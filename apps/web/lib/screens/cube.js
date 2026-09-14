// Home and Scramble — the cube screen, walked from either end. The walk itself is lib/walk-session.js.
//
// Lifted out of app.js on 2026-09-13, when that file was split into modules.

import { CUBE_VIEW } from '../cube-view.js';
import { solveByMethod } from '../method-solver.js';
import { t } from '../i18n.js';
import { OFFERED_TARGETS } from '../stage-targets.js';
// Everything one cube screen's walk owns, from the load to the smart cube following it — the screen
// keeps its composition and hands the walk the parts of it the walk writes to.
import { createWalkSession } from '../walk-session.js';
// The route race into a stage target — one of this screen's own parts, built below.
import { createRouteRace } from './cube/route-race.js';
// The rest of its own parts: the speed menu, the die and the reconnect question.
import { createSpeedMenu } from './cube/speed-menu.js';
import { createDie } from './cube/die.js';
import { createReconnectAsk } from './cube/reconnect-ask.js';
// The BUDGET only. `stage-distance.js` builds nothing at import — its tables are lazy — but this
// thread must never call its search: §8 is not negotiable and a table build of a few hundred
// milliseconds is exactly the 723 ms block that was removed from `loadSolver`. The search runs on
// a worker, through `stageAsk`.
import { NODE_BUDGET as STAGE_NODE_BUDGET } from '../stage-distance.js';

import { $, SOLVED, escHtml, icon, state } from '../app-state.js';
import { load, save, settings } from '../app-settings.js';
import { hooks } from '../screen-slots.js';
import { CHIP_NODE_BUDGET, Cube, loadSolver, solverReady, stageAsk, warmSolver } from '../solver-service.js';
import { classifyCube, deriveCube, lessonFor, raiseRung, stepStates } from '../cube-subject.js';
import { applyNetColors, buildNet, describeCube, newCube } from '../cube-drawing.js';
import { keepAwake } from '../wake-lock.js';
import { adoptCube } from '../cube-connection.js';
import { wireReconnectAnswers } from '../reconnect-answer.js';
import { chainTrusted, markStale } from '../cube-trust-state.js';
import { parkRoll, putInPlay, randomScramble, schedulePreroll } from '../scramble-roll.js';
import { PROVE_COPY, sayWalkLength } from '../prove-affordance.js';
import { SCREENS, go, refreshScreen, screenAbort, screenGen } from '../screen-shell.js';

// The cube screen: where a sequence of moves gets FOLLOWED, and where a cube gets looked at.
//
// One screen, because it was always one object. Solve guide and Playback were the same function
// behind a boolean — `solveScreen({ guide })` — and the 3D viewer was the same cube again with the
// transport taken away. Three nav items differing by a flag and a couple of cards taught nobody
// anything. Restore reads a cube; this is the next step.
//
// Scramble is the SAME screen again, and this one earns its flag where those did not: it is not a
// card hidden or a button greyed out, it is the opposite end of the same walk. Restore reads a
// cube so it can be solved; Scramble starts from solved and tells you how to mix one up.
//
// There was a `followMoves(seq)` handoff here for a third caller to push its own alg through. It
// had no callers, so its branch in the walk was unreachable; it is gone rather than kept warm for
// a History screen that does not exist yet. Re-add it when there is something to add it for.
//
// A new reading updates this screen IN PLACE (see liveUpdate): a full re-render on every
// quarter turn would restart an animation the user is halfway through following.

/** Scramble's subject before its roll lands: solved, which is where a scramble starts. */
const SCRAMBLE_START = Object.freeze({ facelets: SOLVED, isPhysical: false, moves: [] });

/**
 * Why there turned out to be no walk.
 *
 * The reason is the message, and it used to be one sentence for four different failures: the
 * solver never loaded, no scramble could be rolled, the worker died, the oracle refused the
 * answer. "Could not work it out" blames the CUBE for every one of them, and offers re-scanning
 * as the remedy even when the cube is blameless and re-scanning cannot help (found by audit,
 * 2026-09-04). Each one now says what happened and what to do instead — and none of them says a
 * move count is impossible, which two-phase cannot know.
 *
 * At module scope rather than inside the mount, because the die's own roll fails in exactly the
 * same way and must say exactly the same sentence: a `const` after `if (!walking) return` is in
 * the temporal dead zone on every screen that has no walk, which is precisely where the die's
 * failure had nothing to say at all.
 */
