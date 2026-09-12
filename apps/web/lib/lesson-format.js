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
    if (c.number !== undefined && !/^\d{1,3}(,\d{3})*$|^\d+$/.test(String(c.number))) {
      where(i, `\`number\` must be digits, optionally grouped: "${c.number}"`);
    }
    if (c.ghosts !== undefined && typeof c.ghosts !== 'boolean') {
      where(i, '`ghosts` must be true or false — a string is always truthy');
    }
    if (c.counting !== undefined && typeof c.counting !== 'boolean') where(i, '`counting` must be a boolean');
    for (const k of ['hl', 'focus', 'move', 'section', 'say', 'hold']) {
      if (c[k] !== undefined && typeof c[k] !== 'string') where(i, `\`${k}\` must be a string`);
    }
    if (c.spanning !== undefined) {
      where(i, '`spanning` is unresolved — run resolveSpanning() before the episode is played');
    }
    if (c.cam !== undefined && c.cam !== 'tour') {
      if (!Array.isArray(c.cam) || c.cam.length !== 2 || !c.cam.every(isNum)) {
        where(i, '`cam` must be [latitude, longitude] or "tour"');
      }
    }
    if (c.orientation !== undefined) {
      const [up, front] = String(c.orientation).split(' ');
      // `sameAxis` rather than a second regex: "U D" passes every shape check anybody writes by
      // hand and is not an orientation, and the renderer refuses it for the same reason. One
      // definition of what a legal pair is, shared with the thing that will have to draw it.
      if (!/^[URFDLB] [URFDLB]$/.test(c.orientation) || sameAxis(up, front)) {
        where(i, `"${c.orientation}" is not an orientation — two perpendicular faces, as in "U F"`);
      }
    }
    if (c.camUp !== undefined && !/^[URFDLB]$/.test(c.camUp)) {
      where(i, `"${c.camUp}" is not a face letter`);
    }
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
    const step = c.secs ? c.secs / qs.length : 0.55;
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
