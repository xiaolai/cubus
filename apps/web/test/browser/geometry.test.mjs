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
import { readFileSync, readdirSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright';

import { pace } from '../browser-wait.mjs';

import { NAV } from '../../lib/app-state.js';
import { NAV_DEFAULTS_VERSION } from '../../lib/app-settings.js';
import { LEVELS, METHODS } from '../../lib/methods/registry.js';
import { fitStage } from '../../lib/stage.js';
import { freePort } from '../free-port.mjs';
import { CONTRACT_CUBES } from '../fixtures/solver-cubes.mjs';
import { RESERVED_SLOTS } from './reserved-slots.mjs';
import { stripLabelsUnread } from './strip-labels.mjs';

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
async function relaunchBrowser() {
  await browser.close();
  browser = await webkit.launch();
  servedContexts = 0;
}
async function freshContext(options) {
  if (servedContexts >= CONTEXTS_PER_BROWSER) await relaunchBrowser();
  servedContexts += 1;
  return browser.newContext(options);
}

/**
 * Navigations that wedged and were recovered in a fresh browser, printed as they happen.
 *
 * THE COUNT BOUND ABOVE IS NOT THE WHOLE STORY ON LINUX. On CI's Linux WebKit the same symptom —
 * a `page.goto` whose `load` never arrives, burning the full navigation bound — came back twice in
 * two days (runs 35486935512 and 35557685603, 2026-09-20/21), and the second was only the 6th
 * context in its browser, far below both this file's bound of 24 and the ~63 measured on macOS. One
 * navigation in ~97 hung. That is not a ceiling a smaller count would clear; it is a rare wedge in a
 * browser process that was otherwise healthy.
 *
 * So a navigation that times out is tried ONCE more, in a fresh browser process. That recovers a
 * wedged browser and nothing else: a page that genuinely never loads — a hung subresource, an app
 * that stalls its own boot — hangs again in the fresh process and fails exactly as before. Only a
 * TimeoutError from the navigation itself is retried; an assertion, a page error or a second
 * timeout is never retried. And never silently: each recovery is printed with the case it
 * rescued, so a wedge that stops being rare shows up as lines in the log, not as a green run.
 */
const recovered = [];

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

/**
 * THE PORTRAIT CUBE'S FLOOR, ONE TABLE, keyed by WALK KIND and fixture (dev-docs/practice-redesign-plan.md E12.2): no
 * walk's cube is smaller than it was before the redesign. Each kind's figure is its painted cube at 2ae4a375 (headless
 * WebKit, one move into the walk; pll-Na for Practice), or the floor WI-4 or WI-5 already set for it where that is
 * lower. In CSS px, the larger side of what the renderer painted. A fixture or a kind with no floor fails the lookup
 * rather than passing unmeasured.
 *
 * Measured at 2ae4a375 (desktop portrait, iPhone 16, iPhone SE, iPad 11" portrait, Split View): Quick 256 / 197 / 186
 * / 431 / 154; Scramble 256 / 201 / 186 / 495 / 154; a Beginner lesson 202 / 175 / 166 / 391 / 151; a Practice rep
 * with no cube 211 / 184 / 174 / 400 / 144, with a smart cube 256 / 197 / 186 / 431 / 154.
 */
const CUBE_FLOOR = Object.freeze({
  quick: {
    'desktop portrait window': 256,
    'iPhone 16': 197,
    // E10 (owner's call, 2026-10-18): 170, not the 186 it was. The SE is the one fixture where the fixed height of the
    // 44px touch rows that never leave the walk — the solution heading, the Restore row and the one-line strip — is
    // more than the room today's cube had beside them: with the method row folded into the Restore row the cube
    // measured 174. The trade is the whole walk on screen under the cube against about 12px of cube.
    'iPhone SE': 170,
    'iPad 11" portrait': 431,
    'iPad Split View column': 154,
  },
  // WI-4's floor, the lower of the two everywhere (Scramble was 201 and 495 on the iPhone 16 and the iPad).
  scramble: { 'desktop portrait window': 256, 'iPhone 16': 197, 'iPhone SE': 170 /* E10, as Quick */, 'iPad 11" portrait': 431, 'iPad Split View column': 154 },
  lesson: {
    'desktop portrait window': 202,
    'iPhone 16': 175,
    // E12.5 (coordinator, 2026-10-19): 150, not 166. The portrait composition puts the whole walk under the cube, and
    // on the SE that has a fixed cost the pre-redesign layout did not pay — measured 137 with the lesson's label row,
    // which E12.5 then moved into the heading.
    'iPhone SE': 150,
    'iPad 11" portrait': 391,
    'iPad Split View column': 151,
  },
  // WI-5's floors (E11.5), each lower than the page's figure at 2ae4a375.
  'practice-cube': { 'desktop portrait window': 202, 'iPhone 16': 175, 'iPhone SE': 166, 'iPad 11" portrait': 383, 'iPad Split View column': 138 },
  'practice-none': {
    'desktop portrait window': 202,
    'iPhone 16': 175,
    // E11.9 (2026-10-19): with no cube, 150, not 166. The SE with no cube has to fit the strip, the beads, the quiet line
    // and a transport carrying step buttons, and that fixed cost is about 16 px more than today's cube had beside it.
    'iPhone SE': 150,
    'iPad 11" portrait': 383,
    'iPad Split View column': 138,
  },
});
const cubeFloor = (kind, fixture) => {
  const f = CUBE_FLOOR[kind]?.[fixture.name];
  if (typeof f !== 'number') throw new Error(`no portrait cube floor for a ${kind} walk on "${fixture.name}"`);
  return f;
};

/** The larger side of what the cube's canvas painted, in CSS px — opaque pixels' bounding box. Self-contained:
 *  it is evaluated in the page. */
const paintedSize = (sel = '#viewCube canvas') => {
  const c = document.querySelector(sel);
  if (!c?.width) return 0;
  const w = c.width, h = c.height;
  const copy = document.createElement('canvas'); copy.width = w; copy.height = h;
  const ctx = copy.getContext('2d'); ctx.drawImage(c, 0, 0);
  const d = ctx.getImageData(0, 0, w, h).data;
  let x0 = w, x1 = -1, y0 = h, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (d[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return x1 < 0 ? 0 : Math.max(x1 - x0 + 1, y1 - y0 + 1) / (w / c.getBoundingClientRect().width);
};

/** Wait until the cube's canvas has painted something in its middle: the renderer draws on its own frame. */
const cubePainted = (page, sel = '#viewCube canvas') => page.waitForFunction((s) => {
  const c = document.querySelector(s);
  if (!c?.width || !c?.height) return false;
  const copy = document.createElement('canvas');
  copy.width = c.width; copy.height = c.height;
  copy.getContext('2d').drawImage(c, 0, 0);
  const x = Math.floor(c.width * 0.4), y = Math.floor(c.height * 0.4);
  const px = copy.getContext('2d')
    .getImageData(x, y, Math.max(1, Math.ceil(c.width * 0.2)), Math.max(1, Math.ceil(c.height * 0.2))).data;
  for (let i = 3; i < px.length; i += 4) if (px[i] > 8) return true;
  return false;
}, sel);

const near = (a, b, what, tol = 1) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (±${tol})`);
const label = (f) => `${f.name} (${f.width}×${f.height}, insets ${f.insets.join('/')}${f.touch ? ', touch' : ''})`;

/**
 * A context and a page navigated to `url` — THE ONE place this file navigates, so the wedge
 * recovery (see `recovered`) covers every case. It had three copies until 2026-09-21, and the two
 * recorded wedges came through two of them: `open()` on 2026-09-20, the per-screen loop the next
 * day. `prepare(context)` runs before the page does — anything a case stores in localStorage goes
 * in there, because the app reads its storage at module scope.
 *
 * The navigation bound is the suite's (`pace`, BROWSER_NAV_MS): node --test saturates the machine
 * by design, and a WebKit navigation on a saturated machine is queued work, not a hung page — the
 * 30 s default read exactly that as failure (2026-08-29, two fixtures, both clean alone), and even
 * 120 s was exceeded under the full unbounded fan-out, which is why package.json bounds
 * --test-concurrency as well. A navigation that exhausts it is retried once in a fresh browser;
 * any other error, or a second timeout, fails the case. Returns before the app has mounted.
 */
async function openAt(fixture, url, prepare = async () => {}) {
  for (let attempt = 1; ; attempt += 1) {
    const context = await freshContext({ viewport: { width: fixture.width, height: fixture.height }, hasTouch: fixture.touch === true });
    await prepare(context);
    const page = await context.newPage();
    pace(page); // both bounds, navigation included — see BROWSER_NAV_MS
    const errors = [];
    page.on('pageerror', (e) => errors.push(e));
    try {
      await page.goto(url);
      return { page, context, errors };
    } catch (error) {
      await context.close().catch(() => {});
      if (attempt > 1 || error?.name !== 'TimeoutError') throw error;
      const what = `${label(fixture)} ${new URL(url).hash}`;
      recovered.push(what);
      console.error(`geometry: navigation to ${what} never reached load — retrying once in a fresh WebKit (recovery ${recovered.length})`);
      await relaunchBrowser();
    }
  }
}

const urlFor = (fixture, route) => `${BASE}/?insets=${fixture.insets.join(',')}#/${route}`;

async function open(fixture, route = 'home', settings = null) {
  // A stored setting a case needs — the developer die, to put a scrambled cube on Home.
  const opened = await openAt(fixture, urlFor(fixture, route), async (context) => {
    if (settings) await context.addInitScript((s) => localStorage.setItem('cubusSettings', JSON.stringify(s)), settings);
  });
  // 30 s, not 10: this is an AVAILABILITY wait (did the app mount), not an assertion —
  // under test-concurrency=6, six webkits and dev servers share one machine, and the mount
  // once lost a 10 s race (2026-08-30) while every geometry assertion behind it would have
  // passed. Generous waits here; the strictness belongs to the geometry checks themselves.
  await opened.page.waitForSelector('.screen.active');
  return opened;
}

/** A DOMRect as plain numbers. Inlined into page.evaluate source below, so keep it self-contained. */
const rect = (el) => {
  const b = el.getBoundingClientRect();
  return { top: b.top, right: b.right, bottom: b.bottom, left: b.left, width: b.width, height: b.height };
};

/**
 * Every piece of TEXT on the active screen that cannot be read where it is drawn, as readable names.
 * Inlined into page.evaluate source below, so keep it self-contained.
 *
 * Two ways for text to be lost that no box-edge assertion in this file could see, because in both the
 * box itself is exactly where it should be — it is what is INSIDE it that is wrong:
 *
 *   - `spills`: a box whose own text is bigger than it, drawn over whatever is next to it. A whole
 *     algorithm in a `.chip-m`, a single turn's 36px square, stood in a column one move per line over
 *     the notation sentence below it (owner's screenshot, 2026-10-14).
 *   - `cut`: text outside an ancestor that CLIPS and does not scroll, so no gesture reaches it. The
 *     Drill page lost the foot of its sheet to the stage on both desktop windows, and every Lessons
 *     card in the landscape window was crushed to its first rung by a column that shrank it rather
 *     than scrolling — found the same day by the first run of this measurement.
 *
 * TEXT-BEARING elements only, judged by their own text nodes: a cube canvas, an svg and a toggle's
 * 44px hit area are drawn past their boxes on purpose and carry no text. A clipping ancestor that
 * SCROLLS hands the question up to itself: content past a scroller's edge is reachable, so it is the
 * scroller that must then be reachable. `display: contents` boxes have no rect and are skipped.
 *
 * EACH AXIS ON ITS OWN, and the text's own box first (audit, 2026-10-17): a box that clips its OWN text
 * (`overflow: hidden` and a fixed height) loses it as surely as an ancestor does, and a scroller that
 * scrolls across but clips down reaches nothing that is cut off below.
 *
 * `textFits` is the box half; `contentFits` below is its source with the strip half added, and is what every
 * case inlines.
 */
const textFits = (root) => {
  const spills = [];
  const cut = [];
  const named = (el) => `${el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}.${String(el.className).trim().replace(/\s+/g, '.')}`} "${el.textContent.trim().slice(0, 40)}"`;
  for (const el of root.querySelectorAll('*')) {
    if (el.closest('svg, [hidden], [aria-hidden="true"]')) continue;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    // The visually-hidden pattern (`.sr-only`: a clip-path over a 1px box) is text for a screen reader
    // and drawn nowhere, so it is skipped BY ITS CLIP — never by its size, which a box that crushes its own
    // text to a pixel also has (audit, 2026-10-17).
    // Exactly that pattern — a half inset or an empty clip rect — and not any clip at all: `inset(0px)` over a
    // crushed box hides nothing from the check (audit, 2026-10-17).
    // `clip` applies only to an absolutely positioned box (CSS 2.1 §11.1.2), so an empty clip rect exempts only
    // such a box; on a static one it clips nothing and exempts nothing.
    const emptyClip = /^(absolute|fixed)$/.test(cs.position) && /^rect\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\)$/.test(cs.clip);
    if (/^inset\(50%\)$/.test(cs.clipPath) || emptyClip) continue;
    if (r.width === 0 && r.height === 0) continue;
    const scrolls = (v) => v === 'auto' || v === 'scroll';
    if (cs.display !== 'inline') {
      const across = el.scrollWidth - el.clientWidth;
      const down = el.scrollHeight - el.clientHeight;
      if (across > 1 && cs.overflowX === 'visible') spills.push(`${named(el)} by ${across}px across`);
      else if (across > 1 && !scrolls(cs.overflowX)) cut.push(`${named(el)} cut ${across}px across by its own box`);
      if (down > 1 && cs.overflowY === 'visible') spills.push(`${named(el)} by ${down}px down`);
      else if (down > 1 && !scrolls(cs.overflowY)) cut.push(`${named(el)} cut ${down}px down by its own box`);
    }
    // The text's extent on each axis, handed up to a scroller on THAT axis only.
    let x = { lo: r.left, hi: r.right };
    let y = { lo: r.top, hi: r.bottom };
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const acs = getComputedStyle(a);
      if (acs.display === 'contents' || (acs.overflowX === 'visible' && acs.overflowY === 'visible')) continue;
      const b = a.getBoundingClientRect();
      const outX = Math.max(b.left - x.lo, x.hi - b.right);
      const outY = Math.max(b.top - y.lo, y.hi - b.bottom);
      const lost = Math.max(acs.overflowX === 'visible' || scrolls(acs.overflowX) ? 0 : outX,
        acs.overflowY === 'visible' || scrolls(acs.overflowY) ? 0 : outY);
      if (lost > 1) { cut.push(`${named(el)} cut ${Math.round(lost)}px by ${a.id ? `#${a.id}` : a.className}`); break; }
      if (scrolls(acs.overflowX)) x = { lo: b.left, hi: b.right };
      if (scrolls(acs.overflowY)) y = { lo: b.top, hi: b.bottom };
    }
  }
  return { spills, cut };
};

/**
 * What every case inlines as "text that cannot be read where it is drawn": `textFits` above, and a THIRD way to lose
 * text, which a box-and-scroller measurement passes by construction — a label inside a one-line strip, scrolled under
 * the strip's edge fade (strip-labels.mjs). The strip scrolls, so the label is "reachable", and the fade draws it
 * half-way to nothing: "Sexy move" stood as "ve" on the Practice page in the WI-5 audit, with this file green. Its
 * findings are `cut`, beside the rest, so no case can measure text without measuring this.
 */
const contentFits = `((root) => {
  const fits = (${textFits.toString()})(root);
  for (const s of (${stripLabelsUnread.toString()})(root)) fits.cut.push(s + ', inside a one-line strip');
  return fits;
})`;

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
      fits: ${contentFits}(screen),
      paintedSize: (${paintedSize.toString()})(),
      stageContent: (() => { const b = stage.getBoundingClientRect(); return { top: b.top + px(scs.paddingTop), bottom: b.bottom - px(scs.paddingBottom) }; })(),
      // The cube card's tools a person can SEE in this composition (a hidden one has no box).
      tools: [...document.querySelectorAll('.cols > .primary .card-tools > button')].filter((b) => b.getBoundingClientRect().width > 0).map((b) => b.id),
      twinShown: getComputedStyle($('.state-card')).display !== 'none',
      // The move list as a strip: its lines (by chip CENTRES — the current turn is larger), whether it scrolls
      // sideways and says so, any gutter a scrollbar takes, and the current turn against the strip's centre.
      strip: (() => {
        const l = $('#solList');
        const ls = getComputedStyle(l);
        const lb = l.getBoundingClientRect();
        const all = [...l.querySelectorAll('.chip-m')];
        const cur = l.querySelector('.chip-m.cur');
        const mid = (b) => { const r = b.getBoundingClientRect(); return Math.round(r.top + r.height / 2); };
        return {
          lines: new Set(all.map(mid)).size, box: rect(l),
          scrollW: l.scrollWidth, clientW: l.clientWidth, moreRight: l.classList.contains('more-right'),
          gutter: l.offsetHeight - l.clientHeight - px(ls.borderTopWidth) - px(ls.borderBottomWidth), bar: ls.scrollbarWidth,
          curOff: cur ? (cur.getBoundingClientRect().left + cur.getBoundingClientRect().width / 2) - (lb.left + l.clientLeft + l.clientWidth / 2) : null,
          curW: cur ? cur.getBoundingClientRect().width : null,
          otherW: Math.max(...all.filter((c) => c !== cur).map((c) => c.getBoundingClientRect().width)),
        };
      })(),
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
      // Home's developer die lives in the twin, which portrait puts behind a tool (E5); it is a shortcut for a test,
      // so it is pressed where it is rather than by opening the twin around it.
      await page.waitForSelector('#randCube', { state: 'attached' });
      await page.evaluate(() => document.querySelector('#randCube').click());
      await page.waitForSelector('.chip-m');
      await page.waitForFunction(() => /^\d/.test(document.querySelector('#moveCount')?.textContent ?? ''), null, { timeout: 90_000 });
      await cubePainted(page);
      // THE WHOLE-CUBE WALK, the one the method row belongs to. E10: in portrait that row folds into ONE pill at the
      // head of the Restore row — the method naming its own stops — pinned while the stops scroll after it, naming
      // the method ON SCREEN, and never a choice of its own. Landscape keeps the row.
      const whole = await page.evaluate(`(() => {
        const rect = ${rect.toString()};
        const $ = (s) => document.querySelector(s);
        const pin = $('#methodPin');
        const strip = $('#stageTargetRow');
        const firstStop = [...strip.querySelectorAll('[data-stage]')].find((el) => !el.hidden);
        const on = $('#methodRow [data-method][aria-pressed="true"]');
        const pinned = pin && getComputedStyle(pin).display !== 'none';
        const before = pinned ? pin.getBoundingClientRect().left : 0;
        strip.scrollLeft = strip.scrollWidth;
        const after = pinned ? pin.getBoundingClientRect().left : 0;
        strip.scrollLeft = 0;
        strip.dispatchEvent(new Event('scroll'));
        return {
          portrait: $('.cols .sheet').getBoundingClientRect().top >= $('.cols > .primary').getBoundingClientRect().bottom - 1,
          methodRowShown: getComputedStyle($('#methodRow')).display !== 'none',
          shown: on ? on.textContent : null,
          pin: pinned ? { box: rect(pin), text: pin.textContent, hasMethod: pin.hasAttribute('data-method'), sticks: Math.abs(after - before) <= 1,
            firstStop: rect(firstStop), row: rect(strip) } : null,
          tools: [...document.querySelectorAll('.cols > .primary .card-tools > button')].filter((b) => b.getBoundingClientRect().width > 0).map((b) => b.id),
          paintedSize: (${paintedSize.toString()})(),
        };
      })()`);
      if (whole.portrait) {
        assert.equal(whole.methodRowShown, false, 'portrait: the method row is still its own row');
        assert.ok(whole.pin, 'portrait: no method pill at the head of the Restore row');
        assert.ok(whole.shown, 'precondition: the method row names the method on screen');
        assert.equal(whole.pin.text, whole.shown, 'portrait: the pin names a method other than the one on screen');
        assert.equal(whole.pin.hasMethod, false, 'portrait: the pin is a [data-method] — a press would be taken as a choice');
        assert.ok(whole.pin.box.right <= whole.pin.firstStop.left + 1, 'portrait: a stop is drawn before the method pill');
        near(whole.pin.box.top + whole.pin.box.height / 2, whole.pin.row.top + whole.pin.row.height / 2, 'portrait: the pin is not on the Restore row\'s line', 2);
        assert.ok(whole.pin.sticks, 'portrait: the pin scrolled away with the stops');
        assert.deepEqual(whole.tools, ['speedBtn', 'twinBtn'], 'portrait, Home: the cube card\'s tools are speed and the twin');
        // MUST NOT: a portrait cube smaller than its floor, with every row the walk always shows — the heading,
        // the Restore row with the pin and the one-line strip (E10; the rows that come and go are WI-6's).
        assert.ok(whole.paintedSize >= cubeFloor('quick', fixture), `portrait: the painted cube on Home is ${whole.paintedSize.toFixed(1)}px — under its floor of ${cubeFloor('quick', fixture)}px`);
      } else {
        assert.equal(whole.pin, null, 'landscape: the method pill is drawn — landscape keeps the method row');
        assert.ok(whole.methodRowShown, 'landscape: the method row is not shown on a whole-cube walk');
        assert.deepEqual(whole.tools, ['speedBtn'], 'landscape: the cube card shows a tool besides the speed menu');
      }
      // The longest stage name, so the heading and the line under the picture are at their longest.
      await page.click('[data-stage="corners-home"]');
      await page.waitForFunction(
        () => /way back|couldn’t|already/.test(document.querySelector('#moveCount')?.textContent ?? ''),
        null,
        { timeout: 90_000 },
      );
      await cubePainted(page);
      const m = await page.evaluate(`(() => {
        const rect = ${rect.toString()};
        const $ = (s) => document.querySelector(s);
        const card = $('.state-card');
        const pin = $('#methodPin');
        const cols = $('.cols');
        // Hit-tested at each control's centre WITHOUT scrolling the page or the stage. Scrolling a
        // clipped stage to reach one control moves every other box, and the measurement stops
        // meaning anything — an exploratory probe that scrolled reported controls covered by the
        // stage itself. The ONE scroll allowed is the target strip's own, sideways: that is how a
        // strip is used, it moves nothing but its buttons, and the boxes around it are compared
        // before and after to prove it.
        const strip = $('#stageTargetRow');
        // The chips the chosen method shows; the rest of the offered chips are drawn hidden (lib/method-stops.js).
        const stageButtons = [...strip.querySelectorAll('[data-stage]')].filter((el) => !el.hidden);
        const chosen = strip.querySelector('.on');
        const stripBox = strip.getBoundingClientRect();
        const chosenBox = chosen.getBoundingClientRect();
        const chosenInView = chosenBox.left >= stripBox.left - 1 && chosenBox.right <= stripBox.right + 1;
        const oneLine = new Set(stageButtons.map((el) => Math.round(el.getBoundingClientRect().top) + 0)).size === 1;
        const around = () => JSON.stringify([rect(card), rect($('.cols .sheet')), rect($('.cols > .primary'))]);
        const aroundBefore = around();
        const scrolledFrom = strip.scrollLeft;
        const covered = [...document.querySelectorAll('[data-stage], #prevBtn, #repeatBtn, #nextBtn, #playBtn, #stepLbl')]
          .filter((el) => el.getBoundingClientRect().width > 0)
          .map((el) => {
            if (strip.contains(el)) {
              const sb = strip.getBoundingClientRect();
              const eb = el.getBoundingClientRect();
              if (eb.left < sb.left) strip.scrollLeft -= sb.left - eb.left;
              else if (eb.right > sb.right) strip.scrollLeft += eb.right - sb.right;
            }
            const b = el.getBoundingClientRect();
            const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
            return hit && hit !== el && !el.contains(hit) ? (el.dataset.stage || el.id) + ' under ' + hit.className : null;
          })
          .filter(Boolean);
        const aroundAfter = around();
        strip.scrollLeft = scrolledFrom;
        const list = $('#solList');
        const chip = list.querySelector('.chip-m');
        return {
          chosenInView, oneLine, stripMovedOthers: aroundBefore !== aroundAfter,
          list: { client: list.clientHeight, scroll: list.scrollHeight, chip: chip ? chip.getBoundingClientRect().height : 0,
            padding: parseFloat(getComputedStyle(list).paddingTop) + parseFloat(getComputedStyle(list).paddingBottom) },
          netHidden: $('#viewNet').hidden, aimShown: !$('#stageAim').hidden, heading: $('.state-h').textContent,
          state: rect(card), stateScroll: card.scrollHeight, stateClient: card.clientHeight,
          aimNet: rect($('#stageAimNet')), primary: rect($('.cols > .primary')), sheet: rect($('.cols .sheet')),
          asideBox: getComputedStyle($('.cols > .aside')).display !== 'contents',
          colsV: cols.scrollHeight - cols.clientHeight, covered,
          solLabel: rect($('#solLabel')), moveCount: rect($('#moveCount')),
          countLine: parseFloat(getComputedStyle($('#moveCount')).lineHeight) || 0,
          pinShown: Boolean(pin) && getComputedStyle(pin).display !== 'none',
        };
      })()`);
      const portrait = m.sheet.top >= m.primary.bottom - 1;
      // A route is no method's walk (lib/walk-session.js, labelWalk): the row is taken away, and its pin with it.
      assert.equal(m.pinShown, false, 'a walk to a stage shows the method pill — no method walks it');
      if (portrait) {
        // The side card's own assertions below are about the card AS SHOWN: open it with its one control.
        await page.click('#twinBtn');
        Object.assign(m, await page.evaluate(`(() => {
          const rect = ${rect.toString()};
          const card = document.querySelector('.state-card');
          return { state: rect(card), stateScroll: card.scrollHeight, stateClient: card.clientHeight, aimNet: rect(document.querySelector('#stageAimNet')),
            stage: rect(document.getElementById('stage')) };
        })()`));
        assert.ok(inside(m.state, m.stage), `portrait: the opened twin ${JSON.stringify(m.state)} leaves the stage`);
      }
      assert.ok(m.aimShown, 'the target picture is shown');
      assert.ok(m.netHidden, 'and it takes the Initial State net\'s place — the card cannot hold both');
      assert.equal(m.heading, 'Aiming at the top corners home', 'the heading says what the picture is');
      assert.ok(m.stateScroll <= m.stateClient + 1,
        `the side card holds ${m.stateScroll}px of content in ${m.stateClient}px — the rest is drawn over its neighbours`);
      assert.ok(inside(m.aimNet, m.state), `the target picture ${JSON.stringify(m.aimNet)} leaves its card ${JSON.stringify(m.state)}`);
      // The grid composition, where the card has a row of its own and nothing clips it. In portrait it is opened
      // over the stage, held inside it above.
      if (!portrait) assert.ok(m.state.bottom <= m.sheet.top + 1, 'landscape: the card ends above the sheet');
      if (!fixture.touch) assert.ok(m.colsV <= 1, `the composition overflows its box vertically by ${m.colsV}px`);
      // Covered controls, where an overlap can only be a layout defect: the grid compositions, in
      // which nothing scrolls and every region has a box of its own. In a finger's portrait the aside
      // is a scrolling column laid out in flow, so the card cannot overlap a sibling; what sits over
      // a control there is the fixed tab bar over content scrolled below the fold, which is that
      // composition working (the iPhone SE's stage buttons, 2026-09-13). The card itself is held by
      // the two assertions above on every fixture.
      if (!m.asideBox) assert.deepEqual(m.covered, [], 'nothing is drawn over a stage button or the transport');
      // THE MOVES GET ROOM (2026-09-15). The target buttons used to wrap into three rows and take
      // the solution card's height: the move list — the task on this screen — was 15px of 192 on
      // the desktop landscape window and 35px of 108 on the portrait one, and nothing here noticed,
      // because nothing measured the list. One whole row of moves is the floor: below it the
      // screen is not showing what it is for. And the target row is one line on every fixture,
      // whatever the font, with the chosen target in view without anyone scrolling to it.
      assert.ok(m.oneLine, 'the stage targets are one line');
      assert.ok(m.chosenInView, 'the chosen target is in view without scrolling the strip');
      assert.equal(m.stripMovedOthers, false, 'scrolling the target strip moved a box outside it');
      assert.ok(m.list.chip > 0, 'precondition: the move list holds move chips');
      const oneRow = Math.min(m.list.scroll, m.list.chip + m.list.padding);
      assert.ok(m.list.client >= oneRow - 1, `the move list shows ${m.list.client}px — less than one row of moves (${oneRow}px)`);
      // THE SENTENCE BESIDE THE HEADING (2026-10-17). "couldn't find a short way back to …" is the
      // longest thing #moveCount says, and it was drawn glued to the heading ("Solutioncouldn't") and
      // wrapped into a column hanging off its right edge. Either it shares the heading's row — with a
      // gap, on ONE line — or it starts a row of its own at the heading's left edge. Never between.
      const beside = m.moveCount.top < m.solLabel.bottom - 1;
      if (beside) {
        assert.ok(m.moveCount.left - m.solLabel.right >= 8, `the count is ${m.moveCount.left - m.solLabel.right}px from the heading — glued to it`);
        assert.ok(m.countLine > 0 && m.moveCount.height <= m.countLine * 1.5, `the count wraps beside the heading (${m.moveCount.height}px tall, line ${m.countLine}px) — a hanging column`);
      } else {
        near(m.moveCount.left, m.solLabel.left, 'a count on its own row starts under the heading', 1);
      }
    } finally {
      await context.close();
    }
  });
}

// THE SHAPES GRID ON A PHONE (owner, 2026-10-17). Two 132px nets across a phone are 11px stickers, and
// twenty of them read as one block of small squares. Where the grid holds fewer than three cards it shows
// ONE picture a row, scaled to its card; where it holds three or more it is the grid it was. Both sides
// of the line are held on every fixture, and the line is a property of the GRID's width — so this reads
// the width the stylesheet keys on, not the fixture's name.
for (const fixture of FIXTURES) {
  test(`shapes grid: ${label(fixture)}`, async () => {
    const { page, context } = await open(fixture, 'shapes');
    try {
      await page.waitForSelector('#shapeGrid [data-shape] svg');
      const m = await page.evaluate(() => {
        const grid = document.querySelector('#shapeGrid');
        const cards = [...grid.querySelectorAll('[data-shape]')];
        const svgs = cards.map((c) => c.querySelector('svg').getBoundingClientRect());
        const card = cards[0].getBoundingClientRect();
        const cs = getComputedStyle(cards[0]);
        return {
          screen: document.querySelector('.shapes-screen').getBoundingClientRect().width,
          perRow: cards.filter((c) => Math.round(c.getBoundingClientRect().top) === Math.round(card.top)).length,
          svgWidths: [...new Set(svgs.map((r) => Math.round(r.width) + 0))],
          aspect: svgs[0].height / svgs[0].width,
          cardInner: card.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
          inside: svgs.every((r, i) => r.left >= cards[i].getBoundingClientRect().left - 0.5 && r.right <= cards[i].getBoundingClientRect().right + 0.5),
        };
      });
      assert.ok(m.inside, 'a picture is drawn past its own card');
      assert.equal(m.svgWidths.length, 1, `the pictures are drawn at different sizes: ${m.svgWidths}`);
      // The net is twelve stickers across and nine down; scaling must not stretch it.
      assert.ok(Math.abs(m.aspect - 0.75) < 0.02, `the net is drawn at ${m.aspect.toFixed(3)} tall per wide, not 3:4`);
      if (m.screen < 460) {
        assert.equal(m.perRow, 1, `${m.screen}px holds fewer than three cards, so one picture a row — not ${m.perRow}`);
        assert.ok(m.svgWidths[0] >= Math.min(m.cardInner, 360) - 1,
          `one picture a row, but drawn ${m.svgWidths[0]}px in a card ${Math.round(m.cardInner)}px wide`);
        assert.ok(m.svgWidths[0] / 12 >= 20, `a sticker is ${(m.svgWidths[0] / 12).toFixed(1)}px — still too small to read on a phone`);
      } else {
        assert.ok(m.perRow >= 3, `${m.screen}px is the grid, but it shows ${m.perRow} a row`);
        assert.equal(m.svgWidths[0], 132, 'in the grid a picture keeps its thumbnail size');
      }
    } finally {
      await context.close();
    }
  });
}

for (const fixture of FIXTURES) {
  test(`cube screen composition: ${label(fixture)}`, async (t) => {
    const { page, context } = await open(fixture, 'scramble');
    try {
      // The die a person can see: the twin's in landscape, the cube card's in portrait, where the twin is behind its
      // tool (dev-docs/practice-redesign-plan.md E10).
      await page.click('#randCube:visible, #randCubeTool:visible');
      await page.waitForSelector('.chip-m');
      // The renderer paints on its OWN animation frame, which nothing synchronises with the
      // chips appearing. Reading the canvas straight after them is a race, and it was being won
      // only by luck: the whole suite runs at --test-concurrency=6, and once the cube screen's
      // mount started warming the solver pool (six workers each building pruning tables then;
      // one shared build since 2026-09-05, but a build all the same) the frame
      // began landing after the measurement. A blank read then failed for a reason that says
      // nothing about the composition. So wait for the paint instead of racing it — a canvas
      // that genuinely never paints still fails, one timeout later.
      await cubePainted(page);
      // In portrait the strip centres the turn you are on, so there must BE one: one step along.
      if (fixture.height - fixture.insets[0] - fixture.insets[2] > fixture.width) {
        await page.click('#nextBtn');
        await page.waitForSelector('#solList .chip-m.cur');
      }
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
      // primary: --primary-share of the reference box's long side, less half a gap — in landscape. In portrait the
      // cube is the hero (dev-docs/practice-redesign-plan.md E1, §5.7): its card is the stage's full width.
      if (!portrait) near(m.primary.width, m.ref.w * m.share - m.colsGap / 2, 'landscape: primary width');

      if (portrait) {
        // THE PORTRAIT WALKING COMPOSITION (§5.7), for a mouse and a finger alike: the cube card at the top, the
        // stage's full width, square wherever the stage has the height; the moves ONE line directly under it; the
        // twin behind the cube card's tool (E5); the transport at the foot, on screen.
        assert.ok(!m.asideBox, 'portrait: the aside hands its children to the grid');
        near(m.primary.width, m.content.w, 'portrait: the cube card is the stage\'s full width');
        near(m.primary.top, m.cols.top, 'portrait: the cube card is at the top');
        // A stage too short for a square card gives the cube's row, never the strip's or the transport's — both
        // are asserted on screen below whatever the card's shape.
        if (m.primary.height < m.primary.width - 1) {
          assert.ok(m.overflow.colsV <= 1, `portrait, short stage: the composition overflows its box by ${m.overflow.colsV}px`);
        } else {
          near(m.primary.height, m.primary.width, 'portrait: the cube card is square where the stage has the height');
        }
        assert.ok(m.sheet.top >= m.primary.bottom - 1 && m.sheet.top <= m.primary.bottom + 11, `portrait: the moves are not directly under the cube (${m.sheet.top - m.primary.bottom}px below it)`);
        near(m.sheet.width, m.cols.width, 'portrait: the sheet spans the box');
        assert.equal(m.twinShown, false, 'portrait: the twin is drawn in the composition — it is behind the cube card\'s tool');
        assert.deepEqual(m.tools, ['speedBtn', 'twinBtn', 'randCubeTool'], 'portrait, Scramble: the cube card\'s tools are speed, the twin and the re-roll');
        assert.ok(m.aux.top >= m.sheet.bottom - 1, 'portrait: the transport is under the moves');
        assert.ok(m.aux.bottom <= m.stageContent.bottom + 1, `portrait: the transport is off the stage by ${m.aux.bottom - m.stageContent.bottom}px`);
        // The strip: one line, scrolling sideways and saying so by its fade, no bar and no gutter for one, the turn
        // you are on at its centre and larger than the rest.
        assert.equal(m.strip.lines, 1, `portrait: the moves wrap to ${m.strip.lines} lines`);
        assert.ok(m.strip.scrollW > m.strip.clientW, 'precondition: the scramble is longer than the strip');
        assert.ok(m.strip.moreRight, 'portrait: the strip has more on the right and does not fade it');
        assert.equal(m.strip.gutter, 0, `portrait: a scrollbar takes ${m.strip.gutter}px under the strip`);
        assert.equal(m.strip.bar, 'none', 'portrait: the strip draws a scrollbar');
        assert.ok(m.strip.curOff !== null, 'precondition: a turn is current');
        assert.ok(Math.abs(m.strip.curOff) <= 2, `portrait: the current turn is ${m.strip.curOff}px from the strip's centre`);
        assert.ok(m.strip.curW > m.strip.otherW + 1, `portrait: the current turn (${m.strip.curW}px) is not larger than the others (${m.strip.otherW}px)`);
        for (const c of m.chips) assert.ok(c.top >= m.strip.box.top - 1 && c.bottom <= m.strip.box.bottom + 1, `a chip leaves the strip: ${JSON.stringify(c)}`);
        // MUST NOT: a portrait cube smaller than the one this composition replaced.
        assert.ok(m.paintedSize >= cubeFloor('scramble', fixture), `portrait: the painted cube is ${m.paintedSize.toFixed(1)}px — under its floor of ${cubeFloor('scramble', fixture)}px`);
        await gapsHold(page, t, 'portrait, Scramble');
        // Scramble's band holds the follow-note alone: every sentence it can say, without a scroll (E12.8).
        await cubeSettled(page, '#viewCube cubus-cube');
        const bareScramble = await measureBand(page, '#viewCube cubus-cube');
        await bandHoldsEvery(page, '#viewCube cubus-cube', bareScramble, cubeBandStates(await bandEnumeration(page), { why: false }), applyCubeBand, 'portrait, Scramble\'s band');
        await page.evaluate(applyCubeBand, {});

        // The twin, reached by ONE control, drawn whole on the stage, and put away by the same control.
        await page.click('#twinBtn');
        const open = await page.evaluate(`(() => {
          const rect = ${rect.toString()};
          const card = document.querySelector('.state-card');
          return { shown: getComputedStyle(card).display !== 'none', card: rect(card), net: rect(document.querySelector('#viewNet')),
            stage: rect(document.getElementById('stage')), scroll: card.scrollHeight, client: card.clientHeight,
            expanded: document.querySelector('#twinBtn').getAttribute('aria-expanded'),
            fits: ${contentFits}(document.querySelector('.screen.active')) };
        })()`);
        assert.ok(open.shown, 'portrait: the twin\'s tool did not show the twin');
        assert.equal(open.expanded, 'true', 'portrait: the twin\'s tool does not say the twin is open');
        assert.ok(inside(open.card, open.stage), `portrait: the opened twin ${JSON.stringify(open.card)} leaves the stage ${JSON.stringify(open.stage)}`);
        assert.ok(inside(open.net, open.card), 'portrait: the net leaves the opened twin');
        near(open.net.width, Math.min(320, open.card.width - 36), 'portrait: the net fills the opened twin', 2);
        assert.deepEqual(open.fits, { spills: [], cut: [] }, 'portrait, twin open: text that cannot be read where it is drawn');
        await page.click('#twinBtn');
        assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.state-card')).display), 'none', 'portrait: the twin\'s tool did not put the twin away');
      } else {
        // aux directly under primary.
        assert.ok(m.aux.top >= m.primary.bottom - 1, 'aux is under the primary');
        near(m.aux.left, m.primary.left, 'aux shares the primary\'s left edge');
        // Landscape: the twin tops the column beside the primary, the sheet fills the rest of it.
        assert.ok(!m.asideBox, 'landscape: the aside hands its children to the grid');
        assert.ok(m.state.left >= m.primary.right + m.colsGap - 1, 'landscape: the twin is beside the primary');
        near(m.state.top, m.cols.top, 'landscape: the twin tops the column');
        assert.ok(m.sheet.top >= m.state.bottom - 1, 'landscape: the sheet is under the twin');
        near(m.sheet.right, m.cols.right, 'landscape: sheet reaches the box\'s right edge');
        near(m.sheet.bottom, m.cols.bottom, 'landscape: sheet reaches the box\'s bottom edge');
        // The net is whole, inside its card, and as wide as the card lets it be (320px, or the
        // card's content width) — a flex item with auto margins once shrank it to 49px.
        assert.ok(inside(m.net, m.state), `the net ${JSON.stringify(m.net)} leaves its card ${JSON.stringify(m.state)}`);
        near(m.net.width, Math.min(320, m.state.width - 36), 'the net fills its card', 2);
        // Landscape keeps what it had (E10): the speed menu is the cube card's one tool, and the moves still WRAP —
        // the one-line strip is portrait's, and here it would hide most of the walk to save height nobody needs.
        assert.deepEqual(m.tools, ['speedBtn'], 'landscape: the cube card shows a tool besides the speed menu');
        assert.ok(m.strip.lines > 1, `landscape: the moves are ${m.strip.lines} line — they no longer wrap`);
        assert.ok(m.strip.scrollW <= m.strip.clientW + 1, 'landscape: the moves scroll sideways');
      }
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

      // Every chip on the sheet, horizontally — in landscape, where the moves wrap; portrait's strip scrolls them
      // past its edges by design and holds them to its own box above. Nothing wider than the stage.
      if (!portrait) for (const c of m.chips) assert.ok(c.left >= m.sheet.left - 1 && c.right <= m.sheet.right + 1, `a chip leaves the sheet: ${JSON.stringify(c)}`);
      assert.ok(m.overflow.cols <= 1, `the composition overflows its box by ${m.overflow.cols}px`);
      assert.deepEqual(m.fits, { spills: [], cut: [] }, 'text that cannot be read where it is drawn — see contentFits');
      assert.ok(m.overflow.doc <= 0, `the page overflows the viewport by ${m.overflow.doc}px`);

      // The renderer sized its canvas to the slot the composition gave it.
      assert.ok(m.canvas, 'no canvas in the cube slot — the renderer did not mount');
      near(m.canvas.width, m.slot.width, 'canvas width is the slot width', 2);
      near(m.canvas.height, m.slot.height, 'canvas height is the slot height', 2);
      // The slot is the primary's, inside it. `.cube-slot`'s 220px floor once held the slot taller than a locked
      // primary row, and the cube drew 16px past its card into the gap on the Split View column (2026-10-17).
      assert.ok(inside(m.slot, m.primary), `the cube slot ${JSON.stringify(m.slot)} leaves the primary ${JSON.stringify(m.primary)}`);
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

// ---- every walk in landscape, by KIND of walk ---------------------------------------------------
//
// "With a mouse every move is on screen" was asserted on Scramble alone, and Home broke it unseen: the
// 20-move Quick walk on the desktop landscape window put its fourth row under the sheet's foot (192px of
// moves in a 154px list, 2026-10-18), because Home's sheet carries the Restore row and the method row
// that Scramble's does not. So the rule is asserted per KIND of walk, on every landscape fixture,
// with the longest walk of that kind (stage-contract.md, "every walking screen"):
//
//   - a walk with NO SECTIONS — Quick's whole-cube solve, a walk to a Restore stop, a scramble — shows
//     every move with a mouse, and its list has room for 20, the longest a Quick walk can be (God's
//     number, AGENTS.md §3). The cube is a frozen 20-move one (CONTRACT_CUBES[0], 2.0M nodes); the
//     superflip, 20 at best, kept the search going past a minute.
//   - a SECTIONED lesson (112–161 moves across the frozen Beginner lessons) cannot: the whole right-hand
//     column of the 840 window holds 14 rows of 6 chips, 84 moves, before any heading. It may scroll its
//     list, and while it does the turn you are on is wholly inside the list's visible box, with at least
//     one full row shown.
//
// The cube keeps its size because the twin card is what gives: the primary spans every row but the
// transport's, whatever height the twin card takes, which is asserted here as that relation.

const LONGEST_QUICK_CUBE = CONTRACT_CUBES[0];
const GODS_NUMBER = 20;
/** The longest frozen Beginner lesson, 161 moves in four sections (test/fixtures/beginner-lesson.json). */
const LONGEST_LESSON_CUBE = 'BFRUUBFRLBLFLRRLDLUFUBFUULDFFFDDFBRBDBRDLDURLDURBBLDUR';
const landscapeFixtures = FIXTURES.filter((f) => f.height - f.insets[0] - f.insets[2] <= f.width);

/** A frozen cube on Home, read the way a scan is. */
async function frozenOnHome(page, facelets) {
  await page.evaluate(() => { location.hash = '#/scan'; });
  await page.waitForSelector('#stageCard', { state: 'attached' });
  await page.evaluate((f) => {
    document.querySelector('ai-scan-panel').dispatchEvent(new CustomEvent('scan-complete', {
      detail: { facelets: f, rotations: [0, 0, 0, 0, 0, 0] },
    }));
  }, facelets);
  await page.waitForFunction(() => document.querySelector('#stageCard')?.hidden === false, null);
  await page.evaluate(() => { location.hash = '#/home'; });
  await page.waitForSelector('#solList .chip-m');
}

const measureWalk = (page) =>
  page.evaluate(`(() => {
    const rect = ${rect.toString()};
    const $ = (s) => document.querySelector(s);
    const px = (v) => Number.parseFloat(v);
    const list = $('#solList');
    const lb = list.getBoundingClientRect();
    const ls = getComputedStyle(list);
    const card = $('.state-card');
    const net = [$('#viewNet'), $('#stageAimNet')].find((n) => n && !n.closest('[hidden]') && n.getBoundingClientRect().height > 0);
    const chips = [...list.querySelectorAll('.chip-m')];
    const cur = list.querySelector('.chip-m.cur');
    const cols = $('.cols');
    return {
      // What the list SHOWS: its padding box, the part a scroll does not move.
      seen: { top: lb.top + list.clientTop, bottom: lb.top + list.clientTop + list.clientHeight, left: lb.left + list.clientLeft, right: lb.left + list.clientLeft + list.clientWidth },
      scroll: list.scrollHeight, client: list.clientHeight, pad: px(ls.paddingTop) + px(ls.paddingBottom),
      chips: chips.map((c) => ({ i: c.dataset.i, ...rect(c) })), cur: cur ? { i: cur.dataset.i, ...rect(cur) } : null,
      sections: list.querySelectorAll('.walk-sec:not(.whole)').length,
      rowGap: chips.length ? px(getComputedStyle(chips[0].parentElement).rowGap) : 0,
      state: rect(card), stateScroll: card.scrollHeight, stateClient: card.clientHeight, net: net ? rect(net) : null,
      primary: rect($('.cols > .primary')), aux: rect($('.cols > .aux')), cols: rect(cols),
      rowsGap: px(getComputedStyle($('.screen.active')).getPropertyValue('--rows-gap')),
      colsV: cols.scrollHeight - cols.clientHeight,
      fits: ${contentFits}($('.screen.active')),
    };
  })()`);

/** The relations every landscape walk keeps, whatever its kind. */
function landscapeWalkHolds(fixture, m, what) {
  // The cube's height is the grid's: every row but the transport's, the twin card's share included.
  near(m.primary.top, m.cols.top, `${what}: the cube card tops the box`);
  near(m.aux.bottom, m.cols.bottom, `${what}: the transport ends the box`);
  near(m.primary.bottom + m.rowsGap, m.aux.top, `${what}: the cube card reaches the transport`);
  // The twin card gives way to the moves, and what it gives is the net's size, never the net itself.
  assert.ok(m.stateScroll <= m.stateClient + 1, `${what}: the twin card holds ${m.stateScroll}px in ${m.stateClient}px`);
  assert.ok(m.net, `${what}: no net is drawn in the twin card`);
  assert.ok(inside(m.net, m.state), `${what}: the net ${JSON.stringify(m.net)} leaves its card ${JSON.stringify(m.state)}`);
  near(m.net.width / m.net.height, 12 / 9, `${what}: the net keeps its 12:9 shape`, 0.03);
  if (!fixture.touch) assert.ok(m.colsV <= 1, `${what}: the composition overflows its box vertically by ${m.colsV}px`);
  assert.deepEqual(m.fits, { spills: [], cut: [] }, `${what}: text that cannot be read where it is drawn — see contentFits`);
}

/** A walk with no sections: with a mouse, every move inside the list's visible box and nothing to scroll. */
function everyMoveShown(fixture, m, what) {
  assert.equal(m.sections, 0, `precondition: ${what} is a walk with no sections`);
  assert.ok(m.chips.length > 0, `precondition: ${what} has moves`);
  landscapeWalkHolds(fixture, m, what);
  if (fixture.touch) return;
  assert.ok(m.scroll <= m.client + 1, `${what}: the move list scrolls by ${m.scroll - m.client}px — every move must be on screen`);
  const hidden = m.chips.filter((c) => !inside(c, m.seen));
  assert.deepEqual(hidden.map((c) => c.i), [], `${what}: moves outside the list's visible box`);
}

/** The rows of chips the list's visible box holds, times the chips a row holds: room for this many moves. */
function room(m) {
  const tops = m.chips.map((c) => Math.round(c.top) + 0);
  const perRow = Math.max(...[...new Set(tops)].map((t) => tops.filter((x) => x === t).length));
  const chip = m.chips[0].height;
  return perRow * Math.floor((m.client - m.pad + m.rowGap) / (chip + m.rowGap));
}

for (const fixture of landscapeFixtures) {
  test(`landscape, every walk with no sections shows every move: ${label(fixture)}`, async () => {
    const { page, context } = await open(fixture, 'home', { solveMethod: 'quick' });
    try {
      // Quick's whole-cube walk at its longest.
      await frozenOnHome(page, LONGEST_QUICK_CUBE);
      await page.waitForFunction(() => /^\d+$/.test(document.querySelector('#moveCount')?.textContent ?? ''), null, { timeout: 90_000 });
      let m = await measureWalk(page);
      assert.ok(m.chips.length >= GODS_NUMBER - 1, `precondition: CONTRACT_CUBES[0] is a ${m.chips.length}-move Quick walk, not ~20`);
      everyMoveShown(fixture, m, `Home, Quick, ${m.chips.length} moves`);
      if (!fixture.touch) assert.ok(room(m) >= GODS_NUMBER, `Home, Quick: the list has room for ${room(m)} moves — a Quick walk can be ${GODS_NUMBER}`);

      // A walk to a Restore stop: the first stop the row offers, which the superflip has not reached.
      const stop = await page.evaluate(() => [...document.querySelectorAll('#stageTargetRow [data-stage]')].find((el) => !el.hidden && el.dataset.stage !== 'solved')?.dataset.stage);
      assert.ok(stop, 'precondition: the Restore row offers a stop');
      await page.evaluate((id) => document.querySelector(`#stageTargetRow [data-stage="${id}"]`).click(), stop);
      await page.waitForFunction((id) => document.querySelector(`#stageTargetRow [data-stage="${id}"]`)?.classList.contains('on')
        && !/working/.test(document.querySelector('#moveCount')?.textContent ?? '') && document.querySelector('#solList .chip-m'), stop, { timeout: 90_000 });
      m = await measureWalk(page);
      everyMoveShown(fixture, m, `Home, a walk to "${stop}"`);

      // A scramble, on its own screen.
      await page.evaluate(() => { location.hash = '#/scramble'; });
      await page.waitForSelector('.screen.active #randCube:visible');
      await page.click('.screen.active #randCube:visible');
      await page.waitForSelector('#solList .chip-m');
      m = await measureWalk(page);
      everyMoveShown(fixture, m, 'Scramble');
    } finally {
      await context.close();
    }
  });

  test(`landscape, a sectioned lesson keeps the turn you are on in view: ${label(fixture)}`, async () => {
    const { page, context } = await open(fixture, 'home', { solveMethod: 'beginner' });
    try {
      await frozenOnHome(page, LONGEST_LESSON_CUBE);
      await page.waitForFunction(() => document.querySelectorAll('#solList .walk-sec').length > 1, null, { timeout: 90_000 });
      let m = await measureWalk(page);
      assert.equal(m.chips.length, 161, 'precondition: the longest frozen Beginner lesson is on screen');
      assert.ok(m.sections > 1, 'precondition: the lesson is sectioned');
      landscapeWalkHolds(fixture, m, 'a lesson');
      const row = m.chips[0].height + m.pad;
      assert.ok(m.client >= row - 1, `a lesson's list shows ${m.client}px — less than one full row of moves (${row}px)`);

      /** Go somewhere in the lesson the way a person does, then ask where the turn you are on is drawn. */
      const curShown = async (how, go) => {
        await go();
        m = await measureWalk(page);
        assert.ok(m.cur, `${how}: no turn is current`);
        assert.ok(inside(m.cur, m.seen), `${how}: the turn you are on (move ${m.cur.i}) is drawn at ${JSON.stringify(m.cur)}, outside the list's visible box ${JSON.stringify(m.seen)}`);
        landscapeWalkHolds(fixture, m, how);
      };
      // A press on a chip, made the way a hand makes it — no scroll first, which is what Playwright's click would do.
      const jump = (i) => async () => {
        await page.evaluate((k) => document.querySelector(`#solList .chip-m[data-i="${k}"]`).click(), i);
        await page.waitForSelector(`#solList .chip-m.cur[data-i="${i}"]`);
      };
      const lastSection = await page.evaluate(() => Number([...document.querySelectorAll('#solList .walk-sec')].at(-1).querySelector('.chip-m').dataset.i));
      await curShown('jumping to the last section', jump(lastSection));
      for (let k = 1; k <= 3; k += 1) {
        await curShown(`Next, ${k} into the last section`, async () => {
          await page.click('#nextBtn');
          await page.waitForSelector(`#solList .chip-m.cur[data-i="${lastSection + k}"]`);
        });
      }
      await curShown('jumping to the last move', jump(160));
      await curShown('jumping back to the first move', jump(0));
    } finally {
      await context.close();
    }
  });
}

// ---- the rows that come and go, and a lesson's heading, in portrait (dev-docs/practice-redesign-plan.md E12) ----------
//
// On Home in portrait every row that comes and goes — the follow-note, the why line, the practise-step button — took
// its height from the cube: 22–166 px, and on the iPhone SE any one of them took the cube from 172 to 144 px (E12).
// In portrait they are drawn in ONE BAND over the foot of the cube card (lib/foot-band.js), clear of the cube itself and
// over the ghost region below it, so the cube is the same size with the band shown and hidden. And a lesson's strip has
// no label row there (E12.5): the section of the turn you are on names the solution card's heading instead.

/**
 * The cube's own box on the page — the body, not its ghosts: the box of the renderer's cube projected through its own
 * camera, and the box of the sphere around it, which no turn of the cube can leave. Self-contained: evaluated in the page.
 */
const cubeBodyBox = (sel) => {
  const el = document.querySelector(sel);
  const c = el.querySelector('canvas');
  const cr = c.getBoundingClientRect();
  const cam = el.camera;
  el.root.updateMatrixWorld(true);
  cam.updateMatrixWorld(true);
  const V = cam.position.constructor;
  const at = (v) => { const p = v.project(cam); return { x: cr.left + (p.x + 1) / 2 * cr.width, y: cr.top + (1 - p.y) / 2 * cr.height }; };
  let box = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
  for (const x of [-1.5, 1.5]) for (const y of [-1.5, 1.5]) for (const z of [-1.5, 1.5]) {
    const p = at(new V(x, y, z).applyMatrix4(el.root.matrixWorld));
    box = { left: Math.min(box.left, p.x), right: Math.max(box.right, p.x), top: Math.min(box.top, p.y), bottom: Math.max(box.bottom, p.y) };
  }
  return box;
};

/** Until the cube is neither turning a layer nor turning over, and two frames have been drawn since. */
const cubeSettled = async (page, sel) => {
  await page.waitForFunction((x) => { const c = document.querySelector(x); return c && !c.animating && !c.turning; }, sel);
  await page.evaluate(() => new Promise((r) => { requestAnimationFrame(() => requestAnimationFrame(r)); }));
  await cubePainted(page, `${sel} canvas`);
};

/** The band and the rows it may hold, as the cases below read them. */
const measureBand = (page, cubeSel) => page.evaluate(`(() => {
  const rect = ${rect.toString()};
  const band = document.querySelector('.foot-band');
  const drawn = (el) => Boolean(el) && !el.closest('[hidden]') && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
  const card = document.querySelector('.cols > .primary');
  return {
    band: drawn(band) ? rect(band) : null, inCard: Boolean(band) && card.contains(band),
    card: rect(card), cube: (${cubeBodyBox.toString()})(${JSON.stringify(cubeSel)}),
    painted: (${paintedSize.toString()})(${JSON.stringify(`${cubeSel} canvas`)}),
    held: [...(band?.children ?? [])].filter(drawn).map((el) => el.id),
    fits: ${contentFits}(document.querySelector('.screen.active')),
    scroll: band ? { height: band.scrollHeight, client: band.clientHeight } : null,
    controls: [...(band?.querySelectorAll('button, a[href], input, select') ?? [])].filter(drawn)
      .map((el) => ({ name: el.id || el.textContent.trim(), box: rect(el) })),
    surfaces: drawn(band) ? (${bandSurfaces.toString()})(band) : null,
  };
})()`);

/**
 * The band's surface and the text on it, in each of the three themes: the band is a sheet laid over the ghost face, so
 * it must read as one — opaque, and not the colour of what it lies on, or the ghost reads as cut rather than covered
 * (E12.6) — and every word on it, its buttons' included, must clear AA on whatever is behind that word. Self-contained:
 * evaluated in the page. Puts the page's theme back as it found it.
 */
const bandSurfaces = (band) => {
  const rgba = (s) => {
    const n = (s.match(/[\d.]+/g) ?? []).map(Number);
    // `color(srgb r g b / a)` carries 0–1 channels; `rgb()`/`rgba()` 0–255.
    if (/^color\(srgb/.test(s)) return { r: n[0] * 255, g: n[1] * 255, b: n[2] * 255, a: n.length > 3 ? n[3] : 1 };
    return { r: n[0], g: n[1], b: n[2], a: n.length > 3 ? n[3] : 1 };
  };
  const ch = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lum = (c) => 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
  const contrast = (x, y) => { const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };
  const root = document.documentElement;
  const was = root.getAttribute('data-theme');
  const out = [];
  // A theme's colours are read as they STAND, not part way through a transition from the last theme's: a button's
  // colour eases, and read at once it is still the previous theme's (night's "Re-solve" read 3.13:1 that way).
  const still = document.createElement('style');
  still.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }';
  document.head.append(still);
  try {
    for (const theme of ['cream', 'white', 'night']) {
      root.setAttribute('data-theme', theme);
      const surface = rgba(getComputedStyle(band).backgroundColor);
      const under = rgba(getComputedStyle(band.parentElement.closest('.win') ?? document.body).backgroundColor);
      const words = [];
      const walker = document.createTreeWalker(band, NodeFilter.SHOW_TEXT);
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        const el = t.parentElement;
        // Words that are not drawn are not read: a quiet note's rescue buttons are laid out nowhere (`display: none` on
        // the row that holds them), and their colours say nothing about what is on screen.
        if (!t.data.trim() || el.closest('[hidden]') || el.getClientRects().length === 0) continue;
        let behind = surface;
        for (let x = el; x && x !== band; x = x.parentElement) {
          const bg = rgba(getComputedStyle(x).backgroundColor);
          if (bg.a >= 1) { behind = bg; break; }
        }
        words.push({ text: t.data.trim().slice(0, 30), ratio: contrast(rgba(getComputedStyle(el).color), behind) });
      }
      // "Not the colour of the page" as a contrast, not a luminance step: the night page is so dark that a band plainly
      // off it differs by under 0.01 in luminance, and the white page so light that 0.01 is a shade nobody sees.
      out.push({ theme, opaque: surface.a >= 1, distinct: contrast(surface, under) >= 1.05, words });
    }
  } finally {
    if (was === null) root.removeAttribute('data-theme'); else root.setAttribute('data-theme', was);
    getComputedStyle(root).color; // the page's own theme in place before transitions come back
    still.remove();
  }
  return out;
};

