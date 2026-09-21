// Which episode the Course screen is showing, and how it survives being asked for.
//
// The id lives in `state.episode` and NOT in the URL. `router.js` `parse()` treats the whole hash
// as one screen id, so `#/course/11-the-middle-layer` is simply not a known screen and falls to
// `home`; making it work means teaching that parser about path segments, and its audit history is
// entirely about hash parsing going wrong on hostile input (`#/%70air`, `#/constructor`). An app
// with no sharing buys little with a deep link, so the plan took the smaller option and named the
// cost: an episode cannot be linked to from outside the app (plan item 1.2).
//
// Inside the app it still has to survive a load, and that is what this module is for.
//
// COMMIT AFTER THE FRESHNESS CHECK, NEVER BEFORE. Two opens can overlap — a child taps one lesson
// while another is still loading — and assigning the shown episode inside the load left the DOM
// describing one lesson while every closure that read it held the other. That is the trap
// `walk-session.js` records for the cube screen's walk, paid for once already; the same shape is
// the same defect here.
//
// A REFUSAL NEVER LEAVES AN EPISODE SHOWING. An unknown id, a malformed one and a lesson that does
// not validate all land the learner back on the catalogue with a reason — never on `home`, which
// would silently lose the screen, and never on a blank screen, which says nothing at all.

import { state } from './app-state.js';
import { CourseRefusal, EMPTY_COURSE, createCourseSource, episodeIdRefusal, fetchCourse } from './course-source.js';

/**
 * The course this page has. `EMPTY_COURSE` until the page declares one (`installCourseFromPage`, ADR 0007)
 * -- the fallback, and a real source rather than a null, when nothing is declared. How a RELEASE build
 * bundles a course is still ADR 0006 decision 4's open question; the tag is how either kind says so.
 *
 * An `export let` with a named setter beside it, because a module may not assign a binding it
 * imports: the value has ONE owner and everything else reads it live.
 */
export let courseSource = EMPTY_COURSE;

/** Install a course. The seam a delivery mechanism lands on, and the seam a test drives. */
export function useCourse(source) {
  courseSource = source ?? EMPTY_COURSE;
  // The selected lesson belonged to the course being replaced. Left standing, the new session reported
  // `showing` an id with no episode, and the shelf's loading state keyed on it (audit, 2026-09-21). Boot
  // installs the course before the first route, so a deep link is not yet read when this runs.
  state.episode = null;
  // RETIRED, not merely dropped. A new course invalidates whatever the page was holding — but
  // letting go of the reference does not stop the work the old session already started: a pending
  // open resolving afterwards still wrote the global `state.episode` and still called through to
  // the NEW session's listener, so installing a course could be undone moments later by the answer
  // to a question about the old one.
  pageSession?.invalidate();
  pageSession = null;
  // AND THE SCREEN IS TOLD. A lesson already on screen went on playing the old course -- and resolving its
  // recordings against the new one (audit, 2026-09-21) -- because invalidating the session silenced the
  // only thing that could have said so. The mounted Course screen, if one is, rebuilds from the new course.
  const was = listener;
  listener = null;
  was?.(COURSE_REPLACED);
}

/**
 * What the mounted Course screen is handed when the course it was showing is replaced: not a view of any
 * session, because the one it was watching is retired, only the fact that everything on screen now
 * describes a course the page no longer has.
 */
export const COURSE_REPLACED = Object.freeze({ replaced: true });

/**
 * What a course's location may look like in the page's tag: one or more plain directory names, each
 * ending in a slash — `course/`, `courses/en/`. Nothing that can leave the app's own directory or origin:
 * no scheme, no leading slash, no `.` or `..` segment, no whitespace.
 */
const COURSE_BASE = /^(?:(?!\.{1,2}\/)[A-Za-z0-9._-]+\/)+$/;

/**
 * Install the course the PAGE says it has — `<meta name="cubus-course" content="course/">` — and answer
 * whether the page said anything at all (ADR 0007).
 *
 * The tag is how a server with a course beside the app says so: the dev server writes it when
 * `CUBUS_COURSE_DIR` is mounted, and a build that bundles a course will write it too. It is read rather
 * than probed for, because a packaged build answers a request for a missing `course/index.json` with the
 * app's own index.html — so a probe would report a broken shelf where there is simply no course.
 *
 * A tag naming anything but a directory beside the app is REFUSED ON THE SHELF, not ignored: the course
 * installed is one whose catalogue fails with the reason, so the Course screen says the lessons did not
 * load, and why — where the person who wrote the tag will look.
 */
