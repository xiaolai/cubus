// The layout contract, measured in a real WebKit — dev-docs/stage-contract.md.
//
// The stylesheet is the runtime of the contract, and no text test can tell whether a container
// unit resolved, a container query flipped, or a popover stayed on the stage. This file loads the
// real index.html + lib/app.js in headless WebKit (the engine every shipped build is), resizes it
// to each fixture with the fixture's OS insets standing in through `?insets=`, and measures:
//
//   - .app pads itself by exactly the insets — the page runs under the notch, the app does not;
//   - .stage is the safe area less the app's bars, edge to edge;
//   - --ref-w/--ref-h resolve to the reference box the oracle (lib/stage.js) computes for the
//     stage's content box — 4:3 on a landscape stage, 3:4 on a portrait one;
//   - the chrome: tabs over the title bar's centre in landscape, clear of its outer zones; a
//     bottom bar in portrait that the stage stops above;
//   - on a coarse pointer (a finger), a 52px bar and every control at 44px or more;
//   - the cube screen's three regions, in both compositions;
//   - a popover opened on the stage is clamped inside it.
//
// It fails loudly without the browser: `pnpm exec playwright install webkit` (CI does this).

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
// and headless WebKit reports as macOS. `touch` runs the fixture with a coarse pointer, which is
// what a real iPad or phone is; the same size without it is a desktop window of that shape.
const FIXTURES = [
  { name: 'desktop landscape window', width: 840, height: 682, insets: [0, 0, 0, 0] },
  { name: 'desktop portrait window', width: 574, height: 817, insets: [0, 0, 0, 0] },
  { name: 'iPhone 16', width: 393, height: 852, insets: [59, 0, 34, 0], touch: true },
  { name: 'iPhone SE', width: 375, height: 667, insets: [20, 0, 0, 0], touch: true },
  { name: 'iPad 11" landscape', width: 1180, height: 820, insets: [24, 0, 26, 0], touch: true },
  { name: 'iPad 11" portrait', width: 820, height: 1180, insets: [24, 0, 26, 0], touch: true },
  { name: 'iPad 11" landscape, mouse', width: 1180, height: 820, insets: [24, 0, 26, 0] },
  { name: 'iPad Split View column', width: 320, height: 1100, insets: [24, 0, 26, 0], touch: true },
];

const near = (a, b, what, tol = 1) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (±${tol})`);
const label = (f) => `${f.name} (${f.width}×${f.height}, insets ${f.insets.join('/')}${f.touch ? ', touch' : ''})`;

async function open(fixture, route = 'home') {
  const context = await browser.newContext({ viewport: { width: fixture.width, height: fixture.height }, hasTouch: fixture.touch === true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));
  await page.goto(`${BASE}/?insets=${fixture.insets.join(',')}#/${route}`);
  await page.waitForSelector('.screen.active', { timeout: 10_000 });
  return { page, context, errors };
}

/** A DOMRect as plain numbers. Inlined into page.evaluate source below, so keep it self-contained. */
const rect = (el) => {
  const b = el.getBoundingClientRect();
  return { top: b.top, right: b.right, bottom: b.bottom, left: b.left, width: b.width, height: b.height };
};

/** Everything the foundation assertions need, read in one round trip. The probe is a throwaway
 *  element sized by the reference-box properties: custom properties only resolve when used. */
const measure = (page) =>
  page.evaluate(`(() => {
    const rect = ${rect.toString()};
    const px = (v) => Number.parseFloat(v);
    const $ = (s) => document.querySelector(s);
    const app = $('.app');
    const stage = $('#stage');
    const screen = $('.screen.active');
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;width:var(--ref-w);height:var(--ref-h)';
    screen.appendChild(probe);
    const p = rect(probe);
    probe.remove();
    const cs = getComputedStyle(stage);
    const a = getComputedStyle(app);
    const nav = $('#nav');
    const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    return {
      viewport: { w: innerWidth, h: innerHeight },
      supports: CSS.supports('width', '1cqw') && CSS.supports('container-type', 'size'),
      coarse: matchMedia('(pointer: coarse)').matches,
      platform: document.documentElement.dataset.platform,
      appPad: [a.paddingTop, a.paddingRight, a.paddingBottom, a.paddingLeft].map(px),
      titlebar: px(getComputedStyle(document.documentElement).getPropertyValue('--titlebar-h')),
      stage: rect(stage),
      stagePad: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(px),
      ref: { w: p.width, h: p.height },
      nav: { position: getComputedStyle(nav).position, compact: nav.classList.contains('compact'), ...rect(nav) },
      lead: rect($('#tbLead')), trail: rect($('#tbTrail')), bar: rect($('#titlebar')),
      tabs: [...nav.querySelectorAll('.nav-item')].map(rect),
      // The toggle is excluded: its 44px hit area is a ::before, which no rect reports.
      controls: [...document.querySelectorAll('button, .chip-m, .pill')].filter(visible).map((el) => ({ what: el.id || el.className, ...rect(el) })),
    };
  })()`);