/** The band's must-nots, wherever it is shown: inside the cube card's foot, clear of the cube, nothing cut. */
function bandHolds(b, what) {
  assert.ok(b.band, `${what}: the band is not drawn`);
  assert.ok(b.inCard, `${what}: the band is not in the cube card`);
  assert.ok(inside(b.band, b.card), `${what}: the band ${JSON.stringify(b.band)} leaves the cube card ${JSON.stringify(b.card)}`);
  near(b.band.bottom, b.card.bottom, `${what}: the band is not at the cube card's foot`, 2);
  assert.ok(b.band.top >= b.cube.bottom - 0.5, `${what}: the band (top ${b.band.top.toFixed(1)}) is drawn over the cube (bottom ${b.cube.bottom.toFixed(1)})`);
  assert.deepEqual(b.fits, { spills: [], cut: [] }, `${what}: text that cannot be read where it is drawn — see contentFits`);
  // NOTHING IN THE BAND IS REACHED BY SCROLLING IT, and no control in it is drawn in part (E12.6): the band draws no
  // scrollbar, so a row past its foot is a row nobody knows is there — the SE's follow-note had its two buttons cut
  // by 6px of an invisible scroller.
  assert.ok(b.scroll.height <= b.scroll.client + 0.5, `${what}: the band scrolls — ${b.scroll.height}px in ${b.scroll.client}px`);
  for (const c of b.controls) assert.ok(inside(c.box, b.band, 0.5), `${what}: "${c.name}" ${JSON.stringify(c.box)} is not wholly in the band ${JSON.stringify(b.band)}`);
  // A SHEET OVER THE GHOST, and words that can be read on it, in every theme.
  for (const s of b.surfaces) {
    assert.ok(s.opaque, `${what}, ${s.theme}: the band's surface is not opaque`);
    assert.ok(s.distinct, `${what}, ${s.theme}: the band is the colour of the card it lies on — the ghost reads as cut, not covered`);
    assert.ok(s.words.length > 0, `precondition, ${what}, ${s.theme}: the band holds no words to measure`);
    for (const w of s.words) assert.ok(w.ratio >= 4.5, `${what}, ${s.theme}: "${w.text}" is ${w.ratio.toFixed(2)}:1 on the band — AA needs 4.5`);
  }
}

