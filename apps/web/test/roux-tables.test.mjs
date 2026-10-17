// Roux's tables (lib/methods/roux-tables.js, roux-build.js, roux-load.js): the block frame they are built in,
// the shipped files, the descent, and the loader — each held to something that is not itself.
//
// THE ORACLES. cubejs, for what a move does in the block frame and for every route; the app's interpreter
// (`run`, lib/cube-moves.js), for the claim the design rests on — that at a boundary with the slice lined up,
// the block frame and the piece model are the same state; and a breadth-first search over whole cubes, which
// shares nothing with any table, for distances.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

import { MOVES, SOLVED, applyAlg, applyMove } from '../lib/cube-pieces.js';
import { run } from '../lib/cube-moves.js';
import { ROUX_TABLES } from '../lib/data/roux-manifest.js';
import {
  FIRST_BLOCK_TABLE, LSE_MOVES, LSE_SOLVED, SECOND_BLOCK_TABLE, TOP_TURNS, buildRouxTables, buildSideTables, sidesHome,
} from '../lib/methods/roux-build.js';
import { SECOND_BLOCK, firstBlockBuilt } from '../lib/methods/roux-blocks.js';
import { checkedTable, forgetRouxTables, prepareRoux, rouxTables } from '../lib/methods/roux-load.js';
import {
  LSE_SIZE, M_PHYSICAL, applyBlockMove, blockMoves, buildDistances, descend, edgesOriented, fnv1a,
  keepsOrientation, lseCodeOf, lseDecode, lseStep, pack, packedAt,
} from '../lib/methods/roux-tables.js';
import { manifestSource, onDiskMatches } from '../regen-roux-tables.mjs';
import { seededScrambles } from './fixtures/seeded-scrambles.mjs';

const Cube = (await import(new URL('../vendor/cubejs.js', import.meta.url))).default;

const sameState = (a, b) => ['cp', 'co', 'ep', 'eo'].every((k) => a[k].every((v, i) => v === b[k][i]));
const cubejsAfter = (alg) => { const c = new Cube(); if (alg) c.move(alg); return c; };

await prepareRoux();
const TABLES = rouxTables();

/** The tables built from nothing, ONCE for the file: a build is most of this file's cost. */
let built = null;
const rebuilt = () => (built ??= buildRouxTables());

// ---- 1. the block frame ------------------------------------------------------------------------------

test('the middle slice, as data, is cubejs\'s M — and M2 and M\' composed from it are cubejs\'s too', () => {
  for (const [name, n] of [['M', 1], ['M2', 2], ["M'", 3]]) {
    let s = SOLVED;
    for (let i = 0; i < n; i++) s = applyBlockMove(s, { action: M_PHYSICAL });
    assert.ok(sameState(s, cubejsAfter(name)), `${name}: the block frame and cubejs disagree`);
    const [move] = blockMoves([name]);
    assert.ok(sameState(applyBlockMove(SOLVED, move), cubejsAfter(name)), `${name}: blockMoves' action is not cubejs's`);
    assert.equal(move.slice, n, `${name} turns the slice ${n}`);
  }
  // A face turn's action is the piece model's own, so the two frames agree on every one.
  for (const name of Object.keys(MOVES)) {
    assert.ok(sameState(applyBlockMove(SOLVED, blockMoves([name])[0]), cubejsAfter(name)), name);
  }
});

/** A seeded sequence of R, U and M turns, each read off the scramble generator's letters. */
function rumSequences(n, seed) {
  const map = { R: 'R', L: 'M', U: 'U', D: 'U', F: 'M', B: 'R' };
  return seededScrambles(n, seed, 14).map((s) => s.split(' ').map((m) => map[m[0]] + m.slice(1)));
}

test('where the slice\'s turns add up to none, the block frame IS the piece model, and the hold is upright again', () => {
  // The claim every Roux stage boundary rests on (lib/methods/roux.js). Checked on the app's interpreter,
  // which reads `M` as `R L'` with the cube turned — a different arithmetic from the block frame's.
  const names = ['R', 'R2', "R'", 'U', 'U2', "U'", 'M', 'M2', "M'"];
  const moves = blockMoves(names);
  let aligned = 0;
  for (const seq of rumSequences(400, 0x50f7)) {
    let s = SOLVED;
    let k = 0;
    for (const name of seq) { const m = moves[names.indexOf(name)]; s = applyBlockMove(s, m); k += m.slice; }
    const fix = [null, "M'", 'M2', 'M'][k % 4];
    const alg = [...seq, ...(fix ? [fix] : [])].join(' ');
    if (fix) s = applyBlockMove(s, moves[names.indexOf(fix)]);
    const played = run(alg, ['U', 'F'], SOLVED);
    assert.deepEqual([...played.hold], ['U', 'F'], `${alg}: the hold is not upright with the slice lined up`);
    assert.ok(sameState(played.state, s), `${alg}: the block frame and the interpreter disagree at an aligned point`);
    assert.ok(sameState(s, cubejsAfter(alg)), `${alg}: and cubejs disagrees with both`);
    aligned++;
  }
  assert.equal(aligned, 400);
  // And what must NOT hold: one quarter of the slice and the two frames are different states, with the hold
  // tilted — which is why a stage may not END there.
  const played = run('M', ['U', 'F'], SOLVED);
  assert.notDeepEqual([...played.hold], ['U', 'F']);
  assert.ok(!sameState(played.state, applyBlockMove(SOLVED, { action: M_PHYSICAL })));
});

