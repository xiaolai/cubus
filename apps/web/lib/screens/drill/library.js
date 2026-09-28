// The algorithm library, and one drill on the cube in your hands.
//
// dev-docs/algorithm-drills-plan.md phase 3. Two things on one screen, and they are the same thing
// seen with and without hardware: every algorithm the app holds, grouped by the four stages in the
// words the Lessons ladder already uses — and, once a scanned cube is being tracked, the chosen one
// drilled for real (`lib/drill-attempt.js`).
//
// NOTHING IS CHOSEN FOR THE LEARNER. That is what the Drill tab is for. The list defaults to the
// algorithms their own rungs actually use — including the beginner inserts the top F2L rungs keep as
// fallbacks — and one control widens it to everything the repository holds. Widening changes no rung
// and selects nothing (decision D3).
//
// THE NO-CUBE PATH IS THE WHOLE SCREEN, NOT A FALLBACK. With no cube there is still a case to draw
// and a sequence to watch: `entry.setup` is the arrangement this algorithm answers, computed as its
// own inverse from solved, and playing it returns the cube to solved on screen. That is the one
// place the catalogue's arithmetic spine is load-bearing, and it is why no screen here exists only
// with hardware.
//
// WHAT IT NEVER SAYS. No time unless the clock is on AND the cube numbers its turns; no wrong-turn
// cue unless continuity and trust are established; nothing at all about results being kept, because
// none are (decision D1 — the previous time for the same algorithm lives in memory for the session
// and goes when the screen does).
import { $, escHtml, icon } from '../../app-state.js';
import { movesOf } from '../../cube-pieces.js';
import { ALG_ENTRIES, entriesForRungs } from '../../alg-catalogue.js';
import { SECTION_NAME, caseNameOf, purposeFor } from '../../method-lesson.js';
import { DETAIL_PICTURE, LIST_PICTURE, caseTitle, lastLayer, pictureKind, pictureSvg, readByPicture } from '../../alg-picture.js';
import { STAGE_IDS } from '../../method-solver.js';
import { holdForStage, holdSentence } from '../../solving-hold.js';
import { createDrillAttempt } from '../../drill-attempt.js';
import { buildScript } from '../../script-view.js';
import { createStopDriver } from '../../script-drive.js';
import { chainTrusted } from '../../cube-trust-state.js';
import { conn } from '../../live-session.js';
import { newCube, parkCube } from '../../cube-drawing.js';
import { hooks } from '../../screen-slots.js';
import { settings } from '../../app-settings.js';
import { state } from '../../app-state.js';
import { play } from '../../sound.js';
import { plural, t } from '../../i18n.js';

/** What this screen still cannot claim. Narrower than the recognition drill's, because more of it
 *  is now measured — and it keeps the one thing that is not: nothing is kept between visits. */
export const LIBRARY_NOTE = 'Every algorithm the app knows. Practice is followed once your cube has been scanned and is being tracked; nothing is saved between visits.';

/**
 * The view attributes this screen owns, which a script may not write.
 *
 * Every attribute `script-drive.js` sets from a cue that is ABOUT THE VIEW rather than about the
 * cube: with no cues in the demonstration each would be written to its default on every position,
 * and the first of them — `ghosts: 'none'` — takes the ghost faces off a cube the app draws them
 * on everywhere else.
 */
export const OWNED_VIEW = Object.freeze([
  'ghosts', 'ghost-elevation', 'camera-latitude', 'camera-longitude', 'camera-up', 'facelet-scale',
]);

/** How long a demonstrated turn is left on screen before the next. The stop driver's own default,
 *  named here because a drill's gap is a choice rather than an inherited number. */
export const REVEAL_GAP = 900;

/** The subject a drawn case stands for. Never claimed to be anyone's cube. */
const caseSubject = (facelets) => Object.freeze({
  facelets, moves: [], isPhysical: false, setupAlg: '', solution: '',
});

/** The order fact, which is the one thing about an algorithm a child can check with their own hands. */
export const orderLine = (order) => t('Do it %1 times and the cube comes back.', order);

/** The two scopes, and what each is called. */
export const SCOPES = Object.freeze({
  rung: 'My lesson algorithms',
  all: 'Show all algorithms',
});

