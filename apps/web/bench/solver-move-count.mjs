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
//   node bench/solver-move-count.mjs tune       # min2phase probeMin/fullInit ladder, ~6 min
//   node bench/solver-move-count.mjs targets    # move-count targets, the product question
//   node bench/solver-move-count.mjs contract   # what solve-target.js assumes of min2phase
//   node bench/solver-move-count.mjs all        # everything
//
// `sweep`'s bottom row and `shallow`'s 14-move rows are minutes of CPU. That cost IS the
// finding — see the note — so they are kept rather than trimmed, but every shallow trial
// is capped (BENCH_BUDGET_MS, default 120000) and reports the cap rather than running
// unbounded. A benchmark nobody can afford to finish is a benchmark nobody runs.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Cube = require('cubejs');

// 20 by default, which is what every recorded table used. Overridable because a success
// RATE needs more samples than a mean does: 20/20 is not evidence of "always".
const N_STATES = Number(process.env.BENCH_N ?? 20);
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

// --- 5. Tightening min2phase's own bounds --------------------------------------------
// The knob section 1 names but never turns. cubing.js hardcodes min2phase's search
// bounds inside `$solution` — solLen=22, probeMin=0, init_0(false) — and exposes none
// of them through its API, so this stage patches the compiled chunk in place.
//
// Two knobs, and they are not the same kind of thing:
//   probeMin  after min2phase finds a solution it keeps looking for a shorter one until
//             this many phase-2 probes have run. Buys moves, costs time.
//   fullInit  fills the pruning tables to MAX_DEPTH instead of MIN_DEPTH. It cannot
//             change which solutions exist, only how fast they are found — so the move
//             counts MUST come out identical to the partial-table run at every probeMin.
//             That identity is the check that the patch changed speed and nothing else.
//
// The chunk is located by CONTENT, never by its hashed filename, and every patch asserts
// its match count. A patch that silently stopped applying would print the shipped
// numbers under a tuned label, which is the one failure this stage cannot survive.
const TUNE_STATES = 30;
const TUNE_LADDER = (process.env.BENCH_PROBE_LADDER ?? '0,30,100,300,1000')
  .split(',').map((s) => Number(s.trim()));

/** min2phase is GWT-compiled: longs are `{ l, m, h }` with value = l + m*2^22 + h*2^44. */
const toLong = (n) => ({
  l: n % 4194304,
  m: Math.floor(n / 4194304) % 4194304,
  h: Math.floor(n / 17592186044416),
});

