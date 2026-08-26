// The tracking offset — the maths that lets a beginner repair a desynced smart cube with one
// camera scan instead of solving it first.
//
// This is the load-bearing test of the whole trust design. If the offset is wrong, the app shows
// a confident guide for a cube that is not the one in the user's hands — which is worse than
// showing nothing, and is exactly the failure the design exists to prevent.
//
// Pure, no DOM. cubejs is the injected oracle, the same one the app uses.

import assert from 'node:assert/strict';
import { before, test } from 'node:test';

import { IDENTITY, applyOffset, deriveOffset, isIdentity } from '../lib/cube-trust.js';

let Cube;
before(async () => {
  Cube = (await import(new URL('../vendor/cubejs.js', import.meta.url).href)).default;
});

const FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
const SUFFIX = ['', "'", '2'];
const randAlg = (n) =>
  Array.from({ length: n }, () => FACES[(Math.random() * 6) | 0] + SUFFIX[(Math.random() * 3) | 0]).join(' ');
const at = (...algs) => { const c = new Cube(); for (const a of algs) c.move(a); return c.asString(); };

/**
 * One full disconnect-and-repair episode.
 *
 * H — turns made while the cube was tracking
 * D — turns made while nobody was counting (the disconnect)
 * M — turns made AFTER the correction was derived. This is the part that matters: a correction
 *     that only fixes the moment it was taken is worthless, because the user then turns the cube.
 */
const episode = () => {
  const H = randAlg(8), D = randAlg(6), M = randAlg(12);
  return {
    scanned: at(H, D),          // the camera sees physical reality at repair time
    reported0: at(H),           // the cube claims only what it counted
    physical: at(H, D, M),      // where the cube actually is, later
    reported: at(H, M),         // what it claims, later
  };
};

test('a correction derived once stays correct across further turns', () => {
  // 300 trials, each verified across 12 moves made AFTER the offset was derived.
  let ok = 0;
  const TRIALS = 300;
  for (let i = 0; i < TRIALS; i++) {
    const e = episode();
    const offset = deriveOffset(e.scanned, e.reported0, Cube);
    if (applyOffset(offset, e.reported, Cube) === e.physical) ok++;
  }
  assert.equal(ok, TRIALS, 'every trial must be corrected exactly, not most of them');
});

test('the offset goes on the LEFT, and the other side is pinned as wrong', () => {
  // Kept deliberately. The first attempt at this put the offset on the right, which is not
  // constant under later moves. Asserting only that "some arrangement works" would let that
  // mistake back in silently, so the wrong side is asserted to FAIL.
  let rightSideOk = 0;
  const TRIALS = 300;
  for (let i = 0; i < TRIALS; i++) {
    const e = episode();
    const offset = deriveOffset(e.scanned, e.reported0, Cube);
    // reported · offset, spelled out rather than routed through applyOffset.
    const rep = Cube.fromString(e.reported);
    rep.multiply(Cube.fromString(offset));
    if (rep.asString() === e.physical) rightSideOk++;
  }
  // Not asserted as exactly zero: when the drift happens to commute with the history the two
  // sides coincide, which is a real (rare) coincidence rather than a bug. What must not happen is
  // the wrong side working in general.
  assert.ok(rightSideOk < TRIALS * 0.05, `the wrong side must not work in general (got ${rightSideOk}/${TRIALS})`);
});

test('the offset is derivable from two state strings alone, with no move history', () => {
  // This is what makes the design implementable: the app holds no move history, and asking the
  // user to reproduce one is the "solve it first" wall by another name.
  for (let i = 0; i < 40; i++) {
    const e = episode();
    assert.equal(
      applyOffset(deriveOffset(e.scanned, e.reported0, Cube), e.reported, Cube), e.physical,
      'two facelet strings in, exact tracking out',
    );
  }
});

test('a cube that never drifted derives the identity offset', () => {
  const state = at(randAlg(10));
  assert.equal(deriveOffset(state, state, Cube), IDENTITY, 'agreement means nothing to correct');
  assert.ok(isIdentity(deriveOffset(state, state, Cube)));
});

