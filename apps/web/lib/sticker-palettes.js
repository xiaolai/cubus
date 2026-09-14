// The six sticker colours of each palette, BY POSITION on a Western cube: the arrangement every
// entry was chosen in, and the one a colour scheme remaps (ADR 0001). Written once. The renderer
// paints its stickers from it and the app paints its flat nets from it, so the two cannot drift.
//
// Imports nothing, on purpose: packages/cubus-cube/src/cubus-cube.js is bundled as a renderer that
// depends on no app code.
export const STICKER_PALETTES = Object.freeze({
  muted: Object.freeze({ U: '#E8E3D6', D: '#D8B84A', F: '#4E8C6A', B: '#3C6E9E', R: '#B8503F', L: '#C87A3C' }),
  classic: Object.freeze({ U: '#F4F2EC', D: '#F0C000', F: '#00A651', B: '#0051BA', R: '#C41E3A', L: '#FF6C00' }),
  colorsafe: Object.freeze({ U: '#EFEAE0', D: '#E9C46A', F: '#6A9FB5', B: '#20405C', R: '#D1495B', L: '#8C5E8A' }),
});
