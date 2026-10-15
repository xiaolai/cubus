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

import { CORNERS, EDGES, SOLVED, moveCount } from './cube-pieces.js';
import { faceTurnsAlg, heldFace, identityFace, run } from './cube-moves.js';
import { plural, t } from './i18n.js';
import { WHITE_UP_STAGES } from './solving-hold.js';
import { HUMAN_ALGS } from './data/human-algs.js';

/** The four dials a fine-grained stage name belongs to: the heading a step is filed under. */
const DIAL_OF = Object.freeze({
  cross: 'cross',
  'first-layer': 'pairs',
  'middle-layer': 'pairs',
  f2l: 'pairs',
  'top-cross': 'oll',
  'top-face': 'oll',
  'top-corners': 'pll',
  'top-edges': 'pll',
  // The course's route (ADR 0009): its edges go home in the top-face half, its corners turn in the last.
  'edges-home': 'oll',
  'corners-turned': 'pll',
});

/**
 * Plain words, not CFOP jargon: this app's reader is eight. The rung's own label rides beside
 * these on the screen, which is where "two-look" and "trigger pairs" belong.
 *
 * Exported because the learning levels name the same four stages (`ladderRows` in
 * lib/method-ladder.js). Two copies of a name are two names as soon as one of them is edited, and a
 * stage called "Top face" in one place and something else in another reads as two stages.
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
  // WHITE UP OR TURNED OVER, AND THE WORDS DIFFER. The solver builds the cross on its own D and lifts
  // pieces to its own U. Held white up (`WHITE_UP_STAGES`, lib/solving-hold.js; ADR 0003) that U layer
  // is the BOTTOM of the cube in the child's hands; turned over, it is the top. So each sentence that
  // says where a piece goes comes in both holds, and `whyText` picks by the step's STAGE — never by
  // its reason key. `firstLayer.*` is emitted by the layer-by-layer first layer (white up) AND by the
  // joined-pairs rung's fallback (`pairs.js`, stage `f2l`, turned over): keyed by reason alone, that
  // fallback told a child to take a corner "down" that was going up (Codex audit, 2026-09-13).
  'cross.lift': {
    up: () => t('Bring this edge down to the bottom, without disturbing the cross so far.'),
    over: () => t('Bring this edge up to the top, without disturbing the cross so far.'),
  },
  'cross.insert': {
    up: () => t('Line it up under its home, then turn it up into place.'),
    over: () => t('Line it up over its home, then drop it in.'),
  },
  // `plural`, not `%1 moves`: a one-move cross really happens, and "1 moves" is the kind of
  // sentence that tells a child the app is not paying attention. The helper is the repository's
  // own, and it asks the ACTIVE language rather than an `n === 1` written here.
  'cross.whole': {
    up: ({ moves }) => plural(moves, {
      one: 'Make the cross on top — one move, planned as one.',
      other: 'Make the cross on top — %1 moves, planned as one.',
    }),
    over: ({ moves }) => plural(moves, {
      one: 'Make the cross on the bottom — one move, planned as one.',
      other: 'Make the cross on the bottom — %1 moves, planned as one.',
    }),
  },
  // Turned over, the joined-pairs rung's fallback may begin by turning the whole cube so the slot is in
  // front (plan item 6.3). Those sentences were approved by the owner as D4, 2026-09-16.
  // EVERY TURNING SENTENCE NAMES WHITE'S PLACE as well as the destination (dev-docs/lesson-holds-plan.md
  // item 2.1). "Until the gap is in front of you" fixes the front and nothing else: a child can satisfy it
  // holding the cube on its side or upside down — four holds pass a front check — and a hold is said by top
  // AND front (AGENTS §4). White stays underneath through every one of these turns, so that is the anchor.
  // A DRAFT that changes D4's approved wording; it ships only once the owner has approved it.
  'firstLayer.lift': {
    up: () => t('Bring this corner down to the bottom, where you can work with it.'),
    over: ({ turn } = {}) => (turn
      ? t('Keep white underneath and turn the whole cube until the slot is in front of you, then bring this corner up to the top.')
      : t('Bring this corner up to the top, where you can work with it.')),
  },
  'firstLayer.insert': {
    up: () => t('Turn the corner up into its slot above.'),
    over: ({ turn } = {}) => (turn
      ? t('Keep white underneath and turn the whole cube until the slot is in front of you, then drop the corner into it.')
      : t('Drop the corner into its slot underneath.')),
  },
  // A middle-layer step may begin by turning the whole cube so the gap is in front (plan item 6.2),
  // and then says so. The two turning sentences were approved by the owner as D4 of
  // dev-docs/tutorial-capability-plan.md, 2026-09-16.
  'middleLayer.insert': ({ turn } = {}) => (turn
    ? t('Keep white underneath and turn the whole cube until the gap is in front of you, then send this edge down into it.')
    : t('Send this edge down into the middle layer.')),
  // The same algorithm ejects a wrong edge and inserts the right one. Captioning an ejection
  // "send this edge down" describes the opposite of what is about to happen on screen.
  'middleLayer.eject': ({ turn } = {}) => (turn
    ? t('Keep white underneath and turn the whole cube until the wrong edge is in front of you, then lift it out.')
    : t('Lift the wrong edge out of the slot first.')),
  // One sentence, not two. The second described an ejection first, and `pairs.js` proves that
  // branch of the search could never run — so the caption was for a step nothing could produce.
  'f2l.pair': ({ turn } = {}) => (turn
    ? t('Keep white underneath and turn the whole cube until the slot is in front of you, then join the corner to its edge and put the pair in.')
    : t('Join the corner to its edge, then put the pair in together.')),
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
  // The course's own last layer (`COURSE_LAST_LAYER`, lib/methods/last-layer.js; ADR 0009): edges home
  // first, then the corners put in place, then each corner turned up. Every one of these is made turned
  // over, so each says one thing; the course's lessons 14–16 are the sentences these shorten.
  'topEdges.place': () => t('Put the top edges home, each one next to the centre of its own colour.'),
  'topEdges.place.step': () => t('Swap two top edges; they are not all home yet.'),
  'topCorners.place': () => t('Move the top corners to the places they belong — some may still be turned the wrong way.'),
  'topCorners.place.step': () => t('Move three top corners round; they are not all in place yet.'),
  // The twist takes the first two layers apart while it runs. Saying so is the lesson's own warning, and
  // a child who sees the bottom scrambled with no warning undoes the work to "fix" it.
  // `topTurn` (never `turn`, which is the whole cube's elsewhere in this table): the step begins by
  // turning the top to bring the corner to the front right, and says so — otherwise the first move a
  // child makes is one the sentence never mentioned.
  'topCorners.twist': ({ topTurn } = {}) => (topTurn
    ? t('Turn the top to bring the last wrong-way corner to the front right, then turn it up. The layers underneath come back as it finishes.')
    : t('Turn the last wrong-way corner up at the front right. The layers underneath come back as it finishes.')),
  'topCorners.twist.step': ({ topTurn } = {}) => (topTurn
    ? t('Turn the top until a wrong-way corner is at the front right, then turn it up. The layers underneath come apart for now, and come back when every corner is up.')
    : t('Turn the corner at the front right until it faces up. The layers underneath come apart for now, and come back when every corner is up.')),
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
  turn: () => t('turn the cube'),
  'course-cross': () => t('course cross'),
  'course-edge-swap': () => t('course edge swap'),
  'course-corner-cycle': () => t('course corner cycle'),
  'course-corner-twist': () => t('course corner twist'),
  'course-corner-twist-back': () => t('course corner twist back'),
});

/** A key from a generated table rather than a name — `oll:00120011`, `f2l:0c10`. Matched
 *  narrowly on purpose: anything that is not this shape and not in `CASE_TEXT` is still a defect,
 *  and still fails loudly. */
