// A course, as the app asks about it: what episodes are there, and give me that one.
//
// Two questions and no third. This module does not draw, does not choose what to teach, and knows
// nothing about a cube — it is the door the course comes through, and the place a document that is
// not a course is refused before anything tries to play it (ADR 0006 decision 1; the plan's
// `dev-docs/course-and-drills-plan.md` item 1.1).
//
// ASYNCHRONOUS BY SIGNATURE, even where the answer is already in hand. ADR 0006 decision 4 leaves
// how a course reaches a device undecided — a directory bundled into the installer, a pack
// downloaded once, a local path in development — and a synchronous catalogue would quietly decide
// it, because the only delivery a synchronous answer can express is one whose bytes are already in
// memory. The course measures 70.6 MiB of audio. So the seam is async from the first line, and the
// decision stays open at no cost.
//
// THE CATALOGUE DOES NOT READ EPISODES, which is one design answering two requirements. Listing
// seventeen lessons must not cost seventeen documents (the 70.6 MiB again), and an episode that
// fails validation must not remove the other sixteen from the list — so validation happens when an
// episode is ASKED FOR, never when the shelf is read.
//
// Validation is `lesson-format.js`'s one door, `checkLesson`: no `schema` is an episode, `2` is a
// script, anything else is refused rather than guessed at. Nothing here re-implements a rule that
// file already owns.

import { checkLesson } from './lesson-format.js';

/**
 * Why a course document is not available. Three, because a screen does something different with
 * each: `unknown` means look at the shelf again, `unreadable` means the bytes did not arrive, and
 * `malformed` means they arrived and are not a lesson.
 */
export const REFUSALS = Object.freeze(['unknown', 'unreadable', 'malformed']);

/**
 * Bytes that ARRIVED and are not a lesson -- a body that is not JSON, or one that decoded to nothing. A
 * reader throws this so the source can say `malformed` (they arrived) rather than `unreadable` (they did
 * not); every other throw from a reader is a transfer that failed. Merging the two told a person to check
 * their connection about a file that was simply broken (audit, 2026-09-21).
 */
/** The refusal for an id that is not an episode id -- or null for one that is. ONE rule, used by the source's
 *  door and by the session's, which had each written the condition, reason and words out for themselves. */
export function episodeIdRefusal(id) {
  return isEpisodeId(id) ? null : new CourseRefusal('unknown', id, 'is not an episode id, so nothing was asked for');
}

export class CourseContentError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'CourseContentError';
  }
}

/**
 * How long a course fetch may take before it is a hang rather than a wait.
 *
 * A network call somebody is waiting on needs a bound AND a visible pulse; either alone still reads
 * as stuck. This is the bound — without it a stalled catalogue leaves the shelf on "Looking…" for
 * ever, with nothing anybody can act on. The same rule the updater's download already answers to.
 */
export const COURSE_TIMEOUT_MS = 15_000;

/**
 * A refusal that names the episode and carries what was actually wrong.
 *
 * A typed error rather than a null, because the three reasons are not interchangeable and a screen
 * that cannot tell them apart can only say "something went wrong" — which is the sentence this
 * repository exists to not print. The message keeps the validator's own words, because those name
 * the CUE, and "invalid lesson" is not something anybody can act on.
 */
export class CourseRefusal extends Error {
  constructor(reason, episode, detail, { cause } = {}) {
    super(`course: episode ${JSON.stringify(episode)} ${detail}`, cause ? { cause } : undefined);
    this.name = 'CourseRefusal';
    this.reason = reason;
    this.episode = episode;
  }
}

/**
 * What an episode id may look like, and therefore what may be pasted into a URL by `fetchCourse`.
 *
 * Zero trust at the boundary: an id is whatever the caller had — a stored value, a hash, something
 * a child's finger landed on — and `..%2F..%2Fetc` is a perfectly good string. Constraining the
 * SHAPE here means the fetch reader can build a path without a traversal check of its own, and it
 * is also what makes "a malformed id never reaches the catalogue" true by construction rather than
 * by a screen remembering to ask. cubus-im's ids look like `11-the-middle-layer`.
 */