/**
 * THE GAPS THE EYE SEES between the portrait walking composition's regions (E12.6): from the last thing one region
 * DRAWS to the first thing the next one draws — text, a control, a chip, a bead, a picture, or a box with a surface or a
 * rule of its own. The regions' boxes are no measure: a card draws nothing of its own here, so 54px of empty page
 * between the strip and the transport was four boxes' paddings and an empty row's gap, each box tight on the next. A
 * cube's region is its canvas, whatever the renderer frames inside it. A slot held empty on purpose (`reserved`, the
 * selectors of RESERVED_SLOTS, E12.7) counts by its box while it is laid out, drawn in or not. Also the cube's row and the stage's width, so the
 * case can tell a cube held by the width (its row at 100cqw: what is left over has nowhere else to go) from one the
 * gaps are taking room from. Self-contained: evaluated in the page.
 */
const regionGaps = (reserved) => {
  const grid = document.querySelector('.screen.active .cols.walking');
  const stage = document.getElementById('stage');
  const unseen = (el) => {
    for (let x = el; x && x !== document.body; x = x.parentElement) {
      const s = getComputedStyle(x);
      if (x.hidden || s.display === 'none' || s.clipPath !== 'none' || (s.clip && s.clip !== 'auto')) return true;
    }
    return getComputedStyle(el).visibility === 'hidden';
  };
  const clear = (c) => !c || c === 'transparent' || /^rgba\(.*,\s*0\)$/.test(c) || /\/\s*0\)$/.test(c);
  const backdrop = getComputedStyle(stage).backgroundColor;
  const extent = (region) => {
    let top = Infinity, bottom = -Infinity, first = null, last = null;
    const add = (r, what) => {
      if (r.width <= 0 || r.height <= 0) return;
      if (r.top < top) { top = r.top; first = what; }
      if (r.bottom > bottom) { bottom = r.bottom; last = what; }
    };
    const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (!t.data.trim() || unseen(t.parentElement)) continue;
      const range = document.createRange();
      range.selectNodeContents(t);
      add(range.getBoundingClientRect(), JSON.stringify(t.data.trim().slice(0, 24)));
    }
    for (const el of region.querySelectorAll(reserved.join(', ') || ':not(*)')) {
      if (!el.closest('[hidden]') && el.getClientRects().length > 0) add(el.getBoundingClientRect(), `${el.className} (reserved)`);
    }
    for (const el of region.querySelectorAll('*')) {
      if (unseen(el)) continue;
      const s = getComputedStyle(el);
      const surface = !clear(s.backgroundColor) && s.backgroundColor !== backdrop;
      const rule = ['Top', 'Bottom'].some((k) => parseFloat(s[`border${k}Width`]) > 0 && !clear(s[`border${k}Color`]));
      if (el.matches('button, input, select, .chip-m, .bead, svg, img, canvas') || surface || rule) {
        add(el.getBoundingClientRect(), el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}.${el.classList[0] ?? ''}`);
      }
    }
    return { top, bottom, first, last };
  };
  const regions = [...grid.children].flatMap((el) => (getComputedStyle(el).display === 'contents' ? [...el.children] : [el]))
    .filter((el) => !unseen(el) && !/absolute|fixed/.test(getComputedStyle(el).position))
    .map((el) => ({ name: el.id ? `#${el.id}` : `.${[...el.classList].slice(0, 2).join('.')}`, box: el.getBoundingClientRect().top, ...extent(el) }))
    .filter((r) => r.bottom > r.top)
    .sort((a, b) => a.box - b.box);
  const s = getComputedStyle(stage);
  return {
    regions: regions.map((r) => r.name),
    gaps: regions.slice(1).map((r, i) => ({ from: `${regions[i].name} (${regions[i].last})`, to: `${r.name} (${r.first})`, gap: r.top - regions[i].bottom })),
    rowGap: parseFloat(getComputedStyle(grid).rowGap),
    cubeRow: parseFloat(getComputedStyle(grid).gridTemplateRows),
    stageWidth: stage.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight),
  };
};

