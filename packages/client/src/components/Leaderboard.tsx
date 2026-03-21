import { useGameStore } from '../store';

export default function Leaderboard() {
  const leaderboard = useGameStore((s) => s.leaderboard);
  const mode = useGameStore((s) => s.leaderboardMode);

  if (mode === 'hidden') return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 60,
        right: 16,
        background: 'rgba(26, 26, 46, 0.9)',
        color: 'white',
        borderRadius: 8,
        padding: 12,
        minWidth: 160,
      }}
    >
      <h4 style={{ margin: '0 0 8px 0', fontSize: 14, opacity: 0.7 }}>Leaderboard</h4>
      {leaderboard.map((entry) => (
        <div
          key={entry.id}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '4px 0',
            fontSize: 14,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontWeight: 'bold', opacity: 0.5, width: 16 }}>#{entry.rank}</span>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: entry.color,
                display: 'inline-block',
              }}
            />
            <span>{entry.name}</span>
          </div>
          {mode === 'full' && <span style={{ fontWeight: 'bold' }}>{entry.score}</span>}
        </div>
      ))}
      {leaderboard.length === 0 && <p style={{ opacity: 0.5, fontSize: 13, margin: 0 }}>No scores yet</p>}
    </div>
  );
}
