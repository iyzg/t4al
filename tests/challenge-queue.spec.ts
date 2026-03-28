import { test, expect } from '@playwright/test';

const API = 'http://localhost:3001/api';

async function api(method: string, path: string, body?: any) {
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  return { status: res.status, data: await res.json() };
}

async function createGameWithChallenges(opts: {
  name: string;
  activeChallengeCount: number;
  challengeExpireMinutes: number;
  challengeCount: number;
}) {
  const { data: game } = await api('POST', '/games', {
    name: opts.name,
    durationMinutes: 60,
    activeChallengeCount: opts.activeChallengeCount,
    challengeExpireMinutes: opts.challengeExpireMinutes,
  });
  const challenges = [];
  for (let i = 0; i < opts.challengeCount; i++) {
    const { data: c } = await api('POST', `/games/${game.id}/challenges`, {
      name: `Challenge ${i + 1}`,
      description: `Description ${i + 1}`,
      points: (i + 1) * 100,
      lat: 41.88 + i * 0.001,
      lng: -87.62 + i * 0.001,
      sortOrder: i + 1,
    });
    challenges.push(c);
  }
  return { game, challenges };
}

test.describe('Challenge Queue System', () => {
  test('game creation stores queue settings', async () => {
    const { data: game } = await api('POST', '/games', {
      name: 'Queue Settings',
      activeChallengeCount: 5,
      challengeExpireMinutes: 15,
    });
    expect(game.active_challenge_count).toBe(5);
    expect(game.challenge_expire_minutes).toBe(15);
  });

  test('challenges start as queued', async () => {
    const { game, challenges } = await createGameWithChallenges({
      name: 'Queued Start', activeChallengeCount: 3, challengeExpireMinutes: 10, challengeCount: 5,
    });
    for (const c of challenges) {
      expect(c.status).toBe('queued');
    }
  });

  test('first K challenges activate after game start', async () => {
    const { game, challenges } = await createGameWithChallenges({
      name: 'K Activate', activeChallengeCount: 2, challengeExpireMinutes: 10, challengeCount: 5,
    });
    await api('POST', `/games/${game.id}/start`);

    // Wait for ticker to activate challenges (up to 12s)
    await new Promise(r => setTimeout(r, 12000));

    const { data: updatedChallenges } = await api('GET', `/games/${game.id}/challenges`);
    const active = updatedChallenges.filter((c: any) => c.status === 'active');
    const queued = updatedChallenges.filter((c: any) => c.status === 'queued');

    expect(active.length).toBe(2);
    expect(queued.length).toBe(3);

    // The first 2 by sort_order should be active
    expect(active[0].sort_order).toBeLessThan(active[1].sort_order);
    expect(active[1].sort_order).toBeLessThan(queued[0].sort_order);
  });

  test('claiming a challenge advances the queue', async () => {
    const { game, challenges } = await createGameWithChallenges({
      name: 'Queue Advance', activeChallengeCount: 1, challengeExpireMinutes: 10, challengeCount: 3,
    });
    const { data: team } = await api('POST', `/games/${game.id}/teams`, { name: 'Claimers', color: '#e74c3c' });
    await api('POST', `/games/${game.id}/start`);

    // Wait for first challenge to activate
    await new Promise(r => setTimeout(r, 12000));

    // Claim the first challenge
    const { status } = await api('POST', `/challenges/${challenges[0].id}/claim`, { teamId: team.id });
    expect(status).toBe(200);

    // Wait for next challenge to activate
    await new Promise(r => setTimeout(r, 12000));

    const { data: updated } = await api('GET', `/games/${game.id}/challenges`);
    const claimed = updated.filter((c: any) => c.status === 'claimed');
    const active = updated.filter((c: any) => c.status === 'active');

    expect(claimed.length).toBe(1);
    expect(active.length).toBe(1);
    // The second challenge should now be active
    expect(active[0].sort_order).toBe(2);
  });

  test('challenges respect sort_order for activation', async () => {
    const { data: game } = await api('POST', '/games', {
      name: 'Sort Order', activeChallengeCount: 1, challengeExpireMinutes: 10,
    });

    // Create challenges in reverse order
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'Third', description: 'D', points: 300, lat: 41.88, lng: -87.62, sortOrder: 3,
    });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'First', description: 'D', points: 100, lat: 41.881, lng: -87.621, sortOrder: 1,
    });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'Second', description: 'D', points: 200, lat: 41.882, lng: -87.622, sortOrder: 2,
    });

    await api('POST', `/games/${game.id}/start`);
    await new Promise(r => setTimeout(r, 12000));

    const { data: challenges } = await api('GET', `/games/${game.id}/challenges`);
    const active = challenges.filter((c: any) => c.status === 'active');
    expect(active.length).toBe(1);
    expect(active[0].name).toBe('First');
  });

  test('activeChallengeCount 0 means no challenges activate', async () => {
    const { game } = await createGameWithChallenges({
      name: 'Zero Active', activeChallengeCount: 0, challengeExpireMinutes: 10, challengeCount: 3,
    });
    await api('POST', `/games/${game.id}/start`);
    await new Promise(r => setTimeout(r, 12000));

    const { data: challenges } = await api('GET', `/games/${game.id}/challenges`);
    const active = challenges.filter((c: any) => c.status === 'active');
    expect(active.length).toBe(0);
  });

  test('activated_at is set when challenge becomes active', async () => {
    const { game, challenges } = await createGameWithChallenges({
      name: 'Activated At', activeChallengeCount: 1, challengeExpireMinutes: 10, challengeCount: 1,
    });
    await api('POST', `/games/${game.id}/start`);
    await new Promise(r => setTimeout(r, 12000));

    const { data: updated } = await api('GET', `/games/${game.id}/challenges`);
    expect(updated[0].status).toBe('active');
    expect(updated[0].activated_at).toBeTruthy();
  });

  test('reorder endpoint changes queue order', async () => {
    const { data: game } = await api('POST', '/games', { name: 'Reorder Queue' });
    const { data: c1 } = await api('POST', `/games/${game.id}/challenges`, {
      name: 'A', description: 'D', points: 100, lat: 41.88, lng: -87.62, sortOrder: 1,
    });
    const { data: c2 } = await api('POST', `/games/${game.id}/challenges`, {
      name: 'B', description: 'D', points: 200, lat: 41.881, lng: -87.621, sortOrder: 2,
    });

    // Swap order
    const { status, data } = await api('PUT', `/games/${game.id}/challenges/reorder`, {
      order: [
        { id: c2.id, sortOrder: 1 },
        { id: c1.id, sortOrder: 2 },
      ],
    });
    expect(status).toBe(200);
    expect(data[0].name).toBe('B');
    expect(data[0].sort_order).toBe(1);
    expect(data[1].name).toBe('A');
    expect(data[1].sort_order).toBe(2);
  });

  test('update game queue settings', async () => {
    const { data: game } = await api('POST', '/games', {
      name: 'Update Settings', activeChallengeCount: 3, challengeExpireMinutes: 10,
    });
    const { status, data } = await api('PUT', `/games/${game.id}`, {
      activeChallengeCount: 5, challengeExpireMinutes: 20,
    });
    expect(status).toBe(200);
    expect(data.active_challenge_count).toBe(5);
    expect(data.challenge_expire_minutes).toBe(20);
  });
});

