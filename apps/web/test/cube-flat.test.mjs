// Flat views drawn from the model — plan item 4.5 of dev-docs/tutorial-capability-plan.md.
//
// A flat view is only as good as its facelet tables, and a table typed out once is a table with a typo in it:
// every index here is checked against `test/cube-oracle.mjs`'s layout, which shares no code with this module.
// The colours come from the renderer's own palette table through the scheme remap, and are checked that way.
import assert from 'node:assert/strict';
import test from 'node:test';

import { EDGE, FREE, TOP_RING, faceletsOf, netSvg, topFaceSvg } from '../lib/cube-flat.js';
import { SOLVED, applyAlg } from '../lib/cube-pieces.js';
import { STICKER_PALETTES } from '../lib/sticker-palettes.js';
import { paletteFor } from '../lib/scheme.js';
import { SOLVED_FACELETS, faceletAt } from './cube-oracle.mjs';

/** Every `<rect>` of an SVG: its facelet, its fill, whether it is drawn as an empty well, and its box. */
const rects = (svg) => [...svg.matchAll(/<rect data-facelet="(\d+)" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="[\d.]+" fill="([^"]+)"( fill-opacity="0.35")?/g)]
  .map(([, facelet, x, y, w, h, fill, free]) => ({ facelet: Number(facelet), x: Number(x), y: Number(y), w: Number(w), h: Number(h), fill, free: !!free }));

test('the top face and its ring are the facelets the oracle puts there, in the order a diagram reads them', () => {
  for (let i = 0; i < 9; i++) {
    assert.equal(faceletAt([(i % 3) - 1, 1, Math.floor(i / 3) - 1], [0, 1, 0]), i, `top sticker ${i}`);
  }
  const along = [-1, 0, 1];
  assert.deepEqual([...TOP_RING.back], along.map((x) => faceletAt([x, 1, -1], [0, 0, -1])), 'the back strip, left to right from above');
  assert.deepEqual([...TOP_RING.front], along.map((x) => faceletAt([x, 1, 1], [0, 0, 1])), 'the front strip, left to right');
  assert.deepEqual([...TOP_RING.left], along.map((z) => faceletAt([-1, 1, z], [-1, 0, 0])), 'the left strip, top to bottom');
  assert.deepEqual([...TOP_RING.right], along.map((z) => faceletAt([1, 1, z], [1, 0, 0])), 'the right strip, top to bottom');
});

test('the net paints every sticker its colour, in its face\'s block, and an unclaimed one as an empty well', () => {
  const cube = applyAlg(SOLVED, "R U R' U'");
  const facelets = faceletsOf(cube);
  const colours = paletteFor(STICKER_PALETTES.muted, 'western');
  const drawn = rects(netSvg(cube));
  assert.equal(drawn.length, 54);
  for (const r of drawn) assert.equal(r.fill, colours[facelets[r.facelet]], `facelet ${r.facelet}`);
  assert.equal(drawn.filter((r) => r.free).length, 0);
  // Every face's nine stickers sit inside its own block of the 12 by 9 grid, U above F, D below.
  const block = (from) => drawn.filter((r) => r.facelet >= from && r.facelet < from + 9);
  const xs = (rs) => [Math.min(...rs.map((r) => r.x)), Math.max(...rs.map((r) => r.x + r.w))];
  const ys = (rs) => [Math.min(...rs.map((r) => r.y)), Math.max(...rs.map((r) => r.y + r.h))];
  assert.deepEqual(xs(block(0)), xs(block(18)), 'U is not above F');
  assert.deepEqual(xs(block(27)), xs(block(18)), 'D is not below F');
  assert.ok(ys(block(0))[1] < ys(block(18))[0] && ys(block(18))[1] < ys(block(27))[0], 'U, F and D are not stacked');
  assert.ok(xs(block(36))[1] < xs(block(18))[0] && xs(block(18))[1] < xs(block(9))[0] && xs(block(9))[1] < xs(block(45))[0], 'L F R B are not in a row');
  // A picture's unknowns are wells, never a colour.
  const picture = `${'U'.repeat(9)}${'?'.repeat(45)}`;
  const wells = rects(netSvg(picture)).filter((r) => r.free);
  assert.equal(wells.length, 45);
  assert.ok(wells.every((r) => r.fill === FREE));
  assert.match(netSvg(SOLVED), new RegExp(`stroke="${EDGE.replace(/[().]/g, '\\$&')}"`));
});

