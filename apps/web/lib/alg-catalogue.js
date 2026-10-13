// Every algorithm this repository holds, as one list of computed facts.
//
// dev-docs/algorithm-drills-plan.md item 2.1. Not a second copy of the tables: every entry is DERIVED
// at load from `lib/methods/*.js`, `lib/data/human-algs.js` (the speedcubing community's sheets, each
// row naming its source) and `lib/data/case-tables.js` (the proved fewest-turn answers), so an
// algorithm cannot be in the catalogue and not in the app.
//
// THE COUNT IS DERIVED, never written — and not written in this comment either, because the test
// that holds the total greps this file for it rather than stripping comments first (the repository's
// own warning about `//` inside a string is why no stripper is used). What it comes out at is the
// distinct sequences of all three pools, less the ones that are the same move string in more than
// one. `alg-catalogue.test.mjs` asserts the number.
//
// PROVENANCE IS A COLLECTION. Sune, antisune and pi are each at once a hand-written stage algorithm, a
// community sheet's row and the proven-minimal answer to a generated case. A singular `taught | proved`
// field cannot represent that, and would silently drop all but one — which is the acceptance criterion
// for this item, so the type has to be able to express it.
//
// TWO ENTRIES ARE NOT ALGORITHMS AND ARE EXCLUDED. `align` (turning the top until it lines up) and
// `turn` (bringing a slot to the front) both carry an empty `alg`: they are parts a step can name so
// that a step's parts add up to its algorithm. Drilling one would be drilling nothing. The plan names
// `align`; `turn` is the same case and is excluded on the same grounds.
//
// THREE FRAMES, AND THEY ARE NOT THE SAME THING (ADR 0003, ADR 0004). Each entry carries all three
// so that no caller has to convert and none can convert differently:
//
//   alg      as the repertoire writes it — a METHOD-FRAME string, which is what the stage engine and
//            the method solver are fed
//   scanAlg  the same sequence in the CUBE's frame, which is the frame a smart cube reports in and
//            therefore the only frame a track may be built in
//   shown    the same sequence again, renamed into the HOLD this stage is built in — what a child
//            reads off the screen
//
// For every tumbled stage `shown` and `alg` are identical, which is why a drilled Sune reads
// `R U R' U R U2 R'`. For the two WHITE-UP stages they differ, and the hold wins: a child building
// the first layer with white on top turns `R D R'`, not `R U R'`, and ADR 0003 is what decides that.
// The plan's prose said "shown as written" on the strength of the Sune case; the rule is uniform
// ("renamed into the stage's hold") and agrees with it everywhere except cross and first layer.
import { F2L_CASES, FULL_OLL, FULL_PLL } from './data/case-tables.js';
import { HUMAN_F2L, HUMAN_OLL, HUMAN_PLL } from './data/human-algs.js';
import { CROSS_ALGS } from './methods/cross.js';
import { LAST_LAYER_EXTRAS, OLL_ALGS, PLL_ALGS, topFaceOriented } from './methods/last-layer.js';
import { AUF, firstTwoLayers, wholeCubeSolved } from './methods/engine.js';
import { PAIRS_ALGS, PAIRS_EXTRAS } from './methods/pairs.js';
import { SOLVED, invert, movesOf, toFacelets } from './cube-pieces.js';
import { faceTurnsAlg, run } from './cube-moves.js';
import { METHOD_FRAME, METHOD_TO_SCAN, SCAN_HOLD, holdForStage, holdSpec, renameAlg, showMove } from './solving-hold.js';
import { DIAL_OF } from './method-lesson.js';
import { describeEffect, effectOf } from './alg-effect.js';

/** The repertoires, by the name each entry is filed under. Picking BY NAME rather than by index, as
 *  `bench/algorithm-ledger.mjs` does and for its reason: a reordering inside a repertoire must not
 *  silently change which stage an algorithm belongs to. */
const pick = (list, names) => names.map((n) => {
  const hit = list.find((a) => a.name === n);
  if (!hit) throw new Error(`alg-catalogue: names an algorithm "${n}" that no repertoire holds any more`);
  return hit;
});

/**
 * The sets, each with the fine-grained stage its algorithms are performed at.
 *
 * The stage is what supplies the hold, so the PAIRS dial is three stages here and not one: the
 * first-layer inserts are built white up, the middle-layer inserts and the F2L cases after the
 * tumble. One label over both would be a third name for two different grips.
 */
