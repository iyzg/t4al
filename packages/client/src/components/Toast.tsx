import { useEffect } from 'react';
import { useGameStore } from '../store';

const TOAST_TTL_MS = 3500;

// Stack of currently-visible toasts. Each one auto-dismisses on its own
// timer so rapid-fire events don't clobber each other.
export default function Toast() {
  const toasts = useGameStore((s) => s.toasts);

  return (
    <div
      style={{
        position: 'absolute',
        top: 60,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        alignItems: 'center',
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} id={t.id} message={t.message} kind={t.kind} />
      ))}
    </div>
  );
}

function ToastItem({
  id, message, kind,
}: {
  id: number;
  message: string;
  kind: 'error' | 'info';
}) {
  const dismiss = useGameStore((s) => s.dismissToast);

  useEffect(() => {
    const timer = setTimeout(() => dismiss(id), TOAST_TTL_MS);
    return () => clearTimeout(timer);
  }, [id, dismiss]);

  const bg = kind === 'error' ? '#c0392b' : '#27ae60';
  return (
    <div
      onClick={() => dismiss(id)}
      style={{
        background: bg,
        color: 'white',
        padding: '10px 18px',
        borderRadius: 8,
        fontSize: 14,
        fontWeight: 500,
        cursor: 'pointer',
        maxWidth: 320,
        boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
        pointerEvents: 'auto',
      }}
    >
      {message}
    </div>
  );
}
