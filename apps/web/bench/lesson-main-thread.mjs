// How long the UI thread is blocked while a method lesson is built — measured in WebKit, in the real app.
//
// The question it answers (2026-10-16, ADR 0011 Phase 7): the first CFOP lesson of a session built its
// 119-algorithm repertoires and the cross table on the thread that draws, and froze the screen for
// 400–900 ms (measured in node). This drives the app as a learner does and reports the LONGEST stretch the
// page's thread could not run a timer, which is what a child sees as a frozen screen.
//
// Two scenarios, each in a fresh browser context (a fresh session, so nothing is warm):
//   cfop      Quick walk on screen, then CFOP (full) chosen from the "More methods" menu.
//   beginner  Beginner stored, the developer die pressed, the Beginner lesson built.
//
// Run (from apps/web): node bench/lesson-main-thread.mjs [runs=5]
// Needs WebKit for Playwright, as the browser suites do.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../test/browser/harness.mjs';

import { freePort } from '../test/free-port.mjs';

const RUNS = Number(process.argv[2] ?? 5);
if (!Number.isInteger(RUNS) || RUNS < 1) throw new Error(`runs: "${process.argv[2]}" is not a positive whole number`);

const SERVE = fileURLToPath(new URL('../serve.mjs', import.meta.url));
const port = await freePort();
const proc = spawn(process.execPath, [SERVE], { env: { ...process.env, PORT: String(port), CUBUS_LIVE_RELOAD: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('serve.mjs did not start')), 5000);
  proc.stdout.on('data', (d) => { if (d.toString().includes(`:${port}`)) { clearTimeout(timer); resolve(); } });
  proc.on('error', reject);
});
const browser = await launchBrowser('webkit');

/** A heartbeat on the page's thread: the longest gap between two 1 ms timers since `start`. */
const MONITOR = () => {
  window.__gap = { max: 0, last: performance.now(), on: false };
  const beat = () => {
    const now = performance.now();
    if (window.__gap.on) window.__gap.max = Math.max(window.__gap.max, now - window.__gap.last);
    window.__gap.last = now;
    setTimeout(beat, 1);
  };
  beat();
  window.__startGap = () => { window.__gap.max = 0; window.__gap.last = performance.now(); window.__gap.on = true; };
};

const lessonOnScreen = () => document.querySelectorAll('#solList .move-chips').length > 1;

async function open(solveMethod) {
  const context = await browser.newContext({ viewport: { width: 840, height: 682 } });
  const page = await context.newPage();
  page.setDefaultTimeout(120_000);
  await page.addInitScript((m) => {
    localStorage.setItem('cubusSettings', JSON.stringify({
      theme: 'auto', palette: 'muted', autosolve: false, cameraId: '', navHidden: [], navDefaults: 99,
      devRandCube: true, language: '', dragRotate: false, solveTier: 'twenty', solveMethod: m,
    }));
  }, solveMethod);
  await page.addInitScript(MONITOR);
  await page.goto(`http://127.0.0.1:${port}/#/home`);
  await page.waitForSelector('#randCube');
  return { context, page };
}

async function cfop() {
  const { context, page } = await open('quick');
  await page.click('#randCube');
  await page.waitForFunction(() => /^\d+$/.test(document.querySelector('#moveCount')?.textContent ?? ''));
  await page.evaluate(() => window.__startGap());
  await page.click('#moreMethodsBtn');
  await page.click('.method-menu [data-method="cfop"]');
  await page.waitForFunction(lessonOnScreen);
  const ms = await page.evaluate(() => window.__gap.max);
  await context.close();
  return ms;
}

async function beginner() {
  const { context, page } = await open('beginner');
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__startGap());
  await page.click('#randCube');
  await page.waitForFunction(lessonOnScreen);
  const ms = await page.evaluate(() => window.__gap.max);
  await context.close();
  return ms;
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
try {
  for (const [name, run] of [['cfop', cfop], ['beginner', beginner]]) {
    const all = [];
    for (let i = 0; i < RUNS; i++) all.push(await run());
    console.log(`${name.padEnd(9)} longest block on the UI thread: median ${median(all).toFixed(0)} ms, worst ${Math.max(...all).toFixed(0)} ms  [${all.map((x) => x.toFixed(0)).join(', ')}]`);
  }
} finally {
  await browser.close();
  proc.kill('SIGTERM');
}
