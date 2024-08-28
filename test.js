import test from 'node:test'
import http from 'node:http'
import { createHandler } from './index.js'
import Redis from 'ioredis'
import { once } from 'node:events'
import assert from 'node:assert/strict'
import * as ethers from 'ethers'

let signer
let server
let redis
let api

test.before(async () => {
  signer = ethers.Wallet.createRandom()
  const logger = {
    error: console.error,
    info: console.info,
    request: () => {}
  }

  redis = new Redis()
  await redis.flushall()
  const handler = await createHandler({
    logger,
    redis,
    signerAddress: await signer.getAddress()
  })
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
  await t.test('empty scores', async t => {
    const res = await fetch(`${api}/scores`)
    assert.deepEqual(await res.json(), {})
  })
  await t.test('set scores', async t => {
    {
      const digest = ethers.solidityPackedKeccak256(
        ['address[]', 'int256[]'],
        [['0x000000000000000000000000000000000000dEaD'], ['1']]
      )
      const signed = await signer.signMessage(digest)
      const { v, r, s } = ethers.Signature.from(signed)
      const res = await fetch(`${api}/scores`, {
        method: 'POST',
        body: JSON.stringify({
          scores: {
            '0x000000000000000000000000000000000000dEaD': '1'
          },
          signature: {
            v,
            r,
            s
          }
        })
      })
      assert.strictEqual(res.status, 200)
    }
    {
      const res = await fetch(`${api}/scores`)
      assert.deepEqual(await res.json(), {
        '0x000000000000000000000000000000000000dEaD': '1'
      })
    }
  })
  await t.test('increase scores', async t => {
    {
      const digest = ethers.solidityPackedKeccak256(
        ['address[]', 'int256[]'],
        [['0x000000000000000000000000000000000000dEaD'], ['1']]
      )
      const signed = await signer.signMessage(digest)
      const { v, r, s } = ethers.Signature.from(signed)
      const res = await fetch(`${api}/scores`, {
        method: 'POST',
        body: JSON.stringify({
          scores: {
            '0x000000000000000000000000000000000000dEaD': '1'
          },
          signature: {
            v,
            r,
            s
          }
        })
      })
      assert.strictEqual(res.status, 200)
    }
    {
      const res = await fetch(`${api}/scores`)
      assert.deepEqual(await res.json(), {
        '0x000000000000000000000000000000000000dEaD': '2'
      })
    }
  })
  await t.test('decrease scores', async t => {
    {
      const digest = ethers.solidityPackedKeccak256(
        ['address[]', 'int256[]'],
        [['0x000000000000000000000000000000000000dEaD'], ['-2']]
      )
      const signed = await signer.signMessage(digest)
      const { v, r, s } = ethers.Signature.from(signed)
      const res = await fetch(`${api}/scores`, {
        method: 'POST',
        body: JSON.stringify({
          scores: {
            '0x000000000000000000000000000000000000dEaD': '-2'
          },
          signature: {
            v,
            r,
            s
          }
        })
      })
      assert.strictEqual(res.status, 200)
    }
    {
      const res = await fetch(`${api}/scores`)
      assert.deepEqual(await res.json(), {
        '0x000000000000000000000000000000000000dEaD': '0'
      })
    }
  })
  await t.test('validate signatures', async t => {
    const digest = ethers.solidityPackedKeccak256(
      ['address[]', 'int256[]'],
      [['0x000000000000000000000000000000000000dEaD'], ['2']]
    )
    const signed = await signer.signMessage(digest)
    const { v, r, s } = ethers.Signature.from(signed)
    const res = await fetch(`${api}/scores`, {
      method: 'POST',
      body: JSON.stringify({
        scores: {
          '0x000000000000000000000000000000000000dEaD': '1'
        },
        signature: {
          v,
          r,
          s
        }
      })
    })
    assert.strictEqual(res.status, 403)
  })
})
