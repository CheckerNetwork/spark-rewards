CREATE TABLE scheduled_rewards (
  address TEXT NOT NULL PRIMARY KEY,
  amount NUMERIC NOT NULL,
  CONSTRAINT amount_not_negative CHECK (amount >= 0)
);
CREATE TABLE logs (
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  address TEXT NOT NULL,
  score NUMERIC,
  scheduled_rewards_delta NUMERIC NOT NULL,
  PRIMARY KEY (timestamp, address)
);
