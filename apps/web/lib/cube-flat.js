// Flat views of a cube, drawn from the same model the renderer draws: the net, and the top-face case
// diagram — as SVG text, with no DOM, no WebGL and no clock.
//
// dev-docs/tutorial-capability-plan.md item 4.5. The app's net was drawn by the screens outside the renderer
// (`buildNet` in lib/cube-drawing.js) and the Trainer's case wells were hand-built DOM; cubus-im's charts and
// galleries need the same pictures by the dozen, where a WebGL context per case is not an option (item 4.6).
// So the pictures are a function of the cube: a piece state or a painted picture of 54 facelets, the palette
// and the scheme — the renderer's own table (`lib/sticker-palettes.js`) remapped by `lib/scheme.js`, so a
// flat view and the 3D cube cannot come to disagree about a colour.
//
// THE LOOKS ARE THE APP'S, not new ones. The net's proportions are the `.net` rules in index.html — a 12 by 9
// grid, 3px between faces and 2px between stickers at the 320px reference, stickers with a 3px radius and a
// hairline edge, and a sticker a picture does not fix drawn as an empty well at 35% — and the top face is the
// Trainer's wells: 3 by 3, 4px apart at 76px. The one thing added is the ring of side stickers a PLL diagram
// needs, which the wells never had.
//
// A `?` is an empty well, never a colour: the one thing it must never do is look like a seventh one.
import { pieceStateError, toFacelets } from './cube-pieces.js';
import { STICKER_PALETTES } from './sticker-palettes.js';
import { isScheme, paletteFor } from './scheme.js';

/** The empty well a sticker nobody claims is drawn as — `--facelet-off` in the light theme. */
export const FREE = '#3A332A';
/** A sticker's hairline edge — `--sticker-edge`. */
export const EDGE = 'rgba(0,0,0,.28)';

/**
 * A sticker's corner radius as a fraction OF THE STICKER, on each axis separately.
 *
 * The number is the net's approved look — 3px on a 24.58px sticker at the 320px reference — held as a
 * ratio rather than as a pixel count, because a ratio is the only form of it that survives a sticker
 * changing size. Scaled from the DRAWING's width instead (`3 * k`), the radius stayed put while the ring
 * shrank the wells by a third to make room: measured 2026-09-16, the wells drew at 0.200 of their side
 * and the ring's bars at 0.265, against the net's 0.122 — the outermost shapes on the page, the roundest.
 *
 * Per axis, so a foreshortened sticker's corner is foreshortened with it: the ring's side stickers are the
 * same stickers seen edge-on, and a circular corner on a bar a third as tall is a corner the cube does not
 * have. A square sticker gets rx === ry and is unchanged.
 */
const CORNER = 3 / (((320 - 3 * 3) / 12 * 3 - 2 * 2) / 3);

/** Where each face sits in the net, as [row, column] of its top-left cell on the 12 by 9 grid. */
const NET_AT = Object.freeze({ U: [0, 3], L: [3, 0], F: [3, 3], R: [3, 6], B: [3, 9], D: [6, 3] });
const FACE_ORDER = 'URFDLB';

/**
 * The side stickers of the top layer, in the order a diagram viewed from above draws them — each face's top
 * row, read the way it passes round the top face. Facelet indices on the URFDLB layout; `test/cube-flat.test.mjs`
 * checks every one against `test/cube-oracle.mjs`'s layout rather than trusting a table typed out once.
 */
export const TOP_RING = Object.freeze({
  back: Object.freeze([47, 46, 45]),   // left to right along the top edge: B3 B2 B1
  left: Object.freeze([36, 37, 38]),   // top to bottom along the left edge: L1 L2 L3
  right: Object.freeze([11, 10, 9]),   // top to bottom along the right edge: R3 R2 R1
  front: Object.freeze([18, 19, 20]),  // left to right along the bottom edge: F1 F2 F3
});

const escapeXml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

