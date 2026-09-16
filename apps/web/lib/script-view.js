// A script's cube, as a PURE FUNCTION OF POSITION. No DOM, no renderer, no clock.
//
// dev-docs/tutorial-capability-plan.md item 3.2; ADR 0005 decision 3. `lesson-schedule.js` answers
// the same question for a narrated episode and answers it in SECONDS, because an episode's other half
// is an audio track. A walk has no clock and a drill has no timeline, so the thing all three drivers
// share is a POSITION: how far through the script the child is. A driver's whole job is to decide
// which position that is — from a time, from an observed cube, from an answer — and this says what
// the picture at it must be.
//
// WHY PURE MATTERS HERE, exactly as it does for an episode: the same position must give the same cube
// whether it was reached by playing forward, by jumping, or by stepping back. Anything derived from
// "where the cube is now" cannot promise that, and a lesson that scrubs is a lesson that would break.
//
// A POSITION IS A STOP, not a token. `x y R` is one step of a walk (ADR 0004 decision 9), because a
// regrip changes nothing a child can observe; the element plays the group and the driver waits at the
// end of it. A step that is not a move — a paint, a hold, a round, a line of narration — is one
// position of its own.
import { STEP_CUES, checkScript } from './lesson-format.js';
import { CORNERS, EDGES, SOLVED, toFacelets } from './cube-pieces.js';
import { parse } from './cube-notation.js';
import { convertSelectors, faceTurnsOf, run } from './cube-moves.js';
import { readCube } from './cube-questions.js';
import { parseHighlight, pieceKey, resolveStickers, slotVector } from './cube-highlight.js';
import { CENTERS, CORNER_FACELETS, EDGE_FACELETS, FACE_LETTERS } from './cube-layout.js';
import { ask } from './script-questions.js';

const holdPair = (hold) => String(hold).split(' ');
const holdName = (pair) => pair.join(' ');

/** Does this move change the pieces relative to the centres? A regrip does not, so it is no stop. */
const movesPieces = (move) => faceTurnsOf(move).turns.some((t) => t.name);

/**
 * A move text as GROUPS of moves, one per stop: every regrip belongs to the turn it leads into, and a
 * trailing run of regrips is a stop of its own because the hold it leaves is what the step asked for.
 */
export function groupsOf(moves) {
  const groups = [];
  let current = [];
  for (const move of moves) {
    current.push(move);
    if (movesPieces(move)) { groups.push(current); current = []; }
  }
  if (current.length) groups.push(current);
  return groups;
}

/** A complete facelet string as the piece state it spells. Throws on one that does not spell pieces. */
export function stateFrom(facelets) {
  // THE CENTRES ARE THE FRAME. A cube's letters mean what its centres say they mean, so a string whose
  // centres are not U R F D L B does not state a cube in the frame a script writes one in — reading it as
  // pieces answered questions about a different cube, and the segment went on showing the string it was
  // given (found by a Codex audit, 2026-09-16).
  const centres = [...FACE_LETTERS].map((_, i) => facelets[CENTERS[i]]).join('');
  if (centres !== FACE_LETTERS) {
    throw new Error(`script-view: the centres read ${centres}, not ${FACE_LETTERS} — a cube is stated in its own frame, and how it is HELD is a hold step's business`);
  }
  const read = readCube(facelets);
  const state = { cp: [], co: [], ep: [], eo: [] };
  read.corners.forEach((r, slot) => {
    if (r.piece === null) throw new Error(`script-view: the cube does not say what is in ${r.slot}`);
    state.cp[slot] = CORNERS.indexOf(r.piece);
    state.co[slot] = r.twist;
  });
  read.edges.forEach((r, slot) => {
    if (r.piece === null) throw new Error(`script-view: the cube does not say what is in ${r.slot}`);
    state.ep[slot] = EDGES.indexOf(r.piece);
    state.eo[slot] = r.twist;
  });
  return state;
}

/**
 * Everything a script's positions are, worked out once.
 *
 * `positions[k]` is the cube at position k; `segments` are what the ELEMENT is given — a cube to load
 * and a sequence to play — and a new one begins wherever the script cuts to a different cube or a
 * different hold, because those are the two things an element cannot be told part way through a
 * sequence (its `orientation` is the hold at position 0, and its `alg` is played from the cube it was
 * loaded with).
 */
