// Every method the solve tab offers, each as one DEFINITION (ADR 0011 decision 5).
//
// A method is not a learner's rung record any more: it is fixed, it has a name a cuber would recognise,
// and everything the app needs to know about it is declared here and nowhere else — its stages, its holds,
// the chips its walk stops at, the words its sections are headed with, the algorithm sets it teaches and
// where each was sourced, its level, and what proves it. A screen, the walk resolver and the lesson builder
// read an entry; none of them spells a method out. `registry.test.mjs` refuses an entry missing a field and
// a second spelling of a method's definition anywhere under `lib/`.
//
// THE HOLDS ARE THREE THINGS, declared apart (ADR 0011 decision 5):
//   frame       the coordinate frame the method's solver works in, as `[up, front]` of the scan frame;
//   executable  the holds the DRIVER may execute — today's driver is cross-first: it refuses any hold but
//               U on top, and an intuitive step may turn the cube about the vertical axis only
//               (`solveByMethod`, lib/method-solver.js);
//   displayed   how the screen shows the cube: the stages built white up, and the tumble after them
//               (ADR 0003). `WHITE_UP_STAGES` in lib/solving-hold.js is read from here.
// Declaring a hold is not executing it. A method with no cross needs the driver generalised first.
//
// This module is DATA, and is read on the UI thread, so it imports nothing that builds: a method is
// declared as a SPEC — its rungs and its last-layer route — and turned into the engine's stage
// descriptors by `methodOf` (lib/methods/method-of.js), which only the lesson worker and the tests load.
// lib/methods/index.js builds every rung's repertoire when it loads; this module once imported it, and
// that build ran on the UI thread at boot (ADR 0011 Phase 7 audit, 2026-10-16).

import { t } from '../i18n.js';
import { DEFAULT_RUNGS, STAGE_IDS } from './stage-ids.js';

/** The levels the "More methods" menu groups by, in the order a learner meets them. */
export const LEVELS = Object.freeze(['first-steps', 'getting-faster', 'competition']);

/** Every field an entry must declare. An entry missing one is refused when this module loads. */
export const ENTRY_FIELDS = Object.freeze([
  'id', 'label', 'level', 'engine', 'method', 'stages', 'holds', 'stops', 'words', 'algorithms', 'proof',
]);

/** A method as the engine will build it: which rung of each stage, and which last-layer route. */
const spec = (rungs, lastLayer) => Object.freeze({ rungs: Object.freeze({ ...rungs }), lastLayer });

/** The beginner's method: every stage at rung 0, and the course's last layer (ADR 0009's route). */
const BEGINNER_METHOD = spec(DEFAULT_RUNGS, 'course');

/**
 * The section headings of a lesson, keyed by the dial a fine stage belongs to. Plain words, not CFOP
 * jargon: this app's reader starts at five. `method-lesson.js` re-exports this as `SECTION_NAME`.
 */
const BEGINNER_SECTIONS = Object.freeze({
  cross: () => t('Cross'),
  pairs: () => t('First two layers'),
  oll: () => t('Top face'),
  pll: () => t('Last layer'),
});

const QUICK = Object.freeze({
  id: 'quick',
  label: 'Quick',
  level: 'first-steps',
  // The two-phase solver at the Settings tier. It is NOT a source of a minimality claim (AGENTS.md §1),
  // so nothing about this entry may say "shortest"; "Quick" says what is true.
  engine: 'two-phase',
  method: null,
  stages: Object.freeze([]),
  holds: Object.freeze({ frame: null, executable: Object.freeze([]), displayed: Object.freeze({ whiteUpStages: Object.freeze([]) }) }),
  // A Quick walk to a chip is the repair race's (lib/screens/cube/route-race.js), not a stop of a method.
  stops: Object.freeze([]),
  words: null,
  algorithms: Object.freeze([]),
  proof: Object.freeze([
    Object.freeze({
      scope: 'whole cube',
      kind: 'contract',
      check: 'test/solver-engine.test.mjs, test/two-phase.test.mjs — every answer replayed by cubejs',
    }),
  ]),
});

