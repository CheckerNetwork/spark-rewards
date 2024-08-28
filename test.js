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
    signerAddresses: [await signer.getAddress()]
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

test('scheduled rewards', async t => {
  // Tests rely on the state created by each other. This is a shortcut and
  // should eventually be improved.

  await t.test('empty scheduled rewards', async t => {
    {
      const res = await fetch(`${api}/scheduled-rewards`)
      assert.deepEqual(await res.json(), {})
    }
    {
      const res = await fetch(`${api}/log`)
      assert.deepEqual(await res.json(), [])
    }
  })
  await t.test('set scores', async t => {
    {
      const digest = ethers.solidityPackedKeccak256(
        ['address[]', 'uint256[]'],
        [
          [
            '0x000000000000000000000000000000000000dEaD',
            '0x000000000000000000000000000000000000dEa2'
          ],
          [
            '10',
            '100'
          ]
        ]
      )
      const signed = await signer.signMessage(digest)
      const { v, r, s } = ethers.Signature.from(signed)
      const res = await fetch(`${api}/scores`, {
        method: 'POST',
        body: JSON.stringify({
          scores: {
            '0x000000000000000000000000000000000000dEaD': '10',
            '0x000000000000000000000000000000000000dEa2': '100'
          },
          signature: {
            v,
            r,
            s
          }
        })
      })
      assert.strictEqual(res.status, 200)
      assert.deepStrictEqual(await res.json(), {
        '0x000000000000000000000000000000000000dEaD': '4566',
        '0x000000000000000000000000000000000000dEa2': '45662'

      })
    }
    {
      const res = await fetch(`${api}/scheduled-rewards`)
      assert.deepEqual(await res.json(), {
        '0x000000000000000000000000000000000000dEaD': '4566',
        '0x000000000000000000000000000000000000dEa2': '45662'
      })
    }
    {
      const res = await fetch(`${api}/log`)
      const log = await res.json()
      for (const l of log) {
        assert(l.timestamp)
        delete l.timestamp
      }
      assert.deepEqual(log, [
        {
          address: '0x000000000000000000000000000000000000dEaD',
          score: '10',
          scheduledRewards: '4566'
        },
        {
          address: '0x000000000000000000000000000000000000dEa2',
          score: '100',
          scheduledRewards: '45662'
        }
      ])
    }
  })
  await t.test('increase scores', async t => {
    {
      const digest = ethers.solidityPackedKeccak256(
        ['address[]', 'uint256[]'],
        [['0x000000000000000000000000000000000000dEaD'], ['10']]
      )
      const signed = await signer.signMessage(digest)
      const { v, r, s } = ethers.Signature.from(signed)
      const res = await fetch(`${api}/scores`, {
        method: 'POST',
        body: JSON.stringify({
          scores: {
            '0x000000000000000000000000000000000000dEaD': '10'
          },
          signature: {
            v,
            r,
            s
          }
        })
      })
      assert.strictEqual(res.status, 200)
      assert.deepStrictEqual(await res.json(), {
        '0x000000000000000000000000000000000000dEaD': '9132'
      })
    }
    {
      const res = await fetch(`${api}/scheduled-rewards`)
      assert.deepEqual(await res.json(), {
        '0x000000000000000000000000000000000000dEaD': '9132',
        '0x000000000000000000000000000000000000dEa2': '45662'
      })
    }
    {
      const res = await fetch(`${api}/log`)
      const log = await res.json()
      for (const l of log) {
        assert(l.timestamp)
        delete l.timestamp
      }
      assert.deepEqual(log, [
        {
          address: '0x000000000000000000000000000000000000dEaD',
          score: '10',
          scheduledRewards: '4566'
        },
        {
          address: '0x000000000000000000000000000000000000dEa2',
          score: '100',
          scheduledRewards: '45662'
        },
        {
          address: '0x000000000000000000000000000000000000dEaD',
          score: '10',
          scheduledRewards: '4566'
        }
      ])
    }
  })
  await t.test('paid rewards', async t => {
    {
      const digest = ethers.solidityPackedKeccak256(
        ['address[]', 'uint256[]'],
        [['0x000000000000000000000000000000000000dEaD'], ['9132']]
      )
      const signed = await signer.signMessage(digest)
      const { v, r, s } = ethers.Signature.from(signed)
      const res = await fetch(`${api}/paid`, {
        method: 'POST',
        body: JSON.stringify({
          rewards: {
            '0x000000000000000000000000000000000000dEaD': '9132'
          },
          signature: {
            v,
            r,
            s
          }
        })
      })
      assert.strictEqual(res.status, 200)
      assert.deepStrictEqual(await res.json(), {
        '0x000000000000000000000000000000000000dEaD': '0'
      })
    }
    {
      const res = await fetch(`${api}/scheduled-rewards`)
      assert.deepEqual(await res.json(), {
        '0x000000000000000000000000000000000000dEaD': '0',
        '0x000000000000000000000000000000000000dEa2': '45662'
      })
    }
    {
      const res = await fetch(`${api}/log`)
      const log = await res.json()
      for (const l of log) {
        assert(l.timestamp)
        delete l.timestamp
      }
      assert.deepEqual(log, [
        {
          address: '0x000000000000000000000000000000000000dEaD',
          score: '10',
          scheduledRewards: '4566'
        },
        {
          address: '0x000000000000000000000000000000000000dEa2',
          score: '100',
          scheduledRewards: '45662'
        },
        {
          address: '0x000000000000000000000000000000000000dEaD',
          score: '10',
          scheduledRewards: '4566'
        },
        {
          address: '0x000000000000000000000000000000000000dEaD',
          scheduledRewards: '-9132'
        }
      ])
    }
  })
  await t.test('validate signatures', async t => {
    const digest = ethers.solidityPackedKeccak256(
      ['address[]', 'uint256[]'],
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
