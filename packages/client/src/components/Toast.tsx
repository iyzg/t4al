import { useEffect } from 'react';
import { useGameStore } from '../store';

export default function Toast() {
  const toast = useGameStore((s) => s.toast);
  const dismiss = useGameStore((s) => s.dismissToast);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(dismiss, 3500);
    return () => clearTimeout(id);
  }, [toast, dismiss]);

  if (!toast) return null;

  const bg = toast.kind === 'error' ? '#c0392b' : '#27ae60';
  return (
    <div
      onClick={dismiss}
      style={{
        position: 'absolute',
        top: 60,
        left: '50%',
        transform: 'translateX(-50%)',
        background: bg,
        color: 'white',
        padding: '10px 18px',
        borderRadius: 8,
        zIndex: 20,
        fontSize: 14,
        fontWeight: 500,
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        cursor: 'pointer',
        maxWidth: 320,
      }}
    >
      {toast.message}
    </div>
  );
}
