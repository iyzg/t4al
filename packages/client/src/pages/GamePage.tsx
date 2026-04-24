import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import maplibregl from 'maplibre-gl';
import { getMapStyle, CHICAGO_CENTER, CHICAGO_BOUNDS, DEFAULT_ZOOM, MIN_ZOOM, MAX_ZOOM } from '../mapStyle';
import { ensurePmtilesProtocol } from '../mapSetup';
import { useGameStore, getOrCreateDeviceId } from '../store';
import { socket } from '../socket';
import {
  registerSocketHandlers,
  emitStart,
  emitWager,
  emitComplete,
  emitFail,
  emitAbandon,
} from '../socketHandlers';
import { LOCATION_PING_INTERVAL_MS, CHALLENGE_COLOR } from '@t4al/shared';
import type { Challenge, TeamSnapshot } from '@t4al/shared';
import GameHUD from '../components/GameHUD';
import Toast from '../components/Toast';
import { TokensIcon, ClockIcon, LocationIcon, StartIcon, ClaimIcon, WagerIcon } from '../components/icons';
import PressHold from '../components/PressHold';
import { formatBlocks } from '../lib/distance';

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
  const game              = useGameStore((s) => s.game);
  const teamSnapshots     = useGameStore((s) => s.teamSnapshots);
  const startedLocally   = useGameStore((s) => s.startedLocally);

  const [selectedChallengeId, setSelectedChallengeId] = useState<string | null>(null);
  const [myPos, setMyPos] = useState<{ lat: number; lng: number } | null>(null);

  const selectedChallenge = selectedChallengeId ? challenges[selectedChallengeId] ?? null : null;

  // The sheet can outlive selectedChallenge briefly while it slides down. Track
  // a "displayed" challenge that lags behind selection by one animation cycle.
  const SHEET_EXIT_MS = 240;
  const [displayedChallenge, setDisplayedChallenge] = useState<typeof selectedChallenge>(null);
  const [isClosing, setIsClosing] = useState(false);
  useEffect(() => {
    if (selectedChallenge) {
      setDisplayedChallenge(selectedChallenge);
      setIsClosing(false);
      return;
    }
    if (displayedChallenge) {
      setIsClosing(true);
      const id = setTimeout(() => {
        setDisplayedChallenge(null);
        setIsClosing(false);
      }, SHEET_EXIT_MS);
      return () => clearTimeout(id);
    }
  }, [selectedChallenge, displayedChallenge]);

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
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
        maxBounds: CHICAGO_BOUNDS,
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
      el.style.cssText = `width:14px;height:14px;background:${teamColor || '#3498db'};border-radius:50%;border:3px solid white;`;
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

    const expireMinutes = game?.challengeExpireMinutes ?? 10;

    challengeList.forEach((c) => {
      if (c.status !== 'active') return;
      const existing = markersRef.current.get(c.id);
      if (existing) {
        existing.setLngLat([c.lng, c.lat]);
        updatePinChip(existing.getElement(), c, activeChallengeId);
        return;
      }
      const el = createPinElement(c, activeChallengeId, expireMinutes);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const chip = el.querySelector('.pin-chip') as HTMLElement | null;
        if (chip) {
          chip.classList.remove('pin-pop');
          chip.getBoundingClientRect(); // force reflow so repeated clicks re-trigger
          chip.classList.add('pin-pop');
        }
        setSelectedChallengeId(c.id);
      });
      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([c.lng, c.lat])
        .addTo(map);
      markersRef.current.set(c.id, marker);
    });
  }, [challenges, activeChallengeId, teamSnapshots, game?.challengeExpireMinutes]);

  // Tick the timer arcs once per second
  useEffect(() => {
    const tick = () => {
      document.querySelectorAll('.timer-arc').forEach((node) => {
        const arc = node as SVGCircleElement;
        const activatedMs = Number(arc.getAttribute('data-activated-at'));
        const totalMs     = Number(arc.getAttribute('data-total-ms'));
        if (!totalMs) return;
        const pct = Math.max(0, Math.min(100, (1 - (Date.now() - activatedMs) / totalMs) * 100));
        arc.setAttribute('stroke-dasharray', `${pct} 100`);
      });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Deselect gone challenge
  useEffect(() => {
    if (selectedChallengeId && !challenges[selectedChallengeId]) setSelectedChallengeId(null);
  }, [challenges, selectedChallengeId]);

  // Auto-open the card when entering a pin's proximity. Fires when a new pin
  // crosses into range — never reopens a pin the user already closed without
  // leaving range first. Skipped entirely while a sheet is already open.
  const autoOpenPinRef = useRef<string | null>(null);
  useEffect(() => {
    if (!myPos) return;

    let closest: { id: string; dist: number } | null = null;
    for (const c of Object.values(challenges)) {
      if (c.status !== 'active') continue;
      const d = distanceMeters(myPos.lat, myPos.lng, c.lat, c.lng);
      if (d <= c.proximityMeters && (!closest || d < closest.dist)) {
        closest = { id: c.id, dist: d };
      }
    }

    const newId = closest?.id ?? null;
    const prevId = autoOpenPinRef.current;

    if (newId && newId !== prevId && !selectedChallengeId) {
      setSelectedChallengeId(newId);
    }
    autoOpenPinRef.current = newId;
  }, [myPos, challenges, selectedChallengeId]);

  // ── Action handlers ──
  const handleStart = useCallback(() => {
    if (!selectedChallenge || !teamId) return;
    emitStart(selectedChallenge.id, teamId);
  }, [selectedChallenge, teamId]);

  const handleAbandon = useCallback(() => {
    if (!activeChallengeId || !teamId) return;
    emitAbandon(activeChallengeId, teamId);
    setSelectedChallengeId(null);
  }, [activeChallengeId, teamId]);

  const handleComplete = useCallback((count?: number) => {
    if (!activeChallengeId || !teamId) return;
    emitComplete(activeChallengeId, teamId, count);
  }, [activeChallengeId, teamId]);

  const handleSetWager = useCallback((amount: number) => {
    if (!activeChallengeId || !teamId) return;
    emitWager(activeChallengeId, teamId, amount);
  }, [activeChallengeId, teamId]);

  // Atomic start + set-wager from the wager-setup sub-view. Used before the
  // challenge is this team's active one, so activeChallengeId isn't set yet —
  // we emit start and wager with the selectedChallenge.id directly.
  const handleStartAndWager = useCallback((amount: number) => {
    if (!selectedChallenge || !teamId) return;
    emitStart(selectedChallenge.id, teamId);
    emitWager(selectedChallenge.id, teamId, amount);
  }, [selectedChallenge, teamId]);

  const handleFailWager = useCallback(() => {
    if (!activeChallengeId || !teamId) return;
    emitFail(activeChallengeId, teamId);
  }, [activeChallengeId, teamId]);

  // Drive the card's displayed state from `displayedChallenge` (which lags
  // selectedChallenge through the close animation) rather than selectedChallenge
  // directly — otherwise everything would go null/false the moment the user
  // hits X, ripping content out before the slide-down finishes.
  const distance = displayedChallenge && myPos
    ? distanceMeters(myPos.lat, myPos.lng, displayedChallenge.lat, displayedChallenge.lng)
    : null;
  const inRange = displayedChallenge && distance != null
    ? distance <= displayedChallenge.proximityMeters
    : false;
  const isMyActive = displayedChallenge?.id === activeChallengeId;

  // Description visibility: revealed when in range OR we've started this challenge.
  const descriptionVisible = displayedChallenge != null &&
    (inRange || isMyActive || startedLocally.has(displayedChallenge.id));

  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      <Toast />

      {/* Top-left HUD column: clock · (rank if active) · team-stack.
          One flex column so vertical gaps stay equal regardless of whether
          the rank pill is shown. */}
      <div style={{
        position: 'absolute', top: 16, left: 16,
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
        gap: 10, zIndex: 5,
      }}>
        <GameHUD />
        {gameStatus === 'active' && (
          <MyRankPill teams={teamSnapshots} myTeamId={teamId} myColor={teamColor} myTokens={tokens} />
        )}
        <TeamStack teams={teamSnapshots} />
      </div>

      {gameStatus === 'lobby' && <LobbyBanner />}

      {displayedChallenge && (
        <ChallengeCard
          key={displayedChallenge.id}
          challenge={displayedChallenge}
          descriptionVisible={descriptionVisible}
          distance={distance}
          inRange={inRange}
          isMyActive={isMyActive}
          activeChallengeId={activeChallengeId}
          wagerAmount={wagerAmount}
          tokens={tokens}
          expireMinutes={game?.challengeExpireMinutes ?? 10}
          isClosing={isClosing}
          onClose={() => setSelectedChallengeId(null)}
          onStart={handleStart}
          onAbandon={handleAbandon}
          onComplete={handleComplete}
          onSetWager={handleSetWager}
          onStartAndWager={handleStartAndWager}
          onFailWager={handleFailWager}
        />
      )}
    </div>
  );
}

// ── Challenge card ──

// Palette (Figma)
const CARD_BG = '#FFFFFF';
const CARD_TEXT = '#111111';
const STAT_TEXT = '#333333';
const ORANGE = '#E88B3E';
const GREY_BTN = '#E2E2E2';
const GREY_BTN_TEXT = '#333333';

interface ChallengeCardProps {
  challenge: Challenge;
  descriptionVisible: boolean;
  distance: number | null;
  inRange: boolean;
  isMyActive: boolean;
  activeChallengeId: string | null;
  wagerAmount: number | null;
  tokens: number;
  expireMinutes: number;
  isClosing: boolean;
  onClose: () => void;
  onStart: () => void;
  onAbandon: () => void;
  onComplete: (count?: number) => void;
  onSetWager: (amount: number) => void;
  onStartAndWager: (amount: number) => void;
  onFailWager: () => void;
}

function pointsDisplay(c: Challenge, wagerAmount: number | null, isMyActive: boolean): string {
  if (c.type === 'normal')   return String(c.tokens ?? 0);
  if (c.type === 'variable') return `${c.tokensPerUnit}/${c.unitLabel}`;
  if (isMyActive && wagerAmount != null) return String(wagerAmount);
  return '???';
}

function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return '0s';
  const total = Math.floor(msRemaining / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m <= 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

function useNowTick(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function ChallengeCard(props: ChallengeCardProps) {
  const {
    challenge: c, descriptionVisible, distance, inRange, isMyActive,
    activeChallengeId, wagerAmount, tokens, expireMinutes, isClosing,
    onClose, onStart, onAbandon, onComplete, onSetWager, onStartAndWager, onFailWager,
  } = props;

  const now = useNowTick(1000);
  const activatedMs = c.activatedAt ? new Date(c.activatedAt).getTime() : null;
  const remainingMs = activatedMs != null ? (activatedMs + expireMinutes * 60_000 - now) : null;
  const countdownText = remainingMs != null ? formatCountdown(remainingMs) : '—';
  const distanceText = distance != null ? formatBlocks(distance) : '—';
  const pts = pointsDisplay(c, wagerAmount, isMyActive);

  // Sub-views that temporarily replace the card body.
  //   score-entry: variable challenge Claim — count picker before submit
  //   wager-setup: wager challenge — pick amount before start+wager fires
  const [subView, setSubView] = useState<null | 'score-entry' | 'wager-setup'>(null);

  // Reset on challenge switch.
  useEffect(() => { setSubView(null); }, [c.id]);

  // Score-entry: close if we lost the active challenge (yanked or expired).
  useEffect(() => {
    if (subView === 'score-entry' && !isMyActive) setSubView(null);
  }, [subView, isMyActive]);

  // Also show wager-setup when reconnecting to a wager challenge that has no
  // amount set yet — derived in render so there's no flash of the main card.
  const showWagerSetup = c.type === 'wager' && (
    subView === 'wager-setup' ||
    (isMyActive && wagerAmount == null)
  );

  // All three body variants render inside the same outer shell so the
  // slide-up animation fires once (on sheet open) and NOT when switching
  // sub-views.
  let body: React.ReactNode;
  if (subView === 'score-entry' && c.type === 'variable') {
    body = (
      <ScoreEntryBody
        challenge={c}
        onBack={() => setSubView(null)}
        onSubmit={(count) => { onComplete(count); setSubView(null); }}
      />
    );
  } else if (showWagerSetup) {
    body = (
      <WagerSetupBody
        tokens={tokens}
        alreadyStarted={isMyActive}
        onBack={() => {
          if (isMyActive) onAbandon();
          setSubView(null);
        }}
        onConfirm={(amount) => {
          if (isMyActive) onSetWager(amount);
          else onStartAndWager(amount);
        }}
      />
    );
  } else {
    body = (
      <MainBody
        challenge={c}
        descriptionVisible={descriptionVisible}
        inRange={inRange}
        isMyActive={isMyActive}
        activeChallengeId={activeChallengeId}
        pts={pts}
        countdownText={countdownText}
        distanceText={distanceText}
        onStart={onStart}
        onAbandon={onAbandon}
        onComplete={onComplete}
        onFailWager={onFailWager}
        onEnterScoreEntry={() => setSubView('score-entry')}
        onOpenWagerSetup={() => setSubView('wager-setup')}
      />
    );
  }

  return (
    <div
      className={isClosing ? 'challenge-card sheet-closing' : 'challenge-card'}
      style={cardShellStyle()}
    >
      <CardHeader title={c.name} onClose={onClose} />
      {body}
    </div>
  );
}

function MainBody({
  challenge: c, descriptionVisible, inRange, isMyActive, activeChallengeId,
  pts, countdownText, distanceText,
  onStart, onAbandon, onComplete, onFailWager, onEnterScoreEntry, onOpenWagerSetup,
}: {
  challenge: Challenge;
  descriptionVisible: boolean;
  inRange: boolean;
  isMyActive: boolean;
  activeChallengeId: string | null;
  pts: string;
  countdownText: string;
  distanceText: string;
  onStart: () => void;
  onAbandon: () => void;
  onComplete: (count?: number) => void;
  onFailWager: () => void;
  onEnterScoreEntry: () => void;
  onOpenWagerSetup: () => void;
}) {
  return (
    <>
      <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 14, color: STAT_TEXT, alignItems: 'center' }}>
        <StatChip icon={<TokensIcon size={14} />} label={pts} />
        <StatChip icon={<ClockIcon size={14} />} label={countdownText} />
        <StatChip icon={<LocationIcon size={14} />} label={distanceText} />
      </div>

      <div
        className={descriptionVisible ? undefined : 'font-flow'}
        style={{
          marginTop: 14,
          height: 108,
          overflowY: 'auto',
          fontSize: 14,
          lineHeight: 1.5,
          color: CARD_TEXT,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {c.description}
      </div>

      <div style={{ marginTop: 18 }}>
        {isMyActive
          ? <ActiveActions
              challenge={c}
              onAbandon={onAbandon}
              onComplete={onComplete}
              onFailWager={onFailWager}
              onEnterScoreEntry={onEnterScoreEntry}
            />
          : activeChallengeId
            ? <div style={{ textAlign: 'center', color: STAT_TEXT, padding: '12px 8px' }}>
                You already have an active challenge
              </div>
            : <ActivationButton
                type={c.type}
                disabled={!inRange}
                onClick={c.type === 'wager' ? onOpenWagerSetup : onStart}
              />
        }
      </div>
    </>
  );
}

function StatChip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {icon}
      <span>{label}</span>
    </span>
  );
}


function ActivationButton({
  type, disabled, onClick,
}: {
  type: Challenge['type'];
  disabled: boolean;
  onClick: () => void;
}) {
  const isWager = type === 'wager';
  const Icon = isWager ? WagerIcon : StartIcon;
  const label = isWager ? 'Wager' : 'Start';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: '100%',
        padding: '14px 16px',
        border: 'none',
        borderRadius: 12,
        fontSize: 14,
        fontWeight: 700,
        color: disabled ? '#7a7a7a' : 'white',
        background: disabled ? GREY_BTN : ORANGE,
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      }}
    >
      <Icon size={18} />
      {label}
    </button>
  );
}

