// The solver loader's lifecycle, driven: `loadSolver` in lib/solver-service.js, with the import of
// cubejs and the fetch of the proven library scripted rather than real.
//
// What these pin (the 2026-09-13 audit):
//   * callers that arrive while a load is running share it: one import, one library request, and
//     one sentence when it fails;
//   * a load that failed is tried again by the next caller, and a load that worked is not;
//   * a library request that never answers leaves solving available, and the library still lands
//     when it does answer.
//
// How the outcomes are scripted. Customization hooks (`module.registerHooks`), installed before the
// service is imported — which is why this is a file of its own: a fresh process per file is how
// this suite isolates module state. Each case imports its own copy of the service (`?case=<name>`),
// and that copy gets its own cubejs, whose load the case scripts to fail or to go through. Node
// does not cache a load that failed, so importing again really does try again; the retry case is
// the test of that, as it cannot pass if the failure were cached. The library loader is served
// under an https: URL, because under file: it refuses before it fetches; its real code then calls
// `fetch`.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

import { SOLVED_FACELETS } from '../lib/solved.js';

const SERVICE = new URL('../lib/solver-service.js', import.meta.url);
const CUBEJS = new URL('../vendor/cubejs.js', import.meta.url);
const CHALLENGES = new URL('../lib/optimal-challenges.js', import.meta.url);
const LIBRARY = new URL('../lib/data/optimal-challenges.json', import.meta.url);
/** Where the library loader is served from, so that its real code reaches for `fetch`. */
const SERVED_CHALLENGES = 'https://cubus.test/lib/optimal-challenges.js';

/** Per copy of the service, keyed by its query: the cubejs outcomes still to come, in order. */
const cubejsScript = new Map();
/** Per copy of the service: how many times it tried to load cubejs. */
const cubejsLoads = new Map();

registerHooks({
  resolve(specifier, context, next) {
    const parent = context.parentURL ? new URL(context.parentURL) : null;
    if (parent?.pathname === SERVICE.pathname && specifier === '../vendor/cubejs.js') {
      return { url: `${CUBEJS.href}${parent.search}`, shortCircuit: true };
    }
    if (parent?.pathname === SERVICE.pathname && specifier === './optimal-challenges.js') {
      return { url: SERVED_CHALLENGES, shortCircuit: true };
    }
    if (parent?.href === SERVED_CHALLENGES) {
      return next(specifier, { ...context, parentURL: CHALLENGES.href });
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === SERVED_CHALLENGES) {
      return { format: 'module', source: readFileSync(CHALLENGES, 'utf8'), shortCircuit: true };
    }
    const at = new URL(url);
    if (at.pathname === CUBEJS.pathname && at.search !== '') {
      cubejsLoads.set(at.search, (cubejsLoads.get(at.search) ?? 0) + 1);
      const outcome = cubejsScript.get(at.search)?.shift();
      if (outcome === 'fail') throw new Error(`cubejs did not load (scripted, ${at.search})`);
      if (outcome !== 'load') throw new Error(`no cubejs outcome scripted for ${at.search}`);
    }
    return next(url, context);
  },
});

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

/** Every request for the proven library, answered the way the running case says. */
const libraryRequests = [];
let answerLibrary = () => Promise.reject(new Error('this case scripted no library answer'));
globalThis.fetch = (url) => {
  libraryRequests.push(String(url));
  return answerLibrary(url);
};

/** A copy of the service of its own, whose cubejs loads go the way `outcomes` say. */
async function freshService(name, outcomes) {
  const search = `?case=${name}`;
  cubejsScript.set(search, [...outcomes]);
  const svc = await import(`${SERVICE.href}${search}`);
  return { svc, loads: () => cubejsLoads.get(search) ?? 0 };
}

/** A timer's turn: every microtask queued before it has run by the time it resolves. */
const turn = () => new Promise((r) => { setTimeout(r, 0); });

