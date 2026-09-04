// What makes an unmet brand honest.
//
// The app ships decoders nobody here owns hardware for, so the question "may this be believed" has
// to be answered by the app rather than by us in advance. Most of these tests are about a verdict
// that must NOT be reached: a wrong decoder must not talk its way to trusted, a refusal must not
// come back, and silence must not be read as either evidence or a fault.
//
// Pure, no DOM. cubejs is the injected oracle, the same one the app uses.

import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import {
  REASON,
  VERDICT,
  createSelfCheck,
  mayFollowMoves,
  maySourceOffset,
  reconciles,
} from '../lib/cube-selfcheck.js';
import { fromCube, rotateState } from '../lib/cube-pieces.js';
import { IDENTITY, deriveOffset } from '../lib/cube-trust.js';

let Cube;
before(async () => {
  Cube = (await import(new URL('../vendor/cubejs.js', import.meta.url).href)).default;
});

/** The state a solved cube reaches after `alg`. */
const after = (alg) => Cube.fromString(IDENTITY).move(alg).asString();

/**
 * The same arrangement as a decoder reading the cube in a rotated frame would report it.
 *
 * A REAL relabelled decoder, not a stand-in: `rotateState` conjugates the whole permutation by a
 * whole-cube y turn, which is exactly what reading the cube from the next face round does. The
 * centres stay put because the decoder still calls its own front "F" — that is what makes the
 * result a legal state in this app's frame rather than a rotated string.
 *
 * The move channel of such a decoder is relabelled the same way: a physical `R` is reported as
 * `B`, per the face map in cube-pieces. So it reconciles perfectly, which is the whole reason a
 * camera check has to exist.
 */
const asSeenFromRotatedFrame = (facelets, quarters = 1) =>
  new Cube({
    center: [0, 1, 2, 3, 4, 5],
    ...rotateState(fromCube(Cube.fromString(facelets)), quarters),
  }).asString();

/** How a physical turn reads in that frame. cube-pieces' Y_FACES, one quarter turn. */
const AS_REPORTED = { U: 'U', D: 'D', F: 'R', R: 'B', B: 'L', L: 'F' };
const relabelMove = (m) => AS_REPORTED[m[0]] + m.slice(1);

describe('reconciles', () => {
  test('accepts a move list that really does lead from one state to the other', () => {
    assert.equal(reconciles(IDENTITY, ['R', 'U'], after('R U'), Cube), true);
  });

  test('rejects one that does not', () => {
    assert.equal(reconciles(IDENTITY, ['R', 'U'], after("R U'"), Cube), false);
  });

  test('rejects a single wrong turn direction — the cheapest real decoder bug', () => {
    assert.equal(reconciles(IDENTITY, ["R'"], after('R'), Cube), false);
  });

  test('answers null when there is nothing to ask about', () => {
    // Two identical consecutive reports with no moves between them say NOTHING about the move
    // channel. Counting that as a pass is how an idle cube certifies a broken decoder.
    assert.equal(reconciles(IDENTITY, [], IDENTITY, Cube), null);
    assert.equal(reconciles(IDENTITY, ['R'], 'not-a-cube', Cube), null);
    assert.equal(reconciles(IDENTITY, ['R'], after('R'), null), null);
  });

  test('treats unparseable notation as a failure, not as an unanswerable question', () => {
    // A decoder emitting something that is not a turn is a fact about the move channel. Reporting
    // "could not ask" would let it slide.
    assert.equal(reconciles(IDENTITY, ['Q7'], after('R'), Cube), false);
  });
});

