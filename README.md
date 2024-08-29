# spark-rewards

This implements revision D of [Meridian: Off-chain scheduled rewards](https://spacemeridian.notion.site/Meridian-Off-chain-scheduled-rewards-f9480ef009464ecfaf02a4f752cc4d70).

## Routes

### `GET /scheduled-rewards`

Response:

```js
{
  "address": "scheduledRewardsInAttoFIL",
  // ...
}
```

### `GET /scheduled-rewards/:address`

Response:

```js
"scheduledRewardsInAttoFIL"
```

### `POST /scores`

Request:

```js
{
  "participants": ["address" /* ... */],
  "scores": ["score" /* ... */],
  "signature": {
    "r": "...",
    "s": "...",
    "v": "..."
  }
}
```

Sign over a packed keccak256 with this schema:

```js
['address[]', 'uint256[]']
```

The response includes the resulting scheduled rewards of all affected
participants:

```js
{
  "address": "scheduledRewardsInAttoFIL",
  // ...
}
```

### `POST /paid`

Request:

```js
{
  "participants": ["address" /* ... */],
  "rewards": ["amountInAttoFIL", /* ... */],
  "signature": {
    "r": "...",
    "s": "...",
    "v": "..."
  }
}
```

Sign over a packed keccak256 with this schema:

```js
['address[]', 'uint256[]']
```

The response includes the resulting scheduled rewards of all affected
participants:

```js
{
  "adddress": "scheduledRewardsInAttoFIL",
  // ...
}
```

### `GET /log`

The log endpoint returns an audit trail of all scheduled rewards changes over
time:

```js
[
  {
    timestamp: "2024-08-28T14:15:08.113Z",
    address: "address",
    scheduledRewards: "scheduledRewardsInAttoFIL",
    score: "score"
  }, {
    timestamp: "2024-08-28T14:15:25.441Z",
    address: "address",
    scheduledRewards: "scheduledRewardsInAttoFIL"
    // In case of a payout, no `score` is logged
  }
  // ...
]
```

## Development

```bash
redis-server &
npm start
```