// The app's copy of the colour-scheme table, held to the scanner's, and the two conversions the
// app is allowed to make between a colour and a position (ADR 0001).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  classColour,
  COLOUR_NAMES,
  colourOf,
  cubeDependentPairs,
  colourOfSlot,
  isScheme,
  lintColourPairs,
  paletteFor,
  positionColour,
  positionOf,
  POSITIONS,
  SCHEME_COLOURS,
  SCHEMES,
  slotAt,
  slotOf,
  unsafeColourPairs,
} from '../lib/scheme.js';
import { readAppSource } from './app-source.mjs';
import { STICKER_PALETTES } from '../lib/sticker-palettes.js';

const scannerSource = readFileSync(
  new URL('../../../packages/cube-scanner/src/scheme.ts', import.meta.url),
  'utf8',
);

/** The positional palettes: one table, which the renderer and the app's nets both paint from. */
const rendererPalettes = STICKER_PALETTES;

test('the sticker colours are written once: neither the renderer nor the app carries a copy', () => {
  const renderer = readFileSync(new URL('../../../packages/cubus-cube/src/cubus-cube.js', import.meta.url), 'utf8');
  assert.match(renderer, /import \{ STICKER_PALETTES \} from '\.\.\/\.\.\/\.\.\/apps\/web\/lib\/sticker-palettes\.js';/,
    'the renderer no longer paints from the shared table');
  const app = readAppSource();
  for (const [name, palette] of Object.entries(STICKER_PALETTES)) {
    for (const hex of Object.values(palette)) {
      assert.ok(!renderer.includes(hex), `the renderer carries its own copy of ${name}'s ${hex}`);
      assert.ok(!app.includes(hex), `the app carries its own copy of ${name}'s ${hex}`);
    }
  }
});

test('the app’s scheme table is the scanner’s, entry for entry', () => {
  // The TypeScript source is the ONE table; this file carries a copy because app.js cannot
  // import it. Read the copy's source of truth back out of the .ts rather than trusting a hand
  // transcription — the same pin the scan screen's FACE_EDGES copy has in scan-screen.test.mjs.
  for (const scheme of SCHEMES) {
    const m = scannerSource.match(new RegExp(`${scheme}: Object\\.freeze\\(\\{([^}]*)\\}`));
    assert.ok(m, `packages/cube-scanner/src/scheme.ts declares no ${scheme} row`);
    const theirs = Object.fromEntries([...m[1].matchAll(/([URFDLB]):\s*(\d)/g)].map((x) => [x[1], Number(x[2])]));
    assert.deepEqual(theirs, { ...SCHEME_COLOURS[scheme] }, `${scheme} row drifted from the scanner`);
  }
  // And the scanner's list of schemes is this list, in this order.
  assert.match(scannerSource, /SCHEMES: readonly Scheme\[\] = \['western', 'japanese'\]/);
});

test('each scheme is a bijection; only D and B differ; the slot convention is Western', () => {
  for (const scheme of SCHEMES) {
    assert.deepEqual([...POSITIONS.map((p) => colourOf(p, scheme))].sort(), [0, 1, 2, 3, 4, 5]);
    for (let c = 0; c < 6; c++) assert.equal(colourOf(positionOf(c, scheme), scheme), c);
  }
  for (const p of ['U', 'F', 'R', 'L']) assert.equal(colourOf(p, 'western'), colourOf(p, 'japanese'));
  assert.equal(colourOf('D', 'western'), 3); // yellow under white
  assert.equal(colourOf('D', 'japanese'), 5); // blue under white
  for (let c = 0; c < 6; c++) {
    assert.equal(slotOf(c), POSITIONS[c]);
    assert.equal(colourOfSlot(slotOf(c)), c);
    assert.equal(positionOf(c, 'western'), slotOf(c));
  }
  assert.equal(slotAt('D', 'japanese'), 'B'); // the Down tile of a Japanese cube shows the blue capture
  assert.equal(slotAt('B', 'japanese'), 'D');
  assert.equal(slotAt('D', 'western'), 'D');
  assert.deepEqual(COLOUR_NAMES, ['white', 'red', 'green', 'yellow', 'orange', 'blue']);
  assert.equal(isScheme('japanese'), true);
  for (const bad of ['Japanese', 'boy', '', null, undefined, 3]) assert.equal(isScheme(bad), false);
  assert.throws(() => colourOf('D', 'mirror'), /unknown|no colour/);
  assert.throws(() => positionOf(7, 'western'), /paints no position/);
});

test('a positional palette remapped for Japanese moves exactly the D and B hexes', () => {
  for (const [name, palette] of Object.entries(rendererPalettes)) {
    assert.deepEqual(Object.keys(palette).sort(), [...POSITIONS].sort(), `${name} is not keyed by position`);
    const western = paletteFor(palette, 'western');
    const japanese = paletteFor(palette, 'japanese');
    assert.deepEqual(western, palette, `${name}: the Western remap must be the identity`);
    for (const p of ['U', 'F', 'R', 'L']) assert.equal(japanese[p], palette[p]);
    assert.equal(japanese.D, palette.B, `${name}: blue under white`);
    assert.equal(japanese.B, palette.D, `${name}: yellow at the back`);
    // The six hexes are the SAME SET — a remap never invents a colour (§2 of the design note).
    assert.deepEqual(Object.values(japanese).sort(), Object.values(palette).sort());
  }
});

