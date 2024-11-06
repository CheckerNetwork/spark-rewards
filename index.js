import * as Sentry from '@sentry/node'
import getRawBody from 'raw-body'
import httpAssert from 'http-assert'
import * as ethers from 'ethers'
import { json, status } from 'http-responders'
import assert from 'node:assert'

const maxScore = BigInt(1e15)
// https://github.com/filecoin-station/spark-impact-evaluator/blob/fd64313a96957fcb3d5fda0d334245601676bb73/test/Spark.t.sol#L11C39-L11C65
const roundReward = 456621004566210048n

const handler = async (req, res, pgPool, signerAddresses, logger) => {
  if (req.method === 'POST' && req.url === '/scores') {
    await handleIncreaseScores(req, res, pgPool, signerAddresses, logger)
  } else if (req.method === 'POST' && req.url === '/paid') {
    await handlePaidScheduledRewards(req, res, pgPool, signerAddresses, logger)
  } else if (req.method === 'GET' && req.url === '/scheduled-rewards') {
    await handleGetAllScheduledRewards(res, pgPool)
  } else if (req.method === 'GET' && req.url.startsWith('/scheduled-rewards/')) {
    await handleGetSingleScheduledRewards(req, res, pgPool)
  } else if (req.method === 'GET' && req.url === '/log') {
    await handleGetLog(res, pgPool)
  } else {
    status(res, 404)
  }
}

const validateSignature = (signature, addresses, values, signerAddresses) => {
  httpAssert(
    typeof signature === 'object' && signature !== null,
    400,
    '.signature should be an object'
  )
  httpAssert.deepEqual(
    Object.keys(signature).sort(),
    ['r', 's', 'v'],
    400,
    '.signature should have keys .r, .s and .v'
  )

  const digest = ethers.solidityPackedKeccak256(
    ['address[]', 'int256[]'],
    [addresses, values]
  )
  const reqSigner = ethers.verifyMessage(
    digest,
    ethers.Signature.from(signature)
  )
  httpAssert(signerAddresses.includes(reqSigner), 403, 'Invalid signature')
}

async function handleIncreaseScores (req, res, pgPool, signerAddresses, logger) {
  const body = JSON.parse(await getRawBody(req, { limit: '1mb' }))

  httpAssert(
    typeof body === 'object' && body !== null,
    400,
    'Request body should be an object'
  )
  httpAssert(
    Array.isArray(body.participants),
    400,
    '.participants should be an array'
  )
  httpAssert(
    Array.isArray(body.scores),
    400,
    '.scores should be an array'
  )
  httpAssert.strictEqual(
    body.participants.length,
    body.scores.length,
    400,
    '.participants and .scores should have the same size'
  )
  httpAssert(
    body.participants.every(ethers.isAddress),
    400,
    'All .participants should be 0x addresses'
  )
  httpAssert(
    body.scores.every(score => {
      try {
        return BigInt(score) > 0n
      } catch {
        return false
      }
    }),
    400,
    'All .scores should be positive numbers encoded as string'
  )

  validateSignature(
    body.signature,
    body.participants,
    body.scores,
    signerAddresses
  )

  if (body.participants.includes('0x000000000000000000000000000000000000dEaD')) {
    const index = body.participants.indexOf(
      '0x000000000000000000000000000000000000dEaD'
    )
    body.participants.splice(index, 1)
    body.scores.splice(index, 1)
  }

  if (body.participants.length === 0) {
    return json(res, {})
  }

  logger.info(`Increasing scheduled rewards of ${body.participants.length} participants`)
  const scheduledRewardsDeltas = body.scores.map(score => {
    return (BigInt(score) * roundReward) / maxScore
  })

  const pgClient = await pgPool.connect()
  try {
    await pgClient.query('BEGIN')
    await pgClient.query(`
      INSERT INTO scheduled_rewards (address, amount)
      VALUES (UNNEST($1::TEXT[]), UNNEST($2::NUMERIC[]))
      ON CONFLICT (address) DO UPDATE
        SET amount = scheduled_rewards.amount + EXCLUDED.amount
    `, [body.participants, scheduledRewardsDeltas])
    await pgClient.query(`
      INSERT INTO logs (address, score, scheduled_rewards_delta)
      VALUES (UNNEST($1::TEXT[]), UNNEST($2::NUMERIC[]), UNNEST($3::NUMERIC[]))
    `, [body.participants, body.scores, scheduledRewardsDeltas])
    await pgClient.query(`
      DELETE FROM logs WHERE timestamp < NOW() - INTERVAL '30 days'
    `)
    await pgClient.query('COMMIT')
  } catch (err) {
    await pgClient.query('ROLLBACK')
    throw err
  } finally {
    pgClient.release()
  }

  logger.info(`Increased scheduled rewards of ${body.participants.length} participants`)

  const { rows } = await pgPool.query(`
    SELECT address, amount
    FROM scheduled_rewards
    WHERE address = ANY($1)  
  `, [body.participants])
  json(
    res,
    Object.fromEntries(rows.map(({ address, amount }) => [address, String(amount)]))
  )
}

