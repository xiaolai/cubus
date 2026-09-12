// The measurements §7 of dev-docs/solve-to-state-plan.md demands before Phase C may be written.
//
//   node bench/solve-to-state-measure.mjs tables   §7.1 and §7.5 — the tables, retained
//   node bench/solve-to-state-measure.mjs radius   §7.2, §7.3, §7.4 — nodes, radius, fallback rate
//   node bench/solve-to-state-measure.mjs queue    §7.6 — how long a repair waits behind a solve
//   node bench/solve-to-state-measure.mjs all      all three
//
// RETAINED, which is the word §7.1 uses and the reason this file exists rather than a throwaway
// script. The numbers in §3 and §3a came from scripts that no longer run; they were good enough to
// choose an architecture and are not good enough to be relied on, because nothing records the
// machine they were taken on and nothing re-takes them when the code changes. Every section here
// prints the device, and the memory figures are the process's own peak rather than the arithmetic
// sum of the table widths — §8 must not read one as the other, and the first draft did.
//
// THE ENGINE UNDER MEASUREMENT WAS THE SPIKE, and is now the production one. Plan §10 Phase B
// authorises a benchmark-only prototype precisely so the measurements can be taken before Phase C
// exists, and Phase C is free to discard it — which it did. What that changes, and what it does
// not: the NODE COUNTS are identical either way, because both search the same tree in the same
// order under the same two pruning rules, so a budget curve taken on one is a budget curve for the
// other. The TIMINGS are not: the production engine steps a flat buffer where the spike allocated
// an array per node, and it runs 1.8 to 5.3 million nodes a second against the spike's 0.17 to 1.5.
// Every millisecond figure below was re-taken; every node figure is the same number.
//
// This file grades nothing. It measures cost. `test/solve-to-state.test.mjs` is where the engine is
// graded, against oracles that share no search with it, for the reason §9a keeps repeating: a
// heuristic wrong high does not crash, and every check that consults it agrees with it.

import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { SOLVED, applyAlg } from '../lib/cube-pieces.js';
import * as tp from '../lib/two-phase.js';
import { createSolver } from '../lib/solver-engine.js';
import { refine } from '../lib/solve-target.js';
import { PROJECTIONS, TARGETS } from '../lib/stage-targets.js';
import { projectionTable, solveToState } from '../lib/stage-distance.js';
import { STAGE_TARGET_CASES } from '../test/fixtures/stage-targets.mjs';
import { CONTRACT_CUBES, ENGINE_CONTRACT_CUBES, WORKER_CUBES } from '../test/fixtures/solver-cubes.mjs';
import { buildCorpus, CORPUS_TARGETS, KINDS } from './solve-to-state-corpus.mjs';

const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);
const ms = (n) => `${n.toFixed(0)} ms`;

/**
 * The machine, printed by every section. A timing with no device attached is not a measurement.
 *
 * **AND THE LOAD, which is the half that was missing and cost this file two hours.** The seven
 * tables measured 285–370 ms cold on a quiet machine and 3,285–4,852 ms an hour later, on the same
 * commit, because something else had taken the box to a load average of 100 on ten cores. Nothing
 * in the output said so, and a tenfold difference looked exactly like a regression. A benchmark
 * that records the device and not the contention records half the conditions.
 */
function device() {
  const cpu = os.cpus()[0]?.model ?? 'unknown';
  const [one, five] = os.loadavg();
  return `${cpu} · ${os.cpus().length} cores · ${os.arch()} · node ${process.versions.node}`
    + ` · ${(os.totalmem() / 1024 ** 3).toFixed(0)} GiB`
    + `\nload average ${one.toFixed(1)} (1 min) / ${five.toFixed(1)} (5 min)`
    + `${one > os.cpus().length ? '  ← CONTENDED: every millisecond below is inflated' : ''}`;
}

/** The process's own peak resident set, in MiB. `maxRSS` is in KiB on every platform we ship to. */
const peakRssMiB = () => process.resourceUsage().maxRSS / 1024;

/** Quantile of a sorted-in-place copy. p is 0..1. */
function quantile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

