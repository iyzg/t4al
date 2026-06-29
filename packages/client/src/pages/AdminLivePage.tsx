import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import maplibregl from 'maplibre-gl';
import { getMapStyle, CHICAGO_CENTER, CHICAGO_BOUNDS, MIN_ZOOM, MAX_ZOOM } from '../mapStyle';
import { ensurePmtilesProtocol } from '../mapSetup';
import { socket } from '../socket';
import { useGameStore } from '../store';
import { registerSocketHandlers } from '../socketHandlers';
import type { Challenge, Game, GameEvent, Team } from '@t4al/shared';
import PressHold from '../components/PressHold';
import { SectionLabel, EmptyState } from '../components/ui';
import { challengePopupHTML } from '../challengePopup';
import {
  typeColor, statusColor, gameStatusColor,
  ORANGE, INK, INK_SOFT, WHITE, CREAM, FILL, HAIRLINE, BRAND_GREY, NAVY,
  DISABLED_BG, DISABLED_TEXT, DANGER, STATUS_COLORS,
  RADIUS_FIELD, RADIUS_PILL,
} from '../theme';

ensurePmtilesProtocol();

function adminHeaders(gameId: string | undefined): HeadersInit {
  const code = gameId ? localStorage.getItem(`adminCode:${gameId}`) ?? '' : '';
  return { 'Content-Type': 'application/json', 'x-admin-code': code };
}

type EventCat = 'wins' | 'setbacks' | 'activity' | 'game' | 'teams';

// Sentiment category for an event — drives the colored left-rule on each log row.
function eventCat(type: string): EventCat {
  if (type === 'challenge:claimed') return 'wins';
  if (type === 'challenge:expired' || type === 'challenge:wagerFailed' || type === 'challenge:abandoned') return 'setbacks';
  if (type === 'challenge:spawned' || type === 'challenge:started') return 'activity';
  if (type === 'team:created' || type === 'team:reassigned') return 'teams';
  return 'game';
}

const CAT_COLOR: Record<EventCat, string> = {
  wins:     STATUS_COLORS.claimed,   // green
  setbacks: STATUS_COLORS.expired,   // terracotta
  activity: typeColor('normal'),     // dusty blue
  game:     ORANGE,
  teams:    STATUS_COLORS.queued,    // taupe
};

// Live-map challenge marker styling. Active challenges get a soft colored halo
// at full strength so they pop on the warm map; finished (claimed/expired) ones
// dim back. Box size stays constant so MapLibre's centering transform — applied
// to this same element — is never disturbed (we only touch visual properties).
function styleChallengeMarker(el: HTMLElement, status: string, color: string) {
  const active = status === 'active';
  const done = status === 'claimed' || status === 'expired';
  el.style.width = '13px';
  el.style.height = '13px';
  el.style.background = color;
  el.style.borderRadius = '50%';
  el.style.border = '2px solid white';
  // `${color}59` = the marker color at ~35% alpha for the halo ring.
  el.style.boxShadow = active ? `0 0 0 3px ${color}59, 0 1px 4px rgba(0,0,0,0.3)` : 'none';
  el.style.opacity = done ? '0.5' : '1';
}

