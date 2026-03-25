import { socket } from './socket';
import { useGameStore } from './store';

let registered = false;

// Wire server events to store actions.
// Guarded so calling multiple times is safe (idempotent).
export function registerSocketHandlers() {
  if (registered) return;
  registered = true;

  const store = useGameStore.getState;

  socket.on('challenge:spawned', (data) => {
    if (!data?.challenge) return;
    store().challengeSpawned(data.challenge);
  });

  socket.on('challenge:claimed', (data) => {
    if (!data?.challengeId) return;
    store().challengeClaimed(data.challengeId, data.claimedByTeamId);
  });

  socket.on('leaderboard:update', (data) => {
    if (!data?.teams) return;
    store().leaderboardUpdated(data.teams, data.mode);
  });

  socket.on('mode:change', (data) => {
    if (!data) return;
    store().modeChanged(data.mode, data.segmentMode);
  });

  socket.on('challenge:unlocked', (_data) => {
    // Server says we're in range — future: show notification
  });

  socket.on('challenge:left', (_data) => {
    store().setActiveChallengeId(null);
  });

  socket.on('complete:success', (_data) => {
    store().setActiveChallengeId(null);
  });

  socket.on('complete:failed', (data) => {
    console.warn('Complete failed:', data?.reason);
    // If activation or completion was rejected, revert the optimistic state
    const { activeChallengeId } = store();
    if (activeChallengeId === data?.challengeId) {
      store().setActiveChallengeId(null);
    }
  });

  socket.on('game:started', (_data: any) => {
    store().setGameStatus('active');
  });

  socket.on('game:ended', (_data) => {
    store().setGameStatus('ended');
  });

  // Restore active challenge on (re)join
  socket.on('active:restore', (data) => {
    if (data?.challengeId) {
      store().setActiveChallengeId(data.challengeId);
    }
  });

  // Auto-rejoin game room after socket reconnects (network blip, server restart)
  socket.on('connect', () => {
    const { gameId, teamId } = store();
    if (gameId && teamId) {
      socket.emit('game:join', { gameId, teamId });
    }
  });
}
