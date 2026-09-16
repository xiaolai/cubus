// Many cubes on one page: live `<cubus-cube>`s while the browser can hold them, flat diagrams past that.
//
// dev-docs/tutorial-capability-plan.md item 4.6. The plan left the answer to the corpus — "a shared context for
// N viewports, or the flat view as the gallery fallback" — and the corpus answers it. The galleries a tutorial
// needs are the 57 OLL and 21 PLL cases, and both WebKit and Chromium keep 16 live WebGL contexts on a page and
// lose the oldest past that (measured in `test/browser/cube-gallery.test.mjs`, which re-measures on every run).
// A gallery of 57 cannot be 57 cubes; cubus-im's chart at 16 contexts is already one over once the app's own
// parked cube is on the page. And a gallery of cases is a gallery of PICTURES — nothing in one turns — which a
// flat view draws exactly, with no context at all (`lib/cube-flat.js`).
//
// A SHARED CONTEXT drawing N viewports is the other answer, and is not built: it is a rewrite of how the
// element owns its renderer, for a gallery that animates, and no scenario in the corpus asks for one. It is
// the thing to build the day one does.
import { SOLVED, applyAlg, invert } from './cube-pieces.js';
import { topFaceSvg } from './cube-flat.js';

/** Live WebGL contexts a page keeps before the browser loses the oldest, in WebKit and in Chromium. */
export const CONTEXT_CAP = 16;

/**
 * Live cubes a gallery may put on a page: the cap, less the app's own parked cube, less a margin for anything
 * else on the page that draws with WebGL. A gallery past this is drawn flat.
 */
export const LIVE_BUDGET = 12;

/** How a gallery of `count` cubes is drawn: `cubes` while live ones fit, `flat` past that. */
export function galleryKind(count, { budget = LIVE_BUDGET } = {}) {
  if (!Number.isInteger(count) || count < 0) throw new Error(`cube-gallery: a gallery has a whole number of cubes, not ${count}`);
  if (!Number.isInteger(budget) || budget < 0 || budget >= CONTEXT_CAP) {
    throw new Error(`cube-gallery: a budget is under the ${CONTEXT_CAP} live contexts a page keeps, not ${budget}`);
  }
  return count <= budget ? 'cubes' : 'flat';
}

/**
 * A case table as diagrams: each case's cube — the position its algorithm solves — drawn as its top face.
 *
 * `cases` are `{ name, alg }`, the shape of `lib/data/case-tables.js`. OLL cases read by orientation and PLL by
 * colour, with the ring of side stickers PLL is recognised by; `mode` and `ring` say which.
 */
export function flatGallery(cases, { mode = 'orientation', ring = false, palette, scheme, width = 76 } = {}) {
  return cases.map(({ name, alg }) => {
    const cube = applyAlg(SOLVED, invert(alg));
    return Object.freeze({ name, svg: topFaceSvg(cube, { mode, ring, palette, scheme, width, title: name }) });
  });
}