export function buildScript(script) {
  checkScript(script);
  const start = script.start ?? {};
  const startHold = holdPair(start.hold ?? 'U F');
  let hold = [...startHold];
  let state = start.facelets ? stateFrom(start.facelets) : SOLVED;
  let picture = null;

  // What the script opens on. A `scramble` is the child's letters, and its frame is discarded exactly as
  // the element discards one (ADR 0004 decision 8) — so the tokens it draws are what the element loads.
  let opening = '';
  if (start.scramble) {
    const loaded = run(parse(start.scramble), startHold, state);
    state = loaded.state;
    opening = loaded.drawn.join(' ');
  }

  const segments = [];
  const positions = [];
  const cues = new Map();                         // key -> { value, at }
  const openSegment = (fields) => {
    segments.push({ index: segments.length, from: positions.length, hold: holdName(hold), tokens: [], ...fields });
    return segments[segments.length - 1];
  };
  let segment = openSegment(start.facelets ? { facelets: start.facelets } : { scramble: opening });

  const record = (step, stepIndex, kind, { stop = null } = {}) => {
    positions.push(Object.freeze({
      index: positions.length,
      step: stepIndex,
      kind,
      stop,
      segment: segment.index,
      moves: segment.tokens.length,
      hold: holdName(hold),
      cube: picture ?? state,
      isPicture: picture !== null,
      cues: Object.freeze(Object.fromEntries([...cues].map(([k, v]) => [k, Object.freeze({ ...v })]))),
    }));
  };

  // Position 0: the script before anything has happened. A cue written on step 0 has not taken effect
  // here — it takes effect at step 0's own position, which is where the child is told about it.
  record(null, -1, 'start');

  script.steps.forEach((step, i) => {
    for (const key of STEP_CUES) {
      if (step[key] === undefined) continue;          // absent means unchanged, which is the whole of R9
      if (step[key] === null) cues.delete(key);
      else cues.set(key, { value: step[key], at: positions.length });
    }

    if (step.move !== undefined) {
      for (const group of groupsOf(parse(step.move))) {
        const landed = run(group, hold, state);
        state = landed.state;
        hold = [...landed.hold];
        segment.tokens.push(...landed.drawn);
        record(step, i, 'move', { stop: segment.tokens.length });
      }
      return;
    }

    if (step.setup !== undefined) {
      // A setup states the PIECES: the frame its rotations net is discarded (ADR 0004 decision 8), which
      // is exactly what the element does with a `scramble`, so the tokens go there unchanged.
      const opened = run(parse(step.setup), hold, SOLVED);
      state = opened.state;
      picture = null;
      segment = openSegment({ scramble: opened.drawn.join(' ') });
      record(step, i, 'setup');
      return;
    }

    if (step.cube !== undefined) {
      state = stateFrom(step.cube);
      picture = null;
      segment = openSegment({ facelets: step.cube });
      record(step, i, 'cube');
      return;
    }

    if (step.paint !== undefined) {
      picture = step.paint;
      segment = openSegment({ facelets: step.paint });
      record(step, i, 'paint');
      return;
    }

    if (step.hold !== undefined) {
      hold = holdPair(step.hold);
      // A hold is a CUT: the cube does not turn, so the element is re-loaded holding it the new way, and
      // the cube it is loaded with is whatever is in front of the child — stated as stickers, because
      // the moves that got here belong to the segment that is ending rather than the one beginning.
      segment = openSegment({ facelets: picture ?? toFacelets(state) });
      record(step, i, 'hold');
      return;
    }

    record(step, i, step.round !== undefined ? 'round' : 'say');
  });

  return Object.freeze({
    script,
    positions: Object.freeze(positions),
    segments: Object.freeze(segments.map((s) => Object.freeze({ ...s, alg: s.tokens.join(' '), tokens: Object.freeze([...s.tokens]) }))),
  });
}

/**
 * The whole picture at `position`, as plain data. No element is touched and no clock is read.
 *
 * Named for what it takes, because the episode runtime's `viewAt(schedule, t)` takes a TIME and the two
 * live side by side in `cube-kit.js`: one name for two different questions is how a caller ends up
 * asking the wrong one.
 *
 * A cue's value comes with WHERE IT TOOK EFFECT (`at`), and a selector that names a question is
 * resolved there — not here (ADR 0004 R9). That is the difference between "the piece this lesson is
 * about" and "whatever is in that slot now": a driver writes the resolved selector, and seeking away
 * and back cannot change which piece it names.
 */
export function viewAtPosition(built, position) {
  const k = Math.max(0, Math.min(Math.round(Number(position) || 0), built.positions.length - 1));
  const at = built.positions[k];
  const segment = built.segments[at.segment];
  const cues = {};
  for (const [key, cue] of Object.entries(at.cues)) {
    if (key === 'hl') cues[key] = elementSelector(built, cue);
    else if (key === 'focus') cues[key] = boundFocus(built, cue);
    else if (key === 'arrow') cues[key] = elementArrow(built, cue);
    // A trail's letters name pieces the way the child holds the cube, read where the cue was written.
    else if (key === 'trail') cues[key] = convertSelectors(String(cue.value), holdPair(built.positions[cue.at].hold));
    else cues[key] = cue.value;
  }
  return Object.freeze({
    position: k,
    last: built.positions.length - 1,
    step: at.step,
    kind: at.kind,
    hold: at.hold,
    cube: at.cube,
    isPicture: at.isPicture,
    segment: at.segment,
    // The hold the element is LOADED with — its `orientation` — which is the hold at the start of the
    // segment, not the hold now: a rotation inside the sequence turns the element's own frame, and
    // writing the current hold on top of that turns the cube twice (ADR 0004 R2).
    orientation: segment.hold,
    scramble: segment.scramble ?? null,
    facelets: segment.facelets ?? null,
    alg: segment.alg,
    moves: at.moves,
    cues: Object.freeze(cues),
    bound: at.cues,
  });
}