export function installCourseFromPage(doc = globalThis.document, {
  // THE DOCUMENT'S OWN ADDRESS. The base is read from `doc`, so it is resolved against `doc` too: resolving
  // against the global document fetched from the wrong place whenever the two differed, and failed outright
  // with a supplied document and no global one (audit, 2026-09-21).
  make = (base, baseURI) => createCourseSource(fetchCourse({ base, baseURI })),
} = {}) {
  const tag = doc?.querySelector?.('meta[name="cubus-course"]');
  if (!tag) return false;
  // A TAG WITH NO LOCATION is a malformed declaration, refused like one -- not the same fact as no tag. A
  // missing `content` read as absent and showed an empty shelf to the one person who had asked for a course.
  const content = tag.getAttribute('content');
  if (content === null || !COURSE_BASE.test(content)) {
    const why = content === null
      ? 'the page declares a course and names no location for it'
      : `the page names its course as ${JSON.stringify(content)}, which is not a directory beside the app`;
    useCourse(createCourseSource({ list: async () => { throw new Error(why); }, read: async () => null }));
    return true;
  }
  useCourse(make(content, doc.baseURI));
  return true;
}

/**
 * The page's session, made once and kept across screen rebuilds.
 *
 * Opening a lesson changes the COMPOSITION — the shelf is a list, a lesson is the cube with a
 * transport under it — and a new composition is a new screen, so the screen is rebuilt rather than
 * repainted. A session created per mount would then re-fetch the lesson every time that happened,
 * and the parked `<audio>` would re-fetch its media with it. One session per page is what makes the
 * rebuild free.
 *
 * The listener is replaced on each mount rather than added to: the previous screen's closure is
 * writing to a DOM that no longer exists, and keeping it is the "a re-used element keeps its
 * listeners" defect wearing different clothes.
 */
let pageSession = null;
let listener = null;

export function pageCourseSession(onChange = () => {}) {
  listener = onChange;
  if (!pageSession) {
    pageSession = createCourseSession({ source: courseSource, onChange: (view) => listener?.(view) });
  }
  return pageSession;
}

/** Drop the page's session. For a test that must start from nothing. */
export function resetCourseSession() {
  // Retired first: dropping the reference alone left an open in flight free to write `state.episode` and
  // call the NEXT listener after the reset (audit, 2026-09-21) -- the same mechanism `useCourse` retires.
  pageSession?.invalidate();
  pageSession = null;
  listener = null;
}

/**
 * A course session over one source.
 *
 * `onChange` is called whenever the view changes, so the screen redraws in one place rather than
 * every caller remembering to. No DOM and no element: this owns facts, and drawing is the screen's.
 */
