import { create } from 'zustand';
import type {
  Challenge,
  Game,
  GameStatus,
  LeaderboardEntry,
  TeamSnapshot,
} from '@t4al/shared';

export interface GameStore {
  // Identity
  gameId: string | null;
  teamId: string | null;
  teamColor: string | null;
  gameStatus: GameStatus | null;
  game: Game | null;

  // Challenges keyed by id for fast lookup + update
  challenges: Record<string, Challenge>;

  // Leaderboard
  leaderboard: LeaderboardEntry[];

  // Team snapshots (for pie chart — who's working on what)
  teamSnapshots: TeamSnapshot[];

  // Active challenge (this team's)
  activeChallengeId: string | null;

  // Actions
  challengeSpawned: (challenge: Challenge) => void;
  challengeClaimed: (challengeId: string, claimedByTeamId: string) => void;
  challengeExpired: (challengeId: string) => void;
  challengeActivatedByTeam: (challengeId: string, teamId: string) => void;
  challengeAbandonedByTeam: (challengeId: string, teamId: string) => void;
  challengeYanked: (challengeId: string) => void;
  leaderboardUpdated: (teams: LeaderboardEntry[]) => void;
  setActiveChallengeId: (id: string | null) => void;
  setGameStatus: (status: GameStatus) => void;
  setIdentity: (gameId: string, teamId: string, teamColor: string) => void;
  setGameState: (game: Game, teams: TeamSnapshot[], challenges: Challenge[]) => void;
}

export const useGameStore = create<GameStore>()((set, get) => ({
  gameId: null,
  teamId: null,
  teamColor: null,
  gameStatus: null,
  game: null,
  challenges: {},
  leaderboard: [],
  teamSnapshots: [],
  activeChallengeId: null,

  challengeSpawned: (challenge) => set((state) => ({
    challenges: { ...state.challenges, [challenge.id]: challenge }
  })),

  challengeClaimed: (challengeId, claimedByTeamId) => set((state) => {
    // Remove the challenge from map (it's done)
    const { [challengeId]: _, ...rest } = state.challenges;
    // Clear activeChallengeId for any team that had it
    const teamSnapshots = state.teamSnapshots.map((t) =>
      t.activeChallengeId === challengeId ? { ...t, activeChallengeId: null } : t
    );
    return {
      challenges: rest,
      teamSnapshots,
      activeChallengeId: challengeId === state.activeChallengeId ? null : state.activeChallengeId,
    };
  }),

  challengeExpired: (challengeId) => set((state) => {
    // Remove the challenge from map
    const { [challengeId]: _, ...rest } = state.challenges;
    // Clear activeChallengeId for any team that had it
    const teamSnapshots = state.teamSnapshots.map((t) =>
      t.activeChallengeId === challengeId ? { ...t, activeChallengeId: null } : t
    );
    return {
      challenges: rest,
      teamSnapshots,
    };
  }),

  challengeActivatedByTeam: (challengeId, teamId) => set((state) => ({
    teamSnapshots: state.teamSnapshots.map((t) =>
      t.id === teamId ? { ...t, activeChallengeId: challengeId } : t
    ),
    // If it's our team, set our activeChallengeId
    activeChallengeId: teamId === state.teamId ? challengeId : state.activeChallengeId,
  })),

  challengeAbandonedByTeam: (challengeId, teamId) => set((state) => ({
    teamSnapshots: state.teamSnapshots.map((t) =>
      t.id === teamId && t.activeChallengeId === challengeId
        ? { ...t, activeChallengeId: null }
        : t
    ),
    activeChallengeId:
      teamId === state.teamId && state.activeChallengeId === challengeId
        ? null
        : state.activeChallengeId,
  })),

  challengeYanked: (challengeId) => set((state) => ({
    activeChallengeId: state.activeChallengeId === challengeId ? null : state.activeChallengeId,
  })),

  leaderboardUpdated: (teams) => set(() => ({
    leaderboard: teams,
  })),

  setActiveChallengeId: (id) => set(() => ({ activeChallengeId: id })),
  setGameStatus: (status) => set(() => ({ gameStatus: status })),
  setIdentity: (gameId, teamId, teamColor) => set(() => ({ gameId, teamId, teamColor })),

  setGameState: (game, teams, challenges) => {
    const myTeam = teams.find((t) => t.id === get().teamId);
    set({
      game,
      gameStatus: game.status,
      teamSnapshots: teams,
      challenges: Object.fromEntries(challenges.map((c) => [c.id, c])),
      leaderboard: teams.map((t, i) => ({
        id: t.id, name: t.name, color: t.color, score: t.score, rank: i + 1,
      })),
      activeChallengeId: myTeam?.activeChallengeId ?? null,
    });
  },
}));