describe('a decoder that is telling the truth', () => {
  test('reaches stream once its two channels agree, and trusted once the camera does', () => {
    const c = createSelfCheck({ Cube });
    assert.equal(c.onFacelets(IDENTITY), VERDICT.UNKNOWN);
    c.onMove('R');
    c.onMove('U');
    assert.equal(c.onFacelets(after('R U')), VERDICT.STREAM);
    assert.equal(c.reason, REASON.RECONCILED);
    assert.equal(maySourceOffset(c.verdict), false, 'the stream alone must not source the offset');

    // The camera sees the same cube the reports describe.
    assert.equal(c.onCameraScan(after('R U'), after('R U')), VERDICT.TRUSTED);
    assert.equal(c.offset, IDENTITY, 'agreement with no permutation is the identity offset');
    assert.equal(maySourceOffset(c.verdict), true);
  });

  test('a missed turn is offset, not broken — the drift this check exists to repair', () => {
    // The model the offset is derived from: H turns before the break, D turns nobody counted, M
    // turns since. The cube is at H·D·M and reports H·M, so the correction is H·D·H⁻¹ — fixed the
    // moment H and D are, and unmoved by every later turn. Both scans below see the same one.
    const H = "R U F'";
    const D = "L B2 D'"; // untracked, and deliberately not a U/D turn
    const c = createSelfCheck({ Cube });
    c.onFacelets(after(H));
    c.onMove('U');
    c.onMove('R2');
    assert.equal(c.onFacelets(after(`${H} U R2`)), VERDICT.STREAM);
    assert.equal(
      c.onCameraScan(after(`${H} ${D} U R2`), after(`${H} U R2`)),
      VERDICT.TRUSTED,
      'one scan establishes the correction',
    );
    const first = c.offset;
    assert.notEqual(first, IDENTITY, 'a real correction was established');

    // …and it survives further turns on both sides, which is what "constant" means.
    for (const m of ["F'", 'L', 'D']) c.onMove(m);
    c.onFacelets(after(`${H} U R2 F' L D`));
    assert.equal(
      c.onCameraScan(after(`${H} ${D} U R2 F' L D`), after(`${H} U R2 F' L D`)),
      VERDICT.TRUSTED,
    );
    assert.equal(c.offset, first, 'the same correction, unmoved by the turns since');
    assert.equal(c.evidence.offsetResyncs, 0, 'nothing was re-baselined — it never had to be');
  });

  test('needs as many reconciliations as it was asked for, and no fewer', () => {
    const c = createSelfCheck({ Cube, needed: 2 });
    c.onFacelets(IDENTITY);
    c.onMove('R');
    assert.equal(c.onFacelets(after('R')), VERDICT.UNKNOWN, 'one is not two');
    c.onMove('U');
    assert.equal(c.onFacelets(after('R U')), VERDICT.STREAM);
    assert.equal(c.evidence.reconciled, 2);
  });
});

