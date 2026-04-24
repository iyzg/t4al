import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

interface PressHoldProps {
  onComplete: () => void;
  holdMs?: number;
  disabled?: boolean;
  children: ReactNode;
  fillColor?: string;
  idleStyle?: CSSProperties;
  className?: string;
  ariaLabel?: string;
}

// Press-and-hold button. Smoothly fills a progress bar on press, smoothly drains
// back to 0 on release. Fires onComplete once when fill reaches 100%.
export default function PressHold({
  onComplete,
  holdMs = 3000,
  disabled = false,
  children,
  fillColor = 'rgba(255, 255, 255, 0.25)',
  idleStyle,
  className,
  ariaLabel,
}: PressHoldProps) {
  const [progress, setProgress] = useState(0);
  const pressingRef = useRef(false);
  const progressRef = useRef(0);
  const lastTickRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const firedRef = useRef(false);

  const tick = useCallback((now: number) => {
    const dt = now - lastTickRef.current;
    lastTickRef.current = now;
    // Fill rate: fills 0→1 in holdMs. Drain rate: drains 1→0 in holdMs/2 (faster drain feels snappy).
    const rate = pressingRef.current ? dt / holdMs : -dt / (holdMs / 2);
    let next = progressRef.current + rate;
    if (next < 0) next = 0;
    if (next > 1) next = 1;
    progressRef.current = next;
    setProgress(next);

    if (next >= 1 && !firedRef.current) {
      firedRef.current = true;
      onComplete();
      pressingRef.current = false;
    }

    // Continue animating if pressing (and not done), or if draining above zero.
    if (pressingRef.current || next > 0) {
      rafRef.current = requestAnimationFrame(tick);
    } else {
      rafRef.current = null;
      firedRef.current = false;
    }
  }, [holdMs, onComplete]);

  const startPress = useCallback(() => {
    if (disabled) return;
    if (pressingRef.current) return;
    pressingRef.current = true;
    firedRef.current = false;
    lastTickRef.current = performance.now();
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(tick);
    }
  }, [disabled, tick]);

  const endPress = useCallback(() => {
    if (!pressingRef.current) return;
    pressingRef.current = false;
    lastTickRef.current = performance.now();
    if (rafRef.current == null && progressRef.current > 0) {
      rafRef.current = requestAnimationFrame(tick);
    }
  }, [tick]);

  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
  }, []);

  const fillPct = Math.round(progress * 1000) / 10;

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onPointerDown={(e) => { e.preventDefault(); startPress(); }}
      onPointerUp={endPress}
      onPointerLeave={endPress}
      onPointerCancel={endPress}
      className={className}
      style={{
        position: 'relative',
        overflow: 'hidden',
        cursor: disabled ? 'not-allowed' : 'pointer',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        touchAction: 'none',
        border: 'none',
        ...idleStyle,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          width: `${fillPct}%`,
          background: fillColor,
          pointerEvents: 'none',
          transition: 'none',
        }}
      />
      <span style={{ position: 'relative', zIndex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%' }}>
        {children}
      </span>
    </button>
  );
}
