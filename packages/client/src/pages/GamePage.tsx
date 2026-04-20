import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import maplibregl from 'maplibre-gl';
import { getMapStyle, CHICAGO_CENTER, DEFAULT_ZOOM } from '../mapStyle';
import { ensurePmtilesProtocol } from '../mapSetup';
import { useGameStore, getOrCreateDeviceId } from '../store';
import { socket } from '../socket';
import {
  registerSocketHandlers,
  emitAccept,
  emitWager,
  emitComplete,
  emitFail,
  emitAbandon,
} from '../socketHandlers';
import { LOCATION_PING_INTERVAL_MS } from '@t4al/shared';
import type { Challenge, TeamSnapshot } from '@t4al/shared';
import Leaderboard from '../components/Leaderboard';
import GameHUD from '../components/GameHUD';
import Toast from '../components/Toast';

ensurePmtilesProtocol();

// Haversine distance in meters
function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getTeamsOnChallenge(challengeId: string, teamSnapshots: TeamSnapshot[]): TeamSnapshot[] {
  return teamSnapshots.filter((t) => t.activeChallengeId === challengeId);
}

// Type-specific "reward" string shown on the pin and card header
function rewardLabel(c: Challenge): string {
  if (c.type === 'normal')   return `${c.tokens} tokens`;
  if (c.type === 'variable') return `${c.tokensPerUnit}/${c.unitLabel}`;
  return 'WAGER';
}

