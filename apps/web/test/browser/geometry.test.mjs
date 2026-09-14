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
//   - the composition box spans that content box on BOTH axes, on every fixture and on every
//     screen: the reference box is the minimum a composition is designed at, not the box that
//     gets drawn (amended 2026-09-06 — before it the short axis was clamped to the reference and
//     the difference was drawn as paper);
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

import { pace } from '../browser-wait.mjs';

import { fitStage } from '../../lib/stage.js';
import { freePort } from '../free-port.mjs';

// Asked of the OS in before(), not chosen: a fixed port collides with an orphaned server
// from an interrupted run, which fails at startup and reads like a regression. See free-port.mjs.
let PORT;
let BASE;
const SERVE = fileURLToPath(new URL('../../serve.mjs', import.meta.url));
let proc;
let browser;

before(async () => {
  PORT = await freePort();
  BASE = `http://127.0.0.1:${PORT}`;
  proc = spawn(process.execPath, [SERVE], { env: { ...process.env, PORT: String(PORT), CUBUS_LIVE_RELOAD: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    // Say WHY it did not start. serve.mjs refuses a busy port with a precise message naming the
    // port and how to free it, but that goes to its own stderr, so a bare timeout here reads as a
    // regression in whatever changed last. An interrupted run leaves the server orphaned and every
    // later run then fails this way — it cost two wrong diagnoses on 2026-08-30 before anyone read
    // the child's output. Fail loud: hand the child's own words back.
    // 20 s, not 5: the port is the OS's now, so a collision is no longer the cause — but under the
    // full suite's fan-out a cold node start is queued work, and a start budget is an AVAILABILITY
    // wait, not an assertion. Patience here costs nothing on success and removes a false red.
    let said = '';
    const note = (d) => { said += d.toString(); };
    const timeout = setTimeout(
      () => reject(new Error(`serve.mjs did not start within 20s on port ${PORT}. It said: ${said.trim() || '(nothing)'}`)),
      20_000,
    );
    proc.stdout.on('data', (d) => {
      note(d);
      if (d.toString().includes(`:${PORT}`)) { clearTimeout(timeout); resolve(); }
    });
    proc.stderr.on('data', note);
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

/**
 * A context, from a browser that has not served too many.
 *
 * ONE browser for the whole file was the shape until 2026-09-04, and it has a ceiling. This
 * WebKit build stops completing navigations after ~63 sequential contexts in one browser
 * process: the 64th `page.goto` waits for a `load` that never arrives and dies on the 120 s
 * navigation bound. Measured deterministically — three full runs, the same ordinal every time,
 * on a loaded machine and on an idle one — and the dev server was verified RESPONSIVE at the
 * moment of the hang (`curl` returned index.html and both vendor bundles in milliseconds), so
 * the wedge is on the browser side and has nothing to do with what is being served.
 *
 * The cost of not handling it is a test suite that accuses whichever screen happens to be 64th.
 * It was `lessons` three times running, and that same test passes in 1.3 s when it is not 64th —
 * which is exactly the kind of red that gets "fixed" by changing an innocent screen.
 *
 * Nothing about a test changes here: same fixtures, same measurements, same assertions, same
 * one-context-per-test isolation. Only which browser process serves it. The bound is well under
 * the observed ceiling rather than at it, because a ceiling measured on one machine is not a
 * constant — and a browser relaunch costs about a second, twice in a full run.
 */
const CONTEXTS_PER_BROWSER = 24;
let servedContexts = 0;
async function freshContext(options) {
  if (servedContexts >= CONTEXTS_PER_BROWSER) {
    await browser.close();
    browser = await webkit.launch();
    servedContexts = 0;
  }
  servedContexts += 1;
  return browser.newContext(options);
}

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

async function open(fixture, route = 'home', settings = null) {
  const context = await freshContext({ viewport: { width: fixture.width, height: fixture.height }, hasTouch: fixture.touch === true });
  // A stored setting a case needs — the developer die, to put a scrambled cube on Home — goes in
  // before the page runs, because the app reads its settings at module scope.
  if (settings) await context.addInitScript((s) => localStorage.setItem('cubusSettings', JSON.stringify(s)), settings);
  // node --test saturates the machine by design, and a WebKit navigation on a saturated
  // machine is queued work, not a hung page — the 30 s default read exactly that as failure
  // (2026-08-29, two fixtures, both clean alone), and even 120 s was exceeded under the full
  // unbounded fan-out, which is why package.json bounds --test-concurrency as well. Both
  // halves are needed. The selector waits below still bound the app's own boot.
  const page = await context.newPage();
  pace(page); // both bounds, navigation included — see BROWSER_NAV_MS

  const errors = [];
  page.on('pageerror', (e) => errors.push(e));
  await page.goto(`${BASE}/?insets=${fixture.insets.join(',')}#/${route}`);
  // 30 s, not 10: this is an AVAILABILITY wait (did the app mount), not an assertion —
  // under test-concurrency=6, six webkits and dev servers share one machine, and the mount
  // once lost a 10 s race (2026-08-30) while every geometry assertion behind it would have
  // passed. Generous waits here; the strictness belongs to the geometry checks themselves.
  await page.waitForSelector('.screen.active');
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
    // The composition box. Every routable screen draws one, but this reads it defensively rather
    // than assuming it, so a screen that draws none fails saying so instead of throwing inside
    // the probe. (No backticks in this comment: it lives inside the template literal this whole
    // probe is written in, and one would end the string.)
    const cols = $('.cols');
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
      cols: cols && rect(cols),
      nav: { position: getComputedStyle(nav).position, padBottom: px(getComputedStyle(nav).paddingBottom), ...rect(nav) },
      winPadBottom: px(getComputedStyle($('.win')).paddingBottom),
      lead: rect($('#tbLead')), trail: rect($('#tbTrail')), bar: rect($('#titlebar')),
      // The zones' CONTENT: the tabs must clear these, whatever box the engine gave the zones.
      brand: rect($('#tbLead .brand')), gear: rect($('#tbTrail [aria-label="Settings"]')),
      // The label's BOX, not its text. (No backticks in this comment: it lives inside the
      // template literal this whole probe is written in, and one would end the string.)
      // textContent reports a display:none label just as happily as a drawn one, so a test
      // written on it would pass whichever composition was on screen — which is the entire
      // thing under test here.
      tabs: [...nav.querySelectorAll('.nav-item')].map((el) => {
        const lbl = el.querySelector('.lbl');
        return {
          ...rect(el),
          text: el.textContent.trim(),
          name: el.getAttribute('aria-label') || '',
          label: lbl ? { ...rect(lbl), text: lbl.textContent.trim() } : null,
        };
      }),
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
      // The BOTTOM inset is deliberately not .app's. Whatever is bottom-most owns it, because a
      // bar whose background stops short of the screen edge leaves a strip of paper under it
      // (reported from a real iPad, 2026-08-30). In landscape the stage is bottom-most, so .win
      // pads; in portrait the tab bar is, so it grows by the inset and pads by it, and its
      // background reaches the edge. The safe CONTENT area is identical either way, which the
      // stage assertions below still measure against the same numbers as before.
      assert.deepEqual(m.appPad, [t, r, 0, l], '.app should pad top/right/left only');
      const portrait = fixture.height - t - b > fixture.width - l - r;
      assert.equal(
        portrait ? m.winPadBottom : m.nav.padBottom, 0,
        portrait ? 'portrait: .win must not also pad the bottom inset' : 'landscape: the floating tab row must not pad the bottom inset',
      );
      assert.equal(
        portrait ? m.nav.padBottom : m.winPadBottom, b,
        portrait ? 'portrait: the tab bar carries the bottom inset' : 'landscape: .win carries the bottom inset',
      );

      // The chrome. Landscape: the tabs float over the bar's centre, clear of both outer zones
      // Portrait: a bottom bar, in flow, whose background reaches the screen edge.
      if (portrait) {
        assert.equal(m.nav.position, 'static', 'portrait: the tab row is in flow');
        // The bar bleeds its background through the inset and insets only its content — what a
        // native tab bar does, and what leaves no paper strip under it.
        near(m.nav.bottom, fixture.height, 'portrait: the tab bar background reaches the screen edge');
        near(m.nav.bottom - m.nav.padBottom, fixture.height - b, 'portrait: the tabs themselves sit above the bottom inset');
        near(m.nav.left, l, 'portrait: tab bar spans from the left inset');
        near(m.nav.right, fixture.width - r, 'portrait: tab bar spans to the right inset');
      } else {
        assert.equal(m.nav.position, 'absolute', 'landscape: the tab row floats over the bar');
        assert.ok(m.nav.top >= m.bar.top - 0.5 && m.nav.bottom <= m.bar.bottom + 0.5, `landscape: tabs ${JSON.stringify(m.nav)} outside the bar ${JSON.stringify(m.bar)}`);
        assert.ok(m.nav.left >= m.lead.right - 0.5, `landscape: tabs collide with the lead zone (${m.nav.left} < ${m.lead.right})`);
        assert.ok(m.nav.right <= m.trail.left + 0.5, `landscape: tabs collide with the trail zone (${m.nav.right} > ${m.trail.left})`);
        // The zones' content, not just their boxes: the wordmark once overflowed its zone under the tabs.
        assert.ok(m.brand.right <= m.lead.right + 0.5, `landscape: the wordmark overflows its zone (${m.brand.right} > ${m.lead.right})`);
        assert.ok(m.nav.left >= m.brand.right - 0.5, `landscape: tabs collide with the wordmark (${m.nav.left} < ${m.brand.right})`);
        assert.ok(m.nav.right <= m.gear.left + 0.5, `landscape: tabs collide with Settings (${m.nav.right} > ${m.gear.left})`);
        near((m.nav.left + m.nav.right) / 2, (m.bar.left + m.bar.right) / 2, 'landscape: tabs on the bar\'s centre line', 1.5);
      }
      for (const tab of m.tabs) assert.ok(tab.width > 0 && tab.height > 0, 'a tab has no size');
      // The word is drawn where there is room for it and not where there is none — and either
      // way the row is announced, because the accessible name is on the button rather than in
      // the span. A tab with no name is a button a screen reader cannot announce at all.
      for (const tab of m.tabs) {
        assert.ok(tab.name.length > 0, 'a tab has no accessible name');
        assert.ok(tab.label, 'a tab has no label span at all — nothing to draw in either composition');
        assert.equal(tab.label.text, tab.name, 'the drawn word and the announced word must be the same word');
        if (portrait) {
          assert.ok(
            tab.label.width > 0 && tab.label.height > 0,
            `portrait: the bottom bar must draw "${tab.name}" under its icon`,
          );
          // Inside the tab, not spilling out of it: the ellipsis rule is what keeps a long word
          // from widening the row it shares with seven others.
          assert.ok(
            tab.label.left >= tab.left - 0.5 && tab.label.right <= tab.right + 0.5,
            `portrait: the label of "${tab.name}" overflows its tab`,
          );
        } else {
          assert.equal(
            tab.label.width, 0,
            `landscape: the floating row has no room for words, but "${tab.name}" is drawn`,
          );
        }
      }

      // A finger: the 52px bar, a phone/tablet platform (no traffic lights), 44px controls.
      if (fixture.touch) {
        assert.equal(m.titlebar, 52, 'touch: the bar is 52');
        assert.ok(['ios', 'android'].includes(m.platform), `touch: platform ${m.platform} draws desktop chrome`);
        const small = m.controls.filter((c) => c.width < 44 - 0.5 || c.height < 44 - 0.5);
        assert.deepEqual(small, [], 'touch: controls under 44px');
      }

      // The stage: the safe area, less the bar (and the tab bar in portrait), edge to edge.
      const tabbar = m.nav.position === 'static' ? m.nav.height - m.nav.padBottom : 0;
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

      // And the box that is DRAWN is the stage's content box, on both axes, on every fixture —
      // the claim "no fixture shows paper" (amended 2026-09-06, the owner's call). The reference
      // box above is unchanged and still sets the primary's size; what changed is that the short
      // axis is no longer clamped to it, so the difference goes to the flexible regions instead
      // of being drawn as margin. Edges, not just width and height: a box the right SIZE sitting
      // at the wrong offset is still paper, on one side instead of two.
      // Measured against the old stylesheet, 2026-09-06 — this failed on exactly the two fixtures
      // whose long axis is shorter than 4:3 of their short one, and passed on the other six:
      //   iPad 11" portrait          box 735.75 wide in a 760.96 stage — 12.6px each side
      //   desktop portrait window    box 511.17 wide in a 532.67 stage — 10.75px each side
      assert.ok(m.cols, 'the screen drew no composition box at all');
      near(m.cols.left, m.stage.left + pl, 'the composition box starts at the stage content box\'s left edge');
      near(m.cols.right, m.stage.right - pr, 'the composition box reaches the stage content box\'s right edge');
      near(m.cols.top, m.stage.top + pt, 'the composition box starts at the stage content box\'s top edge');
      near(m.cols.bottom, m.stage.bottom - pb, 'the composition box reaches the stage content box\'s bottom edge');
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
      cols: rect(cols), primary: rect($('.cols > .primary')), aux: rect($('.cols > .aux')),
      // The aside is a box only on a finger's portrait, where it scrolls; everywhere else it is
      // display: contents and its two children are the grid's own twin and sheet.
      aside: rect($('.cols > .aside')), asideBox: getComputedStyle($('.cols > .aside')).display !== 'contents',
      sheet: rect($('.cols .sheet')), solution: rect($('.solution-card')), state: rect($('.state-card')), net: rect($('#viewNet')),
      list: { scroll: $('#solList').scrollHeight, client: $('#solList').clientHeight },
      transport: { first: rect($('#prevBtn')), last: rect($('#stepLbl')), scroll: $('.transport').scrollWidth, client: $('.transport').clientWidth,
        buttons: [...document.querySelectorAll('.transport button')].map((b) => ({ id: b.id || b.textContent.trim(), ...rect(b) })) },
      slot: rect($('#viewCube')), canvas: canvas && rect(canvas),
      // What the renderer actually painted: opaque pixels on the canvas's outermost two rows and
      // columns (a clipped picture), and in its middle (a blank canvas would pass an edge check
      // vacuously). preserveDrawingBuffer is on, so the WebGL canvas can be copied and read.
      painted: (() => {
        if (!canvas) return null;
        try {
          const w = canvas.width, h = canvas.height;
          const copy = document.createElement('canvas'); copy.width = w; copy.height = h;
          const ctx = copy.getContext('2d'); ctx.drawImage(canvas, 0, 0);
          const px = ctx.getImageData(0, 0, w, h).data;
          const opaque = (x, y) => px[(y * w + x) * 4 + 3] > 8;
          let edge = 0, middle = 0;
          for (let x = 0; x < w; x++) for (const y of [0, 1, h - 2, h - 1]) if (opaque(x, y)) edge++;
          for (let y = 0; y < h; y++) for (const x of [0, 1, w - 2, w - 1]) if (opaque(x, y)) edge++;
          for (let y = Math.floor(h * 0.4); y < h * 0.6; y++) for (let x = Math.floor(w * 0.4); x < w * 0.6; x++) if (opaque(x, y)) middle++;
          return { edge, middle, w, h };
        } catch (e) { return { error: String(e) }; }
      })(),
      chips, overflow: { cols: cols.scrollWidth - cols.clientWidth, colsV: cols.scrollHeight - cols.clientHeight, doc: document.documentElement.scrollWidth - innerWidth },
    };
  })()`);

// A STAGE TARGET ON THE CUBE SCREEN. The side card grows a picture of the target, and with the
// Initial State net above it that card was 603px of content in a 470px row on the desktop landscape
// window — drawn over the sheet, where a child could not press "first layer" (2026-09-13); 86px
// past the cube on the desktop portrait window and 80px into the sheet on an iPad in landscape.
// The composition case below never saw it: it measures the Scramble screen, where there is no
// target. So this measures Home with the longest target shown, on every fixture.
for (const fixture of FIXTURES) {
  test(`cube screen with a stage target: ${label(fixture)}`, async () => {
    const { page, context } = await open(fixture, 'home', { devRandCube: true });
    try {
      await page.click('#randCube');
      await page.waitForSelector('.chip-m');
      // The longest stage name, so the heading and the line under the picture are at their longest.
      await page.click('[data-stage="corners-home"]');
      await page.waitForFunction(
        () => /way back|couldn’t|already/.test(document.querySelector('#moveCount')?.textContent ?? ''),
        null,
        { timeout: 90_000 },
      );
      const m = await page.evaluate(`(() => {
        const rect = ${rect.toString()};
        const $ = (s) => document.querySelector(s);
        const card = $('.state-card');
        const cols = $('.cols');
        // Hit-tested at each control's centre WITHOUT scrolling anything. Scrolling a clipped stage
        // to reach one control moves every other box, and the measurement stops meaning anything —
        // an exploratory probe that scrolled reported controls covered by the stage itself.
        const covered = [...document.querySelectorAll('[data-stage], #prevBtn, #repeatBtn, #nextBtn, #playBtn, #stepLbl')]
          .filter((el) => el.getBoundingClientRect().width > 0)
          .map((el) => {
            const b = el.getBoundingClientRect();
            const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
            return hit && hit !== el && !el.contains(hit) ? (el.dataset.stage || el.id) + ' under ' + hit.className : null;
          })
          .filter(Boolean);
        return {
          netHidden: $('#viewNet').hidden, aimShown: !$('#stageAim').hidden, heading: $('.state-h').textContent,
          state: rect(card), stateScroll: card.scrollHeight, stateClient: card.clientHeight,
          aimNet: rect($('#stageAimNet')), primary: rect($('.cols > .primary')), sheet: rect($('.cols .sheet')),
          asideBox: getComputedStyle($('.cols > .aside')).display !== 'contents',
          colsV: cols.scrollHeight - cols.clientHeight, covered,
        };
      })()`);
      assert.ok(m.aimShown, 'the target picture is shown');
      assert.ok(m.netHidden, 'and it takes the Initial State net\'s place — the card cannot hold both');
      assert.equal(m.heading, 'Aiming at the top corners home', 'the heading says what the picture is');
      assert.ok(m.stateScroll <= m.stateClient + 1,
        `the side card holds ${m.stateScroll}px of content in ${m.stateClient}px — the rest is drawn over its neighbours`);
      assert.ok(inside(m.aimNet, m.state), `the target picture ${JSON.stringify(m.aimNet)} leaves its card ${JSON.stringify(m.state)}`);
      if (!m.asideBox) {
        // The grid compositions, where the card has a row of its own and nothing clips it.
        const portrait = m.sheet.top >= m.primary.bottom - 1;
        if (portrait) assert.ok(m.state.bottom <= m.primary.bottom + 1, 'portrait: the card is no taller than the cube');
        else assert.ok(m.state.bottom <= m.sheet.top + 1, 'landscape: the card ends above the sheet');
      }
      if (!fixture.touch) assert.ok(m.colsV <= 1, `the composition overflows its box vertically by ${m.colsV}px`);
      // Covered controls, where an overlap can only be a layout defect: the grid compositions, in
      // which nothing scrolls and every region has a box of its own. In a finger's portrait the aside
      // is a scrolling column laid out in flow, so the card cannot overlap a sibling; what sits over
      // a control there is the fixed tab bar over content scrolled below the fold, which is that
      // composition working (the iPhone SE's stage buttons, 2026-09-13). The card itself is held by
      // the two assertions above on every fixture.
      if (!m.asideBox) assert.deepEqual(m.covered, [], 'nothing is drawn over a stage button or the transport');
    } finally {
      await context.close();
    }
  });
}

for (const fixture of FIXTURES) {
  test(`cube screen composition: ${label(fixture)}`, async () => {
    const { page, context } = await open(fixture, 'scramble');
    try {
      await page.click('#randCube');
      await page.waitForSelector('.chip-m');
      // The renderer paints on its OWN animation frame, which nothing synchronises with the
      // chips appearing. Reading the canvas straight after them is a race, and it was being won
      // only by luck: the whole suite runs at --test-concurrency=6, and once the cube screen's
      // mount started warming the solver pool (six workers each building pruning tables then;
      // one shared build since 2026-09-05, but a build all the same) the frame
      // began landing after the measurement. A blank read then failed for a reason that says
      // nothing about the composition. So wait for the paint instead of racing it — a canvas
      // that genuinely never paints still fails, one timeout later.
      await page.waitForFunction(() => {
        const c = document.querySelector('#viewCube canvas');
        if (!c?.width || !c?.height) return false;
        const copy = document.createElement('canvas');
        copy.width = c.width; copy.height = c.height;
        copy.getContext('2d').drawImage(c, 0, 0);
        const x = Math.floor(c.width * 0.4), y = Math.floor(c.height * 0.4);
        const px = copy.getContext('2d')
          .getImageData(x, y, Math.max(1, Math.ceil(c.width * 0.2)), Math.max(1, Math.ceil(c.height * 0.2))).data;
        for (let i = 3; i < px.length; i += 4) if (px[i] > 8) return true;
        return false;
      }, null);
      const m = await measureCube(page);
      const portrait = m.content.h > m.content.w;
      assert.ok(m.walking, 'the scramble screen walks a scramble');
      assert.ok(m.chips.length > 0, 'no chips on the sheet');

      // The composition box: the whole stage's content box, on BOTH axes (amended 2026-09-06).
      // It used to be the reference box on the short axis — `near(m.cols.width, m.ref.w)` in
      // portrait was this suite's assertion that the app letterboxes, and it was true of two
      // fixtures. The short-axis room goes to the flexible regions now, as the long axis always
      // did: in portrait the two columns share the extra width, in landscape the right-hand
      // column's rows share the extra height.
      near(m.cols.width, m.content.w, 'cols width is the stage content width');
      near(m.cols.height, m.content.h, 'cols height is the stage content height');

      // …and the primary is still cut from the REFERENCE box, not from the box that grew. The two
      // are one pair — the box takes the short-axis room and the primary's share of the long axis
      // does not move — and the second is what stops the first being a licence to resize the cube.
      // Precisely what it pins is the dimension --primary-share owns: the height in portrait, the
      // width in landscape. The other dimension belongs to the box, so in portrait the cube's SLOT
      // does widen, and a cube already fitted to the slot's height is unchanged by that (iPad 11"
      // portrait, measured 2026-09-06: painted 430×413 before the amendment, 431×413 after) while
      // one fitted to its width grows into the room it was short of (the desktop portrait window:
      // 244×235 to 256×246 painted px, +4.9%). That is the columns taking the stretch, which is
      // what the amendment asks for; the assertion below is what keeps the PRIMARY out of it.
      // The room the reference gave up is stated for the record; it is 0 on six of the eight.
      const shortAxisRoom = portrait ? m.content.w - m.ref.w : m.content.h - m.ref.h;
      assert.ok(shortAxisRoom >= -1, `the reference box exceeds the stage on its short axis by ${-shortAxisRoom}px`);
      // primary: --primary-share of the reference box's long side, less half a gap.
      if (portrait) near(m.primary.height, m.ref.h * m.share - m.rowsGap / 2, 'portrait: primary height');
      else near(m.primary.width, m.ref.w * m.share - m.colsGap / 2, 'landscape: primary width');

      // aux directly under primary; twin and sheet where each composition puts them.
      assert.ok(m.aux.top >= m.primary.bottom - 1, 'aux is under the primary');
      near(m.aux.left, m.primary.left, 'aux shares the primary\'s left edge');
      if (portrait && fixture.touch) {
        // A finger's portrait: the aside is a scrolling column under the aux, the moves first
        // and the net after them at its natural height.
        assert.ok(m.asideBox, 'touch portrait: the aside is a box');
        assert.ok(m.aside.top >= m.aux.bottom - 1, 'portrait: sheet is under the aux');
        near(m.aside.width, m.cols.width, 'portrait: sheet spans the box');
        assert.ok(m.solution.top < m.state.top, 'portrait: the solution comes before the net');
        assert.ok(m.solution.height > 140 + 1 || m.chips.length <= 6, 'portrait: the solution card grew to its chips instead of scrolling inside');
      } else if (portrait) {
        // A mouse's portrait: the twin beside the cube, level with it and no taller; the sheet
        // under both, the full width of the box.
        assert.ok(!m.asideBox, 'portrait: the aside hands its children to the grid');
        assert.ok(m.state.left >= m.primary.right + m.colsGap - 1, 'portrait: the twin is beside the cube');
        near(m.state.top, m.primary.top, 'portrait: the twin is level with the cube');
        // Where the stretch lands in this composition: the top row is the primary and the twin,
        // and the twin is the one that reaches the box's right edge. A box that widened while its
        // columns did not would leave paper inside itself, which is the same defect one level in.
        near(m.state.right, m.cols.right, 'portrait: the twin reaches the box\'s right edge');
        assert.ok(m.state.bottom <= m.primary.bottom + 1, 'portrait: the twin is no taller than the cube');
        assert.ok(m.sheet.top >= m.aux.bottom - 1, 'portrait: the sheet is under the aux');
        near(m.sheet.width, m.cols.width, 'portrait: the sheet spans the box');
      } else {
        // Landscape: the twin tops the column beside the primary, the sheet fills the rest of it.
        assert.ok(!m.asideBox, 'landscape: the aside hands its children to the grid');
        assert.ok(m.state.left >= m.primary.right + m.colsGap - 1, 'landscape: the twin is beside the primary');
        near(m.state.top, m.cols.top, 'landscape: the twin tops the column');
        assert.ok(m.sheet.top >= m.state.bottom - 1, 'landscape: the sheet is under the twin');
        near(m.sheet.right, m.cols.right, 'landscape: sheet reaches the box\'s right edge');
        near(m.sheet.bottom, m.cols.bottom, 'landscape: sheet reaches the box\'s bottom edge');
      }
      // The net is whole, inside its card, and as wide as the card lets it be (320px, or the
      // card's content width) — a flex item with auto margins once shrank it to 49px.
      assert.ok(inside(m.net, m.state), `the net ${JSON.stringify(m.net)} leaves its card ${JSON.stringify(m.state)}`);
      near(m.net.width, Math.min(320, m.state.width - 36), 'the net fills its card', 2);
      // With a mouse the whole screen is on screen: every move, the net, the transport — no
      // scroll anywhere, at the reference minimums and above. (A phone's sheet may scroll: its
      // twin sits under the moves, and its extra height is the sheet's.)
      if (!fixture.touch) {
        assert.ok(m.list.scroll <= m.list.client + 1, `the move list scrolls by ${m.list.scroll - m.list.client}px — every move must be on screen`);
        assert.ok(m.overflow.colsV <= 1, `the composition overflows its box vertically by ${m.overflow.colsV}px`);
      }

      // One transport line at and above the contract's portrait floor (375 wide), mouse or finger;
      // a narrower column may wrap the bar. Never a row wider than its card.
      assert.ok(m.transport.scroll <= m.transport.client + 1, 'the transport overflows its card');
      // Transport controls are finger-sized on EVERY pointer (stage-contract.md, decided
      // 2026-08-28) — the one exception to "current sizes on a mouse". Hidden controls (the
      // done mark before the last move, Scramble's solve button before the end) report 0×0 and
      // are exactly the zero-height failure this test refuses to filter out — so assert on the
      // visible ones and separately that the walking screen has controls at all.
      const tapable = m.transport.buttons.filter((b) => b.width > 0);
      assert.ok(tapable.length >= 4, `the transport has ${tapable.length} visible controls — the four walk buttons must be there`);
      for (const b of tapable) assert.ok(b.width >= 44 - 0.5 && b.height >= 44 - 0.5, `transport control ${b.id} is ${b.width}×${b.height} — under 44px on a ${fixture.touch ? 'finger' : 'mouse'}`);
      // Centres, not tops: a 44px button and a 20px label share a centre line, not a top edge.
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
      // And what it drew stays inside it: the framing (lib/cube-frame.js) fits the cube and its
      // ghost faces to the slot, so nothing painted reaches the canvas edge — at this slot shape,
      // as at every other. A blank canvas cannot pass: something must be painted in the middle.
      assert.ok(m.painted && !m.painted.error, `the canvas could not be read back: ${m.painted?.error}`);
      assert.ok(m.painted.middle > 0, 'the canvas is blank — the renderer painted nothing');
      assert.equal(m.painted.edge, 0, `${m.painted.edge} painted pixels on the canvas edge (${m.painted.w}×${m.painted.h}) — the picture is clipped`);
    } finally {
      await context.close();
    }
  });
}

// ---- the scan screen's composition --------------------------------------------------------------
//
// The six-face net in the primary region, the twin and the notice beside it — in BOTH
// compositions and on every platform (decided 2026-08-30; a finger's portrait used to get one
// face large over a strip of five instead). The camera is absent in headless WebKit; the screen
// shows its notice and lays out all the same.

const measureScan = (page) =>
  page.evaluate(`(() => {
    const rect = ${rect.toString()};
    const px = (v) => Number.parseFloat(v);
    const $ = (s) => document.querySelector(s);
    const faces = $('.scan-faces');
    const board = $('.scanboard');
    const sb = rect($('#stage'));
    const scs = getComputedStyle($('#stage'));
    return {
      // The stage's CONTENT box as four edges — what the composition box must span.
      content: {
        left: sb.left + px(scs.paddingLeft), right: sb.right - px(scs.paddingRight),
        top: sb.top + px(scs.paddingTop), bottom: sb.bottom - px(scs.paddingBottom),
      },
      focusFlag: getComputedStyle(faces).getPropertyValue('--focus').trim(),
      tiles: [...document.querySelectorAll('.scan-face')].map((t) => ({
        face: t.dataset.face, focus: t.classList.contains('focus'),
        tile: rect(t.querySelector('.tile')), sticker: rect(t.querySelector('.tgrid > .cell')),
        cellPointer: getComputedStyle(t.querySelector('.tgrid > .cell')).pointerEvents,
      })),
      primary: rect($('.cols > .col')), sheet: rect($('.cols .sheet')), twin: rect($('.cols .twin')), tools: rect($('.scan-cam')),
      cols: rect($('.cols')), stage: { w: $('#stage').clientWidth, h: $('#stage').clientHeight },
      solve: rect($('#scanSolveBtn')),
      overflow: { board: board.scrollHeight - board.clientHeight, doc: document.documentElement.scrollWidth - innerWidth },
    };
  })()`);

const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

const inside = (r, box, tol = 1) => r.left >= box.left - tol && r.right <= box.right + tol && r.top >= box.top - tol && r.bottom <= box.bottom + tol;

for (const fixture of FIXTURES) {
  test(`scan screen composition: ${label(fixture)}`, async () => {
    const { page, context } = await open(fixture, 'scan');
    try {
      await page.waitForSelector('.scan-face');
      const m = await measureScan(page);
      const portrait = m.stage.h > m.stage.w;
      assert.equal(m.tiles.length, 6);
      // The same box rule on the third composition variant (`.cols.twin-low`, primary share 0.66):
      // it spans the stage's content box on both axes (amended 2026-09-06). This screen shares the
      // `.cols` size rules, so it letterboxed on exactly the fixtures the cube screen did — the
      // scan net was 735.75 wide in a 760.96px iPad 11" portrait stage before that date.
      near(m.cols.left, m.content.left, 'the scan composition starts at the stage content box\'s left edge');
      near(m.cols.right, m.content.right, 'the scan composition reaches the stage content box\'s right edge');
      near(m.cols.top, m.content.top, 'the scan composition starts at the stage content box\'s top edge');
      near(m.cols.bottom, m.content.bottom, 'the scan composition reaches the stage content box\'s bottom edge');
      // With a mouse the whole screen is on screen: the tiles, the twin, the notice and the
      // button, at the reference minimums and above. (A phone's sheet may scroll.)
      if (!fixture.touch) {
        assert.ok(m.solve.bottom <= m.cols.bottom + 1, `"Solve this cube" ends ${m.solve.bottom - m.cols.bottom}px past the box — the sheet must not scroll`);
        assert.ok(inside(m.twin, m.cols), `the twin ${JSON.stringify(m.twin)} leaves the box ${JSON.stringify(m.cols)}`);
      }
      for (const t of m.tiles) assert.ok(inside(t.tile, m.primary), `${t.face} tile ${JSON.stringify(t.tile)} leaves the primary region ${JSON.stringify(m.primary)}`);
      assert.ok(m.overflow.board <= 1, `the scan board overflows by ${m.overflow.board}px`);
      assert.ok(m.overflow.doc <= 0, `the page overflows the viewport by ${m.overflow.doc}px`);
      // The screen's one action keeps its size whatever the sheet holds. A sheet that overflows
      // scrolls; it must not squash the button at its foot — which is exactly what a flex column
      // does to a flex item before it scrolls, and it took "Solve this cube" to 0px in every
      // portrait fixture. Its full height, not "visible": a scrolled sheet may hold it below the
      // fold, and that is fine; a 0px button is not a button.
      assert.ok(m.solve.height >= (fixture.touch ? 44 : 40) - 0.5, `"Solve this cube" is ${m.solve.height}px tall`);
      assert.ok(m.solve.width >= m.sheet.width - 1, `"Solve this cube" is ${m.solve.width}px wide in a ${m.sheet.width}px sheet`);

      // A LONG NOTICE never moves the button. The assertions above measured the sheet with the
      // short default text; a refusal's explanation is seven lines and its card carries a button,
      // and with those the sheet used to overflow the stage — which clips — so "Solve this cube"
      // showed as a grey sliver at the window's foot with no scrollbar to say why (a user's
      // screenshot, 2026-09-06). The card is what gives: it scrolls inside itself, and the button
      // stays whole and inside the box. Fed through the same event the scanner emits, so the
      // host's own painter lays it out.
      await page.evaluate(() => {
        document.querySelector('ai-scan-panel').dispatchEvent(new CustomEvent('scan-progress', {
          detail: {
            phase: 'scanning', message: 'Show one side to the camera to re-read just that side.',
            captured: [], live: null, confirm: null, device: null, complete: false,
            notice: {
              title: 'Some stickers were misread', tone: 'err',
              body: 'At least %1 stickers do not fit a real cube, and with that many the camera cannot tell which. Start the scan over, with more light on the cube and each side held flat to the camera — red and orange are the colours it confuses most. Show one side to the camera to re-read just that side. And a sentence more than any real notice carries, so the card is asked for more than it can ever need.',
              params: [3], action: { label: 'Start over', kind: 'restart' },
            },
          },
        }));
      });
      const long = await measureScan(page);
      const card = await page.evaluate(() => {
        const c = document.querySelector('.scan-sheet > .card');
        const b = c.getBoundingClientRect();
        const a = document.querySelector('#scanAction').getBoundingClientRect();
        const title = document.querySelector('#scanHowTitle').getBoundingClientRect();
        return { top: b.top, bottom: b.bottom, action: { top: a.top, bottom: a.bottom, height: a.height }, titleHeight: title.height };
      });
      assert.ok(long.solve.height >= (fixture.touch ? 44 : 40) - 0.5, `with a long notice "Solve this cube" is ${long.solve.height}px tall`);
      if (!fixture.touch) {
        assert.ok(long.solve.bottom <= long.cols.bottom + 1, `with a long notice "Solve this cube" ends ${long.solve.bottom - long.cols.bottom}px past the box`);
        assert.ok(long.solve.top >= card.bottom - 1, `with a long notice the button (top ${long.solve.top}) overlaps the card (bottom ${card.bottom})`);
        assert.ok(card.bottom <= long.cols.bottom + 1, `with a long notice the card ends ${card.bottom - long.cols.bottom}px past the box — it must scroll, not grow`);
        // The notice's own button and its title are the parts the eye needs; only the body may
        // scroll. The first fix scrolled the whole card and hid the button below the fold.
        assert.ok(card.action.height >= 30, `with a long notice the notice's button is ${card.action.height}px tall`);
        assert.ok(card.action.bottom <= card.bottom + 1 && card.action.top >= card.top - 1, `the notice's button (${card.action.top}–${card.action.bottom}) is outside its card (${card.top}–${card.bottom})`);
        assert.ok(card.titleHeight >= 16, `with a long notice the title collapsed to ${card.titleHeight}px`);
      }

      // One arrangement, everywhere: the cube's net (decided 2026-08-30). There is no second
      // layout to branch on any more — a finger's portrait used to get one face large over a
      // strip of five, and the focus flag that switched between them is gone with it.
      assert.notEqual(m.focusFlag, '1', 'the focus layout is gone; nothing may turn it back on');
      assert.deepEqual(m.tiles.filter((t) => t.focus).map((t) => t.face), [],
        'no tile may still be marked .focus — the class styles nothing now');

      // The sticker floor, named per fixture class rather than asserted as one number, because
      // this screen is the one place the app deliberately goes under 44px. Measured on this
      // tree, 2026-08-30: a mouse gets 28.3 landscape and 29.1 portrait; a touch iPad 11" gets
      // 34.7 landscape and 36.2 portrait; a NARROW touch client gets 16.9 on an iPhone 16, 15.5
      // on an SE and 11.2 in a 320px split-view column. The last three are under the 44px floor
      // every other control holds, knowingly: the owner's call on 2026-08-30 was that one net
      // everywhere is worth more than a tappable sticker on a phone. The numbers are named here
      // so that shrinking them FURTHER still fails, which is the part that stays a test.
      const narrow = fixture.touch && fixture.width < 500;
      const floor = narrow ? 11 : fixture.touch ? 34 : 24;
      for (const t of m.tiles) assert.ok(t.sticker.width >= floor, `${t.face} sticker ${t.sticker.width}px < ${floor}`);
      // Every side is drawn at the same size — the net is six equal faces, not a hierarchy.
      const widths = m.tiles.map((t) => Math.round(t.tile.width) + 0);
      assert.equal(new Set(widths).size, 1, `the six faces are not the same size: ${widths.join(', ')}`);
      // The card's tools park top-right; no tile may run under them.
      for (const t of m.tiles) assert.ok(!overlaps(m.tools, t.tile), `the tools overlap the ${t.face} tile`);
    } finally {
      await context.close();
    }
  });
}

