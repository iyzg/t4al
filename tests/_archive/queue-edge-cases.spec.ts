import { test, expect } from '@playwright/test';
import { io as ioClient } from 'socket.io-client';

const API = 'http://localhost:3001/api';
const WS = 'http://localhost:3001';

async function api(method: string, path: string, body?: any) {
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  return { status: res.status, data: await res.json() };
}

function connectSocket() {
  return ioClient(WS, { transports: ['websocket'] });
}

test.describe('Queue Edge Cases - Claiming', () => {
  test('claiming a challenge clears other teams active challenge and notifies', async () => {
    const { data: game } = await api('POST', '/games', {
      name: 'Multi-team Claim', activeChallengeCount: 1, challengeExpireMinutes: 10,
    });
    const { data: team1 } = await api('POST', `/games/${game.id}/teams`, { name: 'Fast', color: '#e74c3c' });
    const { data: team2 } = await api('POST', `/games/${game.id}/teams`, { name: 'Slow', color: '#3498db' });
    const { data: challenge } = await api('POST', `/games/${game.id}/challenges`, {
      name: 'Race', description: 'D', points: 100, lat: 41.88, lng: -87.62, sortOrder: 1,
    });
    await api('POST', `/games/${game.id}/start`);
    await new Promise(r => setTimeout(r, 12000));

    const socket1 = connectSocket();
    const socket2 = connectSocket();

    // Both join
    await Promise.all([
      new Promise<void>((r) => { socket1.on('game:state', () => r()); socket1.emit('game:join', { gameId: game.id, teamId: team1.id }); }),
      new Promise<void>((r) => { socket2.on('game:state', () => r()); socket2.emit('game:join', { gameId: game.id, teamId: team2.id }); }),
    ]);

    // Both activate the same challenge
    socket1.emit('challenge:activate', { challengeId: challenge.id, teamId: team1.id });
    await new Promise(r => setTimeout(r, 500));
    socket2.emit('challenge:activate', { challengeId: challenge.id, teamId: team2.id });
    await new Promise(r => setTimeout(r, 500));

    // team2's activate should fail (already has one... actually team2 can activate since
    // their active_challenge_id is NULL, but the challenge is the same one team1 has)
    // Both teams can activate the same challenge independently

    // Team 1 completes
    const claimedPromise = new Promise<any>((resolve) => {
      socket2.on('challenge:claimed', (data: any) => resolve(data));
    });
    socket1.emit('challenge:complete', { challengeId: challenge.id, teamId: team1.id });

    const claimed = await claimedPromise;
    expect(claimed.challengeId).toBe(challenge.id);
    expect(claimed.claimedByTeamId).toBe(team1.id);

    // Verify team2's active challenge was cleared
    await new Promise(r => setTimeout(r, 500));
    const { data: teams } = await api('GET', `/games/${game.id}/teams`);
    const t2 = teams.find((t: any) => t.id === team2.id);
    expect(t2.active_challenge_id).toBeNull();

    socket1.disconnect();
    socket2.disconnect();
  });

  test('cannot activate a challenge that has been claimed', async () => {
    const { data: game } = await api('POST', '/games', {
      name: 'Claimed Activate', activeChallengeCount: 1, challengeExpireMinutes: 10,
    });
    const { data: team1 } = await api('POST', `/games/${game.id}/teams`, { name: 'Winner', color: '#e74c3c' });
    const { data: team2 } = await api('POST', `/games/${game.id}/teams`, { name: 'Late', color: '#3498db' });
    const { data: challenge } = await api('POST', `/games/${game.id}/challenges`, {
      name: 'Gone', description: 'D', points: 100, lat: 41.88, lng: -87.62, sortOrder: 1,
    });
    await api('POST', `/games/${game.id}/start`);
    await new Promise(r => setTimeout(r, 12000));

    // Claim via REST
    await api('POST', `/challenges/${challenge.id}/claim`, { teamId: team1.id });

    // Try to activate via socket — should fail
    const socket = connectSocket();
    await new Promise<void>((r) => { socket.on('game:state', () => r()); socket.emit('game:join', { gameId: game.id, teamId: team2.id }); });

    const failPromise = new Promise<any>((resolve) => {
      socket.on('complete:failed', (data: any) => resolve(data));
    });

    socket.emit('challenge:activate', { challengeId: challenge.id, teamId: team2.id });
    const failed = await failPromise;
    expect(failed.reason).toBe('not_active');

    socket.disconnect();
  });
});