/**
 * MUST NOT: room left between two regions that the cube could have had. No gap the eye sees in the portrait walking
 * composition is wider than the composition's own row gap plus 16px — unless the cube's row is already the stage's
 * width, where a gap is what is left over and the case reports it rather than fails it (E12.6).
 */
async function gapsHold(page, t, what) {
  const m = await page.evaluate(regionGaps, RESERVED_SLOTS.map((s) => s.selector));
  assert.ok(m.regions.length >= 3, `precondition, ${what}: ${m.regions.length} regions measured (${m.regions.join(', ')}) — the cube, the moves and the transport at least`);
  const allowed = m.rowGap + 16;
  const wide = m.gaps.filter((g) => g.gap > allowed + 0.5);
  const byWidth = m.cubeRow >= m.stageWidth - 0.5;
  if (byWidth) {
    for (const g of wide) t.diagnostic(`${what}: the cube is held by the stage's width (row ${m.cubeRow.toFixed(1)}px); ${g.gap.toFixed(1)}px between ${g.from} and ${g.to}`);
    return m;
  }
  assert.deepEqual(wide.map((g) => `${g.gap.toFixed(1)}px between ${g.from} and ${g.to}`), [],
    `${what}: a gap wider than ${allowed}px (the row gap and 16) while the cube's row (${m.cubeRow.toFixed(1)}px) is under the stage's width (${m.stageWidth.toFixed(1)}px)`);
  return m;
}

