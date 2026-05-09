import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TEAM_COLORS } from '@t4al/shared';
import { getOrCreateDeviceId, useGameStore } from '../store';
import { socket } from '../socket';
import { registerSocketHandlers } from '../socketHandlers';
import MapBackground from '../components/MapBackground';

interface TeamRow { id: string; name: string; color: string }
interface GameRow { id: string; name: string; status: string }

const CARD_BG = '#FFFFFF';
const CARD_TEXT = '#111111';
const STAT_TEXT = '#5a5a5a';
const ORANGE = '#E88B3E';
const CREAM = '#FBEFE1';
const FILL_LIGHT = '#F4F1EB';
const HAIRLINE = '#ECE8DF';
const CARD_SHADOW = '0 16px 40px rgba(0, 0, 0, 0.32)';

export default function JoinPage() {
  const navigate = useNavigate();

  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');

  const [game, setGame] = useState<GameRow | null>(null);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [newTeamName, setNewTeamName] = useState('');
  const [selectedColor, setSelectedColor] = useState<string | null>(null);

  const takenColors = new Set(teams.map((t) => t.color));
  const availableColors = TEAM_COLORS.filter((c) => !takenColors.has(c));

  // Light polling of the teams list while we're in the lobby
  useEffect(() => {
    if (!game) return;
    const id = setInterval(() => { void refreshTeams(); }, 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.id]);

  async function refreshTeams() {
    if (!game) return;
    const res = await fetch(`/api/games/${game.id}/teams`);
    if (!res.ok) return;
    const fresh: TeamRow[] = await res.json();
    setTeams(fresh);
    const taken = new Set(fresh.map((t) => t.color));
    if (selectedColor && taken.has(selectedColor)) {
      setSelectedColor(TEAM_COLORS.find((c) => !taken.has(c)) ?? null);
    }
  }

  async function handleJoinCode() {
    setError('');
    const res = await fetch(`/api/games?joinCode=${encodeURIComponent(joinCode.trim().toUpperCase())}`);
    if (!res.ok) {
      setError('Invalid join code');
      return;
    }
    const gameData: GameRow = await res.json();
    setGame(gameData);

    const teamsRes = await fetch(`/api/games/${gameData.id}/teams`);
    const teamsList: TeamRow[] = await teamsRes.json();
    setTeams(teamsList);

    const taken = new Set(teamsList.map((t) => t.color));
    setSelectedColor(TEAM_COLORS.find((c) => !taken.has(c)) ?? null);
  }

  async function handleCreateTeam() {
    if (!newTeamName.trim() || !selectedColor) return;
    setError('');
    const res = await fetch(`/api/games/${game!.id}/teams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newTeamName.trim(), color: selectedColor }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      setError(err?.error || 'Failed to create team');
      await refreshTeams();
      return;
    }
    const data: TeamRow = await res.json();
    handleJoinTeam(data);
  }

  async function handleJoinTeam(team: TeamRow) {
    const deviceId = getOrCreateDeviceId();
    useGameStore.getState().setIdentity({
      gameId: game!.id,
      teamId: team.id,
      teamColor: team.color,
      deviceId,
    });
    localStorage.setItem('t4al_identity', JSON.stringify({
      gameId: game!.id, teamId: team.id, teamColor: team.color,
    }));

    registerSocketHandlers();
    socket.connect();
    socket.emit('game:join', { gameId: game!.id, teamId: team.id, deviceId });
    navigate(`/game/${game!.id}`);
  }

  // ── Code-entry view ──
  if (!game) {
    return (
      <PageShell>
        <Card>
          <BrandLine>In the Loop</BrandLine>

          <h1 style={{ ...cardTitle, marginBottom: 18 }}>Join a game</h1>

          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === 'Enter') handleJoinCode(); }}
            placeholder="ABCD"
            maxLength={4}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className="loop-input"
            style={{
              ...textInput,
              fontSize: 32, fontWeight: 700, letterSpacing: '0.3em',
              textAlign: 'center', padding: '14px 8px',
              fontVariantNumeric: 'tabular-nums',
            }}
          />

          <button
            onClick={handleJoinCode}
            disabled={joinCode.trim().length === 0}
            style={primaryBtn(joinCode.trim().length === 0)}
          >
            Join game
          </button>

          {error && <p style={errorText}>{error}</p>}
        </Card>
      </PageShell>
    );
  }

  // ── Lobby view ──
  return (
    <PageShell>
      <Card>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 14,
        }}>
          <BrandLine>In the Loop</BrandLine>
          <StatusPill>Waiting to start</StatusPill>
        </div>

        <h1 style={cardTitle}>{game.name}</h1>
        <p style={subtitle}>
          {teams.length} {teams.length === 1 ? 'team' : 'teams'}
        </p>

        <Divider />

        <FieldLabel>Teams</FieldLabel>
        {teams.length === 0 ? (
          <div style={emptyPill}>
            No teams yet — be the first.
          </div>
        ) : (
          <div style={{
            background: FILL_LIGHT, borderRadius: 12,
            overflow: 'hidden',
          }}>
            {teams.map((team, i) => (
              <div
                key={team.id}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 14px',
                  borderTop: i === 0 ? 'none' : `1px solid ${HAIRLINE}`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <span style={{
                    width: 14, height: 14, borderRadius: '50%',
                    background: team.color, flexShrink: 0,
                    border: '2px solid white', boxShadow: `0 0 0 1px ${team.color}`,
                  }} />
                  <span style={{
                    fontSize: 15, fontWeight: 600, color: CARD_TEXT,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {team.name}
                  </span>
                </div>
                <button onClick={() => handleJoinTeam(team)} style={joinPillBtn}>
                  Join
                </button>
              </div>
            ))}
          </div>
        )}

        <Divider />

        {availableColors.length > 0 ? (
          <>
            <FieldLabel>Create a team</FieldLabel>
            <input
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              placeholder="Team name"
              maxLength={40}
              className="loop-input"
              style={textInput}
            />

            <p style={{
              ...fieldLabelStyle, marginTop: 16, marginBottom: 8,
            }}>
              Color
            </p>
            <div style={{
              display: 'flex', gap: 10, flexWrap: 'wrap',
            }}>
              {availableColors.map((c) => (
                <button
                  key={c}
                  onClick={() => setSelectedColor(c)}
                  aria-label={`Pick color ${c}`}
                  style={{
                    width: 32, height: 32, borderRadius: '50%', background: c,
                    border: 'none',
                    cursor: 'pointer', padding: 0,
                    boxShadow: c === selectedColor
                      ? `0 0 0 2px white, 0 0 0 4px ${c}`
                      : 'inset 0 0 0 1px rgba(0,0,0,0.06)',
                  }}
                />
              ))}
            </div>

            <button
              onClick={handleCreateTeam}
              disabled={!newTeamName.trim() || !selectedColor}
              style={primaryBtn(!newTeamName.trim() || !selectedColor)}
            >
              Create &amp; join
            </button>
          </>
        ) : (
          <div style={emptyPill}>
            All seven team colors are taken — join an existing team above.
          </div>
        )}

        {error && <p style={errorText}>{error}</p>}
      </Card>
    </PageShell>
  );
}

// ── Shell + small primitives ──

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MapBackground />
      <div style={{
        position: 'relative', zIndex: 1,
        minHeight: '100vh',
        padding: '32px 16px 48px',
        maxWidth: 480, margin: '0 auto',
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-start',
      }}>
        {children}
      </div>
    </>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: CARD_BG, color: CARD_TEXT, borderRadius: 18,
      padding: '22px 22px 24px',
      boxShadow: CARD_SHADOW,
    }}>
      {children}
    </div>
  );
}

function BrandLine({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontSize: 12, fontWeight: 700, letterSpacing: '0.12em',
      textTransform: 'uppercase', color: '#9b9385',
    }}>
      {children}
    </span>
  );
}

function StatusPill({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      background: CREAM, color: '#a86421',
      padding: '4px 10px 4px 8px', borderRadius: 999,
      fontSize: 12, fontWeight: 700, letterSpacing: '0.01em',
    }}>
      <span style={{
        width: 7, height: 7, borderRadius: '50%', background: ORANGE,
      }} />
      {children}
    </span>
  );
}

function Divider() {
  return (
    <div style={{
      height: 1, background: HAIRLINE,
      margin: '18px -22px',
    }} />
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <p style={fieldLabelStyle}>{children}</p>;
}

const fieldLabelStyle: React.CSSProperties = {
  margin: '0 0 8px', fontSize: 14, fontWeight: 600,
  color: CARD_TEXT, letterSpacing: '0',
};

const cardTitle: React.CSSProperties = {
  margin: '12px 0 4px', fontSize: 26, fontWeight: 700,
  letterSpacing: '-0.01em', color: CARD_TEXT,
};

const subtitle: React.CSSProperties = {
  margin: 0, fontSize: 14, color: STAT_TEXT,
};

const textInput: React.CSSProperties = {
  fontSize: 16, padding: '11px 12px', width: '100%',
  boxSizing: 'border-box',
  background: 'white', color: CARD_TEXT,
  border: `1px solid ${HAIRLINE}`,
  borderRadius: 10, outline: 'none',
};

const primaryBtn = (disabled: boolean): React.CSSProperties => ({
  marginTop: 16, width: '100%',
  padding: '13px 18px', fontSize: 16, fontWeight: 700,
  background: disabled ? '#D7D2C8' : ORANGE,
  color: disabled ? '#7a7a7a' : 'white',
  border: 'none', borderRadius: 10,
  cursor: disabled ? 'not-allowed' : 'pointer',
  letterSpacing: '0.01em',
});

const joinPillBtn: React.CSSProperties = {
  padding: '6px 16px', fontSize: 13, fontWeight: 700,
  background: ORANGE, color: 'white',
  border: 'none', borderRadius: 999, cursor: 'pointer',
  letterSpacing: '0.01em',
};

const emptyPill: React.CSSProperties = {
  background: FILL_LIGHT, color: STAT_TEXT,
  borderRadius: 10, padding: '14px 16px',
  fontSize: 14, textAlign: 'center',
};

const errorText: React.CSSProperties = {
  margin: '12px 4px 0', color: '#c0392b',
  fontSize: 14, textAlign: 'center', fontWeight: 600,
};
