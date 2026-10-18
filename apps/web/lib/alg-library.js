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
//   observable           the moves that are not one face turn, and the faces a smart cube reports for each,
//                        named by the cube's own faces (see `observableOf`)
//   purpose              the set's one plain sentence: what the algorithm is FOR (`ALG_SETS`, `purpose`)
//   says                 ONE sentence generated from `effect`, `keeps` and `solves`: what it does toward that
//                        purpose, its point first and what it disturbs on the way after (see `saysOf`)
//
// THE FRAME. Every table here is written in the METHOD frame — white underneath (`METHOD_FRAME` in
// `lib/solving-hold.js`) — so `effect`'s positions are named in the letters' own frame: `D` is the bottom,
// which is the white side, and "the first two layers" are the white ones.

import { faceTurnsOf, run } from './cube-moves.js';
import { parse, readToken } from './cube-notation.js';
import { orientationPerm } from './cube-orientation.js';
import { CORNERS, EDGES, SOLVED, allSolved, applyAlg, compose, invert, toFacelets } from './cube-pieces.js';
import { effectOf } from './alg-effect.js';
import { plural, t } from './i18n.js';
import { METHOD_FRAME } from './solving-hold.js';
import { METHODS as REGISTRY } from './methods/registry.js';
import { HUMAN_F2L, HUMAN_OLL, HUMAN_PLL, SOURCES as HUMAN_SOURCES } from './data/human-algs.js';
import { CMLL_ALGS, SOURCES as CMLL_SOURCES } from './data/cmll-algs.js';
import { F2L_CASES, FULL_OLL, FULL_PLL } from './data/case-tables.js';
import {
  MEHTA_6CO, MEHTA_6CP, MEHTA_BEGINNER, MEHTA_EOLE, MEHTA_L5EP, SOURCES as MEHTA_SOURCES,
} from './data/mehta-algs.js';
import { CF_ALGS, CF_STEPS, SOURCES as CF_SOURCES } from './data/corners-first-algs.js';

// ---- the source modules ------------------------------------------------------------------------------

/** Corners first's steps either side of `centres`, which has no sequence: the corner steps are held white
 *  underneath, the edge steps white on the left — the corner hold turned a quarter about the front-back axis. */
const CF_CORNER_STEPS = Object.freeze(CF_STEPS.slice(0, CF_STEPS.indexOf('centres')));
const CF_EDGE_STEPS = Object.freeze(CF_STEPS.slice(CF_STEPS.indexOf('centres') + 1));
const CF_EDGE_HOLD = Object.freeze([...run('z', METHOD_FRAME, SOLVED).hold]);

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
    citations: HUMAN_SOURCES,
    citeAs: (e) => e.source,
    load: async () => ({ HUMAN_F2L, HUMAN_OLL, HUMAN_PLL }),
  }),
  'cmll-algs': Object.freeze({
    module: 'lib/data/cmll-algs.js',
    hold: METHOD_FRAME,
    holdWhy: 'blocks on D, the top corners on U — the method frame Roux is held in',
    citations: CMLL_SOURCES,
    citeAs: (e) => e.source,
    load: async () => ({ CMLL_ALGS }),
  }),
  'case-tables': Object.freeze({
    module: 'lib/data/case-tables.js',
    hold: METHOD_FRAME,
    holdWhy: 'searched in the method frame: the first two layers on D, the last layer on U',
    load: async () => ({ F2L_CASES, FULL_OLL, FULL_PLL }),
  }),
  'mehta-algs': Object.freeze({
    module: 'lib/data/mehta-algs.js',
    hold: METHOD_FRAME,
    finish: 'bottom',
    holdWhy: 'the sheet\'s hold: the block underneath at the left, white on D, the middle layer round it (mehta-algs.js header) — the method frame',
    citations: MEHTA_SOURCES,
    citeAs: () => 'mehta-os',
    load: async () => ({ MEHTA_EOLE, MEHTA_6CO, MEHTA_6CP, MEHTA_L5EP, MEHTA_BEGINNER }),
  }),
  'corners-first-corners': Object.freeze({
    module: 'lib/data/corners-first-algs.js',
    hold: METHOD_FRAME,
    ignoresCase: true,
    holdWhy: 'the corner steps are written white underneath (corners-first-algs.js, THE HOLDS)',
    citations: CF_SOURCES,
    citeAs: () => 'jelinek-beginner',
    load: async () => ({ CF_ALGS: CF_ALGS.filter((r) => CF_CORNER_STEPS.includes(r.step)) }),
  }),
  'corners-first-edges': Object.freeze({
    module: 'lib/data/corners-first-algs.js',
    hold: CF_EDGE_HOLD,
    finish: 'middle-slice',
    ignoresCase: true,
    holdWhy: 'the edge steps are written white on the left, yellow on the right: the corner hold turned a quarter about the front-back axis (header); corners-first-algs.test.mjs puts the white edges on L',
    citations: CF_SOURCES,
    citeAs: () => 'jelinek-beginner',
    load: async () => ({ CF_ALGS: CF_ALGS.filter((r) => CF_EDGE_STEPS.includes(r.step)) }),
  }),
});

/**
 * Sources that exist as another session's UNCOMMITTED work and are therefore NOT read: nothing here imports
 * them. `alg-ledger.test.mjs` fails the day one is committed, so it is added rather than left pending.
 */
export const PENDING_SOURCES = Object.freeze([]);

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
  mehta: Object.freeze({
    label: 'the sheet labels no algorithm: its column and place in it are the row\'s id',
    nickname: 'the sheet gives no nicknames',
    case: 'the sheet keys a case by its column, which the id carries; the picture is the case',
  }),
  cornersFirst: Object.freeze({
    label: 'Jelinek names no sequence',
    nickname: 'Jelinek gives no nicknames',
    case: 'Jelinek\'s caption says where he applies a sequence, which for a set-up sequence is not the case it solves; the picture is the case',
  }),
  proved: Object.freeze({
    label: 'the proved tables name a case by an identifier, not by a name a learner would find elsewhere (case-tables.js header)',
    nickname: 'the proved tables give no nickname',
  }),
});

/** The purposes a sourced set and its proved oracle share: the oracle answers the same cases, so it is FOR the
 *  same thing. Said once here so the two cannot drift apart. An F2L row moves the top layer and its own slot's
 *  two pieces and nothing else, so it cannot reach a piece in another slot: its purpose says so
 *  (`alg-ledger.test.mjs`, "a slot set's purpose promises only the cases its rows can solve"). */
const PURPOSE = Object.freeze({
  f2l: 'Puts a corner and its edge into one slot of the first two layers when each starts in the top layer or in that slot; a piece in another slot is taken out first.',
  oll: 'Turns every top piece so the top colour faces up, in one algorithm.',
  pll: 'Once the top face is one colour, moves every top piece to where it belongs in one algorithm, which finishes the cube.',
});
const GOAL = Object.freeze({
  f2l: { does: 'insert', region: 'first-two-layers', pieces: 'slot' },
  oll: { does: 'orient', kinds: ['corner', 'edge'] },
  pll: { does: 'permute', kinds: ['corner', 'edge'], after: 'top-up' },
});

/**
 * The milestones a Mehta step reaches or keeps, each a predicate on a piece state in the letters' frame (white
 * on D). "Home" is in its slot, not twisted or flipped. `positional` milestones name pieces by slot, and those
 * pieces are not free for the "also changes" clause; the rest are about every piece at once.
 */
