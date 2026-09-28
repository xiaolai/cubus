// The picture that identifies a generated case, and the words that say what is out of place in it.
//
// The 119 generated cases have no names and never will: `oll:02220000` is this repository's key for
// a position, not a number a learner would find anywhere else, and showing our own as if it were
// the world's would be worse than showing none (`case-tables.js` says so where the keys are
// written). So a list of them was a wall of notation with nothing to recognise — which is how
// OLL and PLL are actually read everywhere else: by PICTURE.
//
// TWO MEASUREMENTS, AND THE FIRST ONE WAS THE WRONG PROPERTY. Over the exact facelets
// `cube-flat.js` draws, all 115 generated cases have a DISTINCT top-face picture — no two share
// one, in any family. That looked like a green light and is not: distinct is not readable. The
// question a diagram has to answer is whether the case is ENTIRELY in what it draws, and measured
// that way the families split —
//
//     OLL   54 cases    0 stickers disturbed below the top layer
//     PLL   21 cases    0
//     F2L   40 cases    2 to 5
//
// — because an F2L algorithm's inverse takes a pair out AND leaves the last layer anywhere, so a
// top-face diagram of one shows a colour jumble that looks like a case and is not. A picture that
// appears to show the case and does not is worse than no picture. So the top diagram is for the
// last layer, where it is complete, and an F2L case gets the whole net, where everything it
// disturbs is visible. `alg-picture.test.mjs` re-runs both measurements.
//
// The cube is drawn AS THE CHILD HOLDS IT. `entry.setup` is the case in the cube's own frame, where
// a last layer sits on D; `topFaceSvg` draws whatever is on top. Turning the state into the entry's
// hold first is what makes the picture the one in front of them, and it is the same hold the card
// names in words two lines above it.
import { netSvg, topFaceSvg } from './cube-flat.js';
import { orientationPerm } from './cube-orientation.js';
import { describeCase } from './alg-effect.js';

/** How big a picture is in the list, and in the detail panel. The list's is a glance; the detail's
 *  is the one you read a case off. */
export const LIST_PICTURE = 46;
export const DETAIL_PICTURE = 96;

/**
 * `facelets` as SEEN when the cube is held with `up` up and `front` facing you — the stickers move
 * and keep their colours.
 *
 * THE OTHER HALF OF `turnFacelets`, AND NOT INTERCHANGEABLE WITH IT. That one renames the letters
 * as well, so a solved cube comes back solved and the result is a valid state in the new frame;
 * this one does not, so the result is what the EYE sees. Turning a cube over does not repaint it:
 * hold a solved cube white-down and the face on top is yellow, which `turnFacelets` reports as `U`
 * (white) because it has renamed the frame, and this reports as `D` (yellow) because that is the
 * sticker being looked at. A picture wants this one; a state wants that one. Using the state
 * transform for a picture painted every last-layer diagram in the cross colour (2026-09-27).
 *
 * IT LIVES HERE RATHER THAN BESIDE ITS COUNTERPART, and not by preference. `lib/cube-orientation.js`
 * is a SOURCE OF THE `cubus-cube` BUNDLE, and `vendor-bundles.test.mjs` requires every declaration
 * in those sources to survive into the built bundle — an export the renderer does not import is
 * tree-shaken away and fails that check. So a helper only the app uses cannot sit there, however
 * well it reads next to `turnFacelets`.
 */
export function heldFacelets(facelets, up, front) {
  const fl = String(facelets);
  if (fl.length !== 54) throw new Error(`alg-picture: expected 54 facelets, got ${fl.length}`);
  const perm = orientationPerm(up, front);
  return Array.from({ length: 54 }, (_, i) => fl[perm[i]]).join('');
}

/**
 * The case this algorithm answers, as the child SEES it.
 *
 * `heldFacelets`, never `turnFacelets`: the second renames the faces as well, so a last layer held
 * on top comes back reported as `U` and every diagram was painted in the cross colour — white
 * squares where a learner is looking at yellow. Turning a cube over does not repaint it.
 */
