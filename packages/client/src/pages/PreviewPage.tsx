import { useState } from 'react';
import type { Challenge } from '@t4al/shared';
import { ChallengeCard } from './GamePage';
import type { ChallengeCardProps } from './GamePage';

// Internal preview-only page for spot-checking challenge card UI without
// running through a real game.  Lists every variant + state combination
// so we can flip between them and visually confirm the flows.
//
// Mounted at /preview (see App.tsx).  Not linked from anywhere; not a
// player-facing surface.

type VariantKey =
  | 'normal-far'
  | 'normal-inrange'
  | 'normal-active'
  | 'variable-far'
  | 'variable-inrange'
  | 'variable-active'
  | 'variable-score-entry'
  | 'wager-far'
  | 'wager-inrange'
  | 'wager-setup'
  | 'wager-active';

interface VariantSpec {
  key: VariantKey;
  label: string;
  group: 'Normal' | 'Variable' | 'Wager';
}

const VARIANTS: VariantSpec[] = [
  { key: 'normal-far',         label: 'Out of range',     group: 'Normal' },
  { key: 'normal-inrange',     label: 'In range — start', group: 'Normal' },
  { key: 'normal-active',      label: 'Active',           group: 'Normal' },
  { key: 'variable-far',       label: 'Out of range',     group: 'Variable' },
  { key: 'variable-inrange',   label: 'In range — start', group: 'Variable' },
  { key: 'variable-active',    label: 'Active',           group: 'Variable' },
  { key: 'variable-score-entry', label: 'Score entry',    group: 'Variable' },
  { key: 'wager-far',          label: 'Out of range',     group: 'Wager' },
  { key: 'wager-inrange',      label: 'In range — start', group: 'Wager' },
  { key: 'wager-setup',        label: 'Wager setup',      group: 'Wager' },
  { key: 'wager-active',       label: 'Active (amount set)', group: 'Wager' },
];

function noop() { /* preview */ }

// Fixed activation timestamp ~3min before "now" so the countdown shows
// a recognizable mid-game value (~7 minutes left given expireMinutes=10).
const ACTIVATED_AT = new Date(Date.now() - 3 * 60 * 1000).toISOString();

const baseChallenge: Omit<Challenge, 'id' | 'name' | 'description' | 'type' | 'tokens' | 'tokensPerUnit' | 'unitLabel'> = {
  gameId: 'preview',
  lat: 41.881764,
  lng: -87.62374,
  proximityMeters: 100,
  sortOrder: 1,
  status: 'active',
  activatedAt: ACTIVATED_AT,
  claimedAt: null,
  claimedByTeamId: null,
  expiredAt: null,
  createdAt: new Date(0).toISOString() as unknown as Date,
} as any;

const NORMAL: Challenge = {
  ...baseChallenge,
  id: 'preview-normal',
  name: 'Free Fry Friday',
  description: 'Convince a restaurant to give you free fries. No apps, no deals — you must grovel.',
  type: 'normal',
  tokens: 70,
  tokensPerUnit: null,
  unitLabel: null,
} as Challenge;

const VARIABLE: Challenge = {
  ...baseChallenge,
  id: 'preview-variable',
  name: 'Break Illinois Law',
  description: 'Per the (unverified) Illinois Animal Control Act, it is illegal to make funny faces at a dog. Pet and pull faces at as many dogs as possible in 3 minutes.',
  type: 'variable',
  tokens: null,
  tokensPerUnit: 3,
  unitLabel: 'dog',
} as Challenge;

const WAGER: Challenge = {
  ...baseChallenge,
  id: 'preview-wager',
  name: 'Guesstimate a Kilometer',
  description: 'Without measuring, walk as close to 1 km from your starting point as you can. Within 20% to claim. Phones, maps, or any tools = abandon.',
  type: 'wager',
  tokens: null,
  tokensPerUnit: null,
  unitLabel: null,
} as Challenge;

