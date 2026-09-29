// One drill attempt, end to end against fed reports — plan phase 1, items 1.1 to 1.7.
//
// Every case here drives the controller the way `cube-reports.js` drives it: a snapshot, then moves,
// each with a serial. Most of them assert something that must NOT happen — no cue, no completion, no
// time — because that is the whole risk of this feature: a drill that accuses a child who did it
// right is worse than a drill that says nothing.
import assert from 'node:assert/strict';
import test from 'node:test';

import { ALG_ENTRIES, entryById } from '../lib/alg-catalogue.js';
import { MIN_TIMEABLE_REPORTS, TOO_SHORT, UNNUMBERED, UNSOLVED, createDrillAttempt } from '../lib/drill-attempt.js';
import { SOLVED, applyAlg, invert, movesOf, toFacelets } from '../lib/cube-pieces.js';
import { METHOD_FRAME, METHOD_TO_SCAN, holdForStage, holdSpec, renameAlg } from '../lib/solving-hold.js';

const SOLVED_FACELETS = toFacelets(SOLVED);
const facelets = (alg) => toFacelets(applyAlg(SOLVED, alg));
const SCRAMBLED = facelets("R U2 F' D B2 L' U");
const sune = entryById('sune');

/**
 * Where the cube stands once the page's step 2 is done: the case the algorithm answers, in the
 * CUBE's frame.
 *
 * This is what "the start of the drill" means now, and it is the arrangement a scrambled seed used
 * to stand in for. Computed from the entry rather than written out, because a hand-written facelet
 * string is a second source of truth for the same fact.
 */
const caseOf = (entry) => toFacelets(applyAlg(SOLVED, invert(entry.scanAlg)));
const SUNE_CASE = caseOf(sune);

/** A recorder: every event the attempt emitted, in order. */
function collect() {
  const events = [];
  return { events, onEvent: (e) => events.push(e), kinds: () => events.map((e) => e.kind) };
}

/** Feed an attempt a sequence in the CUBE's frame, numbering the reports consecutively. */
function feed(attempt, alg, { from = 10, stamp = 1000, step = 400 } = {}) {
  movesOf(alg).forEach((notation, i) => {
    attempt.move({ notation, serial: (from + i) & 0xff, cubeTimestamp: stamp + i * step, timestamp: stamp + i * step });
  });
}

/**
 * The default rig: trusted, numbered, no clock — seeded SOLVED and SET UP, so it hands back an
 * attempt standing at the start of the solve.
 *
 * THE SET-UP IS PART OF THE RIG BECAUSE IT IS PART OF THE PAGE. Every case below except the ones
 * named for step 1 is about the solve, and each would otherwise have to perform seven turns of
 * preamble before saying anything.
 *
 * THE SERIALS COUNT BACKWARDS FROM `seedSerial`, so the last set-up report is `seedSerial` and the
 * solve's first turn is `seedSerial + 1`. That keeps every case's own numbering — reports from 10,
 * a wrap driven from 253 — meaning exactly what it did when there was no set-up phase, instead of
 * each one having to know how long its entry's set-up happens to be.
 *
 * `setUp: false` hands back an attempt at the START of the set-up, for the cases that drive step 2
 * themselves or that are about the seed's own numbering.
 */
function rig({
  entry = sune, trusted = true, numbers = true, clock = false,
  seed = SOLVED_FACELETS, seedSerial = 9, now, setUp = true,
} = {}) {
  const c = collect();
  let isTrusted = trusted;
  const attempt = createDrillAttempt({
    entry,
    chainTrusted: () => isTrusted,
    numbersMoves: () => numbers,
    clock,
    onEvent: c.onEvent,
    ...(now ? { now } : {}),
  });
  const steps = setUp ? movesOf(invert(entry.scanAlg)) : [];
  const first = Number.isFinite(seedSerial) ? (seedSerial - steps.length) & 0xff : seedSerial;
  if (seed) attempt.facelets(seed, first);
  steps.forEach((notation, i) => {
    const serial = Number.isFinite(first) ? (first + 1 + i) & 0xff : undefined;
    attempt.move({ notation, serial, cubeTimestamp: 100 + i * 50, timestamp: 100 + i * 50 });
  });
  // The set-up's own events are dropped so `kinds()` describes what the CASE drove. Conditional on
  // the phase having actually changed, never on `setUp` being asked for: an untrusted or unsolvable
  // rig never reaches the solve, and clearing there would hide the refusal the case is checking.
  if (attempt.phase === 'solve') c.events.length = 0;
  return { attempt, ...c, untrust: () => { isTrusted = false; } };
}

