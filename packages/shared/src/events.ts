import type { Challenge, LeaderboardEntry, LeaderboardMode, SegmentMode } from './types.js';

// ── Payload types ──
// Each WebSocket event carries a typed payload so both sides
// know exactly what data to send/expect.

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

export interface LeaderboardUpdatePayload {
  teams: LeaderboardEntry[];
  mode: LeaderboardMode;
}

export interface ModeChangePayload {
  mode: LeaderboardMode;
  segmentMode: SegmentMode | null;
}

export interface GameEndedPayload {
  finalScores: LeaderboardEntry[];
}

export interface ChallengeUnlockedPayload {
  challengeId: string;
}

export interface ChallengeLeftPayload {
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

export interface TeamLocationPayload {
  teamId: string;
  lat: number;
  lng: number;
}

// ── Client → Server events ──
// These are the messages the team's phone sends to the server.

export interface ClientToServerEvents {
  'challenge:abandon': (data: ChallengeActionPayload) => void;
  'challenge:activate': (data: ChallengeActionPayload) => void;
  'challenge:complete': (data: ChallengeActionPayload) => void;
  'game:join': (data: GameJoinPayload) => void;
  'location:update': (data: LocationUpdatePayload) => void;
}

// ── Server → Client events ──

export interface ActiveRestorePayload {
  challengeId: string;
}

export interface ServerToClientEvents {
  'active:restore': (data: ActiveRestorePayload) => void;
  'challenge:claimed': (data: ChallengeClaimedPayload) => void;
  'challenge:left': (data: ChallengeLeftPayload) => void;
  'challenge:spawned': (data: ChallengeSpawnedPayload) => void;
  'challenge:unlocked': (data: ChallengeUnlockedPayload) => void;
  'complete:failed': (data: CompleteFailedPayload) => void;
  'complete:success': (data: CompleteSuccessPayload) => void;
  'game:ended': (data: GameEndedPayload) => void;
  'leaderboard:update': (data: LeaderboardUpdatePayload) => void;
  'mode:change': (data: ModeChangePayload) => void;
  'team:location': (data: TeamLocationPayload) => void;
}
