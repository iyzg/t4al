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
    const values = batch.map(
      (_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`
    ).join(', ');
    const params = batch.flatMap(l => [l.teamId, l.gameId, l.lat, l.lng]);
    await pool.query(
      `INSERT INTO location_history (team_id, game_id, lat, lng) VALUES ${values}`,
      params,
    );
  }, 5_000);

  io.on('connection', (socket) => {
    console.log('client connected:', socket.id);

    // ── game:join ──
    // Add this socket to a room for the game so we can broadcast to all players
    socket.on('game:join', (data) => {
      socket.join(data.gameId);
      // Store gameId and teamId on the socket for later use
      socket.data.gameId = data.gameId;
      socket.data.teamId = data.teamId;
      console.log(`team ${data.teamId} joined game ${data.gameId}`);
    });

    // ── location:update ──
    // Update in-memory position + buffer for DB flush
    socket.on('location:update', (data) => {
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
    // Team sets a challenge as their active one
    socket.on('challenge:activate', async (data) => {
      // Check team doesn't already have an active challenge
      const team = await pool.query('SELECT active_challenge_id FROM teams WHERE id = $1', [data.teamId]);
      if (team.rows[0]?.active_challenge_id) {
        socket.emit('complete:failed', { challengeId: data.challengeId, reason: 'not_active' as const });
        return;
      }
      await pool.query('UPDATE teams SET active_challenge_id = $1 WHERE id = $2', [data.challengeId, data.teamId]);
    });

    // ── challenge:abandon ──
    // Team drops their active challenge
    socket.on('challenge:abandon', async (data) => {
      await pool.query('UPDATE teams SET active_challenge_id = NULL WHERE id = $1', [data.teamId]);
      socket.emit('challenge:left', { challengeId: data.challengeId });
    });

    // ── challenge:complete ──
    // Team marks challenge complete — atomic claim, first team wins
    socket.on('challenge:complete', async (data) => {
      const result = await pool.query(
        `UPDATE challenges 
         SET status='claimed', claimed_by_team_id=$2, claimed_at=NOW()
         WHERE id=$1 AND status='active'
         RETURNING *`,
        [data.challengeId, data.teamId],
      );

      if (result.rows.length === 0) {
        socket.emit('complete:failed', { challengeId: data.challengeId, reason: 'already_claimed' });
        return;
      }

      const challenge = result.rows[0];
      await pool.query(
        'UPDATE teams SET score=score + $1, active_challenge_id = NULL where id = $2',
        [challenge.points, data.teamId]
      );

      const teamResult = await pool.query('SELECT name FROM teams WHERE id=$1', [data.teamId]);

      socket.emit('complete:success', { challengeId: challenge.id, points: challenge.points });
      io.to(socket.data.gameId).emit('challenge:claimed',
      { 
        challengeId: challenge.id,
        claimedByTeamId: data.teamId,
        claimedByTeamName: teamResult.rows[0].name,
        points: challenge.points
      });


    });

    socket.on('disconnect', () => {
      console.log('client disconnected:', socket.id);
    });
  });
}

export { currentPositions };
