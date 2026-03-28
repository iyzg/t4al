import { Router } from 'express';
import pool from '../db/pool.js';
import { asyncHandler } from '../asyncHandler.js';
import { MIN_PROXIMITY_METERS, MAX_PROXIMITY_METERS } from '@t4al/shared';
import { getLeaderboard } from '../socket.js';

const router = Router({ mergeParams: true });

// POST /api/games/:gameId/challenges — create a challenge (admin setup)
router.post('/', asyncHandler(async (req, res) => {
  const { name, description, points, lat, lng, proximityMeters = 100, sortOrder = 0 } = req.body;

  if (!name || !description || points == null || lat == null || lng == null) {
    res.status(400).json({ error: 'name, description, points, lat, and lng are required' });
    return;
  }

  if (points < 0) {
    res.status(400).json({ error: 'points must be non-negative' });
    return;
  }

  if (proximityMeters < MIN_PROXIMITY_METERS || proximityMeters > MAX_PROXIMITY_METERS) {
    res.status(400).json({ error: `proximityMeters must be between ${MIN_PROXIMITY_METERS} and ${MAX_PROXIMITY_METERS}` });
    return;
  }

  // Auto-assign sortOrder if not provided: use max + 1
  let order = sortOrder;
  if (sortOrder === 0) {
    const maxResult = await pool.query(
      'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM challenges WHERE game_id = $1',
      [req.params.gameId],
    );
    order = maxResult.rows[0].next_order;
  }

  const result = await pool.query(
    `INSERT INTO challenges (game_id, name, description, points, lat, lng, proximity_meters, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [req.params.gameId, name, description, points, lat, lng, proximityMeters, order],
  );

  res.status(201).json(result.rows[0]);
}));

// GET /api/games/:gameId/challenges — list all challenges in a game
router.get('/', asyncHandler(async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM challenges WHERE game_id = $1 ORDER BY sort_order',
    [req.params.gameId],
  );

  res.json(result.rows);
}));

// PUT /api/games/:gameId/challenges/reorder — bulk update sort_order
// MUST be before /:id route so Express doesn't treat "reorder" as an :id
router.put('/reorder', asyncHandler(async (req, res) => {
  const { order } = req.body; // array of { id, sortOrder }

  if (!Array.isArray(order)) {
    res.status(400).json({ error: 'order must be an array of { id, sortOrder }' });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const item of order) {
      await client.query(
        'UPDATE challenges SET sort_order = $1 WHERE id = $2 AND game_id = $3',
        [item.sortOrder, item.id, req.params.gameId],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const result = await pool.query(
    'SELECT * FROM challenges WHERE game_id = $1 ORDER BY sort_order',
    [req.params.gameId],
  );
  res.json(result.rows);
}));

// PUT /api/challenges/:id — update a challenge (admin edits during setup)
router.put('/:id', asyncHandler(async (req, res) => {
  const { name, description, points, lat, lng, proximityMeters, sortOrder } = req.body;

  const result = await pool.query(
    `UPDATE challenges
     SET name = COALESCE($2, name),
         description = COALESCE($3, description),
         points = COALESCE($4, points),
         lat = COALESCE($5, lat),
         lng = COALESCE($6, lng),
         proximity_meters = COALESCE($7, proximity_meters),
         sort_order = COALESCE($8, sort_order)
     WHERE id = $1
     RETURNING *`,
    [req.params.id, name, description, points, lat, lng, proximityMeters, sortOrder],
  );

  if (result.rows.length === 0) {
    res.status(404).json({ error: 'challenge not found' });
    return;
  }

  res.json(result.rows[0]);
}));

// DELETE /api/challenges/:id — delete a challenge (admin)
router.delete('/:id', asyncHandler(async (req, res) => {
  const result = await pool.query(
    'DELETE FROM challenges WHERE id = $1 RETURNING id',
    [req.params.id],
  );

  if (result.rows.length === 0) {
    res.status(404).json({ error: 'challenge not found' });
    return;
  }

  res.json({ deleted: true });
}));

// POST /api/challenges/:id/claim — team completes a challenge, atomic claim
router.post('/:id/claim', asyncHandler(async (req, res) => {
  const { teamId } = req.body;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await client.query(
      `UPDATE challenges
       SET status='claimed', claimed_by_team_id=$2, claimed_at=NOW()
       WHERE id=$1 AND status='active'
       RETURNING *`,
      [req.params.id, teamId],
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'challenge not found or already claimed' });
      return;
    }

    const challenge = result.rows[0];
    await client.query(
      'UPDATE teams SET score = score + $1, active_challenge_id = NULL WHERE id = $2',
      [challenge.points, teamId],
    );

    await client.query('COMMIT');

    // Log event — fetch team name for readable event log
    const teamResult = await pool.query('SELECT name FROM teams WHERE id = $1', [teamId]);
    const teamName = teamResult.rows[0]?.name ?? 'Unknown';
    await pool.query(
      `INSERT INTO game_events (game_id, type, payload) VALUES ($1, 'challenge:claimed', $2)`,
      [challenge.game_id, JSON.stringify({
        challengeId: challenge.id,
        challengeName: challenge.name,
        teamId,
        teamName,
        points: challenge.points,
      })],
    ).catch((err: any) => console.error('Failed to log claim event:', err));

    // Emit socket events so all connected clients update
    const io = req.app.get('io');
    if (io && challenge.game_id) {
      io.to(challenge.game_id).emit('challenge:claimed', {
        challengeId: challenge.id,
        claimedByTeamId: teamId,
        claimedByTeamName: '',
        points: challenge.points,
      });
      const leaderboard = await getLeaderboard(challenge.game_id);
      io.to(challenge.game_id).emit('leaderboard:update', leaderboard);
    }

    res.json(challenge);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

export default router;
