import { socket } from './socket';
import { useGameStore } from './store';
import type { ActionAck } from '@t4al/shared';

let registered = false;

// Wire server events to the store. Idempotent.
export function registerSocketHandlers() {
  if (registered) return;
  registered = true;

  const store = useGameStore.getState;

  // ── Connect / reconnect ──
  socket.on('connect', () => {
    const { gameId, teamId, deviceId, adminCode, isAdmin } = store();
    if (isAdmin && gameId && adminCode) {
      socket.emit('admin:join', { gameId, adminCode });
    } else if (gameId && teamId && deviceId) {
      socket.emit('game:join', { gameId, teamId, deviceId });
    }
  });

  // ── Full snapshot on join/reconnect ──
  socket.on('game:state', (data) => {
    if (!data?.game || !data?.teams || !data?.challenges) return;
    store().setGameState(data.game, data.teams, data.challenges);
  });

  // ── Game room broadcasts ──
  socket.on('challenge:spawned', (data) => {
    if (!data?.challenge) return;
    store().challengeSpawned(data.challenge);
  });

  socket.on('challenge:claimed', (data) => {
    if (!data?.challengeId) return;
    store().challengeClaimed(data.challengeId, data.teamId, data.tokensAwarded);
  });

  socket.on('challenge:expired', (data) => {
    if (!data?.challengeId) return;
    store().challengeExpired(data.challengeId);
  });

  socket.on('challenge:started', (data) => {
    if (!data?.challengeId || !data?.teamId) return;
    store().challengeStartedBy(data.challengeId, data.teamId);
  });

  socket.on('challenge:abandoned', (data) => {
    if (!data?.challengeId || !data?.teamId) return;
    store().challengeAbandonedBy(data.challengeId, data.teamId);
  });

  socket.on('challenge:wagerFailed', (data) => {
    if (!data?.challengeId || !data?.teamId) return;
    store().challengeWagerFailedBy(data.challengeId, data.teamId);
  });

  socket.on('leaderboard:update', (data) => {
    if (!data?.teams) return;
    store().leaderboardUpdated(data.teams);
  });

  // ── Team room (private) ──
  socket.on('team:state', (data) => {
    if (!data) return;
    store().setTeamPrivateState(data);
  });

  socket.on('challenge:yanked', (data) => {
    if (!data?.challengeId) return;
    // team:state will clear activeChallengeId and wagerAmount; just show a toast.
    const reason = data.reason === 'expired'
      ? 'Challenge expired.'
      : 'Another team claimed this challenge first.';
    store().showToast(reason, 'info');
    store().clearStartedLocally(data.challengeId);
  });

  socket.on('complete:success', (data) => {
    if (!data) return;
    store().showToast(`You earned ${data.tokensAwarded} tokens!`, 'info');
    store().clearStartedLocally(data.challengeId);
  });

  socket.on('wager:result', (data) => {
    if (!data) return;
    if (data.outcome === 'pass') {
      store().showToast(`Wager passed: +${data.tokensDelta} tokens.`, 'info');
    } else {
      store().showToast(`Wager failed: ${data.tokensDelta} tokens.`, 'error');
    }
  });

  // ── Lifecycle ──
  socket.on('game:started', (data) => {
    if (!data?.game) return;
    store().gameStarted(data.game, data.challenges ?? []);
  });

  socket.on('game:ended', (data) => {
    store().gameEnded(data?.finalStandings ?? []);
  });
}

// ── Typed ack wrappers for action events ──

const toastForReason: Record<string, string> = {
  team_busy:             'Your team is already on another challenge.',
  challenge_unavailable: 'Too late — that challenge is no longer available.',
  invalid_state:         'That action is not available right now.',
  bad_input:             'Invalid input.',
  not_authorized:        'You are not authorized.',
  unknown:               'Something went wrong.',
};

function handleAck(ack: ActionAck) {
  if (!ack.ok) {
    useGameStore.getState().showToast(toastForReason[ack.reason] ?? ack.reason, 'error');
  }
}

export function emitStart(challengeId: string, teamId: string) {
  socket.emit('challenge:start', { challengeId, teamId }, (ack) => {
    handleAck(ack);
    if (ack.ok) useGameStore.getState().markStartedLocally(challengeId);
  });
}

export function emitWager(challengeId: string, teamId: string, wagerAmount: number) {
  socket.emit('challenge:wager', { challengeId, teamId, wagerAmount }, handleAck);
}

export function emitComplete(challengeId: string, teamId: string, count?: number) {
  socket.emit('challenge:complete', { challengeId, teamId, count }, handleAck);
}

export function emitFail(challengeId: string, teamId: string) {
  socket.emit('challenge:fail', { challengeId, teamId }, handleAck);
}

export function emitAbandon(challengeId: string, teamId: string) {
  socket.emit('challenge:abandon', { challengeId, teamId }, handleAck);
}
