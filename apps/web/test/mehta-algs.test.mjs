// The Mehta table: every row is the cell its sheet published, its picture is a case of its step, and the
// rows of each full set cover every case of that step — counted from the pieces, never from the sheet.
//
// THE ORACLE IS CUBEJS for what an algorithm does (it reads slices, wide turns and rotations with code
// that shares nothing with `lib/cube-notation.js`); the CASES are enumerated from the piece model,
// independently of any row, so a set that missed a case cannot hide it by drawing it wrongly. Then the
// app's own interpreter is held to cubejs on every row, as `human-algs.test.mjs` does.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import Cube from 'cubejs';

import { MEHTA_ALGS, MEHTA_BEGINNER, MEHTA_BEGINNER_STEPS, MEHTA_EOLE, MEHTA_6CO, MEHTA_6CP, MEHTA_L5EP, SOURCES } from '../lib/data/mehta-algs.js';
import { CORNERS, EDGES, SOLVED, applyAlg, compose, fromCube, invert, toFacelets } from '../lib/cube-pieces.js';
import { CORNER_FACELETS } from '../lib/cube-layout.js';

const CORNER_FACELETS_OF = (slot) => CORNER_FACELETS[CORNERS.indexOf(slot)];
import { run } from '../lib/cube-moves.js';

const E = (n) => EDGES.indexOf(n);
const C = (n) => CORNERS.indexOf(n);
const AUF = ['', 'U', 'U2', "U'"];
const ADF = ['', 'D', 'D2', "D'"];
/** Every turn of the top and the bottom together: what "in place" is allowed to be off by. */
const H = AUF.flatMap((a) => ADF.map((d) => applyAlg(SOLVED, `${a} ${d}`)));

/** cubejs's answer to `alg` on facelets `s`, read back as pieces with the centres turned home by a y. */
function after(s, alg) {
  const c = Cube.fromString(s);
  if (alg.trim()) c.move(alg);
  for (const y of ['', 'y', 'y2', "y'"]) {
    const t = Cube.fromString(c.asString());
    if (y) t.move(y);
    const f = t.asString();
    if (f[4] === 'U' && f[22] === 'F') return fromCube(Cube.fromString(f));
  }
  throw new Error(`"${alg}" leaves the centres off the U/D axis`);
}
/** A row's picture: the solved cube, its bottom turned by `bottom`, then the inverse of the algorithm. */
const play = (state, alg) => after(toFacelets(state), alg);
const pictureOf = (row) => play(applyAlg(SOLVED, row.bottom ?? ''), invert(row.alg));

// ---------- what each step starts from and finishes ----------
const FB_E = ['DF', 'DL', 'DB'].map(E);
const FB_C = ['DLF', 'DBL'].map(C);
const BELT3 = ['FL', 'BL', 'BR'].map(E);
const BELT = [...BELT3, E('FR')];
const edgesHome = (s, list) => list.every((p) => s.ep[p] === p && s.eo[p] === 0);
const cornersHome = (s, list) => list.every((p) => s.cp[p] === p && s.co[p] === 0);
const block = (s) => edgesHome(s, FB_E) && cornersHome(s, FB_C);
const eoDone = (s) => s.eo.every((x) => x === 0);
const coDone = (s) => s.co.every((x) => x === 0);
const cpDone = (s) => s.cp.every((x, i) => x === i);
const STEP = {
  eole: { from: (s) => block(s) && edgesHome(s, BELT3), to: (s) => block(s) && edgesHome(s, BELT) && eoDone(s) },
  '6co': { from: (s) => block(s) && edgesHome(s, BELT) && eoDone(s), to: (s) => block(s) && edgesHome(s, BELT) && eoDone(s) && coDone(s) },
  '6cp': { from: (s) => block(s) && edgesHome(s, BELT) && eoDone(s) && coDone(s), to: (s) => block(s) && edgesHome(s, BELT) && eoDone(s) && cpDone(s) && coDone(s) },
  l5ep: { from: (s) => block(s) && edgesHome(s, BELT) && eoDone(s) && coDone(s) && cpDone(s), to: (s) => JSON.stringify(s) === JSON.stringify(SOLVED) },
};
/** True when some turn of the top and bottom puts `s` where `p` holds. */
const upToTurns = (s, p) => H.some((h) => p(compose(s, h)));

