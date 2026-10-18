// How long the library's case photographs take to land — measured in WebKit, in the real app
// (dev-docs/practice-redesign-plan.md §3.4, WI-1's gate).
//
// The gates, as amended after WI-3 (dev-docs/practice-redesign-plan.md §13 item 3): (a) the first 14 tiles in
// READING ORDER photographed within 0.5 s, and (b) the first screen of tiles within 1.5 s — each a median over the
// runs, and a missed gate exits non-zero. Reading order is the order the wells sit in the page, which is the order a
// grid lays its tiles out, row by row. The order itself and "no photograph taken twice" are browser cases, not here. Each run is a fresh browser context, so no photograph is cached from an earlier run. But a fresh
// install opens the library on Beginner, and drawing it asks for Beginner's net-row photographs, which builds and
// borrows the renderer before the clock starts — so no photograph timed here pays for the renderer's build. The clock starts when CFOP (full) is chosen as the library's method (its first
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
      let first14 = null;   // gate (a): the first 14 wells in reading order, all shown
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
const gates = [
  { name: '(a) first 14 tiles in reading order', ms: median(runs.map((r) => r.first14Ms)), bar: 500 },
  { name: `(b) first screen (${median(runs.map((r) => r.firstScreenTiles))} tiles)`, ms: median(runs.map((r) => r.firstScreenMs)), bar: 1500 },
];
for (const g of gates) console.log(`${g.name}: median ${g.ms} ms, gate ${g.bar} ms — ${g.ms <= g.bar ? 'met' : 'MISSED'}`);
console.log(`stage (${median(runs.map((r) => r.tiles))} tiles drawn on approach): median ${median(runs.map((r) => r.stageMs))} ms; load average ${loadavg().map((x) => x.toFixed(1)).join(' ')}`);
if (gates.some((g) => g.ms > g.bar)) process.exitCode = 1;
