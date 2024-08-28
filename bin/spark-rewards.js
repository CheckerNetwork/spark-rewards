import '../lib/instrument.js'
import http from 'node:http'
import { once } from 'node:events'
import { createHandler } from '../index.js'
import Redis from 'ioredis'

const {
  PORT: port = 8000,
  HOST: host = '127.0.0.1',
  REQUEST_LOGGING: requestLogging = 'true',
  // spark-evaluate
  SIGNER_ADDRESS: signerAddress = '0x4EcdC893Beb09121E4F5cBba469D33F5fF618442'
} = process.env

const logger = {
  error: console.error,
  info: console.info,
  request: ['1', 'true'].includes(requestLogging) ? console.info : () => {}
}

const redis = new Redis()

const handler = await createHandler({ logger, redis, signerAddress })
const server = http.createServer(handler)
server.listen(port, host)
await once(server, 'listening')
console.log(`http://${host}:${port}`)
