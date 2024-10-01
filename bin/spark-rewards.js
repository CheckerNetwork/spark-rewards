import '../lib/instrument.js'
import http from 'node:http'
import { once } from 'node:events'
import { createHandler } from '../index.js'
import Redis from 'ioredis'

const {
  PORT: port = 8000,
  HOST: host = '0.0.0.0',
  REQUEST_LOGGING: requestLogging = 'true',
  SIGNER_ADDRESSES: signerAddresses = [
    '0x4EcdC893Beb09121E4F5cBba469D33F5fF618442', // spark-evaluate
    '0xa0e36151B7074A4F2ec31b741C27E46FcbBE5379', // Patrick
    '0x646ac6F1941CAb0ce3fE1368e9AD30364a9F51dA', // Miroslav
    '0x3ee4A552b1a6519A266AEFb0514633F289FF2A9F' // Julian
  ].join(','),
  REDIS_URL: redisUrl = 'redis://localhost:6379'
} = process.env

const logger = {
  error: console.error,
  info: console.info,
  request: ['1', 'true'].includes(requestLogging) ? console.info : () => {}
}

const redisUrlParsed = new URL(redisUrl)
const redis = new Redis({
  host: redisUrlParsed.hostname,
  port: redisUrlParsed.port,
  username: redisUrlParsed.username,
  password: redisUrlParsed.password,
  family: 6 // required for upstash
})

const handler = await createHandler({ logger, redis, signerAddresses })
const server = http.createServer(handler)
server.listen(port, host)
await once(server, 'listening')
console.log(`http://${host}:${port}`)
