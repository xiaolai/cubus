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
// which is enough to MATCH a cube against the walk and not enough to DRAW it. It is also, taken
// literally, WRONG for every lesson — see below.
//
// ---------------------------------------------------------------------------------------------------
// A WALK'S MOVES ARE NOT A SCRIPT'S MOVES, and the difference is a whole-cube turn.
//
// A walk is stored in the SCAN frame from end to end (ADR 0003): every letter means the same face
// however the cube has been turned since, and `moveHolds` records separately which hold each move is
// MADE in, so the chips can be named for the child's own grip. A SCRIPT is the other convention
// (ADR 0004): a letter means a position in the hold in force, and a whole-cube turn changes that hold
// for everything after it.
//
// So handing a walk's `alg` to the player re-reads every move after a regrip in the tumbled frame.
// Measured 2026-09-17 on `R U R' x2 U F U'`: from the tumble on, the script drew L where the walk says
// R and B where it says F — and it lost a position, because a regrip moves no piece and the format
// groups it with the turn it leads into. The cube on screen was wrong and the transport was one short,
// and the only thing that noticed was the browser suite's chip-naming case.
//
// The translation is therefore PRE-COMPENSATION: each move is written in the frame the interpreter will
// be reading in when it gets there, and that frame is simulated here — starting at the identity and
// advanced by the moves themselves, exactly as `cube-moves.js` advances one. Read back, those tokens
// yield the walk's own scan-frame alg, character for character; one script step each, so a regrip gets
// a position of its own and a head and a position stay the same number.
//
// NOT the hold each move is MADE in, which is the obvious answer and is wrong. That hold is the
// CHILD's grip: `scanFrameWalk` jumps it to the next stage's at the tumble, where no token turns
// anything, so a script named for it goes out of step with its own reader at the first stage boundary
// — measured on three real lessons before this was written. The script's frame is the script's, and
// the child's grip is the chips' and `turnTo`'s.
//
// The POSE therefore stays the screen's. `orientation` is host-owned (the writer never writes it) and
// `holdCube` goes on turning the cube, because ADR 0003's tumble is an animated turn made in front of
// the child and a script's hold change is a cut.
// ---------------------------------------------------------------------------------------------------
//
// ONE THING IT DELIBERATELY DOES NOT CARRY: a lesson's cues. Measured the same day, and a gap in the
// FORMAT rather than a choice here: **position 0 never carries a cue.** A cue written on the first
// move step is in force from position 1, because a step's cues attach to the positions its tokens
// reach. This screen shows the first step's focus and highlight at head 0 — "the step you are looking
// at before you turn anything", which is the whole of what makes a lesson a lesson when nothing has
// been pressed yet — and a script can only say that with a cue-only step ahead of the moves, which
// adds a position and breaks the correspondence between a head and a position that everything else
// here depends on. So `focus` and `highlight` stay host-owned until that is answered on its own terms.
import { applyIdentity } from './cube-moves.js';
import { readToken } from './cube-notation.js';
import { SOLVED } from './cube-pieces.js';
import { SCAN_HOLD, renameAlg } from './solving-hold.js';

/**
 * The committed walk as a script.
 *
 * @param {object} walk `setup` (the alg from solved that reaches the walk's first arrangement, or
 *   null), `moves` (scan-frame), `from` (the arrangement the walk begins at, for a walk with no
 *   `setup`), and `scrambling`.
 * @returns {object|null} a script, or null for a walk that cannot be one: no moves, or nothing to
 *   open on.
 *
 * IT DOES NOT NEED THE WALK'S STATE LIST. The states come back out of the script — `trackFor` runs the
 * moves through the interpreter — so asking for `steps` here would be asking the caller to supply what
 * this produces, and would refuse a transport to any walk whose state list is short. That is a real
 * case (`judge()` in lib/walk-follow.js refuses to FOLLOW such a walk), and refusing to follow it is
 * not a reason to refuse to step through it.
 */
export function walkScript({ setup = null, moves = [], from = null, scrambling = false } = {}) {
  if (!moves.length) return null;
  const start = opening(setup, from, scrambling);
  if (!start) return null;
  return {
    schema: 2,
    // The identity: the frame a walk's letters are already in, and where the reader starts.
    start: { ...start, hold: SCAN_HOLD.join(' ') },
    // ONE STEP PER TOKEN. A script gives every STEP a position, and this screen's head counts every
    // move including the regrips — so a step per token is what makes a head and a position the same
    // number. Grouped into one step, a regrip ends up INSIDE the group of the turn it leads into and
    // the walk is a position short of its own chips.
    steps: inReadersFrame(moves).map((move) => ({ move })),
  };
}

/**
 * Each move written in the frame the reader will be in when it reaches it.
 *
 * The walk's letters are identity-frame throughout; the reader's frame starts there and is turned by
 * every whole-cube move it reads. So the token to write is this move named for the frame as it stands,
 * and then the frame is turned by the move ITSELF — the identity move, not the token — because that is
 * what the reader will have done with it.
 */
function inReadersFrame(moves) {
  let frame = SCAN_HOLD;
  return moves.map((move) => {
    const token = renameAlg(move, frame);
    frame = applyIdentity(readToken(move).move, frame, SOLVED).hold;
    return token;
  });
}

/**
 * What the walk opens on — the choice `drawWalk` has always made, made once and in one place.
 *
 * The Scramble side genuinely starts from solved, and says so by naming no cube at all: a script with
 * no `facelets` and no `scramble` opens on a solved cube and a `scramble` of `''`, which is the
 * attribute pair the screen writes today. (`scramble: ''` cannot be written literally — `checkScript`
 * refuses a scramble that names no moves, correctly: an empty alg is the absence of one.)
 *
 * On the SOLVE side an empty `setup` means something different and worse: `takeSetupAlg` refused the
 * inverse of the answer. The walk is still cross-checked and still right, but no alg from solved is
 * known to reach it — so the arrangement is loaded instead, because `scramble: ''` there would draw a
 * SOLVED cube under a scrambled walk.
 */
function opening(setup, from, scrambling) {
  if (setup) return { scramble: setup };
  if (scrambling) return {};
  // Neither a path nor an arrangement: there is no cube to open on, and a script that guessed one
  // would draw a walk over the wrong cube rather than draw nothing.
  return from ? { facelets: from } : null;
}
