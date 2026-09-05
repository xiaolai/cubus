// The highlight channel where it actually runs — real WebGL, real materials.
//
// cube-highlight.test.mjs proves WHICH pieces a selector names. Nothing there can prove what the
// renderer then does to them, and that half has two traps a pure test cannot reach:
//
//   - the rounded cubie body uses ONE material shared by all 26 cubies, so lighting a cubie by
//     walking its children lights the whole cube unless the body is skipped by name;
//   - the pulse is a function of wall-clock time, so a naive assertion on emissiveIntensity is
//     a coin flip — at the trough of the breath a correctly highlighted piece reads as dark.
//
// The second is handled by running the material assertions under `prefers-reduced-motion: reduce`,
// where the highlight is deliberately frozen at full strength, and by testing the motion itself
// separately in a page that has it.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright';

import { freePort } from '../free-port.mjs';

const SERVE = fileURLToPath(new URL('../../serve.mjs', import.meta.url));
let proc;
let browser;
let base;
/** One page per motion preference, shared by every test in this file. */
const PAGES = {};

/** Solved facelets, in URFDLB order — the string the renderer paints from. */
const SOLVED = ['U', 'R', 'F', 'D', 'L', 'B'].map((c) => c.repeat(9)).join('');

before(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, [SERVE], {
    env: { ...process.env, PORT: String(port), CUBUS_LIVE_RELOAD: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let said = '';
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`serve.mjs did not start within 20s. It said: ${said.trim() || '(nothing)'}`)),
      20_000,
    );
    const note = (d) => { said += d.toString(); if (said.includes(`:${port}`)) { clearTimeout(timeout); resolve(); } };
    proc.stdout.on('data', note);
    proc.stderr.on('data', (d) => { said += d.toString(); });
    proc.on('error', reject);
  });
  try {
    browser = await webkit.launch();
  } catch (cause) {
    throw new Error('WebKit for Playwright is not installed — run: pnpm --filter cubus-web exec playwright install webkit', { cause });
  }
  // TWO pages for the whole file, one per motion preference — not one per test.
  //
  // Each page load is the entire SPA (onnxruntime and all), and ten of them made this file run
  // long enough to still be holding a WebKit process and a server when scanner-gpu and
  // solve-worker-browser started. Under `--test-concurrency=6` that pushed those suites past their
  // own startup budgets: 14 failures, none of them assertions, none of them reproducible when the
  // suites were run alone. Raising their timeouts would have hidden the load rather than removed it.
  for (const motion of ['reduce', 'no-preference']) {
    const page = await browser.newPage({ reducedMotion: motion });
    const warnings = [];
    page.on('console', (m) => { if (m.type() === 'warning') warnings.push(m.text()); });
    await page.goto(`${base}/index.html`);
    await page.waitForFunction(() => !!customElements.get('cubus-cube'));
    PAGES[motion] = { page, warnings, motion };
  }
});

after(async () => {
  await browser?.close();
  proc?.kill('SIGTERM');
});

/**
 * A fresh <cubus-cube> on the shared page for `reducedMotion`, with the warning buffer cleared.
 *
 * The old element is disposed before it is dropped. Building one costs a WebGL context, and WebKit
 * caps how many a document may hold — replacing ten without disposing would trade a timeout problem
 * for a context-exhaustion one.
 */
async function cubePage({ reducedMotion = 'reduce', ghosts = 'none', facelets = SOLVED } = {}) {
  const ctx = PAGES[reducedMotion];
  // Reset any per-test emulateMedia override (the mid-pulse test flips this page's preference).
  await ctx.page.emulateMedia({ reducedMotion: ctx.motion });
  ctx.warnings.length = 0;
  await ctx.page.evaluate(({ facelets: fl, ghosts: g }) => {
    if (window.__cube) { window.__cube.dispose?.(); window.__cube.remove(); }
    const el = document.createElement('cubus-cube');
    el.style.cssText = 'position:fixed;left:0;top:0;width:220px;height:220px;z-index:99999';
    // `scramble` is only applied when there is no valid facelets string, so a test that needs the
    // scramble path asks for facelets:null rather than fighting the precedence.
    if (fl) el.setAttribute('facelets', fl);
    el.setAttribute('ghosts', g);
    document.body.appendChild(el);
    window.__cube = el;
  }, { facelets, ghosts });
  return { page: ctx.page, warnings: ctx.warnings };
}

