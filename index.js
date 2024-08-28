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

const validateSignature = (signature, participants, signerAddresses) => {
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
    [Object.keys(participants), Object.values(participants)]
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
    typeof body.scores === 'object' && body.scores !== null,
    400,
    '.scores should be an object'
  )
  httpAssert(
    Object.keys(body.scores).every(ethers.isAddress),
    400,
    'All .scores keys should be 0x addresses'
  )
  httpAssert(
    Object.values(body.scores).every(score => {
      try {
        return BigInt(score) > 0n
      } catch {
        return false
      }
    }),
    400,
    'All .scores values should be positive numbers encoded as string'
  )

  validateSignature(body.signature, body.scores, signerAddresses)

  const timestamp = new Date()
  const tx = redis.multi()
  for (const [address, score] of Object.entries(body.scores)) {
    const scheduledRewards = (BigInt(score) * roundReward) / maxScore
    tx.hincrby('rewards', address, scheduledRewards)
    tx.rpush(
      'log',
      JSON.stringify({
        timestamp,
        address,
        score,
        scheduledRewards: String(scheduledRewards)
      })
    )
  }
  const updated = await tx.exec()

  json(
    res,
    Object.fromEntries(
      Object
        .keys(body.scores)
        .map((address, i) => [address, String(updated[i * 2][1])])
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
    typeof body.rewards === 'object' && body.rewards !== null,
    400,
    '.rewards should be an object'
  )
  httpAssert(
    Object.keys(body.rewards).every(ethers.isAddress),
    400,
    'All .rewards keys should be 0x addresses'
  )
  httpAssert(
    Object.values(body.rewards).every(score => {
      try {
        return BigInt(score) > 0n
      } catch {
        return false
      }
    }),
    400,
    'All .rewards values should be positive numbers encoded as string'
  )

  validateSignature(body.signature, body.rewards, signerAddresses)

  const timestamp = new Date()
  const tx = redis.multi()
  for (const [address, amount] of Object.entries(body.rewards)) {
    tx.hincrby('rewards', address, BigInt(amount) * -1n)
    tx.rpush(
      'log',
      JSON.stringify({
        timestamp,
        address,
        scheduledRewards: String(BigInt(amount) * -1n)
      })
    )
  }
  const updated = await tx.exec()

  json(
    res,
    Object.fromEntries(
      Object
        .keys(body.rewards)
        .map((address, i) => [address, String(updated[i * 2][1])])
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
  json(res, (await redis.lrange('log', 0, -1)).map(JSON.parse))
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