// ---- every other routable screen ---------------------------------------------------------------
//
// Timer, Stats, Trainer, Drill, Lessons, Settings: no region contract of their own beyond the
// grid every screen shares, but the same floor — nothing wider than the stage, nothing clipped
// sideways, every control a finger can hit. Stats is seeded with a session: an empty one is a
// single card and would test nothing.

const SCREENS = ['timer', 'stats', 'trainer', 'drill', 'lessons', 'settings'];
const SESSION = JSON.stringify({
  list: Array.from({ length: 14 }, (_, i) => ({ n: 14 - i, time: (12 + ((i * 7) % 9) + i / 10).toFixed(2), scramble: "R U R' U' F2 D L2 B R2 U", at: 1_700_000_000_000 + i * 3_600_000 })),
});

const measureScreen = (page) =>
  page.evaluate(`(() => {
    const rect = ${rect.toString()};
    const stage = document.getElementById('stage');
    const screen = document.querySelector('.screen.active');
    const root = screen.firstElementChild;
    const cs = getComputedStyle(stage);
    const px = (v) => Number.parseFloat(v);
    const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const s = rect(stage);
    const col = document.querySelector('.cols > .col'), aside = document.querySelector('.cols > .aside');
    return {
      stage: s, root: rect(root), content: s.width - px(cs.paddingLeft) - px(cs.paddingRight),
      stagePad: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(px),
      // A list screen's root IS the composition box (\`.cols.flow\`), which shares the .cols size
      // rules; asked rather than assumed, so a screen that stops using one is skipped, not wrong.
      rootIsCols: root.classList.contains('cols'),
      // The two regions of a .cols screen, to assert they never draw over each other.
      col: col && rect(col), aside: aside && rect(aside),
      // A list screen's column (\`.cols.flow\`) takes its content's height — the room under its
      // last card is the slack a stretched grid row would leave, and it was 170px on Lessons.
      flow: Boolean(document.querySelector('.cols.flow')),
      colSlack: col && col.lastElementChild ? rect(col).bottom - rect(col.lastElementChild).bottom : 0,
      overflow: { screen: screen.scrollWidth - screen.clientWidth, doc: document.documentElement.scrollWidth - innerWidth },
      // Anything drawn beyond the stage sideways — including inside a scrolling column, where it
      // would be clipped rather than seen.
      beyond: [...screen.querySelectorAll('*')].filter(visible).map((el) => ({ what: el.id || el.className || el.tagName, ...rect(el) })).filter((r) => r.left < s.left - 1 || r.right > s.right + 1).slice(0, 4),
      controls: [...screen.querySelectorAll('button:not(.toggle), .chip-m, .pill, input')].filter(visible).map((el) => ({ what: el.id || el.className, ...rect(el) })),
      // A control that is on the page and not hidden, yet has no box: a flex column squashed it.
      // \`visible\` above filters these OUT, which is how a 0px button passed every fixture as
      // "not there" — the exact shape of failure that must count, not vanish.
      collapsed: [...screen.querySelectorAll('button, .chip-m, .pill, input')]
        .filter((el) => !el.closest('[hidden]') && getComputedStyle(el).display !== 'none')
        .filter((el) => { const r = el.getBoundingClientRect(); return r.width < 1 || r.height < 1; })
        .map((el) => el.id || el.className || el.tagName),
      // The toggle keeps its drawn 40×22 and grows a 44px hit area as a ::before, which no rect
      // reports — so probe it: a point 9px above and below the box must still hit the toggle.
      toggles: [...screen.querySelectorAll('.toggle')].filter(visible).map((t) => {
        t.scrollIntoView({ block: 'center' }); // elementFromPoint sees the viewport only
        const r = t.getBoundingClientRect();
        const cx = (r.left + r.right) / 2;
        const hits = (y) => { const el = document.elementFromPoint(cx, y); return el === t || t.contains(el); };
        return { above: hits(r.top - 9), below: hits(r.bottom + 9) };
      }),
    };
  })()`);