// ---- 1.2 readiness ------------------------------------------------------------------------------

test('a single seeding snapshot and then only moves arms and completes', () => {
  const { attempt, kinds } = rig();
  assert.equal(attempt.state, 'ready');
  feed(attempt, sune.scanAlg);
  assert.equal(attempt.state, 'done');
  assert.ok(!kinds().includes('uncertain'), 'a correct execution raised uncertainty');
  assert.ok(!kinds().includes('off'), 'a correct execution was called wrong');
});

test('an untrusted chain never arms', () => {
  const { attempt, kinds } = rig({ trusted: false });
  assert.notEqual(attempt.state, 'ready');
  assert.deepEqual(kinds(), ['ended']);
  feed(attempt, sune.scanAlg);
  assert.equal(attempt.state, 'ended');
});

test('trust lapsing mid-attempt ends it, with no verdict', () => {
  const { attempt, kinds, untrust } = rig();
  feed(attempt, 'R D', { from: 10 });
  untrust();
  attempt.move({ notation: "R'", serial: 12, cubeTimestamp: 2000 });
  assert.equal(attempt.state, 'ended');
  assert.ok(!kinds().includes('done'), 'an attempt across a trust lapse still completed');
});

// ---- 1.3 a chosen algorithm, from wherever the cube is -------------------------------------------

test('every entry is shown in its stage hold, and the frames are declared', () => {
  for (const e of ALG_ENTRIES) {
    assert.equal(e.hold, holdSpec(holdForStage(e.stage)), `${e.id}: not its stage's hold`);
    assert.equal(e.frame, holdSpec(METHOD_FRAME), `${e.id}: frame not declared`);
    assert.equal(e.scanAlg, renameAlg(e.alg, METHOD_TO_SCAN), `${e.id}: scan frame disagrees`);
    // The plan's "shown as written" holds wherever the hold IS the method frame, and the hold wins
    // where it is not — the two white-up stages, where a child turns R D R' and not R U R'.
    if (e.hold === holdSpec(METHOD_FRAME)) assert.equal(e.shown, e.alg, `${e.id}: a tumbled entry was relabelled`);
    else assert.notEqual(e.shown, e.alg, `${e.id}: a white-up entry was not relabelled into its hold`);
  }
});

test('the track accepts the cube frame and REFUSES the same letters unconverted', () => {
  // The conversion failing must be loud. Sune's letters differ between the frames, so feeding the
  // written ones walks arrangements the cube never visits.
  const good = rig();
  feed(good.attempt, sune.scanAlg);
  assert.equal(good.attempt.state, 'done');

  const bad = rig();
  feed(bad.attempt, sune.alg);
  assert.notEqual(bad.attempt.state, 'done', 'unconverted letters completed the drill');
  assert.ok(bad.kinds().includes('off'), 'unconverted letters were not even noticed');
});

