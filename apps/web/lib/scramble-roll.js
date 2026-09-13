// Scrambles and the solves recorded against them: rolling a random-state scramble, keeping one
// pre-rolled, and the solve history.
//
// Lifted out of app.js on 2026-09-13, when that file was split into modules.

import { solveWithinGodsNumber } from './solve-target.js';
import { randomCube } from './random-state.js';

import { load, save } from './app-settings.js';
import { Cube, invertAlg, solverReady, solverWorker } from './solver-service.js';
import { reaches } from './cube-subject.js';

// ---- session store (recent solves) -----------------------------------------------------------
// There used to be five fabricated solves here, handed to anyone whose session was empty — so a
// person who had never solved a cube was shown their "recent solves", complete with turn rates.
// An empty session now reads as empty. Placeholder data that looks real is worse than nothing,
// and this is the screen where that costs the most.
/** Who timed a solve. Exactly these two: `cubeTimed` in solve-stats.js reads `source === 'cube'`
 *  as its licence to put a solve into a turn rate, so an unrecognised value must never survive
 *  the boundary below wearing that name. */
const SOLVE_SOURCES = new Set(['cube', 'manual']);
/** A plausible inspection: from the moment the scramble was reached to the first turn. Bounded
 *  because a stored number with no ceiling is a statistic waiting to be fabricated; a day is
 *  generous past anything a person inspects for and short of anything a clock glitch invents. */
const MAX_INSPECTION_MS = 24 * 60 * 60 * 1000;

/** Solves from storage, normalised. This is the boundary: `cubusSolves` is written by anything on
 *  the origin and edited by anyone with devtools, so `{list: null}` or a list of strings must
 *  become an empty session rather than reaching a `.slice` or an innerHTML template. Fields are
 *  whitelisted for the same reason the cube registry whitelists its own. */
export function recentSolves() {
  const raw = load('cubusSolves', { list: [] }).list;
  if (!Array.isArray(raw)) return [];
  // Mapped, never filtered. Dropping a corrupt row closes the gap it left, so the "last five
  // solves" becomes five solves that were not the last five — and an ao5 computed over them looks
  // perfectly reasonable. An unusable row stays in place as a record with no usable time, which
  // is what makes averageOf() refuse rather than quietly reach further back.
  const ok = (s) => s && typeof s === 'object' && !Array.isArray(s);
  return raw.map((s) => ({
    n: ok(s) && Number.isSafeInteger(s.n) && s.n > 0 ? s.n : 0,
    time: ok(s) && typeof s.time === 'string' ? s.time : '',
    scramble: ok(s) && typeof s.scramble === 'string' ? s.scramble : '',
    at: ok(s) && Number.isSafeInteger(s.at) && s.at > 0 ? s.at : 0,
    // What a CUBE-timed solve knows and a hand-timed one cannot — and, until 2026-09-05, what
    // this whitelist silently ate. `pushSolve` writes them and then reads the list back THROUGH
    // here to write it out again, so every recorded solve erased them from every older record:
    // the turn rate on Stats could not be computed by construction, and "0 cube-timed solves"
    // was the honest report of a list this function had emptied.
    //
    // Per field, and only when usable. A missing key is the ABSENCE this app owes the reader —
    // `moves: 0` or `source: 'cube'` over a hand-timed row would be a fabricated fact about a
    // solve, which is the one thing the statistics module exists to refuse.
    ...(ok(s) && SOLVE_SOURCES.has(s.source) ? { source: s.source } : {}),
    ...(ok(s) && Number.isSafeInteger(s.moves) && s.moves > 0 ? { moves: s.moves } : {}),
    ...(ok(s) && Number.isFinite(s.inspectionMs) && s.inspectionMs >= 0 && s.inspectionMs <= MAX_INSPECTION_MS
      ? { inspectionMs: s.inspectionMs } : {}),
  }));
}

/** Record a solve. RETURNS whether the browser actually kept it: a private window or a full
 *  quota fails this write, and a time that showed on the clock and then vanished from "last five"
 *  with nothing said is indistinguishable from a bug in the timer. The caller says so on screen;
 *  save() already warns to the console. */
