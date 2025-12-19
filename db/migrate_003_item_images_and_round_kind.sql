-- db/migrate_003_item_images_and_round_kind.sql

-- Runtime rounds: add kind to distinguish rated/manual/carousel
ALTER TABLE rounds
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'rated';

-- Template items: per-item image
ALTER TABLE template_items
  ADD COLUMN IF NOT EXISTS image_data TEXT;

-- Runtime items: per-item image
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS image_data TEXT;