export default function GamePage() {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const posMarkerRef = useRef<maplibregl.Marker | null>(null);
  const myPosRef = useRef<{ lat: number; lng: number } | null>(null);

  const challenges        = useGameStore((s) => s.challenges);
  const activeChallengeId = useGameStore((s) => s.activeChallengeId);
  const wagerAmount       = useGameStore((s) => s.wagerAmount);
  const tokens            = useGameStore((s) => s.tokens);
  const teamId            = useGameStore((s) => s.teamId);
  const gameStatus        = useGameStore((s) => s.gameStatus);
  const teamColor         = useGameStore((s) => s.teamColor);
  const gameId            = useGameStore((s) => s.gameId);
  const teamSnapshots     = useGameStore((s) => s.teamSnapshots);
  const acceptedLocally   = useGameStore((s) => s.acceptedLocally);

  const [selectedChallengeId, setSelectedChallengeId] = useState<string | null>(null);
  const [myPos, setMyPos] = useState<{ lat: number; lng: number } | null>(null);

  const selectedChallenge = selectedChallengeId ? challenges[selectedChallengeId] ?? null : null;

  useEffect(() => { registerSocketHandlers(); }, []);

  // Restore identity from sessionStorage on refresh, else redirect to /join
  useEffect(() => {
    if (gameId && teamId) return;
    const saved = sessionStorage.getItem('t4al_identity');
    if (!saved) {
      navigate('/join');
      return;
    }
    try {
      const { gameId: gid, teamId: tid, teamColor: tc } = JSON.parse(saved);
      const deviceId = getOrCreateDeviceId();
      useGameStore.getState().setIdentity({ gameId: gid, teamId: tid, teamColor: tc, deviceId });
      registerSocketHandlers();
      socket.connect();
      socket.emit('game:join', { gameId: gid, teamId: tid, deviceId });
    } catch {
      navigate('/join');
    }
  }, [gameId, teamId, navigate]);

  // Redirect to end page when game ends
  useEffect(() => {
    if (gameStatus === 'ended' && gameId) navigate(`/game/${gameId}/end`);
  }, [gameStatus, gameId, navigate]);

  // Start GPS + per-device ping heartbeat
  useEffect(() => {
    if (!teamId || !gameId) return;
    const deviceId = getOrCreateDeviceId();

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        setMyPos({ lat, lng });
        myPosRef.current = { lat, lng };
        useGameStore.getState().setMyLocation({ lat, lng });
      },
      (err) => console.warn('GPS error:', err.message),
      { enableHighAccuracy: true },
    );

    const heartbeat = setInterval(() => {
      const pos = myPosRef.current;
      if (pos) {
        socket.emit('location:update', { deviceId, teamId, lat: pos.lat, lng: pos.lng });
      }
    }, LOCATION_PING_INTERVAL_MS);

    return () => {
      navigator.geolocation.clearWatch(watchId);
      clearInterval(heartbeat);
    };
  }, [teamId, gameId]);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    try {
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: getMapStyle(),
        center: CHICAGO_CENTER,
        zoom: DEFAULT_ZOOM,
      });
      mapRef.current = map;
      return () => {
        map.remove();
        mapRef.current = null;
      };
    } catch (err) {
      console.warn('Map failed to initialize:', err);
    }
  }, []);

  // Sync my GPS dot
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !myPos) return;
    if (!posMarkerRef.current) {
      const el = document.createElement('div');
      el.style.cssText = `width:14px;height:14px;background:${teamColor || '#3498db'};border-radius:50%;border:3px solid white;box-shadow:0 0 6px rgba(0,0,0,0.5);`;
      posMarkerRef.current = new maplibregl.Marker({ element: el }).setLngLat([myPos.lng, myPos.lat]).addTo(map);
    } else {
      posMarkerRef.current.setLngLat([myPos.lng, myPos.lat]);
    }
  }, [myPos, teamColor]);

  // Sync challenge markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const challengeList = Object.values(challenges);
    const currentIds = new Set(challengeList.map((c) => c.id));

    markersRef.current.forEach((marker, id) => {
      if (!currentIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    });

    challengeList.forEach((c) => {
      if (c.status !== 'active') return;
      const teamsOnIt = getTeamsOnChallenge(c.id, teamSnapshots);
      const existing = markersRef.current.get(c.id);
      if (existing) {
        existing.setLngLat([c.lng, c.lat]);
        applyMarkerStyle(existing.getElement(), c, activeChallengeId, teamsOnIt);
        return;
      }
      const el = document.createElement('div');
      applyMarkerStyle(el, c, activeChallengeId, teamsOnIt);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        setSelectedChallengeId(c.id);
      });
      const marker = new maplibregl.Marker({ element: el }).setLngLat([c.lng, c.lat]).addTo(map);
      markersRef.current.set(c.id, marker);
    });
  }, [challenges, activeChallengeId, teamSnapshots]);

  // Deselect gone challenge
  useEffect(() => {
    if (selectedChallengeId && !challenges[selectedChallengeId]) setSelectedChallengeId(null);
  }, [challenges, selectedChallengeId]);

  // ── Action handlers ──
  const handleAccept = useCallback(() => {
    if (!selectedChallenge || !teamId) return;
    emitAccept(selectedChallenge.id, teamId);
  }, [selectedChallenge, teamId]);

  const handleAbandon = useCallback(() => {
    if (!activeChallengeId || !teamId) return;
    emitAbandon(activeChallengeId, teamId);
    setSelectedChallengeId(null);
  }, [activeChallengeId, teamId]);

  const handleComplete = useCallback((count?: number) => {
    if (!activeChallengeId || !teamId) return;
    if (!confirm('Are you sure you completed this challenge?')) return;
    emitComplete(activeChallengeId, teamId, count);
  }, [activeChallengeId, teamId]);

  const handleSetWager = useCallback((amount: number) => {
    if (!activeChallengeId || !teamId) return;
    emitWager(activeChallengeId, teamId, amount);
  }, [activeChallengeId, teamId]);

  const handleFailWager = useCallback(() => {
    if (!activeChallengeId || !teamId) return;
    if (!confirm('Confirm: you failed this wager? Your tokens will be deducted.')) return;
    emitFail(activeChallengeId, teamId);
  }, [activeChallengeId, teamId]);

  const distance = selectedChallenge && myPos
    ? distanceMeters(myPos.lat, myPos.lng, selectedChallenge.lat, selectedChallenge.lng)
    : null;
  const inRange = selectedChallenge && distance != null
    ? distance <= selectedChallenge.proximityMeters
    : false;
  const isMyActive = selectedChallenge?.id === activeChallengeId;

  // Description visibility: revealed when in range OR we've accepted this challenge.
  const descriptionVisible = selectedChallenge != null &&
    (inRange || isMyActive || acceptedLocally.has(selectedChallenge.id));

  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      <GameHUD />
      <Toast />

      {/* Lobby overlay — hides leaderboard + tokens; shows team-color stack + "Game starting soon!" banner */}
      {gameStatus === 'lobby' ? (
        <LobbyOverlay teams={teamSnapshots} myTeamId={teamId} />
      ) : (
        <>
          <Leaderboard />
          {gameStatus === 'active' && (
            <div style={{
              position: 'absolute', top: 16, right: 16,
              background: '#0b0f1a', color: 'white',
              borderRadius: 999, padding: '6px 14px',
              fontWeight: 700, fontSize: 15,
              zIndex: 5, boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
            }}>
              {tokens} 🪙
            </div>
          )}
        </>
      )}

      {selectedChallenge && (
        <ChallengeCard
          challenge={selectedChallenge}
          descriptionVisible={descriptionVisible}
          distance={distance}
          inRange={inRange}
          isMyActive={isMyActive}
          activeChallengeId={activeChallengeId}
          wagerAmount={wagerAmount}
          tokens={tokens}
          onClose={() => setSelectedChallengeId(null)}
          onAccept={handleAccept}
          onAbandon={handleAbandon}
          onComplete={handleComplete}
          onSetWager={handleSetWager}
          onFailWager={handleFailWager}
        />
      )}
    </div>
  );
}