function ActiveActions(props: {
  challenge: Challenge;
  onAbandon: () => void;
  onComplete: (count?: number) => void;
  onFailWager: () => void;
  onEnterScoreEntry: () => void;
}) {
  const { challenge, onAbandon, onComplete, onFailWager, onEnterScoreEntry } = props;

  if (challenge.type === 'normal') {
    return (
      <ButtonPair>
        <GreyButton onClick={onAbandon}>Give Up</GreyButton>
        <OrangeHoldButton onComplete={() => onComplete()} ariaLabel="Hold to claim">
          <ClaimIcon size={16} /> Claim
        </OrangeHoldButton>
      </ButtonPair>
    );
  }

  if (challenge.type === 'variable') {
    // Tap Claim to open the score-entry sub-view — the sub-view's Claim is the 3s hold.
    return (
      <ButtonPair>
        <GreyButton onClick={onAbandon}>Give Up</GreyButton>
        <OrangeButton onClick={onEnterScoreEntry}>
          <ClaimIcon size={16} /> Claim
        </OrangeButton>
      </ButtonPair>
    );
  }

  // Wager: amount-set state only. The amount-null state is handled by the
  // wager-setup sub-view at the ChallengeCard level, so it never reaches here.
  return (
    <ButtonPair>
      <GreyHoldButton onComplete={onFailWager} ariaLabel="Hold to fail">Fail</GreyHoldButton>
      <OrangeHoldButton onComplete={() => onComplete()} ariaLabel="Hold to claim success">
        <ClaimIcon size={16} /> Success
      </OrangeHoldButton>
    </ButtonPair>
  );
}

