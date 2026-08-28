// The one link nothing else can cover: the real `new Worker(...)`.
//
// Everything under it is tested on the main thread — the bounds patch against the vendored
// module, the tiered progression against a fake, the client protocol against a fake worker. What
// none of that proves is that a browser can actually load `lib/solve-worker.js` as a module
// worker and get an answer back. A worker that fails to load fails in the quietest way there is:
// the promise never settles, and a screen waiting on it looks exactly like a search still going.
//
// Runs in headless WebKit, the engine every shipped build uses.
//
// It fails loudly without the browser: `pnpm exec playwright install webkit` (CI does this).

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright';

const PORT = 5196; // geometry owns 5197, serve.test.mjs 5199; node --test runs files in parallel
const BASE = `http://127.0.0.1:${PORT}`;
const SERVE = fileURLToPath(new URL('../serve.mjs', import.meta.url));
let proc;
let browser;

before(async () => {
  proc = spawn(process.execPath, [SERVE], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('serve.mjs did not start within 5s')), 5000);
    proc.stdout.on('data', (d) => { if (d.toString().includes(`:${PORT}`)) { clearTimeout(timeout); resolve(); } });
    proc.on('error', reject);
  });
  try {
    browser = await webkit.launch();
  } catch (cause) {
    throw new Error('WebKit for Playwright is not installed — run: pnpm --filter cubus-web exec playwright install webkit', { cause });
  }
});

after(async () => {
  await browser?.close();
  proc?.kill('SIGTERM');
});

/** Drive the real client, in the real engine, over the real thread boundary. */
async function inBrowser(fn, arg) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/index.html`);
  const result = await page.evaluate(fn, arg);
  await page.close();
  assert.deepEqual(errors, [], 'the page logged an uncaught error');
  return result;
}

test('a real module worker solves a real cube, at the tier it was asked for', async () => {
  const out = await inBrowser(async () => {
    const { createSolveClient, spawnSolveWorker } = await import('/lib/solve-client.js');
    const { refine } = await import('/lib/solve-target.js');
    const Cube = (await import('/vendor/cubejs.js')).default;
    Cube.initSolver();

    const client = createSolveClient({ spawn: spawnSolveWorker });
    const cube = Cube.random();
    const facelets = cube.asString();
    const steps = [];
    for await (const step of refine(facelets, {
      solve: (f, bounds) => client.solve(f, bounds),
      tier: 'twenty',
      probeBudget: 2_000_000,
    })) steps.push({ moves: step.moves, met: step.met, stopped: step.stopped, alg: step.alg });

    const final = steps[steps.length - 1];
    const oracle = Cube.fromString(facelets);
    oracle.move(final.alg);
    client.cancel();
    return { steps, solved: oracle.isSolved(), facelets };
  });

  assert.ok(out.steps.length >= 1, 'the worker produced no answer at all');
  assert.ok(out.solved, `the worker's solution does not solve ${out.facelets}`);
  const final = out.steps.at(-1);
  assert.equal(final.met, true, '<= 20 is reachable on every cube (dev-docs/solver-move-count.md)');
  assert.ok(final.moves <= 20, `asked for 20 or fewer, got ${final.moves}`);
  // Every intermediate answer is strictly shorter, except the last which repeats to carry the
  // stop reason. A move list that grew in front of a learner is the visible symptom.
  for (let i = 1; i < out.steps.length; i++) {
    const shorter = out.steps[i].moves < out.steps[i - 1].moves;
    const finalRepeat = out.steps[i].moves === out.steps[i - 1].moves && out.steps[i].stopped !== null;
    assert.ok(shorter || finalRepeat, `step ${i} went ${out.steps[i - 1].moves} -> ${out.steps[i].moves}`);
  }
});

test('a tighter tier is honoured, not silently ignored', async () => {
  // The failure this guards: the bounds patch not applying in the shipped bundle. The solver
  // still works, so nothing looks wrong — it just answers 20 when asked for 19, every time.
  const out = await inBrowser(async () => {
    const { createSolveClient, spawnSolveWorker } = await import('/lib/solve-client.js');
    const Cube = (await import('/vendor/cubejs.js')).default;
    Cube.initSolver();
    const client = createSolveClient({ spawn: spawnSolveWorker });
    const facelets = Cube.random().asString();
    const alg = await client.solve(facelets, { solLen: 19, probeMax: 2_000_000 });
    client.cancel();
    const oracle = Cube.fromString(facelets);
    if (alg) oracle.move(alg);
    return { moves: alg === null ? null : alg.trim().split(/\s+/).length, solved: alg === null ? null : oracle.isSolved() };
  });
  assert.notEqual(out.moves, null, 'no solution under 19 within a generous budget');
  assert.ok(out.moves <= 18, `asked for fewer than 19 and got ${out.moves} — the bounds patch is not live`);
  assert.equal(out.solved, true);
});
