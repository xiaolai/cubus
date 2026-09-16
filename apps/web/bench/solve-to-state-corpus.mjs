// The corpus §7.2 of dev-docs/solve-to-state-plan.md demands, and the coverage counts that say what
// shape it is.
//
//   node bench/solve-to-state-corpus.mjs        the coverage report
//   node bench/solve-to-state-corpus.mjs --list every case, one per line
//
// WHY THIS FILE IS THE MOST IMPORTANT ONE IN PHASE B, and it is not close. Both adversarial reviews
// of the plan landed on the same sentence: **the corpus chooses the apparent success rate, which
// chooses the radius, which chooses the architecture.** A corpus of cubes three turns from solved
// says the feature is worthless; a corpus of cubes at a stage and far from solved says it saves
// thirteen moves. Same search, same baseline, same code. So this generator states its limits rather
// than arguing them away, and every case carries the bound its own construction puts on the answer.
//
// THE BOUND, AND WHY IT IS RECORDED PER CASE. The first draft's corpus was circular: every seed
// started from a state already satisfying the target, so the answer was bounded by the perturbation
// length BY CONSTRUCTION and the measurement would have come back reassuring and wrong. That is not
// fully escapable — a seed with a remaining route suffix of length L and an error of length k has an
// answer no worse than k + L whether or not the generator computes it — so the generator computes
// it, writes it down, and lets a reader see how much of the "success" was arithmetic.
//
// THE FIVE KINDS ARE NOT INTERCHANGEABLE and the report never merges them:
//
//   perturb      a state AT the target plus k random turns. A floor, and known to be one.
//   wrong-auf    a state at the target plus a real algorithm with the wrong AUF — the commonest
//                single real mistake, and still conditioned on the stage being complete.
//   slip         a state PART WAY through the target plus an omitted, reversed or repeated turn.
//   wrong-stage  part way through, plus a whole algorithm belonging to a later stage.
//   random       uniformly random states, as the pathological case and not the design case.
//
// And the limit that no amount of care removes: this is a proxy along ONE solver's policy — the
// app's own method route at its default rungs. The radius it chooses is provisional until real use
// reports the fallback frequency.

import { SOLVED, applyAlg, invert, moveCount } from '../lib/cube-pieces.js';
import { solveByMethod } from '../lib/method-solver.js';
import { turnsOf } from '../test/fixtures/method-replay.mjs';
import { OLL_ALGS, PLL_ALGS } from '../lib/methods/last-layer.js';
import { F2L_CASES } from '../lib/data/case-tables.js';
import { INDEPENDENT_PREDICATE } from '../test/fixtures/independent-predicates.mjs';
import { lcg, randomAlg, seededScrambles } from '../test/fixtures/seeded-scrambles.mjs';

export const CORPUS_SEED = 0x7b21;

/** The kinds, in the order the report prints them. `bounded` says whether the construction caps the
 *  answer — which is the one property a reader must not have to infer. */
export const KINDS = Object.freeze([
  { id: 'perturb', label: 'at target + k random turns', bounded: true },
  { id: 'wrong-auf', label: 'at target + a real alg, wrong AUF', bounded: true },
  { id: 'slip', label: 'part way + omitted/reversed/repeated turn', bounded: true },
  { id: 'wrong-stage', label: 'part way + a whole later-stage alg', bounded: true },
  { id: 'random', label: 'a uniformly random state', bounded: false },
]);

/**
 * Which method-route step labels are INSIDE each target — i.e. which steps are building it.
 *
 * Read off `methods/`: the cross rungs emit `cross`; `pairs` rung 0 emits `first-layer` then
 * `middle-layer` (`pairs.js:cornerThenEdge`) while rungs 1 and 2 emit `f2l`; the last layer emits
 * `top-cross`, `top-face`, `top-corners`, `top-edges`.
 *
 * **`corners-home` includes `top-face`, and that is §7.2's special case rather than an oversight.**
 * §0's table: `corners-home` is never a boundary of this app's route, because the app orients the
 * top corners before permuting them. So "part way through corners-home" is seeded exactly where
 * §7.2 says to seed it — at the end of `top-face`, with the corners oriented and not yet placed.
 */
