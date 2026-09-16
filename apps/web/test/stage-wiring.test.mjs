// The repair, attached to two screens — which is the half that fails silently.
//
// `stage-distance.test.mjs` proves the engine, `stage-report.test.mjs` proves the wording, and
// `stage-picture.test.mjs` proves the drawing. This file proves they are WIRED, and every
// assertion here is about a way the wiring can be wrong while every one of those stays green:
//
//   * a search on the UI thread. §8 is not negotiable — the table build is exactly the 723 ms
//     block that was removed from `loadSolver` — and nothing in a passing engine test would
//     notice it happening on the main thread.
//   * chips painted for a cube the app did not believe. A repair must inherit the scan's refusal
//     rather than form an opinion of its own (§9a), and a chip over a refused read is a number
//     about a cube nobody has established.
//   * a late answer landing on the wrong cube. The failure mode §5 spends three corrections on.
//   * a target change REBUILDING the screen instead of retargeting it, which would tear down the
//     walk a child is halfway through.
//   * a stage route wearing whole-cube furniture: the Lesson switch, the prove button.
//
// Source-text assertions, the same shape as `solve-tier-wiring.test.mjs` and `lessons-wiring.test.mjs`
// and for the same reason: these are questions about wiring, and a DOM harness answers them more
// slowly and less exactly.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { OFFERED_TARGETS } from '../lib/stage-targets.js';
import { NODE_BUDGET } from '../lib/stage-distance.js';
import { blockAt, readAppSource } from './app-source.mjs';