test('a drill arms only from a solved cube, and says why when it will not', () => {
  // THE PAGE'S STEP 1 IS A PRECONDITION, NOT A SUGGESTION. "Your cube ends solved, that is how you
  // know you got it right" holds only of a cube that began solved, and set-up turns performed on a
  // scrambled cube reach no case at all — so arming there judges the child against a premise the
  // screen never made.
  const ok = rig({ setUp: false });
  assert.equal(ok.attempt.state, 'ready');
  assert.equal(ok.attempt.phase, 'setup');

  for (const seed of [SCRAMBLED, facelets("R U R' U' F'")]) {
    const { attempt, events } = rig({ seed, setUp: false });
    assert.notEqual(attempt.state, 'ready', 'an unsolved cube armed a drill');
    assert.equal(events.at(-1).why, UNSOLVED, 'it refused without saying why');
    // SAID ONCE. A camera sends a snapshot about once a second and the answer cannot change until
    // the child turns something, so repeating it would be a screen talking over itself.
    const said = events.length;
    attempt.facelets(seed, 10);
    assert.equal(events.length, said, 'the refusal was repeated for every snapshot');
    // And a cube solved AFTERWARDS arms the drill, with nothing asked of the screen — which is why
    // the refusal leaves the seed unset rather than ending the attempt.
    attempt.facelets(SOLVED_FACELETS, 11);
    assert.equal(attempt.state, 'ready', 'a cube solved after the refusal never armed');
    assert.equal(attempt.phase, 'setup');
  }
});

test('the finish is a SOLVED cube, which is what the page promises', () => {
  // REVERSED WITH DECISION 1 (owner, 2026-09-29). The drill used to finish wherever the algorithm
  // landed from an arbitrary seed; it now starts solved and ends solved, which is the one check a
  // child can make without the app.
  const { attempt } = rig();
  feed(attempt, sune.scanAlg);
  assert.equal(attempt.state, 'done');
  assert.equal(attempt.view.solvedAtEnd, true, 'the drill did not finish on a solved cube');
});

// ---- 1.4 continuity before judgment --------------------------------------------------------------

test('a dropped report is tracking uncertainty, never a wrong turn', () => {
  const { attempt, events, kinds } = rig();
  // R U performed; report 11 never arrives; the next report is serial 12.
  attempt.move({ notation: 'R', serial: 10, cubeTimestamp: 1000 });
  attempt.move({ notation: 'D', serial: 12, cubeTimestamp: 1800 });
  assert.equal(attempt.state, 'uncertain');
  assert.ok(!kinds().includes('off'), 'a missing report was reported as a wrong turn');
  assert.equal(events.at(-1).why, 'dropped-report');
});

test('a genuine wrong turn, with continuity intact, is caught on the turn it happened', () => {
  const { attempt, events } = rig();
  attempt.move({ notation: 'R', serial: 10, cubeTimestamp: 1000 });   // sune's first, correct
  attempt.move({ notation: 'F', serial: 11, cubeTimestamp: 1400 });   // not on the track
  assert.equal(attempt.state, 'off');
  assert.equal(events.at(-1).kind, 'off');
});

test('the SOUND fires once per excursion; the instruction follows every turn of it', () => {
  // Two different things, and conflating them cost the child a correct instruction. Suppressing
  // the repeat entirely froze the undo at the first wrong turn, so after a second one the screen
  // named a move that no longer reaches the track.
  const { attempt, events } = rig();
  attempt.move({ notation: 'F', serial: 10, cubeTimestamp: 1000 });
  attempt.move({ notation: 'B', serial: 11, cubeTimestamp: 1400 });
  attempt.move({ notation: 'L', serial: 12, cubeTimestamp: 1800 });
  const off = events.filter((e) => e.kind === 'off');
  assert.equal(off.filter((e) => e.sound).length, 1, 'the cue sounded more than once in one excursion');
  assert.equal(off.length, 3, 'the instruction stopped following the excursion');
  assert.notEqual(off[0].recovery, off[2].recovery, 'the undo did not change as the child went further off');
});

test('a snapshot that puts the cube back on the track ends the excursion', () => {
  const { attempt, events } = rig();
  attempt.move({ notation: 'F', serial: 10, cubeTimestamp: 1000 });
  assert.equal(attempt.state, 'off');
  attempt.facelets(SUNE_CASE, 11);                       // back where it started, on the track
  assert.notEqual(attempt.state, 'off', 'the attempt is still describing a deviation it has left');
  assert.equal(events.at(-1).at, 0, 'the transition carried no progress');
});

