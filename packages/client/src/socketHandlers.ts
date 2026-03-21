import { socket } from './socket';
import { useGameStore } from './store';

// Wire server events to store actions.
// Called once at app startup — handlers persist for the socket's lifetime.
export function registerSocketHandlers() {
  const store = useGameStore.getState;

  socket.on('challenge:spawned', (data) => {
    store().challengeSpawned(data.challenge);
  });

  socket.on('challenge:claimed', (data) => {
    store().challengeClaimed(data.challengeId, data.claimedByTeamId);
  });

  socket.on('leaderboard:update', (data) => {
    store().leaderboardUpdated(data.teams, data.mode);
  });

  socket.on('mode:change', (data) => {
    store().modeChanged(data.mode, data.segmentMode);
  });

  socket.on('challenge:unlocked', (data) => {
    // Server says we're in range — could show a notification
    console.log('Challenge unlocked:', data.challengeId);
  });

  socket.on('challenge:left', (data) => {
    store().setActiveChallengeId(null);
  });

  socket.on('complete:success', (data) => {
    store().setActiveChallengeId(null);
  });

  socket.on('complete:failed', (data) => {
    console.warn('Complete failed:', data.reason);
  });

  socket.on('game:ended', (data) => {
    store().setGameStatus('ended');
  });
}
