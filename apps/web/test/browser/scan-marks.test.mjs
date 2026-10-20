// The scan screen's marks, judged on the page against the ground they are drawn on (sweep 2026-10-20, S9).
//
// One claim, measured in a real WebKit, in all three themes:
//
//   - A RING DRAWN OUTSIDE A STICKER is judged at 3:1 against its LOCAL GROUND — what is actually behind the ring: the
//     picker's panel for the picker's rings, the card for the board's and the identity question's — and it must be
//     drawn, visible and unclipped by any box it sits in. E15's comparison against the sticker's own colour is for a
//     mark drawn INSIDE a sticker; a ring outside one never lies on the sticker, and the sweep measured the five rings
//     at 1.18–1.58:1 against the stickers they mark while each is 4.42:1 or more against its ground (H1, owner's call:
//     no visual change, the rule is the distinction). dev-docs/measurement-method.md.

import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { after, before, test } from 'node:test';

import { LIVENESS_MS, startBrowserFixture } from './harness.mjs';

let fixture;
before(async () => { fixture = await startBrowserFixture(); });
after(async () => { await fixture?.close(); });

const THEMES = ['white', 'cream', 'night'];
const FACES = 'URFDLB';
/** A scanned cube the app adopts (geometry.test.mjs's): six sides with real, mixed stickers. */
const SCANNED_CUBE = 'DDDUURFDURDRRRLBBULLFUFFFLLDUUFDDDLRBBUBLRBULFFLFBRBBR';
const captureOf = (f) => ({ face: f, colors: [...SCANNED_CUBE.slice(FACES.indexOf(f) * 9, FACES.indexOf(f) * 9 + 9)].map((l) => FACES.indexOf(l)), by: 'centre' });

/** A scan report, as the scanner emits it: the host's own painter lays the screen out from it. */
const report = (page, detail) => page.evaluate((d) => document.querySelector('ai-scan-panel').dispatchEvent(new CustomEvent('scan-progress', { detail: d })), {
  phase: 'scanning', message: '', captured: [], sides: 0, live: null, settling: null, seen: null, shownAgain: false,
  device: null, confirm: null, identity: null, complete: false, suspects: [], notice: null, ...detail,
});

/** The theme, set as Settings sets it, with every transition and animation held still so a colour is read as it stands. */
const inTheme = (page, theme) => page.evaluate((th) => {
  document.documentElement.setAttribute('data-theme', th);
  if (!document.getElementById('still-for-reading')) {
    const still = document.createElement('style');
    still.id = 'still-for-reading';
    still.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }';
    document.head.append(still);
  }
  getComputedStyle(document.documentElement).color;
}, theme);

async function openScan({ dpr = 1, motion = 'no-preference' } = {}) {
  const context = await fixture.browser.newContext({ viewport: { width: 840, height: 682 }, deviceScaleFactor: dpr, reducedMotion: motion });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${fixture.base}/#/scan`);
  await page.waitForSelector('.scan-face', { timeout: LIVENESS_MS });
  // The headless engine has no camera; quiet the scanner so the reports below are the only ones.
  await page.evaluate(() => { try { document.querySelector('ai-scan-panel').stop?.(); } catch { /* nothing to stop */ } });
  return { context, page, errors };
}

// ---- S9: rings outside a sticker, against their local ground ------------------------------------------------------

/**
 * In the page: each ring named by `sel` — the first outer box-shadow with a spread, the ring a mark draws outside its
 * box — its colour composited over what is behind it, that ground, whether the element is drawn, and every box that
 * clips it and how far the ring reaches past that box. Self-contained.
 */