const WALK_FAILURES = {
  'solver unavailable': 'the solver did not load — reload the app',
  'no scramble': 'a scramble could not be rolled — try again',
  'cross-check': 'the answer did not check out — read the cube again',
};

/**
 * The best route into a stage target: the race of §4, in lib/screens/cube/route-race.js.
 *
 * Built here, beside the one budget the app may import from the stage engine. `cubejs` is a
 * function because `loadSolver` assigns `Cube` long after this module has loaded.
 */
const lastRoute = createRouteRace({
  state, cubejs: () => Cube, stageAsk, solveByMethod, STAGE_NODE_BUDGET,
});

/** Everything a cube screen's walk session reaches for that the APP owns — listed here, once.
 *
 *  A frozen object rather than a longer argument list at the mount, because none of it varies by
 *  screen. `cubejs` and `solverReady` are FUNCTIONS: `loadSolver` assigns both long after this object
 *  is built, and a session holding their values would hold `null` and `false` for the life of the app. */
const WALK_APP = Object.freeze({
  state, settings, SOLVED, CHIP_NODE_BUDGET, WALK_FAILURES,
  cubejs: () => Cube,
  solverReady: () => solverReady,
  loadSolver, randomScramble, deriveCube, classifyCube, adoptCube, chainTrusted, markStale,
  lessonFor, stageAsk, stepStates, putInPlay, parkRoll, refreshScreen, go, save, raiseRung,
  escHtml, icon, lastRoute, sayWalkLength, describeCube,
});

/** Solve and Scramble are the same screen walked from opposite ends.
 *
 * Solve starts at YOUR cube and ends solved; Scramble starts SOLVED and ends at a random state.
 * Both walk a list of moves forwards, which is the whole reason this is one screen and not a
 * mirrored transport: a scramble played forwards names the turn you actually make. Playing a
 * solution backwards would not — the chips render each move literally, so the label would read R
 * while your hand does R'.
 */
