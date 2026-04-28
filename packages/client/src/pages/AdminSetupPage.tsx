import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import maplibregl from 'maplibre-gl';
import { getMapStyle, CHICAGO_CENTER, CHICAGO_BOUNDS, MIN_ZOOM, MAX_ZOOM } from '../mapStyle';
import { ensurePmtilesProtocol } from '../mapSetup';
import type { Challenge, ChallengeType, Game } from '@t4al/shared';

ensurePmtilesProtocol();

type ChallengeForm = {
  lat: number;
  lng: number;
  name: string;
  description: string;
  type: ChallengeType;
  tokens: number;           // used when type=normal
  tokensPerUnit: number;    // used when type=variable
  unitLabel: string;        // used when type=variable
  proximityMeters: number;
};

type SavedChallenge = Challenge;

const BLANK_FORM: ChallengeForm = {
  lat: 0, lng: 0,
  name: '', description: '',
  type: 'normal',
  tokens: 100,
  tokensPerUnit: 10,
  unitLabel: 'rep',
  proximityMeters: 100,
};

function typeColor(t: ChallengeType): string {
  return t === 'normal' ? '#3498db' : t === 'variable' ? '#2ecc71' : '#9b59b6';
}

/** Build a GeoJSON polygon approximating a circle on the map */
function circlePolygon(lat: number, lng: number, radiusMeters: number, steps = 64): GeoJSON.Feature {
  const coords: [number, number][] = [];
  const km = radiusMeters / 1000;
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    const dLat = (km / 111.32) * Math.cos(angle);
    const dLng = (km / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.sin(angle);
    coords.push([lng + dLng, lat + dLat]);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coords] } };
}

function adminHeaders(gameId: string): HeadersInit {
  const adminCode = localStorage.getItem(`adminCode:${gameId}`) ?? '';
  return { 'Content-Type': 'application/json', 'x-admin-code': adminCode };
}

function typeBadgeText(t: ChallengeType): string {
  return t === 'normal' ? 'NORMAL' : t === 'variable' ? 'VARIABLE' : 'WAGER';
}

function OrderTimeline({
  challenges, activeChallengeCount, onClose, onMove,
}: {
  challenges: SavedChallenge[];
  activeChallengeCount: number;
  onClose: () => void;
  onMove: (index: number, direction: -1 | 1) => void;
}) {
  const sorted = [...challenges].sort((a, b) => a.sortOrder - b.sortOrder);
  const K = activeChallengeCount;
  const spawn = sorted.slice(0, K);
  const queue = sorted.slice(K);

  function Row({ c, idx, section }: { c: SavedChallenge; idx: number; section: 'spawn' | 'queue' }) {
    const isLast = idx === sorted.length - 1;
    const isFirst = idx === 0;
    const accent = section === 'spawn' ? '#27ae60' : 'transparent';
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6,
        padding: '8px 10px', background: '#2a2a3e', borderRadius: 6,
        borderLeft: `3px solid ${accent}`,
      }}>
        <span style={{ opacity: 0.5, width: 22, fontSize: 12, fontWeight: 'bold' }}>#{idx + 1}</span>
        <span style={{
          fontSize: 9, padding: '2px 6px', borderRadius: 3,
          background: typeColor(c.type), fontWeight: 'bold', letterSpacing: 0.4,
        }}>
          {typeBadgeText(c.type)}
        </span>
        <span style={{ flex: 1, fontSize: 14 }}>{c.name}</span>
        <button onClick={() => onMove(idx, -1)} disabled={isFirst}
          style={{ background: 'none', border: 'none', color: isFirst ? '#555' : 'white', cursor: isFirst ? 'default' : 'pointer', fontSize: 16, padding: '2px 6px' }}>↑</button>
        <button onClick={() => onMove(idx, 1)} disabled={isLast}
          style={{ background: 'none', border: 'none', color: isLast ? '#555' : 'white', cursor: isLast ? 'default' : 'pointer', fontSize: 16, padding: '2px 6px' }}>↓</button>
      </div>
    );
  }

  return (
    <div style={{
      position: 'absolute', top: 16, right: 16, width: 360,
      background: '#1a1a2e', color: 'white', padding: 16, borderRadius: 8,
      maxHeight: 'calc(100vh - 32px)', overflow: 'auto',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Activation Order</h3>
        <button onClick={onClose}
          style={{ background: 'none', border: 'none', color: 'white', fontSize: 18, cursor: 'pointer' }}>×</button>
      </div>

      {challenges.length === 0 && <p style={{ opacity: 0.5, fontSize: 13 }}>No challenges yet — click the map to add one.</p>}

      {spawn.length > 0 && (
        <>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0 8px',
          }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#27ae60' }} />
            <span style={{ fontSize: 11, fontWeight: 'bold', letterSpacing: 0.6, textTransform: 'uppercase' }}>
              Spawn at start ({spawn.length}/{K})
            </span>
          </div>
          <p style={{ fontSize: 11, opacity: 0.55, margin: '0 0 8px' }}>
            These appear on the map the moment the game starts.
          </p>
          {spawn.map((c, i) => <Row key={c.id} c={c} idx={i} section="spawn" />)}
        </>
      )}

      {queue.length > 0 && (
        <>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, margin: '16px 0 8px',
          }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#7f8c8d' }} />
            <span style={{ fontSize: 11, fontWeight: 'bold', letterSpacing: 0.6, textTransform: 'uppercase' }}>
              Queue ({queue.length})
            </span>
          </div>
          <p style={{ fontSize: 11, opacity: 0.55, margin: '0 0 8px' }}>
            Each one fills the next open slot when a spawn is claimed or expires.
          </p>
          {queue.map((c, i) => <Row key={c.id} c={c} idx={i + spawn.length} section="queue" />)}
        </>
      )}

      {sorted.length > 0 && sorted.length <= K && (
        <p style={{ fontSize: 11, opacity: 0.55, margin: '8px 0 0' }}>
          Add {K - sorted.length} more to fill all {K} starting slots, or start the game with fewer active challenges.
        </p>
      )}
    </div>
  );
}

