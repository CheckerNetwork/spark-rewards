import * as Sentry from '@sentry/node'
import getRawBody from 'raw-body'
import httpAssert from 'http-assert'
import * as ethers from 'ethers'
import { json, status } from 'http-responders'
import assert from 'node:assert'

const maxScore = BigInt(1e15)
// https://github.com/filecoin-station/spark-impact-evaluator/blob/fd64313a96957fcb3d5fda0d334245601676bb73/test/Spark.t.sol#L11C39-L11C65
const roundReward = 456621004566210048n

const handler = async (req, res, redis, signerAddresses) => {
  if (req.method === 'POST' && req.url === '/scores') {
    await handleIncreaseScores(req, res, redis, signerAddresses)
  } else if (req.method === 'POST' && req.url === '/paid') {
    await handlePaidScheduledRewards(req, res, redis, signerAddresses)
  } else if (req.method === 'GET' && req.url === '/scheduled-rewards') {
    await handleGetAllScheduledRewards(res, redis)
  } else if (req.method === 'GET' && req.url.startsWith('/scheduled-rewards/')) {
    await handleGetSingleScheduledRewards(req, res, redis)
  } else if (req.method === 'GET' && req.url === '/log') {
    await handleGetLog(res, redis)
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

async function handleIncreaseScores (req, res, redis, signerAddresses) {
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

  const timestamp = new Date()
  const tx = redis.multi()
  for (let i = 0; i < body.participants.length; i++) {
    const address = body.participants[i]
    const score = body.scores[i]
    const scheduledRewards = (BigInt(score) * roundReward) / maxScore
    tx.hincrby('rewards', address, scheduledRewards)
    tx.rpush(
      'log',
      JSON.stringify({
        timestamp,
        address,
        score,
        scheduledRewardsDelta: String(scheduledRewards)
      })
    )
  }
  const results = await tx.exec()

  json(
    res,
    Object.fromEntries(
      body.participants.map((address, i) => [
        address,
        // Every other entry is from `hincrby`, which returns the new value.
        // Inside the array there are two fields, the 2nd containing the
        // new value.
        String(results[i * 2][1])
      ])
    )
  )
}

async function handlePaidScheduledRewards (req, res, redis, signerAddresses) {
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

  const timestamp = new Date()
  const tx = redis.multi()
  for (let i = 0; i < body.participants.length; i++) {
    const address = body.participants[i]
    const amount = body.rewards[i]
    tx.hincrby('rewards', address, BigInt(amount) * -1n)
    tx.rpush(
      'log',
      JSON.stringify({
        timestamp,
        address,
        scheduledRewardsDelta: String(BigInt(amount) * -1n)
      })
    )
  }
  const updated = await tx.exec()

  json(
    res,
    Object.fromEntries(
      body.participants.map((address, i) => [
        address,
        String(updated[i * 2][1])
      ])
    )
  )
}

async function handleGetAllScheduledRewards (res, redis) {
  json(res, await redis.hgetall('rewards'))
}

async function handleGetSingleScheduledRewards (req, res, redis) {
  json(res, await redis.hget('rewards', req.url.split('/').pop()))
}

async function handleGetLog (res, redis) {
  const log = await redis.lrange('log', 0, -1)
  res.setHeader('Content-Type', 'application/json')
  res.end(`[${log.join(',')}]`)
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

export const createHandler = async ({ logger, redis, signerAddresses }) => {
  assert(logger, '.logger required')
  assert(redis, '.redis required')
  assert(signerAddresses, '.signerAddresses required')

  return (req, res) => {
    const start = new Date()
    logger.request(`${req.method} ${req.url} ...`)
    handler(req, res, redis, signerAddresses)
      .catch(err => errorHandler(res, err, logger))
      .then(() => {
        logger.request(
          `${req.method} ${req.url} ${res.statusCode} (${new Date() - start}ms)`
        )
      })
  }
}