const app = readAppSource();
const code = app
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/[^\n]*$/gm, '')
  .replace(/([^:'"`])\/\/[^\n]*/g, '$1');
const sheet = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// ---- the search never runs here ----------------------------------------------------------------

test('the app asks a WORKER for a repair, and never searches on this thread', () => {
  // The one door. Everything else about this feature can be wrong and recoverable; a 460 ms table
  // build plus a two-second search on the UI thread is a frozen app, and it is exactly the block
  // §8 forbids by name.
  assert.match(code, /async function stageAsk\(payload\)/, 'the app must have one place that asks');
  assert.match(code, /client\?\.stageRoute/, 'and it must go through the pool');
  // `solveToState` and `lowerBound(s)` are the engine's own entry points. If either is CALLED from
  // app.js, the search is on this thread whatever the comments say.
  assert.doesNotMatch(code, /\bsolveToState\s*\(/, 'app.js must never call the search directly');
  assert.doesNotMatch(code, /\blowerBounds?\s*\(/, 'app.js must never read a distance table directly');
  // The budget constant may be imported — it is a number — but nothing else from that module.
  // EVERY import of the engine, from whichever module and folder: a first match over the app's
  // joined source would check one importer and pass a second that brought in the search.
  const imports = [...code.matchAll(/import \{([^}]*)\} from '(?:\.\.?\/)+stage-distance\.js';/g)].map((m) => m[1]);
  assert.ok(imports.length > 0, 'the budget must come from the engine rather than be typed again here');
  for (const imported of imports) {
    assert.deepEqual(
      imported.split(',').map((n) => n.trim().split(/\s+as\s+/)[0]).filter(Boolean),
      ['NODE_BUDGET'],
      'only the budget crosses into the app — importing the search invites calling it',
    );
  }
});

test('the two budgets are the measured ones, and the chip row uses the cheaper', () => {
  // Six chips at the full budget is twelve seconds of worker time, arriving exactly when the user
  // is about to press "Solve this cube" and needs that same pool.
  assert.match(code, /const CHIP_NODE_BUDGET = 400_000;/, 'the chip budget must be named');
  assert.match(code, /nodeBudget: CHIP_NODE_BUDGET/, 'and the chip row must use it');
  assert.match(code, /nodeBudget: STAGE_NODE_BUDGET/, 'while the walk gets the full one');
  assert.equal(NODE_BUDGET, 4_000_000, 'the full budget is the engine\'s, measured in Phase B');
});

// ---- the Restore chips --------------------------------------------------------------------------

test('the chip row exists, is hidden until there is a cube, and offers every target', () => {
  assert.match(code, /id="stageCard"[^>]*hidden/, 'the row must not be on screen before a scan');
  assert.match(code, /id="stageChips"/, 'and there must be somewhere to put the chips');
  assert.match(code, /OFFERED_TARGETS\.map\(\(target\) =>/, 'the chips are drawn from the target list');
  assert.match(code, /data-target="\$\{escHtml\(target\.id\)\}"/, 'each chip must name the target it is about');
  // Six of them: the five stages and the whole cube (§6). Read from the module rather than counted
  // in the markup, so adding a target adds a chip.
  assert.equal(OFFERED_TARGETS.length, 6);
});

test('chips are painted only for a scan the app BELIEVED', () => {
  // §9a: no repair runs on a read the scanner did not accept. The feature inherits the scan's
  // refusal rather than forming an opinion of its own — which here means the call sits in the
  // branch that adopts the cube, never beside the one that refuses it.
  const complete = blockAt(code, "panel.addEventListener('scan-complete'");
  assert.ok(complete, 'the scan-complete handler must exist');
  const adopted = blockAt(complete, '} else {');
  assert.match(adopted, /adoptCube\(fl,/, 'the adoption branch must exist, and be the one that adopts the cube');
  assert.match(adopted, /paintStageChips\(fl\)/, 'the chips are painted from the adoption branch');
  const refusedBranch = blockAt(complete, 'if (!adopted)');
  assert.ok(refusedBranch, 'the refusal branch must exist');
  assert.doesNotMatch(refusedBranch, /paintStageChips/, 'a refused read must produce no numbers at all');
});

test('a late chip answer cannot land on a cube that has been replaced', () => {
  // The failure §5 spends three corrections on, one screen earlier: a correction to one sticker
  // re-scans and re-paints, and without a generation counter the previous cube's fifth chip
  // arrives and overwrites the new cube's.
  const painter = blockAt(code, 'async function paintStageChips(facelets)');
  assert.ok(painter, 'the painter must exist');
  assert.match(painter, /const mine = \+\+stageGen;/, 'each paint must take a generation');
  assert.match(painter, /mine === stageGen/, 'and check it is still the current one');
  assert.match(painter, /root\.isConnected/, 'and that the screen it is painting is still on the paper');
  const awaits = [...painter.matchAll(/await /g)].length;
  // One door since 2026-09-13 (the two copies of the check-and-drop became `stillOurs`), still
  // asked once after every await.
  const checks = [...painter.matchAll(/if \(!stillOurs\(\)\) return;/g)].length;
  assert.ok(checks >= 2, `only ${checks} freshness checks for ${awaits} awaits — every await is a place the cube can change`);
  // NOT MERELY "STOP ANSWERING". Discarding later replies left the distances already painted
  // standing over a cube that had since been turned — the cross chip read 1 for `R` while the cube
  // reported `R F`, and pressing it walked a route for a cube nobody was holding.
  assert.match(painter, /if \(root\.isConnected && mine === stageGen\) dropStageChips\(\);/,
    'a subject that changed under the row must take the row away, not just silence the next reply');
  // And a scan that stops being complete takes the row away rather than leaving stale numbers.
  assert.match(code, /stageGen \+= 1;/, 'an incomplete scan must invalidate answers already in flight');
});

test('the chip row upgrades bounds to answers, and never the other way', () => {
  const painter = blockAt(code, 'async function paintStageChips(facelets)');
  assert.match(painter, /want: 'bounds'/, 'the instant pass is a table read for every target at once');
  assert.match(painter, /want: 'route'/, 'and the second pass is a budgeted search');
  // `solved` is deliberately not searched: §6 gives its chip the "a route, not a distance" state
  // and §9.5 leaves the whole-cube minimum an open decision for the owner.
  assert.match(painter, /target\.id !== 'solved'/, '`solved` must not be given an exact answer');
  // Cheapest first, so the shallow chips settle while the deep ones run.
  assert.match(painter, /\.sort\(\(a, b\) =>/, 'the searches must be ordered by how cheap they look');
  // A null reply is the pool going away, not a search that finished with nothing.
  assert.match(painter, /if \(!answer\) return;/, 'a missing reply must leave the bound standing');
});

test('pressing a chip carries its target to the cube screen', () => {
  assert.match(code, /state\.stageTarget = chip\.dataset\.target;/, 'the press must set the target');
  assert.match(code, /state\.stageTarget = chip\.dataset\.target;\s*\n\s*go\('home'\);/,
    'and then go where a walk lives');
});

// ---- the cube screen ------------------------------------------------------------------------------

test('the target selector replaces the WALK and does not rebuild the screen', () => {
  // A rebuild would tear down the transport, the 3D element and the walk a child is halfway
  // through. `retarget()` — which is `loadWalk` — is the seam for exactly this (§6), and
  // `refreshScreen()` is the one that must NOT appear here.
  // The selector is one of the session's two pill groups, wired by one function.
  assert.match(code, /wireGroup\('stage', \(\) => state\.stageTarget, /, 'the selector must be wired');
  const handler = blockAt(code, 'const wireGroup = (key, now, choose) =>');
  assert.match(handler, /void loadWalk\(\);/, 'a target change is a walk replacement');
  assert.doesNotMatch(handler, /refreshScreen|renderScreen/, 'and never a rebuild');
  assert.match(handler, /if \(want === now\(\)\) return;/,
    'pressing the target already showing must do nothing, or the transport position is thrown away');
  assert.match(blockAt(code, 'const paintGroup = (key, chosen) =>'), /aria-pressed/,
    'which pill is on must reach a screen reader, not only the eye');
});

test('the target is a fact about this cube, not a setting', () => {
  // §6: it does not go in Settings, for the same reason the ladder's rungs are not a preference.
  assert.match(code, /stageTarget: 'solved',/, 'the default is the whole cube, so nothing changes for anyone else');
  // It outlives the screen it was chosen on, and the Scramble screen shares the mount — so the one
  // function every reader asks answers "none" there, or a Home target draws its aim over a scramble.
  assert.match(code, /function stageTargetNow\(\) \{\s*\n\s*if \(scrambling\) return null;/,
    'a target chosen on Home must not reach the Scramble screen');
  assert.doesNotMatch(code, /settings\.stageTarget/, 'a target in Settings would outlive the cube it is about');
  assert.doesNotMatch(code, /save\('[^']*',\s*\{[^}]*stageTarget/, 'and it is never persisted');
});

test('a stage route wears no whole-cube furniture', () => {
  // The Lesson switch and the prove button are both about a whole-cube solution. Left on, the
  // first offers an object the screen cannot produce and the second offers a whole-cube proof of
  // a stage route.
  assert.match(code, /kindRow\.hidden = Boolean\(route\)/, 'the Solution / Lesson switch goes with the repair');
  // Read off the prove gate's own condition, whatever else it holds.
  assert.match(code, /if \(proveBtn && optimalCapability\(\)[^{\n]*&& !route\) \{/, 'the prove button must be off for a repair');
});

test('the route says what KIND of answer it is, from the object it came from', () => {
  assert.match(code, /route \? routeSentence\(route, stageTargetNow\(\)\)/,
    'the sentence must be derived from the route, so the claim and the moves cannot drift');
  // And the wording itself is not in this file: one named region is what lets `optimal.test.mjs`
  // hold the app to it.
  assert.doesNotMatch(code, /the shortest way back/,
    'the claim belongs to STAGE_COPY in lib/stage-report.js, where the scanner can find it');
});

test('the target is drawn, with the free pieces ghosted', () => {
  // §6, and it is the part that makes a shortest path acceptable rather than alarming.
  assert.match(code, /id="stageAim"[^>]*hidden/, 'the aim is hidden while the target is the whole cube');
  // The picture is drawn in the METHOD frame (white cross on D); the net beside it is the scan
  // frame's, so it is turned before it is painted or the white cross would be drawn on the bottom.
  assert.match(code, /paintAim\(fromMethodFrame\(targetPicture\(aimingAt\)\)\)/, 'and painted from the target picture');
  assert.match(code, /aim\.hidden = !aimingAt;/, 'a whole-cube target draws no aim — it would say nothing');
  // ONE PICTURE (2026-09-13): the target takes the Initial State net's place, because the card that
  // held both was drawn over the sheet on the small windows — and the next walk gets the net back.
  assert.match(code, /net\.hidden = Boolean\(aimingAt\);/, 'while a target is shown the Initial State net is not');
  assert.match(code, /heading\.textContent = t\('Aiming at the %1', aimingAt\.name\)/, 'and the heading says what the picture is');
  assert.match(code, /if \(oldNet\) oldNet\.hidden = false;/, 'the next walk puts the Initial State back');
  // The renderer has to be able to draw "not fixed" at all.
  assert.match(code, /facelets\[i\] === '\?' \? 'free' : facelets\[i\]/, 'the net must map the unknown mark');
  assert.match(sheet, /\.net \.sticker\.free \{/, 'and the sheet must draw it as an empty well');
});

test('the engine is asked about the WHITE cross, and every answer comes back in the scan frame', () => {
  // ADR 0003. The engine and the method solver both put the cross on D, which in the scan frame
  // is yellow — so each crossing between the frames is a place the app can quietly ask about the
  // wrong cross, get a correct answer to that question, and show it.
  assert.match(code, /client\.stageRoute\(\{ \.\.\.payload, facelets: toMethodFrame\(payload\.facelets\) \}\)/,
    'every question to the engine is turned at its one door');
  const race = blockAt(code, 'async function lastRoute(target, facelets, signal, wholeDone)');
  assert.ok(race, 'the race must take the cube as held and turn it itself');
  assert.match(race,
    /const cubie = fromCube\(cubejs\(\)\.fromString\(toMethodFrame\(facelets\)\)\);/,
    'the replay judges every source against the white cross');
  assert.match(race, /renameAlg\(state\.cube\.solution, METHOD_FRAME\)/,
    'the pool\'s scan-frame solution is renamed before its prefix is scanned on the method frame');
  assert.match(race, /renameAlg\(last\.alg, METHOD_TO_SCAN\)/, 'and the answer leaves in the scan frame');
  // The lesson crosses the same two lines.
  assert.match(code, /solveByMethod\(fromCube\(Cube\.fromString\(toMethodFrame\(c\.facelets\)\)\), method\)/,
    'the lesson is built white-first too');
  assert.match(code, /const walk = scanFrameWalk\(result\.steps\);/, 'and walked in the scan frame, each step played in its hold');
  assert.match(code, /renameSelectors\(convertSelectors\(spec, step\.hold\), METHOD_TO_SCAN\)/, 'its cues name pieces the renderer can find');
  assert.match(code, /focus: cue\(cues\.focus\)/);
  assert.match(code, /highlight: cue\(cues\.highlight\)/);
  // And what a child reads is named for how they are holding it — after a regrip, too.
  assert.match(code, /renameAlg\(m, moveHoldAt\(from \+ k\)\)/, 'every chip is named for the hold its move is made in');
});

test('the race keeps its last route through the one helper that does, not a copy of it', () => {
  // `routeToTarget` in lib/stage-route.js is exactly "the last route the race yields". The screen
  // consumed the generator by hand to get the same thing, and two copies of one loop drift apart.
  const race = blockAt(code, 'async function lastRoute(target, facelets, signal, wholeDone)');
  assert.match(race, /await routeToTarget\(target, cubie, deps\)/,
    'the race must keep its answer through routeToTarget');
  assert.doesNotMatch(code, /for await \(const \w+ of routesToTarget\(/,
    'nothing in the app may walk the race\'s generator by hand to keep its last route');
});

test('the chips report distances, and never what the child was doing', () => {
  // §1, and the repository has a rule with this name. A cube carries no history: `SOLVED·U`
  // satisfies the top cross whether it came from a finished stage or from somebody's scramble, so
  // "you were working on the cross" would be inventing data.
  const FORBIDDEN = /you were (?:working|doing)|last stage|were up to|your stage/i;
  for (const literal of [...app.matchAll(/'([^'\n]{8,})'/g)].map((m) => m[1])) {
    assert.ok(!FORBIDDEN.test(literal), `"${literal}" reports an intention the cube cannot carry`);
  }
});

// ---- what an audit found, and what now stops it coming back --------------------------------------

test('a repair is offered only for a scan that is still believed', () => {
  // §9a is structural: no repair runs on a read the scanner did not accept. Asserting that the
  // painter is not CALLED from the refusal branch was half of it — the other half is that a card
  // already on screen goes away when a refusal arrives, and an audit reproduced the gap: the Solve
  // button went disabled while the repair card stayed visible and its chips stayed pressable.
  assert.match(blockAt(code, 'function dropStageChips()'), /stageGen \+= 1;[\s\S]*?card\.hidden = true;/,
    'one helper must both invalidate the answers in flight and take the row away');
  const invalid = blockAt(code, "panel.addEventListener('scan-invalid'");
  assert.match(invalid, /refusal\.refuse\(\)/, 'a scan the SCANNER refused takes the card with it');
  assert.match(blockAt(code, 'const refuse = (say = null) =>'), /dropStageChips\(\);/,
    'which is what refusing does');
  assert.match(code, /if \(!p\.complete \|\| refused\) dropStageChips\(\);/,
    'and so does a scan this screen refused — `complete` survives a refusal, so it cannot be the only test');
  const click = blockAt(code, "$('#stageChips', root)?.addEventListener('click'");
  assert.match(click, /if \(isRefused\(\)\) return;/, 'and a press over a refused read does nothing');
  assert.match(code, /isRefused: \(\) => refusal\.isRefused\(\)/,
    'which the row asks of the screen, whose verdict a refusal is');
});

test('a chip answer is about the cube it was asked about, not merely the cube of its generation', () => {
  // A smart-cube snapshot can replace the subject without touching the generation or the DOM.
  // Reproduced by an audit: scan `R`, report `R F`, and the cross chip still read 1 where the
  // distance had become 2. The freshness test compares the CUBE as well.
  const painter = blockAt(code, 'async function paintStageChips(facelets)');
  assert.match(painter, /state\.cube\.facelets === facelets/,
    'the answer must be discarded when the subject is no longer the cube the question was about');
});

test('a repair survives a whole-cube search that failed', () => {
  // The three sources of §4 are independent, and the code has to be too: the exact search runs on
  // the worker and knows nothing about the two-phase pool. An audit reproduced the coupling — a
  // cube whose cross repair was one move showed "could not work it out" because an unrelated
  // whole-cube solve had thrown.
  const search = blockAt(code, 'function startWholeSearch(');
  assert.match(search, /failure = err;/, 'the whole-cube failure must be captured rather than thrown out of the load');
  assert.match(search, /if \(failure !== null\) throw failure;/,
    '…and handed on only to a caller that asks for the whole-cube answer, so it never hides a repair');
  // AND THE ABANDONED SEARCH MUST STOP TALKING. It kept reporting improvements into the status
  // line after a repair had committed, so "your cube is already at the two bottom layers" became
  // "7" — found by the browser suite, which is the only place that could see it.
  assert.match(search, /const heard = \(\) => fresh\(\) && !abort\.signal\.aborted;/,
    'a search nobody is waiting for may not write the count of the thing that replaced it');
  assert.match(search, /onImprovement: \(step\) => \{ if \(heard\(\)\) setStatus/, 'and its improvements ask');
  assert.match(search, /done\.catch\(\(\) => \{\}\);/,
    'and the promise nobody may be left to await must never be an unhandled rejection');
  const solve = blockAt(code, 'async function solveWalk(');
  assert.match(solve, /const whole = startWholeSearch\(\{ fresh, signal \}\);/,
    'the whole-cube search is started, not awaited');
  assert.match(solve, /\} finally \{\s*\n\s*whole\.stop\(\);\s*\n\s*\}/,
    'every exit calls it off — a repair that answered, and a throw — rather than leaving four million'
    + ' nodes running for nobody');
  // AND THE REPAIR NEVER WAITS FOR IT, AND RUNS FIRST. Awaiting the whole-cube search before the
  // repair made every repair wait one out — including a target the cube was already at.
  const routeAt = solve.indexOf('await lastRoute(');
  const wholeAt = solve.indexOf('await whole.done;');
  assert.ok(routeAt >= 0 && wholeAt >= 0, 'both landmarks must exist, or the order below compares nothing');
  assert.ok(routeAt < wholeAt, 'the repair is asked for before the whole-cube answer is waited on');
  assert.match(code, /pool: async \(\) => \{\s*\n\s*await wholeDone;/,
    'and the pool source awaits it, rather than reading a solution that has not landed yet');
});

test('every walk reload starts from the cube in hand — BEFORE anything is drawn', () => {
  // §5's own correction, applied to the retarget path. `liveMove` advances the local model on every
  // reported turn while the subject waits for a snapshot, so a walk rebuilt after a few turns was
  // about a cube that no longer exists — reproduced: scan `R`, turn `U`, ask for the first layer,
  // and the app offered `R'`, which does not reach it on the `R U` cube.
  assert.match(code, /const ahead = follow\.aheadOfSnapshot\(\);\s*\n\s*if \(!scrambling && ahead && chainTrusted\(\) && state\.cube\.isPhysical\) \{/,
    'the adoption waits for a cube that is ahead of its snapshot, trusted, and in a hand');
  assert.match(blockAt(code, 'if (!scrambling && ahead && chainTrusted() && state.cube.isPhysical)'),
    /adoptCube\(now, \{ physical: true, source: 'cube' \}\);/, 'the live model must be adopted, as #resolveBtn already does');
  // `ahead` is the follow tracker's (lib/walk-follow.js), and it is the tracked-turns flag — never a
  // comparison with the subject, which is the defect the flag was introduced to end.
  assert.match(code, /aheadOfSnapshot: \(\) => \(liveMoved && liveModel \? liveModel\.asString\(\) : null\)/,
    'the model is ahead only when it holds turns no snapshot has confirmed');
  // `liveMoved`, and it is the fact both defects actually needed. Adopting whenever the model
  // merely DIFFERS overwrote a reconnect answer with the previous screen's model — the answer had
  // just established the truth, and the model belonged to the cube before it.
  assert.match(code, /liveMoved = true;/, 'a tracked turn is what sets it');
  // Asserted on the BLOCK, not on a trailing comment: `code` is comment-stripped, so a regex
  // reaching for the explanation matches nothing however right the code is.
  const snapshot = blockAt(code, 'const liveUpdate = (f, serial) =>');
  assert.match(snapshot, /liveMoved = false;/,
    'and a snapshot clears it: the model is no longer ahead of anything');
  assert.match(code, /adoptCube\(now, \{ physical: true, source: 'cube' \}\);\s*\n[\s\S]{0,400}?state\.live = now;/,
    'and `live` with it, or the next mount refuses to follow a walk that starts where the cube is');

  // `isPhysical`, and it is load-bearing. `chainTrusted()` is about the CONNECTION; a generated
  // subject — the die's cube — is not the cube in anybody's hand, and adopting a connected cube's
  // position over it would throw the rolled cube away.
  assert.match(code, /chainTrusted\(\) && state\.cube\.isPhysical/,
    'a generated subject must not be overwritten by the cube on the desk');

  // EVERY RELOAD, not only the selector's. Gating it on the selector left the Solution/Lesson
  // switch reseeding `liveModel` from the last SNAPSHOT, which silently rewound the model past the
  // turns since it — so the next target press had nothing left to notice. Reproduced by a verify
  // pass on that gate.
  assert.doesNotMatch(code, /fromSelector/,
    'the gate is gone: a reload that does not adopt first LOSES the turns it should have captured');

  // THE ORDER, and it is the whole of the fix. The first attempt adopted INSIDE the search, which
  // left two things describing the older cube: `beginWalk` had already painted the net, and the
  // whole-cube locals had already been read off `state.cube` — so a repair that then found nothing
  // committed the PREVIOUS cube's algorithm over the new subject. Reproduced by a verify pass:
  // subject `R U`, algorithm `R'`, steps starting at `R`.
  // Read from the function that owns the ORDER. `loadWalk` is the reporting bracket around it since
  // 2026-09-16 — every part of a load is inside one try now, not just the search — and a scan that kept
  // reading the bracket would have passed over a `runLoad` that did these in any order at all.
  assert.match(blockAt(code, 'async function loadWalk('), /await runLoad\(/,
    'loadWalk must delegate to the function this case reads, or this scan reads nothing');
  const load = blockAt(code, 'async function runLoad(');
  const adoptAt = load.indexOf('adoptTurnsAhead();');
  const beginAt = load.indexOf('beginWalk();');
  // The whole-cube answer is read inside the resolver (lib/walk-resolver.js), which loadWalk awaits here.
  const readAt = load.indexOf('await resolveWalk(');
  assert.ok(adoptAt > 0 && beginAt > 0 && readAt > 0, 'all three landmarks must exist');
  assert.ok(adoptAt < beginAt, 'the subject must be adopted before the screen is painted for it');
  assert.ok(adoptAt < readAt, 'and before the whole-cube answer is read off it');
  // BEFORE, NOT INSIDE — and the difference is not visible to an index comparison. Moving the
  // adoption up by brace-matching put `beginWalk()` INSIDE the `if`, so a walk was painted only
  // when a trusted cube happened to be ahead of the subject. Every ordering assertion above still
  // passed. The indentation is what tells them apart, so the indentation is what is asserted.
  assert.match(load.slice(0, beginAt + 20), /\n {4}beginWalk\(\);/,
    "beginWalk must sit at the function's own indentation, not inside the adoption branch");
  assert.match(load.slice(0, adoptAt + 20), /\n {4}adoptTurnsAhead\(\);/,
    "the adoption is its own call at the function's own indentation");
  assert.match(blockAt(code, 'function adoptTurnsAhead()'), /\n {8}adoptCube\(now,/,
    'and the adoption two levels in, inside its own guard');
});

test('a cube that the adoption FINISHES gets a rebuild, not an error', () => {
  // Turning `R'` after a scanned `R` leaves a solved cube, which has no walk at all — so the
  // composition this screen was built for is gone, and `deriveCube` would throw "nothing to walk",
  // reaching the child as "could not work it out" about a cube that is done. Reproduced by a
  // verify pass. A composition change is a rebuild, which is what the live-snapshot path in this
  // same file already does with one.
  const load = blockAt(code, 'async function runLoad(');
  // UNCONDITIONAL. Nesting it inside the adoption was the bug: a snapshot that had already ingested
  // the solved cube made the adoption a no-op, so the check never ran and the defect came back by
  // another path — reproduced twice, which is what a guard placed inside a branch earns.
  assert.match(load, /\n {4}if \(compositionGone\(\)\) return false;/,
    'the composition check must sit outside the adoption branch, at the function\'s own level');
  const gone = blockAt(code, 'function compositionGone()');
  assert.match(gone, /const after = classifyCube\(\);/, 'and it classifies the cube as it is now');
  // DEFERRED past any refresh already running: `refreshScreen` guards itself with `refreshing`, so
  // calling it from a load that `refreshScreen` itself started is swallowed — and `update()` has
  // reported success by then, so no rebuild happens at all.
  assert.match(gone, /queueMicrotask\(\(\) => \{ if \(!stale\(\)\) refreshScreen\(\); \}\);/,
    'the rebuild must outlive the refresh that may be running around this load');
});

test('a stage reply is believed only if it IS a stage reply', () => {
  // The worst thing this feature could do, and it took a worker without the request kind to do it:
  // the inline fallback answered a repair as an ordinary two-phase solve, and a WHOLE-CUBE
  // algorithm came back tagged as an exact answer. It replays, it reaches the target — solved is
  // inside every target — so every downstream check passed and the screen would have called it
  // the shortest way back. Validation is in `solve-client.js`; app.js must not undo it by reading
  // fields off an unchecked reply.
  const client = readFileSync(new URL('../lib/solve-client.js', import.meta.url), 'utf8');
  assert.match(client, /function stageReply\(reply, want, target\)/, 'the reply must be validated by shape');
  assert.match(client, /if \(worker\?\.inline === true\)/,
    'and a main-thread worker must be refused before a repair is posted to it — §8 is not negotiable');
  assert.match(client, /want, target, facelets, nodeBudget, maxDepth, kind: SOLVE_TO_STATE,/,
    'the protocol assigns the kind LAST, so a payload field cannot overwrite it');
});
