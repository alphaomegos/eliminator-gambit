-- Game sets (login namespace)
CREATE TABLE IF NOT EXISTS game_sets (
  name TEXT PRIMARY KEY
);

-- 6 chars policy (optional but useful)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_game_sets_name_len'
  ) THEN
    ALTER TABLE game_sets
      ADD CONSTRAINT chk_game_sets_name_len CHECK (char_length(name) = 6);
  END IF;
END $$;

-- templates namespace
ALTER TABLE templates
  ADD COLUMN IF NOT EXISTS game_set TEXT;

-- rounds namespace
ALTER TABLE rounds
  ADD COLUMN IF NOT EXISTS game_set TEXT;

-- Backfill existing data -> EDUARD
INSERT INTO game_sets(name) VALUES ('EDUARD')
ON CONFLICT DO NOTHING;

UPDATE templates SET game_set = 'EDUARD' WHERE game_set IS NULL;
UPDATE rounds    SET game_set = 'EDUARD' WHERE game_set IS NULL;

-- Add FK constraints (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_templates_game_set'
  ) THEN
    ALTER TABLE templates
      ADD CONSTRAINT fk_templates_game_set
      FOREIGN KEY (game_set) REFERENCES game_sets(name)
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_rounds_game_set'
  ) THEN
    ALTER TABLE rounds
      ADD CONSTRAINT fk_rounds_game_set
      FOREIGN KEY (game_set) REFERENCES game_sets(name)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- Ensure not null (safe after backfill)
ALTER TABLE templates ALTER COLUMN game_set SET NOT NULL;
ALTER TABLE rounds    ALTER COLUMN game_set SET NOT NULL;

-- Indexes for filtering
CREATE INDEX IF NOT EXISTS idx_templates_game_set ON templates(game_set);
CREATE INDEX IF NOT EXISTS idx_rounds_game_set    ON rounds(game_set);