test('nothing to correct means the report passes through untouched', () => {
  const state = at(randAlg(9));
  assert.equal(applyOffset(null, state, Cube), state, 'no offset');
  assert.equal(applyOffset(undefined, state, Cube), state, 'no offset, spelled differently');
  assert.equal(applyOffset('', state, Cube), state, 'no offset, spelled a third way');
  assert.equal(applyOffset(IDENTITY, state, Cube), state, 'an identity offset');
  assert.ok(isIdentity(null) && isIdentity('') && isIdentity(IDENTITY) && !isIdentity(at('R')));
  // The absent values are named, not tested for falsiness. `false`, `0` and `NaN` are caller bugs,
  // and quietly reading them as "no correction" is how a bug becomes a wrong answer.
  assert.ok(!isIdentity(false) && !isIdentity(0) && !isIdentity(Number.NaN));
});

test('a correction that cannot be applied yields nothing, never the raw report', () => {
  // This is the last place the design can fail open, and it used to. With a correction active the
  // raw report is exactly the value the offset exists to say is NOT true; returning it is
  // indistinguishable from a successful correction, and the caller then treats a known-wrong
  // arrangement as the cube's position.
  const good = at(randAlg(6));
  assert.equal(applyOffset('not a cube', good, Cube), null, 'an unusable offset');
  assert.equal(applyOffset(at('R'), 'not a cube', Cube), null, 'an unusable report');
  assert.equal(applyOffset(null, 'not a cube', Cube), null, 'and with no offset either');
  // The one case that legitimately returns a string is when there was nothing to apply.
  assert.equal(applyOffset(IDENTITY, good, Cube), good);
});

test('a cube whose centres have moved is not in our frame, and is refused', () => {
  // Centres never move under URFDLB notation, and invert() reads them. Swapping two passes every
  // other check — permutations, twist sum, flip sum, parity — and yields a confident offset.
  const moved = [...IDENTITY];
  [moved[4], moved[13]] = [moved[13], moved[4]];
  const f = moved.join('');
  assert.match(f, /^[URFDLB]{54}$/, 'well-formed, so only a centre check can reject it');
  assert.equal(deriveOffset(f, IDENTITY, Cube), null, 'rejected as scanned');
  assert.equal(deriveOffset(IDENTITY, f, Cube), null, 'rejected as reported');
  assert.equal(applyOffset(f, IDENTITY, Cube), null, 'rejected as an offset');
});

test('every two-sticker transposition of a solved cube is refused', () => {
  // The load-bearing regression. cubejs does NOT report a failed decode: handed a triple it does
  // not recognise it leaves that cubie at its solved default and returns a cube-shaped object with
  // no complaint. An earlier version of this module assumed a sentinel and checked only the
  // permutation — which accepted 579 of these 1215 cubes, 412 of them deriving the IDENTITY
  // offset, i.e. reporting "nothing to correct" for a cube that cannot exist.
  //
  // Exhaustive rather than sampled, because the earlier flaky version of this suite proved that
  // sampling here finds the hole about one run in thirty and then gets explained away.
  let accepted = 0, total = 0;
  for (let i = 0; i < 54; i++) {
    for (let j = i + 1; j < 54; j++) {
      if (IDENTITY[i] === IDENTITY[j]) continue;
      total++;
      const a = [...IDENTITY];
      [a[i], a[j]] = [a[j], a[i]];
      if (deriveOffset(a.join(''), IDENTITY, Cube) !== null) accepted++;
    }
  }
  assert.equal(total, 1215, 'every cross-colour transposition was tried');
  assert.equal(accepted, 0, `${accepted} impossible cubes were accepted`);
});

test('unusable input yields nothing, never a plausible-looking wrong offset', () => {
  const good = at(randAlg(7));
  const junk = [
    '', 'nonsense', null, undefined, 42, {},
    'U'.repeat(54),                                  // right shape, 54 of one colour
    `${IDENTITY}U`,                                  // one character too long
    IDENTITY.slice(0, 53),                           // one too short
    IDENTITY.replace(/^U/, 'X'),                     // outside the alphabet
    `R${IDENTITY.slice(1)}`,                         // 8 U and 10 R — not nine of each
  ];
  for (const bad of junk) {
    assert.equal(deriveOffset(bad, good, Cube), null, `bad scanned: ${JSON.stringify(bad)}`);
    assert.equal(deriveOffset(good, bad, Cube), null, `bad reported: ${JSON.stringify(bad)}`);
  }
});

