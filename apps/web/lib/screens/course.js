// The Course screen: what episodes this build has, and what it says when it has none.
//
// The screen exists in EVERY build, whether or not a course is installed (ADR 0006 decision 3). A
// build with none lists nothing and says so — it does not hide itself, because a screen that
// vanishes teaches nothing, and it does not apologise or promise, because neither is a fact.
//
// What must never happen here: nav visibility consulting the catalogue. The tab's default is FIXED
// (`DEFAULT_HIDDEN`, like Trainer and Drill), so nothing anywhere asks "is there a course" to
// decide what to draw in the toolbar. The moment it does, "has the course" is an axis every screen
// has to answer, and that is the failure the smart-cube removal was about.
//
// It draws two compositions: the shelf (a list of what there is) and a lesson playing (the cube
// locked to the reference box with a transport under it). Moving between them REBUILDS the screen,
// because a new composition is a new screen — the subject-in-place rule does not stretch to a
// different grid — and `lib/screens/course/episode-view.js` is the second one.

import { $, escHtml, icon, state } from '../app-state.js';
import { pageCourseSession } from '../course-session.js';
import { courseSource } from '../course-session.js';
import { resolveCourseAudio } from '../course-source.js';
import { t } from '../i18n.js';
import { SCREENS, refreshScreen, screenAbort } from '../screen-shell.js';
import { episodeHtml, mountEpisodeView, sectionsOf } from './course/episode-view.js';

/**
 * What to say when there is nothing on the shelf.
 *
 * Three sentences and not one of them an apology: what is true, why it is true, and what still
 * works. A course-less build is not a broken build, and this is the screen that has to say so
 * without either pretending a course is coming or implying the app is diminished without one.
 */
const emptyShelf = () => `<div class="card" style="text-align:center;padding:28px 20px">
  <div class="eyebrow">${escHtml(t('NO COURSE INSTALLED'))}</div>
  <div class="sub" style="color:var(--ink-3);margin-top:10px;line-height:1.6;max-width:44ch;margin-inline:auto">
    ${escHtml(t('This build has no lessons in it. The course is written and recorded separately, and it is not part of the app.'))}
    ${escHtml(t('Everything else — scanning a cube, solving it, the stage ladder and the drills — works without it.'))}
  </div>
</div>`;

/** A refusal, in the words the source used. Never "something went wrong". */
const refusalCard = (refusal) => `<div class="card" style="padding:14px 16px;border-left:3px solid var(--err)">
  <div class="eyebrow" style="color:var(--err-ink)">${escHtml(t('THAT LESSON DID NOT OPEN'))}</div>
  <div class="sub" style="color:var(--ink-3);margin-top:8px;line-height:1.5">${escHtml(refusalLine(refusal))}</div>
  ${refusalDetail(refusal) ? `<div class="sub num" style="color:var(--ink-5);margin-top:8px;font-size:var(--fs-caption)">${escHtml(refusalDetail(refusal))}</div>` : ''}
</div>`;

/**
 * One sentence per reason, because the three are different facts and need different answers.
 *
 * Each keeps the SOURCE's own words alongside its own. An `unreadable` refusal carries the status,
 * the URL or the timeout that actually happened, and replacing all of that with one generic line
 * left nobody — child, parent or maintainer — anything to act on. The plain sentence says what it
 * means for the learner; the detail says what went wrong.
 */
function refusalLine(refusal) {
  if (refusal.reason === 'unknown') return t('That lesson is not in this course.');
  if (refusal.reason === 'unreadable') return t('That lesson could not be read from where the course is kept.');
  // `malformed` carries the validator's own words, which name the cue — the one sentence here that
  // is worth showing verbatim, because it says which line of which lesson is wrong.
  return refusal.message;
}

/** The source's own words, for the refusals whose sentence above does not already carry them. */
const refusalDetail = (refusal) => (refusal.reason === 'unreadable' ? refusal.message : '');

/**
 * The shelf could not be read — which is NOT the same as there being no course.
 *
 * Separating catalogue failures from episode refusals fixed one defect and introduced this one: the
 * column rendered only the episode refusal, so a shelf that failed to load fell through to the
 * empty state and told the learner their build has no lessons in it. That is a false statement about
 * their app, produced by an error path — the exact thing this repository refuses.
 */
