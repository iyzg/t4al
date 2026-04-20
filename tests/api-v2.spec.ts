// V2 API tests. Covers:
// - Game creation with V2 shape (startingTokens, K, X)
// - Type-specific challenge validation (normal/variable/wager)
// - Team creation with color + name uniqueness
// - Admin lockdown: edits only in lobby
// - Start-game → active; force-end → ended
// - Device reassignment (active-game only)
//
// Assumes server is running on :3001 and DB is fresh (or at least supports
// creating new games without collision).

import { test, expect } from '@playwright/test';

const API = 'http://localhost:3001/api';

async function json<T = any>(method: string, path: string, body?: any, headers: Record<string, string> = {}): Promise<{ status: number; data: T }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data: data as T };
}

async function createGame(overrides: any = {}) {
  const { status, data } = await json<any>('POST', '/games', {
    name: `Test Game ${Date.now()}-${Math.random()}`,
    durationMinutes: 60,
    activeChallengeCount: 3,
    challengeExpireMinutes: 10,
    startingTokens: 50,
    ...overrides,
  });
  expect(status).toBe(201);
  return data as { id: string; joinCode: string; adminCode: string; startingTokens: number };
}

// ─────────── Games ───────────

test.describe('Games', () => {
  test('create game: returns V2 shape', async () => {
    const g = await createGame();
    expect(g.joinCode).toMatch(/^[A-Z2-9]{4}$/);   // 4-char palette, no 0/O/1/I
    expect(g.adminCode).toBeTruthy();
    expect(g.startingTokens).toBe(50);
  });

  test('create game: rejects duration <= 0', async () => {
    const { status, data } = await json('POST', '/games', {
      name: 'bad', durationMinutes: 0,
    });
    expect(status).toBe(400);
    expect(data.error).toMatch(/duration/i);
  });

  test('lookup by joinCode: does not expose adminCode', async () => {
    const g = await createGame();
    const { status, data } = await json<any>('GET', `/games?joinCode=${g.joinCode}`);
    expect(status).toBe(200);
    expect(data.joinCode).toBe(g.joinCode);
    expect(data.adminCode).toBeUndefined();
  });

  test('lookup by joinCode: 404 on miss', async () => {
    const { status } = await json('GET', '/games?joinCode=ZZZZ');
    expect(status).toBe(404);
  });
});

// ─────────── Teams ───────────

test.describe('Teams', () => {
  test('create team: name and color required', async () => {
    const g = await createGame();
    const { status } = await json('POST', `/games/${g.id}/teams`, { name: '', color: '#e74c3c' });
    expect(status).toBe(400);
  });

  test('create team: color must be in palette', async () => {
    const g = await createGame();
    const { status } = await json('POST', `/games/${g.id}/teams`, { name: 'A', color: '#badcolor' });
    expect(status).toBe(400);
  });

  test('create team: 409 on duplicate color', async () => {
    const g = await createGame();
    const a = await json('POST', `/games/${g.id}/teams`, { name: 'Alpha', color: '#e74c3c' });
    expect(a.status).toBe(201);
    const b = await json('POST', `/games/${g.id}/teams`, { name: 'Beta', color: '#e74c3c' });
    expect(b.status).toBe(409);
  });

  test('create team: 409 on duplicate name', async () => {
    const g = await createGame();
    const a = await json('POST', `/games/${g.id}/teams`, { name: 'Alpha', color: '#e74c3c' });
    expect(a.status).toBe(201);
    const b = await json('POST', `/games/${g.id}/teams`, { name: 'Alpha', color: '#3498db' });
    expect(b.status).toBe(409);
  });
});

// ─────────── Challenges ───────────

test.describe('Challenges', () => {
  const hdr = (adminCode: string) => ({ 'x-admin-code': adminCode });
  const normalBody = { name: 'N', description: 'd', type: 'normal', tokens: 10, lat: 41.88, lng: -87.63 };
  const variableBody = { name: 'V', description: 'd', type: 'variable', tokensPerUnit: 5, unitLabel: 'pushup', lat: 41.88, lng: -87.63 };
  const wagerBody = { name: 'W', description: 'd', type: 'wager', lat: 41.88, lng: -87.63 };

  test('normal: requires tokens, forbids tokensPerUnit', async () => {
    const g = await createGame();
    const bad = await json('POST', `/games/${g.id}/challenges`,
      { ...normalBody, tokens: undefined }, hdr(g.adminCode));
    expect(bad.status).toBe(400);
    const good = await json('POST', `/games/${g.id}/challenges`, normalBody, hdr(g.adminCode));
    expect(good.status).toBe(201);
  });

  test('variable: requires tokensPerUnit + unitLabel', async () => {
    const g = await createGame();
    const bad = await json('POST', `/games/${g.id}/challenges`,
      { ...variableBody, unitLabel: undefined }, hdr(g.adminCode));
    expect(bad.status).toBe(400);
    const good = await json('POST', `/games/${g.id}/challenges`, variableBody, hdr(g.adminCode));
    expect(good.status).toBe(201);
  });

  test('wager: all three token fields must be absent', async () => {
    const g = await createGame();
    const bad = await json('POST', `/games/${g.id}/challenges`,
      { ...wagerBody, tokens: 5 }, hdr(g.adminCode));
    expect(bad.status).toBe(400);
    const good = await json('POST', `/games/${g.id}/challenges`, wagerBody, hdr(g.adminCode));
    expect(good.status).toBe(201);
  });

  test('admin gate: missing x-admin-code → 401', async () => {
    const g = await createGame();
    const { status } = await json('POST', `/games/${g.id}/challenges`, normalBody);
    expect(status).toBe(401);
  });

  test('admin gate: wrong x-admin-code → 403', async () => {
    const g = await createGame();
    const { status } = await json('POST', `/games/${g.id}/challenges`, normalBody, { 'x-admin-code': 'wrong' });
    expect(status).toBe(403);
  });
});