test('each of the three ways a cube can be impossible is rejected', () => {
  // A swapped sticker (above) is caught early, by the piece lookup. These three are not: they are
  // well-formed cubes whose pieces all exist, and they are the errors a camera misread or a
  // hand-painted side actually produces. Each needs its own check, and each check was unexercised
  // until this test existed.
  const good = at(randAlg(8));
  const broken = (edit) => { const c = new Cube(); edit(c); return c.asString(); };

  // These are constructed, not stumbled upon. An earlier version of this test swapped two
  // differently-coloured stickers and assumed the result was unreachable; it usually is, but not
  // always — the swap sometimes lands on a perfectly legal cube, which failed roughly one run in
  // thirty. Impossibility has to be built, not hoped for.

  const twisted = broken((c) => { c.co[0] = 1; });                        // one corner rotated in place
  const flipped = broken((c) => { c.eo[0] = 1; });                        // one edge flipped in place
  const swapped = broken((c) => { [c.cp[0], c.cp[1]] = [c.cp[1], c.cp[0]]; }); // two corners exchanged

  // Rejected by arithmetic, not by search. Kociemba assumes solvable input and can run
  // unboundedly on anything else, so "refused" and "refused immediately" are different claims and
  // only the second one is safe to put on the repair path.
  const before = Date.now();
  for (const [name, bad] of [['twisted corner', twisted], ['flipped edge', flipped], ['swapped pair', swapped]]) {
    assert.match(bad, /^[URFDLB]{54}$/, `${name}: well-formed, so only cube maths can reject it`);
    assert.notEqual(bad, good);
    assert.equal(deriveOffset(bad, good, Cube), null, `${name} rejected as scanned`);
    assert.equal(deriveOffset(good, bad, Cube), null, `${name} rejected as reported`);
    assert.equal(applyOffset(bad, good, Cube), null, `${name} as an offset yields nothing`);
    assert.equal(applyOffset(at('R'), bad, Cube), null, `${name} as a report yields nothing`);
  }
  assert.ok(Date.now() - before < 1000, 'and all three refused immediately — no search was attempted');
});