function buildProps(key: VariantKey): ChallengeCardProps {
  const common = {
    descriptionVisible: true,
    isClosing: false,
    expireMinutes: 10,
    tokens: 175,
    onClose: noop, onStart: noop, onAbandon: noop, onComplete: noop,
    onSetWager: noop, onStartAndWager: noop, onFailWager: noop,
  };

  switch (key) {
    case 'normal-far':
      return { ...common, challenge: NORMAL, distance: 320, inRange: false,
        isMyActive: false, activeChallengeId: null, wagerAmount: null };
    case 'normal-inrange':
      return { ...common, challenge: NORMAL, distance: 42, inRange: true,
        isMyActive: false, activeChallengeId: null, wagerAmount: null };
    case 'normal-active':
      return { ...common, challenge: NORMAL, distance: 18, inRange: true,
        isMyActive: true, activeChallengeId: NORMAL.id, wagerAmount: null };

    case 'variable-far':
      return { ...common, challenge: VARIABLE, distance: 540, inRange: false,
        isMyActive: false, activeChallengeId: null, wagerAmount: null };
    case 'variable-inrange':
      return { ...common, challenge: VARIABLE, distance: 60, inRange: true,
        isMyActive: false, activeChallengeId: null, wagerAmount: null };
    case 'variable-active':
      return { ...common, challenge: VARIABLE, distance: 12, inRange: true,
        isMyActive: true, activeChallengeId: VARIABLE.id, wagerAmount: null };
    case 'variable-score-entry':
      // Same as variable-active — user has to tap "Claim" to enter the
      // score-entry sub-view in the actual flow.  Document that here.
      return { ...common, challenge: VARIABLE, distance: 12, inRange: true,
        isMyActive: true, activeChallengeId: VARIABLE.id, wagerAmount: null };

    case 'wager-far':
      return { ...common, challenge: WAGER, distance: 410, inRange: false,
        isMyActive: false, activeChallengeId: null, wagerAmount: null };
    case 'wager-inrange':
      // Tapping Activate opens wager-setup automatically.  Click "Activate" to see it.
      return { ...common, challenge: WAGER, distance: 38, inRange: true,
        isMyActive: false, activeChallengeId: null, wagerAmount: null };
    case 'wager-setup':
      // isMyActive=true with wagerAmount=null forces wager-setup sub-view to render.
      return { ...common, challenge: WAGER, distance: 12, inRange: true,
        isMyActive: true, activeChallengeId: WAGER.id, wagerAmount: null };
    case 'wager-active':
      return { ...common, challenge: WAGER, distance: 12, inRange: true,
        isMyActive: true, activeChallengeId: WAGER.id, wagerAmount: 40 };
  }
}

export default function PreviewPage() {
  const [key, setKey] = useState<VariantKey>('normal-inrange');
  const [bumpKey, setBumpKey] = useState(0);
  const props = buildProps(key);

  const groups: Record<string, VariantSpec[]> = {};
  for (const v of VARIANTS) (groups[v.group] ||= []).push(v);

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0f0f1a',
      padding: '20px 16px',
      color: 'white',
    }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <h1 style={{
          margin: '0 0 4px', fontSize: 22, fontWeight: 700,
          letterSpacing: '-0.01em',
        }}>
          Challenge UI preview
        </h1>
        <p style={{
          margin: '0 0 20px', opacity: 0.6, fontSize: 13,
        }}>
          Pick a variant on the left.  The card on the right renders the
          actual <code style={{ background: 'rgba(255,255,255,0.08)', padding: '0 6px', borderRadius: 4 }}>ChallengeCard</code> with
          mocked props — buttons no-op, but sub-views (score entry, wager
          setup) work as in the real game.
        </p>

        <div style={{
          display: 'grid', gridTemplateColumns: '220px 1fr', gap: 20,
          alignItems: 'start',
        }}>
          {/* ── Variant picker ── */}
          <nav style={{
            background: '#1a1a2e', borderRadius: 12, padding: 12,
            border: '1px solid #2a2a3e',
          }}>
            {Object.entries(groups).map(([group, items]) => (
              <div key={group} style={{ marginBottom: 14 }}>
                <p style={{
                  margin: '4px 6px 6px', fontSize: 11, fontWeight: 700,
                  letterSpacing: '0.08em', textTransform: 'uppercase',
                  color: '#9b9385',
                }}>
                  {group}
                </p>
                {items.map((v) => (
                  <button
                    key={v.key}
                    onClick={() => { setKey(v.key); setBumpKey((k) => k + 1); }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '8px 10px',
                      marginBottom: 4,
                      borderRadius: 8,
                      fontSize: 13, fontWeight: 600,
                      border: 'none',
                      cursor: 'pointer',
                      background: v.key === key ? '#E88B3E' : 'transparent',
                      color: v.key === key ? 'white' : '#cfcec9',
                    }}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            ))}
            <p style={{
              margin: '12px 6px 0', fontSize: 11, color: '#9b9385',
              lineHeight: 1.5,
            }}>
              Note: variable Score-entry opens after tapping <strong>Claim</strong> from the
              Active state.  Wager Setup opens after tapping <strong>Activate</strong> on a
              wager challenge.
            </p>
          </nav>

          {/* ── Card stage ── */}
          <div style={{
            position: 'relative',
            minHeight: 560,
            background: 'linear-gradient(180deg, #1f2436 0%, #11141f 100%)',
            borderRadius: 18,
            border: '1px solid #2a2a3e',
            overflow: 'hidden',
          }}>
            {/* Render card with bumpKey so re-selecting same variant retriggers
                animations and resets sub-view state cleanly. */}
            <div key={`${key}:${bumpKey}`}>
              <ChallengeCard {...props} />
            </div>
            <p style={{
              position: 'absolute', top: 12, left: 16,
              margin: 0, fontSize: 11, fontWeight: 700,
              letterSpacing: '0.08em', textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.4)',
            }}>
              {key}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
