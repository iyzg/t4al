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
  claimed_by_team_id: string | null;
}

interface TeamRow {
  id: string;
  name: string;
  color: string;
  score: number;
}

export default function AdminLivePage() {
  const { gameId } = useParams<{ gameId: string }>();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  const [challenges, setChallenges] = useState<ChallengeRow[]>([]);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [events, setEvents] = useState<GameEvent[]>([]);

  // Poll for updates every 5s
  useEffect(() => {
    const fetchData = async () => {
      const [cRes, tRes, eRes] = await Promise.all([
        fetch(`/api/games/${gameId}/challenges`),
        fetch(`/api/games/${gameId}/teams`),
        fetch(`/api/games/${gameId}/events`).catch(() => null),
      ]);
      setChallenges(await cRes.json());
      setTeams(await tRes.json());
      if (eRes?.ok) setEvents(await eRes.json());
    };
    fetchData();
    const id = setInterval(fetchData, 5000);
    return () => clearInterval(id);
  }, [gameId]);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
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
  }, []);

  async function handleForceEnd() {
    if (!confirm('Force end this game?')) return;
    await fetch(`/api/games/${gameId}/end`, { method: 'POST' });
  }

  async function handleStartGame() {
    await fetch(`/api/games/${gameId}/start`, { method: 'POST' });
  }

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      {/* Map */}
      <div ref={containerRef} style={{ flex: 1 }} />

      {/* Sidebar */}
      <div style={{ width: 350, background: '#1a1a2e', color: 'white', overflow: 'auto', padding: 16 }}>
        <h2 style={{ margin: '0 0 16px 0' }}>Admin Panel</h2>

        {/* Controls */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button onClick={handleStartGame} style={{ flex: 1, padding: 8, background: '#2ecc71', border: 'none', borderRadius: 4, color: 'white' }}>
            Start Game
          </button>
          <button onClick={handleForceEnd} style={{ flex: 1, padding: 8, background: '#e74c3c', border: 'none', borderRadius: 4, color: 'white' }}>
            End Game
          </button>
        </div>

        {/* Teams */}
        <h3>Teams</h3>
        {teams.map((t) => (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: t.color }} />
            <span>{t.name}</span>
            <span style={{ marginLeft: 'auto', fontWeight: 'bold' }}>{t.score} pts</span>
          </div>
        ))}

        {/* Challenges */}
        <h3>Challenges</h3>
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
