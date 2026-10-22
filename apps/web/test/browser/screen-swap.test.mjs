// What a screen swap must never put on the paper — measured in a real WebKit.
//
// Pressing Random on Home does not navigate anywhere: it changes which cube the screen is about.
// It was reported as "the page jitters once", and the jitter turned out to be three separate
// things, each of which this file pins because each is invisible to every text test:
//
//   1. TWO Kociemba searches for one cube. randomScramble() solves a random state to get the
//      scramble alg; deriveCube() then solved the SAME state for the SAME alg. Both ran on the
//      click, between the old paint and the new one — measured at 2–91ms each in this engine.
//   2. A PRESENTED FRAME WITH AN EMPTY SOLUTION. The screen was replaced first and solved second,
//      so one whole composited frame showed the new cube beside an empty chip grid and a count
//      reading "working…". That blink is what a user sees.
//   3. A FIRST DRAWING FRAMED FOR THE WRONG VIEW. The cube's ghosts/elevation/camera were set
//      after appendChild, and connectedCallback draws immediately — so the element's first
//      drawing was fitted to a cube with no ghost faces, which is a visibly larger picture. It
//      never reached the screen only because the element's own animation frame happened to run
//      later in the same frame as the mount. That is the engine's ordering, not ours.
//   4. A WEBGL CONTEXT BUILT PER RENDER. <cubus-cube> disposed on the way out of the DOM and
//      returned early on the way back in, so it could never be re-inserted and every screen
//      render built a new one — 21-24ms and a fresh context, for the same picture. It is parked
//      and re-used now, which is only safe while a re-used element arrives carrying nothing from
//      the screen before it: no attributes, and no listener still driving that screen's DOM.
//
//   5. A SCREEN REBUILT TO CHANGE ITS SUBJECT. Pressing Random does not navigate anywhere — it
//      changes which cube the screen is about — but the only way to make a new cube take effect
//      was to re-enter the screen, which destroys and rebuilds every node in it. The screen
//      retargets in place now, so the last group of tests here is about a rebuild that must NOT
//      happen, and about everything a retarget has to reset for that to be safe.
//
// Every assertion here is about a frame that must NOT exist, or a search that must NOT run — the
// habit that mattered most on the driver. A version of this file that only checked "the chips are
// there in the end" would have passed against all three defects.
//
// It fails loudly without the browser: `pnpm exec playwright install webkit` (CI does this).

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { pace } from '../browser-wait.mjs';
import { freePort } from '../free-port.mjs';
import { CONTRACT_CUBES } from '../fixtures/solver-cubes.mjs';
import { launchBrowser, LIVENESS_MS } from './harness.mjs';
import { fakeScan } from './fake-scan.mjs';

// Asked of the OS in before(), not chosen: a fixed port collides with an orphaned server
// from an interrupted run, which fails at startup and reads like a regression. See free-port.mjs.
let PORT;
let BASE;
const SERVE = fileURLToPath(new URL('../../serve.mjs', import.meta.url));
let proc;
let browser;

before(async () => {
  PORT = await freePort();
  BASE = `http://127.0.0.1:${PORT}`;
  proc = spawn(process.execPath, [SERVE], { env: { ...process.env, PORT: String(PORT), CUBUS_LIVE_RELOAD: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    // Say WHY it did not start. serve.mjs refuses a busy port with a precise message naming the
    // port and how to free it, but that goes to its own stderr, so a bare timeout here reads as a
    // regression in whatever changed last. An interrupted run leaves the server orphaned and every
    // later run then fails this way — it cost two wrong diagnoses on 2026-08-30 before anyone read
    // the child's output. Fail loud: hand the child's own words back.
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
    browser = await launchBrowser('webkit');
  } catch (cause) {
    throw new Error('WebKit for Playwright is not installed — run: pnpm --filter cubus-web exec playwright install webkit', { cause });
  }
});

after(async () => {
  await browser?.close();
  proc?.kill('SIGTERM');
});

/** Home with the developer die showing — the button the report was about. A desktop landscape
 *  window, the shape the layout contract's own fixture table calls the desktop reference.
 *
 *  `solveTier` is a parameter because one test here needs the answer to take REAL TIME: the
 *  default rung is met in single-digit milliseconds, which resolves inside one frame and hides
 *  every intermediate state a frame sampler exists to catch. */
async function openHome({ solveTier = 'twenty' } = {}) {
  const context = await browser.newContext({ viewport: { width: 840, height: 682 } });
  const page = await context.newPage();
  pace(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));
  await page.addInitScript((tier) => {
    localStorage.setItem('cubusSettings', JSON.stringify({
      theme: 'auto', palette: 'muted', autosolve: false, cameraId: '', navHidden: [],
      navDefaults: 99, devRandCube: true, language: '', dragRotate: false, solveTier: tier,
    }));
    // Installed before the app runs, so nothing escapes the count.
    window.__gl = 0;
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
      if (String(kind).startsWith('webgl')) window.__gl += 1;
      return getContext.call(this, kind, ...rest);
    };
    // How many handlers a 'cubus-step' actually reaches. Counting registrations would not do:
    // a listener scoped to an AbortSignal is dropped without removeEventListener being called,
    // so the only honest measure of "is the old one still there" is whether it still runs.
    window.__steps = 0;
    const addEventListener = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, fn, opts) {
      if (type !== 'cubus-step' || typeof fn !== 'function') return addEventListener.call(this, type, fn, opts);
      return addEventListener.call(this, type, (...a) => { window.__steps += 1; return fn(...a); }, opts);
    };
  }, solveTier);
  await page.goto(`${BASE}/#/home`);
  await page.waitForSelector('#randCube');
  // The die does nothing until the solver's tables are built, and boot loads them in the
  // background. Wait for a press to actually land rather than racing it.
  await page.waitForFunction(() => document.querySelector('#viewCube cubus-cube') !== null, null);
  return { page, context, errors };
}

/** The scramble the walk on screen is drawn from: the walk's identity. Pressing Random always draws a
 *  different state (uniformly, from 4.3e19), so a different scramble IS a different walk. */
const SCRAMBLE_NOW = `document.querySelector('#viewCube cubus-cube')?.getAttribute('scramble') ?? null`;
const scrambleNow = (page) => page.evaluate(SCRAMBLE_NOW);

