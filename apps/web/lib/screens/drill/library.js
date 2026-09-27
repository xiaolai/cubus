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
import { ALG_ENTRIES, entriesForRungs } from '../../alg-catalogue.js';
import { DIAL_OF, SECTION_NAME } from '../../method-lesson.js';
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

const entryButton = (e, selected) => `<button class="pill alg-entry" role="option" id="alg-${escHtml(e.id)}"
  data-alg="${escHtml(e.id)}" aria-selected="${e.id === selected}" tabindex="${e.id === selected ? 0 : -1}">
  <span class="num">${escHtml(e.shown)}</span></button>`;

const groupBlock = (g, selected) => `<div class="card tight" data-dial="${escHtml(g.dial)}">
  <div class="eyebrow">${escHtml(g.name)} · ${escHtml(plural(g.entries.length, { one: '%1 algorithm', other: '%1 algorithms' }))}</div>
  <div class="wrap-row" role="listbox" aria-label="${escHtml(g.name)}">${g.entries.map((e) => entryButton(e, selected)).join('')}</div>
</div>`;

/** The whole screen, drawn from a scope and a selection. */
export function libraryHtml({ scope = 'rung', selected = null, rungs = settings.rungs } = {}) {
  const entries = entriesForScope(scope, rungs);
  const groups = groupsFor(entries);
  return `<div class="drill-library" style="width:100%;height:100%;display:flex;flex-direction:column;gap:12px">
  <div class="card" style="padding:12px 16px;display:flex;gap:10px;align-items:center">
    <span class="ico" style="color:var(--ink-5);flex:none">${icon('book', 16)}</span>
    <div class="sub" id="libraryNote" style="color:var(--ink-3);line-height:1.5">${escHtml(t(LIBRARY_NOTE))}</div>
  </div>
  <div class="wrap-row" role="group" aria-label="${escHtml(t('How many algorithms'))}">
    <button class="pill" id="scopeRung" aria-pressed="${scope === 'rung'}">${escHtml(t(SCOPES.rung))}</button>
    <button class="pill" id="scopeAll" aria-pressed="${scope === 'all'}">${escHtml(t(SCOPES.all))}</button>
    <span class="sub" id="scopeCount" style="margin-left:auto;color:var(--ink-4)">${escHtml(plural(entries.length, { one: '%1 algorithm', other: '%1 algorithms' }))}</span>
  </div>
  <div id="algGroups" style="display:flex;flex-direction:column;gap:8px;overflow:auto">${groups.map((g) => groupBlock(g, selected)).join('')}</div>
  <div class="card" id="algDetail" aria-live="polite"></div>
</div>`;
}

/** The detail panel for one entry — or the line that stands in for it when nothing is chosen. */
export function detailHtml(entry, { status = '', timing = null } = {}) {
  if (!entry) return `<div class="sub" style="color:var(--ink-4)">${escHtml(t('Choose an algorithm to see what it does.'))}</div>`;
  const hold = holdSentence(holdForStage(entry.stage));
  return `<div class="card-h"><div>
      <div class="eyebrow">${escHtml(SECTION_NAME[entry.dial]())}</div>
      <div class="num" id="algMoves" style="font-size:var(--fs-title);font-weight:600;margin-top:2px">${escHtml(entry.shown)}</div>
    </div></div>
    <div class="sub" id="algLabel" style="color:var(--ink-3);line-height:1.5">${escHtml(entry.label)}.</div>
    <div class="sub" id="algHold" style="color:var(--ink-4);padding-top:4px">${escHtml(hold)}</div>
    <div class="sub" id="algOrder" style="color:var(--ink-4)">${escHtml(orderLine(entry.effect.order))}</div>
    <div id="algCube" style="padding:8px 0"></div>
    <div class="wrap-row" style="gap:6px"><button class="pill" id="algPlay">${escHtml(t('Watch it'))}</button></div>
    <div class="sub" id="algStatus" role="status" style="color:var(--ink-3);min-height:1.4em">${escHtml(status)}</div>
    <div class="sub num" id="algTime" style="color:var(--ink-4)">${escHtml(timing ?? '')}</div>`;
}

/** What the screen says about an attempt, per event. Pure, so every sentence is testable without a
 *  cube — and so that none of them can name something the attempt did not measure. */
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
    case 'ended': return '';
    default: return '';
  }
}

/**
 * The algorithm acting on its own case, as a script the player can drive.
 *
 * THE LETTERS ARE THE ONES ON THE CARD, in the hold the card names — `entry.shown` in `entry.hold`
 * — so what a child watches is what they are asked to turn. The format's own interpreter converts
 * them to identity moves, which is why this is not a third frame conversion: verified over all 137,
 * every demo ends SOLVED, because the case is the algorithm undone from solved.
 *
 * This is the whole of the no-cube path. Without it the library drew a case and claimed a
 * demonstration it never gave (audit, 2026-09-27).
 */
