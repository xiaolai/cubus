// The one link nothing else can cover: the real `new Worker(...)`.
//
// Everything under it is tested on the main thread — the engine's bounds behind its wrapper,
// the tiered progression against a fake, the client protocol against a fake worker. What
// none of that proves is that a browser can actually load `lib/solve-worker.js` as a module
// worker and get an answer back. A worker that fails to load fails in the quietest way there is:
// the promise never settles, and a screen waiting on it looks exactly like a search still going.
//
// Runs in headless WebKit, the engine every shipped build uses.
//
// It fails loudly without the browser: `pnpm exec playwright install webkit` (CI does this).

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright';

import { pace } from './browser-wait.mjs';

const PORT = 5196; // geometry owns 5197, serve.test.mjs 5199; node --test runs files in parallel
const BASE = `http://127.0.0.1:${PORT}`;
const SERVE = fileURLToPath(new URL('../serve.mjs', import.meta.url));
let proc;
let browser;

before(async () => {
  proc = spawn(process.execPath, [SERVE], { env: { ...process.env, PORT: String(PORT), CUBUS_LIVE_RELOAD: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
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
  pace(page);
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
      probeBudget: 200_000_000, // met is asserted below — reachability headroom over the 50M default
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
  // The failure this guards: the length bound not reaching the engine inside the worker. The
  // solver still works, so nothing looks wrong — it just ignores what it was asked for, every
  // time. solLen 21 is the tightest bound the engine meets reliably within this budget
  // (dev-docs/solver-move-count.md, the two-phase ladder).
  //
  // ESCALATION on null, for the same reason two-phase.test.mjs escalates: `probeMax` is a budget
  // in search NODES, so it is deterministic per cube and identical on every machine — which means
  // a fixed budget against a RANDOM cube asserts a probabilistic property as if it were a
  // deterministic one. It duly failed in CI on a cube this machine never drew. null is a statement
  // about the search, never about the cube (AGENTS.md: a search that ran out of budget is not a
  // cube that cannot be solved), and doubling is what lib/solve-target.js does for the app.
  //
  // The assertion does not weaken. What is under test is that solLen REACHES the engine, and that
  // is still checked exactly as before — on the answer's length. God's number is 20 and 21 is an
  // exclusive bound above it, so after escalation an answer must exist.
  const out = await inBrowser(async () => {
    const { createSolveClient, spawnSolveWorker } = await import('/lib/solve-client.js');
    const Cube = (await import('/vendor/cubejs.js')).default;
    Cube.initSolver();
    const client = createSolveClient({ spawn: spawnSolveWorker });
    const facelets = Cube.random().asString();
    let alg = null;
    let budget = 50_000_000;
    let spent = 0;
    for (let attempt = 0; attempt <= 8 && alg === null; attempt++) {
      alg = await client.solve(facelets, { solLen: 21, probeMax: budget });
      spent += budget;
      budget *= 2;
    }
    client.cancel();
    const oracle = Cube.fromString(facelets);
    if (alg) oracle.move(alg);
    return {
      facelets,
      spent,
      moves: alg === null ? null : alg.trim().split(/\s+/).length,
      solved: alg === null ? null : oracle.isSolved(),
    };
  });
  assert.notEqual(
    out.moves,
    null,
    `no solution under 21 for ${out.facelets} after 8 escalations (${out.spent} nodes) — ` +
      'the engine is complete, so this is a real defect rather than an expensive cube',
  );
  assert.ok(out.moves <= 20, `asked for fewer than 21 and got ${out.moves} — the length bound is not live`);
  assert.equal(out.solved, true);
});

test('the real pool, over real workers, answers what one worker answers', async () => {
  // The pool's own missing link. Everything below it is covered against fakes — slicing, budget
  // sharing, the sort key, sibling cancellation — and none of that touches the two things only a
  // browser has: several real module workers alive at once, and a SharedArrayBuffer that really
  // crosses postMessage. The stop word in particular can be wrong in a way no fake can show: if
  // the offset is dropped in transit, both sides hold a valid view of the same memory and poll
  // different words, so the stop silently never fires.
  const out = await inBrowser(async () => {
    const { createParallelSolveClient, createSolveClient, spawnSolveWorker } = await import('/lib/solve-client.js');
    const { VIEW_COUNT } = await import('/lib/solver-engine.js');
    const Cube = (await import('/vendor/cubejs.js')).default;
    Cube.initSolver();

    // Cross-origin isolation is what makes the pool a pool rather than a fallback. If this is
    // false the headers regressed, and the test must say so rather than quietly measure a lone worker.
    const isolated = typeof SharedArrayBuffer !== 'undefined' && self.crossOriginIsolated === true;
    if (!isolated) return { isolated };

    const facelets = Cube.random().asString();
    const bounds = { solLen: 21, probeMax: 50_000_000 };
    const pool = createParallelSolveClient({
      spawn: spawnSolveWorker, workers: 3, viewCount: VIEW_COUNT,
      makeShared: () => new Int32Array(new SharedArrayBuffer(4)),
    });
    const lone = createSolveClient({ spawn: spawnSolveWorker });
    try {
      // Both solves run at once, which is also the overlap the per-request word exists for.
      const [pooled, single] = await Promise.all([
        pool.solve(facelets, bounds),
        lone.solve(facelets, bounds),
      ]);
      const oracle = Cube.fromString(facelets);
      if (pooled) oracle.move(pooled);
      return { isolated, workers: pool.workers, pooled, single, solved: pooled ? oracle.isSolved() : null, facelets };
    } finally {
      pool.cancel();
      lone.cancel();
    }
  });

  assert.equal(out.isolated, true,
    'the page is not cross-origin isolated — the pool has no shared word and Phase 1 regressed');
  assert.equal(out.workers, 3, 'three real workers, not a silently collapsed one');
  assert.notEqual(out.pooled, null, `the pool found nothing for ${out.facelets}`);
  assert.equal(out.solved, true, `the pool's answer does not solve ${out.facelets}`);
  // The determinism claim, over the real boundary: at the shipped budget the pooled answer IS
  // the single-worker answer. Where that stops holding is pinned in parallel-divergence.test.mjs.
  assert.equal(out.pooled, out.single, `pool and lone worker diverged on ${out.facelets}`);
});

test('a malformed request comes back as a rejection, not a hang', async () => {
  // The worker's catch path had no browser coverage: a regression there leaves the caller's
  // promise pending forever, which on screen looks exactly like a search still going.
  const out = await inBrowser(async () => {
    const { createSolveClient, spawnSolveWorker } = await import('/lib/solve-client.js');
    const client = createSolveClient({ spawn: spawnSolveWorker });
    try {
      await client.solve(12345);
      return { rejected: false };
    } catch (err) {
      return { rejected: true, message: String(err.message) };
    } finally {
      client.cancel();
    }
  });
  assert.equal(out.rejected, true, 'a malformed request must reject, not resolve or hang');
  assert.match(out.message, /54-character/, 'and carry the boundary error, not a generic one');
});

test('the walk seeks in a real engine — a chip press lands the counter on its move', async () => {
  // The half the happy-dom tests cannot reach: they do not load <cubus-cube>, so the transport
  // never advances there. Here the renderer is real, so the walk really walks.
  const page = await browser.newPage();
  pace(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/index.html#/scramble`);
  await page.waitForSelector('#solList .chip-m');

  const out = await page.evaluate(async () => {
    const settle = (ms) => new Promise((r) => setTimeout(r, ms));
    const chips = [...document.querySelectorAll('#solList .chip-m')];
    if (chips.length === 0) return { error: 'no chips' };
    const label = () => document.querySelector('#stepLbl')?.textContent ?? '';
    const first = label();
    chips[chips.length - 1].click();
    for (let i = 0; i < 100 && label() === first; i++) await settle(50);
    return { total: chips.length, first, after: label() };
  });
  await page.close();

  assert.deepEqual(errors, [], 'the page logged an uncaught error');
  assert.equal(out.error, undefined, out.error);
  assert.equal(out.first, `0 / ${out.total}`, 'a fresh walk starts at zero');
  assert.equal(out.after, `${out.total} / ${out.total}`,
    'pressing the last chip must land the transport on the last move');
});

test('a state in the proven library is answered from data — no search, no proof offered', async () => {
  // The point of shipping the library. `Cube.prototype.solve` is the only Kociemba search this
  // thread can run (the engine's own lives in the worker, behind its own module instance), so
  // counting calls to it is counting exactly the work a user would have waited for. A proved
  // state must cost zero of them: deriveCube takes its setup alg from the entry and solve()
  // takes the solution, both already checked against the oracle at load.
  const entry = JSON.parse(
    readFileSync(new URL('../lib/data/optimal-challenges.json', import.meta.url), 'utf8'),
  )[0];

  const out = await inBrowser(async (known) => {
    const app = await import('/lib/app.js');
    const Cube = (await import('/vendor/cubejs.js')).default;
    // Wait for the library to be indexed — it loads with the solver, and a lookup before that
    // would legitimately miss and search, which is not what this test is about.
    const ready = async () => {
      for (let i = 0; i < 100; i++) {
        if (app.state.cube && document.querySelector('#stage')) return true;
        await new Promise((r) => setTimeout(r, 100));
      }
      return false;
    };
    await ready();
    await new Promise((r) => setTimeout(r, 1500));

    let searches = 0;
    const real = Cube.prototype.solve;
    Cube.prototype.solve = function (...a) { searches += 1; return real.apply(this, a); };
    try {
      const c = app.state.cube;
      c.facelets = known.facelets;
      c.solution = ''; c.crossChecked = false; c.solveResult = null;
      c.setupAlg = ''; c.derived = false;
      window.cubusGo('home');
      for (let i = 0; i < 120; i++) {
        if (document.querySelectorAll('.chip-m').length > 0) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const prove = document.querySelector('#proveBtn');
      return {
        searches,
        chips: document.querySelectorAll('.chip-m').length,
        status: document.querySelector('#moveCount')?.textContent ?? '',
        solution: c.solution,
        proveOffered: Boolean(prove) && prove.hidden === false,
      };
    } finally {
      Cube.prototype.solve = real;
    }
  }, entry);

  assert.equal(out.searches, 0, `a proved state cost ${out.searches} Kociemba search(es) — the library exists so it costs none`);
  assert.equal(out.solution, entry.optimalSolution, 'the shown solution is the proved-minimal one, move for move');
  assert.equal(out.chips, entry.optimalLength, 'and the walk is exactly that many moves');
  assert.match(out.status, /proved the minimum/, 'a proved state says so');
  assert.equal(out.proveOffered, false, 'nothing left to prove, so nothing is offered');
});

/** The app, booted with a FAKE native prover injected before any script runs.
 *  `optimal_prove` hangs until the test releases it, which is what a deep cube does for hours. */
async function withFakeProver(run, { prove = true } = {}) {
  const page = await browser.newPage();
  pace(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((prove) => {
    // The affordance is opt-in from Settings and off by default, so a test about the affordance
    // has to ask for it — which is itself the claim the pair of tests below pins.
    if (prove) localStorage.setItem('cubusSettings', JSON.stringify({ proveMinimum: true }));
    window.__calls = [];
    window.__listeners = {};
    window.__emit = (name, payload) => (window.__listeners[name] ?? []).forEach((cb) => cb({ payload }));
    window.__TAURI__ = {
      core: {
        invoke: (cmd) => {
          window.__calls.push(cmd);
          if (cmd === 'optimal_status') return Promise.resolve('ready');
          if (cmd === 'optimal_prepare') return Promise.resolve('ready');
          if (cmd === 'optimal_prove') {
            return new Promise((_res, rej) => { window.__failProve = (why) => rej(new Error(why)); });
          }
          if (cmd === 'optimal_cancel') { window.__failProve?.('cancelled'); return Promise.resolve(true); }
          return Promise.resolve(null);
        },
      },
      event: {
        listen: (name, cb) => {
          (window.__listeners[name] ??= []).push(cb);
          return Promise.resolve(() => {});
        },
      },
      // Enough of the rest that the shell wires up without complaining.
      window: { getCurrentWindow: () => ({ setTitle() {}, minimize() {}, close() {} }) },
      opener: { openUrl: () => {} },
    };
  }, prove);
  await page.goto(`${BASE}/index.html`);
  try {
    return await run(page);
  } finally {
    await page.close();
    assert.deepEqual(errors, [], 'the page logged an uncaught error');
  }
}

/** Put a scrambled (NOT library) cube on the cube screen and wait for its walk. */
const walkAScrambledCube = async (page) => {
  await page.waitForFunction(() => Boolean(window.cubusGo), null);
  await page.evaluate(async () => {
    const app = await import('/lib/app.js');
    const Cube = (await import('/vendor/cubejs.js')).default;
    const scrambled = new Cube();
    scrambled.move("R U2 F L' D B2 R' U F2 L D'"); // eleven moves, and not in the proven library
    const c = app.state.cube;
    c.facelets = scrambled.asString();
    c.solution = ''; c.crossChecked = false; c.solveResult = null; c.setupAlg = ''; c.derived = false;
    window.cubusGo('home');
  });
  await page.waitForSelector('#proveBtn:not([hidden])');
};

test('a proof that answers quickly never shows a waiting state', async () => {
  // The waiting state is EARNED, not announced. Proof cost tracks depth: a shallow cube proves
  // in milliseconds, so a person who presses prove on one must see nothing at all happen except
  // the answer. A fast refusal exercises the same timer as a fast success.
  await withFakeProver(async (page) => {
    await walkAScrambledCube(page);
    const seen = await page.evaluate(async () => {
      const btn = document.querySelector('#proveBtn');
      const texts = [];
      new MutationObserver(() => texts.push(btn.textContent)).observe(btn, { childList: true, characterData: true, subtree: true });
      // Answer immediately, before the reveal timer can fire.
      const patch = setInterval(() => window.__failProve?.('no tables here'), 5);
      btn.click();
      await new Promise((r) => setTimeout(r, 900));
      clearInterval(patch);
      return { texts, cancelHidden: document.querySelector('#proveCancel').hidden, text: btn.textContent };
    });
    assert.ok(
      !seen.texts.some((t) => /proving…|at least/.test(t)),
      `a fast proof flashed a waiting state: ${JSON.stringify(seen.texts)}`,
    );
    assert.equal(seen.cancelHidden, true, 'and offered no stop, because there was nothing to stop');
  });
});

test('a proof that runs long says what it has ruled out, and can be stopped', async () => {
  await withFakeProver(async (page) => {
    await walkAScrambledCube(page);
    const out = await page.evaluate(async () => {
      const btn = document.querySelector('#proveBtn');
      const cancel = document.querySelector('#proveCancel');
      btn.click();
      await new Promise((r) => setTimeout(r, 700)); // past PROOF_WAIT_VISIBLE_MS
      const waiting = { text: btn.textContent, cancelHidden: cancel.hidden };

      // The native side reports an exhausted contour: no solution of 16 moves exists, so the
      // answer is at least 17. That is a fact, not a spinner.
      window.__emit('optimal-proof-progress', { ruled_out: 16, nodes: 1234 });
      await new Promise((r) => setTimeout(r, 50));
      const bounded = btn.textContent;

      cancel.click();
      await new Promise((r) => setTimeout(r, 300));
      return {
        waiting,
        bounded,
        after: btn.textContent,
        afterCancelHidden: cancel.hidden,
        calls: window.__calls.slice(),
      };
    });

    assert.match(out.waiting.text, /proving… \d+:\d\d/, 'a long proof shows it is running, and for how long');
    assert.equal(out.waiting.cancelHidden, false, 'and offers a stop');
    assert.match(out.bounded, /at least 17 · \d+:\d\d/, 'a ruled-out contour becomes a lower bound on screen');
    assert.ok(out.calls.includes('optimal_cancel'), 'the stop actually reaches the native side');
    assert.equal(out.after, 'prove the minimum', 'stopping is a choice, so the affordance comes back');
    assert.equal(out.afterCancelHidden, true, 'and the stop goes away with the wait');
  });
});

test('a handheld asks for the camera that can see the cube; a desktop asks for nothing', async () => {
  // getUserMedia with no facing constraint hands over the platform's default, and on a phone
  // that is the front camera — a cube scanner pointed at the user's face. The hint is therefore
  // platform-shaped, not taste: a desktop is deliberately left asking for nothing, because there
  // a facing mode names a different physical machine rather than a different lens.
  const facingFor = async (platform) => {
    const page = await browser.newPage();
    pace(page);
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    try {
      await page.goto(`${BASE}/?platform=${platform}#/scan`);
      await page.waitForSelector('ai-scan-panel');
      const seen = await page.evaluate(() => ({
        facing: document.querySelector('ai-scan-panel')?.getAttribute('facing'),
        platform: document.documentElement.dataset.platform,
      }));
      assert.equal(seen.platform, platform, 'the platform pin did not take');
      assert.deepEqual(errors, [], 'the page logged an uncaught error');
      return seen.facing;
    } finally {
      await page.close();
    }
  };

  for (const handheld of ['ios', 'android']) {
    assert.equal(await facingFor(handheld), 'environment',
      `${handheld} must ask for the rear camera, or the scanner opens on the user's face`);
  }
  for (const desktop of ['macos', 'windows', 'linux']) {
    assert.equal(await facingFor(desktop), null,
      `${desktop} must express no preference — a facing mode there names another machine`);
  }
});

test('the prove affordance is off until Settings asks for it', async () => {
  // Proving is minutes to hours on a typical cube, so it is not something to put in front of a
  // beginner who did not ask. Default off, and the same walk that draws it when the setting is
  // on must draw nothing when it is not — the native side being present is not enough.
  await withFakeProver(async (page) => {
    await page.waitForFunction(() => Boolean(window.cubusGo), null);
    await page.evaluate(async () => {
      const app = await import('/lib/app.js');
      const Cube = (await import('/vendor/cubejs.js')).default;
      const scrambled = new Cube();
      scrambled.move("R U2 F L' D B2 R' U F2 L D'");
      const c = app.state.cube;
      c.facelets = scrambled.asString();
      c.solution = ''; c.crossChecked = false; c.solveResult = null; c.setupAlg = ''; c.derived = false;
      window.cubusGo('home');
    });
    // Wait for the walk itself, so this is "the chips are there and the button is not" rather
    // than "nothing has rendered yet", which would pass against any code at all.
    await page.waitForFunction(() => document.querySelectorAll('.chip-m').length > 0, null);
    const seen = await page.evaluate(() => {
      const btn = document.querySelector('#proveBtn');
      return { exists: Boolean(btn), hidden: btn?.hidden, stored: localStorage.getItem('cubusSettings') };
    });
    assert.equal(seen.exists, true, 'the button is in the DOM either way — it is drawn or not by its hidden flag');
    assert.equal(seen.hidden, true, 'a fresh install must not offer a proof that can run for hours');
    // Not "nothing was stored": boot legitimately writes settings (the nav-defaults migration).
    // The claim is that OFF is what a fresh install gets without anyone choosing it.
    assert.notEqual(seen.stored, null, 'boot writes settings, so this reads what it wrote');
    assert.ok(!JSON.parse(seen.stored).proveMinimum, 'a fresh install must not have opted itself in');
  }, { prove: false });
});

test('the move count sits at the right edge, clear of the prove button', async () => {
  // The count is the heading's answer and belongs opposite it. With the auto margin on the
  // button instead, the header's space-between stranded the number midway across the card.
  await withFakeProver(async (page) => {
    await walkAScrambledCube(page);
    const box = await page.evaluate(() => {
      const head = document.querySelector('#solLabel').parentElement;
      const r = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right }; };
      const cs = getComputedStyle(head);
      return {
        head: r(head),
        headPadRight: Number.parseFloat(cs.paddingRight),
        label: r(document.querySelector('#solLabel')),
        count: r(document.querySelector('#moveCount')),
        prove: r(document.querySelector('#proveBtn')),
      };
    });
    // The count is on the right half, not stranded beside the heading.
    assert.ok(box.count.left > box.label.right + 20,
      `the count starts ${Math.round(box.count.left - box.label.right)}px after the heading — it is not right-aligned`);
    // A real gap between the number and the pill, not a collision and not a chasm.
    const gap = box.prove.left - box.count.right;
    assert.ok(gap >= 8 && gap <= 24, `the gap between the count and the prove button is ${Math.round(gap)}px`);
    // And the pair ends at the card's right edge.
    assert.ok(box.head.right - box.prove.right <= box.headPadRight + 1,
      'the prove button does not reach the card\'s right edge');
  });
});