for (const screen of SCREENS) {
  for (const fixture of FIXTURES) {
    test(`${screen} screen: ${label(fixture)}`, async () => {
      const context = await freshContext({ viewport: { width: fixture.width, height: fixture.height }, hasTouch: fixture.touch === true });
      await context.addInitScript((session) => localStorage.setItem('cubusSolves', session), SESSION);
      const page = await context.newPage();
      pace(page);
      const errors = [];
      page.on('pageerror', (e) => errors.push(e));
      try {
        await page.goto(`${BASE}/?insets=${fixture.insets.join(',')}#/${screen}`);
        await page.waitForSelector('.screen.active');
        const m = await measureScreen(page);
        assert.deepEqual(errors.map(String), [], 'the page threw');
        assert.ok(m.overflow.doc <= 0, `the page overflows the viewport by ${m.overflow.doc}px`);
        assert.ok(m.overflow.screen <= 1, `the screen overflows sideways by ${m.overflow.screen}px`);
        assert.deepEqual(m.beyond, [], 'drawn beyond the stage');
        assert.deepEqual(m.collapsed, [], 'a control on the page has no box — squashed by its column');
        assert.ok(m.root.width >= m.content * 0.9, `the screen's root is ${m.root.width}px wide in a ${m.content}px stage — it shrank to its content`);
        // The fourth composition variant: a list screen's `.cols.flow` spans the stage's content
        // box on both axes too (amended 2026-09-06). Before that date the portrait box was clamped
        // to --ref-w, so Stats, Drill, Lessons and Settings letterboxed on an iPad in portrait
        // exactly as the cube screen did — and the 0.9 floor above passed that at 0.967, which is
        // why a loose floor is not a substitute for the claim.
        // Timer and Trainer do not draw a `.cols` at all — their root is a plain div that already
        // spanned the stage — so the guard is a class question rather than a list of screens. It
        // was checked in a browser and not assumed: those two were the only ones with no box.
        if (m.rootIsCols) {
          const [pt, pr, pb, pl] = m.stagePad;
          near(m.root.left, m.stage.left + pl, `${screen}: the box starts at the stage content box's left edge`);
          near(m.root.right, m.stage.right - pr, `${screen}: the box reaches the stage content box's right edge`);
          near(m.root.top, m.stage.top + pt, `${screen}: the box starts at the stage content box's top edge`);
          near(m.root.bottom, m.stage.bottom - pb, `${screen}: the box reaches the stage content box's bottom edge`);
        }
        if (m.col && m.aside) {
          // Beside or below, never over: a collapsed grid row once drew the sheet across the column.
          assert.ok(!overlaps(m.col, m.aside), `the sheet ${JSON.stringify(m.aside)} draws over the column ${JSON.stringify(m.col)}`);
          assert.ok(m.col.height > 40 && m.aside.height > 40, `a region collapsed: column ${m.col.height}px, sheet ${m.aside.height}px`);
          // Portrait (the sheet below the column) on a list screen: the column ends where its
          // content ends, so the sheet starts right after it rather than after a blank band.
          if (m.flow && m.aside.top >= m.col.bottom - 1) assert.ok(m.colSlack <= 1, `the column is ${m.colSlack}px taller than its content`);
        }
        if (fixture.touch) {
          const small = m.controls.filter((c) => c.width < 44 - 0.5 || c.height < 44 - 0.5);
          assert.deepEqual(small, [], 'touch: controls under 44px');
          for (const t of m.toggles) assert.ok(t.above && t.below, `touch: a toggle's hit area does not reach 44px (${JSON.stringify(t)})`);
        }
      } finally {
        await context.close();
      }
    });
  }
}

test('a popover opened on the stage stays inside it', async () => {
  // Scramble, not Home: a fresh Home holds a solved cube, which is a cube to look at and has no
  // speed menu to open. Scramble always walks.
  const { page, context } = await open(FIXTURES[0], 'scramble');
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