export function demoScript(entry) {
  return buildScript({
    schema: 2,
    start: { facelets: entry.setup, hold: entry.hold },
    steps: [{ move: entry.shown }],
  });
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
export function mountLibrary(root, { make = createDrillAttempt, signal } = {}) {
  let scope = 'rung';
  let selected = null;
  let attempt = null;
  let lastEvent = null;
  /** The previous time for the SAME algorithm, this session only (decision D1: nothing is stored). */
  const seen = new Map();
  /** The hook slots this mount installed, with the exact function it put there. */
  const installed = new Map();
  /** The demonstration currently loaded, or null. One at a time, like the attempt. */
  let demo = null;

  const detail = () => $('#algDetail', root);

  /** True once this mount is gone. Its own listeners outlive it when the caller passes no signal,
   *  so a click after disposal would otherwise start another attempt on a dead screen. */
  let gone = false;

  const disposeAttempt = () => {
    attempt?.dispose();
    attempt = null;
    // Only the slots THIS mount is holding. Clearing unconditionally would take out a hook a
    // later owner had installed in between (audit, 2026-09-27).
    for (const [slot, fn] of [...installed]) if (hooks[slot] === fn) hooks[slot] = null;
    installed.clear();
  };

  function drawCase(entry) {
    const slot = $('#algCube', root);
    demo?.stay?.();
    demo = null;
    if (!slot || !entry) return;
    // PARK BEFORE THE HOLDER GOES. `select()` rewrites the detail panel with `innerHTML`, which
    // detaches the cube that was in it — and a detached, unparked cube releases itself, so every
    // choice was building a fresh WebGL context for the same picture. Parking first is what lets
    // `newCube()` hand back the one the app already has (audit, 2026-09-27).
    // Attributes before connecting: `connectedCallback` draws immediately, so a cube mounted first
    // and described second is fitted to the wrong subject for its first frame.
    const el = newCube({ subject: caseSubject(entry.setup) });
    slot.replaceChildren(el);
    // The demonstration is built on the cube that was just drawn, and seeks to the start — so the
    // picture and the player agree about where it is before anything is pressed.
    demo = createStopDriver(demoScript(entry), { cube: el });
    // AND TURNED TO THE HOLD THE PANEL JUST NAMED. Drawn in the renderer's default grip, the card
    // said "hold it with white underneath and green at the back" over a cube plainly showing white
    // on top — the words and the picture disagreeing about the same thing (audit, 2026-09-27).
    // `turnTo` is how a hold is shown; it is display only, and changes no state.
    const [up, front] = String(entry.hold).split(' ');
    if (typeof el.turnTo === 'function') void el.turnTo(up, front);
  }

  function showStatus() {
    const el = $('#algStatus', root);
    if (el) el.textContent = statusFor(lastEvent);
  }

  /** This attempt's time, or the reason there is none — never a blank where a number was promised. */
  function showTiming(event) {
    const el = $('#algTime', root);
    if (!el) return;
    el.textContent = timingLine(event, seen.get(selected));
  }

  function onEvent(event) {
    lastEvent = event;
    showStatus();
    if (event.kind === 'done') {
      play('done');
      // SHOWN WHEN IT HAPPENS. The result used to be stored and not rendered, so a first time was
      // invisible until the algorithm was chosen again and a later one sat under the previous
      // one's label. A refusal was not shown at all, so an enabled clock could fail silently —
      // which is the one thing this repository will not do with a number (audit, 2026-09-27).
      if (event.time) seen.set(selected, event.time);
      showTiming(event);
    }
    // `sound` is false on the repeats of one excursion: the instruction updates as the child goes
    // further off, and the bell does not follow them down.
    if (event.kind === 'off' && event.sound) play('off');
  }

  function startAttempt() {
    disposeAttempt();
    const entry = ALG_ENTRIES.find((e) => e.id === selected);
    if (!entry) return;
    const mine = make({
      entry,
      chainTrusted,
      // THE CONNECTION'S OWN ANSWER, not a proxy for it. This asked whether there was a live
      // reading on a trusted chain, which is a different question and was true of every cube —
      // so an unnumbered cube (moyu32, moyu-mhc, qiyi) was accused of wrong turns it may not have
      // made and was eligible for a time it cannot support, defeating both capability gates the
      // attempt is careful to offer (audit, 2026-09-27). `!conn` is no cube, and a cube nobody
      // asserted anything about is not asserted to number its turns either.
      numbersMoves: () => Boolean(conn?.numbersMoves?.()),
      clock: settings.drillClock === true,
      onEvent,
    });
    attempt = mine;
    // EACH HOOK CAPTURES ITS OWN ATTEMPT, never the mutable binding. Reading `attempt` at call
    // time means a report held by a stale closure — one captured before the child chose another
    // algorithm — is delivered to whichever attempt is current, which is the opposite of the
    // disposal guarantee this module claims (audit, 2026-09-27: reproduced).
    for (const [slot, fn] of Object.entries({
      liveMove: (m) => { if (mine === attempt) mine.move(m); },
      liveUpdate: (f, serial) => { if (mine === attempt) mine.facelets(f, serial); },
      onTrustLost: () => { if (mine === attempt) mine.trustLost(); },
      liveGap: () => { if (mine === attempt) mine.movesLost(); },
    })) { hooks[slot] = fn; installed.set(slot, fn); }
    // The scanned state is the seed. With no live reading there is nothing to seed from, and the
    // library half of the screen is all there is — which is the no-cube path, not a degraded one.
    if (state.live && chainTrusted()) attempt.facelets(state.live, null);
  }

  /**
   * Show an algorithm, and — unless told otherwise — begin drilling it.
   *
   * `start: false` is how the screen OPENS: a case is drawn so the panel is not empty, and no
   * attempt is begun. Drawing what an algorithm does is a view; beginning to drill it is a choice,
   * and with a cube connected an attempt started on the learner's behalf would have them tracked
   * against something they never picked.
   */
  function select(id, { start = true } = {}) {
    if (gone) return;
    selected = id;
    lastEvent = null;
    const entry = ALG_ENTRIES.find((e) => e.id === id) ?? null;
    const prior = seen.get(id);
    const el = detail();
    // PARK BEFORE THE PANEL IS REWRITTEN, not inside `drawCase`. `innerHTML` detaches the cube
    // that was in it, and a detached, unparked cube releases itself — so parking afterwards was
    // parking nothing, and every choice built a fresh WebGL context for the same picture (audit
    // verify, 2026-09-27: the first fix was in the right function and the wrong order).
    parkCube();
    if (el) el.innerHTML = detailHtml(entry, { timing: prior ? t('Last time: %1s', prior.seconds) : null });
    drawCase(entry);
    rove(id);
    if (start) startAttempt(); else disposeAttempt();
    showStatus();
  }

  /**
   * The roving tab stop: exactly one entry reachable by Tab, whether or not anything is selected.
   *
   * Keyed on the selection when there is one and on the FIRST entry when there is not — because
   * narrowing the scope past the chosen algorithm clears the selection, and a list where every
   * button is `tabindex="-1"` cannot be reached from the keyboard at all (audit, 2026-09-27).
   */
  function rove(id) {
    const buttons = [...root.querySelectorAll('[data-alg]')];
    const stop = buttons.find((b) => b.dataset.alg === id) ?? buttons[0];
    for (const b of buttons) {
      b.setAttribute('aria-selected', String(b.dataset.alg === id));
      b.tabIndex = b === stop ? 0 : -1;
    }
  }

  function redraw() {
    const groups = groupsFor(entriesForScope(scope));
    const list = $('#algGroups', root);
    if (list) list.innerHTML = groups.map((g) => groupBlock(g, selected)).join('');
    const count = $('#scopeCount', root);
    if (count) count.textContent = plural(entriesForScope(scope).length, { one: '%1 algorithm', other: '%1 algorithms' });
    $('#scopeRung', root)?.setAttribute('aria-pressed', String(scope === 'rung'));
    $('#scopeAll', root)?.setAttribute('aria-pressed', String(scope === 'all'));
    // The selection SURVIVES a scope change when the new scope still holds it, so widening the list
    // does not throw away what the child was working on — and narrowing it clears the detail rather
    // than leaving a panel describing something no longer on screen.
    if (selected && !entriesForScope(scope).some((e) => e.id === selected)) {
      disposeAttempt();
      selected = null;
      const el = detail();
      if (el) el.innerHTML = detailHtml(null);
    }
    rove(selected);
  }

  const opts = signal ? { signal } : {};
  root.addEventListener('click', (e) => {
    if (gone) return;
    const button = e.target.closest?.('[data-alg]');
    if (button) { select(button.dataset.alg); return; }
    if (e.target.closest?.('#scopeRung')) { scope = 'rung'; redraw(); }
    if (e.target.closest?.('#scopeAll')) { scope = 'all'; redraw(); }
    if (e.target.closest?.('#algPlay') && demo) {
      // Pressed again while playing, it stops where it is rather than starting a second run.
      if (demo.playing) demo.stay();
      else { demo.seek(0); demo.play({ every: REVEAL_GAP }); }
    }
  }, opts);

  // Arrow keys move along the list the way the roving point does elsewhere in the app, and the
  // focused button keeps the focus when the algorithm changes — a list that jumped back to the top
  // on every choice would be unusable with a keyboard.
  root.addEventListener('keydown', (e) => {
    if (gone || !['ArrowRight', 'ArrowLeft'].includes(e.key)) return;
    const buttons = [...root.querySelectorAll('[data-alg]')];
    const at = buttons.indexOf(e.target.closest?.('[data-alg]'));
    if (at < 0) return;
    e.preventDefault();
    const next = buttons[at + (e.key === 'ArrowRight' ? 1 : -1)];
    if (!next) return;
    next.focus();
    select(next.dataset.alg);
  }, opts);

  const opening = entriesForScope(scope)[0] ?? null;
  if (opening) select(opening.id, { start: false });
  else { const el = detail(); if (el) el.innerHTML = detailHtml(null); }

  return {
    select,
    get selected() { return selected; },
    get scope() { return scope; },
    dispose() { gone = true; demo?.stay?.(); demo = null; disposeAttempt(); parkCube(); },
  };
}