export function createCourseSession({ source, onChange = () => {} } = {}) {
  if (!source) throw new Error('course: a session needs a source');

  // TWO GENERATIONS, not one. A catalogue refresh and an episode open are different operations with
  // different lifetimes, and sharing a counter made both of them wrong: `load()` captured `gen`
  // without advancing it, so two overlapping refreshes were both "current" and whichever finished
  // LAST won regardless of which was asked for last; and an `open()` bumping the shared counter
  // could leave a refresh unable to clear its own loading flag.
  let openGen = 0;
  let listGen = 0;
  let entries = [];
  let episode = null;
  let refusal = null;      // about the EPISODE
  let listError = null;    // about the SHELF — a different fact, and it must not evict a lesson
  let opening = false;
  let listing = false;
  let live = true;

  const view = () => Object.freeze({
    // `state.episode` is the durable fact: a screen is rebuilt from state, so the id has to live
    // somewhere a rebuild can read. The document does not — it is re-fetched, which is why a
    // rebuild mid-load shows the catalogue and then the episode, rather than a half-drawn one.
    showing: state.episode,
    entries,
    episode,
    refusal,
    listError,
    loading: opening || listing,
  });

  // A LISTENER'S FAILURE IS ITS OWN. It was called unguarded, so a screen that threw while drawing left
  // `loading` true before the read had even started, and a throw in a final notification rejected the
  // open itself (audit, 2026-09-21). Reported loudly, and never allowed to stop this session's own cleanup.
  const changed = () => {
    if (!live) return;
    try {
      onChange(view());
    } catch (err) {
      console.error('course: the screen failed while drawing a change —', err);
    }
  };

  /** Put the learner back on the catalogue with a reason. Never `home`, never blank. */
  // `asked` is the id that was requested. An untyped error used to name `state.episode` -- the lesson
  // shown BEFORE the ask -- so a failure opening B was reported as a failure of A (audit, 2026-09-21).
  const refuse = (err, asked) => {
    refusal = err instanceof CourseRefusal
      ? Object.freeze({ reason: err.reason, episode: err.episode, message: err.message })
      : Object.freeze({ reason: 'unreadable', episode: asked ?? null, message: String(err?.message ?? err) });
    state.episode = null;
    episode = null;
  };

  return Object.freeze({
    view,

    /**
     * Read the shelf. Does NOT disturb what is being shown — including when it FAILS.
     *
     * A failed refresh used to go through `refuse()`, which clears the open episode: the shelf
     * becoming briefly unreachable therefore ejected a lesson a child was in the middle of, which is
     * the opposite of this method's stated contract. A catalogue problem is recorded as one.
     */
    async load() {
      if (!live) return;
      const mine = ++listGen;
      listing = true;
      listError = null;
      changed();
      try {
        const listed = await source.catalogue();
        if (mine !== listGen) return; // superseded; the newer refresh owns the shelf
        entries = listed;
        listError = null;
      } catch (err) {
        if (mine !== listGen) return;
        entries = [];
        listError = Object.freeze({ message: String(err?.message ?? err) });
      } finally {
        if (mine === listGen) {
          listing = false;
          changed();
        }
      }
    },

    /**
     * Ask for one episode.
     *
     * The id is shape-checked by `course-source.js` before any reader is touched, so a malformed id
     * never reaches the catalogue at all — it is refused here as `unknown` and the learner stays
     * where they are, looking at the list.
     */
    async open(id) {
      // A RETIRED session commits nothing. `invalidate()` silenced its notifications and its requests in
      // flight, but a retained reference could still open or close and so write the global
      // `state.episode` out from under the session that replaced it (audit, 2026-09-21).
      if (!live) return;
      const mine = ++openGen;
      refusal = null;
      const notAnId = episodeIdRefusal(id);
      if (notAnId) {
        // `opening` is cleared here too. This bump has just superseded any open still in flight, so
        // that one can no longer clear the flag itself — and the shelf sat on "Looking…" for ever
        // with the refusal hidden behind it.
        opening = false;
        refuse(notAnId, id);
        changed();
        return;
      }
      opening = true;
      changed();
      try {
        const doc = await source.episode(id);
        if (mine !== openGen) return; // a newer ask owns the screen; this answer is dropped unshown
        // BOTH KINDS OF LESSON ARE SHOWN (ADR 0007). This refused a `schema: 2` document by name while
        // the only thing the screen could mount was the episode player — handing it a script threw
        // "Cannot read properties of undefined" into the generic broken-screen path. The screen now
        // chooses the player from the document's `schema`, the field `checkLesson` has already read,
        // so there is nothing left to refuse here that the source has not refused already.
        // COMMITTED HERE, after the check and not before.
        state.episode = id;
        episode = doc;
        refusal = null;
      } catch (err) {
        if (mine !== openGen) return;
        refuse(err, id);
      } finally {
        if (mine === openGen) {
          opening = false;
          changed();
        }
      }
    },

    /** The course this session reads -- where every recording its lessons name is looked up, and nowhere else. */
    get source() { return source; },

    /** Back to the shelf, deliberately. Cancels any open in flight by moving the generation on. */
    close() {
      if (!live) return;
      openGen += 1;
      state.episode = null;
      episode = null;
      refusal = null;
      opening = false;
      changed();
    },

    /**
     * Retire this session: nothing it has in flight may commit or notify again.
     *
     * Needed because `useCourse()` REPLACES the page's session, and dropping the reference alone
     * does not stop the work the old one started — a pending open resolved afterwards still wrote
     * the global `state.episode` and still called through to the new session's listener, so
     * installing a new course could be undone moments later by the old one's answer.
     */
    invalidate() {
      live = false;
      openGen += 1;
      listGen += 1;
      opening = false;
      listing = false;
    },
  });
}
