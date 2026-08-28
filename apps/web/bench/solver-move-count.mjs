// Reproduces every number in dev-docs/solver-move-count.md.
//
// The question behind it: can we make the app's solutions shorter, and can minimal
// move count serve as a difficulty rating for a scramble? Both turn out to be bounded
// by search time, not by any missing data — so the numbers below are the argument.
//
// Lives in apps/web/ because it imports this package's `cubing` and `cubejs`; pnpm
// does not hoist them to the repo root, so a script under dev-docs/ cannot resolve
// them. build.mjs copies an explicit DIRS list, so bench/ never reaches dist/.
//
// Run (from apps/web):
//   node bench/solver-move-count.mjs            # baseline + rotations + shallow, ~4 min
//   node bench/solver-move-count.mjs baseline   # cubing.js min2phase lengths, ~1 s
//   node bench/solver-move-count.mjs rotations  # best-of-24 whole-cube rotations, ~4 s
//   node bench/solver-move-count.mjs sweep      # cubejs maxDepth 22/21/20, ~3 min
//   node bench/solver-move-count.mjs shallow    # minimal length for shallow states, ~5 min
//   node bench/solver-move-count.mjs all        # everything
//
// `sweep`'s bottom row and `shallow`'s 14-move rows are minutes of CPU. That cost IS the
// finding — see the note — so they are kept rather than trimmed, but every shallow trial
// is capped (BENCH_BUDGET_MS, default 120000) and reports the cap rather than running
// unbounded. A benchmark nobody can afford to finish is a benchmark nobody runs.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Cube = require('cubejs');

const N_STATES = 20;
// Wall-clock cap per shallow trial. Checked BETWEEN attempts, so a single attempt already
// in flight can overrun it — the descent's last, failing probe is the expensive one.
const TRIAL_BUDGET_MS = Number(process.env.BENCH_BUDGET_MS ?? 120_000);
const mean = (a) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2);
const lenOf = (alg) => { const s = alg.toString().trim(); return s ? s.split(/\s+/).length : 0; };

// Seeded so the shallow table reproduces exactly. Random-state scrambles cannot be
// seeded through cubing's API, so baseline/rotations/sweep vary by a few hundredths.
function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const FACES = ['U', 'D', 'L', 'R', 'F', 'B'];
const SUFFIX = ['', "'", '2'];

/** A k-move random walk with no same-face repeat. NOTE: its true minimal length is
 *  often BELOW k — cancellations and coincidences collapse it. Measure, never assume. */
function randomWalk(k, seed) {
  const rnd = lcg(seed);
  const out = [];
  let prev = -1;
  while (out.length < k) {
    const f = Math.floor(rnd() * 6);
    if (f === prev) continue;
    prev = f;
    out.push(FACES[f] + SUFFIX[Math.floor(rnd() * 3)]);
  }
  return out.join(' ');
}

/** cubejs throws rather than returning empty when nothing exists within maxDepth. */
function solveOrNull(cube, maxDepth) {
  try {
    const s = cube.solve(maxDepth);
    return s && s.trim() ? s.trim() : null;
  } catch {
    return null;
  }
}

let cubingSolve = null;
let cubingPuzzle = null;
let cubingScramble = null;
async function loadCubing() {
  if (cubingSolve) return;
  ({ experimentalSolve3x3x3IgnoringCenters: cubingSolve } = await import('cubing/search'));
  ({ cube3x3x3: cubingPuzzle } = await import('cubing/puzzles'));
  ({ randomScrambleForEvent: cubingScramble } = await import('cubing/scramble'));
}

async function scrambleSet(n) {
  await loadCubing();
  const out = [];
  for (let i = 0; i < n; i++) out.push((await cubingScramble('333')).toString());
  return out;
}

// --- 1. What the app ships today ---------------------------------------------------
// cubing.js runs min2phase with solLen=22, probeMin=0, fullInit=false: it returns the
// FIRST solution of length <= 21 and stops, leaving its time budget untouched.
async function baseline(scrambles) {
  await loadCubing();
  const kpuzzle = await cubingPuzzle.kpuzzle();
  const lens = [];
  const t0 = Date.now();
  for (const scr of scrambles) {
    lens.push(lenOf(await cubingSolve(kpuzzle.defaultPattern().applyAlg(scr))));
  }
  const ms = Date.now() - t0;
  console.log(`\n[baseline] cubing.js min2phase, n=${scrambles.length}`);
  console.log(`  lengths: ${lens.join(' ')}`);
  console.log(`  mean ${mean(lens)} moves | ${(ms / scrambles.length).toFixed(1)} ms per solve`);
  return lens;
}

