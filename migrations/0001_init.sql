-- The Eliminator's Gambit — D1 (SQLite) schema.
-- IDs are app-generated UUIDs stored as TEXT. Booleans are INTEGER 0/1.

-- A game set is a private namespace ("room") protected by a PIN.
CREATE TABLE game_sets (
  name            TEXT PRIMARY KEY,
  pin_hash        TEXT,                -- "pbkdf2$<iter>$<salt b64>$<hash b64>"
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    INTEGER,             -- unix ms
  created_at      INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,        -- sha256(token), hex
  game_set    TEXT NOT NULL REFERENCES game_sets(name) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX idx_sessions_game_set ON sessions(game_set);

-- Content-addressed images (id = sha256 of bytes), shared by templates and rounds.
CREATE TABLE images (
  id          TEXT PRIMARY KEY,
  game_set    TEXT NOT NULL REFERENCES game_sets(name) ON DELETE CASCADE,
  mime        TEXT NOT NULL,
  bytes       BLOB NOT NULL,
  created_at  INTEGER NOT NULL
);

-- Round templates authored in the editor.
CREATE TABLE templates (
  id          TEXT PRIMARY KEY,
  game_set    TEXT NOT NULL REFERENCES game_sets(name) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('rated', 'manual', 'carousel')),
  name        TEXT NOT NULL,
  prompt      TEXT NOT NULL,
  image_id    TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_templates_game_set ON templates(game_set, updated_at DESC);

CREATE TABLE template_items (
  id           TEXT PRIMARY KEY,
  template_id  TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL,
  title        TEXT NOT NULL,
  rating       REAL,
  secret_text  TEXT,
  is_target    INTEGER NOT NULL DEFAULT 0,
  image_id     TEXT
);
CREATE INDEX idx_template_items_template ON template_items(template_id, position);

-- A match is a sequence of rounds between two teams; scores live here.
CREATE TABLE matches (
  id            TEXT PRIMARY KEY,
  game_set      TEXT NOT NULL REFERENCES game_sets(name) ON DELETE CASCADE,
  team1         TEXT NOT NULL,
  team2         TEXT NOT NULL,
  plan          TEXT NOT NULL,          -- JSON array of round sources
  round_index   INTEGER NOT NULL DEFAULT 0,
  score1        INTEGER NOT NULL DEFAULT 0,
  score2        INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finished')),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_matches_game_set ON matches(game_set, updated_at DESC);

-- A round is a snapshot of a template (or built-in dataset) taken when it starts.
CREATE TABLE rounds (
  id              TEXT PRIMARY KEY,
  match_id        TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  round_index     INTEGER NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('rated', 'manual', 'carousel')),
  name            TEXT NOT NULL,
  prompt          TEXT NOT NULL,
  image_id        TEXT,
  current_team    INTEGER NOT NULL DEFAULT 1 CHECK (current_team IN (1, 2)),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finished')),
  target_item_id  TEXT NOT NULL,
  winner_team     INTEGER,
  loser_team      INTEGER,
  version         INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  UNIQUE (match_id, round_index)
);

CREATE TABLE items (
  id                  TEXT PRIMARY KEY,
  round_id            TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  position            INTEGER NOT NULL,
  title               TEXT NOT NULL,
  rating              REAL,
  secret_text         TEXT,
  image_id            TEXT,
  eliminated          INTEGER NOT NULL DEFAULT 0,
  eliminated_by_team  INTEGER,
  eliminated_at       INTEGER
);
CREATE INDEX idx_items_round ON items(round_id, position);
