// THE LOOP: the cube, one turn, and a way to say it is made.
//
// dev-docs/adr/0008-the-loop-is-a-screen-beside-the-shelf.md. For a child of five to seven who does
// not read: the app says where the cube is and shows ONE turn, the child makes it, and it begins
// again. Teaching is what accretes from doing that many times.
//
// A SCREEN BESIDE THE SHELF, NOT INSTEAD OF IT. The Course screen is a catalogue of narrated lessons
// for a 7-12 reader and stays exactly as it is; ADR 0008 supersedes nothing. Two audiences, two
// surfaces.
//
// NOT A TAB, for the reason the Shapes screen is not one: `NAV` is the beginner's path to a solved
// cube, and this is a different path for a different child. Reached by its route, like every screen.
//
// WHAT IT NEVER DOES, and `test/loop-sentences.test.mjs` holds each one:
//   * name a face by its letter — the letter names nothing a pre-reader can hold, and the referent
//     needs a viewpoint change measured at 39% for a five-year-old against 25% chance;
//   * say "clockwise" — face-relative direction is measured at 25% on a TWO-WAY choice at this age,
//     which is below chance;
//   * ask a conditional — "if the app can see the state, it should resolve the antecedent itself and
//     issue a plain imperative" (dev-docs/teaching-a-five-year-old.md §4).
//
// IT DOES NOT SCAN YET. It takes the cube the app already has, so the first of the loop's four
// moments is missing and this is a demonstration rather than a tool. That is named in ADR 0008's
// consequences rather than left for someone to discover.
import { escHtml, state } from '../app-state.js';
import { newCube, parkCube } from '../cube-drawing.js';
import { lessonFor } from '../cube-subject.js';
import { t } from '../i18n.js';
import { nextTurn } from '../next-turn.js';
import { SCREENS, screenAbort } from '../screen-shell.js';

/**
 * What to say about this turn — and the whole of what this screen says about one.
 *
 * A ROTATION IS NOT A TURN OF A FACE: the child picks the cube up and turns it over, and a line that
 * said "turn the face" would be naming a layer nobody is being asked to move. A HALF TURN gets its
 * own line because "twice" is the whole of it, and because a half turn has no wrong way round —
 * which is the one property a first solving lesson can be built on.
 */
export function turnWords(turn) {
  if (turn === null) return t('Nothing to do.');
  if (turn.kind === 'rotation') return t('Pick the whole cube up and turn it the way the arrow goes.');
  if (turn.turns === 2) return t('Follow the arrow. Twice.');
  return t('Follow the arrow.');
}

SCREENS.loop = () => {
  // Read ONCE per mount, not per press: `lessonFor` caches on the subject, and a walk recomputed
  // under the child's hands could change its mind about what the next turn is between the arrow being
  // drawn and the child making it.
  const lesson = lessonFor(state.cube);
  let done = 0;

  return {
    html: `<div style="width:100%;height:100%;min-height:0;display:flex;flex-direction:column;gap:14px">
      <div class="card primary" style="flex:1;min-height:0;display:flex;flex-direction:column;align-items:center">
        <div style="flex:1;min-height:0;width:100%"><div class="cube-slot" id="loopCube" style="height:100%"></div></div>
      </div>
      <div class="card" style="flex:none;display:flex;gap:12px;align-items:center">
        <div class="sub" id="loopSay" style="flex:1;color:var(--ink-3);line-height:1.5;font-size:var(--fs-title)"></div>
        <button class="btn primary" id="loopDone" style="flex:none;min-width:120px">${escHtml(t('Done'))}</button>
      </div>
      <div class="wrap-row" style="flex:none">
        <button class="pill" data-go="home">${escHtml(t('Back to the cube'))}</button>
      </div>
    </div>`,
    mount(root) {
      const slot = root.querySelector('#loopCube');
      const say = root.querySelector('#loopSay');
      const doneBtn = root.querySelector('#loopDone');

      // Park the screen that is leaving BEFORE building this one's, so the single GL context is
      // handed over rather than a second one made — the idiom the Drill page already uses.
      parkCube();
      const cube = newCube({ subject: state.cube });
      // THE ARROW IS DERIVED, never named here. `next` draws the element's OWN next move, so the
      // picture cannot drift from the turn that will actually be played — which is the defect a
      // lesson shipped with when its arrow spelled a quarter turn for a half one.
      cube.setAttribute('arrow', 'next');
      // Only the walk. `newCube` has already written the subject's facelets, and writing them again
      // re-runs the element's own reset on a REUSED renderer for no change (`cube-drawing.js`).
      if (lesson) cube.setAttribute('alg', lesson.alg);
      slot.appendChild(cube);

      const paint = () => {
        const turn = nextTurn(lesson, done);
        // A cube the method cannot finish is not a cube with nothing to do, and saying so is the
        // scan's own rule: never a sentence about a cause nobody measured.
        // NOT "this cube cannot be read". `lessonFor` answers null for a parse failure AND for a
        // method-solver failure (`cube-subject.js`), and a perfectly readable cube can hit the second.
        // Saying which would be naming a cause nothing measured — the rule the scan is already held to.
        say.textContent = lesson === null
          ? t('This turn could not be prepared.')
          : turnWords(turn);
        doneBtn.disabled = turn === null;
        doneBtn.hidden = turn === null;
      };

      // THE COUNT FOLLOWS THE DRAWING, never the press. `step()` QUEUES a turn and returns; the
      // element dispatches `cubus-step` when that turn has actually landed. Advancing `done` on the
      // click instead replaced the words for the turn being watched with the words for the next one
      // while the first was still turning — and on a half turn that is the difference between
      // "Twice" and a quarter-turn instruction (audit, 2026-10-06).
      //
      // `detail.index` is how many of the walk's moves have been applied, so it IS the count: taking
      // it rather than incrementing locally means the drawing and the words cannot drift apart, and a
      // second press while one is in flight cannot queue a turn the child was never shown.
      cube.addEventListener('cubus-step', (e) => {
        const applied = Number(e.detail?.index);
        if (!Number.isInteger(applied)) return;
        done = applied;
        paint();
      }, { signal: screenAbort?.signal });

      doneBtn.onclick = () => {
        if (nextTurn(lesson, done) === null) return;
        // Disabled until the turn lands, so a second press cannot run ahead of what is on screen.
        doneBtn.disabled = true;
        cube.step();
      };

      paint();
    },
  };
};
