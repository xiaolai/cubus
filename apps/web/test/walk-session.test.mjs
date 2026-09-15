// The walk session, driven on its own — lib/walk-session.js.
//
// All of this was closure state inside the cube screen's mount, reachable only by booting the whole
// app in a DOM and pressing things, or by reading app.js as text. Each case below is a defect an
// audit found, and until the session had parameters each was pinned by a regex over the source —
// which can say a line is present, never that the behaviour it was written for still holds. Here
// every service is a fake whose timing this file decides, so each case IS the ordering the defect
// lived in.

import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { Window } from 'happy-dom';

import Cube from '../vendor/cubejs.js';
import { fromCube, invert } from '../lib/cube-pieces.js';
import { faceTurnsAlg } from '../lib/cube-moves.js';
import { registerLocale, setLocale } from '../lib/i18n.js';
import { FOLLOWS_TO_OFFER, NO_PROGRESS, recordCleanFollow, repairProgress } from '../lib/method-ladder.js';
import { lessonSections, moveStepIndex } from '../lib/method-lesson.js';
import { methodFor, solveByMethod } from '../lib/method-solver.js';
import {
  SCAN_HOLD, TUMBLED, holdSentence, scanFrameWalk, toMethodFrame,
} from '../lib/solving-hold.js';
import { createFollowTracker } from '../lib/walk-follow.js';
import { createWalkPresenter } from '../lib/walk-presenter.js';
import { createWalkSession } from '../lib/walk-session.js';
import { lcg, randomAlg } from './fixtures/seeded-scrambles.mjs';

const SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
/** `alg` applied to `from`. */
const turned = (alg, from = SOLVED) => {
  const c = Cube.fromString(from);
  c.move(alg);
  return c.asString();
};
const settle = () => new Promise((r) => { setTimeout(r, 0); });
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
/** Resolve to `'still waiting'` if `promise` has not settled within `ms`, so a load that hangs on a
 *  search it should not be waiting for fails with a sentence rather than a test timeout. */
const within = (promise, ms = 500) => Promise.race([
  promise,
  new Promise((r) => { setTimeout(() => r('still waiting'), ms).unref(); }),
]);

/** What `deriveCube` leaves on `state.cube`: the solution, its moves, and every state along it. */
function solvedBy(state, alg) {
  const moves = alg.split(' ').filter(Boolean);
  const steps = [state.cube.facelets];
  const c = Cube.fromString(state.cube.facelets);
  for (const m of moves) { c.move(m); steps.push(c.asString()); }
  Object.assign(state.cube, { solution: alg, moves, stepFacelets: steps, setupAlg: '' });
}

/** The nodes of a walking cube screen that a session reads. The markup itself is cubeScreen's, in
 *  lib/screens/cube.js; the app and browser suites are what hold that markup and this module
 *  together. */
const MARKUP = `
  <div class="state-card"><b class="state-h"></b><div id="viewNet"></div>
    <div id="stageAim" hidden><div id="stageAimSay"></div><div id="stageAimNet"></div><div id="stageLive"></div></div>
  </div>
  <div class="transport">
    <button id="prevBtn"></button><button id="repeatBtn"></button><button id="nextBtn"></button><button id="playBtn"></button>
    <div class="progress"><span id="progBar"></span></div><span id="doneMark" hidden></span><span id="stepLbl">0 / 0</span>
    <button class="pill" data-mode="cube"></button><button id="solveItBtn" hidden></button>
  </div>
  <div id="rungOffer" hidden><span id="rungOfferMsg"></span><button id="rungYes"></button><button id="rungNot"></button></div>
  <div class="solution-card">
    <b id="solLabel">Solution</b><span id="moveCount">—</span><button id="proveBtn" hidden></button><button id="proveCancel" hidden></button>
    <div id="stageRow"><button data-stage="solved" class="on" aria-pressed="true"></button><button data-stage="cross" aria-pressed="false"></button></div>
    <div id="walkKindRow"><button data-walk="solution"></button><button data-walk="lesson"></button><span id="rungLine" hidden></span></div>
    <div id="solList"></div><div id="whyLine" hidden></div>
    <div id="followNote" hidden><span id="followMsg"></span><button id="resolveBtn"></button><button id="turnBackBtn"></button></div>
  </div>`;

const windows = [];
after(async () => { for (const win of windows) await win.happyDOM.close(); });

/**
 * One mounted walking screen with a session on it, and nothing loaded.
 *
 * `make({ state, log })` returns the services a case wants to control; everything else is an inert
 * stand-in. `screen` replaces what the screen hands the session (its composition, or a painter a case
 * wants to watch). `omit` removes names from the app or the screen, for the construction check.
 */
