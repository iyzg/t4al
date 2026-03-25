import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

interface TeamResult {
  id: string;
  name: string;
  color: string;
  score: number;
}

export default function EndPage() {
  const { gameId } = useParams<{ gameId: string }>();
  const [teams, setTeams] = useState<TeamResult[]>([]);
  const [gameName, setGameName] = useState('');

  useEffect(() => {
    fetch(`/api/games/${gameId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((g) => { if (g) setGameName(g.name); })
      .catch(() => {});
    fetch(`/api/games/${gameId}/teams`)
      .then((r) => r.ok ? r.json() : [])
      .then((rows: TeamResult[]) => {
        if (Array.isArray(rows)) setTeams(rows.sort((a, b) => b.score - a.score));
      })
      .catch(() => {});
  }, [gameId]);

  return (
    <div style={{ padding: '2rem', maxWidth: 500, margin: '0 auto', textAlign: 'center' }}>
      <h1>{gameName || 'Game Over'}</h1>
      <h2>Final Standings</h2>

      {teams.length === 0 && <p style={{ opacity: 0.5 }}>No teams played</p>}
      {teams.map((team, i) => (
        <div
          key={team.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            marginBottom: 8,
            background: i === 0 ? 'rgba(243, 156, 18, 0.2)' : 'rgba(255,255,255,0.05)',
            borderRadius: 8,
            border: i === 0 ? '2px solid #f39c12' : '1px solid rgba(255,255,255,0.1)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 24, fontWeight: 'bold', opacity: 0.5, width: 32 }}>#{i + 1}</span>
            <span style={{ width: 16, height: 16, borderRadius: '50%', background: team.color }} />
            <span style={{ fontWeight: 'bold', fontSize: 18 }}>{team.name}</span>
          </div>
          <span style={{ fontSize: 20, fontWeight: 'bold' }}>{team.score} pts</span>
        </div>
      ))}

      <div style={{ marginTop: 32, display: 'flex', gap: 12, justifyContent: 'center' }}>
        <a href="/" style={{ padding: '10px 20px', background: '#3498db', color: 'white', borderRadius: 6, textDecoration: 'none' }}>
          New Game
        </a>
        <a href="/join" style={{ padding: '10px 20px', background: '#2ecc71', color: 'white', borderRadius: 6, textDecoration: 'none' }}>
          Join Another Game
        </a>
      </div>
    </div>
  );
}
