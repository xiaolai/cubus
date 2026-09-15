// The subject's solve, driven through the booted app with the pool's answers in this file's hands:
// what a refuted answer leaves behind, a subject replaced mid-search, the tier a carried answer
// may stand for, and an oracle that could not run.

import assert from 'node:assert/strict';
import { test, before } from 'node:test';
import { readFileSync } from 'node:fs';

import { Window } from 'happy-dom';
import Cube from '../vendor/cubejs.js';
import { lcg, randomAlg } from './fixtures/seeded-scrambles.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 0));
const SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
const move = (from, alg) => { const c = Cube.fromString(from); c.move(alg); return c.asString(); };
let win;

before(async () => {
  win = new Window({
    url: 'http://localhost/#/timer',
    settings: {
      disableJavaScriptFileLoading: true, disableCSSFileLoading: true,
      disableComputedStyleRendering: true, fetch: { disableSameOriginPolicy: true },
    },
  });
  win.document.write(html);
  for (const k of [
    'window', 'document', 'navigator', 'location', 'history', 'localStorage', 'customElements',
    'HTMLElement', 'CustomEvent', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance',
  ]) {
    Object.defineProperty(globalThis, k, { value: win[k], writable: true, configurable: true });
  }
  await import('../lib/app.js');
  const svc = await import('../lib/solver-service.js');
  const t0 = Date.now();
  while (!svc.solverReady && Date.now() - t0 < 60000) await new Promise((r) => setTimeout(r, 50));
});

const app = async () => ({
  state: (await import('../lib/app.js')).state,
  subject: await import('../lib/cube-subject.js'),
  svc: await import('../lib/solver-service.js'),
});

/** Stand in for the pool's answers for one case, and put the real ones back. */
async function withAnswers(answer, run) {
  const { svc } = await app();
  const client = svc.solverWorker();
  const real = client.solve;
  const asked = [];
  client.solve = async (facelets, bounds) => { asked.push(bounds); return answer(facelets, bounds, asked.length); };
  try { return await run(asked); } finally { client.solve = real; }
}

test('a refuted answer leaves no verdict behind', async () => {
  const { state, subject } = await app();
  subject.setFacelets(move(SOLVED, "R U F2 L' D"));
  await withAnswers((f, b) => (b.solLen > 2 ? 'R U' : null), async () => {
    await assert.rejects(() => subject.deriveCube({}), /cross-check failed/);
  });
  assert.equal(state.cube.solution, '');
  assert.equal(state.cube.solveResult, null, 'a refuted answer left a verdict claiming it met its tier');
});

test('a subject replaced mid-search is superseded: nothing more is shown or searched for it', async () => {
  const { subject } = await app();
  subject.setFacelets(move(SOLVED, 'R U'));
  const shown = [];
  await withAnswers((f, b, n) => {
    if (n === 1) subject.ingestFacelets(move(SOLVED, 'F2 L'));
    return b.solLen > 2 ? "U' R'" : null;
  }, async (asked) => {
    const err = await subject.deriveCube({ onImprovement: (s) => shown.push(s.moves) }).catch((e) => e);
    assert.equal(err?.name, 'AbortError', `a replaced subject failed as "${err?.message}"`);
    assert.deepEqual(shown, [], 'an answer about the previous cube reached the screen');
    assert.equal(asked.length, 1, 'the search went on for a cube that was no longer the subject');
  });
});

// A live report replaces the subject without aborting anyone. Checked only where an answer was
// yielded, a first search the engine kept refusing went on escalating for the cube that had
// gone — nine requests, then an ordinary Error instead of supersession (found by verification,
// 2026-09-14).
test('a subject replaced while its first search escalates asks nothing more, and is superseded', async () => {
  const { subject } = await app();
  subject.setFacelets(move(SOLVED, 'R U F'));
  await withAnswers((f, b, n) => {
    if (n === 1) subject.ingestFacelets(move(SOLVED, 'F2 L'));
    return null;
  }, async (asked) => {
    const err = await subject.deriveCube({}).catch((e) => e);
    assert.equal(asked.length, 1, 'the search went on escalating for a cube that was no longer the subject');
    assert.equal(err?.name, 'AbortError', `a replaced subject failed as "${err?.message}"`);
  });
});