// --- 2. The free trick that does not work ------------------------------------------
// Conjugating by a whole-cube rotation re-orders min2phase's search without changing
// the answer's length, so best-of-24 looks like a free win. It is not: min2phase
// already loops all 6 URF conjugations internally, so 24 rotations buy almost nothing.
async function rotations(scrambles) {
  await loadCubing();
  const kpuzzle = await cubingPuzzle.kpuzzle();
  const ROT = [];
  for (const a of ['', 'x', 'x2', "x'", 'z', "z'"]) {
    for (const b of ['', 'y', 'y2', "y'"]) ROT.push(`${a} ${b}`.trim());
  }
  const invert = (alg) =>
    alg.split(/\s+/).filter(Boolean).reverse()
      .map((m) => (m.endsWith('2') ? m : m.endsWith("'") ? m[0] : `${m}'`))
      .join(' ');

  const base = [];
  const best = [];
  const t0 = Date.now();
  for (const scr of scrambles) {
    let lo = Infinity;
    for (let i = 0; i < ROT.length; i++) {
      const r = ROT[i];
      const alg = r ? `${r} ${scr} ${invert(r)}` : scr;
      const n = lenOf(await cubingSolve(kpuzzle.defaultPattern().applyAlg(alg)));
      if (i === 0) base.push(n);
      if (n < lo) lo = n;
    }
    best.push(lo);
  }
  console.log(`\n[rotations] best of ${ROT.length} whole-cube rotations, n=${scrambles.length}`);
  console.log(`  base   mean ${mean(base)}`);
  console.log(`  best24 mean ${mean(best)}`);
  console.log(`  ${Date.now() - t0} ms total — ${(+mean(base) - +mean(best)).toFixed(2)} moves gained`);
}

// --- 3. The cost of asking for one move fewer ---------------------------------------
// Each move shaved costs roughly an order of magnitude. This is the wall.
function sweep(scrambles) {
  console.log(`\n[sweep] cubejs by maxDepth, n=${scrambles.length}`);
  const t = Date.now();
  Cube.initSolver();
  console.log(`  initSolver ${Date.now() - t} ms (tables are COMPUTED, never downloaded)`);
  for (const depth of [22, 21, 20]) {
    const lens = [];
    const times = [];
    for (const scr of scrambles) {
      const c = new Cube().move(scr);
      const t0 = Date.now();
      const sol = solveOrNull(c, depth);
      times.push(Date.now() - t0);
      if (sol) lens.push(sol.split(/\s+/).length);
    }
    console.log(
      `  maxDepth=${depth}: solved ${lens.length}/${scrambles.length} | ` +
        `mean ${mean(lens)} moves | mean ${mean(times)} ms | worst ${Math.max(...times)} ms`,
    );
  }
  console.log('  maxDepth=19 omitted: minutes-to-hours per state.');
}

// --- 4. Where a difficulty rating is actually affordable ----------------------------
// Descend until the search fails. This is the minimal TWO-PHASE length — an upper
// bound on the true optimum, never a proof of it (see the note, section 4).
function shallow() {
  console.log('\n[shallow] minimal two-phase length for shallow states');
  const t = Date.now();
  Cube.initSolver();
  console.log(`  initSolver ${Date.now() - t} ms`);
  console.log(`  cap ${TRIAL_BUDGET_MS} ms per trial`);
  console.log('  walk |   min | ms     | scramble');
  for (const k of [8, 10, 12, 14]) {
    for (let trial = 0; trial < 4; trial++) {
      const scr = randomWalk(k, k * 1000 + trial * 7 + 1);
      const cube = new Cube().move(scr);
      const t0 = Date.now();
      let lo = null;
      let capped = false;
      for (let d = k; d >= 1; d--) {
        if (Date.now() - t0 > TRIAL_BUDGET_MS) { capped = true; break; }
        const sol = solveOrNull(cube, d);
        if (!sol) break;
        lo = sol.split(/\s+/).length;
        if (lo < d) d = lo + 1; // skip straight below what was actually found
      }
      const ms = Date.now() - t0;
      // A capped trial is reported, never dropped: `<=` says the true minimum may be lower
      // and we ran out of budget looking. Silently printing `lo` would read as a measurement.
      const shown = capped ? `<=${lo}` : String(lo);
      console.log(
        `  ${String(k).padStart(4)} | ${shown.padStart(5)} | ${String(ms).padStart(6)} | ${scr}` +
          (capped ? '  [capped]' : ''),
      );
    }
  }
  console.log('  NOTE: `min` below `walk` means the walk collapsed — always measure.');
}

// --- 5. A gotcha kept honest by an assertion ----------------------------------------
// cubejs's solve() dereferences a null solution when maxDepth is too small, so it
// THROWS instead of failing cleanly. Every caller that lowers maxDepth needs a catch.
// Asserted rather than merely written down: a documented gotcha silently stops being
// true, a checked one does not.
function assertShallowDepthThrows() {
  const cube = new Cube().move("R U R' U' F2 L D2 B'");
  let threw = false;
  try {
    cube.solve(1);
  } catch {
    threw = true;
  }
  if (!threw) {
    throw new Error(
      'ASSERTION FAILED: cubejs solve(1) no longer throws on an unreachable depth.\n' +
        '  dev-docs/solver-move-count.md documents this throw and callers catch it.\n' +
        '  If cubejs now returns cleanly, update the note and simplify solveOrNull().',
    );
  }
  console.log('\n[assert] cubejs solve() still throws when maxDepth is unreachable — OK');
}

const stage = process.argv[2] ?? 'default';
const wants = (name) =>
  stage === 'all' || stage === name || (stage === 'default' && name !== 'sweep');

Cube.initSolver();
assertShallowDepthThrows();

if (wants('baseline') || wants('rotations')) {
  const scrambles = await scrambleSet(N_STATES);
  if (wants('baseline')) await baseline(scrambles);
  if (wants('rotations')) await rotations(scrambles);
  if (wants('sweep')) sweep(scrambles);
} else if (wants('sweep')) {
  sweep(await scrambleSet(N_STATES));
}
if (wants('shallow')) shallow();

// cubing.js keeps a worker alive; without this the process hangs after the last stage.
process.exit(0);
