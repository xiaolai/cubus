// cubejs's Kociemba tables must never be built on the UI thread — and what that had been hiding.
//
// `loadSolver()` called `Cube.initSolver()` right after first paint. Measured in WebKit on
// 2026-09-05 over ten boots, that was the app's longest synchronous block at boot: median 723 ms,
// worst 793 ms, against median 40 ms and worst 59 ms without it (the remainder is the renderer's
// first WebGL build, which is there either way). On a phone it is two to four times that. The
// plan: dev-docs/deferred-plans-2026-09-05.md §1.
//
// Its only consumer on this thread was `deriveCube`'s `cube.solve()`, searching for a setup alg
// that is by construction the INVERSE of the answer the worker pool produces anyway — the same
// "one search, invert for the other half" the scramble side adopted on 2026-08-29. So the tables
// went, and with them a search this thread never needed to run.
//
// Removing it exposed two things the old arrangement had been covering up, and both are tested
// here because both are silent:
//
//   1. `solvable` used to mean "cubejs found a solution", and for a state no cube can be turned
//      into, cubejs finds one anyway — handed a twisted corner it returns a well-formed 16-move
//      alg that does not solve it. So an impossible cube went WALKING: the screen drew a
//      transport and a solution card, the engine then refused the state, eight budget escalations
//      later `solveWithinGodsNumber` raised, and `failWalk` said "could not work it out" — a
//      search being blamed for something parity had already settled. Legality is arithmetic and
//      is answered from cubejs's PARSER (isCubeState, lib/cube-trust.js), with no table anywhere.
//
//   2. Nothing else may build those tables by accident. A single `cube.solve()` left on this
//      thread would build them lazily the first time it ran, which looks like nothing at all
//      until a user presses something.
//
// Every assertion is about work that must NOT happen. It fails loudly without the browser:
// `pnpm exec playwright install webkit` (CI does this).

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright';

import { pace } from '../browser-wait.mjs';
import { freePort } from '../free-port.mjs';

const SERVE = fileURLToPath(new URL('../../serve.mjs', import.meta.url));
const app = readFileSync(new URL('../../lib/app.js', import.meta.url), 'utf8');

/** A deliberately impossible cube: the URF corner twisted in place, nothing else moved.
 *  Right colour counts, centres pinned, and it survives cubejs's fromString/asString round-trip —
 *  the corner twists sum to 1 rather than to a multiple of three, which is the one thing that
 *  rules it out. Verified against both legality gates on 2026-09-05: `isCubeState` (cubejs's
 *  parser plus the four classical conditions) and the engine's own `parseFacelets` both refuse
 *  it, and `Cube.prototype.solve` returns "F' U B2 U' F U F2 U' F2 U B2 U' F2 U F2 U'" for it,
 *  which leaves the cube unsolved. That last fact is the defect this file is about. */
const TWISTED_CORNER = 'UUUUUUUUFURRRRRRRRFFRFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';

let PORT;
let BASE;
let proc;
let browser;

