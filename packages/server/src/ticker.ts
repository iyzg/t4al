import type { Server } from 'socket.io';
import pool from './db/pool.js';
import { TICKER_INTERVAL_MS } from '@t4al/shared';

// Track current mode per game so we only broadcast on change
const currentModes = new Map<string, string | null>();

export function startTicker(io: Server) {
  setInterval(async () => {
    try {
      await spawnChallenges(io);
      await checkModeTransitions(io);
    } catch (err) {
      console.error('Ticker error:', err);
    }
  }, TICKER_INTERVAL_MS);
}

async function spawnChallenges(io: Server) {
  // Find all scheduled challenges whose spawn time has passed
  const result = await pool.query(
    `UPDATE challenges c
     SET status = 'active', spawned_at = NOW()
     FROM games g
     WHERE c.game_id = g.id
       AND g.status = 'active'
       AND c.status = 'scheduled'
       AND NOW() >= g.start_time + (c.spawn_offset_minutes || ' minutes')::interval
     RETURNING c.*, g.id AS game_id`,
  );

  // Broadcast each spawned challenge to its game room
  for (const challenge of result.rows) {
    io.to(challenge.game_id).emit('challenge:spawned', { challenge });
    console.log(`challenge spawned: ${challenge.name} in game ${challenge.game_id}`);
  }
}

async function checkModeTransitions(io: Server) {
  const activeGamesResult = await pool.query(
    `SELECT id, start_time, leaderboard_mode FROM games WHERE status = 'active'`
  );

  for (const game of activeGamesResult.rows) {
    const activeSegmentResult = await pool.query(
      `SELECT id, mode FROM game_mode_segments
       WHERE game_id=$1 
         AND NOW() >= $2::timestamptz + (start_offset_minutes || ' minutes')::interval
         AND NOW() < $2::timestamptz + (end_offset_minutes || ' minutes')::interval`,
      [game.id, game.start_time]
    );
    
    const leaderboardMode = activeSegmentResult.rows.length === 0 ? 'full' : 'hidden';
    const segmentMode = activeSegmentResult.rows.length === 0 ? null: activeSegmentResult.rows[0].mode;

    if (segmentMode !== currentModes.get(game.id)) {
      await pool.query(
        `UPDATE games g SET leaderboard_mode = $2 WHERE id = $1`,
        [game.id, leaderboardMode]
      );
      
      io.to(game.id).emit('mode:change', { mode: leaderboardMode, segmentMode: segmentMode });
      console.log(`mode changed: ${segmentMode} in game ${game.id}`);

      currentModes.set(game.id, segmentMode);
    }
  }
}
