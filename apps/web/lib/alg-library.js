// The algorithm library: one row per algorithm this repository holds, every column computed from the
// algorithm or read from the source that published it — never typed beside it.
//
// dev-docs/algorithm-drill-v2-plan.md §2.1. The first Drill described one algorithm three ways — a page, a
// fixture and a screen, each with its own copy — and that is the defect this module exists to end: the
// review page (`bench/alg-ledger.mjs`), its fixture (`test/fixtures/alg-ledger.mjs`), the set ledger
// (`bench/algorithm-ledger.mjs`) and the drill all read the rows from HERE. Which algorithm is in which set,
// what kind of set it is, where it came from and which offered method teaches it at which stage is said in
// this file once (`ALG_SETS`, `METHOD_SETS`); the set ledger is a summary computed from it.
//
// CHEAP TO IMPORT ON THE UI THREAD, and that is a measured constraint, not a style. The hand-written tables
// live inside the method modules, and importing those BUILDS their repertoires: `methods/last-layer.js`
// alone took 150 ms to import, measured 2026-10-17. So the method modules are imported only when a row is
// first asked for (`loadEntries`), the data modules (plain arrays) statically, and a row's columns are
// computed when that row is asked for and cached — never all 309 at load. `alg-ledger.test.mjs` asks Node
// what importing this module loads, and refuses a method module in the answer.
//
// WHAT A ROW IS — every column, and where it comes from:
//   id, set              the source's own `name`, and the set (`ALG_SETS`) that files it — exactly one
//   label, nickname      the source's names; `null` where the source gives none (`notGiven` says why, per set)
//   source               `{ name, url, fetched }` read from the data file's own `SOURCES`, or a string —
//                        'written for teaching' / 'proved minimal by search' — for a table nobody published
//   methods              `[{ method, stage }]`: the offered methods (registry ids) whose stage teaches the set
//   alg, hold            the moves as taught, and the hold their letters are written in, declared ONCE per
//                        source module (`ALG_SOURCES`), `[up, front]` in the scan frame's letters (ADR 0004)
//   tokens, htm, stm,    lengths, as WRITTEN (no cancellation between neighbours) — see `htmOf` and the rest
//   qtm
//   kinds                which of wide / slice / rotation appear (`readToken`'s `kind`); [] for face turns only
//   solves               `{ case, facelets, viewHold, picture }`: the source's case key where it has one, and
//                        ALWAYS the state the algorithm solves — its inverse played on a solved cube in the
//                        declared hold — as 54 facelets seen from the hold the learner starts in
//   effect, keeps, order `lib/alg-effect.js`: what it does to a solved cube, which regions it leaves, how many
//                        repeats bring the cube back
//   chunks               the SOURCED triggers found in it (`TRIGGERS`), by token index
//   sameAs, inverseOf,   ids of other rows whose moves are this row's exactly / its inverse / its left-right
//   mirrorOf             mirror (`mirrorAlg`), compared token by token with a half turn's direction ignored
//   observable           the tokens a smart cube does not report as themselves (see `observableOf`)
//   says                 ONE sentence generated from `effect`, `keeps` and `solves` (see `saysOf`)
//
// THE FRAME. Every table here is written in the METHOD frame — white underneath (`METHOD_FRAME` in
// `lib/solving-hold.js`) — so `effect`'s positions are named in the letters' own frame: `D` is the bottom,
// which is the white side, and "the first two layers" are the white ones.

import { faceTurnsOf, run } from './cube-moves.js';
import { parse } from './cube-notation.js';
import { orientationPerm } from './cube-orientation.js';
import { SOLVED, invert, toFacelets } from './cube-pieces.js';
import { effectOf } from './alg-effect.js';
import { t } from './i18n.js';
import { METHOD_FRAME } from './solving-hold.js';
import { METHODS as REGISTRY } from './methods/registry.js';
import { HUMAN_F2L, HUMAN_OLL, HUMAN_PLL, SOURCES as HUMAN_SOURCES } from './data/human-algs.js';
import { CMLL_ALGS, SOURCES as CMLL_SOURCES } from './data/cmll-algs.js';
import { F2L_CASES, FULL_OLL, FULL_PLL } from './data/case-tables.js';

// ---- the source modules ------------------------------------------------------------------------------

/**
 * Every module a row is read from, with the hold its letters are written in — declared here once per module,
 * from the module's own header, so no row carries a hold of its own that could disagree.
 *
 * `load` returns the module's exports. The three data modules are plain arrays and imported statically; the
 * three method modules build repertoires as they load, so they are imported when first asked for.
 */
export const ALG_SOURCES = Object.freeze({
  cross: Object.freeze({
    module: 'lib/methods/cross.js',
    hold: METHOD_FRAME,
    holdWhy: 'the method engine is fed the method frame, white on D: a cross insert drops an edge from the top into DF',
    load: () => import('./methods/cross.js'),
  }),
  pairs: Object.freeze({
    module: 'lib/methods/pairs.js',
    hold: METHOD_FRAME,
    holdWhy: 'the method engine\'s frame, white on D: a first-layer corner goes from the top into DFR',
    load: () => import('./methods/pairs.js'),
  }),
  'last-layer': Object.freeze({
    module: 'lib/methods/last-layer.js',
    hold: METHOD_FRAME,
    holdWhy: 'the method engine\'s frame, white on D: the last layer is U',
    load: () => import('./methods/last-layer.js'),
  }),
  'human-algs': Object.freeze({
    module: 'lib/data/human-algs.js',
    hold: METHOD_FRAME,
    holdWhy: 'the sheets\' own hold, cross on D and the last layer on U — the method frame, which `human-algs.test.mjs` checks every row in',
    load: async () => ({ HUMAN_F2L, HUMAN_OLL, HUMAN_PLL }),
  }),
  'cmll-algs': Object.freeze({
    module: 'lib/data/cmll-algs.js',
    hold: METHOD_FRAME,
    holdWhy: 'blocks on D, the top corners on U — the method frame Roux is held in',
    load: async () => ({ CMLL_ALGS }),
  }),
  'case-tables': Object.freeze({
    module: 'lib/data/case-tables.js',
    hold: METHOD_FRAME,
    holdWhy: 'searched in the method frame: the first two layers on D, the last layer on U',
    load: async () => ({ F2L_CASES, FULL_OLL, FULL_PLL }),
  }),
});