function ButtonPair({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 10 }}>{children}</div>;
}

function GreyButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: '14px 16px',
        border: 'none',
        borderRadius: 12,
        fontSize: 14,
        fontWeight: 600,
        color: GREY_BTN_TEXT,
        background: GREY_BTN,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function OrangeButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: '14px 16px',
        border: 'none',
        borderRadius: 12,
        fontSize: 14,
        fontWeight: 700,
        color: 'white',
        background: ORANGE,
        cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      }}
    >
      {children}
    </button>
  );
}

// Press-and-hold variant: the user must hold for 3s to confirm. Fill bar animates
// across the button as they hold and drains if they release early.
function OrangeHoldButton({
  onComplete, children, ariaLabel,
}: {
  onComplete: () => void;
  children: React.ReactNode;
  ariaLabel?: string;
}) {
  return (
    <PressHold
      onComplete={onComplete}
      ariaLabel={ariaLabel}
      fillColor="rgba(255, 255, 255, 0.28)"
      idleStyle={{
        flex: 1,
        padding: '14px 16px',
        borderRadius: 12,
        fontSize: 14,
        fontWeight: 700,
        color: 'white',
        background: ORANGE,
      }}
    >
      {children}
    </PressHold>
  );
}

function GreyHoldButton({
  onComplete, children, ariaLabel,
}: {
  onComplete: () => void;
  children: React.ReactNode;
  ariaLabel?: string;
}) {
  return (
    <PressHold
      onComplete={onComplete}
      ariaLabel={ariaLabel}
      fillColor="rgba(0, 0, 0, 0.12)"
      idleStyle={{
        flex: 1,
        padding: '14px 16px',
        borderRadius: 12,
        fontSize: 14,
        fontWeight: 600,
        color: GREY_BTN_TEXT,
        background: GREY_BTN,
      }}
    >
      {children}
    </PressHold>
  );
}

