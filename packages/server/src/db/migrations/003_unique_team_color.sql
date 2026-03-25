-- 003_unique_team_color.sql
-- Enforce that each color can only be used once per game.
-- The application already rejects duplicates, but this constraint
-- prevents race conditions (concurrent INSERT with same color).

-- Clean up any existing duplicates first
DELETE FROM teams WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY game_id, color ORDER BY joined_at) as rn
    FROM teams
  ) t WHERE rn > 1
);

ALTER TABLE teams ADD CONSTRAINT teams_game_color_unique UNIQUE (game_id, color);
