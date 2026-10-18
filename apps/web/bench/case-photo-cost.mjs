// How long the library's case photographs take to land — measured in WebKit, in the real app
// (dev-docs/practice-redesign-plan.md §3.4, WI-1's gate).
//
// The gate: CFOP (full)'s first stage — its 46 tiles — photographed within 1.5 s, and the first screen of tiles within
// 0.5 s. Each run is a fresh browser context, so nothing is cached and no renderer is parked: the first photograph
// pays for the renderer's build. The clock starts when CFOP (full) is chosen as the library's method (its first
// stage's tiles are built as they come near the view) and stops when the last well in question holds its photograph.
// The stage's tiles below the view are built only when scrolled near, so "stage" here is the tiles drawn on approach.
//
// Run (from apps/web): node bench/case-photo-cost.mjs [runs=5]
// Needs WebKit for Playwright, as the browser suites do. Record the machine and its load beside the numbers.

import { loadavg } from 'node:os';

import { startBrowserFixture } from '../test/browser/harness.mjs';

const RUNS = Number(process.argv[2] ?? 5);
if (!Number.isInteger(RUNS) || RUNS < 1) throw new Error(`runs: "${process.argv[2]}" is not a positive whole number`);

const fixture = await startBrowserFixture();
const runs = [];
try {
  for (let i = 0; i < RUNS; i += 1) {
    const context = await fixture.browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${fixture.base}/index.html#/practice`);
    await page.waitForSelector('.practice-screen[data-ready="1"]', { timeout: 180_000 });
    const run = await page.evaluate(async () => {
      // CFOP (full), chosen as the library's method; the clock starts as it is chosen, and its first stage's grids
      // are drawn as they come near the view (dev-docs/practice-redesign-plan.md §4.4).
      const { settings } = await import('/lib/app-settings.js');
      const { refreshScreen } = await import('/lib/screen-shell.js');
      const t0 = performance.now();
      settings.practiceMethod = 'cfop';
      refreshScreen();
      await new Promise((resolve) => {
        const ready = () => (document.querySelector('.practice-screen[data-ready="1"][data-method="cfop"]') ? resolve() : requestAnimationFrame(ready));
        ready();
      });
      const phase = document.querySelector('#practiceList .stage-sec[data-sec="0"]');
      const list = document.querySelector('#practiceList');
      const wells = () => [...phase.querySelectorAll('.case-photo')];
      const view = list.getBoundingClientRect();
      const onScreen = (w) => { const r = w.getBoundingClientRect(); return r.bottom > view.top && r.top < view.bottom; };
      let firstScreen = null;
      let first14 = null;   // WI-1's first screen held 14 tiles; tiles are smaller now, so this keeps the comparison
      let firstCount = 0;
      await new Promise((resolve, reject) => {
        const tick = () => {
          const all = wells();
          const pending = all.filter((w) => w.dataset.photo !== 'shown');
          if (all.some((w) => w.dataset.photo === 'failed')) { reject(new Error('a photograph failed')); return; }
          if (first14 === null && all.length >= 14 && all.slice(0, 14).every((w) => w.dataset.photo === 'shown')) first14 = performance.now() - t0;
          if (firstScreen === null && all.length && !pending.some(onScreen)) { firstScreen = performance.now() - t0; firstCount = all.filter(onScreen).length; }
          if (all.length && !pending.length) { resolve(); return; }
          requestAnimationFrame(tick);
        };
        tick();
      });
      const { casePhotoCounts } = await import('/lib/case-photo.js');
      return {
        tiles: phase.querySelectorAll('[data-alg]').length, photographs: wells().length, firstScreenTiles: firstCount,
        firstScreenMs: Math.round(firstScreen), first14Ms: Math.round(first14), stageMs: Math.round(performance.now() - t0), taken: casePhotoCounts.taken,
      };
    });
    if (errors.length) throw new Error(`the page threw: ${errors.join(' | ')}`);
    runs.push(run);
    console.log(`run ${i + 1}: ${JSON.stringify(run)}`);
    await context.close();
  }
} finally {
  await fixture.close();
}
const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
console.log(`median over ${runs.length} runs: first screen ${median(runs.map((r) => r.firstScreenMs))} ms of ${median(runs.map((r) => r.firstScreenTiles))} tiles (gate 500), first 14 photographs ${median(runs.map((r) => r.first14Ms))} ms, stage ${median(runs.map((r) => r.stageMs))} ms (gate 1500); load average ${loadavg().map((x) => x.toFixed(1)).join(' ')}`);