/** Show or hide the cube screen's rows that come and go, as their writers do — the hidden attribute and a text. */
const cubeRows = (page, rows) => page.evaluate((r) => {
  const set = (id, on, text) => { const el = document.getElementById(id); el.hidden = !on; if (on && text) (el.querySelector('#followMsg') ?? el).textContent = text; };
  set('whyLine', r.includes('why'), 'Step 3 of 12 — Put the white edge between its two centres, so the cross grows by one arm.');
  set('whyBtn', r.includes('why'));
  set('practiseStep', r.includes('practise'), 'Practise this');
  set('followNote', r.includes('follow'), 'That was R — turn R\' to get back on the plan.');
}, rows);

/**
 * EVERYTHING THE BAND CAN HOLD, from the modules that say it (E12.8): every sentence the follow-note can say, each built
 * at its longest instance (lib/walk-follow.js, `followNoteSentences`); every label the practise-step button can carry
 * (lib/practice-link.js, `practiseLabels`); the why button's label (lib/walk-presenter.js, `WHY_TURN_LABEL`); and the
 * record's two fixed sentences, both at once (lib/drill/record-says.js). Read in the page, so it is the app's own copy.
 */
const bandEnumeration = (page) => page.evaluate(async () => {
  const [{ followNoteSentences }, { practiseLabels }, { WHY_TURN_LABEL }, { RECORD_SAYS }, { drawnWidth }] = await Promise.all([
    import('/lib/walk-follow.js'), import('/lib/practice-link.js'), import('/lib/walk-presenter.js'), import('/lib/drill/record-says.js'),
    import('/lib/foot-band.js')]);
  // "Longest" as the band draws it, in its own font — the measure the app sizes its room by.
  const widthOf = drawnWidth(document.querySelector('.screen.active .foot-band'));
  return { follow: followNoteSentences({ widthOf }), practise: practiseLabels({ widthOf }), why: WHY_TURN_LABEL,
    record: [RECORD_SAYS.save, RECORD_SAYS.read] };
});

/**
 * MUST NOT, for every one of `states`: the band scrolling, a control in it cut, the cube under it, or the cube a different
 * size than with the band put away (E12.7, E12.8). `apply(state)` shows the state in the page as its writer would.
 */
async function bandHoldsEvery(page, cubeSel, bare, states, apply, what) {
  assert.ok(states.length > 0, `precondition, ${what}: nothing enumerated for the band to hold`);
  for (const state of states) {
    await page.evaluate(apply, state);
    await page.evaluate(() => new Promise((r) => { requestAnimationFrame(() => requestAnimationFrame(r)); }));
    await cubeSettled(page, cubeSel);
    const b = await measureBand(page, cubeSel);
    const label = `${what}: ${JSON.stringify(state).slice(0, 120)}`;
    bandHolds(b, label);
    for (const k of ['top', 'height']) near(b.card[k], bare.card[k], `${label}: the cube card's ${k} moved`);
    near(b.painted, bare.painted, `${label}: the painted cube changed size`);
  }
}

/** The cube screen's band states: each follow-note sentence alone, and the why button beside each practise label. */
const cubeBandStates = (e, { why = true } = {}) => [
  ...e.follow.map((f) => ({ follow: f.text, info: f.info })),
  ...(why ? e.practise.map((label) => ({ why: e.why, practise: label })) : []),
];
const applyCubeBand = (st) => {
  const note = document.getElementById('followNote');
  note.hidden = !st.follow;
  note.classList.toggle('info', Boolean(st.info));
  if (st.follow) document.getElementById('followMsg').textContent = st.follow;
  const whyLine = document.getElementById('whyLine');
  const whyBtn = document.getElementById('whyBtn');
  const practise = document.getElementById('practiseStep');
  if (whyLine) { whyLine.hidden = !st.why; whyLine.textContent = st.why ? 'Step 3 of 12 — the full sentence, said to a screen reader and in the menu' : ''; }
  if (whyBtn) whyBtn.hidden = !st.why;
  if (practise) { practise.hidden = !st.practise; if (st.practise) practise.textContent = st.practise; }
};

for (const fixture of FIXTURES) {
  test(`a lesson in portrait: the heading names the section you are in, and the band leaves the cube its size: ${label(fixture)}`, async (t) => {
    const { page, context, errors } = await open(fixture, 'home', { solveMethod: 'beginner' });
    try {
      await frozenOnHome(page, LONGEST_LESSON_CUBE);
      await page.waitForFunction(() => document.querySelectorAll('#solList .walk-sec').length > 1, null, { timeout: 90_000 });
      await cubePainted(page);
      const portrait = await page.evaluate(() => document.querySelector('.cols .sheet').getBoundingClientRect().top >= document.querySelector('.cols > .primary').getBoundingClientRect().bottom - 1);
      const sections = await page.evaluate(() => [...document.querySelectorAll('#solList .walk-sec')].map((sec) => {
        const ks = [...sec.querySelectorAll('.chip-m')].map((c) => Number(c.dataset.i));
        return { from: Math.min(...ks), to: Math.max(...ks), name: sec.querySelector('.walk-sec-l').textContent.replace(/\s+/g, ' ').trim() };
      }));
      assert.ok(sections.length >= 4, `precondition: the longest lesson has ${sections.length} sections`);
      const heading = () => page.evaluate(() => {
        const shown = (el) => Boolean(el) && !el.hidden && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
        return {
          sec: shown(document.querySelector('#secLabel')) ? document.querySelector('#secLabel').textContent.replace(/\s+/g, ' ').trim() : null,
          sol: shown(document.querySelector('#solLabel')),
          stripLabels: [...document.querySelectorAll('#solList .walk-sec-l')].filter(shown).length,
        };
      });
      for (const s of sections) {
        for (const [where, k] of [['first', s.from], ['middle', Math.floor((s.from + s.to) / 2)], ['last', s.to]]) {
          await page.evaluate((i) => document.querySelector(`#solList .chip-m[data-i="${i}"]`).click(), k);
          await page.waitForSelector(`#solList .chip-m.cur[data-i="${k}"]`);
          const h = await heading();
          if (portrait) {
            assert.equal(h.sec, s.name, `portrait, ${where} turn of "${s.name}" (move ${k}): the heading says ${JSON.stringify(h.sec)}`);
            assert.equal(h.sol, false, 'portrait: the walk\'s own heading is drawn beside the section\'s');
            assert.equal(h.stripLabels, 0, 'portrait: the lesson\'s strip still draws a label row');
          } else {
            assert.equal(h.sec, null, 'landscape: the heading names a section — landscape keeps its labels');
            assert.ok(h.stripLabels > 0, 'landscape: the lesson\'s labels are gone');
          }
        }
      }
      if (portrait) {
        // Measured one move into the lesson, as the floor was (E12.2), once the cube has stopped moving: a picture read
        // part way through a turn or a tumble is no size at all.
        await page.evaluate(() => document.querySelector('#solList .chip-m[data-i="0"]').click());
        await page.waitForSelector('#solList .chip-m.cur[data-i="0"]');
        await cubeSettled(page, '#viewCube cubus-cube');
        practiceFloor(await measureScreen(page), fixture, 'a lesson in portrait');
        // The rows that come and go, in the band: none, then each, then all, and the cube the same size throughout.
        await cubeRows(page, []);
        await cubeSettled(page, '#viewCube cubus-cube');
        const bare = await measureBand(page, '#viewCube cubus-cube');
        assert.equal(bare.band, null, 'portrait: the band is drawn with nothing in it');
        assert.ok(bare.painted >= cubeFloor('lesson', fixture), `portrait: the lesson's painted cube is ${bare.painted.toFixed(1)}px — under its floor of ${cubeFloor('lesson', fixture)}px`);
        await gapsHold(page, t, 'portrait, a lesson');
        for (const rows of [['why'], ['practise'], ['follow'], ['why', 'practise'], ['why', 'practise', 'follow']]) {
          await cubeRows(page, rows);
          await cubeSettled(page, '#viewCube cubus-cube');
          const b = await measureBand(page, '#viewCube cubus-cube');
          const what = `portrait, the band holding ${rows.join(' + ')}`;
          bandHolds(b, what);
          for (const k of ['top', 'left', 'width', 'height']) near(b.card[k], bare.card[k], `${what}: the cube card's ${k} moved`);
          near(b.painted, bare.painted, `${what}: the painted cube changed size`);
        }
        await cubeRows(page, []);
        // THE LONGEST THING THE BAND CAN HOLD, enumerated from source, each without a scroll and the cube its size (E12.8).
        const e = await bandEnumeration(page);
        assert.ok(e.follow.length > 0 && e.practise.length > 0, `precondition: the enumeration is empty (${e.follow.length} sentences, ${e.practise.length} labels)`);
        await bandHoldsEvery(page, '#viewCube cubus-cube', bare, cubeBandStates(e), applyCubeBand, 'portrait, a lesson\'s band');
        await page.evaluate(applyCubeBand, {});
      }
      // THE WHY OF A STEP (E12.8): in portrait the band shows one button, and the full line — the step, the hold, the
      // reason — opens from it in a menu; a screen reader still has the full line where it was. Landscape keeps the line.
      await page.evaluate(() => document.querySelector('#solList .chip-m[data-i="1"]').click());
      await page.waitForSelector('#solList .chip-m.cur[data-i="1"]');
      await page.waitForFunction(() => !document.getElementById('whyLine').hidden && document.getElementById('whyLine').textContent.length > 0);
      const why = await page.evaluate(`(() => {
        const rect = ${rect.toString()};
        const line = document.getElementById('whyLine'), btn = document.getElementById('whyBtn');
        const drawn = (el) => !el.closest('[hidden]') && getComputedStyle(el).display !== 'none' && getComputedStyle(el).clipPath === 'none' && el.getBoundingClientRect().height > 2;
        return { text: line.textContent, lineDrawn: drawn(line), lineInTree: !line.hidden && getComputedStyle(line).display !== 'none',
          btnDrawn: Boolean(btn) && drawn(btn), btnText: btn?.textContent.trim() ?? null, inBand: Boolean(btn?.closest('.foot-band')) };
      })()`);
      assert.ok(why.text.length > 20, `precondition: the step has a why line (${JSON.stringify(why.text)})`);
      if (portrait) {
        assert.ok(why.btnDrawn && why.inBand, 'portrait: the why button is not drawn in the band');
        assert.equal(why.btnText, 'Why this turn?', 'portrait: the why button does not say what it opens');
        assert.equal(why.lineDrawn, false, 'portrait: the full why line is drawn in the band — it opens from the button');
        assert.ok(why.lineInTree, 'portrait: the why line left the page — a screen reader no longer has it');
        await page.click('#whyBtn');
        const menu = await page.evaluate(`(() => {
          const rect = ${rect.toString()};
          const m = [...document.querySelectorAll('.menu.why-menu')].find((x) => !x.hidden);
          return m ? { text: m.textContent.replace(/\\s+/g, ' ').trim(), box: rect(m), stage: rect(document.getElementById('stage')),
            expanded: document.getElementById('whyBtn').getAttribute('aria-expanded'), fits: ${contentFits}(document.querySelector('.screen.active')) } : null;
        })()`);
        assert.ok(menu, 'portrait: pressing the why button opened no menu');
        assert.equal(menu.text, why.text.replace(/\s+/g, ' ').trim(), 'portrait: the menu does not hold the full why line');
        assert.ok(inside(menu.box, menu.stage), `portrait: the why menu ${JSON.stringify(menu.box)} leaves the stage`);
        assert.equal(menu.expanded, 'true', 'portrait: the why button does not say its menu is open');
        assert.deepEqual(menu.fits, { spills: [], cut: [] }, 'portrait, the why menu open: text that cannot be read where it is drawn');
        await page.click('#whyBtn');
      } else {
        assert.ok(why.lineDrawn, 'landscape: the why line is not drawn');
        assert.equal(why.btnDrawn, false, 'landscape: the why button is drawn — landscape keeps the full line');
      }
      assert.deepEqual(errors.map(String), [], 'the page threw');
    } finally {
      await context.close();
    }
  });

  test(`a Quick walk in portrait: the band leaves the cube its size: ${label(fixture)}`, async (t) => {
    const { page, context, errors } = await open(fixture, 'home', { devRandCube: true });
    try {
      await page.waitForSelector('#randCube', { state: 'attached' });
      await page.evaluate(() => document.querySelector('#randCube').click());
      await page.waitForSelector('#solList .chip-m');
      await page.waitForFunction(() => /^\d/.test(document.querySelector('#moveCount')?.textContent ?? ''), null, { timeout: 90_000 });
      await cubePainted(page);
      const portrait = await page.evaluate(() => document.querySelector('.cols .sheet').getBoundingClientRect().top >= document.querySelector('.cols > .primary').getBoundingClientRect().bottom - 1);
      await cubeRows(page, []);
      await cubeSettled(page, '#viewCube cubus-cube');
      const bare = await measureBand(page, '#viewCube cubus-cube');
      if (portrait) await gapsHold(page, t, 'portrait, Quick');
      await cubeRows(page, ['follow']);
      await cubeSettled(page, '#viewCube cubus-cube');
      const b = await measureBand(page, '#viewCube cubus-cube');
      if (portrait) {
        bandHolds(b, 'portrait, Quick, the follow-note');
        near(b.painted, bare.painted, 'portrait, Quick: the painted cube changed size with the follow-note');
        for (const k of ['top', 'height']) near(b.card[k], bare.card[k], `portrait, Quick: the cube card's ${k} moved with the follow-note`);
        const e = await bandEnumeration(page);
        await bandHoldsEvery(page, '#viewCube cubus-cube', bare, cubeBandStates(e), applyCubeBand, 'portrait, Quick\'s band');
      } else {
        // Landscape keeps today's rows: the note at the foot of the solution card, never over the cube.
        assert.equal(b.band, null, 'landscape: the band is drawn');
        assert.ok(await page.evaluate(() => Boolean(document.querySelector('#followNote').closest('.solution-card'))), 'landscape: the follow-note left the solution card');
      }
      assert.deepEqual(errors.map(String), [], 'the page threw');
    } finally {
      await context.close();
    }
  });
}