/**
 * Sources that exist as another session's UNCOMMITTED work and are therefore NOT read: nothing here imports
 * them. `alg-ledger.test.mjs` fails the day one is committed, so it is added rather than left pending.
 */
export const PENDING_SOURCES = Object.freeze([
  Object.freeze({
    id: 'mehta-algs',
    module: 'lib/data/mehta-algs.js',
    why: 'Mehta\'s tables are another session\'s uncommitted work; the ledger includes what is committed and does not commit them for it (plan §2.2)',
  }),
  Object.freeze({
    id: 'corners-first-algs',
    module: 'lib/data/corners-first-algs.js',
    why: 'the corners-first tables are another session\'s uncommitted work, likewise (plan §2.2)',
  }),
]);

/** A data file's citation, as `{ name, url, fetched }` — read from its `SOURCES`, never retyped. */
const cite = (entry) => Object.freeze({ name: entry.name ?? entry.what, url: entry.url, fetched: entry.fetched });

// ---- the sets -----------------------------------------------------------------------------------------

/** Why a field is `null` on every row of a kind of set — the source simply does not give it. */
const NOT_GIVEN = Object.freeze({
  handWritten: Object.freeze({
    label: 'the method module names the algorithm by its id only',
    nickname: 'the method module gives no nickname',
    case: 'the method module keys no case: the case is the picture',
  }),
  proved: Object.freeze({
    label: 'the proved tables name a case by an identifier, not by a name a learner would find elsewhere (case-tables.js header)',
    nickname: 'the proved tables give no nickname',
  }),
});

/**
 * WHICH ALGORITHM IS IN WHICH SET, said once. Moved here from `bench/algorithm-ledger.mjs`, which now reads
 * it. A set takes its rows from one export of one source module — BY NAME, never by index, so a reordering
 * inside a repertoire cannot silently move an algorithm into another set; `names` absent takes them all.
 *
 *   kind        'hand-written' (written for teaching), 'sourced' (the community's, cited), 'proved' (searched,
 *               proven minimal — the ORACLE the sourced tables are checked against, taught by no method), or
 *               'not an algorithm' (a named step with no moves; it has no row).
 *   regions     'layers' (the default) or 'blocks': which kept regions its sentence names (`REGION_FAMILY`).
 *   shows       'orientation' where the set's purpose is turning the top colour up, so its picture shows
 *               which stickers are up rather than every colour, and its sentence says how many it turns up.
 *   notGiven    per field, why that field is `null` on this set's rows.
 */
