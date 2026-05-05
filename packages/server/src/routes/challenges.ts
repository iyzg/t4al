import { Router } from 'express';
import pool from '../db/pool.js';
import { asyncHandler } from '../asyncHandler.js';
import { MIN_PROXIMITY_METERS, MAX_PROXIMITY_METERS } from '@t4al/shared';
import type { ChallengeType } from '@t4al/shared';
import { requireAdmin, requireLobby } from './middleware.js';
import { mapChallenge } from '../db/mappers.js';
import * as lifecycle from '../lifecycle.js';

const router = Router({ mergeParams: true });

// ── Type-field validation ──
// Returns null if valid, else an error message.
function validateChallengeFields(body: any): string | null {
  const { type, tokens, tokensPerUnit, unitLabel } = body ?? {};
  if (!['normal', 'variable', 'wager'].includes(type)) {
    return 'type must be one of: normal, variable, wager';
  }
  if (type === 'normal') {
    if (typeof tokens !== 'number' || tokens < 0) return 'normal challenges require tokens >= 0';
    if (tokensPerUnit != null || unitLabel != null) return 'normal challenges must not set tokensPerUnit or unitLabel';
  } else if (type === 'variable') {
    if (typeof tokensPerUnit !== 'number' || tokensPerUnit < 0) return 'variable challenges require tokensPerUnit >= 0';
    if (typeof unitLabel !== 'string' || !unitLabel.trim()) return 'variable challenges require a unitLabel';
    if (tokens != null) return 'variable challenges must not set tokens';
  } else if (type === 'wager') {
    if (tokens != null || tokensPerUnit != null || unitLabel != null) {
      return 'wager challenges must not set tokens/tokensPerUnit/unitLabel';
    }
  }
  return null;
}

// GET /api/games/:gameId/challenges — list all challenges (admin only)
router.get('/',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const gameId = (req as any).resolvedGameId as string;
    const result = await pool.query(
      'SELECT * FROM challenges WHERE game_id = $1 ORDER BY sort_order',
      [gameId],
    );
    res.json(result.rows.map(mapChallenge));
  }),
);

