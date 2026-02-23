CREATE TABLE item_embeddings (
  item_id uuid PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  owner_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  household_id uuid REFERENCES households(id) ON DELETE CASCADE,
  embedding double precision[] NOT NULL CHECK (array_length(embedding, 1) > 0),
  model text NOT NULL,
  source_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_item_embeddings_owner_user_id ON item_embeddings(owner_user_id);
CREATE INDEX idx_item_embeddings_household_id ON item_embeddings(household_id);
CREATE INDEX idx_item_embeddings_model ON item_embeddings(model);

CREATE TRIGGER trg_item_embeddings_updated_at
BEFORE UPDATE ON item_embeddings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
