import type maplibregl from 'maplibre-gl';

export const CHICAGO_CENTER: [number, number] = [-87.6298, 41.8827];
export const DEFAULT_ZOOM = 15;

export function getMapStyle(): maplibregl.StyleSpecification {
  const src = 'chicago';
  return {
    version: 8,
    sources: {
      [src]: {
        type: 'vector',
        url: 'pmtiles:///chicago.pmtiles',
      },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#1a1a2e' } },
      { id: 'earth', type: 'fill', source: src, 'source-layer': 'earth', paint: { 'fill-color': '#1e1e36' } },
      { id: 'landuse', type: 'fill', source: src, 'source-layer': 'landuse', paint: { 'fill-color': '#1f1f38', 'fill-opacity': 0.5 } },
      { id: 'water', type: 'fill', source: src, 'source-layer': 'water', paint: { 'fill-color': '#16213e' } },
      { id: 'buildings', type: 'fill', source: src, 'source-layer': 'buildings', paint: { 'fill-color': '#24244a', 'fill-opacity': 0.7 } },
      { id: 'roads', type: 'line', source: src, 'source-layer': 'roads', paint: { 'line-color': '#2a2a4a', 'line-width': 1.2 } },
    ],
  };
}
