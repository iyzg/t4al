import { Router } from 'express';
import pool from '../db/pool.js';
import { asyncHandler } from '../asyncHandler.js';

const router = Router({ mergeParams: true });

// POST /api/games/:gameId/challenges — create a challenge (admin setup)
router.post('/', asyncHandler(async (req, res) => {
  const { name, description, points, lat, lng, proximityMeters = 100, spawnOffsetMinutes = 0 } = req.body;

  if (!name || !description || points == null || lat == null || lng == null) {
    res.status(400).json({ error: 'name, description, points, lat, and lng are required' });
    return;
  }

  if (points < 0) {
    res.status(400).json({ error: 'points must be non-negative' });
    return;
  }

  const result = await pool.query(
    `INSERT INTO challenges (game_id, name, description, points, lat, lng, proximity_meters, spawn_offset_minutes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [req.params.gameId, name, description, points, lat, lng, proximityMeters, spawnOffsetMinutes],
  );

  res.status(201).json(result.rows[0]);
}));

// GET /api/games/:gameId/challenges — list all challenges in a game
router.get('/', asyncHandler(async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM challenges WHERE game_id = $1 ORDER BY spawn_offset_minutes',
    [req.params.gameId],
  );

  res.json(result.rows);
}));

// PUT /api/challenges/:id — update a challenge (admin edits during setup)
router.put('/:id', asyncHandler(async (req, res) => {
  const { name, description, points, lat, lng, proximityMeters, spawnOffsetMinutes } = req.body;

  const result = await pool.query(
    `UPDATE challenges
     SET name = COALESCE($2, name),
         description = COALESCE($3, description),
         points = COALESCE($4, points),
         lat = COALESCE($5, lat),
         lng = COALESCE($6, lng),
         proximity_meters = COALESCE($7, proximity_meters),
         spawn_offset_minutes = COALESCE($8, spawn_offset_minutes)
     WHERE id = $1
     RETURNING *`,
    [req.params.id, name, description, points, lat, lng, proximityMeters, spawnOffsetMinutes],
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
// Uses a transaction so challenge claim + score update are all-or-nothing
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
    res.json(challenge);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

export default router;
