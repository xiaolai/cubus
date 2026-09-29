// HOW FAST A TURN IS DRAWN, and the rule that it is drawn that way on every cube.
//
// `tempo-scale` was defined in `lib/screens/cube/speed-menu.js` and written to that screen's cube
// alone, so every other cube the app draws animated at the renderer's own 190ms base: measured
// 2026-09-30 on the Drill page at 200ms per quarter turn against 1620ms for the same turn at
// Normal. A fifth of a second reads as a snap, which is what "the drills have no animation" meant.
//
// THE SHAPE HAD ALREADY SHIPPED ONCE. Ghost faces and the camera were the cube screen's alone too —
// "which is why both drill screens came out with no ghost faces at all" (`lib/screens/cube.js`) —
// and `applyCubeView` was written to end exactly that. The tempo was left out of it. So the cases
// below are about the RELATION (one table, applied by the one function that draws them all) rather
// than about any single screen, because a list of screens is what goes stale next time.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const store = new Map();
globalThis.localStorage ??= {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { WALK_SPEEDS, DEFAULT_WALK_SPEED, WALK_SPEED_KEY, tempoFor } = await import('../lib/cube-view.js');
const { applyCubeView } = await import('../lib/cube-drawing.js');

/** Just enough element to record what was written to it. */
const fakeCube = () => {
  const attrs = new Map();
  return { attrs, setAttribute: (k, v) => attrs.set(k, String(v)), getAttribute: (k) => attrs.get(k) ?? null };
};

const RENDERER_BASE_MS = 190;
/** What a quarter turn takes at a tempo — the renderer divides its base by the scale. */
const turnMs = (tempo) => RENDERER_BASE_MS / tempo;

test('every shipped speed is slower than the renderer\'s bare default', () => {
  // The default is 1, which is 190ms. The complaint that produced the menu was about 760ms being
  // too FAST, so a speed at or above the bare default is not a speed anybody asked for.
  assert.ok(WALK_SPEEDS.length >= 3, 'the speed table is empty or nearly so, so this checks nothing');
  for (const { id, tempo } of WALK_SPEEDS) {
    assert.ok(tempo < 1, `${id}: tempo ${tempo} is at or above the renderer's bare default`);
    assert.ok(turnMs(tempo) >= 760, `${id}: ${Math.round(turnMs(tempo))}ms is faster than the 760ms that was the complaint`);
  }
  assert.ok(WALK_SPEEDS.some((o) => o.id === DEFAULT_WALK_SPEED), 'the default names no shipped speed');
});

test('applyCubeView puts a tempo on the cube, because it is the one place every cube passes through', () => {
  store.clear();
  const el = fakeCube();
  applyCubeView(el);
  const written = el.getAttribute('tempo-scale');
  assert.ok(written !== null, 'a cube was drawn with no tempo, so the renderer uses its own 190ms');
  assert.equal(Number(written), tempoFor(DEFAULT_WALK_SPEED), 'the tempo is not the saved default');
  // The number matters, not just its presence: this is the assertion that fails if someone writes
  // the renderer's bare default and calls the job done.
  assert.ok(turnMs(Number(written)) >= 760, `a turn would take ${Math.round(turnMs(Number(written)))}ms`);
});

test('a chosen speed reaches a cube on a screen with no speed menu', () => {
  // The Drill and Pieces screens have no gauge. The choice still has to reach their cubes, which
  // is the whole of this fix: the menu CHOOSES, `applyCubeView` APPLIES.
  for (const { id, tempo } of WALK_SPEEDS) {
    store.clear();
    store.set(WALK_SPEED_KEY, JSON.stringify({ id }));
    const el = fakeCube();
    applyCubeView(el);
    assert.equal(Number(el.getAttribute('tempo-scale')), tempo, `${id} did not reach a cube`);
  }
});

test('a stored speed nobody ships falls back to the default, never to the renderer\'s', () => {
  // localStorage is untrusted input, and the failure here is invisible: an unknown id reaching
  // `setAttribute` makes the renderer fall back to 190ms, which is the bug this file is about.
  for (const hostile of ['turbo', '', null, 7, {}, [], 'NORMAL']) {
    store.clear();
    store.set(WALK_SPEED_KEY, JSON.stringify({ id: hostile }));
    const el = fakeCube();
    applyCubeView(el);
    const got = Number(el.getAttribute('tempo-scale'));
    assert.equal(got, tempoFor(DEFAULT_WALK_SPEED), `id ${JSON.stringify(hostile)} did not take the default`);
    assert.ok(turnMs(got) >= 760, `id ${JSON.stringify(hostile)} produced a ${Math.round(turnMs(got))}ms turn`);
  }
  // And a record that is not an object at all.
  store.clear();
  store.set(WALK_SPEED_KEY, 'null');
  const el = fakeCube();
  applyCubeView(el);
  assert.equal(Number(el.getAttribute('tempo-scale')), tempoFor(DEFAULT_WALK_SPEED), 'a corrupt record lost the tempo');
});

test('the tempo numbers live in ONE module, and no screen keeps a copy', () => {
  // THE RELATION, not a list of screens. A second copy is how this defect returns: the menu had
  // the only copy, and the only cube it was written to was the menu's own.
  const owner = 'lib/cube-view.js';
  const shipped = WALK_SPEEDS.map((o) => o.tempo);
  const suspects = [
    'lib/screens/cube/speed-menu.js', 'lib/screens/cube.js', 'lib/screens/drill/library.js',
    'lib/screens/pieces/round-play.js', 'lib/cube-drawing.js', 'lib/walk-presenter.js',
    'lib/script-drive.js', 'lib/drill-rounds.js',
  ];
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const rel of suspects) {
    const src = strip(readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8'));
    for (const tempo of shipped) {
      assert.ok(!src.includes(String(tempo)),
        `${rel} spells the tempo ${tempo} itself; the numbers belong to ${owner} alone`);
    }
  }
  // And the owner really does hold them, so the sweep above is not passing on an empty set.
  const own = readFileSync(new URL(`../${owner}`, import.meta.url), 'utf8');
  for (const tempo of shipped) assert.ok(own.includes(String(tempo)), `${owner} does not hold ${tempo}`);
});
