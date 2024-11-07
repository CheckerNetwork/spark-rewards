import Redis from 'ioredis'

const {
  REDIS_URL: redisUrl = 'redis://localhost:6379'
} = process.env

const redisUrlParsed = new URL(redisUrl)
const redis = new Redis({
  host: redisUrlParsed.hostname,
  port: redisUrlParsed.port,
  username: redisUrlParsed.username,
  password: redisUrlParsed.password,
  family: 6 // required for upstash
})

const rewards = await redis.hgetall('rewards')

console.log('INSERT INTO scheduled_rewards (address, amount)')
console.log('VALUES')
console.log(
  Object.entries(rewards)
    .map(([address, amount]) => `('${address}', ${amount})`)
    .join(',\n')
)
console.log(';')

process.exit()