/**
 * Wait until a press of the die is over: a walk drawn from a scramble other than `prev`, its list on the
 * screen, and the die let go. Every part becomes true BECAUSE of the press — the die is held from before
 * the roll until the walk it loads is on screen (lib/screens/cube/die.js), so a released die with a new
 * scramble is the end of everything the press does on this thread.
 *
 * WAIT FOR THE CHANGE, NOT FOR A CONDITION ALREADY TRUE (found by the full gate, 2026-09-25, and again
 * by a verify pass, 2026-10-22). Move chips alone are already on the screen after the first press, so
 * a wait on them returned before the new cube had landed and a sleep did the real waiting: under a
 * loaded gate the sleep lost, and a press made while the die was still held did nothing at all.
 */
const pressLanded = (page, prev) => page.waitForFunction((was) => {
  const el = document.querySelector('#viewCube cubus-cube');
  const die = document.querySelector('#randCube');
  return el !== null && el.getAttribute('scramble') !== was
    && document.querySelectorAll('#solList .chip-m').length > 0 && die !== null && !die.disabled;
}, prev);

/** Press the die and settle on the screen it produces. */
async function press(page) {
  const before = await scrambleNow(page);
  await page.click('#randCube');
  await pressLanded(page, before);
}

/** Press the tab for `id` and wait until the screen it asks for is on the paper.
 *
 *  Not a sleep: this was a fixed 700–900 ms, and the hash is set at once while the screen being
 *  left stays `.screen.active` until the route is applied (AGENTS.md §5). A route that landed
 *  late had every check after the sleep read whichever screen happened to be up, so "navigating
 *  rebuilt the renderer" could pass about screens that were never visited. The root on the paper
 *  before the press is refused too: a tab for the screen already showing re-renders it in place
 *  (`go()` → `applyRoute`), and `data-screen` alone would already be true. */
async function navTo(page, id) {
  const before = await page.evaluateHandle(() => document.querySelector('.screen.active'));
  await page.click(`[data-nav="${id}"]`);
  await page.waitForFunction(([was, want]) => {
    const now = document.querySelector('.screen.active');
    return now !== was && now?.dataset.screen === want;
  }, [before, id], { timeout: LIVENESS_MS });
  await before.dispose();
}

/** Record, once per animation frame, exactly what a composited frame would show. A rAF callback
 *  registered before the click runs at the top of the rendering steps, so what it reads is what
 *  that frame paints. */
const SAMPLER = `(() => {
  window.__frames = [];
  window.__framesStop = false;
  const t0 = performance.now();
  const snap = () => {
    window.__frames.push({
      t: +(performance.now() - t0).toFixed(1) + 0,
      solutionCard: Boolean(document.querySelector('.solution-card')),
      chips: document.querySelectorAll('.chip-m').length,
      count: document.querySelector('#moveCount')?.textContent ?? null,
      cubes: document.querySelectorAll('#viewCube cubus-cube').length,
    });
    if (!window.__framesStop) requestAnimationFrame(snap);
  };
  requestAnimationFrame(snap);
})()`;

/** Stop the sampler once `more` frames have been presented after the moment this is called, and hand
 *  back every frame it saw. Counted from NOW, so the frames it waits for are frames after the event the
 *  caller has just waited on — never a wall-clock window that a slow press can outrun. */
async function framesAfter(page, more, key = '__frames', stop = '__framesStop') {
  const now = await page.evaluate((k) => window[k].length, key);
  await page.waitForFunction(([k, n]) => window[k].length >= n, [key, now + more]);
  return page.evaluate(([k, s]) => { window[s] = true; return window[k]; }, [key, stop]);
}

test('no press runs a Kociemba search on the UI thread — at the press or after it', async () => {
  const { page, context, errors } = await openHome();
  try {
    // The page and lib/app.js resolve the same specifier, so this is the very prototype the app
    // calls on THIS thread. The worker has its own module instance and its own prototype, which
    // is exactly what makes the count meaningful: anything it sees is a search the user waits on.
    await page.evaluate(`(async () => {
      const Cube = (await import('/vendor/cubejs.js')).default;
      window.__searches = 0;
      const real = Cube.prototype.solve;
      Cube.prototype.solve = function (...a) { window.__searches += 1; return real.apply(this, a); };
    })()`);
    // Counted from the first press on. A sleep here once waited out the scramble worker's own
    // Kociemba tables, during which the app rolled on this thread; that worker is gone and a roll is
    // a solve in the pool (lib/scramble-roll.js), so there is no warm-up for this claim to exclude.
    await press(page);

    for (const nth of ['first', 'second', 'third']) {
      const { duringClick, before } = await page.evaluate(`(() => {
        const before = ${SCRAMBLE_NOW};
        document.querySelector('#randCube').click();
        return { duringClick: window.__searches, before };
      })()`);
      assert.equal(duringClick, 0, `the ${nth} press searched ${duringClick} time(s) while the user waited — the cube should already have been rolled`);
      // The press's own walk, never the chips the last one left: each press is over before the next.
      await pressLanded(page, before);
    }
    const total = await page.evaluate(() => window.__searches);
    assert.equal(total, 0, `${total} Kociemba searches ran on the UI thread across four presses; rolling is the worker's job and solving is not needed at all`);
    assert.deepEqual(errors.map(String), [], 'the page threw');
  } finally {
    await context.close();
  }
});

