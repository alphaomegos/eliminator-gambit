-- templates: add kind (rated/manual)
ALTER TABLE templates
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'rated';

-- template_items: add secret + manual target flag
ALTER TABLE template_items
  ADD COLUMN IF NOT EXISTS secret_text TEXT;

ALTER TABLE template_items
  ADD COLUMN IF NOT EXISTS is_target BOOLEAN NOT NULL DEFAULT FALSE;

-- make rating nullable in template_items (idempotent)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_attribute a
    JOIN pg_class c ON a.attrelid=c.oid
    WHERE c.relname='template_items' AND a.attname='rating' AND a.attnotnull
  ) THEN
    EXECUTE 'ALTER TABLE template_items ALTER COLUMN rating DROP NOT NULL';
  END IF;
END $$;

-- runtime items: add secret_text + allow NULL rating
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS secret_text TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_attribute a
    JOIN pg_class c ON a.attrelid=c.oid
    WHERE c.relname='items' AND a.attname='rating' AND a.attnotnull
  ) THEN
    EXECUTE 'ALTER TABLE items ALTER COLUMN rating DROP NOT NULL';
  END IF;
END $$;

