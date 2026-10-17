// The Practice screen: every algorithm the ledger holds, and one of them practised over and over until the
// fingers do it on their own (dev-docs/algorithm-drill-v2-plan.md §3.7, §4; work items WI-10 and WI-12).
//
// EARNED, NOT GIVEN. The first Drill was removed whole (ADR 0010): "a screen rebuilt later starts as a module
// with no screen, and earns its tab again". So this is a new id — never `drill` or `trainer`, which name removed
// screens — hidden by default (`NAV_ADDED[8]`), reachable in Settings → Advanced and at #/practice.
//
// TWO COMPOSITIONS ON ONE ROUTE. With no row chosen (`state.practiceAlg` null) it is the LIBRARY: every row by
// method, stage and set, read from the library worker (lib/drill/library-client.js — the rows cost seconds to
// compute, which no UI thread may pay). With a row it is the PAGE: the case, the algorithm in its chunks, the
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

import { $, escHtml, state } from '../app-state.js';
import { fingersTarget, settings } from '../app-settings.js';
import { t } from '../i18n.js';
import { SCREENS, renderScreen, screenAbort, screenGen } from '../screen-shell.js';
import { hooks } from '../screen-slots.js';
import { newCube } from '../cube-drawing.js';
import { conn, cubeRefused } from '../live-session.js';
import { play } from '../sound.js';
import { run } from '../cube-moves.js';
import { parse } from '../cube-notation.js';
import { SOLVED, invert, toFacelets } from '../cube-pieces.js';
import { stateFrom } from '../script-view.js';
import { holdSentence, holdSpec } from '../solving-hold.js';
import { library } from '../drill/library-client.js';
import { STATUS, createDrillEngine } from '../drill/engine.js';
import { PracticeRecordError, openPracticeRecord, statsOf, watchReps } from '../drill/record.js';
import { mixOrder } from '../drill/mix.js';
import { casePicture, libraryHtml, purposeOf, rowName } from './practice/library-view.js';
import {
  chipsHtml, figuresHtml, lastRepsHtml, orderWords, refusalWords, seconds, segmentsOf, writtenTokens,
} from './practice/page-view.js';

/** How often the page asks whether the cube is still there. A disconnect of a cube whose chain was never
 *  trusted raises no hook (`markStale` notifies only a LAPSE), and a page saying "following your cube" after
 *  the cube has gone is the one sentence it must not keep. A comparison of two flags, once a second. */
const PRESENCE_MS = 1000;

/** A cube that can be followed: connected, and not proved to contradict itself (lib/cube-reports.js gates a
 *  refused cube's turns before they reach any screen). */
const cubeHere = () => state.connected && !cubeRefused();

/** A key press that belongs to the control it landed on, not to the page. */
const onControl = (target) => Boolean(target?.closest?.('button, a, input, select, textarea, summary'));

// ---- the library ----------------------------------------------------------------------------------------