// ── Challenge card with type-specific flows ──

interface ChallengeCardProps {
  challenge: Challenge;
  descriptionVisible: boolean;
  distance: number | null;
  inRange: boolean;
  isMyActive: boolean;
  activeChallengeId: string | null;
  wagerAmount: number | null;
  tokens: number;
  onClose: () => void;
  onAccept: () => void;
  onAbandon: () => void;
  onComplete: (count?: number) => void;
  onSetWager: (amount: number) => void;
  onFailWager: () => void;
}

function ChallengeCard(props: ChallengeCardProps) {
  const {
    challenge: c, descriptionVisible, distance, inRange, isMyActive,
    activeChallengeId, wagerAmount, tokens,
    onClose, onAccept, onAbandon, onComplete, onSetWager, onFailWager,
  } = props;

  const typeBadgeColor =
    c.type === 'normal' ? '#3498db' : c.type === 'variable' ? '#2ecc71' : '#9b59b6';

  return (
    <div
      className="challenge-card"
      style={{
        position: 'absolute', bottom: 24, left: 16, right: 16,
        background: '#1a1a2e', color: 'white', borderRadius: 12, padding: 16,
        maxWidth: 400, margin: '0 auto',
      }}
    >
      <button
        onClick={onClose}
        style={{ position: 'absolute', top: 4, right: 4, background: 'none', border: 'none', color: 'white', fontSize: 22, cursor: 'pointer', padding: '8px 12px', lineHeight: 1 }}
      >
        ×
      </button>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', paddingRight: 32 }}>
        <span style={{
          fontSize: 10, fontWeight: 'bold', padding: '2px 8px', borderRadius: 10,
          background: typeBadgeColor, letterSpacing: 1,
        }}>
          {c.type.toUpperCase()}
        </span>
        <h3 style={{ margin: 0, flex: 1 }}>{c.name}</h3>
        <span style={{ fontWeight: 'bold', color: '#f39c12', whiteSpace: 'nowrap' }}>{rewardLabel(c)}</span>
      </div>

      {descriptionVisible
        ? <p style={{ marginTop: 8, opacity: 0.85 }}>{c.description}</p>
        : <p style={{ marginTop: 8, opacity: 0.5, fontStyle: 'italic' }}>Get closer to reveal the challenge…</p>
      }

      {/* Actions */}
      {isMyActive
        ? <ActiveActions
            challenge={c}
            wagerAmount={wagerAmount}
            tokens={tokens}
            onAbandon={onAbandon}
            onComplete={onComplete}
            onSetWager={onSetWager}
            onFailWager={onFailWager}
          />
        : activeChallengeId
          ? <p style={{ opacity: 0.6, marginTop: 8 }}>You already have an active challenge</p>
          : inRange
            ? <button
                onClick={onAccept}
                style={{ marginTop: 12, width: '100%', padding: '12px 10px', background: '#3498db', border: 'none', borderRadius: 6, color: 'white', fontWeight: 'bold', fontSize: 15 }}
              >
                Accept
              </button>
            : <p style={{ opacity: 0.6, marginTop: 8 }}>
                {distance != null ? `${Math.round(distance)}m away — get closer to accept` : 'GPS loading…'}
              </p>
      }
    </div>
  );
}

