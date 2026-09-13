// The Timer screen.
//
// Lifted out of app.js on 2026-09-13, when that file was split into modules.

import { createSolveTimer } from '../solve-timer.js';
import { t } from '../i18n.js';

import { $, escHtml, state } from '../app-state.js';
import { hooks } from '../screen-slots.js';
import { loadSolver, solverReady, warmSolver } from '../solver-service.js';
import { chainTrusted, conn } from '../cube-connection.js';
import {
  dropLastSolve, parkRoll, pushSolve, putInPlay, randomScramble, recentSolves, schedulePreroll,
} from '../scramble-roll.js';
import { SCREENS, screenAbort } from '../screen-shell.js';

SCREENS.timer = () => {
  // width:100% — the screen centres its child, and a column without a width would shrink to
  // its content. The clock's size and the wrapping rows are classes (index.html).
  //
  // The clock is a real <button>, styled to look exactly as it did as a <div onclick>. It is the
  // screen's primary control — it starts and stops the solve — and a div is not reachable by Tab,
  // not activated by Enter or Space, and announced as nothing. The look is unchanged: `button`
  // already inherits font and colour in this stylesheet, and .timer-clock zeroes the padding.
  // Its accessible NAME is an aria-label that says what pressing it does, because its text is a
  // number that changes sixty times a second; the RESULT is announced through the hint line,
  // which is the screen's status region.
  return { html: `<div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px">
      <div class="num" id="scr" role="status" aria-live="polite" style="font-size:var(--fs-body-l);color:var(--ink-4);text-align:center;max-width:640px">${escHtml(t('press New scramble'))}</div>
      <button type="button" class="num timer-clock" id="clock" aria-label="${escHtml(t('Start the timer'))}">0.00</button>
      <div class="sub" id="timerHint" role="status" aria-live="polite" style="color:var(--ink-4)">${escHtml(t('Click or hold space to start'))}</div>
      <div class="wrap-row" style="justify-content:center;gap:10px"><button class="btn outline sm" id="newScr">${escHtml(t('New scramble'))}</button>
        <span class="pill">${escHtml(t('WCA scrambles'))}</span></div>
      <div class="wrap-row" style="justify-content:center;gap:12px;margin-top:6px" id="lastFive"></div></div>`,
    mount(root) {
      const clock = $('#clock', root); let running = false, t0 = 0, raf = 0;
      const fmt = (ms) => (ms / 1000).toFixed(2);
      const tick = () => { if (!running) return; clock.textContent = fmt(performance.now() - t0); raf = requestAnimationFrame(tick); };
      const hint = $('#timerHint', root);
      const MANUAL = t('Click or hold space to start');
      const say = (text) => { if (hint) hint.textContent = text; };
      /** What pressing the clock will do next. Kept in step with `running` in one place, so the
       *  name a screen reader announces cannot describe the opposite of what the press does. */
      const nameClock = () => clock.setAttribute('aria-label', running ? t('Stop the timer') : t('Start the timer'));

      // ---- cube-driven timing (PRD phase 4) ------------------------------------------------
      // The arrangement the current scramble produces — what the auto timer arms on: the one
      // instant the app can KNOW setup is finished, since applying the scramble is also turns.
      let scrTarget = null;
      // True while the clock was started by the cube, so a manual press can take it back.
      let byCube = false;
      const auto = createSolveTimer({ target: () => scrTarget, trusted: chainTrusted });
      /**
       * A cube that numbers nothing cannot be timed truthfully, so this screen does not time it.
       *
       * solve-timer's two "moves were dropped" refusals both compare serials; with no serial they
       * are inert, and the screen would report a span with nothing able to tell it a turn went
       * missing. That is a measurement resting on an assumption, which is the one thing this app
       * will not print as a number. Three of the brands it speaks to are in that position
       * (moyu32, moyu-mhc, qiyi), and `numbersMoves()` existed with no caller — so they were all
       * being timed (found by audit, 2026-09-04).
       *
       * Asked when the timer ARMS, which is the first instant the answer is both needed and
       * known, and said once: the hand clock still works, and a line repeated on every snapshot
       * would bury that.
       */
      let untimeable = false;
      // Only a session that SAYS no declines the solve. With no session there is no cube-driven
      // timing to decline — `conn` and `state.connected` move together — and refusing on a fact
      // nobody asserted would be inventing the answer rather than asking for it.
      const cubeCanTime = () => !conn || conn.numbersMoves();

      // A lost turn means the span cannot be vouched for, and this is the only path that says so
      // on a cube that does not number its moves — which is three of the brands the app speaks to.
      // The clock keeps running: a solve in progress is still a solve. It is the RESULT that is
      // refused, and solve-timer already owns those words.
      hooks.liveGap = () => auto.interrupted();

      warmSolver();      // New scramble is one press away here; see cubeScreen's mount
      schedulePreroll(); // and it should never be the press that waits for a search
      const newScr = async () => {
        // The scramble on screen is the one the RUNNING solve is recorded against — replacing
        // it mid-solve would file the time under a scramble the solver never saw, and disarm
        // the cube-driven stop. Stop the clock first; then roll.
        if (running) return;
        if (!solverReady) {
          $('#scr', root).textContent = t('working out a scramble…');
          // Retry when it lands. Without this, opening Timer before the solver finished left
          // "solver loading…" on screen permanently — the only way out was pressing New scramble
          // again, which nothing on the screen suggested.
          //
          // And when the load FAILS, say so about the APP rather than about the cube: the retry
          // used to be handed `false` and do nothing at all, leaving the screen waiting forever
          // on something that had already given up (found by audit, 2026-09-04).
          void loadSolver().then((ok) => {
            if (!root.isConnected || state.screen !== 'timer') return;
            if (ok) { void newScr(); return; }
            $('#scr', root).textContent = t('the solver did not load — reload the app');
            say(t('Scrambles need the solver, and it did not load. Reloading the app is the fix; the clock below still times by hand.'));
          });
          return;
        }
        // A roll that THREW says the same thing to a user as one that came back empty: there is
        // no scramble, and the button is the retry. It used to say nothing at all — `newScr` is
        // wired straight to onclick, so the rejection left the click handler as an unhandled
        // promise and the screen sat on the old scramble with no explanation. The engine raises
        // here for real (eight budget escalations, or a pool that cannot spawn a worker).
        let rolled;
        try {
          rolled = await randomScramble();
        } catch (err) {
          if (!root.isConnected || state.screen !== 'timer') return;
          console.error('scramble could not be rolled', err);
          // The scramble already in play is left exactly as it is: it is still the one this
          // screen would record a solve against, and blanking it would lose that too.
          say(t('A scramble could not be worked out — press New scramble to try again.'));
          return;
        }
        // RE-CHECKED after the await, not only before it. A roll is a real Kociemba search now,
        // so seconds can pass inside this call — long enough to press the clock and start a solve.
        // Landing then would file that solve under a scramble shown after it began, and disarm the
        // cube-driven stop. The rolled cube is not thrown away: it is parked as the next roll, so
        // the press after this one is instant rather than paying for the search twice.
        if (!root.isConnected) { parkRoll(rolled); return; }
        if (running) { parkRoll(rolled); return; }
        // The CALLER puts it in play, so a roll that arrives at a bad moment changes nothing the
        // solve history is recorded against.
        putInPlay(rolled);
        scrTarget = rolled.facelets || null;
        auto.reset();
        untimeable = false;
        $('#scr', root).textContent = rolled.alg || '—';
        if (!rolled.alg) say(t('A scramble could not be worked out — press New scramble to try again.'));
        else if (scrTarget && chainTrusted()) say(t('Scramble your cube — the clock starts itself'));
      };
      /** Record a finished solve, and say so when the browser refused to keep it.
       *
       *  A solve that was not stored still showed on the clock and then vanished from "last five"
       *  with nothing said — a private window or a full quota looked exactly like a bug in the
       *  timer. save() already warns to the console; this is the half a person can see. */
      const record = (time, extra) => {
        if (pushSolve(time, extra)) return true;
        say(t('That time is on the clock but was NOT saved — this browser is refusing to store anything, so it will be gone on reload.'));
        return false;
      };
      const stop = () => {
        running = false;
        cancelAnimationFrame(raf);
        // `secs`, not `t`: a local named `t` here shadowed the imported translator for the rest of
        // this function, so every sentence below it would silently stop being translatable.
        const secs = fmt(performance.now() - t0);
        clock.textContent = secs;
        clock.style.color = 'var(--ink)';
        nameClock();
        say(MANUAL);
        // A hand-stopped solve is hand-timed even if the cube started it: the moment recorded is
        // the click, not a move. Recording it as cube-timed would put a click into a turn rate.
        record(secs, { source: 'manual' });
        byCube = false;
        auto.reset();
        renderLast();
      };
      /** Start the clock. ONE body, because the two ways it starts differ in exactly two things:
       *  the sentence on the hint line, and who is credited for the number at the end (`byCube`,
       *  set by the caller that earns it). Everything else — the flag the frame loop reads, the
       *  instant it measures from, the accent colour, the name the button announces, the loop
       *  itself — is the same start, and it was written out twice. Two copies of a five-line
       *  sequence is two places for the next change to land in one of. */
      const runClock = (message) => {
        running = true;
        t0 = performance.now();
        clock.style.color = 'var(--accent)';
        nameClock();
        say(message);
        tick();
      };
      const start = () => runClock(t('Running — click or press space to stop'));
      const toggle = () => { if (running) stop(); else start(); };

      /** The cube reached the scramble and the solver made the first turn. */
      const startFromCube = () => {
        byCube = true;
        // The animated figure runs on the host clock because it only has to LOOK live; the number
        // that gets recorded is replaced by the cube's own measurement when the solve ends.
        runClock(t('Running — solve it, and the cube stops the clock'));
      };

      /** The cube reached solved. The cube's clock decides the number, not this screen's. */
      const stopFromCube = () => {
        running = false;
        cancelAnimationFrame(raf);
        clock.style.color = 'var(--ink)';
        nameClock();
        byCube = false;
        const r = auto.result();
        if (!r) {
          // Refusing is the designed outcome, not an error path: a solve that cannot be timed
          // truthfully is not recorded at all, and the screen says which fact was missing.
          clock.textContent = '—';
          // The module's refusals are English sentences, which IS the catalog key — the same
          // contract the scanner panel's notices use.
          say(t(auto.refusal || 'that solve could not be timed — press New scramble'));
          auto.reset();
          return;
        }
        clock.textContent = r.seconds;
        // `inspectionMs` is host-clocked at both ends and therefore coarser than the solve; it is
        // stored as-is (or omitted) rather than rounded into looking as precise as `time`.
        const saved = record(r.seconds, {
          source: 'cube',
          moves: r.moves,
          ...(r.inspectionMs === null ? {} : { inspectionMs: r.inspectionMs }),
        });
        auto.reset();
        // ONLY ON A SUCCESSFUL WRITE. `record()` puts the "that time is on the clock but was NOT
        // saved" sentence on this same line, and saying the idle hint straight after wiped it in
        // the same task — no frame ever carried it. The cube-timed solve is exactly where that
        // matters most: nobody pressed anything, so a time that quietly failed to store looks
        // like the app deciding the solve did not count. The hand-stopped path says MANUAL
        // BEFORE it records, which is why it never had this bug.
        if (saved) say(MANUAL);
        renderLast();
      };
      clock.onclick = toggle;
      nameClock();
      $('#newScr', root).onclick = newScr;
      // escHtml: solve times come from localStorage, which is untrusted input, and they were
      // going into innerHTML raw — a stored-XSS hole reachable by anything that can write to the
      // origin's storage.
      //
      // The most recent one carries an undo. A mis-recorded solve — a fumbled press, a clock
      // started by a cube that was only being tidied — used to be permanent, and the alternative
      // for anyone who cared about their averages was to edit localStorage by hand. Two-step,
      // the idiom the Forget button uses, because it destroys a record nothing can re-derive.
      const renderLast = () => {
        const l = recentSolves().filter((s) => s.time).slice(0, 5);
        $('#lastFive', root).innerHTML = l.map((s, i) =>
          `<div class="card" style="padding:9px 16px;text-align:center"><div class="num" style="font-size:var(--fs-title);font-weight:600">${escHtml(s.time)}</div>${
            i === 0 ? `<button class="pill" id="undoLast" style="margin-top:6px;padding:2px 10px;font-size:var(--fs-meta)">${escHtml(t('Undo'))}</button>` : ''
          }</div>`,
        ).join('');
        const undo = $('#undoLast', root);
        if (undo) {
          undo.onclick = () => {
            if (undo.dataset.armed !== 'yes') {
              undo.dataset.armed = 'yes';
              undo.textContent = t('Remove it?');
              undo.style.color = 'var(--err-ink)';
              undo.style.borderColor = 'var(--err)';
              return;
            }
            if (dropLastSolve()) say(t('Removed — that solve is no longer counted.'));
            else say(t('It could not be removed — this browser is refusing to store anything.'));
            renderLast();
          };
        }
      };
      // e.repeat: holding the key down fires keydown continuously, which start/stopped the clock
      // dozens of times a second and wrote a run of nonsense times into the solve history.
      const onKey = (e) => {
        if (e.repeat || e.code !== 'Space' || state.screen !== 'timer') return;
        // A press of the clock button arrives here as well as through onclick — Space is a
        // button's own activation key — and toggling twice per press would start and stop in the
        // same instant. The button's own handler owns that case.
        if (document.activeElement === clock) return;
        e.preventDefault();
        toggle();
      };
      document.addEventListener('keydown', onKey, { signal: screenAbort?.signal });

      // The cube's two streams. Moves start the clock; snapshots arm and stop it. Both are the
      // same doors every other screen uses, so the test seam (window.cubusFeed) drives this
      // exactly as the driver does — the reason phase 4's absence went unnoticed is that nothing
      // could exercise it without a physical cube.
      hooks.liveMove = (m) => {
        if (untimeable) return;
        const before = auto.state;
        if (auto.move(m) === 'running' && before === 'armed' && !running) startFromCube();
      };
      hooks.liveUpdate = (f, serial) => {
        if (untimeable) return;
        const before = auto.state;
        const now = auto.facelets(f, serial);
        // "Ready" is a recorded instant, not a mood: the timer captured WHEN the cube reached the
        // scramble, which is what makes the inspection interval a measurement rather than a guess.
        if (before !== 'armed' && now === 'armed') {
          if (!cubeCanTime()) {
            untimeable = true;
            auto.reset();
            say(t('This cube does not number its turns, so cubus cannot tell a clean solve from one that dropped a turn — it will not time it. Use the clock or the space bar and time it by hand.'));
            return;
          }
          say(t('Ready — turn to start'));
        }
        if (before === 'armed' && now === 'idle' && !running) say(t('Scramble your cube — the clock starts itself'));
        if (before === 'running' && now === 'stopped' && byCube) stopFromCube();
      };

      hooks.cleanup = () => {
        // `running` first: tick() re-schedules itself, so cancelling the pending frame while the
        // flag is still true leaves an in-flight callback free to queue another one — a clock that
        // animates forever on a screen that no longer exists.
        running = false;
        cancelAnimationFrame(raf);
        // Release the cube stream with the screen, or a torn-down closure keeps timing.
        hooks.liveMove = null;
        hooks.liveUpdate = null;
      };
      renderLast(); void newScr();
    },
  };
};
