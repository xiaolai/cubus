// The script player's load contract — plan item 3.5 of dev-docs/tutorial-capability-plan.md.
//
// Every case here is a race a real host runs into: a route searched for while the subject changes, a
// turn made while nothing is loaded, trust lapsing half way through a search. The contract is the same in
// each — the newest load owns the cube, and what the connection reported is kept and located on it.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import { createScriptPlayer } from '../lib/script-player.js';
import { MANIFEST } from './browser/public-cube.mjs';

const require = createRequire(import.meta.url);
const Cube = require('cubejs');
const turned = (alg) => { const c = new Cube(); c.move(alg); return c.asString(); };

/** A promise and the hands that settle it. */
const deferred = () => { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const walk = (moves, start = {}) => ({ schema: 2, start, steps: [{ move: moves }] });

/** An element as the manifest describes it, recording every call. */
function recordingCube() {
  const calls = [];
  const attrs = new Map();
  const target = {
    calls,
    setAttribute(n, v) { calls.push(['set', n, v]); attrs.set(n, v); },
    removeAttribute(n) { calls.push(['remove', n]); attrs.delete(n); },
    get stops() { const n = (attrs.get('alg') || '').split(' ').filter(Boolean).length; return [...Array(n + 1).keys()]; },
    animating: false,
  };
  for (const m of ['step', 'stepBack', 'stepStop', 'stepBackStop', 'seek']) target[m] = (...a) => calls.push([m, ...a]);
  const allowed = new Set([...MANIFEST.methods, ...MANIFEST.properties.map((p) => p.name), ...Object.keys(MANIFEST.operations), 'calls']);
  return new Proxy(target, { get(t, n) { if (typeof n === 'string' && !allowed.has(n)) throw new Error(`no member "${n}"`); return t[n]; } });
}

test('two loads resolved in reverse order: only the newer plays, and the older never applies', async () => {
  const cube = recordingCube();
  const player = createScriptPlayer({ cube });
  const older = deferred();
  const newer = deferred();
  const first = player.load(older.promise);
  const second = player.load(newer.promise);
  newer.resolve(walk("U R"));
  assert.equal(await second, true);
  const written = cube.calls.length;
  older.resolve(walk("F B L D"));
  assert.equal(await first, false, 'a load overtaken while it searched reported that it played');
  assert.equal(cube.calls.length, written, 'the superseded route wrote to the element after the newer one had loaded');
  assert.equal(player.view.alg, 'U R');
  // And a rejection belonging to a superseded load is not the host's problem any more.
  const stale = deferred();
  const late = player.load(stale.promise);
  await player.load(walk('R'));
  stale.reject(new Error('the search for the old cube failed'));
  assert.equal(await late, false);
});

test('a superseded route\'s transitions never apply, even from a handle kept for later', async () => {
  const cube = recordingCube();
  const player = createScriptPlayer({ cube });
  await player.load(walk("R U R'"));
  const kept = player.route();                  // e.g. a page's timer, armed to step after a pause
  assert.equal(kept.next().position, 1);
  const pending = deferred();
  const replacing = player.load(pending.promise);
  assert.equal(kept.current, false);
  assert.equal(kept.next(), null, 'a transition of the superseded route applied while its replacement was searched for');
  pending.resolve(walk('F2 D'));
  await replacing;
  assert.equal(kept.next(), null, 'a transition of the superseded route applied to the new one');
  assert.equal(player.position, 0);
  assert.equal(player.route().next().position, 1, 'a handle on the current route refused to move it');
});

// walk-session.test.mjs's "a turn reported during the FIRST search is tracked…", as the player's rule.
test('a turn reported while the first route is searched for is kept, and located on the route when it arrives', async () => {
  const player = createScriptPlayer();
  const search = deferred();
  const loading = player.load(search.promise);
  assert.deepEqual(player.observe(turned('R')), { kind: 'waiting', position: null });
  search.resolve(walk("R U R' U'"));
  assert.equal(await loading, true);
  assert.equal(player.position, 1, 'a turn made before the first route arrived was dropped');
});

// walk-session.test.mjs's "a snapshot during a replacement search keeps the model…", as the player's rule.
test('a snapshot taken during a replacement search is kept, and located on the replacement', async () => {
  const player = createScriptPlayer();
  await player.load(walk("U' R'", { scramble: 'R U' }));
  assert.equal(player.position, 0);
  const search = deferred();
  const replacing = player.load(search.promise);     // the same cube, searched again
  player.observe(turned("R U U'"));                    // its first move, made during the search
  search.resolve(walk("U' R'", { scramble: 'R U' }));
  assert.equal(await replacing, true);
  assert.equal(player.position, 1, 'a cube one move along the new route was not placed there');
});

test('trust lapsing drops the live model, whatever is loaded — and while a load is pending', async () => {
  let trust = true;
  const player = createScriptPlayer({ trusted: () => trust });
  player.observe(turned('R'));
  assert.equal(player.live, turned('R'));
  trust = false;
  assert.equal(player.observe(turned('R U')).kind, 'untrusted');
  assert.equal(player.live, null, 'a report on a chain nobody vouches for was kept as the model');
  trust = true;
  player.observe(turned('R'));
  const search = deferred();
  const loading = player.load(search.promise);
  player.dropLive();                                   // lapsed during the search
  search.resolve(walk("R U"));
  await loading;
  assert.equal(player.position, 0, 'a model trust had dropped was located on the route that loaded after');
});

test('a plain script loads before load() returns, so its position can be read on the next line', () => {
  const player = createScriptPlayer();
  player.observe(turned('R'));
  const done = player.load(walk("R U"));
  assert.equal(player.position, 1);
  assert.ok(done instanceof Promise);
  assert.deepEqual(player.locate(turned('R U')), { kind: 'step', idx: 2 });
});

// Found by a Codex audit, 2026-09-16. Superseding a route stopped the HOST's transitions and nothing
// else: the element had been handed a stop group and went on playing the old walk's moves — through the
// whole of the search for the replacement, which is exactly when nobody is watching for it.
test('superseding a route stops the cube it was driving, and leaves it where the route had reached', async () => {
  const cube = recordingCube();
  const player = createScriptPlayer({ cube });
  await player.load(walk("R U R'"));
  player.next();
  cube.animating = true;                          // the group the press started is still turning
  const moved = cube.calls.filter(([c]) => c === 'seek' || c === 'stepStop').length;
  const pending = player.load(new Promise(() => {}));   // a search that has not answered yet
  assert.deepEqual(cube.calls.at(-1), ['seek', 1], 'the superseded walk was left turning while the next was searched for');
  assert.ok(cube.calls.filter(([c]) => c === 'seek').length >= 1);
  assert.equal(moved > 0, true);
  // `unload()` is the same supersession with no promise to hand over, and says the same thing to the cube.
  cube.animating = true;
  player.unload();
  assert.deepEqual(cube.calls.at(-1), ['seek', 1], 'unload left the cube playing a walk nobody owns');
  assert.equal(player.loaded, false);
  void pending;
});
