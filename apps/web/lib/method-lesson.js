// A lesson's presentation layer: what a step POINTS AT, what it is called, and how the move list
// is cut into stages. Pure — no DOM, no renderer, no solver.
//
// This is the file dev-docs/method-solver-return-plan.md §5 is about, and the reason the feature
// (dev-docs/ is gitignored — the plans live with the maintainer, not in the tree; every reference
// to one in this repository is to a document a checkout does not carry, by design)
// is being tried a second time. The first attempt put a step's reason in ONE GREY CAPTION under a
// flat grid of chips: "Join the corner to its edge, then put the pair in together." A learner
// reading that cannot tell WHICH corner or WHICH edge. Text about a cube does not teach a cube.
//
// The renderer has since grown the channel that was missing — `highlight` (ebcc544) points at
// named pieces and the pulse follows them through a turn, and `focus` (f38c72b) is the inverse,
// draining the hue from every piece the step does not name. The solver's steps already carry
// piece identities in `why`. So the explanation moves off the caption line and onto the cube; the
// sentence stays, translated and short, but it is no longer the load-bearing channel.
//
// Split out of app.js on purpose: WHICH pieces a step names is a question about a step, and the
// browser test that proves the focus divide lands where it should needs to ask it without
// mounting a screen.

import { CORNERS, EDGES } from './cube-pieces.js';
import { plural, t } from './i18n.js';

/** The four dials a fine-grained stage name belongs to, and what a learner sees them called. */
const DIAL_OF = Object.freeze({
  cross: 'cross',
  'first-layer': 'pairs',
  'middle-layer': 'pairs',
  f2l: 'pairs',
  'top-cross': 'oll',
  'top-face': 'oll',
  'top-corners': 'pll',
  'top-edges': 'pll',
});

/**
 * Plain words, not CFOP jargon: this app's reader is eight. The rung's own label rides beside
 * these on the screen, which is where "two-look" and "trigger pairs" belong.
 *
 * Exported because the Lessons ladder names the same four stages and had its own copy. Two copies
 * of a name are two names as soon as one of them is edited, and the two screens are next to each
 * other: a stage called "Top face" on one and something else on the other reads as two stages.
 */
export const SECTION_NAME = Object.freeze({
  cross: () => t('Cross'),
  pairs: () => t('First two layers'),
  oll: () => t('Top face'),
  pll: () => t('Last layer'),
});

/**
 * A step's reason, in words.
 *
 * The solver produces `why: { key, … }` and never a sentence, so the wording lives in one place
 * and can be translated. These are deliberately about what the step ACHIEVES, not about what the
 * moves are: the move list is right there and can be read.
 *
 * Every sentence goes through `t()` with %1..%9 placeholders — §5.4. The removed version's
 * `WHY_TEXT` was English string literals, which is a table that cannot be translated at all.
 */
