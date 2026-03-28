-- 004_challenge_queue.sql
-- Migrate from offset-based challenge spawning to queue-based system.
-- Also removes game mode segments (no longer in spec).

-- Drop game mode segments table entirely
DROP TABLE IF EXISTS game_mode_segments;

-- Remove leaderboard_mode from games (leaderboard is always visible now)
ALTER TABLE games DROP COLUMN IF EXISTS leaderboard_mode;

-- Add queue settings to games
ALTER TABLE games ADD COLUMN active_challenge_count INTEGER NOT NULL DEFAULT 3;
ALTER TABLE games ADD COLUMN challenge_expire_minutes INTEGER NOT NULL DEFAULT 10;

-- Replace spawn_offset_minutes with sort_order on challenges
ALTER TABLE challenges ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
-- Migrate existing data: use spawn_offset_minutes as initial sort_order
UPDATE challenges SET sort_order = COALESCE(spawn_offset_minutes, 0);
ALTER TABLE challenges DROP COLUMN spawn_offset_minutes;

-- Replace spawned_at with activated_at
ALTER TABLE challenges RENAME COLUMN spawned_at TO activated_at;

-- Update status enum: scheduled -> queued, add expired
ALTER TABLE challenges DROP CONSTRAINT IF EXISTS challenges_status_check;
UPDATE challenges SET status = 'queued' WHERE status = 'scheduled';
ALTER TABLE challenges ALTER COLUMN status SET DEFAULT 'queued';
ALTER TABLE challenges ADD CONSTRAINT challenges_status_check
  CHECK (status IN ('queued', 'active', 'claimed', 'expired'));