// ---- the band's room never waits on the ledger -------------------------------------------------------------------
//
// THE ORDERING THAT FAILED (31b51c59): the band's room was sized by every label the practise-step button can carry,
// asked of the library worker, so a worker that answered after the walk was drawn grew the reserve then — and the cube
// shrank under the child's eyes. "The band leaves the cube its size" failed on whichever fixture the worker was slow
// (iPhone 16 268.8 vs 280.8 px; Split View 194 vs 208), and a probe with the worker held 6 s took the painted cube from
// 345 to 330 px on the iPhone 16 once it answered. Pinned here with the worker held back ON PURPOSE: the cube and the
// reserve the walk is drawn with are the ones it keeps once the ledger answers.
test('the band\'s room is sized before the ledger answers: a late library worker changes neither the reserve nor the cube', async () => {
  const fixture = FIXTURES.find((f) => f.name === 'iPhone 16');
  const HELD_MS = 6000;
  let released = false;
  const opened = await openAt(fixture, urlFor(fixture, 'home'), async (context) => {
    await context.addInitScript(() => localStorage.setItem('cubusSettings', JSON.stringify({ devRandCube: true })));
    await context.route(/library-worker\.js/, async (route) => {
      await new Promise((r) => { setTimeout(r, HELD_MS); });
      released = true;
      await route.continue();
    });
  });
  const { page, context, errors } = opened;
  try {
    await page.waitForSelector('.screen.active');
    await page.waitForSelector('#randCube', { state: 'attached' });
    await page.evaluate(() => document.querySelector('#randCube').click());
    await page.waitForSelector('#solList .chip-m');
    await page.waitForFunction(() => /^\d/.test(document.querySelector('#moveCount')?.textContent ?? ''), null, { timeout: 90_000 });
    await cubePainted(page);
    await cubeSettled(page, '#viewCube cubus-cube');
    const reserveNow = () => page.evaluate(() => document.querySelector('.cols > .primary').style.getPropertyValue('--band-reserve'));
    const before = { reserve: await reserveNow(), painted: await page.evaluate(paintedSize) };
    assert.equal(released, false, 'precondition: the ledger answered before the walk was measured — nothing was held back');
    assert.ok(before.painted > 0, 'precondition: no cube painted');
    // The ledger answers now: the practise-step button's offer can appear, and nothing else may move.
    await page.evaluate(async () => { const { library } = await import('/lib/drill/library-client.js'); await library.ids(); });
    assert.equal(released, true, 'precondition: the ledger never answered');
    await page.evaluate(() => new Promise((r) => { requestAnimationFrame(() => requestAnimationFrame(r)); }));
    await cubeSettled(page, '#viewCube cubus-cube');
    const after = { reserve: await reserveNow(), painted: await page.evaluate(paintedSize) };
    assert.equal(after.reserve, before.reserve, 'the reserve under the cube grew when the ledger answered');
    near(after.painted, before.painted, 'the painted cube changed size when the ledger answered');
    assert.deepEqual(errors.map(String), [], 'the page threw');
  } finally {
    await context.close();
  }
});

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
      fits: ${contentFits}(document.querySelector('.screen.active')),
    };
  })()`);

const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

const inside = (r, box, tol = 1) => r.left >= box.left - tol && r.right <= box.right + tol && r.top >= box.top - tol && r.bottom <= box.bottom + tol;

/** A scanned cube the app adopts — `test/browser/stage-target.test.mjs`'s, generated there, not typed. */
// THE METHOD ROW (ADR 0011): one pill per method under the move count, and beside it the note a fallback
// writes. Measured on Home with a Beginner lesson on screen — sections, the longest move list — and with
// the note at its real longest, written through the app's own sentence, on every fixture.
for (const fixture of FIXTURES) {
  test(`cube screen with the method row and its note: ${label(fixture)}`, async () => {
    const { page, context } = await open(fixture, 'home', { devRandCube: true, solveMethod: 'beginner' });
    try {
      // Home's developer die is in the twin, behind a tool in portrait (E5): pressed where it is.
      await page.waitForSelector('#randCube', { state: 'attached' });
      await page.evaluate(() => document.querySelector('#randCube').click());
      await page.waitForFunction(() => document.querySelectorAll('#solList .move-chips').length > 1, null, { timeout: 90_000 });
      // The fallback's sentence, as the walk session words it, shown where the session shows it.
      await page.evaluate(() => {
        const note = document.querySelector('#methodNote');
        note.textContent = 'Beginner could not be worked out for this cube — showing Quick. This choice could not be saved, so it lasts until you leave.';
        note.hidden = false;
      });
      const m = await page.evaluate(`(() => {
        const screen = document.querySelector('.screen.active');
        const row = document.querySelector('#methodRow');
        const pills = [...row.querySelectorAll('[data-method]')].map((el) => {
          const b = el.getBoundingClientRect();
          const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
          return { id: el.dataset.method, width: b.width, height: b.height, pressed: el.getAttribute('aria-pressed'),
            covered: Boolean(hit && hit !== el && !el.contains(hit)) };
        });
        const more = row.querySelector('#moreMethodsBtn');
        if (more) {
          const b = more.getBoundingClientRect();
          const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
          pills.push({ id: 'more', width: b.width, height: b.height, pressed: null, covered: Boolean(hit && hit !== more && !more.contains(hit)) });
        }
        // In portrait the row folds into the pin at the head of the Restore row (E10): its pills are not drawn, and
        // the pin is the one way to the menu.
        const pin = document.querySelector('#methodPin');
        const pinned = Boolean(pin) && getComputedStyle(pin).display !== 'none';
        const pinBox = pinned ? pin.getBoundingClientRect() : null;
        const pinHit = pinned ? document.elementFromPoint(pinBox.left + pinBox.width / 2, pinBox.top + pinBox.height / 2) : null;
        const note = document.querySelector('#methodNote');
        return { visible: !row.hidden && row.getBoundingClientRect().height > 0,
          pills: pills.filter((p) => p.width > 0),
          pin: pinned ? { text: pin.textContent, width: pinBox.width, height: pinBox.height, covered: Boolean(pinHit && pinHit !== pin && !pin.contains(pinHit)) } : null,
          noteShown: note.getBoundingClientRect().height > 0 && getComputedStyle(note).display !== 'none',
          fits: ${contentFits}(screen) };
      })()`);
      // THE NOTE IS SAID IN BOTH COMPOSITIONS (AGENTS.md §3: a method that could not be worked out shows the Quick
      // walk AND SAYS SO). Folding the row in portrait must not fold its sentence away.
      assert.ok(m.noteShown, 'the method note is not on screen — a fallback would be shown without being said');
      if (m.pin) {
        // Portrait: the pin names the method, the row's own pills are gone, and the note keeps a line of its own.
        assert.deepEqual(m.pills, [], 'portrait: the method row\'s pills are drawn beside the pin');
        assert.equal(m.pin.text, 'Beginner', 'portrait: the pin does not name the method on screen');
        m.pills.push({ id: 'pin', width: m.pin.width, height: m.pin.height, pressed: null, covered: m.pin.covered });
      } else {
        assert.ok(m.visible, 'the method row is not on screen over a whole-cube walk');
        // FOUR methods since CFOP (ADR 0011 Phase 7), so the row is the chosen method's pill and a menu.
        assert.deepEqual(m.pills.map((p) => [p.id, p.pressed]), [['beginner', 'true'], ['more', null]]);
      }
      assert.deepEqual(m.fits, { spills: [], cut: [] }, 'with the method row and its note: text that cannot be read where it is drawn — see contentFits');
      for (const p of m.pills) {
        // A finger's floor is 44px (the stylesheet's coarse-pointer rule for every .pill); with a mouse a
        // pill keeps the design system's own pill height, which this row did not change.
        if (fixture.touch) assert.ok(p.height >= 43.5 && p.width >= 43.5, `the ${p.id} pill is ${p.width}×${p.height} — under 44px`);
        else assert.equal(p.covered, false, `the ${p.id} pill is drawn under something else`);
      }
      // THE MENU, OPEN: every method by level, nothing cut — the measurement the ADR's refute pass left
      // unchecked ("the menu's geometry"). Opened from what this composition draws: the row's button, or the pin.
      await page.click(m.pin ? '#methodPin' : '#moreMethodsBtn');
      const menu = await page.evaluate(`(() => {
        const el = document.querySelector('.method-menu');
        const r = el.getBoundingClientRect();
        const items = [...el.querySelectorAll('[data-method]')].map((i) => i.dataset.method);
        const heads = [...el.querySelectorAll('.menu-h')].map((h) => h.textContent);
        const inView = r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1;
        // SHOWN, not merely present: a menu at display:none has a zero box inside the window, keeps its
        // items' text, and leaves contentFits nothing to measure — every line above would pass it.
        const cs = getComputedStyle(el);
        const shown = cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0 && r.width > 0 && r.height > 0;
        const name = (n) => (n ? n.id ? '#' + n.id : n.tagName.toLowerCase() + '.' + String(n.className).trim().replace(/\\s+/g, '.') : 'nothing');
        const fits = ${contentFits}(el);
        // Reachable means pressable once the MENU is scrolled to it (the menu scrolls when the space under
        // its button is short — index.html's popover rule), measured after everything above was read.
        const blocked = [...el.querySelectorAll('[data-method]')].flatMap((i) => {
          i.scrollIntoView({ block: 'nearest' });
          const b = i.getBoundingClientRect();
          const hit = b.width > 0 && b.height > 0 ? document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2) : null;
          return hit && (hit === i || i.contains(hit)) ? [] : [i.dataset.method + ' under ' + name(hit)
            + ' at ' + [b.left, b.top, b.width, b.height].map(Math.round).join(',') + ' in ' + innerWidth + 'x' + innerHeight
            + ', menu ' + [r.left, r.top, r.width, r.height].map(Math.round).join(',')];
        });
        return { items, heads, inView, shown, blocked, fits };
      })()`);
      assert.ok(menu.shown, 'the "More methods" menu is not on screen after its button was pressed');
      assert.deepEqual(menu.blocked, [], 'an item of the open menu cannot be pressed where it is drawn');
      // Every method the registry declares, grouped by level — the registry's list, never a copy that a new
      // method leaves behind (Roux, 2026-10-17, was the first to find one).
      assert.deepEqual(menu.items, LEVELS.flatMap((level) => METHODS.filter((x) => x.level === level).map((x) => x.id)));
      assert.deepEqual(menu.heads, ['First steps', 'Getting faster', 'Competition']);
      assert.ok(menu.inView, 'the open "More methods" menu runs off the window');
      assert.deepEqual(menu.fits, { spills: [], cut: [] }, 'the open menu: text that cannot be read where it is drawn');
    } finally {
      await context.close();
    }
  });
}

const SCANNED_CUBE = 'DDDUURFDURDRRRLBBULLFUFFFLLDUUFDDDLRBBUBLRBULFFLFBRBBR';

// THE RESTORE ROW AFTER A SCAN, which no case above enters: its card is hidden until a cube is read. Seven
// chips since ADR 0009, in a card that may shrink and clip (Codex refute, 2026-10-14) — so every fixture
// completes a scan, waits for every chip to settle, and measures what a child would then see.
for (const fixture of FIXTURES) {
  test(`scan screen with the Restore row after a scan: ${label(fixture)}`, async () => {
    const { page, context } = await open(fixture, 'scan');
    try {
      await page.waitForSelector('#stageCard', { state: 'attached' });
      await page.evaluate((facelets) => {
        document.querySelector('ai-scan-panel').dispatchEvent(new CustomEvent('scan-complete', {
          detail: { facelets, rotations: [0, 0, 0, 0, 0, 0] },
        }));
      }, SCANNED_CUBE);
      await page.waitForFunction(() => document.querySelector('#stageCard')?.hidden === false, null);
      await page.waitForFunction(
        () => [...document.querySelectorAll('.stage-chip .howfar')].every((el) => el.textContent !== '…'),
        null, { timeout: 90_000 },
      );
      const m = await page.evaluate(`(() => {
        const screen = document.querySelector('.screen.active');
        const chips = [...document.querySelectorAll('.stage-chip')].map((c) => {
          const b = c.getBoundingClientRect();
          return { id: c.dataset.target, width: b.width, height: b.height, top: b.top, bottom: b.bottom, left: b.left, right: b.right };
        });
        const row = document.querySelector('#stageChips');
        const rb = row.getBoundingClientRect();
        return {
          chips, vw: innerWidth, fits: ${contentFits}(screen),
          row: { left: rb.left, right: rb.right, scrolls: row.scrollWidth > row.clientWidth + 1, overflowX: getComputedStyle(row).overflowX },
        };
      })()`);
      assert.equal(m.chips.length, 7, 'six stages and the whole cube');
      assert.deepEqual(m.fits, { spills: [], cut: [] }, 'with the Restore row showing: text that cannot be read where it is drawn — see contentFits');
      const least = fixture.touch ? 44 : 40;
      for (const c of m.chips) {
        assert.ok(c.height >= least - 0.5 && c.width >= least - 0.5, `the ${c.id} chip is ${c.width}×${c.height} — under ${least}px`);
      }
      // ONE LINE that scrolls (lib/scroll-strip.js): a chip past the edge is scrolled to, never lost —
      // so the STRIP is what must sit inside the window, and a strip with more than it shows must scroll.
      assert.ok(m.row.left >= -0.5 && m.row.right <= m.vw + 0.5, `the Restore row leaves the window: ${JSON.stringify(m.row)}`);
      if (m.row.scrolls) assert.match(m.row.overflowX, /auto|scroll/, 'a Restore row wider than its card does not scroll — its last chips are unreachable');
    } finally {
      await context.close();
    }
  });
}

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
      assert.deepEqual(m.fits, { spills: [], cut: [] }, 'text that cannot be read where it is drawn — see contentFits');
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
            captured: [], sides: 0, live: null, confirm: null, device: null, complete: false,
            notice: {
              title: 'Some stickers were misread', tone: 'err',
              body: 'At least %1 stickers do not fit a real cube, and with that many the camera cannot tell which. Start the scan over, with more light on the cube and each side held flat to the camera — red and orange are the colours it confuses most. Show one side to the camera to re-read just that side. And a sentence more than any real notice carries, so the card is asked for more than it can ever need.',
              params: [3], action: { label: 'Start over', kind: 'restart' },
            },
          },
        }));
      });
      const long = await measureScan(page);
      assert.deepEqual(long.fits, { spills: [], cut: [] }, 'with a long notice: text that cannot be read where it is drawn — see contentFits');
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
// Timer, Stats, Settings, Shapes: no region contract of their own beyond the
// grid every screen shares, but the same floor — nothing wider than the stage, nothing clipped
// sideways, every control a finger can hit. Stats is seeded with a session: an empty one is a
// single card and would test nothing.

const SCREENS = ['timer', 'stats', 'settings', 'shapes'];

/**
 * Every id the app REGISTERS as a screen, read off the modules that register it.
 *
 * `[...NAV.map(([id]) => id), 'settings']` was what this used, and it is a hand-kept list wearing a
 * derivation's clothes: it finds a new TAB, and it cannot find a new screen that is not a tab —
 * which is how `settings` came to be written in by hand beside it. `shapes` is the second such
 * screen (2026-10-04, reached from the cube screen's Shapes menu rather than from the row), and it
 * would have been measured by nothing here while the guard below went on passing. The registry is
 * `SCREENS.<id> = …` in `lib/screens/*.js`, so that is what is read.
 *
 * Anchored at the start of a line, which is where every registration sits. A match inside a comment
 * or a string would ADD an id and so can only make this stricter; a registration this misses is the
 * failure that matters, and the count assertion below is what refuses to let the list go empty or
 * quietly shrink.
 */
const registeredScreens = () => {
  const dir = new URL('../../lib/screens/', import.meta.url);
  const ids = new Set();
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    for (const m of readFileSync(new URL(name, dir), 'utf8').matchAll(/^SCREENS\.([A-Za-z]\w*)\s*=/gm)) {
      ids.add(m[1]);
    }
  }
  return [...ids];
};

/**
 * Screens measured by a case of their own rather than by the loop below, and why.
 *
 * Named so the guard that follows can tell "covered elsewhere" from "forgotten", which is the whole
 * difference between a list and a relation.
 */
const MEASURED_ELSEWHERE = Object.freeze({
  home: 'the composition and cube-fit cases, which are what the layout contract is about',
  scan: 'its own fixtures — the live face, the board and the sheet each have a case',
  scramble: 'the walking composition, measured with the cube screen it shares',
  practice: 'its two compositions, each at its worst content: the library with its largest set open, and the page for the longest algorithm',
});