// ---- §7.1 and §7.5: the tables ---------------------------------------------------------------------

/**
 * A cold build, in a process of its own, `runs` times.
 *
 * COLD MEANS A NEW PROCESS, and the first draft of this section learned it the hard way: measured
 * in-process after the bench's own imports, the seven tables took 2,413 ms; measured in a bare child
 * they take 720 to 944 ms. One number was three times the other and neither was wrong — they are
 * different questions. A page pays the child's number.
 *
 * Repeated, because a single run of a JIT-sensitive build is not a measurement. The spread is
 * reported rather than a mean, so a reader can see how much of the figure is the machine.
 */
function coldRuns(source, runs = 5, flags = []) {
  const out = [];
  for (let i = 0; i < runs; i++) {
    const r = spawnSync(process.execPath, [...flags, '--input-type=module', '-e', source], {
      cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8',
    });
    if (r.status !== 0) throw new Error(`cold run failed (${r.status}): ${r.stderr}`);
    out.push(JSON.parse(r.stdout.trim().split('\n').pop()));
  }
  return out;
}

const spread = (values) => `${Math.min(...values).toFixed(0)}–${Math.max(...values).toFixed(0)} ms`
  + ` (median ${quantile(values, 0.5).toFixed(0)})`;

/** Node with nothing loaded, so every RSS figure below can be read as a delta rather than a total. */
const BARE = `console.log(JSON.stringify({ rss: process.resourceUsage().maxRSS / 1024 }))`;

const TABLES_COLD = `const m = await import('./lib/stage-distance.js');
const t = performance.now(); m.warmTables();
console.log(JSON.stringify({ build: performance.now() - t, rss: process.resourceUsage().maxRSS / 1024 }))`;

/** Steady state, after a forced collection — the number a WORKER costs, as opposed to the peak. */
const TABLES_STEADY = `const m = await import('./lib/stage-distance.js');
m.warmTables();
global.gc(); await new Promise((r) => setTimeout(r, 200)); global.gc();
console.log(JSON.stringify({ build: 0, rss: process.memoryUsage().rss / 1024 / 1024 }))`;

const CROSS_COLD = `const m = await import('./lib/methods/cross.js');
const t = performance.now(); m.crossTable();
console.log(JSON.stringify({ build: performance.now() - t, rss: process.resourceUsage().maxRSS / 1024 }))`;

const TWOPHASE_COLD = `const m = await import('./lib/two-phase.js');
const t = performance.now(); m.initialize();
console.log(JSON.stringify({ build: performance.now() - t, rss: process.resourceUsage().maxRSS / 1024 }))`;

