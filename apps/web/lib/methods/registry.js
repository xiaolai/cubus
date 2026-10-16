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
// This module is data, and imports only the method library beneath it — never a hold, a screen or a
// target module — so those can read it without a cycle.

import { t } from '../i18n.js';
import { DEFAULT_RUNGS, STAGE_IDS, methodFor } from './index.js';

/** The levels the "More methods" menu groups by, in the order a learner meets them. */
export const LEVELS = Object.freeze(['first-steps', 'getting-faster', 'competition']);

/** Every field an entry must declare. An entry missing one is refused when this module loads. */
export const ENTRY_FIELDS = Object.freeze([
  'id', 'label', 'level', 'engine', 'method', 'stages', 'holds', 'stops', 'words', 'algorithms', 'proof',
]);

/** The beginner's method: every stage at rung 0, and the course's last layer (ADR 0009's route). */
const BEGINNER_METHOD = methodFor(DEFAULT_RUNGS, { lastLayer: 'course' });

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
  /** The engine's stage descriptors, in walking order — one per dial, the course's pair in the last two. */
  stages: BEGINNER_METHOD.stages,
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
    Object.freeze({
      scope: 'last layer',
      kind: 'exhaustive',
      domain: 'all 62,208 last-layer states with the first two layers solved',
      check: 'node bench/method-solver-profile.mjs exhaustive course course (a nightly CI shard)',
      oracle: 'cubejs',
    }),
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

/** Every method the app offers, in the order the pills show them. */
export const METHODS = Object.freeze([QUICK, BEGINNER]);

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
  // The DECLARED stages are the ones that run: a second list beside the method's would be free to drift.
  if (entry.engine === 'method' && entry.stages !== entry.method.stages) {
    throw new Error(`methods: entry "${entry.id}" declares stages that are not its method's own`);
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