// ---- 2. the shipped tables ---------------------------------------------------------------------------

test('the shipped tables are exactly what the build makes, and the manifest names their sizes and checksums', () => {
  const built = rebuilt();
  assert.ok(onDiskMatches(built), 'lib/data/roux/ is stale — run node regen-roux-tables.mjs');
  assert.equal(manifestSource(built).length > 0, true);
  const byId = Object.fromEntries(built.map((t) => [t.id, t]));
  // Named numbers: a table that changed shape is about a different question.
  assert.equal(byId['first-block'].reached, 5_322_240, 'every first-block position is reachable');
  assert.equal(byId['first-block'].deepest, 9);
  assert.equal(byId['second-block'].reached, 1_088_640);
  assert.equal(byId['second-block'].deepest, 16);
  assert.equal(byId['lse-orient'].reached, 184_320, 'the reachable last-six-edges positions');
  assert.equal(byId['lse-orient'].deepest, 10);
  for (const row of ROUX_TABLES) assert.equal(row.bytes, Math.ceil(row.codes / 4), `${row.id}: two bits a code`);
});

test('git keeps the shipped tables as bytes, so no checkout rewrites one', (t) => {
  // A table with an LF byte and no NUL reads to git as text, and a checkout with core.autocrlf (GitHub's Windows
  // runners) would turn LF into CRLF — a table the loader then refuses on its checksum, in every Windows build.
  // lse-orient.bin was read as text when it was first added (it holds no NUL), so the attribute is not a nicety.
  const paths = ROUX_TABLES.map((row) => `apps/web/lib/data/roux/${row.file}`);
  let out;
  try {
    out = execFileSync('git', ['check-attr', 'binary', 'text', 'diff', '--', ...paths],
      { cwd: new URL('../../..', import.meta.url), encoding: 'utf8' });
  } catch {
    return t.skip('git could not be asked for the tables\' attributes — this is not a checkout');
  }
  for (const path of paths) {
    assert.ok(out.includes(`${path}: binary: set`), `${path} is not marked binary in .gitattributes`);
    assert.ok(out.includes(`${path}: text: unset`), `${path} may still be converted as text`);
  }
});

test('a packed descent is as long as the exact distance, from every sampled code, and stops at the goal itself', () => {
  // Codex's trap (refute pass, 2026-10-17): a descent that stopped at a residue of zero returns an empty
  // route from a cube three moves out. `F U L` is three from a built first block.
  const fb = FIRST_BLOCK_TABLE;
  const exact = rebuilt().find((t) => t.id === 'first-block').dist;
  const goal = fb.codeOf(SOLVED);
  const reader = { value: (c) => packedAt(TABLES['first-block'], c), mod: 3, unreached: 3, moveCount: fb.moves.length, step: fb.step, atGoal: (c) => c === goal };
  const trap = fb.codeOf(applyAlg(SOLVED, 'F U L'));
  assert.equal(exact[trap], 3);
  assert.equal(descend(trap, reader).length, 3, 'the descent did not take three moves from F U L');
  // Every residue class, deep codes included: a stride through the whole table.
  let checked = 0;
  for (let code = 7; code < fb.size; code += 2_663) {
    const route = descend(code, reader);
    assert.equal(route.length, exact[code], `code ${code}: descended ${route.length}, distance ${exact[code]}`);
    let at = code;
    for (const m of route) at = fb.step(at, m);
    assert.equal(at, goal, `code ${code}: the descent ended off the goal`);
    checked++;
  }
  assert.ok(checked > 1_900, `only ${checked} codes descended`);
});

