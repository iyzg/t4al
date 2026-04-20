-- 001_schema.sql
-- V2 schema: pre-production, greenfield.
-- To reset: drop the database, re-create, then `npm run migrate`.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Games
CREATE TABLE games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'lobby' CHECK (status IN ('lobby', 'active', 'ended')),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  active_challenge_count INTEGER NOT NULL DEFAULT 3,
  challenge_expire_minutes INTEGER NOT NULL DEFAULT 10,
  starting_tokens INTEGER NOT NULL DEFAULT 50 CHECK (starting_tokens >= 0),
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  join_code TEXT NOT NULL UNIQUE,
  admin_code TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Teams
CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  tokens INTEGER NOT NULL DEFAULT 0,
  active_challenge_id UUID,                      -- FK added below after challenges exists
  wager_amount INTEGER,                          -- non-null only while on a wager challenge with wager set
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT team_name_unique_per_game  UNIQUE (game_id, name),
  CONSTRAINT team_color_unique_per_game UNIQUE (game_id, color)
);

-- Challenges
CREATE TABLE challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  description TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('normal', 'variable', 'wager')),

  -- Type-dependent token fields
  tokens INTEGER,                                -- normal only
  tokens_per_unit INTEGER,                       -- variable only
  unit_label TEXT,                               -- variable only

  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  proximity_meters INTEGER NOT NULL DEFAULT 100,

  sort_order INTEGER NOT NULL DEFAULT 0,

  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'active', 'claimed', 'expired')),
  activated_at TIMESTAMPTZ,
  claimed_by_team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  claimed_at TIMESTAMPTZ,

  -- Enforce type-shape: exactly the right nullables are non-null per type
  CONSTRAINT challenge_type_fields CHECK (
    (type = 'normal'   AND tokens IS NOT NULL AND tokens_per_unit IS NULL     AND unit_label IS NULL) OR
    (type = 'variable' AND tokens IS NULL     AND tokens_per_unit IS NOT NULL AND unit_label IS NOT NULL) OR
    (type = 'wager'    AND tokens IS NULL     AND tokens_per_unit IS NULL     AND unit_label IS NULL)
  )
);

-- Now that challenges exists, wire the teams.active_challenge_id FK
ALTER TABLE teams
  ADD CONSTRAINT teams_active_challenge_fk
  FOREIGN KEY (active_challenge_id) REFERENCES challenges(id) ON DELETE SET NULL;

-- Location history (append-only, retained post-game for viz/stats)
CREATE TABLE location_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Game event log (append-only)
CREATE TABLE game_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_challenges_game_status     ON challenges(game_id, status);
CREATE INDEX idx_challenges_queue_order     ON challenges(game_id, status, sort_order);
CREATE INDEX idx_location_history_team_game ON location_history(team_id, game_id);
CREATE INDEX idx_location_history_recorded  ON location_history(recorded_at);
CREATE INDEX idx_game_events_game           ON game_events(game_id, created_at);