export const ALG_SETS = Object.freeze([
  {
    id: 'cross-inserts', name: 'Cross inserts', kind: 'hand-written', from: ['cross', 'CROSS_ALGS'],
    provenance: 'written for teaching, not searched. Two ways to drop a cross edge in from the top.',
    verified: 'every entry must be reachable and used — `method-solver` refuses a step naming anything outside CASE_NAMES',
  },
  {
    id: 'f1l-inserts', name: 'First-layer corner inserts', kind: 'hand-written', from: ['pairs', 'PAIRS_ALGS'],
    names: ['right-hand', 'left-hand', 'facing-up'],
    provenance: 'the beginner trigger and its repeat, in the three orientations a corner can be in',
    verified: 'same as above',
  },
  {
    id: 'middle-inserts', name: 'Middle-layer edge inserts', kind: 'hand-written', from: ['pairs', 'PAIRS_ALGS'],
    names: ['insert-right', 'insert-left'],
    provenance: 'one pair that both inserts a correct edge and ejects a wrong one, which is how it is taught',
    verified: 'same as above',
  },
  {
    id: 'f2l-triggers', name: 'F2L triggers', kind: 'hand-written', from: ['pairs', 'PAIRS_ALGS'],
    names: ['right', 'right-back', 'right-half', 'left', 'left-back', 'left-half'],
    provenance: 'CFOP (easy)\'s first two layers: six triggers a pair is built out of, rather than 41 cases',
    verified: 'same as above',
  },
  {
    id: 'eoll', name: 'Two-look OLL, first look', kind: 'hand-written', from: ['last-layer', 'OLL_ALGS'], shows: 'orientation',
    names: ['edge-orient'],
    provenance: 'one algorithm, applied up to three times, to orient the last-layer edges',
    verified: 'same as above',
  },
  {
    id: 'ocll', name: 'Two-look OLL, second look', kind: 'hand-written', from: ['last-layer', 'OLL_ALGS'], shows: 'orientation',
    names: ['sune', 'antisune', 'headlights', 'double-sune', 'pi'],
    provenance: 'the corner-orientation cases in face turns only, by choice: the first algorithms a learner meets need no notation beyond the six faces. The renderer and the interpreter read wide turns and slices too; the sourced sets use them',
    verified: 'same as above',
  },
  {
    id: 'cpll', name: 'Two-look PLL, corners', kind: 'hand-written', from: ['last-layer', 'PLL_ALGS'],
    names: ['corner-cycle', 'corner-cycle-back', 'diagonal'],
    provenance: 'adjacent swap both ways round, plus the diagonal',
    verified: 'same as above',
  },
  {
    id: 'epll', name: 'Two-look PLL, edges', kind: 'hand-written', from: ['last-layer', 'PLL_ALGS'],
    names: ['u-perm-a', 'u-perm-b'],
    provenance: 'two U-perms; Z and H fall out of applying two of them',
    verified: 'same as above',
  },
  {
    // The beginner course's last layer (ADR 0009), which Beginner walks: lessons 13 and 14 put the top edges
    // up and home, 15 and 16 the corners. Two sets, because they are two stages' tables, as the app's
    // two-look tables are. HAND-WRITTEN, not sourced: the course is this project's own, and every sequence is
    // the lesson's — none was copied from a sheet.
    id: 'course-edges', name: 'The course\'s top edges', kind: 'hand-written', from: ['last-layer', 'COURSE_ALGS'],
    names: ['course-cross', 'course-edge-swap'],
    provenance: 'the beginner course\'s lessons 13 and 14 (cubus-courses): the cross on top, then a swap of two top edges',
    verified: 'same as above; and `bench/method-solver-profile.mjs exhaustive course course` walks all 62,208 last-layer states through the course\'s route (a nightly CI shard)',
  },
  {
    id: 'course-corners', name: 'The course\'s top corners', kind: 'hand-written', from: ['last-layer', 'COURSE_ALGS'],
    names: ['course-corner-cycle', 'course-corner-twist', 'course-corner-twist-back'],
    provenance: 'the beginner course\'s lessons 15 and 16: three corners moved round, then lesson 9\'s four moves done twice or four times to turn one corner up',
    verified: 'same as above',
  },
  {
    id: 'align', name: 'Alignment', kind: 'not an algorithm', from: ['last-layer', 'LAST_LAYER_EXTRAS'],
    provenance: 'an EMPTY body, so the AUF the repertoire already adds IS the alignment. Deliberately outside PLL_ALGS: "turn the top until it matches" is not something anyone memorises',
    verified: 'its absence once made a one-turn cube get a nineteen-move lesson (audit, 2026-09-09)',
  },
  {
    id: 'turn', name: 'Turning a slot to the front', kind: 'not an algorithm', from: ['pairs', 'PAIRS_EXTRAS'],
    provenance: 'an EMPTY body, named so a pairs step\'s parts add up to its algorithm: the turn of the whole cube that brings a slot to the front right. A regrip, not something anyone memorises',
    verified: 'a part a pairs step names, so it is in CASE_NAMES; held here so that every name a step can carry is filed somewhere',
  },
  {
    id: 'f2l-human', name: 'F2L, human-speed', kind: 'sourced', from: ['human-algs', 'HUMAN_F2L'],
    provenance: 'SpeedCubeDB\'s top-voted Front Right algorithm per case; what CFOP (full) teaches for its first two layers',
    verified: '`human-algs.test.mjs`: cubejs finds each answers exactly its proved case, and the 41 cover the 41 once each',
    notGiven: { nickname: 'SpeedCubeDB numbers the F2L cases and names none' },
  },
  {
    id: 'oll-human', name: 'Full OLL, human-speed', kind: 'sourced', from: ['human-algs', 'HUMAN_OLL'], shows: 'orientation',
    provenance: 'J Perm\'s first-listed algorithm per case; what CFOP (full) teaches for the top face',
    verified: 'same cubejs check, 57 to 57',
    notGiven: { nickname: 'the Speedsolving wiki names some OLL cases and not this one' },
  },
  {
    id: 'pll-human', name: 'Full PLL, human-speed', kind: 'sourced', from: ['human-algs', 'HUMAN_PLL'],
    provenance: 'J Perm\'s first-listed algorithm per case; what CFOP (full) teaches for the last layer',
    verified: 'same cubejs check, 21 to 21',
    notGiven: { nickname: 'a PLL\'s letter is its name; the sheets give no other' },
  },
  {
    id: 'cmll', name: 'CMLL', kind: 'sourced', from: ['cmll-algs', 'CMLL_ALGS'], regions: 'blocks',
    provenance: `${CMLL_SOURCES.speedcubedb.name}'s top-voted algorithm per case, fetched ${CMLL_SOURCES.speedcubedb.fetched} from the page's markup and taught exactly as written; what Roux teaches for the top corners`,
    verified: '`cmll-algs.test.mjs`: cubejs finds every row keeps both blocks and the centres, the 42 rows answer the 42 cases once each, and no row solves the arrangement none is for',
    notGiven: { nickname: 'SpeedCubeDB gives each CMLL case one name, its label', case: 'the CMLL table keys no case: its label names it, and the picture is the case' },
  },
  {
    id: 'f2l-full', name: 'F2L, all cases', kind: 'proved', from: ['case-tables', 'F2L_CASES'],
    provenance: 'searched in `crates/optimal-solver`, proven minimal in the half-turn metric, certified',
    verified: '`f2l-cross-check` refutes every case by brute force with no heuristic; `case-tables.test.mjs` re-runs the generator and diffs the shipped module',
  },
  {
    id: 'oll-full', name: 'Full OLL', kind: 'proved', from: ['case-tables', 'FULL_OLL'], shows: 'orientation',
    provenance: 'same search; one algorithm per case so the top face is one look',
    verified: 'certified over all 1,152 (alignment, goal) pairs; same generator diff',
  },
  {
    id: 'pll-full', name: 'Full PLL', kind: 'proved', from: ['case-tables', 'FULL_PLL'],
    provenance: 'same search; the 288-state goal set checked against the published Cube Explorer distribution',
    verified: 'the distribution matched Cube Explorer entry for entry, mean 11.642361; same generator diff',
  },
].map((s) => Object.freeze({
  ...s,
  regions: s.regions ?? 'layers',
  names: s.names ? Object.freeze([...s.names]) : undefined,
  from: Object.freeze([...s.from]),
  notGiven: Object.freeze({
    ...(s.kind === 'hand-written' ? NOT_GIVEN.handWritten : s.kind === 'proved' ? NOT_GIVEN.proved : {}),
    ...(s.notGiven ?? {}),
  }),
})));

