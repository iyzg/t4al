import { test, expect } from '@playwright/test';

const API = 'http://localhost:3001/api';

async function api(method: string, path: string, body?: any) {
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  return { status: res.status, data: await res.json() };
}

test.describe('Admin Event Log - Queue Events', () => {
  test('game:started event logged when game starts', async () => {
    const { data: game } = await api('POST', '/games', { name: 'Event Start' });
    await api('POST', `/games/${game.id}/start`);

    const { data: events } = await api('GET', `/games/${game.id}/events`);
    expect(events.some((e: any) => e.type === 'game:started')).toBe(true);
  });

  test('challenge:spawned events logged when challenges activate', async () => {
    const { data: game } = await api('POST', '/games', {
      name: 'Event Spawn', activeChallengeCount: 2, challengeExpireMinutes: 10,
    });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'C1', description: 'D', points: 100, lat: 41.88, lng: -87.62, sortOrder: 1,
    });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'C2', description: 'D', points: 200, lat: 41.881, lng: -87.621, sortOrder: 2,
    });
    await api('POST', `/games/${game.id}/start`);
    await new Promise(r => setTimeout(r, 12000));

    const { data: events } = await api('GET', `/games/${game.id}/events`);
    const spawnEvents = events.filter((e: any) => e.type === 'challenge:spawned');
    expect(spawnEvents.length).toBe(2);
    // Each spawn event should have name and points in payload
    for (const e of spawnEvents) {
      expect(e.payload.name).toBeTruthy();
      expect(e.payload.points).toBeGreaterThan(0);
    }
  });

  test('challenge:claimed event logged with correct data', async () => {
    const { data: game } = await api('POST', '/games', {
      name: 'Event Claim', activeChallengeCount: 1, challengeExpireMinutes: 10,
    });
    const { data: team } = await api('POST', `/games/${game.id}/teams`, { name: 'Claimer', color: '#e74c3c' });
    const { data: challenge } = await api('POST', `/games/${game.id}/challenges`, {
      name: 'Claim Event', description: 'D', points: 777, lat: 41.88, lng: -87.62, sortOrder: 1,
    });
    await api('POST', `/games/${game.id}/start`);
    await new Promise(r => setTimeout(r, 12000));
    await api('POST', `/challenges/${challenge.id}/claim`, { teamId: team.id });

    const { data: events } = await api('GET', `/games/${game.id}/events`);
    const claimEvent = events.find((e: any) => e.type === 'challenge:claimed');
    expect(claimEvent).toBeDefined();
    expect(claimEvent.payload.points).toBe(777);
    expect(claimEvent.payload.challengeName).toBe('Claim Event');
    expect(claimEvent.payload.teamName).toBe('Claimer');
  });

  test('game:ended event logged when admin ends game', async () => {
    const { data: game } = await api('POST', '/games', { name: 'Event End' });
    await api('POST', `/games/${game.id}/start`);
    await api('POST', `/games/${game.id}/end`);

    const { data: events } = await api('GET', `/games/${game.id}/events`);
    const endEvent = events.find((e: any) => e.type === 'game:ended');
    expect(endEvent).toBeDefined();
    expect(endEvent.payload.reason).toBe('admin');
  });

  test('events display correctly in admin panel UI', async ({ page }) => {
    const { data: game } = await api('POST', '/games', {
      name: 'Event Display', activeChallengeCount: 1, challengeExpireMinutes: 10,
    });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'Display Challenge', description: 'D', points: 100, lat: 41.88, lng: -87.62, sortOrder: 1,
    });
    await api('POST', `/games/${game.id}/start`);
    await new Promise(r => setTimeout(r, 12000));

    await page.goto(`/game/${game.id}/admin`);

    // Should show formatted events
    await expect(page.locator('text=Game started')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=spawned')).toBeVisible({ timeout: 5000 });
  });
});
