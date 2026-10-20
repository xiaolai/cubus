// ONE FOCUS RING THE APP OWNS, measured by the pixels it draws (sweep 2026-10-20, E7, S7).
//
// The app had no focus style of its own, so every engine drew its default: WebKit's translucent blue ring reached at
// best 2.16–2.63:1 against what it was drawn over, on every stop the sweep focused, and Chromium drew no pixel at 3:1
// round a pressed pill and no visible ring at all round `#scanHow`, a scroller the engine makes focusable. A CSS test
// can only say a rule exists; this says what the engine drew.
//
// For every stop the keyboard reaches on each screen, in both desktop windows — WebKit by Option+Tab on macOS, which is how
// macOS reaches a button, and by Tab elsewhere, Chromium by Tab — in every theme: the frame with the ring against the same frame with `outline: none`. The pixels that
// changed are the ring; those at 3:1 or more against the pixels they replace must add up to at least the control's own
// perimeter (a ring one pixel thick all the way round — the rule draws two), and the ring the engine computes is the
// app's: at least 2 CSS px, drawn OUTSIDE the control, so it is never only a contrast with the control's own fill.
// MUST NOT: a stop that is focus-visible and draws no such ring.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { decodePng } from '../png.mjs';
import { LIVENESS_MS, startBrowserFixture } from './harness.mjs';

const THEMES = ['white', 'cream', 'night'];
/** The desktop windows of the layout contract, one per composition: the walking screens draw different controls in each. */
const VIEWPORTS = [{ width: 840, height: 682 }, { width: 574, height: 817 }];
const ROUTES = ['home', 'scramble', 'scan', 'settings', 'stats', 'timer', 'shapes', 'practice'];

const engines = {};
before(async () => {
  engines.webkit = await startBrowserFixture({ engine: 'webkit' });
  engines.chromium = await startBrowserFixture({ engine: 'chromium' });
});
after(async () => { await Promise.all(Object.values(engines).map((e) => e?.close())); });

const chan = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (d, i) => 0.2126 * chan(d[i]) + 0.7152 * chan(d[i + 1]) + 0.0722 * chan(d[i + 2]);
const ratioAt = (a, b, i) => { const [hi, lo] = [lum(a, i), lum(b, i)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };

/** The page in `theme`, transitions and animations held still so a frame is read as it stands. */
const inTheme = (page, theme) => page.evaluate((th) => {
  document.documentElement.setAttribute('data-theme', th);
  if (!document.getElementById('still-for-reading')) {
    const s = document.createElement('style');
    s.id = 'still-for-reading';
    s.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; }';
    document.head.append(s);
  }
  getComputedStyle(document.documentElement).color;
}, theme);

/** The element focus is on, as the measurement needs it, or null on the page itself. */
const focused = () => {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return null;
  const b = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const name = el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent.replace(/\s+/g, ' ').trim();
  return {
    key: `${el.id}|${el.tagName}|${name}|${Math.round(b.left)},${Math.round(b.top)}`,
    // What kind of control this is, as drawn: two stops of one kind draw one ring on one ground (twenty turns in a strip).
    kind: `${el.tagName}.${[...el.classList].filter((c) => !/^(cur|on|played|active|off)$/.test(c)).sort().join('.')}|${Math.round(b.width)}x${Math.round(b.height)}`,
    label: `${el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`} "${(name || '').slice(0, 40)}"`,
    visible: el.matches(':focus-visible'), screen: el.classList.contains('screen'),
    box: { x: b.left, y: b.top, w: b.width, h: b.height },
    outline: { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth), offset: parseFloat(cs.outlineOffset) },
  };
};

async function openRoute(engine, route, viewport = VIEWPORTS[0]) {
  const context = await engines[engine].browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${engines[engine].base}/#/${route}`);
  await page.waitForSelector('.screen.active', { timeout: LIVENESS_MS });
  await page.waitForLoadState('load');
  if (route === 'scramble') {
    // A walk on screen: the transport, the strip of turns and the speed tool are what a keyboard reaches here.
    await page.click('#randCube:visible, #randCubeTool:visible');
    await page.waitForSelector('#solList .chip-m', { timeout: LIVENESS_MS });
  }
  if (route === 'practice') await page.waitForSelector('[data-ready]', { timeout: LIVENESS_MS });
  return { context, page, errors };
}

/**
 * Every stop the keyboard reaches from the top of the page. Each is held to being focus-visible and wearing the app's
 * ring; the drawn pixels are read, in every theme, for the first two stops of each KIND of control — the twenty turns in
 * a strip are one control drawn twenty times, and reading each would make this a gate nobody waits for.
 */
