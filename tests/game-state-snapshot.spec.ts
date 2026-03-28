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

test.describe('game:state snapshot', () => {
  test('game:state sent on join with full state', async () => {
    const { data: game } = await api('POST', '/games', {
      name: 'Snapshot Test', activeChallengeCount: 2, challengeExpireMinutes: 10,
    });
    const { data: team1 } = await api('POST', `/games/${game.id}/teams`, { name: 'Alpha', color: '#e74c3c' });
    const { data: team2 } = await api('POST', `/games/${game.id}/teams`, { name: 'Beta', color: '#3498db' });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'C1', description: 'D', points: 100, lat: 41.88, lng: -87.62, sortOrder: 1,
    });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'C2', description: 'D', points: 200, lat: 41.881, lng: -87.621, sortOrder: 2,
    });

    await api('POST', `/games/${game.id}/start`);
    await new Promise(r => setTimeout(r, 12000)); // wait for challenges to activate

    const socket = connectSocket();
    const state = await new Promise<any>((resolve) => {
      socket.on('game:state', (data: any) => resolve(data));
      socket.emit('game:join', { gameId: game.id, teamId: team1.id });
    });

    // Verify game data
    expect(state.game).toBeDefined();
    expect(state.game.id).toBe(game.id);
    expect(state.game.status).toBe('active');
    expect(state.game.activeChallengeCount).toBe(2);
    expect(state.game.challengeExpireMinutes).toBe(10);

    // Verify teams include activeChallengeId
    expect(state.teams).toBeDefined();
    expect(state.teams.length).toBe(2);
    const t1 = state.teams.find((t: any) => t.id === team1.id);
    expect(t1).toBeDefined();
    expect(t1.name).toBe('Alpha');
    expect(t1.color).toBe('#e74c3c');
    expect(t1.activeChallengeId).toBeNull();

    // Verify only active challenges are sent
    expect(state.challenges).toBeDefined();
    expect(state.challenges.length).toBe(2);
    for (const c of state.challenges) {
      expect(c.status).toBe('active');
      expect(c.activatedAt).toBeTruthy();
    }

    socket.disconnect();
  });

  test('game:state for lobby game has no active challenges', async () => {
    const { data: game } = await api('POST', '/games', { name: 'Lobby Snapshot' });
    const { data: team } = await api('POST', `/games/${game.id}/teams`, { name: 'Waiter', color: '#e74c3c' });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'Queued', description: 'D', points: 100, lat: 41.88, lng: -87.62,
    });

    const socket = connectSocket();
    const state = await new Promise<any>((resolve) => {
      socket.on('game:state', (data: any) => resolve(data));
      socket.emit('game:join', { gameId: game.id, teamId: team.id });
    });

    expect(state.game.status).toBe('lobby');
    expect(state.challenges.length).toBe(0); // no active challenges in lobby
    expect(state.teams.length).toBe(1);

    socket.disconnect();
  });

  test('game:state reflects team activeChallengeId', async () => {
    const { data: game } = await api('POST', '/games', {
      name: 'Active Challenge Snapshot', activeChallengeCount: 1, challengeExpireMinutes: 10,
    });
    const { data: team } = await api('POST', `/games/${game.id}/teams`, { name: 'Worker', color: '#e74c3c' });
    const { data: challenge } = await api('POST', `/games/${game.id}/challenges`, {
      name: 'Work on Me', description: 'D', points: 100, lat: 41.88, lng: -87.62, sortOrder: 1,
    });
    await api('POST', `/games/${game.id}/start`);
    await new Promise(r => setTimeout(r, 12000));

    // Activate the challenge via socket
    const socket1 = connectSocket();
    await new Promise<void>((resolve) => {
      socket1.on('game:state', () => resolve());
      socket1.emit('game:join', { gameId: game.id, teamId: team.id });
    });
    socket1.emit('challenge:activate', { challengeId: challenge.id, teamId: team.id });
    await new Promise(r => setTimeout(r, 1000));

    // Connect a second socket and check the snapshot
    const socket2 = connectSocket();
    const state = await new Promise<any>((resolve) => {
      socket2.on('game:state', (data: any) => resolve(data));
      socket2.emit('game:join', { gameId: game.id, teamId: team.id });
    });

    const t = state.teams.find((t: any) => t.id === team.id);
    expect(t.activeChallengeId).toBe(challenge.id);

    socket1.disconnect();
    socket2.disconnect();
  });
});

