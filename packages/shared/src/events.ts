import type {
  Challenge,
  Game,
  LeaderboardEntry,
  TeamPrivateState,
  TeamSnapshot,
} from './types.js';

// ── Action acks (returned as the last argument of each action emit) ──

export type AckReason =
  | 'team_busy'              // team already has an active challenge
  | 'challenge_unavailable'  // claimed or expired before your tap landed
  | 'invalid_state'          // e.g. not your team's active, abandon-after-wager-lock
  | 'bad_input'              // count < 1, wager out of range, etc.
  | 'not_authorized'         // admin-only or team mismatch
  | 'unknown';               // server error fallback

export type ActionAck = { ok: true } | { ok: false; reason: AckReason };

// ── Client → Server payloads ──

export interface GameJoinPayload {
  gameId: string;
  teamId: string;
  deviceId: string;
}

export interface AdminJoinPayload {
  gameId: string;
  adminCode: string;
}

export interface LocationUpdatePayload {
  deviceId: string;
  teamId: string;
  lat: number;
  lng: number;
}

export interface ChallengeActionPayload {
  challengeId: string;
  teamId: string;
}

export interface ChallengeWagerPayload {
  challengeId: string;
  teamId: string;
  wagerAmount: number;
}

export interface ChallengeCompletePayload {
  challengeId: string;
  teamId: string;
  count?: number; // variable type only; ≥ 1
}

// ── Server → Client payloads ──

export interface GameStartedPayload {
  game: Game;
  challenges: Challenge[]; // the K freshly-activated challenges
}

export interface GameEndedPayload {
  finalStandings: LeaderboardEntry[];
}

export interface ChallengeSpawnedPayload {
  challenge: Challenge;
}

export interface ChallengeClaimedPayload {
  challengeId: string;
  teamId: string;
  teamName: string;
  tokensAwarded: number;
}

export interface ChallengeExpiredPayload {
  challengeId: string;
}

export interface ChallengeAcceptedPayload {
  challengeId: string;
  teamId: string;
}

export interface ChallengeAbandonedPayload {
  challengeId: string;
  teamId: string;
}

export interface ChallengeWagerFailedPayload {
  challengeId: string;
  teamId: string;
}

export interface LeaderboardUpdatePayload {
  teams: LeaderboardEntry[];
}

export interface ChallengeYankedPayload {
  challengeId: string;
  reason: 'claimed' | 'expired';
}

export interface CompleteSuccessPayload {
  challengeId: string;
  tokensAwarded: number;
}

export interface WagerResultPayload {
  challengeId: string;
  outcome: 'pass' | 'fail';
  tokensDelta: number;
}

export interface TeamsPositionsPayload {
  positions: { teamId: string; lat: number; lng: number }[];
}

export interface GameStatePayload {
  game: Game;
  teams: TeamSnapshot[];
  challenges: Challenge[]; // active challenges only; descriptions included (client gates visibility)
}

// ── Client → Server event map ──
//
// All action events take an ack callback as their last argument.
// game:join, admin:join, location:update are fire-and-forget.

export interface ClientToServerEvents {
  'game:join':          (data: GameJoinPayload) => void;
  'admin:join':         (data: AdminJoinPayload) => void;
  'location:update':    (data: LocationUpdatePayload) => void;

  'challenge:accept':   (data: ChallengeActionPayload,   ack: (r: ActionAck) => void) => void;
  'challenge:wager':    (data: ChallengeWagerPayload,    ack: (r: ActionAck) => void) => void;
  'challenge:complete': (data: ChallengeCompletePayload, ack: (r: ActionAck) => void) => void;
  'challenge:fail':     (data: ChallengeActionPayload,   ack: (r: ActionAck) => void) => void;
  'challenge:abandon':  (data: ChallengeActionPayload,   ack: (r: ActionAck) => void) => void;
}

// ── Server → Client event map ──

export interface ServerToClientEvents {
  // Game room
  'game:started':          (data: GameStartedPayload) => void;
  'game:ended':            (data: GameEndedPayload) => void;
  'challenge:spawned':     (data: ChallengeSpawnedPayload) => void;
  'challenge:claimed':     (data: ChallengeClaimedPayload) => void;
  'challenge:expired':     (data: ChallengeExpiredPayload) => void;
  'challenge:accepted':    (data: ChallengeAcceptedPayload) => void;
  'challenge:abandoned':   (data: ChallengeAbandonedPayload) => void;
  'challenge:wagerFailed': (data: ChallengeWagerFailedPayload) => void;
  'leaderboard:update':    (data: LeaderboardUpdatePayload) => void;

  // Team room (private)
  'challenge:yanked':      (data: ChallengeYankedPayload) => void;
  'complete:success':      (data: CompleteSuccessPayload) => void;
  'wager:result':          (data: WagerResultPayload) => void;
  'team:state':            (data: TeamPrivateState) => void;

  // Admin room
  'teams:positions':       (data: TeamsPositionsPayload) => void;

  // Sent directly to the joining socket on connect
  'game:state':            (data: GameStatePayload) => void;
}
