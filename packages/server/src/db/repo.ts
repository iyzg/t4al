// Repository layer: atomic SQL queries that encode preconditions in WHERE clauses.
// See SPECS §4.3 (concurrency). Every state transition that has a "check-then-write"
// shape MUST be expressed as one statement with RETURNING — zero rows means the
// precondition failed (race lost, already in wrong state, etc.).

import pool from './pool.js';
import { mapChallenge, mapGame, mapTeam } from './mappers.js';
import type { Challenge, Game, Team } from '@t4al/shared';

// ── Reads ──

export async function getGame(gameId: string): Promise<Game | null> {
  const r = await pool.query('SELECT * FROM games WHERE id = $1', [gameId]);
  return r.rows[0] ? mapGame(r.rows[0]) : null;
}

export async function getGameByJoinCode(joinCode: string): Promise<Game | null> {
  const r = await pool.query('SELECT * FROM games WHERE join_code = $1', [joinCode]);
  return r.rows[0] ? mapGame(r.rows[0]) : null;
}

export async function getTeam(teamId: string): Promise<Team | null> {
  const r = await pool.query('SELECT * FROM teams WHERE id = $1', [teamId]);
  return r.rows[0] ? mapTeam(r.rows[0]) : null;
}

export async function getChallenge(challengeId: string): Promise<Challenge | null> {
  const r = await pool.query('SELECT * FROM challenges WHERE id = $1', [challengeId]);
  return r.rows[0] ? mapChallenge(r.rows[0]) : null;
}

export async function listTeams(gameId: string): Promise<Team[]> {
  const r = await pool.query(
    'SELECT * FROM teams WHERE game_id = $1 ORDER BY joined_at',
    [gameId],
  );
  return r.rows.map(mapTeam);
}

export async function listActiveChallenges(gameId: string): Promise<Challenge[]> {
  const r = await pool.query(
    `SELECT * FROM challenges WHERE game_id = $1 AND status = 'active' ORDER BY sort_order`,
    [gameId],
  );
  return r.rows.map(mapChallenge);
}

export async function listAllChallenges(gameId: string): Promise<Challenge[]> {
  const r = await pool.query(
    'SELECT * FROM challenges WHERE game_id = $1 ORDER BY sort_order',
    [gameId],
  );
  return r.rows.map(mapChallenge);
}

export async function listActiveGames(): Promise<Game[]> {
  const r = await pool.query(`SELECT * FROM games WHERE status = 'active'`);
  return r.rows.map(mapGame);
}

// ── Atomic state transitions ──

/**
 * Team starts a challenge: team has no active challenge AND challenge is still active.
 * Returns the team row on success, null if either precondition fails.
 */
export async function startChallenge(
  teamId: string,
  challengeId: string,
): Promise<Team | null> {
  const r = await pool.query(
    `UPDATE teams
     SET active_challenge_id = $1
     WHERE id = $2
       AND active_challenge_id IS NULL
       AND EXISTS (SELECT 1 FROM challenges WHERE id = $1 AND status = 'active')
     RETURNING *`,
    [challengeId, teamId],
  );
  return r.rows[0] ? mapTeam(r.rows[0]) : null;
}

/**
 * Team sets a wager amount on their already-started wager challenge.
 * Precondition: team.activeChallengeId = challengeId AND team.wagerAmount IS NULL
 *               AND amount >= 1 AND amount <= team.tokens.
 */
export async function setWager(
  teamId: string,
  challengeId: string,
  amount: number,
): Promise<Team | null> {
  if (amount < 1) return null;
  const r = await pool.query(
    `UPDATE teams
     SET wager_amount = $1
     WHERE id = $2
       AND active_challenge_id = $3
       AND wager_amount IS NULL
       AND $1 <= tokens
     RETURNING *`,
    [amount, teamId, challengeId],
  );
  return r.rows[0] ? mapTeam(r.rows[0]) : null;
}

/**
 * Atomic claim: challenge is still active. Returns challenge row on success, null on race loss.
 * Caller is responsible for awarding tokens and yanking other teams afterward.
 */
export async function claimChallenge(
  challengeId: string,
  teamId: string,
): Promise<Challenge | null> {
  const r = await pool.query(
    `UPDATE challenges
     SET status = 'claimed', claimed_by_team_id = $1, claimed_at = NOW()
     WHERE id = $2 AND status = 'active'
     RETURNING *`,
    [teamId, challengeId],
  );
  return r.rows[0] ? mapChallenge(r.rows[0]) : null;
}

/**
 * Mark a challenge expired. Returns the row if it was actually flipped from 'active'.
 */
export async function expireChallengeRow(challengeId: string): Promise<Challenge | null> {
  const r = await pool.query(
    `UPDATE challenges SET status = 'expired'
     WHERE id = $1 AND status = 'active' RETURNING *`,
    [challengeId],
  );
  return r.rows[0] ? mapChallenge(r.rows[0]) : null;
}

