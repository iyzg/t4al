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
      // ── base ──
      { id: 'bg', type: 'background', paint: { 'background-color': '#f5f0e8' } },
      { id: 'earth', type: 'fill', source: src, 'source-layer': 'earth',
        paint: { 'fill-color': '#f0ebe3' } },
      { id: 'landcover', type: 'fill', source: src, 'source-layer': 'landcover',
        paint: { 'fill-color': '#e3e8d8', 'fill-opacity': 0.6 } },
      { id: 'landuse', type: 'fill', source: src, 'source-layer': 'landuse',
        paint: { 'fill-color': '#e8e4da', 'fill-opacity': 0.5 } },
      { id: 'water', type: 'fill', source: src, 'source-layer': 'water',
        paint: { 'fill-color': '#bdd5e8' } },

      // ── buildings — very subtle ──
      { id: 'buildings', type: 'fill', source: src, 'source-layer': 'buildings',
        paint: { 'fill-color': '#e6e1d9', 'fill-opacity': 0.6 } },

      // ── roads — light gray streets ──
      { id: 'roads-minor', type: 'line', source: src, 'source-layer': 'roads',
        filter: ['all', ['!in', 'kind', 'highway', 'major_road', 'rail']],
        paint: { 'line-color': '#ddd8d0', 'line-width': 0.8 } },
      { id: 'roads-major', type: 'line', source: src, 'source-layer': 'roads',
        filter: ['==', 'kind', 'major_road'],
        paint: { 'line-color': '#d0cbc3', 'line-width': 1.5 } },
      { id: 'roads-highway', type: 'line', source: src, 'source-layer': 'roads',
        filter: ['==', 'kind', 'highway'],
        paint: { 'line-color': '#c8c3bb', 'line-width': 2 } },

      // ── transit lines — subtle ──
      { id: 'rail', type: 'line', source: src, 'source-layer': 'roads',
        filter: ['==', 'kind', 'rail'],
        paint: { 'line-color': '#c8c0b8', 'line-width': 2, 'line-dasharray': [4, 2] } },
    ],
  };
}
