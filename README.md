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

## Development

```bash
redis-server &
npm start
```