# spark-rewards

## Routes

### `GET /scores`

Response:

```js
{
  "address1": "score1",
  "address2": "score2",
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
  "updatedAdress1": "score1",
  "updatedAddress2": "score2",
  // ...
}
```

### `GET /log`

Response:

```js
[
  { timestamp: "2024-08-28T14:15:08.113Z", address: "address1", score: "scoreUpdate1" },
  { timestamp: "2024-08-28T14:15:08.113Z", address: "address2", score: "scoreUpdate1" },
  { timestamp: "2024-08-28T14:15:25.441Z", address: "address1", score: "scoreUpdate2" }
  ...
]
```

## Development

```bash
redis-server &
npm start
```