const VALID_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Is `id` a usable episode id? Exported because a screen may want to check before it asks. */
export const isEpisodeId = (id) => typeof id === 'string' && VALID_ID.test(id);

/**
 * One catalogue entry, checked. `title` is the reader's if it supplied one and the id otherwise —
 * never invented, and never prettified here: a title is authored text and authored text is the
 * course's (ADR 0006 decision 7), so this module passes it through and writes none of its own.
 */
function entryOf(raw, index) {
  const id = raw?.id;
  if (!isEpisodeId(id)) {
    throw new Error(
      `course: catalogue entry ${index} has no usable id (${JSON.stringify(id)}) — ` +
        'an id is lower-case words joined by hyphens, like "11-the-middle-layer"',
    );
  }
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title : id;
  return Object.freeze({ id, title });
}

/**
 * Where a lesson's audio lives, as the course states it — or nothing, if it may not be used.
 *
 * A top-level `audio` on the episode document. `checkEpisode` governs CUES and tolerates a document
 * carrying other top-level fields, so this needs no format change — but it lives HERE, at the door,
 * because it is validation of untrusted course data and not a screen's preference.
 *
 * RELATIVE ONLY. The value is assigned to a media element that preloads, so an absolute URL, a
 * protocol-relative `//host/…`, or a `data:` / `javascript:` scheme would let a document choose what
 * the app fetches merely by being opened. A leading `/` is refused too: it escapes the course's own
 * directory. ADR 0006 decision 4 defers where a course comes FROM; it does not hand that choice to
 * the file. Anything refused here is no audio at all, and the screen then says plainly that there is
 * nothing to play.
 */
export function courseAudioRef(episode) {
  return courseRef(episode?.audio);
}

/**
 * Any reference a course document makes to a file of its own — an episode's `audio`, a script step's
 * `voice` — held inside the course's directory, or nothing.
 *
 * ONE DOOR for every such field (ADR 0007): a second copy of this function for recordings would be a
 * second place for the two bypasses recorded below to come back through.
 */
export function courseRef(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  // THE URL PARSER IS THE ORACLE, not a pattern of mine. Two attempts at this were wrong in
  // opposite directions and both were caught by review:
  //
  //   1. A BLACKLIST (no scheme, no `//`, no leading `/`) was beaten by `\\host\file` — browsers
  //      treat backslashes as slashes — and by `ht\ntps://host/file`, where an embedded newline
  //      survives `trim()` and is then ignored by the parser. Both reached external HTTPS.
  //   2. An ALLOW-LIST of word characters rejected `./audio/lesson.m4a`, any filename with a space
  //      or a `%20`, every non-ASCII name, and query strings — all of them legitimate references
  //      inside the course's own directory. The screen then said the lesson had no audio, which is
  //      a false statement produced by a guard being too clever.
  //
  // Resolving against a sentinel base and checking where it LANDS answers both: whatever tricks
  // the string plays, the question is only ever "did it stay inside the course directory", and the
  // parser that the browser will use is the one that decides.
  //
  // TWO SENTINELS, WITH NO NAME IN COMMON. One sentinel directory could be NAMED by the reference:
  // `/root/a.m4a` (absolute), `../root/a.m4a` (climbs out and back) and `https://course.invalid/root/a.m4a`
  // all landed under `/root/` and were handed back raw, to escape the real course directory wherever a
  // reader has no `resolve` (audit, 2026-09-21). A string cannot name two unrelated directories on two
  // origins at once, so only a reference that is genuinely relative, and climbs nowhere, lands in both.
  // And the two sentinels differ in SCHEME: a reference that names the scheme of the base it is resolved
  // against is RELATIVE to the parser — `https:audio/a.m4a` against an https base is that base's
  // `audio/a.m4a` — so with both sentinels https it passed, and a page served over http resolved it to
  // `https://audio/a.m4a` (verify pass, 2026-09-21). A string names one scheme at most, so against the
  // other sentinel it is absolute, on another origin, and refused.
  //
  // An ENCODED separator is refused on the PARSED path, not the raw string. `%2F` and `%5C` are not
  // separators to `new URL`, so `..%2F..%2Fx` looks contained -- but a server that percent-decodes before
  // resolving sees `../../x`. Checked after parsing because the parser DROPS tabs and newlines: the raw
  // `..%2\nf..%2\nfx` passed a check on the string and became `..%2f..%2fx` (audit, 2026-09-21).
  for (const base of ['https://one.course.invalid/a/b/', 'http://two.course.invalid/c/d/']) {
    const root = new URL(base);
    let resolved;
    try {
      resolved = new URL(raw, root);
    } catch {
      return '';
    }
    if (resolved.origin !== root.origin) return '';                  // changed host, or a scheme
    if (!resolved.pathname.startsWith(root.pathname)) return '';     // climbed out, or an absolute path
    if (resolved.pathname === root.pathname) return '';              // the directory itself
    if (/%2f|%5c/i.test(resolved.pathname)) return '';               // an encoded separator
  }
  return raw;
}

