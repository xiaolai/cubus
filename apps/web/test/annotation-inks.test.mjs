// What a mark on the cube is made of — `lib/annotation-inks.js`, plan item 4.2.
//
// THE DEFECT THIS EXISTS TO PREVENT, found by the owner on the Phase 4 look sheet, 2026-09-16. The turn
// arrow was drawn in the app's near-black with a light rim around it — and the cube's body is a near-black
// too, 7.6 ΔE away. So the body of the arrow disappeared into the plastic and the RIM became the figure: the
// mark read as a hollow white outline rather than as a mark. Nothing caught it, because every assertion
// about the arrow was about WHICH LAYER and WHICH WAY, and the geometry was correct the whole time.
//
// A golden cannot catch it either: a golden pins what was drawn, so it would have pinned the hollow arrow
// just as happily. What makes the choice checkable is the two things the mark must stay legible against —
// the plastic it lies over and the stickers it crosses — measured in CIELAB, against the renderer's real
// body colour and every palette the app ships.
//
// THE RULE CHANGED SHAPE when the mark stopped having a hue (owner's call, same day: white body, dark
// shadow). A single colour had to clear everything by itself, which nothing can: every hue is close to a
// sticker or close to the plastic. A PAIR only needs ONE of its parts to clear each surface — the body
// cannot clear a white sticker and the shadow cannot clear the plastic, and between them they clear both.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MARK_BODY, MARK_BODY_ALPHA, MARK_SHADOW, MARK_SHADOW_ALPHA, PLASTIC, TEXT_INK, composited,
} from '../lib/annotation-inks.js';
import { STICKER_PALETTES } from '../lib/sticker-palettes.js';

/** sRGB hex to CIELAB. D65, the usual matrix — written out because it is four lines and one import fewer. */
function lab(hex) {
  const to = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((v) => to(v / 255));
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
const deltaE = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));
const hexOf = (v) => (typeof v === 'string' ? Number.parseInt(v.replace('#', ''), 16) : v);

/** Every surface a mark is drawn across: all three palettes' stickers, and the plastic between them. */
const SURFACES = [
  ...Object.entries(STICKER_PALETTES).flatMap(([palette, faces]) =>
    Object.entries(faces).map(([face, hex]) => ({ at: `${palette}/${face}`, hex: hexOf(hex) }))),
  { at: 'the plastic', hex: PLASTIC },
];

/** A part of the mark is legible against a surface at this distance. */
const CLEAR = 25;

/**
 * How far `part`, DRAWN AT ITS OWN ALPHA, moves the surface it lies on.
 *
 * The distance that matters is between the surface and what the surface BECOMES under the part — not between
 * the surface and the part's nominal colour. An audit found the difference the hard way (2026-09-16): every
 * case here measured the nominal colours and none imported the alphas, so setting `MARK_SHADOW_ALPHA` to 0 —
 * deleting the shadow outright — passed all four. Measured this way it cannot: a part at alpha 0 composites
 * to the surface exactly, and its distance from the surface is 0.
 */
const shift = (part, alpha, surface) => deltaE(composited(part, alpha, surface), surface);

test('on every surface it crosses, at least one part of the mark stands clear — as drawn', () => {
  for (const s of SURFACES) {
    const body = shift(MARK_BODY, MARK_BODY_ALPHA, s.hex);
    const shadow = shift(MARK_SHADOW, MARK_SHADOW_ALPHA, s.hex);
    assert.ok(Math.max(body, shadow) >= CLEAR,
      `over ${s.at} the body moves it ${body.toFixed(1)} ΔE and the shadow ${shadow.toFixed(1)} — neither part reads`);
  }
});

// The alphas are half of what a mark looks like, so they are asserted to MATTER rather than merely to exist:
// at alpha 0 a part is the surface, and the rule above must go red. Written as a case and not as a comment
// because "the test would catch that" is exactly the claim that was false here an hour before it was written.
test('a part drawn at no opacity is not a part, and the measurement knows it', () => {
  for (const s of SURFACES) {
    assert.equal(shift(MARK_SHADOW, 0, s.hex), 0, `a transparent shadow still measures as visible over ${s.at}`);
    assert.equal(shift(MARK_BODY, 0, s.hex), 0, `a transparent body still measures as visible over ${s.at}`);
  }
  // And with the shadow deleted, the surfaces the body cannot carry alone are left unread — which is the
  // failure the rule exists to prevent, demonstrated rather than asserted about.
  const orphaned = SURFACES.filter((s) => Math.max(shift(MARK_BODY, MARK_BODY_ALPHA, s.hex), shift(MARK_SHADOW, 0, s.hex)) < CLEAR);
  assert.ok(orphaned.length > 0, 'with no shadow at all the mark still reads everywhere — then it has no job');
});