async function tables() {
  console.log('=== §7.1 the seven projection tables, retained ====================================');
  console.log(device());

  const bare = coldRuns(BARE, 3);
  const baseRss = quantile(bare.map((r) => r.rss), 0.5);
  console.log(`bare node, nothing imported: ${baseRss.toFixed(1)} MiB peak RSS — every figure below is`);
  console.log('a total, and the delta against this line is what the work itself costs.\n');

  console.log(`${pad('projection', 16)}${num('reachable', 11)}${num('diameter', 10)}${num('bytes', 10)}  first shells`);
  let bytes = 0;
  for (const id of Object.keys(PROJECTIONS)) {
    const t = projectionTable(id);
    bytes += PROJECTIONS[id].codeSpace;
    console.log(`${pad(id, 16)}${num(t.reachable, 11)}${num(t.diameter, 10)}${num(PROJECTIONS[id].codeSpace, 10)}  ${t.layers.slice(0, 4).join(' ')} …`);
  }
  console.log(`\ntable bytes total  ${bytes} = ${(bytes / 1024 / 1024).toFixed(3)} MiB`);

  const cold = coldRuns(TABLES_COLD);
  const buildMs = cold.map((r) => r.build);
  const peak = quantile(cold.map((r) => r.rss), 0.5);
  const steady = quantile(coldRuns(TABLES_STEADY, 3, ['--expose-gc']).map((r) => r.rss), 0.5);
  console.log(`cold build         ${spread(buildMs)}, ${cold.length} separate processes`);
  console.log(`peak RSS           ${peak.toFixed(1)} MiB total, ${(peak - baseRss).toFixed(1)} MiB above bare node`);
  console.log(`steady RSS         ${steady.toFixed(1)} MiB total, ${(steady - baseRss).toFixed(1)} MiB above bare node (after a forced collection)`);
  console.log('');
  console.log('**TABLE BYTES ARE NOT WORKER RESIDENCY, and BOTH numbers above are needed.** 1.9 MiB of');
  console.log(`table peaks at ${(peak - baseRss).toFixed(0)} MiB while it is being built — the breadth-first frontier is an`);
  console.log(`array of code tuples and it is the frontier that peaks, not the result — and settles to`);
  console.log(`${(steady - baseRss).toFixed(0)} MiB once the build is collected. §8 weighs a dedicated repair worker against`);
  console.log('sharing the pool, and it is the STEADY figure a worker holds for the session while the');
  console.log('PEAK is what a phone has to survive once. The 0.995 MiB the plan quoted is neither: it');
  console.log('is the arithmetic sum of the arrays.\n');

  console.log('=== §7.5 the inner loop, and what it is NOT competing with ========================');
  const crossCold = coldRuns(CROSS_COLD, 3);
  const twoPhase = coldRuns(TWOPHASE_COLD, 3);
  const crossMs = crossCold.map((r) => r.build);
  const tpMs = twoPhase.map((r) => r.build);
  const count = Object.keys(PROJECTIONS).length;
  console.log(`methods/cross.js, ONE table       ${spread(crossMs)}`);
  console.log(`stage-distance.js, SEVEN tables   ${spread(buildMs)}`);
  console.log(`per table, the new loop is        ${(quantile(crossMs, 0.5) / (quantile(buildMs, 0.5) / count)).toFixed(1)}x cheaper`);
  console.log('');
  console.log(`two-phase initialize()            ${spread(tpMs)}   ← NOT this feature's cost`);
  console.log('');
  console.log('That last line is here because omitting it is how the first draft of this section');
  console.log("reported a 15-second cold import as \"what a page actually pays\". The measurement was");
  console.log('being taken through a module that called `initialize()` at import, and the Kociemba');
  console.log('pruning tables it builds are work the app already does for the solver pool — work a');
  console.log('repair holding only these seven tables never does at all. Attributing it here would');
  console.log('have made a 0.3-second warm-up look like a 15-second one.\n');
  return { bytes, buildMs, crossMs, peak, steady, baseRss };
}

// ---- §7.2, §7.3, §7.4: nodes, radius, fallback rate --------------------------------------------------

/** Budgets to report the corpus against, so §7.3's choice is read off a curve rather than guessed. */
const BUDGETS = [100_000, 400_000, 1_000_000, 2_000_000, 4_000_000];

