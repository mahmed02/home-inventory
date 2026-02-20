CREATE TABLE items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  brand text,
  description text,
  keywords text[] NOT NULL DEFAULT '{}',
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  low_churn boolean NOT NULL DEFAULT true,
  image_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_items_location_id ON items(location_id);
CREATE INDEX idx_items_keywords_gin ON items USING GIN (keywords);
