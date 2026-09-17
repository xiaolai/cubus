// Pressing a target and walking the answer — in a real WebKit, with a real worker.
//
// Plan §6 of dev-docs/solve-to-state-plan.md, Phase D. Everything else about this feature is
// tested without a browser: the engine against oracles, the wording against its own vocabulary,
// the wiring against the source. Four things are only true in a browser, and each of them is a
// way the feature can be entirely correct and still not work:
//
//   1. THE WORKER ANSWERS AT ALL. `stageAsk` goes through the solve pool's control channel to a
//      request kind the worker learned this week. Under `node --test` there is no worker, no
//      `postMessage`, and no way to find out that the reply never comes back.
//   2. A TARGET CHANGE REPAINTS IN PLACE. `retarget()` exists precisely so a change of subject
//      does not destroy the screen, and the failure — a rebuild — looks identical in the DOM a
//      moment later. It is only visible as a NEW `<cubus-cube>`, a new WebGL context, or a
//      transport that has forgotten where it was.
//   3. THE ROUTE IS SHORTER THAN THE SOLVE, and says which kind of answer it is. That is the whole
//      product claim, and it is the one thing no unit test can observe end to end.
//   4. A REPAIR CALLED OFF LETS GO OF ITS WORKER. The stop is a word the page writes while the
//      worker's search is running and polling it, and only a browser has both threads and the
//      memory they share — a stop that never crosses still returns a right answer, late.
//
// The Restore chip row IS driven here, through the one door that does not need a camera: the
// scanner panel's own `scan-complete` event, dispatched with a facelet string. That is the same
// event a real scan fires and the same handler it reaches, so what is being skipped is the camera
// and the model — not the app.
//
// It fails loudly without the browser: `pnpm exec playwright install webkit` (CI does this).

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright';

import { turnFacelets } from '../../lib/cube-orientation.js';
import { fromCube } from '../../lib/cube-pieces.js';
import { moveStepIndex, stepAtMove } from '../../lib/method-lesson.js';
import { methodFor, solveByMethod } from '../../lib/method-solver.js';
import { TUMBLED, holdForStage, holdSpec, renameAlg, scanFrameWalk, toMethodFrame } from '../../lib/solving-hold.js';
import Cube from '../../vendor/cubejs.js';
import { pace } from '../browser-wait.mjs';
import { freePort } from '../free-port.mjs';

let PORT;
let BASE;
const SERVE = fileURLToPath(new URL('../../serve.mjs', import.meta.url));
let proc;
let browser;

