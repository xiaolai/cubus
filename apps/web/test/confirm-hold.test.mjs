// The hold a confirm ask is drawn in (lib/screens/scan/confirm-hold.js), asked of a stand-in twin.
//
// What the renderer actually DRAWS at the front and on top is asked of the real one in
// test/browser/confirm-hold.test.mjs; this is the arithmetic and the lifecycle, without a browser:
// every ask a scanner can make, under both arrangements, turns the twin so the asked colour faces the
// viewer and the up colour is on top — and a newer ask wins over a turn still in flight.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConfirmHold } from '../lib/screens/scan/confirm-hold.js';
import { colourOf, colourOfSlot, positionOf } from '../lib/scheme.js';
// The 24 asks of each arrangement, and which position is opposite which, shared with the renderer
// suite (test/confirm-asks.mjs).
import { OPPOSITE, asksUnder } from './confirm-asks.mjs';

/** A twin that records what it was told; `turnTo` settles when the test says so. */
function fakeTwin({ renderer = true } = {}) {
  const attrs = new Map();
  const turns = [];
  const twin = {
    setAttribute: (k, v) => attrs.set(k, v),
    // The renderer's own default (packages/cubus-cube/src/cubus-cube.js, `orientation: 'U F'`).
    get orientation() { return attrs.get('orientation') ?? 'U F'; },
    written: () => attrs.has('orientation'),
    attr: (k) => attrs.get(k) ?? null,
    turns,
  };
  if (renderer) {
    twin.turnTo = (up, front, opts) => new Promise((settle) => turns.push({ up, front, ms: opts?.ms, settle }));
  }
  return twin;
}

const flush = () => new Promise((r) => setTimeout(r, 0));
/** The view the scan screen reads a scan by (lib/screens/scan.js, `READ_VIEW`). */
const REST = { ghosts: 'floating', 'camera-latitude': '35', 'camera-longitude': '45' };

test('there are 24 asks, and each is drawn with the asked colour in front and the up colour on top, in both arrangements', async () => {
  /** How long each turn was asked to take — a whole-cube turn is PLAYED, never snapped. */
  const durations = new Set();
  for (const scheme of ['western', 'japanese']) {
    assert.equal(asksUnder(scheme).length, 24);
    for (const ask of asksUnder(scheme)) {
      const twin = fakeTwin();
      createConfirmHold({ cube: twin, tileOf: (slot) => positionOf(colourOfSlot(slot), scheme), restView: REST }).show(ask);
      // Green facing you with white on top IS the scan's hold, so that ask turns nothing — and the
      // twin already reads it.
      const home = colourOfSlot(ask.face) === 2 && colourOfSlot(ask.up) === 0;
      assert.equal(twin.turns.length, home ? 0 : 1, `${scheme} ${ask.face}/${ask.up}: one whole-cube turn, or none from home`);
      const [up, front] = home ? twin.orientation.split(' ') : [twin.turns[0].up, twin.turns[0].front];
      // A turn the renderer would refuse is a hold that cannot be drawn: the two must be perpendicular.
      assert.notEqual(OPPOSITE.western[up], front, `${scheme} ${ask.face}/${ask.up}: ${up} ${front} is not a hold`);
      // Read back through the OTHER direction of the arrangement: the colour at the position turned to
      // the front is the colour the ask named.
      assert.equal(colourOf(front, scheme), colourOfSlot(ask.face), `${scheme} ${ask.face}/${ask.up}: the front`);
      assert.equal(colourOf(up, scheme), colourOfSlot(ask.up), `${scheme} ${ask.face}/${ask.up}: the top`);
      if (!home) durations.add(twin.turns[0].ms);
      twin.turns[0]?.settle(true);
      await flush();
      assert.equal(twin.orientation, `${up} ${front}`, 'the hold is written once the turn lands');
    }
  }
  // Every ask is played over the same span, and a span there is: `ms` absent or zero is the renderer's
  // own snap, which is a hold appearing rather than a cube turning (audit, 2026-09-19).
  assert.equal(durations.size, 1, `the turn's length differs between asks: ${[...durations].join(', ')}`);
  assert.ok([...durations][0] > 0, 'a turn was asked for with no duration, so it snaps');
});

test('the ask gone, the twin turns back to the scan hold; the same ask again turns nothing', async () => {
  const twin = fakeTwin();
  const hold = createConfirmHold({ cube: twin, tileOf: (slot) => slot, restView: REST });
  hold.show(null);
  assert.equal(twin.turns.length, 0, 'the twin already rests in the scan hold');
  hold.show({ face: 'R', up: 'U' });
  hold.show({ face: 'R', up: 'U' }); // every report repeats the ask
  assert.equal(twin.turns.length, 1, 'a repeated ask restarted the turn');
  twin.turns[0].settle(true);
  await flush();
  hold.show(null);
  assert.deepEqual([twin.turns[1].up, twin.turns[1].front], ['U', 'F']);
  twin.turns[1].settle(true);
  await flush();
  assert.equal(twin.orientation, 'U F');
});

test('a newer ask wins over a turn still in flight', async () => {
  const twin = fakeTwin();
  const hold = createConfirmHold({ cube: twin, tileOf: (slot) => slot, restView: REST });
  hold.show({ face: 'R', up: 'U' });
  hold.show({ face: 'D', up: 'F' });
  twin.turns[1].settle(true);
  twin.turns[0].settle(true); // the superseded turn lands late
  await flush();
  assert.equal(twin.orientation, 'F D', 'the older turn wrote its hold over the newer one');
  const quiet = fakeTwin();
  const h2 = createConfirmHold({ cube: quiet, tileOf: (slot) => slot, restView: REST });
  h2.show({ face: 'R', up: 'U' });
  quiet.turns[0].settle(false); // superseded by the element itself
  await flush();
  assert.equal(quiet.written(), false, 'a turn that did not complete wrote a hold it never reached');
});

test('an element that has not become the renderer still carries the hold it will draw', () => {
  const twin = fakeTwin({ renderer: false });
  createConfirmHold({ cube: twin, tileOf: (slot) => slot, restView: REST }).show({ face: 'U', up: 'B' });
  assert.equal(twin.orientation, 'B U');
});

test('while an ask stands the twin is seen from the front with its ghosts away, and the reading view comes back after', () => {
  // From the reading view's corner two sides face the eye equally, so "the red side, facing you"
  // showed red and blue side by side. From the front only the ask is in view.
  const twin = fakeTwin();
  const hold = createConfirmHold({ cube: twin, tileOf: (slot) => slot, restView: REST });
  hold.show(null);
  assert.equal(twin.attr('camera-longitude'), null, 'no ask moved the eye');
  hold.show({ face: 'R', up: 'U' });
  assert.deepEqual([twin.attr('camera-longitude'), twin.attr('camera-latitude'), twin.attr('ghosts')], ['0', '30', 'none']);
  hold.show({ face: 'D', up: 'F' });
  assert.equal(twin.attr('camera-longitude'), '0', 'a second ask keeps the front view');
  hold.show(null);
  assert.deepEqual([twin.attr('camera-longitude'), twin.attr('camera-latitude'), twin.attr('ghosts')], ['45', '35', 'floating']);
});