async function radius() {
  const byId = Object.fromEntries(TARGETS.map((t) => [t.id, t]));
  const cases = buildCorpus();
  console.log('=== §7.2 node counts, per target and per error kind ==============================');
  console.log(device());
  console.log(`corpus: ${cases.length} cases over ${CORPUS_TARGETS.length} targets\n`);

  // One pass at the widest budget records the answer and its cost; every narrower budget is then a
  // question about the SAME numbers rather than a second run, because IDA* explores the same nodes
  // in the same order and a budget only decides where it stops.
  const results = [];
  for (const c of cases) {
    const target = byId[c.target];
    const t0 = performance.now();
    const got = solveToState(target, c.state, { maxDepth: 14, nodeBudget: Math.max(...BUDGETS) });
    const took = performance.now() - t0;
    // The engine replays every route it returns, so a non-null answer has already been checked
    // against the target's independent predicate. Asked AGAIN here, because a measurement that
    // counted a wrong route as an answer would put the radius in the wrong place, and the whole
    // point of the replay being cheap is that there is no reason to trust it once instead of twice.
    if (got.alg !== null && !target.verify(applyAlg(c.state, got.alg))) {
      throw new Error(`${c.target}: the engine returned a route that does not reach the target`);
    }
    results.push({ ...c, moves: got.moves, nodes: got.nodes, ms: took });
  }

  console.log(`${pad('target', 14)}${pad('kind', 13)}${num('n', 4)}${num('answered', 10)}${num('deepest', 9)}${num('p50 nodes', 11)}${num('p95 nodes', 11)}${num('worst', 11)}${num('p95 ms', 8)}`);
  for (const target of CORPUS_TARGETS) {
    for (const kind of KINDS) {
      const mine = results.filter((r) => r.target === target && r.kind === kind.id);
      if (mine.length === 0) continue;
      const answered = mine.filter((r) => r.moves !== null);
      const depths = answered.map((r) => r.moves);
      const nodes = mine.map((r) => r.nodes);
      console.log(`${pad(target, 14)}${pad(kind.id, 13)}${num(mine.length, 4)}${num(`${answered.length}/${mine.length}`, 10)}`
        + `${num(depths.length ? Math.max(...depths) : '—', 9)}${num(quantile(nodes, 0.5), 11)}${num(quantile(nodes, 0.95), 11)}`
        + `${num(Math.max(...nodes), 11)}${num(quantile(mine.map((r) => r.ms), 0.95)?.toFixed(0) ?? '—', 8)}`);
    }
  }

  console.log('\n=== §7.3 where exactness stops: answered, by the depth of the answer ==============');
  console.log('Node cost tracks DEPTH, not which target — so the radius is a statement about depth.\n');
  const answered = results.filter((r) => r.moves !== null);
  console.log(`${pad('depth', 8)}${num('cases', 8)}${num('p50 nodes', 12)}${num('p95 nodes', 12)}${num('worst nodes', 13)}${num('worst ms', 10)}`);
  for (let d = 0; d <= 14; d++) {
    const mine = answered.filter((r) => r.moves === d);
    if (mine.length === 0) continue;
    const nodes = mine.map((r) => r.nodes);
    console.log(`${num(d, 8)}${num(mine.length, 8)}${num(quantile(nodes, 0.5), 12)}${num(quantile(nodes, 0.95), 12)}`
      + `${num(Math.max(...nodes), 13)}${num(Math.max(...mine.map((r) => r.ms)).toFixed(0), 10)}`);
  }

  console.log('\n=== §7.3 the budget curve, and §7.4 how often the corpus falls outside it =========');
  console.log('Answered at each budget, by kind. The unbounded kind (`random`) is the one that decides');
  console.log('whether the fallback is load-bearing; the bounded ones were going to be answered.\n');
  console.log(`${pad('budget', 12)}${KINDS.map((k) => num(k.id, 13)).join('')}${num('overall', 10)}`);
  for (const budget of BUDGETS) {
    const row = KINDS.map((k) => {
      const mine = results.filter((r) => r.kind === k.id);
      const ok = mine.filter((r) => r.moves !== null && r.nodes <= budget).length;
      return mine.length ? `${((ok / mine.length) * 100).toFixed(0)}%` : '—';
    });
    const all = results.filter((r) => r.moves !== null && r.nodes <= budget).length;
    console.log(`${pad(budget.toLocaleString(), 12)}${row.map((v) => num(v, 13)).join('')}${num(`${((all / results.length) * 100).toFixed(0)}%`, 10)}`);
  }

  // The one number §7.3 owes: the deepest answer the corpus produced inside each budget. R is read
  // off this, and it is measured rather than chosen — and explicitly not the heuristic's ceiling of
  // 8, which bounds the GUIDANCE and says nothing about reachable depth.
  console.log('\n=== §7.3 the radius R, per budget: the deepest answer that fits ===================');
  for (const budget of BUDGETS) {
    const fits = results.filter((r) => r.moves !== null && r.nodes <= budget);
    const deepest = fits.length ? Math.max(...fits.map((r) => r.moves)) : null;
    const missed = results.length - fits.length;
    console.log(`budget ${num(budget.toLocaleString(), 11)}  deepest exact answer ${num(deepest ?? '—', 3)}`
      + `   unanswered ${num(missed, 4)} of ${results.length}`
      + `   (${results.filter((r) => r.kind === 'random' && !(r.moves !== null && r.nodes <= budget)).length} of them random)`);
  }

  // Refused cases are what the fallback exists for, and their identity is the input to
  // bench/solve-to-state-prefix.mjs. Printed as scrambles would be misleading — these are
  // constructed states, not scrambles — so the count and the shape are what is reported.
  const refused = results.filter((r) => r.moves === null);
  console.log(`\nrefused at the widest budget: ${refused.length} of ${results.length}`);
  for (const kind of KINDS) {
    const n = refused.filter((r) => r.kind === kind.id).length;
    if (n) console.log(`  ${pad(kind.id, 14)}${num(n, 5)}`);
  }
  return results;
}