// ---------- the cases, from the pieces ----------
// The parity of a whole permutation array, never of a list of slot names: EDGES does not list UF UL UB UR
// in index order, so the parity of `[UF, UL, UB, UR]` rearranged is not the parity of the cube.
const parity = (p) => { let n = 0; for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) if (p[i] > p[j]) n++; return n % 2; };
const perms = (a) => (a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p])));
const copy = (s) => ({ cp: [...s.cp], co: [...s.co], ep: [...s.ep], eo: [...s.eo] });
const swapTwoCorners = (s) => { [s.cp[C('URF')], s.cp[C('UFL')]] = [s.cp[C('UFL')], s.cp[C('URF')]]; };
const swapTwoEdges = (s) => { [s.ep[E('UF')], s.ep[E('UL')]] = [s.ep[E('UL')], s.ep[E('UF')]]; };
const FREE_E = ['UF', 'UL', 'UB', 'UR', 'DR'].map(E);
const SIX_C = ['URF', 'UFL', 'ULB', 'UBR', 'DFR', 'DRB'].map(C);

/** Every state the step can meet with only what it reads varied, everything it does not read solved. */
function* statesOf(set) {
  if (set === 'eole') {
    const slots = [...FREE_E, E('FR')];
    for (const p of perms(slots)) for (let m = 0; m < 64; m++) {
      const flips = slots.map((_, i) => (m >> i) & 1);
      if (flips.reduce((x, y) => x + y) % 2) continue;
      const s = copy(SOLVED);
      slots.forEach((k, i) => { s.ep[k] = p[i]; s.eo[k] = flips[i]; });
      if (parity(s.ep)) swapTwoCorners(s);
      yield s;
    }
  } else if (set === '6co') {
    for (let m = 0; m < 729; m++) {
      const t = SIX_C.map((_, i) => Math.floor(m / 3 ** i) % 3);
      if (t.reduce((x, y) => x + y) % 3) continue;
      const s = copy(SOLVED);
      SIX_C.forEach((k, i) => { s.co[k] = t[i]; });
      yield s;
    }
  } else if (set === '6cp') {
    for (const p of perms(SIX_C)) {
      const s = copy(SOLVED);
      SIX_C.forEach((k, i) => { s.cp[k] = p[i]; });
      if (parity(s.cp)) swapTwoEdges(s);
      yield s;
    }
  } else {
    for (const p of perms(FREE_E)) {
      const s = copy(SOLVED);
      FREE_E.forEach((k, i) => { s.ep[k] = p[i]; });
      if (!parity(s.ep)) yield s;
    }
  }
}

/**
 * The case a state is. An orientation step reads only orientations and the one edge it places, so its case
 * is the state up to a turn of the top and bottom BEFORE the algorithm (on a view where the step can start);
 * a permutation step reads every piece, so its case is the double coset: turns before AND after, the
 * second because "in place" is up to a turn of the top and bottom.
 */
function caseOf(set, s) {
  let best = null;
  const keep = (k) => { if (best === null || k < best) best = k; };
  if (set === 'eole' || set === '6co') {
    for (const h of H) {
      const v = compose(s, h);
      if (!STEP[set].from(v)) continue;
      keep(set === 'eole'
        ? [...FREE_E, E('FR')].map((k) => `${v.ep[k] === E('FR') ? 'X' : '.'}${v.eo[k]}`).join('')
        : SIX_C.map((k) => v.co[k]).join(''));
    }
  } else {
    for (const a of H) for (const b of H) {
      const v = compose(compose(a, s), b);
      keep(set === '6cp' ? v.cp.join(',') : `${v.cp.join(',')}|${v.ep.join(',')}`);
    }
  }
  assert.notEqual(best, null, `${set}: a state no view of which can start the step`);
  return best;
}

const SETS = { eole: MEHTA_EOLE, '6co': MEHTA_6CO, '6cp': MEHTA_6CP, l5ep: MEHTA_L5EP };
const CASES = { eole: 55, '6co': 71, '6cp': 41, l5ep: 16 };

