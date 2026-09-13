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
