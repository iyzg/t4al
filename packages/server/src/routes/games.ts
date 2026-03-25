import { Router } from 'express';
import crypto from 'node:crypto';
import pool from '../db/pool.js';
import { asyncHandler } from '../asyncHandler.js';

const router = Router();

// POST /api/games — create a new game
router.post('/', asyncHandler(async (req, res) => {
  const { name, durationMinutes = 120, leaderboardMode = 'full' } = req.body;

  if (!name) {
    res.status(400).json({ error: 'name is required' });
    return;
  }

  const joinCode = crypto.randomBytes(3).toString('hex');
  const adminCode = crypto.randomBytes(4).toString('hex');

  const result = await pool.query(
    `INSERT INTO games (name, duration_minutes, join_code, admin_code, leaderboard_mode)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [name, durationMinutes, joinCode, adminCode, leaderboardMode],
  );

  res.status(201).json(result.rows[0]);
}));

// GET /api/games/join/:joinCode — look up a game by join code
router.get('/join/:joinCode', asyncHandler(async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM games WHERE join_code = $1',
    [req.params.joinCode],
  );

  if (result.rows.length === 0) {
    res.status(404).json({ error: 'invalid join code' });
    return;
  }

  res.json(result.rows[0]);
}));

// GET /api/games/:id — get a game by ID
router.get('/:id', asyncHandler(async (req, res) => {
  const result = await pool.query('SELECT * FROM games WHERE id = $1', [req.params.id]);

  if (result.rows.length === 0) {
    res.status(404).json({ error: 'game not found' });
    return;
  }

  res.json(result.rows[0]);
}));

// PUT /api/games/:id — update game settings
router.put('/:id', asyncHandler(async (req, res) => {
  const { name, durationMinutes } = req.body;
  const fields: string[] = [];
  const values: any[] = [];
  let i = 1;

  if (name !== undefined) { fields.push(`name = $${i++}`); values.push(name); }
  if (durationMinutes !== undefined) { fields.push(`duration_minutes = $${i++}`); values.push(durationMinutes); }

  if (fields.length === 0) {
    res.status(400).json({ error: 'nothing to update' });
    return;
  }

  values.push(req.params.id);
  const result = await pool.query(
    `UPDATE games SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
    values,
  );

  if (result.rows.length === 0) {
    res.status(404).json({ error: 'game not found' });
    return;
  }

  res.json(result.rows[0]);
}));

// POST /api/games/:id/start — admin starts the game
router.post('/:id/start', asyncHandler(async (req, res) => {
  const result = await pool.query(
    `UPDATE games
     SET status = 'active',
         start_time = NOW(),
         end_time = NOW() + (duration_minutes || ' minutes')::interval
     WHERE id = $1 AND status = 'lobby'
     RETURNING *`,
    [req.params.id],
  );

  if (result.rows.length === 0) {
    res.status(400).json({ error: 'game not found or not in lobby' });
    return;
  }

  res.json(result.rows[0]);
}));

// POST /api/games/:id/end — admin force-ends the game
router.post('/:id/end', asyncHandler(async (req, res) => {
  const result = await pool.query(
    `UPDATE games SET status = 'ended' WHERE id = $1 AND status = 'active' RETURNING *`,
    [req.params.id],
  );

  if (result.rows.length === 0) {
    res.status(400).json({ error: 'game not found or not active' });
    return;
  }

  res.json(result.rows[0]);
}));

export default router;
