// What a course lesson IS, on disk, and the refusal that stops a malformed one reaching a child.
//
// A lesson is an audio track plus a cube whose state is a pure function of `t`. That is why
// seeking works, and why re-recording the narration never invalidates a cue. The authoring side —
// the scores, the speech, the measured timings — belongs to cubus-im; this is the shape the two
// projects agree on, so an episode can be embedded in the app rather than shipped as a 7 MB
// self-contained page carrying its own copy of the renderer.
//
// EPISODE, not "lesson", everywhere in the app's own code. The app already has a `lesson`: a step
// of a solve with a reason attached (`lib/method-lesson.js`, and the ladder on the Lessons screen).
// A narrated seven-minute episode is a different thing, and the two would otherwise meet on one
// screen wearing one word. The FILES keep the course's spelling because they are the course's
// files; the boundary is here.
//
// Zero trust: this data crosses a project boundary, so it is validated rather than assumed. Every
// refusal names the cue it is about, because "invalid lesson" is not something anybody can act on.

import { sameAxis } from './cube-orientation.js';
import { parseHighlight } from './cube-highlight.js';
import { readToken } from './cube-notation.js';
import { readAsk } from './script-questions.js';
import { QUARTER_GAP } from './lesson-schedule.js';
import { faceletsError } from './cube-questions.js';

/** Cue fields that may carry a selector, an alg or a label. Everything else is refused. */
const CUE_KEYS = new Set([
  'say', 'hl', 'ghosts', 'cam', 'focus', 'number', 'counting', 'section', 'hold', 'camUp',
  'orientation', 'setup', 'quarters', 'move', 'secs', 'spanning', 'start', 'end',
]);

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Check an episode and return it, or throw naming what is wrong and where.
 *
 * Returns the SAME object rather than a copy: callers pass it straight to `buildSchedule`, and a
 * defensive copy here would only hide which one they were holding.
 */