const INSIDE = Object.freeze({
  cross: ['cross'],
  'first-layer': ['cross', 'first-layer'],
  'two-layers': ['cross', 'first-layer', 'middle-layer', 'f2l'],
  'top-cross': ['cross', 'first-layer', 'middle-layer', 'f2l', 'top-cross'],
  'corners-home': ['cross', 'first-layer', 'middle-layer', 'f2l', 'top-cross', 'top-face'],
});

/** The targets this corpus is generated for: the five stages. `solved` and `six-cross` are not
 *  stages a child is working through, so §7.2's "a mistake while building N" does not describe
 *  them; the frozen fixture and the ledger cover those. */
export const CORPUS_TARGETS = Object.freeze(Object.keys(INSIDE));

/** Real algorithms a learner has actually been taught, for the two kinds that use one. */
const REAL_ALGS = Object.freeze([...OLL_ALGS, ...PLL_ALGS, ...F2L_CASES].map((a) => a.alg).filter(Boolean));

/**
 * The same algorithms, each carrying WHICH STAGE it belongs to — so "a whole later-stage alg" can be one.
 *
 * The wrong-stage case drew from the whole pool, so a last-layer cube could be handed an F2L algorithm
 * under a label saying it came from later in the solve (Codex audit, 2026-09-16). What the case is FOR is
 * a child running ahead of themselves; an algorithm from a stage they have already passed is a different
 * mistake, and counting it as this one blurs the population the bench is measuring.
 */
const STAGE_RANK = Object.freeze({
  cross: 0, 'first-layer': 1, 'middle-layer': 1, f2l: 1, 'top-cross': 2, 'top-face': 2, 'top-corners': 3, 'top-edges': 3,
});
const TAUGHT = Object.freeze([
  ...F2L_CASES.map((a) => ({ alg: a.alg, rank: 1 })),
  ...OLL_ALGS.map((a) => ({ alg: a.alg, rank: 2 })),
  ...PLL_ALGS.map((a) => ({ alg: a.alg, rank: 3 })),
].filter((a) => a.alg));
const rankOf = (targetId) => Math.max(...INSIDE[targetId].map((label) => STAGE_RANK[label] ?? 0));
const laterThan = (targetId) => TAUGHT.filter((a) => a.rank > rankOf(targetId));
const AUF = Object.freeze(['U', 'U2', "U'"]);

const pick = (rnd, list) => list[Math.floor(rnd() * list.length)];

/** The app's own route through a scramble: every intermediate state, with the step that reached it. */
function methodRoute(scramble) {
  const start = applyAlg(SOLVED, scramble);
  let lesson;
  try {
    lesson = solveByMethod(start);
  } catch {
    return null; // a scramble the method solver refuses is not a corpus case, it is a solver bug
  }
  const states = [start];
  let s = start;
  for (const step of lesson.steps) {
    // Played in the step's hold, as the face turns it makes: a step may regrip (plan item 6.1).
    s = applyAlg(s, turnsOf(step));
    states.push(s);
  }
  return { start, steps: lesson.steps, states };
}

/**
 * One seed's worth of geometry for one target: where the target is first reached, and every index
 * that counts as "part way through building it".
 *
 * `suffix[i]` is how many moves of the route remain between `states[i]` and the target. That is the
 * `L` in §7.2's `k + L` bound, and it is what stops this corpus quietly asserting its own answer.
 */
function geometry(route, targetId) {
  const pred = INDEPENDENT_PREDICATE[targetId];
  const reachedAt = route.states.findIndex((s) => pred(s));
  if (reachedAt < 0) return null;
  const inside = new Set(INSIDE[targetId]);
  // How many moves from states[i] to states[reachedAt], along the route.
  const suffix = route.states.map((_, i) => (i >= reachedAt
    ? 0
    : route.steps.slice(i, reachedAt).reduce((n, step) => n + moveCount(turnsOf(step)), 0)));
  // Part way: at least one step of this target done, and the target not yet reached.
  const partWay = [];
  for (let i = 1; i < reachedAt; i++) {
    if (inside.has(route.steps[i - 1].stage)) partWay.push(i);
  }
  // Progress WITHIN the target: how many of its own steps are behind you, of how many there are.
  const ownSteps = route.steps.slice(0, reachedAt).filter((step) => inside.has(step.stage)).length;
  const doneBy = (i) => route.steps.slice(0, i).filter((step) => inside.has(step.stage)).length;
  return { reachedAt, suffix, partWay, ownSteps, doneBy };
}