const ringsOf = (sel) => {
  const parse = (s) => {
    const n = (s.match(/-?[\d.]+/g) ?? []).map(Number);
    if (/^color\(srgb/.test(s)) return { r: n[0] * 255, g: n[1] * 255, b: n[2] * 255, a: n.length > 3 ? n[3] : 1 };
    if (/^rgba?\(/.test(s)) return { r: n[0], g: n[1], b: n[2], a: n.length > 3 ? n[3] : 1 };
    return null;
  };
  const over = (t, u) => ({ r: t.r * t.a + u.r * (1 - t.a), g: t.g * t.a + u.g * (1 - t.a), b: t.b * t.a + u.b * (1 - t.a), a: 1 });
  const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const ratio = (x, y) => { const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };
  /** The ground behind `el`'s ring: its ancestors' backgrounds laid over each other, down to the first opaque one. */
  const ground = (el) => {
    const layers = [];
    for (let x = el.parentElement; x; x = x.parentElement) {
      const bg = parse(getComputedStyle(x).backgroundColor);
      if (bg && bg.a > 0) { layers.push(bg); if (bg.a >= 1) break; }
    }
    let g = { r: 255, g: 255, b: 255, a: 1 };
    for (const l of layers.reverse()) g = over(l, g);
    return g;
  };
  const ring = (el) => {
    const parts = getComputedStyle(el).boxShadow.split(/,(?![^(]*\))/).map((p) => p.trim()).filter((p) => p && p !== 'none' && !/inset/.test(p));
    for (const p of parts) {
      const col = p.match(/(rgba?\([^)]*\)|color\([^)]*\))/)?.[0];
      const nums = p.replace(col ?? '', '').trim().split(/\s+/).map(parseFloat);
      if (col && nums.length >= 4 && nums[3] > 0) return { colour: parse(col), spread: nums[3] };
    }
    return null;
  };
  return [...document.querySelectorAll(sel)].map((el) => {
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const drawn = !el.closest('[hidden]') && cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0 && b.width > 0 && b.height > 0;
    const rg = ring(el);
    const g = ground(el);
    const clipped = [];
    if (rg) {
      const out = { left: b.left - rg.spread, right: b.right + rg.spread, top: b.top - rg.spread, bottom: b.bottom + rg.spread };
      for (let x = el.parentElement; x && x !== document.documentElement; x = x.parentElement) {
        const xs = getComputedStyle(x);
        // A `display: contents` box draws nothing and clips nothing (the cube screens' aside is one).
        if (xs.display === 'contents' || (xs.overflowX === 'visible' && xs.overflowY === 'visible')) continue;
        const c = x.getBoundingClientRect();
        const past = Math.max(c.left - out.left, out.right - c.right, c.top - out.top, out.bottom - c.bottom);
        if (past > 0.5) clipped.push(`${x.id ? `#${x.id}` : x.className} by ${past.toFixed(1)}px`);
      }
    }
    return { drawn, ring: Boolean(rg), spread: rg?.spread ?? 0, ratio: rg ? ratio(over(rg.colour, g), g) : 0, clipped,
      box: { x: b.left, y: b.top, w: b.width, h: b.height } };
  });
};

/** The five rings, each in the state that draws it. */
const RINGS = [
  { what: 'the suspect sticker\'s ring (--err)', sel: '.scan-face .tgrid > .cell.suspect' },
  { what: 'the sticker being edited (--accent)', sel: '.scan-face .cell.editing' },
  { what: 'the picker\'s current colour (--ink)', sel: '.swatches > button.now' },
  { what: 'the picker\'s suggested colour (--err)', sel: '.swatches > button.suggest' },
  { what: 'the identity question\'s claimed colour (--warn-ink)', sel: '.id-ask > button.sw.claimed > i' },
];

const decodePng = (buf) => {
  let p = 8; let w; let h; let type; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p); const tag = buf.toString('ascii', p + 4, p + 8); const data = buf.subarray(p + 8, p + 8 + len);
    if (tag === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); type = data[9]; if (data[8] !== 8 || data[12] !== 0) throw new Error('png: only 8-bit non-interlaced'); }
    if (tag === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const bpp = type === 6 ? 4 : type === 2 ? 3 : null;
  if (!bpp) throw new Error(`png: colour type ${type}`);
  const raw = inflateSync(Buffer.concat(idat)); const stride = w * bpp; const out = Buffer.alloc(w * h * 3); const prev = Buffer.alloc(stride); const cur = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]; raw.copy(cur, 0, y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0; const b = prev[x]; const c = x >= bpp ? prev[x - bpp] : 0;
      const pa = Math.abs(b - c); const pb = Math.abs(a - c); const pc = Math.abs(a + b - 2 * c);
      cur[x] = (cur[x] + [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]) & 255;
    }
    cur.copy(prev);
    for (let x = 0; x < w; x++) for (let k = 0; k < 3; k++) out[(y * w + x) * 3 + k] = cur[x * bpp + k];
  }
  return { w, h, px: (x, y) => { const i = (Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 3; return [out[i], out[i + 1], out[i + 2]]; } };
};