test('every progress-bearing event carries its numbers, from either input', () => {
  // A `running` emitted bare made the screen print its own placeholders: the sentence is
  // "%1 of %2 turns." and there was no %1.
  const { attempt, events } = rig();
  attempt.movesLost();
  attempt.facelets(SUNE_CASE, 20);
  feed(attempt, 'R D', { from: 21 });
  for (const e of events.filter((x) => ['running', 'progress'].includes(x.kind))) {
    assert.equal(typeof e.at, 'number', `a ${e.kind} event carried no position`);
    assert.equal(typeof e.of, 'number', `a ${e.kind} event carried no length`);
  }
});

test('a serial wrapping 255 to 0 raises nothing', () => {
  // SEEDED AT 252 so the first move's 253 is consecutive. Seeded at 9, the jump to 253 is itself a
  // 244-step discontinuity — which the attempt is now right to refuse, and which would make this
  // case pass or fail for a reason that has nothing to do with the wrap it is named for.
  const { attempt, kinds } = rig({ seedSerial: 252 });
  const moves = movesOf(sune.scanAlg);
  moves.forEach((notation, i) => {
    attempt.move({ notation, serial: (253 + i) & 0xff, cubeTimestamp: 1000 + i * 400 });
  });
  assert.equal(attempt.state, 'done');
  assert.ok(!kinds().includes('uncertain'), 'the wraparound read as a dropped report');
});

test('a lost turn the connection reports is uncertainty too', () => {
  const { attempt, kinds } = rig();
  attempt.move({ notation: 'R', serial: 10, cubeTimestamp: 1000 });
  attempt.movesLost();
  assert.equal(attempt.state, 'uncertain');
  assert.ok(!kinds().includes('off'));
});

// ---- 1.5 what the cue may say ---------------------------------------------------------------------

test('the recovery actually recovers, and undoing only the latest turn would not', () => {
  // Planned `R2`, so a single `R` is a legitimate midpoint — then two turns that are not.
  //
  // HELD `U F`, WHICH IS WHY THE REPLAY BELOW IS VALID. A recovery is CHECKED in the cube's frame
  // and SAID in the child's, so `applyAlg(base, recovery)` only means anything where the two frames
  // agree: `showMove(m, ['U', 'F'])` is the identity, while sune's own `D B` swaps U with D and F
  // with B. Replaying held letters against cube-frame arrangements is the ADR 0004 trap, and the
  // pair of `notEqual`s this case used to end with could not tell that it had fallen in. The
  // non-identity branch is the case named for the face under the child's hand, further down.
  const entry = {
    ...sune, id: 'r2-then-u', alg: 'R2 U', scanAlg: renameAlg('R2 U', METHOD_TO_SCAN), shown: 'R2 U', hold: 'U F',
  };
  assert.equal(entry.scanAlg, 'R2 D', 'precondition: this fixture\'s letters in the cube frame');
  const { attempt, events } = rig({ entry });
  attempt.move({ notation: 'R', serial: 10, cubeTimestamp: 1000 });   // midpoint of R2: silent
  assert.notEqual(attempt.state, 'off', 'a midpoint was called a wrong turn');
  attempt.move({ notation: 'U', serial: 11, cubeTimestamp: 1400 });
  attempt.move({ notation: 'F', serial: 12, cubeTimestamp: 1800 });
  assert.equal(attempt.state, 'off');

  const { recovery } = events.at(-1);
  assert.ok(recovery, 'no recovery was offered');
  // Verified by REPLAY, from where the SET-UP left the cube — and asserted as an EQUALITY. The two
  // `notEqual`s this replaces were computed from the old scrambled seed, so after the set-up phase
  // landed the cube somewhere else they compared two arrangements that were both wrong and still
  // came out unequal: the case passed while proving nothing (representative's review, 2026-09-29).
  const base = applyAlg(SOLVED, invert(entry.scanAlg));
  const back = toFacelets(applyAlg(base, `R U F ${recovery}`));
  assert.equal(back, toFacelets(base), 'the recovery did not land the cube back on the track');
  // And the naive answer — undo the latest turn only — does NOT reach the same place.
  const naive = toFacelets(applyAlg(base, "R U F F'"));
  assert.notEqual(naive, back, "undoing only the latest turn recovered, so this case proves nothing");
});