test('with no Worker at all the die still works — slower, never wrong', async () => {
  // The worker is an optimisation, and an optimisation that can take the app down is a defect.
  // A platform without Worker (or one where it fails to start) must fall back to rolling here.
  const context = await browser.newContext({ viewport: { width: 840, height: 682 } });
  const page = await context.newPage();
  pace(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));
  try {
    await page.addInitScript(() => {
      localStorage.setItem('cubusSettings', JSON.stringify({
        theme: 'auto', palette: 'muted', autosolve: false, cameraId: '', navHidden: [],
        navDefaults: 99, devRandCube: true, language: '', dragRotate: false,
      }));
      // Surgical: only the app's own solver worker is denied, so anything else that builds
      // one is unaffected. Rolling a scramble IS a solve now — the separate scramble worker
      // was removed once the solver pool could do the job — so this is the worker the die
      // depends on, and denying it is what forces the on-thread path.
      const RealWorker = window.Worker;
      window.Worker = function (url, opts) {
        if (String(url).includes('solve-worker')) throw new Error('Worker disabled for this test');
        return new RealWorker(url, opts);
      };
      // The inline fallback announces that searches now block the page. Captured, because it
      // is the only evidence available that the fallback was actually taken.
      window.__warned = [];
      const realWarn = console.warn;
      console.warn = (...a) => { window.__warned.push(a.map(String).join(' ')); realWarn(...a); };
    });
    // This test is the slowest in the file by construction: the worker is denied, so cubejs builds
    // its tables and every Kociemba search runs on the main thread. Its own title already accepts
    // that — "slower, never wrong". The wait it needs is the suite's shared liveness bound; see
    // test/browser-wait.mjs for why there is one number rather than one per call site.
    await page.goto(`${BASE}/#/home`);
    await page.waitForSelector('#randCube');
    await page.waitForFunction(() => document.querySelector('#viewCube cubus-cube') !== null, null);
    await page.evaluate(`(async () => {
      const Cube = (await import('/vendor/cubejs.js')).default;
      window.__searches = 0;
      const real = Cube.prototype.solve;
      Cube.prototype.solve = function (...a) { window.__searches += 1; return real.apply(this, a); };
    })()`);

    for (let i = 0; i < 2; i++) {
      await page.click('#randCube');
      await page.waitForFunction(() => document.querySelectorAll('.chip-m').length > 0, null);
    }
    const r = await page.evaluate(`(async () => {
      const Cube = (await import('/vendor/cubejs.js')).default;
      const SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
      const setup = document.querySelector('#viewCube cubus-cube').getAttribute('scramble');
      const chips = [...document.querySelectorAll('.chip-m')].map((c) => c.textContent.trim());
      return { chips: chips.length, solves: Cube.fromString(SOLVED).move(setup).move(chips.join(' ')).isSolved() };
    })()`);
    assert.ok(r.chips > 0, 'with no worker the die produced no moves at all');
    assert.equal(r.solves, true, 'the fallback roll produced a walk that does not solve its cube');
    // Without this the test would pass just as happily if the worker had never been denied.
    // cubejs no longer searches on the roll path, so counting ITS calls proves nothing about
    // the fallback; what does is the inline worker saying out loud that it is blocking.
    const warned = await page.evaluate(() => window.__warned ?? []);
    assert.ok(warned.some((w) => /no Worker|runs on this thread/.test(w)),
      `the worker was not actually denied, so this test proved nothing. Warnings: ${JSON.stringify(warned)}`);
    assert.deepEqual(errors.map(String), [], 'the page threw');
  } finally {
    await context.close();
  }
});

test('no press and no navigation builds a second WebGL context', async () => {
  const { page, context, errors } = await openHome();
  try {
    await press(page);
    const start = await page.evaluate(() => window.__gl);
    assert.equal(start, 1, `${start} WebGL contexts before anything was pressed; one renderer is one context`);

    for (let i = 0; i < 3; i++) await press(page);
    assert.equal(await page.evaluate(() => window.__gl), 1, 'a press rebuilt the renderer — it is meant to be parked and re-used');

    // Away to screens with no cube at all and back: the parked one must outlive them, or coming
    // home from Settings pays for a context every time.
    for (const id of ['timer', 'stats', 'home', 'scramble', 'home']) await navTo(page, id);
    assert.equal(await page.evaluate(() => window.__gl), 1, 'navigating rebuilt the renderer');
    assert.equal(await page.evaluate(() => document.querySelectorAll('cubus-cube').length), 1, 'more than one cube is in the document');
    assert.deepEqual(errors.map(String), [], 'the page threw');
  } finally {
    await context.close();
  }
});

test('a re-used renderer arrives clean, and drives its new screen exactly once', async () => {
  const { page, context, errors } = await openHome();
  try {
    await press(page); // Home: the element gets scramble + alg and a 'cubus-step' listener

    // Onto the scan screen, whose twin is the SAME element with a different job. Anything Home
    // set that this screen does not set must be gone — a leftover `alg` would leave the twin
    // holding a walk through a cube nobody is looking at.
    await navTo(page, 'scan');
    // The twin's state comes from the scan panel's first progress report, a step after the screen
    // lands. Read once it has: a leftover from Home that arrives late (a Home mount coming back
    // from an await) has had that long to show.
    const painted = await page.waitForFunction(
      () => Boolean(document.querySelector('#scanCube > cubus-cube')?.getAttribute('facelets')),
      null, { timeout: LIVENESS_MS },
    ).then(() => true, () => false);
    assert.ok(painted, 'the scan twin was never given a state to paint');
    const onScan = await page.evaluate(() => {
      const el = document.querySelector('#scanCube > cubus-cube');
      return el && { scramble: el.getAttribute('scramble'), alg: el.getAttribute('alg'), facelets: Boolean(el.getAttribute('facelets')) };
    });
    assert.ok(onScan, 'the scan screen has no cube');
    assert.equal(onScan.scramble, null, "the re-used cube still carries Home's scramble");
    assert.equal(onScan.alg, null, "the re-used cube still carries Home's solution");
    assert.ok(onScan.facelets, 'the scan twin was never given a state to paint');

    // Back to Home twice more, then ask the element to announce a step. If the listeners from
    // earlier visits were still on it, one event would reach three handlers.
    for (let i = 0; i < 2; i++) await navTo(page, 'home');
    const delivered = await page.evaluate(() => {
      window.__steps = 0;
      document.querySelector('#viewCube cubus-cube').dispatchEvent(new CustomEvent('cubus-step', { detail: { index: 1, total: 5 } }));
      return window.__steps;
    });
    assert.equal(delivered, 1, `one step reached ${delivered} handlers — listeners from earlier visits are still on the parked element`);
    assert.deepEqual(errors.map(String), [], 'the page threw');
  } finally {
    await context.close();
  }
});

