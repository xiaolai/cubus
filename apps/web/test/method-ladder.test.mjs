// How a learner moves up a rung — §3's four rules, as assertions.
//
// The rule that carries the design is "offer, never ask", and every way it can go wrong is silent:
// an offer that never comes looks like a learner who is not ready; one that comes every solve
// looks like nagging; one that raises a rung without being answered looks like the app deciding.
// So this file is mostly about WHEN an offer exists and what answering it does.
//
// The screen half is `lessons-wiring.test.mjs`; this is the logic, which is where the rules live.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LADDER, STAGE_IDS, TOP_RUNG } from '../lib/method-solver.js';
import {
  FOLLOWS_TO_OFFER, NO_PROGRESS, RE_OFFER_GAP, acceptOffer, declineOffer, followsUntilOffer,
  ladderRows, nextOffer, recordCleanFollow, repairProgress,
} from '../lib/method-ladder.js';

const BOTTOM = Object.freeze({ cross: 0, pairs: 0, oll: 0, pll: 0 });
const fresh = () => repairProgress(NO_PROGRESS);
/** Follow every stage `n` times. */
const followAll = (n, progress = fresh()) => {
  let p = progress;
  for (let i = 0; i < n; i++) p = recordCleanFollow(p, STAGE_IDS);
  return p;
};

test('a new learner is offered nothing, and is on the bottom rung everywhere', () => {
  // §3 rule 1. An offer on the first solve would be a dropdown with extra steps.
  assert.equal(nextOffer(BOTTOM, fresh()), null);
  for (const id of STAGE_IDS) assert.equal(BOTTOM[id], 0);
});

test('an offer arrives only after the stage has actually been followed', () => {
  let p = fresh();
  for (let i = 1; i < FOLLOWS_TO_OFFER; i++) {
    p = recordCleanFollow(p, STAGE_IDS);
    assert.equal(nextOffer(BOTTOM, p), null, `offered after only ${i} follows`);
  }
  p = recordCleanFollow(p, STAGE_IDS);
  const offer = nextOffer(BOTTOM, p);
  assert.ok(offer, `no offer after ${FOLLOWS_TO_OFFER} follows`);
  assert.equal(offer.from, 0);
  assert.equal(offer.to, 1);
  assert.ok(offer.label && offer.blurb, 'an offer that cannot say what it is offering is a dialog');
});

test('only stages the solve actually contained count as practice at them', () => {
  // A cube whose cross was already solved taught nothing about the cross, and crediting it would
  // offer a rung on the strength of solves that never exercised the stage.
  let p = fresh();
  for (let i = 0; i < FOLLOWS_TO_OFFER * 4; i++) p = recordCleanFollow(p, ['pairs', 'oll', 'pll']);
  assert.equal(p.follows.cross, 0, 'the cross was never followed and must not be credited');
  const offer = nextOffer(BOTTOM, p);
  assert.equal(offer.id, 'pairs', 'the cross has no practice, so the offer skips to the next stage');
});

test('one offer at a time, and the lowest stage first', () => {
  // Three offers at once is a configuration screen again. Lowest first is the order the stages are
  // met in: a learner who cannot yet plan the cross has no use for full OLL.
  const p = followAll(FOLLOWS_TO_OFFER * 5);
  const offer = nextOffer(BOTTOM, p);
  assert.equal(offer.id, 'cross');
  // Raise the cross and the next offer is the next stage that has one, never the cross again.
  const raised = acceptOffer(BOTTOM, p, offer);
  assert.equal(raised.rungs.cross, 1);
  const second = nextOffer(raised.rungs, raised.progress);
  assert.notEqual(second?.id, 'cross', 'the cross was just raised and has no practice at its new rung');
});

test('accepting raises exactly one dial and starts that stage\'s practice again', () => {
  const p = followAll(FOLLOWS_TO_OFFER);
  const offer = nextOffer(BOTTOM, p);
  const next = acceptOffer(BOTTOM, p, offer);
  assert.equal(next.rungs.cross, 1);
  for (const id of STAGE_IDS.filter((x) => x !== 'cross')) {
    assert.equal(next.rungs[id], BOTTOM[id], `${id} moved, and only one dial may`);
    assert.equal(next.progress.follows[id], p.follows[id], `${id}'s practice was thrown away`);
  }
  // Follows at the rung below are not practice at this one, so the cross goes quiet.
  assert.equal(next.progress.follows.cross, 0);
  assert.notEqual(nextOffer(next.rungs, next.progress)?.id, 'cross');
  // The stage BELOW it in the order is offered instead, and that is correct rather than eager:
  // pairs earned its own three follows. What stops it arriving in the same breath as the cross
  // answer is the app showing at most one offer per completed lesson, not this function.
  assert.equal(nextOffer(next.rungs, next.progress)?.id, 'pairs');
});

