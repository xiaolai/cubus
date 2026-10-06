// The pictures that identify a generated case — plan follow-up, 2026-09-27.
//
// Two of these cases exist because a measurement was made and it was the WRONG ONE, and one exists
// because a state transform was used where a view was wanted. Both mistakes looked right on the
// screen until the screen was looked at.
import assert from 'node:assert/strict';
import test from 'node:test';

import { ALG_ENTRIES } from '../lib/alg-catalogue.js';
import { caseView, heldFacelets, pictureKind, pictureSvg, readByPicture } from '../lib/alg-picture.js';
import { TOP_RING } from '../lib/cube-flat.js';
import { turnFacelets } from '../lib/cube-orientation.js';
import { SOLVED, toFacelets } from '../lib/cube-pieces.js';
// The INDEPENDENT sticker model: written from the published facelet layout, sharing no code with the
// app, and checked against cubejs. Imported under its own names so no reader can mistake its answers
// for the app's own.
import { ROTATIONS as ORACLE_HOLDS, SOLVED_FACELETS as ORACLE_SOLVED, held as oracleHeld } from './cube-oracle.mjs';
import Cube from '../vendor/cubejs.js';

const SOLVED_FACELETS = toFacelets(SOLVED);
const move = (from, alg) => { const c = Cube.fromString(from); c.move(alg); return c.asString(); };
const generated = ALG_ENTRIES.filter(readByPicture);
const family = (prefix) => generated.filter((e) => e.id.startsWith(prefix));
/** Exactly the facelets the top diagram draws. */
const DRAWN = [...Array(9).keys(), ...TOP_RING.back, ...TOP_RING.front, ...TOP_RING.left, ...TOP_RING.right];
const solvedHeld = (hold) => heldFacelets(SOLVED_FACELETS, ...hold.split(' '));

test('turning a cube over does not repaint it', () => {
  // THE BUG THIS CAUGHT. `turnFacelets` renames the faces as well, so a last layer brought to the
  // top comes back reported as `U` — and every diagram was painted in the cross colour, white
  // squares where a learner is looking at yellow. `heldFacelets` moves the stickers and leaves
  // their colours alone, which is what an eye does.
  assert.equal(turnFacelets(SOLVED_FACELETS, 'D', 'B').slice(0, 9), 'UUUUUUUUU', 'precondition: the state transform renames');
  assert.equal(heldFacelets(SOLVED_FACELETS, 'D', 'B').slice(0, 9), 'DDDDDDDDD', 'the held view repainted the cube');
});

test('heldFacelets matches an independent sticker model, on an asymmetric cube, in all 24 holds', () => {
  // WHAT THIS REPLACED, and why it is worth saying: the case above used to end by declaring a
  // scrambled fixture, never passing it to `heldFacelets`, and asserting that two strings were 54
  // characters long. It claimed "the stickers land in the same places" and checked nothing of the
  // kind. Worse, the below-the-top-layer measurement in the next case derives its baseline through
  // `heldFacelets` too, so nothing in this file compared the transform against anything else.
  //
  // `test/cube-oracle.mjs` is that something else: a sticker model written from the published
  // facelet layout and plain slab rotations, sharing no code with the app, and checked against
  // cubejs on every move cubejs knows. Its `held()` answers the same question this does.
  const asym = move(ORACLE_SOLVED, "R U R' F2 D L' B");
  assert.notEqual(asym, ORACLE_SOLVED, 'precondition: the fixture must not be symmetric under a hold');
  let checked = 0;
  for (const hold of Object.keys(ORACLE_HOLDS)) {
    const [up, front] = hold.split(' ');
    assert.equal(heldFacelets(asym, up, front), oracleHeld(asym, hold), `hold ${hold}`);
    checked += 1;
  }
  assert.equal(checked, 24, 'the oracle stopped offering 24 holds');
  // And the identity hold changes nothing, which no permutation check can imply on its own.
  assert.equal(heldFacelets(asym, 'U', 'F'), asym);
});