export const caseView = (entry) => {
  const [up, front] = String(entry.hold).split(' ');
  return heldFacelets(entry.setup, up, front);
};

/**
 * Which diagram a case is read by.
 *
 * `orientation` for the top-face dial, where the question is which stickers already show the top
 * colour and a full-colour picture would drown that in information nobody is using. `colours`
 * everywhere else: a permutation case is read by WHICH colour sits where, and so is a pair.
 */
export const pictureMode = (entry) => (entry.dial === 'oll' ? 'orientation' : 'colours');

/**
 * The case as an SVG diagram: the top face, and the ring of side stickers a case is read by.
 *
 * The ring is not decoration. A top face alone cannot tell a PLL from its mirror, and it was added
 * to `cube-flat.js` for exactly this picture; the uniqueness measured above is over the face AND
 * the ring, so dropping it would break the property this module promises.
 */
export function caseSvg(entry, { palette, scheme, width = LIST_PICTURE } = {}) {
  return topFaceSvg(caseView(entry), {
    palette,
    scheme,
    width,
    mode: pictureMode(entry),
    ring: true,
    title: caseTitle(entry),
  });
}

/**
 * What the picture shows, in words — the diagram's own title, and the line a screen reader gets.
 *
 * Said for the last-layer dials only. `describeCase` is accurate for every entry, but on an F2L
 * case it reports the whole cube's permutation — "two corners are swapped, four edges are in the
 * wrong places, two corners are turned the wrong way and two edges are flipped" — which is true and
 * is not how anybody reads a pair. There the picture is the identification and a sentence about the
 * whole cube would be noise beside it, the same judgement the detail panel already makes about the
 * effect line.
 */
export function caseTitle(entry) {
  // `caseView(entry) &&` used to guard this: it cannot be falsy — the conversion returns 54
  // characters or throws — so the guard read as a fallback that no input could reach, while
  // building a whole facelet string only to discard it.
  return lastLayer(entry) ? describeCase(entry.effect, entry.id) : GENERIC_TITLE;
}

/** Whether this entry is read by a picture rather than by a name. */
export const readByPicture = (entry) => /^(?:oll|pll|f2l):/.test(entry.id);

/**
 * Whether this entry's case lives wholly in the last layer.
 *
 * ONE statement of it. It was written three times — twice in this file (the title and the diagram
 * kind) and again as `lastLayer` in `screens/drill/library.js`, which decides what the page SAYS.
 * Three copies of one classification is how a diagram comes to disagree with the sentence beside
 * it. It lives here rather than in the screen because the classification is about the picture, and
 * a library module may not import a screen's.
 */
export const lastLayer = (entry) => entry.dial === 'oll' || entry.dial === 'pll';

/** Said of any case a diagram identifies rather than a name. One string, two drawings. */
export const GENERIC_TITLE = 'The case this algorithm answers';

/**
 * Which picture reads this case, if any.
 *
 * `top` where the case is wholly in the top layer and the diagram is therefore complete — measured,
 * not assumed. `net` for an F2L case, which disturbs two to five stickers below the top layer that
 * a top diagram would silently omit. `none` for a named algorithm, which is found by its name.
 */
export function pictureKind(entry) {
  if (!readByPicture(entry)) return 'none';
  return lastLayer(entry) ? 'top' : 'net';
}

/** The case drawn the way `pictureKind` says it must be. */
export function pictureSvg(entry, { palette, scheme, width = LIST_PICTURE } = {}) {
  const kind = pictureKind(entry);
  if (kind === 'none') return '';
  if (kind === 'net') {
    return netSvg(caseView(entry), { palette, scheme, width: width * 2, title: GENERIC_TITLE });
  }
  return caseSvg(entry, { palette, scheme, width });
}
