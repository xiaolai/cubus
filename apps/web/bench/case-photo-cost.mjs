// How long the library's case photographs take to land — measured in WebKit, in the real app
// (dev-docs/practice-redesign-plan.md §3.4, WI-1's gate).
//
// The gate: CFOP (full)'s first stage — its 46 tiles — photographed within 1.5 s, and the first screen of tiles within
// 0.5 s. Each run is a fresh browser context, so nothing is cached and no renderer is parked: the first photograph
// pays for the renderer's build. The clock starts when the stage's sets are opened (their cards are built then) and
// stops when the last well in question holds its photograph.
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
      const group = document.querySelector('section.alg-method[data-method="cfop"]');
      const phase = group.querySelector('.alg-phase');
      const blocks = [...phase.querySelectorAll('details.alg-set')];
      phase.scrollIntoView({ block: 'start' });
      const list = document.querySelector('#practiceList');
      const t0 = performance.now();
      for (const b of blocks) b.open = true;
      const wells = () => [...phase.querySelectorAll('.case-photo')];
      const view = list.getBoundingClientRect();
      const onScreen = (w) => { const r = w.getBoundingClientRect(); return r.bottom > view.top && r.top < view.bottom; };
      let firstScreen = null;
      let firstCount = 0;
      await new Promise((resolve, reject) => {
        const tick = () => {
          const all = wells();
          const pending = all.filter((w) => w.dataset.photo !== 'shown');
          if (all.some((w) => w.dataset.photo === 'failed')) { reject(new Error('a photograph failed')); return; }
          if (firstScreen === null && all.length && !pending.some(onScreen)) { firstScreen = performance.now() - t0; firstCount = all.filter(onScreen).length; }
          if (all.length && !pending.length) { resolve(); return; }
          requestAnimationFrame(tick);
        };
        tick();
      });
      const { casePhotoCounts } = await import('/lib/case-photo.js');
      return {
        tiles: phase.querySelectorAll('[data-alg]').length, photographs: wells().length, firstScreenTiles: firstCount,
        firstScreenMs: Math.round(firstScreen), stageMs: Math.round(performance.now() - t0), taken: casePhotoCounts.taken,
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
console.log(`median over ${runs.length} runs: first screen ${median(runs.map((r) => r.firstScreenMs))} ms (gate 500), stage ${median(runs.map((r) => r.stageMs))} ms (gate 1500); load average ${loadavg().map((x) => x.toFixed(1)).join(' ')}`);
