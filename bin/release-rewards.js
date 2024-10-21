#!/usr/bin/env node

import { ethers } from 'ethers'
import { LedgerSigner } from '@ethers-ext/signer-ledger'
import HIDTransport from '@ledgerhq/hw-transport-node-hid'
import * as SparkImpactEvaluator from '@filecoin-station/spark-impact-evaluator'
import readline from 'node:readline/promises'

process.title = 'release-rewards'
const { RPC_URL = 'https://api.node.glif.io/rpc/v1' } = process.env

const provider = new ethers.JsonRpcProvider(RPC_URL)
const signer = new LedgerSigner(HIDTransport, provider)
const ie = new ethers
  .Contract(SparkImpactEvaluator.ADDRESS, SparkImpactEvaluator.ABI, provider)
  .connect(signer)

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
  `About to send ~${Math.round(Number(total) / 1e18)} FIL from your hardware wallet (Eth account) to the IE`
)
const rl = readline.createInterface(process.stdin, process.stdout)
const answer = await rl.question('Continue? ([y]es/[n]o) ')
if (!/^y(es)?$/.test(answer)) {
  process.exit(1)
}

const addresses = rewards.map(({ address }) => address)
const amounts = rewards.map(({ amount }) => amount)

const batchSize = 1000
for (let i = 0; i < addresses.length; i += batchSize) {
  const batchAddresses = addresses.slice(i, i + batchSize)
  const batchAmounts = amounts.slice(i, i + batchSize)
  console.log('address,amount')
  for (const [j, address] of Object.entries(batchAddresses)) {
    console.log(`${address},${batchAmounts[j]}`)
  }
  console.log(`^ Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(addresses.length / batchSize)}`)
  console.log('Please approve on ledger...')
  const tx = await ie.addBalances(
    batchAddresses,
    batchAmounts,
    { value: batchAmounts.reduce((acc, amount) => acc + amount, 0n) }
  )
  console.log(tx.hash)
  console.log('Awaiting confirmation...')
  await tx.wait()

  console.log('Please sign on ledger...')
  const digest = ethers.solidityPackedKeccak256(
    ['address[]', 'uint256[]'],
    [batchAddresses, batchAmounts]
  )
  const signed = await signer.signMessage(digest)
  const { v, r, s } = ethers.Signature.from(signed)
  const paidRes = await fetch('https://spark-rewards.fly.dev/paid', {
    method: 'POST',
    body: JSON.stringify({
      participants: batchAddresses,
      rewards: batchAmounts.map(amount => String(amount)),
      signature: { v, r, s }
    })
  })
  if (!paidRes.ok) {
    console.error(await paidRes.text())
    process.exit(1)
  }
}

console.log('Done!')
process.exit()