const SET_BY_ID = new Map(ALG_SETS.map((s) => [s.id, s]));

/**
 * Which offered method teaches which set, at which of its registry stages. Keyed by registry id; a phase is
 * `held` (one set or several), or `intuitive` — built by understanding or by search, with nothing to memorise.
 *
 * `algorithm-ledger.test.mjs` holds this to what each method's solver actually NAMES on frozen cubes, and to
 * the registry's entries and stages; that relation is why it can be trusted here.
 */
const offered = (id, phases) => {
  const entry = REGISTRY.find((m) => m.id === id);
  if (!entry) throw new Error(`alg-library: names an offered method "${id}" that the registry does not hold`);
  return Object.freeze({ id, method: entry.label, phases: Object.freeze(phases.map((p) => Object.freeze(p))) });
};

export const METHOD_SETS = Object.freeze([
  offered('quick', [
    { phase: 'Whole cube', intuitive: 'NONE. The two-phase search (`lib/two-phase.js`) answers; there is nothing to memorise' },
  ]),
  offered('beginner', [
    { stage: 'cross', phase: 'Cross', held: ['cross-inserts'] },
    { stage: 'pairs', phase: 'First two layers', held: ['f1l-inserts', 'middle-inserts'] },
    // The course's last layer (ADR 0009), not the app's: Beginner is rung 0 everywhere on the course's route.
    { stage: 'oll', phase: 'Top face', held: ['course-edges'] },
    { stage: 'pll', phase: 'Last layer', held: ['course-corners'] },
  ]),
  // **Both CFOP entries still need the beginner inserts.** `pairsFrom` falls back to `placeSeparately` when a
  // pair is BURIED — a piece of it sitting in another slot — and that fallback is the beginner corner and edge
  // inserts. The relation test finds them named on frozen cubes, and fails if a mapped set stops appearing.
  offered('cfop-4lll', [
    { stage: 'cross', phase: 'Cross', intuitive: 'planned whole: an exact distance table is descended — no algorithm at all' },
    { stage: 'pairs', phase: 'First two layers', held: ['f2l-triggers', 'f1l-inserts', 'middle-inserts'] },
    { stage: 'oll', phase: 'Top face', held: ['eoll', 'ocll'] },
    { stage: 'pll', phase: 'Last layer', held: ['cpll', 'epll'] },
  ]),
  offered('cfop', [
    { stage: 'cross', phase: 'Cross', intuitive: 'planned whole: an exact distance table is descended — no algorithm at all' },
    // The human-speed table, not the proved one: what a method costs is what it TEACHES.
    { stage: 'pairs', phase: 'First two layers', held: ['f2l-human', 'f1l-inserts', 'middle-inserts'] },
    { stage: 'oll', phase: 'Top face', held: ['oll-human'] },
    { stage: 'pll', phase: 'Last layer', held: ['pll-human'] },
  ]),
  offered('roux', [
    { stage: 'first-block', phase: 'Left block', intuitive: 'block building, found by search: a shipped exact distance table is descended — no table of algorithms' },
    { stage: 'second-block', phase: 'Right block', intuitive: 'block building, found by search: a shipped exact distance table' },
    { stage: 'cmll', phase: 'Top corners', held: ['cmll'] },
    { stage: 'lse', phase: 'Last six edges', intuitive: 'found by search with the middle slice: exact distance tables, no table of algorithms' },
  ]),
]);

for (const m of METHOD_SETS) {
  for (const p of m.phases) {
    for (const id of p.held ?? []) {
      if (!SET_BY_ID.has(id)) throw new Error(`alg-library: ${m.id} teaches a set "${id}" that is not defined`);
    }
  }
}

/** `[{ method, stage }]` for one set: every offered method stage that teaches it. */
const methodsOfSet = (setId) => Object.freeze(METHOD_SETS.flatMap((m) => m.phases
  .filter((p) => (p.held ?? []).includes(setId))
  .map((p) => Object.freeze({ method: m.id, stage: p.stage }))));

// ---- loading the entries --------------------------------------------------------------------------------

let entriesPromise = null;

/**
 * Every set's source entries, `Map(setId -> frozen entries)`, the method modules imported on first call. A
 * name a set picks that its source no longer holds is refused here, loudly — never a set that quietly shrank.
 */
export function loadEntries() {
  entriesPromise ??= (async () => {
    const modules = Object.fromEntries(await Promise.all(Object.entries(ALG_SOURCES)
      .map(async ([id, src]) => [id, await src.load()])));
    const out = new Map();
    for (const set of ALG_SETS) {
      const [sourceId, exported] = set.from;
      const list = modules[sourceId]?.[exported];
      if (!Array.isArray(list)) throw new Error(`alg-library: ${set.id} reads ${exported} from ${sourceId}, which does not export it`);
      const entries = set.names
        ? set.names.map((n) => {
          const hit = list.find((a) => a.name === n);
          if (!hit) throw new Error(`alg-library: ${set.id} names an algorithm "${n}" that ${sourceId} no longer holds`);
          return hit;
        })
        : [...list];
      out.set(set.id, Object.freeze(entries));
    }
    return out;
  })();
  return entriesPromise;
}

