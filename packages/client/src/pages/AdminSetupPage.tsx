import { useEffect, useRef, useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import maplibregl from 'maplibre-gl';
import { getMapStyle, CHICAGO_CENTER, CHICAGO_BOUNDS, MIN_ZOOM, MAX_ZOOM } from '../mapStyle';
import { ensurePmtilesProtocol } from '../mapSetup';
import type { Challenge, ChallengeType, Game } from '@t4al/shared';
import {
  typeColor, ORANGE, INK, INK_SOFT, WHITE, FILL, HAIRLINE, BRAND_GREY,
  DISABLED_BG, DANGER,
  PANEL_SHADOW, RADIUS_PANEL, RADIUS_FIELD, RADIUS_PILL, textInput,
} from '../theme';
import { PlayIcon, PauseIcon, ReplayIcon, ChevronLeftIcon, ChevronRightIcon } from '../components/icons';
import { challengePopupHTML } from '../challengePopup';

ensurePmtilesProtocol();

// Compact white-card input styling for the floating map popover (the global
// dark input default would otherwise show through on the light panel).
const popoverInput: React.CSSProperties = {
  ...textInput, fontSize: 14, padding: '8px 10px', borderRadius: 8,
};
const popoverLabel: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: INK_SOFT, margin: '4px 0 0',
};

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

// --- Drag-to-reorder activation list ---
const ROW_H = 44;                 // fixed row height (keeps the drag math exact)
const ROW_GAP = 8;                // vertical gap between rows
const PITCH = ROW_H + ROW_GAP;    // slot-to-slot distance

function GripIcon() {
  return (
    <svg width="10" height="16" viewBox="0 0 10 16" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx="2" cy="3" r="1.3" fill="currentColor" />
      <circle cx="8" cy="3" r="1.3" fill="currentColor" />
      <circle cx="2" cy="8" r="1.3" fill="currentColor" />
      <circle cx="8" cy="8" r="1.3" fill="currentColor" />
      <circle cx="2" cy="13" r="1.3" fill="currentColor" />
      <circle cx="8" cy="13" r="1.3" fill="currentColor" />
    </svg>
  );
}

function moveArr(arr: string[], from: number, to: number): string[] {
  const a = arr.slice();
  const [x] = a.splice(from, 1);
  a.splice(to, 0, x);
  return a;
}

