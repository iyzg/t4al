import { useGameStore } from '../store';

const MODE_LABELS: Record<string, string> = {
  blackout: 'BLACKOUT',
};

const MODE_COLORS: Record<string, string> = {
  blackout: '#e74c3c',
};

export default function ModeBanner() {
  const segmentMode = useGameStore((s) => s.segmentMode);

  if (!segmentMode) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        background: MODE_COLORS[segmentMode] || '#e74c3c',
        color: 'white',
        textAlign: 'center',
        padding: '8px 0',
        fontWeight: 'bold',
        fontSize: 18,
        letterSpacing: 4,
        zIndex: 10,
      }}
    >
      {MODE_LABELS[segmentMode] || segmentMode.toUpperCase()}
    </div>
  );
}
