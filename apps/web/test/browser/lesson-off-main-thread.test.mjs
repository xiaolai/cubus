// A method lesson is never worked out on the UI thread — the method solver's sibling of
// initsolver-off-main-thread.test.mjs (AGENTS.md §2, "No Kociemba search on the UI thread").
//
// Measured 2026-10-16 (bench/lesson-main-thread.mjs, WebKit, five fresh sessions each): choosing
// CFOP (full) blocked the page for a median 836 ms, worst 874 — the 119-algorithm repertoires and the
// cross table built on first use, on the thread that draws — and a Beginner walk for a median 149 ms.
// The lesson is worked out in a worker the page owns (lib/lesson-worker.js), and this file is what
// fails if any of it comes back.
//
// THE SPY is appended to the method engine and the cross stage as they are served, and counts only
// when it runs where there is a document — so the worker's own searches, which are the point, do not
// count. Every entry point that searches is wrapped: `repertoire` (the table build), `fromRepertoire`
// and `shortestTo` (the searches), and `solveCrossWhole` (the cross table and its descent). They are
// function declarations, so reassigning them inside their own module reaches every importer.
//
// Every assertion is about work that must NOT happen. It fails loudly without the browser:
// `pnpm exec playwright install webkit` (CI does this).

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from './harness.mjs';

import { readFileSync } from 'node:fs';

import { whyText } from '../../lib/method-lesson.js';
import { baselineCubes, lessonRecord } from '../fixtures/beginner-lesson.mjs';
import { pace } from '../browser-wait.mjs';
import { freePort } from '../free-port.mjs';

const SERVE = fileURLToPath(new URL('../../serve.mjs', import.meta.url));

let PORT;
let BASE;
let proc;
let browser;

before(async () => {
  PORT = await freePort();
  BASE = `http://127.0.0.1:${PORT}`;
  proc = spawn(process.execPath, [SERVE], { env: { ...process.env, PORT: String(PORT), CUBUS_LIVE_RELOAD: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
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
    browser = await launchBrowser('webkit');
  } catch (cause) {
    throw new Error('WebKit for Playwright is not installed — run: pnpm --filter cubus-web exec playwright install webkit', { cause });
  }
});

after(async () => {
  await browser?.close();
  proc?.kill('SIGTERM');
});

/** The spy for one module: wraps each named function declaration, counting calls on the page's thread. */
const spy = (names) => `
;(() => {
  if (typeof document === 'undefined') return;
  globalThis.__lessonSearches ??= 0;
  globalThis.__lessonSpies = (globalThis.__lessonSpies ?? 0) + 1;
  const wrap = (f) => function (...a) { globalThis.__lessonSearches += 1; return f.apply(this, a); };
  ${names.map((n) => `${n} = wrap(${n});`).join('\n  ')}
})();
`;
const SPIED = {
  '**/lib/methods/engine.js': spy(['repertoire', 'fromRepertoire', 'shortestTo']),
  '**/lib/methods/cross.js': spy(['solveCrossWhole']),
};

async function openHome(solveMethod) {
  const context = await browser.newContext({ viewport: { width: 840, height: 682 } });
  for (const [pattern, body] of Object.entries(SPIED)) {
    await context.route(pattern, async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body: (await response.text()) + body,
        headers: { ...response.headers(), 'content-type': 'text/javascript; charset=utf-8' },
      });
    });
  }
  const page = await context.newPage();
  pace(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));
  await page.addInitScript((m) => {
    localStorage.setItem('cubusSettings', JSON.stringify({
      theme: 'auto', palette: 'muted', autosolve: false, cameraId: '', navHidden: [],
      navDefaults: 99, devRandCube: true, language: '', dragRotate: false, solveTier: 'twenty', solveMethod: m,
    }));
  }, solveMethod);
  await page.goto(`${BASE}/#/home`);
  await page.waitForSelector('#randCube');
  await page.waitForFunction(() => document.querySelector('#viewCube cubus-cube') !== null, null);
  return { page, context, errors };
}

const lessonOnScreen = () => document.querySelectorAll('#solList .move-chips').length > 1;
const searches = (page) => page.evaluate(() => ({ spies: globalThis.__lessonSpies ?? 0, calls: globalThis.__lessonSearches ?? 0 }));

