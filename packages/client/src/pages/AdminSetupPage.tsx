import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import maplibregl from 'maplibre-gl';
import { getMapStyle, CHICAGO_CENTER } from '../mapStyle';
import { ensurePmtilesProtocol } from '../mapSetup';

ensurePmtilesProtocol();

interface ChallengeForm {
  lat: number;
  lng: number;
  name: string;
  description: string;
  points: number;
  proximityMeters: number;
  spawnOffsetMinutes: number;
}

interface SavedChallenge extends ChallengeForm {
  id: string;
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
  const [gameStartTime, setGameStartTime] = useState<string | null>(null);

  // Keep refs in sync for use in imperative map callbacks
  useEffect(() => { challengesRef.current = challenges; }, [challenges]);
  useEffect(() => { editingIdRef.current = editingId; }, [editingId]);
  useEffect(() => { popoverRef.current = popover; }, [popover]);

  // Load game info + existing challenges on mount
  useEffect(() => {
    fetch(`/api/games/${gameId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((g) => { if (g) setGameStartTime(g.start_time ?? null); })
      .catch(() => {});

    fetch(`/api/games/${gameId}/challenges`)
      .then((r) => r.ok ? r.json() : [])
      .then((rows) => {
        if (!Array.isArray(rows)) return;
        setChallenges(rows.map((r: any) => ({
          id: r.id,
          lat: Number(r.lat),
          lng: Number(r.lng),
          name: r.name,
          description: r.description,
          points: r.points,
          proximityMeters: r.proximity_meters,
          spawnOffsetMinutes: r.spawn_offset_minutes,
        })));
      })
      .catch(() => {});
  }, [gameId]);

  // --- Map helpers (stable via useCallback + refs) ---

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

  /** Revert a previously-dragged marker to its saved position */
  const revertMarker = useCallback((id: string) => {
    const orig = challengesRef.current.find((c) => c.id === id);
    const marker = markersRef.current.get(id);
    if (orig && marker) marker.setLngLat([orig.lng, orig.lat]);
  }, []);

  // --- Sync radius circle + preview marker with popover state ---
  useEffect(() => {
    if (popover) {
      updateRadiusCircle(popover.lat, popover.lng, popover.proximityMeters);
      if (editingId) {
        hidePreviewMarker();
      } else {
        showPreviewMarker(popover.lat, popover.lng);
      }
    } else {
      clearRadiusCircle();
      hidePreviewMarker();
    }
  }, [popover?.lat, popover?.lng, popover?.proximityMeters, editingId,
      updateRadiusCircle, clearRadiusCircle, showPreviewMarker, hidePreviewMarker]);

  // --- Initialize map ---
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
          id: 'radius-circle-fill',
          type: 'fill',
          source: 'radius-circle',
          paint: { 'fill-color': '#f39c12', 'fill-opacity': 0.15 },
        });
        map.addLayer({
          id: 'radius-circle-stroke',
          type: 'line',
          source: 'radius-circle',
          paint: { 'line-color': '#f39c12', 'line-width': 2, 'line-dasharray': [2, 2] },
        });
      });

      map.on('click', (e) => {
        // Revert any unsaved drag on previous selection
        const prevId = editingIdRef.current;
        if (prevId) revertMarker(prevId);

        setEditingId(null);
        setPopover({
          lat: e.lngLat.lat,
          lng: e.lngLat.lng,
          name: '',
          description: '',
          points: 100,
          proximityMeters: 100,
          spawnOffsetMinutes: 0,
        });
      });

      mapRef.current = map;
      return () => { map.remove(); mapRef.current = null; };
    } catch (err) {
      console.warn('Map failed to initialize:', err);
    }
  }, []);

  // --- Sync markers with challenges array ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove stale markers
    markersRef.current.forEach((marker, id) => {
      if (!challenges.find((c) => c.id === id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    });

    // Add new / update existing
    challenges.forEach((c) => {
      const existing = markersRef.current.get(c.id);
      if (existing) {
        existing.setLngLat([c.lng, c.lat]);
        return;
      }

      const el = document.createElement('div');
      el.style.cssText =
        'width:16px;height:16px;background:#f39c12;border-radius:50%;border:2px solid white;cursor:pointer;';
      const marker = new maplibregl.Marker({ element: el, draggable: false })
        .setLngLat([c.lng, c.lat])
        .addTo(map);

      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        // Revert any unsaved drag on previous selection
        const prevId = editingIdRef.current;
        if (prevId && prevId !== c.id) revertMarker(prevId);

        const fresh = challengesRef.current.find((ch) => ch.id === c.id);
        if (!fresh) return;
        const { id: _, ...form } = fresh;
        setEditingId(c.id);
        setPopover(form);
      });

      // Update radius circle continuously while dragging
      marker.on('drag', () => {
        const { lat, lng } = marker.getLngLat();
        const radius = popoverRef.current?.proximityMeters ?? 100;
        updateRadiusCircle(lat, lng, radius);
      });

      // Commit the new position to popover state when drag finishes
      marker.on('dragend', () => {
        const { lat, lng } = marker.getLngLat();
        setPopover((prev) => prev ? { ...prev, lat, lng } : null);
      });

      markersRef.current.set(c.id, marker);
    });
  }, [challenges, revertMarker]);

  // --- Toggle draggable + visual highlight on selected marker ---
  // IMPORTANT: only set individual style props — never cssText — because
  // MapLibre positions markers via an inline `transform` on the same element.
  useEffect(() => {
    markersRef.current.forEach((marker, id) => {
      const selected = id === editingId;
      marker.setDraggable(selected);
      const el = marker.getElement();
      el.style.border = selected ? '2px solid #3498db' : '2px solid white';
      el.style.cursor = selected ? 'grab' : 'pointer';
      el.style.boxShadow = selected ? '0 0 10px #3498db' : 'none';
    });
  }, [editingId, challenges]);

  // --- Save / Cancel ---

  async function handleSave() {
    if (!popover) return;
    const url = editingId
      ? `/api/challenges/${editingId}`
      : `/api/games/${gameId}/challenges`;
    const method = editingId ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(popover),
    });
    if (!res.ok) { alert('Failed to save challenge'); return; }
    const data = await res.json();

    if (editingId) {
      setChallenges((prev) =>
        prev.map((c) => (c.id === editingId ? { ...popover, id: editingId } : c)),
      );
    } else {
      setChallenges((prev) => [...prev, { ...popover, id: data.id }]);
    }

    setPopover(null);
    setEditingId(null);
  }

  async function handleDelete() {
    if (!editingId) return;
    const res = await fetch(`/api/challenges/${editingId}`, { method: 'DELETE' });
    if (!res.ok) { alert('Failed to delete challenge'); return; }
    setChallenges((prev) => prev.filter((c) => c.id !== editingId));
    setPopover(null);
    setEditingId(null);
  }

  function handleCancel() {
    if (editingId) revertMarker(editingId);
    setPopover(null);
    setEditingId(null);
  }

  // --- Spawn time label ---
  function spawnTimeLabel(offsetMinutes: number): string {
    if (gameStartTime) {
      const t = new Date(new Date(gameStartTime).getTime() + offsetMinutes * 60_000);
      return `+${offsetMinutes} min (${t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })})`;
    }
    return `+${offsetMinutes} min after start`;
  }

  // --- Render ---
  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {!popover && (
        <div style={{
          position: 'absolute', top: 16, left: 16,
          background: 'rgba(0,0,0,0.7)', color: 'white',
          padding: '8px 16px', borderRadius: 8,
          display: 'flex', alignItems: 'center', gap: 16,
        }}>
          <span>Click anywhere on the map to create a challenge</span>
          <a href={`/game/${gameId}/admin`}
            style={{ color: '#3498db', textDecoration: 'none', whiteSpace: 'nowrap' }}>
            Back to Admin Panel
          </a>
        </div>
      )}

      {popover && (
        <div className="setup-popover" style={{
          position: 'absolute', top: 16, right: 16, width: 300,
          background: '#1a1a2e', color: 'white', padding: 16, borderRadius: 8,
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <h3 style={{ margin: 0 }}>{editingId ? 'Edit Challenge' : 'New Challenge'}</h3>

          <label>Name</label>
          <input value={popover.name} onChange={(e) => setPopover({ ...popover, name: e.target.value })} />

          <label>Description (hidden until activated)</label>
          <textarea value={popover.description} onChange={(e) => setPopover({ ...popover, description: e.target.value })} rows={3} />

          <label>Points</label>
          <input type="number" value={popover.points} onChange={(e) => setPopover({ ...popover, points: Number(e.target.value) })} />

          <label>Activation Radius: {popover.proximityMeters}m</label>
          <input type="range" min={50} max={300} value={popover.proximityMeters}
            onChange={(e) => setPopover({ ...popover, proximityMeters: Number(e.target.value) })} />

          <label>Spawn Offset: {spawnTimeLabel(popover.spawnOffsetMinutes)}</label>
          <input type="number" min={0} value={popover.spawnOffsetMinutes}
            onChange={(e) => setPopover({ ...popover, spawnOffsetMinutes: Number(e.target.value) })} />

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleSave} style={{ flex: 1, padding: 8 }}>Save</button>
            <button onClick={handleCancel} style={{ flex: 1, padding: 8 }}>Cancel</button>
          </div>
          {editingId && (
            <button onClick={handleDelete}
              style={{ padding: 8, background: '#e74c3c', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', marginTop: 4 }}>
              Delete Challenge
            </button>
          )}
        </div>
      )}
    </div>
  );
}
