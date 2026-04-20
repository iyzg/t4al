import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import maplibregl from 'maplibre-gl';
import { getMapStyle, CHICAGO_CENTER } from '../mapStyle';
import { ensurePmtilesProtocol } from '../mapSetup';
import { socket } from '../socket';
import { useGameStore } from '../store';
import { registerSocketHandlers } from '../socketHandlers';
import type { Challenge, ChallengeType, Game, GameEvent, Team } from '@t4al/shared';

ensurePmtilesProtocol();

function adminHeaders(gameId: string | undefined): HeadersInit {
  const code = gameId ? localStorage.getItem(`adminCode:${gameId}`) ?? '' : '';
  return { 'Content-Type': 'application/json', 'x-admin-code': code };
}

function typeColor(t: ChallengeType): string {
  return t === 'normal' ? '#3498db' : t === 'variable' ? '#2ecc71' : '#9b59b6';
}

function formatEvent(type: string, payload: any): string {
  switch (type) {
    case 'game:started':        return 'Game started';
    case 'game:ended':          return 'Game ended';
    case 'team:created':        return `Team created: ${payload.name ?? ''}`;
    case 'team:reassigned':     return `Device reassigned to team ${payload.toTeamId ?? ''}`;
    case 'challenge:spawned':   return `"${payload.name ?? '?'}" spawned (${payload.type ?? ''})`;
    case 'challenge:accepted':  return `Team accepted a challenge`;
    case 'challenge:abandoned': return `Team abandoned a challenge`;
    case 'challenge:expired':   return `Challenge expired`;
    case 'challenge:claimed':
      return `${payload.teamName ?? 'Team'} claimed a challenge (+${payload.tokensAwarded ?? '?'})`;
    case 'challenge:wagerFailed':
      return `Team failed a wager (−${payload.wagerAmount ?? '?'})`;
    default: return `${type}`;
  }
}