/** Positions of the cubies carrying at least one lit sticker, sorted for comparison. */
const litPositions = (page) => page.evaluate(() => window.__cube.cubies
  .filter((c) => c.children.some((m) => m.userData?.face && m.material.emissiveIntensity > 0))
  .map((c) => [c.position.x, c.position.y, c.position.z].map(Math.round).join(','))
  .sort());

const setHighlight = (page, spec) => page.evaluate((s) => {
  window.__cube.setAttribute('highlight', s);
}, spec);

test('six centres, twelve edges, eight corners — lit on the real cube', async () => {
  const { page } = await cubePage();
  for (const [spec, count] of [['centers', 6], ['edges', 12], ['corners', 8]]) {
    await setHighlight(page, spec);
    assert.equal((await litPositions(page)).length, count, spec);
  }
  // The narration line this whole channel exists for, as one union.
  await setHighlight(page, 'centers,edges,corners');
  assert.equal((await litPositions(page)).length, 26);
});

test('the shared cubie body is never lit — only the stickers are', async () => {
  // bodyGeo/bodyMat are built ONCE and handed to all 26 cubies. Walking a highlighted cubie's
  // children and lighting anything with an `emissive` would light that one material, and every
  // cubie on the cube with it. This is the assertion that says the body is skipped by name.
  const { page } = await cubePage();
  await setHighlight(page, 'corners');
  const body = await page.evaluate(() => {
    const mats = window.__cube.cubies.map((c) => c.children.find((m) => !m.userData?.face && !m.userData?.n).material);
    return {
      count: mats.length,
      distinct: new Set(mats).size,
      emissive: [...new Set(mats.map((m) => m.emissive.getHex()))],
      color: mats[0].color.getHex(),
    };
  });
  assert.equal(body.count, 26);
  // The premise of the trap, asserted rather than assumed: ONE material for all 26 cubies.
  assert.equal(body.distinct, 1, 'bodyMat is meant to be shared — if it stops being, this test stops meaning anything');
  // Black emissive is what keeps it dark. emissiveIntensity is NOT the check: three.js defaults it
  // to 1 on every MeshStandardMaterial, so the body reads as "intensity 1" while contributing
  // nothing, and an assertion on intensity would fail on correct code. If _applyHighlight ever
  // touched the body, this hex would become the body's own colour instead.
  assert.deepEqual(body.emissive, [0x000000], 'a cubie body picked up emissive from the highlight');
  assert.notEqual(body.color, 0x000000, 'so the assertion above can tell "untouched" from "copied"');
});

test('clearing the highlight returns every sticker to rest', async () => {
  const { page } = await cubePage();
  await setHighlight(page, 'edges');
  assert.equal((await litPositions(page)).length, 12);

  await setHighlight(page, 'centers');
  assert.equal((await litPositions(page)).length, 6, 'the previous set must not linger');

  await setHighlight(page, 'none');
  assert.equal((await litPositions(page)).length, 0);

  // Removing the attribute means "back to the default", which is none — not "null", the bug the
  // ghosts attribute already had to be fixed for.
  await setHighlight(page, 'corners');
  await page.evaluate(() => window.__cube.removeAttribute('highlight'));
  assert.equal((await litPositions(page)).length, 0);
});

test('piece: follows the piece through a turn; slot: stays with the position', async () => {
  const { page } = await cubePage();

  // F rotates the z=+1 layer, carrying the UF edge at [0,1,1] round to [1,0,1] — the FR slot.
  await page.evaluate(() => {
    window.__cube.setAttribute('alg', 'F');
    window.__cube.seek(1); // instant, no animation: this is the primitive a scrubber uses
  });

  await setHighlight(page, 'piece:UF');
  assert.deepEqual(await litPositions(page), ['1,0,1'], 'the UF edge travelled to the FR slot');

  await setHighlight(page, 'slot:UF');
  assert.deepEqual(await litPositions(page), ['0,1,1'], 'the UF slot did not move');

  const carried = await page.evaluate(() => window.__cube.cubies
    .find((c) => Math.round(c.position.x) === 0 && Math.round(c.position.y) === 1 && Math.round(c.position.z) === 1)
    .userData.piece);
  assert.notEqual(carried, 'FU', 'a different piece is in the UF slot after F');
});

