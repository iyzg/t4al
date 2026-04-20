// ── Core data models ──

export type GameStatus = 'lobby' | 'active' | 'ended';

export interface Game {
  id: string;
  name: string;
  status: GameStatus;
  durationMinutes: number;
  activeChallengeCount: number;       // K — how many challenges active at once
  challengeExpireMinutes: number;     // X — minutes before an active challenge expires
  startingTokens: number;             // initial token balance for every team
  startTime: Date | null;
  endTime: Date | null;
  joinCode: string;
  adminCode: string;
  createdAt: Date;
}

export type ChallengeType = 'normal' | 'variable' | 'wager';
export type ChallengeStatus = 'queued' | 'active' | 'claimed' | 'expired';

export interface Challenge {
  id: string;
  gameId: string;

  name: string;
  description: string;
  type: ChallengeType;

  // Type-dependent token fields
  //   normal:   tokens non-null; tokensPerUnit + unitLabel null
  //   variable: tokensPerUnit + unitLabel non-null; tokens null
  //   wager:    all three null (team picks at wager-set time)
  tokens: number | null;
  tokensPerUnit: number | null;
  unitLabel: string | null;

  lat: number;
  lng: number;
  proximityMeters: number;

  sortOrder: number;

  status: ChallengeStatus;
  activatedAt: Date | null;
  claimedByTeamId: string | null;
  claimedAt: Date | null;
}

export interface Team {
  id: string;
  gameId: string;
  name: string;                       // unique within gameId
  color: string;                      // unique within gameId (from fixed palette)
  tokens: number;                     // current token balance
  activeChallengeId: string | null;   // the one challenge this team is working on
  wagerAmount: number | null;         // set when team locks in a wager (private to team)
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

export type GameEventType =
  | 'game:started'
  | 'game:ended'
  | 'team:created'
  | 'team:reassigned'
  | 'challenge:spawned'
  | 'challenge:accepted'
  | 'challenge:abandoned'
  | 'challenge:claimed'
  | 'challenge:expired'
  | 'challenge:wagerFailed';

export interface GameEvent {
  id: string;
  gameId: string;
  type: GameEventType;
  payload: Record<string, unknown>;
  createdAt: Date;
}

// ── Derived types (used in API responses + socket events) ──

export interface LeaderboardEntry {
  id: string;
  name: string;
  color: string;
  tokens: number;
  rank: number;
}

// Team info included in game:state snapshot (public, visible to all clients)
export interface TeamSnapshot {
  id: string;
  name: string;
  color: string;
  tokens: number;
  activeChallengeId: string | null;
}

// Private team state (delivered to team room only)
export interface TeamPrivateState {
  activeChallengeId: string | null;
  wagerAmount: number | null;
  tokens: number;
}