const SETS = Object.freeze([
  { id: 'cross-inserts', stage: 'cross', entries: CROSS_ALGS },
  { id: 'f1l-inserts', stage: 'first-layer', entries: pick(PAIRS_ALGS, ['right-hand', 'left-hand', 'facing-up']) },
  { id: 'middle-inserts', stage: 'middle-layer', entries: pick(PAIRS_ALGS, ['insert-right', 'insert-left']) },
  { id: 'f2l-triggers', stage: 'f2l', entries: pick(PAIRS_ALGS, ['right', 'right-back', 'right-half', 'left', 'left-back', 'left-half']) },
  { id: 'eoll', stage: 'top-cross', entries: pick(OLL_ALGS, ['edge-orient']) },
  { id: 'ocll', stage: 'top-face', entries: pick(OLL_ALGS, ['sune', 'antisune', 'headlights', 'double-sune', 'pi']) },
  { id: 'cpll', stage: 'top-corners', entries: pick(PLL_ALGS, ['corner-cycle', 'corner-cycle-back', 'diagonal']) },
  { id: 'epll', stage: 'top-edges', entries: pick(PLL_ALGS, ['u-perm-a', 'u-perm-b']) },
  // THE ONE-LOOK SETS COME TWICE, and the order is the owner's (2026-10-13): the algorithm speedcubers
  // learn first, the proved fewest-turn one second. The human sets are what the lessons teach
  // (`lib/methods/`); the proved sets are taught by nothing and are here so a learner can see a case done
  // in fewer turns. Human before proved, so where the two are the same sequence — Sune is both — the
  // entry is filed under the name a learner would look for.
  { id: 'f2l-human', stage: 'f2l', entries: HUMAN_F2L },
  { id: 'oll-human', stage: 'top-face', entries: HUMAN_OLL },
  // One-look PLL permutes corners AND edges, and the method solver emits it as one step. Filed under
  // `top-corners` because the two last-layer permutation stages share a hold and a dial, so the
  // choice changes nothing a caller can observe — said here so it is a decision rather than an
  // accident somebody later "fixes" in the other direction.
  { id: 'pll-human', stage: 'top-corners', entries: HUMAN_PLL },
  { id: 'f2l-full', stage: 'f2l', entries: F2L_CASES },
  { id: 'oll-full', stage: 'top-face', entries: FULL_OLL },
  { id: 'pll-full', stage: 'top-corners', entries: FULL_PLL },
]);

/** Each set's algorithms, by set id — THE one statement of which algorithm is in which set. The ledger
 *  (`bench/algorithm-ledger.mjs`) reads its sets from here rather than picking them again by name. */
export const SET_ENTRIES = Object.freeze(Object.fromEntries(SETS.map((s) => [s.id, s.entries])));

/** The proved fewest-turn sets: taught by no rung, and shown SECOND — after the human set for the same
 *  cases. An entry that belongs to one of these and to nothing else is an ALTERNATIVE (`primary: false`). */
const PROVED_SETS = Object.freeze(new Set(['f2l-full', 'oll-full', 'pll-full']));

/** Which sets each rung of each dial actually needs, mirroring `bench/algorithm-ledger.mjs`'s
 *  `METHODS` table for the app's own method. The F2L rungs KEEP the beginner inserts: `pairsFrom`
 *  falls back to `placeSeparately` for a buried pair, and that fallback is those inserts — the
 *  ledger measured it, and a rung scope that dropped them would hide algorithms the learner still
 *  meets. The ledger's own ladder READS this table (`RUNG_TABLE`), so the two are one statement, and
 *  `alg-catalogue.test.mjs` holds the scopes it gives against the ledger's published totals. */
const RUNG_SETS = Object.freeze({
  // Rung 1 of the cross is an exact distance table descended move by move — no algorithms at all.
  cross: Object.freeze([Object.freeze(['cross-inserts']), Object.freeze([])]),
  pairs: Object.freeze([
    Object.freeze(['f1l-inserts', 'middle-inserts']),
    Object.freeze(['f2l-triggers', 'f1l-inserts', 'middle-inserts']),
    Object.freeze(['f2l-human', 'f1l-inserts', 'middle-inserts']),
  ]),
  oll: Object.freeze([Object.freeze(['eoll', 'ocll']), Object.freeze(['oll-human'])]),
  pll: Object.freeze([Object.freeze(['cpll', 'epll']), Object.freeze(['pll-human'])]),
});

/** The rung keys (`dial:rung`) that need a given set. Derived, so adding a rung to `RUNG_SETS` is the
 *  only edit a new rung needs. */
function rungsUsing(setId) {
  const out = [];
  for (const [dial, rungs] of Object.entries(RUNG_SETS)) {
    rungs.forEach((sets, rung) => { if (sets.includes(setId)) out.push(`${dial}:${rung}`); });
  }
  return out;
}

/** One algorithm's computed facts, the first time a set files it. Built once at load, each entry costing
 *  one order computation, which is bounded at 72 repetitions over this catalogue. */