const GENERATED_CASE_ID = /^(?:oll|pll|f2l):[0-9a-f]+$/;

/** The human-speed table's rows, by their ids — `oll-27`, `pll-T`, `f2l-1`. */
const HUMAN_ROW = new Map(HUMAN_ALGS.map((row) => [row.name, row]));

/**
 * The name the speedcubing community gives a row of the human-speed table — the name a learner will find
 * on every sheet and video, which is the whole reason to show it. NOT translated as a word: "OLL 27" and
 * "T" are proper names. Only the frame around them goes through `t()`, so a language can say "T perm" its
 * own way. An OLL case's nickname (`Sune`) rides beside its number, never in place of it: the number is
 * what the sheets are ordered by.
 */
export function humanCaseName(row) {
  if (row.name.startsWith('pll-')) return t('%1 perm', row.label);
  return row.nickname ? t('%1 · %2', row.label, row.nickname) : row.label;
}

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
/**
 * The sentence a step's reason writes, in the hold that step is made in — or '' when it has no reason.
 *
 * Refuses rather than guesses, twice over, because the caller HIDES an empty line: a missing entry would
 * remove the sentence silently and look like a step that simply had nothing to say, and a hold-dependent
 * sentence with no stage to pick by would print one of two opposite instructions.
 */
function sentenceFor(step) {
  const key = step.why?.key;
  // `hasOwn`, never `WHY_TEXT[key]` alone: the key comes from a step record, and `constructor`
  // would resolve to a function while `__proto__` throws. `cube-highlight.js` records the same
  // lesson about `in` and pays it the same way.
  const entry = typeof key === 'string' && Object.hasOwn(WHY_TEXT, key) ? WHY_TEXT[key] : null;
  // `method-lesson.test.mjs` proves the table covers every key the solver emits, so reaching this is a
  // defect and not an input.
  if (key !== undefined && !entry) {
    throw new Error(`method-lesson: no sentence for reason "${key}"`);
  }
  if (!entry) return '';
  if (typeof entry === 'function') return entry(step.why);
  if (typeof step.stage !== 'string') {
    throw new Error(`method-lesson: "${key}" reads differently held white up and turned over, and this step has no stage to say which`);
  }
  return (WHITE_UP_STAGES.includes(step.stage) ? entry.up : entry.over)(step.why);
}