test('declining postpones THAT stage, and never decides anything about the rung', () => {
  // The rule verbatim: "Declining costs nothing and it re-offers later. Nothing is ever silently
  // raised." A decline that disabled the offer would make the ladder a one-shot dialog.
  //
  // WHAT A DECLINE DOES NOT DO is govern the other three stages. Written as a test first and
  // found to be wrong: declining the cross put the pairs offer up in the same breath, which is
  // nagging wearing the costume of a different question. The postponement is per stage, and
  // "at most one offer per completed lesson" is the app's half — `lessons-wiring.test.mjs` pins
  // that the screen computes an offer once per walk and hides it once answered.
  let p = followAll(FOLLOWS_TO_OFFER);
  const offer = nextOffer(BOTTOM, p);
  assert.equal(offer.id, 'cross');
  p = declineOffer(p, offer);

  // The declined stage goes quiet for RE_OFFER_GAP more follows.
  assert.equal(followsUntilOffer(BOTTOM, p, 'cross'), RE_OFFER_GAP);
  assert.notEqual(nextOffer(BOTTOM, p)?.id, 'cross', 'the declined stage must not come straight back');
  // And the rung is untouched: declining decides nothing about what is being taught.
  assert.equal(nextOffer(BOTTOM, p)?.from ?? 0, 0);

  // Decline every stage in turn, and there is nothing left to offer at all.
  let quiet = p;
  for (const id of STAGE_IDS) {
    const o = nextOffer(BOTTOM, quiet);
    if (o) quiet = declineOffer(quiet, o);
  }
  assert.equal(nextOffer(BOTTOM, quiet), null, 'every stage declined is silence, not a queue');

  // It must come BACK, though — that is the half a one-shot dialog gets wrong.
  for (let i = 0; i < RE_OFFER_GAP; i++) quiet = recordCleanFollow(quiet, STAGE_IDS);
  assert.equal(nextOffer(BOTTOM, quiet)?.id, 'cross', 'and the lowest stage is first again');
});

test('an OVERDUE offer is postponed from where the learner is, not from the threshold', () => {
  // The audit's finding, and it was real. Counting declines and adding them to a fixed threshold
  // means a learner who has quietly built up nine follows and then declines is STILL over the new
  // threshold of six — so the same offer comes back on the very next solve, which is the one thing
  // "declining costs nothing" is supposed to rule out.
  const many = FOLLOWS_TO_OFFER * 3;
  let p = followAll(many);
  const offer = nextOffer(BOTTOM, p);
  assert.equal(offer.id, 'cross', 'the setup is only meaningful if the offer is overdue');
  p = declineOffer(p, offer);
  assert.notEqual(nextOffer(BOTTOM, p)?.id, 'cross', 'an overdue offer came straight back');
  assert.equal(followsUntilOffer(BOTTOM, p, 'cross'), RE_OFFER_GAP,
    'the wait is measured from the follow count at decline time');
  // And it does come back, after exactly that wait.
  for (let i = 0; i < RE_OFFER_GAP - 1; i++) p = recordCleanFollow(p, STAGE_IDS);
  assert.notEqual(nextOffer(BOTTOM, p)?.id, 'cross');
  p = recordCleanFollow(p, STAGE_IDS);
  assert.equal(nextOffer(BOTTOM, p)?.id, 'cross');
});

test('each decline waits longer than the last', () => {
  // The module's own promise, which the first implementation did not keep: declining at each
  // threshold produced gaps of 3, 3, 3 while the text said the interval grows.
  let p = followAll(FOLLOWS_TO_OFFER);
  const gaps = [];
  for (let n = 1; n <= 3; n++) {
    const offer = nextOffer(BOTTOM, p);
    assert.equal(offer?.id, 'cross', `decline ${n}: the cross should be on offer`);
    p = declineOffer(p, offer);
    const gap = followsUntilOffer(BOTTOM, p, 'cross');
    gaps.push(gap);
    for (let i = 0; i < gap; i++) p = recordCleanFollow(p, STAGE_IDS);
  }
  assert.deepEqual(gaps, [RE_OFFER_GAP, RE_OFFER_GAP * 2, RE_OFFER_GAP * 3]);
  for (let i = 1; i < gaps.length; i++) assert.ok(gaps[i] > gaps[i - 1], 'the wait must grow');
});

test('the countdown on the screen and the moment the offer fires are one formula', () => {
  // They were two, and two copies of a threshold are how a screen comes to say "2 more solves"
  // about an offer that is already due.
  for (const declines of [0, 1, 2]) {
    let p = followAll(FOLLOWS_TO_OFFER);
    for (let n = 0; n < declines; n++) {
      const o = nextOffer(BOTTOM, p);
      if (o) p = declineOffer(p, o);
      for (let i = 0; i < RE_OFFER_GAP * (n + 1); i++) p = recordCleanFollow(p, STAGE_IDS);
    }
    for (let step = 0; step < 4; step++) {
      const left = followsUntilOffer(BOTTOM, p, 'cross');
      const offered = nextOffer(BOTTOM, p)?.id === 'cross';
      assert.equal(offered, left === 0,
        `declines=${declines}: the countdown says ${left} while the offer is ${offered ? 'up' : 'down'}`);
      p = recordCleanFollow(p, STAGE_IDS);
    }
  }
});

