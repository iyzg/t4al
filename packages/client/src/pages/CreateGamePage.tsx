import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function CreateGamePage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ id: string; joinCode: string; adminCode: string } | null>(null);

  async function handleCreate() {
    setError('');
    if (!name.trim()) { setError('Game name is required'); return; }
    if (creating) return;
    setCreating(true);

    const res = await fetch('/api/games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, durationMinutes }),
    });

    if (!res.ok) { setCreating(false); setError('Failed to create game'); return; }
    const data = await res.json();
    setCreated({ id: data.id, joinCode: data.join_code, adminCode: data.admin_code });
  }

  if (created) {
    return (
      <div style={{ padding: '2rem', maxWidth: 500, margin: '0 auto' }}>
        <h1>Game Created!</h1>

        <div style={{ background: '#1a1a2e', color: 'white', padding: 20, borderRadius: 8, marginBottom: 16 }}>
          <p><strong>Join Code:</strong> <code style={{ fontSize: '1.4rem', letterSpacing: 2 }}>{created.joinCode}</code></p>
          <p style={{ opacity: 0.6, fontSize: 13 }}>Share this with players so they can join.</p>
          <p><strong>Admin Code:</strong> <code style={{ fontSize: '1.1rem' }}>{created.adminCode}</code></p>
          <p style={{ opacity: 0.6, fontSize: 13 }}>Keep this secret — it's for admin pages.</p>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => navigate(`/game/${created.id}/admin/setup`)}
            style={{ flex: 1, padding: 12, fontSize: '1rem', background: '#3498db', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer' }}
          >
            Set Up Challenges
          </button>
          <button
            onClick={() => navigate(`/game/${created.id}/admin`)}
            style={{ flex: 1, padding: 12, fontSize: '1rem', background: '#2ecc71', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer' }}
          >
            Go to Admin Panel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem', maxWidth: 400, margin: '0 auto' }}>
      <h1>Create a Game</h1>

      <label style={{ display: 'block', marginBottom: 4, fontWeight: 'bold' }}>Game Name</label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Friday Night Hunt"
        style={{ fontSize: '1.1rem', padding: '0.5rem', width: '100%', marginBottom: 16, boxSizing: 'border-box', background: '#2a2a3e', color: 'white', border: '1px solid #444', borderRadius: 4 }}
      />

      <label style={{ display: 'block', marginBottom: 4, fontWeight: 'bold' }}>Duration (minutes)</label>
      <input
        type="number"
        value={durationMinutes}
        onChange={(e) => setDurationMinutes(Number(e.target.value))}
        min={10}
        max={480}
        style={{ fontSize: '1.1rem', padding: '0.5rem', width: '100%', marginBottom: 16, boxSizing: 'border-box', background: '#2a2a3e', color: 'white', border: '1px solid #444', borderRadius: 4 }}
      />

      {error && <p style={{ color: '#e74c3c' }}>{error}</p>}

      <button
        onClick={handleCreate}
        disabled={creating}
        style={{ padding: '0.75rem 1.5rem', fontSize: '1.1rem', background: '#3498db', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', opacity: creating ? 0.5 : 1 }}
      >
        {creating ? 'Creating...' : 'Create Game'}
      </button>
    </div>
  );
}