function newEntry(set, entry, caseId) {
  const hold = holdForStage(set.stage);
  const scanAlg = renameAlg(entry.alg, METHOD_TO_SCAN);
  const effect = effectOf(entry.alg);
  return {
    id: entry.name,
    stage: set.stage,
    dial: DIAL_OF[set.stage],
    hold: holdSpec(hold),
    frame: holdSpec(METHOD_FRAME),
    alg: entry.alg,
    scanAlg,
    shown: movesOf(scanAlg).map((m) => showMove(m, hold)).join(' '),
    // How many turns of a face it is, a slice counting two and a turn of the whole cube none — the
    // count the lessons give, and the one "fewer turns" compares.
    turns: movesOf(faceTurnsAlg(run(scanAlg, SCAN_HOLD, SOLVED).drawn)).length,
    // The case this algorithm answers, in the CUBE's frame: solved, then the sequence undone. Used by the
    // library's picture AND, since 2026-09-29, as the arrangement a drill's set-up phase builds — the page
    // prints the turns that reach it and `drill-attempt.js` tracks them, so it is no longer demo-only.
    // THROUGH THE INTERPRETER, because a human-speed set-up is full of slices and wide turns that the
    // piece model's `applyAlg` does not read. Every algorithm here ends held as it began
    // (`human-algs.test.mjs`), so the arrangement is the case whichever way the cube went in between.
    setup: toFacelets(run(invert(scanAlg), SCAN_HOLD, SOLVED).state),
    // The proved case this answers — a key into `case-tables.js` — for the one-look sets; null for
    // the hand-written ones, which answer a stage rather than a numbered case.
    caseId,
    provenance: [{ set: set.id, name: entry.name }],
    effect,
    label: describeEffect(effect, entry.name).label,
  };
}

/**
 * A second set files a sequence already held: record where it came from.
 *
 * A SHARED SEQUENCE KEEPS ITS CASE. `F' U F` is a hand-written trigger AND the proved answer to an F2L case;
 * filed under the trigger first, it would lose the case it answers and its human-speed sibling would have
 * nothing to compare with. One sequence answering two different cases would be two claims about one cube,
 * and is refused.
 */
function fileAgain(found, set, entry, caseId) {
  found.provenance.push({ set: set.id, name: entry.name });
  if (caseId && found.caseId && found.caseId !== caseId) {
    throw new Error(`alg-catalogue: "${entry.alg}" is filed as case ${found.caseId} and as case ${caseId}`);
  }
  found.caseId ??= caseId;
}

/** What only the whole provenance decides. A shared entry belongs to every rung that needs EITHER of its
 *  sets — sune is rung oll:0 as a taught algorithm and rung oll:1 as a human-speed case, and a learner at
 *  either meets it. */
function finish(e) {
  e.rungs = Object.freeze([...new Set(e.provenance.flatMap((p) => rungsUsing(p.set)))]);
  e.primary = !e.provenance.every((p) => PROVED_SETS.has(p.set));
  e.provenance = Object.freeze(e.provenance.map((p) => Object.freeze(p)));
}

/** Every distinct algorithm the sets hold, one entry per sequence, in the order the sets are listed. */
function buildEntries() {
  const byAlg = new Map();
  for (const set of SETS) {
    for (const entry of set.entries) {
      // The two non-algorithms. Checked here rather than filtered at the source so that a third one
      // added later lands in this branch instead of silently becoming a drill with no moves.
      if (!entry.alg) continue;
      const caseId = entry.case ?? (PROVED_SETS.has(set.id) ? entry.name : null);
      const found = byAlg.get(entry.alg);
      if (found) fileAgain(found, set, entry, caseId);
      else byAlg.set(entry.alg, newEntry(set, entry, caseId));
    }
  }
  const entries = [...byAlg.values()];
  entries.forEach(finish);
  linkAlternatives(entries);
  for (const e of entries) Object.freeze(e);
  return Object.freeze(entries);
}

/**
 * What a one-look algorithm must leave, asked in the METHOD frame its letters are written in — the cross on
 * D, the last layer on U. The SOLVER'S OWN stage contracts, so "does this answer the case" means here
 * exactly what it means to the method solver; `human-algs.test.mjs` asks the same three of cubejs.
 */
const GOAL = Object.freeze({ f2l: firstTwoLayers, oll: topFaceOriented, pll: wholeCubeSolved });
const METHOD_LETTERS = Object.freeze(['U', 'F']);

/**
 * How many turns `other` costs on `entry`'s OWN case — its own turns plus any turn of the top it needs
 * before or after — or null when it does not answer that case at all.
 *
 * Asked on the arrangement `entry`'s page draws, because that is the cube the comparison is about: a
 * proved algorithm is the fewest turns for the ALIGNMENT it was searched at, and on a case drawn from
 * another alignment it may need a turn of the top first. Counting that turn is what keeps "fewer turns"
 * true on the page it is printed on — F2L 3 is `F' U' F`, three turns, and its proved case needs four.
 * The goal is the SET's, not a solved cube: two OLL algorithms for one case orient the same top and may
 * leave its pieces in different places, and the case is the orientation.
 */