// Shared card shell styles so the score-entry sub-view matches the main card.
function cardShellStyle(): React.CSSProperties {
  return {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    background: CARD_BG, color: CARD_TEXT,
    borderTopLeftRadius: 18, borderTopRightRadius: 18,
    padding: '20px 20px 28px',
    maxWidth: 480, margin: '0 auto',
    boxShadow: '0 -8px 32px rgba(0,0,0,0.18)',
    fontSize: 14,
  };
}

function CardHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
      <h3 style={{ margin: 0, fontSize: 20, fontWeight: 700, flex: 1, lineHeight: 1.2, color: CARD_TEXT }}>
        {title}
      </h3>
      <button
        onClick={onClose}
        aria-label="Close"
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          fontSize: 14, color: CARD_TEXT, padding: 0, lineHeight: 1, marginTop: -2,
        }}
      >
        ×
      </button>
    </div>
  );
}

// Body for variable challenge Claim — count picker, preview, press-hold Claim.
// Rendered inside ChallengeCard so the outer shell (and slide-up animation)
// is shared with other body variants.
function ScoreEntryBody({
  challenge, onBack, onSubmit,
}: {
  challenge: Challenge;
  onBack: () => void;
  onSubmit: (count: number) => void;
}) {
  const [count, setCount] = useState(1);
  const per = challenge.tokensPerUnit ?? 0;
  const unit = challenge.unitLabel ?? 'unit';
  const unitPlural = count === 1 ? unit : `${unit}s`;
  const total = count * per;

  return (
    <>
      <div style={{ color: ORANGE, fontSize: 14, fontWeight: 600, marginTop: 2 }}>
        {per} pts / {unit}
      </div>

      <div style={{ textAlign: 'center', padding: '18px 0 14px' }}>
        <div style={{ fontSize: 14, color: STAT_TEXT, marginBottom: 10 }}>
          How many {unitPlural}?
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 24 }}>
          <Stepper onClick={() => setCount(Math.max(1, count - 1))} disabled={count <= 1}>−</Stepper>
          <span style={{ fontSize: 40, fontWeight: 700, minWidth: 60, textAlign: 'center' }}>{count}</span>
          <Stepper onClick={() => setCount(count + 1)}>+</Stepper>
        </div>
      </div>

      <div style={{
        background: '#FBEFE1',
        padding: '12px 16px',
        borderRadius: 10,
        marginBottom: 16,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        color: CARD_TEXT,
      }}>
        <span>{count} x {per} pts</span>
        <strong style={{ color: ORANGE }}>= {total} pts</strong>
      </div>

      <ButtonPair>
        <GreyButton onClick={onBack}>Back</GreyButton>
        <OrangeHoldButton onComplete={() => onSubmit(count)} ariaLabel="Hold to claim">
          <ClaimIcon size={16} /> Claim
        </OrangeHoldButton>
      </ButtonPair>
    </>
  );
}

