/**
 * The corpus of recorded scans, and the split every measurement is taken across
 * (`dev-docs/scan-pipeline-audit-2026-09-23.md` §4, Stage 0.3).
 *
 * WHOLE CUBES ARE HELD OUT, NOT FRAMES, AND NOT SESSIONS. Frames inside one session are strongly
 * correlated — the 09-18 clip measured P(next fit ok | ok) = 0.971 — and two sittings with the same
 * physical cube share its logo, its wear and its colours, which are exactly the properties a fix
 * for "this cube" overfits to. A split that put one sitting of a cube in train and another in test
 * would report a score the next real cube does not reproduce, and the history in §1.1 is six fixes
 * that each scored well on the cube that motivated them.
 *
 * THE SPLIT IS DETERMINISTIC AND CONTENT-ADDRESSED. It is a hash of the cube's name, not a shuffle
 * with a seed and not the order the files happen to sit in: adding a session must not move an
 * existing cube across the boundary, or every number ever measured against the corpus becomes
 * incomparable with the next one. Adding a new CUBE assigns only that cube.
 */

import { parseSession, type RecordedSession, SessionFormatError } from './session-record.js';

/** Which side of the split a cube is on. */
export type Split = 'train' | 'heldout';

/**
 * The fraction of cubes held out.
 *
 * A third, not a tenth: the corpus is small — the plan's floor is five cubes — and a tenth of five
 * cubes is a held-out set that rounds to nothing. It is stated here so a run can say which fraction
 * it measured against rather than leaving it implicit in a script.
 */
export const HELDOUT_FRACTION = 1 / 3;

/**
 * FNV-1a over the cube's name, as an unsigned 32-bit integer.
 *
 * Any stable hash would do; what matters is that it is written HERE rather than taken from a
 * platform's, so the split cannot change under the corpus when a runtime updates. Re-deriving a
 * measurement is worthless if the thing it was measured over moved.
 */
