#!/usr/bin/env node

import { ethers } from 'ethers'
import { LedgerSigner } from '@ethers-ext/signer-ledger'
import HIDTransport from '@ledgerhq/hw-transport-node-hid'
import * as SparkImpactEvaluator from '@filecoin-station/spark-impact-evaluator'
import readline from 'node:readline/promises'
import pRetry from 'p-retry'

process.title = 'release-rewards'
const { RPC_URL = 'https://api.node.glif.io/rpc/v1', WALLET_SEED } = process.env

const rawRewardsRes = await fetch('https://spark-rewards.fly.dev/scheduled-rewards')
const rawRewards = await rawRewardsRes.json()
const rewards = Object.entries(rawRewards)
  .map(([address, amount]) => ({
    address,
    amount: BigInt(amount),
    amountFIL: Number(amount) / 1e18
  }))
  .filter(({ amount }) => amount > 0n)
if (rewards.length === 0) {
  console.log('No rewards to release')
  process.exit(0)
}
rewards.sort((a, b) => Number(b.amount - a.amount))

const total = rewards.reduce((acc, { amount }) => acc + amount, 0n)
console.log(
  `About to send ~${Math.ceil(Number(total) / 1e18)} FIL (+~10FIL gas) ${WALLET_SEED ? '' : 'from your hardware wallet (Eth account)'} to the IE`
)
const rl = readline.createInterface(process.stdin, process.stdout)
const answer = await rl.question('Continue? ([y]es/[n]o) ')
if (!/^y(es)?$/.test(answer)) {
  process.exit(1)
}

const provider = new ethers.JsonRpcProvider(RPC_URL)
const signer = WALLET_SEED
  ? ethers.Wallet.fromPhrase(WALLET_SEED, provider)
  : new LedgerSigner(HIDTransport, provider)
const ie = new ethers
  .Contract(SparkImpactEvaluator.ADDRESS, SparkImpactEvaluator.ABI, provider)
  .connect(signer)

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
    console.log(`${address},${batchAmounts[j]}`)
  }
  console.log(`^ Batch ${i + 1}/${batchCount}`)
  if (!WALLET_SEED) {
    console.log('Please approve on ledger...')
  }
  const tx = await ie.addBalances(
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
      const err = new Error(await res.text().catch(() => 'Unknown error'))
      err.batchIndex = i
      console.error(err)
      throw err
    }
  })
}

console.log('Done!')
process.exit()