function Stepper({
  onClick, disabled, children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 40, height: 40,
        borderRadius: 999,
        border: '1px solid #D0D0D0',
        background: 'white',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        fontSize: 22, fontWeight: 400, color: '#333',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        padding: 0,
      }}
    >
      {children}
    </button>
  );
}

// Body for the wager setup. Rendered inside ChallengeCard so the shell and
// animation are shared with other body variants.
function WagerSetupBody({
  tokens, alreadyStarted, onBack, onConfirm,
}: {
  tokens: number;
  alreadyStarted: boolean;
  onBack: () => void;
  onConfirm: (amount: number) => void;
}) {
  const max = Math.max(1, tokens);
  const [amount, setAmount] = useState(Math.min(10, max));
  const canWager = tokens >= 1;

  if (!canWager) {
    return (
      <div style={{ padding: '24px 0' }}>
        <p style={{ margin: '0 0 14px 0', color: STAT_TEXT, textAlign: 'center' }}>
          You need at least 1 chip to wager.
        </p>
        <GreyButton onClick={onBack}>Back</GreyButton>
      </div>
    );
  }

  return (
    <>
      <div style={{ textAlign: 'center', padding: '18px 0 14px' }}>
        <div style={{ fontSize: 14, color: STAT_TEXT, marginBottom: 10 }}>
          How many chips to wager?
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 24 }}>
          <Stepper onClick={() => setAmount(Math.max(1, amount - 1))} disabled={amount <= 1}>−</Stepper>
          <span style={{ fontSize: 40, fontWeight: 700, minWidth: 70, textAlign: 'center' }}>{amount}</span>
          <Stepper onClick={() => setAmount(Math.min(max, amount + 1))} disabled={amount >= max}>+</Stepper>
        </div>
        <div style={{ fontSize: 14, color: STAT_TEXT, marginTop: 10 }}>
          Balance: {tokens}
        </div>
      </div>

      <ButtonPair>
        <GreyButton onClick={onBack}>Back</GreyButton>
        <OrangeButton onClick={() => onConfirm(amount)}>Confirm</OrangeButton>
      </ButtonPair>

      {alreadyStarted && (
        <div style={{ fontSize: 12, color: STAT_TEXT, textAlign: 'center', marginTop: 10 }}>
          Back will abandon (no amount set yet).
        </div>
      )}
    </>
  );
}