export function hashCube(cube: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < cube.length; i++) {
    h ^= cube.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * The fraction is CHECKED rather than trusted. A NaN compares false against everything and would
 * put every cube in `train`; a negative one does the same; one above 1 holds everything out. All
 * three produce a split that looks like a split and measures nothing, and the number reaches here
 * from a script's argument.
 *
 * IT IS ITS OWN FUNCTION, AND EVERY PUBLIC ENTRY CALLS IT BEFORE ITERATING (2026-09-25). The check
 * used to live inside `splitOf` alone, which every caller reached through a filter callback — so an
 * EMPTY corpus never ran the callback and `sessionsIn(empty, 'train', NaN)` and
 * `describeCorpus(empty, NaN)` both returned normally. A validity check a caller can skip by
 * handing over less data is not a validity check.
 */
function checkFraction(fraction: number): void {
  if (!(Number.isFinite(fraction) && fraction >= 0 && fraction <= 1)) {
    throw new RangeError(`a held-out fraction of ${fraction} is not between 0 and 1`);
  }
}

/** Which side of the split `cube` falls on — a pure function of its name alone. */
export function splitOf(cube: string, fraction = HELDOUT_FRACTION): Split {
  checkFraction(fraction);
  return hashCube(cube) / 0x1_0000_0000 < fraction ? 'heldout' : 'train';
}

/**
 * A loaded corpus: the validated sittings, and nothing else.
 *
 * ONE REPRESENTATION, BECAUSE TWO CAN DISAGREE (2026-09-25). This used to carry a `byCube` index
 * beside `sessions`, and both were publicly mutable: clearing `sessions` left coverage reporting
 * zero sessions and five cubes, and editing one session's `cube` invalidated the index silently.
 * Nothing outside this module ever read the index — only `describeCorpus` did — so the fix is to
 * delete the second copy rather than to guard it, and to derive the grouping where it is needed
 * (`cubesOf`). Deriving cannot drift.
 *
 * Frozen down to each session, so the remaining representation cannot be edited under a
 * measurement either: `readonly` is a compile-time promise, and a corpus is handed to scripts.
 */
export interface Corpus {
  readonly sessions: readonly RecordedSession[];
}

/** The distinct cubes the corpus holds, sorted — derived, never stored. */
export function cubesOf(corpus: Corpus): string[] {
  return [...new Set(corpus.sessions.map((s) => s.cube))].sort();
}

/**
 * Build a corpus from already-parsed session values, checking each and refusing the set that
 * cannot be measured over.
 *
 * `source` names where a value came from — a path, usually — so a malformed entry names its file
 * rather than its index in an array nobody can see.
 */
export function loadCorpus(entries: readonly { source: string; value: unknown }[]): Corpus {
  const sessions: RecordedSession[] = [];
  const seen = new Map<string, string>();
  for (const { source, value } of entries) {
    let session: RecordedSession;
    try {
      session = parseSession(value);
    } catch (err) {
      // A MALFORMED ENTRY AND A BROKEN PARSER ARE DIFFERENT FINDINGS, and the catch-all used to
      // report both as the first: a `TypeError` from a parser defect arrived as a
      // `SessionFormatError` naming a file that was perfectly good, with the original type and
      // stack gone. The expected failure keeps its type and gains the source; anything else keeps
      // its own type as the `cause` of an error that says plainly it was not a format problem.
      if (err instanceof SessionFormatError) {
        throw new SessionFormatError(`${source}: ${err.message}`, { cause: err });
      }
      throw new Error(`${source}: the session parser failed unexpectedly`, { cause: err });
    }
    // A duplicated id is two recordings claiming to be the same sitting. Counting both would weight
    // one sitting twice in every average and in the wrong-cube bound, which is the kind of quiet
    // corruption a corpus must never absorb.
    const already = seen.get(session.id);
    if (already !== undefined) {
      throw new SessionFormatError(
        `${source}: session id ${JSON.stringify(session.id)} is already used by ${already}`,
      );
    }
    seen.set(session.id, source);
    sessions.push(session);
  }
  // Frozen, not merely typed `readonly`: the type is erased at runtime and a corpus is handed to
  // scripts. Each session too, because it is `session.cube` that an index would have gone stale on.
  //
  // DEEPLY, and this was a one-level freeze until 2026-09-26 (Codex audit). The claim above is the
  // whole point of freezing here — the corpus is the instrument every later number is measured with
  // — and `session.truth.facelets = 'bad'` or a detection score set to NaN went straight through it,
  // one level down. A corpus that can be edited after validation is not validated.
  for (const s of sessions) deepFreeze(s);
  return Object.freeze({ sessions: Object.freeze(sessions) as readonly RecordedSession[] });
}

/**
 * Freeze `value` and everything reachable from it.
 *
 * TYPED ARRAYS ARE LEFT ALONE, and not as an oversight: `Object.freeze` THROWS on an array-buffer
 * view that has elements, because its indices are not configurable. Detection data arrives as
 * `Float32Array`, so a naive deep freeze crashes on the first real session. The buffer stays
 * writable; what this protects is the SHAPE of the record and every scalar in it.
 *
 * `seen` guards a cycle. A recorded session is a tree today, and a deep freeze that assumes so for
 * ever is the kind of assumption that turns into a stack overflow at load.
 */
function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object') return value;
  if (ArrayBuffer.isView(value)) return value;
  const obj = value as unknown as object;
  if (seen.has(obj)) return value;
  seen.add(obj);
  for (const key of Object.keys(obj)) {
    deepFreeze((obj as Record<string, unknown>)[key], seen);
  }
  return Object.freeze(value);
}

/** The corpus's sessions on one side of the split. */
export function sessionsIn(
  corpus: Corpus,
  split: Split,
  fraction = HELDOUT_FRACTION,
): RecordedSession[] {
  checkFraction(fraction);
  return corpus.sessions.filter((s) => splitOf(s.cube, fraction) === split);
}

/**
 * What the corpus covers, and what it does not — the honest description of an instrument.
 *
 * Reported before any measurement taken over it, because every number the harness produces is
 * conditional on this: "completion rose to 95%" over a corpus of one cube in one light is a
 * statement about one cube in one light, and the history in §1.1 is what happens when that
 * distinction is left implicit.
 */
