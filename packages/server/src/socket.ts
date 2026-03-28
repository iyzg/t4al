import type { Server, Socket } from 'socket.io';
import pool from './db/pool.js';

// Map a raw SQL challenge row to camelCase for the client
export function mapChallenge(row: any) {
  return {
    id: row.id,
    gameId: row.game_id,
    name: row.name,
    description: row.description,
    points: row.points,
    lat: row.lat,
    lng: row.lng,
    proximityMeters: row.proximity_meters,
    sortOrder: row.sort_order,
    status: row.status,
    activatedAt: row.activated_at,
    claimedByTeamId: row.claimed_by_team_id,
    claimedAt: row.claimed_at,
  };
}

// Map a raw SQL game row to camelCase
export function mapGame(row: any) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    durationMinutes: row.duration_minutes,
    activeChallengeCount: row.active_challenge_count,
    challengeExpireMinutes: row.challenge_expire_minutes,
    startTime: row.start_time,
    endTime: row.end_time,
    joinCode: row.join_code,
    adminCode: row.admin_code,
    createdAt: row.created_at,
  };
}

/** Build leaderboard data for a game */
export async function getLeaderboard(gameId: string) {
  const teamResult = await pool.query(
    'SELECT id, name, color, score FROM teams WHERE game_id = $1 ORDER BY score DESC',
    [gameId],
  );
  return {
    teams: teamResult.rows.map((t: any, i: number) => ({
      id: t.id, name: t.name, color: t.color, score: t.score, rank: i + 1,
    })),
  };
}

/** Log a game event for the admin event log */
async function logEvent(gameId: string, type: string, payload: Record<string, unknown> = {}) {
  try {
    await pool.query(
      `INSERT INTO game_events (game_id, type, payload) VALUES ($1, $2, $3)`,
      [gameId, type, JSON.stringify(payload)],
    );
  } catch (err) {
    console.error('Failed to log event:', err);
  }
}

