// The Practice screen: every algorithm the ledger holds, and one of them practised over and over until the
// fingers do it on their own (dev-docs/algorithm-drill-v2-plan.md §3.7, §4; work items WI-10 and WI-12).
//
// EARNED, NOT GIVEN. The first Drill was removed whole (ADR 0010): "a screen rebuilt later starts as a module
// with no screen, and earns its tab again". So this is a new id — never `drill` or `trainer`, which name removed
// screens — hidden by default (`NAV_ADDED[8]`), reachable in Settings → Advanced and at #/practice.
//
// TWO COMPOSITIONS ON ONE ROUTE. With no row chosen (`state.practiceAlg` null) it is the LIBRARY: one method's
// stages as grids of case tiles (dev-docs/practice-redesign-plan.md §4), read from the library worker
// (lib/drill/library-client.js — the rows cost seconds to compute, which no UI thread may pay). With a row it is the PAGE: the case, the algorithm in its chunks, the
// demo cube, the clock, the record. Going between the two is a new composition and rebuilds; changing the row
// on the page is NOT — `show()` takes the new subject in place, the same cube and the same DOM (AGENTS.md §2).
//
// WITH A SMART CUBE the drill engine (lib/drill/engine.js) judges every reported turn against the SAME string
// the page prints: `judged` below is handed to the engine and split into the chips, and nothing else is. With
// no cube (D6) the demo cube plays the algorithm part by part and a stopwatch the person works themselves times
// a rep — no verdict, nothing called correct, and no time claimed for turns nobody measured.
//
// ONE ATTEMPT ACTS AT A TIME. Every engine is made for one row and carries a token; its sounds and events are
// dropped the moment another engine replaces it, or the screen's signal aborts — the first Drill's hook
// closures sent one attempt's reports into the next (algorithm-drills-plan.md). The engine's own timers name
// their attempt (lib/drill/engine.js), so nothing it scheduled acts on a later rep either.

import { $, escHtml, icon, state } from '../app-state.js';
import { fingersTarget, save, settings } from '../app-settings.js';
import { plural, t } from '../i18n.js';
import { SCREENS, placeMenuUnder, renderScreen, screenAbort, screenGen } from '../screen-shell.js';
import { createMenu } from '../menu-popover.js';
import { createMethodRow, methodRowHtml } from '../method-row.js';
import { createSpeedMenu } from '../speed-menu.js';
import { oneLineStrip } from '../scroll-strip.js';
import { footBand } from '../foot-band.js';
import { RECORD_SAYS } from '../drill/record-says.js';
import { hooks } from '../screen-slots.js';
import { openLibrary } from '../practice-link.js';
import { newCube } from '../cube-drawing.js';
import { conn, cubeRefused } from '../live-session.js';
import { reportedArrangement } from '../cube-reports.js';
import { play } from '../sound.js';
import { applyIdentity, faceTurnsOf, run, toIdentity } from '../cube-moves.js';
import { parse } from '../cube-notation.js';
import { SOLVED, applyMove, toFacelets } from '../cube-pieces.js';
import { stateFrom } from '../script-view.js';
import { holdSentence, holdSpec, sameHold } from '../solving-hold.js';
import { library } from '../drill/library-client.js';
import { caseOf } from '../drill/case-of.js';
import { casePhotographer, photoAttrs } from '../case-photo.js';
import { STATUS, createDrillEngine } from '../drill/engine.js';
import { PracticeRecordError, fingersOf, openPracticeRecord, statsOf, watchReps } from '../drill/record.js';
import { indexedDbStore } from '../drill/record-store.js';
import { mixOrder } from '../drill/mix.js';
import {
  LIBRARY_LEVELS, aboutHtml, bodyHtml, casePicture, countHtml, gridIds, libraryKey, libraryMethods, openingKey, pendingHtml, purposeOf,
  markedPicture, railHtml, rowName, stageIds, tileLabel, tileRing, tilesHtml,
} from './practice/library-view.js';
import {
  RECORD_READING, beadsHtml, chipsHtml, figuresHtml, lastRepsHtml, orderWords, pageHtml, partsWords, refusalWords, seconds, writtenTokens,
} from './practice/page-view.js';

/** How often the page asks whether the cube is still there. A disconnect of a cube whose chain was never
 *  trusted raises no hook (`markStale` notifies only a LAPSE), and a page saying "following your cube" after
 *  the cube has gone is the one sentence it must not keep. A comparison of two flags, once a second. */
const PRESENCE_MS = 1000;

/** A cube that can be followed: a session held, connected, and not proved to contradict itself
 *  (lib/cube-reports.js gates a refused cube's turns before they reach any screen). The session is asked as well
 *  as the flag because a disconnect lets go of the session first and lowers the flag last, and a screen standing
 *  down in between (`onTrustLost`) must already see the cube as gone. */
const cubeHere = () => conn !== null && state.connected && !cubeRefused();

/** The statuses of a rep under way with a cube: the clock draws its glyph, never a number (§5.5). */
const UNDER_WAY = new Set([STATUS.RUNNING, STATUS.OFF, STATUS.UNCERTAIN]);
/** The clock's face drawing the timer glyph rather than a figure. */
const GLYPH = Symbol('the timer glyph');

/** A report's serial as the drill engine counts it — the low byte, which is all its comparison reads — or none. */
const countOf = (serial) => (Number.isInteger(serial) ? serial & 0xff : undefined);

/** A key press that belongs to the control it landed on, not to the page. */
const onControl = (target) => Boolean(target?.closest?.('button, a, input, select, textarea, summary'));

// ---- a save that answers after its page has gone ------------------------------------------------------------

/**
 * A SAVE'S OUTCOME OUTLIVES ITS PAGE. A rep's save is asked for as the rep ends, and the record keeps every save asked
 * for when the page goes before it settles (lib/drill/record.js, `signal`), so its answer can come once the page that
 * asked is gone. Only that page's painting is skipped; the outcome is kept here, for the session, and said by the
 * Practice composition on screen as it comes and by every one that mounts after: the library, where Back leads, and a
 * page, with its other notices. It stands until a rep is saved — the rule a page keeps for its own failed save.
 *
 * Kept here and not in storage: a save fails when the database refuses it (full, closed under the page, refused), and
 * a refusal that lasts is met again by the next rep's save, on the page, as it happens.
 */
let unsaved = null;             // { id, message } for the newest save that did not land, or null once one has
const unsavedSayers = new Set(); // the mounted compositions' sayings, each removed when its screen goes
const keepUnsaved = (next) => {
  unsaved = next;
  for (const say of unsavedSayers) say();
};
const sayUnsavedWhileMounted = (say, signal) => {
  unsavedSayers.add(say);
  signal?.addEventListener('abort', () => unsavedSayers.delete(say), { once: true });
  say();
};
/** The library's words for a save that did not land: the algorithm's name, and why. Null when the newest save landed.
 *  The page says it in fixed words instead (`RECORD_SAYS`, E12.8). */
const unsavedWords = (catalogue) => {
  if (!unsaved) return null;
  const row = catalogue.rows[unsaved.id];
  return t('A rep of %1 was not saved: %2', row ? rowName(row) : unsaved.id, unsaved.message);
};

// ---- the library ----------------------------------------------------------------------------------------

/** How far below the body's view a grid is drawn before it is reached (dev-docs/practice-redesign-plan.md §4.4). */
const DRAW_AHEAD_PX = 200;

/** How near the body's top a stage's section is the one the rail says the reader is in. */
const SPY_PX = 40;

function libraryScreen() {
  return {
    html: `<div class="practice-screen" data-composition="library">
      <div class="lib-head">
        <div class="wrap-row" id="methodRow"></div>
        <span class="ct lib-sum"></span>
        <div class="lib-say" id="practiceLibrarySay" role="status" hidden></div>
      </div>
      <nav class="rail" id="practiceRail" aria-label="${escHtml(t('Stages'))}"></nav>
      <div class="lib-body" id="practiceList">
        <div class="sub" id="practiceWait" role="status" style="color:var(--ink-4)">${escHtml(t('Reading the algorithms…'))}</div>
      </div>
    </div>`,
    async mount(root) {
      const gen = screenGen;
      const box = root.querySelector('.practice-screen');
      const list = $('#practiceList', root);
      let catalogue;
      try {
        catalogue = await library.catalogue();
      } catch (err) {
        if (gen !== screenGen) return;
        console.error('the algorithm library could not be read', err);
        // A failure is not kept by the library client (lib/drill/library-client.js), so asking again is a real retry.
        list.innerHTML = `<div class="sub" role="status" style="color:var(--err-ink)">${escHtml(t('The algorithms could not be read: %1', err.message))}</div>
          <button class="pill" id="practiceListRetry" type="button">${escHtml(t('Try again'))}</button>`;
        $('#practiceListRetry', root).onclick = () => renderScreen();
        return;
      }
      if (gen !== screenGen) return;
      mountLibrary({ root, box, list, catalogue, signal: screenAbort?.signal });
      box.dataset.ready = '1';
    },
  };
}

