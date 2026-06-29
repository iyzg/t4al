import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DEFAULT_ACTIVE_CHALLENGE_COUNT,
  DEFAULT_CHALLENGE_EXPIRE_MINUTES,
  DEFAULT_STARTING_TOKENS,
} from '@t4al/shared';
import { PageShell, Card, BrandLine, StatusPill, Field, Divider, PrimaryButton, SecondaryButton } from '../components/ui';
import {
  textInput, fieldLabel, cardTitle, subtitle, errorText,
  CREAM, FILL, INK, INK_SOFT, ORANGE_TEXT, HAIRLINE, STATUS_COLORS,
} from '../theme';

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
      <PageShell>
        <Card>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 14,
          }}>
            <BrandLine />
            <StatusPill dot={STATUS_COLORS.claimed}>Game created</StatusPill>
          </div>

          <h1 style={cardTitle}>{name || 'Your game'}</h1>
          <p style={subtitle}>Share the join code with players, then set up your challenges.</p>

          <Divider />

          {/* Join code — the player-facing code, shown big and tappable-clear. */}
          <p style={{ ...fieldLabel, marginBottom: 8 }}>Join code</p>
          <div style={{
            background: CREAM, borderRadius: 12, padding: '16px 18px',
            textAlign: 'center',
          }}>
            <div style={{
              fontSize: 38, fontWeight: 700, letterSpacing: '0.28em',
              color: INK, fontVariantNumeric: 'tabular-nums',
              paddingLeft: '0.28em',
            }}>
              {created.joinCode}
            </div>
            <p style={{ margin: '6px 0 0', fontSize: 12, color: ORANGE_TEXT, fontWeight: 600 }}>
              Players enter this at the join screen.
            </p>
          </div>

          {/* Admin code — secret; persisted to localStorage already. */}
          <p style={{ ...fieldLabel, margin: '18px 0 8px' }}>Admin code</p>
          <div style={{
            background: FILL, borderRadius: 12, padding: '12px 14px',
            border: `1px solid ${HAIRLINE}`,
          }}>
            <code style={{
              display: 'block', fontSize: 14, color: INK, wordBreak: 'break-all',
              lineHeight: 1.4,
            }}>
              {created.adminCode}
            </code>
            <p style={{ margin: '6px 0 0', fontSize: 12, color: INK_SOFT }}>
              Saved on this device. Keep it secret — it unlocks the admin pages.
            </p>
          </div>

          <Divider />

          <div style={{ display: 'flex', gap: 10 }}>
            <SecondaryButton onClick={() => navigate(`/game/${created.id}/admin`)}>
              Admin panel
            </SecondaryButton>
            <PrimaryButton onClick={() => navigate(`/game/${created.id}/admin/setup`)} style={{ marginTop: 0 }}>
              Set up challenges
            </PrimaryButton>
          </div>
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <Card>
        <BrandLine />
        <h1 style={cardTitle}>Create a game</h1>
        <p style={{ ...subtitle, marginBottom: 18 }}>
          Set the rules, then place challenges on the map.
        </p>

        <Field label="Game name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
            placeholder="e.g. Friday Night Hunt"
            className="loop-input"
            style={textInput}
          />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <NumberField label="Duration (min)" min={1} value={durationMinutes}
            onChange={(v) => setDurationMinutes(v || 0)} />
          <NumberField label="Active on map (K)" min={1} value={activeChallengeCount}
            onChange={(v) => setActiveChallengeCount(Math.max(1, v || 1))} />
          <NumberField label="Challenge expiry (min)" min={1} value={challengeExpireMinutes}
            onChange={(v) => setChallengeExpireMinutes(Math.max(1, v || 1))} />
          <NumberField label="Starting tokens" min={0} value={startingTokens}
            onChange={(v) => setStartingTokens(Math.max(0, v || 0))} />
        </div>

        <PrimaryButton onClick={handleCreate} disabled={creating} style={{ marginTop: 18 }}>
          {creating ? 'Creating…' : 'Create game'}
        </PrimaryButton>

        {error && <p style={errorText}>{error}</p>}
      </Card>
    </PageShell>
  );
}

function NumberField({
  label, value, min, onChange,
}: {
  label: string;
  value: number;
  min: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label style={{ ...fieldLabel, display: 'block' }}>{label}</label>
      <input
        type="number" min={min} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="loop-input"
        style={textInput}
      />
    </div>
  );
}