test('every screen the app can route to is measured by some case in this file', () => {
  // A HAND-MAINTAINED LIST CANNOT NOTICE A NEW SCREEN. `SCREENS` was exactly that, and when Pieces
  // became a tab of its own (2026-09-29) nothing here would have measured it — the loop would have
  // gone on passing over seven screens while the eighth overflowed on a phone. Assert the RELATION,
  // never the list: whatever the app can route to, this file measures or names as measured elsewhere.
  //
  // THE RELATION IS THE REGISTRY, not the tab row. Deriving it from `NAV` was half a derivation:
  // it noticed a new tab and could not notice a new screen, which is why `settings` sat beside it
  // as a literal — one hand-kept entry is all it takes for the next one to look normal.
  const routable = registeredScreens();
  // The guard's own floor. A regex that stopped matching would answer an empty list and every
  // assertion below would pass over nothing — the silent pass this file's own comments keep warning
  // about. Every tab must be in there too, which is the independent cross-check: `NAV` and the
  // registry are written in different files for different reasons.
  assert.ok(routable.length >= SCREENS.length, `the registry scan found only ${routable.length} screens`);
  for (const [id] of NAV) {
    assert.ok(routable.includes(id), `the ${id} tab is not in the screen registry the scan read`);
  }
  const missing = routable.filter((id) => !SCREENS.includes(id) && !Object.hasOwn(MEASURED_ELSEWHERE, id));
  assert.deepEqual(missing, [], 'a routable screen no geometry case measures');
  // And the other direction, so a deleted screen does not leave a case navigating to nothing.
  const stale = SCREENS.filter((id) => !routable.includes(id));
  assert.deepEqual(stale, [], 'this file measures a screen the app cannot route to');
});
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
      fits: ${contentFits}(screen),
      // THE VERTICAL HALF, which nothing here measured until 2026-10-04. The screen's root must fit
      // the screen's own box: beyond it the stage CLIPS (\`overflow: hidden\`), and whatever is past
      // the fold cannot be scrolled to because no ancestor scrolls either. Found on the new Shapes
      // screen — at 430x932 its root was 2019px inside an 805px screen and twelve of twenty
      // pictures were unreachable — and the whole browser tier passed, because \`beyond\` above reads
      // LEFT and RIGHT only and \`overflow.doc\` is a width.
      //
      // The ROOT and not its descendants, which is what makes this safe for a scrolling grid: a
      // \`.case-grid\` may draw cards below the fold ON PURPOSE, because it scrolls. Those are
      // reachable. A root taller than its screen is the case where nothing is.
      rootOverflowsDown: Math.round(rect(root).bottom - rect(screen).bottom),
      // And the scroll the content needs is somewhere INSIDE the root, so "it fits" cannot be
      // bought by clipping: a root that fits with content past its own bottom and nothing
      // scrollable between is the same failure wearing a passing number.
      scrollableInside: [...screen.querySelectorAll('*')]
        .some((el) => el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(el).overflowY)),
      rootContentOverflows: root.scrollHeight > root.clientHeight + 1,
      // Anything drawn beyond the stage sideways — including inside a scrolling column, where it
      // would be clipped rather than seen. The one exception is the app's one-line strip WHILE it says it
      // scrolls (lib/scroll-strip.js: \`more-left\` / \`more-right\`, its edge fade): portrait's move strip holds
      // the turns past its edges by design (dev-docs/practice-redesign-plan.md §5.7), and the fade is what
      // says they are there. A strip with no fade, or anything outside one, still counts. The exemption is for what a
      // strip SCROLLS, and a chip half under the fade reads as "more this way"; a text LABEL there does not, and is held
      // by contentFits instead — wholly inside the unfaded box or wholly outside the strip (strip-labels.mjs).
      beyond: [...screen.querySelectorAll('*')].filter(visible).filter((el) => !el.parentElement?.closest('.more-left, .more-right')).map((el) => ({ what: el.id || el.className || el.tagName, ...rect(el) })).filter((r) => r.left < s.left - 1 || r.right > s.right + 1).slice(0, 4),
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
      const { page, context, errors } = await openAt(fixture, urlFor(fixture, screen), (context) =>
        context.addInitScript((session) => localStorage.setItem('cubusSolves', session), SESSION),
      );
      try {
        await page.waitForSelector('.screen.active');
        const m = await measureScreen(page);
        assert.deepEqual(errors.map(String), [], 'the page threw');
        assert.ok(m.overflow.doc <= 0, `the page overflows the viewport by ${m.overflow.doc}px`);
        assert.ok(m.overflow.screen <= 1, `the screen overflows sideways by ${m.overflow.screen}px`);
        assert.deepEqual(m.beyond, [], 'drawn beyond the stage');
        assert.deepEqual(m.collapsed, [], 'a control on the page has no box — squashed by its column');
        assert.deepEqual(m.fits, { spills: [], cut: [] }, 'text that cannot be read where it is drawn — see contentFits');
        assert.ok(m.root.width >= m.content * 0.9, `the screen's root is ${m.root.width}px wide in a ${m.content}px stage — it shrank to its content`);
        // DOWNWARDS TOO. The stage clips, and nothing above it scrolls, so a root taller than its
        // screen puts content where no gesture can reach it — see `rootOverflowsDown`, added after
        // the Shapes screen shipped twelve of twenty pictures below an unreachable fold and this
        // whole file passed. A screen whose CONTENT is taller must put the scroll inside itself.
        assert.ok(m.rootOverflowsDown <= 1,
          `${screen}: the root hangs ${m.rootOverflowsDown}px below the screen, where the stage clips it and nothing scrolls`);
        if (m.rootContentOverflows) {
          assert.ok(m.scrollableInside,
            `${screen}: the root's content is taller than the root and nothing inside it scrolls — that content cannot be reached`);
        }
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

// ---- Practice: two compositions on one route, each measured at the content that stresses it ----------------
//
// The route alone shows the LIBRARY with every set closed — a list of headings, which tests nothing. So each
// case chooses its content by what it holds, never the first one listed: the set with the most cards, opened,
// and the page for the row with the most turns (the most chips, the widest chunk names). Both wait for the
// library worker's answer (`data-ready`), because before it the screen is one line of text.

/** The Practice page as the cases below read it: its regions, the strip, the beads, the line and the note. */
const measurePractice = (page) =>
  page.evaluate(`(() => {
    const rect = ${rect.toString()};
    const px = (v) => Number.parseFloat(v);
    const $ = (s) => document.querySelector(s);
    const stage = $('#stage');
    const scs = getComputedStyle(stage);
    const shown = (el) => Boolean(el) && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
    const l = $('#practiceAlg');
    const ls = getComputedStyle(l);
    const lb = l.getBoundingClientRect();
    const all = [...l.querySelectorAll('.chip-m')];
    const cur = l.querySelector('.chip-m.cur');
    const mid = (b) => { const r = b.getBoundingClientRect(); return Math.round(r.top + r.height / 2); };
    const line = $('#practiceLine');
    const lineH = px(getComputedStyle(line).lineHeight);
    const say = $('#practiceSay');
    const sayBox = say.getBoundingClientRect();
    const modes = $('.practice-modes');
    return {
      content: { w: stage.clientWidth - px(scs.paddingLeft) - px(scs.paddingRight), h: stage.clientHeight - px(scs.paddingTop) - px(scs.paddingBottom) },
      stage: rect(stage), cols: rect($('.practice-page')), primary: rect($('.practice-page > .primary')), aux: rect($('.practice-page > .aux')),
      state: rect($('.practice-twin')), sheet: rect($('.practice-page .solution-card')), score: rect($('.practice-score')),
      said: rect($('.practice-said')), line: rect(line), note: rect($('#followNote')),
      lineShown: shown(line), noteShown: shown($('#followNote')),
      lineLines: shown(line) ? Math.round(line.getBoundingClientRect().height / lineH) : 0,
      beads: [...document.querySelectorAll('#practiceFingers .bead')].map((b) => rect(b)),
      modes: rect(modes), modesIn: modes.closest('#practiceInfo') ? 'book' : modes.closest('.practice-twin') ? 'twin' : 'nowhere',
      sayDrawn: sayBox.width > 1 || sayBox.height > 1 || getComputedStyle(say).clipPath === 'none',
      // A case picture anywhere on the screen but the book: an svg that is not an icon, or an image.
      picturesOutside: [...document.querySelectorAll('.screen.active svg:not(.ic), .screen.active img')].filter((el) => !el.closest('#practiceInfo') && !el.closest('.ic')).length,
      painted: (${paintedSize.toString()})('#practiceCube canvas'),
      fits: ${contentFits}(document.querySelector('.screen.active')),
      strip: {
        lines: new Set(all.map(mid)).size, scrollW: l.scrollWidth, clientW: l.clientWidth, moreRight: l.classList.contains('more-right'),
        gutter: l.offsetHeight - l.clientHeight - px(ls.borderTopWidth) - px(ls.borderBottomWidth), bar: ls.scrollbarWidth,
        curOff: cur ? (cur.getBoundingClientRect().left + cur.getBoundingClientRect().width / 2) - (lb.left + l.clientLeft + l.clientWidth / 2) : null,
        curW: cur ? cur.getBoundingClientRect().width : null,
        otherW: Math.max(...all.filter((c) => c !== cur).map((c) => c.getBoundingClientRect().width)),
      },
    };
  })()`);

/**
 * THE PICTURE MEASURED IS ONE THE RENDERER DREW AFTER THE CUBE'S LAST CHANGE. "The canvas painted" is no wait once the
 * cube has a picture: the armed cube was read while the canvas still held the demo's frame, which drew no arrow, and
 * the "same size" comparison compared two different pictures. And "a frame after now" is no wait either: a frame never
 * comes once the cube has nothing left to draw — off the algorithm, the picture can be drawn inside the cue window,
 * before the state the case waits for. So the page records the renderer's frame counter (`renderer.info.render.frame`,
 * as camera-up.test.mjs counts it) at every change the cube is given — an attribute whose VALUE changed, or a turn
 * landing (`cubus-step`) — and a measurement waits for a frame drawn after the last of them. Only the attributes that
 * change the picture: a tempo is drawn by no frame of its own.
 */
async function watchPracticeCube(page) {
  await page.evaluate(() => {
    const cube = document.querySelector('#practiceCube cubus-cube');
    const frame = () => cube.renderer.info.render.frame;
    window.__cubeChangedAt = frame();
    new MutationObserver((list) => {
      if (list.some((m) => m.oldValue !== cube.getAttribute(m.attributeName))) window.__cubeChangedAt = frame();
    }).observe(cube, { attributeFilter: ['facelets', 'alg', 'orientation', 'arrow'], attributeOldValue: true });
    cube.addEventListener('cubus-step', () => { window.__cubeChangedAt = frame(); });
  });
}
const practiceFrameAfter = (page) => page.waitForFunction(
  () => document.querySelector('#practiceCube cubus-cube').renderer.info.render.frame > window.__cubeChangedAt);

/** What holds on the page in every state: the plan's WI-5 gates that are not about the composition's shape. */
function practicePageCommon(m, what) {
  assert.deepEqual(m.fits, { spills: [], cut: [] }, `${what}: text that cannot be read where it is drawn — see contentFits`);
  // Big beads, the primary progress (E4).
  assert.ok(m.beads.length > 0, `${what}: no beads`);
  for (const b of m.beads) assert.ok(b.width >= 28 - 0.5 && b.height >= 28 - 0.5, `${what}: a bead is ${b.width}×${b.height}`);
  // The quiet line: at most two lines (E6), never cut (contentFits, above).
  if (m.lineShown) assert.ok(m.lineLines >= 1 && m.lineLines <= 2, `${what}: the quiet line is ${m.lineLines} lines`);
  // No two regions overlap: a twin pushed under the transport passed contentFits in the mockup until this was added.
  const regions = { primary: m.primary, sheet: m.sheet, twin: m.state, aux: m.aux };
  const names = Object.keys(regions);
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    assert.ok(!overlaps(regions[names[i]], regions[names[j]]), `${what}: the ${names[i]} and the ${names[j]} overlap`);
  }
  // The transport is on screen.
  assert.ok(m.aux.bottom <= m.stage.bottom + 1, `${what}: the transport is off the stage by ${m.aux.bottom - m.stage.bottom}px`);
  // MUST NOT: a case picture outside the book, or the screen reader's sentences drawn (E11.3).
  assert.equal(m.picturesOutside, 0, `${what}: a case picture outside the book`);
  assert.equal(m.sayDrawn, false, `${what}: the screen reader's live region is drawn`);
}

/** The floor every screen shares, asked of the active screen's measurement. */
function practiceFloor(m, fixture, what) {
  assert.ok(m.overflow.doc <= 0, `${what}: the page overflows the viewport by ${m.overflow.doc}px`);
  assert.ok(m.overflow.screen <= 1, `${what}: the screen overflows sideways by ${m.overflow.screen}px`);
  assert.deepEqual(m.beyond, [], `${what}: drawn beyond the stage`);
  assert.deepEqual(m.collapsed, [], `${what}: a control on the page has no box`);
  assert.deepEqual(m.fits, { spills: [], cut: [] }, `${what}: text that cannot be read where it is drawn — see contentFits`);
  assert.ok(m.rootOverflowsDown <= 1, `${what}: the root hangs ${m.rootOverflowsDown}px below the screen`);
  if (m.rootContentOverflows) assert.ok(m.scrollableInside, `${what}: content taller than the root and nothing scrolls`);
  if (m.col && m.aside) assert.ok(!overlaps(m.col, m.aside), `${what}: the sheet draws over the column`);
  if (fixture.touch) {
    assert.deepEqual(m.controls.filter((c) => c.width < 44 - 0.5 || c.height < 44 - 0.5), [], `${what}: touch controls under 44px`);
    for (const t of m.toggles) assert.ok(t.above && t.below, `${what}: a toggle's hit area does not reach 44px`);
  }
}

/**
 * Put the library on `key`'s method — the library's own choice, drawn again as a choice is — and bring the grid
 * holding `set` (or the stage numbered `stage`) into the body's view, waiting until its tiles are built and its
 * photographs have landed: a tile is measured with its picture in place, not the empty well before it.
 */
async function libraryShowing(page, { key, stage = null, set = null }) {
  await page.evaluate(async (k) => {
    const { settings } = await import('/lib/app-settings.js');
    const { refreshScreen } = await import('/lib/screen-shell.js');
    if (document.querySelector('.practice-screen')?.dataset.method === k) return;
    settings.practiceMethod = k;
    refreshScreen();
  }, key);
  await page.waitForSelector(`.practice-screen[data-ready="1"][data-method="${key}"]`);
  const scope = set ? `#practiceList .tiles[data-set="${set}"]` : `#practiceList .stage-sec[data-sec="${stage}"] .tiles`;
  // Every grid of the stage scrolled through, so each comes near the view and is drawn; then the stage's top.
  await page.evaluate(async (sel) => {
    for (const grid of document.querySelectorAll(sel)) {
      grid.scrollIntoView({ block: 'start' });
      await new Promise((r) => { requestAnimationFrame(() => requestAnimationFrame(r)); });
    }
    document.querySelector(sel).closest('.stage-sec').scrollIntoView({ block: 'start' });
  }, scope);
  await page.waitForFunction((sel) => [...document.querySelectorAll(sel)].every((g) => g.childElementCount > 0)
    && !document.querySelector(`${sel} .case-photo[data-photo="pending"]`), scope);
  return scope;
}

/** The share of a tile's width the painted cube in its photograph must reach (dev-docs/practice-redesign-plan.md E9). */
const CUBE_FILLS = 0.75;

/**
 * Every photographed tile in `scope`: the PAINTED cube's box on the page — the photograph's own non-transparent pixels,
 * placed where `object-fit: contain` draws them — its share of the tile's width, and the ring's box. Read off the
 * pixels, never off the well: a well the width of the tile says nothing about how much of it the cube paints.
 */
const photographedCubes = (page, scope) => page.evaluate(async (sel) => {
  const box = (b) => ({ left: b.left, top: b.top, right: b.right, bottom: b.bottom });
  const out = [];
  for (const tile of document.querySelectorAll(`${sel} [data-alg]`)) {
    const img = tile.querySelector('.case-photo[data-photo="shown"] > img');
    if (!img) continue;
    await img.decode();
    const w = img.naturalWidth; const h = img.naturalHeight;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, w, h).data;
    let x0 = w; let y0 = h; let x1 = -1; let y1 = -1;
    for (let i = 3; i < px.length; i += 4) {
      if (px[i] <= 8) continue;
      const p = (i - 3) / 4; const x = p % w; const y = (p - x) / w;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const r = img.getBoundingClientRect();
    const k = Math.min(r.width / w, r.height / h);
    const ox = r.left + (r.width - w * k) / 2; const oy = r.top + (r.height - h * k) / 2;
    const cube = { left: ox + x0 * k, top: oy + y0 * k, right: ox + (x1 + 1) * k, bottom: oy + (y1 + 1) * k };
    const t = tile.getBoundingClientRect();
    const ring = tile.querySelector('.badge svg');
    out.push({ id: tile.dataset.alg, cube, share: (cube.right - cube.left) / t.width, ring: ring ? box(ring.getBoundingClientRect()) : null });
  }
  return out;
}, scope);

