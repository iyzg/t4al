import type maplibregl from 'maplibre-gl';

export const CHICAGO_CENTER: [number, number] = [-87.6298, 41.8827];
export const DEFAULT_ZOOM = 15;

// Pan + zoom limits. The PMTiles file only contains Chicago tiles; panning
// or zooming past these bounds shows empty tiles (jank). These numbers are
// a tight box around the Loop + near neighborhoods where the game is played.
export const CHICAGO_BOUNDS: [[number, number], [number, number]] = [
  [-87.80, 41.76],  // SW (west of the river, Bronzeville-ish)
  [-87.50, 41.98],  // NE (east into the lake, Lincoln Park / Lakeview)
];
export const MIN_ZOOM = 12;   // zoomed-out limit — all of the Loop still fits
export const MAX_ZOOM = 19;   // zoom-in limit — block level

// Landuse kinds that should render as green parks.
const PARK_KINDS = [
  'park', 'grass', 'forest', 'nature_reserve', 'protected_area',
  'recreation_ground', 'playground', 'cemetery', 'garden', 'meadow',
];

export function getMapStyle(): maplibregl.StyleSpecification {
  const src = 'chicago';
  return {
    version: 8,
    // Glyph pack for symbol/text layers.
    glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
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

      // ── parks / green spaces (split off landuse by kind) ──
      { id: 'parks', type: 'fill', source: src, 'source-layer': 'landuse',
        filter: ['in', 'kind', ...PARK_KINDS],
        paint: { 'fill-color': '#c5d9a0', 'fill-opacity': 0.9 } },

      // ── non-green landuse — subtle ──
      { id: 'landuse-other', type: 'fill', source: src, 'source-layer': 'landuse',
        filter: ['!in', 'kind', ...PARK_KINDS],
        paint: { 'fill-color': '#e8e4da', 'fill-opacity': 0.5 } },

      // ── landcover — also subtle (farmland, ice, sand, etc.) ──
      { id: 'landcover', type: 'fill', source: src, 'source-layer': 'landcover',
        paint: { 'fill-color': '#dee4d0', 'fill-opacity': 0.5 } },

      // ── water ──
      { id: 'water', type: 'fill', source: src, 'source-layer': 'water',
        paint: { 'fill-color': '#bdd5e8' } },

      // ── buildings — warm, slightly darker ──
      { id: 'buildings', type: 'fill', source: src, 'source-layer': 'buildings',
        paint: { 'fill-color': '#d4c7aa', 'fill-opacity': 0.9 } },

      // ── roads — minor → major → highway ──
      { id: 'roads-minor', type: 'line', source: src, 'source-layer': 'roads',
        filter: ['all', ['!in', 'kind', 'highway', 'major_road', 'rail']],
        paint: { 'line-color': '#d8d2c8', 'line-width': 0.8 } },
      { id: 'roads-major', type: 'line', source: src, 'source-layer': 'roads',
        filter: ['==', 'kind', 'major_road'],
        paint: { 'line-color': '#bdb6aa', 'line-width': 1.2 } },
      { id: 'roads-highway', type: 'line', source: src, 'source-layer': 'roads',
        filter: ['==', 'kind', 'highway'],
        paint: { 'line-color': '#9e9684', 'line-width': 1.6 } },

      // ── transit ──
      { id: 'rail', type: 'line', source: src, 'source-layer': 'roads',
        filter: ['==', 'kind', 'rail'],
        paint: { 'line-color': '#9a9183', 'line-width': 1 } },

      // ── street labels — sparse, only at close zoom ──
      //
      // Dense-label fix: previously labels appeared on every road segment at
      // zoom 14+, creating the "repeated name" effect. Here we show only
      // highways/major roads at zoom 16+, with generous symbol-spacing and
      // no letter-spacing (which was amplifying the halos between glyphs
      // into a dash-like artifact).
      {
        id: 'roads-labels',
        type: 'symbol',
        source: src,
        'source-layer': 'roads',
        filter: ['all',
          ['in', 'kind', 'highway', 'major_road'],
          ['has', 'name'],
        ],
        minzoom: 16,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'symbol-placement': 'line',
          'symbol-spacing': 400,
          'text-padding': 6,
          'text-max-angle': 30,
        },
        paint: {
          'text-color':      '#7a6e5c',
          'text-halo-color': '#f5f0e8',
          'text-halo-width': 0.8,
        },
      },
    ],
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Note on Sora as map labels
//
// MapLibre renders map text from SDF glyph packs, not CSS-loaded fonts, so
// the Sora we load via Google Fonts for HTML UI can't be used here.
//
// To swap to Sora:
//   1. npx fontnik build-glyphs path/to/Sora-Regular.ttf public/glyphs/Sora\ Regular/
//      (also build Sora Medium + SemiBold if you want weight options)
//   2. Change the top-level `glyphs:` URL to `/glyphs/{fontstack}/{range}.pbf`
//   3. Change the `text-font` in roads-labels to `['Sora Medium']` (or whatever)
//
// For now we use Protomaps-hosted Noto Sans Regular — geometric sans, reads
// similar in feel to Sora.
// ──────────────────────────────────────────────────────────────────────────
