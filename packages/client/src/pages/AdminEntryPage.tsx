import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface GameRow { id: string; name: string; status: string }

export default function AdminEntryPage() {
  const navigate = useNavigate();
  const [joinCode, setJoinCode] = useState('');
  const [adminCode, setAdminCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError('');
    const jc = joinCode.trim().toUpperCase();
    const ac = adminCode.trim();
    if (!jc || !ac) { setError('Both codes required'); return; }
    setSubmitting(true);

    try {
      const lookup = await fetch(`/api/games?joinCode=${encodeURIComponent(jc)}`);
      if (!lookup.ok) {
        setError('Invalid join code');
        setSubmitting(false);
        return;
      }
      const game: GameRow = await lookup.json();

      const verify = await fetch(`/api/games/${game.id}`, {
        headers: { 'x-admin-code': ac },
      });
      if (!verify.ok) {
        setError('Could not verify game');
        setSubmitting(false);
        return;
      }
      const full = await verify.json();
      if (full.adminCode !== ac) {
        setError('Wrong admin code');
        setSubmitting(false);
        return;
      }

      localStorage.setItem(`adminCode:${game.id}`, ac);
      const dest = game.status === 'lobby'
        ? `/game/${game.id}/admin/setup`
        : `/game/${game.id}/admin`;
      navigate(dest);
    } catch {
      setError('Network error');
      setSubmitting(false);
    }
  }

  return (
    <div style={{ padding: '2rem', maxWidth: 480, margin: '0 auto' }}>
      <h1>Admin Login</h1>
      <p style={{ opacity: 0.7, fontSize: 14, marginBottom: 20 }}>
        Enter the game's join code and admin code to access the admin dashboard from this device.
      </p>

      <Field label="Join code">
        <input
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
          placeholder="ABCD"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          maxLength={8}
          style={{ ...inputStyle, fontSize: '1.4rem', letterSpacing: 3, textAlign: 'center' }}
        />
      </Field>

      <Field label="Admin code">
        <input
          value={adminCode}
          onChange={(e) => setAdminCode(e.target.value)}
          placeholder="paste admin code"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          style={inputStyle}
        />
      </Field>

      {error && <p style={{ color: '#e74c3c' }}>{error}</p>}

      <button
        onClick={handleSubmit}
        disabled={submitting}
        style={{
          padding: '0.75rem 1.5rem', fontSize: '1.1rem',
          background: '#3498db', color: 'white', border: 'none',
          borderRadius: 6, cursor: 'pointer', opacity: submitting ? 0.5 : 1,
          width: '100%',
        }}
      >
        {submitting ? 'Verifying…' : 'Enter admin'}
      </button>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  fontSize: '1.05rem', padding: '0.6rem', width: '100%', boxSizing: 'border-box',
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