const shelfErrorCard = (listError) => `<div class="card" style="padding:14px 16px;border-left:3px solid var(--err)">
  <div class="eyebrow" style="color:var(--err-ink)">${escHtml(t('THE LESSONS DID NOT LOAD'))}</div>
  <div class="sub" style="color:var(--ink-3);margin-top:8px;line-height:1.5">${escHtml(t('The list of lessons could not be read. This build may still have a course — this is not that answer.'))}</div>
  <div class="sub num" style="color:var(--ink-5);margin-top:8px;font-size:var(--fs-caption)">${escHtml(listError.message)}</div>
</div>`;

/** One episode on the shelf. A button, because opening it is an action. */
const shelfRow = (entry) => `<button class="card tight" data-open="${escHtml(entry.id)}" style="width:100%;text-align:left;cursor:pointer;display:block">
  <div class="row" style="grid-template-columns:1fr auto;gap:14px;align-items:center">
    <div style="color:var(--ink)">${escHtml(entry.title)}</div>
    <span class="ico" style="color:var(--ink-5)">${icon('play', 18)}</span>
  </div>
</button>`;

/** The catalogue's title for an id, falling back to the id — never a prettified invention. */
const titleOf = (id, view) => view.entries.find((e) => e.id === id)?.title ?? id;



/**
 * THE SHELF AND A LESSON ARE TWO COMPOSITIONS, so moving between them rebuilds the screen rather
 * than repainting a column: a list of cards and a locked cube with a transport under it are not the
 * same grid. That is the app's own rule — a screen takes a new SUBJECT in place, and only a new
 * COMPOSITION is a new screen — and it is why the session lives on the page rather than in this
 * closure: a rebuild must not re-fetch the lesson or the audio it has already got.
 */
SCREENS.course = () => {
  const session = pageCourseSession();
  const first = session.view();
  const showing = state.episode && first.episode ? state.episode : null;
  let mounted = null;

  const paintShelf = (root, view) => {
    const col = $('#courseCol', root);
    if (!col) return;
    if (view.loading && !view.showing) {
      col.innerHTML = `<div class="card"><div class="sub" style="color:var(--ink-4)">${escHtml(t('Looking…'))}</div></div>`;
      return;
    }
    const refusal = view.refusal ? refusalCard(view.refusal) : '';
    // A FAILED SHELF IS NOT AN EMPTY ONE. Only say "no course installed" when the catalogue was
    // actually read and was actually empty.
    if (view.listError) {
      col.innerHTML = refusal + shelfErrorCard(view.listError);
      return;
    }
    col.innerHTML = refusal + (view.entries.length ? view.entries.map(shelfRow).join('') : emptyShelf());
    for (const b of col.querySelectorAll('[data-open]')) {
      b.onclick = () => session.open(b.dataset.open);
    }
  };

  if (showing) {
    return {
      html: episodeHtml({
        title: titleOf(showing, first),
        sections: sectionsOf(first.episode),
        playable: Boolean(resolveCourseAudio(courseSource, first.episode)),
      }),
      mount(root) {
        const signal = screenAbort?.signal;
        mounted = mountEpisodeView(root, {
          episode: first.episode,
          episodeId: showing,
          audioSrc: resolveCourseAudio(courseSource, first.episode),
          onBack: () => session.close(),
        });
        // Going back to the shelf is the other direction of the same composition change, so it is
        // a rebuild too. Registered here, replacing the shelf's listener, because a listener from
        // the screen before this one is writing to a DOM that is gone.
        pageCourseSession((view) => {
          if (signal?.aborted) return;
          if (!view.showing) refreshScreen();
        });
        // The screen owns when the lesson stops, because the screen is what is going away.
        signal?.addEventListener('abort', () => mounted?.dispose(), { once: true });
      },
    };
  }

  return {
    html: `<div class="cols flow">
      <div class="col" id="courseCol"></div>
      <div class="aside">
        <div class="card"><div class="eyebrow">${escHtml(t('WHAT THIS IS'))}</div>
          <div class="sub" style="color:var(--ink-3);margin-top:8px;line-height:1.5">${escHtml(t('Narrated lessons: a voice, and a cube that turns as it talks. Each one is checked before it is shown.'))}</div></div>
      </div></div>`,
    mount(root) {
      // The abort signal, so a load that finishes after the learner has left writes nothing: the
      // session drops a superseded answer on its own, but the screen must also stop repainting a
      // root that is no longer in the document.
      const signal = screenAbort?.signal;
      pageCourseSession((view) => {
        if (signal?.aborted) return;
        // A lesson arriving is a new composition, so the screen is rebuilt; anything else repaints.
        if (view.showing && view.episode) refreshScreen();
        else paintShelf(root, view);
      });
      paintShelf(root, session.view());
      session.load();
    },
  };
};