async function handlePaidScheduledRewards (req, res, pgPool, signerAddresses, logger) {
  const body = JSON.parse(await getRawBody(req, { limit: '1mb' }))

  httpAssert(
    typeof body === 'object' && body !== null,
    400,
    'Request body should be an object'
  )
  httpAssert(
    Array.isArray(body.participants),
    400,
    '.participants should be an array'
  )
  httpAssert(
    Array.isArray(body.rewards),
    400,
    '.rewards should be an array'
  )
  httpAssert.strictEqual(
    body.participants.length,
    body.rewards.length,
    400,
    '.participants and .rewards should have the same size'
  )
  httpAssert(
    body.participants.every(ethers.isAddress),
    400,
    'All .participants should be 0x addresses'
  )
  httpAssert(
    body.rewards.every(amount => {
      try {
        return BigInt(amount) > 0n
      } catch {
        return false
      }
    }),
    400,
    'All .rewards should be positive numbers encoded as string'
  )

  validateSignature(
    body.signature,
    body.participants,
    body.rewards,
    signerAddresses
  )

  if (body.participants.length === 0) {
    return json(res, {})
  }

  logger.info(`Marking scheduled rewards of ${body.participants.length} participants as paid`)
  const scheduledRewardsDeltas = body.rewards.map(r => BigInt(r) * -1n)

  const pgClient = await pgPool.connect()
  try {
    await pgClient.query('BEGIN')
    await pgClient.query(`
      UPDATE scheduled_rewards
      SET
        amount = scheduled_rewards.amount + bulk.amount
      FROM (
        SELECT *
          FROM
            UNNEST($1::TEXT[], $2::NUMERIC[])
          AS t(address, amount)
      ) AS bulk
      WHERE scheduled_rewards.address = bulk.address
    `, [body.participants, scheduledRewardsDeltas])
    await pgClient.query(`
      INSERT INTO logs (address, scheduled_rewards_delta)
      VALUES (UNNEST($1::TEXT[]), UNNEST($2::NUMERIC[]))
    `, [body.participants, scheduledRewardsDeltas])
    await pgClient.query(`
      DELETE FROM logs WHERE timestamp < NOW() - INTERVAL '30 days'
    `)
    await pgClient.query('COMMIT')
  } catch (err) {
    await pgClient.query('ROLLBACK')
    if (err.constraint === 'amount_not_negative') {
      httpAssert.fail(400, `Scheduled rewards would become negative: ${err.detail}`)
    }
    throw err
  } finally {
    pgClient.release()
  }

  logger.info(`Marked scheduled rewards of ${body.participants.length} participants as paid`)

  const { rows } = await pgPool.query(`
    SELECT address, amount
    FROM scheduled_rewards
    WHERE address = ANY($1)  
  `, [body.participants])
  json(
    res,
    Object.fromEntries(rows.map(({ address, amount }) => [address, String(amount)]))
  )
}

async function handleGetAllScheduledRewards (res, pgPool) {
  const { rows } = await pgPool.query(`
    SELECT address, amount
    FROM scheduled_rewards
  `)
  json(
    res,
    Object.fromEntries(rows.map(({ address, amount }) => [address, String(amount)]))
  )
}

async function handleGetSingleScheduledRewards (req, res, pgPool) {
  const address = req.url.split('/').pop()
  const { rows } = await pgPool.query(`
    SELECT amount
    FROM scheduled_rewards
    WHERE address = $1
  `, [address])
  json(
    res,
    String(rows[0]?.amount || '0')
  )
}

async function handleGetLog (res, pgPool) {
  res.setHeader('Content-Type', 'application/json')
  const { rows } = await pgPool.query(`
    SELECT timestamp, address, score, scheduled_rewards_delta
    FROM logs
  `)
  json(res, rows.map(row => ({
    timestamp: row.timestamp,
    address: row.address,
    score: row.score ? String(row.score) : undefined,
    scheduledRewardsDelta: String(row.scheduled_rewards_delta)
  })))
}

const errorHandler = (res, err, logger) => {
  if (err instanceof SyntaxError) {
    res.statusCode = 400
    res.end('Invalid JSON Body')
  } else if (err.statusCode) {
    res.statusCode = err.statusCode
    res.end(err.message)
  } else {
    logger.error(err)
    res.statusCode = 500
    res.end('Internal Server Error')
  }

  if (res.statusCode >= 500) {
    Sentry.captureException(err)
  }
}

export const createHandler = async ({ logger, pgPool, signerAddresses }) => {
  assert(logger, '.logger required')
  assert(pgPool, '.pgPool required')
  assert(signerAddresses, '.signerAddresses required')

  return (req, res) => {
    const start = new Date()
    logger.request(`${req.method} ${req.url} ...`)
    handler(req, res, pgPool, signerAddresses, logger)
      .catch(err => errorHandler(res, err, logger))
      .then(() => {
        logger.request(
          `${req.method} ${req.url} ${res.statusCode} (${new Date() - start}ms)`
        )
      })
  }
}
