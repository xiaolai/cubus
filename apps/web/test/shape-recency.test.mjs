// The cube screen's Shapes menu: five pictures, derived from what this person last chose.
//
// `lib/shape-recency.js` is what let the catalogue grow from five to twenty without the menu
// growing with it, so the claims pinned here are the ones that bound actually rests on:
//
//   the menu is ALWAYS five, and never five slots holding four distinct pictures;
//   a fresh install opens on exactly the menu that shipped before the Shapes screen existed;
//   a STAGE press is not a shape — the guard that keeps the menu from emptying itself through
//     ordinary use of the screen it sits on;
//   and an id storage holds that this build no longer offers is skipped rather than drawn.
//
// NOT HOW THE RECORD IS REPAIRED. A stored `shapesRecent` that is hostile or the wrong type is
// `lib/app-settings.js`'s to fix at import, and `settings-load.test.mjs` owns that — it has the
// one-fresh-module-per-record machinery, and this file deliberately shares a single settings module
// so that `rememberShape`'s writes can be watched across calls.

import assert from 'node:assert/strict';
import { test } from 'node:test';

/** A localStorage stand-in, installed BEFORE the first import: `lib/app-settings.js` reads the
 *  record at module scope, and `save()` writes through this. */
const held = new Map();
let writes = 0;
/** When true, every write is refused — a full disk, or a private window with storage disabled. */
let refuseWrites = false;
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  writable: true,
  value: {
    getItem: (k) => (held.has(k) ? held.get(k) : null),
    setItem: (k, v) => {
      writes += 1;
      if (refuseWrites) throw new Error('quota exceeded (test)');
      held.set(k, String(v));
    },
    removeItem: (k) => { held.delete(k); },
  },
});

const { settings } = await import('../lib/app-settings.js');
const { RECENT_SHOWN, recentShapes, rememberShape } = await import('../lib/shape-recency.js');
const { OFFERED_PATTERNS, selectionOf } = await import('../lib/patterns.js');
const { OFFERED_TARGETS } = await import('../lib/stage-targets.js');

/** The catalogue's own order, as selection ids — what the menu pads from. */
const CATALOGUE = OFFERED_PATTERNS.map((p) => selectionOf(p));

/** Run `body` with the history set to `recent`, then put back whatever was there. */
function withHistory(recent, body) {
  const was = settings.shapesRecent;
  settings.shapesRecent = [...recent];
  try { return body(); } finally { settings.shapesRecent = was; }
}

test('a fresh install opens on the menu that shipped before the Shapes screen existed', () => {
  withHistory([], () => {
    // THE SEED IS THE CATALOGUE'S ORDER, which is why `patterns.test.mjs` pins that order: the
    // first five entries there are the five this menu held when it held all there were. Somebody
    // who has chosen nothing sees no change at all, and nobody has to choose anything for the menu
    // to be right — which is the half a favourites list cannot do.
    assert.deepEqual(recentShapes(), CATALOGUE.slice(0, RECENT_SHOWN));
  });
});

test('the menu is always five distinct pictures, whatever the history holds', () => {
  // The padding case that matters: a history entry that is ALSO one of the leading catalogue rows,
  // which is the usual case and the only case on a fresh install. Filtering the pad against the
  // history instead of deduplicating would draw that picture twice and leave the menu holding four.
  const histories = [
    [],
    [CATALOGUE[0]],
    [CATALOGUE[2]],
    [CATALOGUE[0], CATALOGUE[1], CATALOGUE[2]],
    CATALOGUE.slice(0, RECENT_SHOWN),
    CATALOGUE.slice(10, 16),
    ['not-a-shape', CATALOGUE[19]],
  ];
  for (const history of histories) {
    withHistory(history, () => {
      const shown = recentShapes();
      assert.equal(shown.length, RECENT_SHOWN, `history ${JSON.stringify(history)} drew ${shown.length} pictures`);
      assert.equal(new Set(shown).size, RECENT_SHOWN, `history ${JSON.stringify(history)} drew one picture twice`);
      for (const id of shown) {
        assert.ok(CATALOGUE.includes(id), `history ${JSON.stringify(history)} drew "${id}", which is not offered`);
      }
    });
  }
});

test('the newest choice leads, and the rest of the menu pads from the catalogue', () => {
  // A picture from the far end of the catalogue — one the menu would never otherwise hold.
  const far = CATALOGUE.at(-1);
  withHistory([], () => {
    assert.ok(!recentShapes().includes(far), 'the fixture picked a picture the menu already held');
    rememberShape(far);
    const shown = recentShapes();
    assert.equal(shown[0], far, 'the picture just chosen is not at the front');
    assert.deepEqual(shown.slice(1), CATALOGUE.slice(0, RECENT_SHOWN - 1), 'the rest is not the catalogue order');
  });
});

test('choosing a picture already in the menu moves it to the front rather than repeating it', () => {
  withHistory([], () => {
    rememberShape(CATALOGUE[3]);
    const shown = recentShapes();
    assert.equal(shown[0], CATALOGUE[3]);
    assert.equal(new Set(shown).size, RECENT_SHOWN, 'the picture was both moved and left where it was');
  });
});

test('the history is bounded, so the sixth choice costs the oldest', () => {
  withHistory([], () => {
    const chosen = CATALOGUE.slice(5, 11); // six pictures, none of them part of the seed
    for (const id of chosen) rememberShape(id);
    assert.equal(settings.shapesRecent.length, RECENT_SHOWN, 'the stored history grew past the menu');
    assert.deepEqual(settings.shapesRecent, chosen.slice(1).reverse(),
      'the history is not the last five choices, newest first');
    assert.ok(!recentShapes().includes(chosen[0]), 'the oldest of six is still in the menu');
  });
});