/** A cube as 54 facelets: a piece state is written out, a picture is taken as it is. Refuses anything else. */
export function faceletsOf(cube) {
  if (typeof cube !== 'string') {
    // CHECKED BEFORE IT IS CONVERTED. `toFacelets` writes out whatever it is given, and the string it
    // makes of a malformed state passes the test below: `co` filled with 3, or a `cp` naming one corner
    // twice, drew as a perfectly ordinary cube (Codex audit, 2026-09-16).
    const wrong = pieceStateError(cube);
    if (wrong) throw new Error(`cube-flat: ${wrong}`);
    return toFacelets(cube);
  }
  if (!/^[URFDLB?]{54}$/.test(cube)) {
    throw new Error('cube-flat: expected a piece state or 54 facelets of URFDLB and ?');
  }
  return cube;
}

/** Below this, a net's own stickers are less than a pixel across and the drawing is empty but accepted. */
const MIN_WIDTH = 13;

/** The drawing's width in pixels, or a refusal. A width that is not a positive finite number makes an
 *  SVG with `NaN` geometry or nothing visible at all — drawn, accepted, and empty. */
function widthOf(width) {
  if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) {
    throw new Error(`cube-flat: width must be a positive number of pixels, not ${JSON.stringify(width)}`);
  }
  // AND BIG ENOUGH TO BE A DRAWING. Positive is not the same as visible: `width: 0.001` passed the check
  // above and serialised to `viewBox="0 0 0.00 0.00"` with stickers of zero size — a drawing that is
  // accepted, returned, and shows nothing (audit, 2026-09-16), which is the silent-empty-output failure
  // this file already refuses for a malformed cube. The floor is where the net's smallest sticker is still
  // a whole pixel: a net is 13 sticker-widths across, so below 13 a sticker cannot be one.
  if (width < MIN_WIDTH) {
    throw new Error(`cube-flat: width ${width} is too small to draw; ${MIN_WIDTH} is the smallest sticker that is a pixel`);
  }
  return width;
}

/** The colours a view is painted in: a palette by name, remapped for the scheme. */
function coloursFor({ palette = 'muted', scheme = 'western' } = {}) {
  if (!Object.hasOwn(STICKER_PALETTES, palette)) throw new Error(`cube-flat: no palette "${palette}"`);
  if (!isScheme(scheme)) throw new Error(`cube-flat: no scheme "${scheme}"`);
  return paletteFor(STICKER_PALETTES[palette], scheme);
}

// The radius is the rect's own, never the caller's: it is a property of the sticker, and a caller that
// could pass one is a caller that could pass a different one for two stickers of the same size.
const rect = ({ x, y, w, h, fill, facelet, free }) => `<rect data-facelet="${facelet}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" rx="${(w * CORNER).toFixed(2)}" ry="${(h * CORNER).toFixed(2)}" fill="${fill}"${free ? ' fill-opacity="0.35"' : ''} stroke="${EDGE}" stroke-width="1"/>`;

/**
 * The document every flat view is: a viewBox, a size, a label, and the stickers.
 *
 * ONE COPY. The envelope was written out in both renderers — the same numeric formatting, the same
 * `role="img"`, the same title escaping, the same join — so the accessibility of a diagram depended on
 * which function drew it, and a change to any of those rules needed finding twice (audit, 2026-09-16).
 * The title is escaped HERE and nowhere else, which is what makes "a title cannot inject markup" a
 * property of flat views rather than of two functions that currently agree.
 */
const svgOf = ({ width, height, title, parts }) => `<svg xmlns="http://www.w3.org/2000/svg" `
  + `viewBox="0 0 ${width.toFixed(2)} ${height.toFixed(2)}" width="${width.toFixed(2)}" height="${height.toFixed(2)}" `
  + `role="img" aria-label="${escapeXml(title)}">${parts.join('')}</svg>`;

/**
 * The net: every sticker of the cube unfolded, U above F, L F R B across, D below — the app's net, as SVG.
 *
 * `width` is the drawing's width in pixels (320, the app's reference, by default); every gap and radius scales
 * with it, so a thumbnail and the reference are the same picture.
 */
