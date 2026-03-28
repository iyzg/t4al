import type { Challenge, Game, LeaderboardEntry, TeamSnapshot } from './types.js';

// ── Payload types ──

export interface LocationUpdatePayload {
  teamId: string;
  lat: number;
  lng: number;
}

export interface ChallengeActionPayload {
  challengeId: string;
  teamId: string;
}

export interface GameJoinPayload {
  gameId: string;
  teamId: string;
}

export interface ChallengeSpawnedPayload {
  challenge: Challenge;
}

export interface ChallengeClaimedPayload {
  challengeId: string;
  claimedByTeamId: string;
  claimedByTeamName: string;
  points: number;
}

export interface ChallengeExpiredPayload {
  challengeId: string;
}

export interface ChallengeActivatedPayload {
  challengeId: string;
  teamId: string;
}

export interface ChallengeAbandonedPayload {
  challengeId: string;
  teamId: string;
}

export interface LeaderboardUpdatePayload {
  teams: LeaderboardEntry[];
}

export interface GameEndedPayload {
  finalScores?: LeaderboardEntry[];
}

export interface ChallengeYankedPayload {
  challengeId: string;
}

export interface CompleteSuccessPayload {
  challengeId: string;
  points: number;
}

export interface CompleteFailedPayload {
  challengeId: string;
  reason: 'already_claimed' | 'not_active';
}

export interface GameStatePayload {
  game: Game;
  teams: TeamSnapshot[];
  challenges: Challenge[];       // active challenges only
}

// ── Client → Server events ──

export interface ClientToServerEvents {
  'challenge:abandon': (data: ChallengeActionPayload) => void;
  'challenge:activate': (data: ChallengeActionPayload) => void;
  'challenge:complete': (data: ChallengeActionPayload) => void;
  'game:join': (data: GameJoinPayload) => void;
  'location:update': (data: LocationUpdatePayload) => void;
}

// ── Server → Client events ──

export interface ServerToClientEvents {
  'challenge:spawned': (data: ChallengeSpawnedPayload) => void;
  'challenge:claimed': (data: ChallengeClaimedPayload) => void;
  'challenge:expired': (data: ChallengeExpiredPayload) => void;
  'challenge:activated': (data: ChallengeActivatedPayload) => void;
  'challenge:abandoned': (data: ChallengeAbandonedPayload) => void;
  'challenge:yanked': (data: ChallengeYankedPayload) => void;
  'complete:success': (data: CompleteSuccessPayload) => void;
  'complete:failed': (data: CompleteFailedPayload) => void;
  'leaderboard:update': (data: LeaderboardUpdatePayload) => void;
  'game:state': (data: GameStatePayload) => void;
  'game:started': (data: Record<string, never>) => void;
  'game:ended': (data: GameEndedPayload) => void;
}
