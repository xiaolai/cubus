// Home and Scramble — the cube screen, walked from either end. The walk itself is lib/walk-session.js.
//
// Lifted out of app.js on 2026-09-13, when that file was split into modules.

import { fromCube } from '../cube-pieces.js';
import { CUBE_VIEW } from '../cube-view.js';
import { solveByMethod } from '../method-solver.js';
import { t } from '../i18n.js';
import { OFFERED_TARGETS } from '../stage-targets.js';
import { METHOD_FRAME, METHOD_TO_SCAN, renameAlg, toMethodFrame } from '../solving-hold.js';
// Everything one cube screen's walk owns, from the load to the smart cube following it — the screen
// keeps its composition and hands the walk the parts of it the walk writes to.
import { createWalkSession } from '../walk-session.js';
import { routesToTarget } from '../stage-route.js';
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
import { applyNetColors, buildNet, newCube } from '../cube-drawing.js';
import { keepAwake } from '../wake-lock.js';
import { adoptCube, chainTrusted, markStale, whenWords, wireReconnectAnswers } from '../cube-connection.js';
import { parkRoll, putInPlay, randomScramble, schedulePreroll } from '../scramble-roll.js';
import { PROVE_COPY, sayWalkLength } from '../prove-affordance.js';
import { SCREENS, go, placeMenuUnder, refreshScreen, screenAbort, screenGen } from '../screen-shell.js';

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

/** The three walking speeds, as renderer tempo-scale values. The renderer divides a 190ms base by
 * this, so a LARGER number is faster. None of them is quick: Fast is 0.95s per quarter turn, still
 * slower than the 760ms that used to be the only speed and was the complaint that prompted this. */
const SPEEDS = [
  { id: 'slow', label: 'Slow', tempo: 0.05 },     // 3.8s per quarter turn
  { id: 'normal', label: 'Normal', tempo: 0.1 },  // 1.9s
  { id: 'fast', label: 'Fast', tempo: 0.2 },      // 0.95s
];
const DEFAULT_SPEED = 'normal';

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
 * The best route into `target`, from the three sources of §4.
 *
 * Every source is injected rather than reached for, which is what lets the race be tested
 * without a worker: `lib/stage-route.js` knows nothing about this app. What it does know is
 * that a route is replayed before it is yielded, so nothing that fails the target's own
 * predicate can come back from here.
 *
 * The generator's intermediate yields are dropped on the floor — this returns the LAST one.
 * A screen that painted each in turn would show a fallback for a few hundred milliseconds
 * and then replace it, which is the "working…" flicker the repository already removed once;
 * the chips on Restore are where a bound-then-answer sequence belongs, because there the
 * first number arrives instantly and the second is an upgrade rather than a correction.
 */