test('a last-layer case is WHOLLY in the picture; an F2L case is not', () => {
  // The measurement that decides which picture a case gets. The first version measured whether
  // pictures were DISTINCT — all 115 are — and distinct is not readable: an F2L algorithm's
  // inverse takes a pair out AND leaves the last layer anywhere, so a top diagram of one shows a
  // colour jumble that looks like a case.
  const below = (e) => {
    const view = caseView(e);
    const solved = solvedHeld(e.hold);
    let n = 0;
    for (let i = 0; i < 54; i += 1) if (!DRAWN.includes(i) && view[i] !== solved[i]) n += 1;
    return n;
  };
  for (const e of [...family('oll:'), ...family('pll:')]) {
    assert.equal(below(e), 0, `${e.id}: a last-layer case disturbs something the top diagram cannot show`);
  }
  const f2l = family('f2l:').map(below);
  assert.ok(Math.min(...f2l) >= 1, 'an F2L case now fits in a top diagram — re-read pictureKind');
  assert.equal(family('f2l:').length, 40);
});

test('the picture a case gets follows that measurement', () => {
  for (const e of generated) {
    const wanted = e.id.startsWith('f2l:') ? 'net' : 'top';
    assert.equal(pictureKind(e), wanted, `${e.id}: drawn by the wrong kind of picture`);
  }
  for (const e of ALG_ENTRIES.filter((x) => !readByPicture(x))) {
    assert.equal(pictureKind(e), 'none', `${e.id} has a name and does not need a picture`);
  }
});

test('no two generated cases share a DRAWN picture', () => {
  // Not sufficient on its own — see above — but still necessary: a picture two cases share
  // identifies neither.
  //
  // COMPARED AS DRAWN, not as facelets. This used to key on the raw colours at the drawn indices,
  // and an OLL diagram does not draw its colours: it draws the top layer as oriented-or-not, so two
  // cases whose facelets differ can render the same picture and the facelet key would separate them
  // anyway. The rendered SVG is what a learner actually tells apart, so it is what is compared —
  // minus `aria-label`, which carries the effect SENTENCE and would make every picture unique by
  // describing it (found by audit, 2026-09-28; no collision exists today, the check was just
  // measuring the wrong thing).
  const drawn = (e) => pictureSvg(e, { palette: 'muted', scheme: 'western' })
    .replace(/ aria-label="[^"]*"/g, '');
  const seen = new Map();
  for (const e of generated) {
    const key = `${pictureKind(e)}:${drawn(e)}`;
    seen.set(key, [...(seen.get(key) ?? []), e.id]);
  }
  const shared = [...seen.values()].filter((v) => v.length > 1);
  assert.deepEqual(shared, [], 'two cases are drawn the same');
  // The label really is what was hiding behind the old key — without stripping it nothing can ever
  // collide, so the assertion above would hold whatever the pictures looked like.
  const withLabel = new Set(generated.map((e) => pictureSvg(e, { palette: 'muted', scheme: 'western' })));
  assert.equal(withLabel.size, generated.length, 'the labels stopped being unique; the strip above is now load-bearing differently');
});

test('every generated case draws, and a named one draws nothing', () => {
  for (const e of generated) {
    const svg = pictureSvg(e, { palette: 'muted', scheme: 'western' });
    assert.match(svg, /^<svg/, `${e.id}: no picture`);
    assert.ok((svg.match(/<rect/g) ?? []).length >= 21, `${e.id}: the picture is missing stickers`);
  }
  const named = ALG_ENTRIES.find((e) => e.id === 'sune');
  assert.equal(pictureSvg(named, { palette: 'muted', scheme: 'western' }), '');
});

test('an OLL diagram lights the last layer, not the cross colour', () => {
  // The visible half of the repaint bug: the lit squares must be the colour on top when the cube is
  // held as the card says, which for a tumbled stage is NOT white.
  const oll = family('oll:')[0];
  const view = caseView(oll);
  assert.equal(view[4], 'D', 'the top centre is not the last layer — the view is in the wrong hold');
  const svg = pictureSvg(oll, { palette: 'muted', scheme: 'western' });
  const white = pictureSvg({ ...oll, hold: 'U F' }, { palette: 'muted', scheme: 'western' });
  assert.notEqual(svg, white, 'the diagram does not depend on the hold at all');
});