/** `alg` with one turn omitted, reversed, or repeated — the three ways a child's hand slips. */
function slip(rnd, alg) {
  const moves = alg.trim().split(/\s+/).filter(Boolean);
  if (moves.length === 0) return null;
  const at = Math.floor(rnd() * moves.length);
  let how = pick(rnd, ['omitted', 'reversed', 'repeated']);
  const out = [...moves];
  if (how === 'omitted') out.splice(at, 1);
  else if (how === 'reversed') {
    // A HALF TURN REVERSED IS THE SAME HALF TURN. `invert('R2')` is `R2`, so this produced a step
    // identical to the one it was damaging and filed it under `reversed` — a correctly executed step
    // sitting in the mistake sample (Codex audit, 2026-09-16). The reversal moves to a quarter turn in
    // the same algorithm, and where there is none the hand slips a different way instead.
    const quarter = moves.findIndex((m, i) => i >= at && !m.endsWith('2'));
    const other = quarter >= 0 ? quarter : moves.findIndex((m) => !m.endsWith('2'));
    if (other < 0) { how = 'repeated'; out.splice(at, 0, moves[at]); } else out[other] = invert(moves[other]);
  } else out.splice(at, 0, moves[at]);
  return { how, alg: out.join(' ') };
}

/**
 * The corpus.
 *
 * `perSeed` scrambles are routed once each and every kind is drawn off the same routes, so a target
 * that the route never reaches costs nothing and is visible in the coverage counts rather than
 * silently absent.
 */
