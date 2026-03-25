import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import maplibregl from 'maplibre-gl';
import { getMapStyle, CHICAGO_CENTER, DEFAULT_ZOOM } from '../mapStyle';
import { ensurePmtilesProtocol } from '../mapSetup';
import { useGameStore } from '../store';
import { socket } from '../socket';
import { registerSocketHandlers } from '../socketHandlers';
import { HEARTBEAT_INTERVAL_MS } from '@t4al/shared';
import type { Challenge } from '@t4al/shared';
import Leaderboard from '../components/Leaderboard';
import ModeBanner from '../components/ModeBanner';
import GameHUD from '../components/GameHUD';

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

export default function GamePage() {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const posMarkerRef = useRef<maplibregl.Marker | null>(null);
  const myPosRef = useRef<{ lat: number; lng: number } | null>(null);

  const challenges = useGameStore((s) => s.challenges);
  const activeChallengeId = useGameStore((s) => s.activeChallengeId);
  const teamId = useGameStore((s) => s.teamId);
  const gameStatus = useGameStore((s) => s.gameStatus);
  const teamColor = useGameStore((s) => s.teamColor);
  const gameId = useGameStore((s) => s.gameId);

  const [selectedChallengeId, setSelectedChallengeId] = useState<string | null>(null);
  const [myPos, setMyPos] = useState<{ lat: number; lng: number } | null>(null);

  // Derive selectedChallenge from store so it's always fresh
  const selectedChallenge = selectedChallengeId ? challenges[selectedChallengeId] ?? null : null;

  // Restore identity from sessionStorage on refresh, or redirect to join
  useEffect(() => {
    if (gameId && teamId) return; // already have identity
    const saved = sessionStorage.getItem('t4al_identity');
    if (!saved) {
      navigate('/join');
      return;
    }
    try {
      const { gameId: gid, teamId: tid, teamColor: tc } = JSON.parse(saved);
      useGameStore.getState().setIdentity(gid, tid, tc);
      socket.connect();
      socket.emit('game:join', { gameId: gid, teamId: tid });
    } catch {
      navigate('/join');
    }
  }, [gameId, teamId, navigate]);

  // Register socket handlers once (idempotent)
  useEffect(() => {
    registerSocketHandlers();
  }, []);

  // Redirect to end page when game ends
  useEffect(() => {
    if (gameStatus === 'ended' && gameId) {
      navigate(`/game/${gameId}/end`);
    }
  }, [gameStatus, gameId, navigate]);

  // Start GPS tracking + heartbeat
  useEffect(() => {
    if (!teamId || !gameId) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        setMyPos({ lat, lng });
        myPosRef.current = { lat, lng };
      },
      (err) => console.warn('GPS error:', err.message),
      { enableHighAccuracy: true },
    );

    // Send location to server on interval (reads from ref to avoid stale closure)
    const heartbeat = setInterval(() => {
      const pos = myPosRef.current;
      if (pos) {
        socket.emit('location:update', { teamId, lat: pos.lat, lng: pos.lng });
      }
    }, HEARTBEAT_INTERVAL_MS);

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
      if (c.status === 'scheduled') return;

      const existing = markersRef.current.get(c.id);
      if (existing) {
        existing.setLngLat([c.lng, c.lat]);
        // Update style (individual props to preserve MapLibre's transform)
        applyMarkerStyle(existing.getElement(), c, activeChallengeId, teamId);
        return;
      }

      const el = document.createElement('div');
      applyMarkerStyle(el, c, activeChallengeId, teamId);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        setSelectedChallengeId(c.id);
      });
      const marker = new maplibregl.Marker({ element: el }).setLngLat([c.lng, c.lat]).addTo(map);
      markersRef.current.set(c.id, marker);
    });
  }, [challenges, activeChallengeId, teamId]);

  const handleActivate = useCallback(() => {
    if (!selectedChallenge || !teamId) return;
    socket.emit('challenge:activate', { challengeId: selectedChallenge.id, teamId });
    useGameStore.getState().setActiveChallengeId(selectedChallenge.id);
  }, [selectedChallenge, teamId]);

  const handleAbandon = useCallback(() => {
    if (!activeChallengeId || !teamId) return;
    socket.emit('challenge:abandon', { challengeId: activeChallengeId, teamId });
    useGameStore.getState().setActiveChallengeId(null);
    setSelectedChallengeId(null);
  }, [activeChallengeId, teamId]);

  const handleComplete = useCallback(() => {
    if (!activeChallengeId || !teamId) return;
    if (!confirm('Are you sure you completed this challenge?')) return;
    socket.emit('challenge:complete', { challengeId: activeChallengeId, teamId });
  }, [activeChallengeId, teamId]);

  const inRange =
    selectedChallenge && myPos
      ? distanceMeters(myPos.lat, myPos.lng, selectedChallenge.lat, selectedChallenge.lng) <= selectedChallenge.proximityMeters
      : false;

  const isMyActive = selectedChallenge?.id === activeChallengeId;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      <ModeBanner />
      <GameHUD />
      <Leaderboard />

      {selectedChallenge && (
        <div
          className="challenge-card"
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

          {isMyActive && <p style={{ marginTop: 8, opacity: 0.8 }}>{selectedChallenge.description}</p>}

          {selectedChallenge.status === 'claimed' ? (
            <p style={{ opacity: 0.6, marginTop: 8 }}>
              Claimed{selectedChallenge.claimedByTeamId === teamId ? ' by your team!' : ''}
            </p>
          ) : isMyActive ? (
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={handleComplete} style={{ flex: 1, padding: '12px 10px', background: '#2ecc71', border: 'none', borderRadius: 6, color: 'white', fontWeight: 'bold', fontSize: 15 }}>
                Mark Complete
              </button>
              <button onClick={handleAbandon} style={{ flex: 1, padding: '12px 10px', background: '#e74c3c', border: 'none', borderRadius: 6, color: 'white', fontSize: 15 }}>
                Abandon
              </button>
            </div>
          ) : activeChallengeId ? (
            <p style={{ opacity: 0.6, marginTop: 8 }}>You already have an active challenge</p>
          ) : inRange ? (
            <button onClick={handleActivate} style={{ marginTop: 12, width: '100%', padding: '12px 10px', background: '#3498db', border: 'none', borderRadius: 6, color: 'white', fontWeight: 'bold', fontSize: 15 }}>
              Set as Active
            </button>
          ) : (
            <p style={{ opacity: 0.6, marginTop: 8 }}>
              Get closer to activate ({myPos ? Math.round(distanceMeters(myPos.lat, myPos.lng, selectedChallenge.lat, selectedChallenge.lng)) + 'm away' : 'GPS loading...'})
            </p>
          )}

          <button
            onClick={() => setSelectedChallengeId(null)}
            style={{ position: 'absolute', top: 4, right: 4, background: 'none', border: 'none', color: 'white', fontSize: 22, cursor: 'pointer', padding: '8px 12px', lineHeight: 1 }}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

/** Apply marker style using individual properties (not cssText) to preserve MapLibre's transform. */
function applyMarkerStyle(el: HTMLElement, challenge: Challenge, activeChallengeId: string | null, teamId: string | null) {
  el.style.width = '20px';
  el.style.height = '20px';
  el.style.borderRadius = '50%';
  el.style.cursor = 'pointer';

  if (challenge.status === 'claimed') {
    if (challenge.claimedByTeamId === teamId) {
      el.style.background = '#2ecc71';
      el.style.border = '2px solid white';
      el.style.opacity = '0.8';
      el.style.boxShadow = 'none';
    } else {
      el.style.background = '#666';
      el.style.border = '2px solid #999';
      el.style.opacity = '0.5';
      el.style.boxShadow = 'none';
    }
  } else if (challenge.id === activeChallengeId) {
    el.style.background = '#3498db';
    el.style.border = '3px solid white';
    el.style.boxShadow = '0 0 10px #3498db';
    el.style.opacity = '1';
  } else {
    el.style.background = '#f39c12';
    el.style.border = '2px solid white';
    el.style.boxShadow = 'none';
    el.style.opacity = '1';
  }
}