export function netSvg(cube, { palette, scheme, width = 320, title = 'The cube, unfolded' } = {}) {
  widthOf(width);
  const facelets = faceletsOf(cube);
  const colours = coloursFor({ palette, scheme });
  const k = width / 320;
  const faceGap = 3 * k; const stickerGap = 2 * k;
  // Twelve columns with three gaps between the four faces across, nine rows with two between three down.
  const cell = (width - 3 * faceGap) / 12;
  const height = cell * 9 + 2 * faceGap;
  const size = (cell * 3 - 2 * stickerGap) / 3;
  const parts = [];
  for (const [f, face] of [...FACE_ORDER].entries()) {
    const [row, col] = NET_AT[face];
    const ox = col * cell + (col / 3) * faceGap; const oy = row * cell + (row / 3) * faceGap;
    for (let i = 0; i < 9; i++) {
      const index = f * 9 + i;
      const letter = facelets[index];
      parts.push(rect({
        x: ox + (i % 3) * (size + stickerGap), y: oy + Math.floor(i / 3) * (size + stickerGap), w: size, h: size,
        fill: letter === '?' ? FREE : colours[letter], facelet: index, free: letter === '?',
      }));
    }
  }
  return svgOf({ width, height, title, parts });
}

/**
 * The top face as a case diagram: the Trainer's nine wells, and with `ring` the side stickers a PLL case is
 * read by. `mode: 'orientation'` lights a sticker in the top colour when it shows the colour of the top centre
 * and leaves the rest empty — an OLL case; `mode: 'colours'` paints every sticker its own colour — a PLL case.
 *
 * The cube is taken AS VIEWED: facelets 0-8 are the face on top. A lesson that shows a yellow-top case hands
 * over the cube held that way (`held` in the tests' oracle; a script's picture), not the scan frame.
 */
export function topFaceSvg(cube, { palette, scheme, width = 76, mode = 'colours', ring = false, title = 'The top face' } = {}) {
  widthOf(width);
  const facelets = faceletsOf(cube);
  if (mode !== 'colours' && mode !== 'orientation') throw new Error(`cube-flat: mode is colours or orientation, not "${mode}"`);
  const colours = coloursFor({ palette, scheme });
  const k = width / 76;
  const gap = 4 * k;
  // With a ring, the face shrinks inside a band a third of a sticker deep on every side.
  const band = ring ? (width - 2 * gap) / 3 / 3 : 0;
  const inner = width - 2 * (ring ? band + gap : 0);
  const size = (inner - 2 * gap) / 3;
  const origin = ring ? band + gap : 0;
  const top = facelets[4];
  const fillOf = (index) => {
    const letter = facelets[index];
    if (letter === '?') return { fill: FREE, free: true };
    if (mode === 'orientation') return letter === top && top !== '?' ? { fill: colours[letter], free: false } : { fill: FREE, free: true };
    return { fill: colours[letter], free: false };
  };
  const parts = [];
  for (let i = 0; i < 9; i++) {
    parts.push(rect({ x: origin + (i % 3) * (size + gap), y: origin + Math.floor(i / 3) * (size + gap), w: size, h: size, facelet: i, ...fillOf(i) }));
  }
  if (ring) {
    // THE FOUR SIDES AS DATA, then one loop. They were four hand-written lines differing only in which
    // coordinate ran along the strip and which was pinned — so the four could drift apart, and the way to
    // read them was to diff them against each other (audit, 2026-09-16). Each side now says only the two
    // things that are actually different about it: which strip of facelets it draws, and where a sticker
    // `j` of it goes. `across` is true when the strip runs left to right, which is also what decides
    // whether the rect is wide or tall.
    const along = (j) => origin + j * (size + gap);
    const far = origin + inner + gap;
    const sides = [
      { strip: TOP_RING.back, across: true, pinned: 0 },
      { strip: TOP_RING.front, across: true, pinned: far },
      { strip: TOP_RING.left, across: false, pinned: 0 },
      { strip: TOP_RING.right, across: false, pinned: far },
    ];
    for (const { strip, across, pinned } of sides) {
      for (const [j, index] of strip.entries()) {
        parts.push(rect({
          x: across ? along(j) : pinned,
          y: across ? pinned : along(j),
          w: across ? size : band,
          h: across ? band : size,
          facelet: index,
          ...fillOf(index),
        }));
      }
    }
  }
  return svgOf({ width, height: width, title, parts });
}