/** The library's whole life once the catalogue is here: the method row, the rail, the stages, the record's rings. */
function mountLibrary({ root, box, list, catalogue, signal }) {
  const rail = $('#practiceRail', root);
  const said = $('#practiceLibrarySay', root);
  const look = { palette: settings.palette, scheme: settings.scheme };
  const n = fingersTarget(settings.fingersN);
  const stale = () => signal?.aborted;

  // ---- what the library says: a save that did not land, a record that could not be read, a choice not kept ------
  const trouble = { read: null, kept: null };
  const say = () => {
    const text = [unsavedWords(catalogue), trouble.read, trouble.kept].filter(Boolean).join(' ');
    said.hidden = !text;
    said.textContent = text;
  };
  sayUnsavedWhileMounted(say, signal);
  const pending = pendingHtml(catalogue, escHtml);
  if (pending) said.insertAdjacentHTML('beforebegin', pending);

  // ---- the method: the solve tab's own row, with the library's two groups (plan §4.1) --------------------------
  const methods = libraryMethods(catalogue);
  let key = openingKey(catalogue, settings);
  $('#methodRow', root).innerHTML = methodRowHtml({ methods, chosen: key, escHtml });
  const row = createMethodRow({ root, signal, methods, shown: key, place: placeMenuUnder, levels: LIBRARY_LEVELS });
  /** A method chosen HERE is the library's (`practiceMethod`), never the solve tab's: what to practise is not how to
   *  solve. A choice that cannot be stored is said, because one that silently does not stick reads as forgetting. */
  const choose = (id) => {
    if (id === key || !methods.some((m) => m.id === id)) return;
    settings.practiceMethod = id;
    trouble.kept = save('cubusSettings', settings) ? null : t('This choice of method could not be remembered for next time.');
    key = id;
    row.paint(key);
    say();
    draw();
  };
  root.addEventListener('click', (e) => {
    const pick = e.target.closest?.('[data-method]');
    if (pick && root.contains(pick)) choose(pick.dataset.method);
  }, { signal });

  // ---- the record: ONE read for every ring, and a ring only for a read that has completed (plan §4.2) -----------
  let figures = null;   // Map of row id → its figures (`statsOf`) once read; null while reading or when the read failed
  let reading = null;
  const record = openPracticeRecord({
    store: indexedDbStore(indexedDB), legacy: localStorage, broadcast: BroadcastChannel,
    now: () => Date.now(), signal,
    // Another window's committed write, or a change in what the record can reach: read again.
    onChange: () => { if (!stale()) readRecord(); },
  });
  const NONE = statsOf([]);
  /** A row's figures once the record is read: a row with no reps on record is read, and zero. */
  const figuresOf = (id) => figures?.get(id) ?? NONE;
  const readRecord = () => {
    const ticket = {};
    reading = ticket;
    figures = null;
    list.dataset.record = 'reading';
    paintProgress();
    record.read().then((algs) => {
      if (reading !== ticket || stale()) return;
      figures = new Map([...algs].map(([id, reps]) => [id, statsOf(reps)]));
      trouble.read = null;
      list.dataset.record = 'read';
      paintProgress();
      say();
    }, (err) => {
      if (!(err instanceof PracticeRecordError)) throw err;
      if (reading !== ticket || stale()) return;
      trouble.read = t('Your practice record could not be read (%1), so no progress is shown.', err.code);
      list.dataset.record = 'unreadable';
      paintProgress();
      say();
    });
  };

  // ---- drawing --------------------------------------------------------------------------------------------------
  let group = null;
  let near = null;      // the IntersectionObserver that draws a grid as it comes near the view
  let drawn = null;     // aborts what one method's drawing wired: its book menus and their listeners
  const strip = oneLineStrip(rail, { signal });

  /** Rings and counts for whatever is drawn, from the read — or none while there is no read to draw them from. */
  function paintProgress(scope = list) {
    if (!group) return;
    for (const tile of scope.querySelectorAll('[data-alg]')) {
      const rowNow = catalogue.rows[tile.dataset.alg];
      // The page's beads draw the same reading (`fingersOf` in lib/drill/record.js), so a tile and its page agree (WI-7).
      const stats = figures ? figuresOf(rowNow.id) : null;
      tile.querySelector('.badge').innerHTML = tileRing(stats, n, 24);
      tile.classList.toggle('done', Boolean(fingersOf(stats, n)?.reached));
      tile.setAttribute('aria-label', tileLabel(rowNow, stats?.streak ?? null, n));
    }
    if (scope !== list) return;
    const plain = (ids) => `<span class="num">${ids.length}</span>`;
    const count = (ids, size) => (figures ? countHtml(ids, figuresOf, n, size) : plain(ids));
    group.phases.forEach((p, i) => {
      const ids = stageIds(catalogue, p);
      for (const ct of [rail.querySelector(`[data-jump="${i}"] .ct`), list.querySelector(`[data-sec="${i}"] .ct`)]) if (ct) ct.innerHTML = count(ids, 14);
    });
    const all = [...new Set(group.phases.flatMap((p) => stageIds(catalogue, p)))];
    $('.lib-sum', root).innerHTML = figures ? countHtml(all, figuresOf, n, 22) : '';
  }

  /**
   * An empty grid holds the room its tiles will take: rows of the tile height (`--tile-h`) over the columns its own
   * auto-fill resolves to. Empty and 0px tall, every stage sat inside the first screen and every grid "came near the
   * view" at once, which drew the whole method at every visit — the cost the drawing on approach exists to avoid.
   */
  function reserve(grid) {
    const style = getComputedStyle(grid);
    const columns = style.gridTemplateColumns.split(' ').filter(Boolean).length || 1;
    const rows = Math.ceil(gridIds(catalogue, grid.dataset.set, grid.dataset.part).length / columns);
    const gap = parseFloat(style.rowGap) || 0;
    grid.style.minHeight = `${rows * (parseFloat(style.getPropertyValue('--tile-h')) || 0) + Math.max(0, rows - 1) * gap}px`;
  }

  /** A grid's tiles, built the first time it comes near the view, and kept. */
  function fill(grid) {
    grid.style.minHeight = '';
    grid.innerHTML = tilesHtml(gridIds(catalogue, grid.dataset.set, grid.dataset.part), catalogue, look, escHtml);
    paintProgress(grid);
    photograph(grid);
  }

  /** The rail's item for the section nearest the body's top: where the reader is. */
  function spy() {
    const top = list.getBoundingClientRect().top;
    let at = 0;
    for (const sec of list.querySelectorAll('.stage-sec')) if (sec.getBoundingClientRect().top - top <= SPY_PX) at = Number(sec.dataset.sec);
    for (const item of rail.querySelectorAll('[data-jump]')) {
      const on = Number(item.dataset.jump) === at;
      item.classList.toggle('on', on);
      if (on) item.setAttribute('aria-current', 'true'); else item.removeAttribute('aria-current');
    }
    strip.reveal(rail.querySelector('.rail-item.on'));
  }

  /** One method, drawn: its rail, its stages with their grids empty, and a book menu per stage. */
  function draw() {
    drawn?.abort();
    drawn = new AbortController();
    signal?.addEventListener('abort', () => drawn.abort(), { once: true });
    near?.disconnect();
    for (const m of root.querySelectorAll('.about-menu')) m.remove();
    group = catalogue.groups.find((g) => libraryKey(g) === key);
    box.dataset.method = key;
    inLine = Promise.resolve();
    rail.innerHTML = railHtml(group, catalogue, look, escHtml);
    list.innerHTML = bodyHtml(group, catalogue, look, escHtml, icon);
    list.scrollTop = 0;
    paintProgress();
    // The book: what each of the stage's sets is for, written into the menu as it opens — the only prose the library
    // has, and none of it in the page until a reader asks (R1).
    group.phases.forEach((p, i) => {
      const button = list.querySelector(`[data-about="${i}"]`);
      const menu = createMenu({
        root, button, label: t('What these are for'), signal: drawn.signal, place: placeMenuUnder, dismiss: true,
        beforeOpen: () => { menu.el.innerHTML = aboutHtml(p, catalogue, escHtml); },
      });
      menu.el.classList.add('about-menu');
      menu.el.setAttribute('role', 'dialog');
    });
    near = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        near.unobserve(e.target);
        fill(e.target);
      }
    }, { root: list, rootMargin: `${DRAW_AHEAD_PX}px 0px` });
    for (const grid of list.querySelectorAll('.tiles')) {
      reserve(grid);
      near.observe(grid);
    }
    spy();
  }
  signal?.addEventListener('abort', () => near?.disconnect(), { once: true });

  rail.addEventListener('click', (e) => {
    const item = e.target.closest?.('[data-jump]');
    const sec = item && list.querySelector(`[data-sec="${item.dataset.jump}"]`);
    if (!sec) return;
    list.scrollTop += sec.getBoundingClientRect().top - list.getBoundingClientRect().top;
    spy();
  }, { signal });
  list.addEventListener('scroll', spy, { passive: true, signal });

  // ---- the photographs: a net row's tile is a PHOTOGRAPH of the app's own cube (lib/case-photo.js) ---------------
  // Taken by the one renderer while this screen draws none, in the order the tiles are built. Its well stays empty
  // until the photograph lands; with no renderer to borrow the tile draws the flat picture it always had.
  const photographer = casePhotographer({ host: box, signal });
  const attrsOf = (tile) => {
    const r = catalogue.rows[tile.dataset.alg];
    return photoAttrs(r, catalogue.sets[r.set].region);
  };
  /**
   * READING ORDER, EACH AS IT LANDS (plan §13 item 3). The photographer takes them in the order asked, which is the
   * order of the page; but a photograph the session already holds — the same case asked for by an earlier tile, or a
   * stage come back to — answers at once, and was shown ahead of tiles still waiting above it. So each tile is shown
   * once it AND every tile asked for before it have landed. `draw` starts the line again for a new method.
   */
  function photograph(grid) {
    for (const well of grid.querySelectorAll('.case-photo[data-photo="pending"]')) {
      const tile = well.closest('[data-alg]');
      const landed = photographer.photo(attrsOf(tile));
      inLine = inLine.then(() => landed).then((url) => {
        if (!well.isConnected) return;
        if (url) {
          const img = document.createElement('img');
          img.alt = '';
          img.src = url;
          well.replaceChildren(img);
          well.dataset.photo = 'shown';
        } else if (photographer.unavailable) {
          const flat = document.createElement('template');
          flat.innerHTML = casePicture(catalogue.rows[tile.dataset.alg], look);
          well.replaceWith(flat.content);
        }
      }, (err) => {
        console.error(`the photograph of ${tile.dataset.alg} could not be taken`, err);
        well.dataset.photo = 'failed';
      });
    }
  }
  let inLine = Promise.resolve();
  // The pulse: pointing at or focusing a photographed tile puts the live renderer in it; leaving puts it back.
  const wellIn = (el) => el?.closest?.('[data-alg]')?.querySelector('.case-photo[data-photo="shown"]') ?? null;
  const enter = (e) => {
    const well = wellIn(e.target);
    if (well) photographer.pulse(well, attrsOf(well.closest('[data-alg]')));
  };
  const leave = (e) => {
    const tile = e.target.closest?.('[data-alg]');
    if (tile && !tile.contains(e.relatedTarget)) photographer.rest(wellIn(tile));
  };
  list.addEventListener('pointerover', enter, { signal });
  list.addEventListener('focusin', enter, { signal });
  list.addEventListener('pointerout', leave, { signal });
  list.addEventListener('focusout', leave, { signal });
  list.addEventListener('click', (e) => {
    const tile = e.target.closest?.('[data-alg]');
    if (!tile) return;
    state.practiceAlg = tile.dataset.alg;
    renderScreen();
  }, { signal });

  draw();
  readRecord();
}