describe('a uniformly relabelled decoder', () => {
  // This file used to carry a test named "a uniformly mislabelled decoder is offset, not broken",
  // and it fed a MISSED-MOVE DRIFT — two states differing by a right multiplication, which is a
  // different situation with a different answer. The claim it was named for was false, and the
  // test could not have found that out because it never built the thing it named.
  //
  // The algebra: a decoder reading the cube from the next face round reports Y⁻¹·P·Y for a
  // physical P, so the correction scanned·reported⁻¹ is P·Y⁻¹·P⁻¹·Y — a commutator, which moves
  // with the cube. Nothing fixed corrects such a decoder, so the honest verdict is a refusal.

  test('the offset moves for every turn that does not commute with the relabelling', () => {
    // The measurement, pinned rather than described. From one fixed scrambled state, all eighteen
    // turns: the correction is constant for exactly the six U and D turns — the ones a y rotation
    // leaves alone — and moves for the other twelve. This is why a single scan can never expose
    // such a decoder and a second one always can, unless the only turn in between was U or D.
    const base = "R U F' L2 B D' R2 U'";
    const constant = [];
    for (const m of ['U', 'U2', "U'", 'R', 'R2', "R'", 'F', 'F2', "F'",
                     'D', 'D2', "D'", 'L', 'L2', "L'", 'B', 'B2', "B'"]) {
      const p1 = after(base);
      const p2 = after(`${base} ${m}`);
      const o1 = deriveOffset(p1, asSeenFromRotatedFrame(p1), Cube);
      const o2 = deriveOffset(p2, asSeenFromRotatedFrame(p2), Cube);
      if (o1 === o2) constant.push(m);
    }
    assert.deepEqual(constant, ['U', 'U2', "U'", 'D', 'D2', "D'"]);
  });

  test('reconciles perfectly, and is still refused by the second scan', () => {
    // Self-consistent by construction: the move channel is relabelled the same way, so replaying
    // the reported turns onto the reported state lands exactly on the next reported state. The
    // stream check therefore passes — it is supposed to — and only contact with the world catches
    // this. Every turn below is a non-commuting one; see the measurement above.
    const c = createSelfCheck({ Cube });
    let physical = IDENTITY;
    const report = () => c.onFacelets(asSeenFromRotatedFrame(physical));
    const turn = (m) => {
      physical = Cube.fromString(physical).move(m).asString();
      c.onMove(relabelMove(m));
    };

    report();
    turn('R');
    assert.equal(report(), VERDICT.STREAM, 'a relabelled decoder reconciles — that is the trap');
    assert.equal(c.reason, REASON.RECONCILED);

    assert.equal(
      c.onCameraScan(physical, asSeenFromRotatedFrame(physical)),
      VERDICT.TRUSTED,
      'one scan can never reject anything: it just computes a difference',
    );

    turn('F');
    report();
    assert.equal(
      c.onCameraScan(physical, asSeenFromRotatedFrame(physical)),
      VERDICT.REFUSED,
      'the correction moved with the cube, so it was never a correction',
    );
    assert.equal(c.reason, REASON.CAMERA_DISAGREED);
    assert.equal(c.evidence.offsetResyncs, 0, 'and it is a refusal, not a re-baseline');
    assert.equal(maySourceOffset(c.verdict), false);
    assert.equal(mayFollowMoves(c.verdict), false);
  });

  test('a U turn in between hides it, which is why the rule is constancy and not one scan', () => {
    // The honest limit of the check, asserted so nobody mistakes it for a proof. U and D turns
    // commute with the relabelling, so a session that only ever turned those two faces between
    // scans looks exactly like an offset cube. Two scans are evidence, never a certificate.
    const c = createSelfCheck({ Cube });
    let physical = IDENTITY;
    const report = () => c.onFacelets(asSeenFromRotatedFrame(physical));
    const turn = (m) => {
      physical = Cube.fromString(physical).move(m).asString();
      c.onMove(relabelMove(m));
    };
    report();
    turn('R');
    report();
    c.onCameraScan(physical, asSeenFromRotatedFrame(physical));
    turn('U');
    report();
    assert.equal(c.onCameraScan(physical, asSeenFromRotatedFrame(physical)), VERDICT.TRUSTED);
  });
});

describe('a decoder that is wrong', () => {
  test('an illegal state is refused on the spot', () => {
    const c = createSelfCheck({ Cube });
    // Right alphabet, right length, not a cube anyone can hold.
    assert.equal(c.onFacelets('U'.repeat(54)), VERDICT.REFUSED);
    assert.equal(c.reason, REASON.ILLEGAL_STATE);
  });

  test('one failed reconciliation is a resync, not a verdict', () => {
    // The distinction the whole threshold exists for. A WRONG DECODER fails every reconciliation;
    // a LOST PACKET is weather on a radio link and fails once. Treating them alike meant a single
    // moment of interference made a good cube untrusted for the rest of the session, with no way
    // back — which is a worse failure than the one it was guarding against.
    const c = createSelfCheck({ Cube });
    c.onFacelets(IDENTITY);
    c.onMove('R');
    assert.equal(c.onFacelets(after("R'")), VERDICT.UNKNOWN, 'not a refusal');
    assert.equal(c.reason, REASON.RESYNCED);
    assert.equal(c.evidence.resyncs, 1);

    // And it re-baselined: the next reconciliation measures from the state just reported, so a
    // recovered link goes straight back to producing evidence.
    c.onMove('U');
    assert.equal(c.onFacelets(Cube.fromString(after("R'")).move('U').asString()), VERDICT.STREAM);
    assert.equal(c.evidence.consecutiveFailures, 0, 'a success clears the streak');
  });

  test('a move channel that keeps contradicting the state channel is refused, not demoted', () => {
    // Neither channel can be believed once they persistently disagree, and we cannot tell which is
    // lying. This is deliberately NOT a fall back to reduced trust: reduced means "reports no
    // state", which is a different situation from "reports a state that its own moves contradict".
    const c = createSelfCheck({ Cube });
    c.onFacelets(IDENTITY);
    for (let i = 0; i < 3; i++) {
      c.onMove('R');
      c.onFacelets(after("R'"));
    }
    assert.equal(c.verdict, VERDICT.REFUSED);
    assert.equal(c.reason, REASON.RECONCILE_FAILED);
    assert.equal(maySourceOffset(c.verdict), false);
    assert.equal(mayFollowMoves(c.verdict), false);
  });

  test('a refusal is terminal — nothing later argues it back', () => {
    // The failure mode this exists to prevent: a cube that fails once, then produces enough quiet
    // agreement afterwards to look fine. Trust is not an average.
    const c = createSelfCheck({ Cube });
    c.onFacelets(IDENTITY);
    for (let i = 0; i < 3; i++) {
      c.onMove('R');
      c.onFacelets(after("R'"));
    }
    assert.equal(c.verdict, VERDICT.REFUSED);
    for (let i = 0; i < 20; i++) {
      c.onMove('R');
      c.onFacelets(after('R'));
      c.onCameraScan(after('R'), after('R'));
    }
    assert.equal(c.verdict, VERDICT.REFUSED);
    assert.equal(c.offset, null, 'and it never acquires an offset');
  });

  test('an injected cube model that is not one is refused rather than trusted', () => {
    const c = createSelfCheck({ Cube: null });
    assert.equal(c.onFacelets(IDENTITY), VERDICT.REFUSED);
    assert.equal(c.reason, REASON.NO_CUBE_MODEL);
  });
});