export default function AdminLivePage() {
  const { gameId } = useParams<{ gameId: string }>();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const challengeMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const teamMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const challengesRef = useRef<Challenge[]>([]);
  const hoverPopupRef = useRef<maplibregl.Popup | null>(null);

  const [game, setGame] = useState<Game | null>(null);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [countdown, setCountdown] = useState('');
  const [error, setError] = useState('');
  const [teamsPositions, setTeamsPositions] = useState<{ teamId: string; lat: number; lng: number }[]>([]);
  // Clicking a team/challenge (in the log, the sidebar lists, or the map) filters
  // the event log to it; clicking the map background clears it.
  const [selectedEntity, setSelectedEntity] = useState<{ kind: 'team' | 'challenge'; id: string } | null>(null);
  const [typeFilter, setTypeFilter] = useState<'all' | EventCat>('all');

  useEffect(() => { challengesRef.current = challenges; }, [challenges]);

  // Show/hide the on-map challenge tooltip. Hover (desktop) or tap (mobile) a
  // challenge dot to see its name + token value; tapping the map dismisses it.
  const showChallengePopup = useCallback((id: string) => {
    const cur = challengesRef.current.find((ch) => ch.id === id);
    const map = mapRef.current;
    if (!cur || !map) return;
    if (!hoverPopupRef.current) {
      hoverPopupRef.current = new maplibregl.Popup({
        closeButton: false, closeOnClick: false, offset: 14, className: 'challenge-popup',
      });
    }
    const popup = hoverPopupRef.current;
    popup.setLngLat([cur.lng, cur.lat]).setHTML(challengePopupHTML(cur, { status: cur.status }));
    if (!popup.isOpen()) popup.addTo(map);
    const el = popup.getElement();
    if (el) requestAnimationFrame(() => el.classList.add('is-visible'));
  }, []);
  const hideChallengePopup = useCallback(() => {
    hoverPopupRef.current?.getElement()?.classList.remove('is-visible');
  }, []);

  // Admin auth + socket connect
  useEffect(() => {
    if (!gameId) return;
    const adminCode = localStorage.getItem(`adminCode:${gameId}`);
    if (!adminCode) {
      setError('Admin code missing from localStorage. Navigate back through the game-creation flow.');
      return;
    }
    useGameStore.getState().setAdminCode(adminCode);
    registerSocketHandlers();
    socket.connect();
    socket.emit('admin:join', { gameId, adminCode });

    socket.on('teams:positions', (data) => {
      setTeamsPositions(data.positions);
    });
    return () => { socket.off('teams:positions'); };
  }, [gameId]);

  // Fetch data initially and poll periodically (lightweight supplement to sockets)
  useEffect(() => {
    if (!gameId) return;
    const fetchData = async () => {
      try {
        const [gRes, cRes, tRes, eRes] = await Promise.all([
          fetch(`/api/games/${gameId}`, { headers: adminHeaders(gameId) }),
          fetch(`/api/games/${gameId}/challenges`, { headers: adminHeaders(gameId) }),
          fetch(`/api/games/${gameId}/teams`),
          fetch(`/api/games/${gameId}/events`, { headers: adminHeaders(gameId) }),
        ]);
        if (gRes.ok) setGame(await gRes.json());
        if (cRes.ok) setChallenges(await cRes.json());
        if (tRes.ok) setTeams(await tRes.json());
        if (eRes.ok) setEvents(await eRes.json());
      } catch { /* skip cycle */ }
    };
    fetchData();
    const id = setInterval(fetchData, 5000);
    return () => clearInterval(id);
  }, [gameId]);

  // Countdown
  useEffect(() => {
    if (!game?.endTime) { setCountdown(''); return; }
    const endTime = new Date(game.endTime).getTime();
    const tick = () => {
      const diff = endTime - Date.now();
      if (diff <= 0) { setCountdown('0:00'); return; }
      const min = Math.floor(diff / 60000);
      const sec = Math.floor((diff % 60000) / 1000);
      setCountdown(`${min}:${sec.toString().padStart(2, '0')}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [game?.endTime]);

  // Init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    try {
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: getMapStyle(),
        center: CHICAGO_CENTER,
        zoom: 14,
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
        maxBounds: CHICAGO_BOUNDS,
      });
      map.on('click', () => {
        hoverPopupRef.current?.getElement()?.classList.remove('is-visible');
        setSelectedEntity(null);
      });
      mapRef.current = map;
      return () => {
        hoverPopupRef.current?.remove();
        hoverPopupRef.current = null;
        map.remove();
        mapRef.current = null;
      };
    } catch (err) { console.warn('Map init failed:', err); }
  }, []);

  // Challenge markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const ids = new Set(challenges.map((c) => c.id));
    challengeMarkersRef.current.forEach((m, id) => {
      if (!ids.has(id)) { m.remove(); challengeMarkersRef.current.delete(id); }
    });
    challenges.forEach((c) => {
      const color = statusColor(c.status, c.type);
      const existing = challengeMarkersRef.current.get(c.id);
      if (existing) {
        const el = existing.getElement();
        styleChallengeMarker(el, c.status, color);
        return;
      }
      const el = document.createElement('div');
      styleChallengeMarker(el, c.status, color);
      el.style.cursor = 'pointer';
      el.addEventListener('mouseenter', () => showChallengePopup(c.id));
      el.addEventListener('mouseleave', hideChallengePopup);
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        showChallengePopup(c.id);
        setSelectedEntity((s) => (s?.kind === 'challenge' && s.id === c.id ? null : { kind: 'challenge', id: c.id }));
      });
      const marker = new maplibregl.Marker({ element: el }).setLngLat([c.lng, c.lat]).addTo(map);
      challengeMarkersRef.current.set(c.id, marker);
    });
  }, [challenges]);

  // Team position markers (from live admin broadcast)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const ids = new Set(teamsPositions.map((p) => p.teamId));
    teamMarkersRef.current.forEach((m, id) => {
      if (!ids.has(id)) { m.remove(); teamMarkersRef.current.delete(id); }
    });
    teamsPositions.forEach((p) => {
      const team = teams.find((t) => t.id === p.teamId);
      const existing = teamMarkersRef.current.get(p.teamId);
      if (existing) {
        existing.setLngLat([p.lng, p.lat]);
        return;
      }
      const el = document.createElement('div');
      // Drop shadow lifts the dot off the map so even map-matching team colors
      // (green on parkland, brown on the warm base) stay legible.
      el.style.cssText = `width:18px;height:18px;background:${team?.color ?? BRAND_GREY};border:3px solid white;border-radius:50%;box-shadow:0 1px 5px rgba(0,0,0,0.45);cursor:pointer;`;
      el.title = team?.name ?? '';
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        setSelectedEntity((s) => (s?.kind === 'team' && s.id === p.teamId ? null : { kind: 'team', id: p.teamId }));
      });
      const marker = new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map);
      teamMarkersRef.current.set(p.teamId, marker);
    });
  }, [teamsPositions, teams]);

  // Controls
  async function handleStart() {
    if (!gameId) return;
    const res = await fetch(`/api/games/${gameId}/start`, { method: 'POST', headers: adminHeaders(gameId) });
    if (!res.ok) { const e = await res.json().catch(() => null); setError(e?.error || 'Start failed'); }
  }

  // End + force-expire are confirmed by a press-and-hold gesture (see the
  // buttons below), so they no longer pop a native confirm() dialog.
  async function handleEnd() {
    if (!gameId) return;
    const res = await fetch(`/api/games/${gameId}/end`, { method: 'POST', headers: adminHeaders(gameId) });
    if (!res.ok) { const e = await res.json().catch(() => null); setError(e?.error || 'End failed'); }
  }

  async function handleForceExpire(challengeId: string) {
    if (!gameId) return;
    const res = await fetch(`/api/games/${gameId}/challenges/${challengeId}/force-expire`, {
      method: 'POST', headers: adminHeaders(gameId),
    });
    if (!res.ok) { const e = await res.json().catch(() => null); setError(e?.error || 'Force-expire failed'); }
  }

  const gameStatus = game?.status ?? 'loading';
  const statusBuckets = {
    queued:  challenges.filter((c) => c.status === 'queued'),
    active:  challenges.filter((c) => c.status === 'active'),
    claimed: challenges.filter((c) => c.status === 'claimed'),
    expired: challenges.filter((c) => c.status === 'expired'),
  };
  const canStart = gameStatus === 'lobby';
  const canEnd = gameStatus === 'active';

  const selTeam = (id: string) => setSelectedEntity((s) => (s?.kind === 'team' && s.id === id ? null : { kind: 'team', id }));
  const selChallenge = (id: string) => setSelectedEntity((s) => (s?.kind === 'challenge' && s.id === id ? null : { kind: 'challenge', id }));
  const isSelTeam = (id: string) => selectedEntity?.kind === 'team' && selectedEntity.id === id;
  const isSelChallenge = (id: string) => selectedEntity?.kind === 'challenge' && selectedEntity.id === id;

  // Inline, clickable entity references inside log lines. Teams carry their color
  // + a dot icon; challenges carry their type color, bold. Clicking either filters
  // the log to it.
  const teamRef = (id?: string | null, fallback?: string) => {
    const t = id ? teams.find((x) => x.id === id) : undefined;
    const name = t?.name ?? fallback ?? 'Team';
    const color = t?.color ?? BRAND_GREY;
    return (
      <span onClick={(e) => { e.stopPropagation(); if (id) selTeam(id); }}
        style={{ color: INK, fontWeight: 700, cursor: id ? 'pointer' : 'default', whiteSpace: 'nowrap' }}>
        <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', background: color, border: '2px solid white', boxShadow: `0 0 0 1px ${color}`, marginRight: 5, verticalAlign: 'middle', position: 'relative', top: -1 }} />
        {name}
      </span>
    );
  };
  const challengeRef = (id?: string | null, fallback?: string) => {
    const c = id ? challenges.find((x) => x.id === id) : undefined;
    const name = c?.name ?? fallback ?? 'a challenge';
    return (
      <span onClick={(e) => { e.stopPropagation(); if (id) selChallenge(id); }}
        style={{ color: c ? typeColor(c.type) : INK_SOFT, fontWeight: 700, cursor: id ? 'pointer' : 'default' }}>
        {name}
      </span>
    );
  };
  const renderEvent = (type: string, p: any) => {
    switch (type) {
      case 'game:started': return 'Game started';
      case 'game:ended':   return 'Game ended';
      case 'team:created': return <>New team: {p.name ?? ''}</>;
      case 'team:reassigned':
        return <>Device reassigned: {teamRef(p.fromTeamId)} → {teamRef(p.toTeamId)}</>;
      case 'challenge:spawned':
        return <>{challengeRef(p.challengeId, p.name)} spawned</>;
      case 'challenge:started':
        return <>{teamRef(p.teamId)} started {challengeRef(p.challengeId)}</>;
      case 'challenge:abandoned':
        return <>{teamRef(p.teamId)} gave up on {challengeRef(p.challengeId)}</>;
      case 'challenge:expired':
        return <>{challengeRef(p.challengeId)} expired</>;
      case 'challenge:claimed':
        return <>{teamRef(p.teamId, p.teamName)} claimed {challengeRef(p.challengeId)} (+{p.tokensAwarded ?? '?'})</>;
      case 'challenge:wagerFailed':
        return <>{teamRef(p.teamId)} failed wager on {challengeRef(p.challengeId)} (−{p.wagerAmount ?? '?'})</>;
      default: return type;
    }
  };
  const shownEvents = events.filter((e) => {
    if (typeFilter !== 'all' && eventCat(e.type) !== typeFilter) return false;
    if (selectedEntity) {
      const p: any = e.payload || {};
      if (selectedEntity.kind === 'challenge') { if (p.challengeId !== selectedEntity.id) return false; }
      else if (!(p.teamId === selectedEntity.id || p.fromTeamId === selectedEntity.id || p.toTeamId === selectedEntity.id)) return false;
    }
    return true;
  });

  return (
    <div className="admin-layout" style={{ display: 'flex', height: '100vh' }}>
      <div ref={containerRef} className="admin-map" style={{ flex: 1 }} />

      <div className="admin-sidebar" style={{
        width: 380, background: WHITE, color: INK, overflow: 'auto', padding: 20,
        borderLeft: `1px solid ${HAIRLINE}`,
        boxShadow: '-6px 0 24px rgba(0, 0, 0, 0.08)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em', color: INK }}>
            Live game
          </h1>
          {gameStatus === 'lobby' && (
            <Link to={`/game/${gameId}/admin/setup`}
              style={{ color: ORANGE, textDecoration: 'none', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>
              Edit challenges
            </Link>
          )}
        </div>

        {error && (
          <p style={{ color: DANGER, margin: '0 0 12px', fontSize: 13, fontWeight: 600, lineHeight: 1.4 }}>
            {error}
          </p>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            padding: '5px 12px', borderRadius: RADIUS_PILL, background: FILL,
            fontSize: 12, fontWeight: 700, letterSpacing: '0.04em', color: INK,
          }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: gameStatusColor(gameStatus) }} />
            {gameStatus.toUpperCase()}
          </span>
          {countdown && (
            <span style={{
              background: NAVY, color: WHITE, borderRadius: RADIUS_PILL,
              padding: '5px 14px', fontSize: 16, fontWeight: 700,
              fontVariantNumeric: 'tabular-nums', letterSpacing: '0.02em',
            }}>
              {countdown}
            </span>
          )}
        </div>

        {game && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 12, color: INK_SOFT, marginBottom: 8 }}>
              Join{' '}
              <code style={{
                background: FILL, padding: '2px 8px', borderRadius: 6,
                letterSpacing: 1, fontWeight: 700, color: INK,
              }}>{game.joinCode}</code>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {[
                `${game.activeChallengeCount} active at a time`,
                `${game.challengeExpireMinutes} min to expire`,
                `${game.startingTokens} starting tokens`,
              ].map((s) => (
                <span key={s} style={{
                  background: FILL, color: INK_SOFT, borderRadius: 6,
                  padding: '3px 9px', fontSize: 12, fontWeight: 600,
                }}>{s}</span>
              ))}
            </div>
          </div>
        )}

        {/* Controls */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 22 }}>
          <button onClick={handleStart} disabled={!canStart}
            style={{
              flex: 1, padding: '12px 14px', borderRadius: RADIUS_FIELD, border: 'none',
              fontSize: 14, fontWeight: 700,
              background: canStart ? ORANGE : DISABLED_BG,
              color: canStart ? WHITE : DISABLED_TEXT,
              cursor: canStart ? 'pointer' : 'not-allowed',
            }}>
            Start game
          </button>
          <PressHold
            onComplete={handleEnd}
            disabled={!canEnd}
            ariaLabel="Hold to end the game"
            fillColor="rgba(255, 255, 255, 0.3)"
            idleStyle={{
              flex: 1, padding: '12px 14px', borderRadius: RADIUS_FIELD,
              fontSize: 14, fontWeight: 700,
              background: canEnd ? STATUS_COLORS.expired : DISABLED_BG,
              color: canEnd ? WHITE : DISABLED_TEXT,
            }}
          >
            {canEnd ? 'Hold to end' : 'End game'}
          </PressHold>
        </div>

        {/* Teams */}
        <SectionLabel style={{ marginBottom: 10 }}>Teams</SectionLabel>
        {teams.length === 0 ? (
          <EmptyState>No teams yet</EmptyState>
        ) : (
          <div style={{ background: FILL, borderRadius: 12, overflow: 'hidden' }}>
            {teams.map((t, i) => (
              <div key={t.id}
                onClick={() => selTeam(t.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px', fontSize: 14, cursor: 'pointer',
                  borderTop: i === 0 ? 'none' : `1px solid ${HAIRLINE}`,
                  background: isSelTeam(t.id) ? CREAM : 'transparent',
                }}>
                <span style={{
                  width: 12, height: 12, borderRadius: '50%', background: t.color, flexShrink: 0,
                  border: '2px solid white', boxShadow: `0 0 0 1px ${t.color}`,
                }} />
                <span style={{
                  color: INK, fontWeight: 600,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>{t.name}</span>
                {t.activeChallengeId && <span style={{ fontSize: 11, color: INK_SOFT }}>active</span>}
                <span style={{ marginLeft: 'auto', fontWeight: 700, color: INK, fontVariantNumeric: 'tabular-nums' }}>
                  {t.tokens}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Challenges by bucket */}
        <SectionLabel style={{ margin: '22px 0 6px' }}>Challenges</SectionLabel>
        <div style={{ fontSize: 12, color: INK_SOFT, marginBottom: 10, fontVariantNumeric: 'tabular-nums' }}>
          {statusBuckets.queued.length} queued · {statusBuckets.active.length} active · {statusBuckets.claimed.length} claimed · {statusBuckets.expired.length} expired
        </div>
        {challenges.length === 0 ? (
          <EmptyState>No challenges yet</EmptyState>
        ) : (
          <div style={{ background: FILL, borderRadius: 12, overflow: 'hidden' }}>
            {[...challenges].sort((a, b) => a.sortOrder - b.sortOrder).map((c, i) => {
              const isActive = c.status === 'active';
              const isDone = c.status === 'claimed' || c.status === 'expired';
              const tColor = typeColor(c.type);
              // Visual hierarchy: active challenges are the live ones, so they
              // get a raised white row, a type-color left accent, a filled
              // status pill, and a bolder name. Finished (claimed/expired) rows
              // dim back; queued rows sit neutral. Keeps the muted palette but
              // makes "what's live right now" the thing the eye lands on.
              return (
                <div key={c.id}
                  onClick={() => selChallenge(c.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer',
                    padding: '9px 12px 9px 9px', fontSize: 13,
                    borderTop: i === 0 ? 'none' : `1px solid ${HAIRLINE}`,
                    borderLeft: `3px solid ${isActive ? tColor : 'transparent'}`,
                    background: isSelChallenge(c.id) ? CREAM : (isActive ? WHITE : 'transparent'),
                    opacity: isDone ? 0.5 : 1,
                  }}>
                  <span style={{
                    fontSize: 10, width: 18, height: 18, borderRadius: 5,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    background: tColor, color: WHITE, fontWeight: 700, flexShrink: 0,
                  }}>
                    {c.type.charAt(0).toUpperCase()}
                  </span>
                  {isActive ? (
                    <span style={{
                      flexShrink: 0, padding: '2px 9px', borderRadius: RADIUS_PILL,
                      background: tColor, color: WHITE,
                      fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
                    }}>
                      Active
                    </span>
                  ) : (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor(c.status, c.type) }} />
                      <span style={{ fontSize: 11, fontWeight: 700, color: INK_SOFT, textTransform: 'capitalize' }}>
                        {c.status}
                      </span>
                    </span>
                  )}
                  <span style={{
                    flex: 1, color: INK, fontWeight: isActive ? 700 : 500,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {c.name}
                  </span>
                  {gameStatus === 'active' && isActive && (
                    <PressHold
                      onComplete={() => handleForceExpire(c.id)}
                      ariaLabel={`Hold to force-expire ${c.name}`}
                      fillColor="rgba(255, 255, 255, 0.32)"
                      idleStyle={{
                        padding: '4px 10px', fontSize: 10, fontWeight: 700,
                        borderRadius: 6, background: STATUS_COLORS.expired, color: WHITE,
                        whiteSpace: 'nowrap', flexShrink: 0,
                      }}
                    >
                      Hold to expire
                    </PressHold>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Event log */}
        <SectionLabel style={{ margin: '22px 0 8px' }}>Event log</SectionLabel>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {(['all', 'wins', 'setbacks', 'activity', 'game', 'teams'] as const).map((f) => {
            const active = typeFilter === f;
            const color = f === 'all' ? INK : CAT_COLOR[f];
            return (
              <button key={f} onClick={() => setTypeFilter(f)}
                style={{
                  padding: '4px 10px', borderRadius: RADIUS_PILL, cursor: 'pointer',
                  fontSize: 11, fontWeight: 700, textTransform: 'capitalize',
                  border: `1px solid ${active ? color : HAIRLINE}`,
                  background: active ? color : WHITE,
                  color: active ? WHITE : (f === 'all' ? INK_SOFT : color),
                }}>
                {f}
              </button>
            );
          })}
        </div>

        {selectedEntity && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 12, color: INK_SOFT }}>
            <span>Filtered to</span>
            {selectedEntity.kind === 'team' ? teamRef(selectedEntity.id) : challengeRef(selectedEntity.id)}
            <button onClick={() => setSelectedEntity(null)}
              style={{
                marginLeft: 'auto', background: 'none', border: `1px solid ${HAIRLINE}`,
                color: INK_SOFT, borderRadius: RADIUS_PILL, padding: '2px 10px',
                fontSize: 11, fontWeight: 700, cursor: 'pointer',
              }}>
              Clear ×
            </button>
          </div>
        )}

        {events.length === 0 ? (
          <EmptyState>No events yet</EmptyState>
        ) : (
          <div style={{ background: FILL, borderRadius: 12, padding: '4px 0', maxHeight: 320, overflow: 'auto' }}>
            {shownEvents.length === 0 ? (
              <div style={{ padding: 12, fontSize: 12, color: INK_SOFT, textAlign: 'center' }}>
                No events for this selection.
              </div>
            ) : shownEvents.map((e) => {
              const cat = eventCat(e.type);
              return (
                <div key={e.id} style={{ display: 'flex', alignItems: 'stretch' }}>
                  <span
                    onClick={() => setTypeFilter((prev) => (prev === cat ? 'all' : cat))}
                    title={`Filter to ${cat}`}
                    style={{ width: 4, alignSelf: 'stretch', background: CAT_COLOR[cat], cursor: 'pointer', flexShrink: 0 }}
                  />
                  <div style={{
                    flex: 1, display: 'flex', gap: 8, padding: '7px 12px 7px 9px',
                    fontSize: 12, lineHeight: 1.5, alignItems: 'flex-start',
                  }}>
                    <span style={{ color: INK_SOFT, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                      {new Date(e.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    </span>
                    <span style={{ color: INK_SOFT }}>
                      {renderEvent(e.type, e.payload)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