// ---- the page -------------------------------------------------------------------------------------------

/** The algorithm as the element draws it from `facelets` held `hold`: identity-frame tokens (`run().drawn`). */
const drawnFrom = (row, hold, facelets) => run(parse(row.alg), hold, stateFrom(facelets)).drawn.join(' ');

/** A face turned `q` quarters, in the piece model's names (`R`, `R2`, `R'`), or null for none. */
const quarterName = (face, q) => ({ 1: face, 2: `${face}2`, 3: `${face}'` })[((q % 4) + 4) % 4] ?? null;

/**
 * The turns still to make to finish the identity-frame move `identity` from the pieces `from`, for a cube now at
 * `now` part way through it — as the cube's own face turns — or null when `now` is not part way through it.
 *
 * The faces of one move lie on one axis and commute, so each is part way through its own turn independently, and a
 * half turn can be part way either way round (undoing `R2` passes through `R'`): the reading `between` in
 * lib/script-track.js makes of a midpoint, which is what the engine accepted.
 */
function stillToTurn(identity, from, now) {
  const faces = faceTurnsOf(identity).turns.filter((x) => x.name)
    .map((x) => ({ face: x.face, quarters: x.name.endsWith('2') ? 2 : x.name.endsWith("'") ? -1 : 1 }));
  const pick = (done) => {
    if (done.length < faces.length) {
      for (const q of Math.abs(faces[done.length].quarters) === 1 ? [0, faces[done.length].quarters] : [0, 1, -1, 2]) {
        const found = pick([...done, q]);
        if (found) return found;
      }
      return null;
    }
    const left = faces.map((f, k) => (((f.quarters - done[k]) % 4) + 4) % 4);
    // None made, or all of them, is a position — not a point part way through the move.
    if (done.every((q) => q === 0) || left.every((q) => q === 0)) return null;
    let state = from;
    done.forEach((q, k) => { const name = quarterName(faces[k].face, q); if (name) state = applyMove(state, name); });
    return toFacelets(state) === now ? left.map((q, k) => quarterName(faces[k].face, q)).filter(Boolean) : null;
  };
  return faces.length ? pick([]) : null;
}

/** The page's controls that need the catalogue: drawn disabled (`pageHtml`), live once `mountPage` has it. */
const PAGE_CONTROLS = Object.freeze([
  'practiceBook', 'speedBtn', 'practiceBlocked', 'practiceMixed', 'practiceNext', 'demoPrev', 'demoRepeat', 'demoNext', 'demoAll', 'practiceClock', 'practiceRestart',
]);

/**
 * What must be done, said where it is seen (dev-docs/practice-redesign-plan.md E11.3): the follow-note, in the quiet
 * line's place while it shows, so the cube keeps its size. `text` null puts it away. The slot holds the note ALONE: the
 * record's notice has a row of its own, in the foot band in portrait (E12.3), so the two never stack.
 */
function sayInNote(root, text) {
  const msg = $('#followMsg', root);
  if (msg.textContent !== (text ?? '')) msg.textContent = text ?? '';
  $('#followNote', root).hidden = !text;
}

function pageScreen() {
  /** Set by mount: takes a new row in place. Null until the mount has the catalogue. */
  let showRow = null;
  return {
    html: pageHtml(escHtml, icon),
    update() {
      if (!showRow || !state.practiceAlg) return false;
      return showRow(state.practiceAlg);
    },
    async mount(root) {
      const gen = screenGen;
      const signal = screenAbort?.signal;
      const stale = () => gen !== screenGen || signal?.aborted;
      const page = root.querySelector('.practice-page');
      // The way out is wired before anything is asked for, so it works whatever the answer. Every other control
      // waits, disabled, for the catalogue it needs (`pageHtml`); `mountPage` lets them go.
      $('#practiceBack', root).onclick = openLibrary;
      let catalogue;
      try {
        catalogue = await library.catalogue();
      } catch (err) {
        if (stale()) return;
        console.error('the algorithm library could not be read', err);
        const words = t('The algorithms could not be read: %1', err.message);
        $('#practiceSay', root).textContent = words;
        sayInNote(root, words);
        // A failure is not kept by the library client, so asking again is a real retry.
        const retry = $('#practiceRetry', root);
        retry.hidden = false;
        retry.onclick = () => renderScreen();
        return;
      }
      if (stale()) return;
      if (!Object.hasOwn(catalogue.rows, state.practiceAlg ?? '')) {
        // An id the ledger does not hold (a lesson's, from before the ledger changed): the library, saying so.
        console.warn(`practice: the ledger holds no algorithm "${state.practiceAlg}"`);
        state.practiceAlg = null;
        renderScreen();
        return;
      }
      showRow = mountPage({ root, page, catalogue, signal, stale });
      showRow(state.practiceAlg);
      page.dataset.ready = '1';
    },
  };
}

