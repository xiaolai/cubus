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
import { createWalkSession } from '../lib/walk-session.js';

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
 *  app.js; the app and browser suites are what hold that markup and this module together. */
const MARKUP = `
  <div class="state-card"><b class="state-h"></b><div id="viewNet"></div>
    <div id="stageAim" hidden><div id="stageAimSay"></div><div id="stageAimNet"></div><div id="stageLive"></div></div>
  </div>
  <div class="transport">
    <button id="prevBtn"></button><button id="repeatBtn"></button><button id="nextBtn"></button><button id="playBtn"></button>
    <div class="progress"><span id="progBar"></span></div><span id="doneMark" hidden></span><span id="stepLbl">0 / 0</span>
    <button class="pill" data-mode="cube"></button>
  </div>
  <div class="solution-card">
    <b id="solLabel">Solution</b><span id="moveCount">—</span><button id="proveBtn" hidden></button><button id="proveCancel" hidden></button>
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
 * stand-in. `omit` removes names from the app or the screen, for the construction check.
 */
function world({ subject = {}, omit = [] } = {}, make = () => ({})) {
  const win = new Window();
  windows.push(win);
  const doc = win.document;
  const root = doc.createElement('div');
  root.innerHTML = MARKUP;

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
    ...make({ state, log }),
  };
  for (const name of omit) { delete app[name]; delete screen[name]; }

  const session = createWalkSession(screen, app);
  return {
    session,
    state,
    log,
    $: (sel) => root.querySelector(sel),
    chips: () => [...root.querySelectorAll('.chip-m')].map((chip) => chip.textContent),
  };
}

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