test('no recovery is offered when tracking was lost — the screen asks for the cube instead', () => {
  const { attempt, events } = rig();
  attempt.move({ notation: 'R', serial: 10, cubeTimestamp: 1000 });
  attempt.move({ notation: 'D', serial: 15, cubeTimestamp: 1800 });   // a gap
  assert.equal(attempt.state, 'uncertain');
  assert.equal(events.at(-1).recovery, undefined, 'a recovery was invented across a gap');
});

test('a snapshot brings an uncertain attempt back', () => {
  const { attempt } = rig();
  attempt.movesLost();
  assert.equal(attempt.state, 'uncertain');
  attempt.facelets(SUNE_CASE, 20);
  assert.equal(attempt.state, 'ready');
  feed(attempt, sune.scanAlg, { from: 21 });
  assert.equal(attempt.state, 'done');
});

// ---- 1.6 trust, not numbering ---------------------------------------------------------------------

test('a cube that numbers nothing is tracked and never accused', () => {
  const { attempt, kinds } = rig({ numbers: false });
  // Every event without a serial, as an unnumbered session really delivers them.
  attempt.move({ notation: 'F', cubeTimestamp: 1000 });
  attempt.move({ notation: 'B', cubeTimestamp: 1400 });
  assert.ok(!kinds().includes('off'), 'an unnumbered cube produced an accusation');
  assert.ok(!kinds().includes('uncertain'), 'an unnumbered cube produced a gap it cannot detect');
});

test('an unnumbered cube still completes, and still has no time', () => {
  // The Timer screen's rule, not a new one: with no serial, solve-timer's dropped-move refusals are
  // inert, so a span would be reported with nothing able to say a turn went missing.
  const { attempt, events } = rig({ numbers: false, clock: true });
  assert.equal(attempt.timing.on, false);
  assert.equal(attempt.timing.refusal, UNNUMBERED);
  movesOf(sune.scanAlg).forEach((notation, i) => attempt.move({ notation, cubeTimestamp: 1000 + i * 400 }));
  assert.equal(attempt.state, 'done', 'an unnumbered cube must still be able to finish a drill');
  assert.equal(events.at(-1).time, null, 'an unnumbered cube was given a time');
  assert.equal(events.at(-1).refusal, UNNUMBERED);
});

test('four fixtures that must produce no alert, no completion and no time', () => {
  const cases = [
    { what: 'a connection awaiting confirmation', opts: { trusted: false } },
    { what: 'no connection at all', opts: { trusted: false, numbers: false } },
    { what: 'an assigned-side scan', opts: { trusted: false, seed: SCRAMBLED } },
  ];
  for (const { what, opts } of cases) {
    const { attempt, kinds } = rig({ clock: true, ...opts });
    feed(attempt, sune.scanAlg);
    assert.ok(!kinds().includes('off'), `${what}: raised an alert`);
    assert.ok(!kinds().includes('done'), `${what}: completed`);
  }
  // And the fourth: trust lost part way through.
  const { attempt, kinds, untrust } = rig({ clock: true });
  feed(attempt, 'R D', { from: 10 });
  untrust();
  attempt.move({ notation: "R'", serial: 12, cubeTimestamp: 2000 });
  assert.ok(!kinds().includes('done'), 'trust lost mid-execution still completed');
});

// ---- 1.7 the clock ---------------------------------------------------------------------------------

test('with the clock off, no time is computed and none is claimed', () => {
  const { attempt, events } = rig({ clock: false });
  assert.equal(attempt.timing.on, false);
  assert.equal(attempt.timing.refusal, null, 'the toggle being off is not a refusal to explain');
  feed(attempt, sune.scanAlg);
  assert.equal(events.at(-1).kind, 'done');
  assert.equal(events.at(-1).time, null);
  assert.equal(events.at(-1).refusal, null);
});

