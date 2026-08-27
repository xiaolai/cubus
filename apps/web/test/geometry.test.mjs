// The layout contract, measured in a real WebKit — dev-docs/stage-contract.md.
//
// The stylesheet is the runtime of the contract, and no text test can tell whether a container
// unit resolved, a container query flipped, or a popover stayed on the stage. This file loads the
// real index.html + lib/app.js in headless WebKit (the engine every shipped build is), resizes it
// to each fixture with the fixture's OS insets standing in through `?insets=`, and measures:
//
//   - .app pads itself by exactly the insets — the page runs under the notch, the app does not;
//   - .stage is the safe area less the title bar, edge to edge;
//   - --ref-w/--ref-h resolve to the reference box the oracle (lib/stage.js) computes for the
//     stage's content box — 4:3 on a landscape stage, 3:4 on a portrait one;
//   - a popover opened on the stage is clamped inside it.
//
// It fails loudly without the browser: `pnpm exec playwright install webkit` (CI does this).
// Screens' own regions are step 3 of the contract's order and are asserted there, not here.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright';

import { fitStage } from '../lib/stage.js';

const PORT = 5197; // serve.test.mjs owns 5199; node --test runs files in parallel
const BASE = `http://127.0.0.1:${PORT}`;
const SERVE = fileURLToPath(new URL('../serve.mjs', import.meta.url));
let proc;
let browser;

before(async () => {
  proc = spawn(process.execPath, [SERVE], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('serve.mjs did not start within 5s')), 5000);
    proc.stdout.on('data', (d) => {
      if (d.toString().includes(`:${PORT}`)) { clearTimeout(timeout); resolve(); }
    });
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

// [top, right, bottom, left] insets are the OS's: status bar / Dynamic Island / home indicator.
// The desktop windows are what the contract's formulas give for a 13" Air (stage 840×630 and
// 574×765) plus the 52px title bar the Mac draws in WebKit — detectPlatform() reads the engine,
// and headless WebKit reports as macOS. The other engines' bar is read back, not assumed.
const FIXTURES = [
  { name: 'desktop landscape window', width: 840, height: 682, insets: [0, 0, 0, 0] },
  { name: 'desktop portrait window', width: 574, height: 817, insets: [0, 0, 0, 0] },
  { name: 'iPhone 16', width: 393, height: 852, insets: [59, 0, 34, 0] },
  { name: 'iPhone SE', width: 375, height: 667, insets: [20, 0, 0, 0] },
  { name: 'iPad 11" landscape', width: 1180, height: 820, insets: [24, 0, 26, 0] },
  { name: 'iPad 11" portrait', width: 820, height: 1180, insets: [24, 0, 26, 0] },
  { name: 'iPad Split View column', width: 320, height: 1100, insets: [24, 0, 26, 0] },
];

const near = (a, b, what, tol = 1) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (±${tol})`);

async function open({ width, height, insets }) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));
  await page.goto(`${BASE}/?insets=${insets.join(',')}#/home`);
  await page.waitForSelector('.screen.active', { timeout: 10_000 });
  return { page, context, errors };
}

/** Everything the assertions need, read in one round trip. The probe is a throwaway element sized
 *  by the reference-box properties: custom properties only resolve when something uses them. */
const measure = (page) =>
  page.evaluate(() => {
    const px = (v) => Number.parseFloat(v);
    const app = document.querySelector('.app');
    const stage = document.getElementById('stage');
    const screen = document.querySelector('.screen.active');
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;width:var(--ref-w);height:var(--ref-h)';
    screen.appendChild(probe);
    const p = probe.getBoundingClientRect();
    probe.remove();
    const s = stage.getBoundingClientRect();
    const cs = getComputedStyle(stage);
    const a = getComputedStyle(app);
    return {
      viewport: { w: innerWidth, h: innerHeight },
      supports: CSS.supports('width', '1cqw') && CSS.supports('container-type', 'size'),
      appPad: [a.paddingTop, a.paddingRight, a.paddingBottom, a.paddingLeft].map(px),
      titlebar: px(getComputedStyle(document.documentElement).getPropertyValue('--titlebar-h')),
      stage: { top: s.top, right: s.right, bottom: s.bottom, left: s.left, width: s.width, height: s.height },
      stagePad: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(px),
      ref: { w: p.width, h: p.height },
    };
  });

for (const fixture of FIXTURES) {
  test(`geometry: ${fixture.name} (${fixture.width}×${fixture.height}, insets ${fixture.insets.join('/')})`, async () => {
    const { page, context, errors } = await open(fixture);
    try {
      const m = await measure(page);
      assert.ok(m.supports, 'this WebKit has no container-query units — the floor the contract declares');
      assert.deepEqual(errors.map(String), [], 'the page threw');
      assert.deepEqual(m.viewport, { w: fixture.width, h: fixture.height });

      const [t, r, b, l] = fixture.insets;
      assert.deepEqual(m.appPad, [t, r, b, l], '.app padding is not the insets');

      // The stage: the safe area, less the title bar, edge to edge.
      near(m.stage.left, l, 'stage left');
      near(m.stage.right, fixture.width - r, 'stage right');
      near(m.stage.top, t + m.titlebar, 'stage top');
      near(m.stage.bottom, fixture.height - b, 'stage bottom');

      // The reference box, fit to the stage's CONTENT box: container units measure that.
      const [pt, pr, pb, pl] = m.stagePad;
      const expected = fitStage({ width: m.stage.width - pl - pr, height: m.stage.height - pt - pb });
      near(m.ref.w, expected.ref.w, `--ref-w (${expected.orientation})`);
      near(m.ref.h, expected.ref.h, `--ref-h (${expected.orientation})`);
      const boxRatio = expected.orientation === 'landscape' ? m.ref.w / m.ref.h : m.ref.h / m.ref.w;
      near(boxRatio, 4 / 3, 'reference box ratio', 0.01);
    } finally {
      await context.close();
    }
  });
}

test('a popover opened on the stage stays inside it', async () => {
  const { page, context } = await open(FIXTURES[0]);
  try {
    await page.click('#speedBtn');
    const boxes = await page.evaluate(() => {
      const r = (el) => { const b = el.getBoundingClientRect(); return { top: b.top, right: b.right, bottom: b.bottom, left: b.left }; };
      const menu = document.querySelector('.menu:not([hidden])');
      return { menu: menu && r(menu), stage: r(document.getElementById('stage')), position: menu && getComputedStyle(menu).position };
    });
    assert.ok(boxes.menu, 'the speed menu did not open');
    assert.equal(boxes.position, 'absolute');
    assert.ok(boxes.menu.left >= boxes.stage.left && boxes.menu.right <= boxes.stage.right, `menu ${JSON.stringify(boxes.menu)} leaves the stage horizontally ${JSON.stringify(boxes.stage)}`);
    assert.ok(boxes.menu.top >= boxes.stage.top && boxes.menu.bottom <= boxes.stage.bottom, `menu ${JSON.stringify(boxes.menu)} leaves the stage vertically ${JSON.stringify(boxes.stage)}`);
  } finally {
    await context.close();
  }
});