const cubeScreen = (screenMode) => {
  const scrambling = screenMode === 'scramble';
  // No controls on this screen any more, so these are read but never written here. Left on
  // `cubeView` so they stay tunable without a rebuild — but the DEFAULTS are the tuned look, not
  // a starting point: the Restore screen's cube (ghosts floating at elevation 9, stickers
  // full-bleed at 1 — see the scan screen's mount) is the reference the walking screens must
  // match, and a wiped localStorage once reverted them to a look nobody had chosen. A tuning
  // that lives only in storage is a tuning waiting to be lost.
  // `CUBE_VIEW` is frozen, and `load()` spreads its fallback into a fresh object, so the `delete`
  // below cannot reach the constant. Lifted to `lib/cube-view.js` because a second consumer was
  // reading these five numbers out of THIS FILE with a regular expression.
  const v = load('cubeView', CUBE_VIEW);
  // The camera's distance is no longer a tuning: the renderer fits the picture to its slot
  // (lib/cube-frame.js) — a distance right for one slot shape clipped the ghost faces on every
  // other. A stored camDist is dropped rather than left for save() to keep rewriting.
  if ('camDist' in v) { delete v.camDist; save('cubeView', v); }
  // A scramble is always available: it is generated here rather than read off the cube, so there is
  // no state that makes this screen have nothing to do.
  //
  // Chosen SYNCHRONOUSLY, from arithmetic — that is why `classifyCube` had to stop being a
  // search. The composition is decided before the first frame is composited, so a screen with no
  // walk never briefly draws a transport over one, and a screen with a walk never draws an empty
  // solution card while a search runs.
  const walking = scrambling || classifyCube().solvable;
  // The other reason there is no walk, and the only one worth a sentence. `!solvable` covers both
  // a solved cube (nothing to do, and the picture says so) and an arrangement no turning can
  // produce (nothing to do, and nothing on screen would otherwise explain why).
  const unsolvable = !scrambling && state.cube.unsolvable;
  const label = scrambling ? 'Scramble' : 'Solution';
  const walked = scrambling ? 'scramble' : 'solution';
  // The open reconnect question — the heading it dresses the state card in, the question itself,
  // and putting it back into a sheet already standing — is its own unit
  // (lib/screens/cube/reconnect-ask.js). Its words are read through functions, because this screen
  // retargets in place (see `update` below).
  const { rcNow, stateHeading, reconnectAsk, sync: syncAsk } = createReconnectAsk({ scrambling });
  /** Set by mount, once this screen has a walk it can reload. Null while it has none — a solved
   *  cube draws no transport and no solution card, so there is nothing to retarget INTO. */
  let retarget = null;
  /** The load `update()` last started: the die holds its press until that walk is on screen. */
  let loading = null;
  // Saved key → renderer attribute. Named for what it is now that the sliders it fed are gone.
  const VIEW_ATTRS = [
    ['hintElev', 'ghost-elevation'],
    ['camLat', 'camera-latitude'], ['camLon', 'camera-longitude'],
    ['facScale', 'facelet-scale'],
  ];
  // Four regions of the layout contract's grid (index.html, ".cols"): the cube card is
  // `primary`, the transport card `aux`, the state card the `twin` and the solution card the
  // `sheet` — the last two are the aside's children, which the stylesheet hands to the grid
  // (display: contents) or keeps as a scrolling column, by composition. The DOM is the same
  // either way.
  return {
    html: `<div class="cols${walking ? ' walking' : ''}">
      <div class="card primary" style="display:flex;flex-direction:column;align-items:center;position:relative">
        ${walking ? `<div class="card-tools">
          <button id="speedBtn" title="Animation speed" aria-label="Animation speed">${icon('gauge', 20)}</button>
        </div>` : ''}
        <div style="flex:1;min-height:0;width:100%">
          <div class="cube-slot" id="viewCube" style="height:100%"></div>
        </div>
      </div>
      ${walking ? `<div class="card aux">
        <div class="transport">
          <button class="tbtn" id="prevBtn" title="Back a move" aria-label="Back a move">${icon('chevron-left', 20)}</button>
          <button class="tbtn" id="repeatBtn" title="Show that move again" aria-label="Show that move again">${icon('refresh', 18)}</button>
          <button class="tbtn" id="nextBtn" title="Next move" aria-label="Next move">${icon('chevron-right', 20)}</button>
          <button class="tbtn primary" id="playBtn" title="Play from here to the end" aria-label="Play from here to the end">${icon('play', 18)}</button>
          <div class="progress" title="How far through the ${walked} you are"><span id="progBar"></span></div>
          <span class="done-mark" id="doneMark" hidden title="Done">${icon('check', 14)}</span>
          <span class="num" id="stepLbl" role="status" aria-live="polite" style="color:var(--ink-4);min-width:56px;text-align:right">0 / 0</span>
          ${state.connected ? `<button class="pill${state.cube.trusted ? ' on' : ''}" data-mode="cube" aria-pressed="${Boolean(state.cube.trusted)}" title="Turn your smart cube and the guide keeps up">${escHtml(t('Cube leads'))}</button>` : ''}
          ${scrambling ? `<button class="btn sm primary" id="solveItBtn" hidden>Solve this scramble</button>` : ''}
        </div>
      </div>` : ''}
    <div class="aside">
      <div class="card state-card twin" style="padding-bottom:0">
        <div class="eyebrow-row"><b class="state-h">${escHtml(stateHeading())}</b>
          ${scrambling || settings.devRandCube
            // On Scramble the die IS the screen's re-roll and always shows. On the solve side it
            // loads a random cube that is NOT the one in anyone's hand — a developer shortcut,
            // hidden unless the Advanced toggle asks for it.
            //
            // The die's own status line, beside the button that was pressed. The count in the
            // solution card is where a failed roll is reported when there IS a walk — but a
            // solved cube draws no solution card at all, and there the press used to fail into
            // the console alone: nothing moved, nothing was said (found by audit, 2026-09-05).
            ? `<span class="sub" id="rollSay" role="status" aria-live="polite" style="margin-left:auto;padding-right:8px;color:var(--err-ink)"></span>
              <button id="randCube" title="${scrambling ? 'Roll a different scramble' : 'Load a random scrambled cube'}" aria-label="${scrambling ? 'Roll a different scramble' : 'Load a random scrambled cube'}">${icon('dice', 18)}</button>`
            : ''}</div>
        <!-- 30px above AND ~30px below the net in landscape (bottom = grid row gap 18 + the
             Solution header's 14px pad, with this card's own bottom padding zeroed) — the two
             breathing spaces the eye compares, made equal. The margin is the stylesheet's
             (.state-card .net): beside the cube in portrait the net centres instead. -->
        <div class="net" id="viewNet"></div>
        <!-- THE TARGET, WITH THE FREE PIECES GHOSTED, and it is what makes a minimal route
             acceptable rather than alarming: a repair to the top cross may break the cross on the
             way, and a child who can see what they are aiming at — with "doesn't matter yet" drawn
             as an empty well — follows it. Without this the first alarming route costs the feature
             its credibility, and no amount of correct arithmetic buys that back (§6). Hidden while
             the target is the whole cube, where the picture would be a solved cube beside a
             scrambled one and say nothing. While it IS shown it takes the Initial State net's
             place: the two together did not fit this card's row on the small windows, and the
             card was drawn over the sheet (loadWalk records the measurement).
             (This comment lives inside a template literal, so optimal.test.mjs's scanner reads it
             as a string that could reach a screen. It therefore avoids the claim vocabulary — and
             that is the scanner being right rather than a nuisance: it cannot tell markup from
             copy, and the day it tries is the day it can be walked past.) -->
        <div id="stageAim" hidden style="margin-top:10px">
          <div class="sub" style="color:var(--ink-4);text-align:center;padding-bottom:4px" id="stageAimSay"></div>
          <div class="net" id="stageAimNet"></div>
          <!-- HOW FAR THE CUBE IN YOUR HAND IS, right now. Its own line and never the route's
               count: #moveCount reports progress against THIS route's total, and a live distance
               written into it would make one label silently mean two things (§5.5). -->
          <div class="sub" id="stageLive" role="status" aria-live="polite" style="text-align:center;padding-top:6px;color:var(--ink-4)"></div>
        </div></div>
      ${unsolvable ? `<div class="card sheet unsolvable-card">
        <div class="follow-note" id="unsolvableNote" style="border-top:0">
          <b>${escHtml(t('This arrangement is not one a cube can be turned into.'))}</b>
          <span class="sub" style="color:var(--ink-4)">${escHtml(t('At least one sticker is somewhere turning a real cube could never put it — a corner twisted in place, an edge flipped, or two pieces swapped — so there is no walk to follow. Read the cube again on Restore, or correct the sticker there.'))}</span>
        </div>
      </div>` : ''}
      ${!walking && rcNow() ? `<div class="card sheet reconnect-card">${reconnectAsk()}</div>` : ''}
      ${walking ? `<div class="card tight solution-card sheet">
        ${reconnectAsk()}
        <!-- The count carries the auto margin, not the button: with it on the button, the header's
             space-between left the number stranded midway between the heading and the pill. The
             count is the heading's ANSWER and belongs at the right edge whether or not anything
             follows it; the buttons then sit beside it, each with a margin of its own. -->
        <div class="card-h bare"><b id="solLabel">${label}</b><span class="sub" id="moveCount" role="status" aria-live="polite" style="margin-left:auto">—</span><button class="pill" id="proveBtn" hidden style="margin-left:12px">${PROVE_COPY.button}</button><button class="pill" id="proveCancel" hidden style="margin-left:6px">stop</button></div>
        ${scrambling ? '' : `<!-- Two objects, both reachable — dev-docs/method-solver-return-plan.md §3.
             The first attempt at the explaining solver REPLACED the solution with the lesson: a
             93-move "Lesson" appeared exactly where 20 moves used to be printed, and it read as a
             solver that had broken. They are different questions with different answers, so they
             are two labelled things you switch between, and the count beside the heading changes
             with the label so the two numbers can never be mistaken for each other. -->
        <!-- aria-pressed, not only the "on" class. Which of the two is showing was carried by a
             CSS class alone, so a screen reader announced two identical buttons and no way to tell
             which object was on screen — and the whole point of the pair is that they are two
             different answers to two different questions. -->
        <!-- WHERE THIS WALK IS GOING. Not a setting and not in Settings: the target is a fact
             about this cube right now, which is the same argument the ladder makes about rungs
             (dev-docs/solve-to-state-plan.md §6). The default stays "solved", so nothing changes
             for somebody who only wants their cube solved. Changing it is a WALK REPLACEMENT and
             goes through retarget(), which is exactly what that path is for. -->
        <div class="stage-row" id="stageTargetRow" role="group" aria-label="${escHtml(t('Where to take this cube'))}" style="padding:2px 18px 6px">
          ${OFFERED_TARGETS.map((tg) => `<button class="pill${state.stageTarget === tg.id ? ' on' : ''}" data-stage="${escHtml(tg.id)}" aria-pressed="${state.stageTarget === tg.id}">${escHtml(tg.id === 'solved' ? t('Solved') : tg.name)}</button>`).join('')}
        </div>
        <div class="wrap-row" id="walkKindRow" role="group" aria-label="${escHtml(t('Solution'))} / ${escHtml(t('Lesson'))}" style="gap:6px;padding:2px 18px 6px">
          <button class="pill on" data-walk="solution" aria-pressed="true">${escHtml(t('Solution'))}</button>
          <button class="pill" data-walk="lesson" aria-pressed="false">${escHtml(t('Lesson'))}</button>
          <span class="sub" id="rungLine" style="color:var(--ink-4);margin-left:auto;text-align:right" hidden></span>
        </div>`}
        <div class="list" id="solList" style="padding:6px 0"></div>
        ${scrambling ? '' : '<div class="sub" id="whyLine" style="padding:0 18px 10px;color:var(--ink-4)" hidden></div>'}
        ${scrambling ? '' : `<!-- Offer, never ask (§3 rule 3). Shown only after a lesson has been followed to the
             end enough times, once, in one tap. Declining costs nothing: it postpones the offer
             rather than disabling it, so nothing is ever silently raised and nothing is ever
             permanently refused on a learner's behalf. -->
        <div class="follow-note info" id="rungOffer" hidden>
          <span id="rungOfferMsg" role="status" aria-live="polite"></span>
          <div class="acts">
            <button class="btn sm accent-outline" id="rungYes">${escHtml(t('Show me'))}</button>
            <button class="btn sm outline" id="rungNot">${escHtml(t('Not yet'))}</button>
          </div>
        </div>`}
        <div class="follow-note" id="followNote" hidden>
          <span id="followMsg" role="status" aria-live="polite"></span>
          <div class="acts">
            <button class="btn sm accent-outline" id="resolveBtn">Re-solve</button>
            <button class="btn sm outline" id="turnBackBtn">I'll turn it back</button>
          </div>
        </div>
</div>` : ''}
    </div></div>`,
    async mount(root) {
      // Captured before the first await. A solve can take seconds, and navigating away meanwhile
      // must not let this mount come back and install its liveUpdate over the new screen's.
      const gen = screenGen;
      const stale = () => gen !== screenGen;
      // Captured here for the same reason `gen` is: this mount can outlive its screen, and the
      // signal it must hang listeners on is THIS screen's, not whichever one is current when an
      // await comes back.
      const signal = screenAbort?.signal;

      /** This screen's walk session (lib/walk-session.js), once it has a walk; null on a screen with
       *  none. Declared up here because two things built before it read it LATE: the speed menu's
       *  tempo follows the session's driver, and the teardown calls off the session's search. */
      let session = null;

      // This screen can roll a scramble — start the roller's tables warming now, so the press
      // that asks for one is not the thing that waits for them.
      // Rolling and solving are the same pool now, so one warm-up covers both. This screen
      // solves on entry and on every press of the die; see warmSolver.
      warmSolver();
      if (scrambling || settings.devRandCube) schedulePreroll();
      // Scramble starts solved. Drawn from Home's subject, it showed that cube's setup alg beside
      // a solved net until the roll landed, and for good when the roll failed (found by audit,
      // 2026-09-13).
      const cube = newCube(scrambling ? { subject: SCRAMBLE_START } : { animate: walking });
      // The view goes on BEFORE the element is connected, the way the scan screen's twin does it.
      // connectedCallback draws immediately, so attributes set after appendChild leave that first
      // drawing framed for the renderer's OWN defaults — no ghosts, and a camera fitted to a
      // cube without them, which is a visibly larger picture than the one that replaces it. It
      // survived only because the element's animation frame happened to run later in the same
      // frame as the mount; that ordering is the engine's to change, and nothing tested it.
      cube.setAttribute('ghosts', v.ghosts ? 'floating' : 'none');
      for (const [k, attr] of VIEW_ATTRS) cube.setAttribute(attr, String(v[k]));
      $('#viewCube', root).appendChild(cube);
      applyNetColors();
      const paintNet = buildNet($('#viewNet', root));
      // A second net for the TARGET. Built once with the screen, painted per walk — the same
      // renderer the initial state uses, so a stage picture and a cube are drawn by one thing and
      // cannot come to disagree about which sticker is where.
      const aimNet = $('#stageAimNet', root);
      const paintAim = aimNet ? buildNet(aimNet) : () => {};
      paintNet(scrambling ? SOLVED : state.cube.facelets);
      // The reconnect answer, wired before any await: the solver can take seconds or fail, and
      // the question must be answerable either way.
      wireReconnectAnswers(root);
      /** The open question — or its absence — put into this screen's sheet, in place. */
      const syncReconnectAsk = () => { syncAsk(root); };

      // Speed sits in the card's corner, not in the transport row: it is a preference you set once
      // and forget, whereas the row is the solution you are walking. Same idiom as the scan
      // screen's camera menu. Wired before the solve so a screen that fails to solve still honours
      // the setting. The renderer reads tempo-scale per move, so a change lands on the next turn.
      // Its own unit (lib/screens/cube/speed-menu.js), and what it hands back is called by the walk
      // session whenever the driver changes: tempo DEPENDS on who drives (`following()` in
      // lib/walk-session.js says why).
      const applyTempo = createSpeedMenu({ root, cube, signal, following: () => session?.following() });
      // Turning a cube and reading the next move is minutes with no input at all, so the same
      // reasoning as the scan screen's: taken only where there IS a walk, because a cube being
      // looked at is not a cube being followed.
      const releaseWalkAwake = walking ? keepAwake() : () => {};
      // The screen's own teardown, now that the listeners carry their own: a search this screen
      // started must not go on burning the pool for a cube nobody is looking at.
      hooks.cleanup = () => { session?.dispose(); releaseWalkAwake(); };

      // The die — the press that loads a new cube, what the press holds while it rolls, and where
      // a roll that produced nothing is said — is its own unit (lib/screens/cube/die.js), handed
      // the app's services through WALK_APP. It takes the new subject through `update()`, which
      // records the load it starts in `loading`, and holds its press until that walk is on
      // screen. A rebuild leaves `loading` null.
      createDie({
        root, scrambling, signal, stale,
        takeNewSubject: () => { loading = null; refreshScreen(); return loading; },
      }, WALK_APP);

      hooks.liveUpdate = (f) => {
        // Walking screens install their own handler further down (the follow machinery); until it
        // lands — and on the failure path where it never does — snapshots must not repaint the
        // net either: its label names a fixed reference state.
        if (walking) return;
        // The picture is the SUBJECT. Live reports repaint it only when the subject IS the
        // physical cube — with a generated or unreadable subject on screen, painting the
        // connected cube over it would show one cube while every label describes another.
        if (!state.cube.isPhysical) return;
        // A NEW SUBJECT CAN ALSO BE A NEW COMPOSITION (2026-09-05). `walking` and `unsolvable`
        // were decided when this screen was built, and they decide whether the transport, the
        // solution card and the explanation exist AT ALL. So a cube that was solved and has now
        // been turned has a walk with nowhere to put it: the old handler repainted the picture
        // and stopped, leaving a scrambled cube on screen with no solution, no move list and no
        // way to ask for one — the app going quiet at exactly the moment it has something to say.
        // A composition change is a rebuild, which is precisely the answer refreshScreen() gets
        // from update() on a screen with no walk to replace.
        const now = classifyCube();
        if (now.solvable !== walking || now.unsolvable !== unsolvable) { refreshScreen(); return; }
        paintNet(f);
        cube.setAttribute('facelets', f);
      };

      if (!walking) return;

      // ---- the walk -----------------------------------------------------------------------------
      //
      // Everything from here on is the walk's, and it lives in lib/walk-session.js with its inputs
      // named: what this screen owns is the first argument, what the app owns is WALK_APP. The four
      // live hooks are installed HERE, before the first load, which is where the closure assigned
      // them: a turn reported during that load's search has to reach this walk's model, because the
      // load keeps turns the model is ahead by rather than rewinding past them.
      session = createWalkSession({
        root, cube, scrambling, walking, unsolvable, label, stateHeading, stale, signal,
        paintNet, paintAim, syncReconnectAsk, applyTempo,
      }, WALK_APP);
      hooks.liveMove = session.liveMove;
      hooks.liveUpdate = session.liveUpdate;
      hooks.liveGap = session.liveGap;
      hooks.onTrustLost = session.onTrustLost;
      retarget = session.load;
      await session.load();
    },
    /**
     * Take a new subject without being rebuilt — see refreshScreen().
     *
     * Only the WALK is replaceable in place. The composition is not: `walking` decides whether
     * the transport and the solution card exist at all, and with no walk there is nowhere to put
     * one, so those transitions say so and let the caller render properly. Returning false is not
     * a failure, it is the honest answer to "can you show this without rebuilding".
     */
    update() {
      if (!retarget) return false;                            // nothing mounted, or nothing to walk
      if (!(scrambling || classifyCube().solvable)) return false; // and now there is none to show
      loading = retarget();
      return true;
    },
  };
};

// Home is the cube. There is no separate "3D viewer" entry any more: it was the same screen
// reached by a second name, and the app's front door is the thing it is for.
SCREENS.home = () => cubeScreen('solve');
SCREENS.scramble = () => cubeScreen('scramble');
