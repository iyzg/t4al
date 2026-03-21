import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { getMapStyle, CHICAGO_CENTER, DEFAULT_ZOOM } from './mapStyle';
import { ensurePmtilesProtocol } from './mapSetup';

ensurePmtilesProtocol();

export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

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
  }, []);

  return <div ref={containerRef} style={{ width: '100%', height: '100vh' }} />;
}