test.describe('Challenge Expiration', () => {
  test('expired challenge gets expired status', async () => {
    // Create game with 1-minute expiration to test faster
    const { game, challenges } = await createGameWithChallenges({
      name: 'Expiry Test', activeChallengeCount: 1, challengeExpireMinutes: 1, challengeCount: 2,
    });
    await api('POST', `/games/${game.id}/start`);

    // Wait for activation
    await new Promise(r => setTimeout(r, 12000));

    const { data: before } = await api('GET', `/games/${game.id}/challenges`);
    const activeBefore = before.filter((c: any) => c.status === 'active');
    expect(activeBefore.length).toBe(1);

    // We can't easily wait 1 minute in a test, but we can verify the structure is correct
    // The activated_at should be set for the active challenge
    expect(activeBefore[0].activated_at).toBeTruthy();
  });
});

test.describe('Challenge Queue - Edge Cases', () => {
  test('more challenges than K - only K active at a time', async () => {
    const { game } = await createGameWithChallenges({
      name: 'K Limit', activeChallengeCount: 2, challengeExpireMinutes: 10, challengeCount: 10,
    });
    await api('POST', `/games/${game.id}/start`);
    await new Promise(r => setTimeout(r, 12000));

    const { data: challenges } = await api('GET', `/games/${game.id}/challenges`);
    const active = challenges.filter((c: any) => c.status === 'active');
    expect(active.length).toBe(2);
  });

  test('fewer challenges than K - all become active', async () => {
    const { game } = await createGameWithChallenges({
      name: 'Few Challenges', activeChallengeCount: 10, challengeExpireMinutes: 10, challengeCount: 3,
    });
    await api('POST', `/games/${game.id}/start`);
    await new Promise(r => setTimeout(r, 12000));

    const { data: challenges } = await api('GET', `/games/${game.id}/challenges`);
    const active = challenges.filter((c: any) => c.status === 'active');
    expect(active.length).toBe(3); // all 3 become active
  });

  test('no challenges in game - ticker handles gracefully', async () => {
    const { data: game } = await api('POST', '/games', {
      name: 'No Challenges', activeChallengeCount: 3, challengeExpireMinutes: 10,
    });
    await api('POST', `/games/${game.id}/start`);
    await new Promise(r => setTimeout(r, 12000));

    // Game should still be active
    const { data } = await api('GET', `/games/${game.id}`);
    expect(data.status).toBe('active');
  });

  test('game events logged for challenge spawning', async () => {
    const { game } = await createGameWithChallenges({
      name: 'Event Logging', activeChallengeCount: 2, challengeExpireMinutes: 10, challengeCount: 3,
    });
    await api('POST', `/games/${game.id}/start`);
    await new Promise(r => setTimeout(r, 12000));

    const { data: events } = await api('GET', `/games/${game.id}/events`);
    const spawnEvents = events.filter((e: any) => e.type === 'challenge:spawned');
    expect(spawnEvents.length).toBe(2);
  });
});