/** Sets with rows: every one but the named steps that are not algorithms. */
const ROW_SETS = ALG_SETS.filter((s) => s.kind !== 'not an algorithm');

let indexPromise = null;

/** `id -> { set, entry }`, and a map from each move string (normalised) to the ids that hold it. Built from
 *  strings only — no cube is turned — so it costs microseconds once the entries are in. */
function loadIndex() {
  indexPromise ??= loadEntries().then((entries) => {
    const byId = new Map();
    const byMoves = new Map();
    for (const set of ROW_SETS) {
      for (const entry of entries.get(set.id)) {
        if (byId.has(entry.name)) {
          throw new Error(`alg-library: "${entry.name}" is filed in ${byId.get(entry.name).set.id} and ${set.id}; an id names one row`);
        }
        byId.set(entry.name, { set, entry });
        const key = normalise(entry.alg);
        byMoves.set(key, [...(byMoves.get(key) ?? []), entry.name]);
      }
    }
    return { byId, byMoves };
  });
  return indexPromise;
}

// ---- metrics --------------------------------------------------------------------------------------------
//
// Every metric counts the moves AS WRITTEN: two neighbours that cancel or merge are counted as written, because
// the learner's hands make them as written. Each reads `readToken`'s `kind` and `turns`, so a spelling the
// notation reads is a move every metric agrees on.

const movesIn = (alg) => parse(alg);

/** Tokens: every move written, whole-cube turns included — what the hands do, one by one. */
export const tokensOf = (alg) => movesIn(alg).length;

/** HTM, the half-turn metric: any turn of a face, quarter or half, is 1; a wide turn is 1 (one face and a
 *  turn of the whole cube); a slice is 2 (the two faces either side of it); a whole-cube turn is 0. */
export const htmOf = (alg) => movesIn(alg)
  .reduce((n, m) => n + ({ face: 1, wide: 1, slice: 2, rotation: 0 })[m.kind], 0);

/** STM, the slice-turn metric: as HTM, except a slice is 1 — it is one turn of one layer. */
export const stmOf = (alg) => movesIn(alg)
  .reduce((n, m) => n + ({ face: 1, wide: 1, slice: 1, rotation: 0 })[m.kind], 0);

/** QTM, the quarter-turn metric: a quarter turn of a face or a wide block is 1 and a half turn 2; a slice is
 *  two faces' worth, so 2 a quarter and 4 a half; a whole-cube turn is 0. */
export const qtmOf = (alg) => movesIn(alg)
  .reduce((n, m) => n + ({ face: 1, wide: 1, slice: 2, rotation: 0 })[m.kind] * m.turns, 0);

/** Which of wide / slice / rotation the algorithm uses, in that order; [] for face turns only. */
export const kindsOf = (alg) => {
  const seen = new Set(movesIn(alg).map((m) => m.kind));
  return Object.freeze(['wide', 'slice', 'rotation'].filter((k) => seen.has(k)));
};

// ---- inverse and mirror -----------------------------------------------------------------------------------

/** A move string with a half turn's direction dropped (`R2'` and `R2` are one turn), single-spaced. Two
 *  strings compare equal here exactly when they are the same moves. */
const normalise = (alg) => movesIn(alg).map((m) => m.token.replace("2'", '2')).join(' ');

/** Which letter a letter becomes in a left-right mirror. R and L trade places, and so do their wide turns. */
const MIRROR_LETTER = Object.freeze({ R: 'L', L: 'R', r: 'l', l: 'r' });

/**
 * KEEPS ITS DIRECTION in a left-right mirror: a turn about the left-right axis. Reflecting through the plane
 * between L and R leaves a rotation about the axis perpendicular to it exactly as it was, so `M` stays `M` and
 * `x` stays `x` — and `R` becomes `L'` only because the reflection moves it to the other END of that axis,
 * where the same turn is named the other way round. Every turn about the other two axes changes direction.
 * `alg-ledger.test.mjs` holds this to cubejs: a mirrored algorithm's picture is the mirror of the original's.
 */
const KEEPS_DIRECTION = new Set(['M', 'x']);

/**
 * The left-right mirror of an algorithm: what a left hand does where the right hand did this.
 *
 * Token by token: R and L swap, as do r and l (and Rw and Lw), each with its direction flipped; M and x keep
 * theirs (`KEEPS_DIRECTION`); every other letter keeps its name and flips its direction. A half turn is a half
 * turn either way. Refuses a token the notation cannot read, naming it.
 */
export function mirrorAlg(alg) {
  return movesIn(alg).map((m) => {
    const read = /^(\d?)([URFDLBMESrludfbxyz])(w?)(2'|2|'|)$/.exec(m.token);
    if (!read) throw new Error(`alg-library: cannot mirror "${m.token}"`);
    const [, count, letter, w, amount] = read;
    const to = MIRROR_LETTER[letter] ?? letter;
    const flip = KEEPS_DIRECTION.has(letter) ? amount : ({ '': "'", "'": '', 2: '2', "2'": '2' })[amount];
    return `${count}${to}${w}${flip}`;
  }).join(' ');
}

// ---- triggers ----------------------------------------------------------------------------------------------

