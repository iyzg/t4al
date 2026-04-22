import type maplibregl from 'maplibre-gl';

export const CHICAGO_CENTER: [number, number] = [-87.6298, 41.8827];
export const DEFAULT_ZOOM = 15;

// Pan + zoom limits matched to the chicago.pmtiles extract.
// The file contains tiles only for this tight box (Loop + Near North +
// Near South) at zooms 0–15. Panning or zooming outside shows empty
// geometry ("blue wedges" from unclipped water polygons at low zoom,
// oversharp upscale above zoom 15).
//
// If you want a wider play area or sharper zoom, re-extract with:
//   pmtiles extract <source.pmtiles> chicago.pmtiles \
//       --bbox=-87.85,41.76,-87.50,42.00 --maxzoom=17
export const CHICAGO_BOUNDS: [[number, number], [number, number]] = [
  [-87.74, 41.82],  // SW — matches the extract
  [-87.50, 41.93],  // NE
];
export const MIN_ZOOM = 13;   // don't allow pulling out past where the data is dense
export const MAX_ZOOM = 16;   // slight over-zoom of the z=15 cap is OK (tiles stretch smoothly)

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
      // Buildings exist only at z≥13 in the protomaps schema. Fade their
      // opacity in across z=12.5→13.5 to avoid the "pop-in" on zoom cross.
      { id: 'buildings', type: 'fill', source: src, 'source-layer': 'buildings',
        paint: {
          'fill-color': '#d4c7aa',
          'fill-opacity': ['interpolate', ['linear'], ['zoom'],
            12.5, 0,
            13.5, 0.9,
          ],
        },
      },

      // ── roads — minor → major → highway, widths interpolated by zoom ──
      // Each road line-width grows smoothly as you zoom in, instead of
      // being a fixed pixel value. Minor roads also fade in across
      // z=11.5→12.5 so they don't pop in at their z=12 min_zoom.
      { id: 'roads-minor', type: 'line', source: src, 'source-layer': 'roads',
        filter: ['all', ['!in', 'kind', 'highway', 'major_road', 'rail']],
        paint: {
          'line-color': '#d8d2c8',
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.4, 16, 1.2],
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 11.5, 0, 12.5, 1],
        },
      },
      { id: 'roads-major', type: 'line', source: src, 'source-layer': 'roads',
        filter: ['==', 'kind', 'major_road'],
        paint: {
          'line-color': '#bdb6aa',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 16, 1.8],
        },
      },
      { id: 'roads-highway', type: 'line', source: src, 'source-layer': 'roads',
        filter: ['==', 'kind', 'highway'],
        paint: {
          'line-color': '#9e9684',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 16, 2.4],
        },
      },

      // ── transit ──
      { id: 'rail', type: 'line', source: src, 'source-layer': 'roads',
        filter: ['==', 'kind', 'rail'],
        paint: {
          'line-color': '#9a9183',
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.6, 16, 1.4],
        },
      },

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
          // Fade labels in over half a zoom level so they don't pop at z=16
          'text-opacity': ['interpolate', ['linear'], ['zoom'], 15.5, 0, 16.5, 1],
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
