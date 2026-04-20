// Shared Express middleware.
//
// requireAdmin: verifies the `x-admin-code` header matches the target game's adminCode.
//   Resolves gameId from (in order): req.params.gameId, req.params.id, or a parent-router-provided
//   req.params.gameId. The route that uses this must have exactly one of those.
//
// requireLobby: allows the request through only when the target game's status='lobby'.
//   Mutations on challenges/teams/settings during active or ended games get 409.

import type { Request, Response, NextFunction } from 'express';
import pool from '../db/pool.js';

async function gameIdFromReq(req: Request): Promise<string | null> {
  const id          = Array.isArray(req.params.id)          ? req.params.id[0]          : req.params.id;
  const gameId      = Array.isArray(req.params.gameId)      ? req.params.gameId[0]      : req.params.gameId;
  const challengeId = Array.isArray(req.params.challengeId) ? req.params.challengeId[0] : req.params.challengeId;
  if (id)     return id;
  if (gameId) return gameId;
  if (challengeId) {
    const r = await pool.query('SELECT game_id FROM challenges WHERE id = $1', [challengeId]);
    return r.rows[0]?.game_id ?? null;
  }
  return null;
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const gameId = await gameIdFromReq(req);
  if (!gameId) {
    res.status(400).json({ error: 'gameId not resolvable' });
    return;
  }
  const adminCode = req.get('x-admin-code');
  if (!adminCode) {
    res.status(401).json({ error: 'admin code required' });
    return;
  }
  const r = await pool.query('SELECT admin_code, status FROM games WHERE id = $1', [gameId]);
  if (r.rows.length === 0) {
    res.status(404).json({ error: 'game not found' });
    return;
  }
  if (r.rows[0].admin_code !== adminCode) {
    res.status(403).json({ error: 'invalid admin code' });
    return;
  }
  (req as any).gameStatus = r.rows[0].status;
  (req as any).resolvedGameId = gameId;
  next();
}

export function requireLobby(req: Request, res: Response, next: NextFunction): void {
  const status = (req as any).gameStatus;
  if (status !== 'lobby') {
    res.status(409).json({ error: 'mutation only allowed while game is in lobby' });
    return;
  }
  next();
}