/**
 * The triggers a chunk may be named after, each as its SOURCE spells it. Only triggers a source names AND
 * spells out are here: the Speedsolving wiki's "Trigger" page (fetched 2026-10-17) defines the word and
 * names the sexy move without listing others, so each name below is read from its own page. J Perm's
 * last-layer page mentions a "Show Triggers" option, but it lives in a trainer whose trigger list is not
 * published as text, so it is not a source here.
 */
export const TRIGGER_SOURCES = Object.freeze({
  'sexy-move': Object.freeze({
    name: 'Speedsolving wiki, "Sexy Move"',
    url: 'https://www.speedsolving.com/wiki/index.php?title=Sexy_Move',
    fetched: '2026-10-17',
  }),
  sledgehammer: Object.freeze({
    name: 'Speedsolving wiki, "Sledgehammer"',
    url: 'https://www.speedsolving.com/wiki/index.php?title=Sledgehammer',
    fetched: '2026-10-17',
  }),
});

/** Each trigger: its name, the moves its page writes, and the page. The sledgehammer page writes the left
 *  versions and the inverse (which it says is "sometimes humorously called Hedgeslammer") itself. */
export const TRIGGERS = Object.freeze([
  { id: 'sexy-move', name: 'Sexy move', alg: "R U R' U'", source: 'sexy-move' },
  { id: 'sledgehammer', name: 'Sledgehammer', alg: "R' F R F'", source: 'sledgehammer' },
  { id: 'left-sledgehammer', name: 'Left sledgehammer', alg: "L F' L' F", source: 'sledgehammer' },
  { id: 'hedgeslammer', name: 'Hedgeslammer', alg: "F R' F' R", source: 'sledgehammer' },
  { id: 'left-hedgeslammer', name: 'Left hedgeslammer', alg: "F' L F L'", source: 'sledgehammer' },
].map((x) => Object.freeze(x)));

/** The triggers in an algorithm, by token index: `[{ trigger, from, to }]`, `to` exclusive. Left to right,
 *  non-overlapping — a chunk once found is not re-read as the start of another. */
export function chunksOf(alg) {
  const tokens = movesIn(alg).map((m) => m.token);
  const out = [];
  for (let i = 0; i < tokens.length;) {
    const hit = TRIGGERS.find((tr) => {
      const want = tr.alg.split(' ');
      return want.every((tok, k) => tokens[i + k] === tok);
    });
    if (hit) {
      const len = hit.alg.split(' ').length;
      out.push(Object.freeze({ trigger: hit.id, from: i, to: i + len }));
      i += len;
    } else {
      i += 1;
    }
  }
  return Object.freeze(out);
}

// ---- what a smart cube sees ---------------------------------------------------------------------------------

/**
 * The tokens a smart cube does not report as themselves. A smart cube reports turns of its six faces against
 * its own core, so: a whole-cube turn reports NOTHING; a slice reports the TWO faces either side of it (and the
 * cube is then held differently); a wide turn reports ONE face, the one opposite the side it names. Read off
 * `faceTurnsOf`, the interpreter's own account of which faces a move turns relative to the centres.
 * `[{ at, token, kind, reports }]`, `reports` the face turns the cube would send.
 */
export function observableOf(alg) {
  return Object.freeze(movesIn(alg).flatMap((m, at) => {
    if (m.kind === 'face') return [];
    const reports = faceTurnsOf(m).turns.map((x) => x.name).filter(Boolean);
    return [Object.freeze({ at, token: m.token, kind: m.kind, reports: Object.freeze(reports) })];
  }));
}

// ---- the case ---------------------------------------------------------------------------------------------

/**
 * The state the algorithm solves: its inverse played on a solved cube held as its letters are written, read
 * as the learner sees it in the hold they START in — the hold the inverse ends in, which is the declared hold
 * whenever the algorithm keeps the hold. `facelets` are the scan frame's colour letters, positions as viewed:
 * 0-8 is the face on top. That is the form `topFaceSvg` and `netSvg` draw.
 */
function caseOf(alg, hold) {
  const played = run(invert(alg), hold, SOLVED);
  const viewHold = Object.freeze([...played.hold]);
  // The stickers MOVED to where the learner sees them and NOT renamed: `turnFacelets` would also relabel each
  // colour by the face it now sits on (the method frame's own letters), and a picture painted from those
  // letters shows a white top where the learner sees yellow.
  const scan = toFacelets(played.state);
  const perm = orientationPerm(...viewHold);
  return { facelets: perm.map((from) => scan[from]).join(''), viewHold };
}

// ---- the sentence ------------------------------------------------------------------------------------------

const NUMBER = Object.freeze(['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']);
const count = (n) => t(NUMBER[n] ?? String(n));

/** The regions `keeps` can name, as words, and which contain which — so a sentence names the largest. */
const REGION_WORDS = Object.freeze({
  cross: 'the cross',
  'first-layer': 'the first layer',
  'first-two-layers': 'the first two layers',
  'first-block': 'the first block',
  'both-blocks': 'both blocks',
});
const CONTAINS = Object.freeze({
  'first-two-layers': ['first-layer', 'cross', 'both-blocks', 'first-block'],
  'first-layer': ['cross'],
  'both-blocks': ['first-block'],
});

/**
 * Which regions a set's sentence may name: the layers for the layer methods, the blocks for Roux. An F2L
 * insert keeps the left block too, and saying so is true and tells a CFOP learner nothing; `regions` on the set
 * says which vocabulary its learners have.
 */
export const REGION_FAMILY = Object.freeze({
  layers: Object.freeze(['cross', 'first-layer', 'first-two-layers']),
  blocks: Object.freeze(['first-block', 'both-blocks', 'first-two-layers']),
});