before(async () => {
  PORT = await freePort();
  BASE = `http://127.0.0.1:${PORT}`;
  proc = spawn(process.execPath, [SERVE], { env: { ...process.env, PORT: String(PORT), CUBUS_LIVE_RELOAD: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    // Hand the child's own words back rather than a bare timeout: an interrupted run leaves the
    // server orphaned, and serve.mjs says so precisely on its own stderr (see free-port.mjs).
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

/** The spy, appended to the cubejs bundle's own source as it is served.
 *
 *  Patching from an init script cannot work here and the reason is worth writing down: an init
 *  script runs at document-start, where there is no document to resolve a module specifier
 *  against, so `import('/vendor/cubejs.js')` rejects with "Importing a module script failed" —
 *  and a spy that installs late has proved nothing about what happened before it. Appended to the
 *  module instead, it is installed by the module's OWN evaluation, which is strictly before any
 *  importer's first line. `export_default` is the bundle's last binding (lib/cubejs-entry.js), so
 *  this reaches the very object app.js receives. */
const SPY = `
;(() => {
  const C = export_default;
  globalThis.__initSolverCalls = 0;
  const real = C.initSolver;
  C.initSolver = function (...a) { globalThis.__initSolverCalls += 1; return real.apply(this, a); };
  globalThis.__spyInstalled = true;
})();
`;

/** Home, with the developer die showing and the spy in place. */
async function openHome() {
  const context = await browser.newContext({ viewport: { width: 840, height: 682 } });
  await context.route('**/vendor/cubejs.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()) + SPY,
      headers: { ...response.headers(), 'content-type': 'text/javascript; charset=utf-8' },
    });
  });
  const page = await context.newPage();
  pace(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));
  await page.addInitScript(() => {
    localStorage.setItem('cubusSettings', JSON.stringify({
      theme: 'auto', palette: 'muted', autosolve: false, cameraId: '', navHidden: [],
      navDefaults: 99, devRandCube: true, language: '', dragRotate: false,
    }));
  });
  await page.goto(`${BASE}/#/home`);
  await page.waitForSelector('#randCube');
  await page.waitForFunction(() => document.querySelector('#viewCube cubus-cube') !== null, null);
  return { page, context, errors };
}

/** Has anything built cubejs's tables in THIS realm? Un-fakeable, and independent of the spy:
 *  both table records start as nulls and `initSolver` is the only thing that fills them, so this
 *  answers the question even if the spy had never been installed at all. */
const TABLES_BUILT = `(async () => {
  const Cube = (await import('/vendor/cubejs.js')).default;
  return {
    move: Object.entries(Cube.moveTables).filter(([, v]) => v !== null).map(([k]) => k),
    pruning: Object.entries(Cube.pruningTables).filter(([, v]) => v !== null).map(([k]) => k),
  };
})()`;

test('initSolver is never called on the main thread, and its tables are never built there', async () => {
  const { page, context, errors } = await openHome();
  try {
    // Boot, a press of the die (a roll AND a solve, both through the pool) and a walk drawn.
    await page.click('#randCube');
    await page.waitForFunction(() => document.querySelectorAll('.chip-m').length > 0, null);
    await page.waitForTimeout(2500);

    const spy = await page.evaluate(() => ({ installed: window.__spyInstalled, calls: window.__initSolverCalls }));
    assert.equal(spy.installed, true, 'the spy never installed, so it proved nothing about initSolver');
    assert.equal(spy.calls, 0, `initSolver ran ${spy.calls} time(s) on the UI thread`);

    // The tables themselves, which is the claim the spy is only evidence for. cubejs's parity
    // table is a literal in the source and is never null, so it is excluded by construction:
    // everything listed here is something initSolver computed.
    const built = await page.evaluate(TABLES_BUILT);
    assert.deepEqual(built.move.filter((k) => k !== 'parity'), [],
      `cubejs move tables were built on the UI thread: ${built.move.join(', ')}`);
    assert.deepEqual(built.pruning, [],
      `cubejs pruning tables were built on the UI thread: ${built.pruning.join(', ')}`);
    assert.deepEqual(errors.map(String), [], 'the page threw');
  } finally {
    await context.close();
  }
});

test('nothing in app.js asks cubejs to search', () => {
  // The tables are lazy: any surviving `cube.solve()` would build them the first time it ran, on
  // whichever press happened to reach it. Comments are stripped the way solve-tier-wiring does
  // it — WHY the search was removed is worth keeping in the source, and a test that cannot tell a
  // comment from code would forbid recording it.
  const code = app
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/[^\n]*$/gm, '')
    .replace(/([^:'"`])\/\/[^\n]*/g, '$1')
    // A chained call split across lines is one expression, and the receiver is what identifies it:
    // `solverWorker()\n  .solve(...)` reads as a bare `.solve(` to a line-wise scan, which is how
    // the warm-up looked like a cubejs search when it is the pool's.
    .replace(/\)\s*\n\s*\./g, ').');
  assert.doesNotMatch(code, /initSolver/, 'app.js builds cubejs’s Kociemba tables on the UI thread');
  // `.solve(` on a cubejs Cube is the search. The pool client's own calls are the ones that stay,
  // and they are recognised by their RECEIVER rather than exempted by line number.
  const searches = [...code.matchAll(/^.*\.solve\(.*$/gm)]
    .map((m) => m[0].trim())
    .filter((line) => !/solverWorker\(\)\.solve|client\.solve|solve: \(/.test(line));
  assert.deepEqual(searches, [], 'a cubejs Kociemba search is still reachable from the UI thread');
});

/** Put an arrangement on `state.cube` the way a reading would, and re-enter Home.
 *  `window.cubusGo` re-renders even when the hash does not change, which is the seam the scan
 *  flow uses and the only way to drive a subject change from outside. */
const showOnHome = (facelets) => `(async () => {
  const { state } = await import('/lib/app.js');
  Object.assign(state.cube, {
    facelets: ${JSON.stringify(facelets)},
    derived: false, unsolvable: false, setupAlg: '', solution: '', moves: [],
    stepFacelets: [], solveResult: null, crossChecked: false,
    isPhysical: false, source: 'generated', trusted: false,
  });
  window.cubusGo('home');
})()`;

test('an impossible cube says what is wrong with it, rather than blaming the search', async () => {
  const { page, context, errors } = await openHome();
  try {
    await page.evaluate(showOnHome(TWISTED_CORNER));
    // Long enough that the OLD behaviour would have finished: eight escalations on a state the
    // engine rejects before searching return immediately, so failWalk lands within a tick or two.
    await page.waitForTimeout(2500);

    const shown = await page.evaluate(() => ({
      note: document.querySelector('#unsolvableNote')?.textContent?.trim() ?? null,
      transport: Boolean(document.querySelector('.transport')),
      solution: Boolean(document.querySelector('.solution-card')),
      count: document.querySelector('#moveCount')?.textContent ?? null,
      chips: document.querySelectorAll('.chip-m').length,
    }));

    assert.ok(shown.note, `nothing on screen said why this cube has no walk: ${JSON.stringify(shown)}`);
    assert.match(shown.note, /not one a cube can be turned into/,
      `the note said "${shown.note}"`);
    // The composition, not a message inside a walking one: a solution card with no moves in it is
    // the empty presented frame the die invariant forbids.
    assert.equal(shown.transport, false, 'a transport was drawn for a cube with nothing to walk');
    assert.equal(shown.solution, false, 'a solution card was drawn for a cube with nothing to walk');
    assert.equal(shown.chips, 0, 'moves were offered for a cube that cannot be turned into');
    // And explicitly NOT failWalk. This is the assertion that fails against the old code: there,
    // cubejs answered the twisted corner with a 16-move non-solution, the screen went walking,
    // and the count ended up reading the catch-all.
    assert.notEqual(shown.count, 'could not work it out',
      'an impossible cube reached failWalk — the search was blamed for a fact about the cube');
    assert.deepEqual(errors.map(String), [], 'the page threw');
  } finally {
    await context.close();
  }
});

test('a legal cube read from nowhere still gets its walk, through the pool', async () => {
  // The positive control for the test above: the same seam, a state that IS reachable. Without
  // this, "no walk" would pass just as happily for a screen that had stopped walking anything.
  const { page, context, errors } = await openHome();
  try {
    const legal = await page.evaluate(`(async () => {
      const Cube = (await import('/vendor/cubejs.js')).default;
      const c = new Cube();
      c.move("R U R' U' F2 D L2 B' R2 U2");
      return c.asString();
    })()`);
    await page.evaluate(showOnHome(legal));
    await page.waitForFunction(() => document.querySelectorAll('.chip-m').length > 0, null);

    const r = await page.evaluate(`(async () => {
      const Cube = (await import('/vendor/cubejs.js')).default;
      const SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
      const el = document.querySelector('#viewCube cubus-cube');
      const setup = el.getAttribute('scramble');
      const chips = [...document.querySelectorAll('.chip-m')].map((c) => c.textContent.trim());
      return {
        note: Boolean(document.querySelector('#unsolvableNote')),
        setup,
        chips: chips.length,
        // The setup alg came from inverting the pool's answer; this is the check that it really
        // builds the cube on screen, done here with no help from the app.
        builds: Boolean(setup) && Cube.fromString(SOLVED).move(setup).asString() === ${JSON.stringify(legal)},
        solves: Boolean(setup) && Cube.fromString(SOLVED).move(setup).move(chips.join(' ')).isSolved(),
      };
    })()`);
    assert.equal(r.note, false, 'a perfectly legal cube was called impossible');
    assert.ok(r.chips > 0, 'the walk has no moves');
    assert.equal(r.builds, true, 'the setup alg the twin animates from does not build the cube it is about');
    assert.equal(r.solves, true, 'the moves on screen do not solve the cube the setup alg builds');
    assert.deepEqual(errors.map(String), [], 'the page threw');
  } finally {
    await context.close();
  }
});