const home = (edges, corners) => (state) => allSolved(state, { edges, corners });
const ALL_CORNER_SLOTS = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7]);
const ALL_EDGE_SLOTS = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
const milestone = (m) => Object.freeze({ ...m, edges: Object.freeze(m.edges ?? []), corners: Object.freeze(m.corners ?? []) });
const MILESTONES = Object.freeze({
  // EDGES: UR UF UL UB DR DF DL DB FR FL BL BR; CORNERS: URF UFL ULB UBR DFR DLF DBL DRB.
  block: milestone({ positional: true, edges: [5, 6, 7], corners: [5, 6], keep: 'the block' }),
  belt: milestone({ positional: true, edges: [9, 10, 11, 8], keep: 'the middle layer' }),
  belt3: milestone({ positional: true, edges: [9, 10, 11], keep: 'the other middle edges' }),
  fr: milestone({ positional: true, edges: [8], point: 'puts the front-right edge in place' }),
  drb: milestone({ positional: true, corners: [7], point: 'puts the bottom back-right corner in place' }),
  dfr: milestone({ positional: true, corners: [4], point: 'puts the bottom front-right corner in place' }),
  dr: milestone({ positional: true, edges: [4], point: 'puts the bottom-right edge in place' }),
  'bottom-corners': milestone({ positional: true, corners: [4, 5, 6, 7], keep: 'the bottom corners' }),
  corners: milestone({ positional: true, corners: ALL_CORNER_SLOTS, keep: 'every corner' }),
  eo: milestone({ positional: false, holds: (s) => s.eo.every((v) => v === 0), point: 'turns every edge the right way round', keep: 'every edge the right way round' }),
  co: milestone({ positional: false, holds: (s) => s.co.every((v) => v === 0), point: 'turns every corner so the top or bottom colour faces up or down', keep: 'which way every corner faces' }),
  cp: milestone({ positional: false, holds: (s) => s.cp.every((v, i) => v === i), point: 'puts every corner where it belongs' }),
  solved: milestone({ positional: false, holds: home(ALL_EDGE_SLOTS, ALL_CORNER_SLOTS), point: 'finishes the cube by putting every edge where it belongs' }),
});
/** Whether a milestone holds on a state: its own predicate, or its pieces all home. */
const reached = (id, state) => {
  const m = MILESTONES[id];
  return m.holds ? m.holds(state) : allSolved(state, { edges: m.edges, corners: m.corners });
};

const GOAL_SHAPE = Object.freeze({
  does: ['insert', 'orient', 'permute', 'solve', 'milestones'],
  region: ['cross', 'first-layer', 'first-two-layers', 'bottom-corners', 'cf-ledges', 'cf-redges', 'cf-last-ledge', 'every-piece'],
  pieces: ['edge', 'corner', 'pair', 'slot', 'any'],
  from: ['top'],
  kinds: ['corner', 'edge'],
  after: ['edges-up', 'top-up', 'corners-done'],
});

/** A set's goal, checked for shape and frozen. Refuses — loudly, at import — a goal the sentence and the test
 *  could not read, rather than letting a row fall through to a sentence nobody designed. */
function frozenGoal(set) {
  const g = set.goal;
  const bad = (why) => { throw new Error(`alg-library: ${set.id}'s goal ${why}`); };
  if (typeof set.purpose !== 'string' || !set.purpose.endsWith('.')) bad('has no purpose sentence beside it');
  if (!GOAL_SHAPE.does.includes(g.does)) bad(`does "${g.does}", which no sentence describes`);
  if (g.does === 'insert') {
    if (!GOAL_SHAPE.region.includes(g.region) || !GOAL_SHAPE.pieces.includes(g.pieces)) bad('names a region or pieces no sentence knows');
    if (g.from !== undefined && !GOAL_SHAPE.from.includes(g.from)) bad(`says the pieces come from "${g.from}"`);
    if ((g.pieces === 'pair' || g.pieces === 'slot') && g.region !== 'first-two-layers') bad('puts a slot together outside the first two layers');
  } else if (g.does === 'milestones') {
    if (!Array.isArray(g.point) || !g.point.length || !Array.isArray(g.keeps) || !g.keeps.length) bad('names no milestone it reaches or keeps');
    for (const id of g.point) if (!MILESTONES[id]?.point) bad(`reaches "${id}", which no sentence says`);
    for (const id of g.keeps) if (!MILESTONES[id]?.keep) bad(`keeps "${id}", which no sentence says`);
    if (g.turnsTopAndBottom !== undefined && g.turnsTopAndBottom !== true) bad('says turnsTopAndBottom as something other than true');
    return Object.freeze({ ...g, point: Object.freeze([...g.point]), keeps: Object.freeze([...g.keeps]) });
  } else {
    if (!Array.isArray(g.kinds) || !g.kinds.length || !g.kinds.every((k) => GOAL_SHAPE.kinds.includes(k))) bad('names no kind of top piece');
    if (g.after !== undefined && !GOAL_SHAPE.after.includes(g.after)) bad(`starts after "${g.after}"`);
  }
  return Object.freeze({ ...g, ...(g.kinds ? { kinds: Object.freeze([...g.kinds]) } : {}) });
}

/**
 * WHICH ALGORITHM IS IN WHICH SET, said once. Moved here from `bench/algorithm-ledger.mjs`, which now reads
 * it. A set takes its rows from one export of one source module — BY NAME, never by index, so a reordering
 * inside a repertoire cannot silently move an algorithm into another set; `names` absent takes them all.
 *
 *   kind        'hand-written' (written for teaching), 'sourced' (the community's, cited), 'proved' (searched,
 *               proven minimal — the ORACLE the sourced tables are checked against, taught by no method), or
 *               'not an algorithm' (a named step with no moves; it has no row).
 *   regions     'layers' (the default) or 'blocks': which kept regions its sentence names (`REGION_FAMILY`).
 *   purpose     ONE plain sentence a learner reads first: what the set is FOR. Every row carries it. Declared
 *               beside `goal`, and `alg-ledger.test.mjs` holds the two together twice over: the words must say
 *               what the goal says (and must not say what it does not), and the goal must be true of every
 *               row's case and effect, re-derived with cubejs.
 *   goal        the purpose as data, which is also what decides which pieces a row's sentence (`saysOf`) treats
 *               as its POINT and which as disturbed on the way:
 *                 { does: 'insert', region, pieces, from }  — a step before the last layer. `region` is what the
 *                   stage has built ('cross', 'first-layer', 'first-two-layers'); `pieces` which of it the case
 *                   has wrong: 'edge' / 'corner' (exactly one), 'pair' (a slot's corner AND edge), 'slot' (some
 *                   of one slot's corner and edge); `from: 'top'` when that piece sits in the top layer in the
 *                   case. Everything outside `region` is not built yet, so moving it is not a fault.
 *                 { does: 'orient' | 'permute' | 'solve', kinds, after?, keepsTopEdges? } — a last-layer step:
 *                   which way the top `kinds` face, where they go, or both. `after` is what the case already has
 *                   done: 'edges-up' (the cross on top), 'top-up' (the whole top face), 'corners-done'.
 *               An orientation goal is also why the case picture shows which stickers are up, not every colour.
 *   notGiven    per field, why that field is `null` on this set's rows.
 */