test('a counter at its stored limit stops rising rather than being thrown away on reload', () => {
  // The audit's finding: the repair accepted up to 1e6 and the increment did not stop there, so a
  // count could be pushed past the limit and then reset to ZERO by the code written to protect it.
  const LIMIT = 1e6;
  let p = repairProgress({ follows: Object.fromEntries(STAGE_IDS.map((id) => [id, LIMIT])) });
  assert.equal(p.follows.cross, LIMIT, 'the limit itself is a valid stored value');
  p = recordCleanFollow(p, STAGE_IDS);
  assert.equal(p.follows.cross, LIMIT, 'incrementing past the limit must not happen');
  // The round trip a reload performs keeps every count.
  assert.deepEqual(repairProgress(p), p, 'a repaired record must survive its own repair unchanged');
});

test('a decline still postpones at the count ceiling, where it matters most', () => {
  // The verify pass caught this: clamping the postponement watermark to the SAME limit as the
  // counts made declining stop working exactly where the record is most degenerate. A learner at
  // the ceiling declines, the watermark is clamped to the ceiling, and the offer is eligible again
  // on the spot — the one thing declining exists to prevent.
  const LIMIT = 1e6;
  let p = repairProgress({ follows: Object.fromEntries(STAGE_IDS.map((id) => [id, LIMIT])) });
  const offer = nextOffer(BOTTOM, p);
  assert.equal(offer?.id, 'cross');
  p = declineOffer(p, offer);
  assert.notEqual(nextOffer(BOTTOM, p)?.id, 'cross', 'declining at the ceiling did nothing');
  // The count cannot rise any further, so the postponement is permanent — which is the right
  // answer for a record that has stopped counting, and it survives a reload.
  p = recordCleanFollow(p, STAGE_IDS);
  assert.equal(p.follows.cross, LIMIT);
  assert.notEqual(nextOffer(BOTTOM, p)?.id, 'cross');
  assert.deepEqual(repairProgress(p), p, 'the watermark must survive its own repair');
});

test('a stage at the top of its ladder is never offered anything', () => {
  const top = Object.fromEntries(STAGE_IDS.map((id) => [id, TOP_RUNG[id]]));
  assert.equal(nextOffer(top, followAll(100)), null);
  for (const id of STAGE_IDS) assert.equal(followsUntilOffer(top, fresh(), id), null);
});

test('the ladder shows every rung, including the ones not yet reached', () => {
  // §3 rule 2: a rung not yet reached is DESCRIBED, not hidden — a ladder you can see is a goal.
  const rows = ladderRows({ cross: 1, pairs: 0, oll: 0, pll: 0 }, fresh());
  assert.deepEqual(rows.map((r) => r.id), STAGE_IDS);
  for (const row of rows) {
    assert.equal(row.rungs.length, LADDER[row.id].length, `${row.id} hid a rung`);
    assert.equal(row.rungs.filter((r) => r.current).length, 1, `${row.id} is on no rung, or two`);
    for (const r of row.rungs) {
      assert.ok(r.label && r.blurb, `${row.id} rung ${r.rung} cannot say what it is`);
      assert.equal(r.reached, r.rung <= row.at);
    }
  }
  const cross = rows.find((r) => r.id === 'cross');
  assert.equal(cross.at, 1);
  assert.equal(cross.rungs[0].reached, true);
  assert.equal(cross.rungs[1].current, true);
});

test('a stored progress record is repaired rather than believed', () => {
  // localStorage is untrusted input. A count that is not a count would either throw or, worse,
  // compare as something — the `language: 7` failure, which blanked the whole stage.
  for (const hostile of [null, undefined, 'nope', 7, { follows: 'x' }, { follows: { cross: -1 } },
    { follows: { cross: 1.5 } }, { follows: { cross: 1e12 } }, { declined: { pll: NaN } }]) {
    const p = repairProgress(hostile);
    for (const id of STAGE_IDS) {
      assert.ok(Number.isInteger(p.follows[id]) && p.follows[id] >= 0, `${JSON.stringify(hostile)}`);
      assert.ok(Number.isInteger(p.declined[id]) && p.declined[id] >= 0);
    }
    // And it must not throw when read.
    assert.doesNotThrow(() => nextOffer(BOTTOM, p));
    assert.doesNotThrow(() => ladderRows(BOTTOM, p));
  }
  // A good record survives intact.
  const kept = repairProgress({ follows: { cross: 4 }, declined: { cross: 1 } });
  assert.equal(kept.follows.cross, 4);
  assert.equal(kept.declined.cross, 1);
});

test('nothing is ever raised without an answer', () => {
  // The whole of "never ask" rests on this: reading an offer must not change anything. If merely
  // computing one moved a dial, a learner would find their method changed by looking at a screen.
  const before = followAll(FOLLOWS_TO_OFFER * 3);
  const snapshot = JSON.stringify({ r: BOTTOM, p: before });
  for (let i = 0; i < 5; i++) nextOffer(BOTTOM, before);
  ladderRows(BOTTOM, before);
  followsUntilOffer(BOTTOM, before, 'cross');
  assert.equal(JSON.stringify({ r: BOTTOM, p: before }), snapshot);
});