function ActiveActions(props: {
  challenge: Challenge;
  wagerAmount: number | null;
  tokens: number;
  onAbandon: () => void;
  onComplete: (count?: number) => void;
  onSetWager: (amount: number) => void;
  onFailWager: () => void;
}) {
  const { challenge, wagerAmount, tokens, onAbandon, onComplete, onSetWager, onFailWager } = props;

  if (challenge.type === 'normal') {
    return (
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button
          onClick={() => onComplete()}
          style={{ flex: 1, padding: '12px 10px', background: '#2ecc71', border: 'none', borderRadius: 6, color: 'white', fontWeight: 'bold', fontSize: 15 }}
        >
          Claim ({challenge.tokens})
        </button>
        <button
          onClick={onAbandon}
          style={{ flex: 1, padding: '12px 10px', background: '#e74c3c', border: 'none', borderRadius: 6, color: 'white', fontSize: 15 }}
        >
          Abandon
        </button>
      </div>
    );
  }

  if (challenge.type === 'variable') {
    return <VariableActions challenge={challenge} onComplete={onComplete} onAbandon={onAbandon} />;
  }

  // Wager
  if (wagerAmount == null) {
    return <WagerSetup tokens={tokens} onSetWager={onSetWager} onAbandon={onAbandon} />;
  }
  return (
    <div style={{ marginTop: 12 }}>
      <p style={{ opacity: 0.8, margin: '0 0 8px 0' }}>
        You wagered <strong>{wagerAmount}</strong> tokens.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => onComplete()}
          style={{ flex: 1, padding: '12px 10px', background: '#2ecc71', border: 'none', borderRadius: 6, color: 'white', fontWeight: 'bold', fontSize: 15 }}
        >
          Pass (+{wagerAmount * 2})
        </button>
        <button
          onClick={onFailWager}
          style={{ flex: 1, padding: '12px 10px', background: '#e74c3c', border: 'none', borderRadius: 6, color: 'white', fontSize: 15 }}
        >
          Fail (−{wagerAmount})
        </button>
      </div>
      <p style={{ opacity: 0.5, fontSize: 12, marginTop: 8, textAlign: 'center' }}>
        Wager is locked — no abandon.
      </p>
    </div>
  );
}

function VariableActions({
  challenge, onComplete, onAbandon,
}: {
  challenge: Challenge;
  onComplete: (count?: number) => void;
  onAbandon: () => void;
}) {
  const [count, setCount] = useState(1);
  return (
    <div style={{ marginTop: 12 }}>
      <label style={{ fontSize: 13, opacity: 0.8, display: 'block', marginBottom: 6 }}>
        How many {challenge.unitLabel}{count === 1 ? '' : 's'}?
      </label>
      <input
        type="number"
        min={1}
        value={count}
        onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))}
        style={{ width: '100%', padding: 8, background: '#2a2a3e', color: 'white', border: '1px solid #444', borderRadius: 4, fontSize: 16, boxSizing: 'border-box' }}
      />
      <div style={{ opacity: 0.7, fontSize: 13, margin: '8px 0' }}>
        = {count * (challenge.tokensPerUnit ?? 0)} tokens
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => onComplete(count)}
          style={{ flex: 1, padding: '12px 10px', background: '#2ecc71', border: 'none', borderRadius: 6, color: 'white', fontWeight: 'bold', fontSize: 15 }}
        >
          Claim
        </button>
        <button
          onClick={onAbandon}
          style={{ flex: 1, padding: '12px 10px', background: '#e74c3c', border: 'none', borderRadius: 6, color: 'white', fontSize: 15 }}
        >
          Abandon
        </button>
      </div>
    </div>
  );
}

