import * as Sentry from '@sentry/node'
import getRawBody from 'raw-body'
import httpAssert from 'http-assert'
import * as ethers from 'ethers'
import { json, status } from 'http-responders'
import assert from 'node:assert'

const maxScore = BigInt(1e15)
// https://github.com/filecoin-station/spark-impact-evaluator/blob/fd64313a96957fcb3d5fda0d334245601676bb73/test/Spark.t.sol#L11C39-L11C65
const roundReward = 456621004566210048n

const handler = async (req, res, redis, redlock, signerAddresses, logger) => {
  if (req.method === 'POST' && req.url === '/scores') {
    await handleIncreaseScores(req, res, redis, signerAddresses, redlock, logger)
  } else if (req.method === 'POST' && req.url === '/paid') {
    await handlePaidScheduledRewards(req, res, redis, signerAddresses, redlock, logger)
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

const addLogJSON = (tx, obj) => {
  tx.rpush('log', JSON.stringify(obj))
  // Keep ca. 30 days of data:
  // 3 rounds per hour * 24 hours * 30 days * 5000 participants
  tx.ltrim('log', -(3 * 24 * 5000 * 30), -1)
}

async function handleIncreaseScores (req, res, redis, signerAddresses, redlock, logger) {
  const body = JSON.parse(await getRawBody(req, { limit: '1mb' }))
  const timestamp = new Date()

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
  const scheduledRewardsDelta = body.scores.map(score => {
    return (BigInt(score) * roundReward) / maxScore
  })
  let updatedRewards

  const lock = await redlock.lock('lock:rewards', 20_000)
  try {
    const currentRewards = (await redis.hmget('rewards', ...body.participants)).map(amount => {
      return BigInt(amount || '0')
    })
    updatedRewards = body.scores.map((_, i) => {
      return currentRewards[i] + scheduledRewardsDelta[i]
    })

    const tx = redis.multi()
    tx.hset(
      'rewards',
      Object.fromEntries(body.participants.map((address, i) => ([
        address,
        String(updatedRewards[i])
      ])))
    )
    for (let i = 0; i < body.participants.length; i++) {
      addLogJSON(tx, {
        timestamp,
        address: body.participants[i],
        score: body.scores[i],
        scheduledRewardsDelta: String(scheduledRewardsDelta[i])
      })
    }
    await tx.exec()
  } finally {
    await lock.unlock()
  }

  json(
    res,
    Object.fromEntries(
      body.participants.map((address, i) => [
        address,
        String(updatedRewards[i])
      ])
    )
  )
}

async function handlePaidScheduledRewards (req, res, redis, signerAddresses, redlock, logger) {
  const body = JSON.parse(await getRawBody(req, { limit: '1mb' }))
  const timestamp = new Date()

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
  let updatedRewards

  const lock = await redlock.lock('lock:rewards', 20_000)
  try {
    const currentRewards = (await redis.hmget('rewards', ...body.participants)).map(amount => {
      return BigInt(amount || '0')
    })
    updatedRewards = body.rewards.map((amount, i) => {
      return currentRewards[i] - BigInt(amount)
    })

    const tx = redis.multi()
    tx.hset(
      'rewards',
      Object.fromEntries(body.participants.map((address, i) => ([
        address,
        String(updatedRewards[i])
      ])))
    )
    for (let i = 0; i < body.participants.length; i++) {
      addLogJSON(tx, {
        timestamp,
        address: body.participants[i],
        scheduledRewardsDelta: String(BigInt(body.rewards[i]) * -1n)
      })
    }
    await tx.exec()
  } finally {
    await lock.unlock()
  }

  json(
    res,
    Object.fromEntries(
      body.participants.map((address, i) => [
        address,
        String(updatedRewards[i])
      ])
    )
  )
}

async function handleGetAllScheduledRewards (res, redis) {
  json(res, await redis.hgetall('rewards'))
}

async function handleGetSingleScheduledRewards (req, res, redis) {
  const address = req.url.split('/').pop()
  json(
    res,
    (await redis.hget('rewards', address)) || '0'
  )
}

async function handleGetLog (res, redis) {
  res.setHeader('Content-Type', 'application/json')
  res.write('[')

  // Fetch logs in batches to avoid upstash request size limit
  // https://upstash.com/docs/redis/troubleshooting/max_request_size_exceeded
  let offset = 0
  const batchSize = 1000
  while (true) {
    const batch = await redis.lrange('log', offset, offset + batchSize - 1)
    if (batch.length === 0) {
      break
    }
    offset += batchSize
    res.write(batch.join(','))
  }

  res.end(']')
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

export const createHandler = async ({ logger, redis, signerAddresses, redlock }) => {
  assert(logger, '.logger required')
  assert(redis, '.redis required')
  assert(redlock, '.redlock required')
  assert(signerAddresses, '.signerAddresses required')

  return (req, res) => {
    const start = new Date()
    logger.request(`${req.method} ${req.url} ...`)
    handler(req, res, redis, redlock, signerAddresses, logger)
      .catch(err => errorHandler(res, err, logger))
      .then(() => {
        logger.request(
          `${req.method} ${req.url} ${res.statusCode} (${new Date() - start}ms)`
        )
      })
  }
}