describe('trust is a running claim, not a badge', () => {
  test('a decoder that goes wrong AFTER being trusted is still caught', () => {
    // The checks used to switch themselves off at TRUSTED, which turned them off at the exact
    // moment they started mattering. A cube can be fine for two hundred moves and then desync.
    const c = createSelfCheck({ Cube });
    c.onFacelets(IDENTITY);
    c.onMove('R');
    c.onFacelets(after('R'));
    assert.equal(c.onCameraScan(after('R'), after('R')), VERDICT.TRUSTED);

    // Now the move channel starts lying — persistently, which is what a broken decoder does.
    for (let i = 0; i < 3; i++) {
      c.onMove('U');
      c.onFacelets(after("R U'"));
    }
    assert.equal(c.verdict, VERDICT.REFUSED);
    assert.equal(c.reason, REASON.RECONCILE_FAILED);
  });

  test('an offset that changes between scans is refused', () => {
    // deriveOffset succeeds for ANY two legal states — it just computes the difference — so a
    // single scan can never reject anything. What is checkable is the word "constant": a
    // correction that moves is not a correction.
    const c = createSelfCheck({ Cube });
    c.onFacelets(IDENTITY);
    c.onMove('R');
    c.onFacelets(after('R'));
    assert.equal(c.onCameraScan(after('R'), after('R')), VERDICT.TRUSTED);
    // Second scan, same cube reported, but the camera now sees something else entirely.
    assert.equal(c.onCameraScan(after('R U2'), after('R')), VERDICT.REFUSED);
    assert.equal(c.reason, REASON.CAMERA_DISAGREED);
  });

  test('a stable offset across two scans keeps the cube trusted', () => {
    const c = createSelfCheck({ Cube });
    c.onFacelets(IDENTITY);
    c.onMove('R');
    c.onFacelets(after('R'));
    c.onCameraScan(after('R U2'), after('R'));
    const first = c.offset;
    // The same physical relationship, observed again after a turn on both sides.
    c.onMove('U');
    c.onFacelets(after('R U'));
    assert.equal(c.onCameraScan(after('R U U2'), after('R U')), VERDICT.TRUSTED);
    assert.equal(c.offset, first, 'a constant correction stays constant');
    assert.equal(c.evidence.cameraScans, 2);
  });
});

