// Event-driven challenge lifecycle. Replaces the old polling ticker.
// See SPECS §4.4. No setInterval for game state; one setInterval per active
// game for admin position broadcasts only (see broadcastPositions).

import type { Server } from 'socket.io';
import type { Challenge, LeaderboardEntry } from '@t4al/shared';
import { ADMIN_POSITION_INTERVAL_MS } from '@t4al/shared';
import pool from './db/pool.js';
import * as repo from './db/repo.js';
import {
  challengeTimers,
  gameEndTimers,
  adminPositionIntervals,
  getTeamPosition,
} from './state.js';

// Emits leaderboard:update to the game room.
export async function emitLeaderboard(io: Server, gameId: string) {
  const r = await pool.query(
    'SELECT id, name, color, tokens FROM teams WHERE game_id = $1 ORDER BY tokens DESC, name ASC',
    [gameId],
  );
  const teams: LeaderboardEntry[] = r.rows.map((t: any, i: number) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    tokens: t.tokens,
    rank: i + 1,
  }));
  io.to(`game:${gameId}`).emit('leaderboard:update', { teams });
}

// Emits team:state to a specific team room with their current private state.
export async function emitTeamState(io: Server, teamId: string) {
  const row = await repo.getTeamPrivateRow(teamId);
  if (!row) return;
  io.to(`team:${teamId}`).emit('team:state', row);
}

// Schedule the expire timer for a challenge. Idempotent: clears existing before setting.
export function scheduleChallengeExpiry(
  io: Server,
  gameId: string,
  challenge: Challenge,
  expireMinutes: number,
) {
  const existing = challengeTimers.get(challenge.id);
  if (existing) clearTimeout(existing);

  const activated = challenge.activatedAt ? new Date(challenge.activatedAt).getTime() : Date.now();
  const expireAt = activated + expireMinutes * 60_000;
  const msRemaining = Math.max(0, expireAt - Date.now());

  const timer = setTimeout(() => expireChallenge(io, gameId, challenge.id), msRemaining);
  challengeTimers.set(challenge.id, timer);
}

// Fire an expired challenge: flip DB row, yank teams, broadcast, refill queue.
// Safe to call from either the natural expiry timer or an admin force-expire.
export async function expireChallenge(io: Server, gameId: string, challengeId: string) {
  const pending = challengeTimers.get(challengeId);
  if (pending) clearTimeout(pending);
  challengeTimers.delete(challengeId);
  const expired = await repo.expireChallengeRow(challengeId);
  if (!expired) return; // already claimed or expired (race)

  const yankedTeamIds = await repo.yankTeamsOnChallenge(challengeId, null);

  // Team-scoped yanks
  for (const teamId of yankedTeamIds) {
    io.to(`team:${teamId}`).emit('challenge:yanked', {
      challengeId,
      reason: 'expired',
    });
    emitTeamState(io, teamId);
  }

  // Game room broadcast + event log
  io.to(`game:${gameId}`).emit('challenge:expired', { challengeId });
  repo.logEvent(gameId, 'challenge:expired', { challengeId });

  // Refill queue
  await fillQueueAndBroadcast(io, gameId);
}

// Claim flow: delegates to repo, broadcasts results, refills queue.
export async function completeAndBroadcast(
  io: Server,
  gameId: string,
  teamId: string,
  challengeId: string,
  count: number | undefined,
): Promise<
  | { ok: true }
  | { ok: false; reason: 'challenge_unavailable' | 'invalid_state' | 'bad_input' }
> {
  const result = await repo.completeChallenge(challengeId, teamId, count);
  if (result === null) {
    // Defensive check (team's active challenge didn't match, or bad input)
    return { ok: false, reason: 'invalid_state' };
  }
  if ('raceLost' in result) {
    io.to(`team:${teamId}`).emit('challenge:yanked', { challengeId, reason: 'claimed' });
    emitTeamState(io, teamId);
    return { ok: false, reason: 'challenge_unavailable' };
  }

  const { challenge, tokensAwarded, yankedTeamIds } = result;

  // Clear the expire timer; challenge is now claimed
  const timer = challengeTimers.get(challengeId);
  if (timer) {
    clearTimeout(timer);
    challengeTimers.delete(challengeId);
  }

  // Look up team name for the game-room broadcast
  const team = await repo.getTeam(teamId);
  const teamName = team?.name ?? 'Unknown';

  // Team-scoped events
  io.to(`team:${teamId}`).emit('complete:success', { challengeId, tokensAwarded });
  emitTeamState(io, teamId);
  if (challenge.type === 'wager') {
    io.to(`team:${teamId}`).emit('wager:result', {
      challengeId,
      outcome: 'pass',
      tokensDelta: tokensAwarded,
    });
  }

  // Yank teams that were working on the same challenge
  for (const otherTeamId of yankedTeamIds) {
    io.to(`team:${otherTeamId}`).emit('challenge:yanked', {
      challengeId,
      reason: 'claimed',
    });
    emitTeamState(io, otherTeamId);
  }

  // Game-room broadcast + event log
  io.to(`game:${gameId}`).emit('challenge:claimed', {
    challengeId,
    teamId,
    teamName,
    tokensAwarded,
  });
  repo.logEvent(gameId, 'challenge:claimed', {
    challengeId,
    teamId,
    teamName,
    tokensAwarded,
  });

  await emitLeaderboard(io, gameId);
  await fillQueueAndBroadcast(io, gameId);
  return { ok: true };
}