function costOn(entry, other) {
  const goal = GOAL[entry.dial === 'pairs' ? 'f2l' : entry.dial];
  const start = run(invert(entry.alg), METHOD_LETTERS, SOLVED).state;
  let best = null;
  for (const pre of AUF) {
    for (const post of AUF) {
      const end = run([pre, other.alg, post].filter(Boolean).join(' '), METHOD_LETTERS, start).state;
      if (!goal(end)) continue;
      const cost = other.turns + (pre ? 1 : 0) + (post ? 1 : 0);
      if (best === null || cost < best) best = cost;
    }
  }
  return best;
}

/**
 * Join each case's human-speed entry to its proved one, both ways, where they are different sequences.
 *
 * `fewer` goes on the human entry ONLY when the proved one does that same drawn case in strictly fewer
 * turns, counting the turn of the top it may need — the sentence the drill page prints is "fewer turns",
 * and an equal count would make it false. `usual` goes on every proved alternative, so its page can send
 * the learner back to the algorithm the lessons teach.
 */
function linkAlternatives(entries) {
  for (const e of entries) { e.fewer = null; e.usual = null; }
  for (const pair of pairsByCase(entries).values()) linkPair(pair);
}

/** Each one-look case's human-speed entry and proved entry — the same entry twice where they are one
 *  sequence. A case missing either is refused: every case has both, by the bijection
 *  `human-algs.test.mjs` proves. */
function pairsByCase(entries) {
  const byCase = new Map();
  for (const e of entries.filter((x) => x.caseId)) {
    const pair = byCase.get(e.caseId) ?? {};
    for (const p of e.provenance) {
      if (PROVED_SETS.has(p.set)) pair.proved = e;
      else if (/-human$/.test(p.set)) pair.human = e;
    }
    byCase.set(e.caseId, pair);
  }
  for (const [caseId, { human, proved }] of byCase) {
    if (!human || !proved) throw new Error(`alg-catalogue: case ${caseId} has no ${human ? 'proved' : 'human-speed'} entry`);
  }
  return byCase;
}

/** Link one case's two entries. `align` is how many of the counted turns are turns of the top, so the page
 *  can say what it counted: the button shows the proved algorithm as written, and a total that silently
 *  included one more turn than the button shows would read as a miscount. */
function linkPair({ human, proved }) {
  if (human === proved) return;
  proved.usual = human.id;
  const cost = costOn(human, proved);
  if (cost !== null && cost < human.turns) human.fewer = Object.freeze({ id: proved.id, turns: cost, align: cost - proved.turns });
}

/** Every distinct algorithm this repository holds. */
export const ALG_ENTRIES = buildEntries();

/** The non-algorithms, kept visible so the exclusion is a fact a test can assert rather than an
 *  absence nobody notices. */
export const NOT_ALGORITHMS = Object.freeze(
  [...LAST_LAYER_EXTRAS, ...PAIRS_EXTRAS].filter((e) => !e.alg).map((e) => e.name),
);

/** The set ids, for the test that holds this file against the ledger. */
export const SET_IDS = Object.freeze(SETS.map((s) => s.id));
/** The rung table, exported for the same reason. */
export const RUNG_TABLE = RUNG_SETS;

const BY_ID = new Map(ALG_ENTRIES.map((e) => [e.id, e]));

/** One entry by its id, or null. Never throws: an id can come from a stored preference. */
export const entryById = (id) => BY_ID.get(id) ?? null;

/** The entries of one dial, in catalogue order. */
export const entriesForDial = (dial) => ALG_ENTRIES.filter((e) => e.dial === dial);

/**
 * What a learner on these rungs actually meets — the default scope of the Drill list (decision D3).
 *
 * A rung record is the app's `settings.rungs` shape: `{ cross, pairs, oll, pll }`. An out-of-range
 * rung falls back to the bottom rather than throwing, because this reads a stored preference and a
 * hand-edited record must not take the screen down.
 */
export function entriesForRungs(rungs = {}) {
  const wanted = new Set();
  for (const [dial, table] of Object.entries(RUNG_SETS)) {
    const n = Number.isInteger(rungs[dial]) && rungs[dial] >= 0 && rungs[dial] < table.length ? rungs[dial] : 0;
    for (const set of table[n]) wanted.add(set);
  }
  return ALG_ENTRIES.filter((e) => e.provenance.some((p) => wanted.has(p.set)));
}
