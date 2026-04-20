// Socket-level V2 tests.
// Covers: accept → complete → tokens awarded, ack semantics, wager pass/fail.
//
// Uses socket.io-client directly (no browser) so we can exercise the raw protocol.

import { test, expect } from '@playwright/test';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';

const API    = 'http://localhost:3001/api';
const SOCKET = 'http://localhost:3001';

async function json<T = any>(method: string, path: string, body?: any, headers: Record<string, string> = {}): Promise<{ status: number; data: T }> {
  const res = await fetch(`${API}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function setupGame(overrides: {
  startingTokens?: number;
  challengeType?: 'normal' | 'variable' | 'wager';
  tokens?: number;
  tokensPerUnit?: number;
  unitLabel?: string;
} = {}) {
  const { data: game } = await json<any>('POST', '/games', {
    name: `Sockets ${Date.now()}-${Math.random()}`,
    durationMinutes: 60,
    activeChallengeCount: 3,
    challengeExpireMinutes: 10,
    startingTokens: overrides.startingTokens ?? 50,
  });
  const hdr = { 'x-admin-code': game.adminCode };
  const { data: team } = await json<any>('POST', `/games/${game.id}/teams`, { name: 'Alpha', color: '#e74c3c' });

  const body: any = {
    name: 'C', description: 'd',
    type: overrides.challengeType ?? 'normal',
    lat: 41.88, lng: -87.63,
  };
  if (body.type === 'normal')   body.tokens = overrides.tokens ?? 10;
  if (body.type === 'variable') { body.tokensPerUnit = overrides.tokensPerUnit ?? 5; body.unitLabel = overrides.unitLabel ?? 'rep'; }

  const { data: challenge } = await json<any>('POST', `/games/${game.id}/challenges`, body, hdr);
  await json('POST', `/games/${game.id}/start`, {}, hdr);

  return { game, team, challenge, hdr };
}

async function teardown(gameId: string, hdr: Record<string, string>) {
  await json('POST', `/games/${gameId}/end`, {}, hdr);
}

function connectAsPlayer(gameId: string, teamId: string, deviceId: string): Promise<Socket> {
  return new Promise((resolve) => {
    const socket = io(SOCKET);
    socket.on('connect', () => {
      socket.emit('game:join', { gameId, teamId, deviceId });
      // Wait for game:state before resolving so the test has a synced view
      socket.once('game:state', () => resolve(socket));
    });
  });
}

function emitAck<T>(socket: Socket, event: string, payload: any): Promise<T> {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

test.describe('Socket flows', () => {
  test('normal: accept → complete awards tokens', async () => {
    const { game, team, challenge, hdr } = await setupGame({ challengeType: 'normal', tokens: 25 });
    const s = await connectAsPlayer(game.id, team.id, 'dev-1');

    const accept: any = await emitAck(s, 'challenge:accept', { challengeId: challenge.id, teamId: team.id });
    expect(accept.ok).toBe(true);

    const complete: any = await emitAck(s, 'challenge:complete', { challengeId: challenge.id, teamId: team.id });
    expect(complete.ok).toBe(true);

    const { data: teams } = await json<any>('GET', `/games/${game.id}/teams`);
    const me = teams.find((t: any) => t.id === team.id);
    expect(me.tokens).toBe(50 + 25); // starting + award

    s.disconnect();
    await teardown(game.id, hdr);
  });

  test('variable: complete awards count * tokensPerUnit', async () => {
    const { game, team, challenge, hdr } = await setupGame({
      challengeType: 'variable', tokensPerUnit: 7, unitLabel: 'pushup',
    });
    const s = await connectAsPlayer(game.id, team.id, 'dev-2');

    const accept: any = await emitAck(s, 'challenge:accept', { challengeId: challenge.id, teamId: team.id });
    expect(accept.ok).toBe(true);

    const complete: any = await emitAck(s, 'challenge:complete', { challengeId: challenge.id, teamId: team.id, count: 6 });
    expect(complete.ok).toBe(true);

    const { data: teams } = await json<any>('GET', `/games/${game.id}/teams`);
    const me = teams.find((t: any) => t.id === team.id);
    expect(me.tokens).toBe(50 + 42);

    s.disconnect();
    await teardown(game.id, hdr);
  });

  test('variable: count < 1 → ack not ok', async () => {
    const { game, team, challenge, hdr } = await setupGame({ challengeType: 'variable' });
    const s = await connectAsPlayer(game.id, team.id, 'dev-3');

    await emitAck(s, 'challenge:accept', { challengeId: challenge.id, teamId: team.id });
    const complete: any = await emitAck(s, 'challenge:complete', { challengeId: challenge.id, teamId: team.id, count: 0 });
    expect(complete.ok).toBe(false);

    s.disconnect();
    await teardown(game.id, hdr);
  });

  test('wager: set → pass → +2× wager; wager lock-in blocks abandon', async () => {
    const { game, team, challenge, hdr } = await setupGame({ challengeType: 'wager' });
    const s = await connectAsPlayer(game.id, team.id, 'dev-4');

    const accept: any = await emitAck(s, 'challenge:accept', { challengeId: challenge.id, teamId: team.id });
    expect(accept.ok).toBe(true);

    const wager: any = await emitAck(s, 'challenge:wager', { challengeId: challenge.id, teamId: team.id, wagerAmount: 10 });
    expect(wager.ok).toBe(true);

    // Now abandon should fail (wager is locked)
    const abandon: any = await emitAck(s, 'challenge:abandon', { challengeId: challenge.id, teamId: team.id });
    expect(abandon.ok).toBe(false);

    const pass: any = await emitAck(s, 'challenge:complete', { challengeId: challenge.id, teamId: team.id });
    expect(pass.ok).toBe(true);

    const { data: teams } = await json<any>('GET', `/games/${game.id}/teams`);
    const me = teams.find((t: any) => t.id === team.id);
    expect(me.tokens).toBe(50 + 20); // starting + 2 × 10

    s.disconnect();
    await teardown(game.id, hdr);
  });

  test('wager: fail deducts wager, challenge stays active', async () => {
    const { game, team, challenge, hdr } = await setupGame({ challengeType: 'wager' });
    const s = await connectAsPlayer(game.id, team.id, 'dev-5');

    await emitAck(s, 'challenge:accept', { challengeId: challenge.id, teamId: team.id });
    await emitAck(s, 'challenge:wager', { challengeId: challenge.id, teamId: team.id, wagerAmount: 15 });

    const fail: any = await emitAck(s, 'challenge:fail', { challengeId: challenge.id, teamId: team.id });
    expect(fail.ok).toBe(true);

    const { data: teams } = await json<any>('GET', `/games/${game.id}/teams`);
    const me = teams.find((t: any) => t.id === team.id);
    expect(me.tokens).toBe(50 - 15);

    // Challenge should still be active
    const { data: ch } = await json<any>('GET', `/games/${game.id}/challenges`, undefined,
      { 'x-admin-code': game.adminCode });
    const stillActive = ch.find((c: any) => c.id === challenge.id);
    expect(stillActive.status).toBe('active');

    s.disconnect();
    await teardown(game.id, hdr);
  });

  test('team_busy: accepting a second challenge returns team_busy', async () => {
    const { game, team, challenge, hdr } = await setupGame({ challengeType: 'normal' });

    // Create a second challenge + restart the game? Can't — challenges are lobby-only.
    // Instead: same challenge, two accept emits.
    const s = await connectAsPlayer(game.id, team.id, 'dev-6');

    const first: any = await emitAck(s, 'challenge:accept', { challengeId: challenge.id, teamId: team.id });
    expect(first.ok).toBe(true);

    const second: any = await emitAck(s, 'challenge:accept', { challengeId: challenge.id, teamId: team.id });
    expect(second.ok).toBe(false);
    expect(second.reason).toBe('team_busy');

    s.disconnect();
    await teardown(game.id, hdr);
  });

  test('claim race: only one team wins, other gets yanked', async () => {
    // Setup: one challenge, two teams, both try to complete.
    const { data: game } = await json<any>('POST', '/games', {
      name: `Race ${Date.now()}`, durationMinutes: 60, activeChallengeCount: 3, challengeExpireMinutes: 10, startingTokens: 50,
    });
    const hdr = { 'x-admin-code': game.adminCode };
    const { data: teamA } = await json<any>('POST', `/games/${game.id}/teams`, { name: 'Alpha', color: '#e74c3c' });
    const { data: teamB } = await json<any>('POST', `/games/${game.id}/teams`, { name: 'Bravo', color: '#3498db' });
    const { data: challenge } = await json<any>('POST', `/games/${game.id}/challenges`,
      { name: 'Race', description: 'd', type: 'normal', tokens: 30, lat: 41.88, lng: -87.63 }, hdr);
    await json('POST', `/games/${game.id}/start`, {}, hdr);

    const sA = await connectAsPlayer(game.id, teamA.id, 'dev-a');
    const sB = await connectAsPlayer(game.id, teamB.id, 'dev-b');

    await emitAck(sA, 'challenge:accept', { challengeId: challenge.id, teamId: teamA.id });
    await emitAck(sB, 'challenge:accept', { challengeId: challenge.id, teamId: teamB.id });

    // Fire both completes roughly simultaneously
    const [ackA, ackB] = await Promise.all([
      emitAck(sA, 'challenge:complete', { challengeId: challenge.id, teamId: teamA.id }),
      emitAck(sB, 'challenge:complete', { challengeId: challenge.id, teamId: teamB.id }),
    ]);

    // Exactly one succeeds; the other either loses the atomic claim race
    // (challenge_unavailable) or gets cleared first by the winner's yank
    // broadcast and fails its defensive check (invalid_state). Either is fine.
    const results = [ackA, ackB] as any[];
    const wins   = results.filter((r) => r.ok);
    const losses = results.filter((r) =>
      !r.ok && (r.reason === 'challenge_unavailable' || r.reason === 'invalid_state'),
    );
    expect(wins.length).toBe(1);
    expect(losses.length).toBe(1);

    // And exactly one team actually gained tokens.
    const { data: teams } = await json<any>('GET', `/games/${game.id}/teams`);
    const winners = teams.filter((t: any) => t.tokens > 50);
    expect(winners.length).toBe(1);

    sA.disconnect();
    sB.disconnect();
    await teardown(game.id, hdr);
  });
});