/**
 * A cue's selector as `<cubus-cube>` reads one: in the cube's OWN letters, a question answered.
 *
 * Everything is read at the position the cue TOOK EFFECT (R9). A script writes letters the way the
 * child holds the cube (ADR 0004 decision 6), and which faces those letters mean is fixed by the hold
 * when the lesson said them — a regrip later does not quietly move "the slot at your upper right" to a
 * different pair of faces. What stays positional stays positional: a `slot:` highlight names a place, and
 * the element lights whatever occupies it after every turn (decision 10).
 */
function elementSelector(built, cue) {
  const where = built.positions[cue.at];
  const hold = holdPair(where.hold);
  const text = String(cue.value);
  if (!text.startsWith('ask:')) return convertSelectors(text, hold);
  const answer = ask(text.slice(4), where.cube, hold);
  const named = answer.pieces.length ? answer.pieces.map((p) => `piece:${p}`) : (answer.slots ?? []).map((s) => `slot:${s}`);
  // An answer nothing can be lit for is `none`, never an empty string: the element reads an empty
  // selector as "no change", so a cue whose answer is empty would leave the last one glowing.
  return named.length ? convertSelectors(named.join(','), hold) : 'none';
}

/**
 * An `arrow` cue as the element reads one: the child's letter turned into the cube's own token, in the hold
 * where the cue was written — the same reading every move of a script gets. `next` is the element's own.
 */
function elementArrow(built, cue) {
  if (cue.value === 'next') return 'next';
  const where = built.positions[cue.at];
  return run(parse(cue.value), holdPair(where.hold), SOLVED).drawn[0];
}

/**
 * Every cubie of a cube as the selector resolvers read one: where it is, which piece it carries, and its
 * stickers — each one's colour (the face it belongs to) and the way it faces.
 *
 * Read off the STICKERS, which a state and a picture both have: the letter at a slot's k-th facelet is
 * the colour of the sticker facing that slot's k-th face. A picture's `?` is a sticker nobody can name.
 */
function selectablesOf(cube) {
  const read = readCube(cube);
  const facelets = typeof cube === 'string' ? cube : toFacelets(cube);
  const stickersAt = (slot, at) => at.map((f, k) => ({ face: facelets[f] === '?' ? null : facelets[f], dir: slot[k] }));
  const slots = [
    ...read.corners.map((r, i) => ({ r, at: CORNER_FACELETS[i] })),
    ...read.edges.map((r, i) => ({ r, at: EDGE_FACELETS[i] })),
  ].map(({ r, at }) => ({
    slot: r.slot, pos: slotVector(r.slot), piece: r.piece === null ? null : pieceKey(r.piece), stickers: stickersAt(r.slot, at),
  }));
  const centres = [...FACE_LETTERS].map((face, i) => {
    const letter = facelets[CENTERS[i]];
    return { slot: face, pos: slotVector(face), piece: letter === '?' ? null : letter, stickers: [{ face: letter === '?' ? null : letter, dir: face }] };
  });
  return [...slots, ...centres];
}

/**
 * A `focus` cue BOUND: the pieces its selector named at the position it took effect, as `piece:` tokens.
 *
 * Focus latches (ADR 0004 decision 10) — the element binds it where it is written and keeps naming those
 * pieces. A driver cannot promise to write it at that position: it seeks, it jumps, it lands cold in the
 * middle of a lesson. So the binding is done here, once, from the script, and what the element is handed
 * no longer depends on where the cube happens to be when it arrives. A slot a picture cannot read stays
 * a slot, because there is no piece to name.
 */
function boundFocus(built, cue) {
  const spec = elementSelector(built, cue);
  const { selectors } = parseHighlight(spec);
  if (!selectors.length) return spec;
  const cube = built.positions[cue.at].cube;
  const cubies = selectablesOf(cube);
  const { stickers } = resolveStickers(selectors, cubies);
  // Grouped by cubie: a cubie whose every sticker was named is bound as the whole PIECE, and one with
  // only some named is bound sticker by sticker, by colour — `piece:UF/F` — so a sticker focus follows
  // that sticker wherever its piece goes (plan item 4.1). A sticker or piece a picture cannot name stays
  // a position, because there is nothing to bind.
  const byCubie = new Map();
  for (const [i, j] of stickers) byCubie.set(i, [...(byCubie.get(i) ?? []), j]);
  const tokens = [...byCubie].flatMap(([i, js]) => {
    const c = cubies[i];
    if (js.length === c.stickers.length) return [c.piece === null ? `slot:${c.slot}` : `piece:${c.piece}`];
    return js.map((j) => {
      const st = c.stickers[j];
      return c.piece === null || st.face === null ? `slot:${c.slot}/${st.dir}` : `piece:${c.piece}/${st.face}`;
    });
  });
  return tokens.length ? tokens.join(',') : 'none';
}

/** Ask a named question of the cube at `position`, in the hold in force there. */
export function askAt(built, position, question) {
  const view = viewAtPosition(built, position);
  return ask(question, view.cube, holdPair(view.hold));
}