test('with the clock on, the SOLVE is timed and the set-up is not', () => {
  const { attempt, events } = rig({ clock: true, now: () => 0 });
  assert.equal(attempt.timing.on, true);
  feed(attempt, sune.scanAlg, { stamp: 1000, step: 400 });
  assert.equal(attempt.state, 'done');
  const { time } = events.at(-1);
  assert.ok(time, 'a timed attempt reported no time');
  // THE SET-UP IS NOT IN THE TIME. The rig stamps its set-up reports from 100ms and the solve from
  // 1000ms, so a clock armed at the seed would read about 3.3s here instead of 2.4s, and would
  // count fourteen turns instead of seven. Building the case is work the child does BEFORE the
  // thing being timed — the same reason a solve is not timed from the scramble.
  assert.equal(time.moves, movesOf(sune.scanAlg).length, 'the clock counted the set-up\'s turns');
  // Six gaps of 400ms between sune's seven moves — the first move's own duration is the documented
  // bias, and it is missing here exactly as it is in a solve.
  assert.equal(time.ms, 2400);
});

test('one stamped report is too short to time, and says so rather than blaming the clock', () => {
  // MEASURED, not predicted. The first build refused `drop-in` on the strength of its spelling —
  // one token — and was wrong: `F2` is two physical quarter turns and a cube stamps both. What
  // actually has no span is a stream that delivered ONE stamp, which is what this drives.
  assert.equal(MIN_TIMEABLE_REPORTS, 2);
  const dropIn = entryById('drop-in');
  const { attempt, events } = rig({ entry: dropIn, clock: true, now: () => 0 });
  movesOf(dropIn.scanAlg).forEach((notation, i) => {
    attempt.move({ notation, serial: (10 + i) & 0xff, ...(i === 0 ? { cubeTimestamp: 1000 } : {}) });
  });
  assert.equal(attempt.state, 'done', 'a drill that cannot be timed must still finish');
  const last = events.at(-1);
  assert.equal(last.time, null);
  assert.equal(last.refusal, TOO_SHORT);
  assert.ok(!/clock reset/.test(last.refusal), 'the false clock-reset wording reached a drill');
});

test('and the same entry IS timed when the cube reports both of its quarter turns', () => {
  // The other side of the correction, and it needs a REAL report stream: a cube does not send
  // `B2`, it sends B and then B. The first is a midpoint of the half turn and the second lands.
  const dropIn = entryById('drop-in');
  assert.equal(dropIn.scanAlg, 'B2', 'precondition: one token, two physical turns');
  const { attempt, events } = rig({ entry: dropIn, clock: true, now: () => 0 });
  attempt.move({ notation: 'B', serial: 10, cubeTimestamp: 1000 });
  attempt.move({ notation: 'B', serial: 11, cubeTimestamp: 1500 });
  assert.equal(attempt.state, 'done');
  const { time } = events.at(-1);
  assert.ok(time, 'a two-quarter-turn algorithm was refused a time');
  assert.equal(time.ms, 500);
});

// ---- 1.1 one owner, one attempt ----------------------------------------------------------------------

test('a disposed attempt emits nothing, whatever arrives late', () => {
  const { attempt, kinds } = rig({ clock: true });
  feed(attempt, 'R D', { from: 10 });
  const before = kinds().length;
  attempt.dispose();
  feed(attempt, "R' D R D2 R'", { from: 12 });
  attempt.facelets(SOLVED_FACELETS, 40);
  attempt.trustLost();
  assert.equal(kinds().length, before, 'a disposed attempt kept emitting');
});

test('selecting another algorithm cannot be completed by the first one\'s reports', () => {
  const a = rig({ clock: true });
  feed(a.attempt, 'R D', { from: 10 });
  a.attempt.dispose();                                    // the screen swaps to B
  const b = rig({ entry: entryById('antisune'), clock: true });
  // A's remaining reports arrive. They belong to a sequence B is not drilling.
  feed(a.attempt, "R' D R D2 R'", { from: 12 });
  assert.ok(!a.kinds().includes('done'), 'the disposed attempt completed');
  assert.ok(!b.kinds().includes('done'), "A's reports completed B");
  assert.ok(!b.kinds().includes('off'), "A's reports accused B");
});