/** Load a copy of cubing's min2phase with solLen/probeMin/fullInit made settable. */
async function tunableMin2phase() {
  const { readdirSync, readFileSync, writeFileSync, mkdtempSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { fileURLToPath, pathToFileURL } = await import('node:url');

  const distRoot = dirname(dirname(fileURLToPath(import.meta.resolve('cubing/search'))));
  const chunks = join(distRoot, 'chunks');
  const hits = readdirSync(chunks).filter(
    (f) => f.endsWith('.js') && /function \$solution\(/.test(readFileSync(join(chunks, f), 'utf8')),
  );
  if (hits.length !== 1) {
    throw new Error(
      `tune: expected exactly one min2phase chunk under ${chunks}, found ${hits.length}.\n` +
        '  cubing’s chunk layout changed; re-derive the patch before trusting any number here.',
    );
  }
  const swap = (text, from, to, expect) => {
    const n = text.split(from).length - 1;
    if (n !== expect) {
      throw new Error(`tune: patch \`${from}\` matched ${n}x, expected ${expect}x — bounds moved.`);
    }
    return text.split(from).join(to);
  };
  let out = readFileSync(join(chunks, hits[0]), 'utf8');
  out = swap(out, 'this$static.solLen = 22;', 'this$static.solLen = TUNE.solLen;', 1);
  out = swap(out, 'this$static.probeMin = { l: 0, m: 0, h: 0 };', 'this$static.probeMin = TUNE.probeMin;', 1);
  out = swap(out, 'this$static.probeMax = { l: 3531008, m: 23, h: 0 };', 'this$static.probeMax = TUNE.probeMax;', 1);
  out = swap(out, 'init_0(false)', 'init_0(TUNE.fullInit)', 2);
  const EXPORTS = 'export {\n  initialize,\n  solvePattern\n}';
  if (!out.includes(EXPORTS)) throw new Error('tune: min2phase export block not found.');
  out = out.replace(
    EXPORTS,
    'var TUNE = { solLen: 22, probeMin: { l: 0, m: 0, h: 0 }, ' +
      'probeMax: { l: 3531008, m: 23, h: 0 }, fullInit: false };\n' +
      'var configure = function (t) { Object.assign(TUNE, t); };\n' +
      'export {\n  initialize,\n  solvePattern,\n  configure\n}',
  );
  const file = join(mkdtempSync(join(tmpdir(), 'min2phase-tune-')), 'min2phase.mjs');
  writeFileSync(file, out);
  return { module: await import(pathToFileURL(file).href), chunk: hits[0] };
}

/** One table setting, the whole probeMin ladder. Runs in a CHILD process (see tune()). */
async function tuneChild(fullInit, statesPath) {
  const { readFileSync } = await import('node:fs');
  const { module: m, chunk } = await tunableMin2phase();
  const states = JSON.parse(readFileSync(statesPath, 'utf8'));
  const label = fullInit ? 'full' : 'partial';

  const t0 = Date.now();
  m.configure({ fullInit });
  m.initialize();
  console.log(`\n[tune:${label}] ${chunk}`);
  console.log(`  table init ${Date.now() - t0} ms | n=${states.length}`);
  console.log('  probeMin |  moves | mean ms |  p90 ms | worst ms');

  for (const probes of TUNE_LADDER) {
    m.configure({ solLen: 22, probeMin: toLong(probes), fullInit });
    m.solvePattern(states[0]); // warm, so JIT cost does not land on the first timed state
    const lens = [];
    const ts = [];
    for (const facelets of states) {
      const s0 = process.hrtime.bigint();
      const sol = m.solvePattern(facelets);
      ts.push(Number(process.hrtime.bigint() - s0) / 1e6);
      if (/^Error/.test(sol)) throw new Error(`tune ${label} probeMin=${probes}: min2phase said ${sol}`);
      // Every single answer is verified, not sampled: a tuned bound that returned a
      // SHORTER but WRONG alg would otherwise read as the win we are looking for.
      const check = Cube.fromString(facelets);
      check.move(sol.trim());
      if (!check.isSolved()) {
        throw new Error(`tune ${label} probeMin=${probes}: returned an alg that does not solve the state`);
      }
      lens.push(sol.trim().split(/\s+/).filter(Boolean).length);
    }
    const sorted = [...ts].sort((a, b) => a - b);
    const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
    console.log(
      `  ${String(probes).padStart(8)} | ${mean(lens).padStart(6)} | ` +
        `${mean(ts).padStart(7)} | ${p90.toFixed(1).padStart(7)} | ${Math.max(...ts).toFixed(1).padStart(8)}`,
    );
  }
}

/** Parent: one shared state set, then one child process per table setting.
 *  Separate processes because min2phase's `initLevel` only ever ratchets upward — a
 *  single process cannot measure partial tables again once it has built the full ones —
 *  and because JIT state from the first ladder would otherwise flatter the second. */
async function tune() {
  const { writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { fileURLToPath } = await import('node:url');
  const { spawnSync } = await import('node:child_process');

  // cubejs random states, not cubing scrambles: the child must not need cubing's worker,
  // and it needs facelets rather than an alg. Both generators are uniform over states.
  const states = [];
  for (let i = 0; i < TUNE_STATES; i++) states.push(Cube.random().asString());
  const statesPath = join(tmpdir(), `min2phase-tune-states-${process.pid}.json`);
  writeFileSync(statesPath, JSON.stringify(states));

  const self = fileURLToPath(import.meta.url);
  for (const mode of ['tune:partial', 'tune:full']) {
    const r = spawnSync(process.execPath, [self, mode, statesPath], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`tune: child ${mode} exited ${r.status}`);
  }
  console.log('\n  Move counts must match row-for-row between the two tables — they are the');
  console.log('  same search, pruned better. The ms columns are machine- and load-dependent;');
  console.log('  the durable figure is the partial:full RATIO within one run.');
}

// --- 6. Solution length as a target a person can understand ---------------------------
// `probeMin` is "try harder", which is not a thing to show anyone. `solLen` is "only accept
// a solution this short", which is exactly how a learner would put it: 22 is fine today,
// under 20 later, as short as you can find it eventually.
//
// So this measures the product question rather than the search one. For each target, descend:
// ask for < 23, then < 22, then < 21 ... each answer strictly shorter than the last, each
// attempt bounded by a PROBE budget rather than a stopwatch, because probes are the same
// number on a slow phone and a fast laptop and seconds are not.
//
// What comes out is the tier table: for each move-count target, how often it is reached and
// what it costs to get there.
const TARGETS = (process.env.BENCH_TARGETS ?? '22,21,20,19,18').split(',').map(Number);
/** Probes per attempt. 100M is min2phase's own ceiling and takes minutes; this is a budget. */
const PROBE_BUDGET = Number(process.env.BENCH_PROBES ?? 2_000_000);

async function targets(statesPath) {
  const { readFileSync } = await import('node:fs');
  const { module: m, chunk } = await tunableMin2phase();
  const states = JSON.parse(readFileSync(statesPath, 'utf8'));

  m.configure({ fullInit: true });
  const built = Date.now();
  m.initialize();
  console.log(`\n[targets] ${chunk}`);
  console.log(`  full tables, init ${Date.now() - built} ms | n=${states.length} | budget ${PROBE_BUDGET.toLocaleString()} probes/attempt`);
  console.log('  target |  reached | cumulative ms: median    p90   worst | mean moves');

  // Per cube: the running best solution, and the time spent getting there.
  const best = states.map(() => ({ alg: null, moves: Infinity, ms: 0, stalled: false }));

  for (const target of TARGETS) {
    for (const [i, facelets] of states.entries()) {
      const cube = best[i];
      if (cube.stalled || cube.moves <= target) continue; // already short enough, costs nothing
      m.configure({ solLen: target + 1, probeMin: toLong(0), probeMax: toLong(PROBE_BUDGET), fullInit: true });
      const t0 = process.hrtime.bigint();
      const answer = m.solvePattern(facelets);
      cube.ms += Number(process.hrtime.bigint() - t0) / 1e6;
      if (/^Error/.test(answer)) {
        // Out of budget, not out of solutions. The previous answer stands and this cube stops
        // descending — which is exactly what the app would do.
        cube.stalled = true;
        continue;
      }
      const check = Cube.fromString(facelets);
      check.move(answer.trim());
      if (!check.isSolved()) throw new Error(`targets: solution for ${facelets} does not solve`);
      cube.alg = answer.trim();
      cube.moves = cube.alg.split(/\s+/).length;
    }

    const reached = best.filter((c) => c.moves <= target);
    const times = reached.map((c) => c.ms).sort((a, b) => a - b);
    const median = times.length ? times[Math.floor(times.length / 2)] : 0;
    const p90 = times.length ? times[Math.min(times.length - 1, Math.floor(times.length * 0.9))] : 0;
    console.log(
      `  ${String(`<= ${target}`).padStart(6)} | ${String(reached.length).padStart(3)}/${states.length}` +
      `    | ${median.toFixed(0).padStart(14)} ${p90.toFixed(0).padStart(6)} ${(times.length ? Math.max(...times) : 0).toFixed(0).padStart(6)} ` +
      `| ${(reached.reduce((a, c) => a + c.moves, 0) / (reached.length || 1)).toFixed(2)}`,
    );
  }
  console.log('  Cumulative: the time column is everything spent descending to that target,');
  console.log('  which is what a learner waits, not what one attempt costs.');
}

// --- 7. The contract solve-target.js is written against ------------------------------
// `lib/solve-target.js` drives min2phase through an injected function and assumes two things
// of it: asked for a solution shorter than N it returns one, never longer; and when it cannot
// find one within the probe budget it says so rather than returning something else. Its unit
// tests prove the module handles both, against a fake. This proves the REAL solver behaves
// that way — which no fake can.
async function contract() {
  const { module: m, chunk } = await tunableMin2phase();
  const { refine } = await import('../lib/solve-target.js');
  m.configure({ fullInit: true });
  m.initialize();

  let violations = 0;
  const solve = async (facelets, { solLen, probeMax }) => {
    m.configure({ solLen, probeMin: toLong(0), probeMax: toLong(probeMax), fullInit: true });
    const answer = m.solvePattern(facelets);
    if (/^Error/.test(answer)) return null;
    const moves = answer.trim().split(/\s+/).length;
    if (moves >= solLen) {
      console.log(`  BROKEN: asked for fewer than ${solLen}, got ${moves}`);
      violations++;
    }
    const oracle = Cube.fromString(facelets);
    oracle.move(answer.trim());
    if (!oracle.isSolved()) { console.log('  BROKEN: returned alg does not solve'); violations++; }
    return answer;
  };

  console.log(`\n[contract] ${chunk} — n=${N_STATES} per tier, 100,000 probes`);
  for (const tier of ['twenty', 'nineteen', 'eighteen']) {
    const finals = [];
    for (let i = 0; i < N_STATES; i++) {
      const facelets = Cube.random().asString();
      let last = null;
      let previous = Infinity;
      for await (const step of refine(facelets, { solve, tier, probeBudget: 100_000 })) {
        // The final step repeats the current answer to carry the stop reason, so equality is
        // allowed only there. Anything longer, or a repeat mid-stream, is a real violation.
        const improved = step.moves < previous || (step.moves === previous && step.stopped !== null);
        if (!improved) {
          console.log(`  BROKEN: ${previous} -> ${step.moves} (stopped=${step.stopped})`);
          violations++;
        }
        previous = step.moves;
        last = step;
      }
      finals.push(last);
    }
    const met = finals.filter((f) => f.met).length;
    const mean = finals.reduce((a, f) => a + f.moves, 0) / finals.length;
    console.log(`  ${tier.padEnd(9)} met ${String(met).padStart(3)}/${N_STATES} | mean ${mean.toFixed(2)} moves`);
  }
  if (violations > 0) {
    throw new Error(`${violations} contract violations — solve-target.js is written against behaviour min2phase no longer has`);
  }
  console.log('  contract holds: shorter when asked, null when out of budget, never longer');
}

// --- 8. A gotcha kept honest by an assertion ----------------------------------------
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
// `sweep` and `tune` both cost minutes, so neither joins the default run — ask for them.
const OPT_IN = new Set(['sweep', 'tune', 'targets', 'contract']);
const wants = (name) =>
  stage === 'all' || stage === name || (stage === 'default' && !OPT_IN.has(name));

// `tune` re-invokes this script once per table setting; a child runs only its own ladder.
if (stage === 'tune:partial' || stage === 'tune:full') {
  Cube.initSolver(); // the child verifies every returned alg against the oracle
  await tuneChild(stage === 'tune:full', process.argv[3]);
  process.exit(0);
}

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
if (wants('tune')) await tune();
if (wants('contract')) await contract();
if (wants('targets')) {
  const { writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const list = [];
  for (let i = 0; i < N_STATES; i++) list.push(Cube.random().asString());
  const path = join(tmpdir(), `min2phase-targets-${process.pid}.json`);
  writeFileSync(path, JSON.stringify(list));
  await targets(path);
}

// cubing.js keeps a worker alive; without this the process hangs after the last stage.
process.exit(0);
