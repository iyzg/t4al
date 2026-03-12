-- 002_simplify.sql
-- Align schema with finalized specs:
--   - Drop team_challenge_states (tracking moves to teams.active_challenge_id)
--   - Simplify challenges: relative-only spawn timing, no expiration
--   - Simplify game_mode_segments: offset-based, not absolute timestamps

DROP TABLE team_challenge_states;

ALTER TABLE teams ADD COLUMN active_challenge_id UUID REFERENCES challenges(id) ON DELETE SET NULL;

ALTER TABLE challenges
  DROP COLUMN spawn_mode,
  DROP COLUMN spawn_at,
  DROP COLUMN resolved_spawn_at,
  ALTER COLUMN spawn_offset_minutes SET NOT NULL;
  
ALTER TABLE challenges
  DROP CONSTRAINT challenges_status_check,
  ADD CONSTRAINT challenges_status_check CHECK (status IN ('scheduled', 'active', 'claimed'));

ALTER TABLE game_mode_segments
  DROP COLUMN start_time,
  DROP COLUMN end_time,
  ADD COLUMN start_offset_minutes INTEGER NOT NULL,
  ADD COLUMN end_offset_minutes INTEGER NOT NULL,
  ADD CONSTRAINT time_check CHECK (start_offset_minutes < end_offset_minutes);