// The guard above runs before each request, and no request follows the LAST attempt the first
// search is allowed: a subject replaced while that one ran came back as refine's own escalation
// error, an ordinary Error about a cube nobody was looking at (found by verification, 2026-09-14).
test('a subject replaced during the last attempt its first search is allowed is superseded, not failed', async () => {
  const { subject } = await app();
  const { MAX_PROMISE_ESCALATIONS } = await import('../lib/solve-target.js');
  const attempts = MAX_PROMISE_ESCALATIONS + 1;
  subject.setFacelets(move(SOLVED, 'R U F L'));
  await withAnswers((f, b, n) => {
    if (n === attempts) subject.ingestFacelets(move(SOLVED, 'F2 L'));
    return null;
  }, async (asked) => {
    const err = await subject.deriveCube({}).catch((e) => e);
    assert.equal(asked.length, attempts, 'precondition: every attempt the first search is allowed was asked');
    assert.equal(err?.name, 'AbortError', `a subject replaced during the last attempt failed as "${err?.message}"`);
  });
});

test('a carried answer stands for the twenty tier only, and a tighter tier searches', async () => {
  const { state, subject, svc } = await app();
  const { settings } = await import('../lib/app-settings.js');
  const { adoptCube } = await import('../lib/cube-connection.js');
  const { randomScramble } = await import('../lib/scramble-roll.js');
  const rolled = await randomScramble();
  assert.ok(rolled.alg, 'precondition: a scramble was rolled');
  const carried = svc.invertAlg(rolled.alg);
  const n = carried.split(' ').length;
  const tier = settings.solveTier;
  try {
    await withAnswers((f, b) => (b.solLen > n ? carried : null), async (asked) => {
      settings.solveTier = 'eighteen';
      adoptCube(rolled.facelets, { physical: false, source: 'generated', setupAlg: rolled.alg });
      await subject.deriveCube({});
      assert.ok(asked.length > 0, 'a carried answer stood in for a tier nobody searched');
      assert.equal(state.cube.solveResult?.target, 18, 'and nothing says whether 18 was reached');

      settings.solveTier = 'twenty';
      asked.length = 0;
      adoptCube(rolled.facelets, { physical: false, source: 'generated', setupAlg: rolled.alg });
      await subject.deriveCube({});
      assert.equal(asked.length, 0, 'the <= 20 promise the scramble already kept was searched again');
    });
  } finally { settings.solveTier = tier; }
});

// Searched again under a tier it does not answer, a carried answer once started nothing: the search
// began from scratch, and a budget that stopped at a longer answer replaced the shorter one already
// known (found by verification, 2026-09-14). The known answer bounds the search now.
test('a carried answer a tier searches again still bounds the search: nothing longer replaces it', async () => {
  const { state, subject } = await app();
  const { settings } = await import('../lib/app-settings.js');
  const { adoptCube } = await import('../lib/cube-connection.js');
  const setupAlg = "R U F2 L' D";
  const tier = settings.solveTier;
  try {
    settings.solveTier = 'shortest';
    await withAnswers((f, b) => (b.solLen > 7 ? "D' L F2 U' R' U U'" : null), async (asked) => {
      adoptCube(move(SOLVED, setupAlg), { physical: false, source: 'generated', setupAlg });
      const known = state.cube.solution;
      assert.equal(known.split(' ').length, 5, 'precondition: the scramble carried its 5-move answer');
      await subject.deriveCube({});
      assert.equal(state.cube.solution, known, 'a longer answer the budget stopped at replaced the known one');
      assert.equal(asked[0]?.solLen, 5, 'the search did not start below the answer it already had');
    });
  } finally { settings.solveTier = tier; }
});

