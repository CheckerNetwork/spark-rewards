import test, { suite } from 'node:test'
import http from 'node:http'
import { createHandler } from './index.js'
import Redis from 'ioredis'
import { once } from 'node:events'
import assert from 'node:assert/strict'
import * as ethers from 'ethers'
import Redlock from 'redlock'

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
    redlock: new Redlock([redis]),
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

const sign = async (addresses, values) => {
  const digest = ethers.solidityPackedKeccak256(
    ['address[]', 'uint256[]'],
    [addresses, values]
  )
  const signed = await signer.signMessage(digest)
  const { v, r, s } = ethers.Signature.from(signed)
  return { v, r, s }
}

suite('scheduled rewards', () => {
  // Tests rely on the state created by each other. This is a shortcut and
  // should eventually be improved.

  test('empty scheduled rewards', async t => {
    {
      const res = await fetch(`${api}/scheduled-rewards`)
      assert.deepEqual(await res.json(), {})
    }
    {
      const res = await fetch(`${api}/log`)
      assert.deepEqual(await res.json(), [])
    }
  })
  test('ignore burner address', async t => {
    {
      const participants = ['0x000000000000000000000000000000000000dEaD']
      const scores = ['100']
      const res = await fetch(`${api}/scores`, {
        method: 'POST',
        body: JSON.stringify({
          participants,
          scores,
          signature: await sign(participants, scores)
        })
      })
      assert.strictEqual(res.status, 200)
      assert.deepStrictEqual(await res.json(), {})
    }
    {
      const res = await fetch(`${api}/scheduled-rewards`)
      assert.deepEqual(await res.json(), {})
    }
    {
      const res = await fetch(`${api}/log`)
      const log = await res.json()
      assert.deepEqual(log, [])
    }
  })
  test('set scores', async t => {
    {
      const participants = [
        '0x000000000000000000000000000000000000dEa2',
        '0x000000000000000000000000000000000000dEa7'
      ]
      const scores = [
        '10',
        '100'
      ]
      const res = await fetch(`${api}/scores`, {
        method: 'POST',
        body: JSON.stringify({
          participants,
          scores,
          signature: await sign(participants, scores)
        })
      })
      assert.strictEqual(res.status, 200)
      assert.deepStrictEqual(await res.json(), {
        '0x000000000000000000000000000000000000dEa2': '4566',
        '0x000000000000000000000000000000000000dEa7': '45662'

      })
    }
    {
      const res = await fetch(`${api}/scheduled-rewards`)
      assert.deepEqual(await res.json(), {
        '0x000000000000000000000000000000000000dEa2': '4566',
        '0x000000000000000000000000000000000000dEa7': '45662'
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
          address: '0x000000000000000000000000000000000000dEa2',
          score: '10',
          scheduledRewardsDelta: '4566'
        },
        {
          address: '0x000000000000000000000000000000000000dEa7',
          score: '100',
          scheduledRewardsDelta: '45662'
        }
      ])
    }
  })
  test('increase scores', async t => {
    {
      const participants = ['0x000000000000000000000000000000000000dEa2']
      const scores = ['10']
      const res = await fetch(`${api}/scores`, {
        method: 'POST',
        body: JSON.stringify({
          participants,
          scores,
          signature: await sign(participants, scores)
        })
      })
      assert.strictEqual(res.status, 200)
      assert.deepStrictEqual(await res.json(), {
        '0x000000000000000000000000000000000000dEa2': '9132'
      })
    }
    {
      const res = await fetch(`${api}/scheduled-rewards`)
      assert.deepEqual(await res.json(), {
        '0x000000000000000000000000000000000000dEa2': '9132',
        '0x000000000000000000000000000000000000dEa7': '45662'
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
          address: '0x000000000000000000000000000000000000dEa2',
          score: '10',
          scheduledRewardsDelta: '4566'
        },
        {
          address: '0x000000000000000000000000000000000000dEa7',
          score: '100',
          scheduledRewardsDelta: '45662'
        },
        {
          address: '0x000000000000000000000000000000000000dEa2',
          score: '10',
          scheduledRewardsDelta: '4566'
        }
      ])
    }
  })
  test('big integer', async t => {
    const participants = [
      '0x000000000000000000000000000000000000dE12'
    ]
    const scores = [
      '1000000000000000000000000000'
    ]
    const res = await fetch(`${api}/scores`, {
      method: 'POST',
      body: JSON.stringify({
        participants,
        scores,
        signature: await sign(participants, scores)
      })
    })
    assert.strictEqual(res.status, 200)
    assert.deepStrictEqual(await res.json(), {
      '0x000000000000000000000000000000000000dE12': '456621004566210048000000000000'
    })
  })
  test('paid rewards', async t => {
    {
      const participants = ['0x000000000000000000000000000000000000dEa2']
      const rewards = ['9132']
      const res = await fetch(`${api}/paid`, {
        method: 'POST',
        body: JSON.stringify({
          participants,
          rewards,
          signature: await sign(participants, rewards)
        })
      })
      assert.strictEqual(res.status, 200)
      assert.deepStrictEqual(await res.json(), {
        '0x000000000000000000000000000000000000dEa2': '0'
      })
    }
    {
      const res = await fetch(`${api}/scheduled-rewards`)
      assert.deepEqual(await res.json(), {
        '0x000000000000000000000000000000000000dEa2': '0',
        '0x000000000000000000000000000000000000dEa7': '45662',
        '0x000000000000000000000000000000000000dE12': '456621004566210048000000000000'
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
          address: '0x000000000000000000000000000000000000dEa2',
          score: '10',
          scheduledRewardsDelta: '4566'
        },
        {
          address: '0x000000000000000000000000000000000000dEa7',
          score: '100',
          scheduledRewardsDelta: '45662'
        },
        {
          address: '0x000000000000000000000000000000000000dEa2',
          score: '10',
          scheduledRewardsDelta: '4566'
        },
        {
          address: '0x000000000000000000000000000000000000dE12',
          score: '1000000000000000000000000000',
          scheduledRewardsDelta: '456621004566210048000000000000'
        },
        {
          address: '0x000000000000000000000000000000000000dEa2',
          scheduledRewardsDelta: '-9132'
        }
      ])
    }
  })
  suite('validate signatures', () => {
    test('bad argument', async t => {
      const digest = ethers.solidityPackedKeccak256(
        ['address[]', 'uint256[]'],
        [['0x000000000000000000000000000000000000dEa2'], ['2']]
      )
      const signed = await signer.signMessage(digest)
      const { v, r, s } = ethers.Signature.from(signed)
      const res = await fetch(`${api}/scores`, {
        method: 'POST',
        body: JSON.stringify({
          participants: ['0x000000000000000000000000000000000000dEa2'],
          scores: ['1'],
          signature: { v, r, s }
        })
      })
      assert.strictEqual(res.status, 403)
    })
    test('bad signer', async t => {
      const participants = ['0x000000000000000000000000000000000000dEa2']
      const scores = ['2']
      const digest = ethers.solidityPackedKeccak256(
        ['address[]', 'uint256[]'],
        [participants, scores]
      )
      const signed = await ethers.Wallet.createRandom().signMessage(digest)
      const { v, r, s } = ethers.Signature.from(signed)
      const res = await fetch(`${api}/scores`, {
        method: 'POST',
        body: JSON.stringify({
          participants,
          scores,
          signature: { v, r, s }
        })
      })
      assert.strictEqual(res.status, 403)
    })
  })
  test('single scheduled rewards', async t => {
    {
      const res = await fetch(
        `${api}/scheduled-rewards/0x000000000000000000000000000000000000dEa2`
      )
      assert.strictEqual(await res.json(), '0')
    }
    {
      const res = await fetch(
        `${api}/scheduled-rewards/0xunknown`
      )
      assert.strictEqual(await res.json(), null)
    }
  })
})