function OrderTimeline({
  challenges, activeChallengeCount, onClose, onReorder, onPreviewChange,
}: {
  challenges: SavedChallenge[];
  activeChallengeCount: number;
  onClose: () => void;
  onReorder: (orderedIds: string[]) => void;
  onPreviewChange: (orderedIds: string[] | null) => void;
}) {
  const sorted = [...challenges].sort((a, b) => a.sortOrder - b.sortOrder);
  const baseIds = sorted.map((c) => c.id);
  const byId = new Map(sorted.map((c) => [c.id, c] as const));
  const n = baseIds.length;
  const K = activeChallengeCount;

  const [dragId, setDragId] = useState<string | null>(null);
  const [targetSlot, setTargetSlot] = useState(0);
  const targetSlotRef = useRef(0);
  const dragInfo = useRef<{ origSlot: number; startY: number } | null>(null);
  const dyRef = useRef(0);
  const rowEls = useRef<Map<string, HTMLDivElement>>(new Map());

  const slotY = (slot: number) => slot * PITCH;
  const containerH = n > 0 ? n * PITCH - ROW_GAP : 0;

  // Display slot for the row at base index i under the current drag. Rows render
  // in FIXED dom order (baseIds) and only their transform changes, so both drag
  // directions ease via the same transition — no snap.
  const slotFor = (i: number, orig: number, target: number) => {
    if (i === orig) return target;
    if (orig < target) return i > orig && i <= target ? i - 1 : i;
    return i >= target && i < orig ? i + 1 : i;
  };

  function beginDrag(e: React.PointerEvent, id: string) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    const origSlot = baseIds.indexOf(id);
    dragInfo.current = { origSlot, startY: e.clientY };
    dyRef.current = 0;
    targetSlotRef.current = origSlot;
    setDragId(id);
    setTargetSlot(origSlot);

    const handleMove = (ev: PointerEvent) => {
      const info = dragInfo.current;
      if (!info) return;
      const dy = ev.clientY - info.startY;
      dyRef.current = dy;
      const el = rowEls.current.get(id);
      if (el) el.style.transform = `translateY(${slotY(info.origSlot) + dy}px) scale(1.03)`;
      const center = slotY(info.origSlot) + dy + ROW_H / 2;
      const slot = Math.max(0, Math.min(n - 1, Math.floor(center / PITCH)));
      if (slot !== targetSlotRef.current) {
        targetSlotRef.current = slot;
        setTargetSlot(slot);
        onPreviewChange(moveArr(baseIds, info.origSlot, slot));
      }
    };
    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      const info = dragInfo.current;
      const finalSlot = targetSlotRef.current;
      const el = rowEls.current.get(id);
      // Ease the lifted row into its slot, then commit the new order.
      if (el && info) {
        el.style.transition = 'transform 200ms cubic-bezier(0.2,0.8,0.2,1)';
        void el.offsetHeight; // flush so the transition applies to the next change
        el.style.transform = `translateY(${slotY(finalSlot)}px) scale(1)`;
      }
      dragInfo.current = null;
      setDragId(null);
      onPreviewChange(null);
      if (info && finalSlot !== info.origSlot) onReorder(moveArr(baseIds, info.origSlot, finalSlot));
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }

  return (
    <div className="setup-popover" style={{
      position: 'absolute', top: 16, right: 16, width: 360,
      background: WHITE, color: INK, padding: 18, borderRadius: RADIUS_PANEL,
      boxShadow: PANEL_SHADOW,
      maxHeight: 'calc(100vh - 32px)', overflow: 'auto',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: INK }}>Activation order</h3>
        <button onClick={onClose} aria-label="Close"
          style={{ background: 'none', border: 'none', color: INK_SOFT, fontSize: 20, lineHeight: 1, cursor: 'pointer', padding: 0 }}>×</button>
      </div>

      {n === 0 ? (
        <p style={{ color: INK_SOFT, fontSize: 13 }}>No challenges yet — click the map to add one.</p>
      ) : (
        <div style={{ position: 'relative', height: containerH }}>
          {baseIds.map((id, i) => {
            const c = byId.get(id)!;
            const info = dragInfo.current;
            const isDragged = id === dragId;
            const slot = dragId && info ? slotFor(i, info.origSlot, targetSlot) : i;
            const accent = slot < K ? ORANGE : 'transparent';
            const y = isDragged && info ? slotY(info.origSlot) + dyRef.current : slotY(slot);
            return (
              <div key={id}
                ref={(el) => { if (el) rowEls.current.set(id, el); else rowEls.current.delete(id); }}
                onPointerDown={(e) => beginDrag(e, id)}
                style={{
                  position: 'absolute', left: 0, right: 0, top: 0, height: ROW_H,
                  transform: isDragged ? `translateY(${y}px) scale(1.03)` : `translateY(${y}px)`,
                  transition: isDragged ? 'none' : 'transform 200ms cubic-bezier(0.2,0.8,0.2,1)',
                  zIndex: isDragged ? 5 : 1,
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '0 10px', boxSizing: 'border-box',
                  background: FILL, borderRadius: 8,
                  borderLeft: `3px solid ${accent}`,
                  boxShadow: isDragged ? '0 10px 22px rgba(0,0,0,0.18)' : 'none',
                  cursor: isDragged ? 'grabbing' : 'grab',
                  touchAction: 'none', userSelect: 'none',
                }}>
                <span style={{ color: INK_SOFT, opacity: 0.45, display: 'inline-flex' }}><GripIcon /></span>
                <span style={{ color: INK_SOFT, opacity: 0.7, width: 20, fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>#{slot + 1}</span>
                <span style={{
                  fontSize: 9, padding: '2px 6px', borderRadius: 4, color: WHITE,
                  background: typeColor(c.type), fontWeight: 700, letterSpacing: 0.4, flexShrink: 0,
                }}>
                  {typeBadgeText(c.type)}
                </span>
                <span style={{ flex: 1, fontSize: 14, color: INK, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span>
              </div>
            );
          })}
        </div>
      )}

      {n > 0 && n <= K && (
        <p style={{ fontSize: 12, color: INK_SOFT, margin: '12px 0 0', lineHeight: 1.4 }}>
          Add {K - n} more to fill all {K} starting slots.
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
  const hoverPopupRef = useRef<maplibregl.Popup | null>(null);

  const showHoverPopup = useCallback((id: string) => {
    const cur = challengesRef.current.find((ch) => ch.id === id);
    const map = mapRef.current;
    if (!cur || !map) return;
    if (!hoverPopupRef.current) {
      hoverPopupRef.current = new maplibregl.Popup({
        closeButton: false, closeOnClick: false, offset: 16, className: 'challenge-popup',
      });
    }
    const popup = hoverPopupRef.current;
    popup.setLngLat([cur.lng, cur.lat]).setHTML(challengePopupHTML(cur, { description: true }));
    if (!popup.isOpen()) popup.addTo(map);
    const el = popup.getElement();
    if (el) requestAnimationFrame(() => el.classList.add('is-visible'));
  }, []);
  const hideHoverPopup = useCallback(() => {
    hoverPopupRef.current?.getElement()?.classList.remove('is-visible');
  }, []);

  const [challenges, setChallenges] = useState<SavedChallenge[]>([]);
  const [game, setGame] = useState<Game | null>(null);
  const [simStep, setSimStep] = useState(0);
  const [popover, setPopover] = useState<ChallengeForm | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showOrderPanel, setShowOrderPanel] = useState(false);
  const [error, setError] = useState('');
  // Live order preview while dragging in the activation panel — drives the map
  // marker numbers so they renumber in step with the dragged row.
  const [previewOrder, setPreviewOrder] = useState<string[] | null>(null);

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
      // `${ORANGE}73` = brand orange at ~45% alpha (0x73 ≈ 0.45) so the
      // preview fill tracks the brand accent if it is ever retuned.
      el.style.cssText =
        `width:20px;height:20px;background:${ORANGE}73;border-radius:50%;border:2px dashed ${ORANGE};pointer-events:none;`;
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
          paint: { 'fill-color': ORANGE, 'fill-opacity': 0.15 },
        });
        map.addLayer({
          id: 'radius-circle-stroke', type: 'line', source: 'radius-circle',
          paint: { 'line-color': ORANGE, 'line-width': 2, 'line-dasharray': [2, 2] },
        });
      });

      map.on('click', (e) => {
        const prevId = editingIdRef.current;
        if (prevId) revertMarker(prevId);
        setEditingId(null);
        setPopover({ ...BLANK_FORM, lat: e.lngLat.lat, lng: e.lngLat.lng });
      });

      mapRef.current = map;
      return () => {
        hoverPopupRef.current?.remove();
        hoverPopupRef.current = null;
        map.remove();
        mapRef.current = null;
      };
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
        `font-family:'Sora',-apple-system,BlinkMacSystemFont,sans-serif;text-shadow:0 1px 2px rgba(0,0,0,0.5);`;
      el.textContent = String(orderRank);
      const marker = new maplibregl.Marker({ element: el, draggable: false })
        .setLngLat([c.lng, c.lat])
        .addTo(map);

      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        hideHoverPopup();
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

      el.addEventListener('mouseenter', () => showHoverPopup(c.id));
      el.addEventListener('mouseleave', hideHoverPopup);

      marker.on('drag', () => {
        hideHoverPopup();
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

  // Live marker numbering: follow the activation-order drag preview when one is
  // active, otherwise the committed sort order.
  useEffect(() => {
    const order = previewOrder
      ?? [...challenges].sort((a, b) => a.sortOrder - b.sortOrder).map((c) => c.id);
    order.forEach((id, i) => {
      const el = markersRef.current.get(id)?.getElement();
      if (el) el.textContent = String(i + 1);
    });
  }, [previewOrder, challenges]);

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
      const baseColor = c ? typeColor(c.type) : BRAND_GREY;

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
        // Simulated "claimed/done" marker: dimmed neutral. Uses BRAND_GREY +
        // low opacity rather than STATUS_COLORS.claimed (green) so the
        // scrubber's opacity-based sim language reads as "inactive", not "won".
        el.style.background = BRAND_GREY;
        el.style.opacity = '0.45';
        el.style.border = '2px solid rgba(255,255,255,0.4)';
        el.style.borderStyle = 'solid';
        el.style.cursor = 'pointer';
      } else {
        // queued — a faded colored dot. Opacity alone conveys "not live yet";
        // it keeps the same solid white edge as an active dot so type stays
        // color-only. (Previously a dashed border, which rendered as a coin/gear
        // ring on the small circle and was misread as a challenge-type marker.)
        el.style.background = baseColor;
        el.style.opacity = '0.55';
        el.style.border = '2px solid rgba(255,255,255,0.85)';
        el.style.borderStyle = 'solid';
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

  async function commitOrder(orderedIds: string[]) {
    if (!gameId) return;
    const byId = new Map(challenges.map((c) => [c.id, c] as const));
    const reordered = orderedIds
      .map((id, i) => { const c = byId.get(id); return c ? { ...c, sortOrder: i + 1 } : null; })
      .filter((c): c is SavedChallenge => c !== null);
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
        <div className="setup-topbar" style={{
          position: 'absolute', top: 16, left: 16, right: 16,
          background: WHITE, color: INK,
          padding: '10px 12px 10px 16px', borderRadius: RADIUS_PANEL,
          boxShadow: PANEL_SHADOW,
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <span style={{ flex: '1 1 auto', fontSize: 14, fontWeight: 500, color: INK_SOFT }}>
            Click anywhere on the map to create a challenge
          </span>
          <button onClick={() => setShowOrderPanel(true)}
            style={{ padding: '7px 14px', background: ORANGE, border: 'none', borderRadius: RADIUS_PILL, color: WHITE, cursor: 'pointer', whiteSpace: 'nowrap', fontSize: 13, fontWeight: 700 }}>
            Challenge order ({challenges.length})
          </button>
          <Link to={`/game/${gameId}/admin`}
            style={{ color: ORANGE, textDecoration: 'none', whiteSpace: 'nowrap', fontSize: 14, fontWeight: 600, padding: '0 6px' }}>
            Admin panel
          </Link>
        </div>
      )}

      {/* Popover */}
      {popover && (
        <div className="setup-popover" style={{
          position: 'absolute', top: 16, right: 16, width: 320,
          background: WHITE, color: INK, padding: 18, borderRadius: RADIUS_PANEL,
          boxShadow: PANEL_SHADOW,
          display: 'flex', flexDirection: 'column', gap: 8,
          maxHeight: 'calc(100vh - 32px)', overflow: 'auto',
        }}>
          <h3 style={{ margin: '0 0 2px', fontSize: 18, fontWeight: 700, color: INK }}>
            {editingId ? 'Edit challenge' : 'New challenge'}
          </h3>

          <label style={popoverLabel}>Type</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['normal', 'variable', 'wager'] as ChallengeType[]).map((t) => {
              const selected = popover.type === t;
              return (
                <button key={t}
                  onClick={() => setPopover({ ...popover, type: t })}
                  style={{
                    flex: 1, padding: '7px 4px',
                    background: selected ? typeColor(t) : FILL,
                    color: selected ? WHITE : INK_SOFT,
                    border: selected ? 'none' : `1px solid ${HAIRLINE}`,
                    borderRadius: 8,
                    cursor: 'pointer', fontSize: 12, textTransform: 'uppercase',
                    letterSpacing: 0.3,
                    fontWeight: 700,
                  }}>
                  {t}
                </button>
              );
            })}
          </div>

          <label style={popoverLabel}>Name</label>
          <input className="loop-input" style={popoverInput}
            value={popover.name} onChange={(e) => setPopover({ ...popover, name: e.target.value })} />

          <label style={popoverLabel}>Description (hidden until in range)</label>
          <textarea className="loop-input" style={{ ...popoverInput, resize: 'vertical', lineHeight: 1.4 }}
            value={popover.description} onChange={(e) => setPopover({ ...popover, description: e.target.value })} rows={3} />

          {popover.type === 'normal' && (
            <>
              <label style={popoverLabel}>Tokens</label>
              <input className="loop-input" style={popoverInput} type="number" value={popover.tokens}
                onChange={(e) => setPopover({ ...popover, tokens: Math.max(0, Number(e.target.value) || 0) })} />
            </>
          )}
          {popover.type === 'variable' && (
            <>
              <label style={popoverLabel}>Tokens per unit</label>
              <input className="loop-input" style={popoverInput} type="number" value={popover.tokensPerUnit}
                onChange={(e) => setPopover({ ...popover, tokensPerUnit: Math.max(0, Number(e.target.value) || 0) })} />
              <label style={popoverLabel}>Unit label (e.g. "pushup", "photo")</label>
              <input className="loop-input" style={popoverInput} value={popover.unitLabel}
                onChange={(e) => setPopover({ ...popover, unitLabel: e.target.value })} />
            </>
          )}
          {popover.type === 'wager' && (
            <p style={{ color: INK_SOFT, fontSize: 13, margin: '2px 0 0', lineHeight: 1.4 }}>
              Wager: team picks an amount; pass = +2× wager, fail = −wager.
            </p>
          )}

          <label style={{ ...popoverLabel, marginTop: 6 }}>Activation radius: {popover.proximityMeters}m</label>
          <input type="range" min={50} max={300} value={popover.proximityMeters}
            style={{ accentColor: ORANGE, background: 'transparent', border: 'none', padding: 0 }}
            onChange={(e) => setPopover({ ...popover, proximityMeters: Number(e.target.value) })} />

          {error && <p style={{ color: DANGER, margin: '2px 0 0', fontSize: 13, fontWeight: 600 }}>{error}</p>}

          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button onClick={handleCancel} disabled={saving}
              style={{ flex: 1, padding: '10px 12px', background: FILL, color: INK, border: `1px solid ${HAIRLINE}`, borderRadius: RADIUS_FIELD, cursor: saving ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 700 }}>
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving}
              style={{ flex: 1, padding: '10px 12px', background: ORANGE, color: WHITE, border: 'none', borderRadius: RADIUS_FIELD, cursor: saving ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 700, opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
          {editingId && (
            <button onClick={handleDelete}
              style={{ padding: '10px 12px', background: 'none', color: DANGER, border: `1px solid ${HAIRLINE}`, borderRadius: RADIUS_FIELD, cursor: 'pointer', marginTop: 2, fontSize: 13, fontWeight: 700 }}>
              Delete challenge
            </button>
          )}
        </div>
      )}

      {/* Order panel */}
      {showOrderPanel && (
        <OrderTimeline
          challenges={challenges}
          activeChallengeCount={game?.activeChallengeCount ?? 3}
          onClose={() => { setShowOrderPanel(false); setPreviewOrder(null); }}
          onReorder={commitOrder}
          onPreviewChange={setPreviewOrder}
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

// Square icon button for the scrubber transport controls. `active` paints the
// brand-orange "playing" state; the icon inherits `color` via currentColor.
function ctrlBtn({ active = false, disabled = false }: { active?: boolean; disabled?: boolean }): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 34, height: 32, padding: 0, flexShrink: 0,
    background: active ? ORANGE : WHITE,
    border: `1px solid ${active ? ORANGE : HAIRLINE}`,
    color: active ? WHITE : (disabled ? DISABLED_BG : INK),
    borderRadius: 8,
    cursor: disabled ? 'default' : 'pointer',
  };
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

  return (
    <div style={{
      position: 'absolute', bottom: 16, left: 16, right: 16,
      maxWidth: 520, margin: '0 auto',
      background: WHITE, color: INK,
      padding: '14px 18px', borderRadius: RADIUS_PANEL,
      boxShadow: PANEL_SHADOW,
      display: 'flex', flexDirection: 'column', gap: 12,
      pointerEvents: 'auto',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={handlePlayPause}
          title={playing ? 'Pause' : (step >= maxStep ? 'Replay from start' : 'Play')}
          aria-label={playing ? 'Pause' : 'Play'}
          style={ctrlBtn({ active: playing })}>
          {playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
        </button>
        <button onClick={() => { setPlaying(false); onStepChange(Math.max(0, step - 1)); }}
          disabled={step === 0} aria-label="Step back"
          style={ctrlBtn({ disabled: step === 0 })}>
          <ChevronLeftIcon size={20} />
        </button>
        <input type="range" min={0} max={maxStep} value={step}
          onChange={(e) => { setPlaying(false); onStepChange(Number(e.target.value)); }}
          style={{ flex: 1, accentColor: ORANGE, background: 'transparent', border: 'none', padding: 0 }} />
        <button onClick={() => { setPlaying(false); onStepChange(Math.min(maxStep, step + 1)); }}
          disabled={step === maxStep} aria-label="Step forward"
          style={ctrlBtn({ disabled: step === maxStep })}>
          <ChevronRightIcon size={20} />
        </button>
        <button onClick={() => { setPlaying(false); onStepChange(0); }}
          title="Reset to start" aria-label="Reset to start"
          style={ctrlBtn({})}>
          <ReplayIcon size={18} />
        </button>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11, alignItems: 'center' }}>
        <span style={{ color: INK_SOFT }}>Active now:</span>
        {active.length === 0 && <span style={{ color: INK_SOFT, fontStyle: 'italic' }}>none</span>}
        {active.map((c) => (
          <span key={c.id} style={{
            padding: '3px 9px', borderRadius: RADIUS_PILL, color: WHITE,
            background: typeColor(c.type), fontWeight: 600,
          }}>
            {c.name}
          </span>
        ))}
      </div>
    </div>
  );
}
