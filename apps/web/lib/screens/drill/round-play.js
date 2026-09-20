// The Drill screen, playing real rounds.
//
// It replaces a hand-built preview — a fixed OLL case, a Reveal that showed a string, and grade
// buttons that recorded nothing — with the drill engine the renderer already had:
// `makeRound` generates a position, `createEventDriver` runs it, and `answerAt` works the answer out
// FROM THE CUBE rather than from anything written beside it. A generated round cannot disagree with
// the position it was generated from, which is the property that makes an endless drill honest.
//
// WHAT THIS SCREEN STILL DOES NOT DO, and says so: it does not record anything. That is a decision
// taken on the owner's behalf on 2026-09-20 and it rests on a specific observation rather than on
// caution — `createRound` measures which FACES a child picked, and returns right, wrong or unknown.
// It does not measure a child executing an algorithm. So recording those answers would not make the
// preview's "average execution" true; it would put a number describing a different activity under a
// label that has always meant this one. A queue needs a scheduling rule as well, and saving results
// supplies none. The banner therefore narrows rather than disappears — practice works, results are
// not kept — and the figures stay dashes, which is what this repository does with a statistic
// nobody computed.
//
// Its banner is its OWN. Changing the shared `PREVIEW_NOTE` would have re-described the Alg trainer,
// which is still a design in full.

import { $, escHtml, icon } from '../../app-state.js';
import { newCube } from '../../cube-drawing.js';
import { makeRound } from '../../drill-rounds.js';
import { buildScript } from '../../script-view.js';
import { answerAt, createEventDriver } from '../../script-rounds.js';
import { SOLVED_FACELETS } from '../../solved.js';
import { t } from '../../i18n.js';

/** How long a revealed stop is left on screen before the next one. Long enough to watch. */
export const REVEAL_BEAT = 900;

/** The faces a child may pick, in the order they are drawn. */
const FACES = ['U', 'R', 'F', 'D', 'L', 'B'];

/** What this screen still cannot claim. Its own wording — see the note at the top. */
export const DRILL_NOTE = 'Practice works. Results are not saved; the queue and averages are still a preview.';

/** The drill's cube stands for a generated position, and is not claimed to be anyone's cube. */
const DRILL_SUBJECT = Object.freeze({
  facelets: SOLVED_FACELETS, moves: [], isPhysical: false, setupAlg: '', solution: '',
});

/** One sentence per verdict. `unknown` is never "wrong" — nobody can be wrong about what is hidden. */
export function verdictLine(verdict) {
  if (verdict === 'right') return t('Yes — that is where it lives.');
  if (verdict === 'wrong') return t('Not those. Watch where it belongs.');
  if (verdict === 'unknown') return t('This picture does not show that piece, so there is nothing to be right about.');
  return '';
}

export function drillHtml() {
  // `walking`: the grid modifier that places an aux row under the primary. See the same note in
  // `lib/screens/course/episode-view.js` — without it the transport has no grid area on a
  // coarse-pointer portrait window.
  return `<div class="cols walking">
    <div class="card primary" style="display:flex;flex-direction:column;align-items:center;position:relative">
      <div style="flex:1;min-height:0;width:100%"><div class="cube-slot" id="drillCube" style="height:100%"></div></div>
    </div>
    <div class="card aux">
      <!-- Wrapping, because seven controls do not fit the aux row on a narrow landscape window:
           measured at 840x682 they overflowed the screen sideways by 113px. -->
      <div class="transport" style="flex-wrap:wrap;justify-content:center" role="group" aria-label="${escHtml(t('Pick the faces this piece belongs on'))}">
        ${FACES.map((f) => `<button class="tbtn" data-face="${f}" aria-pressed="false" aria-label="${escHtml(t('Face %1', f))}">${f}</button>`).join('')}
        <button class="pill" style="flex:none;min-width:44px" id="drillNext">${escHtml(t('Next'))}</button>
      </div>
    </div>
    <div class="aside">
      <div class="card" style="padding:12px 16px;display:flex;gap:10px;align-items:center">
        <span class="ico" style="color:var(--ink-5);flex:none">${icon('repeat', 16)}</span>
        <div class="sub" style="color:var(--ink-3);line-height:1.5">${escHtml(t(DRILL_NOTE))}</div>
      </div>
      <div class="card">
        <div class="eyebrow">${escHtml(t('THE QUESTION'))}</div>
        <div class="sub" id="drillAsk" style="color:var(--ink);margin-top:8px;line-height:1.5"></div>
        <div class="sub" id="drillVerdict" role="status" aria-live="polite" style="margin-top:10px;min-height:2.6em;line-height:1.5"></div>
      </div>
      <div class="card">
        <div class="eyebrow">${escHtml(t('HOW WELL DID THAT GO'))}</div>
        <!-- A minimum width per control: in a narrow aside these shrank to 36px wide, under the
             44px floor a coarse pointer requires. A disabled control is still a touch target the
             contract measures, and still something a finger lands on. -->
        <div style="display:flex;gap:10px;padding-top:8px;flex-wrap:wrap" role="group" aria-label="${escHtml(t('How well did that go'))}">
          <button class="btn outline" style="min-width:44px;flex:1" disabled>${escHtml(t('Again'))}</button>
          <button class="btn outline" style="min-width:44px;flex:1" disabled>${escHtml(t('Good'))}</button>
          <button class="btn primary" style="min-width:44px;flex:1" disabled>${escHtml(t('Easy'))}</button>
        </div>
      </div>
      <div class="card"><div class="eyebrow">${escHtml(t('THIS DRILL'))}</div>
        <div class="num" style="font-size:var(--fs-display);font-weight:600;margin-top:6px">—</div>
        <div class="sub" style="color:var(--ink-4)">${escHtml(t('nothing is recorded, so there is nothing to average'))}</div></div>
      <div class="card"><div class="eyebrow">${escHtml(t('QUEUE'))}</div>
        <div class="sub" style="color:var(--ink-4);margin-top:8px;line-height:1.5">${escHtml(t('A queue needs a schedule, and a schedule needs results this screen does not keep.'))}</div></div>
    </div></div>`;
}