test('a scheme moves only D and B, and every other colour stays', () => {
  const western = rects(netSvg(SOLVED_FACELETS, { scheme: 'western' }));
  const japanese = rects(netSvg(SOLVED_FACELETS, { scheme: 'japanese' }));
  const moved = western.filter((r, i) => r.fill !== japanese[i].fill).map((r) => SOLVED_FACELETS[r.facelet]);
  assert.deepEqual([...new Set(moved)].sort(), ['B', 'D']);
});

test('the case diagram: orientation lights what shows the top colour, and the ring carries the sides', () => {
  const solved = rects(topFaceSvg(SOLVED, { mode: 'orientation' }));
  assert.equal(solved.length, 9);
  assert.equal(solved.filter((r) => !r.free).length, 9, 'a solved top face is all lit');
  const turned = rects(topFaceSvg(applyAlg(SOLVED, 'R'), { mode: 'orientation' }));
  assert.equal(turned.filter((r) => !r.free).length, 6, 'after R, the right column of the top shows F and is not lit');
  const ringed = rects(topFaceSvg(applyAlg(SOLVED, "R U R' U'"), { ring: true }));
  assert.deepEqual(ringed.map((r) => r.facelet).sort((a, b) => a - b),
    [...Array(9).keys(), ...TOP_RING.back, ...TOP_RING.front, ...TOP_RING.left, ...TOP_RING.right].sort((a, b) => a - b));
  // A stage target's top is mostly unclaimed: its unknowns are wells in either mode, never a colour.
  const target = `UUUU?UUUU${'?'.repeat(45)}`;
  for (const mode of ['colours', 'orientation']) {
    const unknown = rects(topFaceSvg(target, { mode, ring: true })).filter((r) => target[r.facelet] === '?');
    assert.equal(unknown.length, 13, 'precondition: the centre and the whole ring are unknown');
    assert.ok(unknown.every((r) => r.free && r.fill === FREE), `${mode}: an unknown sticker was painted a colour`);
  }
  // Nothing drawn outside the picture, and the ring outside the face.
  assert.ok(ringed.every((r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= 76.01 && r.y + r.h <= 76.01), 'a sticker was drawn off the diagram');
  const face = ringed.filter((r) => r.facelet < 9);
  const back = ringed.filter((r) => TOP_RING.back.includes(r.facelet));
  assert.ok(back.every((r) => r.y + r.h <= Math.min(...face.map((f) => f.y))), 'the back strip overlaps the face');
});

test('bad input is refused, and a title is escaped', () => {
  assert.throws(() => netSvg('UUU'), /expected a piece state or 54 facelets/);
  assert.throws(() => netSvg(SOLVED, { palette: 'neon' }), /no palette "neon"/);
  assert.throws(() => netSvg(SOLVED, { scheme: 'mirror' }), /no scheme "mirror"/);
  assert.throws(() => topFaceSvg(SOLVED, { mode: 'fancy' }), /mode is colours or orientation/);
  assert.match(netSvg(SOLVED, { title: '<script>"&' }), /aria-label="&lt;script&gt;&quot;&amp;"/);
  assert.doesNotMatch(netSvg(SOLVED, { title: '<script>' }), /<script>/);
});

// Found by a Codex audit, 2026-09-16. Both halves are the same mistake in different places: something is
// drawn first and questioned afterwards, or not questioned at all.
test('a malformed cube and an impossible width are refused before anything is drawn', () => {
  // A state was converted and then the STRING was checked, which a malformed state passes: an out-of-range
  // twist and a permutation naming one corner twice both drew as an ordinary cube.
  assert.throws(() => netSvg({ ...SOLVED, co: [3, 0, 0, 0, 0, 0, 0, 0] }), /whole numbers 0 to 2/);
  assert.throws(() => netSvg({ ...SOLVED, cp: [0, 0, 2, 3, 4, 5, 6, 7] }), /names one cubie twice/);
  assert.throws(() => netSvg({ ...SOLVED, eo: [] }), /array of 12/);
  assert.throws(() => topFaceSvg({ ...SOLVED, co: [0, 0, 0, 0, 0, 0, 0, 9] }), /whole numbers 0 to 2/);
  // And a width that is not a positive number made an SVG of `NaN` geometry, or one no pixel wide, and
  // said nothing about it.
  for (const width of [0, -320, Number.NaN, Number.POSITIVE_INFINITY, '320', null]) {
    assert.throws(() => netSvg(SOLVED, { width }), /positive number of pixels/, `netSvg accepted ${String(width)}`);
    assert.throws(() => topFaceSvg(SOLVED, { width }), /positive number of pixels/, `topFaceSvg accepted ${String(width)}`);
  }
  // The ordinary cases still draw.
  assert.match(netSvg(SOLVED, { width: 64 }), /^<svg /);
  assert.match(topFaceSvg(SOLVED), /^<svg /);
});
