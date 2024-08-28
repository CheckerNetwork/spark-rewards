import * as Sentry from '@sentry/node'
import getRawBody from 'raw-body'
import httpAssert from 'http-assert'
import { isAddress } from 'ethers'
import { json, status } from 'http-responders'

const handler = async (req, res, redis) => {
  if (req.method === 'POST' && req.url === '/scores') {
    // TODO: Validate signature

    const body = await getRawBody(req, { limit: '1mb' })
    const participants = JSON.parse(body)

    httpAssert(
      typeof participants === 'object' && participants !== null,
      400,
      'Request body should be an object'
    )
    httpAssert(
      Object.keys(participants).every(isAddress),
      400,
      'All keys should be 0x addresses'
    )
    httpAssert(
      Object.values(participants).every(Number.isInteger),
      400,
      'All values should be integers'
    )

    for (const [address, score] of Object.entries(participants)) {
      await redis.hincrby('scores', address, score)
    }
    status(res, 200)
  } else {
    status(res, 404)
  }
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

export const createHandler = async ({ logger, redis }) => {
  return (req, res) => {
    const start = new Date()
    logger.request(`${req.method} ${req.url} ...`)
    handler(req, res, redis)
      .catch(err => errorHandler(res, err, logger))
      .then(() => {
        logger.request(
          `${req.method} ${req.url} ${res.statusCode} (${new Date() - start}ms)`
        )
      })
  }
}
