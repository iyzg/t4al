import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameStore } from '../store';
import { socket } from '../socket';
import { registerSocketHandlers } from '../socketHandlers';

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
  const [selectedColor, setSelectedColor] = useState<string | null>(null);

  // Colors already taken by existing teams
  const takenColors = new Set(teams.map((t) => t.color));
  const availableColors = TEAM_COLORS.filter((c) => !takenColors.has(c));

  async function refreshTeams() {
    if (!game) return;
    const res = await fetch(`/api/games/${game.id}/teams`);
    if (res.ok) {
      const fresh = await res.json();
      setTeams(fresh);
      // If selected color was taken, pick the first available
      const taken = new Set(fresh.map((t: TeamRow) => t.color));
      if (selectedColor && taken.has(selectedColor)) {
        const next = TEAM_COLORS.find((c) => !taken.has(c)) ?? null;
        setSelectedColor(next);
      }
    }
  }

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
    const teamsList = await teamsRes.json();
    setTeams(teamsList);

    // Auto-select first available color
    const taken = new Set(teamsList.map((t: TeamRow) => t.color));
    setSelectedColor(TEAM_COLORS.find((c) => !taken.has(c)) ?? null);
  }

  async function handleCreateTeam() {
    if (!newTeamName.trim() || !selectedColor) return;
    setError('');
    const res = await fetch(`/api/games/${game!.id}/teams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newTeamName, color: selectedColor }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      setError(err?.error || 'Failed to create team');
      // Refresh teams to get the latest taken colors
      await refreshTeams();
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

    // Register handlers BEFORE connect/emit so no initial state events are lost
    registerSocketHandlers();
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
          style={{ fontSize: '1.2rem', padding: '0.5rem', width: '100%', boxSizing: 'border-box' }}
        />
        <button onClick={handleJoinCode} style={{ marginTop: '1rem', padding: '0.75rem 1.5rem', fontSize: '1rem', background: '#3498db', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
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
          <button onClick={() => handleJoinTeam(team)} style={{ padding: '4px 16px', background: '#3498db', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}>Join</button>
        </div>
      ))}

      {availableColors.length > 0 ? (
        <>
          <h2>Create Team</h2>
          <input
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            placeholder="Team name"
            style={{ fontSize: '1rem', padding: '0.5rem', width: '100%', boxSizing: 'border-box' }}
          />
          <div style={{ display: 'flex', gap: '0.5rem', margin: '0.5rem 0', flexWrap: 'wrap' }}>
            {availableColors.map((c) => (
              <button
                key={c}
                onClick={() => setSelectedColor(c)}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  background: c,
                  border: c === selectedColor ? '3px solid white' : '3px solid transparent',
                  cursor: 'pointer',
                  padding: 0,
                }}
              />
            ))}
          </div>
          <button onClick={handleCreateTeam} style={{ padding: '0.75rem 1.5rem', fontSize: '1rem', background: '#2ecc71', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
            Create & Join
          </button>
        </>
      ) : (
        <p style={{ opacity: 0.5, marginTop: 16 }}>All colors are taken — join an existing team above.</p>
      )}
      {error && <p style={{ color: 'red' }}>{error}</p>}
    </div>
  );
}
