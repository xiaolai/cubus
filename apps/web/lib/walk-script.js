// A walk on the cube screen, as a SCRIPT the player can drive — plan item 6.5.
//
// The cube screen's walk is searched for rather than authored, which is why this item stayed open: a
// script is a written thing and a walk is an answer. But a committed walk carries everything a script
// needs to say where the cube is and what turns it, so the translation is a pure function of the
// committed walk and belongs nowhere near the search.
//
// `lib/walk-follow.js` has built a one-line version of this since plan item 3.5:
//
//     { schema: 2, start: { facelets: steps[0] }, steps: [{ move: moves.join(' ') }] }
//
// which is enough to MATCH a cube against the walk and not enough to DRAW it: a solve would load from
// an arrangement rather than from the verified path to it, and the Scramble side has no arrangement to
// load at all. This is that script with the opening put right, and ONE builder for both readers rather
// than a literal in the module that happened to need it first.
//
// ---------------------------------------------------------------------------------------------------
// TWO THINGS IT DELIBERATELY DOES NOT CARRY, each with a reason that outlived the attempt to carry it.
//
// **The hold.** A script's `start.hold` is the frame its letters are READ in as well as the pose the
// cube is shown in (ADR 0004: a letter means a position in the hold in force). A walk's moves are
// already in the SCAN frame — `scanFrameWalk` renamed them there and the chips are named to match — so
// handing `walkHold` to the script would re-read every letter in the tumbled frame and silently
// relabel the whole walk. The screen keeps `orientation` and goes on turning the cube through
// `holdCube`, exactly as today.
//
// **A lesson's cues.** Measured 2026-09-17, and it is a gap in the FORMAT rather than a choice here:
// **position 0 never carries a cue.** A cue written on the first move step is in force from position 1,
// because a step's cues attach to the positions its tokens reach. The cube screen shows the first
// step's focus and highlight at head 0 — "the step you are looking at before you turn anything", which
// is the whole of what makes a lesson a lesson when nothing has been pressed yet — and a script can
// only say that with a cue-only step ahead of the moves, which adds a position and breaks the
// correspondence between a head and a position that everything else here depends on. So `focus` and
// `highlight` stay host-owned until that is answered on its own terms, rather than being moved with a
// one-position regression nobody would see in a test that did not look at head 0.
// ---------------------------------------------------------------------------------------------------

/**
 * The committed walk as a script.
 *
 * @param {object} walk `setup` (the alg from solved that reaches the walk's first arrangement, or
 *   null), `moves`, `steps` (the arrangement at every position, `moves.length + 1` of them), and
 *   `scrambling`.
 * @returns {object|null} a script, or null for a walk too incomplete to be one — which is what
 *   `walk-follow.js` already refused by hand, and for the same reason: a route whose states do not
 *   line up with its moves cannot say where a cube is.
 */
export function walkScript({ setup = null, moves = [], steps = [], scrambling = false } = {}) {
  if (!moves.length || steps.length !== moves.length + 1) return null;
  return { schema: 2, start: opening(setup, steps, scrambling), steps: [{ move: moves.join(' ') }] };
}

/**
 * What the walk opens on — the choice `drawWalk` has always made, made once and in one place.
 *
 * The Scramble side genuinely starts from solved, and says so by naming no opening at all: a script
 * with no `start` opens on a solved cube and a `scramble` of `''`, which is the attribute pair the
 * screen writes today. (`scramble: ''` cannot be written literally — `checkScript` refuses a scramble
 * that names no moves, correctly: an empty alg is the absence of one, not an alg.)
 *
 * On the SOLVE side an empty `setup` means something different and worse: `takeSetupAlg` refused the
 * inverse of the answer. The walk is still cross-checked and still right, but no alg from solved is
 * known to reach it — so the arrangement is loaded instead, because `scramble: ''` there would draw a
 * SOLVED cube under a scrambled walk.
 */
function opening(setup, steps, scrambling) {
  if (setup) return { scramble: setup };
  return scrambling ? {} : { facelets: steps[0] };
}
