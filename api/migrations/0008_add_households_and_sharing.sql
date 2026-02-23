CREATE TABLE households (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE household_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  invited_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, user_id)
);

CREATE TABLE household_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  token_hash text NOT NULL UNIQUE,
  invited_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  accepted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE locations
  ADD COLUMN household_id uuid REFERENCES households(id) ON DELETE SET NULL;

ALTER TABLE items
  ADD COLUMN household_id uuid REFERENCES households(id) ON DELETE SET NULL;

CREATE INDEX idx_household_members_household_id ON household_members(household_id);
CREATE INDEX idx_household_members_user_id ON household_members(user_id);
CREATE INDEX idx_household_invitations_household_id ON household_invitations(household_id);
CREATE INDEX idx_household_invitations_email ON household_invitations(email);
CREATE INDEX idx_household_invitations_expires_at ON household_invitations(expires_at);
CREATE INDEX idx_locations_household_id ON locations(household_id);
CREATE INDEX idx_items_household_id ON items(household_id);

CREATE TEMP TABLE tmp_user_households (
  user_id uuid PRIMARY KEY,
  household_id uuid NOT NULL
) ON COMMIT DROP;

INSERT INTO tmp_user_households(user_id, household_id)
SELECT u.id, gen_random_uuid()
FROM users u;

INSERT INTO households(id, name, created_by_user_id)
SELECT
  t.household_id,
  COALESCE(NULLIF(u.display_name, ''), split_part(u.email, '@', 1), 'Household') || ' Household',
  u.id
FROM tmp_user_households t
JOIN users u ON u.id = t.user_id;

INSERT INTO household_members(household_id, user_id, role, invited_by_user_id)
SELECT household_id, user_id, 'owner', user_id
FROM tmp_user_households;

UPDATE locations l
SET household_id = t.household_id
FROM tmp_user_households t
WHERE l.owner_user_id = t.user_id
  AND l.household_id IS NULL;

UPDATE items i
SET household_id = t.household_id
FROM tmp_user_households t
WHERE i.owner_user_id = t.user_id
  AND i.household_id IS NULL;

DROP INDEX IF EXISTS uq_locations_owner_code_nonnull;
DROP INDEX IF EXISTS uq_locations_legacy_code_nonnull;
CREATE UNIQUE INDEX uq_locations_household_code_nonnull
  ON locations(household_id, code)
  WHERE household_id IS NOT NULL AND code IS NOT NULL;
CREATE UNIQUE INDEX uq_locations_owner_legacy_code_nonnull
  ON locations(owner_user_id, code)
  WHERE household_id IS NULL AND owner_user_id IS NOT NULL AND code IS NOT NULL;
CREATE UNIQUE INDEX uq_locations_legacy_code_nonnull
  ON locations(code)
  WHERE household_id IS NULL AND owner_user_id IS NULL AND code IS NOT NULL;
