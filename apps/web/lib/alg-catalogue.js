// Every algorithm this repository holds, as one list of computed facts.
//
// dev-docs/algorithm-drills-plan.md item 2.1. Not a copy of anybody's algorithm sheet, and not a
// second copy of the tables either: every entry is DERIVED from `lib/methods/*.js` and
// `lib/data/case-tables.js` at load, so an algorithm cannot be in the catalogue and not in the app.
//
// THE COUNT IS DERIVED, never written — and not written in this comment either, because the test
// that holds the total greps this file for it rather than stripping comments first (the repository's
// own warning about `//` inside a string is why no stripper is used). What it comes out at is the
// distinct hand-written sequences plus the generated cases, less the few that are the same move
// string in both pools. `alg-catalogue.test.mjs` asserts the number.
//
// PROVENANCE IS A COLLECTION. `F' U F`, sune, antisune and pi are each BOTH a taught algorithm and
// the proven-minimal answer to a generated case. A singular `taught | proved` field cannot represent
// that, and would silently drop one of the two — which is the acceptance criterion for this item, so
// the type has to be able to express it.
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
import { CROSS_ALGS } from './methods/cross.js';
import { LAST_LAYER_EXTRAS, OLL_ALGS, PLL_ALGS } from './methods/last-layer.js';
import { PAIRS_ALGS, PAIRS_EXTRAS } from './methods/pairs.js';
import { SOLVED, applyAlg, invert, movesOf, toFacelets } from './cube-pieces.js';
import { METHOD_FRAME, METHOD_TO_SCAN, holdForStage, holdSpec, renameAlg, showMove } from './solving-hold.js';
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
  { id: 'f2l-full', stage: 'f2l', entries: F2L_CASES },
  { id: 'oll-full', stage: 'top-face', entries: FULL_OLL },
  // One-look PLL permutes corners AND edges, and the method solver emits it as one step. Filed under
  // `top-corners` because the two last-layer permutation stages share a hold and a dial, so the
  // choice changes nothing a caller can observe — said here so it is a decision rather than an
  // accident somebody later "fixes" in the other direction.
  { id: 'pll-full', stage: 'top-corners', entries: FULL_PLL },
]);

/** Which sets each rung of each dial actually needs, mirroring `bench/algorithm-ledger.mjs`'s
 *  `METHODS` table for the app's own method. The F2L rungs KEEP the beginner inserts: `pairsFrom`
 *  falls back to `placeSeparately` for a buried pair, and that fallback is those inserts — the
 *  ledger measured it, and a rung scope that dropped them would hide algorithms the learner still
 *  meets. `algorithm-ledger.test.mjs`'s published totals (18 at the bottom, 124 at the top) are what
 *  `alg-catalogue.test.mjs` holds this table against, so the two cannot drift apart. */
const RUNG_SETS = Object.freeze({
  // Rung 1 of the cross is an exact distance table descended move by move — no algorithms at all.
  cross: Object.freeze([Object.freeze(['cross-inserts']), Object.freeze([])]),
  pairs: Object.freeze([
    Object.freeze(['f1l-inserts', 'middle-inserts']),
    Object.freeze(['f2l-triggers', 'f1l-inserts', 'middle-inserts']),
    Object.freeze(['f2l-full', 'f1l-inserts', 'middle-inserts']),
  ]),
  oll: Object.freeze([Object.freeze(['eoll', 'ocll']), Object.freeze(['oll-full'])]),
  pll: Object.freeze([Object.freeze(['cpll', 'epll']), Object.freeze(['pll-full'])]),
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

/** Everything about one algorithm, computed. Built once at load, each entry costing one order
 *  computation, which is bounded at 72 repetitions over this catalogue. */
function buildEntries() {
  const byAlg = new Map();
  for (const set of SETS) {
    const stage = set.stage;
    const hold = holdForStage(stage);
    for (const entry of set.entries) {
      // The two non-algorithms. Checked here rather than filtered at the source so that a third one
      // added later lands in this branch instead of silently becoming a drill with no moves.
      if (!entry.alg) continue;
      const found = byAlg.get(entry.alg);
      if (found) { found.provenance.push({ set: set.id, name: entry.name }); continue; }
      const scanAlg = renameAlg(entry.alg, METHOD_TO_SCAN);
      const effect = effectOf(entry.alg);
      const described = describeEffect(effect, entry.name);
      byAlg.set(entry.alg, {
        id: entry.name,
        stage,
        dial: DIAL_OF[stage],
        hold: holdSpec(hold),
        frame: holdSpec(METHOD_FRAME),
        alg: entry.alg,
        scanAlg,
        shown: movesOf(scanAlg).map((m) => showMove(m, hold)).join(' '),
        // The case this algorithm answers, in the CUBE's frame: solved, then the sequence undone.
        // Used by the library's no-cube demo and by nothing else — a drill never builds a setup.
        setup: toFacelets(applyAlg(SOLVED, invert(scanAlg))),
        provenance: [{ set: set.id, name: entry.name }],
        rungs: rungsUsing(set.id),
        effect,
        label: described.label,
        labelParts: described.parts,
      });
    }
  }
  // A shared entry belongs to every rung that needs EITHER of its sets — sune is rung oll:0 as a
  // taught algorithm and rung oll:1 as a generated case, and a learner at either meets it.
  for (const e of byAlg.values()) {
    const rungs = new Set(e.provenance.flatMap((p) => rungsUsing(p.set)));
    e.rungs = Object.freeze([...rungs]);
    e.provenance = Object.freeze(e.provenance.map((p) => Object.freeze(p)));
    Object.freeze(e);
  }
  return Object.freeze([...byAlg.values()]);
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