test('no frame is ever presented with the solution card empty', async () => {
  const { page, context, errors } = await openHome();
  try {
    await press(page); // from here on the screen is already walking, and the die is let go

    for (let i = 0; i < 3; i++) {
      await page.evaluate(SAMPLER);
      await press(page);
      // Frames after the walk landed, so a late change still has room to show.
      const frames = await framesAfter(page, 30);
      assert.ok(frames.length >= 30, `only ${frames.length} frames sampled — the press was not observed`);

      const empty = frames.filter((f) => f.solutionCard && f.chips === 0);
      assert.deepEqual(empty, [], 'a composited frame showed the solution card with no moves in it');

      const working = frames.filter((f) => f.count === 'working…');
      assert.deepEqual(working, [], 'a composited frame showed the move count still saying "working…"');

      // The screen is never without its cube either: two would mean the old one outlived the swap.
      const wrongCubes = frames.filter((f) => f.cubes !== 1);
      assert.deepEqual(wrongCubes, [], 'a composited frame had no cube, or two');
    }
    assert.deepEqual(errors.map(String), [], 'the page threw');
  } finally {
    await context.close();
  }
});

// ---- Home after a scan: the count, the list and the cube's size land together ----------------
//
// THE SAME RULE AS THE DIE'S, for the path the die does not take. A scanned cube arrives with no
// answer, so Home searches on the way in, and two things went on the paper before the walk did
// (verify pass, 2026-10-22, reproduced at 575ac788 and cb2979dc):
//
//   - THE COUNT BEFORE THE LIST. `refine` yields its first answer (20) and goes on asking for a
//     shorter one at the bonus budget; the resolver wrote each yield into `#moveCount`, so for
//     20–80 ms the screen said "20" beside an empty move list.
//   - A CUBE THAT SHRANK WHEN THE LIST LANDED. In portrait the move strip took no height until it
//     had a chip, so the whole wait was drawn with a bigger cube (iPhone SE 304 → 220 px, the
//     desktop portrait window 500 → 448) — the cube shrinking in front of the child.
//
// Recorded every frame from the navigation, the way SAMPLER is above. The canvas box is what the
// renderer fits its picture to, and a resize clears it (the CI run that read the cube as 0 px), so
// a box that changes IS a cube drawn at two sizes. A Restore stop and a Scramble roll wait in the
// same `beginWalk`, so the page that has a scanned cube on Home holds them too, one phase each.
const HOME_SCAN_FIXTURES = [
  { name: 'iPhone SE', width: 375, height: 667, insets: '20,0,0,0', touch: true },
  { name: 'desktop portrait window', width: 574, height: 817, insets: '0,0,0,0' },
  { name: 'desktop landscape window', width: 840, height: 682, insets: '0,0,0,0' },
];

const WALK_FRAMES = `(() => {
  window.__walkFrames = [];
  window.__walkStop = false;
  const t0 = performance.now();
  const box = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { w: b.width, h: b.height };
  };
  const snap = () => {
    const screen = document.querySelector('.screen.active');
    window.__walkFrames.push({
      t: +(performance.now() - t0).toFixed(1) + 0,
      screen: screen?.dataset.screen ?? null,
      count: screen?.querySelector('#moveCount')?.textContent ?? null,
      chips: screen ? screen.querySelectorAll('#solList .chip-m').length : 0,
      slot: box(screen?.querySelector('#viewCube')),
      canvas: box(screen?.querySelector('#viewCube canvas')),
    });
    if (!window.__walkStop) requestAnimationFrame(snap);
  };
  requestAnimationFrame(snap);
})()`;

/**
 * HOW LONG A REQUEST TO THE APP'S WORKERS IS HELD while a phase below runs (`HOLD_WORKERS`). A Restore stop's route and a
 * roll can answer inside the frame they were asked in, and then no frame ever shows the wait — so a phase passed with
 * the waiting list's shape reverted (verify pass, 2026-10-22). Holding the requests is the test's own doing: the app
 * is unchanged, and a request that lands late is one a slow machine sends anyway.
 */
const HOLD_MS = 400;
const HOLD_WORKERS = () => {
  window.__holdWorkerMs = 0;
  const post = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function held(...args) {
    const ms = window.__holdWorkerMs;
    if (!ms) return post.apply(this, args);
    setTimeout(() => post.apply(this, args), ms);
    return undefined;
  };
};

/**
 * Every frame from `act` until `landed` says its walk is on screen, and 30 frames after, held to both MUST-NOTs: no
 * count beside an empty list, and no cube at a size other than the one it settles at — and to having SHOWN the wait:
 * at least one frame before the list, or the phase proves nothing about the frames it exists to check. The app's worker
 * requests are held `HOLD_MS` while it runs, so every path waits on the paper.
 */
async function walkLandsWhole(page, fixture, { what, screen, act, landed }) {
  await page.evaluate(WALK_FRAMES);
  await page.evaluate((ms) => { window.__holdWorkerMs = ms; }, HOLD_MS);
  await act();
  await landed();
  await page.evaluate(() => { window.__holdWorkerMs = 0; });
  const frames = (await framesAfter(page, 30, '__walkFrames', '__walkStop')).filter((f) => f.screen === screen);
  const where = `${fixture.name}, ${what}`;
  assert.ok(frames.length >= 30, `${where}: only ${frames.length} frames sampled — the change was not observed`);
  assert.ok(frames.some((f) => f.chips === 0),
    `${where}: no frame before the list — the wait was never on the paper, so this phase checked nothing about it`);
  const settled = frames.at(-1);
  assert.ok(settled.slot && settled.canvas, `${where}: the settled frame has no cube`);
  const sizeOff = (a, b) => !a || Math.abs(a.w - b.w) > 0.5 || Math.abs(a.h - b.h) > 0.5;
  // Both MUST-NOTs in one comparison, so a failure shows every frame of each kind at once.
  assert.deepEqual({
    countWithoutList: frames.filter((f) => f.chips === 0 && /\d/.test(f.count ?? '')),
    cubeAtAnotherSize: frames.filter((f) => sizeOff(f.slot, settled.slot) || sizeOff(f.canvas, settled.canvas)),
  }, { countWithoutList: [], cubeAtAnotherSize: [] },
  `${where}: a frame showed a move count beside an empty move list, or drew the cube at a size other than its`
    + ` settled ${settled.canvas.w}×${settled.canvas.h}`);
}