test('a block table\'s distance is the true one: a breadth-first search over whole cubes agrees, to depth 4', () => {
  // Shares nothing with the tables: real cubes through the piece model, asked the block predicate.
  const exact = rebuilt().find((t) => t.id === 'first-block').dist;
  const shortestTo = (start, goalFn, limit) => {
    let level = [start];
    const seen = new Set([key(start)]);
    for (let d = 0; d <= limit; d++) {
      if (level.some(goalFn)) return d;
      const next = [];
      for (const s of level) for (const m of Object.keys(MOVES)) { const t = applyMove(s, m); const k = key(t); if (!seen.has(k)) { seen.add(k); next.push(t); } }
      level = next;
    }
    return null;
  };
  let compared = 0;
  for (const scramble of seededScrambles(40, 0xfb1, 4)) {
    const state = applyAlg(SOLVED, scramble);
    const want = shortestTo(state, firstBlockBuilt, 4);
    assert.ok(want !== null, `${scramble}: four turns from solved, so at most four from a built block`);
    assert.equal(exact[FIRST_BLOCK_TABLE.codeOf(state)], want, `${scramble}: the table says ${exact[FIRST_BLOCK_TABLE.codeOf(state)]}, the search ${want}`);
    compared++;
  }
  assert.equal(compared, 40);
});

const key = (s) => `${s.cp.join('')}|${s.co.join('')}|${s.ep.join(',')}|${s.eo.join('')}`;

test('every block route, replayed in cubejs, builds its block — and the second never touches the first', () => {
  const fbGoal = FIRST_BLOCK_TABLE.codeOf(SOLVED);
  const sbGoal = SECOND_BLOCK_TABLE.codeOf(SOLVED);
  for (const scramble of seededScrambles(60, 0xb10c, 25)) {
    const state = applyAlg(SOLVED, scramble);
    const fb = descend(FIRST_BLOCK_TABLE.codeOf(state), { value: (c) => packedAt(TABLES['first-block'], c), mod: 3, unreached: 3, moveCount: FIRST_BLOCK_TABLE.moves.length, step: FIRST_BLOCK_TABLE.step, atGoal: (c) => c === fbGoal });
    const fbAlg = fb.map((m) => FIRST_BLOCK_TABLE.moves[m].name).join(' ');
    const afterFb = cubejsAfter([scramble, fbAlg].filter(Boolean).join(' '));
    assert.ok(firstBlockBuilt(afterFb), `${scramble}: cubejs says the first block route does not build it`);
    const sb = descend(SECOND_BLOCK_TABLE.codeOf(applyAlg(state, fbAlg)), { value: (c) => packedAt(TABLES['second-block'], c), mod: 3, unreached: 3, moveCount: SECOND_BLOCK_TABLE.moves.length, step: SECOND_BLOCK_TABLE.step, atGoal: (c) => c === sbGoal });
    const sbAlg = sb.map((m) => SECOND_BLOCK_TABLE.moves[m].name).join(' ');
    assert.ok(sb.every((m) => /^[RUM]/.test(SECOND_BLOCK_TABLE.moves[m].name)), `${scramble}: the second block turned something other than R, U and M`);
    const afterSb = cubejsAfter([scramble, fbAlg, sbAlg].filter(Boolean).join(' '));
    // cubejs keeps positions physical, so its blocks are measured against the L and R centres — the slice
    // may be off, and is lined up by the stage, not the table.
    assert.ok(firstBlockBuilt(afterSb) && allSecondBlock(afterSb), `${scramble}: cubejs says the second block route does not build both`);
  }
});

const allSecondBlock = (c) => SECOND_BLOCK.edges.every((e) => c.ep[e] === e && c.eo[e] === 0) && SECOND_BLOCK.corners.every((q) => c.cp[q] === q && c.co[q] === 0);

// ---- 3. the last six edges ---------------------------------------------------------------------------

test('the oriented positions are exactly what the moves that keep them reach from solved — 5,760 of 184,320', () => {
  const all = buildDistances(LSE_SIZE, [LSE_SOLVED], LSE_MOVES.length, (c, m) => lseStep(c, LSE_MOVES[m]));
  let reachable = 0;
  let oriented = 0;
  let leaks = 0;
  for (let c = 0; c < LSE_SIZE; c++) {
    if (all[c] === 0xff) continue;
    reachable++;
    const d = lseDecode(c);
    if (!edgesOriented(d)) continue;
    oriented++;
    // Closed: no move that keeps orientation takes an oriented position out of the set.
    for (const m of LSE_MOVES) if (keepsOrientation(m, d.k) && !edgesOriented(lseDecode(lseStep(c, m)))) leaks++;
  }
  assert.equal(reachable, 184_320);
  assert.equal(oriented, 5_760);
  assert.equal(oriented * 32, reachable, 'one orientation in thirty-two — the six flips, their parity fixed');
  assert.equal(leaks, 0, 'a move that keeps the orientation broke it');
  // And it is the orbit: the built-on-load table reaches every oriented position and nothing else.
  const { finish, oriented: covered } = buildSideTables();
  assert.equal(covered, 5_760);
  for (let c = 0; c < LSE_SIZE; c++) {
    if (finish[c] === 0xff) continue;
    assert.ok(edgesOriented(lseDecode(c)), `code ${c} is in the finish table and not oriented`);
  }
});