// ── Lobby overlay ──
// Shown while game.status === 'lobby'. Mirrors the mockup:
//   - A compact vertical stack of team colors on the left (the current player's
//     team gets a distinct "pill" treatment at the top of the stack).
//   - A large rounded white banner at the bottom saying "Game starting soon! :)"
// Compute [team, rank] pairs sorted by tokens desc, name asc (matches server).
function rankedTeams(teams: TeamSnapshot[]): Array<{ team: TeamSnapshot; rank: number }> {
  return [...teams]
    .sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name))
    .map((team, i) => ({ team, rank: i + 1 }));
}

// Segmented vertical stack of all teams (including yours). Only the very
// top and very bottom outer corners are rounded; internal edges are flat.
// Ordered by rank — top bar is #1.
function TeamStack({ teams }: { teams: TeamSnapshot[] }) {
  const R = 4;
  const ranked = rankedTeams(teams);
  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
        gap: 2,
      }}
    >
      {ranked.map(({ team, rank }, i) => {
        const isFirst = i === 0;
        const isLast  = i === ranked.length - 1;
        return (
          <span
            key={team.id}
            title={`${team.name} · #${rank} · ${team.tokens}`}
            style={{
              width: 8, height: 22,
              background: team.color,
              borderTopLeftRadius:     isFirst ? R : 0,
              borderTopRightRadius:    isFirst ? R : 0,
              borderBottomLeftRadius:  isLast  ? R : 0,
              borderBottomRightRadius: isLast  ? R : 0,
            }}
          />
        );
      })}
    </div>
  );
}

