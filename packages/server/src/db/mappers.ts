// Map raw SQL rows to camelCase domain objects.
import type { Challenge, Game, Team, TeamSnapshot, LeaderboardEntry, TeamPrivateState } from '@t4al/shared';

export function mapGame(row: any): Game {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    durationMinutes: row.duration_minutes,
    activeChallengeCount: row.active_challenge_count,
    challengeExpireMinutes: row.challenge_expire_minutes,
    startingTokens: row.starting_tokens,
    startTime: row.start_time,
    endTime: row.end_time,
    joinCode: row.join_code,
    adminCode: row.admin_code,
    createdAt: row.created_at,
  };
}

export function mapChallenge(row: any): Challenge {
  return {
    id: row.id,
    gameId: row.game_id,
    name: row.name,
    description: row.description,
    type: row.type,
    tokens: row.tokens,
    tokensPerUnit: row.tokens_per_unit,
    unitLabel: row.unit_label,
    lat: row.lat,
    lng: row.lng,
    proximityMeters: row.proximity_meters,
    sortOrder: row.sort_order,
    status: row.status,
    activatedAt: row.activated_at,
    claimedByTeamId: row.claimed_by_team_id,
    claimedAt: row.claimed_at,
  };
}

export function mapTeam(row: any): Team {
  return {
    id: row.id,
    gameId: row.game_id,
    name: row.name,
    color: row.color,
    tokens: row.tokens,
    activeChallengeId: row.active_challenge_id,
    wagerAmount: row.wager_amount,
    joinedAt: row.joined_at,
  };
}

export function mapTeamSnapshot(row: any): TeamSnapshot {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    tokens: row.tokens,
    activeChallengeId: row.active_challenge_id,
  };
}

export function mapTeamPrivateState(row: any): TeamPrivateState {
  return {
    activeChallengeId: row.active_challenge_id,
    wagerAmount: row.wager_amount,
    tokens: row.tokens,
  };
}

export function mapLeaderboardEntry(row: any, rank: number): LeaderboardEntry {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    tokens: row.tokens,
    rank,
  };
}