test('every last-six-edges route, replayed in cubejs, solves the cube, and the last two keep the edges oriented', () => {
  const read = { orient: (c) => packedAt(TABLES['lse-orient'], c), sides: (c) => TABLES.sides[c], finish: (c) => TABLES.finish[c] };
  const keeping = (c, m) => keepsOrientation(LSE_MOVES[m], lseDecode(c).k);
  // Positions after CMLL: the six edges, the slice and the top as random as M and U make them.
  const map = { U: 'U', D: 'M', R: 'U2', L: "M'", F: 'M2', B: "U'" };
  for (const s of seededScrambles(150, 0x15e, 30)) {
    const alg = s.split(' ').map((m) => map[m[0]]).join(' ');
    // Lined up first, as CMLL leaves it: the stage starts from a slice standing straight.
    const c0 = cubejsAfter(alg);
    const k = [0, 1, 2, 3].find((n) => { const t = cubejsAfter(['', 'M', 'M2', "M'"][n]); return [0, 2, 3, 5].every((i) => t.center[i] === c0.center[i]); });
    const start = [alg, [null, "M'", 'M2', 'M'][k]].filter(Boolean).join(' ');
    let code = lseCodeOf(cubejsAfter(start), 0, TOP_TURNS);
    assert.ok(code >= 0, `${start}: not a last-six-edges position`);
    const parts = [
      ['orient', undefined, (c) => edgesOriented(lseDecode(c)), 3, 3],
      ['sides', keeping, sidesHome, 256, 0xff],
      ['finish', keeping, (c) => c === LSE_SOLVED, 256, 0xff],
    ];
    const played = [];
    for (const [id, allowed, atGoal, mod, unreached] of parts) {
      const route = descend(code, { value: read[id], mod, unreached, moveCount: LSE_MOVES.length, step: (c, m) => lseStep(c, LSE_MOVES[m]), allowed, atGoal });
      for (const m of route) code = lseStep(code, LSE_MOVES[m]);
      played.push(...route.map((m) => LSE_MOVES[m].name));
    }
    const done = cubejsAfter([start, ...played].join(' '));
    assert.ok(done.isSolved(), `${start}: cubejs says the three steps do not solve it (${played.join(' ')})`);
  }
});

// ---- 4. loading ----------------------------------------------------------------------------------------

test('a table that is short, or one byte off, is refused before anything descends it', () => {
  const row = ROUX_TABLES.find((r) => r.id === 'second-block');
  const good = new Uint8Array(TABLES['second-block']);
  assert.equal(checkedTable(row, good), good);
  assert.throws(() => checkedTable(row, good.slice(1)), /is 272159 bytes, not 272160/);
  const bad = good.slice();
  bad[1234] ^= 1;
  assert.throws(() => checkedTable(row, bad), /does not match its checksum/);
  assert.equal(fnv1a(good), row.fnv);
});

test('a stage asked before the tables load throws; a failed load is not remembered, and the next one succeeds', async () => {
  forgetRouxTables();
  assert.throws(() => rouxTables(), /not loaded — await prepareRoux\(\)/);
  let calls = 0;
  const flaky = async (file) => {
    calls++;
    if (calls === 1) throw new Error('the network dropped');
    const { readFile } = await import('node:fs/promises');
    return new Uint8Array(await readFile(new URL(`../lib/data/roux/${file}`, import.meta.url)));
  };
  await assert.rejects(prepareRoux({ read: flaky }), /the network dropped/);
  assert.throws(() => rouxTables(), /not loaded/, 'a failed load left something loaded');
  // Two callers at once share one load.
  const [a, b] = await Promise.all([prepareRoux({ read: flaky }), prepareRoux({ read: flaky })]);
  assert.equal(a, b);
  assert.equal(calls, 1 + ROUX_TABLES.length, 'the second caller started a second load');
  assert.equal(rouxTables(), a);
});

// The packing helpers, against their definition: two bits, the distance mod 3, and 3 for unreached.
test('two bits a code: the distance mod 3, and 3 where the goal cannot be reached', () => {
  const dist = new Uint8Array([0, 1, 2, 3, 4, 5, 0xff, 9, 10]);
  const packed = pack(dist);
  assert.deepEqual([...dist].map((_, i) => packedAt(packed, i)), [0, 1, 2, 0, 1, 2, 3, 0, 1]);
  assert.equal(packed.length, 3);
});