export interface CorpusCoverage {
  sessions: number;
  cubes: number;
  heldOutCubes: number;
  cameras: string[];
  lightings: string[];
  handling: string[];
  states: string[];
  /**
   * Sessions EVERY frame of which carries pixels — the only ones a camera or model experiment can
   * replay end to end.
   *
   * Every, not some: a session with pixels on a handful of frames cannot be re-read by another
   * detector, and counting it here would report a corpus as ready for the experiment that is the
   * whole reason pixels are kept.
   */
  withPixels: number;
  /** Which of the plan's Stage 0.3 floors this corpus does not yet meet. Empty when it meets them. */
  shortfalls: string[];
}

/**
 * The plan's floor (§4, Stage 0.3): five cubes, three lightings, three cameras, and both handling
 * conditions.
 *
 * THE LAST TWO WERE PROMISED AND NOT CHECKED until 2026-09-25. The fixture note has said "five
 * cubes, three lightings, three cameras, careful and careless handling" since the corpus existed,
 * and `describeCorpus` measured the first two — so five cubes across three lightings on ONE camera
 * with careful handling only reported `shortfalls: []` and read as a corpus that met the floor. A
 * floor nothing measures is not a floor, and this is the instrument whose whole job is to say what
 * it cannot measure.
 */
export const MIN_CUBES = 5;
export const MIN_LIGHTINGS = 3;
export const MIN_CAMERAS = 3;
export const HANDLING_NEEDED = ['careful', 'careless'] as const;

/** What the coverage numbers say is missing — the policy, separated from gathering them. */
function shortfallsOf(cover: Omit<CorpusCoverage, 'shortfalls'>, trainCubes: number): string[] {
  const out: string[] = [];
  if (cover.cubes < MIN_CUBES) out.push(`${cover.cubes} of ${MIN_CUBES} cubes`);
  if (cover.lightings.length < MIN_LIGHTINGS) {
    out.push(`${cover.lightings.length} of ${MIN_LIGHTINGS} lighting conditions`);
  }
  if (cover.cameras.length < MIN_CAMERAS) {
    out.push(`${cover.cameras.length} of ${MIN_CAMERAS} cameras`);
  }
  const missing = HANDLING_NEEDED.filter((h) => !cover.handling.includes(h));
  if (missing.length > 0) out.push(`no ${missing.join(' or ')} handling`);
  // BOTH SIDES OF THE SPLIT, not just the held-out one (2026-09-25). `fraction = 1` put all five
  // cubes in held-out and still reported no shortfall, and the default fraction does the same to a
  // small corpus whose names happen to hash low. A corpus with nothing to fit on measures as little
  // as one with nothing to test on.
  if (cover.cubes > 0 && cover.heldOutCubes === 0) {
    out.push('no cube is held out, so nothing can be measured out of sample');
  }
  if (cover.cubes > 0 && trainCubes === 0) {
    out.push('every cube is held out, so nothing is left to develop against');
  }
  if (cover.withPixels === 0 && cover.sessions > 0) {
    out.push('no session carries pixels, so camera and model changes cannot be replayed');
  }
  return out;
}

export function describeCorpus(corpus: Corpus, fraction = HELDOUT_FRACTION): CorpusCoverage {
  checkFraction(fraction);
  const distinct = (pick: (s: RecordedSession) => string): string[] =>
    [...new Set(corpus.sessions.map(pick))].sort();
  const cubes = cubesOf(corpus);
  const heldOut = cubes.filter((c) => splitOf(c, fraction) === 'heldout');
  const cover = {
    sessions: corpus.sessions.length,
    cubes: cubes.length,
    heldOutCubes: heldOut.length,
    cameras: distinct((s) => s.conditions.camera),
    lightings: distinct((s) => s.conditions.lighting),
    handling: distinct((s) => s.conditions.handling),
    states: distinct((s) => s.conditions.state),
    withPixels: corpus.sessions.filter((s) => s.frames.every((f) => f.pixels !== undefined)).length,
  };
  return { ...cover, shortfalls: shortfallsOf(cover, cubes.length - heldOut.length) };
}
