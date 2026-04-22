import type maplibregl from 'maplibre-gl';

export const CHICAGO_CENTER: [number, number] = [-87.6298, 41.8827];
export const DEFAULT_ZOOM = 15;

export function getMapStyle(): maplibregl.StyleSpecification {
  const src = 'chicago';
  return {
    version: 8,
    // Glyph pack for symbol/text layers. Protomaps hosts a small fontstack
    // (Noto Sans, Noto Sans Italic, Roboto Mono). Sora is not in that set —
    // see note at the bottom of this file for how to swap to Sora.
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

      // ── parks / green spaces — more visible ──
      { id: 'landcover', type: 'fill', source: src, 'source-layer': 'landcover',
        paint: { 'fill-color': '#dbe5ca', 'fill-opacity': 0.9 } },
      { id: 'landuse', type: 'fill', source: src, 'source-layer': 'landuse',
        paint: { 'fill-color': '#e8e4da', 'fill-opacity': 0.5 } },

      // ── water ──
      { id: 'water', type: 'fill', source: src, 'source-layer': 'water',
        paint: { 'fill-color': '#bdd5e8' } },

      // ── buildings — warmer, slightly darker ──
      { id: 'buildings', type: 'fill', source: src, 'source-layer': 'buildings',
        paint: { 'fill-color': '#d4c7aa', 'fill-opacity': 0.9 } },

      // ── roads — stronger hierarchy; minor → major → highway in darkening + widening ──
      { id: 'roads-minor', type: 'line', source: src, 'source-layer': 'roads',
        filter: ['all', ['!in', 'kind', 'highway', 'major_road', 'rail']],
        paint: { 'line-color': '#d8d2c8', 'line-width': 0.8 } },
      { id: 'roads-major', type: 'line', source: src, 'source-layer': 'roads',
        filter: ['==', 'kind', 'major_road'],
        paint: { 'line-color': '#bdb6aa', 'line-width': 1.2 } },
      { id: 'roads-highway', type: 'line', source: src, 'source-layer': 'roads',
        filter: ['==', 'kind', 'highway'],
        paint: { 'line-color': '#9e9684', 'line-width': 1.6 } },

      // ── transit — distinct cooler gray, still thin ──
      { id: 'rail', type: 'line', source: src, 'source-layer': 'roads',
        filter: ['==', 'kind', 'rail'],
        paint: { 'line-color': '#9a9183', 'line-width': 1 } },

      // ── street labels — subtle, only for majors/highways at zoom 14+ ──
      {
        id: 'roads-labels',
        type: 'symbol',
        source: src,
        'source-layer': 'roads',
        filter: ['all',
          ['in', 'kind', 'highway', 'major_road'],
          ['has', 'name'],
        ],
        minzoom: 14,
        layout: {
          'text-field': ['get', 'name'],
          // Protomaps-hosted font. Swap to Sora once SDF glyphs are generated
          // (see note at the bottom of this file).
          'text-font': ['Noto Sans Medium'],
          'text-size': 10.5,
          'symbol-placement': 'line',
          'text-padding': 4,
          'text-letter-spacing': 0.04,
        },
        paint: {
          'text-color':      '#7a6e5c',
          'text-halo-color': '#f5f0e8',
          'text-halo-width': 1.2,
        },
      },
    ],
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Note on Sora as map labels
//
// MapLibre GL renders map text from signed-distance-field (SDF) glyph packs,
// not CSS-loaded fonts. The global Sora we load via Google Fonts in index.html
// works for HTML UI but does nothing for the map canvas.
//
// To use Sora on the map we'd need to:
//   1. `npx fontnik build-glyphs node_modules/@fontsource/sora/files/sora-latin-400-normal.woff2 public/glyphs/Sora\ Regular/`
//      (or generate from the TTF)
//   2. Also build Sora\ Medium and Sora\ SemiBold into public/glyphs/
//   3. Change `glyphs:` above to: `/glyphs/{fontstack}/{range}.pbf`
//   4. Change `text-font` to `['Sora Medium']`
//
// For now we use Protomaps' hosted Noto Sans — similar geometric sans
// feel. Swap in Sora when you want the step.
// ──────────────────────────────────────────────────────────────────────────