export const ALG_SETS = Object.freeze([
  {
    id: 'cross-inserts', name: 'Cross inserts', kind: 'hand-written', from: ['cross', 'CROSS_ALGS'],
    purpose: 'Brings one edge of the bottom cross down from the top layer.',
    goal: { does: 'insert', region: 'cross', pieces: 'edge', from: 'top' },
    provenance: 'written for teaching, not searched. Two ways to drop a cross edge in from the top.',
    verified: 'every entry must be reachable and used — `method-solver` refuses a step naming anything outside CASE_NAMES',
  },
  {
    id: 'f1l-inserts', name: 'First-layer corner inserts', kind: 'hand-written', from: ['pairs', 'PAIRS_ALGS'],
    purpose: 'Brings one corner of the first layer down from the top layer.',
    goal: { does: 'insert', region: 'first-layer', pieces: 'corner', from: 'top' },
    names: ['right-hand', 'left-hand', 'facing-up'],
    provenance: 'the beginner trigger and its repeat, in the three orientations a corner can be in',
    verified: 'same as above',
  },
  {
    id: 'middle-inserts', name: 'Middle-layer edge inserts', kind: 'hand-written', from: ['pairs', 'PAIRS_ALGS'],
    purpose: 'Brings one edge of the middle layer down from the top layer.',
    goal: { does: 'insert', region: 'first-two-layers', pieces: 'edge', from: 'top' },
    names: ['insert-right', 'insert-left'],
    provenance: 'one pair that both inserts a correct edge and ejects a wrong one, which is how it is taught',
    verified: 'same as above',
  },
  {
    id: 'f2l-triggers', name: 'F2L triggers', kind: 'hand-written', from: ['pairs', 'PAIRS_ALGS'],
    purpose: 'Brings a corner and its edge down from the top layer together, into one slot of the first two layers.',
    goal: { does: 'insert', region: 'first-two-layers', pieces: 'pair', from: 'top' },
    names: ['right', 'right-back', 'right-half', 'left', 'left-back', 'left-half'],
    provenance: 'CFOP (easy)\'s first two layers: six triggers a pair is built out of, rather than 41 cases',
    verified: 'same as above',
  },
  {
    id: 'eoll', name: 'Two-look OLL, first look', kind: 'hand-written', from: ['last-layer', 'OLL_ALGS'],
    purpose: 'Turns the top edges so the top colour faces up, which makes a cross on top.',
    goal: { does: 'orient', kinds: ['edge'] },
    names: ['edge-orient'],
    provenance: 'one algorithm, applied up to three times, to orient the last-layer edges',
    verified: 'same as above',
  },
  {
    id: 'ocll', name: 'Two-look OLL, second look', kind: 'hand-written', from: ['last-layer', 'OLL_ALGS'],
    purpose: 'Once the cross on top is made, turns the top corners so the whole top face is one colour.',
    goal: { does: 'orient', kinds: ['corner'], after: 'edges-up' },
    names: ['sune', 'antisune', 'headlights', 'double-sune', 'pi'],
    provenance: 'the corner-orientation cases in face turns only, by choice: the first algorithms a learner meets need no notation beyond the six faces. The renderer and the interpreter read wide turns and slices too; the sourced sets use them',
    verified: 'same as above',
  },
  {
    id: 'cpll', name: 'Two-look PLL, corners', kind: 'hand-written', from: ['last-layer', 'PLL_ALGS'],
    purpose: 'Once the top face is one colour, moves the top corners to where they belong.',
    goal: { does: 'permute', kinds: ['corner'], after: 'top-up' },
    names: ['corner-cycle', 'corner-cycle-back', 'diagonal'],
    provenance: 'adjacent swap both ways round, plus the diagonal',
    verified: 'same as above',
  },
  {
    id: 'epll', name: 'Two-look PLL, edges', kind: 'hand-written', from: ['last-layer', 'PLL_ALGS'],
    purpose: 'Once the top corners are where they belong, moves the top edges to where they belong, which finishes the cube.',
    goal: { does: 'permute', kinds: ['edge'], after: 'corners-done' },
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
    purpose: 'Makes a cross on top by turning the top edges so the top colour faces up, then moves them to where they belong.',
    goal: { does: 'solve', kinds: ['edge'] },
    names: ['course-cross', 'course-edge-swap'],
    provenance: 'the beginner course\'s lessons 13 and 14 (cubus-courses): the cross on top, then a swap of two top edges',
    verified: 'same as above; and `bench/method-solver-profile.mjs exhaustive course course` walks all 62,208 last-layer states through the course\'s route (a nightly CI shard)',
  },
  {
    id: 'course-corners', name: 'The course\'s top corners', kind: 'hand-written', from: ['last-layer', 'COURSE_ALGS'],
    purpose: 'Moves the top corners to where they belong, then turns each one until the top colour faces up, leaving the top edges where they are.',
    goal: { does: 'solve', kinds: ['corner'], keepsTopEdges: true },
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
    purpose: PURPOSE.f2l, goal: GOAL.f2l,
    provenance: 'SpeedCubeDB\'s top-voted Front Right algorithm per case; what CFOP (full) teaches for its first two layers',
    verified: '`human-algs.test.mjs`: cubejs finds each answers exactly its proved case, and the 41 cover the 41 once each',
    notGiven: { nickname: 'SpeedCubeDB numbers the F2L cases and names none' },
  },
  {
    id: 'oll-human', name: 'Full OLL, human-speed', kind: 'sourced', from: ['human-algs', 'HUMAN_OLL'],
    purpose: PURPOSE.oll, goal: GOAL.oll,
    provenance: 'J Perm\'s first-listed algorithm per case; what CFOP (full) teaches for the top face',
    verified: 'same cubejs check, 57 to 57',
    notGiven: { nickname: 'the Speedsolving wiki names some OLL cases and not this one' },
  },
  {
    id: 'pll-human', name: 'Full PLL, human-speed', kind: 'sourced', from: ['human-algs', 'HUMAN_PLL'],
    purpose: PURPOSE.pll, goal: GOAL.pll,
    provenance: 'J Perm\'s first-listed algorithm per case; what CFOP (full) teaches for the last layer',
    verified: 'same cubejs check, 21 to 21',
    notGiven: { nickname: 'a PLL\'s letter is its name; the sheets give no other' },
  },
  {
    id: 'cmll', name: 'CMLL', kind: 'sourced', from: ['cmll-algs', 'CMLL_ALGS'], regions: 'blocks',
    purpose: 'Solves the four top corners, both where they go and which way they face, without breaking the two blocks.',
    goal: { does: 'solve', kinds: ['corner'] },
    provenance: `${CMLL_SOURCES.speedcubedb.name}'s top-voted algorithm per case, fetched ${CMLL_SOURCES.speedcubedb.fetched} from the page's markup and taught exactly as written; what Roux teaches for the top corners`,
    verified: '`cmll-algs.test.mjs`: cubejs finds every row keeps both blocks and the centres, the 42 rows answer the 42 cases once each, and no row solves the arrangement none is for',
    notGiven: { nickname: 'SpeedCubeDB gives each CMLL case one name, its label', case: 'the CMLL table keys no case: its label names it, and the picture is the case' },
  },
  {
    id: 'mehta-eole', name: 'Mehta: EOLE', kind: 'sourced', from: ['mehta-algs', 'MEHTA_EOLE'],
    purpose: 'Puts the last middle edge in place and turns every edge the right way round, keeping the block and the other middle edges.',
    goal: { does: 'milestones', point: ['fr', 'eo'], keeps: ['block', 'belt3'] },
    provenance: 'the Mehta-OS sheet\'s EOLE page, every cell in the sheet\'s order (`mehta-algs.js`)',
    verified: '`mehta-algs.test.mjs`: cubejs draws every row\'s case and the rows answer the 55 cases once each',
    notGiven: NOT_GIVEN.mehta,
  },
  {
    id: 'mehta-6co', name: 'Mehta: 6CO', kind: 'sourced', from: ['mehta-algs', 'MEHTA_6CO'],
    purpose: 'Turns every corner so the top or bottom colour faces up or down, keeping the block, the middle layer and every edge the right way round.',
    goal: { does: 'milestones', point: ['co'], keeps: ['block', 'belt', 'eo'] },
    provenance: 'the Mehta-OS sheet\'s 6CO page, every cell in the sheet\'s order (`mehta-algs.js`)',
    verified: '`mehta-algs.test.mjs`: the rows answer the 71 cases once each',
    notGiven: NOT_GIVEN.mehta,
  },
  {
    id: 'mehta-6cp', name: 'Mehta: 6CP', kind: 'sourced', from: ['mehta-algs', 'MEHTA_6CP'],
    purpose: 'Puts every corner where it belongs, keeping the block, the middle layer, every edge the right way round and which way every corner faces.',
    goal: { does: 'milestones', point: ['cp'], keeps: ['block', 'belt', 'eo', 'co'] },
    provenance: 'the Mehta-OS sheet\'s 6CP page, every cell in the sheet\'s order (`mehta-algs.js`)',
    verified: '`mehta-algs.test.mjs`: the 47 rows answer the 41 cases, two columns pinned as the same six cases with the bottom turned first',
    notGiven: NOT_GIVEN.mehta,
  },
  {
    id: 'mehta-l5ep', name: 'Mehta: L5EP', kind: 'sourced', from: ['mehta-algs', 'MEHTA_L5EP'],
    purpose: 'Finishes the cube by putting the last five edges where they belong, keeping the block, the middle layer and every corner, with the top and bottom turned to match.',
    goal: { does: 'milestones', point: ['solved'], keeps: ['block', 'belt', 'corners'], turnsTopAndBottom: true },
    provenance: 'the Mehta-OS sheet\'s L5EP page, each case drawn up to three ways (`mehta-algs.js`)',
    verified: '`mehta-algs.test.mjs`: the 45 rows answer the 16 cases',
    notGiven: NOT_GIVEN.mehta,
  },
  {
    id: 'mehta-beginner-eo', name: 'Mehta, beginner path: edges the right way round', kind: 'sourced', from: ['mehta-algs', 'MEHTA_BEGINNER'], steps: ['eo'],
    purpose: 'Turns every edge the right way round, keeping the block and the middle layer.',
    goal: { does: 'milestones', point: ['eo'], keeps: ['block', 'belt'] },
    provenance: 'the Mehta-OS sheet\'s "Beginner Mehta Algs" page, its EO step (`mehta-algs.js`)',
    verified: '`mehta-algs.test.mjs`: the step finishes every state it can meet',
    notGiven: NOT_GIVEN.mehta,
  },
  {
    id: 'mehta-beginner-dcal', name: 'Mehta, beginner path: two bottom corners', kind: 'sourced', from: ['mehta-algs', 'MEHTA_BEGINNER'], steps: ['dcal-1', 'dcal-2'],
    purpose: 'Puts the bottom back-right corner in place, then the bottom front-right corner, keeping the block, the middle layer and every edge the right way round.',
    goal: { does: 'milestones', point: ['drb', 'dfr'], keeps: ['block', 'belt', 'eo'] },
    provenance: 'the Mehta-OS sheet\'s "Beginner Mehta Algs" page, its two DCAL looks (`mehta-algs.js`)',
    verified: '`mehta-algs.test.mjs`: each look finishes every state it can meet',
    notGiven: NOT_GIVEN.mehta,
  },
  {
    id: 'mehta-beginner-cdrll', name: 'Mehta, beginner path: top corners', kind: 'sourced', from: ['mehta-algs', 'MEHTA_BEGINNER'], steps: ['cdrll-1', 'cdrll-2'],
    purpose: 'Turns every corner so the top or bottom colour faces up or down, then puts every corner where it belongs, keeping the block, the middle layer, every edge the right way round and the bottom corners.',
    goal: { does: 'milestones', point: ['co', 'cp'], keeps: ['block', 'belt', 'eo', 'bottom-corners'] },
    provenance: 'the Mehta-OS sheet\'s "Beginner Mehta Algs" page, its two CDRLL looks (`mehta-algs.js`)',
    verified: '`mehta-algs.test.mjs`: each look finishes every state it can meet',
    notGiven: NOT_GIVEN.mehta,
  },
  {
    id: 'mehta-beginner-last-edges', name: 'Mehta, beginner path: last edges', kind: 'sourced', from: ['mehta-algs', 'MEHTA_BEGINNER'], steps: ['d-edge', 'epll'],
    purpose: 'Puts the bottom-right edge in place, then finishes the cube by putting the top edges where they belong, keeping the block, the middle layer and every corner, with the top and bottom turned to match.',
    goal: { does: 'milestones', point: ['dr', 'solved'], keeps: ['block', 'belt', 'corners'], turnsTopAndBottom: true },
    provenance: 'the Mehta-OS sheet\'s "Beginner Mehta Algs" page, its last bottom edge and EPLL (`mehta-algs.js`)',
    verified: '`mehta-algs.test.mjs`: each step finishes every state it can meet',
    notGiven: NOT_GIVEN.mehta,
  },
  {
    id: 'cf-bottom-corners', name: 'Corners first: bottom corners', kind: 'sourced', from: ['corners-first-corners', 'CF_ALGS'], steps: ['bottom-corners'],
    purpose: 'Brings one bottom corner down from the top layer, keeping the other bottom corners.',
    goal: { does: 'insert', region: 'bottom-corners', pieces: 'corner', from: 'top' },
    provenance: 'Josef Jelinek\'s corners-first beginner page, its bottom-corner sequences (`corners-first-algs.js`)',
    verified: '`corners-first-algs.test.mjs`: the step finishes every position it can meet, proved by search',
    notGiven: NOT_GIVEN.cornersFirst,
  },
  {
    id: 'cf-top-corners', name: 'Corners first: top corners', kind: 'sourced', from: ['corners-first-corners', 'CF_ALGS'], steps: ['top-corners-place', 'top-corners-twist'], regions: 'corners',
    purpose: 'Moves the top corners to where they belong, then turns them so the top colour faces up, keeping the bottom corners.',
    goal: { does: 'solve', kinds: ['corner'] },
    provenance: 'Josef Jelinek\'s corners-first beginner page, its corner and twist sequences (`corners-first-algs.js`)',
    verified: '`corners-first-algs.test.mjs`: each step finishes every position it can meet, proved by search',
    notGiven: NOT_GIVEN.cornersFirst,
  },
  {
    id: 'cf-ledges', name: 'Corners first: left edges', kind: 'sourced', from: ['corners-first-edges', 'CF_ALGS'], steps: ['ledges'],
    purpose: 'Puts one edge of the left side in place, keeping every corner and the edges already placed.',
    goal: { does: 'insert', region: 'cf-ledges', pieces: 'edge' },
    provenance: 'Josef Jelinek\'s corners-first beginner page, its left-edge sequences (`corners-first-algs.js`)',
    verified: '`corners-first-algs.test.mjs`: the step finishes every position it can meet, proved by search',
    notGiven: NOT_GIVEN.cornersFirst,
  },
  {
    id: 'cf-redges', name: 'Corners first: right edges', kind: 'sourced', from: ['corners-first-edges', 'CF_ALGS'], steps: ['redges'],
    purpose: 'Puts one edge of the right side in place, keeping every corner and the edges already placed.',
    goal: { does: 'insert', region: 'cf-redges', pieces: 'edge' },
    provenance: 'Josef Jelinek\'s corners-first beginner page, its right-edge sequences (`corners-first-algs.js`)',
    verified: '`corners-first-algs.test.mjs`: the step finishes every position it can meet, proved by search',
    notGiven: NOT_GIVEN.cornersFirst,
  },
  {
    id: 'cf-last-ledge', name: 'Corners first: last left edge', kind: 'sourced', from: ['corners-first-edges', 'CF_ALGS'], steps: ['last-ledge'],
    purpose: 'Puts the last edge of the left side in place, keeping every corner and the edges already placed.',
    goal: { does: 'insert', region: 'cf-last-ledge', pieces: 'edge' },
    provenance: 'Josef Jelinek\'s corners-first beginner page, its last-left-edge sequences (`corners-first-algs.js`)',
    verified: '`corners-first-algs.test.mjs`: the step finishes every position it can meet, proved by search',
    notGiven: NOT_GIVEN.cornersFirst,
  },
  {
    id: 'cf-middle-edges', name: 'Corners first: middle edges', kind: 'sourced', from: ['corners-first-edges', 'CF_ALGS'], steps: ['midges-flip', 'midges-place'],
    purpose: 'Turns the edges of the middle slice the right way round and puts them where they belong, keeping the rest of the cube.',
    goal: { does: 'insert', region: 'every-piece', pieces: 'any' },
    provenance: 'Josef Jelinek\'s corners-first beginner page, its middle-slice sequences (`corners-first-algs.js`)',
    verified: '`corners-first-algs.test.mjs`: each step finishes every position it can meet, proved by search',
    notGiven: NOT_GIVEN.cornersFirst,
  },
  {
    id: 'f2l-full', name: 'F2L, all cases', kind: 'proved', from: ['case-tables', 'F2L_CASES'],
    purpose: PURPOSE.f2l, goal: GOAL.f2l,
    provenance: 'searched in `crates/optimal-solver`, proven minimal in the half-turn metric, certified',
    verified: '`f2l-cross-check` refutes every case by brute force with no heuristic; `case-tables.test.mjs` re-runs the generator and diffs the shipped module',
  },
  {
    id: 'oll-full', name: 'Full OLL', kind: 'proved', from: ['case-tables', 'FULL_OLL'],
    purpose: PURPOSE.oll, goal: GOAL.oll,
    provenance: 'same search; one algorithm per case so the top face is one look',
    verified: 'certified over all 1,152 (alignment, goal) pairs; same generator diff',
  },
  {
    id: 'pll-full', name: 'Full PLL', kind: 'proved', from: ['case-tables', 'FULL_PLL'],
    purpose: PURPOSE.pll, goal: GOAL.pll,
    provenance: 'same search; the 288-state goal set checked against the published Cube Explorer distribution',
    verified: 'the distribution matched Cube Explorer entry for entry, mean 11.642361; same generator diff',
  },
].map((s) => {
  const regions = s.regions ?? 'layers';
  if (!['layers', 'blocks', 'corners'].includes(regions)) throw new Error(`alg-library: ${s.id} names regions "${regions}", which no sentence knows`);
  if (s.names && s.steps) throw new Error(`alg-library: ${s.id} picks its rows both by name and by step`);
  return s;
}).map((s) => Object.freeze({
  ...s,
  ...(s.goal ? { goal: frozenGoal(s) } : {}),
  regions: s.regions ?? 'layers',
  names: s.names ? Object.freeze([...s.names]) : undefined,
  steps: s.steps ? Object.freeze([...s.steps]) : undefined,
  from: Object.freeze([...s.from]),
  notGiven: Object.freeze({
    ...(s.kind === 'hand-written' ? NOT_GIVEN.handWritten : s.kind === 'proved' ? NOT_GIVEN.proved : {}),
    ...(s.notGiven ?? {}),
  }),
})));