describe('the evidence may arrive in either order', () => {
  // Four holes in the state machine, found 2026-09-04. Each is a thing that must happen and did
  // not, so each of these fails against the code as it stood.

  test('camera first, then the stream, still reaches trusted', () => {
    // The app's own repair flow scans FIRST — that is what a repair IS — so the order the checker
    // demanded was the one the app could not supply, and a camera-repaired cube could never become
    // trusted at all. The two checks are independent evidence; which one lands first is not.
    const c = createSelfCheck({ Cube });
    assert.equal(c.onCameraScan(IDENTITY, IDENTITY), VERDICT.UNKNOWN, 'a scan alone proves nothing');
    assert.equal(c.offset, IDENTITY, 'but the correction is in hand');
    c.onFacelets(IDENTITY);
    c.onMove('R');
    assert.equal(c.onFacelets(after('R')), VERDICT.TRUSTED, 'the pair is complete');
    assert.equal(c.reason, REASON.CAMERA_AGREED);
    assert.equal(maySourceOffset(c.verdict), true);
  });

  test('a lost turn on a TRUSTED cube is reported, though the verdict does not move', () => {
    // The verdict deliberately survives a lost packet — that is the whole point of the tolerance —
    // so the verdict cannot also be how the loss is announced. Before this, a trusted cube losing
    // a turn changed neither verdict nor reason, and nothing anywhere said a turn had gone.
    const c = createSelfCheck({ Cube });
    c.onFacelets(IDENTITY);
    c.onMove('R');
    c.onFacelets(after('R'));
    assert.equal(c.onCameraScan(after('R'), after('R')), VERDICT.TRUSTED);
    assert.equal(c.losses, 0);

    c.onMove('U');
    assert.equal(c.onFacelets(after("R U'")), VERDICT.TRUSTED, 'still trusted, as designed');
    assert.equal(c.losses, 1, 'and the loss is counted, which is what a caller watches');
    assert.equal(c.reason, REASON.RESYNCED, 'and named, so the reason listener fires');
    assert.equal(c.evidence.resyncs, 1);
  });

  test('a scan after a lost turn re-baselines the offset instead of refusing the cube', () => {
    // The constancy rule assumes nothing new went untracked. A reconciliation failure is exactly
    // the event that breaks that assumption: D grew, so H·D·H⁻¹ genuinely changed. Refusing there
    // punished a cube for being repaired.
    const c = createSelfCheck({ Cube });
    c.onFacelets(IDENTITY);
    c.onMove('R');
    c.onFacelets(after('R'));
    c.onCameraScan(after('R'), after('R'));
    const first = c.offset;

    c.onMove('U'); // …and the cube reports a state those moves do not reach: a turn went missing
    assert.equal(c.onFacelets(after("R U'")), VERDICT.TRUSTED);
    assert.equal(c.losses, 1);

    assert.equal(
      c.onCameraScan(after("R U' F"), after("R U'")),
      VERDICT.TRUSTED,
      'the repair scan is a repair, not a contradiction',
    );
    assert.notEqual(c.offset, first, 'and it really did move');
    assert.equal(c.evidence.offsetResyncs, 1, 'recorded as a resync');
    assert.equal(c.reason, REASON.OFFSET_RESYNCED);

    // The rule still bites over any pair of scans with an intact stream between them.
    c.onMove('B');
    c.onFacelets(Cube.fromString(after("R U'")).move('B').asString());
    assert.equal(
      c.onCameraScan(after("R U' B D2"), Cube.fromString(after("R U'")).move('B').asString()),
      VERDICT.REFUSED,
      'no loss in between, so a moved correction is still a refusal',
    );
    assert.equal(c.reason, REASON.CAMERA_DISAGREED);
  });

  test('a cube declared state-less that reports a state says so, instead of staying reduced', () => {
    // `reduced` is a DECLARATION the connection made, not a fact. A cube that then reports a state
    // has contradicted it, and leaving the verdict at reduced meant the reconciliation check never
    // ran on a stream that was arriving — permanently, silently, for the whole connection.
    const c = createSelfCheck({ Cube });
    assert.equal(c.declareNoStateReports(), VERDICT.REDUCED);
    assert.equal(c.onFacelets(IDENTITY), VERDICT.UNKNOWN, 'it cannot still be "reports no state"');
    assert.equal(c.reason, REASON.CAPABILITY_CONTRADICTED);
    assert.equal(c.evidence.contradictions, 1);

    // And the ordinary machinery works from here: the moves it reports are now reconciled.
    c.onMove('R');
    assert.equal(c.onFacelets(after('R')), VERDICT.STREAM);
    assert.equal(maySourceOffset(c.verdict), false, 'still not until the camera agrees');
    assert.equal(c.onCameraScan(after('R'), after('R')), VERDICT.TRUSTED);
    assert.equal(maySourceOffset(c.verdict), true);
  });

  test('an illegal state from a state-less cube is refused, not merely a contradiction', () => {
    // Legality first: a decoder producing an unreachable arrangement is wrong whatever it declared.
    const c = createSelfCheck({ Cube });
    c.declareNoStateReports();
    assert.equal(c.onFacelets('U'.repeat(54)), VERDICT.REFUSED);
    assert.equal(c.reason, REASON.ILLEGAL_STATE);
    assert.equal(c.evidence.contradictions, 0);
  });
});

