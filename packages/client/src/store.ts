import { create } from 'zustand';
import type {
  Challenge,
  GameStatus,
  LeaderboardEntry,
  LeaderboardMode,
  SegmentMode,
} from '@t4al/shared';

export interface GameStore {
  // Identity
  gameId: string | null;
  teamId: string | null;
  teamColor: string | null;
  gameStatus: GameStatus | null;

  // Challenges keyed by id for fast lookup + update
  challenges: Record<string, Challenge>;

  // Leaderboard
  leaderboard: LeaderboardEntry[];
  leaderboardMode: LeaderboardMode;

  // Current mode
  segmentMode: SegmentMode | null;

  // Active challenge (this team's)
  activeChallengeId: string | null;

  // Actions
  challengeSpawned: (challenge: Challenge) => void;
  challengeClaimed: (challengeId: string, claimedByTeamId: string) => void;
  leaderboardUpdated: (teams: LeaderboardEntry[], mode: LeaderboardMode) => void
  modeChanged: (mode: LeaderboardMode, segmentMode: SegmentMode | null) => void;
}

export const useGameStore = create<GameStore>()((set) => ({
  gameId: null,
  teamId: null,
  teamColor: null,
  gameStatus: null,
  challenges: {},
  leaderboard: [],
  leaderboardMode: 'full',
  segmentMode: null,
  activeChallengeId: null,

  challengeSpawned: (challenge) => set((state) => ({
    challenges: { ...state.challenges, [challenge.id]: challenge }
  })),

  challengeClaimed: (challengeId, claimedByTeamId) => set((state) => ({
    activeChallengeId: challengeId === state.activeChallengeId ? null : state.activeChallengeId,
    challenges: { 
      ...state.challenges,
      [challengeId]: {
        ...state.challenges[challengeId],
        status: 'claimed',
        claimedByTeamId: claimedByTeamId,
      },
    }

  })),

  leaderboardUpdated: (teams, mode) => set(() => ({
    leaderboard: teams,
    leaderboardMode: mode,
  })),

  modeChanged: (mode, segmentMode) => set(() => ({
    leaderboardMode: mode,
    segmentMode: segmentMode,

  })),
}));
