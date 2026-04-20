import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DEFAULT_ACTIVE_CHALLENGE_COUNT,
  DEFAULT_CHALLENGE_EXPIRE_MINUTES,
  DEFAULT_STARTING_TOKENS,
} from '@t4al/shared';

export default function CreateGamePage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [activeChallengeCount, setActiveChallengeCount] = useState(DEFAULT_ACTIVE_CHALLENGE_COUNT);
  const [challengeExpireMinutes, setChallengeExpireMinutes] = useState(DEFAULT_CHALLENGE_EXPIRE_MINUTES);
  const [startingTokens, setStartingTokens] = useState(DEFAULT_STARTING_TOKENS);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ id: string; joinCode: string; adminCode: string } | null>(null);

  async function handleCreate() {
    setError('');
    if (!name.trim()) { setError('Game name is required'); return; }
    if (durationMinutes <= 0) { setError('Duration must be > 0'); return; }
    if (startingTokens < 0) { setError('Starting tokens must be ≥ 0'); return; }
    if (creating) return;
    setCreating(true);

    try {
      const res = await fetch('/api/games', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          durationMinutes,
          activeChallengeCount,
          challengeExpireMinutes,
          startingTokens,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        setError(err?.error || 'Failed to create game');
        setCreating(false);
        return;
      }
      const data = await res.json();
      // Persist adminCode so admin pages can authenticate
      localStorage.setItem(`adminCode:${data.id}`, data.adminCode);
      setCreated({ id: data.id, joinCode: data.joinCode, adminCode: data.adminCode });
    } catch {
      setError('Network error');
      setCreating(false);
    }
  }

  if (created) {
    return (
      <div style={{ padding: '2rem', maxWidth: 500, margin: '0 auto' }}>
        <h1>Game Created</h1>

        <div style={{ background: '#1a1a2e', color: 'white', padding: 20, borderRadius: 8, marginBottom: 16 }}>
          <p><strong>Join code:</strong> <code style={{ fontSize: '1.6rem', letterSpacing: 3 }}>{created.joinCode}</code></p>
          <p style={{ opacity: 0.6, fontSize: 13 }}>Share this with players so they can join.</p>
          <p><strong>Admin code:</strong> <code style={{ fontSize: '1rem', wordBreak: 'break-all' }}>{created.adminCode}</code></p>
          <p style={{ opacity: 0.6, fontSize: 13 }}>Saved to localStorage. Keep it secret — it unlocks admin pages.</p>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => navigate(`/game/${created.id}/admin/setup`)}
            style={{ flex: 1, padding: 12, fontSize: '1rem', background: '#3498db', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer' }}
          >
            Set up challenges
          </button>
          <button
            onClick={() => navigate(`/game/${created.id}/admin`)}
            style={{ flex: 1, padding: 12, fontSize: '1rem', background: '#2ecc71', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer' }}
          >
            Admin panel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem', maxWidth: 480, margin: '0 auto' }}>
      <h1>Create a Game</h1>

      <Field label="Game name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Friday Night Hunt"
          style={inputStyle}
        />
      </Field>

      <Field label="Duration (minutes)">
        <input
          type="number" min={1} value={durationMinutes}
          onChange={(e) => setDurationMinutes(Number(e.target.value) || 0)}
          style={inputStyle}
        />
      </Field>

      <Field label="Active challenges on map (K)">
        <input
          type="number" min={1} value={activeChallengeCount}
          onChange={(e) => setActiveChallengeCount(Math.max(1, Number(e.target.value) || 1))}
          style={inputStyle}
        />
      </Field>

      <Field label="Challenge expiration (minutes)">
        <input
          type="number" min={1} value={challengeExpireMinutes}
          onChange={(e) => setChallengeExpireMinutes(Math.max(1, Number(e.target.value) || 1))}
          style={inputStyle}
        />
      </Field>

      <Field label="Starting tokens per team">
        <input
          type="number" min={0} value={startingTokens}
          onChange={(e) => setStartingTokens(Math.max(0, Number(e.target.value) || 0))}
          style={inputStyle}
        />
      </Field>

      {error && <p style={{ color: '#e74c3c' }}>{error}</p>}

      <button
        onClick={handleCreate} disabled={creating}
        style={{ padding: '0.75rem 1.5rem', fontSize: '1.1rem', background: '#3498db', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', opacity: creating ? 0.5 : 1 }}
      >
        {creating ? 'Creating…' : 'Create Game'}
      </button>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  fontSize: '1.05rem', padding: '0.5rem', width: '100%', boxSizing: 'border-box',
  background: '#2a2a3e', color: 'white', border: '1px solid #444', borderRadius: 4,
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', marginBottom: 4, fontWeight: 'bold', fontSize: 14 }}>{label}</label>
      {children}
    </div>
  );
}
