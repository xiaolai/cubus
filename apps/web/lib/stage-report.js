// What a chip says, and what it is allowed to CLAIM while saying it.
//
// Plan §6 of dev-docs/solve-to-state-plan.md. Five states, and they are visually distinct because
// no two of them are the same kind of fact:
//
//   done    the predicate already holds. Nothing to do, and the chip is an encouragement.
//   exact   a finished search, or the cross table. **The only state that may call itself the
//           shortest.**
//   bound   a table read and no finished search. A LOWER bound, labelled as one, and it may become
//           a different exact number later — which is allowed precisely because it was labelled.
//   route   a length that is not claimed minimal: what the fallback produces, and what the `solved`
//           chip always carries. The pool's answer is an upper bound by construction — measured, at
//           `solLen: 21` with no refinement it returns 13 moves for a cube whose six-move inverse
//           solves it — so presenting one as a distance would be a claim the engine cannot make.
//   dash    the budget ran out. A statistic that cannot be computed is a dash.
//
// THE SENTENCE THIS FILE EXISTS TO MAKE UNWRITABLE. The first draft of §6 offered "no short way
// back" for the out-of-budget case. **That is the forbidden sentence**: budget exhaustion does not
// establish that no short repair exists, so it is a claim about the cube made from a fact about the
// search. Every string here is about the search, and `test/stage-report.test.mjs` scans them.
//
// Wording lives here rather than at the call sites so that `optimal.test.mjs`'s claim scanner has
// one named region to sanction — the same discipline `PROVE_COPY` already follows in `app.js`, and
// for the same reason: a claim spread across a template is a claim nobody can find later.

import { plural, t } from './i18n.js';

/** The five, as ids. A chip's class and its aria wording both key on these. */
export const CHIP = Object.freeze({
  DONE: 'done',
  EXACT: 'exact',
  BOUND: 'bound',
  ROUTE: 'route',
  DASH: 'dash',
});

/**
 * The sentences, named — plan §6's wording, pinned by `optimal.test.mjs`'s source scan.
 *
 * `shortest` is the ONLY minimality claim in this app that is not about a whole cube, and it is a
 * third source of one: `AGENTS.md` says so, and the scanner sanctions this object by name. It may
 * be said only from an exhausted IDA\* contour over an admissible heuristic, with the route replayed
 * against the target's independent predicate first — which is what `stage-distance.js` returns and
 * nothing else in the app can produce.
 */
export const STAGE_COPY = Object.freeze({
  /** An exact answer. The claim, and the reason this object is a sanctioned region. */
  shortest: (moves) => t('the shortest way back — %1', plural(moves, { one: '%1 move', other: '%1 moves' })),
  /** A route with no claim attached. */
  route: (moves) => t('a way back — %1', plural(moves, { one: '%1 move', other: '%1 moves' })),
  /** The fallback ran all the way to a solved cube. Said, never presented as reaching the target. */
  overshoot: (name, moves) => t('couldn’t find a short way back to the %1; the whole cube in %2', name, moves),
  /** A bound. Labelled every time it is shown, so a later exact number is a refinement and not a
   *  contradiction — plan §6's "working…" defect is the one this avoids. */
  atLeast: (moves) => t('at least %1', plural(moves, { one: '%1 move', other: '%1 moves' })),
  /** Already there — the chip face. */
  done: () => t('done'),
  /**
   * Already there — the SENTENCE, where a chip has a word.
   *
   * "the shortest way back — 0 moves" is what the exact branch says without this, and it is
   * technically true and useless: a child reads a move count and looks for moves. Plan §9a puts it
   * plainly — an empty route must never render as a walk — and the first thing that has to stop is
   * calling it a route.
   */
  already: (name) => t('your cube is already at the %1', name),
  /**
   * Out of budget.
   *
   * A STATEMENT ABOUT THE SEARCH. Not "there is no short way back", which budget exhaustion cannot
   * establish and which `solve-tier-wiring.test.mjs` already forbids for move counts.
   */
  unknown: () => t('couldn’t work one out'),
  /** The offer that stands in for an answer nobody could compute. */
  offerSolve: () => t('solve the whole cube instead'),
  /**
   * A PICTURE, which is a way TO somewhere rather than a way BACK.
   *
   * Every sentence above is written for a stage: "back" is right there, because a stage is where
   * the cube already was and the child has lost it. A fun shape is somewhere the cube has never
   * been, so "a way back to the Checkerboard" is simply false, and a child who reads it looks for
   * a mistake they did not make.
   *
   * IT MAKES NO CLAIM, and this is the region's whole obligation. Two-phase cannot prove a minimum,
   * so a picture route can never be the "shortest" sentence, and `routeToPicture` returns an
   * explicit `minimal: false` rather than leaving the field absent for this to read as falsy.
   */
  /**
   * NO ARTICLE, unlike every stage sentence above, because a picture's name brings its own.
   *
   * A stage is named bare — "cross", "first layer" — so the copy supplies "the". A picture is named
   * as a thing: "The Checkerboard", "Lines", "a plus on every face". Reusing the stage phrasing gave
   * "a way to the The Checkerboard", which is the kind of seam a child reads as the app being
   * broken. Adding an article per name would be the other way round and worse: it puts English
   * grammar in a data table that gets translated.
   */
  wayTo: (name, moves) => t('a way to %1 — %2', name, plural(moves, { one: '%1 move', other: '%1 moves' })),
  /** Already showing it — the picture's own "already there". */
  showing: (name) => t('your cube is already showing %1', name),
});

