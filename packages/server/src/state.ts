// In-memory state for the server. See SPECS §2 and §4.4.
//
// All of these are lost on process restart; recovery logic in index.ts rebuilds
// what's rebuildable (timers, intervals). devicePings are lost but clients re-ping
// every 5s. deviceTeam is re-populated by clients re-emitting game:join.

import type { Socket } from 'socket.io';

// deviceId → team membership. A device can only be in one game at a time;
// opening a new game replaces the entry.
export const deviceTeam = new Map<string, { gameId: string; teamId: string }>();

// deviceId → connected sockets. One device may have multiple sockets (tabs).
// Used to find sockets when the admin reassigns a device to another team.
export const deviceSockets = new Map<string, Set<Socket>>();

// Latest ping from each device, keyed by deviceId.
// RETAINED across games for post-game data analysis (user preference).
export const devicePings = new Map<string, {
  teamId: string;
  gameId: string;
  lat: number;
  lng: number;
  updatedAt: Date;
}>();

// Expiration timers for active challenges, keyed by challengeId.
export const challengeTimers = new Map<string, NodeJS.Timeout>();

// Per-game end timers.
export const gameEndTimers = new Map<string, NodeJS.Timeout>();

// Per-game admin position broadcast intervals.
export const adminPositionIntervals = new Map<string, NodeJS.Timeout>();

// ── Helpers ──

import { DEVICE_PING_STALE_MS } from '@t4al/shared';

/**
 * Average of the latest ping from each device on `teamId` that pinged within
 * the freshness window. Returns null if no fresh pings exist.
 */
export function getTeamPosition(teamId: string): { lat: number; lng: number } | null {
  const cutoff = Date.now() - DEVICE_PING_STALE_MS;
  const active: { lat: number; lng: number }[] = [];
  for (const p of devicePings.values()) {
    if (p.teamId === teamId && p.updatedAt.getTime() > cutoff) {
      active.push({ lat: p.lat, lng: p.lng });
    }
  }
  if (active.length === 0) return null;
  const lat = active.reduce((s, p) => s + p.lat, 0) / active.length;
  const lng = active.reduce((s, p) => s + p.lng, 0) / active.length;
  return { lat, lng };
}

/** Register a socket for a device. Multiple sockets per device are allowed. */
export function registerSocket(deviceId: string, socket: Socket) {
  let set = deviceSockets.get(deviceId);
  if (!set) {
    set = new Set();
    deviceSockets.set(deviceId, set);
  }
  set.add(socket);
}

/** Remove a socket on disconnect. */
export function unregisterSocket(deviceId: string, socket: Socket) {
  const set = deviceSockets.get(deviceId);
  if (!set) return;
  set.delete(socket);
  if (set.size === 0) deviceSockets.delete(deviceId);
}

/** All connected sockets for a device (e.g. to emit to every tab). */
export function socketsForDevice(deviceId: string): Socket[] {
  return [...(deviceSockets.get(deviceId) ?? [])];
}