const WHY_TEXT = Object.freeze({
  'cross.lift': () => t('Bring this edge up to the top, without disturbing the cross so far.'),
  'cross.insert': () => t('Line it up over its home, then drop it in.'),
  // `plural`, not `%1 moves`: a one-move cross really happens, and "1 moves" is the kind of
  // sentence that tells a child the app is not paying attention. The helper is the repository's
  // own, and it asks the ACTIVE language rather than an `n === 1` written here.
  'cross.whole': ({ moves }) => plural(moves, {
    one: 'Make the cross on the bottom — one move, planned as one.',
    other: 'Make the cross on the bottom — %1 moves, planned as one.',
  }),
  'firstLayer.lift': () => t('Bring this corner up to the top, where you can work with it.'),
  'firstLayer.insert': () => t('Drop the corner into its slot underneath.'),
  'middleLayer.insert': () => t('Send this edge down into the middle layer.'),
  // The same algorithm ejects a wrong edge and inserts the right one. Captioning an ejection
  // "send this edge down" describes the opposite of what is about to happen on screen.
  'middleLayer.eject': () => t('Lift the wrong edge out of the slot first.'),
  // One sentence, not two. The second described an ejection first, and `pairs.js` proves that
  // branch of the search could never run — so the caption was for a step nothing could produce.
  'f2l.pair': () => t('Join the corner to its edge, then put the pair in together.'),
  // A look may take several applications, and only the last one reaches its goal. The `.step`
  // forms are what the ones before it say — the difference between describing a step and
  // describing the stage it belongs to.
  'topCross.orient': () => t('Make a cross on the top face.'),
  'topCross.orient.step': () => t('Turn some of the top edges the right way up — not all of them yet.'),
  'topFace.orient': () => t('Make the whole top face one colour.'),
  'topFace.orient.step': () => t('Twist some of the top corners the right way up — not all of them yet.'),
  'topCorners.permute': () => t('Move the top corners to the places they belong.'),
  'topCorners.permute.step': () => t('Start moving the top corners round; they are not all home yet.'),
  'lastLayer.align': () => t('Turn the top until it lines up.'),
  'topEdges.permute': () => t('Move the top edges home — this finishes the cube.'),
  'topEdges.permute.step': () => t('Start moving the top edges round; the cube is not finished yet.'),
  // One-look PLL moves the corners AND the edges, so it does not borrow either two-look sentence.
  // "Move the top edges home" over an algorithm that is mostly about corners is the same defect
  // the middle-layer captions had: a sentence describing something other than what is happening.
  'lastLayer.permute': () => t('Move the whole top layer into place — this finishes the cube.'),
});

/** Every reason key the solver can emit. A step whose key is missing here would caption as
 *  nothing and point at nothing, so the wiring test asserts the two lists match. */
export const WHY_KEYS = Object.freeze(Object.keys(WHY_TEXT));

/**
 * What a named algorithm is called on screen, keyed by the name the solver emits.
 *
 * The name used to be pasted straight into the sentence, which made it the one piece of the
 * caption that stayed English however the app was set — "把角块和棱块拼起来 (corner-cycle-back)".
 * A table rather than `t(step.caseName)` because the solver's names are IDENTIFIERS: several are
 * bare words a flat catalog would have to translate the same way everywhere they occur, and
 * `corner-cycle-back` is a program's spelling rather than a reader's.
 *
 * The English side is the identifier read as English and nothing more — this table is where a
 * name gets translated, not where it gets renamed. `method-lesson.test.mjs` holds it to the
 * solver's own `CASE_NAMES`, both ways, so an algorithm added without a name here fails rather
 * than appearing untranslated.
 */
const CASE_TEXT = Object.freeze({
  'drop-in': () => t('drop in'),
  'flip-in': () => t('flip in'),
  'right-hand': () => t('right hand'),
  'left-hand': () => t('left hand'),
  'facing-up': () => t('facing up'),
  'insert-right': () => t('insert right'),
  'insert-left': () => t('insert left'),
  // The six triggers say "trigger" out loud. They are the one group whose identifiers are bare
  // direction words, and `right` on its own is a word a catalog has to answer for the whole app.
  right: () => t('right trigger'),
  'right-back': () => t('right trigger back'),
  'right-half': () => t('right trigger half'),
  left: () => t('left trigger'),
  'left-back': () => t('left trigger back'),
  'left-half': () => t('left trigger half'),
  'edge-orient': () => t('edge orient'),
  sune: () => t('sune'),
  antisune: () => t('antisune'),
  headlights: () => t('headlights'),
  'double-sune': () => t('double sune'),
  pi: () => t('pi'),
  'corner-cycle': () => t('corner cycle'),
  'corner-cycle-back': () => t('corner cycle back'),
  diagonal: () => t('diagonal'),
  'u-perm-a': () => t('U perm a'),
  'u-perm-b': () => t('U perm b'),
  align: () => t('align'),
});