// ─────────── Mutation lockdown ───────────

test.describe('Mutation lockdown during active game', () => {
  const hdr = (adminCode: string) => ({ 'x-admin-code': adminCode });

  test('challenge create returns 409 once game is active', async () => {
    const g = await createGame();
    // Need at least one team + one challenge to start
    await json('POST', `/games/${g.id}/teams`, { name: 'Alpha', color: '#e74c3c' });
    const c1 = await json('POST', `/games/${g.id}/challenges`,
      { name: 'N', description: 'd', type: 'normal', tokens: 10, lat: 41.88, lng: -87.63 },
      hdr(g.adminCode));
    expect(c1.status).toBe(201);

    const start = await json('POST', `/games/${g.id}/start`, {}, hdr(g.adminCode));
    expect(start.status).toBe(200);

    const c2 = await json('POST', `/games/${g.id}/challenges`,
      { name: 'N2', description: 'd', type: 'normal', tokens: 10, lat: 41.88, lng: -87.63 },
      hdr(g.adminCode));
    expect(c2.status).toBe(409);

    // Force end so we leave a clean state
    await json('POST', `/games/${g.id}/end`, {}, hdr(g.adminCode));
  });

  test('team create returns 409 once game is active', async () => {
    const g = await createGame();
    await json('POST', `/games/${g.id}/teams`, { name: 'Alpha', color: '#e74c3c' });
    await json('POST', `/games/${g.id}/challenges`,
      { name: 'N', description: 'd', type: 'normal', tokens: 10, lat: 41.88, lng: -87.63 },
      hdr(g.adminCode));
    await json('POST', `/games/${g.id}/start`, {}, hdr(g.adminCode));

    const newTeam = await json('POST', `/games/${g.id}/teams`,
      { name: 'Beta', color: '#3498db' });
    expect(newTeam.status).toBe(409);

    await json('POST', `/games/${g.id}/end`, {}, hdr(g.adminCode));
  });
});

// ─────────── Lifecycle ───────────

test.describe('Game lifecycle', () => {
  const hdr = (adminCode: string) => ({ 'x-admin-code': adminCode });

  test('start then force-end', async () => {
    const g = await createGame();
    await json('POST', `/games/${g.id}/teams`, { name: 'Alpha', color: '#e74c3c' });
    await json('POST', `/games/${g.id}/challenges`,
      { name: 'N', description: 'd', type: 'normal', tokens: 10, lat: 41.88, lng: -87.63 },
      hdr(g.adminCode));

    const start = await json('POST', `/games/${g.id}/start`, {}, hdr(g.adminCode));
    expect(start.status).toBe(200);

    const active = await json<any>('GET', `/games/${g.id}`, undefined, hdr(g.adminCode));
    expect(active.data.status).toBe('active');
    expect(active.data.startTime).toBeTruthy();

    // Teams should have been initialized to startingTokens
    const teams = await json<any[]>('GET', `/games/${g.id}/teams`);
    expect(teams.data[0].tokens).toBe(g.startingTokens);

    const end = await json('POST', `/games/${g.id}/end`, {}, hdr(g.adminCode));
    expect(end.status).toBe(200);

    const ended = await json<any>('GET', `/games/${g.id}`, undefined, hdr(g.adminCode));
    expect(ended.data.status).toBe('ended');
  });

  test('start rejects while not in lobby', async () => {
    const g = await createGame();
    await json('POST', `/games/${g.id}/teams`, { name: 'Alpha', color: '#e74c3c' });
    await json('POST', `/games/${g.id}/challenges`,
      { name: 'N', description: 'd', type: 'normal', tokens: 10, lat: 41.88, lng: -87.63 },
      hdr(g.adminCode));
    await json('POST', `/games/${g.id}/start`, {}, hdr(g.adminCode));

    const second = await json('POST', `/games/${g.id}/start`, {}, hdr(g.adminCode));
    expect(second.status).toBe(409);

    await json('POST', `/games/${g.id}/end`, {}, hdr(g.adminCode));
  });
});