// Shows the current player's rank, styled like the clock pill and placed
// directly beneath it.
function MyRankPill({
  teams, myTeamId, myColor,
}: {
  teams: TeamSnapshot[];
  myTeamId: string | null;
  myColor: string | null;
  myTokens: number;       // still accepted for API stability; no longer rendered
}) {
  const ranked = rankedTeams(teams);
  const mine = myTeamId ? ranked.find((r) => r.team.id === myTeamId) : null;
  if (!mine) return null;
  return (
    <div
      title="Your team rank"
      style={{
        background: '#0b0f1a',
        color: 'white',
        borderRadius: 999,
        padding: '5px 12px 5px 6px',
        display: 'flex', alignItems: 'center', gap: 8,
        fontWeight: 700, fontSize: 14,
        letterSpacing: '0.01em',
      }}
    >
      <span style={{
        width: 14, height: 14, borderRadius: '50%',
        background: myColor ?? mine.team.color,
      }} />
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
        #{mine.rank}
      </span>
    </div>
  );
}

// Bottom-of-screen banner shown during lobby.
function LobbyBanner() {
  return (
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
        zIndex: 5,
      }}
    >
      Game starting soon! :)
    </div>
  );
}

// ── Pin construction ──────────────────────────────────────────────────────
// Single 34×34 SVG inside a sized div. The SVG's viewBox is centered on
// (0,0), and every shape (timer arc, chip circle, chip border) is drawn at
// (0,0) — no CSS offsets or nested positioned containers, so there's no
// box-model math that can drift under MapLibre's subpixel translate on zoom.
//
// Figma spec: chip diameter 23, ring diameter 31 (≈3px gap).
const SVG_NS    = 'http://www.w3.org/2000/svg';
const PIN_OUTER = 34;
const CHIP_R    = 23 / 2;       // chip radius 11.5
const ARC_R     = 31 / 2;       // arc radius   15.5

