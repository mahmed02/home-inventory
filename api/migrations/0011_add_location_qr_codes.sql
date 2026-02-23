CREATE TABLE location_qr_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL UNIQUE REFERENCES locations(id) ON DELETE CASCADE,
  code uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  owner_user_id uuid NULL,
  household_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER set_location_qr_codes_updated_at
BEFORE UPDATE ON location_qr_codes
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_location_qr_codes_household_created_at
  ON location_qr_codes(household_id, created_at DESC);

CREATE INDEX idx_location_qr_codes_owner_created_at
  ON location_qr_codes(owner_user_id, created_at DESC);

INSERT INTO location_qr_codes(location_id, owner_user_id, household_id)
SELECT id, owner_user_id, household_id
FROM locations
ON CONFLICT (location_id) DO NOTHING;
