import { Router } from 'express';
import crypto from 'node:crypto';
import pool from '../db/pool.js';
import { asyncHandler } from '../asyncHandler.js';
import {
  DEFAULT_ACTIVE_CHALLENGE_COUNT,
  DEFAULT_CHALLENGE_EXPIRE_MINUTES,
  DEFAULT_STARTING_TOKENS,
  JOIN_CODE_LENGTH,
  ADMIN_CODE_BYTES,
} from '@t4al/shared';
import { requireAdmin, requireLobby } from './middleware.js';
import { mapGame } from '../db/mappers.js';
import * as lifecycle from '../lifecycle.js';

const router = Router();

// ── Auth code generation ──
const JOIN_CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
function generateJoinCode(): string {
  let out = '';
  const buf = crypto.randomBytes(JOIN_CODE_LENGTH);
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) {
    out += JOIN_CODE_CHARSET[buf[i] % JOIN_CODE_CHARSET.length];
  }
  return out;
}
function generateAdminCode(): string {
  return crypto.randomBytes(ADMIN_CODE_BYTES).toString('base64url');
}

// POST /api/games — create a new game
router.post('/', asyncHandler(async (req, res) => {
  const {
    name,
    durationMinutes = 120,
    activeChallengeCount = DEFAULT_ACTIVE_CHALLENGE_COUNT,
    challengeExpireMinutes = DEFAULT_CHALLENGE_EXPIRE_MINUTES,
    startingTokens = DEFAULT_STARTING_TOKENS,
  } = req.body ?? {};

  if (!name || typeof name !== 'string') {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  if (typeof durationMinutes !== 'number' || durationMinutes <= 0) {
    res.status(400).json({ error: 'durationMinutes must be > 0' });
    return;
  }
  if (typeof startingTokens !== 'number' || startingTokens < 0) {
    res.status(400).json({ error: 'startingTokens must be >= 0' });
    return;
  }

  // Retry on join_code UNIQUE collision (negligibly rare; handle cleanly anyway)
  for (let attempt = 0; attempt < 5; attempt++) {
    const joinCode  = generateJoinCode();
    const adminCode = generateAdminCode();
    try {
      const result = await pool.query(
        `INSERT INTO games (
           name, duration_minutes, active_challenge_count,
           challenge_expire_minutes, starting_tokens, join_code, admin_code
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [
          name,
          durationMinutes,
          activeChallengeCount,
          challengeExpireMinutes,
          startingTokens,
          joinCode,
          adminCode,
        ],
      );
      res.status(201).json(mapGame(result.rows[0]));
      return;
    } catch (err: any) {
      if (err.code === '23505' && err.constraint === 'games_join_code_key') continue;
      throw err;
    }
  }
  res.status(500).json({ error: 'could not allocate unique join code' });
}));

// GET /api/games?joinCode=XXXX — lookup by join code (public fields only)
router.get('/', asyncHandler(async (req, res) => {
  const joinCode = typeof req.query.joinCode === 'string' ? req.query.joinCode : null;
  if (!joinCode) {
    res.status(400).json({ error: 'joinCode query param required' });
    return;
  }
  const result = await pool.query(
    `SELECT id, name, status, duration_minutes, active_challenge_count,
            challenge_expire_minutes, starting_tokens, start_time, end_time,
            join_code, created_at
     FROM games WHERE join_code = $1`,
    [joinCode],
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: 'game not found' });
    return;
  }
  // admin_code intentionally not returned
  const g = result.rows[0];
  res.json({ ...mapGame({ ...g, admin_code: '' }), adminCode: undefined });
}));

// GET /api/games/:id — get a game (admin gets full row incl. adminCode)
router.get('/:id', asyncHandler(async (req, res) => {
  const result = await pool.query('SELECT * FROM games WHERE id = $1', [req.params.id]);
  if (result.rows.length === 0) {
    res.status(404).json({ error: 'game not found' });
    return;
  }
  const isAdmin = req.get('x-admin-code') === result.rows[0].admin_code;
  const full = mapGame(result.rows[0]);
  res.json(isAdmin ? full : { ...full, adminCode: undefined });
}));

// PUT /api/games/:id — update game settings (lobby only)
router.put('/:id',
  requireAdmin,
  requireLobby,
  asyncHandler(async (req, res) => {
    const { name, durationMinutes, activeChallengeCount, challengeExpireMinutes, startingTokens } = req.body ?? {};
    const fields: string[] = [];
    const values: any[] = [];
    let i = 1;
    if (name !== undefined)                   { fields.push(`name = $${i++}`);                     values.push(name); }
    if (durationMinutes !== undefined)        { fields.push(`duration_minutes = $${i++}`);         values.push(durationMinutes); }
    if (activeChallengeCount !== undefined)   { fields.push(`active_challenge_count = $${i++}`);   values.push(activeChallengeCount); }
    if (challengeExpireMinutes !== undefined) { fields.push(`challenge_expire_minutes = $${i++}`); values.push(challengeExpireMinutes); }
    if (startingTokens !== undefined)         { fields.push(`starting_tokens = $${i++}`);          values.push(startingTokens); }

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
    res.json(mapGame(result.rows[0]));
  }),
);

// POST /api/games/:id/start — admin starts the game
router.post('/:id/start',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const io = req.app.get('io');
    const gameId = (req as any).resolvedGameId as string;
    const result = await lifecycle.startGameAndBroadcast(io, gameId);
    if (!result.ok) {
      res.status(409).json({ error: 'game not in lobby' });
      return;
    }
    res.json({ ok: true });
  }),
);

// POST /api/games/:id/end — admin force-ends the game
router.post('/:id/end',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const io = req.app.get('io');
    const gameId = (req as any).resolvedGameId as string;
    const result = await lifecycle.endGameAndBroadcast(io, gameId);
    if (!result.ok) {
      res.status(409).json({ error: 'game not active' });
      return;
    }
    res.json({ ok: true });
  }),
);

// GET /api/games/:id/events — admin event log
router.get('/:id/events',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const gameId = (req as any).resolvedGameId as string;
    const result = await pool.query(
      `SELECT id, game_id AS "gameId", type, payload, created_at AS "createdAt"
       FROM game_events WHERE game_id = $1 ORDER BY created_at DESC LIMIT 500`,
      [gameId],
    );
    res.json(result.rows);
  }),
);

// POST /api/games/:id/reassign-device — admin moves a device to another team
router.post('/:id/reassign-device',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const gameId = (req as any).resolvedGameId as string;
    const { deviceId, newTeamId } = req.body ?? {};
    if (!deviceId || !newTeamId) {
      res.status(400).json({ error: 'deviceId and newTeamId required' });
      return;
    }
    if ((req as any).gameStatus !== 'active') {
      res.status(409).json({ error: 'game not active' });
      return;
    }
    const team = await pool.query(
      'SELECT id FROM teams WHERE id = $1 AND game_id = $2',
      [newTeamId, gameId],
    );
    if (team.rows.length === 0) {
      res.status(404).json({ error: 'team not found in this game' });
      return;
    }

    const { deviceTeam, devicePings, socketsForDevice } = await import('../state.js');
    const entry = deviceTeam.get(deviceId);
    const io = req.app.get('io');
    const oldTeamId = entry?.teamId;
    deviceTeam.set(deviceId, { gameId, teamId: newTeamId });

    for (const socket of socketsForDevice(deviceId)) {
      if (oldTeamId) socket.leave(`team:${oldTeamId}`);
      socket.join(`team:${newTeamId}`);
      socket.data.teamId = newTeamId;
    }
    if (oldTeamId && oldTeamId !== newTeamId) {
      await lifecycle.emitTeamState(io, newTeamId);
    }

    const ping = devicePings.get(deviceId);
    if (ping) devicePings.set(deviceId, { ...ping, teamId: newTeamId });

    await pool.query(
      `INSERT INTO game_events (game_id, type, payload) VALUES ($1, 'team:reassigned', $2)`,
      [gameId, JSON.stringify({ deviceId, fromTeamId: oldTeamId ?? null, toTeamId: newTeamId })],
    );

    res.json({ ok: true });
  }),
);

export default router;