const SET_BY_ID = new Map(ALG_SETS.map((s) => [s.id, s]));

for (const s of ALG_SETS) {
  // A set with rows says what it is for; a named step with no moves has nothing to explain.
  if ((s.kind !== 'not an algorithm') !== Boolean(s.goal)) {
    throw new Error(`alg-library: ${s.id} ${s.goal ? 'is not an algorithm and declares a goal' : 'has rows and no purpose and goal'}`);
  }
}

/**
 * Which offered method teaches which set, at which of its registry stages. Keyed by registry id; a phase is
 * `held` (one set or several), or `intuitive` — built by understanding or by search, with nothing to memorise.
 *
 * An offered phase also says `endsAt`: the Restore stop its stage's end reaches — one of the entry's `stops`,
 * which the library pictures the stage by (dev-docs/practice-redesign-plan.md §4.3) — or null where it reaches
 * none of its own: Quick stops nowhere, and Roux's CMLL keeps both blocks and finishes nothing.
 *
 * `algorithm-ledger.test.mjs` holds this to what each method's solver actually NAMES on frozen cubes, its
 * `endsAt` to the stops that solver REACHES at each stage end, and both to the registry's entries and stages;
 * that relation is why it can be trusted here.
 */
const offered = (id, phases) => {
  const entry = REGISTRY.find((m) => m.id === id);
  if (!entry) throw new Error(`alg-library: names an offered method "${id}" that the registry does not hold`);
  for (const p of phases) {
    if (!Object.hasOwn(p, 'endsAt')) throw new Error(`alg-library: ${id}/${p.phase} declares no endsAt — a stop of ${id}'s, or null for none`);
    if (p.endsAt !== null && !entry.stops.includes(p.endsAt)) throw new Error(`alg-library: ${id}/${p.phase} ends at "${p.endsAt}", which is not one of ${id}'s stops`);
  }
  return Object.freeze({ id, method: entry.label, phases: Object.freeze(phases.map((p) => Object.freeze(p))) });
};