test('a duplicated finishing snapshot produces exactly one completion', () => {
  const { attempt, kinds } = rig();
  feed(attempt, sune.scanAlg);
  const end = SOLVED_FACELETS;                            // the set-up then the algorithm: back to solved
  attempt.facelets(end, 30);
  attempt.facelets(end, 31);
  assert.equal(kinds().filter((k) => k === 'done').length, 1);
});

test('the algorithm never changes underneath an attempt in flight', () => {
  const { attempt } = rig();
  const before = attempt.entry.alg;
  feed(attempt, 'R D', { from: 10 });
  assert.equal(attempt.entry.alg, before);
  assert.equal(attempt.view.shown, sune.shown);
});

// ---- what the round-1 audit found (2026-09-27) -----------------------------------------------------

test('a drill that finishes but cannot be timed reports the refusal instead of throwing', () => {
  // `refusal` is a GETTER on the timer. Reading it as a call threw a TypeError on the one path
  // this feature is about, and no case reached it: every test that HAD a refusal had no timer
  // built, so the optional chain short-circuited past the mistake. Here the timer IS built —
  // the clock is on, the cube numbers its turns — and it refuses because no move is stamped.
  const { attempt, events } = rig({ clock: true, now: () => 0 });
  assert.equal(attempt.timing.on, true, 'precondition: a timer was built');
  movesOf(sune.scanAlg).forEach((notation, i) => attempt.move({ notation, serial: (10 + i) & 0xff }));
  assert.equal(attempt.state, 'done');
  const last = events.at(-1);
  assert.equal(last.time, null);
  assert.equal(typeof last.refusal, 'string', 'the refusal did not survive as words');
  // With NO stamps at all the timer's own diagnosis is the true and specific one, so it keeps it.
  assert.match(last.refusal, /timestamp/, 'the refusal is not the one the timer gave');
});

test('a serial that cannot be placed stops judgment — it never accuses', () => {
  // Two shapes of unknown continuity, both of which the first build read as "fine, carry on":
  // a report with no serial at all, and one that is BEHIND the last (stale or replayed).
  for (const [what, second] of [
    ['a missing serial', { notation: 'F', cubeTimestamp: 1400 }],
    ['a backward serial', { notation: 'F', serial: 8, cubeTimestamp: 1400 }],
  ]) {
    const { attempt, kinds } = rig({ seedSerial: 9 });
    attempt.move({ notation: 'R', serial: 10, cubeTimestamp: 1000 });
    attempt.move(second);
    assert.equal(attempt.state, 'uncertain', `${what}: did not stop judgment`);
    assert.ok(!kinds().includes('off'), `${what}: accused the child`);
  }
});

test('an ended attempt stays ended, whatever arrives after', () => {
  // `move()` guarded its terminal states and `facelets()` did not, so an attempt ended by an
  // untrusted snapshot came back to life on the next trusted one — reviving something the app had
  // already declared over.
  const c = collect();
  let trusted = false;
  const attempt = createDrillAttempt({ entry: sune, chainTrusted: () => trusted, numbersMoves: () => true, onEvent: c.onEvent });
  attempt.facelets(SCRAMBLED, 9);
  assert.equal(attempt.state, 'ended');
  trusted = true;
  attempt.facelets(SCRAMBLED, 10);
  assert.equal(attempt.state, 'ended', 'an ended attempt was revived by a later snapshot');
  assert.equal(c.kinds().filter((k) => k === 'ready').length, 0, 'it armed after ending');
});

test('the recovery names the face under the child\'s hand, not the cube\'s own letter', () => {
  // Sune is held `D B`. A wrong scan-frame `F` is the face a child holding that grip calls B, so
  // "undo it with F'" points at the wrong face — the frame confusion ADR 0003 exists to stop,
  // reappearing in a sentence instead of in a track.
  const { attempt, events } = rig();
  assert.equal(sune.hold, 'D B', 'precondition: this entry is held tumbled');
  attempt.move({ notation: 'R', serial: 10, cubeTimestamp: 1000 });
  attempt.move({ notation: 'F', serial: 11, cubeTimestamp: 1400 });
  assert.equal(attempt.state, 'off');
  assert.equal(events.at(-1).recovery, "B'", 'the recovery is in the cube\'s frame, not the hold\'s');
});

