import '../lib/instrument.js'
import http from 'node:http'
import { once } from 'node:events'
import { createHandler } from '../index.js'

const {
  PORT = 8000,
  HOST = '127.0.0.1',
  REQUEST_LOGGING = 'true'
} = process.env

const logger = {
  error: console.error,
  info: console.info,
  request: ['1', 'true'].includes(REQUEST_LOGGING) ? console.info : () => {}
}

const handler = await createHandler({ logger })
const server = http.createServer(handler)
server.listen(PORT, HOST)
await once(server, 'listening')
console.log(`http://${HOST}:${PORT}`)
