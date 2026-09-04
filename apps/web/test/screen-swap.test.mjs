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
import { webkit } from 'playwright';

import { pace } from './browser-wait.mjs';
import { freePort } from './free-port.mjs';

// Asked of the OS in before(), not chosen: a fixed port collides with an orphaned server
// from an interrupted run, which fails at startup and reads like a regression. See free-port.mjs.
let PORT;
let BASE;
const SERVE = fileURLToPath(new URL('../serve.mjs', import.meta.url));
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
    browser = await webkit.launch();
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

/** Press the die and settle on the screen it produces. */
async function press(page) {
  await page.click('#randCube');
  await page.waitForFunction(() => document.querySelectorAll('.chip-m').length > 0, null);
}

/** Record, once per animation frame, exactly what a composited frame would show. A rAF callback
 *  registered before the click runs at the top of the rendering steps, so what it reads is what
 *  that frame paints. */
const SAMPLER = `(() => {
  window.__frames = [];
  const t0 = performance.now();
  const snap = () => {
    window.__frames.push({
      t: +(performance.now() - t0).toFixed(1),
      solutionCard: Boolean(document.querySelector('.solution-card')),
      chips: document.querySelectorAll('.chip-m').length,
      count: document.querySelector('#moveCount')?.textContent ?? null,
      cubes: document.querySelectorAll('#viewCube cubus-cube').length,
    });
    if (performance.now() - t0 < 2000) requestAnimationFrame(snap);
  };
  requestAnimationFrame(snap);
})()`;

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
    await press(page);
    // The roller's Kociemba tables take 3-6s to build, and until they exist it is slower than
    // this thread, so app.js deliberately rolls here in the meantime. The claim is about a warm
    // app, which is every app a second after it opens; give it that second.
    await page.waitForTimeout(9000);
    await page.evaluate('window.__searches = 0');

    for (const nth of ['first', 'second', 'third']) {
      const duringClick = await page.evaluate(`(() => {
        document.querySelector('#randCube').click();
        return window.__searches;
      })()`);
      assert.equal(duringClick, 0, `the ${nth} press searched ${duringClick} time(s) while the user waited — the cube should already have been rolled`);
      await page.waitForFunction(() => document.querySelectorAll('.chip-m').length > 0, null);
      await page.waitForTimeout(2500);
    }
    const total = await page.evaluate(() => window.__searches);
    assert.equal(total, 0, `${total} Kociemba searches ran on the UI thread across three presses; rolling is the worker's job and solving is not needed at all`);
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
    for (const id of ['lessons', 'stats', 'home', 'scramble', 'home']) {
      await page.click(`[data-nav="${id}"]`);
      await page.waitForTimeout(700);
    }
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
    await page.click('[data-nav="scan"]');
    await page.waitForTimeout(900);
    const onScan = await page.evaluate(() => {
      const el = document.querySelector('cubus-cube');
      return el && { scramble: el.getAttribute('scramble'), alg: el.getAttribute('alg'), facelets: Boolean(el.getAttribute('facelets')) };
    });
    assert.ok(onScan, 'the scan screen has no cube');
    assert.equal(onScan.scramble, null, "the re-used cube still carries Home's scramble");
    assert.equal(onScan.alg, null, "the re-used cube still carries Home's solution");
    assert.ok(onScan.facelets, 'the scan twin was never given a state to paint');

    // Back to Home twice more, then ask the element to announce a step. If the listeners from
    // earlier visits were still on it, one event would reach three handlers.
    for (let i = 0; i < 2; i++) { await page.click('[data-nav="home"]'); await page.waitForTimeout(900); }
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
    await press(page); // settle: from here on the screen is already walking
    await page.waitForTimeout(400);

    for (let i = 0; i < 3; i++) {
      await page.evaluate(SAMPLER);
      await press(page);
      await page.waitForTimeout(600);
      const frames = await page.evaluate(() => window.__frames);
      assert.ok(frames.length > 8, `only ${frames.length} frames sampled — the press was not observed`);

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
      const t0 = performance.now();
      const snap = () => {
        const el = document.querySelector('#viewCube cubus-cube');
        window.__seen.push({
          t: +(performance.now() - t0).toFixed(1),
          subject: window.__state.cube.facelets,
          drawn: el ? el.getAttribute('facelets') : null,
          scramble: el ? el.getAttribute('scramble') : null,
        });
        if (performance.now() - t0 < 4000) requestAnimationFrame(snap);
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
    await page.waitForTimeout(600);

    const SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
    const told = await page.evaluate(() => window.__told);
    assert.ok(told.length > 0, 'the renderer was never told anything — this probe stopped watching what it claims to watch');
    // An empty `scramble` draws a solved cube; `facelets` = SOLVED says so outright. Either is a
    // lie while the subject is scrambled.
    const lies = told.filter((a) => a.subject !== SOLVED
      && ((a.name === 'scramble' && a.value === '') || (a.name === 'facelets' && a.value === SOLVED)));
    assert.deepEqual(lies, [], 'the renderer was told to draw a solved cube while the subject was scrambled');

    const seen = await page.evaluate(() => window.__seen);
    assert.ok(seen.length > 8, `only ${seen.length} frames sampled — the change of subject was not observed`);
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
      state.cube.crossChecked = false; // exactly how a carried solution arrives
      return true;
    })()`);
    assert.ok(corrupted, 'no carried solution to corrupt — the derivation path is gone');

    await page.evaluate('window.cubusGo("home")'); // re-walk the same subject
    await page.waitForTimeout(2500);
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
    await page.evaluate(() => {
      const die = document.querySelector('#randCube');
      die.click(); die.click(); die.click();
    });
    await page.waitForTimeout(3000);
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