export default function AdminLivePage() {
  const { gameId } = useParams<{ gameId: string }>();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const challengeMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const teamMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());

  const [game, setGame] = useState<Game | null>(null);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [countdown, setCountdown] = useState('');
  const [error, setError] = useState('');
  const [teamsPositions, setTeamsPositions] = useState<{ teamId: string; lat: number; lng: number }[]>([]);

  // Admin auth + socket connect
  useEffect(() => {
    if (!gameId) return;
    const adminCode = localStorage.getItem(`adminCode:${gameId}`);
    if (!adminCode) {
      setError('Admin code missing from localStorage. Navigate back through the game-creation flow.');
      return;
    }
    useGameStore.getState().setAdminCode(adminCode);
    registerSocketHandlers();
    socket.connect();
    socket.emit('admin:join', { gameId, adminCode });

    socket.on('teams:positions', (data) => {
      setTeamsPositions(data.positions);
    });
    return () => { socket.off('teams:positions'); };
  }, [gameId]);

  // Fetch data initially and poll periodically (lightweight supplement to sockets)
  useEffect(() => {
    if (!gameId) return;
    const fetchData = async () => {
      try {
        const [gRes, cRes, tRes, eRes] = await Promise.all([
          fetch(`/api/games/${gameId}`, { headers: adminHeaders(gameId) }),
          fetch(`/api/games/${gameId}/challenges`, { headers: adminHeaders(gameId) }),
          fetch(`/api/games/${gameId}/teams`),
          fetch(`/api/games/${gameId}/events`, { headers: adminHeaders(gameId) }),
        ]);
        if (gRes.ok) setGame(await gRes.json());
        if (cRes.ok) setChallenges(await cRes.json());
        if (tRes.ok) setTeams(await tRes.json());
        if (eRes.ok) setEvents(await eRes.json());
      } catch { /* skip cycle */ }
    };
    fetchData();
    const id = setInterval(fetchData, 5000);
    return () => clearInterval(id);
  }, [gameId]);

  // Countdown
  useEffect(() => {
    if (!game?.endTime) { setCountdown(''); return; }
    const endTime = new Date(game.endTime).getTime();
    const tick = () => {
      const diff = endTime - Date.now();
      if (diff <= 0) { setCountdown('0:00'); return; }
      const min = Math.floor(diff / 60000);
      const sec = Math.floor((diff % 60000) / 1000);
      setCountdown(`${min}:${sec.toString().padStart(2, '0')}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [game?.endTime]);

  // Init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    try {
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: getMapStyle(),
        center: CHICAGO_CENTER,
        zoom: 14,
      });
      mapRef.current = map;
      return () => { map.remove(); mapRef.current = null; };
    } catch (err) { console.warn('Map init failed:', err); }
  }, []);

  // Challenge markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const ids = new Set(challenges.map((c) => c.id));
    challengeMarkersRef.current.forEach((m, id) => {
      if (!ids.has(id)) { m.remove(); challengeMarkersRef.current.delete(id); }
    });
    challenges.forEach((c) => {
      const color = c.status === 'claimed'   ? '#2ecc71'
                  : c.status === 'active'    ? typeColor(c.type)
                  : c.status === 'expired'   ? '#e74c3c'
                  : '#666';
      const existing = challengeMarkersRef.current.get(c.id);
      if (existing) {
        existing.getElement().style.background = color;
        existing.getElement().title = `${c.name} [${c.status}]`;
        return;
      }
      const el = document.createElement('div');
      el.style.cssText = `width:12px;height:12px;background:${color};border-radius:50%;border:2px solid white;`;
      el.title = `${c.name} [${c.status}]`;
      const marker = new maplibregl.Marker({ element: el }).setLngLat([c.lng, c.lat]).addTo(map);
      challengeMarkersRef.current.set(c.id, marker);
    });
  }, [challenges]);

  // Team position markers (from live admin broadcast)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const ids = new Set(teamsPositions.map((p) => p.teamId));
    teamMarkersRef.current.forEach((m, id) => {
      if (!ids.has(id)) { m.remove(); teamMarkersRef.current.delete(id); }
    });
    teamsPositions.forEach((p) => {
      const team = teams.find((t) => t.id === p.teamId);
      const existing = teamMarkersRef.current.get(p.teamId);
      if (existing) {
        existing.setLngLat([p.lng, p.lat]);
        return;
      }
      const el = document.createElement('div');
      el.style.cssText = `width:18px;height:18px;background:${team?.color ?? '#ccc'};border:3px solid white;border-radius:50%;box-shadow:0 0 8px rgba(0,0,0,0.6);`;
      el.title = team?.name ?? '';
      const marker = new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map);
      teamMarkersRef.current.set(p.teamId, marker);
    });
  }, [teamsPositions, teams]);

  // Controls
  async function handleStart() {
    if (!gameId) return;
    const res = await fetch(`/api/games/${gameId}/start`, { method: 'POST', headers: adminHeaders(gameId) });
    if (!res.ok) { const e = await res.json().catch(() => null); setError(e?.error || 'Start failed'); }
  }

  async function handleEnd() {
    if (!gameId) return;
    if (!confirm('Force-end this game?')) return;
    const res = await fetch(`/api/games/${gameId}/end`, { method: 'POST', headers: adminHeaders(gameId) });
    if (!res.ok) { const e = await res.json().catch(() => null); setError(e?.error || 'End failed'); }
  }

  async function handleReassign(deviceId: string, newTeamId: string) {
    if (!gameId) return;
    const res = await fetch(`/api/games/${gameId}/reassign-device`, {
      method: 'POST', headers: adminHeaders(gameId),
      body: JSON.stringify({ deviceId, newTeamId }),
    });
    if (!res.ok) { const e = await res.json().catch(() => null); setError(e?.error || 'Reassign failed'); }
  }

  const gameStatus = game?.status ?? 'loading';
  const statusBuckets = {
    queued:  challenges.filter((c) => c.status === 'queued'),
    active:  challenges.filter((c) => c.status === 'active'),
    claimed: challenges.filter((c) => c.status === 'claimed'),
    expired: challenges.filter((c) => c.status === 'expired'),
  };

  return (
    <div className="admin-layout" style={{ display: 'flex', height: '100vh' }}>
      <div ref={containerRef} className="admin-map" style={{ flex: 1 }} />

      <div className="admin-sidebar" style={{
        width: 380, background: '#1a1a2e', color: 'white', overflow: 'auto', padding: 16,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>Admin</h2>
          {gameStatus === 'lobby' && (
            <a href={`/game/${gameId}/admin/setup`} style={{ color: '#3498db', textDecoration: 'none', fontSize: 14 }}>
              Edit Challenges
            </a>
          )}
        </div>

        {error && <p style={{ color: '#e74c3c', margin: '0 0 8px' }}>{error}</p>}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{
            padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 'bold',
            background: gameStatus === 'active' ? '#2ecc71'
                      : gameStatus === 'ended'  ? '#e74c3c' : '#f39c12',
          }}>
            {gameStatus.toUpperCase()}
          </span>
          {countdown && <span style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 'bold' }}>{countdown}</span>}
        </div>

        {game && (
          <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 12 }}>
            Join: <code style={{ letterSpacing: 1 }}>{game.joinCode}</code>
            {' · '}K={game.activeChallengeCount} X={game.challengeExpireMinutes}m
            {' · '}start: {game.startingTokens}
          </div>
        )}

        {/* Controls */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button onClick={handleStart} disabled={gameStatus !== 'lobby'}
            style={{ flex: 1, padding: 8, background: gameStatus === 'lobby' ? '#2ecc71' : '#555', border: 'none', borderRadius: 4, color: 'white', cursor: gameStatus === 'lobby' ? 'pointer' : 'not-allowed' }}>
            Start Game
          </button>
          <button onClick={handleEnd} disabled={gameStatus !== 'active'}
            style={{ flex: 1, padding: 8, background: gameStatus === 'active' ? '#e74c3c' : '#555', border: 'none', borderRadius: 4, color: 'white', cursor: gameStatus === 'active' ? 'pointer' : 'not-allowed' }}>
            End Game
          </button>
        </div>

        {/* Teams */}
        <h3>Teams ({teams.length})</h3>
        {teams.length === 0 && <p style={{ opacity: 0.5, fontSize: 13 }}>No teams yet</p>}
        {teams.map((t) => (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontSize: 14 }}>
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: t.color }} />
            <span>{t.name}</span>
            {t.activeChallengeId && <span style={{ fontSize: 11, opacity: 0.5 }}>(active)</span>}
            <span style={{ marginLeft: 'auto', fontWeight: 'bold' }}>{t.tokens} 🪙</span>
          </div>
        ))}

        {/* Reassign device (active-game only) */}
        {gameStatus === 'active' && (
          <ReassignDeviceForm teams={teams} onSubmit={handleReassign} />
        )}

        {/* Challenges by bucket */}
        <h3>Challenges ({challenges.length})</h3>
        <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>
          {statusBuckets.queued.length} queued · {statusBuckets.active.length} active · {statusBuckets.claimed.length} claimed · {statusBuckets.expired.length} expired
        </div>
        {[...challenges].sort((a, b) => a.sortOrder - b.sortOrder).map((c) => (
          <div key={c.id} style={{ marginBottom: 4, fontSize: 13 }}>
            <span style={{
              fontSize: 10, padding: '1px 6px', borderRadius: 8, marginRight: 6,
              background: typeColor(c.type), fontWeight: 'bold', letterSpacing: 0.5,
            }}>
              {c.type.charAt(0).toUpperCase()}
            </span>
            <span style={{
              color: c.status === 'claimed' ? '#2ecc71'
                   : c.status === 'active'  ? typeColor(c.type)
                   : c.status === 'expired' ? '#e74c3c' : '#888',
            }}>
              [{c.status}]
            </span>{' '}
            {c.name}
          </div>
        ))}

        {/* Event log */}
        <h3>Event Log</h3>
        <div style={{ fontSize: 12, opacity: 0.8, maxHeight: 300, overflow: 'auto' }}>
          {events.length === 0 && <p>No events yet</p>}
          {events.map((e) => (
            <div key={e.id} style={{ marginBottom: 4 }}>
              <span style={{ opacity: 0.5 }}>{new Date(e.createdAt).toLocaleTimeString()}</span>{' '}
              {formatEvent(e.type, e.payload)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ReassignDeviceForm({
  teams, onSubmit,
}: {
  teams: Team[];
  onSubmit: (deviceId: string, newTeamId: string) => void;
}) {
  const [deviceId, setDeviceId] = useState('');
  const [newTeamId, setNewTeamId] = useState('');
  return (
    <div style={{ marginTop: 16, padding: 10, background: '#2a2a3e', borderRadius: 6 }}>
      <div style={{ fontSize: 13, fontWeight: 'bold', marginBottom: 6 }}>Reassign Device</div>
      <input placeholder="deviceId (from user's localStorage)"
        value={deviceId} onChange={(e) => setDeviceId(e.target.value)}
        style={{ width: '100%', padding: 4, boxSizing: 'border-box', fontSize: 12, marginBottom: 6, background: '#1a1a2e', color: 'white', border: '1px solid #444', borderRadius: 4 }}
      />
      <select value={newTeamId} onChange={(e) => setNewTeamId(e.target.value)}
        style={{ width: '100%', padding: 4, fontSize: 12, background: '#1a1a2e', color: 'white', border: '1px solid #444', borderRadius: 4 }}>
        <option value="">Select new team…</option>
        {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <button
        onClick={() => { if (deviceId && newTeamId) { onSubmit(deviceId, newTeamId); setDeviceId(''); setNewTeamId(''); } }}
        disabled={!deviceId || !newTeamId}
        style={{ marginTop: 6, padding: '6px 12px', background: '#3498db', border: 'none', borderRadius: 4, color: 'white', cursor: 'pointer', fontSize: 12, opacity: (deviceId && newTeamId) ? 1 : 0.5 }}
      >
        Move
      </button>
    </div>
  );
}