test('an oracle that could not run accepts the answer unverified, and the next solve checks it', async () => {
  const { state, subject, svc } = await app();
  subject.setFacelets(move(SOLVED, 'R U'));
  const real = svc.Cube.fromString;
  let down = true;
  svc.Cube.fromString = function (f) {
    if (down) { down = false; throw new Error('oracle down (test)'); }
    return real.call(this, f);
  };
  try {
    await withAnswers((f, b) => (b.solLen > 2 ? "U' R'" : null), async (asked) => {
      await subject.deriveCube({});
      assert.equal(state.cube.solution, "U' R'", 'an oracle that refuted nothing dropped the answer');
      assert.equal(state.cube.crossChecked, false, 'an answer nobody verified was marked checked');
      const searches = asked.length;
      await subject.deriveCube({});
      assert.equal(asked.length, searches, 'checking again searched again');
      assert.equal(state.cube.crossChecked, true, 'the next solve did not retry the check');
    });
  } finally { svc.Cube.fromString = real; }
});

test('a regrip on a walk is a position whose cube is the one before it', async () => {
  // Plan item 6.1: a lesson's moves may turn the whole cube, which moves no piece. The walk's states are
  // about the pieces — what a smart cube reports and `follow` compares — so a regrip, handed over as the
  // no face turns it is, repeats the state rather than failing the replay or skipping a position.
  const { subject } = await app();
  const after = move(SOLVED, 'R');
  assert.deepEqual(subject.stepStates(SOLVED, ['R', '', "R'"]), [SOLVED, after, after, SOLVED]);
});

test('a lesson step made after a regrip lights the edge it sends home, on the cube as scanned', async () => {
  // Plan items 6.1 and 6.2: after a regrip a step names its pieces as the child then sees the cube, so the
  // lesson reads its cues in that hold before renaming them into the scan frame. Checked on the stickers,
  // never with the renaming itself: the edge a middle-layer insert lights must be home once its moves are
  // made, and must not have been before.
  const { subject } = await app();
  /** Each middle-layer slot's two stickers on the published layout, as the scan frame writes them. */
  const HOME = { FR: [[23, 'F'], [12, 'R']], FL: [[21, 'F'], [41, 'L']], BR: [[48, 'B'], [14, 'R']], BL: [[50, 'B'], [39, 'L']] };
  const sorted = (letters) => [...letters].sort().join('');
  let checked = 0;
  for (let seed = 1; seed < 60 && checked < 4; seed += 1) {
    const lesson = subject.lessonFor({ facelets: move(SOLVED, randomAlg(lcg(seed), 25)), lesson: null });
    assert.ok(lesson, `seed ${seed}: the method solved the cube`);
    let at = 0;
    for (const step of lesson.steps) {
      const n = step.alg.split(' ').filter(Boolean).length;
      if (step.why.key === 'middleLayer.insert' && step.hold.join(' ') !== 'D B') {
        const pieces = step.highlight.split(',').filter((t) => t.startsWith('piece:')).map((t) => t.slice('piece:'.length));
        assert.equal(pieces.length, 1, `seed ${seed}: an insert lights one edge — "${step.highlight}"`);
        const slot = Object.keys(HOME).find((name) => sorted(name) === sorted(pieces[0]));
        assert.ok(slot, `seed ${seed}: ${pieces[0]} is not a middle-layer edge`);
        const home = (facelets) => HOME[slot].every(([i, face]) => facelets[i] === face);
        assert.ok(!home(lesson.stepFacelets[at]), `seed ${seed}: the lit edge ${pieces[0]} was already home`);
        assert.ok(home(lesson.stepFacelets[at + n]), `seed ${seed}: the lit edge ${pieces[0]} is not the one the step sends home`);
        checked += 1;
      }
      at += n;
    }
  }
  assert.ok(checked >= 4, `precondition: ${checked} middle-layer inserts made after a regrip were checked`);
});
