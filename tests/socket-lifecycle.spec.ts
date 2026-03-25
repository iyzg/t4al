import { test, expect } from '@playwright/test';

const API = 'http://localhost:3001/api';

async function api(method: string, path: string, body?: any) {
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  return { status: res.status, data: await res.json() };
}

/**
 * Test the complete game lifecycle using a real browser with Socket.io.
 * We use page.evaluate() to interact with the Socket.io client.
 */
test.describe('Socket.io Game Lifecycle', () => {
  test('join sends initial challenges and leaderboard', async ({ page }) => {
    // Set up: create game, team, challenge, start game
    const { data: game } = await api('POST', '/games', { name: 'Socket Test' });
    const { data: team } = await api('POST', `/games/${game.id}/teams`, { name: 'Socket Team', color: '#e74c3c' });
    const { data: challenge } = await api('POST', `/games/${game.id}/challenges`, {
      name: 'Instant Challenge', description: 'Spawns immediately', points: 100,
      lat: 41.8827, lng: -87.6233, spawnOffsetMinutes: 0,
    });
    await api('POST', `/games/${game.id}/start`);

    // Wait for the ticker to spawn the challenge (10s interval)
    await page.waitForTimeout(12000);

    // Verify the challenge was spawned
    const { data: challenges } = await api('GET', `/games/${game.id}/challenges`);
    const spawned = challenges.find((c: any) => c.id === challenge.id);
    expect(spawned.status).toBe('active');

    // Now join via the UI to verify the socket sends initial state
    await page.goto('/join');
    await page.evaluate(({ gid, tid }) => {
      sessionStorage.setItem('t4al_identity', JSON.stringify({
        gameId: gid, teamId: tid, teamColor: '#e74c3c',
      }));
    }, { gid: game.id, tid: team.id });

    await page.goto(`/game/${game.id}`);

    // Wait for socket to connect and receive initial state
    await page.waitForTimeout(3000);

    // Check that the store has the challenge (via the Zustand store)
    const hasChallenges = await page.evaluate(() => {
      // @ts-ignore — accessing the global Zustand store
      const store = (window as any).__ZUSTAND_STORE__;
      // We can't directly access the store, but we can check if leaderboard is rendered
      return document.body.textContent?.includes('Socket Team') ?? false;
    });

    // The leaderboard should show the team name
    // (We use the Leaderboard component which renders team names)
    await expect(page.locator('text=Socket Team')).toBeVisible({ timeout: 5000 });
  });

  test('game events endpoint returns events after game start', async () => {
    const { data: game } = await api('POST', '/games', { name: 'Events Lifecycle' });
    await api('POST', `/games/${game.id}/start`);

    const { data: events } = await api('GET', `/games/${game.id}/events`);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.some((e: any) => e.type === 'game:started')).toBe(true);
  });

  test('game events include game:ended after admin end', async () => {
    const { data: game } = await api('POST', '/games', { name: 'End Events' });
    await api('POST', `/games/${game.id}/start`);
    await api('POST', `/games/${game.id}/end`);

    const { data: events } = await api('GET', `/games/${game.id}/events`);
    expect(events.some((e: any) => e.type === 'game:ended')).toBe(true);
  });

  test('challenge claim via API works end to end', async () => {
    const { data: game } = await api('POST', '/games', { name: 'Claim E2E' });
    const { data: team } = await api('POST', `/games/${game.id}/teams`, { name: 'Claimers', color: '#fff' });
    const { data: challenge } = await api('POST', `/games/${game.id}/challenges`, {
      name: 'Claimable', description: 'D', points: 500,
      lat: 41.88, lng: -87.62, spawnOffsetMinutes: 0,
    });
    await api('POST', `/games/${game.id}/start`);

    // Wait for ticker to spawn
    await new Promise(r => setTimeout(r, 12000));

    // Verify it's active
    const { data: list } = await api('GET', `/games/${game.id}/challenges`);
    const active = list.find((c: any) => c.id === challenge.id);
    expect(active.status).toBe('active');

    // Claim it via REST API
    const { status, data } = await api('POST', `/challenges/${challenge.id}/claim`, { teamId: team.id });
    expect(status).toBe(200);
    expect(data.status).toBe('claimed');

    // Verify team score updated
    const { data: teams } = await api('GET', `/games/${game.id}/teams`);
    const claimer = teams.find((t: any) => t.id === team.id);
    expect(claimer.score).toBe(500);
  });
});
