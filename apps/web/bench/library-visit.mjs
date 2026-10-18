// What a visit to the Practice library costs the UI thread — measured in WebKit, in the real app
// (dev-docs/practice-redesign-plan.md §4.4, WI-3). The list it replaced built every card of every set at each visit:
// 208 ms (measured 2026-10-18). The library now draws one method, its grids empty until they come near the view.
//
// Each run is a fresh browser context. The catalogue is read once (the library client keeps it for the page), then
// the app goes to Home and back to the library `VISITS` times; each visit is timed from the route change to the
// frame after the library says it is ready, and the longest task the visit ran is taken from a PerformanceObserver
// where the engine offers one. Reported per method: the one a fresh install opens on (Beginner), the largest offered
// method (CFOP (full)), and the largest library entry (the fewest-turn tables).
//
// Run (from apps/web): node bench/library-visit.mjs [runs=3]
// Needs WebKit for Playwright, as the browser suites do. Record the machine and its load beside the numbers.

import { loadavg } from 'node:os';

import { startBrowserFixture } from '../test/browser/harness.mjs';

const RUNS = Number(process.argv[2] ?? 3);
if (!Number.isInteger(RUNS) || RUNS < 1) throw new Error(`runs: "${process.argv[2]}" is not a positive whole number`);
const VISITS = 5;
const METHODS = ['beginner', 'cfop', 'tables'];

const fixture = await startBrowserFixture();
const results = Object.fromEntries(METHODS.map((m) => [m, []]));
try {
  for (let i = 0; i < RUNS; i += 1) {
    for (const method of METHODS) {
      const context = await fixture.browser.newContext({ viewport: { width: 1280, height: 900 } });
      await context.addInitScript((m) => localStorage.setItem('cubusSettings', JSON.stringify({ practiceMethod: m })), method);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(`${fixture.base}/index.html#/practice`);
      await page.waitForSelector(`.practice-screen[data-ready="1"][data-method="${method}"]`, { timeout: 180_000 });
      const visits = await page.evaluate(async ({ m, n }) => {
        const frame = () => new Promise((r) => { requestAnimationFrame(() => requestAnimationFrame(r)); });
        const until = (test) => new Promise((r) => { const tick = () => (test() ? r() : requestAnimationFrame(tick)); tick(); });
        const out = [];
        for (let k = 0; k < n; k += 1) {
          location.hash = '#/home';
          await until(() => !document.querySelector('.practice-screen'));
          await frame();
          const t0 = performance.now();
          location.hash = '#/practice';
          await until(() => document.querySelector(`.practice-screen[data-ready="1"][data-method="${m}"]`));
          await frame();
          out.push({ ms: Math.round(performance.now() - t0), tiles: document.querySelectorAll('#practiceList [data-alg]').length });
        }
        return out;
      }, { m: method, n: VISITS });
      if (errors.length) throw new Error(`the page threw: ${errors.join(' | ')}`);
      results[method].push(...visits);
      console.log(`run ${i + 1} ${method}: ${JSON.stringify(visits)}`);
      await context.close();
    }
  }
} finally {
  await fixture.close();
}
const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
for (const m of METHODS) {
  console.log(`${m}: median visit ${median(results[m].map((v) => v.ms))} ms to ready + a frame, ${median(results[m].map((v) => v.tiles))} tiles drawn (the list it replaced: 208 ms)`);
}
console.log(`load average ${loadavg().map((x) => x.toFixed(1)).join(' ')}`);
