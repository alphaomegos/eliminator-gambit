-- db/init.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Game sets (login namespace)
CREATE TABLE IF NOT EXISTS game_sets (
  name TEXT PRIMARY KEY,
  CONSTRAINT chk_game_sets_name_len CHECK (char_length(name) = 6)
);

-- Default game set for existing database
INSERT INTO game_sets(name) VALUES ('EDUARD')
ON CONFLICT DO NOTHING;


CREATE TABLE IF NOT EXISTS rounds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_set TEXT NOT NULL REFERENCES game_sets(name) ON DELETE RESTRICT,

  category TEXT NOT NULL,
  prompt TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  current_team INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active', -- active | finished
  target_item_id UUID NOT NULL,
  winner_team INT,
  loser_team INT,

  -- Round kind: rated | manual | carousel
  kind TEXT NOT NULL DEFAULT 'rated',

  -- optional round image
  image_data TEXT
);

CREATE INDEX IF NOT EXISTS idx_rounds_game_set ON rounds(game_set);


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

CREATE TABLE IF NOT EXISTS templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_set TEXT NOT NULL REFERENCES game_sets(name) ON DELETE RESTRICT,

  name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- templates: kind (rated/manual/carousel) and optional image
  kind TEXT NOT NULL DEFAULT 'rated',
  image_data TEXT
);

CREATE INDEX IF NOT EXISTS idx_templates_game_set ON templates(game_set);


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

-- db/migrate_003_item_images_and_carousel.sql

-- Round kind: rated | manual | carousel
ALTER TABLE rounds
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'rated';

-- If you don't already have round images in schema on fresh installs
ALTER TABLE rounds
  ADD COLUMN IF NOT EXISTS image_data TEXT;

-- If you don't already have template images in schema on fresh installs
ALTER TABLE templates
  ADD COLUMN IF NOT EXISTS image_data TEXT;

-- Per-item images (templates + runtime items)
ALTER TABLE template_items
  ADD COLUMN IF NOT EXISTS image_data TEXT;

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS image_data TEXT;

-- rounds: add kind (rated/manual/carousel)
ALTER TABLE rounds
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'rated';

-- template_items: add per-item image_data
ALTER TABLE template_items
  ADD COLUMN IF NOT EXISTS image_data TEXT;

-- items: add per-item image_data
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS image_data TEXT;

-- Backfill existing rows into default game set (for older DBs)
UPDATE templates SET game_set = 'EDUARD' WHERE game_set IS NULL;
UPDATE rounds    SET game_set = 'EDUARD' WHERE game_set IS NULL;