// POST /api/games/:gameId/challenges — create (lobby only)
router.post('/',
  requireAdmin,
  requireLobby,
  asyncHandler(async (req, res) => {
    const gameId = (req as any).resolvedGameId as string;
    const { name, description, lat, lng, proximityMeters = 100, sortOrder } = req.body ?? {};
    const typeErr = validateChallengeFields(req.body);
    if (typeErr) { res.status(400).json({ error: typeErr }); return; }

    if (!name || !description || lat == null || lng == null) {
      res.status(400).json({ error: 'name, description, lat, lng required' });
      return;
    }
    if (proximityMeters < MIN_PROXIMITY_METERS || proximityMeters > MAX_PROXIMITY_METERS) {
      res.status(400).json({ error: `proximityMeters must be in [${MIN_PROXIMITY_METERS}, ${MAX_PROXIMITY_METERS}]` });
      return;
    }

    let order = sortOrder;
    if (order == null) {
      const maxR = await pool.query(
        'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM challenges WHERE game_id = $1',
        [gameId],
      );
      order = maxR.rows[0].next;
    }

    const type: ChallengeType = req.body.type;
    const tokens          = type === 'normal'   ? req.body.tokens        : null;
    const tokensPerUnit   = type === 'variable' ? req.body.tokensPerUnit : null;
    const unitLabel       = type === 'variable' ? req.body.unitLabel     : null;

    const result = await pool.query(
      `INSERT INTO challenges (
         game_id, name, description, type, tokens, tokens_per_unit, unit_label,
         lat, lng, proximity_meters, sort_order
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [gameId, name, description, type, tokens, tokensPerUnit, unitLabel,
       lat, lng, proximityMeters, order],
    );
    res.status(201).json(mapChallenge(result.rows[0]));
  }),
);

// PUT /api/games/:gameId/challenges/order — bulk reorder (lobby only)
router.put('/order',
  requireAdmin,
  requireLobby,
  asyncHandler(async (req, res) => {
    const gameId = (req as any).resolvedGameId as string;
    const { order } = req.body ?? {};
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
          [item.sortOrder, item.id, gameId],
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
      [gameId],
    );
    res.json(result.rows.map(mapChallenge));
  }),
);

// PUT /api/challenges/:challengeId — update (lobby only)
router.put('/:challengeId',
  requireAdmin,
  requireLobby,
  asyncHandler(async (req, res) => {
    const challengeIdParam = req.params.challengeId;
    const challengeId = Array.isArray(challengeIdParam) ? challengeIdParam[0] : challengeIdParam;
    const { name, description, type, tokens, tokensPerUnit, unitLabel,
            lat, lng, proximityMeters, sortOrder } = req.body ?? {};

    // If the caller is changing type or token fields, re-validate the shape
    if (type != null) {
      const typeErr = validateChallengeFields({ type, tokens, tokensPerUnit, unitLabel });
      if (typeErr) { res.status(400).json({ error: typeErr }); return; }
    }

    const result = await pool.query(
      `UPDATE challenges SET
         name             = COALESCE($2, name),
         description      = COALESCE($3, description),
         type             = COALESCE($4, type),
         tokens           = CASE WHEN $4 IS NOT NULL THEN $5 ELSE tokens           END,
         tokens_per_unit  = CASE WHEN $4 IS NOT NULL THEN $6 ELSE tokens_per_unit  END,
         unit_label       = CASE WHEN $4 IS NOT NULL THEN $7 ELSE unit_label       END,
         lat              = COALESCE($8,  lat),
         lng              = COALESCE($9,  lng),
         proximity_meters = COALESCE($10, proximity_meters),
         sort_order       = COALESCE($11, sort_order)
       WHERE id = $1
       RETURNING *`,
      [challengeId, name, description, type, tokens, tokensPerUnit, unitLabel,
       lat, lng, proximityMeters, sortOrder],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'challenge not found' });
      return;
    }
    res.json(mapChallenge(result.rows[0]));
  }),
);

// POST /api/games/:gameId/challenges/:challengeId/force-expire — admin force-expires
// an active challenge during a live game. Reuses the same lifecycle path the
// natural expiry timer uses, so teams get yanked and the queue refills.
router.post('/:challengeId/force-expire',
  requireAdmin,
  asyncHandler(async (req, res) => {
    if ((req as any).gameStatus !== 'active') {
      res.status(409).json({ error: 'force-expire only allowed while game is active' });
      return;
    }
    const gameId = (req as any).resolvedGameId as string;
    const challengeIdParam = req.params.challengeId;
    const challengeId = Array.isArray(challengeIdParam) ? challengeIdParam[0] : challengeIdParam;

    const r = await pool.query(
      'SELECT status FROM challenges WHERE id = $1 AND game_id = $2',
      [challengeId, gameId],
    );
    if (r.rows.length === 0) {
      res.status(404).json({ error: 'challenge not found' });
      return;
    }
    if (r.rows[0].status !== 'active') {
      res.status(409).json({ error: `challenge is ${r.rows[0].status}, not active` });
      return;
    }

    const io = req.app.get('io');
    await lifecycle.expireChallenge(io, gameId, challengeId);
    res.json({ ok: true });
  }),
);

// DELETE /api/challenges/:challengeId — delete (lobby only)
router.delete('/:challengeId',
  requireAdmin,
  requireLobby,
  asyncHandler(async (req, res) => {
    const challengeIdParam = req.params.challengeId;
    const challengeId = Array.isArray(challengeIdParam) ? challengeIdParam[0] : challengeIdParam;
    const result = await pool.query(
      'DELETE FROM challenges WHERE id = $1 RETURNING id',
      [challengeId],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'challenge not found' });
      return;
    }
    res.json({ deleted: true });
  }),
);

export default router;