/** The kept regions of one family that no other kept region contains, in `REGIONS` order. */
export const largestKept = (keeps, family = 'layers') => keeps
  .filter((r) => REGION_FAMILY[family].includes(r))
  .filter((r) => !keeps.some((o) => (CONTAINS[o] ?? []).includes(r)));

const isTop = (position) => position.startsWith('U');
const allTop = (positions) => positions.length > 0 && positions.every(isTop);

const SIDE = Object.freeze({ U: 'top', D: 'bottom', F: 'front', B: 'back', R: 'right', L: 'left' });

/** A position in words, in the letters' frame: `DFR` is "the bottom front-right corner", `FR` "the
 *  front-right edge", `DF` "the bottom-front edge". */
export function positionWords(position) {
  if (position.length === 3) {
    const [layer, ...sides] = position;
    const ordered = sides.sort((a, b) => 'FBRL'.indexOf(a) - 'FBRL'.indexOf(b));
    return `the ${SIDE[layer]} ${SIDE[ordered[0]]}-${SIDE[ordered[1]]} corner`;
  }
  const ordered = [...position].sort((a, b) => 'UDFBRL'.indexOf(a) - 'UDFBRL'.indexOf(b));
  return `the ${SIDE[ordered[0]]}-${SIDE[ordered[1]]} edge`;
}

/**
 * The clauses for one kind of piece, from its cycles and its in-place turns. The words are chosen so each says
 * exactly one checkable fact: "swaps two" is one 2-cycle, "swaps two pairs of" two of them, "cycles three" one
 * 3-cycle, "cycles four" one 4-cycle — each only when no piece in it comes back turned. Anything else is said
 * as "moves N", which is true of every permutation and claims nothing more. "top" is said exactly when every
 * piece the clause covers is in the top layer.
 */
function pieceClauses(cycles, inPlace, noun, turnVerb) {
  const out = [];
  if (cycles.length) {
    const lens = cycles.map((c) => c.positions.length).sort((a, b) => a - b);
    const turned = cycles.some((c) => c.turn !== 0);
    const top = allTop(cycles.flatMap((c) => c.positions)) ? `${t('top')} ` : '';
    const n = lens.reduce((a, b) => a + b, 0);
    const shape = lens.join(',');
    if (!turned && shape === '2') out.push(t('swaps two %1%2', top, noun));
    else if (!turned && shape === '2,2') out.push(t('swaps two pairs of %1%2', top, noun));
    else if (!turned && shape === '3') out.push(t('cycles three %1%2', top, noun));
    else if (!turned && shape === '4') out.push(t('cycles four %1%2', top, noun));
    else out.push(t('moves %1 %2%3', count(n), top, noun));
  }
  if (inPlace.length) {
    const top = allTop(inPlace.map((p) => p.position)) ? `${t('top')} ` : '';
    const one = inPlace.length === 1;
    out.push(t('%1 %2 %3%4 in place', turnVerb, count(inPlace.length), top, one ? noun.replace(/s$/, '') : noun));
  }
  return out;
}

/** "a, b and c". */
const listed = (parts) => (parts.length <= 1 ? parts.join('') : t('%1 and %2', parts.slice(0, -1).join(', '), parts.at(-1)));

const capitalised = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * ONE sentence: what the algorithm does, generated from the computed `effect`, `keeps` and case — never typed.
 *
 * Three shapes, chosen by what the algorithm does, so every sentence says something a learner can check:
 *   TOP COLOUR UP   a set whose purpose is orientation (`shows: 'orientation'`), when it keeps the first two
 *                   layers: how many top corners and edges show the top colour on top after it and did not in
 *                   the case. "Turns the top colour up on three corners; keeps the first two layers."
 *   CYCLES          every moved piece is in the top layer, or it keeps both blocks: the piece clauses above.
 *                   "Swaps two top corners and two top edges" is said as two clauses.
 *   BUILDING        anything else — an insert: the pieces outside the top layer it puts in place, by name, and
 *                   how many top pieces it moves on the way. "Puts the bottom front-right corner and the
 *                   front-right edge in place and moves three top pieces; keeps the cross."
 * Then the largest regions it keeps, and whether it ends with the cube held differently. Each fragment goes
 * through `t()`; `alg-ledger.test.mjs` reads every sentence back and re-derives each claim with cubejs.
 */
export function saysOf({ effect, keeps, facelets, shows, regions = 'layers' }) {
  const kept = largestKept(keeps, regions);
  const moved = [
    ...effect.cornerCycles.flatMap((c) => c.positions), ...effect.twistedInPlace.map((p) => p.position),
    ...effect.edgeCycles.flatMap((c) => c.positions), ...effect.flippedInPlace.map((p) => p.position),
  ];
  let body;
  if (shows === 'orientation' && keeps.includes('first-two-layers')) {
    // Read off the case's own top face: the stickers of the top layer's corners and edges that do NOT show
    // the top centre's colour on top are the ones the algorithm turns up.
    const top = facelets[4];
    const corners = [0, 2, 6, 8].filter((i) => facelets[i] !== top).length;
    const edges = [1, 3, 5, 7].filter((i) => facelets[i] !== top).length;
    const parts = [];
    if (corners) parts.push(t('%1 %2', count(corners), corners === 1 ? t('corner') : t('corners')));
    if (edges) parts.push(t('%1 %2', count(edges), edges === 1 ? t('edge') : t('edges')));
    body = t('turns the top colour up on %1', listed(parts));
  } else if (allTop(moved) || keeps.includes('both-blocks')) {
    body = listed([
      ...pieceClauses(effect.cornerCycles, effect.twistedInPlace, t('corners'), t('twists')),
      ...pieceClauses(effect.edgeCycles, effect.flippedInPlace, t('edges'), t('flips')),
    ]);
  } else {
    const below = moved.filter((p) => !isTop(p));
    const topMoved = moved.filter(isTop).length;
    const named = listed(below.map(positionWords));
    body = topMoved
      ? t('puts %1 in place and moves %2 top %3', named, count(topMoved), topMoved === 1 ? t('piece') : t('pieces'))
      : t('puts %1 in place', named);
  }
  let sentence = capitalised(body);
  if (kept.length) sentence = t('%1; keeps %2', sentence, listed(kept.map((r) => t(REGION_WORDS[r]))));
  if (!effect.keepsHold) sentence = t('%1; ends with the cube held differently', sentence);
  return `${sentence}.`;
}