export function pushSolve(time, extra = {}) {
  const list = recentSolves();
  return save('cubusSolves', {
    list: [
      // Highest n, not the first row's. Corrupt rows keep their place with a placeholder n of 0,
      // so reading position zero could restart numbering at 1 half-way through a session.
      // `moves` and `source` are what a cube-timed solve knows and a hand-timed one cannot:
      // a turn rate is a fact about a move stream, so it may only ever be computed from these.
      { n: list.reduce((hi, s) => Math.max(hi, s.n || 0), 0) + 1, time, scramble: currentScramble || '—', at: Date.now(), ...extra },
      ...list,
      // 100, not 50. Stats offers an ao100, and a 50-record history made that statistic
      // unreachable by construction — a number on screen that could never stop being an em dash.
      // The retained span also has to outlast the seven-day chart drawn beside it.
    ].slice(0, 200),
  });
}

/** Take the most recent SHOWN solve back off the list.
 *
 *  The one destructive edit the app offers, and it exists because the alternative was permanent:
 *  a fumbled press, or a clock a cube started while the cube was only being tidied, went into
 *  every average from then on and could be removed only by editing localStorage by hand.
 *
 *  The newest row WITH A TIME, not simply the first. `recentSolves()` keeps corrupt records in
 *  place on purpose — that is what stops an average quietly reaching further back — so the first
 *  row and the first row a person can SEE are not always the same one. The button is drawn beside
 *  a time; it has to remove that record and not an unreadable one hiding above it.
 *
 *  Returns whether anything was removed AND stored. */
export function dropLastSolve() {
  const list = recentSolves();
  const at = list.findIndex((s) => s.time);
  if (at < 0) return false;
  return save('cubusSolves', { list: [...list.slice(0, at), ...list.slice(at + 1)] });
}

/** The scramble a finished solve is recorded against. Written by the caller that PUT one in
 *  play, never by the roll itself — see randomScramble. */
let currentScramble = '';

/** The eighteen face turns. Enough to recognise a state that is one turn from solved. */
const SINGLE_MOVES = Object.freeze(
  ['U', 'D', 'L', 'R', 'F', 'B'].flatMap((f) => [f, `${f}'`, `${f}2`]),
);

/** How many trivial draws in a row before we stop believing the random source. */
const MAX_TRIVIAL_REDRAWS = 8;

/**
 * Is this state already solved, or one turn from it?
 *
 * TNoodle rejects these, so a scramble claiming to be WCA-standard has to as well. It asks the
 * STATE rather than the solver, which is what makes it exact: "our answer came back short"
 * would depend on the search finding the optimal route, and two-phase does not promise one.
 *
 * It essentially never fires — 19 states out of 43,252,003,274,489,856,000, about four in 10^19
 * draws. That is the point: eighteen move-applications on a path that already runs a Kociemba
 * search, and the conformance claim becomes true rather than nearly true.
 */
function trivialState(cube) {
  if (cube.isSolved()) return true;
  const facelets = cube.asString();
  return SINGLE_MOVES.some((m) => {
    const c = Cube.fromString(facelets);
    c.move(m);
    return c.isSolved();
  });
}

/**
 * Roll one, without putting it in play.
 *
 * WCA-standard on both halves now. The STATE is a uniform draw from a cryptographic source
 * (random-state.js) — that half was always right. The LENGTH is the half that was not: this
 * handed the state to cubejs's `solve()`, whose default bound is 22, so 96% of scrambles came
 * out above God's number and 79.5% were exactly 22 (measured, n=200).
 *
 * The bound is not a preference, it is the promise the solve path already keeps:
 * `solveWithinGodsNumber`, one implementation, so a scramble and a solution cannot come to
 * disagree about what 20 means. Inversion preserves length, so a <= 20 solution is a <= 20
 * scramble — and because invertAlg is an involution, inverting the scramble hands that solution
 * straight back, which is how the solve side gets its answer without searching (takeDerivation).
 *
 * Asking cubejs for 20 instead is the obvious one-argument fix and is a trap: measured mean
 * 5,644 ms and worst 66 s per scramble, against 4 ms median through this engine, which searches
 * six interleaved views under a node budget rather than depth-limited IDA* on one.
 *
 * Pure on purpose: `currentScramble` is the scramble a timed solve is RECORDED against, so a
 * roll that happens before anyone asked for one must not touch it. Rolling ahead while it did
 * would have filed a solve under a scramble the solver never saw.
 */