test('the table is the four sets and the beginner path, each row frozen, named once and sourced', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(SETS).map(([k, v]) => [k, v.length])), { eole: 55, '6co': 71, '6cp': 47, l5ep: 45 });
  assert.equal(MEHTA_ALGS.length, 218);
  const names = [...MEHTA_ALGS, ...MEHTA_BEGINNER].map((r) => r.name);
  assert.equal(new Set(names).size, names.length, 'two rows share an id');
  for (const r of [...MEHTA_ALGS, ...MEHTA_BEGINNER]) assert.ok(Object.isFrozen(r), `${r.name} can be edited in place`);
  for (const [key, src] of Object.entries(SOURCES)) assert.match(src.url, /^https:\/\//, `${key} is not a URL`);
  assert.deepEqual([...new Set(MEHTA_BEGINNER.map((r) => r.step))], [...MEHTA_BEGINNER_STEPS]);
  assert.deepEqual(MEHTA_BEGINNER_STEPS.map((s) => MEHTA_BEGINNER.filter((r) => r.step === s).length), [5, 8, 5, 7, 2, 1, 4]);
});

test('a row differs from its cell only by the documented changes', () => {
  const strip = (cell) => cell
    .replace(/:\s*(Right|Front|Back)\s*$/, '')
    .replace(/^\((U2|U'|U)\)\s*/, '')
    .replace(/\s*\((D2|D'|D)\)$/, '')
    .split(/\s+/).map((t) => t.replace("2'", '2').replace(/^([A-Za-z])3$/, "$1'")).join(' ');
  for (const r of [...MEHTA_ALGS, ...MEHTA_BEGINNER]) {
    if (r.sourceAlg === undefined) { assert.doesNotMatch(r.alg, /[()’:]|2'|3/, `${r.name} looks un-normalised`); continue; }
    assert.notEqual(r.sourceAlg, r.alg, `${r.name} keeps a sourceAlg equal to its alg`);
    assert.equal(strip(r.sourceAlg), r.alg, `${r.name}`);
    const pre = r.sourceAlg.match(/^\((U2|U'|U)\)/)?.[1];
    assert.equal(r.pre, pre, `${r.name}: pre is not the cell's leading turn`);
    const post = r.sourceAlg.match(/\((D2|D'|D)\)$/)?.[1];
    if (post) assert.equal(r.bottom, invert(post), `${r.name}: bottom is not the inverse of the cell's "(${post})"`);
    const where = r.sourceAlg.match(/:\s*(Right|Front|Back)\s*$/)?.[1];
    if (r.set === 'l5ep') assert.equal(r.dEdge, where?.toLowerCase(), `${r.name}: dEdge is not the cell's`);
  }
});

// ---------- every row is in reduced form ----------
// The source-fidelity check reads a row only when it carries a `sourceAlg`, so an undocumented cancelling pair
// appended to a row ("R U' R' U U'") would pass every other test. No two adjacent turns may share a layer —
// the same face, the same slice, the same wide turn or the same whole-cube axis — because they would merge
// into one turn or cancel to none; and the turn count must equal the count after that merge.
const layerOf = (m) => m.replace(/['2]/g, '');
const mergedCount = (alg) => alg.split(' ').reduce((out, m) => {
  if (out.length && layerOf(out[out.length - 1]) === layerOf(m)) out[out.length - 1] = m; else out.push(m);
  return out;
}, []).length;
function assertReduced(r) {
  const ms = r.alg.trim().split(/\s+/);
  for (let i = 1; i < ms.length; i++) {
    assert.notEqual(layerOf(ms[i]), layerOf(ms[i - 1]), `${r.name} ("${r.alg}"): "${ms[i - 1]} ${ms[i]}" turns one layer twice in a row`);
  }
  assert.equal(ms.length, mergedCount(r.alg), `${r.name} ("${r.alg}") is not reduced`);
}

test('every row is in reduced form: no two adjacent turns of one layer', () => {
  for (const r of [...MEHTA_ALGS, ...MEHTA_BEGINNER]) assertReduced(r);
});

test('every full-set row draws a case its step can start from, not one it has already finished', () => {
  for (const [set, rows] of Object.entries(SETS)) for (const r of rows) {
    const s = pictureOf(r);
    assert.ok(upToTurns(s, STEP[set].from), `${r.name} ("${r.alg}") draws a cube the ${set} step cannot start from`);
    assert.ok(!upToTurns(s, STEP[set].to), `${r.name} draws a cube the ${set} step has already finished`);
    // The picture is drawn so the algorithm lands on the bottom turned by `bottom`; the check is not that
    // arithmetic restated, but that undoing it is all that is left.
    assert.ok(STEP[set].to(play(s, `${r.alg} ${invert(r.bottom ?? '')}`)), `${r.name} does not finish its step`);
  }
});

test('the rows of each set cover every case of its step, and say which rows draw the same case', () => {
  for (const [set, rows] of Object.entries(SETS)) {
    const cases = new Set();
    for (const s of statesOf(set)) if (!upToTurns(s, STEP[set].to)) cases.add(caseOf(set, s));
    assert.equal(cases.size, CASES[set], `${set} has ${cases.size} cases, not ${CASES[set]}`);
    const drawn = new Map();
    for (const r of rows) {
      const k = caseOf(set, pictureOf(r));
      assert.ok(cases.has(k), `${r.name} draws a ${set} case the enumeration does not have`);
      drawn.set(k, [...(drawn.get(k) ?? []), r]);
    }
    const missing = [...cases].filter((k) => !drawn.has(k));
    assert.deepEqual(missing, [], `${set}: ${missing.length} cases no row draws`);
    const shared = [...drawn.values()].filter((v) => v.length > 1);
    if (set === 'eole' || set === '6co') {
      // An orientation case is one row: the sheet lays out each case once.
      assert.deepEqual(shared, [], `two ${set} rows draw the same case`);
    }
    if (set === '6cp') {
      // The 5-2 column is the 2-6 column with the bottom turned first: the same six cases.
      assert.deepEqual(shared.map((v) => v.map((r) => r.name).sort().join(' = ')).sort(),
        [1, 2, 3, 4, 5, 6].map((i) => `6cp-2-6-${i} = 6cp-5-2-${i}`));
    }
    if (set === 'l5ep') {
      // Each case is drawn once per place the bottom edge can sit; every row of a case carries its letter.
      for (const v of drawn.values()) assert.equal(new Set(v.map((r) => r.group)).size, 1, `${v.map((r) => r.name).join(', ')} name different cases`);
      assert.deepEqual([...new Set(rows.map((r) => r.group))].sort(), ['Ca', 'Cb', 'D', 'H', 'I', 'Oa', 'Ob', 'Pa', 'Pb', 'Qa', 'Qb', 'Ua', 'Ub', 'Wa', 'Wb', 'Z'].sort());
    }
  }
});

test('every column means what the module says it means, on every row', () => {
  // The sheet's column headers are its recognition system; a learner reads them first. So each is read back
  // off the row's own picture rather than trusted.
  const frAt = (s) => { const slot = s.ep.indexOf(E('FR')); return { slot: EDGES[slot], bad: s.eo[slot] === 1 }; };
  const letter = (bad) => (bad ? 'B' : 'G');
  for (const r of MEHTA_EOLE) {
    const s = pictureOf(r); const fr = frAt(s);
    const want = { solved: ['FR', false], flipped: ['FR', true], 'dr-good': ['DR', false], 'dr-bad': ['DR', true] }[r.group];
    if (want) assert.deepEqual([fr.slot, fr.bad], want, `${r.name}: the last middle-layer edge is not where "${r.group}" says`);
    else assert.equal(`${fr.slot}:${letter(fr.bad)}${letter(s.eo[E('FR')] === 1)}`, `UF:${r.group}`, `${r.name}: not what "${r.group}" says`);
  }
  const whiteFacing = (s, slot) => {
    const f = toFacelets(s);
    const i = CORNER_FACELETS_OF(slot).find((k) => f[k] === 'U' || f[k] === 'D');
    return 'URFDLB'[Math.floor(i / 9)];
  };
  for (const r of MEHTA_6CO) {
    const s = pictureOf(r);
    assert.equal(`${whiteFacing(s, 'DFR')}${whiteFacing(s, 'DRB')}`, r.group, `${r.name}: the bottom corners' white stickers are not "${r.group}"`);
  }
  // L5EP's right/front/back: the bottom layer is drawn turned so that the gap the block leaves — the DR slot of
  // the solved bottom — is at the right, the front or the back.
  for (const r of MEHTA_L5EP) {
    if (!r.dEdge) continue;
    const gap = EDGES[applyAlg(SOLVED, r.bottom ?? '').ep.indexOf(E('DR'))];
    assert.equal(gap, { right: 'DR', front: 'DF', back: 'DB' }[r.dEdge], `${r.name}: the bottom's gap is at ${gap}`);
  }
  const NUMBER = { UFL: 1, ULB: 2, UBR: 3, URF: 4, DFR: 5, DRB: 6 };
  for (const r of MEHTA_6CP) {
    const s = pictureOf(r);
    const seen = AUF.map((a) => { const v = compose(s, applyAlg(SOLVED, a)); return `${NUMBER[CORNERS[v.cp.indexOf(C('DFR'))]]}-${NUMBER[CORNERS[v.cp.indexOf(C('DRB'))]]}`; });
    assert.ok(seen.includes(r.group), `${r.name}: the two bottom corners are at ${seen.join(' / ')}, never "${r.group}"`);
  }
});

test('the coverage check can fail: a set missing a row leaves its case uncovered', () => {
  // Without this, an enumeration that produced too few cases would pass the test above vacuously.
  const rows = MEHTA_EOLE.slice(1);
  const drawn = new Set(rows.map((r) => caseOf('eole', pictureOf(r))));
  assert.ok(!drawn.has(caseOf('eole', pictureOf(MEHTA_EOLE[0]))));
});

// ---------- the beginner path ----------
const DFR = C('DFR');
const DRB = C('DRB');
const steps = {
  eo: { start: (s) => block(s) && edgesHome(s, BELT), to: STEP['6co'].from },
  'dcal-1': { start: STEP['6co'].from, to: (s) => STEP['6co'].from(s) && cornersHome(s, [DRB]) },
  'dcal-2': { start: (s) => STEP['6co'].from(s) && cornersHome(s, [DRB]), to: (s) => STEP['6co'].from(s) && cornersHome(s, [DRB, DFR]) },
  'cdrll-1': { start: (s) => STEP['6co'].from(s) && cornersHome(s, [DRB, DFR]), to: (s) => STEP['6co'].from(s) && cornersHome(s, [DRB, DFR]) && coDone(s) },
  'cdrll-2': { start: (s) => STEP['6co'].from(s) && cornersHome(s, [DRB, DFR]) && coDone(s), to: STEP.l5ep.from },
  'd-edge': { start: STEP.l5ep.from, to: (s) => STEP.l5ep.from(s) && edgesHome(s, [E('DR')]) },
  epll: { start: (s) => STEP.l5ep.from(s) && edgesHome(s, [E('DR')]), to: STEP.l5ep.to },
};
const U_C = ['URF', 'UFL', 'ULB', 'UBR'].map(C);
const U_E = ['UF', 'UL', 'UB', 'UR'].map(E);
/** The states each beginner step meets: what it reads varied, the rest solved. */
function* beginnerStates(step) {
  if (step === 'eo') {
    for (let m = 0; m < 32; m++) {
      const f = FREE_E.map((_, i) => (m >> i) & 1);
      if (f.reduce((x, y) => x + y) % 2) continue;
      const s = copy(SOLVED); FREE_E.forEach((k, i) => { s.eo[k] = f[i]; }); yield s;
    }
  } else if (step === 'dcal-1' || step === 'dcal-2') {
    const piece = step === 'dcal-1' ? DRB : DFR;
    const slots = step === 'dcal-1' ? SIX_C : [...U_C, DFR];
    // A corner the step does not read, to take the balancing twist when the piece is twisted in its own slot:
    // DFR is free in DCAL-1, and every top corner is free in DCAL-2.
    const spare = step === 'dcal-1' ? DFR : C('URF');
    for (const slot of slots) for (let t = 0; t < 3; t++) {
      const s = copy(SOLVED);
      if (slot === piece) {
        // Twisted at home: the twist is balanced on the spare corner.
        s.co[piece] = t; s.co[spare] = (3 - t) % 3;
      } else {
        // The piece goes to `slot` and whatever was there takes its place, twisted back so the sum is whole;
        // the corner swap is odd, so two top edges (free in both steps) are swapped to keep the cube legal.
        [s.cp[slot], s.cp[piece]] = [s.cp[piece], s.cp[slot]];
        s.co[slot] = t; s.co[piece] = (3 - t) % 3;
        swapTwoEdges(s);
      }
      yield s;
    }
  } else if (step === 'cdrll-1') {
    for (let m = 0; m < 81; m++) {
      const t = U_C.map((_, i) => Math.floor(m / 3 ** i) % 3);
      if (t.reduce((x, y) => x + y) % 3) continue;
      const s = copy(SOLVED); U_C.forEach((k, i) => { s.co[k] = t[i]; }); yield s;
    }
  } else if (step === 'cdrll-2') {
    for (const p of perms(U_C)) { const s = copy(SOLVED); U_C.forEach((k, i) => { s.cp[k] = p[i]; }); if (parity(s.cp)) swapTwoEdges(s); yield s; }
  } else if (step === 'd-edge') {
    for (const p of perms(FREE_E)) { const s = copy(SOLVED); FREE_E.forEach((k, i) => { s.ep[k] = p[i]; }); if (!parity(s.ep)) yield s; }
  } else {
    for (const p of perms(U_E)) { const s = copy(SOLVED); U_E.forEach((k, i) => { s.ep[k] = p[i]; }); if (!parity(s.ep)) yield s; }
  }
}
/** Does some turn of the top, then one of `rows` (with its own `pre`), finish `step` from `s`? */
const finishes = (step, s, rows) => rows.some((r) => AUF.some((a) => upToTurns(play(s, `${a} ${r.pre ?? ''} ${r.alg}`), steps[step].to)));

/** A piece state is a real cube: corner and edge parities agree, twists and flips sum whole, and cubejs reads it back unchanged. */
const assertLegal = (s, label) => {
  assert.equal(parity(s.cp), parity(s.ep), `${label}: corner and edge permutation parities differ`);
  assert.equal(s.co.reduce((x, y) => x + y) % 3, 0, `${label}: the corner twists do not sum whole`);
  assert.equal(s.eo.reduce((x, y) => x + y) % 2, 0, `${label}: the edge flips do not sum whole`);
  assert.deepEqual(fromCube(Cube.fromString(toFacelets(s))), s, `${label}: cubejs does not read the state back`);
};

test('the DCAL enumerations are legal cubes, as many as the step can meet', () => {
  // DCAL-1 places DRB: it can sit in any of six slots (four top, DFR, DRB) with any of three twists — 6 * 3 = 18
  // states, one of them solved, so 17 to finish. DCAL-2 places DFR with DRB kept: five slots (four top, DFR),
  // three twists — 15 states, 14 to finish. Every one must be a cube a hand could hold.
  for (const [step, total, open] of [['dcal-1', 18, 17], ['dcal-2', 15, 14]]) {
    const states = [...beginnerStates(step)];
    for (const s of states) assertLegal(s, `${step} ${toFacelets(s)}`);
    assert.equal(new Set(states.map(toFacelets)).size, total, `${step}: distinct states`);
    assert.equal(states.filter((s) => !upToTurns(s, steps[step].to)).length, open, `${step}: states to finish`);
  }
});

test('every beginner step finishes every state it can meet, with a turn of the top and one of its algorithms', () => {
  for (const step of MEHTA_BEGINNER_STEPS) {
    const rows = MEHTA_BEGINNER.filter((r) => r.step === step);
    let met = 0;
    for (const s of beginnerStates(step)) {
      assert.ok(upToTurns(s, steps[step].start), `${step}: the enumeration made a state the step cannot start from`);
      if (upToTurns(s, steps[step].to)) continue;
      met += 1;
      assert.ok(finishes(step, s, rows), `${step}: no algorithm finishes ${toFacelets(s)}`);
    }
    assert.ok(met > 0, `${step}: the enumeration met nothing to finish`);
    // And every algorithm of the step finishes something: none is listed for a case that cannot arise.
    for (const r of rows) {
      assert.ok([...beginnerStates(step)].some((s) => !upToTurns(s, steps[step].to) && finishes(step, s, [r])), `${r.name} finishes no ${step} state`);
    }
  }
});

test('the beginner check can fail: EPLL without its H perm leaves the H case unfinished', () => {
  const rows = MEHTA_BEGINNER.filter((r) => r.step === 'epll' && r.alg !== 'M2 U M2 U2 M2 U M2');
  assert.equal(rows.length, 3);
  const h = play(SOLVED, 'M2 U M2 U2 M2 U M2');
  assert.ok(!finishes('epll', h, rows));
});

test('every row ends with the centres home, and the app\'s interpreter agrees with cubejs on it', () => {
  for (const r of [...MEHTA_ALGS, ...MEHTA_BEGINNER]) {
    const c = new Cube();
    c.move(r.alg);
    const f = c.asString();
    for (const [i, face] of [[4, 'U'], [13, 'R'], [22, 'F'], [31, 'D'], [40, 'L'], [49, 'B']]) assert.equal(f[i], face, `${r.name} leaves the ${face} centre elsewhere`);
    const app = run(r.alg, ['U', 'F'], SOLVED);
    assert.deepEqual([...app.hold], ['U', 'F'], `${r.name} leaves the cube turned`);
    assert.equal(toFacelets(app.state), f, `${r.name} ("${r.alg}")`);
  }
});
