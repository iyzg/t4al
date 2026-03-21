import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Protocol } from 'pmtiles';
import { getMapStyle, CHICAGO_CENTER, DEFAULT_ZOOM } from '../mapStyle';
import { useGameStore } from '../store';
import { socket } from '../socket';
import { registerSocketHandlers } from '../socketHandlers';
import { HEARTBEAT_INTERVAL_MS } from '@t4al/shared';
import type { Challenge } from '@t4al/shared';

const protocol = new Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile);

// Haversine distance in meters between two lat/lng points
function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function GamePage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const posMarkerRef = useRef<maplibregl.Marker | null>(null);

  const challenges = useGameStore((s) => s.challenges);
  const activeChallengeId = useGameStore((s) => s.activeChallengeId);
  const teamId = useGameStore((s) => s.teamId);
  const teamColor = useGameStore((s) => s.teamColor);
  const gameId = useGameStore((s) => s.gameId);

  const [selectedChallenge, setSelectedChallenge] = useState<Challenge | null>(null);
  const [myPos, setMyPos] = useState<{ lat: number; lng: number } | null>(null);

  // Register socket handlers once
  useEffect(() => {
    registerSocketHandlers();
  }, []);

  // Start GPS tracking + heartbeat
  useEffect(() => {
    if (!teamId || !gameId) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        setMyPos({ lat, lng });
      },
      (err) => console.warn('GPS error:', err.message),
      { enableHighAccuracy: true },
    );

    // Send location to server on interval
    const heartbeat = setInterval(() => {
      const pos = useGameStore.getState();
      // myPos is local state, read from the ref pattern below
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      navigator.geolocation.clearWatch(watchId);
      clearInterval(heartbeat);
    };
  }, [teamId, gameId]);

  // Send location updates when myPos changes
  useEffect(() => {
    if (!myPos || !teamId) return;
    socket.emit('location:update', { teamId, lat: myPos.lat, lng: myPos.lng });
  }, [myPos, teamId]);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

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
  }, []);

  // Sync my position marker
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

    // Remove stale markers
    markersRef.current.forEach((marker, id) => {
      if (!currentIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    });

    // Add/update markers
    challengeList.forEach((c) => {
      if (c.status === 'scheduled') return; // not yet spawned

      const existing = markersRef.current.get(c.id);
      if (existing) {
        // Update position if needed
        existing.setLngLat([c.lng, c.lat]);
        return;
      }

      const el = document.createElement('div');
      el.style.cssText = getMarkerStyle(c, activeChallengeId, teamId);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        setSelectedChallenge(c);
      });
      const marker = new maplibregl.Marker({ element: el }).setLngLat([c.lng, c.lat]).addTo(map);
      markersRef.current.set(c.id, marker);
    });
  }, [challenges, activeChallengeId, teamId]);

  const handleActivate = useCallback(() => {
    if (!selectedChallenge || !teamId) return;
    socket.emit('challenge:activate', { challengeId: selectedChallenge.id, teamId });
    useGameStore.getState().setActiveChallengeId(selectedChallenge.id);
    // Refresh selected challenge view
    setSelectedChallenge({ ...selectedChallenge });
  }, [selectedChallenge, teamId]);

  const handleAbandon = useCallback(() => {
    if (!activeChallengeId || !teamId) return;
    socket.emit('challenge:abandon', { challengeId: activeChallengeId, teamId });
    useGameStore.getState().setActiveChallengeId(null);
    setSelectedChallenge(null);
  }, [activeChallengeId, teamId]);

  const handleComplete = useCallback(() => {
    if (!activeChallengeId || !teamId) return;
    if (!confirm('Are you sure you completed this challenge?')) return;
    socket.emit('challenge:complete', { challengeId: activeChallengeId, teamId });
  }, [activeChallengeId, teamId]);

  // Compute proximity for selected challenge
  const inRange =
    selectedChallenge && myPos
      ? distanceMeters(myPos.lat, myPos.lng, selectedChallenge.lat, selectedChallenge.lng) <= selectedChallenge.proximityMeters
      : false;

  const isMyActive = selectedChallenge?.id === activeChallengeId;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* Challenge card */}
      {selectedChallenge && (
        <div
          style={{
            position: 'absolute',
            bottom: 24,
            left: 16,
            right: 16,
            background: '#1a1a2e',
            color: 'white',
            borderRadius: 12,
            padding: 16,
            maxWidth: 400,
            margin: '0 auto',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>{selectedChallenge.name}</h3>
            <span style={{ fontWeight: 'bold', color: '#f39c12' }}>{selectedChallenge.points} pts</span>
          </div>

          {/* Description only visible when active */}
          {isMyActive && <p style={{ marginTop: 8, opacity: 0.8 }}>{selectedChallenge.description}</p>}

          {selectedChallenge.status === 'claimed' ? (
            <p style={{ opacity: 0.6, marginTop: 8 }}>
              Claimed{selectedChallenge.claimedByTeamId === teamId ? ' by your team!' : ''}
            </p>
          ) : isMyActive ? (
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={handleComplete} style={{ flex: 1, padding: 10, background: '#2ecc71', border: 'none', borderRadius: 6, color: 'white', fontWeight: 'bold' }}>
                Mark Complete
              </button>
              <button onClick={handleAbandon} style={{ flex: 1, padding: 10, background: '#e74c3c', border: 'none', borderRadius: 6, color: 'white' }}>
                Abandon
              </button>
            </div>
          ) : activeChallengeId ? (
            <p style={{ opacity: 0.6, marginTop: 8 }}>You already have an active challenge</p>
          ) : inRange ? (
            <button onClick={handleActivate} style={{ marginTop: 12, width: '100%', padding: 10, background: '#3498db', border: 'none', borderRadius: 6, color: 'white', fontWeight: 'bold' }}>
              Set as Active
            </button>
          ) : (
            <p style={{ opacity: 0.6, marginTop: 8 }}>Get closer to activate ({myPos ? Math.round(distanceMeters(myPos.lat, myPos.lng, selectedChallenge.lat, selectedChallenge.lng)) + 'm away' : 'GPS loading...'})</p>
          )}

          <button
            onClick={() => setSelectedChallenge(null)}
            style={{ position: 'absolute', top: 8, right: 12, background: 'none', border: 'none', color: 'white', fontSize: 18, cursor: 'pointer' }}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

function getMarkerStyle(challenge: Challenge, activeChallengeId: string | null, teamId: string | null): string {
  const base = 'width:20px;height:20px;border-radius:50%;cursor:pointer;transition:all 0.2s;';
  if (challenge.status === 'claimed') {
    if (challenge.claimedByTeamId === teamId) {
      return base + 'background:#2ecc71;border:2px solid white;opacity:0.8;';
    }
    return base + 'background:#666;border:2px solid #999;opacity:0.5;';
  }
  if (challenge.id === activeChallengeId) {
    return base + 'background:#3498db;border:3px solid white;box-shadow:0 0 10px #3498db;';
  }
  return base + 'background:#f39c12;border:2px solid white;';
}