async function lastRoute(target, facelets, signal, wholeDone) {
  // THE RACE RUNS IN THE METHOD FRAME, and only its answer leaves it (ADR 0003). All three
  // sources and the replay must agree about which cross is "the cross": the replay checks the
  // target's predicate on THIS cubie, so a source answering in the scan frame would be judged
  // against the white cross while having aimed at the yellow one.
  const cubie = fromCube(Cube.fromString(toMethodFrame(facelets)));
  let last = null;
  const deps = {
    exact: async () => {
      if (signal?.aborted) return null;
      const reply = await stageAsk({
        want: 'route', target: target.id, facelets, nodeBudget: STAGE_NODE_BUDGET, maxDepth: 12,
      });
      return reply?.moves === null || !reply ? null : { alg: reply.alg, moves: reply.moves };
    },
    // AWAITED, not read. The whole-cube search is running beside this one rather than in
    // front of it, so the pool source is "whatever that search produces, when it produces
    // it" — which is exactly a third racer. Reading `state.cube.solution` synchronously made
    // this source empty whenever it was asked first, which after the reordering is always.
    pool: async () => {
      await wholeDone;
      // The whole-cube solution is a scan-frame walk; the prefix scan runs on the method
      // frame's cubie, so it is renamed first. A throw here is absorbed by the race.
      return state.cube.solution ? renameAlg(state.cube.solution, METHOD_FRAME) : null;
    },
    /**
     * The method route — SCHEDULED, not called inline, and the yield is the point.
     *
     * `solveByMethod` is synchronous and unbounded: 0.45 to 24 ms measured, median 6.6.
     * Called straight from the race it runs before anything awaits, so it blocked this
     * thread between the exact request being built and it being sent — the one source that
     * leaves the machine, delayed by the one that cannot. A macrotask first puts it behind
     * the worker message and the pool's already-known answer, which costs it a tick and
     * costs the other two nothing.
     *
     * §4 keeps it in the race even so, and the measurement is why it is worth saying: over
     * the 156 corpus states where the fallback actually fires it was shorter in ZERO of
     * them. It is not here to win; it is here because the pool source is
     * `state.cube.solution`, and when that search failed there is nothing else.
     */
    method: async () => {
      await new Promise((resolve) => { setTimeout(resolve, 0); });
      return solveByMethod(cubie).alg;
    },
  };
  for await (const found of routesToTarget(target, cubie, deps)) last = found;
  // Back to the scan frame, where the walk, the renderer and `follow` live. Same moves, same
  // count, same claim — only the names change, so `minimal` and `overshoot` carry over as-is.
  if (!last || last.alg === null) return last;
  return Object.freeze({ ...last, alg: renameAlg(last.alg, METHOD_TO_SCAN) });
}

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
  escHtml, icon, lastRoute, sayWalkLength,
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
  // The open reconnect question, on the solve side only — Scramble's subject is always the
  // generated walk. The unconfirmed DRESS (the twin's heading) is worn only while the subject IS
  // the candidate; the question itself stands as long as it is open, because it is about the
  // cube, not about whatever the screen happens to show.
  // Read through a FUNCTION, not captured: this screen retargets in place now (see `update`
  // below), so a question that opens or closes has to be able to change the heading and the ask
  // on a screen that is not being rebuilt. A const here would freeze both at first render.
  const rcNow = () => (scrambling ? null : state.reconnect);
  const stateHeading = () => {
    const rc = rcNow();
    const rcDress = Boolean(rc?.candidate && state.cube.facelets === rc.candidate);
    if (scrambling) return 'Target State';
    if (!rcDress) return 'Initial State';
    if (rc.reading === 'turned') return 'Your cube — as it reports it';
    const when = whenWords(rc.seenAt).full;
    return `Your cube — as we last saw it${when ? `, ${when}` : ''}`;
  };
  // The question: at the top of the sheet, ABOVE the moves, not instead of them — a disconnect or
  // a reconnect must not wipe the guide (the floor never rises), so the walk of the candidate
  // stays walkable while the answer is open, and trust gates what it gates today: Follow.
  const reconnectAsk = () => {
    const rc = rcNow();
    if (!rc) return '';
    const when = whenWords(rc.seenAt);
    let ask = '';
    let sub = '';
    if (rc.reading === 'no-report') {
      ask = 'Your cube hasn’t said where it is.';
      sub = rc.candidate
        ? `It’s connected but hasn’t reported an arrangement — this is how we last saw it${when.full ? `, ${when.full}` : ''}.`
        : 'It’s connected but hasn’t reported an arrangement. The camera can read it as it is.';
    } else if (rc.reading === 'turned') {
      ask = `Your cube says it has been turned since${when.day ? ` ${when.day}` : ''} — is this it now?`;
    } else {
      ask = rc.candidate === SOLVED ? 'Is it solved right now?' : 'Is this your cube right now?';
      sub = `As we last saw it${when.full ? `, ${when.full}` : ''}.`;
    }
    // Yes needs a report to derive the correction from; a silent cube leaves the camera as the
    // only door. No reading grants trust — these two buttons are how the user does.
    const yes = rc.raw && rc.candidate
      ? '<button class="btn sm primary" data-reconnect="yes">Yes, that’s it</button>' : '';
    return `<div class="follow-note reconnect-ask" id="reconnectAsk" style="border-top:0">
      <b>${escHtml(ask)}</b>${sub ? `<span class="sub" style="color:var(--ink-4)">${escHtml(sub)}</span>` : ''}
      <div class="acts">${yes}<button class="btn sm outline" data-reconnect="scan">Check with the camera</button></div>
    </div>`;
  };
  /** Set by mount, once this screen has a walk it can reload. Null while it has none — a solved
   *  cube draws no transport and no solution card, so there is nothing to retarget INTO. */
  let retarget = null;
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
      const cube = newCube({ animate: walking });
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
      /** Put the open question — or its absence — into the sheet of a screen already standing.
       *  A question opening or closing used to be a reason to rebuild the whole screen, which on
       *  a walking one threw away the walk to change a paragraph above it. Replaces the node in
       *  place rather than wrapping it, so no stylesheet rule learns a new box. */
      const syncReconnectAsk = () => {
        const card = root.querySelector('.solution-card');
        if (!card) return;
        const showing = card.querySelector(':scope > .reconnect-ask');
        const html = reconnectAsk();
        if (!html) { showing?.remove(); return; }
        const holder = document.createElement('div');
        holder.innerHTML = html;
        const asked = holder.firstElementChild;
        if (showing) showing.replaceWith(asked); else card.prepend(asked);
        wireReconnectAnswers(root);
      };

      // Set by the speed menu, and called by the walk session whenever the driver changes: tempo
      // DEPENDS on who drives (`following()` in lib/walk-session.js says why).
      let applyTempo = () => {};

      // Speed sits in the card's corner, not in the transport row: it is a preference you set once
      // and forget, whereas the row is the solution you are walking. Same idiom as the scan
      // screen's camera menu. Wired before the solve so a screen that fails to solve still honours
      // the setting. The renderer reads tempo-scale per move, so a change lands on the next turn.
      const speedBtn = $('#speedBtn', root);
      const speedMenu = document.createElement('div');
      let speedId = DEFAULT_SPEED;
      let closeSpeed = () => {};
      if (speedBtn) {
        speedMenu.className = 'menu';
        speedMenu.hidden = true;
        speedMenu.setAttribute('role', 'menu');
        speedMenu.setAttribute('aria-label', t('Animation speed'));
        root.appendChild(speedMenu);
        // localStorage is untrusted input: an id no longer in SPEEDS must not reach setAttribute.
        const saved = load('walkSpeed', { id: DEFAULT_SPEED }).id;
        if (SPEEDS.some((o) => o.id === saved)) speedId = saved;
        closeSpeed = () => { speedMenu.hidden = true; speedBtn.classList.remove('open'); };

        const applySpeed = () => {
          const chosen = SPEEDS.find((o) => o.id === speedId);
          // The ONE place tempo is written. While the cube drives, the choice is stored but not
          // applied — it takes effect the moment the user takes over.
          cube.setAttribute('tempo-scale', String(session?.following() ? 1 : chosen.tempo));
          speedBtn.title = `Animation speed — ${chosen.label}`;
          speedBtn.setAttribute('aria-label', speedBtn.title);
          speedMenu.textContent = '';
          for (const o of SPEEDS) {
            const b = document.createElement('button');
            b.textContent = t(o.label);
            b.dataset.speed = o.id;
            b.setAttribute('role', 'menuitemradio');
            b.setAttribute('aria-checked', String(o.id === speedId));
            if (o.id === speedId) b.className = 'now';
            b.onclick = () => { speedId = o.id; save('walkSpeed', { id: o.id }); applySpeed(); closeSpeed(); speedBtn.focus(); };
            speedMenu.appendChild(b);
          }
        };
        applySpeed();
        applyTempo = applySpeed;

        speedBtn.onclick = (ev) => {
          const wasClosed = speedMenu.hidden;
          closeSpeed();
          if (!wasClosed) return;
          speedMenu.hidden = false;
          speedBtn.classList.add('open');
          placeMenuUnder(speedBtn, speedMenu);
          (speedMenu.querySelector('.now') ?? speedMenu.firstElementChild)?.focus();
          ev.stopPropagation();
        };
        const onAway = (ev) => {
          if (!speedMenu.hidden && !speedMenu.contains(ev.target) && !speedBtn.contains(ev.target)) closeSpeed();
        };
        const onEsc = (ev) => {
          if (ev.key !== 'Escape' || speedMenu.hidden) return;
          closeSpeed();
          speedBtn.focus(); // Escape returns you to the control you opened it from
        };
        // `{ signal }`, not a hand-written removal pair: this screen's abort is cut by
        // renderScreen on every navigation, so a listener that carries it cannot outlive its
        // screen — which is the same mechanism the parked <cubus-cube>'s listener relies on, and
        // one fewer place for a teardown to be written correctly. The pair it replaces was the
        // whole of `cleanup` here.
        document.addEventListener('click', onAway, { signal });
        document.addEventListener('keydown', onEsc, { signal });
      }
      // Turning a cube and reading the next move is minutes with no input at all, so the same
      // reasoning as the scan screen's: taken only where there IS a walk, because a cube being
      // looked at is not a cube being followed.
      const releaseWalkAwake = walking ? keepAwake() : () => {};
      // The screen's own teardown, now that the listeners carry their own: a search this screen
      // started must not go on burning the pool for a cube nobody is looking at.
      hooks.cleanup = () => { session?.dispose(); releaseWalkAwake(); };

      // A new cube is a new SUBJECT, not a new screen. This used to re-enter the screen, because
      // the solution, the move list and the step count were all built at mount and there was no
      // other way to replace them — which destroyed every node, listener and animation on the
      // screen to change one fact about it. loadWalk() is that other way now; refreshScreen()
      // asks for it and falls back to a rebuild only when the composition itself has to change.
      // Absent on the solve side unless the Advanced dev toggle shows it.
      //
      // The ANSWER IS STILL FOUND BEFORE ANYTHING ON SCREEN CHANGES. Adopting a cube and then
      // retargeting would put an empty chip grid and a count reading "working…" on the screen
      // until the solver answered — one whole presented frame, measured, and the blink this
      // button was reported for. Solving first spends the same milliseconds with the screen still
      // complete, and every await in loadWalk then resolves as a microtask.
      /** A roll produced nothing — said WHERE THE PRESS WAS, always.
       *
       *  The count beside the solution heading is this screen's status line while there is a
       *  walk: it is where failWalk reports the identical failure on the Scramble side, so the
       *  same press gets the same words wherever it is made. A screen with no walk has no such
       *  line — a solved cube draws no solution card — and there this reported to the console
       *  alone, which for the person pressing the button is indistinguishable from a button that
       *  does nothing (found by audit, 2026-09-05). `#rollSay` is the die's own line, drawn
       *  wherever the die is, so there is no composition in which the press can fail in silence.
       *  The die stays enabled either way, so the answer is the one it prints: try again.
       *  Silence was what both branches did before: an empty roll returned, and a rejected one
       *  escaped this handler entirely as an unhandled promise. */
      const sayRollFailed = (err) => {
        console.error('a random cube could not be rolled', err ?? 'the roller produced no cube');
        const status = $('#moveCount', root) ?? $('#rollSay', root);
        if (status) status.textContent = t(WALK_FAILURES['no scramble']);
      };
      /** Which press of the die owns the screen. Neither of the two generations already here can
       *  answer that: `stale()` counts SCREENS and this one is not being replaced, and `walkGen`
       *  counts walks, which a press has not started yet while it is still rolling. Rolling is a
       *  real Kociemba search — seconds, in the pool, alongside whatever else is queued — so two
       *  presses can be in flight at once and land in either order, and the OLDER one adopting
       *  its cube afterwards replaces the newer one on a screen already showing it (found by
       *  audit, 2026-09-05). */
      let rollGen = 0;
      const die = $('#randCube', root);
      if (die) die.onclick = async () => {
        if (!solverReady || die.disabled) return;
        const mine = ++rollGen;
        // Held from BEFORE the first await, not from after the roll: the press used to stay live
        // for the length of the search it started, so a second press could roll a second cube
        // over the first. Released in the `finally` at the end, because a roll that fails must
        // leave behind the button that retries it.
        die.disabled = true;
        try {
          // Scramble rolls its own inside loadWalk — the walk IS the scramble there, so there is
          // no subject to adopt first.
          if (!scrambling) {
            // Known by construction, and NOT the cube in your hand. Marking this 'camera' was the
            // bug behind a solved physical cube instantly completing a random solve: the guide
            // accepted the real cube's snapshots as progress through an arrangement it had never
            // been in.
            let rolled;
            try {
              rolled = await randomScramble();
            } catch (err) {
              // Rolling IS a solve (2026-08-31), so it fails the way a solve fails — eight budget
              // escalations, or a pool that could not spawn a worker. The press must not end in
              // silence and an unhandled rejection.
              if (!stale() && mine === rollGen) sayRollFailed(err);
              return;
            }
            // Superseded, by the screen or by a later press. Either way this cube is nobody's
            // subject — and rolling is a real search, so it is parked rather than wasted.
            if (stale() || mine !== rollGen) { parkRoll(rolled); return; }
            if (!rolled.facelets) { sayRollFailed(null); return; }
            putInPlay(rolled);
            adoptCube(rolled.facelets, { physical: false, source: 'generated', setupAlg: rolled.alg });
          }
          // A failure is not swallowed into silence — it leaves `solution` empty, and the screen
          // says "could not work it out" the way it does for any walk it cannot build.
          try { if (!scrambling) await deriveCube({ signal }); }
          catch (err) {
            // A search the screen's own teardown called off is not a failure worth a line: the
            // subject is gone and nobody is waiting on it.
            if (err?.name !== 'AbortError') console.warn('random cube could not be solved', err);
          }
          if (stale() || mine !== rollGen) return; // navigated away, or overtaken, while solving
          refreshScreen();
        } finally { die.disabled = false; }
      };

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
        paintNet, paintAim, syncReconnectAsk, applyTempo: () => applyTempo(),
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
      if (!walking) return false;                             // this screen has no walk to replace
      if (!(scrambling || classifyCube().solvable)) return false; // and now there is none to show
      void retarget();
      return true;
    },
  };
};

// Home is the cube. There is no separate "3D viewer" entry any more: it was the same screen
// reached by a second name, and the app's front door is the thing it is for.
SCREENS.home = () => cubeScreen('solve');
SCREENS.scramble = () => cubeScreen('scramble');