async function rollScramble() {
  // cubejs no longer SEARCHES here, but it is still the parser and the oracle: a state has to
  // be drawn into a Cube, and the answer has to be checked by applying it.
  if (!solverReady) return null;
  for (let draw = 0; draw < MAX_TRIVIAL_REDRAWS; draw++) {
    // Crypto random-state, never Cube.random(): the uniform draw is the project's scramble rule
    // (AGENTS.md), and Math.random is exactly the quiet weakening it forbids.
    const r = randomCube(Cube);
    if (trivialState(r)) continue;
    const facelets = r.asString();
    const solution = await solveWithinGodsNumber(facelets, {
      solve: (f, bounds) => solverWorker().solve(f, bounds),
    });
    if (solution === undefined) return null; // aborted before an answer; nothing to show
    const alg = invertAlg(solution);
    // Zero trust at the boundary — unchanged in substance and now worth MORE than it was. The
    // answer crossed a thread and came from the two-phase engine; cubejs, a different
    // implementation, checks it by applying it. Before this it was cubejs checking cubejs.
    if (!alg || !reaches(facelets, alg)) {
      console.error('solver returned a scramble its alg does not reach — refusing it');
      return null;
    }
    return { facelets, alg };
  }
  // Unreachable short of a broken random source: it needs MAX_TRIVIAL_REDRAWS draws in a row
  // from a set of 19 states. Loud, because the alternative is a die that quietly does nothing.
  console.error('rollScramble: every draw was a trivial state — the random source is broken');
  return null;
}

/** One cube rolled ahead, waiting to be asked for. */
let nextRoll = null;
let rollPending = false;

/**
 * Roll the next one before anybody asks for it.
 *
 * A Kociemba search blocks whichever thread runs it — 2-196 ms measured across presses in
 * WebKit, and the spread is the search's, not the machine's. On the UI thread that is up to
 * twelve dropped frames, and moving it off the click alone only moved the stutter a beat later.
 *
 * It goes to the SOLVER POOL, the same place a solve goes. There used to be a second worker for
 * this — the since-deleted `lib/scramble-worker.js` — carrying its own ~34 MB of cubejs
 * Kociemba tables and 3-6 s of
 * build, plus a `warmRoller()` to start it early. The pool's workers already hold warm two-phase
 * tables, so that entire worker was the app paying twice for a capability it had once.
 *
 * The die never DEPENDS on this having finished: an unrolled press rolls on the spot. Late is
 * slow, never wrong.
 */
export function schedulePreroll() {
  if (rollPending || nextRoll || !solverReady) return;
  rollPending = true;
  void rollScramble().then(
    (rolled) => { rollPending = false; if (rolled && !nextRoll) nextRoll = rolled; },
    (err) => {
      // Loud, and not fatal: the next press rolls on demand and reports its own failure.
      rollPending = false;
      console.warn('pre-roll failed; the next press will roll on demand', err);
    },
  );
}

/**
 * The next random cube, and the alg that reaches it.
 *
 * PURE with respect to `currentScramble`, which the CALLER puts in play once it knows the roll is
 * still wanted. It used to be set here, inside the await — so a roll that landed after the user
 * had already started a solve re-filed that running solve under a scramble it was never about
 * (found by audit, 2026-09-04). Rolling is a real Kociemba search now, so that window is seconds
 * wide rather than notional.
 */
export async function randomScramble() {
  // Taken BEFORE any await: two presses must not be handed the same pre-rolled cube.
  const ready = nextRoll;
  nextRoll = null;
  const rolled = ready ?? await rollScramble();
  schedulePreroll(); // there should always be one waiting
  if (!rolled) return { facelets: '', alg: '' };
  return rolled;
}

/** This roll is the one a solve will be recorded against. */
export const putInPlay = (rolled) => { if (rolled?.alg) currentScramble = rolled.alg; };

/** This roll arrived at a moment nothing could use it — hold it for the next press rather than
 *  throwing away a search somebody has already paid for. Never over a roll already waiting: the
 *  one in hand is at least as fresh, and a scramble is a scramble. */
export const parkRoll = (rolled) => { if (rolled?.facelets && rolled.alg && !nextRoll) nextRoll = rolled; };
