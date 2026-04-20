import { useEffect, useState } from 'react';
import { useGameStore } from '../store';

// Formats a remaining-time amount with escalating precision:
//   >= 1h  → "Xh Ym"     (e.g. "4h 32m")
//   >= 1m  → "Mm Ss"     (e.g. "59m 59s", "30m 10s")
//   < 1m   → "Ss"        (e.g. "59s")
function formatTime(totalSeconds: number): string {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, '0')}s`;
  return `${s}s`;
}

export default function GameHUD() {
  const game = useGameStore((s) => s.game);
  const gameStatus = useGameStore((s) => s.gameStatus);
  const [countdown, setCountdown] = useState('');

  useEffect(() => {
    if (gameStatus === 'active' && game?.endTime) {
      const endTime = new Date(game.endTime).getTime();
      const tick = () => setCountdown(formatTime((endTime - Date.now()) / 1000));
      tick();
      const id = setInterval(tick, 1000);
      return () => clearInterval(id);
    }
    if (gameStatus === 'lobby' && game?.durationMinutes != null) {
      // Show the game's planned duration — dimmed — until it starts
      setCountdown(formatTime(game.durationMinutes * 60));
      return;
    }
    if (gameStatus === 'ended') { setCountdown('0s'); return; }
  }, [gameStatus, game?.endTime, game?.durationMinutes]);

  const dimmed = gameStatus === 'lobby';

  return (
    <div
      style={{
        background: '#0b0f1a',
        color: 'white',
        borderRadius: 999,
        padding: '6px 14px',
        fontWeight: 700,
        fontSize: 15,
        letterSpacing: '0.02em',
        fontVariantNumeric: 'tabular-nums',
        opacity: dimmed ? 0.75 : 1,
        boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
      }}
    >
      {countdown || '\u2014:\u2014'}
    </div>
  );
}