/** Run `body` with console.error recorded rather than printed. */
async function recordingErrors(body) {
  const said = [];
  const real = console.error;
  console.error = (...args) => { said.push(args.map(String).join(' ')); };
  try {
    return await body(said);
  } finally {
    console.error = real;
  }
}

const unavailable = async () => ({ ok: false, status: 503 });

test('callers that arrive while the solver loads share that one load', async () => {
  await recordingErrors(async () => {
    const { svc, loads } = await freshService('shared', ['load']);
    libraryRequests.length = 0;
    answerLibrary = unavailable;
    const calls = [svc.loadSolver(), svc.loadSolver(), svc.loadSolver()];
    assert.deepEqual(await Promise.all(calls), [true, true, true]);
    assert.equal(svc.solverReady, true);
    assert.equal(loads(), 1, 'cubejs was imported more than once');
    assert.equal(libraryRequests.length, 1,
      `three callers started ${libraryRequests.length} loads, each asking for the library`);
    assert.equal(await svc.loadSolver(), true);
    assert.equal(libraryRequests.length, 1, 'a solver already loaded was loaded again');
  });
});

test('a load that failed is tried again by the next caller, one that worked is not', async () => {
  await recordingErrors(async (said) => {
    const { svc, loads } = await freshService('retry', ['fail', 'load']);
    libraryRequests.length = 0;
    answerLibrary = unavailable;
    const calls = [svc.loadSolver(), svc.loadSolver()];
    assert.deepEqual(await Promise.all(calls), [false, false]);
    assert.equal(loads(), 1, 'two callers of one failing load imported twice');
    assert.equal(svc.solverReady, false, 'a solver that did not load reads as ready');
    assert.equal(svc.Cube, null, 'a solver that did not load published an oracle');
    assert.equal(said.filter((s) => s.includes('the solver did not load')).length, 1,
      'one failed load must be said exactly once, however many callers were waiting on it');
    assert.equal(libraryRequests.length, 0,
      'the library was asked for with no oracle to check it');

    assert.equal(await svc.loadSolver(), true, 'a load that failed was never tried again');
    assert.equal(loads(), 2, 'the retry never reached the import');
    assert.equal(svc.solverReady, true);
    assert.equal(svc.Cube.fromString(SOLVED_FACELETS).isSolved(), true,
      'the retry published an oracle that does not work');
    assert.equal(libraryRequests.length, 1, 'the load that worked did not ask for the library');

    assert.equal(await svc.loadSolver(), true);
    assert.equal(loads(), 2, 'a load that worked ran again');
  });
});

test('a library request that never answers leaves solving available, and it lands when it does',
  { timeout: 30_000 }, async () => {
    const { svc } = await freshService('stalled', ['load']);
    libraryRequests.length = 0;
    let asked;
    const requested = new Promise((r) => { asked = r; });
    let answer;
    answerLibrary = () => {
      asked();
      return new Promise((r) => { answer = r; });
    };
    const loading = svc.loadSolver();
    await requested;
    const early = await Promise.race([loading, turn().then(() => 'still waiting on the library')]);
    assert.equal(early, true, 'solving waited on a library request that has not answered');
    assert.equal(svc.solverReady, true);
    assert.equal(svc.Cube.fromString(SOLVED_FACELETS).isSolved(), true);
    assert.deepEqual(libraryRequests,
      [new URL('./data/optimal-challenges.json', SERVED_CHALLENGES).href]);

    // The real library, validated against the oracle the load published, the way the app's is.
    const entries = JSON.parse(readFileSync(LIBRARY, 'utf8'));
    const probe = entries[0].facelets;
    assert.equal(svc.challenges.get(probe), undefined,
      'a state was claimed before the library came');
    answer({ ok: true, status: 200, json: async () => entries });
    for (let i = 0; i < 20 && svc.challenges.get(probe) === undefined; i += 1) await turn();
    assert.equal(svc.challenges.get(probe)?.optimalLength, entries[0].optimalLength,
      'the library answered and was never published');
  });
