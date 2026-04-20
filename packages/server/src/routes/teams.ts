import { Router } from 'express';
import pool from '../db/pool.js';
import { asyncHandler } from '../asyncHandler.js';
import { TEAM_COLORS } from '@t4al/shared';
import { mapTeam } from '../db/mappers.js';

const router = Router({ mergeParams: true });

// GET /api/games/:gameId/teams — list all teams (public)
router.get('/', asyncHandler(async (req, res) => {
  const gameIdParam = req.params.gameId;
  const gameId = Array.isArray(gameIdParam) ? gameIdParam[0] : gameIdParam;
  const result = await pool.query(
    'SELECT * FROM teams WHERE game_id = $1 ORDER BY joined_at',
    [gameId],
  );
  res.json(result.rows.map(mapTeam));
}));

// POST /api/games/:gameId/teams — create a team (lobby only)
// Not requiring admin: any player with the joinCode can create a team in lobby.
// Lobby-only is enforced here inline since no adminCode is required.
router.post('/', asyncHandler(async (req, res) => {
  const gameIdParam = req.params.gameId;
  const gameId = Array.isArray(gameIdParam) ? gameIdParam[0] : gameIdParam;
  const { name, color } = req.body ?? {};

  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name required' });
    return;
  }
  if (!color || !TEAM_COLORS.includes(color)) {
    res.status(400).json({ error: 'color must be from the palette' });
    return;
  }

  // Check game is in lobby
  const game = await pool.query('SELECT status FROM games WHERE id = $1', [gameId]);
  if (game.rows.length === 0) {
    res.status(404).json({ error: 'game not found' });
    return;
  }
  if (game.rows[0].status !== 'lobby') {
    res.status(409).json({ error: 'teams can only be created in lobby' });
    return;
  }

  try {
    const result = await pool.query(
      `INSERT INTO teams (game_id, name, color) VALUES ($1, $2, $3) RETURNING *`,
      [gameId, name.trim(), color],
    );
    res.status(201).json(mapTeam(result.rows[0]));
  } catch (err: any) {
    if (err.code === '23505' && err.constraint === 'team_name_unique_per_game') {
      res.status(409).json({ error: 'team name already taken' });
      return;
    }
    if (err.code === '23505' && err.constraint === 'team_color_unique_per_game') {
      res.status(409).json({ error: 'color already taken' });
      return;
    }
    throw err;
  }
}));

export default router;