/** The entries a scope shows. `rung` reads the learner's own rungs; `all` is everything. */
export function entriesForScope(scope, rungs = settings.rungs) {
  return scope === 'all' ? ALG_ENTRIES : entriesForRungs(rungs);
}

/** The list, grouped into the four dials in walking order. Empty dials are dropped rather than drawn
 *  as a heading with nothing under it. */
export function groupsFor(entries) {
  return STAGE_IDS
    .map((dial) => ({ dial, name: SECTION_NAME[dial](), entries: entries.filter((e) => e.dial === dial) }))
    .filter((g) => g.entries.length > 0);
}

/**
 * One entry, led by the name a learner would use.
 *
 * The first build showed the MOVES and nothing else, which made the list a wall of notation with
 * nothing to recognise — `R U R' U R U2 R'` where a learner is looking for Sune. The app already
 * had the names, translated, in `method-lesson.js`; they simply were not used. The 119 generated
 * cases genuinely have none (decision D2), so those lead with their sequence and say so by having
 * no second line.
 */
/**
 * One algorithm as a CARD in the chooser.
 *
 * A card, not a pill in a wrapping row: 137 pills of wildly different widths is a ragged wall that
 * cannot be scanned, and on a phone it is a single column of notation. `.case-grid` is the app's
 * own primitive for exactly this — as many fixed-width cards as fit, which reflows by CONTAINER
 * and needs no viewport query (the layout contract forbids one).
 *
 * A named algorithm leads with its name and a generated one with its picture, because that is what
 * each is found by.
 */
const entryCard = (e) => {
  const name = caseNameOf(e.id);
  const face = name
    ? `<div style="font-weight:600">${escHtml(name)}</div>`
    : `<div style="display:flex;justify-content:center">${pictureKind(e) === 'top' ? pictureSvg(e, { palette: settings.palette, scheme: settings.scheme, width: LIST_PICTURE }) : ''}</div>`;
  return `<button class="card alg-entry" data-alg="${escHtml(e.id)}" id="alg-${escHtml(e.id)}"
    style="text-align:center;cursor:pointer;display:flex;flex-direction:column;gap:6px;justify-content:center">
    ${face}
    <div class="num sub" style="font-size:var(--fs-caption);color:var(--ink-4);line-height:1.35">${escHtml(e.shown)}</div>
  </button>`;
};

const groupBlock = (g) => `<div data-dial="${escHtml(g.dial)}">
  <div class="eyebrow">${escHtml(g.name)} · ${escHtml(plural(g.entries.length, { one: '%1 algorithm', other: '%1 algorithms' }))}</div>
  <div class="case-grid" role="list">${g.entries.map(entryCard).join('')}</div>
</div>`;

/**
 * The chooser: every algorithm, grouped by stage, as a grid you can scan.
 *
 * `.cols.flow` is the app's list composition — one column in portrait that scrolls, two regions in
 * landscape — and it is what Stats, Lessons and Settings already use. Nothing here is a new layout.
 */
export function libraryHtml({ scope = 'rung', rungs = settings.rungs } = {}) {
  const entries = entriesForScope(scope, rungs);
  const groups = groupsFor(entries);
  return `<div class="cols flow">
  <div class="col">
    <div class="card" style="padding:12px 16px;display:flex;gap:10px;align-items:center">
      <span class="ico" style="color:var(--ink-5);flex:none">${icon('book', 16)}</span>
      <div class="sub" id="libraryNote" style="color:var(--ink-3);line-height:1.5">${escHtml(t(LIBRARY_NOTE))}</div>
    </div>
    <div class="wrap-row" role="group" aria-label="${escHtml(t('How many algorithms'))}">
      <button class="pill" id="scopeRung" aria-pressed="${scope === 'rung'}">${escHtml(t(SCOPES.rung))}</button>
      <button class="pill" id="scopeAll" aria-pressed="${scope === 'all'}">${escHtml(t(SCOPES.all))}</button>
      <span class="sub" id="scopeCount" style="margin-left:auto;color:var(--ink-4)">${escHtml(plural(entries.length, { one: '%1 algorithm', other: '%1 algorithms' }))}</span>
    </div>
    <div id="algGroups" style="display:flex;flex-direction:column;gap:14px">${groups.map(groupBlock).join('')}</div>
  </div>
</div>`;
}