// In-memory store for current team positions (used for admin map display)
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
    // Sends a full game:state snapshot on join/reconnect
    socket.on('game:join', async (data) => {
      if (!data?.gameId || !data?.teamId) return;
      // Leave previous game room if switching games
      if (socket.data.gameId && socket.data.gameId !== data.gameId) {
        socket.leave(socket.data.gameId);
      }
      socket.join(data.gameId);
      socket.data.gameId = data.gameId;
      socket.data.teamId = data.teamId;
      console.log(`team ${data.teamId} joined game ${data.gameId}`);
      logEvent(data.gameId, 'team:joined', { teamId: data.teamId });

      // Send full game:state snapshot
      try {
        const [gameResult, teamResult, challengeResult] = await Promise.all([
          pool.query('SELECT * FROM games WHERE id = $1', [data.gameId]),
          pool.query('SELECT id, name, color, score, active_challenge_id FROM teams WHERE game_id = $1 ORDER BY score DESC', [data.gameId]),
          pool.query(`SELECT * FROM challenges WHERE game_id = $1 AND status = 'active' ORDER BY sort_order`, [data.gameId]),
        ]);

        const gameRow = gameResult.rows[0];
        if (!gameRow) return;

        socket.emit('game:state', {
          game: mapGame(gameRow),
          teams: teamResult.rows.map((t: any) => ({
            id: t.id,
            name: t.name,
            color: t.color,
            score: t.score,
            activeChallengeId: t.active_challenge_id,
          })),
          challenges: challengeResult.rows.map(mapChallenge),
        });
      } catch (err) {
        console.error('Failed to send game:state:', err);
      }
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
        // Verify the challenge is active
        const challenge = await pool.query(
          `SELECT id FROM challenges WHERE id = $1 AND status = 'active'`,
          [data.challengeId],
        );
        if (challenge.rows.length === 0) {
          socket.emit('complete:failed', { challengeId: data.challengeId, reason: 'not_active' as const });
          return;
        }

        // Atomic: only set active_challenge_id if it's currently NULL
        const result = await pool.query(
          `UPDATE teams SET active_challenge_id = $1 WHERE id = $2 AND active_challenge_id IS NULL RETURNING id`,
          [data.challengeId, data.teamId],
        );
        if (result.rows.length === 0) {
          socket.emit('complete:failed', { challengeId: data.challengeId, reason: 'not_active' as const });
          return;
        }

        // Broadcast activation to all clients in the game
        if (socket.data.gameId) {
          io.to(socket.data.gameId).emit('challenge:activated', {
            challengeId: data.challengeId,
            teamId: data.teamId,
          });
          logEvent(socket.data.gameId, 'challenge:activated', {
            challengeId: data.challengeId,
            teamId: data.teamId,
          });
        }
      } catch (err) {
        console.error('challenge:activate error:', err);
      }
    });

    // ── challenge:abandon ──
    socket.on('challenge:abandon', async (data) => {
      if (!data?.challengeId || !data?.teamId) return;
      try {
        const result = await pool.query(
          'UPDATE teams SET active_challenge_id = NULL WHERE id = $1 AND active_challenge_id = $2 RETURNING id',
          [data.teamId, data.challengeId],
        );
        if (result.rows.length > 0 && socket.data.gameId) {
          // Broadcast abandonment to all clients
          io.to(socket.data.gameId).emit('challenge:abandoned', {
            challengeId: data.challengeId,
            teamId: data.teamId,
          });
          logEvent(socket.data.gameId, 'challenge:abandoned', {
            challengeId: data.challengeId,
            teamId: data.teamId,
          });
        }
      } catch (err) {
        console.error('challenge:abandon error:', err);
      }
    });

    // ── challenge:complete ──
    socket.on('challenge:complete', async (data) => {
      if (!data?.challengeId || !data?.teamId) return;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Verify the team has this challenge as their active challenge
        const teamCheck = await client.query(
          `SELECT active_challenge_id FROM teams WHERE id = $1`,
          [data.teamId],
        );
        if (teamCheck.rows[0]?.active_challenge_id !== data.challengeId) {
          await client.query('ROLLBACK');
          socket.emit('complete:failed', { challengeId: data.challengeId, reason: 'not_active' as const });
          return;
        }

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

        // Award points and clear active challenge for the completing team
        await client.query(
          'UPDATE teams SET score = score + $1, active_challenge_id = NULL WHERE id = $2',
          [challenge.points, data.teamId],
        );

        // Clear active_challenge_id for ALL other teams that had this challenge active
        const yankedTeams = await client.query(
          'UPDATE teams SET active_challenge_id = NULL WHERE active_challenge_id = $1 AND id != $2 RETURNING id',
          [data.challengeId, data.teamId],
        );

        await client.query('COMMIT');

        const teamResult = await pool.query('SELECT name FROM teams WHERE id=$1', [data.teamId]);
        const teamName = teamResult.rows[0]?.name ?? 'Unknown';

        socket.emit('complete:success', { challengeId: challenge.id, points: challenge.points });

        if (socket.data.gameId) {
          logEvent(socket.data.gameId, 'challenge:claimed', {
            challengeId: challenge.id,
            challengeName: challenge.name,
            teamId: data.teamId,
            teamName: teamName,
            points: challenge.points,
          });

          io.to(socket.data.gameId).emit('challenge:claimed', {
            challengeId: challenge.id,
            claimedByTeamId: data.teamId,
            claimedByTeamName: teamName,
            points: challenge.points,
          });

          // Notify yanked teams
          for (const yanked of yankedTeams.rows) {
            // Find the socket for this team and emit yanked
            const sockets = await io.in(socket.data.gameId).fetchSockets();
            for (const s of sockets) {
              if (s.data.teamId === yanked.id) {
                s.emit('challenge:yanked', { challengeId: data.challengeId });
              }
            }
          }

          // Send updated leaderboard to all clients in the game
          const leaderboard = await getLeaderboard(socket.data.gameId);
          io.to(socket.data.gameId).emit('leaderboard:update', leaderboard);
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