/**
 * Where a lesson's audio actually is, as a URL the app may load.
 *
 * A reference is relative to the COURSE, and only the reader knows where the course is — so the
 * resolution is asked of it. Without this, `audio/lesson.m4a` resolved against the PAGE: an app at
 * `/index.html` with its course at `/course/` requested `/audio/lesson.m4a`, which is both the wrong
 * file and outside the course directory. A reader with no `resolve` hands back the reference
 * unchanged, which is what a bundled course beside the page wants.
 */
export function resolveCourseAudio(reader, episode) {
  return resolveCourseRef(reader, episode?.audio);
}

/** Where any course-relative reference actually is, as a URL the app may load — or nothing. */
export function resolveCourseRef(reader, value) {
  const ref = courseRef(value);
  if (!ref) return '';
  try {
    return typeof reader?.resolve === 'function' ? reader.resolve(ref) : ref;
  } catch {
    return '';
  }
}


/**
 * A course over a reader.
 *
 * The reader is the whole of the delivery question, and it is two functions: `list()` resolves to
 * the catalogue's raw entries, and `read(id)` resolves to one document — or to `null`/`undefined`
 * when there is no such episode, which is how "unknown" reaches here without every reader inventing
 * its own error for it.
 */
export function createCourseSource({ list, read, resolve } = {}) {
  if (typeof list !== 'function' || typeof read !== 'function') {
    throw new Error('course: a source needs a reader with list() and read()');
  }

  return Object.freeze({
    /**
     * Where a course-relative reference lands — the reader's answer, because only the reader knows
     * where the course IS. Absent when the reader has no opinion, which is what a course sitting
     * beside the page wants: the reference is already relative to the right place.
     */
    resolve: typeof resolve === 'function' ? resolve : undefined,
    /**
     * Every episode there is, in the reader's order.
     *
     * A listing that is not an array, or that names one episode twice, is refused whole — a
     * duplicate id is not a near-miss to resolve but a catalogue contradicting itself, and
     * `new Map(pairs)` would have picked one by array order (the reasoning `indexChallenges` in
     * `optimal-challenges.js` already paid for). An empty catalogue is NOT an error: it is what a
     * build with no course installed has, and it is the ordinary case this app must handle well.
     */
    async catalogue() {
      const raw = await list();
      if (!Array.isArray(raw)) {
        throw new Error('course: the catalogue did not come back as a list');
      }
      const entries = raw.map(entryOf);
      const seen = new Set();
      for (const { id } of entries) {
        if (seen.has(id)) throw new Error(`course: the catalogue names ${JSON.stringify(id)} twice`);
        seen.add(id);
      }
      return Object.freeze(entries);
    },

    /**
     * One episode, validated, or a `CourseRefusal` saying which of the three things went wrong.
     *
     * The document is returned as `checkLesson` returns it — the SAME object, not a copy, which is
     * that function's stated contract so a caller cannot end up holding a different one from the
     * one that was checked.
     */
    async episode(id) {
      const notAnId = episodeIdRefusal(id);
      if (notAnId) throw notAnId;
      let doc;
      try {
        doc = await read(id);
      } catch (cause) {
        if (cause instanceof CourseContentError) {
          throw new CourseRefusal('malformed', id, `is not a lesson — ${cause.message}`, { cause });
        }
        throw new CourseRefusal('unreadable', id, `could not be read — ${cause?.message ?? cause}`, { cause });
      }
      if (doc === null || doc === undefined) {
        throw new CourseRefusal('unknown', id, 'is not in this course');
      }
      try {
        return checkLesson(doc);
      } catch (cause) {
        // The validator's message names the cue. Keeping it is the whole point: a refusal a person
        // can act on says which line of which lesson, not that a lesson was bad.
        throw new CourseRefusal('malformed', id, `is not a lesson — ${cause?.message ?? cause}`, { cause });
      }
    },
  });
}

