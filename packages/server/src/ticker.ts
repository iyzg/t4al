import type { Server } from 'socket.io';
import pool from './db/pool.js';
import { TICKER_INTERVAL_MS } from '@t4al/shared';
import { mapChallenge } from './socket.js';

export function startTicker(io: Server) {
  setInterval(async () => {
    try {
      await expireChallenges(io);
      await fillChallengeQueue(io);
      await checkGameExpiration(io);
    } catch (err) {
      console.error('Ticker error:', err);
    }
  }, TICKER_INTERVAL_MS);
}

/**
 * Expire active challenges that have been active longer than challengeExpireMinutes.
 * Yanks them from any teams that had them active.
 */
async function expireChallenges(io: Server) {
  // Find active challenges whose activated_at + expire time has passed
  const result = await pool.query(
    `UPDATE challenges c
     SET status = 'expired'
     FROM games g
     WHERE c.game_id = g.id
       AND g.status = 'active'
       AND c.status = 'active'
       AND c.activated_at IS NOT NULL
       AND NOW() >= c.activated_at + (g.challenge_expire_minutes || ' minutes')::interval
     RETURNING c.*, g.id AS game_id`,
  );

  for (const row of result.rows) {
    // Clear active_challenge_id for all teams working on this challenge
    const yankedTeams = await pool.query(
      'UPDATE teams SET active_challenge_id = NULL WHERE active_challenge_id = $1 RETURNING id',
      [row.id],
    );

    // Broadcast expiration to all clients
    io.to(row.game_id).emit('challenge:expired', { challengeId: row.id });

    // Send yanked event to affected teams
    if (yankedTeams.rows.length > 0) {
      const sockets = await io.in(row.game_id).fetchSockets();
      for (const yanked of yankedTeams.rows) {
        for (const s of sockets) {
          if (s.data.teamId === yanked.id) {
            s.emit('challenge:yanked', { challengeId: row.id });
          }
        }
      }
    }

    // Log event
    pool.query(
      `INSERT INTO game_events (game_id, type, payload) VALUES ($1, 'challenge:expired', $2)`,
      [row.game_id, JSON.stringify({ challengeId: row.id, name: row.name, points: row.points })],
    ).catch((err: any) => console.error('Failed to log expire event:', err));

    console.log(`challenge expired: ${row.name} in game ${row.game_id}`);
  }
}

/**
 * Fill the challenge queue: if fewer than K challenges are active, activate the next queued ones.
 */
async function fillChallengeQueue(io: Server) {
  // Get all active games with their challenge counts
  const activeGames = await pool.query(
    `SELECT g.id, g.active_challenge_count,
            (SELECT COUNT(*) FROM challenges c WHERE c.game_id = g.id AND c.status = 'active') AS current_active
     FROM games g
     WHERE g.status = 'active'`,
  );

  for (const game of activeGames.rows) {
    const needed = game.active_challenge_count - Number(game.current_active);
    if (needed <= 0) continue;

    // Activate the next N queued challenges by sort_order
    const result = await pool.query(
      `UPDATE challenges
       SET status = 'active', activated_at = NOW()
       WHERE id IN (
         SELECT id FROM challenges
         WHERE game_id = $1 AND status = 'queued'
         ORDER BY sort_order
         LIMIT $2
       )
       RETURNING *`,
      [game.id, needed],
    );

    for (const row of result.rows) {
      const challenge = mapChallenge(row);
      io.to(game.id).emit('challenge:spawned', { challenge });

      pool.query(
        `INSERT INTO game_events (game_id, type, payload) VALUES ($1, 'challenge:spawned', $2)`,
        [game.id, JSON.stringify({ challengeId: row.id, name: row.name, points: row.points })],
      ).catch((err: any) => console.error('Failed to log spawn event:', err));

      console.log(`challenge spawned: ${row.name} in game ${game.id}`);
    }
  }
}

async function checkGameExpiration(io: Server) {
  const result = await pool.query(
    `UPDATE games SET status = 'ended'
     WHERE status = 'active' AND end_time IS NOT NULL AND NOW() >= end_time
     RETURNING id`,
  );

  for (const game of result.rows) {
    io.to(game.id).emit('game:ended', {});
    pool.query(
      `INSERT INTO game_events (game_id, type, payload) VALUES ($1, 'game:ended', '{"reason":"timer"}')`,
      [game.id],
    ).catch((err: any) => console.error('Failed to log auto-end event:', err));
    console.log(`game auto-ended: ${game.id}`);
  }
}