function world({ subject = {}, omit = [], screen: screenOver = {} } = {}, make = () => ({})) {
  const win = new Window();
  windows.push(win);
  const doc = win.document;
  const root = doc.createElement('div');
  root.innerHTML = MARKUP;
  // IN the document, as a mounted screen is: the session drops a live answer for a root that is no
  // longer connected, so a detached one would make every such answer look like a screen left behind.
  doc.body.appendChild(root);

  // The renderer, reduced to the calls a walk makes on it. Attributes are the element's own.
  const cube = doc.createElement('div');
  cube.calls = [];
  for (const name of ['step', 'stepBack', 'play', 'pause']) cube[name] = () => { cube.calls.push(name); };
  cube.seek = (i) => { cube.calls.push(`seek ${i}`); };
  cube.turnTo = async () => {};

  const log = [];
  const state = {
    cube: {
      facelets: turned('R'), trusted: false, isPhysical: false, source: 'generated', staleWhy: '',
      solution: '', moves: [], stepFacelets: [], setupAlg: '', solveResult: null, ...subject,
    },
    live: null,
    stageTarget: 'solved',
    connected: false,
    screen: 'home',
  };
  const screenAbort = new AbortController();
  const screen = {
    root, cube, scrambling: false, walking: true, unsolvable: false, label: 'Solution',
    stateHeading: () => 'Initial State', stale: () => false, signal: screenAbort.signal,
    paintNet: () => {}, paintAim: () => {}, syncReconnectAsk: () => {}, applyTempo: () => {},
    ...screenOver,
  };
  const app = {
    state,
    settings: { rungs: {}, rungProgress: {}, proveMinimum: false },
    SOLVED,
    CHIP_NODE_BUDGET: 1,
    WALK_FAILURES: { 'solver unavailable': 'no solver', 'no scramble': 'no scramble', 'cross-check': 'no check' },
    cubejs: () => Cube,
    solverReady: () => true,
    loadSolver: async () => true,
    randomScramble: async () => { throw new Error('this case rolls nothing'); },
    deriveCube: async () => { throw new Error('this case searches for nothing'); },
    classifyCube: () => ({ solvable: true, unsolvable: false }),
    adoptCube: (f) => { log.push(`adopt ${f}`); state.cube.facelets = f; },
    chainTrusted: () => state.cube.trusted && (state.cube.source === 'cube' || state.cube.source === 'camera'),
    markStale: () => {},
    lessonFor: () => null,
    stageAsk: async () => null,
    stepStates: (from, moves) => {
      const out = [from];
      const c = Cube.fromString(from);
      for (const m of moves) { c.move(m); out.push(c.asString()); }
      return out;
    },
    putInPlay: () => {},
    parkRoll: () => {},
    refreshScreen: () => { log.push('refreshScreen'); },
    go: () => {},
    save: () => true,
    raiseRung: () => true,
    escHtml: (s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`),
    icon: () => '',
    lastRoute: async () => null,
    sayWalkLength: ({ setStatus, total }) => { setStatus(String(total)); },
    describeCube: (el, c) => { el.setAttribute('aria-label', c.facelets); },
    ...make({ state, log }),
  };
  for (const name of omit) { delete app[name]; delete screen[name]; }

  const session = createWalkSession(screen, app);
  return {
    session,
    state,
    log,
    win,
    cube,
    /** Tear the screen down, as renderScreen does when it navigates away. */
    abortScreen: () => screenAbort.abort(),
    $: (sel) => root.querySelector(sel),
    chips: () => [...root.querySelectorAll('.chip-m')].map((chip) => chip.textContent),
  };
}

// The words are the picture's: beginWalk draws the new subject before any search, and a subject
// taken in place kept the old one's label (found by audit, 2026-09-13) — even when no walk follows.
test('a walk that cannot be built still describes the cube it is drawn over', async () => {
  const w = world();
  await w.session.load();
  assert.equal(w.cube.getAttribute('facelets'), w.state.cube.facelets, 'precondition: the subject was drawn');
  assert.equal(w.cube.getAttribute('aria-label'), w.state.cube.facelets, 'the renderer kept the words of another cube');
});

test('a service the app does not provide fails the mount, by name — not the rare press that would first call it', () => {
  // `raiseRung` is reached only by answering a rung offer, which arrives only at the end of a
  // followed lesson: a typo in WALK_APP would otherwise surface there and nowhere else.
  assert.throws(() => world({ omit: ['raiseRung'] }), { name: 'TypeError', message: /app does not provide "raiseRung"/ });
  assert.throws(() => world({ omit: ['applyTempo'] }), { name: 'TypeError', message: /screen does not provide "applyTempo"/ });
});

test('of two loads in flight, the one that started first and answers last writes nothing', async () => {
  // A reconnect answered while the die's solve is still running: two loads, the slower one last.
  // Committing inside the search and only THEN noticing it had been overtaken left the screen
  // showing one cube while every closure that reads the walk held the other.
  const searches = [];
  const w = world({}, () => ({
    deriveCube: (opts) => {
      const d = deferred();
      searches.push({ opts, d });
      return d.promise;
    },
  }));

  const first = w.session.load();
  await settle();
  w.state.cube.facelets = turned('U');
  const second = w.session.load();
  await settle();
  assert.equal(searches.length, 2, 'precondition: both loads reached the search');
  assert.equal(searches[0].opts.signal.aborted, true,
    'the superseded search was left to run to its budget on every worker, with the next one queued behind it');
  assert.equal(searches[1].opts.signal.aborted, false);

  solvedBy(w.state, "U'");
  searches[1].d.resolve();
  assert.equal(await second, true);
  assert.deepEqual(w.chips(), ["U'"]);

  // The older search's answer lands now, and it describes a cube that is no longer on screen.
  w.state.cube.facelets = turned('R');
  solvedBy(w.state, "R'");
  searches[0].d.resolve();
  assert.equal(await first, false, 'an overtaken load must report that it wrote nothing');
  assert.deepEqual(w.chips(), ["U'"], 'the older walk was painted over the newer one');
  assert.equal(w.$('#stepLbl').textContent, '0 / 1');
});

test('a stage repair that answers calls the whole-cube search off, and does not wait for it', async () => {
  let whole = null;
  const w = world({ subject: { facelets: turned('R U') } }, () => ({
    deriveCube: (opts) => { whole = opts; return new Promise(() => {}); }, // a search that never answers
    lastRoute: async () => ({ kind: 'exact', alg: "U'", moves: 1, minimal: true, overshoot: false }),
  }));
  w.state.stageTarget = 'cross';

  const loaded = await within(w.session.load());
  assert.equal(loaded, true, 'the repair was held at "working…" behind a whole-cube search it does not need');
  assert.ok(whole, 'precondition: the whole-cube search was started beside the repair');
  assert.equal(whole.signal.aborted, true, 'the whole-cube search was left holding a worker for nobody');
  assert.deepEqual(w.chips(), ["U'"]);
});

test('turns the cube reported since its last snapshot are adopted before the next search asks about it', async () => {
  // Scan R, turn U, choose a target: the follow model knows about the U and the subject does not
  // until a snapshot arrives. Asked about the subject, the app offered R' for a cube that is R U.
  const R = turned('R');
  let searches = 0;
  const w = world({ subject: { facelets: R, trusted: true, isPhysical: true, source: 'cube' } }, ({ state, log }) => ({
    deriveCube: async () => {
      log.push(`search ${state.cube.facelets}`);
      searches += 1;
      solvedBy(state, searches === 1 ? "R'" : "U' R'");
    },
  }));
  w.state.live = R;

  assert.equal(await w.session.load(), true);
  assert.equal(w.session.following(), true, 'precondition: the walk starts where the cube is, so the cube leads');

  w.session.liveMove({ notation: 'U', serial: 1 });
  const RU = turned('U', R);
  assert.notEqual(w.state.cube.facelets, RU, 'precondition: no snapshot has told the subject yet');

  assert.equal(await w.session.load(), true);
  assert.deepEqual(w.log.slice(-2), [`adopt ${RU}`, `search ${RU}`],
    'the search was asked about the cube as it was before the turn');
  assert.equal(w.state.live, RU,
    'and `live` moves with it, or follow compares the fresh walk to an old snapshot and refuses for the whole visit');
});

test('a cube that no longer has a walk rebuilds the screen — after the load, not inside it', async () => {
  // Turning R' after a scanned R leaves a solved cube. Searching it reached the child as "could not
  // work it out" about a finished cube; rebuilding inside the load was swallowed by refreshScreen's
  // own re-entry guard, so nothing happened at all.
  let searched = false;
  const w = world({}, () => ({
    classifyCube: () => ({ solvable: false, unsolvable: false }),
    deriveCube: async () => { searched = true; },
  }));

  const loading = w.session.load();
  assert.deepEqual(w.log, [], 'the rebuild ran inside the load, where refreshScreen\'s guard swallows it');
  assert.equal(await loading, false);
  assert.deepEqual(w.log, ['refreshScreen']);
  assert.equal(searched, false, 'a cube with no walk was searched for one');
  assert.equal(w.$('#moveCount').textContent, '—', 'the screen was reset for a walk that cannot exist');
});

test('the screen\'s teardown calls off the search in flight', async () => {
  let opts = null;
  const w = world({}, () => ({ deriveCube: (o) => { opts = o; return new Promise(() => {}); } }));
  void w.session.load();
  await settle();
  assert.ok(opts, 'precondition: a search is in flight');
  w.session.dispose();
  assert.equal(opts.signal.aborted, true, 'leaving the screen left its search burning the pool');
});

// ---- step 0 of breaking this module up ----------------------------------------------------------------
//
// The next change splits the session into units: the follow tracker, the presenter, the rung offer,
// the live distance and the resolver. Each case below pins an ordering the session keeps today that
// stage-wiring.test.mjs could check only as the position of a line in the source, or that nothing
// checked at all, so the split is held to what the screen does rather than to where its lines were.
// Each fails when the line it guards is removed — checked by removing it.

test('the moment a load starts, the old walk is gone and its prove button disarmed — before any search answers', async () => {
  let searches = 0;
  const second = deferred();
  const w = world({}, ({ state }) => ({
    deriveCube: async () => {
      searches += 1;
      if (searches === 2) await second.promise;
      solvedBy(state, "R'");
    },
  }));
  assert.equal(await w.session.load(), true);
  assert.deepEqual(w.chips(), ["R'"], 'precondition: a walk is on screen');
  // What the previous walk left armed: its prove button, and a heading about its target.
  const prove = w.$('#proveBtn');
  prove.hidden = false;
  prove.disabled = false;
  prove.onclick = () => {};
  w.$('.state-h').textContent = 'Aiming at the cross';

  const loading = w.session.load();
  await settle();
  assert.equal(searches, 2, 'precondition: the second search is in flight');
  assert.deepEqual(w.chips(), [], 'the old walk\'s moves stood under the new subject while it was searched');
  assert.equal(w.$('#moveCount').textContent, 'working…');
  assert.equal(prove.hidden, true, 'the previous walk\'s prove button stayed on screen through the search');
  assert.equal(prove.disabled, true, 'and it could still be pressed');
  assert.equal(prove.onclick, null, 'and a press would still have started a proof of the previous walk');
  assert.equal(w.$('.state-h').textContent, 'Initial State',
    'the heading waited for the search instead of describing the new subject at once');
  second.resolve();
  assert.equal(await loading, true);
});

test('a load adopts the turned cube before it paints anything for it', async () => {
  const R = turned('R');
  const RU = turned('U', R);
  const events = [];
  const w = world({
    subject: { facelets: R, trusted: true, isPhysical: true, source: 'cube' },
    screen: { paintNet: (f) => { events.push(`net ${f}`); } },
  }, ({ state }) => ({
    adoptCube: (f) => { events.push(`adopt ${f}`); state.cube.facelets = f; },
    deriveCube: async () => { solvedBy(state, state.cube.facelets === R ? "R'" : "U' R'"); },
  }));
  w.state.live = R;
  assert.equal(await w.session.load(), true);
  assert.equal(w.session.following(), true, 'precondition: the cube leads, so its turns are tracked');
  w.session.liveMove({ notation: 'U', serial: 1 });

  events.length = 0;
  assert.equal(await w.session.load(), true);
  assert.deepEqual(events.slice(0, 2), [`adopt ${RU}`, `net ${RU}`],
    'the net was painted before the turned cube was adopted');
});

test('a turn reported while a walk is being searched for survives into the next load', async () => {
  const R = turned('R');
  const RU = turned('U', R);
  const searched = [];
  let hold = null;
  const w = world({ subject: { facelets: R, trusted: true, isPhysical: true, source: 'cube' } }, ({ state }) => ({
    deriveCube: async () => {
      searched.push(state.cube.facelets);
      const wait = hold;
      if (wait) await wait.promise;
      solvedBy(state, state.cube.facelets === R ? "R'" : "U' R'");
    },
  }));
  w.state.live = R;
  assert.equal(await w.session.load(), true);
  assert.equal(w.session.following(), true, 'precondition: the cube leads, so the model is seeded');

  hold = deferred();
  const second = w.session.load();
  await settle();
  w.session.liveMove({ notation: 'U', serial: 1 }); // turned while the reply is in flight
  const release = hold;
  hold = null;
  release.resolve();
  assert.equal(await second, true);

  assert.equal(await w.session.load(), true);
  assert.equal(searched.at(-1), RU, 'the turn made during the search was thrown away by the walk reset');
});

test('a stage walk the cube follows shows its live distance at once, asked about the cube in hand', async () => {
  const R = turned('R');
  const asked = [];
  const w = world({ subject: { facelets: R, trusted: true, isPhysical: true, source: 'cube' } }, () => ({
    deriveCube: () => new Promise(() => {}),
    lastRoute: async () => ({ kind: 'exact', alg: "R'", moves: 1, minimal: true, overshoot: false }),
    stageAsk: async (q) => { asked.push(q); return q.want === 'bounds' ? { bounds: { cross: 1 } } : { moves: 1 }; },
  }));
  w.state.stageTarget = 'cross';
  w.state.live = R;
  assert.equal(await within(w.session.load()), true);
  assert.equal(w.session.following(), true, 'precondition: the walk starts where the cube is');
  for (let i = 0; i < 5; i += 1) await settle();
  assert.ok(asked.length > 0, 'a fresh mount asked nothing — the number was requested before the model existed');
  assert.deepEqual([...new Set(asked.map((q) => q.facelets))], [R],
    'the live distance was asked about a cube other than the one in hand');
  assert.match(w.$('#stageLive').textContent, /your cube now/);
});

test('following is judged again for every walk: refused on one, allowed on the next, refused again', async () => {
  const R = turned('R');
  const w = world({ subject: { facelets: R, trusted: true, isPhysical: true, source: 'cube' } }, ({ state }) => ({
    deriveCube: async () => { solvedBy(state, "R'"); },
  }));
  const follow = w.$('[data-mode="cube"]');

  w.state.live = turned('U'); // the cube reports another arrangement: this walk does not start at it
  assert.equal(await w.session.load(), true);
  assert.equal(follow.disabled, true, 'precondition: a walk that does not start where the cube is may not be followed');
  assert.equal(w.session.following(), false);

  w.state.live = R;
  assert.equal(await w.session.load(), true);
  assert.equal(follow.disabled, false, 'a refusal from the previous walk outlived it');
  assert.equal(w.session.following(), true);

  w.state.cube.trusted = false;
  w.state.cube.staleWhy = 'it disconnected';
  assert.equal(await w.session.load(), true);
  assert.equal(follow.disabled, true);
  assert.equal(w.session.following(), false, 'the previous walk\'s following carried into one that may not follow');
  assert.match(follow.title, /Read the cube first — it disconnected/);
});

test('a roll overtaken by a newer one is parked for later, and only the newer one is put in play', async () => {
  const rolls = [];
  const played = [];
  const parked = [];
  const w = world({ screen: { scrambling: true } }, () => ({
    randomScramble: () => { const d = deferred(); rolls.push(d); return d.promise; },
    putInPlay: (r) => { played.push(r); },
    parkRoll: (r) => { parked.push(r); },
  }));
  const first = w.session.load();
  await settle();
  const second = w.session.load();
  await settle();
  assert.equal(rolls.length, 2, 'precondition: both loads are rolling');

  const older = { facelets: turned('R U'), alg: 'R U' };
  const newer = { facelets: turned('F'), alg: 'F' };
  rolls[1].resolve(newer);
  assert.equal(await second, true);
  rolls[0].resolve(older);
  assert.equal(await first, false);
  assert.deepEqual(played, [newer], 'the overtaken roll was put in play');
  assert.deepEqual(parked, [older], 'a roll nobody showed was thrown away instead of kept for the next press');
});

test('once the screen is torn down, a step event from the parked renderer moves nothing', async () => {
  const w = world({}, ({ state }) => ({ deriveCube: async () => { solvedBy(state, "R'"); } }));
  assert.equal(await w.session.load(), true);
  const step = (index) => w.cube.dispatchEvent(new w.win.CustomEvent('cubus-step', { detail: { index } }));
  step(1);
  assert.equal(w.$('#stepLbl').textContent, '1 / 1', 'precondition: the renderer drives the transport');
  w.abortScreen();
  step(0);
  assert.equal(w.$('#stepLbl').textContent, '1 / 1',
    'the parked renderer, at the next screen, still drove this screen\'s transport');
});

test('leaving while a repair is still being worked out leaves no unhandled rejection behind', async () => {
  const unhandled = [];
  const onUnhandled = (reason) => { unhandled.push(String(reason)); };
  process.on('unhandledRejection', onUnhandled);
  try {
    // Both searches end as the real ones do when called off: they reject.
    const rejectOnAbort = (signal, why) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error(why)), { once: true });
    });
    const w = world({ subject: { facelets: turned('U') } }, () => ({
      deriveCube: (opts) => rejectOnAbort(opts.signal, 'solve: superseded'),
      lastRoute: (_target, _from, signal) => rejectOnAbort(signal, 'route: superseded'),
    }));
    w.state.stageTarget = 'cross';
    const loading = w.session.load();
    await settle();
    w.session.dispose(); // chose the cross and left at once
    assert.equal(await loading, false, 'precondition: the load was called off');
    for (let i = 0; i < 5; i += 1) await settle();
    assert.deepEqual(unhandled, [], 'the abandoned whole-cube search rejected with nobody listening');
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('a cube the method cannot teach falls back to its solution, and the switch stays there for the next load', async () => {
  let lessonAsks = 0;
  const w = world({}, ({ state }) => ({
    deriveCube: async () => { solvedBy(state, "R'"); },
    lessonFor: () => { lessonAsks += 1; return null; },
  }));
  assert.equal(await w.session.load(), true);
  const lessonPill = w.$('[data-walk="lesson"]');
  const solutionPill = w.$('[data-walk="solution"]');
  lessonPill.click();
  for (let i = 0; i < 3; i += 1) await settle();
  assert.equal(lessonAsks, 1, 'precondition: the lesson was asked for');
  assert.equal(solutionPill.getAttribute('aria-pressed'), 'true', 'the switch still said Lesson over a Solution');
  assert.equal(lessonPill.getAttribute('aria-pressed'), 'false');

  assert.equal(await w.session.load(), true);
  assert.equal(lessonAsks, 1, 'the next load asked again for a lesson the switch says is not showing');
});

// ---- step 0 of the resolver: the search leaving loadWalk -------------------------------------------------
//
// stage-wiring.test.mjs checks the order of the whole-cube search and the repair as positions inside
// loadWalk, which the resolver's extraction moves out of it. These pin what that order is FOR, so the
// extraction is held to the screen's behaviour rather than to where the lines stood.

test('a whole-cube search that fails does not take a repair that answered with it', async () => {
  const w = world({ subject: { facelets: turned('R U') } }, () => ({
    deriveCube: async () => { throw new Error('solver unavailable'); },
    // The repair answers only AFTER the whole-cube search has failed: the order an audit reproduced.
    lastRoute: async (_target, _from, _signal, wholeDone) => {
      await wholeDone;
      return { kind: 'exact', alg: "U'", moves: 1, minimal: true, overshoot: false };
    },
  }));
  w.state.stageTarget = 'cross';
  assert.equal(await within(w.session.load()), true, 'a whole-cube failure took the repair that answered down with it');
  assert.deepEqual(w.chips(), ["U'"], "the repair's moves are not the walk on screen");
  assert.notEqual(w.$('#moveCount').textContent, 'no solver', 'the failure of a search nobody needed was shown over the repair');
});

test('with nothing to fall back on, a search that fails is what the screen says', async () => {
  const whole = world({}, () => ({ deriveCube: async () => { throw new Error('solver unavailable'); } }));
  assert.equal(await within(whole.session.load()), false, 'a whole-cube search that failed was committed as a walk');
  assert.equal(whole.$('#moveCount').textContent, 'no solver', 'a whole-cube walk whose search failed said nothing about it');
  assert.deepEqual(whole.chips(), [], 'a failed search left moves on screen');

  // A repair that found nothing leaves the whole-cube answer as the walk — and its failure as the screen's.
  const stage = world({ subject: { facelets: turned('R U') } }, () => ({
    deriveCube: async () => { throw new Error('solver unavailable'); },
    lastRoute: async () => ({ kind: 'none', alg: null, moves: null, minimal: false, overshoot: false }),
  }));
  stage.state.stageTarget = 'cross';
  assert.equal(await within(stage.session.load()), false,
    'a repair that found nothing, over a whole-cube search that failed, was committed as a walk');
  assert.equal(stage.$('#moveCount').textContent, 'no solver',
    'a repair that found nothing, over a whole-cube search that failed, said nothing about the failure');
});

test('once a repair is on screen, the abandoned whole-cube search no longer writes the count', async () => {
  let reports = null;
  const w = world({ subject: { facelets: turned('R U') } }, () => ({
    deriveCube: (opts) => { reports = opts; return new Promise(() => {}); },
    lastRoute: async () => ({ kind: 'exact', alg: "U'", moves: 1, minimal: true, overshoot: false }),
  }));
  w.state.stageTarget = 'cross';
  assert.equal(await within(w.session.load()), true, 'precondition: the repair was committed');
  const count = w.$('#moveCount').textContent;
  assert.ok(reports, 'precondition: the whole-cube search was given its two ways to report');
  reports.onImprovement({ moves: 7 });
  assert.equal(w.$('#moveCount').textContent, count, "the abandoned search wrote its move count over the repair's");
  reports.onProgress({ attempt: 2 });
  assert.equal(w.$('#moveCount').textContent, count, "the abandoned search wrote its progress over the repair's count");
});

// ---- the resolver's exits: the solver, a failed repair, a snapshot, a short replay, the pills ---

test('a solver that cannot be loaded is said on both sides, before anything is searched or rolled', async () => {
  for (const scrambling of [false, true]) {
    let asked = 0;
    const w = world({ screen: { scrambling } }, () => ({
      solverReady: () => false,
      loadSolver: async () => false,
      deriveCube: async () => { asked += 1; },
      randomScramble: async () => { asked += 1; return { facelets: turned('F'), alg: 'F' }; },
    }));
    const side = scrambling ? 'Scramble' : 'Solve';
    assert.equal(await within(w.session.load()), false, `${side}: a walk was committed with no solver`);
    assert.equal(w.$('#moveCount').textContent, 'no solver', `${side}: the missing solver was not what the screen said`);
    assert.equal(asked, 0, `${side}: a search ran on a solver that never loaded`);
  }
});

test('a repair that fails calls the whole-cube search off, and that search writes nothing over the failure', async () => {
  let whole = null;
  const w = world({ subject: { facelets: turned('R U') } }, () => ({
    deriveCube: (opts) => { whole = opts; return new Promise(() => {}); }, // still searching
    lastRoute: async () => { throw new Error('route: the worker was lost'); },
  }));
  w.state.stageTarget = 'cross';
  assert.equal(await within(w.session.load()), false, 'precondition: a repair that threw is not a walk');
  assert.equal(w.$('#moveCount').textContent, 'could not work it out', 'precondition: the failure is on screen');
  assert.ok(whole, 'precondition: the whole-cube search was started beside the repair');
  whole.onImprovement({ moves: 7 });
  whole.onProgress({ attempt: 2 });
  assert.equal(w.$('#moveCount').textContent, 'could not work it out',
    'a search nobody is waiting for wrote its count over the failure');
  assert.equal(whole.signal.aborted, true, 'the whole-cube search was left holding a worker for a load that had failed');
});

test('a load overtaken while the solver loads never hands its whole-cube search a live signal', async () => {
  const loaded = deferred();
  const searches = [];
  const w = world({}, () => ({
    solverReady: () => false,
    loadSolver: () => loaded.promise,
    deriveCube: (opts) => { searches.push(opts); return new Promise(() => {}); },
    // A repair holds the load open behind the whole-cube search, as the pool source does by
    // awaiting it — so nothing else is left to call that search off.
    lastRoute: (_target, _from, _signal, wholeDone) => wholeDone.then(() => null),
  }));
  w.state.stageTarget = 'cross';
  void w.session.load();
  await settle();
  void w.session.load(); // a second press, before the solver has loaded
  await settle();
  loaded.resolve(true);
  for (let i = 0; i < 3; i += 1) await settle();
  assert.ok(searches.length > 0, 'precondition: the current load reached the search');
  assert.equal(searches.at(-1).signal.aborted, false, 'precondition: the current load searches');
  assert.deepEqual(searches.slice(0, -1).map((s) => s.signal.aborted), searches.slice(0, -1).map(() => true),
    'the overtaken load searched on a live signal: its abort had fired before the search was chained to it');
});

test('a snapshot that lands while a repair is still racing does not empty the whole-cube walk', async () => {
  const RU = turned('R U');
  const route = deferred();
  const w = world({ subject: { facelets: RU } }, ({ state }) => ({
    deriveCube: async () => { solvedBy(state, "U' R'"); },
    lastRoute: () => route.promise,
  }));
  w.state.stageTarget = 'cross';
  const loading = w.session.load();
  await settle(); // the whole-cube answer has landed; the repair is still out
  // What a physical cube's snapshot does to the subject (ingestFacelets): a new arrangement and no
  // derived walk. It is not a new question, so the load's generation does not move.
  Object.assign(w.state.cube, { facelets: turned('R U F'), solution: '', moves: [], stepFacelets: [], setupAlg: '' });
  route.resolve({ kind: 'none', alg: null, moves: null, minimal: false, overshoot: false });
  assert.equal(await within(loading), true, 'precondition: with no repair, the whole-cube answer is the walk');
  assert.deepEqual(w.chips(), ["U'", "R'"],
    'the whole-cube walk was read off the subject after a snapshot had emptied it');
  assert.equal(w.cube.getAttribute('facelets'), RU, 'and the walk is drawn from the cube it was worked out for');
});

test('a replay that comes up short is refused on both sides, not walked to wherever it stopped', async () => {
  for (const [what, replay] of [['an empty replay', () => []], ['a replay that stops at its start', (from) => [from]]]) {
    const stage = world({ subject: { facelets: turned('R U') } }, () => ({
      deriveCube: () => new Promise(() => {}),
      lastRoute: async () => ({ kind: 'exact', alg: "U'", moves: 1, minimal: true, overshoot: false }),
      stepStates: replay,
    }));
    stage.state.stageTarget = 'cross';
    assert.equal(await within(stage.session.load()), false, `a stage route with ${what} was committed as a walk`);
    assert.deepEqual(stage.chips(), [], `a stage route with ${what} left moves on screen`);
    assert.equal(stage.$('#moveCount').textContent, 'could not work it out', `a stage route with ${what} said nothing`);

    const scramble = world({ screen: { scrambling: true } }, () => ({
      randomScramble: async () => ({ facelets: turned('F'), alg: 'F' }),
      stepStates: replay,
    }));
    assert.equal(await within(scramble.session.load()), false, `a scramble with ${what} was committed as a walk`);
    assert.equal(scramble.$('#moveCount').textContent, 'no scramble', `a scramble with ${what} was not a failed roll`);
  }
});

test('a pill already on does nothing, and a new target replaces the walk in place, said in both channels', async () => {
  let searches = 0;
  const w = world({ subject: { facelets: turned('R U') } }, ({ state }) => ({
    deriveCube: async () => { searches += 1; solvedBy(state, "U' R'"); },
    lastRoute: async () => ({ kind: 'exact', alg: "U'", moves: 1, minimal: true, overshoot: false }),
  }));
  assert.equal(await w.session.load(), true);
  const said = (key) => [...w.win.document.querySelectorAll(`[data-${key}]`)]
    .map((p) => `${p.dataset[key]} ${p.getAttribute('aria-pressed')} ${p.classList.contains('on')}`);
  const loads = searches;

  w.$('[data-stage="solved"]').click();
  w.$('[data-walk="solution"]').click();
  await settle();
  assert.equal(searches, loads, 'pressing the pill already on searched again, throwing away the transport position');

  w.$('[data-stage="cross"]').click();
  for (let i = 0; i < 3; i += 1) await settle();
  assert.equal(w.state.stageTarget, 'cross');
  assert.deepEqual(w.chips(), ["U'"], 'the new target did not replace the walk');
  assert.deepEqual(said('stage'), ['solved false false', 'cross true true'], 'the pills disagree about which target is on');
  assert.deepEqual(w.log, [], 'a new target rebuilt the screen instead of replacing the walk');
});

// ---- step 0 of the follow tracker: turns that are ahead of a snapshot ------------------------------------
//
// stage-wiring.test.mjs and stage-smartcube.test.mjs check these as lines inside the four live hooks and
// inside loadWalk's adoption, which the follow tracker's extraction moves. Each case pins what one of
// those lines is FOR: when the model's turns stop being turns anybody can vouch for, and what a lost turn
// or lapsed trust takes off the screen.

/** A trusted cube at `R` that the walk follows, turned `U` since its last snapshot. */
async function turnedAhead(extra = {}) {
  const R = turned('R');
  const w = world({ subject: { facelets: R, trusted: true, isPhysical: true, source: 'cube' } }, ({ state }) => ({
    deriveCube: async () => { solvedBy(state, state.cube.facelets === R ? "R'" : "U' R'"); },
    ...extra,
  }));
  w.state.live = R;
  assert.equal(await w.session.load(), true);
  assert.equal(w.session.following(), true, 'precondition: the cube leads, so its turns are tracked');
  w.session.liveMove({ notation: 'U', serial: 1 });
  return { w, R, RU: turned('U', R) };
}

test('a snapshot ends the model being ahead: a subject changed after it is not overwritten by old turns', async () => {
  const { w, RU } = await turnedAhead();
  w.session.liveUpdate(RU, 2); // the cube's own report catches the subject up
  // And then the subject changes for another reason — a reconnect answered, say — to a cube the model
  // never saw. The model's turns were confirmed by that snapshot; they are not news about this cube.
  const F = turned('F');
  w.state.cube.facelets = F;
  w.state.live = F;
  w.log.length = 0;
  await w.session.load();
  assert.ok(!w.log.some((entry) => entry.startsWith('adopt ')),
    'a snapshot left the model claiming to be ahead of it, and its turns were adopted over a newer subject');
});

test('trust lapsing ends the model being ahead: a cube confirmed afterwards keeps its confirmed arrangement', async () => {
  const { w, R, RU } = await turnedAhead();
  // Disconnect, reconnect, confirm R: trust lapses, then is granted again for the arrangement the user confirmed.
  w.state.cube.trusted = false;
  w.session.onTrustLost();
  w.state.cube.trusted = true;
  w.state.cube.facelets = R;
  w.state.live = R;
  w.log.length = 0;
  await w.session.load();
  assert.ok(!w.log.includes(`adopt ${RU}`),
    'the model from before trust lapsed overwrote the arrangement the user confirmed, and was trusted');
});

test('a lost turn ends the model being ahead: its turns are not adopted as the cube in hand', async () => {
  const { w, RU } = await turnedAhead();
  w.session.liveGap();
  w.log.length = 0;
  await w.session.load();
  assert.ok(!w.log.includes(`adopt ${RU}`),
    'after a turn went unrecorded, a model nobody can vouch for was adopted as the subject');
});

test('a lost turn, and trust lapsing, each take the live number off the screen', async () => {
  for (const [what, hook] of [['a lost turn', 'liveGap'], ['trust lapsing', 'onTrustLost']]) {
    const R = turned('R');
    const w = world({ subject: { facelets: R, trusted: true, isPhysical: true, source: 'cube' } }, () => ({
      deriveCube: () => new Promise(() => {}),
      lastRoute: async () => ({ kind: 'exact', alg: "R'", moves: 1, minimal: true, overshoot: false }),
      stageAsk: async (q) => (q.want === 'bounds' ? { bounds: { cross: 1 } } : { moves: 1 }),
    }));
    w.state.stageTarget = 'cross';
    w.state.live = R;
    assert.equal(await within(w.session.load()), true);
    for (let i = 0; i < 5; i += 1) await settle();
    assert.match(w.$('#stageLive').textContent, /your cube now/, `${what}: precondition: a live number is showing`);
    w.session[hook]();
    assert.equal(w.$('#stageLive').textContent, '', `${what} left the live number standing over a cube it no longer describes`);
  }
});

// ---- a stand-down that throws, and one loss heard by both hooks --------------------------------
//
// Standing following down turns the renderer, and a renderer can throw. markStale says so and
// carries on, and whatever the hook had left to do after the throw never happens: the model and
// the number made from it are what must not be left behind.

test('a stand-down that throws still forgets the model and calls off the number made from it', async () => {
  for (const hook of ['onTrustLost', 'liveGap']) {
    const R = turned('R');
    const RU = turned('U', R);
    const routes = [];
    const w = world({ subject: { facelets: R, trusted: true, isPhysical: true, source: 'cube' } }, () => ({
      deriveCube: () => new Promise(() => {}),
      lastRoute: async () => ({ kind: 'exact', alg: "R'", moves: 1, minimal: true, overshoot: false }),
      stageAsk: (q) => {
        if (q.want === 'bounds') return Promise.resolve({ bounds: { cross: 1 } });
        routes.push(q);
        // Answered as a search called off is: once it is called off, and not before.
        return new Promise((resolve) => {
          q.signal.addEventListener('abort', () => resolve({ alg: null, moves: null, exact: false, why: 'stopped' }), { once: true });
        });
      },
    }));
    w.state.stageTarget = 'cross';
    w.state.live = R;
    assert.equal(await within(w.session.load()), true);
    assert.equal(w.session.following(), true, `${hook}: precondition: the cube leads, so standing down turns the drawing`);
    w.session.liveMove({ notation: 'U', serial: 1 }); // the model is now ahead of the last snapshot
    for (let i = 0; i < 5; i += 1) await settle();
    const out = routes.at(-1);
    assert.equal(out?.signal.aborted, false, `${hook}: precondition: the live distance has an exact search out`);
    assert.match(w.$('#stageLive').textContent, /your cube now/, `${hook}: precondition: a live number is showing`);

    const seek = w.cube.seek;
    w.cube.seek = () => { throw new Error('the renderer is gone (test)'); };
    if (hook === 'onTrustLost') Object.assign(w.state.cube, { trusted: false, staleWhy: 'it disconnected' });
    assert.throws(() => w.session[hook](), /the renderer is gone/, `${hook}: precondition: standing down threw`);
    w.cube.seek = seek;
    assert.equal(out.signal.aborted, true, `${hook}: a throw while standing down left the search about the old cube running`);
    assert.equal(w.$('#stageLive').textContent, '', `${hook}: a throw while standing down left the live number standing`);

    // And the model went with them: a cube confirmed next is not overwritten by its turns.
    const F = turned('F');
    Object.assign(w.state.cube, { trusted: true, staleWhy: '', facelets: F });
    w.state.live = F;
    w.log.length = 0;
    await within(w.session.load());
    assert.deepEqual(w.log.filter((entry) => entry === `adopt ${RU}`), [],
      `${hook}: a throw while standing down kept the model, and its turns were adopted over the confirmed cube`);
  }
});

// Through the session a second invalidation cannot be seen — it clears a line already clear — so
// this drives lib/walk-follow.js directly and counts what it asks of the live distance.

/** A follow tracker on its own, leading a trusted cube at `R` along `R'`, with every drop of the
 *  live number counted. */
function followRig() {
  const win = new Window();
  windows.push(win);
  const root = win.document.createElement('div');
  root.innerHTML = MARKUP;
  win.document.body.appendChild(root);
  const R = turned('R');
  const state = { cube: { facelets: R, trusted: true, isPhysical: true, source: 'cube', staleWhy: '' }, live: R };
  const drops = { count: 0 };
  const walk = { moves: ["R'"], steps: [R, SOLVED] };
  const follow = createFollowTracker({
    root, cube: { seek: () => {}, step: () => {}, stepBack: () => {} }, state, cubejs: () => Cube,
    applyTempo: () => {}, setPlaying: () => {}, moveHoldAt: () => SCAN_HOLD, markStale: () => {},
    adoptCube: () => {}, go: () => {}, scrambling: false,
    refreshLiveDistance: async () => {}, dropLiveDistance: () => { drops.count += 1; },
    chainTrusted: () => state.cube.trusted && state.cube.source === 'cube',
    walkNow: () => walk,
  });
  follow.rebase(walk);
  return { follow, state, drops };
}

test('a lost turn forgets the model once, whichever of its two hooks hears of it first', () => {
  // Trust lapsing and the gap are two hooks for one loss, and each must also be whole alone — so
  // neither may count on the other having run, and neither may do the other's work again.
  for (const heard of [['onTrustLost'], ['liveGap'], ['onTrustLost', 'liveGap'], ['liveGap', 'onTrustLost']]) {
    const { follow, state, drops } = followRig();
    const what = heard.join(' then ');
    assert.ok(follow.model(), `${what}: precondition: a trusted cube has a model`);
    assert.equal(follow.following(), true, `${what}: precondition: the cube leads`);
    Object.assign(state.cube, { trusted: false, staleWhy: 'a turn went unrecorded' });
    for (const hook of heard) follow[hook]();
    assert.equal(follow.model(), null, `${what}: the model outlived the loss`);
    assert.equal(drops.count, 1, `${what}: one loss invalidated the live number ${drops.count} times`);
  }
});

// A walk may pass through one arrangement twice, two moves apart: a step that ends on `R` and a
// step that begins with `R'` are not merged, because each step is a unit the learner is taught.
// Measured 2026-09-15 over 150 scrambles × every rung combination: 1,661 of 3,600 method walks
// revisit a state within two moves. At such a point the cube in hand matches the step behind AND
// the step ahead, and the move that got it there is literally the walk's next move — so reading it
// as an undo drew a turn backwards that nobody made, and the walk only caught up on a later jump.
test('a turn that cancels the one before it is the walk\'s next move, not an undo', () => {
  const win = new Window();
  windows.push(win);
  const root = win.document.createElement('div');
  root.innerHTML = MARKUP;
  win.document.body.appendChild(root);
  const R = turned('R');
  const state = { cube: { facelets: SOLVED, trusted: true, isPhysical: true, source: 'cube', staleWhy: '' }, live: SOLVED };
  const calls = [];
  const walk = { moves: ['R', "R'"], steps: [SOLVED, R, SOLVED] };
  const follow = createFollowTracker({
    root,
    cube: { seek: () => {}, step: () => calls.push('step'), stepBack: () => calls.push('stepBack') },
    state, cubejs: () => Cube,
    applyTempo: () => {}, setPlaying: () => {}, moveHoldAt: () => SCAN_HOLD, markStale: () => {},
    adoptCube: () => {}, go: () => {}, scrambling: false,
    refreshLiveDistance: async () => {}, dropLiveDistance: () => {},
    chainTrusted: () => state.cube.trusted && state.cube.source === 'cube',
    walkNow: () => walk,
  });
  follow.rebase(walk);
  assert.equal(follow.following(), true, 'precondition: the walk starts where the cube is, so the cube leads');
  follow.liveMove({ notation: 'R', serial: 1 });
  follow.liveMove({ notation: "R'", serial: 2 });
  assert.deepEqual(calls, ['step', 'step'],
    'the second turn is the walk\'s own next move; drawing it as an undo sends the walk backwards');
});

test('leaving the screen calls off the live distance\'s exact search too', async () => {
  const R = turned('R');
  const routes = [];
  const subject = { facelets: R, trusted: true, isPhysical: true, source: 'cube' };
  const w = world({ subject }, () => ({
    deriveCube: () => new Promise(() => {}),
    lastRoute: async () => ({
      kind: 'exact', alg: "R'", moves: 1, minimal: true, overshoot: false,
    }),
    // The bound answers at once; the exact search stays out, the way a deep one does.
    stageAsk: (q) => {
      if (q.want === 'bounds') return Promise.resolve({ bounds: { cross: 1 } });
      routes.push(q);
      return new Promise(() => {});
    },
  }));
  w.state.stageTarget = 'cross';
  w.state.live = R;
  assert.equal(await within(w.session.load()), true);
  for (let i = 0; i < 5; i += 1) await settle();
  assert.ok(routes.length > 0, 'precondition: the live distance has its exact search out');
  const out = routes.at(-1);
  assert.equal(out.signal?.aborted, false,
    'the live distance asked its exact search with no way to call it off');
  w.abortScreen();
  assert.equal(out.signal.aborted, true,
    'the screen went and the search about its cube was left running');
});

// ---- step 0 of the presenter: the transport as the learner sees it -----------------------------------------
//
// The chips' marks, a chip press, and taking over from a cube that leads are pinned through the whole app
// in router-wiring.test.mjs. These pin the three transport behaviours nothing checked, before the presenter
// that owns them leaves the session.

test('repeat at the first move does nothing — even if the button is pressable', async () => {
  const w = world({}, ({ state }) => ({ deriveCube: async () => { solvedBy(state, "R' U'"); } }));
  assert.equal(await w.session.load(), true);
  const turns = () => w.cube.calls.filter((c) => c === 'step' || c === 'stepBack');
  // The guard is not the disabled attribute's backup: stepBack() refuses at the start and step() does not,
  // so a repeat that reached the renderer at 0 would move the cube FORWARD one move.
  w.$('#repeatBtn').disabled = false;
  w.cube.calls.length = 0;
  w.$('#repeatBtn').click();
  assert.deepEqual(turns(), [], 'a repeat at the start stepped the cube');

  // After a move, a repeat undoes it and makes it again.
  w.cube.dispatchEvent(new w.win.CustomEvent('cubus-step', { detail: { index: 1 } }));
  w.cube.calls.length = 0;
  w.$('#repeatBtn').click();
  assert.deepEqual(turns(), ['stepBack', 'step'], 'a repeat did not show the last move again');
});

test('the play button is named for what pressing it will do', async () => {
  const w = world({}, ({ state }) => ({ deriveCube: async () => { solvedBy(state, "R' U'"); } }));
  assert.equal(await w.session.load(), true);
  const play = w.$('#playBtn');
  assert.equal(play.getAttribute('aria-label'), 'Play from here to the end');
  play.click();
  assert.ok(w.cube.calls.includes('play'), 'precondition: the walk is playing');
  assert.equal(play.getAttribute('aria-label'), 'Pause', 'a playing walk offered to play');
  play.click();
  assert.equal(play.getAttribute('aria-label'), 'Play from here to the end', 'a paused walk offered to pause');
});

test('at each end, the buttons that cannot act are disabled, and the done mark shows only at the end', async () => {
  const w = world({}, ({ state }) => ({ deriveCube: async () => { solvedBy(state, "R' U'"); } }));
  assert.equal(await w.session.load(), true);
  const step = (index) => w.cube.dispatchEvent(new w.win.CustomEvent('cubus-step', { detail: { index } }));
  const disabled = (id) => w.$(`#${id}`).disabled;

  assert.equal(disabled('prevBtn'), true, 'Back was pressable before any move');
  assert.equal(disabled('repeatBtn'), true, 'Repeat was pressable before any move');
  assert.equal(disabled('nextBtn'), false);
  assert.equal(disabled('playBtn'), false);
  assert.equal(w.$('#doneMark').hidden, true, 'the walk was marked done before it started');

  step(2);
  assert.equal(disabled('nextBtn'), true, 'Next stayed pressable at the end');
  assert.equal(disabled('playBtn'), true, 'Play stayed pressable at the end');
  assert.equal(disabled('prevBtn'), false);
  assert.equal(w.$('#doneMark').hidden, false, 'the last move landed and the walk was not marked done');
  assert.equal(w.$('#progBar').style.width, '100%');

  step(1);
  assert.equal(w.$('#doneMark').hidden, true, 'a step back from the end left the walk marked done');
  assert.equal(w.$('#progBar').style.width, '50%');
});

// Through the session a second take-over cannot be seen — the first has already stood the cube
// down — so this drives lib/walk-presenter.js directly and counts its calls to the follow tracker.

/** A walk presenter on its own over two moves, its head at `head`, with every take-over counted. */
function presenterRig(head) {
  const win = new Window();
  windows.push(win);
  const root = win.document.createElement('div');
  root.innerHTML = MARKUP;
  win.document.body.appendChild(root);
  const cube = win.document.createElement('div');
  for (const name of ['step', 'stepBack', 'play', 'pause', 'seek']) cube[name] = () => {};
  const solList = root.querySelector('#solList');
  solList.innerHTML = '<button class="chip-m" data-i="0"></button><button class="chip-m" data-i="1"></button>';
  const takeOvers = { count: 0 };
  const presenter = createWalkPresenter({
    root, cube, state: { connected: false, cube: {} }, signal: new AbortController().signal, scrambling: false,
    stale: () => false, solList, icon: () => '', adoptCube: () => {}, go: () => {},
    walkNow: () => ({ total: 2, target: null, alg: '', lesson: null, walkHold: SCAN_HOLD, walkGen: 1, walkLoaded: true }),
    takeOver: () => { takeOvers.count += 1; }, onHead: () => {},
  });
  presenter.takeChips();
  presenter.sync(head);
  return { $: (sel) => root.querySelector(sel), takeOvers };
}

test('one transport press takes over from the cube once', () => {
  for (const [what, head, press] of [
    ['Play', 1, (r) => r.$('#playBtn').click()],
    ['Next', 1, (r) => r.$('#nextBtn').click()],
    ['Back', 1, (r) => r.$('#prevBtn').click()],
    ['Repeat', 1, (r) => r.$('#repeatBtn').click()],
    ['Repeat at the start', 0, (r) => { r.$('#repeatBtn').disabled = false; r.$('#repeatBtn').click(); }],
    ['a chip', 1, (r) => r.$('.chip-m').click()],
  ]) {
    const r = presenterRig(head);
    press(r);
    assert.equal(r.takeOvers.count, 1, `${what}: one press took over from the cube ${r.takeOvers.count} times`);
  }
});

// ---- the follow model is knowledge of the cube in hand, and exists only on a trusted chain ------

test('a turn reported during the FIRST search is tracked, and the next load asks about the turned cube', async () => {
  const R = turned('R');
  const RU = turned('U', R);
  const searched = [];
  let hold = deferred();
  const w = world({ subject: { facelets: R, trusted: true, isPhysical: true, source: 'cube' } }, ({ state }) => ({
    deriveCube: async () => {
      searched.push(state.cube.facelets);
      const wait = hold;
      if (wait) await wait.promise;
      solvedBy(state, state.cube.facelets === R ? "R'" : "U' R'");
    },
  }));
  w.state.live = R;
  const first = w.session.load();
  await settle();
  w.session.liveMove({ notation: 'U', serial: 1 }); // turned before the first walk is on screen
  const release = hold;
  hold = null;
  release.resolve();
  assert.equal(await first, true);
  assert.equal(await w.session.load(), true);
  assert.equal(searched.at(-1), RU, 'a turn made while the first walk was searched for reached no model and was dropped');
});

test('trust lapsing ends the model: what the next connection reports is not adopted over a cube confirmed later', async () => {
  for (const [what, reported] of [
    ['a turn', (w) => { w.session.liveMove({ notation: 'U', serial: 1 }); }],
    ['a snapshot and a turn', (w) => { w.session.liveUpdate(turned('B'), 1); w.session.liveMove({ notation: 'U', serial: 2 }); }],
  ]) {
    const { w } = await turnedAhead();
    w.state.cube.trusted = false;
    w.state.cube.staleWhy = 'it disconnected';
    w.session.onTrustLost();
    reported(w); // before anyone has answered for the cube
    const F = turned('F');
    Object.assign(w.state.cube, { trusted: true, staleWhy: '', facelets: F });
    w.state.live = F;
    w.log.length = 0;
    await w.session.load();
    assert.deepEqual(w.log.filter((entry) => entry.startsWith('adopt ')), [],
      `${what} on a chain nobody could vouch for moved the old model on, and it was adopted over the confirmed cube`);
  }
});

test('a rolled scramble\'s trust is not the chain\'s: the cube does not lead, and Re-solve adopts no model', async () => {
  const R = turned('R');
  const rolled = world({ subject: { facelets: R, trusted: true, isPhysical: false, source: 'generated' } }, ({ state }) => ({
    deriveCube: async () => { solvedBy(state, "R'"); },
  }));
  rolled.state.live = R; // a connected cube happens to report the rolled arrangement
  assert.equal(await rolled.session.load(), true);
  assert.equal(rolled.session.following(), false, 'a rolled cube being trusted let a chain nobody verified lead the walk');
  assert.equal(rolled.$('[data-mode="cube"]').disabled, true);

  for (const [what, lapse] of [['after trust lapsed', true], ['with no lapse at all', false]]) {
    const { w } = await turnedAhead();
    if (lapse) { w.state.cube.trusted = false; w.session.onTrustLost(); }
    Object.assign(w.state.cube, { trusted: true, source: 'generated', isPhysical: false, facelets: turned('F') }); // the die
    w.log.length = 0;
    w.$('#resolveBtn').click();
    assert.deepEqual(w.log.filter((entry) => entry.startsWith('adopt ')), [],
      `${what}, Re-solve adopted the model as the cube in hand on a rolled scramble's trust`);
  }
});

test('a lost turn reported as onMovesLost reports it — trust first, then the gap — says the gap\'s own words', async () => {
  const { w } = await turnedAhead();
  w.state.cube.trusted = false;
  w.state.cube.staleWhy = 'a turn went unrecorded';
  w.session.onTrustLost();
  w.session.liveGap();
  assert.match(w.$('[data-mode="cube"]').title, /missed a turn/, "the trust hook's sentence stood over the gap's account");
  assert.equal(w.$('#followMsg').textContent, 'A turn went unrecorded — checking the cube…');
  assert.equal(w.session.following(), false);
});

test('while a walk is searched for there is nothing to follow, and a refusal stops following in every channel', async () => {
  const R = turned('R');
  let searches = 0;
  const second = deferred();
  const w = world({ subject: { facelets: R, trusted: true, isPhysical: true, source: 'cube' } }, ({ state }) => ({
    deriveCube: async () => { searches += 1; if (searches === 2) await second.promise; solvedBy(state, "R'"); },
  }));
  w.state.live = R;
  assert.equal(await w.session.load(), true);
  assert.equal(w.session.following(), true, 'precondition: the cube leads the first walk');
  const toggle = w.$('[data-mode="cube"]');

  const loading = w.session.load();
  await settle();
  assert.equal(toggle.disabled, true, 'the toggle stayed pressable with no walk on screen to follow');
  toggle.disabled = false; // DOM state a later paint could get wrong: the refusal is the tracker's
  toggle.click();
  assert.equal(w.session.following(), false, 'a press during the search set the cube leading a walk with no moves');
  second.reject(new Error('solver unavailable'));
  assert.equal(await loading, false);
  assert.equal(w.session.following(), false, 'the walk was refused and the cube still led it');
  assert.equal(toggle.getAttribute('aria-pressed'), 'false', 'a refused toggle announced itself as pressed');
  assert.equal(toggle.classList.contains('on'), false);
});

test('a first walk refused before it is judged does not leave the toggle announced as pressed', async () => {
  const w = world({ subject: { facelets: turned('R'), trusted: true, isPhysical: true, source: 'cube' } }, () => ({
    deriveCube: async () => { throw new Error('solver unavailable'); },
  }));
  const toggle = w.$('[data-mode="cube"]');
  toggle.classList.add('on'); // as cubeScreen draws it for a trusted cube
  toggle.setAttribute('aria-pressed', 'true');
  assert.equal(await w.session.load(), false);
  assert.equal(toggle.disabled, true, 'precondition: following is refused');
  assert.equal(toggle.getAttribute('aria-pressed'), 'false', 'the refused toggle kept the markup\'s aria-pressed="true"');
});

test('a snapshot during a replacement search keeps the model, and a cube one move along the walk leads it from there', async () => {
  const RU = turned('R U');
  const R = turned('R');
  let hold = null;
  const w = world({ subject: { facelets: RU, trusted: true, isPhysical: true, source: 'cube' } }, ({ state }) => ({
    deriveCube: async () => { const wait = hold; if (wait) await wait.promise; solvedBy(state, "U' R'"); },
  }));
  w.state.live = RU;
  assert.equal(await w.session.load(), true);
  assert.equal(w.session.following(), true, 'precondition: the cube leads');

  hold = deferred();
  const second = w.session.load(); // the same cube, searched for again — a Solution → Lesson switch
  await settle();
  w.session.liveMove({ notation: "U'", serial: 2 }); // the walk's first move, made during the search
  w.state.live = R;
  w.session.liveUpdate(R, 2); // and the cube's own snapshot of it
  const release = hold;
  hold = null;
  release.resolve();
  assert.equal(await second, true);
  assert.equal(w.session.following(), true,
    'a cube one move along the walk worked out for it was refused as "not the cube in your hand"');
  assert.ok(w.cube.calls.includes('seek 1'), 'and the drawing was not put where the cube is');
});

test('a walk refused because the cube was elsewhere is followed once the cube is back where it starts', async () => {
  const R = turned('R');
  const w = world({ subject: { facelets: R, trusted: true, isPhysical: true, source: 'cube' } }, ({ state }) => ({
    deriveCube: async () => { solvedBy(state, "R'"); },
  }));
  w.state.live = turned('U', R); // the cube reports a turn the walk does not start from
  assert.equal(await w.session.load(), true);
  const toggle = w.$('[data-mode="cube"]');
  assert.equal(toggle.disabled, true, 'precondition: a walk that does not start where the cube is may not be followed');
  w.session.liveMove({ notation: "U'", serial: 2 }); // turned back
  assert.equal(toggle.disabled, false, 'the cube came back to where the walk starts, and was refused for the whole visit');
  assert.equal(w.session.following(), true);
});

// ---- the presenter: a finished play, a missing renderer, and a tick for a walk that exists ------

test('a walk played to its end stops being played: the button offers Play again', async () => {
  const w = world({}, ({ state }) => ({ deriveCube: async () => { solvedBy(state, "R' U'"); } }));
  assert.equal(await w.session.load(), true);
  const play = w.$('#playBtn');
  play.click();
  assert.equal(play.getAttribute('aria-label'), 'Pause', 'precondition: the walk is playing');
  // The renderer plays each move and stops by itself after the last, saying nothing but the step.
  for (const index of [1, 2]) w.cube.dispatchEvent(new w.win.CustomEvent('cubus-step', { detail: { index } }));
  assert.equal(play.getAttribute('aria-label'), 'Play from here to the end', 'a finished walk still offered to pause');
});

test('with no renderer, the transport moves the head as bookkeeping, and no press throws', async () => {
  const w = world({}, ({ state }) => ({ deriveCube: async () => { solvedBy(state, "R' U'"); } }));
  for (const name of ['step', 'stepBack', 'seek', 'play', 'pause']) delete w.cube[name]; // never upgraded
  const errors = [];
  w.win.addEventListener('error', (e) => { errors.push(String(e.error?.message ?? e.message)); });
  assert.equal(await w.session.load(), true);
  const label = () => w.$('#stepLbl').textContent;
  w.$('#nextBtn').click();
  assert.equal(label(), '1 / 2', 'Next did nothing without a renderer to animate it');
  w.$('#solList').querySelectorAll('.chip-m')[1].click();
  assert.equal(label(), '2 / 2', 'a chip press did nothing without a renderer');
  w.$('#prevBtn').click();
  assert.equal(label(), '1 / 2', 'Back did nothing without a renderer');
  w.$('#repeatBtn').click();
  w.$('#playBtn').click();
  assert.equal(w.$('#playBtn').getAttribute('aria-label'), 'Play from here to the end',
    'the button read Pause over a cube that cannot play');
  assert.deepEqual(errors, [], 'a transport press threw on an element that is not a renderer');
});

test('the done tick is for a walk that exists — not a search, not a failure, but a stage already reached', async () => {
  const d = deferred();
  const w = world({}, ({ state }) => ({ deriveCube: async () => { await d.promise; solvedBy(state, "R'"); } }));
  const loading = w.session.load();
  await settle();
  assert.equal(w.$('#doneMark').hidden, true, 'the walk was ticked done while it was still being worked out');
  d.reject(new Error('solver unavailable'));
  assert.equal(await loading, false);
  assert.equal(w.$('#doneMark').hidden, true, 'a walk that could not be worked out was ticked done');

  const reached = world({ subject: { facelets: turned('R U') } }, () => ({
    deriveCube: () => new Promise(() => {}),
    lastRoute: async () => ({ kind: 'exact', alg: '', moves: 0, minimal: true, overshoot: false }),
  }));
  reached.state.stageTarget = 'cross';
  assert.equal(await within(reached.session.load()), true, 'precondition: a route of no moves is a walk');
  assert.equal(reached.$('#doneMark').hidden, false, 'a stage already reached lost its tick');
});

// ---- the rung offer, through the session: what counts as followed, and a reload's warning -------

/** A lesson walk of `R' U'` in one cross section, one follow of the cross short of a rung offer. */
async function lessonWalk(over = {}) {
  let progress = repairProgress(NO_PROGRESS);
  for (let i = 0; i < FOLLOWS_TO_OFFER - 1; i += 1) progress = recordCleanFollow(progress, ['cross']);
  const settings = { rungs: { cross: 0, pairs: 0, oll: 0, pll: 0 }, rungProgress: progress, proveMinimum: false };
  const saves = [];
  const w = world({}, ({ state }) => ({
    settings,
    deriveCube: async () => { solvedBy(state, "R' U'"); },
    lessonFor: (cube) => {
      const moves = ["R'", "U'"];
      const stepFacelets = [cube.facelets, turned("R'", cube.facelets), turned("R' U'", cube.facelets)];
      return {
        alg: moves.join(' '), moves, moveHolds: [SCAN_HOLD, SCAN_HOLD, SCAN_HOLD], stepFacelets, summary: 'Cross', steps: [], moveStep: [],
        sections: [{ id: 'cross', name: 'Cross', steps: 1, moves: 2, from: 0, to: 2 }],
      };
    },
    save: (key, value) => { saves.push(value.rungProgress.follows.cross); return true; },
    ...over,
  }));
  assert.equal(await w.session.load(), true);
  w.$('[data-walk="lesson"]').click();
  for (let i = 0; i < 3; i += 1) await settle();
  assert.equal(w.$('#solLabel').textContent, 'Lesson', 'precondition: the lesson is the walk on screen');
  return { w, saves };
}

test('pressing a lesson\'s chips one after another shows no turn, and earns no follow', async () => {
  const { w, saves } = await lessonWalk();
  // The renderer's seek is instant and reports where it landed, as the real one does.
  w.cube.seek = (k) => { w.cube.dispatchEvent(new w.win.CustomEvent('cubus-step', { detail: { index: k } })); };
  const chip = (k) => w.$('#solList').querySelectorAll('.chip-m')[k];
  chip(0).click();
  chip(1).click();
  assert.equal(w.$('#stepLbl').textContent, '2 / 2', 'precondition: the chips took the head to the end');
  assert.deepEqual(saves, [], 'a lesson pressed through chip by chip was credited as followed');
  // Stepped through, one shown move at a time, it still is.
  for (const index of [0, 1, 2]) w.cube.dispatchEvent(new w.win.CustomEvent('cubus-step', { detail: { index } }));
  assert.equal(saves.length, 1, 'a lesson stepped through was not credited');
});

test('a rung raised but not saved stays said through the reload the raise starts', async () => {
  const { w } = await lessonWalk({ raiseRung: () => false });
  for (const index of [1, 2]) w.cube.dispatchEvent(new w.win.CustomEvent('cubus-step', { detail: { index } }));
  assert.equal(w.$('#rungYes').hidden, false, 'precondition: the offer is on screen');
  w.$('#rungYes').click(); // accepting reloads the lesson at the new rung, in the same task
  assert.equal(w.$('#rungOffer').hidden, false, 'the reload hid the warning before it could be painted');
  assert.match(w.$('#rungOfferMsg').textContent, /not saving your progress/);
  for (let i = 0; i < 3; i += 1) await settle();
  assert.equal(w.$('#rungOffer').hidden, false, 'the reloaded walk hid the warning');
});

// ---- every sentence following and the transport say goes through t() ----------------------------

test('what following and the transport say goes through t(), sentence by sentence', async () => {
  const sentences = [
    'Needs a solve worked out on this screen', 'Turn your smart cube and the guide keeps up',
    'Play from here to the end', 'Pause', 'That was %1 — the next move is %2.',
    'This cube is not on the plan any more.', 'You took over — click to let the cube drive again',
    'Paused — you are driving. Switch Cube leads back on and your cube sets the pace.',
    'Your cube missed a turn — read it again before following', 'A turn went unrecorded — checking the cube…',
    'Read the cube first — %1', 'its position is unverified',
    'This is not the cube in your hand — read your cube to follow along', 'Solve this scramble',
  ];
  registerLocale('qa-walk', Object.fromEntries(sentences.map((s) => [s, `«${s}»`])));
  setLocale('qa-walk');
  const said = [];
  try {
    const R = turned('R');
    const w = world({ subject: { facelets: R, trusted: true, isPhysical: true, source: 'cube' } }, ({ state }) => ({
      deriveCube: async () => { solvedBy(state, "R' U'"); },
    }));
    w.state.live = R;
    const toggle = w.$('[data-mode="cube"]');
    const play = w.$('#playBtn');
    const note = () => w.$('#followMsg').textContent;
    const loading = w.session.load();
    said.push(['refused while searching', toggle.title]);
    assert.equal(await loading, true);
    said.push(['following', toggle.title], ['play', play.getAttribute('aria-label')]);
    w.session.liveMove({ notation: 'F', serial: 1 });
    said.push(['a wrong turn', note()]);
    w.session.liveUpdate(turned('F', R), 1);
    said.push(['off the plan', note()]);
    w.session.liveUpdate(R, 2);
    play.click();
    said.push(['taken over', toggle.title], ['paused', note()], ['pause', play.getAttribute('aria-label')]);
    w.session.liveGap();
    said.push(['a lost turn', toggle.title], ['unrecorded', note()]);
    w.state.cube.trusted = true;
    w.session.onTrustLost();
    said.push(['trust lapsed', toggle.title]);
    w.state.cube.trusted = true;
    w.state.live = turned('B');
    w.session.liveUpdate(w.state.live, 3);
    assert.equal(await w.session.load(), true);
    said.push(['elsewhere', toggle.title]);

    const scramble = world({ screen: { scrambling: true } }, () => ({
      randomScramble: async () => ({ facelets: turned('R'), alg: 'R' }),
    }));
    assert.equal(await scramble.session.load(), true);
    scramble.cube.dispatchEvent(new scramble.win.CustomEvent('cubus-step', { detail: { index: 1 } }));
    said.push(['hand-off', scramble.$('#solveItBtn').textContent]);
  } finally {
    setLocale('en');
  }
  for (const [where, text] of said) assert.match(text, /«/, `${where}: "${text}" reached the screen without t()`);
});

test('why trust lapsed is said in the catalog\'s words, inside the sentence that gives it', async () => {
  // The sentence went through t() and the reason inside it did not: a translated screen said
  // "read the cube first" in its own language and why in English.
  const why = 'it disconnected';
  registerLocale('qa-why', Object.fromEntries(
    ['Read the cube first — %1', why, 'its position is unverified'].map((s) => [s, `«${s}»`])));
  setLocale('qa-why');
  try {
    const { w } = await turnedAhead();
    const toggle = w.$('[data-mode="cube"]');
    Object.assign(w.state.cube, { trusted: false, staleWhy: why });
    w.session.onTrustLost();
    assert.equal(toggle.title, `«Read the cube first — «${why}»»`,
      'standing down as trust lapsed gave its reason untranslated');
    assert.equal(await w.session.load(), true);
    assert.equal(toggle.title, `«Read the cube first — «${why}»»`,
      'a walk refused on a chain nobody vouches for gave its reason untranslated');
    w.state.cube.staleWhy = '';
    assert.equal(await w.session.load(), true);
    assert.equal(toggle.title, '«Read the cube first — «its position is unverified»»',
      'with no reason recorded, the general one was not the catalog\'s');
  } finally {
    setLocale('en');
  }
});

// ---- the hold a lesson is shown in, said where the drawing turns --------------------------------

/** A lesson built the way `lessonFor` builds one: solved in the method frame, renamed to the
 *  scan's. */
function scanFrameLesson(facelets) {
  const result = solveByMethod(fromCube(Cube.fromString(toMethodFrame(facelets))), methodFor());
  const walk = scanFrameWalk(result.steps);
  const steps = result.steps.map((s, i) => ({ ...s, alg: walk.algs[i], hold: walk.stepHolds[i], focus: '', highlight: '' }));
  const moves = [...walk.moves];
  const alg = moves.join(' ');
  const stepFacelets = [facelets];
  const c = Cube.fromString(facelets);
  // As face turns, the way `lessonFor` builds them: a regrip moves no piece, and cubejs reads no rotation.
  for (const m of moves) { c.move(faceTurnsAlg(m)); stepFacelets.push(c.asString()); }
  return { facelets, steps, sections: lessonSections(steps), moveStep: moveStepIndex(steps), alg, moves, moveHolds: walk.holds, stepFacelets, summary: '' };
}

/** A walking screen on the Lesson for `scramble`, loaded and switched to. */
async function turnedLessonWorld(scramble) {
  const w = world({ subject: { facelets: turned(scramble) } }, ({ state }) => ({
    deriveCube: async () => { solvedBy(state, invert(scramble)); },
    lessonFor: (c) => scanFrameLesson(c.facelets),
  }));
  assert.equal(await w.session.load(), true);
  w.$('[data-walk="lesson"]').click();
  for (let i = 0; i < 5; i += 1) await settle();
  return w;
}

// The sentence follows the hold the screen last SHOWED. A lesson begun turned over drew the cube
// turned and never said to turn it; a jump or a step back across the turn did the same (found by
// audit, 2026-09-13).
test('a lesson begun turned over says so at its first move', async () => {
  const w = await turnedLessonWorld('D');
  assert.match(w.$('#whyLine').textContent, new RegExp(holdSentence(TUMBLED).replace('.', '\\.')),
    'the drawing turned over and the lesson never said to turn the cube');
});

test('a jump or a step back across the turn says so where it lands', async () => {
  const scramble = randomAlg(lcg(1), 25);
  const w = await turnedLessonWorld(scramble);
  const lesson = scanFrameLesson(turned(scramble));
  const flip = lesson.moveStep.findIndex((k) => lesson.steps[k].stage === 'middle-layer');
  assert.ok(flip > 2, 'precondition: the lesson turns over after a few moves');
  const head = (index) => w.cube.dispatchEvent(new w.win.CustomEvent('cubus-step', { detail: { index } }));
  const why = () => w.$('#whyLine').textContent;
  head(flip + 3);
  assert.ok(why().includes(holdSentence(TUMBLED)), `a jump past the turn landed silently: ${why()}`);
  head(flip - 1);
  assert.ok(why().includes(holdSentence(SCAN_HOLD)), `a step back across the turn landed silently: ${why()}`);
  head(flip - 2);
  assert.ok(!why().includes('Hold it with'), `a hold already shown was said again: ${why()}`);
});