/**
 * One chip, from a bound and whatever answer has arrived so far.
 *
 * `bound` is the instant table read and is always present. `answer` is null until a search or a
 * fallback lands. `atTarget` is the predicate, asked of the cube rather than inferred from a zero —
 * a distance of zero and "already there" are the same fact, but only one of them is a fact the
 * screen should be reading off arithmetic.
 */
export function chipFor({ target, bound = null, answer = null, atTarget = false }) {
  const name = target?.name ?? '';
  if (atTarget) {
    return { state: CHIP.DONE, text: STAGE_COPY.done(), moves: 0, minimal: true, name };
  }
  if (answer && answer.moves !== null) {
    return answer.minimal
      ? { state: CHIP.EXACT, text: String(answer.moves), moves: answer.moves, minimal: true, name }
      : { state: CHIP.ROUTE, text: String(answer.moves), moves: answer.moves, minimal: false, name };
  }
  // A search that FINISHED and found nothing is a dash. A search that has not finished is still a
  // bound — and the difference is `answer` being present with a null count, rather than absent.
  if (answer) return { state: CHIP.DASH, text: '—', moves: null, minimal: false, name };
  if (bound === null) return { state: CHIP.DASH, text: '—', moves: null, minimal: false, name };
  return { state: CHIP.BOUND, text: `≥ ${bound}`, moves: bound, minimal: false, name };
}

/**
 * The sentence beside a route on the cube screen.
 *
 * Reads a `lib/stage-route.js` route, so the claim and the thing claimed about cannot drift: a
 * route that did not come from an exhausted contour has `minimal: false` and cannot reach the
 * `shortest` branch however this is called.
 */
export function routeSentence(route, target) {
  if (!route || route.moves === null) return STAGE_COPY.unknown();
  const name = target?.name ?? '';
  // A PICTURE IS A WAY TO, NEVER A WAY BACK, and it never claims a minimum. Branched before
  // everything below because all of it is written for a stage: "back" is the word, and the exact
  // engine's `minimal` is the claim. A picture destination has no exact engine and was never there.
  if (target?.picture || target?.sideways) {
    if (route.moves === 0) return STAGE_COPY.showing(name);
    return STAGE_COPY.wayTo(name, route.moves);
  }
  // ZERO IS NOT A LENGTH, it is a different fact. Checked before the claim, so "already there"
  // can never come out as a minimality claim about no moves at all.
  if (route.moves === 0) return STAGE_COPY.already(name);
  if (route.overshoot) return STAGE_COPY.overshoot(name, route.moves);
  return route.minimal ? STAGE_COPY.shortest(route.moves) : STAGE_COPY.route(route.moves);
}

/**
 * The accessible description of a chip — what a screen reader is told, where a sighted reader has
 * the chip's colour and shape.
 *
 * The five states are "visually distinct" in §6's words, and a state carried only by colour is not
 * distinct to everybody. So the label says which kind of fact it is, in words, every time.
 */
export function chipLabel(chip) {
  switch (chip.state) {
    case CHIP.DONE: return t('%1: done', chip.name);
    case CHIP.EXACT: return t('%1: %2', chip.name, STAGE_COPY.shortest(chip.moves));
    case CHIP.ROUTE: return t('%1: %2', chip.name, STAGE_COPY.route(chip.moves));
    case CHIP.BOUND: return t('%1: %2', chip.name, STAGE_COPY.atLeast(chip.moves));
    default: return t('%1: %2', chip.name, STAGE_COPY.unknown());
  }
}