test('an unread sticker leaves its whole cubie without an identity, and says so', async () => {
  // Facelet 0 is the ULB corner's U sticker. One unread sticker makes the PIECE unknown — naming
  // it by the letters that were read would name a cubie nobody has seen.
  const { page, warnings } = await cubePage();
  await page.evaluate((fl) => { window.__cube.setAttribute('facelets', fl); },
    `?${SOLVED.slice(1)}`);

  const unknown = await page.evaluate(() => window.__cube.cubies.filter((c) => c.userData.piece === null).length);
  assert.equal(unknown, 1);

  await setHighlight(page, 'piece:BLU');
  assert.deepEqual(await litPositions(page), []);
  assert.ok(
    warnings.some((w) => w.includes('highlight matched nothing') && w.includes('piece:BLU')),
    `expected a warning naming the empty selector, got: ${JSON.stringify(warnings)}`,
  );
});

test('an invalid selector is refused loudly and highlights nothing', async () => {
  const { page, warnings } = await cubePage();
  await setHighlight(page, 'edges,slot:UD');
  assert.deepEqual(await litPositions(page), [], 'whole-or-nothing: the valid half must not light');
  assert.ok(
    warnings.some((w) => w.includes('refusing highlight') && w.includes('slot:UD')),
    `expected a warning naming the bad token, got: ${JSON.stringify(warnings)}`,
  );
});

test('ghosts breathe in opacity, since an unlit material has no emissive to raise', async () => {
  const { page } = await cubePage({ ghosts: 'all' });
  const restingOpacity = await page.evaluate(() => window.__cube._ghostMeshes[0].material.opacity);
  await setHighlight(page, 'centers');
  const lit = await page.evaluate(() => window.__cube.cubies
    .filter((c) => c.children.some((m) => m.userData?.n && m.material.opacity > 0.45 + 1e-6)).length);
  assert.equal(lit, 6, `ghosts on the highlighted centres should be raised above ${restingOpacity}`);
});

test('the pulse actually moves, and stays inside its band', async () => {
  // The one assertion that needs motion, so it runs in a page that HAS it. Everything above is
  // deliberately frozen; without this test a highlight stuck at full strength would pass them all.
  const { page } = await cubePage({ reducedMotion: 'no-preference' });
  await setHighlight(page, 'corners');
  const samples = await page.evaluate(() => new Promise((done) => {
    const seen = [];
    let n = 0;
    const tick = () => {
      const c = window.__cube.cubies.find((x) => Math.abs(x.position.x) + Math.abs(x.position.y) + Math.abs(x.position.z) === 3);
      seen.push(c.children.find((m) => m.userData?.face).material.emissiveIntensity);
      if (++n < 60) requestAnimationFrame(tick); else done(seen);
    };
    requestAnimationFrame(tick);
  }));
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  assert.ok(max - min > 0.02, `expected the pulse to vary, saw ${min}..${max}`);
  assert.ok(min >= 0 && max <= 0.38 + 1e-6, `pulse left its band: ${min}..${max}`);
});

test('reduced motion freezes the highlight at full strength rather than removing it', async () => {
  // The indicator carries meaning — it is how the narration says which piece it means — so the
  // motion goes and the signal stays. Same stance _next() takes on the turn itself.
  const { page } = await cubePage({ reducedMotion: 'reduce' });
  await setHighlight(page, 'corners');
  const samples = await page.evaluate(() => new Promise((done) => {
    const seen = [];
    let n = 0;
    const tick = () => {
      const c = window.__cube.cubies.find((x) => Math.abs(x.position.x) + Math.abs(x.position.y) + Math.abs(x.position.z) === 3);
      seen.push(c.children.find((m) => m.userData?.face).material.emissiveIntensity);
      if (++n < 30) requestAnimationFrame(tick); else done(seen);
    };
    requestAnimationFrame(tick);
  }));
  assert.deepEqual([...new Set(samples)], [0.38], 'reduced motion should hold the peak, not drop to zero');
});

// ---------------------------------------------------------------------------------------------
// Regression: the lifecycle paths an audit found untested (2026-09-06).
//
// The "through a turn" test above seeks BEFORE setting the highlight, so it could never catch a
// stale set. These set the highlight FIRST — the order a lesson actually uses, where the cue is
// spoken and only then does the cube move.
// ---------------------------------------------------------------------------------------------

