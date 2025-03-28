#!/usr/bin/env node

import { ethers } from 'ethers'
import { LedgerSigner } from '@ethers-ext/signer-ledger'
import HIDTransport from '@ledgerhq/hw-transport-node-hid'
import * as SparkImpactEvaluator from '@filecoin-station/spark-impact-evaluator'
import readline from 'node:readline/promises'
import pRetry from 'p-retry'
import beeper from 'beeper'
import pMap from 'p-map'
import assert from 'node:assert'

process.title = 'commit-rewards'
const {
  RPC_URL = 'https://api.node.glif.io/rpc/v1',
  WALLET_SEED,
  GLIF_TOKEN
} = process.env

assert(GLIF_TOKEN, 'GLIF_TOKEN required')

const fetchRequest = new ethers.FetchRequest(RPC_URL)
fetchRequest.setHeader('Authorization', `Bearer ${GLIF_TOKEN}`)
const provider = new ethers.JsonRpcProvider(fetchRequest)
const ie = new ethers.Contract(SparkImpactEvaluator.ADDRESS, SparkImpactEvaluator.ABI, provider)

const rawRewardsRes = await fetch('https://spark-rewards.fly.dev/scheduled-rewards')
const rawRewards = /** @type {Record<string, string>} */ (await rawRewardsRes.json())
const unfilteredRewards = Object.entries(rawRewards)
  .map(([address, amount]) => ({
    address,
    amount: BigInt(amount)
  }))
unfilteredRewards.sort((a, b) => Number(b.amount - a.amount))

console.log(`Found ${unfilteredRewards.length} participants with spark-rewards scheduled rewards`)
console.log('Filtering out participants with total scheduled rewards (spark-rewards + smart contract) below 0.1 FIL...')
/** @type {{address: string, amount: bigint}[]} */
const rewardsBeforeCompliance = []
await pMap(
  unfilteredRewards,
  async ({ address, amount }, index) => {
    if (index > 0 && index % 100 === 0) {
      console.log(`${index}/${unfilteredRewards.length}`)
    }
    if (amount === 0n) return
    const totalScheduledRewards =
      (await ie.rewardsScheduledFor(address)) + amount
    if (totalScheduledRewards >= 0.1 * 1e18) {
      rewardsBeforeCompliance.push({ address, amount })
    }
  },
  { concurrency: 100 }
)
console.log(`Filtered out ${unfilteredRewards.length - rewardsBeforeCompliance.length} participants with total scheduled rewards below 0.1 FIL`)

console.log('Filtering out sanctioned participants...')

/** @type {typeof rewardsBeforeCompliance} */
const rewards = []
await pMap(
  rewardsBeforeCompliance,
  async ({ address, amount }, index) => {
    if (index > 0 && index % 100 === 0) {
      console.log(`${index}/${rewardsBeforeCompliance.length}`)
    }
    const res = await pRetry(
      () => fetch(`https://station-wallet-screening.fly.dev/${address}`),
      {
        retries: 1000,
        onFailedAttempt: () =>
          console.error('Failed to validate FIL_WALLET_ADDRESS address. Retrying...')
      }
    )
    if (res.ok) {
      rewards.push({ address, amount })
    } else {
      console.error(`Participant ${address} failed screening`)
    }
  },
  { concurrency: 100 }
)
console.log(`Filtered out ${rewards.length - rewardsBeforeCompliance.length} sanctioned participants`)

if (rewards.length === 0) {
  console.log('No rewards to commit')
  process.exit(0)
}
const total = rewards.reduce((acc, { amount }) => acc + amount, 0n)
console.log(
  `About to send ~${Math.ceil(Number(total) / 1e18)} FIL (+~10FIL gas) ${WALLET_SEED ? '' : 'from your hardware wallet (Eth account)'} to the IE`
)
const rl = readline.createInterface(process.stdin, process.stdout)
await beeper()
const answer = await rl.question('Continue? ([y]es/[n]o) ')
if (!/^y(es)?$/i.test(answer)) {
  process.exit(1)
}

const signer = WALLET_SEED
  ? ethers.Wallet.fromPhrase(WALLET_SEED, provider)
  : new LedgerSigner(HIDTransport, provider)

const ieWithSigner = /** @type {ethers.BaseContract & import('../types/spark-impact-evaluator.js').SparkImpactEvaluator } */ (
  ie.connect(signer)
)

const addresses = rewards.map(({ address }) => address)
const amounts = rewards.map(({ amount }) => amount)
const batchSize = 1000
const batchCount = Math.ceil(addresses.length / batchSize)

for (let i = 0; i < batchCount; i++) {
  const batchStartIndex = i * batchSize
  const batchEndIndex = Math.min((i + 1) * batchSize, addresses.length)
  const batchAddresses = addresses.slice(batchStartIndex, batchEndIndex)
  const batchAmounts = amounts.slice(batchStartIndex, batchEndIndex)

  console.log('address,amount')
  for (const [j, address] of Object.entries(batchAddresses)) {
    console.log(`${address},${batchAmounts[Number(j)]}`)
  }
  console.log(`^ Batch ${i + 1}/${batchCount}`)
  if (!WALLET_SEED) {
    await beeper()
    console.log('Please approve on ledger...')
  }

  const tx = await ieWithSigner.addBalances(
    batchAddresses,
    batchAmounts,
    { value: batchAmounts.reduce((acc, amount) => acc + amount, 0n) }
  )
  console.log(`Awaiting confirmation of ${tx.hash}`)
  await tx.wait()

  const digest = ethers.solidityPackedKeccak256(
    ['address[]', 'uint256[]'],
    [batchAddresses, batchAmounts]
  )

  if (!WALLET_SEED) {
    await beeper()
    await rl.question('Ensure ledger is unlocked, hit enter to continue...')
    console.log(`Please sign batch ${i + 1}/${batchCount} on ledger...`)
  }
  const signed = await signer.signMessage(digest)
  const { v, r, s } = ethers.Signature.from(signed)
  await pRetry(async () => {
    const res = await fetch('https://spark-rewards.fly.dev/paid', {
      method: 'POST',
      body: JSON.stringify({
        participants: batchAddresses,
        rewards: batchAmounts.map(amount => String(amount)),
        signature: { v, r, s }
      })
    })
    if (res.ok) {
      console.log('OK')
    } else if (!res.ok) {
      const err = Object.assign(new Error(await res.text().catch(() => 'Unknown error')), { batchIndex: i })
      console.error(err)
      throw err
    }
  })
}

console.log('Done!')
process.exit()
