import { create } from 'zustand';
import type {
  Challenge,
  Game,
  GameStatus,
  LeaderboardEntry,
  TeamPrivateState,
  TeamSnapshot,
} from '@t4al/shared';

export interface GameStore {
  // Identity
  gameId:     string | null;
  teamId:     string | null;
  teamColor:  string | null;
  deviceId:   string | null;
  adminCode:  string | null;    // set when viewing admin UI
  isAdmin:    boolean;

  // Game snapshot
  game:         Game | null;
  gameStatus:   GameStatus | null;
  finalStandings: LeaderboardEntry[] | null;

  // Challenges keyed by id for fast update
  challenges: Record<string, Challenge>;

  // Leaderboard (sorted)
  leaderboard: LeaderboardEntry[];

  // Public team state (for map pie-chart, admin list, etc.)
  teamSnapshots: TeamSnapshot[];

  // Private team state (for the current client's team only)
  tokens:            number;
  activeChallengeId: string | null;
  wagerAmount:       number | null;

  // Device-local GPS (from navigator.geolocation)
  myLocation: { lat: number; lng: number } | null;

  // Ephemeral UI state — toast is a queue; oldest first
  toasts:        Array<{ id: number; message: string; kind: 'error' | 'info' }>;
  // Socket connection status: 'connected' is the happy path; 'reconnecting'
  // means socket.io's auto-retry is firing; 'offline' means we've been
  // disconnected long enough that the player should know.
  connectionStatus: 'connected' | 'reconnecting' | 'offline';
  startedLocally: Set<string>;  // challengeIds we've started since last map reset
                                  // (used so description stays revealed after walking out of range)

  // ── Setters / reducers ──
  setIdentity:    (args: { gameId: string; teamId: string; teamColor: string; deviceId: string }) => void;
  clearIdentity:  () => void;
  setAdminCode:   (code: string | null) => void;
  setGameState:   (game: Game, teams: TeamSnapshot[], challenges: Challenge[]) => void;
  setTeamPrivateState: (state: TeamPrivateState) => void;
  setMyLocation:  (loc: { lat: number; lng: number } | null) => void;
  setGameStatus:  (status: GameStatus) => void;

  challengeSpawned:      (challenge: Challenge) => void;
  challengeClaimed:      (challengeId: string, teamId: string, tokensAwarded: number) => void;
  challengeExpired:      (challengeId: string) => void;
  challengeStartedBy:   (challengeId: string, teamId: string) => void;
  challengeAbandonedBy:  (challengeId: string, teamId: string) => void;
  challengeWagerFailedBy:(challengeId: string, teamId: string) => void;
  leaderboardUpdated:    (teams: LeaderboardEntry[]) => void;
  gameStarted:           (game: Game, challenges: Challenge[]) => void;
  gameEnded:             (finalStandings: LeaderboardEntry[]) => void;

  markStartedLocally:   (challengeId: string) => void;
  clearStartedLocally:  (challengeId: string) => void;

  showToast:             (message: string, kind?: 'error' | 'info') => void;
  dismissToast:          (id: number) => void;
  setConnectionStatus:   (status: 'connected' | 'reconnecting' | 'offline') => void;
}