test.describe('challenge:activated broadcast', () => {
  test('other clients receive challenge:activated when a team activates', async () => {
    const { data: game } = await api('POST', '/games', {
      name: 'Activation Broadcast', activeChallengeCount: 1, challengeExpireMinutes: 10,
    });
    const { data: team1 } = await api('POST', `/games/${game.id}/teams`, { name: 'Activator', color: '#e74c3c' });
    const { data: team2 } = await api('POST', `/games/${game.id}/teams`, { name: 'Observer', color: '#3498db' });
    const { data: challenge } = await api('POST', `/games/${game.id}/challenges`, {
      name: 'Activate Me', description: 'D', points: 100, lat: 41.88, lng: -87.62, sortOrder: 1,
    });
    await api('POST', `/games/${game.id}/start`);
    await new Promise(r => setTimeout(r, 12000));

    // Connect both teams
    const socket1 = connectSocket();
    const socket2 = connectSocket();
    await Promise.all([
      new Promise<void>((resolve) => { socket1.on('game:state', () => resolve()); socket1.emit('game:join', { gameId: game.id, teamId: team1.id }); }),
      new Promise<void>((resolve) => { socket2.on('game:state', () => resolve()); socket2.emit('game:join', { gameId: game.id, teamId: team2.id }); }),
    ]);

    // Listen for activation on observer
    const activatedPromise = new Promise<any>((resolve) => {
      socket2.on('challenge:activated', (data: any) => resolve(data));
    });

    // Team 1 activates
    socket1.emit('challenge:activate', { challengeId: challenge.id, teamId: team1.id });

    const activated = await activatedPromise;
    expect(activated.challengeId).toBe(challenge.id);
    expect(activated.teamId).toBe(team1.id);

    socket1.disconnect();
    socket2.disconnect();
  });
});

test.describe('challenge:abandoned broadcast', () => {
  test('other clients receive challenge:abandoned when a team abandons', async () => {
    const { data: game } = await api('POST', '/games', {
      name: 'Abandon Broadcast', activeChallengeCount: 1, challengeExpireMinutes: 10,
    });
    const { data: team1 } = await api('POST', `/games/${game.id}/teams`, { name: 'Abandoner', color: '#e74c3c' });
    const { data: team2 } = await api('POST', `/games/${game.id}/teams`, { name: 'Observer', color: '#3498db' });
    const { data: challenge } = await api('POST', `/games/${game.id}/challenges`, {
      name: 'Abandon Me', description: 'D', points: 100, lat: 41.88, lng: -87.62, sortOrder: 1,
    });
    await api('POST', `/games/${game.id}/start`);
    await new Promise(r => setTimeout(r, 12000));

    const socket1 = connectSocket();
    const socket2 = connectSocket();
    await Promise.all([
      new Promise<void>((resolve) => { socket1.on('game:state', () => resolve()); socket1.emit('game:join', { gameId: game.id, teamId: team1.id }); }),
      new Promise<void>((resolve) => { socket2.on('game:state', () => resolve()); socket2.emit('game:join', { gameId: game.id, teamId: team2.id }); }),
    ]);

    // Activate first
    socket1.emit('challenge:activate', { challengeId: challenge.id, teamId: team1.id });
    await new Promise(r => setTimeout(r, 500));

    // Listen for abandon on observer
    const abandonedPromise = new Promise<any>((resolve) => {
      socket2.on('challenge:abandoned', (data: any) => resolve(data));
    });

    socket1.emit('challenge:abandon', { challengeId: challenge.id, teamId: team1.id });

    const abandoned = await abandonedPromise;
    expect(abandoned.challengeId).toBe(challenge.id);
    expect(abandoned.teamId).toBe(team1.id);

    socket1.disconnect();
    socket2.disconnect();
  });
});