/** A method the app does not offer, whose sets the library still files: `id` null, so no row names it as a
 *  registry method, and a name that is not a registry label so it cannot be mistaken for one. */
const notOffered = (name, phases) => {
  if (REGISTRY.some((m) => m.label === name)) throw new Error(`alg-library: "${name}" is an offered method's label, not a method the app does not offer`);
  for (const p of phases) if (Object.hasOwn(p, 'endsAt')) throw new Error(`alg-library: ${name}/${p.phase} is not offered, so it has no stop to end at`);
  return Object.freeze({ id: null, method: name, phases: Object.freeze(phases.map((p) => Object.freeze(p))) });
};

export const METHOD_SETS = Object.freeze([
  offered('quick', [
    { phase: 'Whole cube', endsAt: null, intuitive: 'NONE. The two-phase search (`lib/two-phase.js`) answers; there is nothing to memorise' },
  ]),
  offered('beginner', [
    { stage: 'cross', phase: 'Cross', endsAt: 'cross', held: ['cross-inserts'] },
    { stage: 'pairs', phase: 'First two layers', endsAt: 'two-layers', held: ['f1l-inserts', 'middle-inserts'] },
    // The course's last layer (ADR 0009), not the app's: Beginner is rung 0 everywhere on the course's route. Its
    // first stage puts the top edges home, oriented and placed, so it ends past the top cross.
    { stage: 'oll', phase: 'Top face', endsAt: 'top-edges', held: ['course-edges'] },
    { stage: 'pll', phase: 'Last layer', endsAt: 'solved', held: ['course-corners'] },
  ]),
  // **Both CFOP entries still need the beginner inserts.** `pairsFrom` falls back to `placeSeparately` when a
  // pair is BURIED — a piece of it sitting in another slot — and that fallback is the beginner corner and edge
  // inserts. The relation test finds them named on frozen cubes, and fails if a mapped set stops appearing.
  offered('cfop-4lll', [
    { stage: 'cross', phase: 'Cross', endsAt: 'cross', intuitive: 'planned whole: an exact distance table is descended — no algorithm at all' },
    { stage: 'pairs', phase: 'First two layers', endsAt: 'two-layers', held: ['f2l-triggers', 'f1l-inserts', 'middle-inserts'] },
    { stage: 'oll', phase: 'Top face', endsAt: 'top-oriented', held: ['eoll', 'ocll'] },
    { stage: 'pll', phase: 'Last layer', endsAt: 'solved', held: ['cpll', 'epll'] },
  ]),
  offered('cfop', [
    { stage: 'cross', phase: 'Cross', endsAt: 'cross', intuitive: 'planned whole: an exact distance table is descended — no algorithm at all' },
    // The human-speed table, not the proved one: what a method costs is what it TEACHES.
    { stage: 'pairs', phase: 'First two layers', endsAt: 'two-layers', held: ['f2l-human', 'f1l-inserts', 'middle-inserts'] },
    { stage: 'oll', phase: 'Top face', endsAt: 'top-oriented', held: ['oll-human'] },
    { stage: 'pll', phase: 'Last layer', endsAt: 'solved', held: ['pll-human'] },
  ]),
  offered('roux', [
    { stage: 'first-block', phase: 'Left block', endsAt: 'first-block', intuitive: 'block building, found by search: a shipped exact distance table is descended — no table of algorithms' },
    { stage: 'second-block', phase: 'Right block', endsAt: 'both-blocks', intuitive: 'block building, found by search: a shipped exact distance table' },
    { stage: 'cmll', phase: 'Top corners', endsAt: null, held: ['cmll'] },
    { stage: 'lse', phase: 'Last six edges', endsAt: 'solved', intuitive: 'found by search with the middle slice: exact distance tables, no table of algorithms' },
  ]),
  notOffered('Mehta', [
    { phase: 'First block', intuitive: 'block building: a 1x2x3 block flat on the bottom, at the left' },
    { phase: 'Three middle edges', intuitive: 'placed by understanding, with nothing to memorise' },
    { phase: 'Last middle edge, every edge the right way round', held: ['mehta-eole'] },
    { phase: 'Corners turned', held: ['mehta-6co'] },
    { phase: 'Corners placed', held: ['mehta-6cp'] },
    { phase: 'Last five edges', held: ['mehta-l5ep'] },
  ]),
  notOffered('Mehta, beginner path', [
    { phase: 'First block', intuitive: 'block building' },
    { phase: 'Middle layer', intuitive: 'placed by understanding' },
    { phase: 'Edges the right way round', held: ['mehta-beginner-eo'] },
    { phase: 'Two bottom corners', held: ['mehta-beginner-dcal'] },
    { phase: 'Top corners', held: ['mehta-beginner-cdrll'] },
    { phase: 'Last edges', held: ['mehta-beginner-last-edges'] },
  ]),
  notOffered('Corners first', [
    { phase: 'Bottom corners', held: ['cf-bottom-corners'] },
    { phase: 'Top corners', held: ['cf-top-corners'] },
    { phase: 'Centres', intuitive: 'no sequence: turn the middle slices until the white centre is underneath again' },
    { phase: 'Left and right edges', held: ['cf-ledges', 'cf-redges', 'cf-last-ledge'] },
    { phase: 'Middle edges', held: ['cf-middle-edges'] },
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
const methodsOfSet = (setId) => Object.freeze(METHOD_SETS.filter((m) => m.id !== null).flatMap((m) => m.phases
  .filter((p) => (p.held ?? []).includes(setId))
  .map((p) => Object.freeze({ method: m.id, stage: p.stage }))));

// ---- loading the entries --------------------------------------------------------------------------------

let entriesPromise = null;

/**
 * Every set's source entries, `Map(setId -> frozen entries)`, the method modules imported on first call. A
 * name a set picks that its source no longer holds is refused here, loudly — never a set that quietly shrank.
 *
 * A LOAD THAT FAILED IS NOT KEPT. A module fetch that did not arrive once is said to every caller already
 * waiting, and the next call loads again — never the same failure handed out for the life of the thread.
 */
export function loadEntries() {
  if (entriesPromise) return entriesPromise;
  const loading = (async () => {
    const modules = Object.fromEntries(await Promise.all(Object.entries(ALG_SOURCES)
      .map(async ([id, src]) => [id, await src.load()])));
    const out = new Map();
    for (const set of ALG_SETS) {
      const [sourceId, exported] = set.from;
      const list = modules[sourceId]?.[exported];
      if (!Array.isArray(list)) throw new Error(`alg-library: ${set.id} reads ${exported} from ${sourceId}, which does not export it`);
      let entries;
      if (set.names) {
        entries = set.names.map((n) => {
          const hit = list.find((a) => a.name === n);
          if (!hit) throw new Error(`alg-library: ${set.id} names an algorithm "${n}" that ${sourceId} no longer holds`);
          return hit;
        });
      } else if (set.steps) {
        for (const step of set.steps) {
          if (!list.some((a) => a.step === step)) throw new Error(`alg-library: ${set.id} names a step "${step}" that ${sourceId}'s ${exported} holds no row of`);
        }
        entries = list.filter((a) => set.steps.includes(a.step));
      } else {
        entries = [...list];
      }
      out.set(set.id, Object.freeze(entries));
    }
    return out;
  })();
  entriesPromise = loading;
  loading.catch(() => { if (entriesPromise === loading) entriesPromise = null; });
  return loading;
}

/** Sets with rows: every one but the named steps that are not algorithms. */
const ROW_SETS = ALG_SETS.filter((s) => s.kind !== 'not an algorithm');

let indexPromise = null;

/** `id -> { set, entry }`, and a map from each move string (normalised) to the ids that hold it. Built from
 *  strings only — no cube is turned — so it costs microseconds once the entries are in. Like the entries, an
 *  index that failed is not kept. */
function loadIndex() {
  if (indexPromise) return indexPromise;
  const building = loadEntries().then((entries) => {
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
  indexPromise = building;
  building.catch(() => { if (indexPromise === building) indexPromise = null; });
  return building;
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

/** The hold whose letters are the cube's own at the start: the frame a smart cube's reports are named in. */
const LETTERS_HOLD = Object.freeze(['U', 'F']);

/**
 * The moves that are not one turn of one face, and what a smart cube reports for each. A smart cube reports
 * turns of its six faces against its own core, so: a whole-cube turn reports NOTHING; a slice reports the TWO
 * faces either side of it (and the cube is then held differently); a wide turn reports ONE face, the one
 * opposite the side it names.
 *
 * NAMED BY THE CUBE'S OWN FACES — the letters' faces at the start — because that is what the cube sends. A
 * rotation, slice or wide turn earlier in the algorithm has turned the hold, so the child's `M` after a `y` is
 * a slice of the cube's front and back, and reports `F'` and `B`. `run`, the one interpreter, tracks the hold
 * and gives each move in the starting frame (`drawn`); `faceTurnsOf` decomposes that move.
 * `[{ at, token, kind, reports }]`, `reports` the face turns the cube would send.
 */
export function observableOf(alg) {
  const moves = movesIn(alg);
  const { drawn } = run(moves, LETTERS_HOLD, SOLVED);
  return Object.freeze(moves.flatMap((m, at) => {
    if (m.kind === 'face') return [];
    const reports = faceTurnsOf(readToken(drawn[at]).move).turns.map((x) => x.name).filter(Boolean);
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
//
// A row's `says` is about what the algorithm is FOR, not everything it does. Its set's `goal` splits the pieces
// it changes into its POINT and what it disturbs on the way (the full account stays in `effect`):
//   * a step before the last layer (`does: 'insert'`): the point is what the stage has BUILT that the case has
//     wrong (`REGION_PIECES[goal.region]`) — never the top layer, and never a piece the stage has not built
//     yet, which it may move freely. "Puts the bottom front-right corner in place; keeps the rest of the first
//     layer; also moves the top layer and the front-right edge."
//   * a last-layer step: the point is the top layer — which way its `kinds` face, where they go, or both — and
//     the sentence says what it keeps. "Swaps two side-by-side top corners, and swaps two opposite top edges;
//     keeps the first two layers."
// Every clause is a fact `alg-ledger.test.mjs` reads back and re-derives with cubejs; a row the rules cannot
// describe is refused here, so the ledger lists it as a gap instead of printing a sentence nobody designed.

const NUMBER = Object.freeze(['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']);
const count = (n) => t(NUMBER[n] ?? String(n));
/** A counted noun: the form chosen by the language (`plural`), the number spelled out. */
const counted = (n, one, other) => plural(n, { one, other }, count(n));

const isTop = (position) => position.startsWith('U');
const kindOf = (position) => (position.length === 3 ? 'corner' : 'edge');
const letters = (position) => [...position].sort().join('');

/** The pieces a stage has built, by position in the letters' frame (D the bottom, the white side). */
const REGION_PIECES = (() => {
  const cross = ['DR', 'DF', 'DL', 'DB'];
  const firstLayer = [...cross, 'DFR', 'DLF', 'DBL', 'DRB'];
  return Object.freeze({
    cross: Object.freeze(cross),
    'first-layer': Object.freeze(firstLayer),
    'first-two-layers': Object.freeze([...firstLayer, 'FR', 'FL', 'BL', 'BR']),
    // Corners first: the bottom corners (white down), then — every corner done — the edges, white on L.
    'bottom-corners': Object.freeze(['DFR', 'DLF', 'DBL', 'DRB']),
    'cf-ledges': Object.freeze([...CORNERS, 'UL', 'FL', 'BL', 'DL']),
    'cf-redges': Object.freeze([...CORNERS, 'FL', 'BL', 'DL', 'UR', 'FR', 'BR', 'DR']),
    'cf-last-ledge': Object.freeze([...CORNERS, 'UL', 'FL', 'BL', 'DL', 'UR', 'FR', 'BR', 'DR']),
    'every-piece': Object.freeze([...CORNERS, ...EDGES]),
  });
})();

/** The built regions that hold every corner: whatever else such a step moves is an edge. */
const CORNERS_BUILT = new Set(['cf-ledges', 'cf-redges', 'cf-last-ledge', 'every-piece']);

/** The six edges Roux solves last — the four on top and the two in the bottom of the middle slice. CMLL may
 *  move them, because nothing is built there yet. */
const LAST_SIX_EDGES = Object.freeze(['UR', 'UF', 'UL', 'UB', 'DF', 'DB']);

const SIDE = Object.freeze({ U: 'top', D: 'bottom', F: 'front', B: 'back', R: 'right', L: 'left' });
const OPPOSITE = Object.freeze({ F: 'B', B: 'F', R: 'L', L: 'R' });

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

/** A slot by its middle edge, `FR` -> "front-right". */
const slotWords = (edge) => {
  const ordered = [...edge].sort((a, b) => 'FBRL'.indexOf(a) - 'FBRL'.indexOf(b));
  return `${SIDE[ordered[0]]}-${SIDE[ordered[1]]}`;
};

/** Two top positions of one kind are side by side when they share a side face; otherwise they are opposite
 *  (corners diagonally, edges straight across). */
const sideBySide = (a, b) => {
  const x = [...a].filter((c) => c !== 'U');
  const y = [...b].filter((c) => c !== 'U');
  return x.length === 2 ? x.some((c) => y.includes(c)) : OPPOSITE[x[0]] !== y[0];
};

/** Every position the algorithm changes, and where the piece that ENDS there sits in the case. The case is the
 *  algorithm undone on a solved cube, so a piece the algorithm carries from a to b sits at a in the case. In
 *  `CORNERS` then `EDGES` order, so one effect has one sentence. */
function changed(effect) {
  const out = [];
  for (const c of [...effect.cornerCycles, ...effect.edgeCycles]) {
    const n = c.positions.length;
    c.positions.forEach((p, i) => out.push({ position: p, from: c.positions[(i + n - 1) % n], kind: kindOf(p) }));
  }
  for (const p of [...effect.twistedInPlace, ...effect.flippedInPlace]) {
    out.push({ position: p.position, from: p.position, kind: kindOf(p.position) });
  }
  const rank = (p) => (p.kind === 'corner' ? CORNERS.indexOf(p.position) : 8 + EDGES.indexOf(p.position));
  return out.sort((a, b) => rank(a) - rank(b));
}

/** The case's top face, facelet index -> position, as `facelets` is laid out (0-8 the top, row 0 at the back). */
const TOP_FACELETS = Object.freeze({
  corner: Object.freeze([[0, 'ULB'], [2, 'UBR'], [6, 'UFL'], [8, 'URF']]),
  edge: Object.freeze([[1, 'UB'], [3, 'UL'], [5, 'UR'], [7, 'UF']]),
});

/** The top pieces of one kind whose top sticker is NOT the top colour in the case: what the row turns up. */
const notUp = (facelets, kind) => TOP_FACELETS[kind].filter(([i]) => facelets[i] !== facelets[4]).map(([, p]) => p);

/** Whole sentences for where top pieces go, one per shape, so a translator sees each. */
const PLACE_WORDS = Object.freeze({
  corner: Object.freeze({
    near: 'swaps two side-by-side top corners',
    far: 'swaps two diagonally opposite top corners',
    pairsNear: 'swaps two pairs of side-by-side top corners',
    pairsFar: 'swaps two pairs of diagonally opposite top corners',
    3: 'moves three top corners round',
    4: 'moves all four top corners round',
  }),
  edge: Object.freeze({
    near: 'swaps two side-by-side top edges',
    far: 'swaps two opposite top edges',
    pairsNear: 'swaps two pairs of side-by-side top edges',
    pairsFar: 'swaps two pairs of opposite top edges',
    3: 'moves three top edges round',
    4: 'moves all four top edges round',
  }),
});

/**
 * Where the top pieces of one kind go, as clauses. Four positions allow exactly four shapes — one swap, two
 * swaps, a three-cycle, a four-cycle — and each has its words, so nothing falls back to a bare count. A swap
 * says whether its two pieces are side by side or opposite, which is what tells a learner which case it is.
 */
function placeClauses(cycles, kind) {
  if (!cycles.every((c) => c.positions.every(isTop))) {
    throw new Error(`alg-library: a ${kind} cycle leaves the top layer, which a last-layer sentence cannot place`);
  }
  const words = PLACE_WORDS[kind];
  const swap = (c) => (sideBySide(...c.positions) ? words.near : words.far);
  if (cycles.length === 2 && cycles.every((c) => c.positions.length === 2)) {
    return [t(sideBySide(...cycles[0].positions) ? words.pairsNear : words.pairsFar)];
  }
  return cycles.map((c) => t(c.positions.length === 2 ? swap(c) : words[c.positions.length]));
}

/** "a, b and c". */
const listed = (parts) => (parts.length <= 1 ? parts.join('') : t('%1 and %2', parts.slice(0, -1).join(', '), parts.at(-1)));

const capitalised = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** What a step before the last layer is for, keyed by the region its stage has built. */
const PUT_IN_PLACE = Object.freeze({
  cross: 'Puts %1 in place; keeps the other cross edges',
  'first-layer': 'Puts %1 in place; keeps the rest of the first layer',
  'first-two-layers': 'Puts %1 in place; keeps the rest of the first two layers',
  'bottom-corners': 'Puts %1 in place; keeps the other bottom corners',
  'cf-ledges': 'Puts %1 in place; keeps every corner and the edges already placed',
  'cf-redges': 'Puts %1 in place; keeps every corner and the edges already placed',
  'cf-last-ledge': 'Puts %1 in place; keeps every corner and the edges already placed',
  'every-piece': 'Puts %1 in place; keeps the rest of the cube',
});
/** The same, for a point whose every piece is only turned in its own slot. A region with no entry here never
 *  says it. */
const TURN_IN_PLACE = Object.freeze({
  'cf-ledges': 'Turns %1 the right way round; keeps every corner and the edges already placed',
  'cf-redges': 'Turns %1 the right way round; keeps every corner and the edges already placed',
  'cf-last-ledge': 'Turns %1 the right way round; keeps every corner and the edges already placed',
  'every-piece': 'Turns %1 the right way round; keeps the rest of the cube',
});
const PUT_IN_SLOT = 'Puts the %1 corner and edge into their slot; keeps the rest of the first two layers';

/** Pieces outside the built region that are not in the top layer, as the words "also moves" lists them. */
const NOT_BUILT = Object.freeze([
  Object.freeze({ is: (p) => p.kind === 'corner', one: '%1 bottom corner', other: '%1 bottom corners' }),
  Object.freeze({ is: (p) => p.kind === 'edge' && p.position.startsWith('D'), one: '%1 bottom edge', other: '%1 bottom edges' }),
  Object.freeze({ is: (p) => p.kind === 'edge' && !p.position.startsWith('D'), one: '%1 middle edge', other: '%1 middle edges' }),
]);

function insertSentence(effect, goal) {
  const all = changed(effect);
  const scope = REGION_PIECES[goal.region];
  const point = all.filter((p) => scope.includes(p.position));
  if (!point.length) throw new Error(`alg-library: changes nothing in ${goal.region}, so a sentence has no point to name`);
  const [corner, edge] = [point.find((p) => p.kind === 'corner'), point.find((p) => p.kind === 'edge')];
  const slot = point.length === 2 && corner && edge && letters(corner.position.replace('D', '')) === letters(edge.position);
  const turned = Boolean(TURN_IN_PLACE[goal.region]) && point.every((p) => p.from === p.position);
  let sentence = slot
    ? t(PUT_IN_SLOT, slotWords(edge.position))
    : t((turned ? TURN_IN_PLACE : PUT_IN_PLACE)[goal.region], listed(point.map((p) => positionWords(p.position))));
  const rest = all.filter((p) => !scope.includes(p.position));
  const parts = [];
  if (CORNERS_BUILT.has(goal.region)) {
    // Every corner is built, so everything outside the region is an edge.
    if (rest.length === 1) parts.push(positionWords(rest[0].position));
    else if (rest.length > 1) parts.push(counted(rest.length, '%1 other edge', '%1 other edges'));
  } else {
    if (rest.some((p) => isTop(p.position))) parts.push(t('the top layer'));
    for (const group of NOT_BUILT) {
      const these = rest.filter((p) => !isTop(p.position) && group.is(p));
      if (these.length === 1) parts.push(positionWords(these[0].position));
      else if (these.length > 1) parts.push(counted(these.length, group.one, group.other));
    }
  }
  if (parts.length) sentence = t('%1; also moves %2', sentence, listed(parts));
  return sentence;
}

const KEEPS = Object.freeze({ layers: '%1; keeps the first two layers', blocks: '%1; keeps both blocks', corners: '%1; keeps the bottom corners' });
const KEPT_REGION = Object.freeze({ layers: 'first-two-layers', blocks: 'both-blocks', corners: 'bottom-corners' });
const COME_BACK = '%1; mixes the first two layers, which come back once the other top corners are turned up too';

/**
 * Whether a row that breaks the first two layers does so only on the way: it twists ONE top corner in place
 * and moves nothing else on top, and three of it are nothing at all. Then the first two layers come back
 * exactly when the twists it has given the top corners add up to whole turns — which they do once every top
 * corner faces up, because a cube's corner twists always add up to whole turns. The course teaches its corner
 * twist this way (lesson 9's four moves, done twice or four times).
 */
const twistsOnTheWay = (top, order) => order === 3 && top.length === 1
  && top[0].kind === 'corner' && top[0].from === top[0].position;

function lastLayerSentence(effect, facelets, goal, regions, keeps, order) {
  // The top face is read in the hold the learner starts in, which is the letters' hold only while it is kept.
  if (!effect.keepsHold) throw new Error('alg-library: a last-layer row that turns the whole cube has no top face to read');
  const all = changed(effect);
  const top = all.filter((p) => isTop(p.position));
  const below = all.filter((p) => !isTop(p.position));
  const orients = goal.does === 'orient' || goal.does === 'solve';
  const places = goal.does === 'permute' || goal.does === 'solve';
  const orientItems = [];
  const placeItems = [];
  const besides = [];
  const sitsElsewhere = [];
  for (const kind of ['corner', 'edge']) {
    const cycles = kind === 'corner' ? effect.cornerCycles : effect.edgeCycles;
    const down = notUp(facelets, kind);
    const focused = goal.kinds.includes(kind);
    if (!focused && regions === 'blocks' && kind === 'edge') {
      // Roux has built nothing among these edges yet: the incidental part is said as the step that solves them.
      if (all.some((p) => p.kind === 'edge')) besides.push(t('some of the six edges left for last'));
      continue;
    }
    if (!focused && regions === 'corners' && kind === 'edge') {
      // Corners first places no edge until every corner is done: any edge it moves is left for later.
      if (all.some((p) => p.kind === 'edge')) besides.push(t('some of the edges left for later'));
      continue;
    }
    if (focused && orients) {
      if (down.length) orientItems.push(down.length === 1 ? positionWords(down[0]) : counted(down.length, `%1 top ${kind}`, `%1 top ${kind}s`));
    } else if (down.length) {
      if (focused) throw new Error(`alg-library: its case has top ${kind}s facing the wrong way, which a "${goal.does}" goal does not describe`);
      // Not the point, and turned as well as (perhaps) moved: said as the pieces themselves.
      besides.push(t(kind === 'corner' ? 'the top corners' : 'the top edges'));
      continue;
    }
    if (focused && places) placeItems.push(...placeClauses(cycles, kind));
    // Only cycles ON TOP: a row that mixes the layers below says so in its own clause.
    else if (cycles.some((c) => c.positions.some(isTop))) sitsElsewhere.push(kind);
  }
  // Moved but not the point, and every one still facing up: only WHERE they sit changes.
  if (sitsElsewhere.length === 2) besides.push(t('where the top pieces sit'));
  else if (sitsElsewhere.length === 1) besides.push(t(sitsElsewhere[0] === 'corner' ? 'where the top corners sit' : 'where the top edges sit'));
  if (goal.does === 'orient' && !orientItems.length) throw new Error('alg-library: an orientation row whose case has every top piece facing up');
  if (goal.does === 'permute' && !placeItems.length) throw new Error('alg-library: a permutation row that moves no top piece');
  if (!orientItems.length && !placeItems.length) throw new Error('alg-library: changes nothing its goal is about');
  const turns = orientItems.length ? t('turns %1 so the top colour faces up', listed(orientItems)) : '';
  const point = capitalised(turns && placeItems.length ? t('%1, and %2', turns, listed(placeItems)) : turns || listed(placeItems));
  let sentence;
  if (keeps.includes(KEPT_REGION[regions])) {
    const strays = below.filter((p) => !(regions === 'blocks' && LAST_SIX_EDGES.includes(p.position))
      && !(regions === 'corners' && p.kind === 'edge'));
    if (strays.length) throw new Error(`alg-library: keeps ${KEPT_REGION[regions]} and moves ${strays.map((p) => p.position).join(' ')}`);
    sentence = t(KEEPS[regions], point);
  } else if (regions === 'layers' && twistsOnTheWay(top, order)) {
    sentence = t(COME_BACK, point);
  } else {
    throw new Error(`alg-library: a last-layer row that breaks ${KEPT_REGION[regions]} for good`);
  }
  if (besides.length) sentence = t('%1; also changes %2', sentence, listed(besides));
  return sentence;
}

/** The finishing turn, said after the body: a whole clause per kind, so a translator sees each. */
const FINISH = Object.freeze({
  bottom: '%1; with %2 after it to line up the bottom',
  middle: '%1; with %2 after it to line up the middle centres',
});

/** The 16 turns of the top and bottom, `U^a D^d`, as piece states: what the Mehta sheet aligns a case by. */
const ALIGNMENTS = Object.freeze(['', 'U', 'U2', "U'"].flatMap((u) => ['', 'D', 'D2', "D'"]
  .map((d) => Object.freeze(applyAlg(SOLVED, `${u} ${d}`.trim())))));

/**
 * A Mehta step's sentence, from the case before the algorithm: which of its goal's milestones the case does
 * not have under ANY turn of the top and bottom that shows what it keeps (its point), what it keeps, and
 * which other pieces it changes. No position word: 53 rows draw their case with the bottom turned.
 */
function milestoneSentence(caseState, goal) {
  const aligned = ALIGNMENTS.map((a) => compose(caseState, a));
  const A = aligned.filter((s) => goal.keeps.every((id) => reached(id, s)));
  if (!A.length) throw new Error(`alg-library: no turn of the top and bottom gives the case ${goal.keeps.join(', ')}`);
  const point = goal.point.filter((id) => A.every((s) => !reached(id, s)));
  if (!point.length) throw new Error('alg-library: changes nothing its goal is about');
  const clauses = [capitalised(listed(point.map((id) => t(MILESTONES[id].point))))];
  const keepWords = listed(goal.keeps.map((id) => t(MILESTONES[id].keep)));
  clauses.push(goal.turnsTopAndBottom ? t('keeps %1 once the top and bottom are lined up', keepWords) : t('keeps %1', keepWords));
  const named = new Set([...goal.keeps, ...goal.point]);
  const covered = [...named].filter((id) => MILESTONES[id].positional);
  const freeCorners = ALL_CORNER_SLOTS.filter((i) => !covered.some((id) => MILESTONES[id].corners.includes(i)));
  const freeEdges = ALL_EDGE_SLOTS.filter((i) => !covered.some((id) => MILESTONES[id].edges.includes(i)));
  const any = (...ids) => ids.some((id) => named.has(id));
  const items = [];
  if (!any('co', 'corners', 'solved') && freeCorners.some((i) => caseState.co[i] !== 0)) items.push(t('which way some corners face'));
  if (!any('cp', 'corners', 'solved') && A.every((s) => freeCorners.some((i) => s.cp[i] !== i))) items.push(t('where some corners sit'));
  if (!any('eo', 'solved') && freeEdges.some((i) => caseState.eo[i] !== 0)) items.push(t('which way some edges face'));
  if (!any('solved') && A.every((s) => freeEdges.some((i) => s.ep[i] !== i))) items.push(t('where some edges sit'));
  if (items.length) clauses.push(t('also changes %1', listed(items)));
  return clauses.join('; ');
}

/**
 * ONE sentence: what the algorithm does toward its set's goal, generated from the computed `effect`, `keeps`,
 * `order` and case — never typed. Each fragment goes through `t()`; whole clauses are templates, so a
 * translator sees "keeps the rest of the first layer" rather than "keeps" and a region glued on.
 */
export function saysOf({ effect, keeps, order, facelets, goal, regions = 'layers', finish = '', caseState }) {
  let body;
  if (goal.does === 'insert') body = insertSentence(effect, goal);
  else if (goal.does === 'milestones') body = milestoneSentence(caseState, goal);
  else body = lastLayerSentence(effect, facelets, goal, regions, keeps, order);
  if (finish) body = t(finish.startsWith('D') ? FINISH.bottom : FINISH.middle, body, finish);
  return `${effect.keepsHold ? body : t('%1; ends with the cube held differently', body)}.`;
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
  const src = ALG_SOURCES[set.from[0]];
  const key = src.citeAs(entry);
  const citation = src.citations[key];
  if (!citation) throw new Error(`alg-library: ${entry.name} names a source "${key}" its data file does not list`);
  return cite(citation);
}

const sameHold = (a, b) => a[0] === b[0] && a[1] === b[1];

/**
 * The turn that finishes a row after its algorithm, or ''. Mehta's sheet writes it as "(D)" at the end of a
 * cell (`bottom` is its inverse); a corners-first edge step leaves the middle slice loose, and the one turn of
 * it that puts the centres back is derived here. Every measured column describes the algorithm and this turn.
 */
function finishOf(src, entry) {
  if (src.finish === 'bottom') return entry.bottom ? invert(entry.bottom) : '';
  if (src.finish === 'middle-slice') {
    const f = ['', 'M', 'M2', "M'"].find((x) => sameHold(run(`${entry.alg} ${x}`.trim(), LETTERS_HOLD, SOLVED).hold, LETTERS_HOLD));
    if (f === undefined) throw new Error(`alg-library: ${entry.name} leaves the centres where no turn of the middle slice puts them back`);
    return f;
  }
  return '';
}

/** Everything about one row; the expensive columns are computed here, once per id. */
function buildRow(id, { byId, byMoves }) {
  const { set, entry } = byId.get(id);
  const { alg } = entry;
  const src = ALG_SOURCES[set.from[0]];
  const { hold } = src;
  // The measured columns describe the algorithm FOLLOWED BY its finishing turn, when the source has one.
  const finish = finishOf(src, entry);
  const whole = finish ? `${alg} ${finish}` : alg;
  // Read from the hold the letters are written in, so `endHold` names the hold the learner ends in — the
  // declared one whenever the algorithm keeps it. The piece fields are the same from any hold.
  const effect = effectOf(whole, { hold });
  const { facelets, viewHold } = caseOf(whole, hold);
  const caseState = run(invert(whole), LETTERS_HOLD, SOLVED).state;
  const keepsF2L = effect.keeps.includes('first-two-layers');
  const picture = !keepsF2L ? 'net' : set.goal.does === 'orient' ? 'top-orientation' : 'top-colours';
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
      case: src.ignoresCase ? null : entry.case ?? (set.kind === 'proved' ? entry.name : null),
      facelets,
      viewHold,
      picture,
      finish,
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
    purpose: t(set.purpose),
    says: saysOf({ effect, keeps: effect.keeps, order: effect.order, facelets, goal: set.goal, regions: set.regions, finish, caseState }),
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
  const m = methodId === null ? undefined : METHOD_SETS.find((x) => x.id === methodId);
  if (!m) throw new Error(`alg-library: no offered method "${methodId}"`);
  const sets = [...new Set(m.phases.flatMap((p) => p.held ?? []))];
  return Object.freeze((await Promise.all(sets.map(setRows))).flat());
}

/** The set definition for an id, or undefined. */
export const algSet = (setId) => SET_BY_ID.get(setId);