for (const fixture of FIXTURES) {
  test(`geometry: ${label(fixture)}`, async () => {
    const { page, context, errors } = await open(fixture);
    try {
      const m = await measure(page);
      assert.ok(m.supports, 'this WebKit has no container-query units — the floor the contract declares');
      assert.deepEqual(errors.map(String), [], 'the page threw');
      assert.deepEqual(m.viewport, { w: fixture.width, h: fixture.height });
      assert.equal(m.coarse, fixture.touch === true, 'the pointer the engine reports is not the one the fixture asked for');

      const [t, r, b, l] = fixture.insets;
      assert.deepEqual(m.appPad, [t, r, b, l], '.app padding is not the insets');
      const portrait = fixture.height - t - b > fixture.width - l - r;

      // The chrome. Landscape: the tabs float over the bar's centre, clear of both outer zones
      // (compact if that is what it took). Portrait: a bottom bar, in flow, above the inset.
      if (portrait) {
        assert.equal(m.nav.position, 'static', 'portrait: the tab row is in flow');
        near(m.nav.bottom, fixture.height - b, 'portrait: tab bar sits on the bottom inset');
        near(m.nav.left, l, 'portrait: tab bar spans from the left inset');
        near(m.nav.right, fixture.width - r, 'portrait: tab bar spans to the right inset');
        assert.ok(!m.nav.compact, 'portrait: labels always fit under the icons');
      } else {
        assert.equal(m.nav.position, 'absolute', 'landscape: the tab row floats over the bar');
        assert.ok(m.nav.top >= m.bar.top - 0.5 && m.nav.bottom <= m.bar.bottom + 0.5, `landscape: tabs ${JSON.stringify(m.nav)} outside the bar ${JSON.stringify(m.bar)}`);
        assert.ok(m.nav.left >= m.lead.right - 0.5, `landscape: tabs collide with the lead zone (${m.nav.left} < ${m.lead.right})`);
        assert.ok(m.nav.right <= m.trail.left + 0.5, `landscape: tabs collide with the trail zone (${m.nav.right} > ${m.trail.left})`);
        near((m.nav.left + m.nav.right) / 2, (m.bar.left + m.bar.right) / 2, 'landscape: tabs on the bar\'s centre line', 1.5);
      }
      for (const tab of m.tabs) assert.ok(tab.width > 0 && tab.height > 0, 'a tab has no size');

      // A finger: the 52px bar, a phone/tablet platform (no traffic lights), 44px controls.
      if (fixture.touch) {
        assert.equal(m.titlebar, 52, 'touch: the bar is 52');
        assert.ok(['ios', 'android'].includes(m.platform), `touch: platform ${m.platform} draws desktop chrome`);
        const small = m.controls.filter((c) => c.width < 44 - 0.5 || c.height < 44 - 0.5);
        assert.deepEqual(small, [], 'touch: controls under 44px');
      }

      // The stage: the safe area, less the bar (and the tab bar in portrait), edge to edge.
      const tabbar = m.nav.position === 'static' ? m.nav.height : 0;
      near(m.stage.left, l, 'stage left');
      near(m.stage.right, fixture.width - r, 'stage right');
      near(m.stage.top, t + m.titlebar, 'stage top');
      near(m.stage.bottom, fixture.height - b - tabbar, 'stage bottom');

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

// ---- the cube screen's composition --------------------------------------------------------------
//
// Scramble rather than Home: a fresh app's cube is solved, so Home walks an empty solution; the
// scramble screen rolls one and fills the sheet with chips, which is the state the regions have
// to hold. One DOM, two compositions: beside the cube in landscape, under it in portrait.

// Evaluated from source text: `rect` must exist inside the page, so its definition is inlined.
const measureCube = (page) =>
  page.evaluate(`(() => {
    const rect = ${rect.toString()};
    const px = (v) => Number.parseFloat(v);
    const $ = (s) => document.querySelector(s);
    const screen = $('.screen.active');
    const cs = getComputedStyle(screen);
    const share = px(cs.getPropertyValue('--primary-share'));
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;width:var(--ref-w);height:var(--ref-h)';
    screen.appendChild(probe);
    const ref = rect(probe);
    probe.remove();
    const stage = $('#stage');
    const scs = getComputedStyle(stage);
    const content = {
      w: stage.clientWidth - px(scs.paddingLeft) - px(scs.paddingRight),
      h: stage.clientHeight - px(scs.paddingTop) - px(scs.paddingBottom),
    };
    const cols = $('.cols');
    const canvas = $('#viewCube canvas');
    const chips = [...document.querySelectorAll('.chip-m')].map(rect);
    return {
      share, ref: { w: ref.width, h: ref.height }, content,
      colsGap: px(cs.getPropertyValue('--cols-gap')), rowsGap: px(cs.getPropertyValue('--rows-gap')),
      walking: cols.classList.contains('walking'),
      cols: rect(cols), primary: rect($('.cols > .primary')), aux: rect($('.cols > .aux')), sheet: rect($('.cols > .aside')),
      solution: rect($('.solution-card')), state: rect($('.state-card')),
      transport: { first: rect($('#prevBtn')), last: rect($('#stepLbl')), scroll: $('.transport').scrollWidth, client: $('.transport').clientWidth },
      slot: rect($('#viewCube')), canvas: canvas && rect(canvas),
      chips, overflow: { cols: cols.scrollWidth - cols.clientWidth, doc: document.documentElement.scrollWidth - innerWidth },
    };
  })()`);

for (const fixture of FIXTURES) {
  test(`cube screen composition: ${label(fixture)}`, async () => {
    const { page, context } = await open(fixture, 'scramble');
    try {
      await page.click('#randCube');
      await page.waitForSelector('.chip-m', { timeout: 15_000 });
      const m = await measureCube(page);
      const portrait = m.content.h > m.content.w;
      assert.ok(m.walking, 'the scramble screen walks a scramble');
      assert.ok(m.chips.length > 0, 'no chips on the sheet');

      // The composition box: the reference box on the short axis, the whole stage on the long one.
      if (portrait) {
        near(m.cols.width, m.ref.w, 'portrait: cols width is the reference width');
        near(m.cols.height, m.content.h, 'portrait: cols height is the stage content height');
      } else {
        near(m.cols.height, m.ref.h, 'landscape: cols height is the reference height');
        near(m.cols.width, m.content.w, 'landscape: cols width is the stage content width');
      }

      // primary: --primary-share of the reference box's long side, less half a gap.
      if (portrait) near(m.primary.height, m.ref.h * m.share - m.rowsGap / 2, 'portrait: primary height');
      else near(m.primary.width, m.ref.w * m.share - m.colsGap / 2, 'landscape: primary width');

      // aux directly under primary; sheet beside (landscape) or below (portrait), to the box's edge.
      assert.ok(m.aux.top >= m.primary.bottom - 1, 'aux is under the primary');
      near(m.aux.left, m.primary.left, 'aux shares the primary\'s left edge');
      if (portrait) {
        assert.ok(m.sheet.top >= m.aux.bottom - 1, 'portrait: sheet is under the aux');
        near(m.sheet.width, m.cols.width, 'portrait: sheet spans the box');
        assert.ok(m.solution.top < m.state.top, 'portrait: the solution comes before the net');
        assert.ok(m.solution.height > 140 + 1 || m.chips.length <= 6, 'portrait: the solution card grew to its chips instead of scrolling inside');
      } else {
        assert.ok(m.sheet.left >= m.primary.right + m.colsGap - 1, 'landscape: sheet is beside the primary');
        near(m.sheet.right, m.cols.right, 'landscape: sheet reaches the box\'s right edge');
        near(m.sheet.bottom, m.cols.bottom, 'landscape: sheet reaches the box\'s bottom edge');
        assert.ok(m.state.top < m.solution.top, 'landscape: the net comes before the solution');
      }

      // One transport line at and above the contract's portrait floor (375 wide), mouse or finger;
      // a narrower column may wrap the bar. Never a row wider than its card.
      assert.ok(m.transport.scroll <= m.transport.client + 1, 'the transport overflows its card');
      // Centres, not tops: a 38px button and a 20px label share a centre line, not a top edge.
      const mid = (r) => r.top + r.height / 2;
      if (fixture.width >= 375) near(mid(m.transport.first), mid(m.transport.last), 'transport wrapped', 2);

      // Every chip on the sheet, horizontally; nothing wider than the stage.
      for (const c of m.chips) assert.ok(c.left >= m.sheet.left - 1 && c.right <= m.sheet.right + 1, `a chip leaves the sheet: ${JSON.stringify(c)}`);
      assert.ok(m.overflow.cols <= 1, `the composition overflows its box by ${m.overflow.cols}px`);
      assert.ok(m.overflow.doc <= 0, `the page overflows the viewport by ${m.overflow.doc}px`);

      // The renderer sized its canvas to the slot the composition gave it.
      assert.ok(m.canvas, 'no canvas in the cube slot — the renderer did not mount');
      near(m.canvas.width, m.slot.width, 'canvas width is the slot width', 2);
      near(m.canvas.height, m.slot.height, 'canvas height is the slot height', 2);
    } finally {
      await context.close();
    }
  });
}

test('a popover opened on the stage stays inside it', async () => {
  const { page, context } = await open(FIXTURES[0]);
  try {
    await page.click('#speedBtn');
    const boxes = await page.evaluate(`(() => {
      const rect = ${rect.toString()};
      const menu = document.querySelector('.menu:not([hidden])');
      return { menu: menu && rect(menu), stage: rect(document.getElementById('stage')), position: menu && getComputedStyle(menu).position };
    })()`);
    assert.ok(boxes.menu, 'the speed menu did not open');
    assert.equal(boxes.position, 'absolute');
    assert.ok(boxes.menu.left >= boxes.stage.left && boxes.menu.right <= boxes.stage.right, `menu ${JSON.stringify(boxes.menu)} leaves the stage horizontally ${JSON.stringify(boxes.stage)}`);
    assert.ok(boxes.menu.top >= boxes.stage.top && boxes.menu.bottom <= boxes.stage.bottom, `menu ${JSON.stringify(boxes.menu)} leaves the stage vertically ${JSON.stringify(boxes.stage)}`);
  } finally {
    await context.close();
  }
});