export async function expireActiveChallengesForGame(gameId: string): Promise<Challenge[]> {
  const r = await pool.query(
    `UPDATE challenges SET status = 'expired'
     WHERE game_id = $1 AND status = 'active' RETURNING *`,
    [gameId],
  );
  return r.rows.map(mapChallenge);
}

/**
 * Atomic game start: only flips a lobby game, computes endTime from duration.
 */
export async function startGame(gameId: string): Promise<Game | null> {
  const r = await pool.query(
    `UPDATE games
     SET status = 'active',
         start_time = NOW(),
         end_time = NOW() + (duration_minutes || ' minutes')::interval
     WHERE id = $1 AND status = 'lobby'
     RETURNING *`,
    [gameId],
  );
  return r.rows[0] ? mapGame(r.rows[0]) : null;
}

/**
 * Initialize all teams in the game to startingTokens. Called once on game start.
 */
export async function initializeTeamTokens(gameId: string, startingTokens: number): Promise<void> {
  await pool.query(
    'UPDATE teams SET tokens = $1 WHERE game_id = $2',
    [startingTokens, gameId],
  );
}

/**
 * Atomic game end: flips to 'ended', sets end_time to NOW() (force-end case rewrites
 * the planned end_time). Clears all teams' activeChallengeId + wagerAmount.
 */
export async function endGame(gameId: string): Promise<Game | null> {
  const r = await pool.query(
    `UPDATE games SET status = 'ended', end_time = NOW()
     WHERE id = $1 AND status = 'active'
     RETURNING *`,
    [gameId],
  );
  if (!r.rows[0]) return null;
  await pool.query(
    `UPDATE teams SET active_challenge_id = NULL, wager_amount = NULL WHERE game_id = $1`,
    [gameId],
  );
  return mapGame(r.rows[0]);
}

/**
 * Fill the queue: atomically activate the next N queued challenges (by sort_order),
 * where N = activeChallengeCount - currently active. Returns the newly-activated rows.
 * No race window even if two expire timers fire in the same tick.
 */
export async function fillQueue(gameId: string): Promise<Challenge[]> {
  const r = await pool.query(
    `UPDATE challenges
     SET status = 'active', activated_at = NOW()
     WHERE id IN (
       SELECT id FROM challenges
       WHERE game_id = $1 AND status = 'queued'
       ORDER BY sort_order
       LIMIT GREATEST(0, (
         SELECT active_challenge_count FROM games WHERE id = $1
       ) - (
         SELECT COUNT(*) FROM challenges
         WHERE game_id = $1 AND status = 'active'
       ))
     )
     RETURNING *`,
    [gameId],
  );
  return r.rows.map(mapChallenge);
}

/**
 * Teams whose active_challenge_id points at this challenge get their
 * activeChallengeId + wagerAmount cleared. Used by expire + claim yanks.
 * Returns the yanked team IDs.
 */
export async function yankTeamsOnChallenge(
  challengeId: string,
  exceptTeamId: string | null = null,
): Promise<string[]> {
  const r = exceptTeamId
    ? await pool.query(
        `UPDATE teams SET active_challenge_id = NULL, wager_amount = NULL
         WHERE active_challenge_id = $1 AND id <> $2 RETURNING id`,
        [challengeId, exceptTeamId],
      )
    : await pool.query(
        `UPDATE teams SET active_challenge_id = NULL, wager_amount = NULL
         WHERE active_challenge_id = $1 RETURNING id`,
        [challengeId],
      );
  return r.rows.map((row: any) => row.id);
}

/**
 * Abandon: clear the team's active challenge, but ONLY if no wager has been set
 * (wager lock-in forbids abandon). Returns true on success.
 */
export async function abandonChallenge(
  teamId: string,
  challengeId: string,
): Promise<boolean> {
  const r = await pool.query(
    `UPDATE teams
     SET active_challenge_id = NULL, wager_amount = NULL
     WHERE id = $1 AND active_challenge_id = $2 AND wager_amount IS NULL
     RETURNING id`,
    [teamId, challengeId],
  );
  return r.rowCount! > 0;
}

/**
 * Wager fail: deducts wagerAmount from tokens, clears active + wager.
 * Precondition: team.activeChallengeId = challengeId AND team.wagerAmount IS NOT NULL.
 * Returns { wagerAmount, tokens } (the deducted amount and post-deduction balance),
 * or null if preconditions fail.
 *
 * Uses a CTE so the old wager_amount is captured in the same statement as the UPDATE.
 */