/** The visible die: the twin's in landscape, the cube card's tool in portrait. */
const DIE = '#randCube:visible, #randCubeTool:visible';

/** Take the roll the app has waiting (lib/scramble-roll.js), through the app's own door, so the next roll is made on
 *  demand — the path of a press that comes before the next roll is ready. Called inside a phase, once its requests are
 *  held: the pre-roll that taking one starts is then held too, so it cannot be ready again before the press. */
const takeWaitingRoll = (page) => page.evaluate(async () => { const m = await import('/lib/scramble-roll.js'); void m.randomScramble(); });

for (const fixture of HOME_SCAN_FIXTURES) {
  test(`a walk lands whole — count, list and the cube's size together — after a scan, a stop and a roll: ${fixture.name}`, async () => {
    const context = await browser.newContext({ viewport: { width: fixture.width, height: fixture.height }, hasTouch: fixture.touch === true });
    await context.addInitScript(HOLD_WORKERS);
    const page = await context.newPage();
    pace(page);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e));
    try {
      await page.goto(`${BASE}/?insets=${fixture.insets}#/scan`);
      await page.waitForSelector('.screen.active[data-screen="scan"] #stageCard', { state: 'attached' });
      // CONTRACT_CUBES[0]: a frozen 20-move cube, so the search takes real time on every machine.
      await fakeScan(page, CONTRACT_CUBES[0]);
      await page.waitForFunction(() => document.querySelector('#stageCard')?.hidden === false, null);

      // HOME AFTER A SCAN, from the navigation: the walk's list, on the screen asked for — only this walk draws it.
      await walkLandsWhole(page, fixture, {
        what: 'Home after a scan', screen: 'home',
        act: () => page.evaluate(() => { location.hash = '#/home'; }),
        landed: () => page.waitForSelector('.screen.active[data-screen="home"] #solList .chip-m', { timeout: LIVENESS_MS }),
      });

      // A RESTORE STOP, pressed on the same screen: the first stop the row offers, which this cube has not reached. The
      // walk it lands is a route, said in its own sentence — never the whole-cube count that stood before the press.
      const said = await page.textContent('#moveCount');
      const stop = await page.evaluate(() => [...document.querySelectorAll('#stageTargetRow [data-stage]')]
        .find((el) => !el.hidden && el.dataset.stage !== 'solved')?.dataset.stage);
      assert.ok(stop, `${fixture.name}: precondition — the Restore row offers a stop`);
      await walkLandsWhole(page, fixture, {
        what: `a walk to "${stop}"`, screen: 'home',
        act: () => page.evaluate((id) => document.querySelector(`#stageTargetRow [data-stage="${id}"]`).click(), stop),
        landed: () => page.waitForFunction(([id, was]) => {
          const count = document.querySelector('#moveCount')?.textContent ?? '';
          return document.querySelector(`#stageTargetRow [data-stage="${id}"]`)?.classList.contains('on')
            && count !== was && count !== 'working…' && document.querySelectorAll('#solList .chip-m').length > 0;
        }, [stop, said], { timeout: LIVENESS_MS }),
      });

      // SCRAMBLE, from its navigation: the screen rolls on the way in — on demand, its waiting roll taken first.
      await walkLandsWhole(page, fixture, {
        what: 'Scramble on the way in', screen: 'scramble',
        act: async () => { await takeWaitingRoll(page); await page.evaluate(() => { location.hash = '#/scramble'; }); },
        landed: () => page.waitForFunction(() => document.querySelector('.screen.active[data-screen="scramble"] #solList .chip-m')
          && [...document.querySelectorAll('#randCube, #randCubeTool')].every((d) => !d.disabled), null, { timeout: LIVENESS_MS }),
      });

      // AND A ROLL OF ITS DIE: a different list, with the die let go — the die is held until the walk it loads is on screen.
      const rolled = await page.textContent('#solList');
      await walkLandsWhole(page, fixture, {
        what: 'a roll on Scramble', screen: 'scramble',
        act: async () => { await takeWaitingRoll(page); await page.click(DIE); },
        landed: () => page.waitForFunction((was) => document.querySelector('#solList').textContent !== was
          && document.querySelectorAll('#solList .chip-m').length > 0
          && [...document.querySelectorAll('#randCube, #randCubeTool')].every((d) => !d.disabled), rolled, { timeout: LIVENESS_MS }),
      });
      assert.deepEqual(errors.map(String), [], 'the page threw');
    } finally {
      await context.close();
    }
  });
}

