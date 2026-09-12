// The repair, with a smart cube in the loop — and the six things §5 corrects about it.
//
// Every one of these was a first-draft mistake in dev-docs/solve-to-state-plan.md, caught by
// reading the code rather than by reasoning about it, and every one of them fails SILENTLY:
//
//   1. a repair computed on the raw report rather than the offset-corrected state. It would be
//      labelled for the wrong faces, and it would look perfectly plausible.
//   2. `cubeRefused()` named as the trust gate. It is verdict-only, and trust is lost in ways that
//      never set a verdict — `markStale` clears it with none at all. Naming the wrong predicate
//      lets a stale cube drive advice, which is a failure this repository has already had once.
//   3. `requestState()` read as restoring trust. It issues one request and resolves on the event;
//      re-establishing trust is the camera's job and nothing else's.
//   4. a lost packet absorbed. It invalidates the answer, and it is reported rather than swallowed.
//   5. per-turn numbers routed through `refreshScreen()`. That path reaches `beginWalk`, which
//      clears the walk a child is halfway through following.
//   6. the upside-down cube treated as a state problem. It is a display problem: the predicates
//      live in the cube's own colour frame, and what changes is which way to draw it.
//
// Source-text assertions, like the rest of this repository's wiring tests. A DOM harness would
// answer "does a turn update the number" and none of the six questions above, which are all about
// WHICH code the update goes through.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const app = readFileSync(new URL('../lib/app.js', import.meta.url), 'utf8');
const code = app
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/[^\n]*$/gm, '')
  .replace(/([^:'"`])\/\/[^\n]*/g, '$1');

/** The live-distance path, as source. Every case below is about what is and is not inside it. */
const live = code.match(/async function refreshLiveDistance\(\)[\s\S]*?\n {6}\}/)?.[0] ?? '';

test('the live distance exists at all, and is its own function', () => {
  assert.ok(live, 'there must be one named path for a per-turn number, or the rules below have no subject');
  assert.match(code, /liveMove = \(m\) => \{[\s\S]*?void refreshLiveDistance\(\);/,
    'a reported turn must refresh it');
  assert.match(code, /liveUpdate = \(f, serial\) => \{[\s\S]*?void refreshLiveDistance\(\);/,
    'and so must a snapshot, which is the drift correction');
});

// ---- 1. the offset-corrected state ---------------------------------------------------------------

test('the number is computed from the corrected model, never from the raw report', () => {
  // `liveModel` is seeded from `state.live` — the corrected stream — and advanced by `liveMove`.
  // `state.reported` is the cube's own raw claim and is deliberately never corrected.
  assert.match(live, /liveModel\.asString\(\)/, 'the corrected model is what the question is asked about');
  assert.doesNotMatch(live, /state\.reported/, 'the raw report would be labelled for the wrong faces');
  assert.doesNotMatch(live, /state\.cube\.facelets/,
    'the global subject lags until adoptCube — an answer built from it is about a cube that no'
    + ' longer exists, which is the trap #resolveBtn already documents');
});

test('the chain from the cube\'s raw report to this number passes through the correction', () => {
  // The assertion above says WHICH object is read. This one follows that object back to the wire,
  // because "liveModel is corrected" is a claim about three files and reading one of them proves
  // nothing.
  //
  //   the cube reports         onFacelets(reported, serial)
  //   the ONE correction       f = applyOffset(state.cube.offset, reported, Cube)
  //   the corrected stream     state.live = f          …and liveUpdate(f, serial)
  //   the local model          liveModel = Cube.fromString(f)   — and Cube.fromString(state.live)
  //   this number              liveModel.asString()
  //
  // THAT THE CORRECTION IS RIGHT is a different claim and is not this file's: it is proved by a
  // CONJUGATED DECODER in `cube-selfcheck.test.mjs`, which is the only construction that can tell
  // a uniformly relabelled cube from an offset one. Re-deriving it here would be a second, weaker
  // copy of that argument. What this case owns is that the repair sits downstream of it.
  // ONE correction on the SNAPSHOT STREAM, which is what `onFacelets` says of itself — not one in
  // the whole file. The other three sites are different questions: the move-reconciliation path
  // asks where the cube says it is after a turn, and the reconnect derivation asks it of a
  // candidate. The first draft of this case counted all four and failed, which is the assertion
  // being wrong rather than the app.
  const onFacelets = code.match(/function onFacelets\(reported, serial\) \{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.ok(onFacelets, 'the snapshot path must exist');
  assert.match(onFacelets, /const f = applyOffset\(state\.cube\.offset, reported, Cube\);/,
    'the stream is corrected before anything downstream sees it');
  assert.equal([...onFacelets.matchAll(/applyOffset\(/g)].length, 1,
    'a second correction inside this path is a second answer to "where is this cube"');
  assert.match(onFacelets, /state\.live = f;[\s\S]*?if \(liveUpdate\) liveUpdate\(f, serial\);/,
    'the corrected value is what reaches the screen, not the raw report beside it');
  assert.ok(!/liveUpdate\(reported/.test(onFacelets), 'and never the raw one');
  assert.match(code, /liveUpdate = \(f, serial\) => \{\s*\n\s*liveModel = Cube\.fromString\(f\);/,
    'and it is what seeds the local model');
  assert.match(code, /liveModel = Cube\.fromString\(state\.live\)/,
    'the walk seeds it from the corrected stream too, never from state.reported');
});

// ---- 2. the trust gate ---------------------------------------------------------------------------

test('the gate is chainTrusted(), and not the verdict-only predicate', () => {
  assert.match(live, /chainTrusted\(\)/, 'the composite predicate is the one that means what this needs');
  assert.doesNotMatch(live, /cubeRefused\(\)/,
    'cubeRefused() is verdict-only: markStale clears trust with no verdict, so a stale cube would'
    + ' pass it and drive advice');
  // A cube that is stale but not refused must produce nothing. The gate returns early through the
  // shared invalidation, rather than leaving the last number standing over an unverified cube.
  assert.match(live, /if \(!aimingAt \|\| !liveModel \|\| !chainTrusted\(\)\) \{ dropLiveDistance\(\); return; \}/,
    'an ungated path is worse than no path: a stale number reads exactly like a fresh one');
  // AND TRUST IS RE-ASKED AFTER EVERY AWAIT, not only before the first request. Trust can lapse
  // while a reply is in flight, and a number that was legitimate when it was asked for is not
  // legitimate when it lands.
  const rechecks = [...live.matchAll(/!chainTrusted\(\)/g)].length;
  assert.ok(rechecks >= 3, `trust is asked ${rechecks} times: once as a gate is not enough`);
});

test('every way a live answer stops being about the cube goes through ONE invalidation', () => {
  // An audit found three of these separately: the early return cleared the line without moving the
  // generation, so an answer in flight repainted over the clearing; `onTrustLost` did neither; and
  // a new query left the previous number standing when both of its replies came back unavailable.
  // They are one function now, and this case is what stops a fourth site inventing a fourth answer.
  const drop = code.match(/function dropLiveDistance\(\) \{[\s\S]*?\n {6}\}/)?.[0] ?? '';
  assert.ok(drop, 'the invalidation must be one named thing');
  assert.match(drop, /liveGen \+= 1;/, 'it moves the generation, so an answer in flight cannot land');
  assert.match(drop, /el\.textContent = ''/, 'and it takes the last number off the screen');

  for (const site of [
    [/liveGap = \(\) => \{[\s\S]*?\n {6}\};/, 'a lost turn'],
    [/onTrustLost = \(\) => \{[\s\S]*?\n {6}\};/, 'trust lapsing'],
  ]) {
    const [pattern, what] = site;
    const block = code.match(pattern)?.[0] ?? '';
    assert.ok(block, `${what}: the hook must exist`);
    assert.match(block, /dropLiveDistance\(\)/, `${what} must invalidate the live number`);
    // AND THE MODEL STOPS BEING "AHEAD". `liveMoved` is a claim about the CURRENT connection, and
    // it survived a disconnect: scan `R`, report `U`, disconnect, reconnect, confirm `R`, and the
    // adoption overwrote the confirmed truth with `R U` and marked it trusted. That is §9a's
    // severe failure — a route for a cube other than the one in their hands, passing every
    // internal check. Reproduced by a verify pass on the fix that introduced the flag.
    assert.match(block, /liveMoved = false;/,
      `${what} must also stop the model claiming to be ahead of a snapshot`);
  }
  // And a fresh query clears before it asks, rather than after it answers.
  assert.match(live, /el\.textContent = '';\s*\n\s*const bounds = await/,
    'the old number goes before the new request, or an unavailable reply leaves it standing');
});

// ---- 3. requestState restores nothing --------------------------------------------------------------

test('nothing here asks the cube to restore its own trust', () => {
  // `requestState()` issues one REQUEST_FACELETS and resolves on the event. It says where the cube
  // thinks it is; it does not establish that the app is right about it, and only the camera does.
  assert.doesNotMatch(live, /requestState/,
    'a state request is a reading, not a warrant — trust comes from the camera and nowhere else');
});

// ---- 4. a lost packet invalidates the answer ---------------------------------------------------------

test('a lost turn takes the number with it, and one already in flight cannot land after', () => {
  const gap = code.match(/liveGap = \(\) => \{[\s\S]*?\n {6}\};/)?.[0] ?? '';
  assert.ok(gap, 'the lost-move hook must exist');
  assert.match(gap, /dropLiveDistance\(\)/,
    'a request already in flight is about a cube the model no longer matches, and the last number'
    + ' on screen is about that cube too — one call takes both');
});

// ---- 5. the narrow path -------------------------------------------------------------------------------

test('a per-turn number never rebuilds the walk', () => {
  // `refreshScreen()` reaches `update()` → `retarget()` → `loadWalk` → `beginWalk`, which clears
  // `moves`, `steps`, `chips`, `total`, `target` and `lesson` and points back at step 0. Routing a
  // per-turn number through it would destroy the walk the child is following.
  for (const forbidden of ['refreshScreen', 'renderScreen', 'loadWalk', 'beginWalk', 'retarget']) {
    assert.ok(!live.includes(forbidden), `the live path must not reach ${forbidden}()`);
  }
  // And it must not write any of the walk's own state, which is the same failure by hand.
  //
  // ASSIGNMENT, not the substring. The first version of this check used `includes('moves =')` and
  // failed on `answer.moves === null` — a comparison reading as a write. A check that fires on
  // correct code teaches the next reader to loosen it, which is how it stops firing on the wrong
  // code too.
  for (const owned of ['moves', 'steps', 'chips', 'total', 'target', 'lesson', 'at']) {
    const assigns = new RegExp(`(^|[^.\\w])${owned}\\s*=(?!=)`, 'm');
    assert.ok(!assigns.test(live), `the live path must not assign the walk's \`${owned}\``);
  }
});

test('the live answer carries its own generation, because walkGen deliberately does not move', () => {
  assert.match(live, /const mine = \+\+liveGen;/, 'each refresh must take a generation');
  const checks = [...live.matchAll(/mine !== liveGen/g)].length;
  const awaits = [...live.matchAll(/await /g)].length;
  assert.equal(checks, awaits,
    `${checks} freshness checks for ${awaits} awaits — every await is a place the cube can change,`
    + ' and a result for cube A landing on cube B is the failure this counter exists for');
  assert.match(live, /root\.isConnected/, 'and the screen it is writing to must still be on the paper');
  assert.ok(!live.includes('walkGen'),
    'walkGen counts WALKS and a per-turn update deliberately does not bump it — sharing it would'
    + ' make every turn look like a new walk to everything that reads it');
});

test('the live number has a line of its own and never the route\'s count', () => {
  // `#moveCount` reports progress against THIS route's total (`setStatus`). A live distance
  // written into it would make one label silently mean two things.
  assert.match(live, /\$\('#stageLive', root\)|liveSay\(\)/, 'it must write its own element');
  assert.ok(!live.includes('#moveCount'), 'and never the route\'s count');
  assert.ok(!live.includes('setStatus'), 'nor the function that writes it');
  assert.match(app, /id="stageLive"[^>]*aria-live="polite"/,
    'and the line must announce itself, since it changes without anybody pressing anything');
});

// ---- 6. which way up ------------------------------------------------------------------------------------

test('the upside-down cube is answered by the drawing, not by the state', () => {
  assert.match(code, /const BOTTOM_LAYER_TARGETS = new Set\(\['cross', 'first-layer'\]\);/,
    'which targets are drawn from below is a claim about the METHOD and must be named');
  assert.match(code, /cube\.setAttribute\('camera-up', aimingAt && BOTTOM_LAYER_TARGETS\.has\(aimingAt\.id\) \? 'D' : 'U'\)/,
    'the renderer already takes camera-up for exactly this');
  // And nothing anywhere re-frames the STATE to compensate. The predicates live in the cube's own
  // colour frame with the cross on D, and rotating the state to match how somebody is holding it
  // would describe a situation that does not exist.
  assert.ok(!live.includes('rotateState'), 'the live path must not re-frame the cube');
});

// ---- what was NOT built, and the number that decided it ----------------------------------------------

test('the undo source is absent, and deliberately', () => {
  // §4 ranks undo last and §7.4 is its gate: "if that is near zero, Phase E's undo source can be
  // dropped". Measured over plan §7.2's five-kind corpus, the population this feature is FOR — a
  // stage finished and then broken — is answered exactly 100% of the time (`perturb`) and 98%
  // (`wrong-auf`) at the shipped budget, and everywhere the exact search gives up the pool prefix
  // still answers. Undo's only unique value was in deep messes, where the log is long too.
  //
  // It also needs more than trust: a recorded CHECKPOINT at which the predicate held, plus an
  // unbroken log from it — and `onMovesLost` breaks the log by definition. Scan `SOLVED·R`, ask
  // for `two-layers`, turn `U`: undoing the whole available log lands on `SOLVED·R`, which does
  // not satisfy the target, and every state and every logged move there is trustworthy.
  //
  // Asserted so its ABSENCE is a decision on the record rather than an omission somebody
  // rediscovers. Adding it means deleting this case and saying why.
  assert.ok(!code.includes('undoCheckpoint'), 'no undo checkpoint is kept');
  assert.ok(!code.includes('stageUndo'), 'and no undo source is offered');
});
