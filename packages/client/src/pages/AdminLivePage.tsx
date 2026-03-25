import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import maplibregl from 'maplibre-gl';
import { getMapStyle, CHICAGO_CENTER } from '../mapStyle';
import { ensurePmtilesProtocol } from '../mapSetup';

ensurePmtilesProtocol();

interface GameEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

interface ChallengeRow {
  id: string;
  name: string;
  status: string;
  points: number;
  lat: number;
  lng: number;
  claimed_by_team_id: string | null;
}

interface TeamRow {
  id: string;
  name: string;
  color: string;
  score: number;
}

interface GameRow {
  id: string;
  name: string;
  status: string;
  duration_minutes: number;
  end_time: string | null;
  join_code: string;
  admin_code: string;
}

export default function AdminLivePage() {
  const { gameId } = useParams<{ gameId: string }>();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());

  const [game, setGame] = useState<GameRow | null>(null);
  const [challenges, setChallenges] = useState<ChallengeRow[]>([]);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [countdown, setCountdown] = useState('');

  // Editable game settings
  const [editName, setEditName] = useState('');
  const [editDuration, setEditDuration] = useState(60);
  const [settingsDirty, setSettingsDirty] = useState(false);

  // Poll for updates every 5s
  const initializedRef = useRef(false);
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [gRes, cRes, tRes, eRes] = await Promise.all([
          fetch(`/api/games/${gameId}`),
          fetch(`/api/games/${gameId}/challenges`),
          fetch(`/api/games/${gameId}/teams`),
          fetch(`/api/games/${gameId}/events`).catch(() => null),
        ]);
        if (!gRes.ok || !cRes.ok || !tRes.ok) return; // silently skip on error
        const gameData = await gRes.json();
        setGame(gameData);
        setChallenges(await cRes.json());
        setTeams(await tRes.json());
        if (eRes?.ok) setEvents(await eRes.json());

        // Seed edit fields on first load
        if (!initializedRef.current) {
          initializedRef.current = true;
          setEditName(gameData.name);
          setEditDuration(gameData.duration_minutes);
        }
      } catch {
        // Network error or JSON parse failure — skip this poll cycle
      }
    };
    fetchData();
    const id = setInterval(fetchData, 5000);
    return () => clearInterval(id);
  }, [gameId]);

  // Countdown timer
  useEffect(() => {
    if (!game?.end_time) { setCountdown(''); return; }
    const endTime = new Date(game.end_time).getTime();
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
  }, [game?.end_time]);

  // Initialize map
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
      return () => {
        map.remove();
        mapRef.current = null;
      };
    } catch (err) {
      console.warn('Map failed to initialize:', err);
    }
  }, []);

  // Sync challenge markers on map
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const currentIds = new Set(challenges.map((c) => c.id));

    // Remove stale markers
    markersRef.current.forEach((marker, id) => {
      if (!currentIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    });

    // Add/update markers
    challenges.forEach((c) => {
      const color =
        c.status === 'claimed' ? '#2ecc71'
        : c.status === 'active' ? '#f39c12'
        : '#666';

      const existing = markersRef.current.get(c.id);
      if (existing) {
        // Update color
        existing.getElement().style.background = color;
        return;
      }

      const el = document.createElement('div');
      el.style.cssText = `width:12px;height:12px;background:${color};border-radius:50%;border:2px solid white;`;
      el.title = `${c.name} [${c.status}] (${c.points} pts)`;
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([c.lng, c.lat])
        .addTo(map);
      markersRef.current.set(c.id, marker);
    });
  }, [challenges]);

  async function handleSaveSettings() {
    const res = await fetch(`/api/games/${gameId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editName, durationMinutes: editDuration }),
    });
    if (res.ok) {
      const updated = await res.json();
      setGame(updated);
      setSettingsDirty(false);
    }
  }

  async function handleStartGame() {
    await fetch(`/api/games/${gameId}/start`, { method: 'POST' });
  }

  async function handleForceEnd() {
    if (!confirm('Force end this game?')) return;
    await fetch(`/api/games/${gameId}/end`, { method: 'POST' });
  }

  const gameStatus = game?.status ?? 'loading';

  return (
    <div className="admin-layout" style={{ display: 'flex', height: '100vh' }}>
      {/* Map */}
      <div ref={containerRef} className="admin-map" style={{ flex: 1 }} />

      {/* Sidebar */}
      <div className="admin-sidebar" style={{ width: 350, background: '#1a1a2e', color: 'white', overflow: 'auto', padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>Admin Panel</h2>
          <a href={`/game/${gameId}/admin/setup`}
            style={{ color: '#3498db', textDecoration: 'none', fontSize: 14 }}>
            Edit Challenges
          </a>
        </div>

        {/* Game status + timer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <span style={{
            padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 'bold',
            background: gameStatus === 'active' ? '#2ecc71' : gameStatus === 'ended' ? '#e74c3c' : '#f39c12',
          }}>
            {gameStatus.toUpperCase()}
          </span>
          {countdown && (
            <span style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 'bold' }}>
              {countdown}
            </span>
          )}
        </div>

        {/* Codes */}
        {game && (
          <div style={{ marginBottom: 16, fontSize: 13, display: 'flex', gap: 16 }}>
            <div>
              <span style={{ opacity: 0.5 }}>Join Code </span>
              <code style={{ fontSize: 15, letterSpacing: 1 }}>{game.join_code}</code>
            </div>
            <div>
              <span style={{ opacity: 0.5 }}>Admin Code </span>
              <code style={{ fontSize: 15, letterSpacing: 1 }}>{game.admin_code}</code>
            </div>
          </div>
        )}

        {/* Game Settings */}
        <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 12, opacity: 0.5 }}>Game Name</label>
          <input value={editName}
            onChange={(e) => { setEditName(e.target.value); setSettingsDirty(true); }}
            style={{ padding: 6, borderRadius: 4, border: '1px solid #444', background: '#2a2a3e', color: 'white' }}
          />
          <label style={{ fontSize: 12, opacity: 0.5 }}>Duration (minutes)</label>
          <input type="number" value={editDuration} min={10} max={480}
            onChange={(e) => { setEditDuration(Number(e.target.value)); setSettingsDirty(true); }}
            style={{ padding: 6, borderRadius: 4, border: '1px solid #444', background: '#2a2a3e', color: 'white', width: 100 }}
          />
          {settingsDirty && (
            <button onClick={handleSaveSettings}
              style={{ padding: 6, background: '#3498db', border: 'none', borderRadius: 4, color: 'white', cursor: 'pointer', alignSelf: 'flex-start' }}>
              Save Changes
            </button>
          )}
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button onClick={handleStartGame} disabled={gameStatus !== 'lobby'}
            style={{ flex: 1, padding: 8, background: gameStatus === 'lobby' ? '#2ecc71' : '#555', border: 'none', borderRadius: 4, color: 'white', cursor: gameStatus === 'lobby' ? 'pointer' : 'not-allowed' }}>
            Start Game
          </button>
          <button onClick={handleForceEnd} disabled={gameStatus !== 'active'}
            style={{ flex: 1, padding: 8, background: gameStatus === 'active' ? '#e74c3c' : '#555', border: 'none', borderRadius: 4, color: 'white', cursor: gameStatus === 'active' ? 'pointer' : 'not-allowed' }}>
            End Game
          </button>
        </div>

        {/* Teams */}
        <h3>Teams ({teams.length})</h3>
        {teams.length === 0 && <p style={{ opacity: 0.5, fontSize: 13 }}>No teams yet</p>}
        {teams.map((t) => (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: t.color }} />
            <span>{t.name}</span>
            <span style={{ marginLeft: 'auto', fontWeight: 'bold' }}>{t.score} pts</span>
          </div>
        ))}

        {/* Challenges */}
        <h3>Challenges ({challenges.length})</h3>
        {challenges.map((c) => (
          <div key={c.id} style={{ marginBottom: 4, fontSize: 13 }}>
            <span style={{ color: c.status === 'claimed' ? '#2ecc71' : c.status === 'active' ? '#f39c12' : '#666' }}>
              [{c.status}]
            </span>{' '}
            {c.name} ({c.points} pts)
          </div>
        ))}

        {/* Event Log */}
        <h3>Event Log</h3>
        <div style={{ fontSize: 12, opacity: 0.7, maxHeight: 300, overflow: 'auto' }}>
          {events.length === 0 && <p>No events yet</p>}
          {events.map((e) => (
            <div key={e.id} style={{ marginBottom: 4 }}>
              <span style={{ opacity: 0.5 }}>{new Date(e.created_at).toLocaleTimeString()}</span>{' '}
              {e.type}: {JSON.stringify(e.payload)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