/** Pixels that change when the ring on `sel`'s `k`th element is taken away: the ring is DRAWN, not only declared. */
async function ringDrawn(page, sel, k) {
  const box = await page.evaluate(({ s, i }) => {
    const el = [...document.querySelectorAll(s)][i];
    el.setAttribute('data-ring-probe', '');
    const b = el.getBoundingClientRect();
    return { x: b.left, y: b.top, w: b.width, h: b.height };
  }, { s: sel, i: k });
  const clip = { x: Math.max(0, box.x - 6), y: Math.max(0, box.y - 6), width: box.w + 12, height: box.h + 12 };
  const on = decodePng(await page.screenshot({ clip, animations: 'disabled' }));
  await page.evaluate(() => {
    const s = document.createElement('style');
    s.id = 'ring-off';
    s.textContent = '[data-ring-probe] { box-shadow: none !important; }';
    document.head.append(s);
  });
  const off = decodePng(await page.screenshot({ clip, animations: 'disabled' }));
  await page.evaluate(() => { document.getElementById('ring-off')?.remove(); document.querySelector('[data-ring-probe]')?.removeAttribute('data-ring-probe'); });
  let changed = 0;
  for (let y = 0; y < on.h; y++) {
    for (let x = 0; x < on.w; x++) {
      const a = on.px(x, y); const b = off.px(x, y);
      if (Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])) >= 24) changed += 1;
    }
  }
  return { changed, perimeter: Math.round(2 * (box.w + box.h)) };
}

test('every ring drawn outside a sticker clears 3:1 against its local ground, is drawn, and is not clipped — every theme', async (t) => {
  const { context, page, errors } = await openScan();
  const seen = [];
  const least = {};
  const measure = async (which) => {
    for (const theme of THEMES) {
      await inTheme(page, theme);
      for (const r of RINGS.filter((x) => which.includes(x.sel))) {
        const found = await page.evaluate(ringsOf, r.sel);
        const shown = found.filter((f) => f.drawn);
        assert.ok(shown.length > 0, `precondition, ${theme}: ${r.what} is not on the page`);
        for (const [k, f] of shown.entries()) {
          seen.push(r.sel);
          least[r.what] = Math.min(least[r.what] ?? Infinity, f.ratio);
          assert.ok(f.ring, `${theme}: ${r.what} draws no ring outside its box`);
          assert.ok(f.ratio >= 3, `${theme}: ${r.what} is ${f.ratio.toFixed(2)}:1 against its local ground — a ring outside a sticker needs 3:1`);
          assert.deepEqual(f.clipped, [], `${theme}: ${r.what} is clipped by the box it sits in`);
          if (k === 0) {
            const d = await ringDrawn(page, r.sel, found.indexOf(f));
            // At least one device pixel per CSS px of the ring's perimeter changes: a ring taken away leaves a trace.
            assert.ok(d.changed >= d.perimeter, `${theme}: ${r.what} is declared and not drawn — ${d.changed} pixels change against a ${d.perimeter}px perimeter`);
          }
        }
      }
    }
  };
  try {
    // A refusal with a suspect sticker, and the picker opened on it: the suspect, the edited sticker, the picker's
    // current colour and its suggestion.
    await report(page, {
      captured: [...FACES].map(captureOf), sides: 6, suspects: [{ face: 'R', index: 2, to: 5 }], message: 'Show one side to the camera to re-read just that side.',
    });
    await page.waitForSelector('.scan-face .tgrid > .cell.suspect', { timeout: LIVENESS_MS });
    await measure([RINGS[0].sel]);
    await page.evaluate(() => document.querySelector('.scan-face .tgrid > .cell.suspect').click());
    await page.waitForSelector('.swatches > button.suggest', { timeout: LIVENESS_MS });
    await measure([RINGS[1].sel, RINGS[2].sel, RINGS[3].sel]);
    await page.keyboard.press('Escape');
    // The identity question, with the colour both sides read as claimed.
    await report(page, { captured: ['U', 'R', 'D'].map(captureOf), sides: 3, identity: { id: 7, colors: Array(9).fill(2), claimed: 2, choices: [2, 4, 5] } });
    await page.waitForSelector('.id-ask > button.sw.claimed > i', { timeout: LIVENESS_MS });
    await measure([RINGS[4].sel]);
    // Every one of the five was measured, not skipped by a state that did not arrive.
    assert.deepEqual([...new Set(seen)].sort(), RINGS.map((r) => r.sel).sort(), 'a ring was never measured');
    for (const [what, ratio] of Object.entries(least)) t.diagnostic(`${what}: least ${ratio.toFixed(2)}:1 on its local ground`);
    assert.deepEqual(errors, [], 'the page threw');
  } finally {
    await context.close();
  }
});
