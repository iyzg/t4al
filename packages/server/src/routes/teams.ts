import { Router } from 'express';
import pool from '../db/pool.js';

const router = Router({ mergeParams: true });

// GET /api/games/:gameId/teams — list all teams in a game
router.get('/', async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM teams WHERE game_id = $1 ORDER BY joined_at',
    [req.params.gameId],
  );

  res.json(result.rows);
});

// POST /api/games/:gameId/teams — create a team
router.post('/', async (req, res) => {
  const {name, color} = req.body;

  if (name == null || color == null) {
    res.status(400).json({ error: 'name and color are required' });
    return;
  }

  const result = await pool.query(
    `INSERT INTO teams (game_id, name, color) 
     VALUES ($1, $2, $3)
     RETURNING *`,
    [req.params.gameId, name, color]
  );

  res.status(201).json(result.rows[0])
});

export default router;