// ---- §7.6: how long a repair waits behind a running solve --------------------------------------------

async function queue() {
  console.log('=== §7.6 queue latency: how long a repair waits behind a running solve ============');
  console.log(device());
  console.log('');
  console.log('WHAT IS BEING MEASURED, and why it is the whole solve rather than a share of it.');
  console.log('`createParallelSolveClient` splits ONE cube across every worker in the pool — the views');
  console.log('are slices of the same search, not separate jobs (lib/solve-client.js:sliceViews). So');
  console.log('while a solve runs there is no idle worker for a repair to take, and a repair queued');
  console.log('behind it waits for the whole solve. That duration, at the shipped tier, is the number');
  console.log('§8 needs: it is what a repair would cost if it shared the pool instead of owning a');
  console.log('worker of its own.\n');

  tp.initialize();
  const solve = createSolver(tp);
  // TWO POPULATIONS, and the second is the one that matters. The frozen fixture's 30-turn rows are
  // ordinary random cubes; `test/fixtures/solver-cubes.mjs` holds the app's own RELEASE GATE cubes,
  // each frozen with its measured cost (2.0 to 4.2 million nodes) precisely because they are the
  // expensive end of the distribution. A percentile over three easy cubes is not a percentile, and
  // the first run of this section reported one.
  const cubes = [
    ...STAGE_TARGET_CASES.filter((r) => r.length === 30).map((r) => tp.toFacelets(applyAlg(SOLVED, r.scramble))),
    ...CONTRACT_CUBES, ...ENGINE_CONTRACT_CUBES, ...Object.values(WORKER_CUBES),
  ];
  const durations = [];
  for (const facelets of cubes) {
    const t0 = performance.now();
    let last = null;
    for await (const step of refine(facelets, { solve, tier: 'twenty' })) last = step;
    durations.push({ ms: performance.now() - t0, moves: last?.moves ?? null });
  }
  console.log(`${pad('cube', 6)}${num('ms', 10)}${num('moves', 8)}`);
  durations.forEach((d, i) => console.log(`${pad(`#${i + 1}`, 6)}${num(d.ms.toFixed(0), 10)}${num(d.moves ?? '—', 8)}`));
  const values = durations.map((d) => d.ms);
  console.log(`\nn=${values.length}   p50 ${ms(quantile(values, 0.5))}   p95 ${ms(quantile(values, 0.95))}`
    + `   worst ${ms(Math.max(...values))}`);
  console.log('\nSINGLE-THREADED HERE, which is the honest caveat: this measures the engine on one');
  console.log('thread, and the shipped pool is up to six workers on ONE cube, so a real solve is');
  console.log('faster than this by roughly the pool width. It is still the right shape of number —');
  console.log('the wait is a whole solve either way — and it is an UPPER bound on the wait, which is');
  console.log('the direction a decision about contention should be wrong in.');
  return values;
}

// ---- run ---------------------------------------------------------------------------------------

const RUN_DIRECTLY = Boolean(process.argv[1]?.endsWith('solve-to-state-measure.mjs'));
if (RUN_DIRECTLY) {
  const which = process.argv[2] ?? 'all';
  const wanted = which === 'all' ? ['tables', 'radius', 'queue'] : [which];
  const known = { tables, radius, queue };
  for (const section of wanted) {
    const fn = known[section];
    if (!fn) {
      console.error(`unknown section "${section}" — one of: ${Object.keys(known).join(', ')}, all`);
      process.exitCode = 1;
      break;
    }
    await fn();
    console.log('');
  }
}