// Fail wager: deduct tokens, clear state, broadcast. Challenge stays active.
export async function failWagerAndBroadcast(
  io: Server,
  gameId: string,
  teamId: string,
  challengeId: string,
): Promise<{ ok: true } | { ok: false; reason: 'invalid_state' }> {
  const result = await repo.failWager(teamId, challengeId);
  if (!result) return { ok: false, reason: 'invalid_state' };

  io.to(`team:${teamId}`).emit('wager:result', {
    challengeId,
    outcome: 'fail',
    tokensDelta: -result.wagerAmount,
  });
  emitTeamState(io, teamId);

  io.to(`game:${gameId}`).emit('challenge:wagerFailed', { challengeId, teamId });
  repo.logEvent(gameId, 'challenge:wagerFailed', {
    challengeId,
    teamId,
    wagerAmount: result.wagerAmount,
  });

  await emitLeaderboard(io, gameId);
  return { ok: true };
}

// Abandon: clear active, no wager lock-in. Broadcast.
export async function abandonAndBroadcast(
  io: Server,
  gameId: string,
  teamId: string,
  challengeId: string,
): Promise<{ ok: true } | { ok: false; reason: 'invalid_state' }> {
  const ok = await repo.abandonChallenge(teamId, challengeId);
  if (!ok) return { ok: false, reason: 'invalid_state' };

  emitTeamState(io, teamId);
  io.to(`game:${gameId}`).emit('challenge:abandoned', { challengeId, teamId });
  repo.logEvent(gameId, 'challenge:abandoned', { challengeId, teamId });
  return { ok: true };
}

// Fill queue + broadcast + schedule timers for the newly-activated rows.
export async function fillQueueAndBroadcast(io: Server, gameId: string) {
  const game = await repo.getGame(gameId);
  if (!game || game.status !== 'active') return;
  const activated = await repo.fillQueue(gameId);
  for (const ch of activated) {
    scheduleChallengeExpiry(io, gameId, ch, game.challengeExpireMinutes);
    io.to(`game:${gameId}`).emit('challenge:spawned', { challenge: ch });
    repo.logEvent(gameId, 'challenge:spawned', {
      challengeId: ch.id,
      name: ch.name,
      type: ch.type,
    });
  }
}

// Start broadcasting team positions to the admin room every 5s.
export function startAdminPositionBroadcast(io: Server, gameId: string) {
  // Clear any existing interval (idempotent)
  const existing = adminPositionIntervals.get(gameId);
  if (existing) clearInterval(existing);

  const interval = setInterval(async () => {
    try {
      await broadcastPositions(io, gameId);
    } catch (err) {
      console.error('admin position broadcast error:', err);
    }
  }, ADMIN_POSITION_INTERVAL_MS);
  adminPositionIntervals.set(gameId, interval);
}

export function stopAdminPositionBroadcast(gameId: string) {
  const interval = adminPositionIntervals.get(gameId);
  if (interval) {
    clearInterval(interval);
    adminPositionIntervals.delete(gameId);
  }
}