/** The two dials whose algorithms ARE their permutation, and where the order is a fingerprint
 *  worth knowing — named or not. */
// `lastLayer` is imported from `lib/alg-picture.js`, which is the one statement of it — it used
// to be declared here as well, so the sentence this screen says and the diagram it draws each
// decided for themselves what a last-layer case is.
export { lastLayer };

/**
 * Whether this entry's own EFFECT is worth printing.
 *
 * The last layer only, and only where there is NO picture. For the first two layers the algorithm
 * is a placement and its purpose line already says the job; and where a picture is shown, the case
 * sentence beside it says the same fact the right way round.
 */
export const effectWorthSaying = (entry) => lastLayer(entry) && !readByPicture(entry);

/**
 * Whether to say what is WRONG with the case rather than what the algorithm does to it.
 *
 * The two sentences are one fact back to front — a case is its algorithm undone — so printing both
 * says the same thing twice. Where there is a PICTURE the case sentence is the one that matches it.
 */
export const caseWorthSaying = (entry) => readByPicture(entry) && lastLayer(entry);

/**
 * The algorithm acting on its own case, as a script the player can drive.
 *
 * The letters are the ones on the card, in the hold the card names, so what a child watches is what
 * they are asked to turn. Verified over all 137: every demonstration ends SOLVED, because a case is
 * its algorithm undone from solved.
 */
export function demoScript(entry) {
  return buildScript({
    schema: 2,
    start: { facelets: entry.setup, hold: entry.hold },
    steps: [{ move: entry.shown }],
  });
}

/** One sentence per verdict, for the live drill. `unknown` is never "wrong". */
export function statusFor(event) {
  if (!event) return '';
  switch (event.kind) {
    case 'ready': return t('Turn your cube when you are ready.');
    case 'running': case 'progress': return t('%1 of %2 turns.', event.at, event.of);
    case 'off': return event.recovery
      ? t('That turn is not in this algorithm. Undo it with %1.', event.recovery)
      : t('That turn is not in this algorithm.');
    case 'uncertain': return t('I lost track of your cube. Show it to the camera again.');
    case 'done': return t('Done.');
    default: return '';
  }
}

/**
 * ONE ALGORITHM, ON ITS OWN PAGE — the drill.
 *
 * This is the cube screen's own composition (`.cols.walking`), not a new one: the cube is the
 * LOCKED PRIMARY REGION, the transport is `aux`, and the aside carries the case and the words. That
 * matters for two reasons beyond looking right. The layout contract says every platform runs the
 * same two compositions keyed only on orientation, and this one is already measured across all
 * eight fixtures — so a phone gets the cube above a scrolling sheet and a desktop gets them side by
 * side, with no viewport query anywhere. And a drill should LOOK like the walk it is practising:
 * same cube, same transport, same move chips.
 *
 * What it replaced was a browse list with a detail panel bolted underneath, which scrolled past the
 * fold on a desktop and was unusable on a phone. A list is for choosing; a drill is for doing, and
 * they are not the same screen.
 */
