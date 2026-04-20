import { useEffect, useState } from 'react';
import { useGameStore } from '../store';

function formatHhMm(totalSeconds: number): string {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}`;
  return `${m}:${(sec % 60).toString().padStart(2, '0')}`;
}

export default function GameHUD() {
  const game = useGameStore((s) => s.game);
  const gameStatus = useGameStore((s) => s.gameStatus);
  const [countdown, setCountdown] = useState('');

  useEffect(() => {
    if (gameStatus === 'active' && game?.endTime) {
      const endTime = new Date(game.endTime).getTime();
      const tick = () => setCountdown(formatHhMm((endTime - Date.now()) / 1000));
      tick();
      const id = setInterval(tick, 1000);
      return () => clearInterval(id);
    }
    if (gameStatus === 'lobby' && game?.durationMinutes != null) {
      // Show the game's planned duration as HH:MM — dimmed — until it starts
      setCountdown(formatHhMm(game.durationMinutes * 60));
      return;
    }
    if (gameStatus === 'ended') { setCountdown('0:00'); return; }
  }, [gameStatus, game?.endTime, game?.durationMinutes]);

  const dimmed = gameStatus === 'lobby';

  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        left: 16,
        background: '#0b0f1a',
        color: 'white',
        borderRadius: 999,
        padding: '6px 14px',
        fontWeight: 700,
        fontSize: 15,
        letterSpacing: '0.02em',
        fontVariantNumeric: 'tabular-nums',
        opacity: dimmed ? 0.75 : 1,
        zIndex: 5,
        boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
      }}
    >
      {countdown || '\u2014:\u2014'}
    </div>
  );
}
