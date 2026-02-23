CREATE TABLE movement_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL,
  from_location_id uuid NOT NULL,
  to_location_id uuid NOT NULL,
  moved_by_user_id uuid NULL,
  owner_user_id uuid NULL,
  household_id uuid NULL,
  source text NOT NULL DEFAULT 'api.items.patch',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_location_id <> to_location_id)
);

CREATE INDEX idx_movement_history_item_id_created_at
  ON movement_history(item_id, created_at DESC);

CREATE INDEX idx_movement_history_household_id_created_at
  ON movement_history(household_id, created_at DESC);

CREATE INDEX idx_movement_history_owner_user_id_created_at
  ON movement_history(owner_user_id, created_at DESC);

CREATE INDEX idx_movement_history_moved_by_user_id_created_at
  ON movement_history(moved_by_user_id, created_at DESC);