test('and on a white-up stage, where the hold IS the scan frame, it is unchanged', () => {
  // The other branch, so the renaming cannot be the identity by accident: a cross entry is held
  // `U F`, and its own letters are what the child turns.
  const cross = ALG_ENTRIES.find((e) => e.stage === 'cross');
  assert.equal(cross.hold, 'U F', 'precondition: this entry is held white up');
  const { attempt, events } = rig({ entry: cross });
  attempt.move({ notation: 'R', serial: 10, cubeTimestamp: 1000 });
  if (attempt.state !== 'off') return;                    // R may be on this short track
  assert.equal(events.at(-1).recovery, "R'");
});

test('a half turn reported as two quarters is two turns to the clock, not one', () => {
  // The timer used to be fed only after a track match, so the first quarter of a half turn — a
  // legitimate midpoint — reached it as nothing. The span and the move count then described a
  // performance nobody gave.
  const entry = { ...sune, id: 'r2', alg: 'R2', scanAlg: renameAlg('R2', METHOD_TO_SCAN), shown: 'R2' };
  const { attempt, events } = rig({ entry, clock: true, now: () => 0 });
  attempt.move({ notation: 'R', serial: 10, cubeTimestamp: 1000 });   // midpoint
  attempt.move({ notation: 'R', serial: 11, cubeTimestamp: 1600 });   // lands
  assert.equal(attempt.state, 'done');
  const { time } = events.at(-1);
  assert.ok(time, 'a two-quarter half turn produced no time');
  assert.equal(time.moves, 2, 'the clock counted the midpoint as nothing');
  assert.equal(time.ms, 600);
});

// ---- what the round-1 VERIFY pass found still open (2026-09-27) ------------------------------------

test('a numbering cube\'s report without a serial cannot be judged', () => {
  // The case the screen actually produces: it seeds with no serial, so `lastSerial` starts null
  // and the first build skipped continuity entirely — an unserialised report could then be called
  // a wrong turn.
  const { attempt, kinds } = rig({ seedSerial: null, setUp: false });
  attempt.move({ notation: 'F', cubeTimestamp: 1000 });        // no serial, on a numbering cube
  assert.equal(attempt.state, 'uncertain');
  assert.ok(!kinds().includes('off'), 'an unplaceable report was called a wrong turn');
});

test('a snapshot that moves the cube along the track says so', () => {
  const { attempt, events } = rig();
  const two = toFacelets(applyAlg(applyAlg(SOLVED, invert(sune.scanAlg)), 'R D'));
  attempt.facelets(two, 11);
  const last = events.at(-1);
  assert.ok(['running', 'progress'].includes(last.kind), `a snapshot advanced the cube silently (${last.kind})`);
  assert.equal(last.at, 2, 'the published position is not where the snapshot put it');
});

test('coming back to a midpoint ends the excursion', () => {
  // A midpoint is ON the track. Left in `off`, the screen kept telling the child to undo a
  // deviation they had already come back from.
  const entry = { ...sune, id: 'r2-then-u', alg: 'R2 U', scanAlg: renameAlg('R2 U', METHOD_TO_SCAN), shown: 'R2 U' };
  const { attempt } = rig({ entry });
  attempt.move({ notation: 'R', serial: 10, cubeTimestamp: 1000 });   // midpoint of R2
  attempt.move({ notation: 'U', serial: 11, cubeTimestamp: 1400 });   // off
  assert.equal(attempt.state, 'off');
  attempt.move({ notation: "U'", serial: 12, cubeTimestamp: 1800 });  // back to the midpoint
  assert.notEqual(attempt.state, 'off', 'the attempt still describes a deviation it has left');
});