test('a colour CLASS has one hex whatever the scheme; a POSITION has one per scheme', () => {
  const palette = rendererPalettes.muted;
  // Class 3 is yellow. Painted as a class it is the yellow hex on every cube; painted as the
  // position D it is yellow on a Western cube and blue on a Japanese one. Conflating the two was
  // the bug the refute pass found in the scan screen (a class painted through the positional
  // palette would draw yellow as blue under a Japanese remap).
  assert.equal(classColour(palette, 3), palette.D);
  assert.equal(classColour(palette, 5), palette.B);
  assert.equal(positionColour(palette, 'D', 'western'), palette.D);
  assert.equal(positionColour(palette, 'D', 'japanese'), palette.B);
  assert.equal(positionColour(palette, 'B', 'japanese'), palette.D);
  for (let c = 0; c < 6; c++) {
    for (const scheme of SCHEMES) {
      assert.equal(classColour(palette, c), positionColour(palette, positionOf(c, scheme), scheme));
    }
  }
});

test('the chirality flips at DBL between the schemes', () => {
  // Western reads blue → orange → yellow clockwise around the DBL corner (the definition of BOY);
  // Japanese reads the same three colours in the reversed cyclic order. A renderer assertion that
  // reuses the Western order for a Japanese cube is wrong, not merely stale.
  const dbl = (scheme) => ['B', 'L', 'D'].map((p) => colourOf(p, scheme));
  assert.deepEqual(dbl('western'), [5, 4, 3]);
  assert.deepEqual(dbl('japanese'), [3, 4, 5]);
});

test('the unsafe colour pairs are every pair opposite on ANY cube — four that differ, plus red–orange', () => {
  assert.deepEqual(unsafeColourPairs(), [
    [0, 3], // white–yellow: an edge on a Japanese cube, opposite on a Western one
    [0, 5], // white–blue: the other way round
    [1, 4], // red–orange: opposite on both
    [2, 3], // green–yellow
    [2, 5], // green–blue
  ]);
});

test('the lesson lint names a piece by two colours only where the prose does', () => {
  // The pairs the lint minds are the ones that are a piece on one cube and nothing on the other;
  // red–orange is opposite on both, so no sentence naming it can mean a piece and it is left out.
  assert.deepEqual(cubeDependentPairs(), [[0, 3], [0, 5], [2, 3], [2, 5]]);
  // The line the design note found already shipped: on a Japanese cube that piece does not exist.
  const shipped = 'One is already home. White and blue, sitting between the white centre and the blue centre.';
  assert.deepEqual(lintColourPairs(shipped).map((f) => f.pair), [['white', 'blue']]);
  // Every joiner a writer would use, in either order.
  for (const s of ['the blue-white edge', 'a yellow–green edge', 'the green/blue piece', 'yellow and green', 'the white yellow edge']) {
    assert.equal(lintColourPairs(s).length, 1, s);
  }
  // Pairs that exist on both cubes are fine, and a LIST of colours is not a piece.
  for (const s of [
    'white and green',
    'the red-white edge',
    'white, green, red and orange',
    'white, yellow and green',
    'Find the white centre, then the blue centre.',
    'blue on one side and yellow on the other side',
  ]) {
    assert.deepEqual(lintColourPairs(s), [], s);
  }
  // A comma before the piece is not a list unless what precedes it is a COLOUR: refusing every
  // comma swallowed a real piece naming.
  assert.deepEqual(lintColourPairs('Next, white and blue form an edge.').map((f) => f.pair), [
    ['white', 'blue'],
  ]);
  // A corner is three colours, so it is three pairs — and the unsafe one is not the first.
  assert.deepEqual(lintColourPairs('Find the red-white-blue corner.').map((f) => f.pair), [
    ['white', 'blue'],
  ]);
  // …and a corner that exists on both cubes stays quiet.
  assert.deepEqual(lintColourPairs('Find the red-white-green corner.'), []);
  // Sentences are reported so an author can find the line.
  assert.equal(lintColourPairs(shipped)[0].sentence, 'White and blue, sitting between the white centre and the blue centre.');
});

test('the renderer remaps the same two positions this module does', () => {
  // `cubus-cube.js` carries its own one-line arithmetic — it is bundled as the renderer and
  // depends on nothing in the app — so the two must be held equal or they can come to disagree
  // about what Japanese means. Read out of the renderer's source, not imported: importing it
  // would pull in three.js and a WebGL context to check a table.
  const src = readFileSync(new URL('../../../packages/cubus-cube/src/cubus-cube.js', import.meta.url), 'utf8');
  const m = src.match(/const SWAPPED = \{([^}]*)\}/);
  assert.ok(m, 'the renderer no longer declares SWAPPED as a literal');
  const swapped = Object.fromEntries([...m[1].matchAll(/([URFDLB]):\s*'([URFDLB])'/g)].map((x) => [x[1], x[2]]));
  // What the renderer does to a palette, expressed as this module's own remap.
  for (const position of POSITIONS) {
    const mine = slotAt(position, 'japanese'); // the Western name of the colour Japanese puts here
    assert.equal(swapped[position], mine, `${position} must read the same entry in both`);
  }
  // And the one fact underneath: only D and B move.
  assert.deepEqual(
    POSITIONS.filter((p) => swapped[p] !== p).sort(),
    ['B', 'D'],
  );
});