export function buildCorpus({ seed = CORPUS_SEED, seeds = 24, randomCases = 12 } = {}) {
  const rnd = lcg(seed);
  const cases = [];
  // A SCRAMBLE THE SOLVER REFUSES IS A SOLVER BUG, which is what `methodRoute`'s own comment says — and
  // the refusals were then dropped by a `.filter(Boolean)` that said nothing. Zero routes still produced
  // a corpus, because the random cases populate every target on their own, and the coverage guard at the
  // end could not tell that every ROUTED case had quietly gone missing (Codex audit, 2026-09-16).
  const drawn = seededScrambles(seeds, seed, 25);
  const refused = [];
  const routes = drawn.filter((scramble, i) => {
    const route = methodRoute(scramble);
    if (route) { drawn[i] = route; return true; }
    refused.push(scramble);
    return false;
  }).map((_, i) => drawn[i]);
  if (refused.length) {
    throw new Error(
      `solve-to-state-corpus: the method solver refused ${refused.length} of ${seeds} scrambles, which is `
      + `a solver defect rather than a corpus one. The first: ${refused[0]}`,
    );
  }
  if (!routes.length) throw new Error('solve-to-state-corpus: no scrambles were routed, so there is no corpus');

  for (const targetId of CORPUS_TARGETS) {
    for (const route of routes) {
      const g = geometry(route, targetId);
      if (!g) continue;

      // --- perturb: at the target, plus k random turns. k cycles 1..10 so every depth appears.
      const k = 1 + cases.filter((c) => c.target === targetId && c.kind === 'perturb').length % 10;
      const error = randomAlg(rnd, k);
      cases.push({
        target: targetId, kind: 'perturb', errorKind: `${k} random turns`,
        state: applyAlg(route.states[g.reachedAt], error),
        atTarget: true, progress: 1, errorLen: k, suffixLen: 0, bound: k,
      });

      // --- wrong-auf: at the target, plus a real algorithm behind an AUF that should not be there.
      const auf = pick(rnd, AUF);
      const real = pick(rnd, REAL_ALGS);
      const wrong = `${auf} ${real}`;
      cases.push({
        target: targetId, kind: 'wrong-auf', errorKind: `${auf} then a taught alg`,
        state: applyAlg(route.states[g.reachedAt], wrong),
        atTarget: true, progress: 1, errorLen: moveCount(wrong), suffixLen: 0, bound: moveCount(wrong),
      });

      if (g.partWay.length === 0) continue;

      // --- slip: part way, and the next step goes wrong by one turn.
      const i = pick(rnd, g.partWay);
      const damaged = slip(rnd, turnsOf(route.steps[i]));
      if (damaged) {
        cases.push({
          target: targetId, kind: 'slip', errorKind: damaged.how,
          state: applyAlg(route.states[i], damaged.alg),
          atTarget: false, progress: g.ownSteps ? g.doneBy(i) / g.ownSteps : 0,
          errorLen: moveCount(damaged.alg), suffixLen: g.suffix[i],
          bound: moveCount(damaged.alg) + g.suffix[i],
        });
      }

      // --- wrong-stage: part way, and a whole algorithm from later in the solve lands on it.
      const j = pick(rnd, g.partWay);
      const pool = laterThan(targetId);
      if (pool.length) {
        const later = pick(rnd, pool).alg;
        cases.push({
          target: targetId, kind: 'wrong-stage', errorKind: 'a whole later-stage alg',
          state: applyAlg(route.states[j], later),
          atTarget: false, progress: g.ownSteps ? g.doneBy(j) / g.ownSteps : 0,
          errorLen: moveCount(later), suffixLen: g.suffix[j],
          bound: moveCount(later) + g.suffix[j],
        });
      }
    }

    // --- random: the pathological case, and the only kind with no bound at all.
    for (const scramble of seededScrambles(randomCases, seed + 1, 30)) {
      cases.push({
        // NOT `uniform`, which this said until 2026-09-16 (Codex audit): thirty random face turns is a
        // random WALK, and its distribution is not the uniform one over all 43 quintillion states. The
        // walk is what this bench wants — it is seeded, so the corpus is reproducible, and `randomState`
        // draws from a cryptographic source that cannot be — but the label has to say which it is.
        target: targetId, kind: 'random', errorKind: 'a 30-turn random walk',
        state: applyAlg(SOLVED, scramble),
        atTarget: false, progress: 0, errorLen: null, suffixLen: null, bound: null,
      });
    }
  }
  // AND EVERY TARGET GOT CASES OF ITS OWN. The random cases are drawn per target regardless, so a target
  // whose routes all failed the geometry check still appeared in the counts — with nothing in it but
  // noise. Checked here, where the counts are still a list rather than a table.
  for (const targetId of CORPUS_TARGETS) {
    const routed = cases.filter((c) => c.target === targetId && c.kind !== 'random').length;
    if (routed === 0) {
      throw new Error(`solve-to-state-corpus: "${targetId}" drew no case from any route — only random ones`);
    }
  }
  return cases;
}

/** The coverage counts §7.2 asks for: by target, by progress within the stage, by error kind. */
export function coverage(cases) {
  const byTargetKind = new Map();
  const byProgress = new Map();
  const byErrorKind = new Map();
  // FIVE buckets and not four. `steps-done` is not `at-target`: for `corners-home` every step of
  // the target's own stages can be finished while the target is still not reached, because the app
  // orients the top corners before permuting them and `top-corners` is not one of the target's
  // labels. Folding those two into one bucket would hide §0's whole finding inside a percentage.
  const bucket = (c) => (c.atTarget ? 'at-target'
    : c.progress >= 1 ? 'steps-done'
    : c.progress >= 0.67 ? '2/3+' : c.progress >= 0.34 ? '1/3+' : 'early');
  for (const c of cases) {
    const tk = `${c.target}|${c.kind}`;
    byTargetKind.set(tk, (byTargetKind.get(tk) ?? 0) + 1);
    if (c.kind !== 'random') {
      const pk = `${c.target}|${bucket(c)}`;
      byProgress.set(pk, (byProgress.get(pk) ?? 0) + 1);
    }
    byErrorKind.set(c.errorKind, (byErrorKind.get(c.errorKind) ?? 0) + 1);
  }
  return { byTargetKind, byProgress, byErrorKind };
}

// ---- run -----------------------------------------------------------------------------------------