export function checkEpisode(episode) {
  const where = (i, msg) => { throw new Error(`episode cue ${i}: ${msg}`); };
  if (!episode || typeof episode !== 'object') throw new Error('episode: expected an object');
  // An episode carries no `schema` — that field is how a SCRIPT says what it is (`checkScript`), and a
  // document that has one is not this kind of document. Refused here as well as in `checkLesson`,
  // because a caller holding this function directly would otherwise read a script's cue list as an
  // episode and play it with every step field silently ignored.
  if (episode.schema !== undefined) {
    throw new Error(`episode: carries \`schema\` ${JSON.stringify(episode.schema)} — read it with checkLesson()`);
  }
  const { cues } = episode;
  if (!Array.isArray(cues) || cues.length === 0) {
    throw new Error('episode: `cues` must be a non-empty array');
  }
  let last = -Infinity;
  cues.forEach((c, i) => {
    if (!c || typeof c !== 'object') where(i, 'expected an object');
    for (const k of Object.keys(c)) if (!CUE_KEYS.has(k)) where(i, `unknown field "${k}"`);
    if (typeof c.say !== 'string' || !c.say) where(i, '`say` must be a non-empty string');
    if (!isNum(c.start) || !isNum(c.end)) where(i, '`start` and `end` must be numbers');
    if (c.end < c.start) where(i, `ends (${c.end}) before it starts (${c.start})`);
    // Monotonic starts are what makes `lineAt` a scan rather than a search, and what makes a seek
    // land on exactly one line. Out of order they would silently overlap.
    if (c.start < last) where(i, `starts at ${c.start}, before the previous cue's ${last}`);
    last = c.start;
    if (c.quarters !== undefined) {
      if (!Array.isArray(c.quarters)) where(i, '`quarters` must be an array of moves');
      for (const q of c.quarters) {
        if (typeof q !== 'string' || !/^[URFDLB](2|')?$/.test(q)) {
          where(i, `"${q}" is not a face turn — the fixed frame takes URFDLB only, never a rotation`);
        }
      }
    }
    // A NAMED field is not a checked field. Every one of these passed the old "is the key allowed"
    // test and then failed somewhere the cue number was no longer available to blame:
    //   `setup: "banana"`  the renderer refuses the tokens and applies NO scramble, so the episode
    //                      silently opens on a solved cube instead of the position it describes
    //   `number: "six"`    reaches `BigInt()` and throws inside the player, mid-playback
    //   `ghosts: "false"`  is a truthy string, so it turns the ghosts ON
    if (c.setup !== undefined) {
      if (typeof c.setup !== 'string') where(i, '`setup` must be a string');
      const bad = c.setup.trim().split(/\s+/).filter(Boolean).filter((m) => !/^[URFDLB](2|')?$/.test(m));
      if (bad.length) where(i, `\`setup\` has moves the renderer cannot apply: ${bad.join(' ')}`);
    }
    if (c.secs !== undefined && (!isNum(c.secs) || c.secs <= 0)) where(i, '`secs` must be positive');
    if (c.number !== undefined && badCount(c.number)) where(i, badCount(c.number));
    if (c.ghosts !== undefined && badBoolean('ghosts', c.ghosts)) where(i, badBoolean('ghosts', c.ghosts));
    if (c.counting !== undefined && badBoolean('counting', c.counting)) where(i, badBoolean('counting', c.counting));
    for (const k of ['hl', 'focus', 'move', 'section', 'say', 'hold']) {
      if (c[k] !== undefined && typeof c[k] !== 'string') where(i, `\`${k}\` must be a string`);
    }
    if (c.spanning !== undefined) {
      where(i, '`spanning` is unresolved — run resolveSpanning() before the episode is played');
    }
    if (c.cam !== undefined && badCamera(c.cam)) where(i, badCamera(c.cam));
    if (c.orientation !== undefined && badPair(c.orientation)) {
      where(i, `"${c.orientation}" is not an orientation — ${badPair(c.orientation)}`);
    }
    if (c.camUp !== undefined && badFaceLetter(c.camUp)) where(i, badFaceLetter(c.camUp));
  });

  // A cue's turns are scheduled from its own end, so two cues whose windows overlap interleave
  // their moves in time while the player still applies them as a PREFIX of the algorithm. The
  // effect is silent and wrong: timestamps [1, 3, 5, 2.5] make the player apply `R U` at 2.6s
  // where the schedule says `R D`. Cheaper to refuse than to make the player order-aware.
  let reach = -Infinity;
  cues.forEach((c, i) => {
    // A `setup` starts a NEW position, and the previous position's remaining turns are discarded
    // rather than played — so they cannot overlap anything here. Carrying `reach` across that
    // boundary rejected a legitimate reset at 2s because a discarded sequence ran to 5s.
    if (c.setup !== undefined) reach = -Infinity;
    const qs = c.quarters || [];
    if (!qs.length) return;
    // The SCHEDULER'S gap, imported rather than typed again: this file decides whether an episode is
    // playable and `lesson-schedule.js` decides when its turns happen, so a default spelled out in both
    // is validation and playback drifting apart by a number nobody would think to change twice
    // (Codex audit, 2026-09-16).
    const step = c.secs ? c.secs / qs.length : QUARTER_GAP;
    if (c.end < reach) {
      where(i, `its turns start at ${c.end} while the previous cue's are still landing at ${reach}`);
    }
    reach = c.end + qs.length * step;
  });
  return episode;
}

/**
 * Resolve every `spanning n` into a wall-clock `secs`, now that the speech timings are known.
 *
 * This ran in cubus-im's builder, BEFORE its player ever saw the cues — so an app handed raw score
 * and timing files and told to "run the same player" would have produced a different schedule and
 * had no way to notice. Moving it here is what makes the two runtimes the same runtime.
 *
 * `spanning n` means "animate from the end of this line until the line n ahead of it starts", less
 * a short lead so the last turn has landed before the sentence that announces it. The floor is not
 * decoration: `spanning 1` buys only the gap between two lines, and the cube then flicks rather
 * than turning — a mistake that leaves every check green and is invisible in a build log.
 */
export const SPAN_LEAD = 0.30;
export const MIN_PER_MOVE = 0.12;

export function resolveSpanning(cues) {
  return cues.map((c, i) => {
    if (c.spanning === undefined) return c;
    const n = c.spanning;
    const j = i + n;
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(`episode cue ${i}: \`spanning\` must be a positive whole number of lines`);
    }
    if (j >= cues.length) {
      throw new Error(`episode cue ${i}: \`spanning ${n}\` runs past the end of the episode`);
    }
    if (!isNum(cues[j].start) || !isNum(c.end)) {
      throw new Error(
        `episode cue ${i}: \`spanning ${n}\` needs measured timings, and cue ${j} has none`,
      );
    }
    const secs = Math.round((cues[j].start - c.end - SPAN_LEAD) * 100) / 100;
    // `NaN <= 0` and `NaN / q < MIN` are both FALSE, so an unmeasured timing sailed through both
    // guards below and became `secs: NaN` — a cue that animates for no time at all.
    if (!Number.isFinite(secs) || secs <= 0) {
      throw new Error(`episode cue ${i}: \`spanning ${n}\` leaves ${secs}s — the lines are too short`);
    }
    const q = (c.quarters || []).length;
    if (q && secs / q < MIN_PER_MOVE) {
      throw new Error(
        `episode cue ${i}: \`spanning ${n}\` gives ${secs}s for ${q} moves — `
        + `${Math.round((secs / q) * 1000)}ms each, which is too fast to follow `
        + `(floor is ${MIN_PER_MOVE * 1000}ms)`,
      );
    }
    const { spanning, ...rest } = c;
    return { ...rest, secs };
  });
}

// ---- scripts (schema 2) --------------------------------------------------------------------------
//
// A SCRIPT is what a tutorial is for every stage and every driver: one cube, and an ordered list of
// STEPS written the way a child holds it (dev-docs/adr/0005-the-renderer-plays-scripts-methods-choose.md
// decision 3; plan item 3.1 of dev-docs/tutorial-capability-plan.md). An episode — today's narrated
// lesson, with its measured timings — is the same thing with a clock attached, and is still read by
// `checkEpisode`: a document with no `schema` is one of those, and nothing about it changes.
//
// WHY A LIST OF STEPS RATHER THAN A LIST OF LINES. An episode's cues are lines of narration that happen
// to carry turns, which is why its moves are `quarters` on a cue and its positions are wherever a
// `setup` appears. A walk has no narration and a drill has no timeline, and both are the same tutorial
// said differently. A step is the unit all three share: what the cube does, and what the lesson is
// saying about it while it does.
//
// FOUR THINGS A STEP CAN BE, and exactly one of them per step:
//
//   { move: "y R U R'" }   the child's letters, in the hold in force — rotations, slices and wide
//                          moves included (ADR 0004 decision 5)
//   { setup: "R U R'" }    a cut to a new cube: solved, then these moves in the cube's own frame
//   { cube: "UUU…" }       a cut to a stated cube, as 54 facelets
//   { paint: "UU?…" }      a PICTURE: what a cube looks like, `?` where nothing is claimed
//   { hold: "D B" }        a cut to a hold — how the cube is held from here, with no turn
//   { round: { … } }       a drill round (plan item 3.4)
//
// A PAINT IS NOT A STATE. A stage target and a half-read scan are pictures: they say what some
// stickers are and claim nothing about the rest, and no cube need exist that matches. So a paint
// begins a PICTURE SEGMENT which lasts until the next step that states a whole cube (`setup` or
// `cube`): inside it the view and every question are answered from the picture, and a MOVE IS
// REFUSED — turning a picture would be inventing the stickers it does not claim.
//
// A CUE TAKES EFFECT WHERE IT IS WRITTEN and holds until a later step says otherwise; `null` clears
// it. That is ADR 0004 R9: cubus-im's builder copies a persistent selector onto every cue it covers,
// so the player cannot tell "set here" from "still set" and re-binds an inherited `focus` at every
// line — which, since the element binds focus where it is written, lights a different piece each time.
// Here the copy never happens, so where a value took effect is where it appears.

/** What a step may say about the cube. Exactly one per step. */
export const STEP_KINDS = Object.freeze(['move', 'setup', 'cube', 'paint', 'hold', 'round']);

/** What a step may say about the LESSON, beside what the cube does. */
export const STEP_CUES = Object.freeze([
  'say', 'section', 'hl', 'focus', 'ask', 'ghosts', 'ghostElevation', 'cam', 'camUp',
  'number', 'counting', 'at', 'secs',
  // Phase 4's annotations, as they land (plan item 3.1): a turn arrow, the face letters, a piece's trail.
  'arrow', 'labels', 'trail',
]);

const STEP_KEYS = new Set([...STEP_KINDS, ...STEP_CUES]);
const FACELETS = /^[URFDLB]{54}$/;
/**
 * A field written as TEXT, or the reason it is not.
 *
 * `String(value)` validates what a value would look like rather than what it is, and hands the original
 * on unchanged: `{cube: ['UUU…']}` stringifies to a perfectly good facelet string, passed every check,
 * and crashed the cube reader a layer down (Codex audit, 2026-09-16). Asked before the contents are.
 */
const notText = (value) => (typeof value === 'string' ? null : `must be written as text, not ${Array.isArray(value) ? 'a list' : typeof value}`);
const PICTURE = /^[URFDLB?]{54}$/;

/**
 * The value rules an episode and a script BOTH have, written once.
 *
 * The two checkers grew the same camera, number, boolean, face-letter and orientation rules side by side,
 * and a change to one could leave validation disagreeing with playback (Codex audit, 2026-09-16). What
 * stays per format is what genuinely differs: a script may write `null` to clear a cue and an episode may
 * not, and their notation rules are their own. Each returns the reason, or null when there is none.
 */
const badCamera = (value) => (value === 'tour'
  || (Array.isArray(value) && value.length === 2 && value.every(isNum))
  ? null : '`cam` must be [latitude, longitude] or "tour"');
const badCount = (value) => (/^\d{1,3}(,\d{3})*$|^\d+$/.test(String(value))
  ? null : `\`number\` must be digits, optionally grouped: "${value}"`);
const badBoolean = (name, value) => (typeof value === 'boolean'
  ? null : `\`${name}\` must be true or false — a string is always truthy`);
const badFaceLetter = (value) => (/^[URFDLB]$/.test(value) ? null : `"${value}" is not a face letter`);
/** Two perpendicular faces — what a hold is, and what an orientation is. `sameAxis` rather than a second
 *  regex: "U D" passes every shape check anybody writes by hand and is not one, and the renderer refuses
 *  it for the same reason. */
const badPair = (value) => {
  if (notText(value)) return `${notText(value)}`;
  const [up, front] = value.split(' ');
  return /^[URFDLB] [URFDLB]$/.test(value) && !sameAxis(up, front)
    ? null : 'two perpendicular faces, as in "U F"';
};

/** A hold, as `checkEpisode` reads an orientation: two perpendicular faces of URFDLB. */
function badHold(value) {
  const wrong = badPair(value);
  return wrong === null ? null : `"${value}" is not a hold — ${wrong}`;
}

/**
 * Every move of `text` read through the notation, or the reason the first bad one is not a move.
 *
 * A `setup` and a `scramble` may contain rotations and slices, and the frame they net is DISCARDED:
 * they state the PIECES, relative to the centres, and how the cube is held is a `hold` step's business
 * (ADR 0004 decision 8, which is what `<cubus-cube>`'s `scramble` already does). That matters because
 * an insert is written the way it is taught — `y F' U' F U R U R' U' y'` — and refusing the rotations
 * in it would refuse the way every author writes one.
 */
function badMoves(text) {
  if (notText(text)) return notText(text);
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return 'names no moves';
  for (const token of tokens) {
    const { move, why } = readToken(token);
    if (!move) return `"${token}" is ${why}`;
  }
  return null;
}

/** A selector a cue may carry: the element's own grammar, or `ask:<question>` (plan item 3.1). */
function badSelector(value) {
  if (notText(value)) return `a selector ${notText(value)}`;
  const text = value;
  if (text.startsWith('ask:')) {
    const { why } = readAsk(text.slice(4));
    return why ? `\`${text}\`: ${why}` : null;
  }
  const { invalid } = parseHighlight(text);
  return invalid === null ? null : `"${invalid}" is not a selector`;
}

/**
 * Check a script and return it, or throw naming the step that is wrong.
 *
 * The same contract as `checkEpisode`: zero trust at the boundary, the SAME object back, and every
 * refusal says which step it is about — "invalid script" is not something anybody can act on.
 */
export function checkScript(script) {
  const where = (i, msg) => { throw new Error(`script step ${i}: ${msg}`); };
  if (!script || typeof script !== 'object') throw new Error('script: expected an object');
  if (script.schema !== 2) throw new Error(`script: expected schema 2, got ${JSON.stringify(script.schema)}`);
  const known = new Set(['schema', 'start', 'steps']);
  for (const k of Object.keys(script)) if (!known.has(k)) throw new Error(`script: unknown field "${k}"`);

  const start = script.start ?? {};
  if (typeof start !== 'object') throw new Error('script: `start` must be an object');
  for (const k of Object.keys(start)) {
    if (!['facelets', 'scramble', 'hold'].includes(k)) throw new Error(`script start: unknown field "${k}"`);
  }
  if (start.facelets !== undefined && faceletsError(start.facelets)) {
    throw new Error('script start: `facelets` must be 54 of URFDLB — a picture is a `paint` step');
  }
  if (start.scramble !== undefined) {
    const bad = badMoves(start.scramble);
    if (bad) throw new Error(`script start: \`scramble\` ${bad}`);
  }
  if (start.facelets !== undefined && start.scramble !== undefined) {
    throw new Error('script start: a cube is stated by `facelets` or reached by `scramble`, not both');
  }
  if (start.hold !== undefined) {
    const bad = badHold(start.hold);
    if (bad) throw new Error(`script start: ${bad}`);
  }

  const { steps } = script;
  if (!Array.isArray(steps) || steps.length === 0) throw new Error('script: `steps` must be a non-empty array');
  checkSteps(steps, where);
  return script;
}

/**
 * The cues any step may carry, checked where they are written.
 *
 * Split out of `checkSteps` (Codex audit, 2026-09-16), which was one function holding segment state, six
 * step kinds, recursive rounds, timing AND these — five jobs and a hundred lines. What stays in the caller
 * is the part with STATE: which segment we are inside, and how the times run. These are pure: a field, a
 * rule, a reason.
 */
function checkCues(step, i, where) {
  for (const k of ['say', 'section']) {
    if (step[k] !== undefined && step[k] !== null && typeof step[k] !== 'string') where(i, `\`${k}\` must be a string`);
  }
  for (const k of ['hl', 'focus']) {
    if (step[k] === undefined || step[k] === null) continue;
    if (typeof step[k] !== 'string') where(i, `\`${k}\` must be a string, or null to clear it`);
    const bad = badSelector(step[k]);
    if (bad) where(i, `\`${k}\`: ${bad}`);
  }
  if (step.ask !== undefined && step.ask !== null) {
    if (typeof step.ask !== 'string') where(i, '`ask` must be a string');
    const { why } = readAsk(step.ask);
    if (why) where(i, `\`ask\`: ${why}`);
  }
  if (step.arrow !== undefined && step.arrow !== null && step.arrow !== 'next') {
    // One move, in the child's letters like every move a script writes — or `next`, the move about to be made.
    if (notText(step.arrow)) where(i, `\`arrow\` ${notText(step.arrow)}`);
    const tokens = step.arrow.trim().split(/\s+/);
    if (tokens.length !== 1) where(i, `\`arrow\` is one move or "next", not "${step.arrow}"`);
    const bad = badMoves(step.arrow);
    if (bad) where(i, `\`arrow\` ${bad}`);
  }
  if (step.trail !== undefined && step.trail !== null && step.trail !== 'none') {
    if (notText(step.trail)) where(i, `\`trail\` ${notText(step.trail)}`);
    const bad = step.trail.split(',').map((t) => t.trim()).find((t) => !/^(piece|slot):[URFDLB]{2,3}$/i.test(t) || parseHighlight(t).invalid !== null);
    if (bad !== undefined) where(i, `\`trail\` names pieces — piece:UF or slot:UF — and "${bad}" is not one`);
  }
  if (step.labels !== undefined && step.labels !== null && !['none', 'position', 'face'].includes(step.labels)) {
    where(i, `\`labels\` is none, position or face, not "${step.labels}"`);
  }
  // The same rules the episode checker applies, with a script's own `null` rule in front of each: a
  // script writes `null` to CLEAR a cue, and an episode has no such value.
  if (step.ghosts !== undefined && step.ghosts !== null && badBoolean('ghosts', step.ghosts)) {
    where(i, badBoolean('ghosts', step.ghosts));
  }
  if (step.counting !== undefined && step.counting !== null && badBoolean('counting', step.counting)) {
    where(i, badBoolean('counting', step.counting));
  }
  if (step.ghostElevation !== undefined && step.ghostElevation !== null && !isNum(step.ghostElevation)) {
    where(i, '`ghostElevation` must be a number');
  }
  if (step.cam !== undefined && step.cam !== null && badCamera(step.cam)) {
    where(i, badCamera(step.cam));
  }
  if (step.camUp !== undefined && step.camUp !== null && badFaceLetter(step.camUp)) {
    where(i, badFaceLetter(step.camUp));
  }
  if (step.number !== undefined && step.number !== null && badCount(step.number)) {
    where(i, badCount(step.number));
  }
  if (step.secs !== undefined && (!isNum(step.secs) || step.secs <= 0)) where(i, '`secs` must be positive');
}

/** The step rules, shared by a script and by a round's reveal segment (plan item 3.4). */
function checkSteps(steps, where, { rounds = true, painted: startPainted = false } = {}) {
  let painted = startPainted;             // inside a picture segment?
  let last = -Infinity;                   // the last `at`, so a timed script cannot go backwards
  steps.forEach((step, i) => {
    if (!step || typeof step !== 'object') where(i, 'expected an object');
    for (const k of Object.keys(step)) if (!STEP_KEYS.has(k)) where(i, `unknown field "${k}"`);
    const kinds = STEP_KINDS.filter((k) => step[k] !== undefined);
    if (kinds.length > 1) where(i, `says ${kinds.join(' and ')}; a step is one of them`);
    // A step that does nothing to the cube is ordinary: most of a narrated lesson is a line being
    // said over a cube that is standing still, and a cue change is a step of its own. What is refused
    // is a step that says nothing at all, which is a typo rather than a pause.
    if (kinds.length === 0 && !STEP_CUES.some((k) => step[k] !== undefined)) {
      where(i, `says nothing — one of ${STEP_KINDS.join(', ')}, or a cue`);
    }
    const [kind] = kinds;

    if (kind === 'move') {
      if (typeof step.move !== 'string') where(i, '`move` must be a string');
      const bad = badMoves(step.move);
      if (bad) where(i, `\`move\` ${bad}`);
      // The picture segment's rule, and the reason it is a refusal rather than a best effort: a
      // picture claims nothing about the stickers it leaves unknown, so turning one would be
      // inventing them.
      if (painted) where(i, 'a move inside a picture segment — a picture is not a cube, and cannot be turned');
    }
    if (kind === 'setup' || kind === 'cube') painted = false;
    if (kind === 'setup') {
      if (typeof step.setup !== 'string') where(i, '`setup` must be a string');
      const bad = badMoves(step.setup);
      if (bad) where(i, `\`setup\` ${bad}`);
    }
    if (kind === 'cube') {
      // THE WHOLE CUBE, HERE. It was 54 letters of the right alphabet and nothing else, so `'U'.repeat(54)`
      // passed and `buildScript` threw about a slot — in a place that no longer knew which step it came
      // from (Codex audit, 2026-09-16). The same reader the builder uses says why, at the step that wrote it.
      const wrong = faceletsError(step.cube);
      if (wrong) where(i, `\`cube\` ${wrong} — a picture with unknowns is a \`paint\` step`);
    }
    if (kind === 'paint') {
      if (notText(step.paint) || !PICTURE.test(step.paint)) where(i, '`paint` must be 54 of URFDLB and `?`');
      painted = true;
    }
    if (kind === 'hold') {
      const bad = badHold(step.hold);
      if (bad) where(i, bad);
    }
    if (kind === 'round') {
      if (!rounds) where(i, 'a round inside a reveal — a reveal shows an answer, it does not ask again');
      // A prediction imagines a turn of the cube, and a picture is not a cube. Asked BEFORE the round's
      // own fields are read: its reveal is a segment of its own, and a round that turns a picture should
      // be refused for the turn it names rather than for the first move of the answer it would show.
      if (painted && step.round?.turn !== undefined) where(i, 'a round with a turn inside a picture segment — a picture cannot be turned, even in imagination');
      checkRound(step.round, (msg) => where(i, msg), { painted });
    }

    checkCues(step, i, where);
    // `at` is the one cue with STATE behind it, so it stays here with the rest of the walk: monotonic,
    // for the same reason an episode's cues are — a clock driver scans forward for the step a time is
    // inside, and out of order two steps would silently overlap.
    if (step.at !== undefined) {
      if (!isNum(step.at) || step.at < 0) where(i, '`at` must be a number of seconds');
      if (step.at < last) where(i, `is at ${step.at}, before the step before it at ${last}`);
      last = step.at;
    }
  });
}

/** The questions a round may be answered by: each names one slot or one piece, so its answer is faces. */
export const ROUND_QUESTIONS = Object.freeze(['whereIs', 'pieceIn']);

/** A drill round's shape; `lib/script-rounds.js` gives it its behaviour (plan item 3.4). */
function checkRound(round, where, { painted = false } = {}) {
  if (!round || typeof round !== 'object') where('`round` must be an object');
  const known = new Set(['say', 'turn', 'ask', 'choose', 'reveal']);
  for (const k of Object.keys(round)) if (!known.has(k)) where(`round: unknown field "${k}"`);
  if (round.say !== undefined && typeof round.say !== 'string') where('round: `say` must be a string');
  if (round.turn !== undefined) {
    if (typeof round.turn !== 'string') where('round: `turn` must be a string');
    const bad = badMoves(round.turn);
    if (bad) where(`round: \`turn\` ${bad}`);
  }
  if (typeof round.ask !== 'string') where('round: `ask` names the question the answer comes from');
  const { why, name, of } = readAsk(round.ask);
  if (why) where(`round: \`ask\`: ${why}`);
  // A round is answered by picking FACES — the centres a piece sits between — so its question must name
  // one place: where a piece is (after the turn, for a prediction), or which piece is in a slot.
  if (!ROUND_QUESTIONS.includes(name)) where(`round: \`ask\`: "${name}" is not answered by picking faces — a round asks ${ROUND_QUESTIONS.join(' or ')}`);
  if (!Number.isInteger(round.choose) || round.choose < 1) where('round: `choose` is how many answers, a whole number of them');
  if (round.choose !== of.length) where(`round: \`choose\` is ${round.choose}, and "${of}" is answered by ${of.length} faces`);
  if (round.reveal !== undefined) {
    if (!Array.isArray(round.reveal)) where('round: `reveal` must be an array of steps');
    // A reveal is a script segment, so it is checked by the same rules — minus rounds, because a
    // reveal shows the answer and cannot ask another question. It also INHERITS the picture segment it
    // sits in: a fresh check started `painted` at false, so a reveal with a move in it passed validation
    // inside a picture and then threw when the reveal was built, which is the one failure a checker
    // exists to move forward in time (Codex audit, 2026-09-16).
    checkSteps(round.reveal, (j, msg) => where(`round: reveal step ${j}: ${msg}`), { rounds: false, painted });
  }
}

/**
 * Read a lesson document of either kind: an episode (no `schema`) or a script (`schema: 2`).
 *
 * THE ONE DOOR, so a runtime cannot be handed a document of the wrong kind and quietly play it as the
 * other. A schema it does not know is refused rather than guessed at — a lesson written for a later
 * runtime would otherwise be played with its new fields silently ignored, which is the failure mode a
 * version number exists to prevent.
 */
export function checkLesson(doc) {
  const schema = doc?.schema;
  if (schema === undefined) return checkEpisode(doc);
  if (schema === 2) return checkScript(doc);
  throw new Error(
    `lesson: schema ${JSON.stringify(schema)} is not one this runtime knows `
    + '— no `schema` is an episode, 2 is a script',
  );
}
