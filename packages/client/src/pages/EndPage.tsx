import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Team } from '@t4al/shared';
import MapBackground from '../components/MapBackground';

const CARD_BG = '#FFFFFF';
const CARD_TEXT = '#111111';
const STAT_TEXT = '#5a5a5a';
const ORANGE = '#E88B3E';
const CREAM = '#FBEFE1';
const FILL_LIGHT = '#F4F1EB';
const HAIRLINE = '#ECE8DF';
const CARD_SHADOW = '0 16px 40px rgba(0, 0, 0, 0.32)';

// Reveal timing.  Tweak these to retune the payoff cadence.
//
// Non-winner rows reveal bottom-up with an accelerating-gap curve:
// the gap between last and second-to-last is small (snappy), and each
// subsequent gap grows toward 2nd place (suspense building).  Then the
// drumroll silence; then the winner pops in with confetti.
const FIRST_DELAY_MS    = 600;   // breathe a beat after page mounts
const ROW_GAP_MIN_MS    = 160;   // snap between the bottom rows
const ROW_GAP_MAX_MS    = 620;   // suspense gap right before 2nd place
const ROW_GAP_POWER     = 1.7;   // > 1: accelerates slowdown toward the top
const DRUMROLL_MS       = 900;   // silence after 2nd place, before the winner
const COUNT_LEAD_MS     = 220;   // counter starts after row has slid into place
const COUNT_DUR_MS      = 900;   // how long the token rollup lasts

// Curve for the gap before the (j+1)-th non-winner reveal, where j=0 is
// the gap between last place and the row above it.  Larger j → larger
// gap, raised to ROW_GAP_POWER for an ease-in feel.
function gapForIndex(j: number, totalGaps: number): number {
  if (totalGaps <= 0) return 0;
  if (totalGaps === 1) return ROW_GAP_MAX_MS;
  const t = j / (totalGaps - 1);                     // 0..1
  return ROW_GAP_MIN_MS + (ROW_GAP_MAX_MS - ROW_GAP_MIN_MS) * Math.pow(t, ROW_GAP_POWER);
}

