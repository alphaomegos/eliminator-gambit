-- db/init.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS rounds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category TEXT NOT NULL,
  prompt TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  current_team INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active', -- active | finished
  target_item_id UUID NOT NULL,
  winner_team INT,
  loser_team INT
);

CREATE TABLE IF NOT EXISTS items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  round_id UUID NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  rating NUMERIC NOT NULL,
  eliminated BOOLEAN NOT NULL DEFAULT FALSE,
  eliminated_by_team INT,
  eliminated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_items_round_id ON items(round_id);

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS template_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_id UUID NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  rating NUMERIC NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_template_items_template_id ON template_items(template_id);

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_templates_updated_at ON templates;
CREATE TRIGGER trg_templates_updated_at
BEFORE UPDATE ON templates
FOR EACH ROW EXECUTE FUNCTION set_updated_at();


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

