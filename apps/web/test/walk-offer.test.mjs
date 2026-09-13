// The rung offer on its own — lib/walk-offer.js.
//
// lessons-wiring.test.mjs holds the offer to its shape in the source: answered both ways, through the
// one rung-raising operation, crediting once per walk and only the stages the lesson contained. This
// file holds it to what a learner sees: which moves count as followed, when a follow is credited, what
// the row says, and which offer an answer is about.

import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { Window } from 'happy-dom';

import { FOLLOWS_TO_OFFER, NO_PROGRESS, nextOffer, recordCleanFollow, repairProgress } from '../lib/method-ladder.js';
import { createRungOffer } from '../lib/walk-offer.js';

const BOTTOM = Object.freeze({ cross: 0, pairs: 0, oll: 0, pll: 0 });
const LESSON = Object.freeze({ sections: [{ id: 'cross' }] });
/** Progress one clean follow of the cross short of an offer. */
const almost = () => {
  let p = repairProgress(NO_PROGRESS);
  for (let i = 0; i < FOLLOWS_TO_OFFER - 1; i += 1) p = recordCleanFollow(p, ['cross']);
  return p;
};
const windows = [];
after(async () => { for (const win of windows) await win.happyDOM.close(); });

/** A mounted offer row with a rung offer on it. `saves` and `raises` record what reached storage. */
function rig({ saveOk = true, raiseOk = true } = {}) {
  const win = new Window();
  windows.push(win);
  const root = win.document.createElement('div');
  root.innerHTML = '<div id="rungOffer" hidden><span id="rungOfferMsg"></span>'
    + '<button id="rungYes"></button><button id="rungNot"></button></div>';
  win.document.body.appendChild(root);
  const settings = { rungs: { ...BOTTOM }, rungProgress: almost() };
  const saves = [];
  const raises = [];
  let raised = 0;
  const offer = createRungOffer({
    root,
    settings,
    save: (key, value) => { saves.push({ key, follows: value.rungProgress.follows.cross }); return saveOk; },
    raiseRung: (o) => { raises.push(o); return raiseOk; },
    onRaised: () => { raised += 1; },
  });
  const $ = (sel) => root.querySelector(sel);
  /** Step the head forward one move at a time from `from` to `to`. */
  const stepThrough = (from, to, walkGen) => {
    for (let k = from; k < to; k += 1) offer.onHead(k, k + 1, { lesson: LESSON, total: to, walkGen });
  };
  return { offer, settings, saves, raises, raisedCount: () => raised, $, stepThrough };
}

test('a lesson stepped through to its last move is credited once, and the row offers the rung', () => {
  const r = rig();
  r.stepThrough(0, 2, 1);
  assert.equal(r.saves.length, 1, 'the follow was not written');
  assert.equal(r.settings.rungProgress.follows.cross, FOLLOWS_TO_OFFER, 'the cross was not credited');
  assert.equal(r.$('#rungOffer').hidden, false, 'the offer did not appear once the stage had been followed enough');
  assert.equal(r.$('#rungYes').hidden, false);
  assert.equal(r.$('#rungNot').hidden, false);
  assert.match(r.$('#rungOfferMsg').textContent, /Ready for/);

  // Back one and forward again: the same walk, arriving at the end a second time.
  r.offer.onHead(2, 1, { lesson: LESSON, total: 2, walkGen: 1 });
  r.offer.onHead(1, 2, { lesson: LESSON, total: 2, walkGen: 1 });
  assert.equal(r.saves.length, 1, 'one walk was credited twice for arriving at its end twice');
});

test('a jump to the last move credits nothing, because nothing was watched', () => {
  const r = rig();
  r.offer.onHead(0, 2, { lesson: LESSON, total: 2, walkGen: 1 });
  assert.deepEqual(r.saves, [], 'a chip pressed at the end credited the whole lesson');
  assert.equal(r.$('#rungOffer').hidden, true);
});

test('a new walk starts with nothing followed, and is credited on its own', () => {
  const r = rig();
  r.stepThrough(0, 2, 1);
  assert.equal(r.saves.length, 1, 'precondition: the first walk was credited');
  r.offer.newWalk();
  r.offer.onHead(0, 2, { lesson: LESSON, total: 2, walkGen: 2 });
  assert.equal(r.saves.length, 1, 'the new walk was credited on the moves the previous walk had followed');
  r.stepThrough(0, 2, 2);
  assert.equal(r.saves.length, 2, 'the new walk, followed through, was not credited');
});

test('a follow that cannot be saved says so where the offer would be, and offers nothing', () => {
  const r = rig({ saveOk: false });
  r.stepThrough(0, 2, 1);
  assert.equal(r.$('#rungOffer').hidden, false, 'a failed save was not said anywhere');
  assert.match(r.$('#rungOfferMsg').textContent, /not saving your progress/,
    'progress that never reaches storage looked like a learner who had not practised enough');
  assert.equal(r.$('#rungYes').hidden, true, 'an offer was made that could not be kept');
  assert.equal(r.$('#rungNot').hidden, true);
});

test('Yes raises the offer that was on screen and tells the screen; declining records it and does not', () => {
  const yes = rig();
  yes.stepThrough(0, 2, 1);
  const shown = nextOffer(yes.settings.rungs, yes.settings.rungProgress);
  assert.ok(shown, 'precondition: an offer is on screen');
  // The ladder moves on before the press — another stage is now the one due — and what the row said
  // is still what is being answered.
  let pairsDue = repairProgress(NO_PROGRESS);
  for (let i = 0; i < FOLLOWS_TO_OFFER; i += 1) pairsDue = recordCleanFollow(pairsDue, ['pairs']);
  yes.settings.rungProgress = pairsDue;
  const nowDue = nextOffer(yes.settings.rungs, yes.settings.rungProgress);
  assert.ok(nowDue && nowDue.id !== shown.id, 'precondition: the ladder now names a different offer');
  yes.$('#rungYes').click();
  assert.deepEqual(yes.raises, [shown], 'the offer raised was not the one on screen');
  assert.equal(yes.raisedCount(), 1, 'the screen was not told a rung went up');
  assert.equal(yes.$('#rungOffer').hidden, true);

  const no = rig();
  no.stepThrough(0, 2, 1);
  const before = no.saves.length;
  no.$('#rungNot').click();
  assert.deepEqual(no.raises, [], 'declining raised a rung');
  assert.equal(no.saves.length, before + 1, 'the decline was not written');
  assert.notEqual(nextOffer(no.settings.rungs, no.settings.rungProgress)?.id, 'cross',
    'the declined stage came straight back');
  assert.equal(no.raisedCount(), 0, 'the screen was told a rung went up when it had been declined');
  assert.equal(no.$('#rungOffer').hidden, true);
});

test('a raise that cannot be saved is said in the row', () => {
  const r = rig({ raiseOk: false });
  r.stepThrough(0, 2, 1);
  r.$('#rungYes').click();
  assert.equal(r.$('#rungOffer').hidden, false, 'a rung raise that did not reach storage was said nowhere');
  assert.match(r.$('#rungOfferMsg').textContent, /not saving your progress/);
});