test('the renderer is never told to draw a SOLVED cube while the subject is a scrambled one', async () => {
  // The frame the initSolver removal could have created, and the reason `newCube` changed with it
  // (2026-09-05, dev-docs/deferred-plans-2026-09-05.md §1).
  //
  // The setup alg — the path the twin animates from solved to the scanned arrangement — used to be
  // a Kociemba search `newCube()` could force on THIS thread, so "the screen is walking" and "the
  // alg is in hand" were the same instant. They are not any more: the alg is the inverse of the
  // pool's answer, so it arrives WITH the walk. `scramble=""` in the meantime is the renderer's
  // instruction to draw a solved cube and animate nothing — a solved cube beside a scrambled walk,
  // the exact class the die invariant forbids ("the die solves before it swaps", AGENTS.md).
  //
  // MEASURED AT THE INSTRUCTION, NOT AT THE FRAME, and that distinction is the whole reason this
  // test is written this way. A frame sampler cannot see it: `beginWalk()` runs synchronously at
  // the top of loadWalk, in the same task as the mount, and it clears `scramble` and sets
  // `facelets` before any frame is composited — so the wrong instruction is issued, obeyed by a
  // renderer that draws on `connectedCallback`, and then overwritten inside one frame. That is the
  // same accident AGENTS.md already records for the ghost attributes: "it never reached the screen
  // only because the element's own animation frame happened to run later in the same frame as the
  // mount, which is the engine's ordering to change and nothing tested it." Patching
  // `setAttribute` records what the app ASKED for, attached or detached, whatever the engine then
  // chooses to do about it. (The composited frames are checked too, because that is the claim a
  // person experiences — but on its own it would pass against code with the guard removed.)
  //
  // Driven through `state.cube` because that is what a reading does: the die adopts a rolled cube
  // that already CARRIES its alg (takeDerivation), so it can never exercise the gap. The last
  // claim is what fails against the OLD code — the search that filled that gap ran here.
  const { page, context, errors } = await openHome({ solveTier: 'shortest' });
  try {
    const scrambled = await page.evaluate(`(async () => {
      const Cube = (await import('/vendor/cubejs.js')).default;
      const { state } = await import('/lib/app.js');
      const c = new Cube();
      c.move("R U R' U' F2 D L2 B' R2 U2");
      window.__state = state;
      window.__searches = 0;
      const real = Cube.prototype.solve;
      Cube.prototype.solve = function (...a) { window.__searches += 1; return real.apply(this, a); };
      return c.asString();
    })()`);

    // Every instruction the app gives a <cubus-cube> about WHAT to draw, with the subject that was
    // current when it gave it. Recorded from here on, so the solved cube this app booted on — for
    // which `facelets` = SOLVED is simply the truth — is not in the sample.
    await page.evaluate(`(() => {
      window.__told = [];
      const real = Element.prototype.setAttribute;
      Element.prototype.setAttribute = function (name, value) {
        if (this.tagName === 'CUBUS-CUBE' && (name === 'facelets' || name === 'scramble')) {
          window.__told.push({ name, value, subject: window.__state.cube.facelets });
        }
        return real.call(this, name, value);
      };
      // The composited frames as well: same rAF discipline as SAMPLER above.
      window.__seen = [];
      window.__seenStop = false;
      const t0 = performance.now();
      const snap = () => {
        const el = document.querySelector('#viewCube cubus-cube');
        window.__seen.push({
          t: +(performance.now() - t0).toFixed(1) + 0,
          subject: window.__state.cube.facelets,
          drawn: el ? el.getAttribute('facelets') : null,
          scramble: el ? el.getAttribute('scramble') : null,
        });
        if (!window.__seenStop) requestAnimationFrame(snap);
      };
      requestAnimationFrame(snap);
    })()`);
    await page.evaluate(`(async () => {
      const { state } = await import('/lib/app.js');
      Object.assign(state.cube, {
        facelets: ${JSON.stringify(scrambled)},
        derived: false, unsolvable: false, setupAlg: '', solution: '', moves: [],
        stepFacelets: [], solveResult: null, crossChecked: false,
        isPhysical: false, source: 'generated', trusted: false,
      });
      window.cubusGo('home');
    })()`);
    await page.waitForFunction(() => document.querySelectorAll('.chip-m').length > 0, null);
    // Not a wait for the navigation: `cubusGo` onto the screen already showing re-renders inside the
    // call, and the solved cube Home opened on has no chips, so the chips above are the new walk's.
    // Then frames AFTER the walk lands, counted from that moment, where a solved cube drawn late
    // would show — never a wall-clock window, which a `shortest` search can outrun.
    const seen = await framesAfter(page, 30, '__seen', '__seenStop');

    const SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
    const told = await page.evaluate(() => window.__told);
    assert.ok(told.length > 0, 'the renderer was never told anything — this probe stopped watching what it claims to watch');
    // An empty `scramble` draws a solved cube; `facelets` = SOLVED says so outright. Either is a
    // lie while the subject is scrambled.
    const lies = told.filter((a) => a.subject !== SOLVED
      && ((a.name === 'scramble' && a.value === '') || (a.name === 'facelets' && a.value === SOLVED)));
    assert.deepEqual(lies, [], 'the renderer was told to draw a solved cube while the subject was scrambled');

    assert.ok(seen.length >= 30, `only ${seen.length} frames sampled — the change of subject was not observed`);
    const lying = seen.filter((f) => f.subject !== SOLVED && (f.drawn === SOLVED || f.scramble === ''));
    assert.deepEqual(lying, [], 'a composited frame drew a solved cube while the subject was scrambled');

    const searched = await page.evaluate(() => window.__searches);
    assert.equal(searched, 0,
      `taking a new subject cost ${searched} Kociemba search(es) on the UI thread — the setup alg is the inverse of the pool's answer, not a search of its own`);
    assert.deepEqual(errors.map(String), [], 'the page threw');
  } finally {
    await context.close();
  }
});

test('the cube is given its view before it is connected, so its first drawing is the settled one', async () => {
  const { page, context, errors } = await openHome();
  try {
    // Recorded at the insertion itself, before the element is connected and therefore before it
    // builds and draws. Patching connectedCallback would not work: a custom element's lifecycle
    // callbacks are read off the prototype once, when the element is DEFINED, so a later
    // replacement is never called. Insertion is the observable moment.
    await page.evaluate(`(() => {
      window.__atConnect = [];
      const real = Node.prototype.appendChild;
      Node.prototype.appendChild = function (node) {
        if (node && node.tagName === 'CUBUS-CUBE') {
          window.__atConnect.push({
            connected: node.isConnected,
            ghosts: node.getAttribute('ghosts'),
            elevation: node.getAttribute('ghost-elevation'),
            lat: node.getAttribute('camera-latitude'),
            lon: node.getAttribute('camera-longitude'),
            scale: node.getAttribute('facelet-scale'),
          });
        }
        return real.call(this, node);
      };
    })()`);

    await press(page);
    const seen = await page.evaluate(() => window.__atConnect);
    assert.ok(seen.length >= 1, 'no cube was inserted with appendChild during the press — if the insertion moved to append()/insertBefore, this probe stopped watching the thing it claims to watch');
    for (const a of seen) {
      assert.equal(a.connected, false, 'the cube was already in the document before this insertion');
      assert.equal(a.ghosts, 'floating', 'the cube was connected without knowing its ghosts — its first drawing is fitted to a cube that has none');
      assert.ok(a.elevation !== null, 'ghost elevation was set after connection');
      assert.ok(a.lat !== null && a.lon !== null, 'the camera was set after connection');
      assert.ok(a.scale !== null, 'facelet scale was set after connection');
    }
    assert.deepEqual(errors.map(String), [], 'the page threw');
  } finally {
    await context.close();
  }
});

