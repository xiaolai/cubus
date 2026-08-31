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
import { IDENTITY } from '../lib/cube-trust.js';

let Cube;
before(async () => {
  Cube = (await import(new URL('../vendor/cubejs.js', import.meta.url).href)).default;
});

/** The state a solved cube reaches after `alg`. */
const after = (alg) => Cube.fromString(IDENTITY).move(alg).asString();

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

  test('a uniformly mislabelled decoder is offset, not broken', () => {
    // The camera check is the repair as well as the test: a decoder whose colour scheme is rotated
    // is self-consistent and reconciles perfectly, and the offset absorbs it.
    const c = createSelfCheck({ Cube });
    c.onFacelets(IDENTITY);
    c.onMove('R');
    assert.equal(c.onFacelets(after('R')), VERDICT.STREAM);
    const physical = after('R U2');
    assert.equal(c.onCameraScan(physical, after('R')), VERDICT.TRUSTED);
    assert.notEqual(c.offset, IDENTITY, 'a real correction was established');
    assert.ok(c.offset, 'and it is a usable state');
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
