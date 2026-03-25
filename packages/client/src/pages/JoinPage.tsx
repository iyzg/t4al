import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameStore } from '../store';
import { socket } from '../socket';

interface TeamRow {
  id: string;
  name: string;
  color: string;
}

interface GameRow {
  id: string;
  name: string;
  status: string;
}

const TEAM_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22'];

export default function JoinPage() {
  const navigate = useNavigate();

  // Phase 1: join code entry
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');

  // Phase 2: lobby
  const [game, setGame] = useState<GameRow | null>(null);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [newTeamName, setNewTeamName] = useState('');
  const [selectedColor, setSelectedColor] = useState(TEAM_COLORS[0]);

  async function handleJoinCode() {
    setError('');
    const res = await fetch(`/api/games/join/${joinCode}`);
    if (!res.ok) {
      setError('Invalid join code');
      return;
    }
    const gameData = await res.json();
    setGame(gameData);

    // Fetch existing teams
    const teamsRes = await fetch(`/api/games/${gameData.id}/teams`);
    setTeams(await teamsRes.json());
  }

  async function handleCreateTeam() {
    if (!newTeamName.trim()) return;
    const res = await fetch(`/api/games/${game!.id}/teams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newTeamName, color: selectedColor }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      setError(err?.error || 'Failed to create team');
      return;
    }
    const data = await res.json();
    handleJoinTeam(data);
  }

  async function handleJoinTeam(team: TeamRow) {
    useGameStore.getState().setIdentity(game!.id, team.id, team.color);
    sessionStorage.setItem('t4al_identity', JSON.stringify({
      gameId: game!.id, teamId: team.id, teamColor: team.color,
    }));

    socket.connect();
    socket.emit('game:join', { gameId: game!.id, teamId: team.id });
    navigate(`/game/${game!.id}`);
  }

  // Phase 1: enter join code
  if (!game) {
    return (
      <div style={{ padding: '2rem', maxWidth: 400, margin: '0 auto' }}>
        <h1>In the Loop</h1>
        <p>Enter your game's join code:</p>
        <input
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value)}
          placeholder="e.g. a1b2c3"
          style={{ fontSize: '1.2rem', padding: '0.5rem', width: '100%' }}
        />
        <button onClick={handleJoinCode} style={{ marginTop: '1rem', padding: '0.5rem 1rem', fontSize: '1rem' }}>
          Join Game
        </button>
        {error && <p style={{ color: 'red' }}>{error}</p>}
      </div>
    );
  }

  // Phase 2: lobby
  return (
    <div style={{ padding: '2rem', maxWidth: 400, margin: '0 auto' }}>
      <h1>{game.name}</h1>
      <p>Waiting in lobby...</p>

      <h2>Teams</h2>
      {teams.length === 0 && <p>No teams yet — create one!</p>}
      {teams.map((team) => (
        <div key={team.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <span style={{ width: 20, height: 20, borderRadius: '50%', background: team.color, display: 'inline-block' }} />
          <span>{team.name}</span>
          <button onClick={() => handleJoinTeam(team)}>Join</button>
        </div>
      ))}

      <h2>Create Team</h2>
      <input
        value={newTeamName}
        onChange={(e) => setNewTeamName(e.target.value)}
        placeholder="Team name"
        style={{ fontSize: '1rem', padding: '0.5rem', width: '100%' }}
      />
      <div style={{ display: 'flex', gap: '0.5rem', margin: '0.5rem 0' }}>
        {TEAM_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => setSelectedColor(c)}
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: c,
              border: c === selectedColor ? '3px solid white' : '3px solid transparent',
              cursor: 'pointer',
            }}
          />
        ))}
      </div>
      <button onClick={handleCreateTeam} style={{ padding: '0.5rem 1rem', fontSize: '1rem' }}>
        Create & Join
      </button>
      {error && <p style={{ color: 'red' }}>{error}</p>}
    </div>
  );
}
