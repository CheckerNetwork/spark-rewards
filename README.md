# spark-rewards

## Routes

### `GET /scheduled-rewards`

Response:

```js
{
  "address1": "scheduledRewards1",
  "address2": "scheduledRewards2",
  // ...
}
```

### `POST /scores`

Request:

```js
{
  "participants": {
    "address1": "score1",
    "address2": "score2"
  },
  "signature": {
    "r": "...",
    "s": "...",
    "v": "..."
  }
}
```

Response:

```js
{
  "updatedAdress1": "scheduledRewards1",
  "updatedAddress2": "scheduledRewards2",
  // ...
}
```

### `POST /paid`

Request:

```js
{
  "participants": {
    "address1": "amount1",
    "address2": "amount2",
    // ...
  },
  "signature": {
    "r": "...",
    "s": "...",
    "v": "..."
  }
}
```

Response:

```js
{
  "adddress1": "scheduledRewards1",
  "address2": "scheduledRewards2",
  // ...
}
```

### `GET /log`

Response:

```js
[
  {
    timestamp: "2024-08-28T14:15:08.113Z",
    address: "address1",
    score: "scoreUpdate1",
    scheduledRewards: "scheduledRewardsUpdate1"
  }, {
    timestamp: "2024-08-28T14:15:08.113Z",
    address: "address2",
    score: "scoreUpdate1",
    scheduledRewards: "scheduledRewardsUpdate1"
  }, {
    timestamp: "2024-08-28T14:15:25.441Z",
    address: "address1",
    scheduledRewards: "scheduledRewardsUpdate2"
  }
  ...
]
```

## Development

```bash
redis-server &
npm start
```