export default function AdminSetupPage() {
  const { gameId } = useParams<{ gameId: string }>();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const previewMarkerRef = useRef<maplibregl.Marker | null>(null);
  const challengesRef = useRef<SavedChallenge[]>([]);
  const editingIdRef = useRef<string | null>(null);
  const popoverRef = useRef<ChallengeForm | null>(null);

  const [challenges, setChallenges] = useState<SavedChallenge[]>([]);
  const [game, setGame] = useState<Game | null>(null);
  const [simStep, setSimStep] = useState(0);
  const [popover, setPopover] = useState<ChallengeForm | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showOrderPanel, setShowOrderPanel] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { challengesRef.current = challenges; }, [challenges]);
  useEffect(() => { editingIdRef.current = editingId; }, [editingId]);
  useEffect(() => { popoverRef.current = popover; }, [popover]);

  // Load existing challenges + game (for activeChallengeCount K)
  useEffect(() => {
    if (!gameId) return;
    fetch(`/api/games/${gameId}/challenges`, { headers: adminHeaders(gameId) })
      .then((r) => r.ok ? r.json() : [])
      .then((rows: Challenge[]) => {
        if (Array.isArray(rows)) setChallenges(rows);
      })
      .catch(() => {});
    fetch(`/api/games/${gameId}`, { headers: adminHeaders(gameId) })
      .then((r) => r.ok ? r.json() : null)
      .then((g) => { if (g) setGame(g); })
      .catch(() => {});
  }, [gameId]);

  // --- Map helpers ---
  const updateRadiusCircle = useCallback((lat: number, lng: number, radiusMeters: number) => {
    const src = mapRef.current?.getSource('radius-circle') as maplibregl.GeoJSONSource | undefined;
    src?.setData(circlePolygon(lat, lng, radiusMeters) as any);
  }, []);

  const clearRadiusCircle = useCallback(() => {
    const src = mapRef.current?.getSource('radius-circle') as maplibregl.GeoJSONSource | undefined;
    src?.setData({ type: 'FeatureCollection', features: [] } as any);
  }, []);

  const showPreviewMarker = useCallback((lat: number, lng: number) => {
    const map = mapRef.current;
    if (!map) return;
    if (previewMarkerRef.current) {
      previewMarkerRef.current.setLngLat([lng, lat]);
    } else {
      const el = document.createElement('div');
      el.style.cssText =
        'width:20px;height:20px;background:rgba(243,156,18,0.5);border-radius:50%;border:2px dashed #f39c12;pointer-events:none;';
      previewMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([lng, lat])
        .addTo(map);
    }
  }, []);

  const hidePreviewMarker = useCallback(() => {
    previewMarkerRef.current?.remove();
    previewMarkerRef.current = null;
  }, []);

  const revertMarker = useCallback((id: string) => {
    const orig = challengesRef.current.find((c) => c.id === id);
    const marker = markersRef.current.get(id);
    if (orig && marker) marker.setLngLat([orig.lng, orig.lat]);
  }, []);

  useEffect(() => {
    if (popover) {
      updateRadiusCircle(popover.lat, popover.lng, popover.proximityMeters);
      if (editingId) hidePreviewMarker();
      else showPreviewMarker(popover.lat, popover.lng);
    } else {
      clearRadiusCircle();
      hidePreviewMarker();
    }
  }, [popover?.lat, popover?.lng, popover?.proximityMeters, editingId,
      updateRadiusCircle, clearRadiusCircle, showPreviewMarker, hidePreviewMarker]);

  // Init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    try {
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: getMapStyle(),
        center: CHICAGO_CENTER,
        zoom: 15,
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
        maxBounds: CHICAGO_BOUNDS,
      });

      map.on('load', () => {
        map.addSource('radius-circle', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        map.addLayer({
          id: 'radius-circle-fill', type: 'fill', source: 'radius-circle',
          paint: { 'fill-color': '#f39c12', 'fill-opacity': 0.15 },
        });
        map.addLayer({
          id: 'radius-circle-stroke', type: 'line', source: 'radius-circle',
          paint: { 'line-color': '#f39c12', 'line-width': 2, 'line-dasharray': [2, 2] },
        });
      });

      map.on('click', (e) => {
        const prevId = editingIdRef.current;
        if (prevId) revertMarker(prevId);
        setEditingId(null);
        setPopover({ ...BLANK_FORM, lat: e.lngLat.lat, lng: e.lngLat.lng });
      });

      mapRef.current = map;
      return () => { map.remove(); mapRef.current = null; };
    } catch (err) {
      console.warn('Map failed to initialize:', err);
    }
  }, []);

  // Sync markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach((marker, id) => {
      if (!challenges.find((c) => c.id === id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    });

    const sortedForLabels = [...challenges].sort((a, b) => a.sortOrder - b.sortOrder);
    challenges.forEach((c) => {
      const orderRank = sortedForLabels.findIndex((x) => x.id === c.id) + 1;
      const existing = markersRef.current.get(c.id);
      if (existing) {
        existing.setLngLat([c.lng, c.lat]);
        const el = existing.getElement();
        el.style.background = typeColor(c.type);
        el.textContent = String(orderRank);
        return;
      }
      const el = document.createElement('div');
      el.style.cssText =
        `width:26px;height:26px;background:${typeColor(c.type)};border-radius:50%;border:2px solid white;cursor:pointer;` +
        `display:flex;align-items:center;justify-content:center;color:white;font-weight:bold;font-size:13px;` +
        `font-family:-apple-system,BlinkMacSystemFont,sans-serif;text-shadow:0 1px 2px rgba(0,0,0,0.5);`;
      el.textContent = String(orderRank);
      const marker = new maplibregl.Marker({ element: el, draggable: false })
        .setLngLat([c.lng, c.lat])
        .addTo(map);

      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const prevId = editingIdRef.current;
        if (prevId && prevId !== c.id) revertMarker(prevId);
        const fresh = challengesRef.current.find((ch) => ch.id === c.id);
        if (!fresh) return;
        setEditingId(c.id);
        setPopover({
          lat: fresh.lat, lng: fresh.lng,
          name: fresh.name, description: fresh.description,
          type: fresh.type,
          tokens:         fresh.tokens        ?? BLANK_FORM.tokens,
          tokensPerUnit:  fresh.tokensPerUnit ?? BLANK_FORM.tokensPerUnit,
          unitLabel:      fresh.unitLabel     ?? BLANK_FORM.unitLabel,
          proximityMeters: fresh.proximityMeters,
        });
      });

      marker.on('drag', () => {
        const { lat, lng } = marker.getLngLat();
        const radius = popoverRef.current?.proximityMeters ?? 100;
        updateRadiusCircle(lat, lng, radius);
      });
      marker.on('dragend', () => {
        const { lat, lng } = marker.getLngLat();
        setPopover((prev) => prev ? { ...prev, lat, lng } : null);
      });
      markersRef.current.set(c.id, marker);
    });
  }, [challenges, revertMarker]);

  // Apply sim state styling: claimed = greyed, queued = dashed, active = full color.
  // The `editing` overlay still wins for whichever marker is being edited.
  useEffect(() => {
    const K = game?.activeChallengeCount ?? 3;
    const sorted = [...challenges].sort((a, b) => a.sortOrder - b.sortOrder);
    markersRef.current.forEach((marker, id) => {
      const selected = id === editingId;
      const c = challenges.find((x) => x.id === id);
      const idx = sorted.findIndex((x) => x.id === id);
      const state: 'active' | 'claimed' | 'queued' =
        idx < simStep ? 'claimed' : idx < simStep + K ? 'active' : 'queued';

      marker.setDraggable(selected);
      const el = marker.getElement();
      const baseColor = c ? typeColor(c.type) : '#888';

      if (selected) {
        el.style.background = baseColor;
        el.style.opacity = '1';
        el.style.border = '2px solid #ffffff';
        el.style.borderStyle = 'solid';
        el.style.cursor = 'grab';
      } else if (state === 'active') {
        el.style.background = baseColor;
        el.style.opacity = '1';
        el.style.border = '2px solid rgba(255,255,255,0.85)';
        el.style.borderStyle = 'solid';
        el.style.cursor = 'pointer';
      } else if (state === 'claimed') {
        el.style.background = '#555';
        el.style.opacity = '0.45';
        el.style.border = '2px solid rgba(255,255,255,0.4)';
        el.style.borderStyle = 'solid';
        el.style.cursor = 'pointer';
      } else {
        // queued
        el.style.background = baseColor;
        el.style.opacity = '0.55';
        el.style.border = '2px dashed rgba(255,255,255,0.6)';
        el.style.borderStyle = 'dashed';
        el.style.cursor = 'pointer';
      }
      el.style.boxShadow = 'none';
    });
  }, [editingId, challenges, simStep, game?.activeChallengeCount]);

  // --- Save / Delete ---

  function buildPayload(form: ChallengeForm) {
    const base = {
      name: form.name, description: form.description,
      type: form.type, lat: form.lat, lng: form.lng,
      proximityMeters: form.proximityMeters,
    };
    if (form.type === 'normal')   return { ...base, tokens: form.tokens };
    if (form.type === 'variable') return { ...base, tokensPerUnit: form.tokensPerUnit, unitLabel: form.unitLabel };
    return base; // wager — no token fields
  }

  async function handleSave() {
    if (!popover || !gameId || saving) return;
    if (!popover.name.trim() || !popover.description.trim()) {
      setError('Name and description are required.');
      return;
    }
    setError('');
    setSaving(true);
    const url = editingId
      ? `/api/challenges/${editingId}`
      : `/api/games/${gameId}/challenges`;
    const method = editingId ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method, headers: adminHeaders(gameId),
        body: JSON.stringify(buildPayload(popover)),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        setError(err?.error || 'Failed to save challenge');
        setSaving(false);
        return;
      }
      const data: Challenge = await res.json();
      if (editingId) {
        setChallenges((prev) => prev.map((c) => (c.id === editingId ? data : c)));
      } else {
        setChallenges((prev) => [...prev, data]);
      }
      setPopover(null);
      setEditingId(null);
    } catch {
      setError('Network error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!editingId || !gameId) return;
    const res = await fetch(`/api/challenges/${editingId}`, {
      method: 'DELETE',
      headers: adminHeaders(gameId),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      setError(err?.error || 'Failed to delete');
      return;
    }
    setChallenges((prev) => prev.filter((c) => c.id !== editingId));
    setPopover(null);
    setEditingId(null);
  }

  function handleCancel() {
    if (editingId) revertMarker(editingId);
    setPopover(null);
    setEditingId(null);
    setError('');
  }

  async function moveChallenge(index: number, direction: -1 | 1) {
    if (!gameId) return;
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= challenges.length) return;

    const sorted = [...challenges].sort((a, b) => a.sortOrder - b.sortOrder);
    const [item] = sorted.splice(index, 1);
    sorted.splice(newIndex, 0, item);
    const reordered = sorted.map((c, i) => ({ ...c, sortOrder: i + 1 }));
    setChallenges(reordered);

    await fetch(`/api/games/${gameId}/challenges/order`, {
      method: 'PUT',
      headers: adminHeaders(gameId),
      body: JSON.stringify({ order: reordered.map((c) => ({ id: c.id, sortOrder: c.sortOrder })) }),
    });
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* Top bar */}
      {!popover && !showOrderPanel && (
        <div style={{
          position: 'absolute', top: 16, left: 16, right: 16,
          background: 'rgba(0,0,0,0.7)', color: 'white',
          padding: '8px 16px', borderRadius: 8,
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <span style={{ flex: '1 1 auto' }}>Click anywhere on the map to create a challenge</span>
          <button onClick={() => setShowOrderPanel(true)}
            style={{ padding: '4px 12px', background: '#3498db', border: 'none', borderRadius: 4, color: 'white', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            Challenge Order ({challenges.length})
          </button>
          <a href={`/game/${gameId}/admin`}
            style={{ color: '#3498db', textDecoration: 'none', whiteSpace: 'nowrap' }}>
            Admin Panel
          </a>
        </div>
      )}

      {/* Popover */}
      {popover && (
        <div className="setup-popover" style={{
          position: 'absolute', top: 16, right: 16, width: 320,
          background: '#1a1a2e', color: 'white', padding: 16, borderRadius: 8,
          display: 'flex', flexDirection: 'column', gap: 8,
          maxHeight: 'calc(100vh - 32px)', overflow: 'auto',
        }}>
          <h3 style={{ margin: 0 }}>{editingId ? 'Edit Challenge' : 'New Challenge'}</h3>

          <label>Type</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['normal', 'variable', 'wager'] as ChallengeType[]).map((t) => (
              <button key={t}
                onClick={() => setPopover({ ...popover, type: t })}
                style={{
                  flex: 1, padding: '6px 4px',
                  background: popover.type === t ? typeColor(t) : '#2a2a3e',
                  color: 'white', border: 'none', borderRadius: 4,
                  cursor: 'pointer', fontSize: 12, textTransform: 'uppercase',
                  fontWeight: popover.type === t ? 'bold' : 'normal',
                }}>
                {t}
              </button>
            ))}
          </div>

          <label>Name</label>
          <input value={popover.name} onChange={(e) => setPopover({ ...popover, name: e.target.value })} />

          <label>Description (hidden until in range)</label>
          <textarea value={popover.description} onChange={(e) => setPopover({ ...popover, description: e.target.value })} rows={3} />

          {popover.type === 'normal' && (
            <>
              <label>Tokens</label>
              <input type="number" value={popover.tokens}
                onChange={(e) => setPopover({ ...popover, tokens: Math.max(0, Number(e.target.value) || 0) })} />
            </>
          )}
          {popover.type === 'variable' && (
            <>
              <label>Tokens per unit</label>
              <input type="number" value={popover.tokensPerUnit}
                onChange={(e) => setPopover({ ...popover, tokensPerUnit: Math.max(0, Number(e.target.value) || 0) })} />
              <label>Unit label (e.g. "pushup", "photo")</label>
              <input value={popover.unitLabel}
                onChange={(e) => setPopover({ ...popover, unitLabel: e.target.value })} />
            </>
          )}
          {popover.type === 'wager' && (
            <p style={{ opacity: 0.6, fontSize: 13, margin: '0 0 4px' }}>
              Wager: team picks an amount; pass = +2× wager, fail = −wager.
            </p>
          )}

          <label>Activation Radius: {popover.proximityMeters}m</label>
          <input type="range" min={50} max={300} value={popover.proximityMeters}
            onChange={(e) => setPopover({ ...popover, proximityMeters: Number(e.target.value) })} />

          {error && <p style={{ color: '#e74c3c', margin: 0 }}>{error}</p>}

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleSave} disabled={saving}
              style={{ flex: 1, padding: 8, opacity: saving ? 0.5 : 1 }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={handleCancel} disabled={saving} style={{ flex: 1, padding: 8 }}>Cancel</button>
          </div>
          {editingId && (
            <button onClick={handleDelete}
              style={{ padding: 8, background: '#e74c3c', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', marginTop: 4 }}>
              Delete Challenge
            </button>
          )}
        </div>
      )}

      {/* Order panel */}
      {showOrderPanel && (
        <OrderTimeline
          challenges={challenges}
          activeChallengeCount={game?.activeChallengeCount ?? 3}
          onClose={() => setShowOrderPanel(false)}
          onMove={moveChallenge}
        />
      )}

      {/* Timeline scrubber */}
      {!popover && challenges.length > 0 && (
        <TimelineScrubber
          challenges={challenges}
          activeChallengeCount={game?.activeChallengeCount ?? 3}
          step={simStep}
          onStepChange={setSimStep}
        />
      )}
    </div>
  );
}

function TimelineScrubber({
  challenges, activeChallengeCount, step, onStepChange,
}: {
  challenges: SavedChallenge[];
  activeChallengeCount: number;
  step: number;
  onStepChange: (s: number) => void;
}) {
  const sorted = [...challenges].sort((a, b) => a.sortOrder - b.sortOrder);
  const N = sorted.length;
  const K = activeChallengeCount;
  const maxStep = N;

  const [playing, setPlaying] = useState(false);
  const STEP_MS = 1200;

  // Clamp if challenges shrunk
  useEffect(() => {
    if (step > maxStep) onStepChange(maxStep);
  }, [maxStep, step, onStepChange]);

  // Auto-advance while playing; stop at end
  useEffect(() => {
    if (!playing) return;
    if (step >= maxStep) { setPlaying(false); return; }
    const id = setTimeout(() => onStepChange(step + 1), STEP_MS);
    return () => clearTimeout(id);
  }, [playing, step, maxStep, onStepChange]);

  function handlePlayPause() {
    if (playing) { setPlaying(false); return; }
    if (step >= maxStep) onStepChange(0);
    setPlaying(true);
  }

  const active = sorted.slice(step, Math.min(step + K, N));
  const claimedCount = step;
  const queuedCount = Math.max(0, N - step - K);

  let label: string;
  if (step === 0) label = 'Game start';
  else if (step >= N) label = 'All challenges claimed';
  else label = `After ${step} claim${step === 1 ? '' : 's'}`;

  return (
    <div style={{
      position: 'absolute', bottom: 16, left: 16, right: 16,
      maxWidth: 640, margin: '0 auto',
      background: 'rgba(0,0,0,0.78)', color: 'white',
      padding: '10px 14px', borderRadius: 8,
      display: 'flex', flexDirection: 'column', gap: 8,
      pointerEvents: 'auto',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12 }}>
        <span style={{ fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 0.6 }}>
          Map preview · {label}
        </span>
        <span style={{ marginLeft: 'auto', opacity: 0.6 }}>
          {claimedCount} done · {active.length} active · {queuedCount} queued
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={handlePlayPause}
          title={playing ? 'Pause' : (step >= maxStep ? 'Replay from start' : 'Play')}
          style={{
            background: playing ? '#3498db' : 'none',
            border: '1px solid rgba(255,255,255,0.3)',
            color: 'white', borderRadius: 4, padding: '2px 10px',
            cursor: 'pointer', minWidth: 32, fontSize: 13,
          }}>
          {playing ? '❚❚' : '▶'}
        </button>
        <button onClick={() => { setPlaying(false); onStepChange(Math.max(0, step - 1)); }}
          disabled={step === 0}
          style={{ background: 'none', border: '1px solid rgba(255,255,255,0.3)', color: step === 0 ? '#555' : 'white', borderRadius: 4, padding: '2px 8px', cursor: step === 0 ? 'default' : 'pointer' }}>‹</button>
        <input type="range" min={0} max={maxStep} value={step}
          onChange={(e) => { setPlaying(false); onStepChange(Number(e.target.value)); }}
          style={{ flex: 1 }} />
        <button onClick={() => { setPlaying(false); onStepChange(Math.min(maxStep, step + 1)); }}
          disabled={step === maxStep}
          style={{ background: 'none', border: '1px solid rgba(255,255,255,0.3)', color: step === maxStep ? '#555' : 'white', borderRadius: 4, padding: '2px 8px', cursor: step === maxStep ? 'default' : 'pointer' }}>›</button>
        <button onClick={() => { setPlaying(false); onStepChange(0); }}
          style={{ background: 'none', border: '1px solid rgba(255,255,255,0.3)', color: 'white', borderRadius: 4, padding: '2px 10px', cursor: 'pointer', fontSize: 11 }}>Reset</button>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11, alignItems: 'center' }}>
        <span style={{ opacity: 0.5 }}>Active now:</span>
        {active.length === 0 && <span style={{ opacity: 0.5, fontStyle: 'italic' }}>none</span>}
        {active.map((c) => (
          <span key={c.id} style={{
            padding: '2px 8px', borderRadius: 10,
            background: typeColor(c.type), fontWeight: 500,
          }}>
            {c.name}
          </span>
        ))}
      </div>
    </div>
  );
}