const RUN_DIRECTLY = Boolean(process.argv[1]?.endsWith('solve-to-state-corpus.mjs'));
if (RUN_DIRECTLY) {
  const cases = buildCorpus();
  const { byTargetKind, byProgress, byErrorKind } = coverage(cases);
  const pad = (s, n) => String(s).padEnd(n);
  const num = (s, n) => String(s).padStart(n);

  console.log(`corpus: ${cases.length} cases, seed 0x${CORPUS_SEED.toString(16)}\n`);

  console.log('=== by target and kind ==========================================================');
  console.log(`${pad('target', 14)}${KINDS.map((k) => num(k.id, 13)).join('')}${num('total', 8)}`);
  for (const target of CORPUS_TARGETS) {
    const row = KINDS.map((k) => byTargetKind.get(`${target}|${k.id}`) ?? 0);
    console.log(`${pad(target, 14)}${row.map((n) => num(n, 13)).join('')}${num(row.reduce((a, b) => a + b, 0), 8)}`);
  }

  console.log('\n=== by progress within the stage (the bounded kinds only) =======================');
  const BUCKETS = ['early', '1/3+', '2/3+', 'steps-done', 'at-target'];
  console.log(`${pad('target', 14)}${BUCKETS.map((b) => num(b, 11)).join('')}`);
  for (const target of CORPUS_TARGETS) {
    console.log(`${pad(target, 14)}${BUCKETS.map((b) => num(byProgress.get(`${target}|${b}`) ?? 0, 11)).join('')}`);
  }

  console.log('\n=== by error kind ================================================================');
  for (const [kind, n] of [...byErrorKind].sort((a, b) => b[1] - a[1])) {
    console.log(`${pad(kind, 30)}${num(n, 6)}`);
  }

  console.log('\n=== the bound each construction puts on its own answer ===========================');
  console.log('Read this before any success rate. A case whose bound is 3 was going to be answered');
  console.log('within 3 whatever the engine did; the measurement is only about cases whose bound is');
  console.log('above the radius, and about the unbounded ones.\n');
  console.log('A BOUND ABOVE 20 IS NOT A BOUND. God\'s number is 20, so an answer no worse than 44');
  console.log('says nothing the cube did not already say — those cases are as informative as the');
  console.log('unbounded ones. The column that matters is "binding": bound <= 10, the radius §3a');
  console.log('measured, where the construction really does guarantee the answer.\n');
  console.log(`${pad('kind', 14)}${num('n', 5)}${num('mean', 8)}${num('worst', 7)}${num('binding', 9)}${num('>20', 6)}`);
  for (const kind of KINDS) {
    const mine = cases.filter((c) => c.kind === kind.id);
    if (mine.length === 0) continue;
    const bounds = mine.map((c) => c.bound).filter((b) => b !== null);
    const mean = bounds.length ? (bounds.reduce((a, b) => a + b, 0) / bounds.length).toFixed(1) : '—';
    const worst = bounds.length ? Math.max(...bounds) : '—';
    const binding = bounds.filter((b) => b <= 10).length;
    const vacuous = bounds.filter((b) => b > 20).length;
    console.log(`${pad(kind.id, 14)}${num(mine.length, 5)}${num(mean, 8)}${num(worst, 7)}${num(binding, 9)}${num(vacuous, 6)}`
      + `  ${kind.bounded ? '' : '(no bound at all)'}`);
  }

  if (process.argv.includes('--list')) {
    console.log('\n=== every case ====================================================================');
    for (const c of cases) {
      console.log(`${pad(c.target, 14)} ${pad(c.kind, 12)} ${pad(c.errorKind, 24)} `
        + `progress ${c.progress.toFixed(2)}  k=${num(c.errorLen ?? '—', 3)} L=${num(c.suffixLen ?? '—', 3)} bound=${num(c.bound ?? '—', 4)}`);
    }
  }

  // A corpus that quietly generated nothing for a target would make every downstream number a lie
  // about a sample that does not exist, and it would look exactly like a corpus that generated
  // everything. Loud, at the source.
  for (const target of CORPUS_TARGETS) {
    const n = cases.filter((c) => c.target === target).length;
    if (n === 0) throw new Error(`corpus: no cases at all for ${target}`);
  }
}
