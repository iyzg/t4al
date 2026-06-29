import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageShell, Card, BrandLine, StatusPill, Field, PrimaryButton } from '../components/ui';
import { textInput, subtitle, errorText, cardTitle } from '../theme';

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
    <PageShell>
      <Card>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 14,
        }}>
          <BrandLine />
          <StatusPill>Admin</StatusPill>
        </div>

        <h1 style={cardTitle}>Admin login</h1>
        <p style={{ ...subtitle, marginBottom: 18 }}>
          Enter the game's join code and admin code to manage it from this device.
        </p>

        <Field label="Join code">
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
            placeholder="ABCD"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={8}
            className="loop-input"
            style={{
              ...textInput,
              fontSize: 28, fontWeight: 700, letterSpacing: '0.3em',
              textAlign: 'center', padding: '12px 8px',
              fontVariantNumeric: 'tabular-nums',
            }}
          />
        </Field>

        <Field label="Admin code">
          <input
            value={adminCode}
            onChange={(e) => setAdminCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
            placeholder="paste admin code"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="loop-input"
            style={textInput}
          />
        </Field>

        <PrimaryButton onClick={handleSubmit} disabled={submitting} style={{ marginTop: 4 }}>
          {submitting ? 'Verifying…' : 'Enter admin'}
        </PrimaryButton>

        {error && <p style={errorText}>{error}</p>}
      </Card>
    </PageShell>
  );
}
