// ── Core data models ──

export type GameStatus = 'lobby' | 'active' | 'ended';

export interface Game {
  id: string;
  name: string;
  status: GameStatus;
  durationMinutes: number;
  activeChallengeCount: number;       // K — how many challenges active at once
  challengeExpireMinutes: number;     // challenges expire after this many minutes
  startTime: Date | null;             // set when game starts
  endTime: Date | null;               // computed: startTime + durationMinutes
  joinCode: string;
  adminCode: string;
  createdAt: Date;
}

export type ChallengeStatus = 'queued' | 'active' | 'claimed' | 'expired';

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

  sortOrder: number;                  // queue position; admin sets this

  status: ChallengeStatus;
  activatedAt: Date | null;           // when this challenge became active (visible on map)
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

// Team info included in game:state snapshot
export interface TeamSnapshot {
  id: string;
  name: string;
  color: string;
  score: number;
  activeChallengeId: string | null;
}
