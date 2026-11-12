-- Apply once to an existing prototype database before deploying the hardened API.
CREATE UNIQUE INDEX IF NOT EXISTS accounts_owner_unique ON accounts(owner_id);

ALTER TABLE ledger_transactions ADD COLUMN IF NOT EXISTS request_fingerprint text;

CREATE TABLE IF NOT EXISTS payment_attempts (
  idempotency_key text PRIMARY KEY,
  user_id text NOT NULL,
  request_fingerprint text NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  method text NOT NULL CHECK (method IN ('instapay','card','wallet')),
  status text NOT NULL CHECK (status IN ('processing','succeeded','failed')),
  provider_ref text,
  ledger_txn_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