before(async () => {
  PORT = await freePort();
  BASE = `http://127.0.0.1:${PORT}`;
  proc = spawn(process.execPath, [SERVE], {
    env: { ...process.env, PORT: String(PORT), CUBUS_LIVE_RELOAD: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    let said = '';
    const note = (d) => { said += d.toString(); };
    const timeout = setTimeout(
      () => reject(new Error(`serve.mjs did not start within 5s on port ${PORT}. It said: ${said.trim() || '(nothing)'}`)),
      5000,
    );
    proc.stdout.on('data', (d) => {
      note(d);
      if (d.toString().includes(`:${PORT}`)) { clearTimeout(timeout); resolve(); }
    });
    proc.stderr.on('data', note);
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

/** Home with the developer die, so there is a real scrambled cube to repair. */
async function openHome() {
  const context = await browser.newContext({ viewport: { width: 840, height: 682 } });
  const page = await context.newPage();
  pace(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));
  await page.addInitScript(() => {
    localStorage.setItem('cubusSettings', JSON.stringify({
      theme: 'auto', palette: 'muted', autosolve: false, cameraId: '', navHidden: [],
      navDefaults: 99, devRandCube: true, language: '', dragRotate: false, solveTier: 'twenty',
    }));
    // A rebuild is only visible as a NEW context. Counting them is the one measurement that can
    // tell "repainted in place" from "destroyed and rebuilt to look the same".
    window.__gl = 0;
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
      if (String(kind).startsWith('webgl')) window.__gl += 1;
      return getContext.call(this, kind, ...rest);
    };
  });
  await page.goto(`${BASE}/#/home`);
  await page.waitForSelector('#randCube');
  await page.waitForFunction(() => document.querySelector('#viewCube cubus-cube') !== null, null);
  return { page, context, errors };
}

/** Press the die and settle on the walk it produces. */
async function scrambled(page) {
  await page.click('#randCube');
  await page.waitForFunction(() => document.querySelectorAll('.chip-m').length > 0, null);
  await page.waitForFunction(() => {
    const n = document.querySelector('#moveCount')?.textContent ?? '';
    return n !== '' && n !== 'working…';
  }, null);
}

/** Press a target pill and wait for the count to become a repair sentence. */
async function aimAt(page, id) {
  await page.click(`[data-stage="${id}"]`);
  await page.waitForFunction(
    () => /way back|couldn’t/.test(document.querySelector('#moveCount')?.textContent ?? ''),
    null,
    { timeout: 30_000 },
  );
}

test('a target change walks a shorter answer, and says which kind of answer it is', async () => {
  const { page, context, errors } = await openHome();
  try {
    await scrambled(page);
    const whole = Number(await page.textContent('#moveCount'));
    assert.ok(whole >= 15 && whole <= 20, `a random cube should solve in 15..20 moves, not ${whole}`);
    const wholeChips = await page.locator('.chip-m').count();
    assert.equal(wholeChips, whole, 'the chip grid is the move list, so the two counts must agree');

    await aimAt(page, 'cross');
    const said = await page.textContent('#moveCount');
    // THE CLAIM, and the shape of it. `stage-report.test.mjs` proves only one wording can say
    // "shortest" and only for a minimal route; this proves that wording reaches a screen.
    assert.match(said, /(the shortest way back|a way back) — \d+ moves?/,
      `the repair must name what kind of answer it is, not just a number — got "${said}"`);
    const moves = Number(said.match(/(\d+) moves?/)[1]);
    assert.ok(moves > 0, 'a scrambled cube is not already at the cross');
    assert.ok(moves < whole,
      `the whole point: the cross is ${moves} moves away and the whole cube is ${whole} — a repair`
      + ' that is not shorter than the solve is a feature with nothing to offer');
    const repairChips = await page.locator('.chip-m').count();
    assert.equal(repairChips, moves, 'the move list must be the repair, not the leftover solution');
  } finally {
    assert.deepEqual(errors.map(String), [], 'the page must raise nothing');
    await context.close();
  }
});

test('a target change repaints in place — it does not rebuild the screen', async () => {
  const { page, context, errors } = await openHome();
  try {
    await scrambled(page);
    // Identity, not appearance. A rebuilt screen looks the same a frame later; what it cannot fake
    // is being the SAME element. The cube is tagged, and the tag survives only a repaint.
    await page.evaluate(() => { document.querySelector('#viewCube cubus-cube').dataset.mark = 'before'; });
    const glBefore = await page.evaluate(() => window.__gl);

    await aimAt(page, 'two-layers');

    assert.equal(
      await page.evaluate(() => document.querySelector('#viewCube cubus-cube')?.dataset.mark ?? 'gone'),
      'before',
      'the 3D element must be the same one — a rebuild would tear down the walk a child is following',
    );
    assert.equal(await page.evaluate(() => window.__gl), glBefore,
      'and no new WebGL context: one per render is the defect screen-swap.test.mjs was written for');
    // And the transport is still the transport, rather than a fresh screen's.
    assert.equal(await page.locator('#prevBtn').count(), 1);
  } finally {
    assert.deepEqual(errors.map(String), [], 'the page must raise nothing');
    await context.close();
  }
});

test('the target is drawn beside the cube, and goes away with the whole-cube walk', async () => {
  const { page, context, errors } = await openHome();
  try {
    await scrambled(page);
    assert.equal(await page.locator('#stageAim').isVisible(), false,
      'the whole cube needs no picture — it would be a solved cube saying nothing');

    await aimAt(page, 'top-cross');
    assert.equal(await page.locator('#stageAim').isVisible(), true);
    assert.equal(await page.textContent('.state-h'), 'Aiming at the top cross', 'the heading says what the picture is');
    assert.match(await page.textContent('#stageAimSay'), /^Grey doesn’t matter yet\. Hold it with /);
    // ONE PICTURE: the target takes the Initial State net's place, because the card holding both
    // was drawn over the sheet on the small windows (geometry.test.mjs measures every fixture).
    assert.equal(await page.locator('#viewNet').isVisible(), false, 'the Initial State net makes room for the target');
    // The picture must actually be ghosted: `top-cross` fixes 38 of 54 stickers, so 16 are free.
    // A picture with nothing free would be a solved cube wearing the target's name.
    const free = await page.locator('#stageAimNet .sticker.free').count();
    assert.equal(free, 16, 'the top cross leaves sixteen stickers free, and they must read as free');

    // …and back to the whole cube takes it away again.
    await page.click('[data-stage="solved"]');
    await page.waitForFunction(() => document.querySelector('#stageAim')?.hidden === true, null);
    assert.equal(await page.locator('#stageAim').isVisible(), false);
    assert.equal(await page.locator('#viewNet').isVisible(), true, 'and the Initial State net comes back with the whole cube');
    assert.equal(await page.textContent('.state-h'), 'Initial State');
  } finally {
    assert.deepEqual(errors.map(String), [], 'the page must raise nothing');
    await context.close();
  }
});

test('a repair wears no whole-cube furniture, and the switch comes back with the solve', async () => {
  const { page, context, errors } = await openHome();
  try {
    await scrambled(page);
    assert.equal(await page.locator('#walkKindRow').isVisible(), true,
      'the Solution / Lesson switch belongs to the whole-cube walk');

    await aimAt(page, 'first-layer');
    assert.equal(await page.locator('#walkKindRow').isVisible(), false,
      'a repair has no lesson to switch to (§9.4), so the switch must go with it');
    assert.equal(await page.locator('#proveBtn').isVisible(), false,
      'and the native prover proves a WHOLE cube — there is nothing here to ask it about');

    await page.click('[data-stage="solved"]');
    await page.waitForFunction(() => document.querySelector('#walkKindRow')?.hidden === false, null);
    assert.equal(await page.locator('#walkKindRow').isVisible(), true, 'and it comes back with the solve');
  } finally {
    assert.deepEqual(errors.map(String), [], 'the page must raise nothing');
    await context.close();
  }
});

/**
 * A cube the app can believe in, without a camera: `F R' U' F2 B2 L2 F U' L2 B D2 B2` from solved,
 * as facelets.
 *
 * GENERATED, NOT TYPED, and the first version of this fixture was typed. It looked like a
 * scrambled cube and `parseFacelets` refused it, so the app adopted nothing, the chips all read as
 * dashes and the press landed on a screen with no walk at all — a 37-second timeout whose message
 * was about the wait rather than about the cube. A facelet string is 54 characters of constraint;
 * inventing one is inventing a cube that does not exist.
 */
const SCANNED = 'DDDUURFDURDRRRLBBULLFUFFFLLDUUFDDDLRBBUBLRBULFFLFBRBBR';

test('the Restore chips appear after a scan, and press through to a walk', async () => {
  const { page, context, errors } = await openHome();
  try {
    await page.goto(`${BASE}/#/scan`);
    // `attached`, not the default `visible`: the card is hidden and that is the assertion below.
    // Waiting for it to be visible waits sixty seconds for the thing that must not happen yet.
    await page.waitForSelector('#stageCard', { state: 'attached' });
    assert.equal(await page.locator('#stageCard').isVisible(), false,
      'no numbers before a cube — a distance about a cube nobody has read is a distance about nothing');

    // The event a finished scan fires, with the model and the camera left out. `scan-complete` is
    // what the app listens to; dispatching it drives the real handler, the real adoption and the
    // real chip painter.
    await page.evaluate((facelets) => {
      document.querySelector('ai-scan-panel').dispatchEvent(new CustomEvent('scan-complete', {
        detail: { facelets, rotations: [0, 0, 0, 0, 0, 0] },
      }));
    }, SCANNED);

    await page.waitForFunction(() => document.querySelector('#stageCard')?.hidden === false, null);
    assert.equal(await page.locator('.stage-chip').count(), 6, 'five stages and the whole cube (§6)');

    // Every chip must settle on something a person can read. `…` is the waiting state and must not
    // survive: a chip that never resolves is worse than a dash, because a dash says so.
    await page.waitForFunction(
      () => [...document.querySelectorAll('.stage-chip .howfar')].every((el) => el.textContent !== '…'),
      null,
      { timeout: 60_000 },
    );
    const faces = await page.locator('.stage-chip .howfar').allTextContents();
    for (const face of faces) {
      assert.match(face, /^(done|—|≥ \d+|\d+)$/, `a chip reading "${face}" is none of the five states`);
    }
    // And the accessible name says WHICH KIND of fact it is, in words — the five states are
    // visually distinct, and a state carried by colour alone is not distinct to everybody.
    const labels = await page.locator('.stage-chip').evaluateAll(
      (els) => els.map((el) => el.getAttribute('aria-label')),
    );
    for (const label of labels) {
      assert.match(label, /: (done|at least \d+ moves?|the shortest way back|a way back|couldn)/,
        `"${label}" does not say what kind of fact it is`);
    }

    // THE PRESS. It carries the target to the cube screen, which is where a walk lives.
    await page.click('[data-target="two-layers"]');
    await page.waitForFunction(() => location.hash === '#/home', null);
    await page.waitForFunction(
      () => /way back|couldn’t/.test(document.querySelector('#moveCount')?.textContent ?? ''),
      null,
      { timeout: 30_000 },
    );
    assert.equal(await page.getAttribute('[data-stage="two-layers"]', 'aria-pressed'), 'true',
      'the screen must arrive showing the target that was pressed');
    assert.ok((await page.locator('.chip-m').count()) > 0, 'and with a walk to follow');
  } finally {
    assert.deepEqual(errors.map(String), [], 'the page must raise nothing');
    await context.close();
  }
});

test('an untrusted cube produces no live number, and never touches the route\'s count', async () => {
  // TWO OF §5's CORRECTIONS AT ONCE, behaviourally.
  //
  //   * the gate is `chainTrusted()`, not `cubeRefused()`. A cube reporting through the seam here
  //     has never been read by a camera, so trust was never granted — and `cubeRefused()` would
  //     say nothing about that, because no verdict was ever set. A live number over it would be
  //     advice about a cube nobody has established.
  //   * the live path writes its own line. `#moveCount` reports progress against THIS route's
  //     total, and a live distance written into it would make one label mean two things — which is
  //     the failure a source assertion can describe and only a running app can demonstrate.
  const { page, context, errors } = await openHome();
  try {
    await scrambled(page);
    await aimAt(page, 'cross');
    const said = await page.textContent('#moveCount');

    await page.evaluate((facelets) => {
      window.cubusFeed.useConnection({ mac: 'AA:BB:CC:DD:EE:FF', name: 'Test cube' });
      window.cubusFeed.facelets(facelets, 1);
      window.cubusFeed.facelets(facelets, 2);
    }, SCANNED);
    // Long enough for a reply to have come back and be dropped, rather than merely not sent yet.
    await page.waitForTimeout(1500);

    assert.equal(await page.textContent('#moveCount'), said,
      'the route\'s own count must be exactly what it was — the live path has its own line');
    assert.equal((await page.textContent('#stageLive')).trim(), '',
      'an untrusted cube produces no number at all, rather than a number nobody should act on');
  } finally {
    assert.deepEqual(errors.map(String), [], 'the page must raise nothing');
    await context.close();
  }
});

/**
 * A cube whose first two layers — the WHITE layer and the middle — are already done:
 * `R D R' D R D2 R'` from solved, which is the Sune made on the yellow face with the cube held the
 * way the app scans it (white up). Held tumbled (ADR 0003) it is `R U R' U R U2 R'` on the top.
 *
 * Every OLL and PLL algorithm preserves the first two layers by construction, which makes this the
 * cheapest way to build a cube that satisfies a stage target and is not solved. It used to be the
 * Sune on U, which keeps the YELLOW two layers and was "done" only while the stages were measured
 * in the scan frame.
 */
const TWO_LAYERS_DONE = 'UUUUUUUUURRRRRRLLDFFFFFFRRBBDDDDDRDFLLLLLLFFDBBBBBBLBD';

test('a cube already at the target is told so, and is handed no walk to follow', async () => {
  // §9a's edge case, end to end: "already at the target, where the answer is empty and an empty
  // route must never render as a walk". Both halves are here — the sentence, and the list, which
  // would otherwise be a heading with an empty space under it and read as a list that failed.
  const { page, context, errors } = await openHome();
  try {
    await page.goto(`${BASE}/#/scan`);
    await page.waitForSelector('#stageCard', { state: 'attached' });
    await page.evaluate((facelets) => {
      document.querySelector('ai-scan-panel').dispatchEvent(new CustomEvent('scan-complete', {
        detail: { facelets, rotations: [0, 0, 0, 0, 0, 0] },
      }));
    }, TWO_LAYERS_DONE);
    await page.waitForFunction(() => document.querySelector('#stageCard')?.hidden === false, null);

    // The chip says it in one word before anything is pressed.
    await page.waitForFunction(
      () => document.querySelector('[data-target="two-layers"] .howfar')?.textContent === 'done',
      null,
      { timeout: 60_000 },
    );
    assert.match(await page.getAttribute('[data-target="two-layers"]', 'aria-label'), /: done$/);

    await page.click('[data-target="two-layers"]');
    await page.waitForFunction(() => location.hash === '#/home', null);
    await page.waitForFunction(
      () => /already at/.test(document.querySelector('#moveCount')?.textContent ?? ''),
      null,
      { timeout: 30_000 },
    );
    assert.match(await page.textContent('#moveCount'), /already at the two bottom layers/);
    assert.equal(await page.locator('.chip-m').count(), 0, 'there are no moves, so there are no chips');
    assert.match(await page.textContent('#solList'), /Nothing to do here/,
      'and the list says so, rather than being an empty space under a heading');
  } finally {
    assert.deepEqual(errors.map(String), [], 'the page must raise nothing');
    await context.close();
  }
});

// ---- calling a repair off — audit row 44b -------------------------------------------------------
//
// A superseded repair used to run out its whole budget on the pool's first worker — the thread
// every stage question and a pooled solve's first slice share. It is called off now by STOP_NOW in
// a word its running search polls (lib/solve-client.js). test/stage-protocol.test.mjs pins each
// piece of that on ONE thread: a word raised before the search, or by a fake engine between polls.
// This case is the crossing itself: a real module worker, a SharedArrayBuffer the page and the
// worker both hold, and a search already running when the page writes the word.

test('a repair called off mid-search lets go of its worker', async () => {
  const { NODE_BUDGET, STOP_POLL, solveToState } = await import('../../lib/stage-distance.js');
  const { parseFacelets } = await import('../../lib/two-phase.js');
  const page = pace(await browser.newPage());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));
  try {
    await page.goto(`${BASE}/index.html`);
    const out = await page.evaluate(async ({ facelets, budget }) => {
      if (typeof SharedArrayBuffer === 'undefined' || self.crossOriginIsolated !== true) {
        return { isolated: false };
      }
      const { createParallelSolveClient, spawnSolveWorker } = await import('/lib/solve-client.js');
      const { VIEW_COUNT } = await import('/lib/solver-engine.js');
      // The pool as lib/solver-service.js builds it, on threads of its own: the app's pool rolls
      // the die's next scramble at boot, and nothing here may queue behind that.
      let spawned = 0;
      const pool = createParallelSolveClient({
        spawn: () => { spawned += 1; return spawnSolveWorker(); },
        workers: 2,
        viewCount: VIEW_COUNT,
        makeShared: () => new Int32Array(new SharedArrayBuffer(4)),
      });
      // The whole cube, from a twelve-turn scramble: a target the repair budget does not reach,
      // which is what makes this a search long enough to call off. The precondition says so.
      const solved = (nodeBudget, signal) => pool.stageRoute({
        want: 'route', target: 'solved', facelets, nodeBudget, maxDepth: 14, signal,
      });
      const clock = () => performance.now();
      try {
        // Every distance table built and the search run once, so nothing below times a warm-up.
        await pool.stageRoute({ want: 'bounds', facelets });
        await solved(Math.floor(budget / 8), new AbortController().signal);
        // HOW LONG A REQUEST TAKES TO GET THERE AND BACK, with no search in it: a `bounds` read is a
        // table lookup. The worst of a few, because it is the slowest delivery that matters below.
        let trip = 0;
        for (let i = 0; i < 4; i += 1) {
          const t0 = clock();
          await pool.stageRoute({ want: 'bounds', facelets });
          trip = Math.max(trip, clock() - t0);
        }
        // Unstopped, with a word nobody raises: the same request, and how long it holds the worker.
        let from = clock();
        const full = await solved(budget, new AbortController().signal);
        const fullMs = clock() - from;
        // Called off an eighth of the way through THE SEARCH — measured from when the search can have
        // started, not from when it was posted. The budget is about 80 ms of work, so an eighth of
        // `fullMs` alone is some 10 ms, and a message reaching a worker while three browsers run at
        // once can take longer than that: the word was then up before the search read node zero, and
        // the case failed on its own precondition rather than on anything the product did (seen once
        // in the full tier, 2026-09-17). Both terms stretch together on a slow machine, which is the
        // reasoning the wall-clock assertion below already rests on.
        const walk = new AbortController();
        const asked = solved(budget, walk.signal);
        await new Promise((resolve) => { setTimeout(resolve, trip + Math.max(0, fullMs - trip) / 8); });
        from = clock();
        walk.abort();
        // Posted while the stopped search still holds the worker, so the worker reads it only once
        // that search has returned.
        const next = pool.stageRoute({
          want: 'route', target: 'cross', facelets, nodeBudget: 400_000, maxDepth: 10,
        });
        const stopped = await asked;
        const answered = await next;
        const freedMs = clock() - from;
        return { isolated: true, spawned, full, fullMs, trip, stopped, answered, freedMs };
      } finally {
        pool.cancel();
      }
    }, { facelets: SCANNED, budget: NODE_BUDGET });

    assert.equal(out.isolated, true,
      'the page is not cross-origin isolated, so no stop word can be shared with a worker');
    // THE PRECONDITION, in nodes: unstopped, this request holds its worker for the whole budget.
    assert.deepEqual([out.full.why, out.full.nodes], ['budget', NODE_BUDGET],
      'unstopped, the search did not run out its budget, so there is nothing here to call off');
    // CALLED OFF — and said so, rather than blamed on the budget.
    assert.equal(out.stopped.why, 'stopped',
      `called off, the search ran on to "${out.stopped.why}" after ${out.stopped.nodes} nodes`);
    assert.equal(out.stopped.moves, null, 'a stopped search has no route to offer');
    // WHILE IT RAN. The first poll is at node zero, so a word up before the search began stops it
    // there; a positive multiple of STOP_POLL is a running search that the word reached at a poll.
    assert.ok(out.stopped.nodes > 0, `the word was up before the search began, not during it`
      + ` (a round trip took up to ${Math.round(out.trip)} ms against ${Math.round(out.fullMs)} ms for the whole budget)`);
    assert.equal(out.stopped.nodes % STOP_POLL, 0,
      `${out.stopped.nodes} nodes is not a poll, so the word is not what stopped the search`);
    // An eighth of the way in by the clock; half the budget leaves the two runs' speeds a factor
    // of four to differ by before this bound is reached.
    assert.ok(out.stopped.nodes <= NODE_BUDGET / 2,
      `called off an eighth of the way in, the search still spent ${out.stopped.nodes} nodes`);
    // AND ITS WORKER IS FREE: the next request, read only after the stopped search returned, is
    // answered as the engine answers it, on the one thread the pool ever spawned for a repair.
    const direct = solveToState('cross', parseFacelets(SCANNED), {
      nodeBudget: 400_000, maxDepth: 10,
    });
    assert.deepEqual([out.answered.alg, out.answered.exact], [direct.alg, true],
      'the worker that was called off did not answer the next repair as the engine does');
    assert.equal(out.spawned, 1,
      'a thread was ended and replaced — calling a repair off must keep the one it runs on');
    // THE ONE WALL-CLOCK ASSERTION, and why a stop that works cannot fail it. The worker is free
    // after one STOP_POLL of search and a cross route; left grinding, it is free only after the
    // remaining seven eighths of `fullMs`. The bound is half of `fullMs`, read off the same clock
    // on the same page, so a slow machine stretches the bound along with the work.
    assert.ok(out.freedMs < out.fullMs / 2,
      `the next repair was answered ${Math.round(out.freedMs)} ms after the call-off, against`
      + ` ${Math.round(out.fullMs)} ms for the whole budget`);
  } finally {
    assert.deepEqual(errors.map(String), [], 'the page must raise nothing');
    await page.close();
  }
});

// ---- which way up — ADR 0003 ----------------------------------------------------------------------
//
// White-first. The cross and the first layer are built white up, green facing you; once the first
// layer is complete the cube tumbles forward — white underneath, green at the back — for everything
// after it (the lesson course's ADR 0002). These cases drive the real screen and then check the
// claim a child depends on with cubejs, off the stickers themselves: that the chips, made on the
// cube the way the screen says to hold it, build the WHITE layers.

const SOLVED_FACELETS = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';

function applyMoves(facelets, alg) {
  const cube = Cube.fromString(facelets);
  if (String(alg).trim()) cube.move(alg);
  return cube.asString();
}

/** What the renderer was handed to walk: its moves, and where they start. */
async function walkOnScreen(page) {
  const got = await page.evaluate(() => {
    const cube = document.querySelector('#viewCube cubus-cube');
    return { facelets: cube.getAttribute('facelets'), scramble: cube.getAttribute('scramble'), alg: cube.getAttribute('alg') ?? '' };
  });
  // A walk with a verified setup is drawn from solved plus that setup; a repair, from its facelets.
  return { alg: got.alg, start: got.facelets ?? applyMoves(SOLVED_FACELETS, got.scramble ?? '') };
}

/** The white cross, on top, in the scan frame — U edges home. Read off the stickers, not a predicate. */
const WHITE_CROSS = [[1, 'U'], [3, 'U'], [5, 'U'], [7, 'U'], [10, 'R'], [19, 'F'], [37, 'L'], [46, 'B']];
/** The top row of each side face, and the top two rows — the white layer, and it with the middle. */
const TOP_ROW = [9, 10, 11, 18, 19, 20, 36, 37, 38, 45, 46, 47];
const TWO_ROWS = [...TOP_ROW, 12, 13, 14, 21, 22, 23, 39, 40, 41, 48, 49, 50];
/** Is every listed sticker its own face's colour? A sticker's face is its index / 9, in URFDLB. */
const home = (facelets, at) => facelets[at] === 'URFDLB'[Math.floor(at / 9)];

/** Wait until the app has ASKED for `spec` and the renderer has actually FINISHED turning to it. */
async function settledHold(page, spec) {
  await page.waitForFunction((want) => {
    const cube = document.querySelector('#viewCube cubus-cube');
    return cube?.dataset.hold === want && cube._turn?.to === want && cube._turn.phase === 1;
  }, spec, { timeout: 10_000 });
}

const chipTexts = (page) => page.locator('.chip-m').allTextContents();

test('a stage target chosen on Home does not follow the child onto the Scramble screen', async () => {
  // `state.stageTarget` outlives the screen it was chosen on, and the cube screen's two modes share
  // one mount. The Scramble screen's walk is never a repair, so a target set on Home must draw no
  // aim there, hide nothing, and turn nothing — or its "Target State" net is replaced by a picture
  // of a stage the scramble has nothing to do with, under a heading naming that stage.
  const { page, context, errors } = await openHome();
  try {
    await scrambled(page);
    await aimAt(page, 'two-layers');
    await settledHold(page, 'D B');

    await page.evaluate(() => { location.hash = '#/scramble'; });
    await page.waitForFunction(() => location.hash === '#/scramble', null);
    await page.waitForFunction(() => document.querySelectorAll('.chip-m').length > 0, null, { timeout: 60_000 });
    await settledHold(page, 'U F');
    assert.equal(await page.locator('#stageAim').isVisible(), false, 'no aim on a scramble walk');
    assert.equal(await page.locator('#viewNet').isVisible(), true, 'the scramble keeps its own net');
    assert.equal(await page.textContent('.state-h'), 'Target State', 'and its own heading');
  } finally {
    assert.deepEqual(errors.map(String), [], 'the page must raise nothing');
    await context.close();
  }
});

test('a tumbled stage turns the CUBE over, and every chip is named for how it is held', async () => {
  const { page, context, errors } = await openHome();
  try {
    await scrambled(page);
    await settledHold(page, 'U F');
    let walk = await walkOnScreen(page);
    assert.deepEqual(await chipTexts(page), walk.alg.split(' '),
      'the whole cube is held as scanned, so its chips are exactly its moves');

    await aimAt(page, 'two-layers');
    await settledHold(page, 'D B');
    walk = await walkOnScreen(page);
    assert.notEqual(walk.alg, '', 'a scrambled cube is not already at the two bottom layers');
    assert.equal(await page.getAttribute('#viewCube cubus-cube', 'camera-up'), null,
      'and the camera did not move to show it — the eye moving is the defect this replaced');
    assert.deepEqual(await chipTexts(page), renameAlg(walk.alg, TUMBLED).split(' '),
      'every chip is the renderer\'s move, named for the tumbled hold');
    assert.match(await page.textContent('#stageAimSay'), /Hold it with white underneath and green at the back\./);

    // THE PHYSICAL CLAIM. The route builds the white layer and the middle — the scan frame's whole U
    // face and the top two rows of every side — and the chips, made on the cube as a child holds it,
    // land on that same cube held the same way.
    const end = applyMoves(walk.start, walk.alg);
    assert.equal(end.slice(0, 9), 'UUUUUUUUU', 'the white face is complete');
    for (const at of TWO_ROWS) assert.ok(home(end, at), `sticker ${at} of the first two layers`);
    assert.equal(
      applyMoves(turnFacelets(walk.start, ...TUMBLED), (await chipTexts(page)).join(' ')),
      turnFacelets(end, ...TUMBLED),
    );

    // THE FIRST LAYER IS BUILT WHITE UP, and the cube is turned over only once it is complete — so
    // aiming at it turns the cube back, and its chips are its moves as they are.
    await aimAt(page, 'first-layer');
    await settledHold(page, 'U F');
    walk = await walkOnScreen(page);
    assert.deepEqual(await chipTexts(page), walk.alg.split(' '), 'the first layer is built white up, so its chips are its moves');
    assert.match(await page.textContent('#stageAimSay'), /Hold it with white on top and green facing you\./);
    const layerEnd = applyMoves(walk.start, walk.alg);
    assert.equal(layerEnd.slice(0, 9), 'UUUUUUUUU', 'the first layer the chips build is the WHITE one, on top');
    for (const at of TOP_ROW) assert.ok(home(layerEnd, at), `sticker ${at} of the white layer`);

    await aimAt(page, 'cross');
    await settledHold(page, 'U F');
    walk = await walkOnScreen(page);
    assert.deepEqual(await chipTexts(page), walk.alg.split(' '), 'the cross is built white up, so its chips are its moves');
    assert.match(await page.textContent('#stageAimSay'), /Hold it with white on top and green facing you\./);
    const crossEnd = applyMoves(walk.start, walk.alg);
    for (const [at, face] of WHITE_CROSS) {
      assert.equal(crossEnd[at], face, `sticker ${at}: the cross the chips build is the WHITE one, on top`);
    }
  } finally {
    assert.deepEqual(errors.map(String), [], 'the page must raise nothing');
    await context.close();
  }
});

test('a lesson builds its white cross and first layer white up, then turns the cube over once and says how to hold it', async () => {
  const { page, context, errors } = await openHome();
  try {
    await scrambled(page);
    await page.click('[data-walk="lesson"]');
    await page.waitForFunction(() => document.querySelectorAll('#solList .move-chips').length > 1, null, { timeout: 30_000 });
    const walk = await walkOnScreen(page);
    const moves = walk.alg.split(' ');
    const sections = await page.evaluate(() => [...document.querySelectorAll('#solList .move-chips')]
      .map((s) => ({ heading: s.previousElementSibling?.textContent ?? '', chips: [...s.querySelectorAll('.chip-m')].map((c) => c.textContent) })));
    assert.match(sections[0].heading, /^Cross/, 'the first section is the cross');
    const crossCount = sections[0].chips.length;
    assert.ok(crossCount > 0, 'a scrambled cube has a cross to build');

    // The hold of every move, worked out the way the app works it out — from the method solver's own
    // steps, fed the method frame — so this also proves the lesson on screen IS that solver's lesson.
    const { steps } = solveByMethod(fromCube(Cube.fromString(toMethodFrame(walk.start))), methodFor());
    const index = moveStepIndex(steps);
    const heldAt = moves.map((_, k) => holdSpec(holdForStage(steps[stepAtMove(index, k)].stage)));
    const stages = new Set(steps.map((s) => s.stage));
    assert.ok(stages.has('first-layer') && stages.has('middle-layer'),
      `the default rungs build the first layer on its own, or the flip point is not being tested: ${[...stages]}`);
    const flipAt = heldAt.indexOf('D B');
    assert.ok(flipAt > crossCount, 'the cube is turned over after the first layer, not after the cross');
    assert.ok(heldAt.slice(flipAt).every((h) => h === 'D B'), 'and it is turned over once, never back');
    // A chip is named for the hold its own move is made in: the stage's, turned by every regrip before it
    // in the middle layer (plan items 6.1 and 6.2) — the lesson's own record, worked out as the app works it.
    const { holds } = scanFrameWalk(steps);
    assert.deepEqual(sections.flatMap((s) => s.chips), moves.map((m, k) => renameAlg(m, holds[k])),
      'every chip is named for the hold its own move is made in');

    // Off the stickers: the white cross on top after the cross section, and the whole white layer on
    // top at the moment the cube is turned over.
    const afterCross = applyMoves(walk.start, moves.slice(0, crossCount).join(' '));
    for (const [at, face] of WHITE_CROSS) {
      assert.equal(afterCross[at], face, `sticker ${at}: the lesson's cross is the WHITE one, on top`);
    }
    const atFlip = applyMoves(walk.start, moves.slice(0, flipAt).join(' '));
    assert.equal(atFlip.slice(0, 9), 'UUUUUUUUU', 'the first layer is the WHITE one, finished on top before the turn');
    for (const at of TOP_ROW) assert.ok(home(atFlip, at), `sticker ${at} of the white layer at the turn`);

    // The first step is a cross step, and it points at a WHITE edge — which the scan frame names U*.
    // The solver names it D* in its own frame; unrenamed, the pulse would sit on a yellow edge.
    await settledHold(page, 'U F');
    const lit = (await page.getAttribute('#viewCube cubus-cube', 'highlight')) ?? '';
    const pieces = lit.split(',').filter((token) => token.startsWith('piece:'));
    assert.ok(pieces.length > 0, `the first step must point at something — "${lit}"`);
    for (const token of pieces) assert.match(token, /U/, `${token}: a cross step points at a white edge`);

    // The head on the first tumbled move: the cube turns over, and the line says how to hold it.
    await page.click(`.chip-m[data-i="${flipAt - 1}"]`);
    await settledHold(page, 'D B');
    assert.match(await page.textContent('#whyLine'), /Hold it with white underneath and green at the back\./);
    // And back across the line turns it back, because a scrub goes both ways.
    await page.click('#prevBtn');
    await settledHold(page, 'U F');
  } finally {
    assert.deepEqual(errors.map(String), [], 'the page must raise nothing');
    await context.close();
  }
});
