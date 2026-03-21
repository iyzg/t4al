import type { Server, Socket } from 'socket.io';
import pool from './db/pool.js';

// In-memory store for current team positions (used for proximity checks)
const currentPositions = new Map<string, { lat: number; lng: number; updatedAt: Date }>();

// Pending location writes, flushed to DB every 5s
const locationBuffer: { teamId: string; gameId: string; lat: number; lng: number }[] = [];

export function registerSocketHandlers(io: Server) {
  // Flush location buffer to DB every 5 seconds
  setInterval(async () => {
    if (locationBuffer.length === 0) return;
    const batch = locationBuffer.splice(0, locationBuffer.length);
    const values = batch
      .map((_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`)
      .join(', ');
    const params = batch.flatMap((l) => [l.teamId, l.gameId, l.lat, l.lng]);
    try {
      await pool.query(
        `INSERT INTO location_history (team_id, game_id, lat, lng) VALUES ${values}`,
        params,
      );
    } catch (err) {
      console.error('Failed to flush location buffer:', err);
    }
  }, 5_000);

  io.on('connection', (socket) => {
    console.log('client connected:', socket.id);

    // ── game:join ──
    socket.on('game:join', (data) => {
      if (!data?.gameId || !data?.teamId) return;
      socket.join(data.gameId);
      socket.data.gameId = data.gameId;
      socket.data.teamId = data.teamId;
      console.log(`team ${data.teamId} joined game ${data.gameId}`);
    });

    // ── location:update ──
    socket.on('location:update', (data) => {
      if (!data?.teamId || data.lat == null || data.lng == null) return;
      currentPositions.set(data.teamId, {
        lat: data.lat,
        lng: data.lng,
        updatedAt: new Date(),
      });
      if (socket.data.gameId) {
        locationBuffer.push({
          teamId: data.teamId,
          gameId: socket.data.gameId,
          lat: data.lat,
          lng: data.lng,
        });
      }
    });

    // ── challenge:activate ──
    socket.on('challenge:activate', async (data) => {
      if (!data?.challengeId || !data?.teamId) return;
      try {
        const team = await pool.query('SELECT active_challenge_id FROM teams WHERE id = $1', [data.teamId]);
        if (!team.rows[0]) return;
        if (team.rows[0].active_challenge_id) {
          socket.emit('complete:failed', { challengeId: data.challengeId, reason: 'not_active' as const });
          return;
        }
        await pool.query('UPDATE teams SET active_challenge_id = $1 WHERE id = $2', [data.challengeId, data.teamId]);
      } catch (err) {
        console.error('challenge:activate error:', err);
      }
    });

    // ── challenge:abandon ──
    socket.on('challenge:abandon', async (data) => {
      if (!data?.challengeId || !data?.teamId) return;
      try {
        await pool.query('UPDATE teams SET active_challenge_id = NULL WHERE id = $1', [data.teamId]);
        socket.emit('challenge:left', { challengeId: data.challengeId });
      } catch (err) {
        console.error('challenge:abandon error:', err);
      }
    });

    // ── challenge:complete ──
    // Uses a transaction so claim + score update are atomic
    socket.on('challenge:complete', async (data) => {
      if (!data?.challengeId || !data?.teamId) return;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const result = await client.query(
          `UPDATE challenges
           SET status='claimed', claimed_by_team_id=$2, claimed_at=NOW()
           WHERE id=$1 AND status='active'
           RETURNING *`,
          [data.challengeId, data.teamId],
        );

        if (result.rows.length === 0) {
          await client.query('ROLLBACK');
          socket.emit('complete:failed', { challengeId: data.challengeId, reason: 'already_claimed' });
          return;
        }

        const challenge = result.rows[0];
        await client.query(
          'UPDATE teams SET score = score + $1, active_challenge_id = NULL WHERE id = $2',
          [challenge.points, data.teamId],
        );

        await client.query('COMMIT');

        const teamResult = await pool.query('SELECT name FROM teams WHERE id=$1', [data.teamId]);
        const teamName = teamResult.rows[0]?.name ?? 'Unknown';

        socket.emit('complete:success', { challengeId: challenge.id, points: challenge.points });

        if (socket.data.gameId) {
          io.to(socket.data.gameId).emit('challenge:claimed', {
            challengeId: challenge.id,
            claimedByTeamId: data.teamId,
            claimedByTeamName: teamName,
            points: challenge.points,
          });
        }
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('challenge:complete error:', err);
      } finally {
        client.release();
      }
    });

    socket.on('disconnect', () => {
      console.log('client disconnected:', socket.id);
    });
  });
}

export { currentPositions };
