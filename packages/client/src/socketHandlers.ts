import { socket } from './socket';
import { useGameStore } from './store';

let registered = false;

// Wire server events to store actions.
// Guarded so calling multiple times is safe (idempotent).
export function registerSocketHandlers() {
  if (registered) return;
  registered = true;

  const store = useGameStore.getState;

  // Full state snapshot on join/reconnect
  socket.on('game:state', (data) => {
    if (!data?.game || !data?.teams || !data?.challenges) return;
    store().setGameState(data.game, data.teams, data.challenges);
  });

  socket.on('challenge:spawned', (data) => {
    if (!data?.challenge) return;
    store().challengeSpawned(data.challenge);
  });

  socket.on('challenge:claimed', (data) => {
    if (!data?.challengeId) return;
    store().challengeClaimed(data.challengeId, data.claimedByTeamId);
  });

  socket.on('challenge:expired', (data) => {
    if (!data?.challengeId) return;
    store().challengeExpired(data.challengeId);
  });

  socket.on('challenge:activated', (data) => {
    if (!data?.challengeId || !data?.teamId) return;
    store().challengeActivatedByTeam(data.challengeId, data.teamId);
  });

  socket.on('challenge:abandoned', (data) => {
    if (!data?.challengeId || !data?.teamId) return;
    store().challengeAbandonedByTeam(data.challengeId, data.teamId);
  });

  socket.on('challenge:yanked', (data) => {
    if (!data?.challengeId) return;
    store().challengeYanked(data.challengeId);
  });

  socket.on('leaderboard:update', (data) => {
    if (!data?.teams) return;
    store().leaderboardUpdated(data.teams);
  });

  socket.on('complete:success', (_data) => {
    store().setActiveChallengeId(null);
  });

  socket.on('complete:failed', (data) => {
    console.warn('Complete failed:', data?.reason);
    const { activeChallengeId } = store();
    if (activeChallengeId === data?.challengeId) {
      store().setActiveChallengeId(null);
    }
  });

  socket.on('game:started', () => {
    store().setGameStatus('active');
  });

  socket.on('game:ended', (_data) => {
    store().setGameStatus('ended');
  });

  // Auto-rejoin game room after socket reconnects
  socket.on('connect', () => {
    const { gameId, teamId } = store();
    if (gameId && teamId) {
      socket.emit('game:join', { gameId, teamId });
    }
  });
}
