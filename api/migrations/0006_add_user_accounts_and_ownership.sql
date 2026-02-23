CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE locations
  ADD COLUMN owner_user_id uuid REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE items
  ADD COLUMN owner_user_id uuid REFERENCES users(id) ON DELETE CASCADE;

DROP INDEX IF EXISTS uq_locations_code_nonnull;
CREATE UNIQUE INDEX uq_locations_owner_code_nonnull
  ON locations(owner_user_id, code)
  WHERE owner_user_id IS NOT NULL AND code IS NOT NULL;
CREATE UNIQUE INDEX uq_locations_legacy_code_nonnull
  ON locations(code)
  WHERE owner_user_id IS NULL AND code IS NOT NULL;

CREATE INDEX idx_locations_owner_user_id ON locations(owner_user_id);
CREATE INDEX idx_items_owner_user_id ON items(owner_user_id);
CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_expires_at ON user_sessions(expires_at);

CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
