import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import maplibregl from 'maplibre-gl';
import { getMapStyle, CHICAGO_CENTER } from '../mapStyle';
import { ensurePmtilesProtocol } from '../mapSetup';
import type { Challenge, ChallengeType } from '@t4al/shared';

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
  const [popover, setPopover] = useState<ChallengeForm | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showOrderPanel, setShowOrderPanel] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { challengesRef.current = challenges; }, [challenges]);
  useEffect(() => { editingIdRef.current = editingId; }, [editingId]);
  useEffect(() => { popoverRef.current = popover; }, [popover]);

  // Load existing challenges
  useEffect(() => {
    if (!gameId) return;
    fetch(`/api/games/${gameId}/challenges`, { headers: adminHeaders(gameId) })
      .then((r) => r.ok ? r.json() : [])
      .then((rows: Challenge[]) => {
        if (Array.isArray(rows)) setChallenges(rows);
      })
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

    challenges.forEach((c) => {
      const existing = markersRef.current.get(c.id);
      if (existing) {
        existing.setLngLat([c.lng, c.lat]);
        const el = existing.getElement();
        el.style.background = typeColor(c.type);
        return;
      }
      const el = document.createElement('div');
      el.style.cssText =
        `width:18px;height:18px;background:${typeColor(c.type)};border-radius:50%;border:2px solid white;cursor:pointer;`;
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

  useEffect(() => {
    markersRef.current.forEach((marker, id) => {
      const selected = id === editingId;
      marker.setDraggable(selected);
      const el = marker.getElement();
      el.style.border = selected ? '2px solid #ffffff' : '2px solid rgba(255,255,255,0.6)';
      el.style.cursor = selected ? 'grab' : 'pointer';
      el.style.boxShadow = 'none';
    });
  }, [editingId, challenges]);

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
        <div style={{
          position: 'absolute', top: 16, right: 16, width: 320,
          background: '#1a1a2e', color: 'white', padding: 16, borderRadius: 8,
          maxHeight: 'calc(100vh - 32px)', overflow: 'auto',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>Challenge Order</h3>
            <button onClick={() => setShowOrderPanel(false)}
              style={{ background: 'none', border: 'none', color: 'white', fontSize: 18, cursor: 'pointer' }}>×</button>
          </div>
          <p style={{ fontSize: 12, opacity: 0.6, margin: '0 0 12px' }}>
            Top of the list activates first. K challenges are on the map at once.
          </p>
          {[...challenges]
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((c, i) => (
              <div key={c.id} style={{
                display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6,
                padding: '6px 8px', background: '#2a2a3e', borderRadius: 4,
              }}>
                <span style={{
                  fontSize: 10, padding: '1px 6px', borderRadius: 8,
                  background: typeColor(c.type), fontWeight: 'bold',
                }}>
                  {c.type.charAt(0).toUpperCase()}
                </span>
                <span style={{ opacity: 0.5, width: 20, fontSize: 12 }}>#{i + 1}</span>
                <span style={{ flex: 1, fontSize: 14 }}>{c.name}</span>
                <button onClick={() => moveChallenge(i, -1)} disabled={i === 0}
                  style={{ background: 'none', border: 'none', color: i === 0 ? '#555' : 'white', cursor: i === 0 ? 'default' : 'pointer', fontSize: 16, padding: '2px 6px' }}>↑</button>
                <button onClick={() => moveChallenge(i, 1)} disabled={i === challenges.length - 1}
                  style={{ background: 'none', border: 'none', color: i === challenges.length - 1 ? '#555' : 'white', cursor: i === challenges.length - 1 ? 'default' : 'pointer', fontSize: 16, padding: '2px 6px' }}>↓</button>
              </div>
            ))}
          {challenges.length === 0 && <p style={{ opacity: 0.5, fontSize: 13 }}>No challenges yet</p>}
        </div>
      )}
    </div>
  );
}