export function drillPageHtml(entry, { status = '', timing = null } = {}) {
  const name = caseNameOf(entry.id);
  const heading = name ? name.charAt(0).toUpperCase() + name.slice(1) : '';
  const moves = movesOf(entry.shown);
  const picture = readByPicture(entry)
    ? `<div id="algCase" style="display:flex;justify-content:center;padding:2px 0 6px">${pictureSvg(entry, { palette: settings.palette, scheme: settings.scheme, width: DETAIL_PICTURE })}</div>`
    : '';
  return `<div class="cols walking">
    <div class="card primary" style="display:flex;flex-direction:column;align-items:center">
      <div style="flex:1;min-height:0;width:100%"><div class="cube-slot" id="algCube" style="height:100%"></div></div>
    </div>
    <div class="card aux">
      <div class="transport">
        <button class="tbtn" id="algBack" title="${escHtml(t('One turn back'))}" aria-label="${escHtml(t('One turn back'))}">${icon('chevron-left', 20)}</button>
        <button class="tbtn" id="algReplay" title="${escHtml(t('Start again'))}" aria-label="${escHtml(t('Start again'))}">${icon('refresh', 18)}</button>
        <button class="tbtn" id="algNext" title="${escHtml(t('One turn on'))}" aria-label="${escHtml(t('One turn on'))}">${icon('chevron-right', 20)}</button>
        <button class="tbtn primary" id="algPlay" title="${escHtml(t('Watch it'))}" aria-label="${escHtml(t('Watch it'))}" aria-pressed="false">${icon('play', 18)}</button>
        <div class="progress" title="${escHtml(t('How far through the algorithm you are'))}"><span id="algProg"></span></div>
        <span class="num" id="algAt" role="status" aria-live="polite" style="color:var(--ink-4);min-width:56px;text-align:right">0 / ${moves.length}</span>
      </div>
    </div>
    <div class="aside">
      <div class="card twin">
        <!-- THE WAY BACK IS ITS OWN ROW. Crammed into the eyebrow beside the stage name it ran
             12px off the right edge of the stage on every fixture, which the geometry gate refuses
             at anything over 1px — and a back affordance squeezed against a heading is not one a
             thumb finds anyway. -->
        <div class="wrap-row" style="padding-bottom:2px">
          <button class="pill" id="algBackToList">${icon('chevron-left', 14)} ${escHtml(t('All algorithms'))}</button>
        </div>
        <div class="eyebrow">${escHtml(SECTION_NAME[entry.dial]())}</div>
        ${heading ? `<div class="alg-title" style="font-size:var(--fs-title);font-weight:600">${escHtml(heading)}</div>` : ''}
        ${picture}
        <div class="sub" id="algHold" style="color:var(--ink-4)">${escHtml(holdSentence(holdForStage(entry.stage)))}</div>
      </div>
      <div class="card sheet">
        <div class="sub" id="algPurpose" style="line-height:1.5">${escHtml(purposeFor(entry))}</div>
        ${caseWorthSaying(entry) ? `<div class="sub" id="algCaseSays" style="color:var(--ink-3);line-height:1.5">${escHtml(caseTitle(entry))}.</div>` : ''}
        ${effectWorthSaying(entry) ? `<div class="sub" id="algLabel" style="color:var(--ink-3);line-height:1.5">${escHtml(entry.label)}.</div>` : ''}
        ${lastLayer(entry) ? `<div class="sub" id="algOrder" style="color:var(--ink-4)">${escHtml(orderLine(entry.effect.order))}</div>` : ''}
        <div class="eyebrow">${escHtml(t('THE TURNS'))}</div>
        <div class="wrap-row" id="algMoves">${moves.map((m, k) => `<button class="chip-m" data-i="${k}" title="${escHtml(t('Jump to this move'))}">${escHtml(m)}</button>`).join('')}</div>
        <div class="sub" id="algStatus" role="status" aria-live="polite" style="color:var(--ink-3);min-height:1.4em">${escHtml(status)}</div>
        <div class="sub num" id="algTime" style="color:var(--ink-4)">${escHtml(timing ?? '')}</div>
      </div>
    </div>
  </div>`;
}

/**
 * What the screen says about this attempt's clock: the time, or why there is not one.
 *
 * Pure, so every wording here is testable without a cube. A refusal is SHOWN rather than swallowed
 * — a clock the child turned on and which then produced nothing must say why, or the setting looks
 * broken and the app looks like it is hiding a number.
 *
 * The comparison is always against the same child's own earlier try and says so, because that is
 * the only comparison a drill time supports: the timer's missing first move is 10-25% of a span
 * this short, and the same in every direction for the same person.
 */
export function timingLine(event, prior = null) {
  if (!event || event.kind !== 'done') return '';
  if (event.time) {
    return prior && prior !== event.time
      ? t('%1s — your last try was %2s', event.time.seconds, prior.seconds)
      : t('%1s', event.time.seconds);
  }
  return event.refusal ? t('No time: %1.', event.refusal) : '';
}

/**
 * Mount the library.
 *
 * ONE ATTEMPT AT A TIME, and it owns the three hook slots. `renderScreen` clears every hook on
 * navigation, so an attempt cannot outlive its screen; choosing another algorithm disposes the one
 * in flight before building the next, so a late report from the old one reaches a disposed object
 * and is dropped rather than completing the new one.
 */