const BEGINNER = Object.freeze({
  id: 'beginner',
  label: 'Beginner',
  level: 'first-steps',
  engine: 'method',
  method: BEGINNER_METHOD,
  /** Its stages, by dial, in walking order — the course's pair stands in the last two (`methodOf` builds them). */
  stages: STAGE_IDS,
  holds: Object.freeze({
    // The solver works white-down (lib/solving-hold.js `METHOD_FRAME`): the scan frame tumbled.
    frame: Object.freeze(['D', 'B']),
    // Upright in the solver's frame, turned only about the vertical axis between steps.
    executable: Object.freeze([Object.freeze({ up: 'U', turns: 'vertical' })]),
    // White up while the white side is built, then the tumble (x2), then white underneath (ADR 0003).
    displayed: Object.freeze({ whiteUpStages: Object.freeze(['cross', 'first-layer']) }),
  }),
  // The Restore chips the walk stops at, in order (ADR 0009): every chip in the row.
  stops: Object.freeze(['cross', 'first-layer', 'two-layers', 'top-cross', 'top-edges', 'corners-home', 'solved']),
  words: Object.freeze({ dials: STAGE_IDS, sections: BEGINNER_SECTIONS }),
  algorithms: Object.freeze([
    Object.freeze({ set: 'cross and first two layers', source: 'intuitive — found by search, no table', rederived: 'test/method-solver.test.mjs' }),
    Object.freeze({ set: 'the course\'s last layer', source: 'lib/methods/last-layer.js COURSE_ALGS, from the beginner course', rederived: 'test/course-route.test.mjs (cubejs)' }),
  ]),
  proof: Object.freeze([
    lastLayerSweep('course', 'course'),
    Object.freeze({
      scope: 'cross, first layer, middle layer',
      // Not completeness: a sample can show a failure, never that none exists.
      kind: 'regression sampling',
      domain: 'seeded and frozen cubes',
      check: 'test/course-route.test.mjs, test/method-composition.test.mjs, test/beginner-lesson.test.mjs',
      oracle: 'cubejs',
    }),
  ]),
});

// ---- CFOP, two entries (ADR 0011 decision 6; plan Phase 7) ---------------------------------------
//
// Not a dial: the two-look last layer and the full one are two methods with names a cuber recognises,
// and a learner grows by choosing the next. Both are the engine's higher rungs on the APP's last-layer
// route — orient the whole top, then permute it — which is what CFOP is; the course's route is the
// beginner's alone.

/** CFOP with the two-look last layer: the cross planned whole, the corner joined to its edge and the pair
 *  put in together, two looks to orient the top (6 algorithms) and two to permute it (5). */
const CFOP_EASY_METHOD = spec({ cross: 1, pairs: 1, oll: 0, pll: 0 }, 'app');
/** Full CFOP: the cross planned whole, the 41 F2L cases, full OLL (57) and full PLL (21) — the sourced
 *  table of lib/data/human-algs.js. */
const CFOP_FULL_METHOD = spec({ cross: 1, pairs: 2, oll: 1, pll: 1 }, 'app');

// THE HOLD STORY IS THE BEGINNER'S, KEPT (owner's call Q5): white up while the white side is built, the
// tumble, then white underneath. CFOP has no first-layer stage of its own — F2L builds the bottom layer
// together with the middle, and each pair goes in from the top — so the flip point is after the CROSS.
const CFOP_HOLDS = Object.freeze({
  frame: Object.freeze(['D', 'B']),
  executable: Object.freeze([Object.freeze({ up: 'U', turns: 'vertical' })]),
  displayed: Object.freeze({ whiteUpStages: Object.freeze(['cross']) }),
});

// The chips a CFOP walk stops at (owner's call Q8): the cross, the first two layers, the top oriented
// (OLL's end, its own target), and solved.
const CFOP_STOPS = Object.freeze(['cross', 'two-layers', 'top-oriented', 'solved']);