test.describe('Queue Edge Cases - Game End', () => {
  test('ending a game does not crash with active challenges', async () => {
    const { data: game } = await api('POST', '/games', {
      name: 'End With Active', activeChallengeCount: 2, challengeExpireMinutes: 10,
    });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'C1', description: 'D', points: 100, lat: 41.88, lng: -87.62, sortOrder: 1,
    });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'C2', description: 'D', points: 200, lat: 41.881, lng: -87.621, sortOrder: 2,
    });
    await api('POST', `/games/${game.id}/start`);
    await new Promise(r => setTimeout(r, 12000));

    // Verify challenges are active
    const { data: before } = await api('GET', `/games/${game.id}/challenges`);
    const activeBefore = before.filter((c: any) => c.status === 'active');
    expect(activeBefore.length).toBe(2);

    // End the game — should not error
    const { status } = await api('POST', `/games/${game.id}/end`);
    expect(status).toBe(200);

    // Challenges should still have their status (not crashed)
    const { data: after } = await api('GET', `/games/${game.id}/challenges`);
    expect(after.length).toBe(2);
  });

  test('ended game stops advancing the queue', async () => {
    const { data: game } = await api('POST', '/games', {
      name: 'Ended Queue', activeChallengeCount: 1, challengeExpireMinutes: 10,
    });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'C1', description: 'D', points: 100, lat: 41.88, lng: -87.62, sortOrder: 1,
    });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'C2', description: 'D', points: 200, lat: 41.881, lng: -87.621, sortOrder: 2,
    });
    await api('POST', `/games/${game.id}/start`);
    await new Promise(r => setTimeout(r, 12000));

    // End the game
    await api('POST', `/games/${game.id}/end`);

    // Wait to see if ticker advances the queue (it shouldn't)
    await new Promise(r => setTimeout(r, 12000));

    const { data: challenges } = await api('GET', `/games/${game.id}/challenges`);
    const active = challenges.filter((c: any) => c.status === 'active');
    const queued = challenges.filter((c: any) => c.status === 'queued');

    // Only 1 should have activated before game ended
    expect(active.length).toBe(1);
    expect(queued.length).toBe(1); // second never activated
  });
});

test.describe('Queue Edge Cases - Concurrent Operations', () => {
  test('two teams completing the same challenge - only one succeeds', async () => {
    const { data: game } = await api('POST', '/games', {
      name: 'Race Condition', activeChallengeCount: 1, challengeExpireMinutes: 10,
    });
    const { data: team1 } = await api('POST', `/games/${game.id}/teams`, { name: 'Fast', color: '#e74c3c' });
    const { data: team2 } = await api('POST', `/games/${game.id}/teams`, { name: 'Also Fast', color: '#3498db' });
    const { data: challenge } = await api('POST', `/games/${game.id}/challenges`, {
      name: 'Only One', description: 'D', points: 500, lat: 41.88, lng: -87.62, sortOrder: 1,
    });
    await api('POST', `/games/${game.id}/start`);
    await new Promise(r => setTimeout(r, 12000));

    // Both try to claim simultaneously
    const [r1, r2] = await Promise.all([
      api('POST', `/challenges/${challenge.id}/claim`, { teamId: team1.id }),
      api('POST', `/challenges/${challenge.id}/claim`, { teamId: team2.id }),
    ]);

    // Exactly one should succeed
    const successes = [r1.status, r2.status].filter(s => s === 200).length;
    const failures = [r1.status, r2.status].filter(s => s === 400).length;
    expect(successes).toBe(1);
    expect(failures).toBe(1);

    // Only one team should have points
    const { data: teams } = await api('GET', `/games/${game.id}/teams`);
    const scored = teams.filter((t: any) => t.score > 0);
    expect(scored.length).toBe(1);
    expect(scored[0].score).toBe(500);
  });
});

test.describe('Player Game Page - Queue Integration', () => {
  test('game page shows waiting message before game starts', async ({ page }) => {
    const { data: game } = await api('POST', '/games', { name: 'Waiting UI' });
    const { data: team } = await api('POST', `/games/${game.id}/teams`, { name: 'Waiter', color: '#e74c3c' });

    // Set session identity
    await page.goto('/');
    await page.evaluate((identity) => {
      sessionStorage.setItem('t4al_identity', JSON.stringify(identity));
    }, { gameId: game.id, teamId: team.id, teamColor: '#e74c3c' });

    await page.goto(`/game/${game.id}`);
    await expect(page.locator('text=Waiting for game to start')).toBeVisible({ timeout: 10000 });
  });

  test('leaderboard is always visible (no mode hiding)', async ({ page }) => {
    const { data: game } = await api('POST', '/games', { name: 'Leaderboard Visible' });
    const { data: team1 } = await api('POST', `/games/${game.id}/teams`, { name: 'Scorer', color: '#e74c3c' });
    const { data: team2 } = await api('POST', `/games/${game.id}/teams`, { name: 'Other', color: '#3498db' });
    await api('POST', `/games/${game.id}/start`);

    await page.goto('/');
    await page.evaluate((identity) => {
      sessionStorage.setItem('t4al_identity', JSON.stringify(identity));
    }, { gameId: game.id, teamId: team1.id, teamColor: '#e74c3c' });

    await page.goto(`/game/${game.id}`);
    await expect(page.locator('text=Leaderboard')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Scorer')).toBeVisible();
    await expect(page.locator('text=Other')).toBeVisible();
  });

  test('no mode banner shown', async ({ page }) => {
    const { data: game } = await api('POST', '/games', { name: 'No Banner' });
    const { data: team } = await api('POST', `/games/${game.id}/teams`, { name: 'Player', color: '#e74c3c' });
    await api('POST', `/games/${game.id}/start`);

    await page.goto('/');
    await page.evaluate((identity) => {
      sessionStorage.setItem('t4al_identity', JSON.stringify(identity));
    }, { gameId: game.id, teamId: team.id, teamColor: '#e74c3c' });

    await page.goto(`/game/${game.id}`);
    await page.waitForTimeout(2000);

    // No BLACKOUT banner or any mode banner
    const bannerCount = await page.locator('text=BLACKOUT').count();
    expect(bannerCount).toBe(0);
  });
});
