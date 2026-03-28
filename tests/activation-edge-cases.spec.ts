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

test.describe('Activation Edge Cases', () => {
  test('team cannot activate two challenges simultaneously', async () => {
    const { data: game } = await api('POST', '/games', {
      name: 'Double Activate', activeChallengeCount: 2, challengeExpireMinutes: 10,
    });
    const { data: team } = await api('POST', `/games/${game.id}/teams`, { name: 'Greedy', color: '#e74c3c' });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'C1', description: 'D', points: 100, lat: 41.88, lng: -87.62, sortOrder: 1,
    });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'C2', description: 'D', points: 200, lat: 41.881, lng: -87.621, sortOrder: 2,
    });
    await api('POST', `/games/${game.id}/start`);
    await new Promise(r => setTimeout(r, 12000));

    const socket = connectSocket();
    await new Promise<void>((r) => { socket.on('game:state', () => r()); socket.emit('game:join', { gameId: game.id, teamId: team.id }); });

    const { data: challenges } = await api('GET', `/games/${game.id}/challenges`);
    const active = challenges.filter((c: any) => c.status === 'active');

    // Activate first challenge
    socket.emit('challenge:activate', { challengeId: active[0].id, teamId: team.id });
    await new Promise(r => setTimeout(r, 500));

    // Try to activate second — should fail (team already has active challenge)
    const failPromise = new Promise<any>((resolve) => {
      socket.on('complete:failed', (data: any) => resolve(data));
    });
    socket.emit('challenge:activate', { challengeId: active[1].id, teamId: team.id });

    const failed = await failPromise;
    expect(failed.reason).toBe('not_active');

    // Verify team only has one active challenge
    const { data: teams } = await api('GET', `/games/${game.id}/teams`);
    const t = teams.find((t: any) => t.id === team.id);
    expect(t.active_challenge_id).toBe(active[0].id);

    socket.disconnect();
  });

  test('cannot complete a challenge the team has not activated', async () => {
    const { data: game } = await api('POST', '/games', {
      name: 'No Active Complete', activeChallengeCount: 1, challengeExpireMinutes: 10,
    });
    const { data: team } = await api('POST', `/games/${game.id}/teams`, { name: 'Cheater', color: '#e74c3c' });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'Not Mine', description: 'D', points: 100, lat: 41.88, lng: -87.62, sortOrder: 1,
    });
    await api('POST', `/games/${game.id}/start`);
    await new Promise(r => setTimeout(r, 12000));

    const socket = connectSocket();
    await new Promise<void>((r) => { socket.on('game:state', () => r()); socket.emit('game:join', { gameId: game.id, teamId: team.id }); });

    const { data: challenges } = await api('GET', `/games/${game.id}/challenges`);

    // Try to complete without activating
    const failPromise = new Promise<any>((resolve) => {
      socket.on('complete:failed', (data: any) => resolve(data));
    });
    socket.emit('challenge:complete', { challengeId: challenges[0].id, teamId: team.id });

    const failed = await failPromise;
    expect(failed.reason).toBe('not_active');

    socket.disconnect();
  });

  test('abandon then activate another challenge works', async () => {
    const { data: game } = await api('POST', '/games', {
      name: 'Abandon Switch', activeChallengeCount: 2, challengeExpireMinutes: 10,
    });
    const { data: team } = await api('POST', `/games/${game.id}/teams`, { name: 'Switcher', color: '#e74c3c' });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'C1', description: 'D', points: 100, lat: 41.88, lng: -87.62, sortOrder: 1,
    });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'C2', description: 'D', points: 200, lat: 41.881, lng: -87.621, sortOrder: 2,
    });
    await api('POST', `/games/${game.id}/start`);
    await new Promise(r => setTimeout(r, 12000));

    const socket = connectSocket();
    await new Promise<void>((r) => { socket.on('game:state', () => r()); socket.emit('game:join', { gameId: game.id, teamId: team.id }); });

    const { data: challenges } = await api('GET', `/games/${game.id}/challenges`);
    const active = challenges.filter((c: any) => c.status === 'active');

    // Activate first
    socket.emit('challenge:activate', { challengeId: active[0].id, teamId: team.id });
    await new Promise(r => setTimeout(r, 500));

    // Abandon
    socket.emit('challenge:abandon', { challengeId: active[0].id, teamId: team.id });
    await new Promise(r => setTimeout(r, 500));

    // Activate second — should succeed now
    const activatedPromise = new Promise<any>((resolve) => {
      socket.on('challenge:activated', (data: any) => {
        if (data.challengeId === active[1].id) resolve(data);
      });
    });
    socket.emit('challenge:activate', { challengeId: active[1].id, teamId: team.id });

    const activated = await activatedPromise;
    expect(activated.challengeId).toBe(active[1].id);
    expect(activated.teamId).toBe(team.id);

    socket.disconnect();
  });

  test('completing a challenge when another team also had it active clears their state', async () => {
    const { data: game } = await api('POST', '/games', {
      name: 'Clear Other', activeChallengeCount: 1, challengeExpireMinutes: 10,
    });
    const { data: team1 } = await api('POST', `/games/${game.id}/teams`, { name: 'Winner', color: '#e74c3c' });
    const { data: team2 } = await api('POST', `/games/${game.id}/teams`, { name: 'Loser', color: '#3498db' });
    const { data: challenge } = await api('POST', `/games/${game.id}/challenges`, {
      name: 'Shared', description: 'D', points: 100, lat: 41.88, lng: -87.62, sortOrder: 1,
    });
    await api('POST', `/games/${game.id}/start`);
    await new Promise(r => setTimeout(r, 12000));

    const socket1 = connectSocket();
    const socket2 = connectSocket();
    await Promise.all([
      new Promise<void>((r) => { socket1.on('game:state', () => r()); socket1.emit('game:join', { gameId: game.id, teamId: team1.id }); }),
      new Promise<void>((r) => { socket2.on('game:state', () => r()); socket2.emit('game:join', { gameId: game.id, teamId: team2.id }); }),
    ]);

    // Both activate
    socket1.emit('challenge:activate', { challengeId: challenge.id, teamId: team1.id });
    await new Promise(r => setTimeout(r, 500));
    socket2.emit('challenge:activate', { challengeId: challenge.id, teamId: team2.id });
    await new Promise(r => setTimeout(r, 500));

    // Team2's activate should succeed if team2 had NULL active_challenge_id
    // (both teams can work on the same challenge)

    // Team 1 completes — team 2 should get yanked
    const yankedPromise = new Promise<any>((resolve) => {
      socket2.on('challenge:yanked', (data: any) => resolve(data));
    });
    socket1.emit('challenge:complete', { challengeId: challenge.id, teamId: team1.id });

    const yanked = await yankedPromise;
    expect(yanked.challengeId).toBe(challenge.id);

    // Verify team2's active_challenge_id is null
    await new Promise(r => setTimeout(r, 500));
    const { data: teams } = await api('GET', `/games/${game.id}/teams`);
    const t2 = teams.find((t: any) => t.id === team2.id);
    expect(t2.active_challenge_id).toBeNull();

    socket1.disconnect();
    socket2.disconnect();
  });
});
