// Rolling a scramble, driven directly (lib/scramble-roll.js), through the seams rollScramble and
// randomScramble take: the draw, the solve and the signal. And the solve history the Timer stores.
//
// What these pin (the 2026-09-13 audit):
//   * a solved or one-turn draw never reaches the solver — TNoodle's rule, asked of the STATE — and
//     eight such draws in a row roll nothing and say the random source is broken;
//   * a roll called off stops escalating and hands back nothing, whether it was called off
//     before it started or while it ran;
//   * a history at the largest safe number is renumbered, never written a number its reader drops;
//   * a stored history keeps its rows' places: unusable rows are blanks, usable fields whitelisted.
//
// One process, one solver: storage is a stand-in set before the modules load, and the pool is
// loaded once (on inline workers, as node has no Worker for it to spawn).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import Cube from '../vendor/cubejs.js';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};
const quiet = console.error;
console.error = () => {};
const { loadSolver } = await import('../lib/solver-service.js');
const roll = await import('../lib/scramble-roll.js');
assert.equal(await loadSolver(), true);
console.error = quiet;

const at = (alg) => { const c = new Cube(); if (alg) c.move(alg); return c; };
const TRIVIAL = ['', ...['U', 'D', 'L', 'R', 'F', 'B'].flatMap((f) => [f, `${f}'`, `${f}2`])];

test('a solved or one-turn draw is redrawn, and never reaches the solver', async () => {
  assert.equal(TRIVIAL.length, 19, 'the solved state and all eighteen face turns');
  for (const t of TRIVIAL) {
    const draws = [at(t), at('R U')];
    const asked = [];
    const rolled = await roll.rollScramble({
      draw: () => draws.shift(),
      solve: async (f) => { asked.push(f); return "U' R'"; },
    });
    assert.deepEqual(asked, [at('R U').asString()], `the ${t || 'solved'} state reached the solver`);
    assert.deepEqual(rolled, { facelets: at('R U').asString(), alg: 'R U' });
  }
});

test('eight trivial draws in a row roll nothing, and say the source is broken', async () => {
  let drawn = 0;
  let asked = 0;
  const said = [];
  console.error = (...a) => { said.push(a.join(' ')); };
  try {
    const rolled = await roll.rollScramble({
      draw: () => { drawn += 1; return at('R'); },
      solve: async () => { asked += 1; return null; },
    });
    assert.equal(rolled, null);
    assert.equal(drawn, 8, 'the redraw bound');
    assert.equal(asked, 0, 'a trivial state reached the solver');
    assert.ok(said.some((s) => /random source is broken/.test(s)), 'and it is said, loudly');
  } finally { console.error = quiet; }
});

test('a roll called off mid-search stops escalating, and hands back nothing', async () => {
  const ac = new AbortController();
  const bounds = [];
  const rolled = await roll.rollScramble({
    signal: ac.signal,
    draw: () => at('R U'),
    solve: async (f, b) => { bounds.push(b); ac.abort(); return null; },
  });
  assert.equal(rolled, null);
  assert.equal(bounds.length, 1, 'the budget was doubled and the search asked again after the abort');
  assert.ok(bounds[0].signal === ac.signal, 'the search was never handed the signal');
});

test('a scramble request already called off takes no roll', async () => {
  const ac = new AbortController();
  ac.abort();
  const r = await roll.randomScramble({ signal: ac.signal });
  assert.equal(r.facelets, '', 'a request already called off rolled a cube anyway');
});

test('a scramble request called off after it started hands back nothing', async () => {
  const ac = new AbortController();
  const pending = roll.randomScramble({ signal: ac.signal });
  ac.abort();
  const r = await pending;
  assert.equal(r.facelets, '', 'a request called off mid-roll still rolled a cube');
});

test('a history at the largest safe number is renumbered, never written a number its reader drops', () => {
  store.set('cubusSolves', JSON.stringify({
    list: [{ n: Number.MAX_SAFE_INTEGER, time: '9.00', scramble: 'R', at: 5 }, { n: 0, time: '', scramble: '', at: 0 }],
  }));
  assert.equal(roll.pushSolve('8.00'), true);
  assert.deepEqual(roll.recentSolves().map((s) => s.n), [3, 2, 0],
    'the new solve was stored under a number the reader turns into 0');
});

test('stored rows keep their places: unusable ones are blanks, usable fields are whitelisted', () => {
  store.set('cubusSolves', JSON.stringify({
    list: [null, 'x', [1],
      { n: 2, time: '1.00', scramble: 'R', at: 9, source: 'cube', moves: 3, inspectionMs: 5, extra: 1 },
      { n: -1, time: 4, scramble: null, at: 1.5, source: 'psychic', moves: 0, inspectionMs: 86_400_001 }],
  }));
  const blank = { n: 0, time: '', scramble: '', at: 0 };
  assert.deepEqual(roll.recentSolves(), [blank, blank, blank,
    { n: 2, time: '1.00', scramble: 'R', at: 9, source: 'cube', moves: 3, inspectionMs: 5 }, blank]);
});