describe('a cube that reports no state at all', () => {
  test('is reduced, and reduced is not refused', () => {
    // §5: it may drive move-following; it may never source the offset. The camera stays its only
    // path to truth.
    const c = createSelfCheck({ Cube });
    assert.equal(c.declareNoStateReports(), VERDICT.REDUCED);
    assert.equal(c.reason, REASON.NO_STATE_REPORTS);
    assert.equal(mayFollowMoves(c.verdict), true);
    assert.equal(maySourceOffset(c.verdict), false);
  });

  test('stays reduced even after the camera agrees', () => {
    // The camera establishes an offset, but the move channel was never checked against anything,
    // so its reports still may not BE the source of one.
    const c = createSelfCheck({ Cube });
    c.declareNoStateReports();
    assert.equal(c.onCameraScan(IDENTITY, IDENTITY), VERDICT.REDUCED);
    assert.equal(maySourceOffset(c.verdict), false);
    assert.equal(c.offset, IDENTITY, 'it does get the correction, it just cannot vouch for itself');
  });

  test('does not accumulate a move backlog nothing will ever consume', () => {
    // A reduced cube never reports a state, so `pending` can only grow — for the whole life of a
    // connection, on a cube a child is playing with. The COUNT still rises; only the unusable
    // backlog is dropped.
    const c = createSelfCheck({ Cube });
    c.declareNoStateReports();
    for (let i = 0; i < 5000; i++) c.onMove('R');
    assert.equal(c.evidence.moveReports, 5000, 'the count is still the truth');
    assert.equal(c.verdict, VERDICT.REDUCED);
  });

  test('is never inferred from silence', () => {
    // "No facelets yet" and "no facelets ever" are different, and guessing between them demotes a
    // healthy cube a second before its first report lands. It has to be declared.
    const c = createSelfCheck({ Cube });
    c.onMove('R');
    c.onMove('U');
    assert.equal(c.verdict, VERDICT.UNKNOWN);
    // Following IS allowed while unverified: mirroring a turn is not a claim about where the cube
    // is, and blocking it until the first reconciliation lands sent the opening turns of every
    // session nowhere. Sourcing the trust offset is the thing that stays closed.
    assert.equal(mayFollowMoves(c.verdict), true, 'unproven is not the same as known-wrong');
    assert.equal(maySourceOffset(c.verdict), false, 'but it may not vouch for the cube');
  });
});

describe('what the report will carry', () => {
  test('counts, not conclusions', () => {
    const c = createSelfCheck({ Cube });
    c.onFacelets(IDENTITY);
    c.onMove('R');
    c.onFacelets(after('R'));
    assert.deepEqual(c.evidence, {
      reconciled: 1,
      failed: 0,
      resyncs: 0,
      offsetResyncs: 0,
      contradictions: 0,
      consecutiveFailures: 0,
      stateReports: 2,
      moveReports: 1,
      cameraScans: 0,
      needed: 1,
      tolerated: 3,
    });
  });

  test('an idle cube accumulates no evidence either way', () => {
    // Ten identical reports and no turns is not a passing decoder; it is an untested one.
    const c = createSelfCheck({ Cube });
    for (let i = 0; i < 10; i++) c.onFacelets(IDENTITY);
    assert.equal(c.verdict, VERDICT.UNKNOWN);
    assert.equal(c.evidence.reconciled, 0);
  });
});