/**
 * The course a build with no course installed has: nothing on the shelf, and every ask refused.
 *
 * A real source rather than a null anybody has to remember to check, so the Course screen runs one
 * code path whether or not a course exists — which is ADR 0006 decision 3 (never a mode) expressed
 * as a value rather than as a rule people have to keep.
 */
export const EMPTY_COURSE = createCourseSource({
  list: async () => [],
  read: async () => null,
});

/**
 * A reader that fetches a course over HTTP, from wherever `base` points.
 *
 * `fetch` is injectable for the reason `loadChallenges` records: Node's fetch cannot read a `file:`
 * URL, so without the seam the one function the app actually calls would be the one function
 * nothing exercises — and an injected fetch is also how a course is loaded from somewhere else
 * entirely, which is the delivery decision this module refuses to foreclose.
 *
 * A 404 is `null` (there is no such episode) and every other bad status throws (something is
 * wrong). Those are different facts and a screen treats them differently, so they are not merged.
 */
export function fetchCourse({
  base,
  fetch: get = globalThis.fetch,
  timeoutMs = COURSE_TIMEOUT_MS,
  baseURI = globalThis.document?.baseURI ?? globalThis.location?.href ?? null,
} = {}) {
  if (!base) throw new Error('course: fetchCourse needs a base URL');
  if (typeof get !== 'function') throw new Error('course: fetchCourse needs a fetch');
  // RESOLVED AGAINST THE DOCUMENT, not against a hardcoded host. `new URL('/course/',
  // 'http://localhost')` silently rewrites a relative base onto localhost with no port, so a dev
  // server on :15173 and any deployed origin both fetched the wrong place. A relative base with no
  // document to resolve against is refused rather than guessed at.
  let root;
  try {
    root = baseURI ? new URL(String(base), baseURI) : new URL(String(base));
  } catch {
    throw new Error(`course: "${base}" is a relative base and there is no document to resolve it against`);
  }
  // A DIRECTORY, normalised after parsing. Appending `/` to the whole string put it inside a query or a
  // fragment -- `…/course?version=1` became `?version=1/`, and the index was then fetched from the
  // origin's root (audit, 2026-09-21). A base is where a course IS; a query or fragment names no directory.
  // Asked of the HREF, not of `search` and `hash`: an EMPTY query or fragment (`…/course?`, `…/course#`)
  // reads as '' there while its delimiter stays in the URL, and every reference resolved against it then
  // failed the containment check below (verify pass, 2026-09-21). After parsing, a `?` or `#` in the href
  // can only be a delimiter — the parser percent-encodes both anywhere else.
  if (root.href.includes('?') || root.href.includes('#')) {
    throw new Error(`course: "${base}" carries a query or a fragment — a course base is a directory`);
  }
  if (!root.pathname.endsWith('/')) root.pathname += '/';

  /** What a 404 answers with — distinct from a body that decoded to `null`, which is a broken file. */
  const MISSING = Symbol('course:missing');

  /**
   * A deadline for one request: a signal, and how to stop its timer.
   *
   * A BOUND, because a fetch with neither timeout nor progress is a hang to the person watching -- the rule
   * this repository already paid for on the updater. A BOUND EITHER WAY: `AbortSignal.timeout` is the short
   * spelling, and where it is missing -- an older WebView is exactly where this matters -- the controller
   * below is the same bound spelled out. NAMED, not messaged: `new Error('TimeoutError')` has
   * `name === 'Error'`, and the classifier would report a deadline as "could not be reached".
   */
  const deadline = () => {
    if (timeoutMs > 0 && typeof AbortSignal?.timeout === 'function') {
      return { signal: AbortSignal.timeout(timeoutMs), clear: () => {} };
    }
    if (timeoutMs > 0 && typeof AbortController === 'function') {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(Object.assign(new Error('timed out'), { name: 'TimeoutError' })), timeoutMs);
      return { signal: controller.signal, clear: () => clearTimeout(timer) };
    }
    return { signal: undefined, clear: () => {} };
  };

  /** Errors this reader already worded, which the classifier hands on unchanged. */
  const worded = new WeakSet();

  /** Why a request failed, said about its URL: a deadline, content that is not JSON, or a lost transfer. */
  const failure = (url, cause) => {
    if (worded.has(cause) || cause instanceof CourseContentError) return cause;
    if (cause?.name === 'TimeoutError' || cause?.name === 'AbortError') {
      return new Error(`${url} did not answer within ${timeoutMs}ms`, { cause });
    }
    if (cause?.name === 'SyntaxError') return new CourseContentError(`${url} is not valid JSON — ${cause.message}`, { cause });
    return new Error(`${url} could not be reached — ${cause?.message ?? cause}`, { cause });
  };

  const json = async (url) => {
    const { signal, clear } = deadline();
    // ONE try AROUND BOTH AWAITS. The timer runs through the BODY on purpose -- a response that opens
    // promptly and then stalls mid-stream is the hang this bound exists to prevent -- but only the fetch
    // was inside the handler, so a deadline that struck the body said "The operation was aborted." with no
    // URL and no bound (audit, 2026-09-21). Both phases now fail the same way.
    try {
      const response = await get(url, signal ? { signal } : undefined);
      if (response.status === 404) return MISSING;
      if (!response.ok) {
        const refused = new Error(`${url} did not load (${response.status})`);
        worded.add(refused);
        throw refused;
      }
      return await response.json();
    } catch (cause) {
      throw failure(url, cause);
    } finally {
      clear();
    }
  };

  return {
    /** Where a course-relative reference lands, given where this course is. */
    resolve(ref) {
      const url = new URL(ref, root);
      // The same containment question `courseAudioRef` asks, asked again against the REAL root —
      // because a reference that is safe relative to a sentinel is only safe here if the root has
      // not been pointed somewhere surprising.
      return url.href.startsWith(root.href) ? url.href : '';
    },
    async list() {
      const data = await json(new URL('index.json', root));
      // A 404 is an empty shelf — the ordinary state of a build with no course. A body that
      // DECODED to null is a broken index and goes on to `catalogue()`, which refuses it by name;
      // merging the two reported a malformed file as "no course installed".
      return data === MISSING ? [] : data;
    },
    async read(id) {
      // The id is already known to match VALID_ID — `episode()` checks before it reads — so there
      // is no traversal to defend against here. Encoded anyway, because a reader is a public export
      // and the next caller may not come through `episode()`.
      const doc = await json(new URL(`${encodeURIComponent(id)}.json`, root));
      if (doc === MISSING) return null;
      if (doc === null) throw new CourseContentError(`${id}.json decoded to null, which is not a lesson`);
      return doc;
    },
  };
}