// ---- the row ------------------------------------------------------------------------------------------------

const rowCache = new Map();

/** A frozen deep copy, so a row handed out cannot be edited under the cache. */
const frozen = (v) => {
  if (Array.isArray(v)) return Object.freeze(v.map(frozen));
  if (v && typeof v === 'object') return Object.freeze(Object.fromEntries(Object.entries(v).map(([k, x]) => [k, frozen(x)])));
  return v;
};

function sourceOf(set, entry) {
  if (set.kind === 'hand-written') return 'written for teaching';
  if (set.kind === 'proved') return 'proved minimal by search';
  const table = set.from[0] === 'human-algs' ? HUMAN_SOURCES : CMLL_SOURCES;
  const src = table[entry.source];
  if (!src) throw new Error(`alg-library: ${entry.name} names a source "${entry.source}" its data file does not list`);
  return cite(src);
}

/** Everything about one row; the expensive columns are computed here, once per id. */
function buildRow(id, { byId, byMoves }) {
  const { set, entry } = byId.get(id);
  const { alg } = entry;
  const { hold } = ALG_SOURCES[set.from[0]];
  const effect = effectOf(alg);
  const { facelets, viewHold } = caseOf(alg, hold);
  const keepsF2L = effect.keeps.includes('first-two-layers');
  const picture = !keepsF2L ? 'net' : set.shows === 'orientation' ? 'top-orientation' : 'top-colours';
  const others = (key) => (byMoves.get(key) ?? []).filter((x) => x !== id);
  const source = sourceOf(set, entry);
  const nicknameSource = entry.nickname ? cite(HUMAN_SOURCES['speedsolving-oll-names']) : null;
  return frozen({
    id,
    set: set.id,
    label: entry.label ?? null,
    nickname: entry.nickname ?? null,
    source,
    nicknameSource,
    sourceAlg: entry.sourceAlg ?? null,
    methods: methodsOfSet(set.id),
    alg,
    hold: [...hold],
    tokens: tokensOf(alg),
    htm: htmOf(alg),
    stm: stmOf(alg),
    qtm: qtmOf(alg),
    kinds: kindsOf(alg),
    solves: {
      case: entry.case ?? (set.kind === 'proved' ? entry.name : null),
      facelets,
      viewHold,
      picture,
    },
    effect: {
      cornerCycles: effect.cornerCycles,
      edgeCycles: effect.edgeCycles,
      twistedInPlace: effect.twistedInPlace,
      flippedInPlace: effect.flippedInPlace,
      movedCorners: effect.movedCorners,
      movedEdges: effect.movedEdges,
      parity: effect.parity,
      keepsHold: effect.keepsHold,
      endHold: effect.endHold,
    },
    keeps: effect.keeps,
    order: effect.order,
    chunks: chunksOf(alg),
    sameAs: others(normalise(alg)),
    inverseOf: others(normalise(invert(alg))),
    mirrorOf: others(normalise(mirrorAlg(alg))),
    observable: observableOf(alg),
    says: saysOf({ effect, keeps: effect.keeps, facelets, shows: set.shows, regions: set.regions }),
  });
}

// ---- the public reads ----------------------------------------------------------------------------------------

/** Every row id, set by set in `ALG_SETS` order, each set in its source's order. */
export async function algIds() {
  const { byId } = await loadIndex();
  return Object.freeze([...byId.keys()]);
}

/** One row, computed on first ask and cached. Refuses an id no source holds. */
export async function algRow(id) {
  const index = await loadIndex();
  if (!index.byId.has(id)) throw new Error(`alg-library: no algorithm "${id}"`);
  if (!rowCache.has(id)) rowCache.set(id, buildRow(id, index));
  return rowCache.get(id);
}

/** Every row of one set. A set that is not an algorithm set has no rows, and asking for one is refused. */
export async function setRows(setId) {
  const set = SET_BY_ID.get(setId);
  if (!set) throw new Error(`alg-library: no set "${setId}"`);
  if (set.kind === 'not an algorithm') throw new Error(`alg-library: "${setId}" is not an algorithm set, so it has no rows`);
  const entries = await loadEntries();
  return Object.freeze(await Promise.all(entries.get(setId).map((e) => algRow(e.name))));
}

/** Every row an offered method teaches, stage by stage, a row once even where two stages share its set. */
export async function rowsForMethod(methodId) {
  const m = METHOD_SETS.find((x) => x.id === methodId);
  if (!m) throw new Error(`alg-library: no offered method "${methodId}"`);
  const sets = [...new Set(m.phases.flatMap((p) => p.held ?? []))];
  return Object.freeze((await Promise.all(sets.map(setRows))).flat());
}

/** The set definition for an id, or undefined. */
export const algSet = (setId) => SET_BY_ID.get(setId);
