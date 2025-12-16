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

