import { useEffect, useState } from 'react';
import { useGameStore } from '../store';

export default function GameHUD() {
  const gameId = useGameStore((s) => s.gameId);
  const gameStatus = useGameStore((s) => s.gameStatus);
  const [gameName, setGameName] = useState('');
  const [endTime, setEndTime] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState('');

  // Fetch game info — re-fetch when gameStatus changes (e.g. lobby → active)
  // so the countdown timer picks up the newly-set end_time
  useEffect(() => {
    if (!gameId) return;
    fetch(`/api/games/${gameId}`)
      .then((r) => r.json())
      .then((g) => {
        setGameName(g.name);
        if (g.end_time) setEndTime(new Date(g.end_time));
      });
  }, [gameId, gameStatus]);

  // Countdown timer
  useEffect(() => {
    if (!endTime) return;
    const tick = () => {
      const diff = endTime.getTime() - Date.now();
      if (diff <= 0) {
        setCountdown('0:00');
        return;
      }
      const min = Math.floor(diff / 60000);
      const sec = Math.floor((diff % 60000) / 1000);
      setCountdown(`${min}:${sec.toString().padStart(2, '0')}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [endTime]);

  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        left: 16,
        background: 'rgba(26, 26, 46, 0.9)',
        color: 'white',
        borderRadius: 8,
        padding: '8px 16px',
        display: 'flex',
        gap: 16,
        alignItems: 'center',
        zIndex: 5,
      }}
    >
      <span style={{ fontWeight: 'bold' }}>{gameName || 'In the Loop'}</span>
      {countdown && <span style={{ fontFamily: 'monospace', fontSize: 18 }}>{countdown}</span>}
    </div>
  );
}