/**
 * The name a learner would call this algorithm, or null when it has none.
 *
 * Null for a GENERATED case, for `caseLabel`'s reason: `oll:1a2b3c4d` is this repository's key for
 * a position, not a number anybody would find elsewhere, and showing our own as if it were the
 * world's would be worse than showing none. A row of the human-speed table has the world's name, and
 * gets it.
 */
export const caseNameOf = (id) => {
  if (GENERATED_CASE_ID.test(id)) return null;
  const row = HUMAN_ROW.get(id);
  return row ? humanCaseName(row) : caseText(id);
};

/**
 * The case name to show after a step's sentence, or null.
 *
 * Only for named algorithms — a searched sequence has no case to name — and never for a GENERATED case
 * identifier: `oll:1a2b3c4d` is this repository's key for a position, not the number a learner would find
 * anywhere else, and our own numbering shown as if it were the world's would be worse than showing none.
 * The step keeps it so a future screen can look the case up — see lib/data/case-tables.js.
 */
function caseLabel(step) {
  if (!(step.kind === 'case' && step.caseName && !step.parts)) return null;
  // `caseNameOf`, not the test-and-look-up written out again: the generated-id rule had two
  // maintenance points, and the two must never come to disagree about what counts as ours.
  return caseNameOf(step.caseName);
}

/** The sentence for a step, with the case name where the step is a named algorithm. */
export function whyText(step) {
  if (!step) return '';
  const sentence = sentenceFor(step);
  const label = caseLabel(step);
  return label === null ? sentence : t('%1 (%2)', sentence, label);
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
  // What the child looks for before the move — the top edges with none of the top colour (plan item
  // 6.2) — stays in colour beside the piece the step is about, and only that piece pulses.
  const looked = asList(step.why?.look).map((i) => `piece:${edgeName(i)}`).filter((p) => !pieces.includes(p));
  const toward = turnedToward(step);
  const pulse = toward ? [...pieces, toward] : pieces;
  return { highlight: pulse.join(','), focus: ['centers', ...pieces, ...looked].join(',') };
}

/**
 * The centre a step's whole-cube turn brings to face the child, as a PIECE in the step's starting hold —
 * or null for a step that does not turn the cube (dev-docs/lesson-holds-plan.md item 2.2).
 *
 * A piece, not `slot:F`. One step carries the turn AND the moves after it, so a positional front would
 * pulse the OLD front centre all the while the sentence says to turn away from it; the centre named by
 * identity is the destination before the turn ("until this one faces you") and the front after it. It
 * names no colour — the renderer draws whatever that centre is — so it holds under either scheme.
 */
function turnedToward(step) {
  if (!step?.why?.turn || !Array.isArray(step.hold)) return null;
  const regrip = String(step.alg ?? '').trim().split(/\s+/)[0];
  const after = run(regrip, step.hold, SOLVED).hold;
  if (after[0] === step.hold[0] && after[1] === step.hold[1]) {
    throw new Error(`method-lesson: a step that says it turns the cube begins "${regrip}", which turns nothing`);
  }
  return `piece:${heldFace(identityFace('F', after), step.hold)}`;
}

/** How many moves are in an alg — the shared tokenizer, not a third spelling of it. A regrip is one:
 *  this counts POSITIONS in a walk, which is what a chip and the playhead are indexed by. */
const movesIn = moveCount;

/**
 * How many face turns an alg is, in the half-turn metric — a regrip none, a slice two. What a lesson
 * says it COSTS (plan item 6.1): turning the cube so the gap is in front is not a move a child is
 * charged for, and a count that included it would make the method look longer for teaching it.
 */
export const turnsIn = (alg) => moveCount(faceTurnsAlg(String(alg ?? '')));

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
    last.moves += turnsIn(s.alg);
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
 * Which step the CUE is about when `made` moves have been made — the step about to happen.
 *
 * Its own function because it answers a different question from the one the chip row answers, and
 * they used to share an answer. The transport announces "`made` moves are done"; the chips fill up
 * to `made` and mark `made - 1` as current, which is about the move just performed. The sentence
 * and the highlight are about the move NEXT, so they read `map[made]` — and reading `map[made - 1]`
 * meant the first move of every teaching step animated under the previous step's explanation.
 *
 * Clamped at the end: after the last move there is no next one, so the last step's cue stays
 * rather than the screen going blank on the move that finished the cube.
 */
export function stepAtMove(map, made) {
  if (!map?.length) return undefined;
  return map[Math.min(Math.max(made, 0), map.length - 1)];
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