export const useGameStore = create<GameStore>()((set, get) => ({
  gameId: null,
  teamId: null,
  teamColor: null,
  deviceId: null,
  adminCode: null,
  isAdmin: false,

  game: null,
  gameStatus: null,
  finalStandings: null,

  challenges: {},
  leaderboard: [],
  teamSnapshots: [],

  tokens: 0,
  activeChallengeId: null,
  wagerAmount: null,

  myLocation: null,

  toasts: [],
  connectionStatus: 'connected',
  startedLocally: new Set(),

  setIdentity: ({ gameId, teamId, teamColor, deviceId }) =>
    set({ gameId, teamId, teamColor, deviceId, isAdmin: false }),

  clearIdentity: () =>
    set({
      gameId: null, teamId: null, teamColor: null, deviceId: null,
      adminCode: null, isAdmin: false,
      game: null, gameStatus: null, finalStandings: null,
      challenges: {}, leaderboard: [], teamSnapshots: [],
      tokens: 0, activeChallengeId: null, wagerAmount: null,
      startedLocally: new Set(),
    }),

  setAdminCode: (code) => set({ adminCode: code, isAdmin: code != null }),

  setGameState: (game, teams, challenges) => {
    const myTeam = teams.find((t) => t.id === get().teamId);
    set({
      game,
      gameStatus: game.status,
      teamSnapshots: teams,
      challenges: Object.fromEntries(challenges.map((c) => [c.id, c])),
      leaderboard: [...teams]
        .sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name))
        .map((t, i) => ({ id: t.id, name: t.name, color: t.color, tokens: t.tokens, rank: i + 1 })),
      activeChallengeId: myTeam?.activeChallengeId ?? get().activeChallengeId,
      tokens: myTeam?.tokens ?? get().tokens,
    });
  },

  setTeamPrivateState: (state) => set({
    activeChallengeId: state.activeChallengeId,
    wagerAmount:       state.wagerAmount,
    tokens:            state.tokens,
  }),

  setMyLocation: (loc) => set({ myLocation: loc }),
  setGameStatus: (status) => set({ gameStatus: status }),

  challengeSpawned: (challenge) =>
    set((s) => ({ challenges: { ...s.challenges, [challenge.id]: challenge } })),

  challengeClaimed: (challengeId, teamId, tokensAwarded) =>
    set((s) => {
      const { [challengeId]: _removed, ...rest } = s.challenges;
      const teamSnapshots = s.teamSnapshots.map((t) => {
        if (t.activeChallengeId === challengeId) {
          return {
            ...t,
            activeChallengeId: null,
            tokens: t.id === teamId ? t.tokens + tokensAwarded : t.tokens,
          };
        }
        if (t.id === teamId) return { ...t, tokens: t.tokens + tokensAwarded };
        return t;
      });
      const startedLocally = new Set(s.startedLocally);
      startedLocally.delete(challengeId);
      return {
        challenges: rest,
        teamSnapshots,
        startedLocally,
      };
    }),

  challengeExpired: (challengeId) =>
    set((s) => {
      const { [challengeId]: _removed, ...rest } = s.challenges;
      const teamSnapshots = s.teamSnapshots.map((t) =>
        t.activeChallengeId === challengeId ? { ...t, activeChallengeId: null } : t,
      );
      const startedLocally = new Set(s.startedLocally);
      startedLocally.delete(challengeId);
      return { challenges: rest, teamSnapshots, startedLocally };
    }),

  challengeStartedBy: (challengeId, teamId) =>
    set((s) => ({
      teamSnapshots: s.teamSnapshots.map((t) =>
        t.id === teamId ? { ...t, activeChallengeId: challengeId } : t,
      ),
    })),

  challengeAbandonedBy: (challengeId, teamId) =>
    set((s) => ({
      teamSnapshots: s.teamSnapshots.map((t) =>
        t.id === teamId && t.activeChallengeId === challengeId
          ? { ...t, activeChallengeId: null }
          : t,
      ),
    })),

  challengeWagerFailedBy: (challengeId, teamId) =>
    set((s) => ({
      teamSnapshots: s.teamSnapshots.map((t) =>
        t.id === teamId && t.activeChallengeId === challengeId
          ? { ...t, activeChallengeId: null }
          : t,
      ),
    })),

  leaderboardUpdated: (teams) =>
    set((s) => ({
      leaderboard: teams,
      teamSnapshots: s.teamSnapshots.map((t) => {
        const entry = teams.find((x) => x.id === t.id);
        return entry ? { ...t, tokens: entry.tokens } : t;
      }),
    })),

  gameStarted: (game, challenges) =>
    set({
      game,
      gameStatus: 'active',
      challenges: Object.fromEntries(challenges.map((c) => [c.id, c])),
    }),

  gameEnded: (finalStandings) =>
    set({ gameStatus: 'ended', finalStandings, leaderboard: finalStandings }),

  markStartedLocally: (challengeId) =>
    set((s) => {
      const next = new Set(s.startedLocally);
      next.add(challengeId);
      return { startedLocally: next };
    }),

  clearStartedLocally: (challengeId) =>
    set((s) => {
      const next = new Set(s.startedLocally);
      next.delete(challengeId);
      return { startedLocally: next };
    }),

  showToast: (message, kind = 'error') => set((s) => ({
    toasts: [...s.toasts, { id: Date.now() + Math.random(), message, kind }],
  })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setConnectionStatus: (status) => set({ connectionStatus: status }),
}));

// Generate or retrieve a persistent deviceId from localStorage.
// Called on first load; the result is stored in localStorage and survives reloads.
export function getOrCreateDeviceId(): string {
  const KEY = 'deviceId';
  const existing = localStorage.getItem(KEY);
  if (existing) return existing;
  const fresh = crypto.randomUUID();
  localStorage.setItem(KEY, fresh);
  return fresh;
}
