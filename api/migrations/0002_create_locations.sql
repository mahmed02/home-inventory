CREATE TABLE locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text,
  type text,
  parent_id uuid REFERENCES locations(id) ON DELETE RESTRICT,
  description text,
  image_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_locations_parent_id ON locations(parent_id);
CREATE UNIQUE INDEX uq_locations_code_nonnull ON locations(code) WHERE code IS NOT NULL;
