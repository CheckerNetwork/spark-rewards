import Sentry from '@sentry/node'
import getRawBody from 'raw-body'
import httpAssert from 'http-assert'
import { isAddress } from 'ethers'

// TODO: Persistant data structure
const scores = new Map()

const handler = async (req, res) => {
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
      const currentScore = scores.has(address) ? scores.get(address) : 0
      scores.set(address, currentScore + score)
    }
  } else {
    res.statusCode = 404
    res.end('Not Found')
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

export const createHandler = async ({ logger }) => {
  return (req, res) => {
    const start = new Date()
    logger.request(`${req.method} ${req.url} ...`)
    handler(req, res)
      .catch(err => errorHandler(res, err, logger))
      .then(() => {
        logger.request(
          `${req.method} ${req.url} ${res.statusCode} (${new Date() - start}ms)`
        )
      })
  }
}