export async function failWager(
  teamId: string,
  challengeId: string,
): Promise<{ wagerAmount: number; tokens: number } | null> {
  const r = await pool.query(
    `WITH before AS (
       SELECT wager_amount AS was FROM teams
       WHERE id = $1 AND active_challenge_id = $2 AND wager_amount IS NOT NULL
     )
     UPDATE teams
     SET tokens = tokens - (SELECT was FROM before),
         active_challenge_id = NULL,
         wager_amount = NULL
     WHERE id = $1 AND EXISTS (SELECT 1 FROM before)
     RETURNING tokens, (SELECT was FROM before) AS wager_amount_was`,
    [teamId, challengeId],
  );
  return r.rows[0]
    ? { wagerAmount: r.rows[0].wager_amount_was, tokens: r.rows[0].tokens }
    : null;
}

/**
 * Complete a normal/variable challenge: claim + award tokens + clear team state.
 * Uses a single transaction so the atomic claim + token award + team clear all commit together.
 * Returns { challenge, tokensAwarded, yankedTeamIds } or null if claim race was lost.
 */
export async function completeChallenge(
  challengeId: string,
  teamId: string,
  count?: number,
): Promise<
  | { challenge: Challenge; tokensAwarded: number; yankedTeamIds: string[] }
  | { raceLost: true }
  | null
> {
  // Defensive read outside any transaction: no lock, just a TOCTOU-tolerant check.
  // The challenge-row atomic claim below is the actual serialization point; taking
  // `FOR UPDATE` on the team row here would deadlock with concurrent yanks targeting
  // the same team rows from other teams' completeChallenge transactions.
  const teamPre = await pool.query(
    'SELECT active_challenge_id, wager_amount FROM teams WHERE id = $1',
    [teamId],
  );
  if (teamPre.rows[0]?.active_challenge_id !== challengeId) return null;
  const wagerAtRead: number | null = teamPre.rows[0].wager_amount;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Atomic claim — locks the challenge row exclusively until COMMIT,
    // serializing all concurrent claim attempts.
    const claimR = await client.query(
      `UPDATE challenges
       SET status = 'claimed', claimed_by_team_id = $1, claimed_at = NOW()
       WHERE id = $2 AND status = 'active'
       RETURNING *`,
      [teamId, challengeId],
    );
    if (claimR.rows.length === 0) {
      await client.query('ROLLBACK');
      return { raceLost: true };
    }
    const ch = mapChallenge(claimR.rows[0]);

    // Compute token award
    let tokensAwarded = 0;
    if (ch.type === 'normal') {
      tokensAwarded = ch.tokens ?? 0;
    } else if (ch.type === 'variable') {
      if (!count || count < 1) {
        await client.query('ROLLBACK');
        return null;
      }
      tokensAwarded = (ch.tokensPerUnit ?? 0) * count;
    } else if (ch.type === 'wager') {
      if (wagerAtRead == null) {
        await client.query('ROLLBACK');
        return null;
      }
      tokensAwarded = 2 * wagerAtRead;
    }

    // Award tokens to claiming team, clear its state
    await client.query(
      `UPDATE teams SET tokens = tokens + $1,
                         active_challenge_id = NULL,
                         wager_amount = NULL
       WHERE id = $2`,
      [tokensAwarded, teamId],
    );

    // Yank all OTHER teams working on this challenge
    const yankR = await client.query(
      `UPDATE teams SET active_challenge_id = NULL, wager_amount = NULL
       WHERE active_challenge_id = $1 AND id <> $2 RETURNING id`,
      [challengeId, teamId],
    );

    await client.query('COMMIT');
    return {
      challenge: ch,
      tokensAwarded,
      yankedTeamIds: yankR.rows.map((r: any) => r.id),
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ── Miscellaneous ──

export async function getTeamPrivateRow(
  teamId: string,
): Promise<{ activeChallengeId: string | null; wagerAmount: number | null; tokens: number; activeChallengeDescription: string | null } | null> {
  // LEFT JOIN the active challenge so the player only ever receives a
  // description for a challenge their team has actually started.
  const r = await pool.query(
    `SELECT t.active_challenge_id, t.wager_amount, t.tokens,
            c.description AS active_challenge_description
       FROM teams t
       LEFT JOIN challenges c ON c.id = t.active_challenge_id
      WHERE t.id = $1`,
    [teamId],
  );
  if (!r.rows[0]) return null;
  return {
    activeChallengeId: r.rows[0].active_challenge_id,
    wagerAmount: r.rows[0].wager_amount,
    tokens: r.rows[0].tokens,
    activeChallengeDescription: r.rows[0].active_challenge_description ?? null,
  };
}

export async function logEvent(
  gameId: string,
  type: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO game_events (game_id, type, payload) VALUES ($1, $2, $3)`,
      [gameId, type, JSON.stringify(payload)],
    );
  } catch (err) {
    console.error('Failed to log event:', err);
  }
}