test('a cubejs that returns something unrecognisable is refused, not trusted', () => {
  // cubejs is INJECTED, which makes it a boundary — and boundaries get validated even when the
  // thing on the other side is ours. Nothing the real cubejs produces reaches these branches; a
  // future version whose representation differs would, and the failure would otherwise be a
  // silently wrong offset rather than a refusal.
  const good = at(randAlg(6));
  // A constructor, because the module builds the inverse with `new Cube()` as well as reading
  // states with `Cube.fromString`. Both halves are part of the contract.
  const fake = (patch) => {
    const solved = () => ({
      cp: [0, 1, 2, 3, 4, 5, 6, 7], co: [0, 0, 0, 0, 0, 0, 0, 0],
      ep: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], eo: Array(12).fill(0),
      center: [0, 1, 2, 3, 4, 5],
      cornerParity: () => 0, edgeParity: () => 0,
      asString: () => IDENTITY, multiply() {},
    });
    const Fake = function () { return solved(); };
    // asString echoes what it was handed, so the fake round-trips like a real library and the
    // patched field under test is what gets rejected — not the scaffolding.
    Fake.fromString = (f) => ({ ...solved(), asString: () => f, ...patch });
    return Fake;
  };
  // Twists must be 0-2 and flips 0-1. A "3" sums to a multiple of three, so the parity check
  // alone would wave it through — which is exactly why the range is checked separately.
  assert.equal(deriveOffset(good, good, fake({ co: [3, 0, 0, 0, 0, 0, 0, 0] })), null, 'twist out of range');
  assert.equal(deriveOffset(good, good, fake({ eo: [2, 0, ...Array(10).fill(0)] })), null, 'flip out of range');
  assert.equal(deriveOffset(good, good, fake({ cornerParity: undefined })), null, 'parity not answerable');
  assert.equal(deriveOffset(good, good, fake({ cp: [0, 0, 2, 3, 4, 5, 6, 7] })), null, 'corners not a permutation');
  assert.equal(deriveOffset(good, good, {}), null, 'not a cube library at all');
  assert.equal(deriveOffset(good, good, null), null, 'nothing injected');
  const throws = function () {}; throws.fromString = () => { throw new Error('nope'); };
  assert.equal(deriveOffset(good, good, throws), null, 'one that throws');
  // A plain object with the right method is NOT enough — the module also constructs. This threw a
  // TypeError out of a function documented to return string|null until the check covered both.
  assert.equal(deriveOffset(good, good, { fromString: fake({}).fromString }), null, 'not constructible');
  assert.equal(applyOffset(at('R'), good, { fromString: fake({}).fromString }), null, 'and apply yields nothing');
  // A library whose inputs validate but whose OUTPUT is not a cube. Nothing is inferred from the
  // inputs having been checked: the answer is checked too, because a bad offset would otherwise
  // surface far from here, as a guide for an arrangement that cannot exist.
  assert.equal(deriveOffset(good, good, fake({ asString: () => 'junk' })), null, 'output not a cube');
  assert.equal(applyOffset(at('R'), good, fake({ asString: () => 'junk' })), null, 'and apply yields nothing');
  // Output validated by the same function its inputs went through. A looser alphabet-and-length
  // check would wave through a wrong colour count or moved centres.
  const wrongCounts = `UU${IDENTITY.slice(2).replace(/R/g, 'U')}`.slice(0, 54);
  assert.equal(deriveOffset(good, good, fake({ asString: () => wrongCounts })), null, 'output shaped right, still not a cube');
  // A validation method that throws must become null, not an exception escaping the contract.
  assert.equal(deriveOffset(good, good, fake({ cornerParity: () => { throw new Error('x'); } })), null);
  // Sparse arrays: every, reduce and for..of all skip holes, so a length-8 array with no values
  // used to pass the range and sum checks.
  assert.equal(deriveOffset(good, good, fake({ co: Object.assign([], { length: 8 }) })), null, 'sparse twists');
  assert.equal(deriveOffset(good, good, fake({ ep: Object.assign([], { length: 12 }) })), null, 'sparse edges');

  // And the sane fake still returns something, so the tests above are rejecting the patch under
  // test and not the scaffolding. (Its multiply() is a no-op and its asString() echoes its input,
  // so the answer is `good` rather than IDENTITY — this fake models the API, not the algebra.)
  assert.equal(deriveOffset(good, good, fake({})), good);
});

test('applying an offset does not mutate what it was given', () => {
  const e = episode();
  const offset = deriveOffset(e.scanned, e.reported0, Cube);
  const offsetCopy = String(offset), reportedCopy = String(e.reported);
  applyOffset(offset, e.reported, Cube);
  applyOffset(offset, e.reported, Cube);
  assert.equal(offset, offsetCopy, 'the offset survives being used');
  assert.equal(e.reported, reportedCopy);
  // Twice in a row must give the same answer — the snapshot stream calls this once a second.
  assert.equal(applyOffset(offset, e.reported, Cube), applyOffset(offset, e.reported, Cube));
});

test('a corrected report is itself a real cube', () => {
  // A correction that produced an unsolvable state would break every solver downstream, and the
  // failure would surface far from here.
  for (let i = 0; i < 40; i++) {
    const e = episode();
    const truth = applyOffset(deriveOffset(e.scanned, e.reported0, Cube), e.reported, Cube);
    assert.match(truth, /^[URFDLB]{54}$/);
    // Round-trips through the independent oracle, which is the same check the app relies on.
    assert.equal(Cube.fromString(truth).asString(), truth);
    // And it is still usable as an offset input, which is what "a real cube" has to mean here.
    assert.notEqual(deriveOffset(truth, IDENTITY, Cube), null);
  }
});