function WagerSetup({
  tokens, onSetWager, onAbandon,
}: {
  tokens: number;
  onSetWager: (amount: number) => void;
  onAbandon: () => void;
}) {
  const max = Math.max(1, tokens);
  const [amount, setAmount] = useState(Math.min(10, max));
  const canWager = tokens >= 1;

  return (
    <div style={{ marginTop: 12 }}>
      {canWager ? (
        <>
          <label style={{ fontSize: 13, opacity: 0.8, display: 'block', marginBottom: 6 }}>
            Wager amount (max {tokens})
          </label>
          <input
            type="range"
            min={1}
            max={max}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            style={{ width: '100%' }}
          />
          <div style={{ textAlign: 'center', fontSize: 24, fontWeight: 'bold', margin: '4px 0' }}>
            {amount}
          </div>
          <div style={{ opacity: 0.6, fontSize: 12, textAlign: 'center', margin: '0 0 10px 0' }}>
            Pass: +{amount * 2} · Fail: −{amount}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => onSetWager(amount)}
              style={{ flex: 1, padding: '12px 10px', background: '#9b59b6', border: 'none', borderRadius: 6, color: 'white', fontWeight: 'bold', fontSize: 15 }}
            >
              Lock in wager
            </button>
            <button
              onClick={onAbandon}
              style={{ flex: 1, padding: '12px 10px', background: '#e74c3c', border: 'none', borderRadius: 6, color: 'white', fontSize: 15 }}
            >
              Abandon
            </button>
          </div>
        </>
      ) : (
        <>
          <p style={{ opacity: 0.7, margin: '0 0 8px 0' }}>
            You need at least 1 token to wager.
          </p>
          <button
            onClick={onAbandon}
            style={{ width: '100%', padding: '12px 10px', background: '#e74c3c', border: 'none', borderRadius: 6, color: 'white', fontSize: 15 }}
          >
            Abandon
          </button>
        </>
      )}
    </div>
  );
}

// ── Lobby overlay ──
// Shown while game.status === 'lobby'. Mirrors the mockup:
//   - A compact vertical stack of team colors on the left (the current player's
//     team gets a distinct "pill" treatment at the top of the stack).
//   - A large rounded white banner at the bottom saying "Game starting soon! :)"
function LobbyOverlay({ teams, myTeamId: _myTeamId }: { teams: TeamSnapshot[]; myTeamId: string | null }) {
  const R = 4; // rounded-corner radius for the outermost edges of the stack

  return (
    <>
      {/* Segmented vertical stack of all teams (including yours). Only the very
          top and very bottom outer corners are rounded; internal edges are flat. */}
      <div
        style={{
          position: 'absolute',
          top: 68, left: 22,
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          gap: 2, zIndex: 4,
        }}
      >
        {teams.map((t, i) => {
          const isFirst = i === 0;
          const isLast  = i === teams.length - 1;
          return (
            <span
              key={t.id}
              title={t.name}
              style={{
                width: 8, height: 22,
                background: t.color,
                borderTopLeftRadius:     isFirst ? R : 0,
                borderTopRightRadius:    isFirst ? R : 0,
                borderBottomLeftRadius:  isLast  ? R : 0,
                borderBottomRightRadius: isLast  ? R : 0,
                boxShadow: '0 1px 3px rgba(0,0,0,.35)',
              }}
            />
          );
        })}
      </div>

      {/* Bottom banner */}
      <div
        style={{
          position: 'absolute',
          left: 16, right: 16, bottom: 32,
          background: '#ffffff',
          color: '#0b0f1a',
          borderRadius: 18,
          padding: '22px 24px',
          textAlign: 'center',
          fontWeight: 700,
          fontSize: 20,
          letterSpacing: '-0.01em',
          boxShadow: '0 8px 28px rgba(0,0,0,.35)',
          zIndex: 5,
        }}
      >
        Game starting soon! :)
      </div>
    </>
  );
}

function applyMarkerStyle(
  el: HTMLElement,
  challenge: Challenge,
  activeChallengeId: string | null,
  teamsOnIt: TeamSnapshot[],
) {
  el.style.width = '22px';
  el.style.height = '22px';
  el.style.borderRadius = '50%';
  el.style.cursor = 'pointer';

  const typeColor =
    challenge.type === 'normal'   ? '#3498db' :
    challenge.type === 'variable' ? '#2ecc71' : '#9b59b6';

  if (challenge.id === activeChallengeId) {
    el.style.border = '3px solid white';
    el.style.boxShadow = `0 0 10px ${typeColor}`;
  } else {
    el.style.border = '2px solid white';
    el.style.boxShadow = 'none';
  }
  el.style.opacity = '1';

  if (teamsOnIt.length > 0) {
    const sliceAngle = 360 / teamsOnIt.length;
    const stops = teamsOnIt.map((t, i) =>
      `${t.color} ${i * sliceAngle}deg ${(i + 1) * sliceAngle}deg`,
    ).join(', ');
    el.style.background = `conic-gradient(${stops})`;
  } else {
    el.style.background = typeColor;
  }
}