// The headings are the beginner's words, and deliberately so: they name what each section ACHIEVES —
// "Top face" is what OLL makes, "Last layer" what PLL finishes — and a learner moving up from Beginner
// meets the same four words over the same four parts of the cube.
const CFOP_WORDS = Object.freeze({ dials: STAGE_IDS, sections: BEGINNER_SECTIONS });

const record = (fields) => Object.freeze(fields);

/** What both CFOP entries share in their algorithm sources and their proof. */
const PLANNED_CROSS_ALGS = record({ set: 'planned cross', source: 'exact distance table — found by search, no table of algorithms', rederived: 'test/cfop-proof.test.mjs (cubejs)' });
const CFOP_CROSS_PROOF = record({
  scope: 'cross (planned whole)',
  kind: 'exhaustive',
  domain: 'all 190,080 positions of the four cross edges',
  check: 'lib/methods/cross.js builds the exact distance table by breadth-first search over every position; test/cfop-proof.test.mjs replays planned crosses with cubejs',
  oracle: 'cubejs',
});
const CFOP_PAIRS_PROOF = (rung) => record({
  scope: `first two layers (${rung})`,
  kind: 'exhaustive',
  domain: 'all 384 placements of a pair\'s corner and edge with the cross solved',
  check: 'test/cfop-proof.test.mjs (every placement, through the whole method), test/f2l-configurations.test.mjs',
  oracle: 'cubejs',
});
const CFOP_LOOKS_PROOF = record({
  scope: 'each last-layer look',
  kind: 'exhaustive',
  domain: 'OLL: all 216 top orientations; PLL: all 288 top permutations with the top oriented',
  check: 'test/cfop-proof.test.mjs',
  oracle: 'cubejs',
});
/** The nightly 62,208-state sweep at one pair of last-layer rungs — Beginner's course route included. */
function lastLayerSweep(oll, pll) {
  return Object.freeze({
  scope: 'last layer',
  kind: 'exhaustive',
  domain: 'all 62,208 last-layer states with the first two layers solved',
  check: `node bench/method-solver-profile.mjs exhaustive ${oll} ${pll} (a nightly CI shard)`,
  // The sweep's check is the solver's own contract replay on the cubie model, not cubejs.
  oracle: 'the stage contracts and a whole-cube replay (lib/method-solver.js)',
  });
}
const CFOP_SAMPLE_PROOF = record({
  scope: 'whole method',
  kind: 'regression sampling',
  domain: 'seeded and frozen cubes',
  check: 'test/cfop-proof.test.mjs',
  oracle: 'cubejs',
});

/** One CFOP entry: everything but its method, its name, its level, its F2L and its last-layer tables. */
function cfopEntry({ id, label, level, method, pairs, algorithms, sweep }) {
  return Object.freeze({
    id,
    label,
    level,
    engine: 'method',
    method,
    stages: STAGE_IDS,
    holds: CFOP_HOLDS,
    stops: CFOP_STOPS,
    words: CFOP_WORDS,
    algorithms: Object.freeze([PLANNED_CROSS_ALGS, ...algorithms]),
    proof: Object.freeze([CFOP_CROSS_PROOF, CFOP_PAIRS_PROOF(pairs), CFOP_LOOKS_PROOF, lastLayerSweep(...sweep), CFOP_SAMPLE_PROOF]),
  });
}

const CFOP_EASY = cfopEntry({
  id: 'cfop-4lll',
  label: 'CFOP (easy)',
  level: 'getting-faster',
  method: CFOP_EASY_METHOD,
  pairs: 'trigger pairs',
  algorithms: [
    record({ set: 'trigger pairs', source: 'lib/methods/pairs.js PAIRS_ALGS, the six triggers', rederived: 'test/f2l-configurations.test.mjs' }),
    record({ set: 'two-look OLL and PLL', source: 'lib/methods/last-layer.js OLL_ALGS, PLL_ALGS', rederived: 'test/cfop-proof.test.mjs (cubejs)' }),
  ],
  sweep: [0, 0],
});