for (const fixture of FIXTURES) {
  test(`practice library, largest stage drawn: ${label(fixture)}`, async () => {
    const { page, context, errors } = await openAt(fixture, urlFor(fixture, 'practice'));
    try {
      await page.waitForSelector('.practice-screen[data-ready="1"]');
      // Chosen by what the catalogue holds: the stage with the most rows, over every method the library offers.
      const largest = await page.evaluate(async () => {
        const { library } = await import('/lib/drill/library-client.js');
        const { libraryKey, stageIds } = await import('/lib/screens/practice/library-view.js');
        const c = await library.catalogue();
        let best = null;
        for (const g of c.groups) {
          g.phases.forEach((p, i) => {
            const n = stageIds(c, p).length;
            if (!best || n > best.n) best = { key: libraryKey(g), stage: i, n, name: p.phase ?? '(tables)' };
          });
        }
        return best;
      });
      const scope = await libraryShowing(page, largest);
      const drawn = {
        tiles: await page.evaluate((sel) => document.querySelectorAll(`${sel} [data-alg]`).length, scope),
        photos: await page.evaluate((sel) => document.querySelectorAll(`${sel} .case-photo[data-photo="shown"] > img`).length, scope),
      };
      assert.equal(drawn.tiles, largest.n, `the largest stage (${largest.key}/${largest.name}) drew ${drawn.tiles} of its ${largest.n} tiles`);
      assert.ok(drawn.photos > 0, `the largest stage (${largest.key}/${largest.name}) shows no photograph, so this measures none`);
      practiceFloor(await measureScreen(page), fixture, `library (${largest.key}/${largest.name}, ${drawn.tiles} tiles, ${drawn.photos} photographs)`);
      // E9: the cube fills its tile, and the ring stays off it.
      const fill = await photographedCubes(page, scope);
      assert.equal(fill.length, drawn.photos, 'precondition: every photograph measured');
      assert.deepEqual(fill.filter((c) => !c.ring), [], 'precondition: every tile carries its ring once the record is read');
      const small = fill.filter((c) => c.share < CUBE_FILLS);
      assert.deepEqual(small.map((c) => `${c.id} ${(100 * c.share).toFixed(1)}%`), [],
        `the painted cube is under ${100 * CUBE_FILLS}% of its tile's width`);
      assert.deepEqual(fill.filter((c) => overlaps(c.ring, c.cube)).map((c) => c.id), [], 'the progress ring draws over the cube');
      // The rail is one line in portrait — a strip, never a second row — and its stages are all reachable.
      const rail = await page.evaluate(() => {
        const items = [...document.querySelectorAll('.rail [data-jump]')];
        return { rows: new Set(items.map((i) => Math.round(i.getBoundingClientRect().top) + 0)).size, n: items.length };
      });
      if (fixture.width < fixture.height) assert.equal(rail.rows, 1, `portrait: the rail wraps to ${rail.rows} rows`);
      assert.deepEqual(errors.map(String), [], 'the page threw');
    } finally {
      await context.close();
    }
  });

  test(`practice page, longest algorithm: ${label(fixture)}`, async (t) => {
    const { page, context, errors } = await openAt(fixture, urlFor(fixture, 'practice'));
    try {
      await page.waitForSelector('.practice-screen[data-ready="1"]');
      // A grid's tiles are drawn when it comes near the view, so the grid holding the longest row is brought there.
      const { id, key, set } = await page.evaluate(async () => {
        const { library } = await import('/lib/drill/library-client.js');
        const { libraryKey } = await import('/lib/screens/practice/library-view.js');
        const catalogue = await library.catalogue();
        const longest = Object.values(catalogue.rows).reduce((a, b) => (b.alg.split(/\s+/).length > a.alg.split(/\s+/).length ? b : a));
        const g = catalogue.groups.find((x) => x.phases.some((p) => p.sets.includes(longest.set)));
        return { id: longest.id, key: libraryKey(g), set: longest.set };
      });
      await libraryShowing(page, { key, set });
      await page.waitForSelector(`[data-alg="${id}"]`, { state: 'attached' });
      await page.evaluate((x) => document.querySelector(`[data-alg="${x}"]`).click(), id);
      // Measured once the record has been read: what the page holds then, not the dashes of a read still pending.
      await page.waitForFunction((x) => document.querySelector('.practice-page')?.dataset.ready === '1'
        && document.querySelector('.practice-page')?.dataset.alg === x
        && document.querySelector('.practice-page')?.dataset.record === 'read', id);
      await cubePainted(page, '#practiceCube canvas');
      // MID-REP, with no cube: one move along, so a turn is current and the strip has something to centre.
      await watchPracticeCube(page);
      await page.click('#demoNext');
      await page.waitForSelector('#practiceAlg .chip-m.cur');
      await practiceFrameAfter(page);
      practiceFloor(await measureScreen(page), fixture, `page (${id})`);
      // A card whose content is taller than it and does not scroll draws that content over its neighbour —
      // the case card's sentences did, over the sheet, in the portrait window. contentFits cannot see it: every
      // text box is the size of its text, and the card clips nothing.
      const overrun = await page.evaluate(() => [...document.querySelectorAll('.screen.active .card')]
        .filter((c) => c.scrollHeight > c.clientHeight + 1 && !/auto|scroll|hidden/.test(getComputedStyle(c).overflowY))
        .map((c) => `${c.id || c.className}: ${c.scrollHeight}px in ${c.clientHeight}px`));
      assert.deepEqual(overrun, [], `page (${id}): a card's content runs out of it`);

      const m = await measurePractice(page);
      const portrait = m.content.h > m.content.w;
      const what = `page (${id}), no cube`;
      practicePageCommon(m, what);
      if (portrait) {
        // THE PORTRAIT WALKING COMPOSITION (§5.7), shared with the cube screen: the cube card the stage's full width at
        // the top, square where the stage has the height; the moves ONE line directly under it, the turn you are on at
        // its centre and larger; the transport at the foot, on screen.
        near(m.primary.width, m.content.w, `${what}: the cube card is the stage's full width`);
        near(m.primary.top, m.cols.top, `${what}: the cube card is at the top`);
        if (m.primary.height >= m.primary.width - 1) near(m.primary.height, m.primary.width, `${what}: the cube card is square where the stage has the height`);
        assert.ok(m.sheet.top >= m.primary.bottom - 1 && m.sheet.top <= m.primary.bottom + 11, `${what}: the moves are not directly under the cube (${m.sheet.top - m.primary.bottom}px)`);
        assert.equal(m.strip.lines, 1, `${what}: the moves wrap to ${m.strip.lines} lines`);
        assert.ok(m.strip.moreRight, `${what}: the strip has more on the right and does not fade it`);
        assert.equal(m.strip.gutter, 0, `${what}: a scrollbar takes ${m.strip.gutter}px under the strip`);
        assert.equal(m.strip.bar, 'none', `${what}: the strip draws a scrollbar`);
        assert.ok(m.strip.curOff !== null && Math.abs(m.strip.curOff) <= 2, `${what}: the current turn is ${m.strip.curOff}px from the strip's centre`);
        assert.ok(m.strip.curW > m.strip.otherW + 1, `${what}: the current turn (${m.strip.curW}px) is not larger than the others (${m.strip.otherW}px)`);
        // E11.6: the modes' row is behind the book in portrait, never in the twin.
        assert.equal(m.modesIn, 'book', `${what}: the modes' row is in the ${m.modesIn}, not behind the book`);
        // MUST NOT: a cube smaller than the page this one replaced (E11.5, E11.9).
        const floor = cubeFloor('practice-none', fixture);
        assert.ok(m.painted >= floor, `${what}: the painted cube is ${m.painted.toFixed(1)}px — under its floor of ${floor}px`);
        await gapsHold(page, t, what);
        // The reserved slots the gate measures by their box are on this page, every one: the list can never cover nothing.
        const slots = await page.evaluate((list) => list.map((s) => ({ ...s, laid: [...document.querySelectorAll(s.selector)].filter((el) => !el.closest('[hidden]') && el.getClientRects().length > 0).length })), RESERVED_SLOTS);
        assert.ok(slots.length > 0, 'RESERVED_SLOTS is empty');
        for (const s of slots) assert.ok(s.laid > 0, `${what}: RESERVED_SLOTS names ${s.name} (${s.selector}), and nothing on the page is it`);
      } else {
        // Landscape is the cube screen's: the moves WRAP in the sheet beside the cube, and the modes sit under the line.
        assert.ok(m.strip.lines > 1, `${what}: the moves are one line — landscape wraps them`);
        assert.ok(m.strip.scrollW <= m.strip.clientW + 1, `${what}: the moves scroll sideways`);
        assert.equal(m.modesIn, 'twin', `${what}: the modes' row is not under the quiet line`);
        assert.ok(m.modes.top >= m.said.bottom - 1, `${what}: the modes' row is not under the quiet line`);
        assert.ok(m.state.left >= m.primary.right - 1, `${what}: the twin is not beside the cube`);
      }

      // EVERY TURN OF THE WALK, so the strip stands at every scroll position the walk puts it at: a trigger's name is
      // never drawn half under the fade (contentFits, strip-labels.mjs), and it is drawn while the turn you are on is in
      // its part — at the part's first turn, its middle and its last. Found as "ve" for "Sexy move" (WI-5 audit).
      const walked = await page.evaluate(`(async () => {
        const cube = document.querySelector('#practiceCube cubus-cube');
        const n = document.querySelectorAll('#practiceAlg .chip-m').length;
        const out = [];
        for (let k = 1; k <= n; k++) {
          cube.seek(k);
          const cur = document.querySelector('#practiceAlg .chip-m.cur');
          const sec = cur?.closest('.walk-sec');
          const label = sec?.querySelector(':scope > .walk-sec-l');
          out.push({ k, cur: cur ? Number(cur.dataset.k) : null, from: sec ? Number(sec.dataset.from) : null, to: sec ? Number(sec.dataset.to) : null,
            label: label ? label.textContent : null, labelDrawn: label ? getComputedStyle(label).visibility !== 'hidden' : null,
            fits: (${contentFits})(document.querySelector('.screen.active')) });
        }
        cube.seek(1);
        return out;
      })()`);
      assert.ok(walked.length >= 21, `precondition: ${id} walked ${walked.length} turns`);
      for (const w of walked) {
        assert.equal(w.cur, w.k - 1, `precondition: at turn ${w.k} the current chip is ${w.cur}`);
        assert.deepEqual(w.fits, { spills: [], cut: [] }, `${what}, turn ${w.k}: text that cannot be read where it is drawn — see contentFits`);
      }
      const inPart = walked.filter((w) => w.label);
      assert.ok(inPart.length > 0, `precondition: ${id} has a trigger part, so a label is measured`);
      const { from, to } = inPart[0];
      const named = new Map(inPart.map((w) => [w.cur, w]));
      for (const [where, at] of [['first', from], ['middle', Math.floor((from + to - 1) / 2)], ['last', to - 1]]) {
        assert.ok(named.has(at), `precondition: the walk stood on the part's ${where} turn (${at})`);
        assert.equal(named.get(at).labelDrawn, true, `${what}: "${named.get(at).label}" is not drawn while its part's ${where} turn is the one you are on`);
      }
      await practiceFrameAfter(page);

      // THE BOOK: the case picture and every sentence, there and nowhere else, readable where it is drawn.
      await page.click('#practiceBook');
      const book = await page.evaluate(`(() => {
        const rect = ${rect.toString()};
        const menu = document.querySelector('#practiceInfo');
        return { shown: !menu.hidden && menu.getBoundingClientRect().height > 0, menu: rect(menu), stage: rect(document.getElementById('stage')),
          pic: menu.querySelectorAll('#practicePic svg, #practicePic img').length, modes: Boolean(menu.querySelector('.practice-modes')),
          fits: ${contentFits}(document.querySelector('.screen.active')) };
      })()`);
      assert.ok(book.shown, `${what}: the book did not open`);
      assert.ok(inside(book.menu, book.stage), `${what}: the book ${JSON.stringify(book.menu)} leaves the stage`);
      assert.equal(book.pic, 1, `${what}: the book does not hold the case picture`);
      assert.equal(book.modes, portrait, `${what}: the modes' row is ${book.modes ? '' : 'not '}in the book`);
      assert.deepEqual(book.fits, { spills: [], cut: [] }, `${what}, book open: text that cannot be read where it is drawn`);
      await page.click('#practiceBook');

      // WITH A SMART CUBE, armed and then off the algorithm: the follow-note takes the quiet line's place, and the cube
      // keeps its size (WI-5). pll-Na opens with a clockwise turn in every hold, so a counter-clockwise one is off.
      await page.evaluate(() => {
        window.cubusFeed.useConnection({ mac: 'AA:BB:CC:DD:EE:01', name: 'Test cube', requestBattery: async () => 80, disconnect: async () => {},
          mayFollow: () => true, numbersMoves: () => true, evidence: { moveReports: 0 } });
        window.cubusFeed.facelets('UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB', 1);
      });
      await page.waitForFunction(() => document.querySelector('.practice-page').dataset.mode === 'cube'
        && document.querySelector('.practice-page').dataset.status === 'armed');
      await practiceFrameAfter(page);
      const armed = await measurePractice(page);
      practicePageCommon(armed, `page (${id}), armed`);
      assert.equal(armed.noteShown, false, 'armed: the follow-note shows with nothing to be done');
      // E11.8: the beads row is the same height with a cube and without.
      near(armed.score.height, m.score.height, 'the beads row changes height with a cube');
      if (portrait) {
        const floor = cubeFloor('practice-cube', fixture);
        assert.ok(armed.painted >= floor, `armed: the painted cube is ${armed.painted.toFixed(1)}px — under its floor of ${floor}px`);
        await gapsHold(page, t, `page (${id}), armed`);
      }
      await page.evaluate(() => window.cubusFeed.move({ notation: "R'", timestamp: 2000, cubeTimestamp: 2000, serial: 2 }));
      await page.waitForFunction(() => document.querySelector('.practice-page').dataset.status === 'off');
      await page.waitForFunction(() => !document.querySelector('#followNote').hidden);
      await practiceFrameAfter(page);
      const off = await measurePractice(page);
      practicePageCommon(off, `page (${id}), off the algorithm`);
      // E11.3: the note is IN the line's place — the line is not drawn, the note stands where it stood.
      assert.ok(off.noteShown && !off.lineShown, 'off: the follow-note does not replace the quiet line');
      near(off.note.top, armed.line.top, 'off: the follow-note is not where the quiet line was');
      // MUST NOT: the cube changing size between armed and off the algorithm.
      for (const k of ['top', 'left', 'width', 'height']) near(off.primary[k], armed.primary[k], `off the algorithm: the cube card's ${k} moved`);
      near(off.painted, armed.painted, 'off the algorithm: the painted cube changed size');
      near(off.score.height, m.score.height, 'off: the beads row changes height');
      // TWO MESSAGES AT ONCE (E12.3): the record's notice is in the foot band in portrait — its own row in landscape —
      // and the quiet line's slot holds only the follow-note, so they never stack and the cube keeps its size.
      await page.evaluate(() => { const r = document.querySelector('#practiceRecordSay'); r.textContent = 'That rep was not saved: quota exceeded (test)'; r.hidden = false; });
      await page.evaluate(() => new Promise((r) => { requestAnimationFrame(() => requestAnimationFrame(r)); }));
      const both = await measurePractice(page);
      practicePageCommon(both, `page (${id}), off with the record's notice`);
      const notice = await page.evaluate(`(() => {
        const rect = ${rect.toString()};
        const r = document.querySelector('#practiceRecordSay');
        return { box: rect(r), inNote: Boolean(r.closest('#followNote')), inBand: Boolean(r.closest('.foot-band')), inTwin: Boolean(r.closest('.practice-twin')), stage: rect(document.getElementById('stage')) };
      })()`);
      assert.ok(both.noteShown, 'off with the record\'s notice: the follow-note is not on screen');
      assert.ok(notice.box.height > 0 && inside(notice.box, notice.stage), 'off with the record\'s notice: the notice is not on screen');
      assert.equal(notice.inNote, false, 'the record\'s notice is in the follow-note\'s slot — the two stack');
      near(both.painted, armed.painted, 'off with the record\'s notice: the painted cube changed size');
      for (const k of ['top', 'height']) near(both.primary[k], armed.primary[k], `off with the record's notice: the cube card's ${k} moved`);
      if (portrait) {
        bandHolds(await measureBand(page, '#practiceCube cubus-cube'), `page (${id}), the record's notice in the band`);
        // The record's two fixed sentences, each alone and both at once: the longest the band holds here (E12.8).
        const e = await bandEnumeration(page);
        assert.equal(e.record.length, 2, 'precondition: the record has two fixed sentences');
        const bareRecord = { card: both.primary, painted: armed.painted };
        await bandHoldsEvery(page, '#practiceCube cubus-cube', bareRecord, [...e.record, e.record.join(' ')],
          (text) => { const r = document.querySelector('#practiceRecordSay'); r.textContent = text; r.hidden = false; }, `page (${id}), the record's band`);
      }
      else assert.ok(notice.inTwin && !notice.inBand, 'landscape: the record\'s notice is not its own row in the twin');
      assert.deepEqual(errors.map(String), [], 'the page threw');
    } finally {
      await context.close();
    }
  });
}

// ---- Settings: the "in the fingers" stepper, in both places it can be drawn ---------------------------------
//
// With the Practice tab shown the stepper is a card of its own; with the tab hidden (the default, ADR 0010) it sits
// in Advanced (lib/screens/settings/practice-target.js). The screen loop above measures Settings as a fresh install
// draws it — Practice hidden, Advanced closed — where the stepper is in NEITHER place, so neither was measured.

const STEPPER_PLACES = [
  { where: 'Practice shown, its own card', settings: { navHidden: [], navDefaults: NAV_DEFAULTS_VERSION }, card: 'PRACTICE' },
  { where: 'Practice hidden, in Advanced', settings: null, card: 'ADVANCED' },
];

for (const place of STEPPER_PLACES) {
  for (const fixture of FIXTURES) {
    test(`settings stepper (${place.where}): ${label(fixture)}`, async () => {
      const { page, context, errors } = await open(fixture, 'settings', place.settings);
      try {
        if (place.card === 'ADVANCED') {
          // The developer chord, as a keyboard sends it: Advanced opens on the Settings screen it is pressed on.
          await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', ctrlKey: true, altKey: true, metaKey: true })));
        }
        await page.waitForSelector('#setFingers-more');
        const drawn = await page.evaluate(() => ({
          count: ['setFingers-less', 'fingersN', 'setFingers-more'].map((id) => document.querySelectorAll(`#${id}`).length),
          card: document.querySelector('#fingersN').closest('.card')?.querySelector('.eyebrow')?.textContent,
        }));
        assert.deepEqual(drawn.count, [1, 1, 1], 'not exactly one stepper on the screen');
        assert.equal(drawn.card, place.card, `the stepper is in the ${drawn.card} card`);
        practiceFloor(await measureScreen(page), fixture, `settings, stepper ${place.where}`);
        // And it works where it is drawn: one press up is one more clean rep.
        const before = Number(await page.evaluate(() => document.querySelector('#fingersN').textContent));
        await page.click('#setFingers-more');
        await page.waitForFunction((n) => document.querySelector('#fingersN')?.textContent === String(n), before + 1);
        assert.deepEqual(errors.map(String), [], 'the page threw');
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
