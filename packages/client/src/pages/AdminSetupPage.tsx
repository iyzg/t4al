import { useEffect, useRef, useState } from 'react';
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

export default function AdminSetupPage() {
  const { gameId } = useParams<{ gameId: string }>();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());

  const [challenges, setChallenges] = useState<SavedChallenge[]>([]);
  const [popover, setPopover] = useState<ChallengeForm | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Load existing challenges on mount
  useEffect(() => {
    fetch(`/api/games/${gameId}/challenges`)
      .then((r) => r.json())
      .then((rows) => {
        const mapped = rows.map((r: any) => ({
          id: r.id,
          lat: Number(r.lat),
          lng: Number(r.lng),
          name: r.name,
          description: r.description,
          points: r.points,
          proximityMeters: r.proximity_meters,
          spawnOffsetMinutes: r.spawn_offset_minutes,
        }));
        setChallenges(mapped);
      });
  }, [gameId]);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: getMapStyle(),
      center: CHICAGO_CENTER,
      zoom: 15,
    });

    map.on('click', (e) => {
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
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Sync markers with challenges
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove old markers
    markersRef.current.forEach((marker, id) => {
      if (!challenges.find((c) => c.id === id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    });

    // Add/update markers
    challenges.forEach((c) => {
      if (markersRef.current.has(c.id)) return;
      const el = document.createElement('div');
      el.style.cssText = 'width:16px;height:16px;background:#f39c12;border-radius:50%;border:2px solid white;cursor:pointer;';
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([c.lng, c.lat])
        .addTo(map);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        setEditingId(c.id);
        setPopover({
          lat: c.lat,
          lng: c.lng,
          name: c.name,
          description: c.description,
          points: c.points,
          proximityMeters: c.proximityMeters,
          spawnOffsetMinutes: c.spawnOffsetMinutes,
        });
      });
      markersRef.current.set(c.id, marker);
    });
  }, [challenges]);

  async function handleSave() {
    const url = editingId === null
      ? `/api/games/${gameId}/challenges`
      : `/api/challenges/${editingId}`;
    const method = editingId === null ? 'POST' : 'PUT';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(popover),
    });

    if (!res.ok) {
      alert('Failed to save challenge');
      return;
    }

    const data = await res.json();

    if (editingId === null) {
      setChallenges([...challenges, { ...popover!, id: data.id }]);
    } else {
      setChallenges(challenges.map((c) => (c.id === editingId ? { ...popover!, id: editingId } : c)));
    }

    setPopover(null);
    setEditingId(null);
  }

  if (!popover) {
    return (
      <div style={{ position: 'relative', width: '100%', height: '100vh' }}>
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
        <div style={{ position: 'absolute', top: 16, left: 16, background: 'rgba(0,0,0,0.7)', color: 'white', padding: '8px 16px', borderRadius: 8 }}>
          Click anywhere on the map to create a challenge
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* Challenge creation/edit popover */}
      <div style={{
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
        <input type="range" min={50} max={300} value={popover.proximityMeters} onChange={(e) => setPopover({ ...popover, proximityMeters: Number(e.target.value) })} />

        <label>Spawn Offset: +{popover.spawnOffsetMinutes} min</label>
        <input type="number" min={0} value={popover.spawnOffsetMinutes} onChange={(e) => setPopover({ ...popover, spawnOffsetMinutes: Number(e.target.value) })} />

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleSave} style={{ flex: 1, padding: 8 }}>Save</button>
          <button onClick={() => { setPopover(null); setEditingId(null); }} style={{ flex: 1, padding: 8 }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
