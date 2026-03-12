// ── Core data models ──

export type GameStatus = 'lobby' | 'active' | 'ended';
export type LeaderboardMode = 'full' | 'rank_only' | 'hidden';

export interface Game {
  id: string;
  name: string;
  status: GameStatus;
  durationMinutes: number;
  startTime: Date | null;       // set when game starts
  endTime: Date | null;         // computed: startTime + durationMinutes
  joinCode: string;
  adminCode: string;
  leaderboardMode: LeaderboardMode;
  createdAt: Date;
}

export type ChallengeStatus = 'scheduled' | 'active' | 'claimed';

export interface Challenge {
  id: string;
  gameId: string;

  // Content
  name: string;
  description: string;
  points: number;

  lat: number;
  lng: number;
  proximityMeters: number;

  spawnOffsetMinutes: number;

  status: ChallengeStatus;
  spawnedAt: Date | null;
  claimedByTeamId: string | null;
  claimedAt: Date | null;
}

export interface Team {
  id: string;
  gameId: string;
  name: string;
  color: string;
  score: number;
  activeChallengeId: string | null;
  joinedAt: Date;
}

export type SegmentMode = 'blackout';

export interface GameModeSegment {
  id: string;
  gameId: string;
  mode: SegmentMode;
  startOffsetMinutes: number;
  endOffsetMinutes: number;
}

export interface LocationHistory {
  id: string;
  teamId: string;
  gameId: string;
  lat: number;
  lng: number;
  recordedAt: Date;
}

export interface GameEvent {
  id: string;
  gameId: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}

// ── Derived types (used in API responses + socket events) ──

export interface LeaderboardEntry {
  id: string;
  name: string;
  color: string;
  score: number;
  rank: number;
}
