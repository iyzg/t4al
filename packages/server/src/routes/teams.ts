import { Router } from 'express';
import pool from '../db/pool.js';
import { asyncHandler } from '../asyncHandler.js';

const router = Router({ mergeParams: true });

// GET /api/games/:gameId/teams — list all teams in a game
router.get('/', asyncHandler(async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM teams WHERE game_id = $1 ORDER BY joined_at',
    [req.params.gameId],
  );

  res.json(result.rows);
}));

// POST /api/games/:gameId/teams — create a team
router.post('/', asyncHandler(async (req, res) => {
  const { name, color } = req.body;

  if (!name || !color) {
    res.status(400).json({ error: 'name and color are required' });
    return;
  }

  try {
    const result = await pool.query(
      `INSERT INTO teams (game_id, name, color)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [req.params.gameId, name, color],
    );
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    // Unique constraint violation on (game_id, color)
    if (err.code === '23505' && err.constraint === 'teams_game_color_unique') {
      res.status(409).json({ error: 'color already taken' });
      return;
    }
    throw err; // re-throw other errors to Express error handler
  }
}));

export default router;