test('a refuted solution still blocks — the oracle can still say no', async () => {
  // The negative control for the search that was removed. A generated cube's solution is not
  // searched for — it is the inverse of a setup alg the solver found — so the independent
  // check is the cubejs oracle applying it in finishSolve. If that check has quietly stopped
  // being able to fail, the app would show any alg at all with confidence.
  //
  // No monkey-patching: patching isSolved() globally would ALSO fail takeDerivation's own
  // pre-check (app.js), so the carried solution would never be installed and the searched
  // path would be the one refusing — a pass proving nothing about this path. Instead the
  // CARRIED SOLUTION ITSELF is corrupted through the module's real state, unverified flag
  // and all, and the real, untouched oracle must refuse it on the next walk.
  const { page, context, errors } = await openHome();
  try {
    await press(page);
    const corrupted = await page.evaluate(`(async () => {
      const { state } = await import('/lib/app.js');
      if (!state.cube.solution) return false;
      state.cube.solution = "R U"; // well-formed, reaches nothing
      // Cleared so the next walk RE-ASKS the oracle. A carried solution arrives already checked
      // (takeDerivation commits through finishSolve, 2026-09-05), and a solution nobody has
      // vouched for is exactly what this flag means: solve() re-runs finishSolve, and that is
      // the refusal being provoked here.
      state.cube.crossChecked = false;
      return true;
    })()`);
    assert.ok(corrupted, 'no carried solution to corrupt — the derivation path is gone');

    await page.evaluate('window.cubusGo("home")'); // re-walk the same subject
    // Not a wait for the navigation: `cubusGo` onto the screen already showing re-renders inside the
    // call, which puts the count at "working…". The wait is for the re-walk's VERDICT — the count
    // leaving "working…" — whatever it says; the checks below say whether it is the refusal.
    await page.waitForFunction(() => {
      const count = document.querySelector('#moveCount')?.textContent ?? '';
      return count !== '' && count !== 'working…' && count !== '—';
    });
    const shown = await page.evaluate(() => ({
      count: document.querySelector('#moveCount')?.textContent ?? null,
      chips: document.querySelectorAll('.chip-m').length,
    }));
    assert.equal(shown.chips, 0, 'a refuted solution was drawn as moves to make anyway');
    // The refusal NAMES ITSELF. One sentence used to cover four unrelated failures — the solver
    // never loading, no scramble, a dead worker, and this: the oracle refusing an answer. "Could
    // not work it out" blamed the cube for all four and offered re-scanning as the remedy even
    // where re-scanning cannot help. Here it can and does, which is why this branch says so.
    assert.equal(
      shown.count,
      'the answer did not check out — read the cube again',
      `the screen said "${shown.count}" instead of refusing`,
    );
    // The page is allowed to complain loudly here; it is not allowed to throw uncaught.
    assert.deepEqual(errors.map(String), [], 'the refusal escaped as an uncaught error');
  } finally {
    await context.close();
  }
});

test('the walk on screen solves the cube on screen — the guard the skipped search leans on', async () => {
  // Not a regression test for the skip; the SAFETY NET under it. Carrying a setup alg forward
  // instead of searching for it is only sound while the alg really reaches the cube it came with,
  // so that has to be checked somewhere that fails rather than asserted in a comment. Both halves
  // of what the screen shows are checked against each other with no help from the app: the setup
  // alg the renderer animates from, and the moves in the chip grid the user is asked to make.
  const { page, context, errors } = await openHome();
  try {
    for (let i = 0; i < 3; i++) {
      await press(page);
      const r = await page.evaluate(`(async () => {
        const Cube = (await import('/vendor/cubejs.js')).default;
        const SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
        const setup = document.querySelector('#viewCube cubus-cube').getAttribute('scramble');
        const chips = [...document.querySelectorAll('.chip-m')].map((c) => c.textContent.trim());
        if (!setup || !chips.length) return { setup, chips: chips.length, solves: null };
        return { setup, chips: chips.length, solves: Cube.fromString(SOLVED).move(setup).move(chips.join(' ')).isSolved() };
      })()`);
      assert.ok(r.setup && r.setup.trim().length > 0, 'the walking cube has no setup alg to animate from');
      assert.ok(r.chips > 0, 'the sheet offered no moves');
      assert.equal(r.solves, true, `the ${r.chips} moves on screen do not solve the cube the setup alg builds`);
    }
    assert.deepEqual(errors.map(String), [], 'the page threw');
  } finally {
    await context.close();
  }
});


// ---- retargeting: the screen keeps its structure and changes its subject ----------------------

/** Stamp nodes that must survive a retarget. Attributes the app never touches, so their presence
 *  afterwards proves the very same elements are still on screen — not lookalikes rebuilt from the
 *  same template, which is exactly what a full render would produce. */
const STAMP = `(() => {
  document.querySelector('.screen.active').dataset.stamp = 'screen';
  document.querySelector('#viewNet').dataset.stamp = 'net';
  document.querySelector('#solList').dataset.stamp = 'list';
  document.querySelector('.transport').dataset.stamp = 'transport';
  return true;
})()`;

const stamps = (page) => page.evaluate(`(() => ({
  screen: document.querySelector('.screen.active')?.dataset.stamp ?? null,
  net: document.querySelector('#viewNet')?.dataset.stamp ?? null,
  list: document.querySelector('#solList')?.dataset.stamp ?? null,
  transport: document.querySelector('.transport')?.dataset.stamp ?? null,
}))()`);

test('pressing Random does not rebuild the screen — it retargets it', async () => {
  const { page, context, errors } = await openHome();
  try {
    await press(page); // reach the walking composition, which is what retargets
    await page.evaluate(STAMP);
    const before = await page.evaluate(() => document.querySelector('#viewCube cubus-cube').getAttribute('scramble'));

    await press(page);
    const after = await stamps(page);
    assert.deepEqual(after, { screen: 'screen', net: 'net', list: 'list', transport: 'transport' },
      'the screen was rebuilt: these are new nodes, so every animation, scroll position and transport state on it was thrown away');

    const now = await page.evaluate(() => document.querySelector('#viewCube cubus-cube').getAttribute('scramble'));
    assert.notEqual(now, before, 'the screen kept its structure but did not take the new cube');
    assert.deepEqual(errors.map(String), [], 'the page threw');
  } finally {
    await context.close();
  }
});

