import '../lib/instrument.js'
import http from 'node:http'
import { once } from 'node:events'
import { createHandler } from '../index.js'
import pg from 'pg'
import { migrate } from '../migrations/index.js'

const {
  PORT: port = 3000,
  HOST: host = '0.0.0.0',
  REQUEST_LOGGING: requestLogging = 'true',
  SIGNER_ADDRESSES: signerAddresses = [
    '0x4EcdC893Beb09121E4F5cBba469D33F5fF618442', // spark-evaluate
    '0xa0e36151B7074A4F2ec31b741C27E46FcbBE5379', // Patrick
    '0x646ac6F1941CAb0ce3fE1368e9AD30364a9F51dA', // Miroslav
    '0x3ee4A552b1a6519A266AEFb0514633F289FF2A9F' // Julian
  ].join(','),
  DATABASE_URL
} = process.env

const logger = {
  error: console.error,
  info: console.info,
  request: ['1', 'true'].includes(requestLogging) ? console.info : () => {}
}

const pgPool = new pg.Pool({
  connectionString: DATABASE_URL,
  // allow the pool to close all connections and become empty
  min: 0,
  // this values should correlate with service concurrency hard_limit configured in fly.toml
  // and must take into account the connection limit of our PG server, see
  // https://fly.io/docs/postgres/managing/configuration-tuning/
  max: 100,
  // close connections that haven't been used for one second
  idleTimeoutMillis: 1000,
  // automatically close connections older than 60 seconds
  maxLifetimeSeconds: 60
})
pgPool.on('error', err => {
  // Prevent crashing the process on idle client errors, the pool will recover
  // itself. If all connections are lost, the process will still crash.
  // https://github.com/brianc/node-postgres/issues/1324#issuecomment-308778405
  console.error('An idle client has experienced an error', err.stack)
})
await migrate(pgPool)

const handler = await createHandler({ logger, pgPool, signerAddresses })
const server = http.createServer(handler)
server.listen(port, host)
await once(server, 'listening')
console.log(`http://${host}:${port}`)
