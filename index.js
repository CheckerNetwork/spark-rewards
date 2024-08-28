import * as Sentry from '@sentry/node'
import getRawBody from 'raw-body'
import httpAssert from 'http-assert'
import * as ethers from 'ethers'
import { json, status } from 'http-responders'
import assert from 'node:assert'

const handler = async (req, res, redis, signerAddress) => {
  if (req.method === 'POST' && req.url === '/scores') {
    await handleUpdateScores(req, res, redis, signerAddress)
  } else if (req.method === 'GET' && req.url === '/scores') {
    await handleGetScores(res, redis)
  } else if (req.method === 'GET' && req.url === '/log') {
    await handleGetLog(res, redis)
  } else {
    status(res, 404)
  }
}

async function handleUpdateScores (req, res, redis, signerAddresses) {
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
        BigInt(score)
        return true
      } catch {
        return false
      }
    }),
    400,
    'All .scores values should be numbers encoded as string'
  )
  httpAssert(
    typeof body.signature === 'object' && body.scores !== null,
    400,
    '.signature should be an object'
  )
  httpAssert.deepEqual(
    Object.keys(body.signature).sort(),
    ['r', 's', 'v'],
    400,
    '.signature should have keys .r, .s and .v'
  )

  const digest = ethers.solidityPackedKeccak256(
    ['address[]', 'int256[]'],
    [Object.keys(body.scores), Object.values(body.scores)]
  )
  const reqSigner = ethers.verifyMessage(
    digest,
    ethers.Signature.from(body.signature)
  )
  httpAssert(signerAddresses.includes(reqSigner), 403, 'Invalid signature')

  const start = new Date()
  const tx = redis.multi()
  for (const [address, score] of Object.entries(body.scores)) {
    tx.hincrby('scores', address, score)
    tx.rpush('log', JSON.stringify({ timestamp: start, address, score }))
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

async function handleGetScores (res, redis) {
  json(res, await redis.hgetall('scores'))
}

async function handleGetLog (res, redis) {
  json(
    res,
    (await redis.lrange('log', 0, -1)).map(JSON.parse)
  )
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