/**
 * Which algorithm the drill is on, or null for the chooser.
 *
 * Module scope, like the Drill screen's own kind, and for the same reason: choosing one is a new
 * COMPOSITION rather than a new subject — a list and a drill are not the same screen — so it is
 * `renderScreen` that swaps them, and the choice has to outlive the render. `router.js` has no
 * sub-paths and gains none here, which is the decision the Course screen already took for an
 * episode id (plan 1.2, 2026-09-19).
 */
let chosen = null;

/** The entry being drilled, or null. Re-read from the catalogue every time, never held. */
export const chosenEntry = () => (chosen === null ? null : ALG_ENTRIES.find((e) => e.id === chosen) ?? null);

/** For the shell: the whole screen, whichever composition it is in. */
export const drillLibraryHtml = () => {
  const entry = chosenEntry();
  return entry ? drillPageHtml(entry) : libraryHtml({ scope });
};

/** Which scope the chooser is showing. Module scope, so a return from a drill lands where it left. */
let scope = 'rung';

/**
 * Mount whichever composition is showing.
 *
 * ONE ATTEMPT AND ONE DEMONSTRATION AT A TIME, both owned here and both released on the way out —
 * the attempt because the app has one of each hook slot, the demonstration because a driver left
 * playing keeps turning a cube on a screen nobody is looking at.
 */