test('a highlight set BEFORE a seek is re-resolved against where the pieces land', async () => {
  const { page } = await cubePage();
  await setHighlight(page, 'piece:UF');
  assert.deepEqual(await litPositions(page), ['0,1,1'], 'starts at home');

  await page.evaluate(() => { window.__cube.setAttribute('alg', 'F'); window.__cube.seek(1); });
  assert.deepEqual(await litPositions(page), ['1,0,1'], 'seek() must re-resolve, not keep the old set');

  await setHighlight(page, 'slot:UF');
  await page.evaluate(() => window.__cube.seek(0));
  await setHighlight(page, 'slot:UF');
  await page.evaluate(() => window.__cube.seek(1));
  assert.deepEqual(await litPositions(page), ['0,1,1'], 'the slot stays put across a seek');
});

test('a highlight set BEFORE a scramble is re-resolved after it', async () => {
  // reset() paints (and resolves) while every cubie is at home, THEN applies the scramble.
  //
  // This MUST use a positional selector. An identity selector travels for free — the glow lives on
  // the cubie's own materials, so `piece:UF` lands on the right cubie whether or not anything
  // re-resolved. An earlier version of this test used `piece:` and passed against the bug.
  const { page } = await cubePage({ facelets: null });
  await setHighlight(page, 'slot:UF');
  assert.deepEqual(await litPositions(page), ['0,1,1']);

  await page.evaluate(() => window.__cube.setAttribute('scramble', 'F'));
  assert.deepEqual(await litPositions(page), ['0,1,1'],
    'the SLOT must stay lit; with no re-resolve the glow rides the departing cubie to 1,0,1');

  // The complement, pinned deliberately: identity highlights need no re-resolution at all.
  await setHighlight(page, 'piece:UF');
  assert.deepEqual(await litPositions(page), ['1,0,1'], 'the UF piece is where the scramble put it');
});

test('an animated turn re-resolves the highlight when the move completes', async () => {
  // Positional again, for the same reason as the scramble test above.
  const { page } = await cubePage({ reducedMotion: 'no-preference' });
  await setHighlight(page, 'slot:UF');
  await page.evaluate(() => new Promise((done) => {
    const el = window.__cube;
    el.addEventListener('cubus-step', function once() { el.removeEventListener('cubus-step', once); done(); });
    el.setAttribute('alg', 'F');
    el.step();
  }));
  assert.deepEqual(await litPositions(page), ['0,1,1'],
    '_completeMove must re-resolve after baking, or the glow leaves the slot with the piece');
});

test('clearing the highlight invalidates a frame, so the glow cannot linger', async () => {
  // One task, no rAF in between: _dirty is read in the same turn it should have been set.
  const { page } = await cubePage();
  const dirty = await page.evaluate(() => {
    const el = window.__cube;
    el.setAttribute('highlight', 'edges');
    el._dirty = false;                     // stand in for "the last frame has been drawn"
    el.setAttribute('highlight', 'none');  // clearing must ask for another one
    return el._dirty;
  });
  assert.equal(dirty, true, 'on a stationary cube nothing else would repaint, so the glow would stay');
});

test('turning reduced motion on mid-pulse snaps the highlight to full strength', async () => {
  // The branch that skipped the update under reduced motion froze the pulse wherever it was — at
  // the trough that is invisible, so the indicator vanished for the users who asked for less
  // motion. The phase is now evaluated every frame and written only when it changes.
  const { page } = await cubePage({ reducedMotion: 'no-preference' });
  await setHighlight(page, 'corners');

  // Wait for a frame that is demonstrably OFF peak before flipping the preference. A fixed sleep
  // could land on the peak by chance, and then the assertion below would hold whether or not the
  // fix was present — the test would pass for the wrong reason.
  const before = await page.evaluate(() => new Promise((done, fail) => {
    const read = () => {
      const c = window.__cube.cubies.find((x) => Math.abs(x.position.x) + Math.abs(x.position.y) + Math.abs(x.position.z) === 3);
      return c.children.find((m) => m.userData?.face).material.emissiveIntensity;
    };
    let n = 0;
    const tick = () => {
      const k = read();
      if (k < 0.30) return done(k);
      if (++n > 180) return fail(new Error(`never left the peak after ${n} frames (last ${k})`));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
  assert.ok(before < 0.30, `expected an off-peak frame before flipping, got ${before}`);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await new Promise((r) => setTimeout(r, 350)); // a handful of frames
  const k = await page.evaluate(() => {
    const c = window.__cube.cubies.find((x) => Math.abs(x.position.x) + Math.abs(x.position.y) + Math.abs(x.position.z) === 3);
    return c.children.find((m) => m.userData?.face).material.emissiveIntensity;
  });
  assert.equal(k, 0.38, `the highlight should jump to peak, not freeze at the ${before} it held`);
});
