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
 * Which side of the split `cube` falls on — a pure function of its name alone.
 *
 * The fraction is CHECKED rather than trusted. A NaN compares false against everything and would
 * put every cube in `train`; a negative one does the same; one above 1 holds everything out. All
 * three produce a split that looks like a split and measures nothing, and the number reaches here
 * from a script's argument.
 */
export function splitOf(cube: string, fraction = HELDOUT_FRACTION): Split {
  if (!(Number.isFinite(fraction) && fraction >= 0 && fraction <= 1)) {
    throw new RangeError(`a held-out fraction of ${fraction} is not between 0 and 1`);
  }
  return hashCube(cube) / 0x1_0000_0000 < fraction ? 'heldout' : 'train';
}

/** A loaded corpus: every session, and the cubes they belong to. */
export interface Corpus {
  sessions: RecordedSession[];
  /** Cube name → its sessions, in load order. */
  byCube: Map<string, RecordedSession[]>;
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
      const why = err instanceof SessionFormatError ? err.message : String(err);
      throw new SessionFormatError(`${source}: ${why}`);
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
  const byCube = new Map<string, RecordedSession[]>();
  for (const s of sessions) {
    const list = byCube.get(s.cube);
    if (list) list.push(s);
    else byCube.set(s.cube, [s]);
  }
  return { sessions, byCube };
}

/** The corpus's sessions on one side of the split. */
export function sessionsIn(
  corpus: Corpus,
  split: Split,
  fraction = HELDOUT_FRACTION,
): RecordedSession[] {
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

/** The plan's floor: at least five cubes and three lighting conditions (§4, Stage 0.3). */
export const MIN_CUBES = 5;
export const MIN_LIGHTINGS = 3;

export function describeCorpus(corpus: Corpus, fraction = HELDOUT_FRACTION): CorpusCoverage {
  const distinct = (pick: (s: RecordedSession) => string): string[] =>
    [...new Set(corpus.sessions.map(pick))].sort();
  const cubes = [...corpus.byCube.keys()];
  const cameras = distinct((s) => s.conditions.camera);
  const lightings = distinct((s) => s.conditions.lighting);
  const shortfalls: string[] = [];
  if (cubes.length < MIN_CUBES) {
    shortfalls.push(`${cubes.length} of ${MIN_CUBES} cubes`);
  }
  if (lightings.length < MIN_LIGHTINGS) {
    shortfalls.push(`${lightings.length} of ${MIN_LIGHTINGS} lighting conditions`);
  }
  const heldOut = cubes.filter((c) => splitOf(c, fraction) === 'heldout');
  if (heldOut.length === 0 && cubes.length > 0) {
    shortfalls.push('no cube is held out, so nothing can be measured out of sample');
  }
  const withPixels = corpus.sessions.filter((s) =>
    s.frames.every((f) => f.pixels !== undefined),
  ).length;
  if (withPixels === 0 && corpus.sessions.length > 0) {
    shortfalls.push('no session carries pixels, so camera and model changes cannot be replayed');
  }
  return {
    sessions: corpus.sessions.length,
    cubes: cubes.length,
    heldOutCubes: heldOut.length,
    cameras,
    lightings,
    handling: distinct((s) => s.conditions.handling),
    states: distinct((s) => s.conditions.state),
    withPixels,
    shortfalls,
  };
}