const CFOP_FULL = cfopEntry({
  id: 'cfop',
  label: 'CFOP (full)',
  level: 'competition',
  method: CFOP_FULL_METHOD,
  pairs: 'the 41 cases',
  algorithms: [
    record({ set: 'F2L, OLL, PLL (119)', source: 'lib/data/human-algs.js — J Perm (OLL, PLL), SpeedCubeDB (F2L)', rederived: 'test/human-algs.test.mjs (cubejs)' }),
  ],
  sweep: [1, 1],
});

/** Every method the app offers, in the order the pills show them. */
export const METHODS = Object.freeze([QUICK, BEGINNER, CFOP_EASY, CFOP_FULL]);

/** The method a new install walks (owner's call Q1, 2026-10-16). */
export const DEFAULT_METHOD = 'quick';

/** The beginner's entry — the template every later method copies. */
export const BEGINNER_ENTRY = BEGINNER;

/** Prototype-free, so a stored id like `toString` resolves to nothing rather than a function. */
const BY_ID = Object.freeze(Object.assign(Object.create(null), Object.fromEntries(METHODS.map((m) => [m.id, m]))));

/** Whether `id` names an offered method. */
export const isMethodId = (id) => typeof id === 'string' && Object.hasOwn(BY_ID, id);

/** The entry named `id`, or a throw — a method silently swapped for another is a lesson nobody chose. */
export function methodById(id) {
  if (!isMethodId(id)) throw new Error(`methods: no method named "${String(id)}" — the methods are ${METHODS.map((m) => m.id).join(', ')}`);
  return BY_ID[id];
}

/** An entry with every field, a known level, and an engine that matches its stages. Throws on the first
 *  defect. Run over `METHODS` when this module loads; exported for the test that feeds it bad entries. */
export function checkEntry(entry) {
  for (const field of ENTRY_FIELDS) {
    if (!Object.hasOwn(entry, field)) throw new Error(`methods: entry "${entry.id}" declares no "${field}"`);
  }
  if (!LEVELS.includes(entry.level)) throw new Error(`methods: entry "${entry.id}" has unknown level "${entry.level}"`);
  if (!['two-phase', 'method'].includes(entry.engine)) throw new Error(`methods: entry "${entry.id}" has unknown engine "${entry.engine}"`);
  if (entry.engine === 'method' && (!entry.method || entry.stages.length === 0)) {
    throw new Error(`methods: entry "${entry.id}" runs the method engine with no stages`);
  }
  // A method is a spec the engine can build: rungs for every declared stage, and a known route. That the
  // BUILT stages are the declared ones is `methodOf`'s check, where they are built.
  if (entry.engine === 'method') {
    const { rungs, lastLayer } = entry.method;
    if (!['app', 'course'].includes(lastLayer)) throw new Error(`methods: entry "${entry.id}" has unknown last-layer route "${lastLayer}"`);
    for (const stage of entry.stages) {
      if (!Number.isInteger(rungs?.[stage])) throw new Error(`methods: entry "${entry.id}" names no rung for its "${stage}" stage`);
    }
  }
  if (entry.engine === 'two-phase' && (entry.method !== null || entry.stages.length !== 0)) {
    throw new Error(`methods: entry "${entry.id}" runs the two-phase solver but declares a method or stages`);
  }
  if (entry.engine === 'method' && entry.proof.length === 0) {
    throw new Error(`methods: entry "${entry.id}" declares no proof`);
  }
  for (const key of ['frame', 'executable', 'displayed']) {
    if (!Object.hasOwn(entry.holds, key)) throw new Error(`methods: entry "${entry.id}" holds declare no "${key}"`);
  }
  return entry;
}

for (const entry of METHODS) checkEntry(entry);
if (new Set(METHODS.map((m) => m.id)).size !== METHODS.length) throw new Error('methods: two entries share an id');
