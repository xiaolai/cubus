// The reason line, in a real DOM.
//
// Everything else about the explaining solver is checked without a screen: the solver's own
// tests, and a wiring test that reads app.js as text. Neither can tell whether a learner ever
// SEES a reason — which is the entire feature. So this mounts the walk and reads the line.
//
// It runs under happy-dom, which has no Worker; the solver falls back to this thread and says
// so, and that fallback is why the real solver runs here rather than a stub.

import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 0));
const waitFor = async (fn, ms = 10000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) { if (fn()) return true; await new Promise((r) => setTimeout(r, 20)); }
  return false;
};

let win;
let state;

before(async () => {
  win = new Window({
    url: 'http://localhost/#/timer',
    settings: {
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableComputedStyleRendering: true,
      fetch: { disableSameOriginPolicy: true },
    },
  });
  win.document.write(html);
  for (const k of [
    'window', 'document', 'navigator', 'location', 'history',
    'localStorage', 'customElements', 'HTMLElement', 'CustomEvent',
    'requestAnimationFrame', 'cancelAnimationFrame', 'performance',
  ]) {
    Object.defineProperty(globalThis, k, { value: win[k], writable: true, configurable: true });
  }
  // Seeded BEFORE app.js is imported: settings are read once at module evaluation, so a value
  // written afterwards would never reach the solver.
  win.localStorage.setItem('cubusSettings', JSON.stringify({ teachLevel: 'beginner', solveTier: 'twenty' }));
  ({ state } = await import('../lib/app.js'));
  await tick();
});

test('with explaining on, the walk shows a reason for the step you are on', async () => {
  win.location.hash = '#/scramble';
  await tick();
  assert.ok(await waitFor(() => win.document.querySelectorAll('#solList .chip-m').length > 0), 'no solver');

  const Cube = (await import(new URL('../vendor/cubejs.js', import.meta.url).href)).default;
  const c = new Cube();
  c.move("R U R' U' F2 D L2 B' R2 U2");
  Object.assign(state.cube, {
    facelets: c.asString(), derived: false, setupAlg: '', solution: '', moves: [],
    stepFacelets: [], methodSteps: null, moveStep: null, isPhysical: false, source: 'generated',
  });
  win.location.hash = '#/home';
  await tick();

  assert.ok(await waitFor(() => (state.cube.methodSteps ?? []).length > 0),
    'the explaining solver never ran');
  const steps = state.cube.methodSteps;
  assert.equal(state.cube.moveStep.length, state.cube.moves.length,
    'every move must belong to a step, or the line captions the wrong one');

  const line = win.document.querySelector('#whyLine');
  assert.ok(line, 'the reason line is not on the screen');
  assert.ok(await waitFor(() => !line.hidden && line.textContent.trim().length > 0),
    'the reason line is empty');
  assert.match(line.textContent, /^Step 1 of \d+ — \S/, `unexpected caption: "${line.textContent}"`);

  // The caption FOLLOWING the walk is not checked here: this DOM does not load
  // <cubus-cube>, so the transport never advances — stepLbl stays at 0 / N however the walk is
  // driven. That half is covered in test/solve-worker-browser.test.mjs, in a real engine.
  // Every move belongs to exactly one step, and the steps are walked in order.
  const map = state.cube.moveStep;
  assert.equal(map[0], 0, 'the first move belongs to the first step');
  assert.equal(map[map.length - 1], steps.length - 1, 'the last move belongs to the last step');
  for (let i = 1; i < map.length; i++) {
    assert.ok(map[i] === map[i - 1] || map[i] === map[i - 1] + 1,
      `step index jumped from ${map[i - 1]} to ${map[i]} between moves`);
  }
  assert.ok(steps.length >= 10, `a beginner lesson should be many steps, got ${steps.length}`);
});

test('a solution cached by the OTHER solver is not reused', async () => {
  // How the reason line disappeared in the real app while every test passed: a solution already
  // on `state.cube` short-circuits solve(), and if it was produced without a lesson — restored,
  // or computed while explaining was off — the walk renders with nothing to caption it. The
  // tests all set the state up by hand and never had a stale one.
  const Cube = (await import(new URL('../vendor/cubejs.js', import.meta.url).href)).default;
  const c = new Cube();
  c.move("R U R' U' F2 D L2 B' R2 U2");

  // Exactly the bad shape: a solution with no lesson beside it, while explaining is on.
  Object.assign(state.cube, {
    facelets: c.asString(), derived: false, setupAlg: '',
    solution: "R U R' U'", moves: ['R', 'U', "R'", "U'"], stepFacelets: [],
    methodSteps: null, moveStep: null, isPhysical: false, source: 'generated',
  });
  win.location.hash = '#/scramble';
  await tick();
  win.location.hash = '#/home';
  await tick();

  assert.ok(await waitFor(() => (state.cube.methodSteps ?? []).length > 0),
    'the stale solution was reused and no lesson was computed');
  assert.notEqual(state.cube.solution, "R U R' U'", 'the stale solution must be replaced');
  const line = win.document.querySelector('#whyLine');
  assert.ok(await waitFor(() => !line.hidden && line.textContent.trim().length > 0),
    'the reason line is still empty after the lesson was computed');
});

test('the card says which of the two solvers produced this', async () => {
  // "Solution 93" and "Solution 20" read identically, so a 93-move lesson looked like a broken
  // solver. It is a different object and has to say so.
  assert.ok(await waitFor(() => (state.cube.methodSteps ?? []).length > 0), 'no lesson');
  const label = win.document.querySelector('#solLabel');
  const count = win.document.querySelector('#moveCount');
  assert.equal(label.textContent, 'Lesson', `the header still reads "${label.textContent}"`);
  assert.match(count.textContent, /^\d+ steps · \d+ moves$/,
    `the count reads "${count.textContent}" — a bare number cannot say what it counts`);
});