for (const method of ['cfop', 'cfop-4lll', 'beginner']) {
  test(`a ${method} lesson, whole and cut at a chip, is worked out with no search on the UI thread`, async () => {
    const { page, context, errors } = await openHome(method);
    try {
      await page.click('#randCube');
      await page.waitForFunction(lessonOnScreen);
      const whole = await searches(page);
      // Only the engine is certain to be on this thread — the targets read its predicates — so it is the
      // spy that must have installed; the cross stage may never load here at all, which is the point.
      assert.ok(whole.spies >= 1, 'the spy never installed, so it proved nothing');
      assert.equal(whole.calls, 0, `the ${method} lesson searched ${whole.calls} time(s) on the UI thread`);
      await page.click('[data-stage="cross"]');
      await page.waitForFunction(() => {
        const heads = [...document.querySelectorAll('#solList .move-chips')].map((s) => s.previousElementSibling?.textContent ?? '');
        return heads.length > 0 && heads.every((h) => /^Cross/.test(h));
      });
      const cut = await searches(page);
      assert.equal(cut.calls, 0, `the ${method} lesson cut at the cross searched ${cut.calls} time(s) on the UI thread`);
      // AND A CUT WITH NOTHING CACHED. The cut above follows a whole lesson that is already on the subject,
      // so a search confined to the uncached path of the cut would never run there. A new cube, with the
      // chip still chosen, is asked for its cut first.
      // Which cube the walk is about, as the cube element names it — the walk's text could repeat.
      const cubeNow = () => { const c = document.querySelector('#viewCube cubus-cube'); return `${c?.getAttribute('facelets')}|${c?.getAttribute('scramble')}`; };
      const before = await page.evaluate(cubeNow);
      await page.click('#randCube');
      await page.waitForFunction((was) => {
        const c = document.querySelector('#viewCube cubus-cube');
        const now = `${c?.getAttribute('facelets')}|${c?.getAttribute('scramble')}`;
        const heads = [...document.querySelectorAll('#solList .move-chips')].map((s) => s.previousElementSibling?.textContent ?? '');
        return now !== was && heads.length > 0 && heads.every((h) => /^Cross/.test(h));
      }, before);
      assert.equal(await page.getAttribute('[data-stage="cross"]', 'aria-pressed'), 'true', 'precondition: the chip stayed chosen across the roll');
      const fresh = await searches(page);
      assert.equal(fresh.calls, 0, `the ${method} lesson cut for an uncached cube searched ${fresh.calls} time(s) on the UI thread`);
      assert.deepEqual(errors.map(String), [], 'the page threw');
    } finally {
      await context.close();
    }
  });
}

test('the repair race\'s method source does not search on the UI thread either', async () => {
  // Quick has no lesson, but a chip pressed under it races a method route beside the exact search, and
  // that route is the beginner's method — worked out, until now, on this thread.
  const { page, context, errors } = await openHome('quick');
  try {
    await page.click('#randCube');
    // The press's walk, listed, with the die let go — not its count, which can stand before the list.
    await page.waitForFunction(() => /^\d+$/.test(document.querySelector('#moveCount')?.textContent ?? '')
      && document.querySelectorAll('#solList .chip-m').length > 0 && document.querySelector('#randCube')?.disabled === false);
    await page.click('[data-stage="two-layers"]');
    // The route's sentence, which only this press's race writes. No sleep after it: every source of the
    // race is STARTED when the race begins (lib/stage-route.js), the method source's call included, so a
    // search it made on this thread has already been counted by the time the route is said.
    await page.waitForFunction(() => /way back|couldn’t/.test(document.querySelector('#moveCount')?.textContent ?? ''));
    const s = await searches(page);
    assert.ok(s.spies >= 1, 'the spy never installed, so it proved nothing');
    assert.equal(s.calls, 0, `the repair race searched ${s.calls} time(s) on the UI thread`);
    assert.deepEqual(errors.map(String), [], 'the page threw');
  } finally {
    await context.close();
  }
});

test('the lesson WORKER builds the beginner lesson byte for byte as the frozen baseline, on every cube', async () => {
  // The worker solves and the page turns its answer into a lesson; across the thread boundary the steps
  // are structured-cloned, and nothing a learner is shown may change for it. beginner-lesson.test.mjs
  // holds the same record in node, where the worker is this thread; this holds the real one.
  const frozen = JSON.parse(readFileSync(new URL('../fixtures/beginner-lesson.json', import.meta.url), 'utf8'));
  assert.deepEqual(frozen.cases.map((c) => c.facelets), baselineCubes());
  const { page, context, errors } = await openHome('beginner');
  try {
    const lessons = await page.evaluate(async (cubes) => {
      const { lessonFor } = await import('/lib/cube-subject.js');
      const { methodById } = await import('/lib/methods/registry.js');
      const out = [];
      for (const facelets of cubes) out.push(await lessonFor({ facelets, lesson: null }, methodById('beginner')));
      return out;
    }, baselineCubes());
    for (const [n, { facelets, lesson }] of frozen.cases.entries()) {
      assert.ok(lessons[n], `cube ${n} (${facelets}): no lesson from the worker`);
      assert.deepEqual(lessonRecord(lessons[n], whyText), lesson, `cube ${n} (${facelets}): the worker's lesson differs from the baseline`);
    }
    const s = await searches(page);
    assert.equal(s.calls, 0, `building ${lessons.length} lessons searched ${s.calls} time(s) on the UI thread`);
    assert.deepEqual(errors.map(String), [], 'the page threw');
  } finally {
    await context.close();
  }
});
