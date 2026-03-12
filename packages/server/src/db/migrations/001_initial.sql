CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'lobby' CHECK (status IN ('lobby', 'active', 'ended')),
  duration_minutes INTEGER NOT NULL DEFAULT 120,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  join_code TEXT NOT NULL UNIQUE,
  admin_code TEXT NOT NULL,
  leaderboard_mode TEXT NOT NULL DEFAULT 'full' CHECK (leaderboard_mode IN ('full', 'rank_only', 'hidden')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  joined_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  points INTEGER NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  proximity_meters INTEGER NOT NULL DEFAULT 100,
  spawn_mode TEXT NOT NULL CHECK (spawn_mode IN ('absolute', 'relative')),
  spawn_at TIMESTAMPTZ,
  spawn_offset_minutes INTEGER,
  resolved_spawn_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'active', 'claimed', 'expired')),
  spawned_at TIMESTAMPTZ,
  claimed_by_team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  claimed_at TIMESTAMPTZ
);

CREATE TABLE game_mode_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'blackout',
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  CHECK (start_time < end_time)
);

CREATE TABLE team_challenge_states (
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('unlocked', 'active')),
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at TIMESTAMPTZ,
  PRIMARY KEY (team_id, challenge_id)
);

CREATE TABLE location_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE game_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_challenges_game_status ON challenges(game_id, status);
CREATE INDEX idx_team_challenge_states_team ON team_challenge_states(team_id);
CREATE INDEX idx_location_history_team_game ON location_history(team_id, game_id);
CREATE INDEX idx_location_history_recorded ON location_history(recorded_at);
CREATE INDEX idx_game_events_game ON game_events(game_id, created_at);