export default function EndPage() {
  const { gameId } = useParams<{ gameId: string }>();
  const [teams, setTeams] = useState<Team[]>([]);
  const [gameName, setGameName] = useState('');
  const [confettiTrigger, setConfettiTrigger] = useState(0);
  const [winnerVisible, setWinnerVisible] = useState(false);

  useEffect(() => {
    fetch(`/api/games/${gameId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((g) => { if (g) setGameName(g.name); })
      .catch(() => {});
    fetch(`/api/games/${gameId}/teams`)
      .then((r) => r.ok ? r.json() : [])
      .then((rows: Team[]) => {
        if (Array.isArray(rows)) {
          setTeams([...rows].sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name)));
        }
      })
      .catch(() => {});
  }, [gameId]);

  // Schedule the confetti burst + winner-card reveal together at the
  // moment the winner row pops in.
  useEffect(() => {
    if (teams.length === 0) return;
    const N = teams.length;
    const t = window.setTimeout(() => {
      setWinnerVisible(true);
      setConfettiTrigger((k) => k + 1);
    }, computeWinnerDelay(N));
    return () => clearTimeout(t);
  }, [teams.length]);

  const winner = teams[0];
  const totalTokens = teams.reduce((sum, t) => sum + t.tokens, 0);
  const N = teams.length;

  // Compute the reveal delay for a leaderboard row.  Last place reveals
  // first; each higher rank lands after a growing gap; then DRUMROLL_MS
  // of silence; then the winner.
  //
  // For non-winner ranks i ∈ [1, N-1]:
  //   delay(i) = FIRST_DELAY + sum_{j=0..N-2-i} gapForIndex(j, N-2)
  //
  // (Walking from rank N-1 up to rank i consumes N-1-i gaps, indexed
  // 0..N-2-i in the curve.)
  function rowDelayMs(rankIndex: number): number {
    if (rankIndex === 0) return computeWinnerDelay(N);
    let total = FIRST_DELAY_MS;
    const totalGaps = N - 2;
    const gapsConsumed = N - 1 - rankIndex;
    for (let j = 0; j < gapsConsumed; j++) {
      total += gapForIndex(j, totalGaps);
    }
    return total;
  }

  function computeWinnerDelay(n: number): number {
    if (n < 2) return FIRST_DELAY_MS;
    let total = FIRST_DELAY_MS;
    const totalGaps = n - 2;
    for (let j = 0; j < totalGaps; j++) total += gapForIndex(j, totalGaps);
    return total + DRUMROLL_MS;
  }

  return (
    <>
      <MapBackground />
      <div style={{
        position: 'relative', zIndex: 1,
        minHeight: '100vh',
        padding: '32px 16px 48px',
        maxWidth: 480, margin: '0 auto',
      }}>
        <div style={{
          background: CARD_BG, color: CARD_TEXT, borderRadius: 18,
          padding: '22px 22px 24px',
          boxShadow: CARD_SHADOW,
          position: 'relative',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 14,
          }}>
            <span style={{
              fontSize: 12, fontWeight: 700, letterSpacing: '0.12em',
              textTransform: 'uppercase', color: '#9b9385',
            }}>
              In the Loop
            </span>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: CREAM, color: '#a86421',
              padding: '4px 10px 4px 8px', borderRadius: 999,
              fontSize: 12, fontWeight: 700, letterSpacing: '0.01em',
            }}>
              <span style={{
                width: 7, height: 7, borderRadius: '50%', background: ORANGE,
              }} />
              Game over
            </span>
          </div>

          <h1 style={{
            margin: '12px 0 4px', fontSize: 26, fontWeight: 700,
            letterSpacing: '-0.01em', color: CARD_TEXT,
          }}>
            {gameName || 'Final standings'}
          </h1>
          <p style={{ margin: 0, fontSize: 14, color: STAT_TEXT }}>
            {N} {N === 1 ? 'team' : 'teams'}
            {N > 0 && ' · '}
            {N > 0 && (
              <RollingNumber
                value={totalTokens}
                startDelayMs={FIRST_DELAY_MS + COUNT_LEAD_MS}
                durationMs={COUNT_DUR_MS + (N - 1) * 200}
              />
            )}
            {N > 0 && ' tokens earned'}
          </p>

          <Divider />

          {/* Champion section: appears synchronously with the winner row.
              Confetti emits from this region. */}
          {winner && (
            <>
              <div
                className="endpage-champion"
                style={{
                  background: CREAM, borderRadius: 12,
                  padding: '16px 18px',
                  textAlign: 'center',
                  position: 'relative',
                  opacity: winnerVisible ? 1 : 0,
                  transform: winnerVisible ? 'scale(1)' : 'scale(0.85)',
                  transition: 'opacity 480ms cubic-bezier(0.2,0.8,0.2,1), transform 480ms cubic-bezier(0.2,0.8,0.2,1)',
                }}
              >
                <Confetti trigger={confettiTrigger} />
                <p style={{
                  margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: '0.12em',
                  textTransform: 'uppercase', color: '#a86421',
                }}>
                  Champions
                </p>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  gap: 10, marginTop: 8,
                }}>
                  <span style={{
                    width: 18, height: 18, borderRadius: '50%',
                    background: winner.color,
                    border: '2px solid white', boxShadow: `0 0 0 1px ${winner.color}`,
                  }} />
                  <span style={{
                    fontSize: 22, fontWeight: 700, color: CARD_TEXT,
                    letterSpacing: '-0.01em',
                  }}>
                    {winner.name}
                  </span>
                </div>
                <p style={{
                  margin: '4px 0 0', fontSize: 24, fontWeight: 700, color: ORANGE,
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  <RollingNumber
                    value={winner.tokens}
                    startDelayMs={rowDelayMs(0) + COUNT_LEAD_MS}
                    durationMs={COUNT_DUR_MS}
                  />
                  <span style={{
                    fontSize: 13, fontWeight: 600, color: STAT_TEXT,
                    marginLeft: 6, letterSpacing: '0.02em',
                  }}>
                    tokens
                  </span>
                </p>
              </div>

              <Divider />
            </>
          )}

          <p style={{
            margin: '0 0 8px', fontSize: 14, fontWeight: 600,
            color: CARD_TEXT,
          }}>
            Final standings
          </p>

          {N === 0 ? (
            <div style={{
              background: FILL_LIGHT, color: STAT_TEXT,
              borderRadius: 10, padding: '14px 16px',
              fontSize: 14, textAlign: 'center',
            }}>
              No teams played.
            </div>
          ) : (
            <div style={{
              background: FILL_LIGHT, borderRadius: 12,
              overflow: 'hidden',
            }}>
              {teams.map((team, i) => {
                const isWinner = i === 0;
                const delay = rowDelayMs(i);
                return (
                  <div
                    key={team.id}
                    className="endpage-row"
                    style={{
                      animationDelay: `${delay}ms`,
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '12px 14px',
                      borderTop: i === 0 ? 'none' : `1px solid ${HAIRLINE}`,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                      <span style={{
                        fontSize: 15, fontWeight: 700, color: STAT_TEXT,
                        width: 22, textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                        opacity: isWinner ? 1 : 0.55,
                      }}>
                        {i + 1}
                      </span>
                      <span style={{
                        width: 14, height: 14, borderRadius: '50%',
                        background: team.color, flexShrink: 0,
                        border: '2px solid white', boxShadow: `0 0 0 1px ${team.color}`,
                      }} />
                      <span style={{
                        fontSize: 15,
                        fontWeight: isWinner ? 700 : 600,
                        color: CARD_TEXT,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {team.name}
                      </span>
                    </div>
                    <span style={{
                      fontSize: 16, fontWeight: 700, color: isWinner ? ORANGE : CARD_TEXT,
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                      <RollingNumber
                        value={team.tokens}
                        startDelayMs={delay + COUNT_LEAD_MS}
                        durationMs={COUNT_DUR_MS}
                      />
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          <Divider />

          <div style={{
            display: 'flex', gap: 10, justifyContent: 'space-between',
          }}>
            <a href="/join" style={{
              flex: 1, textAlign: 'center',
              padding: '13px 18px', fontSize: 15, fontWeight: 700,
              background: ORANGE, color: 'white',
              borderRadius: 10, textDecoration: 'none',
              letterSpacing: '0.01em',
            }}>
              Join another
            </a>
            <a href="/" style={{
              flex: 1, textAlign: 'center',
              padding: '13px 18px', fontSize: 15, fontWeight: 700,
              background: FILL_LIGHT, color: CARD_TEXT,
              borderRadius: 10, textDecoration: 'none',
              letterSpacing: '0.01em',
              border: `1px solid ${HAIRLINE}`,
            }}>
              New game
            </a>
          </div>
        </div>
      </div>
    </>
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

// ── Rolling token counter ────────────────────────────────────────────
// Animates from 0 to `value` over `durationMs`, starting after
// `startDelayMs`.  Uses ease-out-cubic so the count decelerates into
// place.
function RollingNumber({
  value, startDelayMs = 0, durationMs = 900,
}: { value: number; startDelayMs?: number; durationMs?: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const startAt = performance.now() + startDelayMs;
    let raf = 0;
    function tick(now: number) {
      const elapsed = now - startAt;
      if (elapsed < 0) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const t = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(value * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, startDelayMs, durationMs]);
  return <>{display}</>;
}

// ── Confetti burst ───────────────────────────────────────────────────
// Tiny canvas-based emitter.  When `trigger` changes, fires a fresh
// burst of rectangular particles from the center of the host element.
// Particle colors pull from the in-game team palette + brand orange.
const CONFETTI_COLORS = [
  '#E88B3E', '#C41230', '#0082C8', '#80561B',
  '#008751', '#492F90', '#F38AB4', '#FBD907',
];
function Confetti({ trigger }: { trigger: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!trigger || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width  = Math.max(1, rect.width  * dpr);
    canvas.height = Math.max(1, rect.height * dpr);
    ctx.scale(dpr, dpr);

    const cx = rect.width / 2;
    const cy = rect.height * 0.45;

    type P = {
      x: number; y: number; vx: number; vy: number;
      rot: number; vRot: number; size: number;
      color: string; life: number; maxLife: number;
    };
    const particles: P[] = Array.from({ length: 90 }, () => {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9;
      const speed = 5 + Math.random() * 8;
      return {
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        rot: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 0.4,
        size: 5 + Math.random() * 5,
        color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
        life: 0,
        maxLife: 90 + Math.random() * 60,
      };
    });

    let raf = 0;
    function frame() {
      ctx!.clearRect(0, 0, rect.width, rect.height);
      let alive = false;
      for (const p of particles) {
        if (p.life >= p.maxLife) continue;
        alive = true;
        p.life += 1;
        p.vy += 0.32;            // gravity
        p.vx *= 0.992;            // air drag
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vRot;
        const fade = 1 - p.life / p.maxLife;
        ctx!.save();
        ctx!.translate(p.x, p.y);
        ctx!.rotate(p.rot);
        ctx!.globalAlpha = Math.max(0, fade);
        ctx!.fillStyle = p.color;
        ctx!.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.55);
        ctx!.restore();
      }
      if (alive) raf = requestAnimationFrame(frame);
      else ctx!.clearRect(0, 0, rect.width, rect.height);
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [trigger]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute', inset: 0,
        pointerEvents: 'none',
        // Burst should escape the cream pill so confetti fans across the card.
        overflow: 'visible',
        width: '100%', height: '100%',
      }}
      aria-hidden
    />
  );
}
