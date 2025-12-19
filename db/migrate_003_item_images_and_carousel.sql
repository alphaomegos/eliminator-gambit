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