async function walkStops(page, engine) {
  const vp = page.viewportSize();
  const stops = [];
  await page.evaluate(() => { document.activeElement?.blur?.(); });
  const seen = new Set();
  const kinds = new Map();
  for (let i = 0; i < 120; i++) {
    // WebKit on macOS skips buttons and links on Tab (the system's keyboard-navigation default) and reaches every control
    // on Option+Tab; WebKitGTK and Chromium reach them on Tab.
    await page.keyboard.press(engine === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab');
    const f = await page.evaluate(focused);
    if (!f) continue;
    if (seen.has(f.key)) break;
    seen.add(f.key);
    if (f.screen || f.box.w === 0 || f.box.h === 0) continue;
    kinds.set(f.kind, (kinds.get(f.kind) ?? 0) + 1);
    if (kinds.get(f.kind) > 2) { stops.push({ ...f, per: null }); continue; }
    const clip = { x: Math.max(0, f.box.x - 8), y: Math.max(0, f.box.y - 8) };
    clip.width = Math.min(vp.width, f.box.x + f.box.w + 8) - clip.x;
    clip.height = Math.min(vp.height, f.box.y + f.box.h + 8) - clip.y;
    if (clip.width < 2 || clip.height < 2) continue;
    const per = {};
    for (const theme of THEMES) {
      await inTheme(page, theme);
      const on = decodePng(await page.screenshot({ clip, animations: 'disabled', caret: 'hide' })).rgba;
      await page.evaluate(() => {
        const s = document.createElement('style');
        s.id = 'no-ring';
        s.textContent = '*:focus, *:focus-visible { outline: none !important; }';
        document.head.append(s);
      });
      const off = decodePng(await page.screenshot({ clip, animations: 'disabled', caret: 'hide' })).rgba;
      await page.evaluate(() => document.getElementById('no-ring')?.remove());
      let at3 = 0;
      for (let k = 0; k < on.length; k += 4) {
        if (Math.max(Math.abs(on[k] - off[k]), Math.abs(on[k + 1] - off[k + 1]), Math.abs(on[k + 2] - off[k + 2])) < 24) continue;
        if (ratioAt(on, off, k) >= 3) at3 += 1;
      }
      per[theme] = at3;
    }
    stops.push({ ...f, per, perimeter: Math.round(2 * (Math.min(f.box.w, clip.width) + Math.min(f.box.h, clip.height))) });
  }
  return stops;
}

for (const engine of ['webkit', 'chromium']) {
  test(`every stop the keyboard reaches draws the app's focus ring at 3:1, 2px, outside the control — ${engine}`, async (t) => {
    const failures = [];
    let measured = 0;
    let read = 0;
    let least = Infinity;
    let leastAt = '';
    for (const viewport of VIEWPORTS) for (const screen of ROUTES) {
      const route = `${screen} at ${viewport.width}×${viewport.height}`;
      const { context, page, errors } = await openRoute(engine, screen, viewport);
      try {
        const stops = await walkStops(page, engine);
        assert.ok(stops.length >= 2, `precondition, ${route}: the keyboard reached ${stops.length} stops`);
        for (const s of stops) {
          if (!s.visible) { failures.push(`${route}: ${s.label} is focused and not focus-visible`); continue; }
          measured += 1;
          if (!(s.outline.style !== 'none' && s.outline.width >= 2 && s.outline.offset >= 0)) {
            failures.push(`${route}: ${s.label} wears outline ${s.outline.style} ${s.outline.width}px offset ${s.outline.offset}px — not the app's ring`);
          }
          if (!s.per) continue;
          read += 1;
          for (const theme of THEMES) {
            if (s.per[theme] / s.perimeter < least) { least = s.per[theme] / s.perimeter; leastAt = `${route}, ${theme}: ${s.label}`; }
            if (s.per[theme] < s.perimeter) failures.push(`${route}, ${theme}: ${s.label} — ${s.per[theme]} ring pixels at 3:1 against a ${s.perimeter}px perimeter`);
          }
        }
        assert.deepEqual(errors, [], `${route}: the page threw`);
      } finally {
        await context.close();
      }
    }
    t.diagnostic(`${measured} stops held to the app's ring, ${read} read in pixels; the least ring at 3:1 is ${least.toFixed(2)}× its control's perimeter (${leastAt})`);
    assert.ok(measured >= 80, `precondition: only ${measured} stops measured across ${ROUTES.length} screens in ${VIEWPORTS.length} windows`);
    assert.deepEqual(failures, [], 'a stop with no focus ring at 3:1 the app owns');
  });
}

// `#scanHow` is a scroller the engine makes focusable once its text overflows. Named, because it is not a control the
// app wrote as one, so nothing else here would notice it dropping out of the walk: it must be reached and must ring.
test('the scan notice, a focusable scroller, shows the ring when the keyboard reaches it — chromium', async () => {
  const { context, page, errors } = await openRoute('chromium', 'scan');
  try {
    await page.evaluate(() => document.querySelector('ai-scan-panel').dispatchEvent(new CustomEvent('scan-progress', { detail: {
      phase: 'scanning', message: 'Show one side to the camera to re-read just that side.', captured: [], sides: 0, live: null, confirm: null,
      device: null, complete: false, notice: { title: 'Some stickers were misread', tone: 'err',
        body: 'At least %1 stickers do not fit a real cube, and with that many the camera cannot tell which. Start the scan over, with more light on the cube and each side held flat to the camera — red and orange are the colours it confuses most. Show one side to the camera to re-read just that side. And a sentence more than any real notice carries, so the card is asked for more than it can ever need.',
        params: [3], action: { label: 'Start over', kind: 'restart' } } } })));
    await page.setViewportSize({ width: 574, height: 817 });
    await page.waitForFunction(() => { const h = document.getElementById('scanHow'); return h.scrollHeight > h.clientHeight + 1; }, null, { timeout: LIVENESS_MS });
    const stops = await walkStops(page, 'chromium');
    const how = stops.find((s) => s.label.startsWith('#scanHow'));
    assert.ok(how, `the keyboard never reached #scanHow (stops: ${stops.map((s) => s.label).join(', ')})`);
    assert.equal(how.visible, true, '#scanHow is focused and not focus-visible');
    for (const theme of THEMES) assert.ok(how.per[theme] >= how.perimeter, `${theme}: #scanHow draws ${how.per[theme]} ring pixels at 3:1 against a ${how.perimeter}px perimeter`);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});