/** The page's whole life: the cube, the engine, the record, the demo and the stopwatch. Returns `show(id)`. */
function mountPage({ root, page, catalogue, signal, stale }) {
  const say = $('#practiceSay', root);
  const chipsBox = $('#practiceAlg', root);
  const time = $('#practiceTime', root);
  const face = $('#practiceClockFace', root);
  const clockBtn = $('#practiceClock', root);
  const clockLabel = clockBtn.querySelector('.sr-only');
  const demoButtons = ['#demoPrev', '#demoRepeat', '#demoNext', '#demoAll'].map((id) => $(id, root));
  const recordSay = $('#practiceRecordSay', root);
  // The move strip is the cube screen's (lib/scroll-strip.js): one line in portrait, the turn you are on at its centre.
  const strip = oneLineStrip(chipsBox, { signal });
  // The record is in IndexedDB, and every call to it answers later. It owns its connection and its channel, and the
  // screen's signal closes both. `onChange` is another window's committed write, or a change in what the record can
  // reach (`status()`): the notice is said again and the record on screen read again. It is raised when a status
  // CHANGES, never again for a read that fails the way the last one did, so a read it asks for cannot ask for the next.
  const record = openPracticeRecord({
    store: indexedDbStore(indexedDB), legacy: localStorage, broadcast: BroadcastChannel,
    now: () => Date.now(), signal,
    onChange: () => {
      if (stale()) return;
      sayRecord();
      if (row) paintRecord();
    },
  });

  let row = null;
  let caseNow = null;
  let engine = null;
  let engineConn = null;      // the session the engine judges — a new one is a new stream (`presenceChanged`)
  let modelCount;             // the serial of the last report or arrangement that set the engine's model (`makeEngine`)
  let token = null;
  let startFacelets = null;   // the arrangement the current rep was armed from (the engine's start event)
  let turnsSinceArm = 0;
  let waitingForReport = false;
  let lastResult = null;
  let drawnKey = null;        // what the cube was last given, so a repaint does not reset it for nothing
  let drewFollowed = false;   // whether the cube shows a followed cube's picture rather than the case (`paint`)
  let mixed = null;           // { order, at } while practising mixed
  let advanceTicket = null;   // the mixed-practice step on a `done` queued, until it runs or a start over calls it off
  let modeTicket = null;      // mixed practice asked for, until the record has ordered it or Blocked calls it off
  // What a mixed-practice order still being read was asked in. A start over, another row and the first turn of an
  // attempt each begin another (`newAttempt`): an order that lands after one of them would change the algorithm under
  // the child's hands, so it is dropped — the click on Mixed, and the step into the next round, alike.
  let attempt = 0;
  const newAttempt = () => { attempt += 1; };
  let watch = { t0: null, timer: null, laps: [] };
  let shownAt = 0;            // the demo's position, from the element's own report

  // ---- the cube -----------------------------------------------------------------------------------------
  // Put into the page by the first `show`, once its attributes hold that row's picture: `connectedCallback` draws at
  // once (AGENTS.md §2), so a cube connected here drew a solved cube with no hold and no moves, which the row then
  // replaced. Until it goes in, a seek is remembered rather than made (`seek`).
  const cube = newCube({ subject: { facelets: SOLVED_FACELETS(), moves: [], isPhysical: false } });
  cube.setAttribute('aria-label', t('The algorithm, on a cube'));
  // The record's notice: its own row in landscape, over the foot of the cube card in portrait (lib/foot-band.js, E12.3).
  // The band is clear of the cube once the page has put the cube in; until then there is nothing to be clear of.
  // Its room is kept for the longest it can say: both fixed sentences at once (E12.8).
  footBand({ host: page, card: $('.practice-page > .primary', root), cube: () => (cube.isConnected ? cube : null), rows: [recordSay], signal,
    longest: () => [[{ row: recordSay, text: `${t(RECORD_SAYS.save)} ${t(RECORD_SAYS.read)}` }]] });
  let seekWhenIn = null;
  const seek = (k) => { if (cube.isConnected) cube.seek(k); else seekWhenIn = k; };
  cube.addEventListener('cubus-step', (e) => {
    shownAt = e.detail?.index ?? 0;
    if (!live()) markChips(shownAt);
  }, { signal });

  const draw = ({ facelets, hold, alg, arrow }) => {
    const key = `${facelets}|${holdSpec(hold)}|${alg}`;
    if (key !== drawnKey) {
      drawnKey = key;
      cube.setAttribute('orientation', holdSpec(hold));
      cube.setAttribute('alg', alg);
      cube.setAttribute('facelets', facelets);
    }
    cube.setAttribute('arrow', arrow);
  };

  // ---- the chips ----------------------------------------------------------------------------------------
  /**
   * The chips to position `k`, and the transport's progress with them. `off`: the index of the turn that was expected
   * when the cube left the algorithm — that chip is marked off (§5.4, `.chip-m.off`), centred, and no chip is current.
   * Only `off` marks one: half of one move and a lost turn never do.
   */
  const markChips = (k, off = null) => {
    const chips = [...chipsBox.querySelectorAll('.chip-m')];
    for (const chip of chips) {
      const i = Number(chip.dataset.k);
      chip.classList.toggle('played', i < k);
      chip.classList.toggle('cur', off === null && i === k - 1);
      chip.classList.toggle('off', i === off);
    }
    strip.centre((off === null ? null : chips[off]) ?? chips[k - 1] ?? chips[0] ?? null);
    const n = chips.length;
    const at = Math.max(0, k);
    const bar = $('#practiceProgress', root);
    bar.setAttribute('aria-valuemax', String(n));
    bar.setAttribute('aria-valuenow', String(at));
    bar.setAttribute('aria-valuetext', t('%1 of %2', at, n));
    $('#practiceProg', root).style.width = n ? `${(at / n) * 100}%` : '0%';
    $('#practiceDone', root).hidden = !n || at < n;
  };

  // ---- the record ---------------------------------------------------------------------------------------
  /**
   * What the page says about the record: a READ that failed and a WRITE that did not land, each standing until what it
   * said stops being true — a read that works, a rep that is saved. They are about the record, never about the row on
   * screen, so taking another row in place clears neither: mixed practice moved on right after the rep that was not
   * saved, and the only sign of the loss went with it. The write is the module's (`unsaved`), because a save can answer
   * after its page has gone, and the next page says it too.
   *
   * And the record's own STATE, read from `record.status()` at every saying and never kept here: a database this page
   * cannot reach now (`error`, said only while no failed read is saying it), and the earlier record — the one
   * localStorage held — when it is not in this one (`legacy`).
   */
  const trouble = { read: null };
  // IN FIXED WORDS (E12.8): the notice stands in the band over the cube card in portrait, whose room is kept for the
  // longest thing it can say — so it says one of two sentences known in advance, never a failure's own message. Each
  // failure is logged where it is first seen here, once.
  const logged = new WeakSet();
  const logOnce = (what, err) => {
    if (!err || logged.has(err)) return;
    logged.add(err);
    console.error(`practice: ${what}: ${err.message}`, err);
  };
  const sayRecord = () => {
    const { error, legacy } = record.status();
    logOnce('the practice record cannot be reached', error);
    logOnce('the earlier practice record could not be read', legacy);
    const text = [
      unsaved ? t(RECORD_SAYS.save) : null,
      error || legacy || trouble.read ? t(RECORD_SAYS.read) : null,
    ].filter(Boolean).join(' ');
    recordSay.hidden = !text;
    recordSay.textContent = text;
  };
  sayUnsavedWhileMounted(sayRecord, signal);

  /**
   * THE FIGURES, THE STREAK AND THE HISTORY ARE A READ THAT HAS COMPLETED. While one is pending they are unknown — a
   * dash, never the figures an earlier read found nor those of an empty record — and only the newest read paints: a
   * later read, another row or leaving the screen takes the ticket (`reading`). `data-record` says which it is.
   */
  let reading = null;
  const paintFigures = (reps) => {
    const known = reps === RECORD_READING ? null : reps;
    const stats = known && statsOf(known);
    // The newest rep on record clean but paused: the row it broke starts again from the bead it would have lit (E12.4).
    const newest = known?.at(-1);
    const paused = Boolean(newest?.clean && newest.pauses > 0);
    $('#practiceFingers', root).outerHTML = beadsHtml(stats, fingersTarget(settings.fingersN), escHtml, { paused });
    $('#practiceFigures', info.el).innerHTML = figuresHtml(stats, escHtml);
    $('#practiceReps', info.el).innerHTML = lastRepsHtml(reps, escHtml);
    page.dataset.record = reps === RECORD_READING ? 'reading' : reps === null ? 'unreadable' : 'read';
  };
  const paintRecord = () => {
    const ticket = {};
    reading = ticket;
    paintFigures(RECORD_READING);
    const current = () => reading === ticket && !stale();
    record.reps(row.id).then((reps) => {
      if (!current()) return;
      trouble.read = null;
      paintFigures(reps);
      sayRecord();
    }, (err) => {
      if (!(err instanceof PracticeRecordError)) throw err;
      if (!current()) return;
      logOnce(`its record could not be read (${err.code})`, err);
      trouble.read = t(RECORD_SAYS.read);
      paintFigures(null);
      sayRecord();
    });
  };

  /**
   * A REP IS SAID SAVED ONLY ONCE THE RECORD HAS SAID SO. Nothing is painted when the rep ends; when its save settles,
   * a save that did not land is said, and the row the rep was made on — if it is still the row on screen — is read
   * again, which is how the rep reaches the figures. The record runs its calls one after another in the order they
   * were made, so saves settle in the order the reps ended and the notice's last word is the newest rep's. A rejected
   * save is a defect (`add` answers `saved: false` for every trouble of the record's own): said like a lost rep, and
   * thrown on. `data-saving` counts the saves in flight.
   */
  let saving = 0;
  page.dataset.saving = '0';
  const saveRep = (id, rep) => {
    const pending = record.add(id, rep);
    page.dataset.saving = String(saving += 1);
    const settled = (error) => {
      page.dataset.saving = String(saving -= 1);
      // What the save answered is kept whether or not this page is still here (`unsaved`); only painting needs it.
      // Said in fixed words on the page (E12.8); the failure's own words are logged here, where it arrived.
      if (error) console.error(`practice: a rep of ${id} was not saved: ${error.message}`, error);
      keepUnsaved(error ? { id, message: error.message } : null);
      if (stale()) return;
      if (row?.id === id) paintRecord();
    };
    pending.then((done) => settled(done.saved ? null : done.error), (err) => { settled(err); throw err; });
  };

  // ---- the engine ---------------------------------------------------------------------------------------
  /** Arm from the cube's arrangement as its own reports last gave it — `live`, or the report the reconnect question
   *  holds back — and only while it accounts for every turn the cube has counted (`reportedArrangement`); false, and
   *  nothing armed, when there is no such report. Either kind of report is the cube's
   *  model in the frame its turns move it in, which is all a tracker RELATIVE to the cube's own reports needs (plan
   *  §3.1); neither is a claim about its colours. A report the cube has turned away from is none: an engine armed
   *  from one judged the next snapshot a contradiction of a clean rep, so the page waits for that snapshot instead.
   *  Read from the reports layer, not kept here, so a report that came before this page did is not lost. With it
   *  comes the serial the report was taken at: the engine counts the next report from it, so a turn lost straight
   *  after the report is caught (`countFrom` in lib/drill/engine.js). */
  const startFromReport = () => {
    const now = reportedArrangement();
    if (!now) return false;
    modelCount = countOf(now.serial);
    engine.start({ facelets: now.facelets, serial: modelCount });
    return true;
  };
  const live = () => Boolean(engine) && engine.state.status !== STATUS.IDLE && cubeHere();

  const makeEngine = (judged) => {
    // The model carries to a new row only on the SAME connection — another session's arrangement is another stream's
    // — and only from an engine that was following: an idle one hears no turns, so its model is where the cube WAS.
    const st0 = engine?.state;
    const carry = st0 && engineConn === conn && st0.status !== STATUS.IDLE && st0.trusted ? engine.facelets : null;
    const carryCount = modelCount;
    engine?.stop();
    const mine = {};
    const session = conn;
    token = mine;
    engineConn = session;
    startFacelets = null;
    turnsSinceArm = 0;
    waitingForReport = false;
    lastResult = null;
    const rowId = row.id;
    const reps = watchReps((rep) => saveRep(rowId, rep));
    // ONE CONNECTION'S ENGINE. Its own timers (the cue window) can fire after its cube has gone, or after another
    // has taken its place inside one presence tick — and an `off` then would blame a turn nobody can see.
    const ours = () => token === mine && !stale() && conn === session && cubeHere();
    engine = createDrillEngine({
      alg: judged,
      chunks: row.chunks.map(({ from, to }) => ({ from, to })),
      numbersMoves: session?.numbersMoves?.() === true,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h),
      now: () => performance.now(),
      sound: (name) => { if (ours()) play(name); },
      onEvent: (e) => {
        if (!ours()) return;
        reps(e);
        heard(e, mine);
        // `off` is the one event the engine raises on its own clock (the cue window), not inside a call
        // of ours that paints after it — so it paints here, or the page says nothing until the next turn.
        if (e.type === 'off') paint();
      },
    });
    // A carried model goes on with the serial count it was built under — the last report's, or the arrangement's it
    // was handed — so the next report is compared with it. Carried with none, the next report was compared with
    // nothing, and a turn lost straight after the switch was read as a turn made.
    if (cubeHere()) {
      if (carry) engine.start({ facelets: carry, serial: carryCount });
      else startFromReport();
    }
  };

  const heard = (e, mine) => {
    if (['start', 'next', 'restart', 'gesture'].includes(e.type)) {
      startFacelets = e.facelets;
      turnsSinceArm = 0;
      waitingForReport = false;
    }
    if (e.type === 'refused') waitingForReport = true;
    // A start over — the button, Escape, the cube's own gesture — is a request for THIS algorithm again: a step on
    // queued by the rep that just ended is called off, or the page would switch under the rep it had just re-armed.
    if (e.type === 'restart' || e.type === 'gesture') {
      advanceTicket = null;
      newAttempt();
    }
    if (e.type === 'done') {
      lastResult = e.result;
      // Mixed practice moves on once this rep is filed — after the engine has finished arming the next one,
      // so the engine being replaced is never stopped from inside its own `done`. Its own ticket, because a
      // start over keeps the engine and so its token: only the ticket says the step was called off.
      if (mixed) {
        const ticket = {};
        advanceTicket = ticket;
        const asked = attempt;   // the attempt this rep finished, not whatever one is current when the timer runs
        setTimeout(() => {
          if (advanceTicket === ticket && token === mine && !stale() && turnsSinceArm === 0) advance(asked);
        }, 0);
      }
    }
  };

  // ---- painting -----------------------------------------------------------------------------------------
  /** A timed part is named by its trigger, the only parts the engine is asked to time (`makeEngine`). */
  const partName = (split) => {
    const chunk = row.chunks.find((c) => c.from === split.from && c.to === split.to);
    return t(catalogue.triggers[chunk?.trigger]?.name ?? chunk?.trigger ?? '—');
  };
  const paintParts = (result) => {
    const box = $('#practiceParts', info.el);
    const text = result ? partsWords(result, partName) : '';
    box.hidden = !text;
    box.textContent = text;
  };
  /**
   * A clean rep's split times beside the trigger labels in the strip (§5.4), each part's own on the cube's clock, while
   * that rep's time is the clock's — from the rep's end to the next one's first turn. Never a rep that left the
   * algorithm or paused (its parts are not the algorithm's own pace), and never a part the clock could not time.
   * `st` null: not following, so nothing measured stands there.
   */
  const paintSplits = (st) => {
    const r = st && st.status === STATUS.ARMED ? lastResult : null;
    const shown = r && r.clean && r.ms !== null && !r.pauses?.length ? r.splits : [];
    for (const sec of chipsBox.querySelectorAll('.walk-sec')) {
      const slot = sec.querySelector(':scope > .walk-sec-l > .walk-sec-t');
      if (!slot) continue;
      const split = shown.find((x) => x.from === Number(sec.dataset.from) && x.to === Number(sec.dataset.to) && x.ms !== null);
      const words = split ? ` ${seconds(split.ms)}` : '';
      if (slot.textContent !== words) slot.textContent = words;
    }
  };
  /** The stopwatch's button says what a press does, for a screen reader; the glyph is what is seen. */
  const clockSays = (words) => { clockLabel.textContent = words; clockBtn.setAttribute('aria-label', words); };
  /** The clock: `words` for a screen reader (`#practiceTime`), the bare figure on its face — or, while a rep is under
   *  way with a cube, the timer glyph (§5.5): the only number the page could tick is host time, which the cube's own
   *  time would then replace with a different value. */
  const showTime = (words, figure) => {
    if (time.textContent !== words) time.textContent = words;
    if (figure === GLYPH) { if (!face.querySelector('svg')) face.innerHTML = icon('timer', 18); } else if (face.textContent !== figure || face.querySelector('svg')) face.textContent = figure;
  };
  const paintClock = () => {
    const following = live();
    if (following && watch.t0 !== null) {
      // The cube's clock takes over. A stopwatch left running would go on writing its own count over every
      // time the cube measured, every 50 ms; the lap it was timing ends with nothing claimed for it.
      stopWatch();
      watch.t0 = null;
      clockSays(t('Start the stopwatch'));
    }
    clockBtn.hidden = following;
    // The step buttons walk the moves on the screen's cube; with a smart cube the cube in the hand leads (§5.5).
    for (const b of demoButtons) b.hidden = following;
    paintParts(following ? lastResult : null);
    if (following) {
      if (UNDER_WAY.has(engine.state.status)) showTime(t('A rep is under way: your cube times it'), GLYPH);
      else if (lastResult) {
        const r = lastResult;
        if (r.ms === null) showTime(t('— (%1)', refusalWords(r.refused)), '—');
        else {
          showTime(r.tps ? t('%1, first turn to last · %2 turns a second (%3)', seconds(r.ms), r.tps.value.toFixed(1), r.tps.metric)
            : t('%1, first turn to last', seconds(r.ms)), seconds(r.ms));
        }
      } else showTime('—', '—');
      return;
    }
    if (watch.t0 === null) {
      clockSays(t('Start the stopwatch'));
      const lap = watch.laps.at(-1);
      showTime(watch.laps.length ? t('%1 on your stopwatch', seconds(lap)) : '—', watch.laps.length ? seconds(lap) : '—');
    }
  };

  /** What the page says. `arrowShown`: whether the cube is drawing an arrow — no sentence may send the child to one
   *  that is not there (before the hold is known it once did, and with Turn arrows off every sentence did). */
  const sentence = (arrowShown) => {
    if (!cubeHere()) return t('No smart cube connected: the cube on screen shows the moves, part by part. Time yourself with the stopwatch.');
    const st = engine.state;
    if (waitingForReport) return t('A turn went missing, so cubus does not know where your cube is. Waiting for the cube to say.');
    if (st.status === STATUS.IDLE) return t('Waiting for your cube to say where it is.');
    if (st.status === STATUS.UNCERTAIN) return t('A turn went missing between your cube and the app, so this rep is not judged. Finish it, or start over.');
    if (st.status === STATUS.OFF) {
      const lead = st.about === 'turn' ? t('That turn left the algorithm.') : t('Your cube left the algorithm.');
      if (!st.wayBack) return t('%1 It is too far to turn back: press Start over, or turn one face four times.', lead);
      if (st.wayBack.held) return t('%1 Turn it back: %2', lead, st.wayBack.held.join(' '));
      // The holds still standing name the way back differently, so no letters say it: only the arrow can show it,
      // and with no arrow on the cube, starting over is the way that needs no letters.
      return arrowShown ? t('%1 Follow the arrow back.', lead) : t('%1 Press Start over, or turn one face four times.', lead);
    }
    // A clean rep with a marked pause broke the row: said here, to a screen reader, and in the book — never in the
    // follow-note, which is for what must be done (E11.3, E12.4). The bead shows it.
    const pause = st.status === STATUS.ARMED && lastResult?.clean && lastResult.pauses?.length
      ? t('That rep had a pause, so the row of clean reps starts again.') : '';
    const go = narrate(st, arrowShown);
    return pause ? t('%1 %2', pause, go) : go;
  };
  const narrate = (st, arrowShown) => {
    // Not "its first turns tell cubus how you are holding it": for drop-in and the H perm no turn ever does.
    if (!drawHold(st)) return t('Hold the cube any way you like and start: cubus follows from your first turns.');
    if (!arrowShown) return st.status === STATUS.ARMED ? t('Go: start the algorithm.') : t('Keep going.');
    return st.status === STATUS.ARMED ? t('Go: the arrow shows the first turn.') : t('Keep going: the arrow shows the next turn.');
  };

  /** Whether the page's sentence asks something of the person — said in the follow-note, where it is seen — or only
   *  narrates (E11.3): no cube, the hold not known yet, and "keep going" are said to a screen reader alone. */
  const mustAct = (st) => cubeHere() && (waitingForReport || [STATUS.IDLE, STATUS.UNCERTAIN, STATUS.OFF].includes(st.status));

  /** Each hold's track — the arrangement at every position of the whole algorithm, from solved — which two holds must
   *  share for one picture to stand for both. Worked out once per hold for the row on the page (`show` empties it). */
  let tracks = new Map();
  const trackIn = (hold) => {
    const key = holdSpec(hold);
    if (!tracks.has(key)) {
      let now = { state: SOLVED, hold: [...hold] };
      const states = [toFacelets(SOLVED)];
      for (const move of parse(row.alg)) {
        now = applyIdentity(toIdentity(move, now.hold), now.hold, now.state);
        states.push(toFacelets(now.state));
      }
      tracks.set(key, states.join('|'));
    }
    return tracks.get(key);
  };

  /**
   * The hold the walk is drawn in, or null while it cannot be drawn: the one hold left (`settled`) — or, where the
   * holds left can never be told apart, one of them. drop-in (F2) keeps the four holds about its axis for the whole rep
   * and the H perm two, end to end (lib/drill/engine.js), and no report ever settles them. Those holds pass the cube
   * through the same arrangement at every position — checked here over the whole algorithm, never assumed, because
   * holds left part way through settling (flip-in after one turn) do not — so the walk shows the same cube in each,
   * and its next turn is the same turn, though a half turn may be drawn the other way round. What they cannot agree
   * on is the camera, which no report can settle; the cube's own frame is taken when it is one of them, so the
   * picture does not turn as the rep begins.
   */
  const drawHold = (st) => {
    if (st.settled) return st.holds[0];
    if (st.holds.length < 2) return null;
    const one = trackIn(st.holds[0]);
    if (!st.holds.every((h) => trackIn(h) === one)) return null;
    return st.holds.find((h) => sameHold(h, ['U', 'F'])) ?? st.holds[0];
  };

  /**
   * What the cube shows while a cube is followed: `alg` played from `facelets` held `hold`, standing at `at`, pointing
   * `arrow`, with the chips marked to `chips`.
   */
  const pictureOf = (st) => {
    const drawn = drawHold(st);
    if (st.status === STATUS.OFF || !drawn || !startFacelets) {
      // Off the algorithm, or before the hold is known: the cube as it is NOW, and an arrow only for the way back —
      // in the cube's OWN letters, which is what the element reads, so it needs no hold to point the way. Held as the
      // rep has got it by its position, whole-cube turns and slices included: the hold the way back's letters are
      // written in. The hold it BEGAN in swung the cube back across an `x` the child had already made.
      const reached = drawn ? run(parse(row.alg).slice(0, st.position ?? 0), drawn, SOLVED).hold : ['U', 'F'];
      return {
        facelets: engine.facelets, hold: reached, alg: '', at: 0,
        arrow: st.status === STATUS.OFF && st.wayBack ? st.wayBack.turns[0] : 'none',
        // Off: the turns made stay played, and the turn that was expected is the one marked off (§5.4).
        chips: st.position ?? 0, off: st.status === STATUS.OFF ? st.position ?? null : null,
      };
    }
    const hold = drawn;
    const walk = { facelets: startFacelets, hold, alg: drawnFrom(row, hold, startFacelets), at: st.position, arrow: 'next', chips: st.position };
    // A turn went missing and nothing has said where the cube is since: the position is the last one it was KNOWN at,
    // so the cube stands there, and no next turn is pointed at — that turn is from an arrangement the cube may not
    // be in. Nor is the engine's model read for a midpoint: it is missing a turn. A snapshot mends it (`resync`).
    if (!st.trusted) return { ...walk, arrow: 'none' };
    return midway(st, hold) ?? walk;
  };

  /**
   * The cube PART WAY through a move — one quarter of a half turn, one face of a slice — drawn as it is NOW, with
   * the turns still to make and the rest of the algorithm after them; null when the cube stands at its position.
   *
   * The engine accepts such a midpoint and keeps its position, because nothing has been completed. Drawn at that
   * position, the picture showed the cube before a turn the child had half made, and the arrow asked for the whole
   * half turn where a quarter was left. Looked for in the move from the position, and in the move that led into it
   * through any regrips — the two the engine accepts a midpoint beside (`locate` in lib/script-track.js).
   */
  const midway = (st, hold) => {
    const moves = parse(row.alg);
    const start = stateFrom(startFacelets);
    const now = engine.facelets;
    for (let k = st.position; k >= 0; k -= 1) {
      const at = run(moves.slice(0, k), hold, start);
      if (k === st.position && toFacelets(at.state) === now) return null;
      if (k === moves.length) continue;
      const identity = toIdentity(moves[k], at.hold);
      const rest = stillToTurn(identity, at.state, now);
      if (rest) {
        const after = run(moves, hold, start).drawn.slice(k + 1);
        return { facelets: now, hold: at.hold, alg: [...rest, ...after].join(' '), at: 0, arrow: 'next', chips: st.position };
      }
      // Back through regrips only: a move that turns a face is the last one a midpoint can belong to.
      if (k < st.position && faceTurnsOf(identity).turns.some((x) => x.name)) break;
    }
    return null;
  };

  const paint = () => {
    if (stale() || !row) return;
    const following = live();
    const st = engine.state;
    const mode = following ? 'cube' : 'demo';
    // Who drives decides the tempo (lib/speed-menu.js): the cube in the hand, or the chosen speed.
    if (page.dataset.mode !== mode) { page.dataset.mode = mode; applyTempo(); }
    page.dataset.status = st.status;
    page.dataset.settled = String(st.settled);
    page.dataset.position = String(st.position ?? 0);
    // The hold the walk is drawn from, which the cube's `orientation` is not once a midpoint redraws it from part way.
    page.dataset.hold = following && drawHold(st) ? holdSpec(drawHold(st)) : '';
    const picture = following ? pictureOf(st) : null;
    // The arrow the cube really draws — the picture's, unless Turn arrows is off — and the sentence written from it.
    const arrow = picture && settings.turnArrows ? picture.arrow : 'none';
    const words = sentence(arrow !== 'none');
    if (say.textContent !== words) say.textContent = words;
    sayInNote(root, mustAct(st) ? words : null);
    paintHold();
    paintClock();
    paintSplits(picture ? st : null);
    if (!picture) {
      // Not following — the cube gone, or a new one that has said nothing yet. A picture of the cube that was followed
      // would stand under "waiting" with its walk, its place and its arrow, so the page goes back to the case. Only on
      // the way out of following: a demo being played is not reset by every paint.
      if (drewFollowed) drawCase();
      return;
    }
    drewFollowed = true;
    draw({ facelets: picture.facelets, hold: picture.hold, alg: picture.alg, arrow });
    if (picture.alg) seek(picture.at);
    markChips(picture.chips, picture.off ?? null);
  };

  // ---- the demo, with no cube ---------------------------------------------------------------------------
  const drawCase = () => {
    drewFollowed = false;
    draw({ facelets: caseNow.facelets, hold: caseNow.hold, alg: drawnFrom(row, caseNow.hold, caseNow.facelets), arrow: 'none' });
    seek(0);
    shownAt = 0;
    markChips(0);
  };
  // The cube screen's transport (§5.2): back a move, that move again, the next move, and on to the end — each
  // animated by the element, which reports where it stands (`cubus-step`). From the end, a press begins again.
  const total = () => writtenTokens(row.alg).length;
  let repeatTo = null;   // where "that move again" goes once its undo has landed
  cube.addEventListener('cubus-step', (e) => {
    if (repeatTo === null || (e.detail?.index ?? -1) !== repeatTo - 1) return;
    const to = repeatTo;
    repeatTo = null;
    cube.playTo(to);
  }, { signal });
  const demo = (fn) => () => { if (!live()) { repeatTo = null; fn(); } };
  $('#demoPrev', root).onclick = demo(() => cube.playTo(shownAt - 1));
  $('#demoRepeat', root).onclick = demo(() => {
    if (shownAt === 0) return;
    const back = shownAt;
    cube.playTo(back - 1);
    repeatTo = back;
  });
  $('#demoNext', root).onclick = demo(() => {
    if (shownAt >= total()) { drawCase(); return; }
    cube.playTo(shownAt + 1);
  });
  $('#demoAll', root).onclick = demo(() => {
    if (shownAt >= total()) drawCase();
    cube.playTo(total());
  });

  // ---- the stopwatch, with no cube: the person's own clock, never a turn's ---------------------------------
  const stopWatch = () => {
    clearInterval(watch.timer);
    watch.timer = null;
  };
  const toggleWatch = () => {
    if (live()) return;
    if (watch.t0 === null) {
      watch.t0 = performance.now();
      clockSays(t('Stop the stopwatch'));
      watch.timer = setInterval(() => { const now = seconds(performance.now() - watch.t0); showTime(now, now); }, 50);
      return;
    }
    const ms = performance.now() - watch.t0;
    stopWatch();
    watch.t0 = null;
    watch.laps = [...watch.laps.slice(-4), ms];
    paintClock();
  };
  clockBtn.onclick = toggleWatch;

  // ---- start over ---------------------------------------------------------------------------------------
  const startOver = () => {
    newAttempt();
    advanceTicket = null;
    if (live()) {
      if (!engine.restart()) waitingForReport = true;
      paint();
      return;
    }
    if (cubeHere() && engine.state.status === STATUS.IDLE && startFromReport()) { paint(); return; }
    stopWatch();
    watch.t0 = null;
    drawCase();
    paintClock();
  };
  $('#practiceRestart', root).onclick = startOver;
  document.addEventListener('keydown', (e) => {
    if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
    // Escape with the book open closes the book (its own listener, made after this one) and starts nothing over.
    if (e.key === 'Escape') { if (info.isOpen()) return; e.preventDefault(); startOver(); return; }
    if (e.code === 'Space' && !live() && !onControl(e.target)) { e.preventDefault(); toggleWatch(); }
  }, { signal });

  // ---- the book: everything a parent reads, behind one button on the cube card (plan §5.1) ------------------------
  // Made AFTER the page's keydown listener above: on Escape that listener sees the book still open and leaves it to
  // the book's own, which closes it and gives the focus back.
  const info = createMenu({
    root, button: $('#practiceBook', root), label: t('About this algorithm'), signal, place: placeMenuUnder, dismiss: true,
  });
  info.el.id = 'practiceInfo';
  info.el.classList.add('practice-info');
  info.el.setAttribute('role', 'dialog');
  info.el.innerHTML = `<div class="practice-pic" id="practicePic"></div>
    <p id="practiceName"></p>
    <div id="practiceAbout"></div>
    <p class="sub" id="practiceParts" hidden></p>
    <div id="practiceFigures"></div>
    <div id="practiceReps"></div>`;

  /**
   * THE MODES' ROW, ONE ROW IN TWO PLACES (E11.6): under the quiet line in landscape, behind the book in portrait,
   * where the twin's height is the cube's. Which composition it is, the stylesheet's container query says
   * (`--practice-modes` on the page) — asked of it, never a width measured here.
   */
  const modes = $('.practice-modes', root);
  const placeModes = () => {
    const inBook = getComputedStyle(page).getPropertyValue('--practice-modes').trim() === 'book';
    if (inBook && modes.parentElement !== info.el) $('#practiceName', info.el).after(modes);
    else if (!inBook && modes.parentElement === info.el) $('.practice-said', root).after(modes);
    page.dataset.modes = inBook ? 'book' : 'twin';
  };
  placeModes();
  window.addEventListener('resize', placeModes, { signal });

  // ---- the speed: the cube screen's own menu (lib/speed-menu.js); a cube in the hand sets the tempo aside --------
  const applyTempo = createSpeedMenu({ root, cube, signal, following: () => live(), place: placeMenuUnder });

  // ---- one at a time, or mixed --------------------------------------------------------------------------
  const paintMode = () => {
    for (const [id, on] of [['#practiceBlocked', !mixed], ['#practiceMixed', Boolean(mixed)]]) {
      const b = $(id, root);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
    $('#practiceNext', root).hidden = !mixed;
  };
  const seed = () => crypto.getRandomValues(new Uint32Array(1))[0];
  /** A round's order, weakest first, from a read of the whole record — null, and said, when it cannot be read. */
  const orderFor = (ids) => record.read().then((rec) => mixOrder(ids, rec, { seed: seed() }), (err) => {
    if (!(err instanceof PracticeRecordError)) throw err;
    if (!stale()) {
      logOnce(`its record could not be read for mixed practice (${err.code})`, err);
      trouble.read = t(RECORD_SAYS.read);
      sayRecord();
    }
    return null;
  });
  /**
   * One step on in mixed practice. INSIDE A ROUND IT READS NOTHING: the round's order was fixed when the round began, so
   * the step is taken at once, whether or not the rep before it is saved yet. A NEW ROUND IS ORDERED BY THE RECORD, and
   * so waits for the reps just made to be on it: the record answers a read only after every add called before it, so
   * the read is the wait. Until its answer the step stays queued under its ticket, and Blocked, a new attempt (a start
   * over, another row, a rep begun meanwhile — `attempt`) or leaving the screen calls it off — the order would land on
   * a page that has moved on.
   */
  const advance = (asked = attempt) => {
    advanceTicket = null;   // one step on, however it was asked for
    if (!mixed) return;
    if (mixed.at + 1 < mixed.order.length) {
      mixed.at += 1;
      show(mixed.order[mixed.at]);
      return;
    }
    const ticket = {};
    advanceTicket = ticket;
    const round = mixed;
    const from = row.id;
    orderFor(catalogue.sets[row.set].ids).then((next) => {
      if (advanceTicket !== ticket || stale() || mixed !== round || attempt !== asked || turnsSinceArm > 0) return;
      advanceTicket = null;
      if (!next) return;
      // No algorithm twice in a row across two rounds either.
      if (next.length > 1 && next[0] === from) [next[0], next[1]] = [next[1], next[0]];
      mixed = { order: next, at: 0 };
      show(next[0]);
    });
  };
  $('#practiceBlocked', root).onclick = () => { modeTicket = null; mixed = null; paintMode(); };
  $('#practiceMixed', root).onclick = () => {
    const ticket = {};
    modeTicket = ticket;
    const asked = attempt;
    orderFor(catalogue.sets[row.set].ids).then((order) => {
      if (modeTicket !== ticket || stale() || attempt !== asked) return;
      modeTicket = null;
      if (!order) return;
      mixed = { order, at: 0 };
      paintMode();
      if (order[0] !== row.id) show(order[0]);
    });
  };
  $('#practiceNext', root).onclick = () => advance();
  // The catalogue is here: the controls that waited for it are live (`pageHtml` drew them disabled).
  for (const id of PAGE_CONTROLS) $(`#${id}`, root).disabled = false;

  // ---- the cube's streams -------------------------------------------------------------------------------
  /**
   * The cube came, went, or was replaced — ONE ENGINE PER CONNECTION. A new session is a new stream: its own turn
   * numbers, its own arrangement, perhaps a cube that numbers nothing. Restarting the old engine kept its last
   * serial and its rep in flight, so the new cube's first turn read as a turn gone missing and its first report as
   * a snapshot that contradicted the old cube's. Asked at every report and every presence tick, because a cube
   * that drops and is back inside one tick changes nothing else this page can see.
   */
  let wasHere = cubeHere();
  const presenceChanged = () => {
    const here = cubeHere();
    if (here === wasHere && conn === engineConn) return;
    wasHere = here;
    if (conn !== engineConn) makeEngine(row.alg); else if (!here) engine.stop();
    else if (engine.state.status === STATUS.IDLE) startFromReport();
    if (!here) drawCase();
    paint();
  };
  hooks.liveMove = (m) => {
    if (stale() || !engine) return;
    presenceChanged();
    // An idle engine does not arm here: every report that could arm it already did as it arrived (`onSnapshot`) or
    // as the engine was made (`makeEngine`), and a turn on top of no report is a turn on an arrangement nobody knows.
    if (turnsSinceArm === 0) newAttempt();   // the first turn since the cube was armed: an attempt has begun
    turnsSinceArm += 1;
    engine.report(m);
    modelCount = countOf(m.serial);
    paint();
  };
  /** A snapshot from the cube — `live`, or one the reconnect question holds back from being `live` — with the serial
   *  it was taken at, which every arrangement handed to the engine carries (`startFromReport` says why). */
  const onSnapshot = (f, reportSerial) => {
    if (stale() || !engine) return;
    presenceChanged();
    const st = engine.state.status;
    const serial = countOf(reportSerial);
    // Whether the engine takes this arrangement — and with it the snapshot's count — or keeps its own model and count.
    let takes = true;
    if (st === STATUS.IDLE) { if (cubeHere()) engine.start({ facelets: f, serial }); else takes = false; }
    else if (waitingForReport) engine.restart({ facelets: f, serial });
    // A cube whose arrangement changed before any turn of the rep (a first report, a cube picked up and set
    // down) is a new start, not a contradiction: there is nothing to judge yet.
    else if (st === STATUS.ARMED && turnsSinceArm === 0) {
      if (engine.facelets !== f) engine.restart({ facelets: f, serial });
      else takes = false;
    } else {
      // An arrangement the engine already holds changes nothing, its count included (`resync`).
      takes = !(engine.state.trusted && engine.facelets === f);
      engine.resync(f, { serial });
    }
    if (takes) modelCount = serial;
    paint();
  };
  hooks.liveUpdate = (f, serial) => onSnapshot(f, serial);
  // While the reconnect question is open its reports are held back from `live` — where the cube IS is exactly what
  // is being asked — and they still reach this screen, because the engine claims nothing about where the cube is:
  // it judges turns relative to the cube's own model. Nothing here answers the question, writes `live` or the
  // subject, or grants trust. Without this, a remembered cube left Practice waiting until somebody answered on Home.
  hooks.heldUpdate = (f, serial) => onSnapshot(f, serial);
  hooks.liveGap = () => {
    if (stale() || !engine) return;
    presenceChanged();
    engine.gap();
    paint();
  };
  // Trust is about the cube's COLOURS; the engine claims nothing about them, so a lapse alone changes nothing
  // here. What ends following is the stream itself: a cube that left, or one proved to contradict itself.
  hooks.onTrustLost = () => { if (!stale() && engine) presenceChanged(); };
  const presence = setInterval(() => { if (!stale() && engine) presenceChanged(); }, PRESENCE_MS);
  hooks.cleanup = () => {
    clearInterval(presence);
    stopWatch();
    engine?.stop();
    token = null;
  };

  // ---- the row, taken in place --------------------------------------------------------------------------
  /** How to hold the cube: any way at all while a cube is followed (the engine infers the hold, plan §3.2), the
   *  hold the letters are written for otherwise. Painted with the rest of the page, because a cube comes and goes
   *  while the row stays — drawn only with the row, "hold it any way you like" outlived the cube it was about. */
  const holdWords = () => (cubeHere()
    ? t('The letters are written for a cube held one way; with a smart cube, hold it any way you like.')
    : t('The letters are written for this hold. %1', holdSentence(caseNow.hold)));
  const paintHold = () => {
    const line = $('#practiceHold', info.el);
    const words = holdWords();
    if (line && line.textContent !== words) line.textContent = words;
  };
  /** The phase a set is taught in, by name — the stage of the quiet line — or null where no method names one. */
  const stageOf = (setId) => catalogue.groups.flatMap((g) => g.phases).find((p) => p.sets.includes(setId))?.phase ?? null;
  const paintCase = () => {
    const set = catalogue.sets[row.set];
    const setName = t(set?.name ?? row.set);
    // ONE quiet line (E4): the set, the stage — left out when the set's name already says it — and the length.
    const phase = stageOf(row.set);
    const stage = phase && t(phase);
    const n = writtenTokens(row.alg).length;
    $('#practiceLine', root).textContent = [
      setName, stage && !setName.toLowerCase().includes(stage.toLowerCase()) ? stage : null,
      plural(n, { one: '%1 move', other: '%1 moves' }),
    ].filter(Boolean).join(' · ');
    // Behind the book: its picture, then what the algorithm is FOR, what this one does, and how to hold it.
    const purpose = purposeOf(row, set);
    // The flat picture with its moved pieces marked, as a flat tile draws it (E13): the live cube beside it is the 3D view.
    $('#practicePic', info.el).innerHTML = markedPicture(row, set.region, { palette: settings.palette, scheme: settings.scheme });
    $('#practiceName', info.el).innerHTML = `<b>${escHtml(rowName(row))}</b> · ${escHtml(setName)}${stage ? ` · ${escHtml(stage)}` : ''}`;
    $('#practiceAbout', info.el).innerHTML = [
      purpose ? `<p class="practice-purpose">${escHtml(purpose)}</p>` : '',
      `<p class="sub practice-says">${escHtml(row.says)}</p>`,
      `<p class="sub" id="practiceHold">${escHtml(holdWords())}</p>`,
      orderWords(row.order) ? `<p class="sub">${escHtml(orderWords(row.order))}</p>` : '',
    ].join('');
  };

  function show(id) {
    if (stale() || !Object.hasOwn(catalogue.rows, id)) return false;
    newAttempt();
    row = catalogue.rows[id];
    state.practiceAlg = id;
    caseNow = caseOf(row);
    tracks = new Map();
    // THE ONE STRING: printed as the chips, and handed to the engine. Nothing re-spells it in between.
    const judged = row.alg;
    page.dataset.alg = row.id;
    page.dataset.judging = judged;
    chipsBox.innerHTML = chipsHtml(row, catalogue.triggers, escHtml);
    paintCase();
    stopWatch();
    watch = { t0: null, timer: null, laps: [] };
    makeEngine(judged);
    paintRecord();
    if (!live()) drawCase();
    paintMode();
    paint();
    if (!cube.isConnected) {
      $('#practiceCube', root).appendChild(cube);
      if (seekWhenIn) cube.seek(seekWhenIn);
      seekWhenIn = null;
    }
    return true;
  }
  return show;
}

/** The solved arrangement, for the cube's subject as it is made — every attribute is the row's before it connects. */
const SOLVED_FACELETS = () => toFacelets(SOLVED);

SCREENS.practice = () => (state.practiceAlg ? pageScreen() : libraryScreen());