test('a retarget replaces the whole walk, not just the picture', async () => {
  const { page, context, errors } = await openHome();
  try {
    await press(page);
    await press(page);
    const r = await page.evaluate(`(async () => {
      const Cube = (await import('/vendor/cubejs.js')).default;
      const SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
      const setup = document.querySelector('#viewCube cubus-cube').getAttribute('scramble');
      const chips = [...document.querySelectorAll('.chip-m')].map((c) => c.textContent.trim());
      return {
        solves: Cube.fromString(SOLVED).move(setup).move(chips.join(' ')).isSolved(),
        chips: chips.length,
        count: document.querySelector('#moveCount').textContent,
        step: document.querySelector('#stepLbl').textContent,
        progress: document.querySelector('#progBar').style.width,
        played: document.querySelectorAll('.chip-m.played').length,
        done: document.querySelector('#doneMark').hidden,
        prevDisabled: document.querySelector('#prevBtn').disabled,
      };
    })()`);
    // The move list, the count and the transport are all part of the subject. A retarget that
    // repainted the cube and left any of them describing the previous one is the exact failure
    // the old "re-enter the screen" workaround existed to avoid.
    assert.equal(r.solves, true, 'the chips on screen do not solve the cube on screen');
    assert.equal(r.count, String(r.chips), `the count says "${r.count}" for ${r.chips} chips`);
    assert.equal(r.step, `0 / ${r.chips}`, `the step label says "${r.step}" — the transport was not reset`);
    assert.equal(r.progress, '0%', `the progress bar is at ${r.progress} on a walk nobody has started`);
    assert.equal(r.played, 0, 'moves are marked as already made on a fresh walk');
    assert.equal(r.done, true, 'the done tick is showing before a single move');
    assert.equal(r.prevDisabled, true, 'Back is enabled at step 0');
    assert.deepEqual(errors.map(String), [], 'the page threw');
  } finally {
    await context.close();
  }
});

test('a retarget mid-walk resets the position rather than keeping the old one', async () => {
  const { page, context, errors } = await openHome();
  try {
    await press(page);
    // Walk three moves in, so there is a position to be wrongly carried over.
    for (let i = 0; i < 3; i++) await page.click('#nextBtn');
    await page.waitForFunction(() => document.querySelector('#stepLbl').textContent.startsWith('3 '), null);

    await press(page);
    const r = await page.evaluate(() => ({
      step: document.querySelector('#stepLbl').textContent,
      played: document.querySelectorAll('.chip-m.played').length,
    }));
    assert.ok(r.step.startsWith('0 / '), `the new walk opened at "${r.step}" — the old position was carried onto a different cube`);
    assert.equal(r.played, 0, 'chips of the new walk are marked as already made');
    assert.deepEqual(errors.map(String), [], 'the page threw');
  } finally {
    await context.close();
  }
});

test('two presses in the same tick leave one cube, and it is the last one', async () => {
  // Without a per-walk generation the two overlapping loads race, and the slower one finishes
  // last and paints its move list over the cube the faster one left on screen.
  const { page, context, errors } = await openHome();
  try {
    await press(page);
    const before = await page.evaluate(`(() => {
      const before = ${SCRAMBLE_NOW};
      const die = document.querySelector('#randCube');
      die.click(); die.click(); die.click();
      return before;
    })()`);
    // The die is held from the first click until that press's walk is on screen, so the walk that
    // lands with the die let go is the last one any of the three could start.
    await pressLanded(page, before);
    const r = await page.evaluate(`(async () => {
      const Cube = (await import('/vendor/cubejs.js')).default;
      const SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
      const setup = document.querySelector('#viewCube cubus-cube').getAttribute('scramble');
      const chips = [...document.querySelectorAll('.chip-m')].map((c) => c.textContent.trim());
      return { solves: Cube.fromString(SOLVED).move(setup).move(chips.join(' ')).isSolved(), chips: chips.length,
               count: document.querySelector('#moveCount').textContent };
    })()`);
    assert.equal(r.solves, true, 'the move list belongs to a different cube than the one drawn');
    assert.equal(r.count, String(r.chips), 'the count and the chips disagree');
    assert.deepEqual(errors.map(String), [], 'the page threw');
  } finally {
    await context.close();
  }
});

test('one step event still reaches exactly one handler after several retargets', async () => {
  // loadWalk() runs again on every retarget. If it re-registers the renderer's step listener,
  // the handlers stack up and the older ones drive chip rows built for earlier cubes.
  const { page, context, errors } = await openHome();
  try {
    await press(page);
    for (let i = 0; i < 3; i++) await press(page);
    const delivered = await page.evaluate(() => {
      window.__steps = 0;
      document.querySelector('#viewCube cubus-cube').dispatchEvent(new CustomEvent('cubus-step', { detail: { index: 1, total: 5 } }));
      return window.__steps;
    });
    assert.equal(delivered, 1, `one step reached ${delivered} handlers after three retargets`);
    assert.deepEqual(errors.map(String), [], 'the page threw');
  } finally {
    await context.close();
  }
});

test('the composition still changes when it has to — solved cube to walk', async () => {
  // A solved cube has no walk, so Home draws no transport and no solution card at all. That is a
  // different composition, not a retarget, and the screen must fall back to a full render rather
  // than trying to fill regions that do not exist.
  const { page, context, errors } = await openHome();
  try {
    const before = await page.evaluate(() => ({
      transport: Boolean(document.querySelector('.transport')),
      solution: Boolean(document.querySelector('.solution-card')),
    }));
    assert.deepEqual(before, { transport: false, solution: false }, 'a fresh app should open on a solved cube with nothing to walk');

    await press(page);
    const after = await page.evaluate(() => ({
      transport: Boolean(document.querySelector('.transport')),
      solution: Boolean(document.querySelector('.solution-card')),
      chips: document.querySelectorAll('.chip-m').length,
    }));
    assert.equal(after.transport, true, 'the transport never appeared');
    assert.equal(after.solution, true, 'the solution card never appeared');
    assert.ok(after.chips > 0, 'the walk has no moves');
    assert.deepEqual(errors.map(String), [], 'the page threw');
  } finally {
    await context.close();
  }
});
