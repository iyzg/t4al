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

test.describe('Reconnection - game:state snapshot', () => {
  test('reconnecting client gets full state including challenges spawned while disconnected', async () => {
    const { data: game } = await api('POST', '/games', {
      name: 'Reconnect Test', activeChallengeCount: 2, challengeExpireMinutes: 10,
    });
    const { data: team } = await api('POST', `/games/${game.id}/teams`, { name: 'Reconnector', color: '#e74c3c' });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'C1', description: 'D', points: 100, lat: 41.88, lng: -87.62, sortOrder: 1,
    });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'C2', description: 'D', points: 200, lat: 41.881, lng: -87.621, sortOrder: 2,
    });

    // Connect, receive initial state (lobby, no active challenges)
    const socket = connectSocket();
    const initialState = await new Promise<any>((resolve) => {
      socket.on('game:state', (data: any) => resolve(data));
      socket.emit('game:join', { gameId: game.id, teamId: team.id });
    });
    expect(initialState.challenges.length).toBe(0); // lobby, nothing active
    socket.disconnect();

    // Start game and wait for challenges to activate
    await api('POST', `/games/${game.id}/start`);
    await new Promise(r => setTimeout(r, 12000));

    // Reconnect — should get full state with active challenges
    const socket2 = connectSocket();
    const reconnectState = await new Promise<any>((resolve) => {
      socket2.on('game:state', (data: any) => resolve(data));
      socket2.emit('game:join', { gameId: game.id, teamId: team.id });
    });

    expect(reconnectState.game.status).toBe('active');
    expect(reconnectState.challenges.length).toBe(2);
    expect(reconnectState.challenges.every((c: any) => c.status === 'active')).toBe(true);
    socket2.disconnect();
  });

  test('reconnecting gets updated scores from while disconnected', async () => {
    const { data: game } = await api('POST', '/games', {
      name: 'Score Reconnect', activeChallengeCount: 1, challengeExpireMinutes: 10,
    });
    const { data: team1 } = await api('POST', `/games/${game.id}/teams`, { name: 'Scorer', color: '#e74c3c' });
    const { data: team2 } = await api('POST', `/games/${game.id}/teams`, { name: 'Offline', color: '#3498db' });
    const { data: challenge } = await api('POST', `/games/${game.id}/challenges`, {
      name: 'Points', description: 'D', points: 500, lat: 41.88, lng: -87.62, sortOrder: 1,
    });
    await api('POST', `/games/${game.id}/start`);
    await new Promise(r => setTimeout(r, 12000));

    // Team 1 claims while team 2 is "offline"
    await api('POST', `/challenges/${challenge.id}/claim`, { teamId: team1.id });

    // Team 2 reconnects
    const socket = connectSocket();
    const state = await new Promise<any>((resolve) => {
      socket.on('game:state', (data: any) => resolve(data));
      socket.emit('game:join', { gameId: game.id, teamId: team2.id });
    });

    // Should see updated scores
    const t1 = state.teams.find((t: any) => t.id === team1.id);
    expect(t1.score).toBe(500);

    // Claimed challenge should NOT be in the active challenges list
    expect(state.challenges.length).toBe(0); // claimed, no more queued

    socket.disconnect();
  });

  test('reconnecting after team activated a challenge preserves activeChallengeId', async () => {
    const { data: game } = await api('POST', '/games', {
      name: 'Active Reconnect', activeChallengeCount: 1, challengeExpireMinutes: 10,
    });
    const { data: team } = await api('POST', `/games/${game.id}/teams`, { name: 'Active Team', color: '#e74c3c' });
    const { data: challenge } = await api('POST', `/games/${game.id}/challenges`, {
      name: 'Working', description: 'D', points: 100, lat: 41.88, lng: -87.62, sortOrder: 1,
    });
    await api('POST', `/games/${game.id}/start`);
    await new Promise(r => setTimeout(r, 12000));

    // Activate via socket
    const socket1 = connectSocket();
    await new Promise<void>((r) => { socket1.on('game:state', () => r()); socket1.emit('game:join', { gameId: game.id, teamId: team.id }); });
    socket1.emit('challenge:activate', { challengeId: challenge.id, teamId: team.id });
    await new Promise(r => setTimeout(r, 1000));
    socket1.disconnect();

    // Reconnect
    const socket2 = connectSocket();
    const state = await new Promise<any>((resolve) => {
      socket2.on('game:state', (data: any) => resolve(data));
      socket2.emit('game:join', { gameId: game.id, teamId: team.id });
    });

    const myTeam = state.teams.find((t: any) => t.id === team.id);
    expect(myTeam.activeChallengeId).toBe(challenge.id);
    socket2.disconnect();
  });
});