/** A key from a generated table rather than a name — `oll:00120011`, `f2l:0c10`. Matched
 *  narrowly on purpose: anything that is not this shape and not in `CASE_TEXT` is still a defect,
 *  and still fails loudly. */
const GENERATED_CASE_ID = /^(?:oll|pll|f2l):[0-9a-f]+$/;

/** Every name this module can put on screen — held against the solver's own list by test. */
export const CASE_TEXT_KEYS = Object.freeze(Object.keys(CASE_TEXT));

/** A named algorithm in the reader's language. Loud on a name it does not know, for the reason
 *  `whyText` is loud on a reason it cannot caption: printing the identifier looks like a label
 *  rather than like the defect it is. */
export function caseText(name) {
  if (typeof name !== 'string' || !Object.hasOwn(CASE_TEXT, name)) {
    throw new Error(`method-lesson: no name for case "${name}"`);
  }
  return CASE_TEXT[name]();
}

/** The sentence for a step, with the case name where the step is a named algorithm. */
export function whyText(step) {
  if (!step) return '';
  const key = step.why?.key;
  // `hasOwn`, never `WHY_TEXT[key]` alone: the key comes from a step record, and `constructor`
  // would resolve to a function while `__proto__` throws. `cube-highlight.js` records the same
  // lesson about `in` and pays it the same way.
  const write = typeof key === 'string' && Object.hasOwn(WHY_TEXT, key) ? WHY_TEXT[key] : null;
  // A reason nothing can caption is a step with no explanation, and the caller HIDES an empty
  // line — so a missing entry would remove the sentence silently and look like a step that
  // simply had nothing to say. Loud instead; `method-lesson.test.mjs` proves the table covers
  // every key the solver emits, so reaching this is a defect and not an input.
  if (key !== undefined && !write) {
    throw new Error(`method-lesson: no sentence for reason "${key}"`);
  }
  const sentence = write ? write(step.why) : '';
  // A case name is what a learner recognises next time, so it is worth showing — but only for
  // named algorithms, never for a searched sequence, which has no case to name.
  if (!(step.kind === 'case' && step.caseName && !step.parts)) return sentence;
  // A generated case IDENTIFIER is carried on the step and never shown. `oll:1a2b3c4d` is this
  // repository's key for a position; it is not the number a learner would find anywhere else, and
  // our own numbering shown as if it were the world's would be worse than showing none. The step
  // keeps it so a future screen can look the case up — see lib/data/case-tables.js.
  if (GENERATED_CASE_ID.test(step.caseName)) return sentence;
  return t('%1 (%2)', sentence, caseText(step.caseName));
}

/** A cubie index as its slot name, refusing anything that is not one.
 *
 *  An out-of-range index produced `piece:undefined`, which `parseHighlight` refuses whole — so ONE
 *  bad index silently removed the cue for the entire step. A cue that vanishes looks exactly like
 *  a step with nothing to point at, which is the quiet failure this channel exists to end. */
const named = (table, kind) => (i) => {
  if (!Number.isInteger(i) || i < 0 || i >= table.length) {
    throw new Error(`method-lesson: ${i} is not a ${kind}`);
  }
  return table[i];
};
const cornerName = named(CORNERS, 'corner');
const edgeName = named(EDGES, 'edge');
const asList = (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);

/**
 * The pieces a step names, as `<cubus-cube>` selector tokens.
 *
 * `piece:` and not `slot:`, deliberately: a lesson is about the white-green edge, not about the
 * top-front position, and the highlight has to travel with the piece while the turn happens. The
 * distinction is `cube-highlight.js`'s whole reason for existing.
 */
export function namedPieces(step) {
  const why = step?.why;
  if (!why) return [];
  const out = [];
  for (const i of asList(why.corner)) out.push(`piece:${cornerName(i)}`);
  for (const i of asList(why.corners)) out.push(`piece:${cornerName(i)}`);
  for (const i of asList(why.edge)) out.push(`piece:${edgeName(i)}`);
  for (const i of asList(why.edges)) out.push(`piece:${edgeName(i)}`);
  // The whole-cross step names the cross itself; it has no per-piece payload because it places
  // all four at once, and pointing at all four is exactly right for it.
  if (why.key === 'cross.whole') out.push(...['DF', 'DR', 'DB', 'DL'].map((e) => `piece:${e}`));
  return [...new Set(out)];
}