function libraryScreen() {
  return {
    html: `<div class="practice-screen" data-composition="library" style="width:100%;height:100%;min-height:0;display:flex;flex-direction:column;gap:14px">
      <div class="card" style="padding:12px 16px;flex:none">
        <div class="sub" style="color:var(--ink-3);line-height:1.5">${escHtml(t('Every algorithm the app teaches, by method. Pick one to practise it until your fingers know it — with a smart cube every turn is checked and timed, and without one the cube on screen shows the moves.'))}</div>
      </div>
      <div class="practice-list" id="practiceList" style="flex:1;min-height:0;overflow-y:auto">
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
        list.innerHTML = `<div class="sub" role="status" style="color:var(--err-ink)">${escHtml(t('The algorithms could not be read: %1', err.message))}</div>`;
        return;
      }
      if (gen !== screenGen) return;
      list.innerHTML = libraryHtml(catalogue, { palette: settings.palette, scheme: settings.scheme }, escHtml);
      list.addEventListener('click', (e) => {
        const card = e.target.closest?.('[data-alg]');
        if (!card) return;
        state.practiceAlg = card.dataset.alg;
        renderScreen();
      });
      box.dataset.ready = '1';
    },
  };
}

// ---- the page -------------------------------------------------------------------------------------------

/** The case of a row as the demo cube draws it: its inverse played on a solved cube in the row's hold, the
 *  pieces in the cube's own frame, and the hold the algorithm starts in (the library's `caseOf`, as pieces). */
function caseOf(row) {
  const played = run(invert(row.alg), row.hold, SOLVED);
  return { facelets: toFacelets(played.state), hold: [...played.hold] };
}

/** The algorithm as the element draws it from `facelets` held `hold`: identity-frame tokens (`run().drawn`). */
const drawnFrom = (row, hold, facelets) => run(parse(row.alg), hold, stateFrom(facelets)).drawn.join(' ');

const PAGE_HTML = `<div class="cols practice-page" data-composition="practice">
  <div class="card primary" style="display:flex;flex-direction:column;align-items:center;position:relative">
    <div style="flex:1;min-height:0;width:100%"><div class="cube-slot" id="practiceCube" style="height:100%"></div></div>
  </div>
  <div class="aside">
    <div class="card twin practice-case" id="practiceCase"></div>
    <div class="card sheet practice-sheet">
      <div class="wrap-row">
        <button class="pill" id="practiceBack" type="button">${escHtml(t('All algorithms'))}</button>
        <span class="wrap-row" role="group" aria-label="${escHtml(t('How to practise'))}" style="gap:6px">
          <button class="pill on" id="practiceBlocked" type="button" aria-pressed="true">${escHtml(t('One at a time'))}</button>
          <button class="pill" id="practiceMixed" type="button" aria-pressed="false">${escHtml(t('Mixed'))}</button>
        </span>
        <button class="pill" id="practiceNext" type="button" hidden>${escHtml(t('Next algorithm'))}</button>
      </div>
      <div class="practice-about" id="practiceAbout"></div>
      <div class="practice-say" id="practiceSay" role="status" aria-live="polite"></div>
      <div class="practice-alg" id="practiceAlg"></div>
      <div class="wrap-row" id="practiceDemo">
        <button class="pill" id="demoNext" type="button">${escHtml(t('Play the next part'))}</button>
        <button class="pill" id="demoAll" type="button">${escHtml(t('Play it all'))}</button>
      </div>
      <div class="wrap-row">
        <button class="btn accent-outline" id="practiceClock" type="button" aria-keyshortcuts="Space">${escHtml(t('Start the stopwatch'))}</button>
        <span class="num practice-time" id="practiceTime" role="status" aria-live="polite">—</span>
        <button class="btn outline" id="practiceRestart" type="button" aria-keyshortcuts="Escape" title="${escHtml(t('Start over (Esc)'))}">${escHtml(t('Start over'))}</button>
      </div>
      <div id="practiceFigures"></div>
      <div class="sub" id="practiceRecordSay" role="status" style="color:var(--err-ink)" hidden></div>
      <div id="practiceReps"></div>
    </div>
  </div>
</div>`;

function pageScreen() {
  /** Set by mount: takes a new row in place. Null until the mount has the catalogue. */
  let showRow = null;
  return {
    html: PAGE_HTML,
    update() {
      if (!showRow || !state.practiceAlg) return false;
      return showRow(state.practiceAlg);
    },
    async mount(root) {
      const gen = screenGen;
      const signal = screenAbort?.signal;
      const stale = () => gen !== screenGen || signal?.aborted;
      const page = root.querySelector('.practice-page');
      let catalogue;
      try {
        catalogue = await library.catalogue();
      } catch (err) {
        if (stale()) return;
        console.error('the algorithm library could not be read', err);
        $('#practiceSay', root).textContent = t('The algorithms could not be read: %1', err.message);
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
  const clockBtn = $('#practiceClock', root);
  const demoRow = $('#practiceDemo', root);
  const recordSay = $('#practiceRecordSay', root);
  const record = openPracticeRecord({ storage: localStorage, now: () => Date.now() });

  let row = null;
  let caseNow = null;
  let engine = null;
  let token = null;
  let startFacelets = null;   // the arrangement the current rep was armed from (the engine's start event)
  let turnsSinceArm = 0;
  let waitingForReport = false;
  let lastResult = null;
  let drawnKey = null;        // what the cube was last given, so a repaint does not reset it for nothing
  let mixed = null;           // { order, at } while practising mixed
  let watch = { t0: null, timer: null, laps: [] };
  let shownAt = 0;            // the demo's position, from the element's own report

  // ---- the cube -----------------------------------------------------------------------------------------
  const cube = newCube({ subject: { facelets: SOLVED_FACELETS(), moves: [], isPhysical: false } });
  cube.setAttribute('aria-label', t('The algorithm, on a cube'));
  $('#practiceCube', root).appendChild(cube);
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
    cube.setAttribute('arrow', settings.turnArrows ? arrow : 'none');
  };

  // ---- the chips ----------------------------------------------------------------------------------------
  const markChips = (k) => {
    for (const chip of chipsBox.querySelectorAll('.chip-m')) {
      const i = Number(chip.dataset.k);
      chip.classList.toggle('played', i < k);
      chip.classList.toggle('cur', i === k - 1);
    }
  };

  // ---- the record ---------------------------------------------------------------------------------------
  const sayRecord = (text) => { recordSay.hidden = !text; recordSay.textContent = text ?? ''; };
  const paintRecord = () => {
    let reps = [];
    let stats = null;
    try {
      reps = record.reps(row.id);
      stats = statsOf(reps);
    } catch (err) {
      if (!(err instanceof PracticeRecordError)) throw err;
      sayRecord(t('Your practice record could not be read (%1), so it is left as it is and nothing new is saved.', err.code));
    }
    $('#practiceFigures', root).innerHTML = figuresHtml(stats, fingersTarget(settings.fingersN), escHtml);
    $('#practiceReps', root).innerHTML = lastRepsHtml(reps, escHtml);
  };
  const saveRep = (id, rep) => {
    const done = record.add(id, rep);
    if (!done.saved) sayRecord(t('That rep was not saved: %1', done.error.message));
    else sayRecord(null);
    if (row?.id === id) paintRecord();
  };

  // ---- the engine ---------------------------------------------------------------------------------------
  const live = () => Boolean(engine) && engine.state.status !== STATUS.IDLE && cubeHere();

  const makeEngine = (judged) => {
    const carry = engine && engine.state.trusted ? engine.facelets : null;
    engine?.stop();
    const mine = {};
    token = mine;
    startFacelets = null;
    turnsSinceArm = 0;
    waitingForReport = false;
    lastResult = null;
    const rowId = row.id;
    const reps = watchReps((rep) => saveRep(rowId, rep));
    engine = createDrillEngine({
      alg: judged,
      chunks: row.chunks.map(({ from, to }) => ({ from, to })),
      numbersMoves: conn?.numbersMoves?.() === true,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h),
      now: () => performance.now(),
      sound: (name) => { if (token === mine && !stale()) play(name); },
      onEvent: (e) => {
        if (token !== mine || stale()) return;
        reps(e);
        heard(e, mine);
        // `off` is the one event the engine raises on its own clock (the cue window), not inside a call
        // of ours that paints after it — so it paints here, or the page says nothing until the next turn.
        if (e.type === 'off') paint();
      },
    });
    const from = carry ?? state.live;
    if (cubeHere() && from) engine.start({ facelets: from });
  };

  const heard = (e, mine) => {
    if (['start', 'next', 'restart', 'gesture'].includes(e.type)) {
      startFacelets = e.facelets;
      turnsSinceArm = 0;
      waitingForReport = false;
    }
    if (e.type === 'refused') waitingForReport = true;
    if (e.type === 'done') {
      lastResult = e.result;
      // Mixed practice moves on once this rep is filed — after the engine has finished arming the next one,
      // so the engine being replaced is never stopped from inside its own `done`.
      if (mixed) setTimeout(() => { if (token === mine && !stale()) advance(); }, 0);
    }
  };

  // ---- painting -----------------------------------------------------------------------------------------
  const paintClock = () => {
    const following = live();
    clockBtn.hidden = following;
    demoRow.hidden = following;
    if (following) {
      if (lastResult) {
        const r = lastResult;
        time.textContent = r.ms === null
          ? t('— (%1)', refusalWords(r.refused))
          : r.tps ? t('%1, first turn to last · %2 turns a second (%3)', seconds(r.ms), r.tps.value.toFixed(1), r.tps.metric)
            : t('%1, first turn to last', seconds(r.ms));
      } else time.textContent = '—';
      return;
    }
    if (watch.t0 === null) {
      clockBtn.textContent = t('Start the stopwatch');
      time.textContent = watch.laps.length ? t('%1 on your stopwatch', seconds(watch.laps.at(-1))) : '—';
    }
  };

  const sentence = () => {
    if (!cubeHere()) return t('No smart cube connected: the cube on screen shows the moves, part by part. Time yourself with the stopwatch.');
    const st = engine.state;
    if (waitingForReport) return t('A turn went missing, so cubus does not know where your cube is. Waiting for the cube to say.');
    if (st.status === STATUS.IDLE) return t('Waiting for your cube to say where it is.');
    if (st.status === STATUS.UNCERTAIN) return t('A turn went missing between your cube and the app, so this rep is not judged. Finish it, or start over.');
    if (st.status === STATUS.OFF) {
      const lead = st.about === 'turn' ? t('That turn left the algorithm.') : t('Your cube left the algorithm.');
      if (!st.wayBack) return t('%1 It is too far to turn back: press Start over, or turn one face four times.', lead);
      return st.wayBack.held ? t('%1 Turn it back: %2', lead, st.wayBack.held.join(' ')) : t('%1 Follow the arrow back.', lead);
    }
    if (!st.settled) return t('Hold the cube any way you like and start: its first turns tell cubus how you are holding it.');
    return st.status === STATUS.ARMED ? t('Go: the arrow shows the first turn.') : t('Keep going: the arrow shows the next turn.');
  };

  const paint = () => {
    if (stale() || !row) return;
    const following = live();
    const st = engine.state;
    page.dataset.mode = following ? 'cube' : 'demo';
    page.dataset.status = st.status;
    page.dataset.settled = String(st.settled);
    page.dataset.position = String(st.position ?? 0);
    say.textContent = sentence();
    paintClock();
    if (!following) return;
    if (st.status === STATUS.OFF || !st.settled || !startFacelets) {
      // Off the algorithm, or before the hold is known: the cube as it is NOW, and an arrow only for the way back.
      const hold = st.settled ? st.holds[0] : ['U', 'F'];
      draw({ facelets: engine.facelets, hold, alg: '', arrow: st.status === STATUS.OFF && st.settled && st.wayBack ? st.wayBack.turns[0] : 'none' });
      markChips(st.status === STATUS.OFF ? -1 : st.position ?? 0);
      return;
    }
    const hold = st.holds[0];
    draw({ facelets: startFacelets, hold, alg: drawnFrom(row, hold, startFacelets), arrow: 'next' });
    cube.seek(st.position);
    markChips(st.position);
  };

  // ---- the demo, with no cube ---------------------------------------------------------------------------
  const drawCase = () => {
    draw({ facelets: caseNow.facelets, hold: caseNow.hold, alg: drawnFrom(row, caseNow.hold, caseNow.facelets), arrow: 'none' });
    cube.seek(0);
    shownAt = 0;
    markChips(0);
  };
  const ends = () => segmentsOf(writtenTokens(row.alg).length, row.chunks).map((s) => s.to);
  $('#demoNext', root).onclick = () => {
    if (live()) return;
    const n = writtenTokens(row.alg).length;
    if (shownAt >= n) { drawCase(); return; }
    cube.playTo(ends().find((k) => k > shownAt) ?? n);
  };
  $('#demoAll', root).onclick = () => {
    if (live()) return;
    if (shownAt >= writtenTokens(row.alg).length) drawCase();
    cube.playTo(writtenTokens(row.alg).length);
  };

  // ---- the stopwatch, with no cube: the person's own clock, never a turn's ---------------------------------
  const stopWatch = () => {
    clearInterval(watch.timer);
    watch.timer = null;
  };
  const toggleWatch = () => {
    if (live()) return;
    if (watch.t0 === null) {
      watch.t0 = performance.now();
      clockBtn.textContent = t('Stop the stopwatch');
      watch.timer = setInterval(() => { time.textContent = seconds(performance.now() - watch.t0); }, 50);
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
    if (live()) {
      if (!engine.restart()) waitingForReport = true;
      paint();
      return;
    }
    if (cubeHere() && state.live && engine.state.status === STATUS.IDLE) { engine.start({ facelets: state.live }); paint(); return; }
    stopWatch();
    watch.t0 = null;
    drawCase();
    paintClock();
  };
  $('#practiceRestart', root).onclick = startOver;
  document.addEventListener('keydown', (e) => {
    if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'Escape') { e.preventDefault(); startOver(); return; }
    if (e.code === 'Space' && !live() && !onControl(e.target)) { e.preventDefault(); toggleWatch(); }
  }, { signal });

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
  const orderFor = (ids) => {
    try {
      return mixOrder(ids, record.read(), { seed: seed() });
    } catch (err) {
      if (!(err instanceof PracticeRecordError)) throw err;
      sayRecord(t('Your practice record could not be read (%1), so mixed practice cannot put the weakest first.', err.code));
      return null;
    }
  };
  const advance = () => {
    if (!mixed) return;
    mixed.at += 1;
    if (mixed.at >= mixed.order.length) {
      const next = orderFor(catalogue.sets[row.set].ids);
      if (!next) return;
      // No algorithm twice in a row across two rounds either.
      if (next.length > 1 && next[0] === row.id) [next[0], next[1]] = [next[1], next[0]];
      mixed = { order: next, at: 0 };
    }
    show(mixed.order[mixed.at]);
  };
  $('#practiceBlocked', root).onclick = () => { mixed = null; paintMode(); };
  $('#practiceMixed', root).onclick = () => {
    const order = orderFor(catalogue.sets[row.set].ids);
    if (!order) return;
    mixed = { order, at: 0 };
    paintMode();
    if (order[0] !== row.id) show(order[0]);
  };
  $('#practiceNext', root).onclick = advance;
  $('#practiceBack', root).onclick = () => { state.practiceAlg = null; renderScreen(); };

  // ---- the cube's streams -------------------------------------------------------------------------------
  hooks.liveMove = (m) => {
    if (stale() || !engine) return;
    if (engine.state.status === STATUS.IDLE && cubeHere() && state.live) engine.start({ facelets: state.live });
    turnsSinceArm += 1;
    engine.report(m);
    paint();
  };
  hooks.liveUpdate = (f) => {
    if (stale() || !engine) return;
    const st = engine.state.status;
    if (st === STATUS.IDLE) { if (cubeHere()) engine.start({ facelets: f }); }
    else if (waitingForReport) engine.restart({ facelets: f });
    // A cube whose arrangement changed before any turn of the rep (a first report, a cube picked up and set
    // down) is a new start, not a contradiction: there is nothing to judge yet.
    else if (st === STATUS.ARMED && turnsSinceArm === 0) { if (engine.facelets !== f) engine.restart({ facelets: f }); }
    else engine.resync(f);
    paint();
  };
  hooks.liveGap = () => { if (!stale()) { engine?.gap(); paint(); } };
  // Trust is about the cube's COLOURS; the engine claims nothing about them, so a lapse alone changes nothing
  // here. What ends following is the stream itself: a cube that left, or one proved to contradict itself.
  hooks.onTrustLost = () => { if (!stale() && !cubeHere()) { engine?.stop(); paint(); } };
  let wasHere = cubeHere();
  const presence = setInterval(() => {
    if (stale()) return;
    const here = cubeHere();
    if (here === wasHere) return;
    wasHere = here;
    if (!here) engine?.stop();
    else if (state.live && engine?.state.status === STATUS.IDLE) engine.start({ facelets: state.live });
    if (!here && row) drawCase();
    paint();
  }, PRESENCE_MS);
  hooks.cleanup = () => {
    clearInterval(presence);
    stopWatch();
    engine?.stop();
    token = null;
  };

  // ---- the row, taken in place --------------------------------------------------------------------------
  const paintCase = () => {
    const set = catalogue.sets[row.set];
    // What the algorithm is FOR, then what this one does: the page is about one row, so it says both.
    const purpose = purposeOf(row, set);
    const lines = [
      purpose ? `<div class="practice-purpose">${escHtml(purpose)}</div>` : '',
      `<div class="sub practice-says">${escHtml(row.says)}</div>`,
      `<div class="sub" style="color:var(--ink-4)">${escHtml(cubeHere()
        ? t('The letters are written for a cube held one way; with a smart cube, hold it any way you like.')
        : t('The letters are written for this hold. %1', holdSentence(caseNow.hold)))}</div>`,
      orderWords(row.order) ? `<div class="sub" style="color:var(--ink-4)">${escHtml(orderWords(row.order))}</div>` : '',
    ];
    // The twin holds the picture and the name only: in portrait it shares the cube's locked row, so words of
    // any length go to the sheet, the region that scrolls.
    $('#practiceCase', root).innerHTML = `<div class="eyebrow">${escHtml(t(set?.name ?? row.set))}</div>
      <div class="practice-pic">${casePicture(row, { palette: settings.palette, scheme: settings.scheme })}</div>
      <b class="practice-name">${escHtml(rowName(row))}</b>`;
    $('#practiceAbout', root).innerHTML = lines.join('');
  };

  function show(id) {
    if (stale() || !Object.hasOwn(catalogue.rows, id)) return false;
    row = catalogue.rows[id];
    state.practiceAlg = id;
    caseNow = caseOf(row);
    // THE ONE STRING: printed as the chips, and handed to the engine. Nothing re-spells it in between.
    const judged = row.alg;
    page.dataset.alg = row.id;
    page.dataset.judging = judged;
    chipsBox.innerHTML = chipsHtml(row, catalogue.triggers, escHtml);
    paintCase();
    stopWatch();
    watch = { t0: null, timer: null, laps: [] };
    makeEngine(judged);
    sayRecord(null);
    paintRecord();
    if (!live()) drawCase();
    paintMode();
    paint();
    return true;
  }
  return show;
}

/** The solved arrangement, for the cube's first subject before a row is drawn. */
const SOLVED_FACELETS = () => toFacelets(SOLVED);

SCREENS.practice = () => (state.practiceAlg ? pageScreen() : libraryScreen());