// THE LOAD-BEARING GUARD. The menu's items and the Restore row's stage chips are all `[data-stage]`
// and all go through one group (`wireGroup` in lib/walk-session.js), so anything wired there sees
// every press of `cross` and `solved` too. Recording those would push the pictures out of the menu
// with things that are not pictures — the menu would empty itself through ordinary use of the screen
// it sits on, and the only visible symptom would be a menu that had stopped offering shapes.
test('a stage is not a shape: pressing one records nothing', () => {
  withHistory([], () => {
    const before = [...settings.shapesRecent];
    for (const stage of OFFERED_TARGETS) {
      assert.equal(rememberShape(stage.id), false, `the stage "${stage.id}" was recorded as a shape`);
    }
    assert.equal(rememberShape('not-a-shape'), false);
    assert.equal(rememberShape(''), false);
    assert.equal(rememberShape(undefined), false);
    assert.deepEqual(settings.shapesRecent, before, 'something that is not a picture reached the history');
    assert.deepEqual(recentShapes(), CATALOGUE.slice(0, RECENT_SHOWN), 'the menu changed anyway');
  });
});

test('an id the catalogue no longer offers is skipped, and the menu is still full', () => {
  // The case a build makes when a row goes back to `offered: false`: storage keeps the id, and the
  // menu has no picture to draw for it. `app-settings.js` deliberately does not erase it — its job
  // is to refuse a hostile record, not to know what a shape is — so the skipping happens here.
  withHistory(['retired-shape', 'another-retired-one', CATALOGUE[12]], () => {
    const shown = recentShapes();
    assert.equal(shown[0], CATALOGUE[12], 'the one real id in the history is not at the front');
    assert.equal(shown.length, RECENT_SHOWN, 'two dead ids left the menu short');
    assert.ok(!shown.some((id) => id.includes('retired')), 'a picture nothing can draw reached the menu');
  });
});

test('a set pattern is remembered by the id its press carries, not by its own', () => {
  // A set pattern is selected by its TARGET's id, because the exact engine already answers that id.
  // Storing the pattern id instead would mean mapping back and forth at every read and write, and
  // the two directions would be free to disagree about which picture is on.
  const set = OFFERED_PATTERNS.find((p) => p.kind === 'set');
  assert.ok(set, 'no set pattern — this check went blind');
  assert.notEqual(selectionOf(set), set.id, 'a set pattern is pressed by its own id, so this proves nothing');
  withHistory([], () => {
    assert.equal(rememberShape(set.id), false, 'a set pattern was recorded under its pattern id');
    rememberShape(selectionOf(set));
    assert.equal(settings.shapesRecent[0], selectionOf(set));
    assert.equal(recentShapes()[0], selectionOf(set));
  });
});

test('a choice is persisted, and re-choosing the one already in front writes nothing', () => {
  withHistory([], () => {
    const id = CATALOGUE[7];
    const before = writes;
    assert.equal(rememberShape(id), true, 'the write did not report success');
    assert.ok(writes > before, 'the choice never reached storage');
    assert.deepEqual(JSON.parse(held.get('cubusSettings')).shapesRecent, [id],
      'what landed in storage is not the history');
    // Re-pressing the picture that is already on is the commonest press there is — the menu ticks
    // it, so it is the one under the finger — and each one would otherwise rewrite the whole
    // settings record.
    const after = writes;
    assert.equal(rememberShape(id), true, 'a no-op write reported failure');
    assert.equal(writes, after, 're-choosing the picture already in front rewrote the record');
  });
});

// A REFUSAL IS NOT SETTLED, and the unchanged-history short circuit must not pretend otherwise.
//
// `rememberShape` returns early when the chosen picture is already at the front, so that re-pressing
// the one the menu has ticked does not rewrite the whole settings record. That check asked only
// whether the history had CHANGED — and a refused write leaves the history changed in MEMORY, so the
// next press of the same picture matched it and returned `true` with storage still empty. Measured
// 2026-10-04: first call `false`, retry `true`, nothing ever written, and no retry attempted even
// once storage recovered. The in-memory update is deliberately kept on failure (the menu is right
// for this session either way); what this pins is that "unchanged" no longer implies "saved".
test('a refused write is retried, and never reported as a success', () => {
  withHistory([], () => {
    const id = CATALOGUE[9];
    // What storage holds BEFORE — the cases above have already written this key, so "nothing
    // reached storage" has to be "storage did not move", not "storage is empty".
    const onDisk = held.get('cubusSettings');
    refuseWrites = true;
    try {
      assert.equal(rememberShape(id), false, 'a refused write reported success');
      assert.equal(settings.shapesRecent[0], id, 'the menu did not take the choice for this session');
      assert.equal(held.get('cubusSettings'), onDisk, 'precondition: the refused write must not reach storage');

      // THE PRESS THAT USED TO LIE. Same picture, already at the front, history unchanged.
      const attempted = writes;
      assert.equal(rememberShape(id), false,
        'the unchanged-history short circuit claimed a success for a history that was never saved');
      assert.ok(writes > attempted, 'no retry was even attempted');
    } finally { refuseWrites = false; }

    // AND IT RECOVERS. Once storage works again, the same press persists rather than short-circuiting
    // on a history that still looks unchanged — which is the half that makes the fix worth having.
    assert.equal(rememberShape(id), true, 'the write was not retried after storage recovered');
    assert.deepEqual(JSON.parse(held.get('cubusSettings')).shapesRecent, [id],
      'the recovered write did not carry the history');
    // Settled again: the next identical press is the cheap no-op it is supposed to be.
    const after = writes;
    assert.equal(rememberShape(id), true);
    assert.equal(writes, after, 'a settled history is being rewritten on every press again');
  });
});