async function broadcastPositions(io: Server, gameId: string) {
  const teams = await repo.listTeams(gameId);
  const positions: { teamId: string; lat: number; lng: number }[] = [];
  for (const team of teams) {
    const pos = getTeamPosition(team.id);
    if (pos) positions.push({ teamId: team.id, ...pos });
  }
  io.to(`admin:${gameId}`).emit('teams:positions', { positions });

  // Persist each computed team position to location_history for post-game analysis.
  for (const p of positions) {
    pool
      .query(
        `INSERT INTO location_history (team_id, game_id, lat, lng, recorded_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [p.teamId, gameId, p.lat, p.lng],
      )
      .catch((err: any) => console.error('location_history insert failed:', err));
  }
}

// Start a game: atomic transition, initialize tokens, activate first K, set timers.
export async function startGameAndBroadcast(
  io: Server,
  gameId: string,
): Promise<
  | { ok: true }
  | { ok: false; reason: 'invalid_state' }
> {
  const game = await repo.startGame(gameId);
  if (!game) return { ok: false, reason: 'invalid_state' };

  await repo.initializeTeamTokens(gameId, game.startingTokens);
  await fillQueueAndBroadcast(io, gameId);

  // Game-end timer
  const msUntilEnd = new Date(game.endTime!).getTime() - Date.now();
  gameEndTimers.set(
    gameId,
    setTimeout(() => endGameAndBroadcast(io, gameId), Math.max(0, msUntilEnd)),
  );

  startAdminPositionBroadcast(io, gameId);

  // Fresh game snapshot so clients get K activated challenges
  const challenges = await repo.listActiveChallenges(gameId);
  io.to(`game:${gameId}`).emit('game:started', { game, challenges });
  repo.logEvent(gameId, 'game:started', {});

  return { ok: true };
}

// End a game: clear timers, broadcast final standings.
export async function endGameAndBroadcast(
  io: Server,
  gameId: string,
): Promise<{ ok: true } | { ok: false; reason: 'invalid_state' }> {
  // Clear challenge timers for active challenges in this game
  const challenges = await repo.listActiveChallenges(gameId);
  for (const ch of challenges) {
    const t = challengeTimers.get(ch.id);
    if (t) {
      clearTimeout(t);
      challengeTimers.delete(ch.id);
    }
  }

  const endTimer = gameEndTimers.get(gameId);
  if (endTimer) {
    clearTimeout(endTimer);
    gameEndTimers.delete(gameId);
  }
  stopAdminPositionBroadcast(gameId);

  const ended = await repo.endGame(gameId);
  if (!ended) return { ok: false, reason: 'invalid_state' };

  // Flip any still-active challenges to expired so the post-game state is clean
  // and the event log reflects what happened to them.
  const expired = await repo.expireActiveChallengesForGame(gameId);
  for (const ch of expired) {
    io.to(`game:${gameId}`).emit('challenge:expired', { challengeId: ch.id });
    repo.logEvent(gameId, 'challenge:expired', { challengeId: ch.id });
  }

  const teamsResult = await pool.query(
    'SELECT id, name, color, tokens FROM teams WHERE game_id = $1 ORDER BY tokens DESC, name ASC',
    [gameId],
  );
  const finalStandings: LeaderboardEntry[] = teamsResult.rows.map((t: any, i: number) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    tokens: t.tokens,
    rank: i + 1,
  }));

  io.to(`game:${gameId}`).emit('game:ended', { finalStandings });
  repo.logEvent(gameId, 'game:ended', { finalStandings });
  return { ok: true };
}

// Rehydrate timers + intervals on server restart. See SPECS §4.7.
export async function recoverActiveGames(io: Server) {
  const games = await repo.listActiveGames();
  for (const game of games) {
    // Game end: past its end time? End immediately. Otherwise schedule.
    const endTime = game.endTime ? new Date(game.endTime).getTime() : null;
    if (endTime != null && endTime <= Date.now()) {
      await endGameAndBroadcast(io, game.id);
      continue;
    }
    if (endTime != null) {
      gameEndTimers.set(
        game.id,
        setTimeout(() => endGameAndBroadcast(io, game.id), endTime - Date.now()),
      );
    }

    // Challenge timers: expire passed ones immediately, schedule the rest
    const active = await repo.listActiveChallenges(game.id);
    for (const ch of active) {
      const activated = ch.activatedAt ? new Date(ch.activatedAt).getTime() : Date.now();
      const expireAt = activated + game.challengeExpireMinutes * 60_000;
      if (Date.now() >= expireAt) {
        await expireChallenge(io, game.id, ch.id);
      } else {
        scheduleChallengeExpiry(io, game.id, ch, game.challengeExpireMinutes);
      }
    }

    // Catch up on any missed queue fills
    await fillQueueAndBroadcast(io, game.id);

    // Start admin position broadcast for this game
    startAdminPositionBroadcast(io, game.id);

    console.log(`Recovered active game ${game.id}`);
  }
}