/**
 * What the cube should show while this step is the one under the transport head.
 *
 * `highlight` pulses the pieces the step names. `focus` is the same set PLUS the six centres —
 * the centres are what tell you which way up the cube is, and greying them turns a cube into a
 * grey box with four coloured stickers on it. Everything else loses its hue, so the stage stops
 * competing for attention.
 *
 * Both empty when the step names nothing, which reads as "no cue" rather than "focus on nothing":
 * an empty focus spec is `none`, and `parseHighlight` treats that as no selectors at all.
 */
export function lessonCues(step) {
  const pieces = namedPieces(step);
  if (pieces.length === 0) return { highlight: '', focus: '' };
  return { highlight: pieces.join(','), focus: ['centers', ...pieces].join(',') };
}

/** How many moves are in an alg. */
const movesIn = (alg) => (String(alg ?? '').trim() ? String(alg).trim().split(/\s+/).length : 0);

/**
 * The move list, cut into the four stages — §5.1.
 *
 * The app used to slice a two-phase solution at fixed 16 / 62 / 82 % and head the pieces CROSS /
 * F2L / OLL / PLL: stage names over an object that has no stages. That was removed for being
 * invention. This is the object that actually has them, so the sections are read off the steps
 * rather than proportioned.
 *
 * Each section carries the half-open move range `[from, to)` it covers, so the chips under a
 * heading are exactly the moves of its steps and no arithmetic is repeated at the call site.
 */
export function lessonSections(steps) {
  const sections = [];
  let move = 0;
  let step = 0;
  for (const s of steps ?? []) {
    // `hasOwn`, for the same reason `whyText` uses it: a stage name is data off a step record, and
    // `constructor` resolves through the prototype to a function while `__proto__` resolves to an
    // object — either way past the guard below and into `SECTION_NAME[dial] is not a function`
    // three lines later, which names nothing a reader can act on.
    const dial = typeof s.stage === 'string' && Object.hasOwn(DIAL_OF, s.stage) ? DIAL_OF[s.stage] : null;
    // An unknown stage would silently vanish from the list — a section of moves with no heading,
    // or worse, moves attributed to the previous stage. Named loudly instead.
    if (!dial) throw new Error(`method-lesson: no section for stage "${s.stage}"`);
    let last = sections[sections.length - 1];
    if (!last || last.id !== dial) {
      last = { id: dial, name: SECTION_NAME[dial](), steps: 0, moves: 0, from: move, to: move, firstStep: step };
      sections.push(last);
    }
    const n = movesIn(s.alg);
    last.steps += 1;
    last.moves += n;
    move += n;
    last.to = move;
    step += 1;
  }
  return sections;
}

/** Which step each move belongs to, so the walk can say why the move you are on is there. */
export function moveStepIndex(steps) {
  return (steps ?? []).flatMap((step, i) => Array.from({ length: movesIn(step.alg) }, () => i));
}

/**
 * "Cross planned whole · pairs joined" — the rungs in play, named on the cube screen (§3 rule 4).
 *
 * So it is never a mystery why today's solve has more steps than yesterday's. Reads the method's
 * own stage list rather than a setting, because the method is what produced the solve on screen.
 */
export function rungSummary(method) {
  if (!method?.stages) return '';
  // `t('%1: %2', …)` rather than a template literal with a colon in it. The colon and the order
  // are both the sentence's, not the program's: a language that puts the rung first, or that
  // spaces its punctuation differently, has nothing to edit if the two halves are glued here.
  return method.stages.map((s) => t('%1: %2', SECTION_NAME[s.id](), t(s.label))).join(' · ');
}