/** Wire the drill up. Returns a disposer, because the screen owns when it stops. */
export function mountDrill(root, { make = makeRound } = {}) {
  const cube = newCube({ subject: DRILL_SUBJECT });
  // SAY WHAT IS ACTUALLY DRAWN. `newCube` describes its SUBJECT, and this one is a stand-in whose
  // facelets are solved — so the largest thing on the screen announced itself as "A solved cube"
  // over a stirred position with a piece lit. A canvas is nothing to a screen reader; the name is
  // the only thing it has.
  cube.setAttribute('aria-label', t('A mixed-up cube, with one piece lit to ask about'));
  $('#drillCube', root)?.appendChild(cube);

  const ask = $('#drillAsk', root);
  const verdict = $('#drillVerdict', root);
  const buttons = [...root.querySelectorAll('[data-face]')];

  let driver = null;
  let at = 0;
  let revealing = false;
  let timer = null;

  const setPressed = () => {
    const picked = new Set(driver?.round?.picked ?? []);
    for (const b of buttons) b.setAttribute('aria-pressed', String(picked.has(b.dataset.face)));
  };

  const load = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    revealing = false;
    const round = make();
    const built = buildScript(round.script);
    // The position that ASKS — found rather than assumed, because a script's steps and its
    // positions are not the same list once a step carries cues of its own.
    at = built.positions.findIndex((p) => built.script.steps[p?.step]?.round);
    driver = createEventDriver(built, { cube });
    driver.seek(at);
    const { choose } = answerAt(built, at);
    if (ask) {
      ask.textContent = choose === 2
        ? t('The lit piece is an edge. Which two faces does it belong on?')
        : t('The lit piece is a corner. Which three faces does it belong on?');
    }
    if (verdict) verdict.textContent = '';
    for (const b of buttons) b.disabled = false;
    setPressed();
  };

  const pick = (face) => {
    if (!driver || revealing) return;
    const state = driver.select(face);
    setPressed();
    if (!state.locked) return;
    // Answered. Say what happened, then play the reveal the author supplied — which for a
    // recognition round lights the slot the piece lives in and moves nothing.
    revealing = true;
    for (const b of buttons) b.disabled = true;
    if (verdict) verdict.textContent = verdictLine(state.verdict);
    // STOP BY STOP, with a beat between them. `createEventDriver.reveal()` plays one stop per call
    // and says how many are left — "the page owns every delay between them" is its contract — so
    // draining it in a loop would run the whole answer past the child in a single frame, which is
    // the same thing as not showing it. The timer is held so `dispose` can stop it: a screen that
    // is gone must not still be writing to the element it used to own.
    const step = () => {
      if (!driver) return;
      if (driver.reveal() > 0) timer = setTimeout(step, REVEAL_BEAT);
      else timer = null;
    };
    step();
  };

  for (const b of buttons) b.addEventListener('click', () => pick(b.dataset.face));
  // NEXT CATCHES. The initial mount runs inside the shell's error boundary; a click does not, so a
  // failure to generate or build the replacement escaped into nothing — with the previous round's
  // timer already cancelled and its buttons already reset, leaving a half-changed screen and no
  // explanation. A drill that cannot deal another round says so and stays usable.
  $('#drillNext', root)?.addEventListener('click', () => {
    try {
      load();
    } catch (err) {
      for (const b of buttons) b.disabled = true;
      if (ask) ask.textContent = t('Another round could not be made.');
      if (verdict) verdict.textContent = String(err?.message ?? err);
    }
  });

  load();

  return {
    dispose() {
      if (timer) { clearTimeout(timer); timer = null; }
      driver = null;
    },
    // For a test: what the screen is actually holding, without reading it back out of the DOM.
    state: () => ({ picked: driver?.round?.picked ?? [], verdict: driver?.round?.verdict ?? null, revealing }),
    /** Is a reveal stop still queued? The observable that makes "it stopped when I left" checkable. */
    pending: () => timer !== null,
  };
}