function createPinElement(
  c: Challenge,
  activeChallengeId: string | null,
  expireMinutes: number,
): HTMLElement {
  const outer = document.createElement('div');
  // IMPORTANT: do NOT set `position` inline. MapLibre's .maplibregl-marker
  // class sets position:absolute; overriding it with position:relative puts
  // every marker back in document flow, so subsequent markers get a flow
  // offset equal to the accumulated block height of prior markers (the
  // first marker reads 0, the second reads PIN_OUTER, etc.), which shows
  // up as a drifting vertical offset that was baffling us.
  outer.style.cssText =
    `width:${PIN_OUTER}px;height:${PIN_OUTER}px;cursor:pointer;` +
    `display:block;line-height:0;`;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(PIN_OUTER));
  svg.setAttribute('height', String(PIN_OUTER));
  svg.setAttribute('viewBox', `-${PIN_OUTER / 2} -${PIN_OUTER / 2} ${PIN_OUTER} ${PIN_OUTER}`);
  svg.style.cssText = 'display:block;overflow:visible;';

  // Timer arc — outside the chip
  const activatedMs = c.activatedAt ? new Date(c.activatedAt).getTime() : Date.now();
  const totalMs    = expireMinutes * 60_000;
  const pctRemain  = Math.max(0, Math.min(100, (1 - (Date.now() - activatedMs) / totalMs) * 100));

  const arc = document.createElementNS(SVG_NS, 'circle');
  arc.setAttribute('class', 'timer-arc');
  arc.setAttribute('cx', '0');
  arc.setAttribute('cy', '0');
  arc.setAttribute('r', String(ARC_R));
  arc.setAttribute('fill', 'none');
  arc.setAttribute('stroke', CHALLENGE_COLOR);
  arc.setAttribute('stroke-width', '3');
  arc.setAttribute('stroke-linecap', 'round');
  arc.setAttribute('pathLength', '100');
  arc.setAttribute('stroke-dasharray', `${pctRemain} 100`);
  arc.setAttribute('data-activated-at', String(activatedMs));
  arc.setAttribute('data-total-ms', String(totalMs));
  arc.setAttribute('transform', 'rotate(-90)');
  svg.appendChild(arc);

  // Chip — drawn inside the SVG at (0,0). Wrapped in a <g> so the
  // click-pop scale animation targets a single element without disturbing
  // the arc, which is a sibling.
  const chip = document.createElementNS(SVG_NS, 'g');
  chip.setAttribute('class', 'pin-chip');
  svg.appendChild(chip);
  renderChipSvg(chip, c, activeChallengeId);

  outer.appendChild(svg);
  return outer;
}

// Update the chip only — border weight, wager notches, active state.
// The timer arc updates itself every second via the component-level interval.
function updatePinChip(outer: HTMLElement, c: Challenge, activeChallengeId: string | null) {
  const chip = outer.querySelector('.pin-chip');
  if (chip) renderChipSvg(chip as SVGElement, c, activeChallengeId);
}

function renderChipSvg(chip: SVGElement, c: Challenge, activeChallengeId: string | null) {
  const isActive    = c.id === activeChallengeId;
  const isWager     = c.type === 'wager';
  const borderWidth = isActive ? 3 : 2;
  const r           = CHIP_R;

  // Wager border = 8 white notches around the chip (stroke-dasharray).
  // Circumference at r = 11.5 → ~72.3; cycle of ~9.04 per notch with
  // notch length 3 and gap 6.04 gives 8 evenly-spaced white bars.
  const borderMarkup = isWager
    ? `<circle cx="0" cy="0" r="${r - 1.5}" fill="none" stroke="white" stroke-width="3" stroke-dasharray="3 6.04" />`
    : `<circle cx="0" cy="0" r="${r - borderWidth / 2}" fill="none" stroke="white" stroke-width="${borderWidth}" />`;

  chip.innerHTML =
    `<circle cx="0" cy="0" r="${r}" fill="${CHALLENGE_COLOR}" />` +
    borderMarkup;
}
