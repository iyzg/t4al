import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { ensurePmtilesProtocol } from '../mapSetup';
import { getMapStyle, CHICAGO_CENTER, DEFAULT_ZOOM } from '../mapStyle';

// Build a marching-ants line-dasharray sequence by shifting a {dashLen,
// gapLen} pattern by stepSize each frame.
//
// Always emits a uniform 4-element array [fill, gap, fill, gap] with the
// same period (dashLen + gapLen) so the pattern's spatial frequency
// stays constant from step to step. Mixing array lengths (e.g. 2- vs
// 3-element forms) makes MapLibre reinterpret the period and produces
// jarring back-and-forth jumps.
function buildDashSeq(dashLen: number, gapLen: number, stepSize: number): number[][] {
  const period = dashLen + gapLen;
  const N = Math.round(period / stepSize);
  const seq: number[][] = [];
  for (let i = 0; i < N; i++) {
    const x = i * stepSize;
    if (x === 0)         seq.push([dashLen, gapLen, 0, 0]);
    else if (x <= gapLen) seq.push([0, x, dashLen, gapLen - x]);
    else                  seq.push([x - gapLen, gapLen, period - x, 0]);
  }
  return seq;
}
const RAIL_DASH_SEQ = buildDashSeq(3, 4, 0.25);  // 28 steps, period 7
const DASH_STEP_MS  = 50;                        // ~1.4s full cycle

// Non-interactive map rendered behind page content. Uses the same style
// as the in-game map so non-game pages feel like part of the same world.
// A dark overlay heavily mutes the warm map base; the rail layer is
// dashed and animated as a subtle marching-ants effect to keep the
// background alive without drawing attention.
export default function MapBackground() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    ensurePmtilesProtocol();

    let rafId = 0;
    let map: maplibregl.Map | undefined;

    // Guard map creation: if WebGL is unavailable the constructor throws, and
    // an uncaught throw here would unmount the whole page. The map is purely
    // decorative, so on failure we fall back to the dark overlay alone.
    try {
      map = new maplibregl.Map({
        container: ref.current,
        style: getMapStyle(),
        center: CHICAGO_CENTER,
        zoom: DEFAULT_ZOOM,
        interactive: false,
        attributionControl: false,
      });

      const m = map;
      m.on('load', () => {
        if (m.getLayer('rail')) {
          m.setPaintProperty('rail', 'line-color', '#a89a82');
          m.setPaintProperty('rail', 'line-width', [
            'interpolate', ['linear'], ['zoom'], 12, 1.0, 16, 2.2,
          ]);
        }

        let lastStep = -1;
        function tick(now: number) {
          const step = Math.floor(now / DASH_STEP_MS) % RAIL_DASH_SEQ.length;
          if (step !== lastStep) {
            if (m.getLayer('rail')) {
              m.setPaintProperty('rail', 'line-dasharray', RAIL_DASH_SEQ[step]);
            }
            lastStep = step;
          }
          rafId = requestAnimationFrame(tick);
        }
        rafId = requestAnimationFrame(tick);
      });
    } catch (err) {
      console.warn('MapBackground failed to initialize:', err);
    }

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      map?.remove();
    };
  }, []);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 0,
        pointerEvents: 'none',
      }}
      aria-hidden
    >
      <div ref={ref} style={{ width: '100%', height: '100%' }} />
      {/* Dark overlay turns the warm map into a moody navy backdrop. */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'rgba(11, 15, 26, 0.72)',
      }} />
    </div>
  );
}
