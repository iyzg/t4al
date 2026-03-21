import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Protocol } from 'pmtiles';

// Register PMTiles protocol exactly once at app startup
let registered = false;
export function ensurePmtilesProtocol() {
  if (registered) return;
  const protocol = new Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile);
  registered = true;
}