export function mountLibrary(root, { make = createDrillAttempt, signal, go = () => {} } = {}) {
  let attempt = null;
  let demo = null;
  let lastEvent = null;
  let gone = false;
  let ticking = null;
  const seen = new Map();
  const installed = new Map();
  const entry = chosenEntry();

  const disposeAttempt = () => {
    attempt?.dispose();
    attempt = null;
    for (const [slot, fn] of [...installed]) if (hooks[slot] === fn) hooks[slot] = null;
    installed.clear();
  };

  const stopTicking = () => { if (ticking !== null) { clearInterval(ticking); ticking = null; } };

  function showStatus() {
    const el = $('#algStatus', root);
    if (el) el.textContent = statusFor(lastEvent);
  }

  function showTiming(event, prior = seen.get(chosen) ?? null) {
    const el = $('#algTime', root);
    if (el) el.textContent = timingLine(event, prior);
  }

  /** The transport, the progress bar, the step count and which chip is lit — all from the driver,
   *  which emits nothing, so they are asked for rather than pushed. */
  function showTransport() {
    if (!demo || gone) return;
    const at = demo.position;
    const of = demo.track.states.length - 1;
    const label = $('#algAt', root);
    if (label) label.textContent = `${at} / ${of}`;
    const bar = $('#algProg', root);
    if (bar) bar.style.width = `${of > 0 ? Math.round((at / of) * 100) : 0}%`;
    const play = $('#algPlay', root);
    if (play) play.setAttribute('aria-pressed', String(demo.playing));
    const back = $('#algBack', root);
    if (back) back.disabled = at <= 0;
    const next = $('#algNext', root);
    if (next) next.disabled = at >= of;
    // THE CHIP FOR THE TURN JUST MADE, which is what a learner reads position off — the same mark
    // the walk puts on its own chips.
    for (const chip of root.querySelectorAll('.chip-m')) {
      chip.classList.toggle('on', Number(chip.dataset.i) === at - 1);
    }
    if (demo.playing && ticking === null) {
      ticking = setInterval(() => {
        if (gone || !demo) { stopTicking(); return; }
        if (!demo.playing) stopTicking();
        showTransport();
      }, REVEAL_GAP / 3);
    }
  }

  /**
   * Start again: a fresh LIVE attempt, not only a fresh demonstration.
   *
   * `createDrillAttempt` is terminal by design — `facelets()` and `move()` both return early once
   * the state is `done` or `ended` — and `startAttempt()` ran only at mount. So after one
   * completion, a trust loss or a dropped report, every hook call was a no-op and the drill ignored
   * the cube for as long as the page stayed open; the only affordance named "start again" drove the
   * demonstration, which was the half still working. Nothing tested a SECOND attempt, which is why
   * a one-shot drill read as finished rather than as broken.
   *
   * `seen` deliberately survives: the previous time is what the next completion is compared against.
   */
  function restart() {
    lastEvent = null;
    const time = $('#algTime', root);
    if (time) time.textContent = '';
    startAttempt();
    showStatus();
  }

  /** One press of the transport. `pause`, never `stay` — the driver has no `stay`. */
  function drive(id, index) {
    if (!demo) return;
    if (id === 'algPlay') { if (demo.playing) demo.pause(); else demo.play({ every: REVEAL_GAP }); }
    if (id === 'algNext') demo.next();
    if (id === 'algBack') demo.back();
    if (id === 'algReplay') { demo.seek(0); demo.play({ every: REVEAL_GAP }); }
    if (index !== undefined) demo.seek(index + 1);
    showTransport();
  }

  function startAttempt() {
    disposeAttempt();
    if (!entry) return;
    const mine = make({
      entry,
      chainTrusted,
      numbersMoves: () => Boolean(conn?.numbersMoves?.()),
      clock: settings.drillClock === true,
      onEvent: (event) => {
        lastEvent = event;
        showStatus();
        if (event.kind === 'done') {
          play('done');
          // The PREVIOUS time, taken before this one replaces it. Storing first made `prior` and
          // `event.time` the same object, so `timingLine`'s "your last try was …" branch could never
          // be taken: two consecutive attempts both read as a bare time with nothing to beat, which
          // is the one thing a repeated drill is for.
          const prior = seen.get(chosen) ?? null;
          if (event.time) seen.set(chosen, event.time);
          showTiming(event, prior);
        }
        if (event.kind === 'off' && event.sound) play('off');
      },
    });
    attempt = mine;
    for (const [slot, fn] of Object.entries({
      liveMove: (m) => { if (mine === attempt) mine.move(m); },
      liveUpdate: (f, serial) => { if (mine === attempt) mine.facelets(f, serial); },
      onTrustLost: () => { if (mine === attempt) mine.trustLost(); },
      liveGap: () => { if (mine === attempt) mine.movesLost(); },
    })) { hooks[slot] = fn; installed.set(slot, fn); }
    if (state.live && chainTrusted()) attempt.facelets(state.live, null);
  }

  // ---- the drill page ------------------------------------------------------------------------
  if (entry) {
    const slot = $('#algCube', root);
    if (slot) {
      parkCube();
      const el = newCube({ subject: caseSubject(entry.setup) });
      slot.replaceChildren(el);
      const [up, front] = String(entry.hold).split(' ');
      if (typeof el.turnTo === 'function') void el.turnTo(up, front);
      // THE VIEW IS THIS SCREEN'S, NOT THE SCRIPT'S. A driver writes `ghosts`, the camera and the
      // elevation from its script's cues on every position, defaulting `ghosts` to `'none'` — so a
      // demonstration with no cues stripped the ghost faces straight back off the cube `newCube`
      // had just given them. `owned` is the seam for exactly this ("attributes the host owns are
      // never written"), and the host here owns the whole tuned view: a demonstration is about the
      // turns, not about re-framing the cube.
      demo = createStopDriver(demoScript(entry), { cube: el, owned: OWNED_VIEW });
    }
    startAttempt();
    showTransport();
    showStatus();
  }

  const opts = signal ? { signal } : {};
  root.addEventListener('click', (e) => {
    if (gone) return;
    const card = e.target.closest?.('[data-alg]');
    if (card) { chosen = card.dataset.alg; go(); return; }
    if (e.target.closest?.('#algBackToList')) { chosen = null; go(); return; }
    if (e.target.closest?.('#scopeRung')) { scope = 'rung'; go(); return; }
    if (e.target.closest?.('#scopeAll')) { scope = 'all'; go(); return; }
    const chip = e.target.closest?.('.chip-m');
    if (chip) { drive(null, Number(chip.dataset.i)); return; }
    const tbtn = e.target.closest?.('.transport button');
    // The restart is OUTSIDE `drive`, which returns early with no demonstration: a page whose cube
    // slot never mounted still has a live attempt to start again.
    if (tbtn) { if (tbtn.id === 'algReplay') restart(); drive(tbtn.id); }
  }, opts);

  return {
    get chosen() { return chosen; },
    get scope() { return scope; },
    dispose() {
      gone = true;
      stopTicking();
      demo?.pause?.();
      demo = null;
      disposeAttempt();
      parkCube();
    },
  };
}
