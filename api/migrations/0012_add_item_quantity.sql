ALTER TABLE items
ADD COLUMN IF NOT EXISTS quantity integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_items_quantity_nonnegative'
      AND conrelid = 'items'::regclass
  ) THEN
    ALTER TABLE items
    ADD CONSTRAINT ck_items_quantity_nonnegative
    CHECK (quantity IS NULL OR quantity >= 0);
  END IF;
END $$;
