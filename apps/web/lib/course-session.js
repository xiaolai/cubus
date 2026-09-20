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
import { CourseRefusal, EMPTY_COURSE, isEpisodeId } from './course-source.js';

/**
 * The course this build has. `EMPTY_COURSE` until something installs one — which is the honest
 * default, because no build installs one yet (ADR 0006 decision 4 leaves delivery undecided).
 *
 * An `export let` with a named setter beside it, because a module may not assign a binding it
 * imports: the value has ONE owner and everything else reads it live.
 */
export let courseSource = EMPTY_COURSE;

/** Install a course. The seam a delivery mechanism lands on, and the seam a test drives. */
export function useCourse(source) {
  courseSource = source ?? EMPTY_COURSE;
  // RETIRED, not merely dropped. A new course invalidates whatever the page was holding — but
  // letting go of the reference does not stop the work the old session already started: a pending
  // open resolving afterwards still wrote the global `state.episode` and still called through to
  // the NEW session's listener, so installing a course could be undone moments later by the answer
  // to a question about the old one.
  pageSession?.invalidate();
  pageSession = null;
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

  const changed = () => { if (live) onChange(view()); };

  /** Put the learner back on the catalogue with a reason. Never `home`, never blank. */
  const refuse = (err) => {
    refusal = err instanceof CourseRefusal
      ? Object.freeze({ reason: err.reason, episode: err.episode, message: err.message })
      : Object.freeze({ reason: 'unreadable', episode: state.episode, message: String(err?.message ?? err) });
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
      const mine = ++openGen;
      refusal = null;
      if (!isEpisodeId(id)) {
        // `opening` is cleared here too. This bump has just superseded any open still in flight, so
        // that one can no longer clear the flag itself — and the shelf sat on "Looking…" for ever
        // with the refusal hidden behind it.
        opening = false;
        refuse(new CourseRefusal('unknown', id, 'is not an episode id, so nothing was asked for'));
        changed();
        return;
      }
      opening = true;
      changed();
      try {
        const doc = await source.episode(id);
        if (mine !== openGen) return; // a newer ask owns the screen; this answer is dropped unshown
        // A SCRIPT IS A VALID LESSON AND IS NOT A NARRATED ONE. `checkLesson` accepts both kinds,
        // so the source hands back `schema: 2` documents quite correctly — and the episode player
        // then called `resolveSpanning(doc.cues)` on a document whose steps live under `steps`,
        // throwing "Cannot read properties of undefined" into the generic broken-screen path. The
        // Course screen plays narrated lessons; anything else is refused BY NAME, here, where every
        // other refusal is made.
        if (doc?.schema !== undefined) {
          throw new CourseRefusal('malformed', id, `is a script (schema ${JSON.stringify(doc.schema)}), and the course plays narrated lessons`);
        }
        // COMMITTED HERE, after the check and not before.
        state.episode = id;
        episode = doc;
        refusal = null;
      } catch (err) {
        if (mine !== openGen) return;
        refuse(err);
      } finally {
        if (mine === openGen) {
          opening = false;
          changed();
        }
      }
    },

    /** Back to the shelf, deliberately. Cancels any open in flight by moving the generation on. */
    close() {
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
