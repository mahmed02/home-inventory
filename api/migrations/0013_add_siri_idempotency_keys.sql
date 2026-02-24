CREATE TABLE IF NOT EXISTS siri_idempotency_keys (
  id bigserial PRIMARY KEY,
  scope_key text NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  response_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_siri_idempotency_scope_key
ON siri_idempotency_keys(scope_key, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_siri_idempotency_expires_at
ON siri_idempotency_keys(expires_at);
