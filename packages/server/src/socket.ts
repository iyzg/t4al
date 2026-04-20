// Socket.io handlers for V2: deviceId-aware game:join, admin:join with
// adminCode validation, action events with acks. See SPECS §4.1 and §5.
//
// All mutating actions go through the lifecycle module so broadcasts +
// event-log writes are centralized there.

import type { Server, Socket } from 'socket.io';
import type {
  ActionAck,
  ChallengeActionPayload,
  ChallengeCompletePayload,
  ChallengeWagerPayload,
  GameJoinPayload,
  AdminJoinPayload,
  LocationUpdatePayload,
  TeamSnapshot,
} from '@t4al/shared';
import * as repo from './db/repo.js';
import * as lifecycle from './lifecycle.js';
import {
  devicePings,
  deviceTeam,
  registerSocket,
  unregisterSocket,
} from './state.js';

function gameRoom(gameId: string)  { return `game:${gameId}`; }
function teamRoom(teamId: string)  { return `team:${teamId}`; }
function adminRoom(gameId: string) { return `admin:${gameId}`; }

export function registerSocketHandlers(io: Server) {
  io.on('connection', (socket) => {
    console.log('client connected:', socket.id);

    // ── game:join ──────────────────────────────────────────────────────
    socket.on('game:join', async (data: GameJoinPayload) => {
      if (!data?.gameId || !data?.teamId || !data?.deviceId) return;

      // Verify team exists in this game
      const team = await repo.getTeam(data.teamId);
      if (!team || team.gameId !== data.gameId) return;

      const game = await repo.getGame(data.gameId);
      if (!game) return;

      // Leave prior rooms if re-joining from a different game/team
      const prevGameId = socket.data.gameId;
      const prevTeamId = socket.data.teamId;
      const prevDeviceId = socket.data.deviceId;
      if (prevGameId && prevGameId !== data.gameId) socket.leave(gameRoom(prevGameId));
      if (prevTeamId && prevTeamId !== data.teamId) socket.leave(teamRoom(prevTeamId));
      if (prevDeviceId && prevDeviceId !== data.deviceId) {
        unregisterSocket(prevDeviceId, socket);
      }

      // Join rooms
      socket.join(gameRoom(data.gameId));
      socket.join(teamRoom(data.teamId));
      socket.data.gameId   = data.gameId;
      socket.data.teamId   = data.teamId;
      socket.data.deviceId = data.deviceId;
      socket.data.isAdmin  = false;

      // Track device → team
      deviceTeam.set(data.deviceId, { gameId: data.gameId, teamId: data.teamId });
      registerSocket(data.deviceId, socket);

      // Emit game:state snapshot
      const teams = await repo.listTeams(data.gameId);
      const teamSnapshots: TeamSnapshot[] = teams.map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        tokens: t.tokens,
        activeChallengeId: t.activeChallengeId,
      }));
      const challenges = await repo.listActiveChallenges(data.gameId);
      socket.emit('game:state', { game, teams: teamSnapshots, challenges });

      // Emit team:state (private) to this team's room
      lifecycle.emitTeamState(io, data.teamId);
    });

    // ── admin:join ─────────────────────────────────────────────────────
    socket.on('admin:join', async (data: AdminJoinPayload) => {
      if (!data?.gameId || !data?.adminCode) return;
      const game = await repo.getGame(data.gameId);
      if (!game || game.adminCode !== data.adminCode) return;

      socket.join(gameRoom(data.gameId));
      socket.join(adminRoom(data.gameId));
      socket.data.gameId  = data.gameId;
      socket.data.isAdmin = true;

      const teams = await repo.listTeams(data.gameId);
      const teamSnapshots: TeamSnapshot[] = teams.map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        tokens: t.tokens,
        activeChallengeId: t.activeChallengeId,
      }));
      const challenges = await repo.listActiveChallenges(data.gameId);
      socket.emit('game:state', { game, teams: teamSnapshots, challenges });
    });

    // ── location:update ────────────────────────────────────────────────
    socket.on('location:update', (data: LocationUpdatePayload) => {
      if (!data?.deviceId || !data?.teamId) return;
      if (typeof data.lat !== 'number' || typeof data.lng !== 'number') return;
      devicePings.set(data.deviceId, {
        teamId:    data.teamId,
        gameId:    socket.data.gameId ?? '',
        lat:       data.lat,
        lng:       data.lng,
        updatedAt: new Date(),
      });
    });

    // ── challenge:accept ───────────────────────────────────────────────
    socket.on(
      'challenge:accept',
      async (data: ChallengeActionPayload, ack: (r: ActionAck) => void) => {
        const gameId = socket.data.gameId;
        if (!gameId || !data?.challengeId || !data?.teamId) {
          return ack({ ok: false, reason: 'bad_input' });
        }
        // Defensive: socket's team must match payload
        if (socket.data.teamId && socket.data.teamId !== data.teamId) {
          return ack({ ok: false, reason: 'not_authorized' });
        }

        const team = await repo.acceptChallenge(data.teamId, data.challengeId);
        if (!team) {
          // Either team was busy or challenge was unavailable. Cheap way to
          // disambiguate: read team's current state.
          const current = await repo.getTeam(data.teamId);
          if (current?.activeChallengeId) {
            return ack({ ok: false, reason: 'team_busy' });
          }
          return ack({ ok: false, reason: 'challenge_unavailable' });
        }

        io.to(gameRoom(gameId)).emit('challenge:accepted', {
          challengeId: data.challengeId,
          teamId:      data.teamId,
        });
        repo.logEvent(gameId, 'challenge:accepted', {
          challengeId: data.challengeId,
          teamId:      data.teamId,
        });
        lifecycle.emitTeamState(io, data.teamId);
        ack({ ok: true });
      },
    );

    // ── challenge:wager ────────────────────────────────────────────────
    socket.on(
      'challenge:wager',
      async (data: ChallengeWagerPayload, ack: (r: ActionAck) => void) => {
        if (!data?.challengeId || !data?.teamId || typeof data.wagerAmount !== 'number') {
          return ack({ ok: false, reason: 'bad_input' });
        }
        if (data.wagerAmount < 1) {
          return ack({ ok: false, reason: 'bad_input' });
        }

        const team = await repo.setWager(data.teamId, data.challengeId, data.wagerAmount);
        if (!team) return ack({ ok: false, reason: 'invalid_state' });

        lifecycle.emitTeamState(io, data.teamId);
        ack({ ok: true });
      },
    );

    // ── challenge:complete ─────────────────────────────────────────────
    socket.on(
      'challenge:complete',
      async (data: ChallengeCompletePayload, ack: (r: ActionAck) => void) => {
        const gameId = socket.data.gameId;
        if (!gameId || !data?.challengeId || !data?.teamId) {
          return ack({ ok: false, reason: 'bad_input' });
        }
        const result = await lifecycle.completeAndBroadcast(
          io,
          gameId,
          data.teamId,
          data.challengeId,
          data.count,
        );
        ack(result as ActionAck);
      },
    );

    // ── challenge:fail (wager) ─────────────────────────────────────────
    socket.on(
      'challenge:fail',
      async (data: ChallengeActionPayload, ack: (r: ActionAck) => void) => {
        const gameId = socket.data.gameId;
        if (!gameId || !data?.challengeId || !data?.teamId) {
          return ack({ ok: false, reason: 'bad_input' });
        }
        const result = await lifecycle.failWagerAndBroadcast(
          io,
          gameId,
          data.teamId,
          data.challengeId,
        );
        ack(result as ActionAck);
      },
    );

    // ── challenge:abandon ──────────────────────────────────────────────
    socket.on(
      'challenge:abandon',
      async (data: ChallengeActionPayload, ack: (r: ActionAck) => void) => {
        const gameId = socket.data.gameId;
        if (!gameId || !data?.challengeId || !data?.teamId) {
          return ack({ ok: false, reason: 'bad_input' });
        }
        const result = await lifecycle.abandonAndBroadcast(
          io,
          gameId,
          data.teamId,
          data.challengeId,
        );
        ack(result as ActionAck);
      },
    );

    // ── disconnect ─────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      const deviceId = socket.data.deviceId;
      if (deviceId) unregisterSocket(deviceId, socket);
      console.log('client disconnected:', socket.id);
    });
  });
}
