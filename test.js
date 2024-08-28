import test from 'node:test'
import http from 'node:http'
import { createHandler } from './index.js'
import Redis from 'ioredis'
import { once } from 'node:events'
import assert from 'node:assert/strict'

let server
let redis
let api

test.before(async () => {
  const logger = {
    error: console.error,
    info: console.info,
    request: () => {}
  }

  redis = new Redis()
  await redis.flushall()
  const handler = await createHandler({ logger, redis })
  server = http.createServer(handler)
  server.listen()
  await once(server, 'listening')
  api = `http://127.0.0.1:${server.address().port}`
})

test.after(() => {
  server.close()
  redis.disconnect()
})

test('scores', async t => {
  {
    const res = await fetch(`${api}/scores`)
    assert.deepEqual(await res.json(), {})
  }
  {
    const res = await fetch(`${api}/scores`, {
      method: 'POST',
      body: JSON.stringify({
        '0x000000000000000000000000000000000000dEaD': '1'
      })
    })
    assert(res.ok)
  }
  {
    const res = await fetch(`${api}/scores`)
    assert.deepEqual(await res.json(), {
      '0x000000000000000000000000000000000000dEaD': '1'
    })
  }
  {
    const res = await fetch(`${api}/scores`, {
      method: 'POST',
      body: JSON.stringify({
        '0x000000000000000000000000000000000000dEaD': '1'
      })
    })
    assert(res.ok)
  }
  {
    const res = await fetch(`${api}/scores`)
    assert.deepEqual(await res.json(), {
      '0x000000000000000000000000000000000000dEaD': '2'
    })
  }
})