// The two measurements that make the PAIR necessary, kept as cases so the rule cannot be read as timid: each
// part fails somewhere on its own, and they fail in different places, which is the whole argument for having
// two. A single-colour mark would have to pass the case above alone, and nothing does.
test('neither part could do it alone, and they fail in different places', () => {
  const failsFor = (colour, alpha) => SURFACES.filter((s) => shift(colour, alpha, s.hex) < CLEAR).map((s) => s.at);
  const bodyFails = failsFor(MARK_BODY, MARK_BODY_ALPHA);
  const shadowFails = failsFor(MARK_SHADOW, MARK_SHADOW_ALPHA);
  assert.ok(bodyFails.length > 0, 'the white body clears every surface alone — the shadow would be decoration');
  assert.ok(shadowFails.length > 0, 'the dark shadow clears every surface alone — the body would be decoration');
  assert.deepEqual(bodyFails.filter((at) => shadowFails.includes(at)), [],
    'both parts fail on the same surface, so the mark is illegible there whatever else is true');
  // Named rather than left as counts: the body loses the white stickers, the shadow loses the plastic.
  assert.ok(bodyFails.every((at) => at.endsWith('/U')), `the body's collisions are ${bodyFails.join(', ')}, not the white face`);
  assert.ok(shadowFails.includes('the plastic'), 'the shadow no longer merges with the plastic, so this rule is stale');
});

test('the mark has no hue to choose, and the shadow is not the body', () => {
  const chroma = (hex) => Math.hypot(lab(hex)[1], lab(hex)[2]);
  assert.ok(chroma(MARK_BODY) < 5, `the body has a hue (chroma ${chroma(MARK_BODY).toFixed(1)}) — the point of white is that there is nothing to justify`);
  assert.ok(deltaE(MARK_BODY, MARK_SHADOW) >= 60, 'the shadow is too near the body to state its edge');
  // And it is brighter than the cube's own white sticker, or the mark and that face are one surface.
  for (const palette of Object.values(STICKER_PALETTES)) {
    assert.ok(lab(MARK_BODY)[0] > lab(hexOf(palette.U))[0] + 3, 'the body is not brighter than the white sticker');
  }
});

// A LETTER IS READ, AND READING IS A CONTRAST PROBLEM, not a distance-in-colour-space one. ΔE says two
// colours are different; it does not say a glyph in one can be read on the other, which needs luminance.
// The face letters were measured against the wrong thing until the owner said they were hard to read on
// green and blue (2026-09-16), and he was right by a margin: a near-black letter is 1.5:1 on the colorsafe
// blue, and 8 of the 18 sticker-and-palette combinations are under the 4.5:1 a reader needs.
//
// So a letter is not written on a sticker at all. It is written on a PLATE, and the plate is what it is
// measured against — which makes the number a constant instead of eighteen numbers, one per sticker.
const luminance = (hex) => {
  const f = (c) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f((hex >> 16) & 255) + 0.7152 * f((hex >> 8) & 255) + 0.0722 * f(hex & 255);
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (hi + 0.05) / (lo + 0.05);
};
/** What a reader needs of text — the bar this repository already holds its own text tokens to. */
const READABLE = 4.5;

test('a face letter is readable on its plate, which is why it has one', () => {
  const onPlate = contrast(TEXT_INK, MARK_BODY);
  assert.ok(onPlate >= READABLE, `a letter is ${onPlate.toFixed(1)}:1 on its plate`);
  // And the case for the plate, kept as a measurement so it cannot be tidied away as belt and braces: on the
  // stickers themselves the same letter fails, on many of them, and worst on blue.
  const stickers = SURFACES.filter((s) => s.at !== 'the plastic');
  const failing = stickers.filter((s) => contrast(TEXT_INK, s.hex) < READABLE);
  assert.ok(failing.length >= 6,
    `only ${failing.length} stickers fail the letter without a plate — if that is really so, the plate is unnecessary`);
  const worst = stickers.map((s) => ({ ...s, c: contrast(TEXT_INK, s.hex) })).reduce((b2, s) => (s.c < b2.c ? s : b2));
  assert.ok(worst.c < 2, `the worst sticker for a bare letter is ${worst.at} at ${worst.c.toFixed(1)}:1`);
});
