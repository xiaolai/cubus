// The library's case photographs, taken by the app's own photographer (lib/case-photo.js) in real browsers
// (dev-docs/practice-redesign-plan.md §3.3, §3.5, §3.6; WI-1).
//
// CHROMIUM measures. It draws WebGL with the same software rasteriser on every machine (AGENTS.md §7), so its pixels
// can decide things: every net row is photographed, bare and marked, and the plan's criterion is applied to every
// set — two pictures LOOK ALIKE when, drawn as a tile shows them (contained in its picture box at DPR 2, on the tile) and
// cropped to their painted content, fewer than 2% of those pixels differ by more than 48/255 in any channel. From that the keep list and the unmarked list are
// RE-DERIVED, both ways, by the rules that made them; a list that no longer matches its rule fails here, and is
// changed by measuring, never by editing.
//
// IN EVERY THEME, AT DPR 1 AND 2 (plan E14). A moved sticker's mark is the theme's ink or its ground, whichever
// contrasts more with that sticker, so what a tile shows is a different picture in each theme: no two cases alike, and
// every mark seen at its sticker, are asserted in all three — on the photographs, the flat tiles and the book alike.
//
// WEBKIT checks only that every photograph decodes and paints: its pixels are not reproducible across machines.
//
// Any warning the renderer prints fails a case: "highlight matched nothing" is a marking that silently drew nothing.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import * as lib from '../../lib/alg-library.js';
import { NET_KEPT, UNMARKED, isMarked, isPhotographed, photoAttrs } from '../../lib/case-photo.js';
import { caseOf, movedPieces } from '../../lib/drill/case-of.js';
import { orientationPerm } from '../../lib/cube-orientation.js';
import { catalogueOf } from '../../lib/drill/library-client.js';
import { bookPicture, casePicture, markedPicture, outlineMoved } from '../../lib/screens/practice/library-view.js';
import { THEME_INKS } from '../fixtures/theme-inks.mjs';
import { LIVENESS_MS, startBrowserFixture } from './harness.mjs';

const catalogue = await catalogueOf(lib);
const LOOK = { palette: 'classic', scheme: 'western' };
/** The share of each visible moved sticker's own painted pixels its marking must change by more than 48/255 (plan E8). */
const MARK_SEEN = 0.25;
const regionOf = (row) => catalogue.sets[row.set].region;
/**
 * The unmarked list's SECOND rule (case-photo.js `UNMARKED`): the sets with a flat row that draws another case than the
 * one its marking is worked out from — a source's finishing turn after the algorithm — so a mark would outline the
 * wrong stickers. Computed here from the ledger and the page's case; test/case-photo.test.mjs holds the other side.
 */
const MISDRAWN = [...new Set(Object.values(catalogue.rows).filter((row) => !isPhotographed(row)).filter((row) => {
  const c = caseOf(row);
  return orientationPerm(...c.hold).map((scan) => c.facelets[scan]).join('') !== row.solves.facelets;
}).map((row) => row.set))].sort();
const THEMES = Object.freeze(['white', 'cream', 'night']);
const rgb = (c) => `rgb(${c.map(Math.round).join(', ')})`;
/**
 * A flat picture as the page draws it in `theme`. An image made from a data URL resolves no CSS, so what the stylesheet
 * resolves is resolved here, from tokens.css: each mark in its token (`data-mark`), and the theme's own off-grey — not the
 * fallback in the markup, which is cream's and which Night does not draw.
 */
const asDrawn = (svg, theme) => {
  const inks = THEME_INKS[theme];
  return svg.replace(/data-mark="(ink|ground)"([^>]*?) stroke="currentColor"/g, (m, k, rest) => `data-mark="${k}"${rest} stroke="${rgb(inks[k])}"`)
    .replace(/var\(--facelet-off, #[0-9A-Fa-f]{6}\)/g, rgb(inks.off));
};
/** Every set that holds rows, and what each of its rows is drawn as, every way the rules compare. */
const SETS = Object.entries(catalogue.sets).filter(([, s]) => s.ids.length).map(([id, s]) => [id, s.ids.map((rowId) => {
  const row = catalogue.rows[rowId];
  const plain = casePicture(row, LOOK);
  const net = row.solves.picture === 'net';
  const bare = net ? photoAttrs(row, regionOf(row), { mark: false }) : null;
  const by = (f) => Object.fromEntries(THEMES.map((th) => [th, asDrawn(f(th), th)]));
  return {
    id: rowId,
    // Rows that are one case are one picture by construction, and are not counted as alike.
    key: net ? `${bare.orientation}|${bare.facelets}` : `viewed|${row.solves.facelets}`,
    today: by(() => plain),
    outlined: by((th) => outlineMoved(plain, movedPieces(row, regionOf(row)).viewed.flat(), { inks: THEME_INKS[th] })),
    bare,
    marked: isPhotographed(row) ? photoAttrs(row, regionOf(row), { mark: true }) : null,
    // The moved stickers on the faces the camera sees (viewed 0-26: up, right, front) — the ones a photograph outlines.
    visibleMoved: movedPieces(row, regionOf(row)).viewed.flat().filter((f) => f < 27).length,
    photographed: isPhotographed(row),
    tileMarked: isMarked(row),
  };
})]);

/** A page on the library with the app's photographer and the plan's measurement loaded, and every renderer warning
 *  and page error kept. */
async function photoPage(fixture, { dpr = 2 } = {}) {
  const context = await fixture.browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: dpr });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(String(e)));
  // The renderer's own warnings only: a GL driver also warns on every canvas read, which says nothing about a picture.
  page.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warning' && /<cubus-cube>|case-photo/.test(m.text()))) problems.push(`${m.type()}: ${m.text()}`); });
  await page.goto(`${fixture.base}/index.html#/practice`);
  await page.waitForSelector('.practice-screen[data-ready="1"]', { timeout: LIVENESS_MS });
  await page.evaluate(async () => {
    const photo = await import('/lib/case-photo.js');
    const frame = photo.PHOTO_FRAME;
    const done = new AbortController();
    const photographer = photo.casePhotographer({ host: document.querySelector('.practice-screen'), signal: done.signal });
    // The picture box as a tile DRAWS it, at the smallest width it is drawn (plan E9): the portrait grid's narrowest
    // tile, `minmax(78px, 1fr)`, less 4 px padding each side and a 1 px border — 68 px — in the still's shape. Every
    // picture is contained in it as index.html contains it, photograph and flat picture alike.
    const W = 68 * 2; const H = Math.round((68 * 2 * frame.h) / frame.w);
    const load = (src) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error(`a picture did not decode: ${src.slice(0, 60)}`)); i.src = src; });
    const srcOf = (p) => (p.startsWith('<svg') ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(p)}` : p);
    /** The painted box of RGBA pixels `w` wide: where anything is drawn. */
    const paintedBox = (px, w) => {
      let x0 = Infinity; let y0 = Infinity; let x1 = -1; let y1 = -1;
      for (let i = 3; i < px.length; i += 4) {
        if (px[i] === 0) continue;
        const p = (i - 3) / 4; const x = p % w; const y = (p - x) / w;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      return { x0, y0, x1, y1 };
    };
    /** A picture as a tile shows it: contained in the picture box at DPR 2, with the box it paints — and over `ground`,
     *  the tile's surface in the theme it is shown in. */
    const draw = async (p, ground = [255, 255, 255]) => {
      const img = await load(srcOf(p));
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const g = cv.getContext('2d');
      const k = Math.min(W / img.width, H / img.height);
      g.drawImage(img, (W - img.width * k) / 2, (H - img.height * k) / 2, img.width * k, img.height * k);
      const px = g.getImageData(0, 0, W, H).data;
      // Over the tile's ground.
      const rgb = new Uint8ClampedArray((px.length / 4) * 3);
      for (let i = 0, j = 0; i < px.length; i += 4, j += 3) {
        for (let c = 0; c < 3; c += 1) rgb[j + c] = (px[i + c] * px[i + 3] + ground[c] * (255 - px[i + 3])) / 255;
      }
      return { px, rgb, box: paintedBox(px, W) };
    };
    /**
     * The share of what is SHOWN that two pictures differ on by more than `by` in any channel — 48/255 is the
     * criterion's. Shown is the pictures' painted content, both of it (the union of their painted boxes), never the
     * picture box: an empty margin would dilute the difference and call two clear pictures alike (plan E8, amended).
     */
    const differ = (a, b, by = 48) => {
      const x0 = Math.min(a.box.x0, b.box.x0); const x1 = Math.max(a.box.x1, b.box.x1);
      const y0 = Math.min(a.box.y0, b.box.y0); const y1 = Math.max(a.box.y1, b.box.y1);
      if (x1 < x0) return 0;
      let d = 0;
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const i = (y * W + x) * 3;
          if (Math.abs(a.rgb[i] - b.rgb[i]) > by || Math.abs(a.rgb[i + 1] - b.rgb[i + 1]) > by || Math.abs(a.rgb[i + 2] - b.rgb[i + 2]) > by) d += 1;
        }
      }
      return d / ((x1 - x0 + 1) * (y1 - y0 + 1));
    };
    /** Pairs of different cases that look alike, and the nearest pair. */
    const alike = (pics, keys) => {
      let n = 0; let min = 1;
      for (let i = 0; i < pics.length; i += 1) {
        for (let j = i + 1; j < pics.length; j += 1) {
          if (keys[i] === keys[j]) continue;
          const v = differ(pics[i], pics[j]);
          min = Math.min(min, v);
          if (v < 0.02) n += 1;
        }
      }
      return { alike: n, min: Number(min.toFixed(4)) + 0 };
    };
    /**
     * E8, sticker by sticker: for each sticker the marked photograph outlines (`photoMarks`, the polygons its outline
     * was stroked on), the share of the sticker's own painted pixels that differ from the unmarked photograph by more
     * than 48/255 — both stills at their own size, where the polygons are.
     */
    const stickerShares = async (markedUrl, bareUrl) => {
      const polys = photo.photoMarks(markedUrl);
      if (!polys) throw new Error('a marked photograph with no marks recorded');
      const pixels = async (url) => {
        const img = await load(url);
        const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
        const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
        return { px: g.getImageData(0, 0, img.width, img.height).data, w: img.width, h: img.height };
      };
      const m = await pixels(markedUrl); const b = await pixels(bareUrl);
      if (m.w !== b.w || m.h !== b.h) throw new Error(`marked ${m.w}x${m.h} and unmarked ${b.w}x${b.h} stills are not one frame`);
      return polys.map((poly) => {
        const cv = document.createElement('canvas'); cv.width = m.w; cv.height = m.h;
        const g = cv.getContext('2d');
        g.beginPath(); poly.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath();
        g.fill();
        const mask = g.getImageData(0, 0, m.w, m.h).data;
        let inside = 0; let changed = 0;
        for (let i = 0; i < mask.length; i += 4) {
          if (mask[i + 3] < 255 || b.px[i + 3] === 0) continue;
          inside += 1;
          if (Math.abs(m.px[i] - b.px[i]) > 48 || Math.abs(m.px[i + 1] - b.px[i + 1]) > 48 || Math.abs(m.px[i + 2] - b.px[i + 2]) > 48) changed += 1;
        }
        return inside ? changed / inside : 0;
      });
    };
    const hash = async (url) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await (await fetch(url)).arrayBuffer()))]
      .map((b) => b.toString(16).padStart(2, '0')).join('');
    /** The page in `theme`, as Settings puts it there: the photographer reads its two inks where the library is drawn. */
    const theme = (th) => { document.documentElement.setAttribute('data-theme', th); getComputedStyle(document.documentElement).color; };
    window.__photos = { photo, photographer, draw, differ, alike, stickerShares, hash, done, theme };
  });
  return { page, context, problems };
}

// ---- Chromium: the measurement ------------------------------------------------------------------------------------

let chromium;
before(async () => { chromium = await startBrowserFixture({ engine: 'chromium' }); });
after(async () => { await chromium?.close(); });

test('every set tells its cases apart as the tiles show them in every theme, and both lists re-derive from their rules, both ways', async (t) => {
  const { page, context, problems } = await photoPage(chromium);
  try {
    const byTheme = {};
    for (const theme of THEMES) {
      byTheme[theme] = await page.evaluate(async ({ sets, theme: th, ground }) => {
        const { photographer, draw, alike, theme: setTheme } = window.__photos;
        setTheme(th);
        const out = {};
        for (const [id, rows] of sets) {
          const shot = async (attrs) => {
            const url = await photographer.photo(attrs);
            if (!url) throw new Error(`${id}: the photographer gave no photograph`);
            return url;
          };
          const keys = rows.map((r) => r.key);
          const px = { today: [], outlined: [], bare: [], marked: [], shown: [] };
          for (const r of rows) {
            const today = await draw(r.today[th], ground);
            const outlined = await draw(r.outlined[th], ground);
            const bare = r.bare ? await draw(await shot(r.bare), ground) : today;
            const marked = r.marked ? await draw(await shot(r.marked), ground) : outlined;
            px.today.push(today); px.outlined.push(outlined); px.bare.push(bare); px.marked.push(marked);
            // What the tile shows: a photograph, marked unless unmarked; a flat picture, outlined unless unmarked.
            px.shown.push(r.photographed ? (r.tileMarked ? marked : bare) : (r.tileMarked ? outlined : today));
          }
          out[id] = Object.fromEntries(Object.entries(px).map(([k, v]) => [k, alike(v, keys)]));
        }
        return out;
      }, { sets: SETS, theme, ground: THEME_INKS[theme].ground });
    }
    // The lists' rules, in every theme: one theme's picture is not another's, so each must give the same lists. Every
    // theme's lists are said before any is asserted, so a list that moves is reported in all three.
    const lists = {};
    for (const theme of THEMES) {
      const measured = byTheme[theme];
      const keeps = Object.keys(measured).filter((id) => measured[id].bare.alike > measured[id].today.alike).sort();
      // Either rule makes a set unmarked: its marking makes pairs alike, or it would outline another case's stickers.
      const unmarked = Object.keys(measured).filter((id) => MISDRAWN.includes(id) || (keeps.includes(id)
        ? measured[id].outlined.alike > measured[id].today.alike
        : measured[id].marked.alike > measured[id].bare.alike)).sort();
      const byAlike = unmarked.filter((id) => !MISDRAWN.includes(id));
      for (const [id, m] of Object.entries(measured)) {
        t.diagnostic(`${theme} ${id}: today ${m.today.alike}/${m.today.min}, outlined ${m.outlined.alike}/${m.outlined.min}, photographed ${m.bare.alike}/${m.bare.min}, marked ${m.marked.alike}/${m.marked.min}, shown ${m.shown.alike}/${m.shown.min}`);
      }
      lists[theme] = { keeps, unmarked };
      t.diagnostic(`${theme}: keep list ${keeps.join(', ')}; unmarked list ${unmarked.join(', ')} (by alike: ${byAlike.join(', ') || 'none'}; misdrawn: ${MISDRAWN.join(', ')})`);
    }
    for (const theme of THEMES) {
      assert.deepEqual(lists[theme].keeps, [...NET_KEPT].sort(), `${theme}: the keep list is not what its rule computes`);
      assert.deepEqual(lists[theme].unmarked, [...UNMARKED].sort(), `${theme}: the unmarked list is not what its rule computes`);
      // R8: as the tiles show them, no two cases of any set look alike — in this theme.
      for (const [id, m] of Object.entries(byTheme[theme])) assert.equal(m.shown.alike, 0, `${theme} ${id}: ${m.shown.alike} pairs of cases look alike as shown`);
    }
    assert.deepEqual(problems, []);
  } finally {
    await context.close();
  }
});

test('a photograph is the same picture whenever it is taken: one set, forwards and then backwards, byte for byte', async () => {
  const { page, context, problems } = await photoPage(chromium);
  try {
    const rows = SETS.find(([id]) => id === 'f2l-human')[1].filter((r) => r.marked);
    assert.ok(rows.length > 30, 'precondition: the F2L set is photographed');
    const differences = await page.evaluate(async (list) => {
      const { photo, photographer, hash } = window.__photos;
      const take = async (order) => {
        const out = {};
        for (const r of order) out[r.id] = await hash(await photographer.photo(r.marked));
        return out;
      };
      const forwards = await take(list);
      photo.clearCasePhotos();
      const backwards = await take([...list].reverse());
      return list.filter((r) => forwards[r.id] !== backwards[r.id]).map((r) => r.id);
    }, rows);
    // A photograph read before its frame was drawn, or at a moving point of the breath, is a wrong picture that
    // looks right: it would differ with what was drawn before it.
    assert.deepEqual(differences, [], 'photographs that depend on what was photographed before them');
    assert.deepEqual(problems, []);
  } finally {
    await context.close();
  }
});


// ---- Chromium: every mark is SEEN at its sticker (E8's gate), on all three surfaces, every theme, DPR 1 and 2 -----------

/** Every row whose flat picture — the tile's, or the book's — marks a moved piece: unmarked and marked as the theme draws
 *  them, and where each marked sticker is (its rect in the UNMARKED picture, in the picture's own units, so the sticker
 *  measured is the sticker as it is, whatever the marking does to its outline). */
const flatRows = (picture, which = () => true) => Object.values(catalogue.rows).filter((row) => isMarked(row) && which(row)).map((row) => {
  const plain = casePicture(row, LOOK);
  const rects = new Map([...plain.matchAll(/<rect data-facelet="(\d+)" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="([\d.]+)"/g)]
    .map(([, f, x, y, w, h, rx]) => [Number(f), { f: Number(f), x: Number(x), y: Number(y), w: Number(w), h: Number(h), rx: Number(rx) }]));
  const marked = Object.fromEntries(THEMES.map((th) => [th, picture(row, { ...LOOK, inks: THEME_INKS[th] })]));
  const moved = [...marked.white.matchAll(/<rect class="moved" data-facelet="(\d+)"/g)].map(([, f]) => rects.get(Number(f)));
  return {
    id: row.id, bare: Object.fromEntries(THEMES.map((th) => [th, asDrawn(plain, th)])),
    marked: Object.fromEntries(THEMES.map((th) => [th, asDrawn(marked[th], th)])), moved, vb: /viewBox="0 0 ([\d.]+) ([\d.]+)/.exec(plain).slice(1).map(Number),
  };
}).filter((r) => r.moved.length);
const BOOK_ROWS = flatRows((row, look) => bookPicture(row, regionOf(row), look));
const TILE_ROWS = flatRows((row, look) => markedPicture(row, regionOf(row), look),
  (row) => !isPhotographed(row));
const PHOTO_ROWS = SETS.flatMap(([, rows]) => rows).filter((r) => r.photographed && r.tileMarked);

test('every mark is seen at its sticker — book, flat tile and photograph — in every theme at DPR 1 and 2', async (t) => {
  assert.ok(BOOK_ROWS.length > 500, `precondition: only ${BOOK_ROWS.length} rows mark a moved piece in the book`);
  assert.ok(TILE_ROWS.length > 150, `precondition: only ${TILE_ROWS.length} flat tiles mark a moved piece`);
  assert.ok(PHOTO_ROWS.length > 250, `precondition: only ${PHOTO_ROWS.length} marked photographs`);
  // The book's width and ground, read off the real book open on a page — nothing typed from the stylesheet.
  const probe = await chromium.browser.newContext({ viewport: { width: 1280, height: 900 } });
  const shown = {};
  try {
    const page = await probe.newPage();
    await page.goto(`${chromium.base}/index.html#/practice`);
    await page.waitForSelector('.practice-screen[data-ready="1"]', { timeout: LIVENESS_MS });
    await page.evaluate(async () => {
      const { state } = await import('/lib/app-state.js');
      const { refreshScreen } = await import('/lib/screen-shell.js');
      state.practiceAlg = 'sune';
      refreshScreen();
    });
    await page.waitForSelector('.practice-page[data-ready="1"]', { timeout: LIVENESS_MS });
    /** The book open, read: its picture's width, its ground, and each mark's token and the colour it is drawn in. */
    const readBook = async () => {
      await page.waitForSelector('.practice-page[data-ready="1"]', { timeout: LIVENESS_MS });
      if (await page.evaluate(() => document.querySelector('#practiceInfo').hidden)) await page.click('#practiceBook');
      await page.waitForFunction(() => !document.querySelector('#practiceInfo').hidden, null, { timeout: LIVENESS_MS });
      return page.evaluate(() => {
        const still = document.createElement('style');
        still.textContent = '*, *::before, *::after { transition: none !important; }';
        document.head.append(still);
        const svg = document.querySelector('#practicePic svg');
        let ground = svg.parentElement;
        while (ground && /rgba\(0, 0, 0, 0\)|transparent/.test(getComputedStyle(ground).backgroundColor)) ground = ground.parentElement;
        const out = {
          width: svg.getBoundingClientRect().width,
          ground: getComputedStyle(ground).backgroundColor,
          marks: [...svg.querySelectorAll('rect.moved')].map((r) => `${r.dataset.facelet}:${r.dataset.mark}=${getComputedStyle(r).stroke}`),
        };
        still.remove();
        return out;
      });
    };
    // Each theme as Settings sets it: the screen drawn again, its marks chosen in the theme it is drawn in.
    for (const theme of THEMES) {
      await page.evaluate(async (th) => {
        const { settings } = await import('/lib/app-settings.js');
        const { applyTheme } = await import('/lib/cube-drawing.js');
        const { renderScreen } = await import('/lib/screen-shell.js');
        settings.theme = th; applyTheme(); renderScreen();
      }, theme);
      shown[theme] = await readBook();
    }
    // AUTO, the system turning dark with the book open: no render is asked for, and the marks must still be Night's.
    await page.emulateMedia({ colorScheme: 'light' });
    await page.evaluate(async () => {
      const { settings } = await import('/lib/app-settings.js');
      const { applyTheme } = await import('/lib/cube-drawing.js');
      const { renderScreen } = await import('/lib/screen-shell.js');
      settings.theme = 'auto'; applyTheme(); renderScreen();
    });
    await readBook();
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForFunction((want) => [...document.querySelectorAll('#practicePic rect.moved')].map((r) => `${r.dataset.facelet}:${r.dataset.mark}`).join() === want,
      shown.night.marks.map((m) => m.split('=')[0]).join(), { timeout: LIVENESS_MS }).catch(() => {});
    shown.autoDark = await readBook();
  } finally {
    await probe.close();
  }
  t.diagnostic(`the book draws its picture ${JSON.stringify(shown)}`);
  for (const theme of THEMES) {
    assert.equal(shown[theme].ground, rgb(THEME_INKS[theme].ground), `${theme}: the book's ground is not the --panel the marks were chosen against`);
    // Each mark drawn in the token it names, and named as the picture this theme draws names it.
    const want = asDrawn(bookPicture(catalogue.rows.sune, regionOf(catalogue.rows.sune), { ...LOOK, inks: THEME_INKS[theme] }), theme);
    const wantMarks = [...want.matchAll(/data-facelet="(\d+)" data-mark="(\w+)"/g)].map(([, f, m]) => `${f}:${m}=${rgb(THEME_INKS[theme][m])}`);
    assert.deepEqual(shown[theme].marks, wantMarks, `${theme}: the book's marks are not this theme's choice, drawn in their tokens`);
  }
  // Precondition: Night and White choose differently for this row, so the Auto case below can tell them apart.
  assert.notDeepEqual(shown.night.marks.map((m) => m.split('=')[0]), shown.white.marks.map((m) => m.split('=')[0]), 'precondition: sune is marked alike in Night and White');
  assert.deepEqual(shown.autoDark.marks, shown.night.marks, 'Auto turned dark with the book open, and its marks are not Night\'s');

  const unseen = [];
  for (const dpr of [1, 2]) {
    const { page, context, problems } = await photoPage(chromium, { dpr });
    try {
      for (const theme of THEMES) {
        const inks = THEME_INKS[theme];
        const flat = await page.evaluate(async ({ sets, dpr: d, ground }) => {
          const load = (src) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('a picture did not decode')); i.src = src; });
          const out = [];
          for (const { what, rows, w, h } of sets) {
            const Wd = Math.round(w * d); const Hd = Math.round(h * d);
            for (const r of rows) {
              // Contained in its box, as the stylesheet draws it.
              const k = Math.min(Wd / r.vb[0], Hd / r.vb[1]); const ox = (Wd - r.vb[0] * k) / 2; const oy = (Hd - r.vb[1] * k) / 2;
              const draw = async (svg, g0) => {
                const img = await load(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
                const cv = document.createElement('canvas'); cv.width = Wd; cv.height = Hd;
                const g = cv.getContext('2d');
                if (g0) { g.fillStyle = g0; g.fillRect(0, 0, Wd, Hd); }
                g.drawImage(img, ox, oy, r.vb[0] * k, r.vb[1] * k);
                return g.getImageData(0, 0, Wd, Hd).data;
              };
              const a = await draw(r.bare, ground); const b = await draw(r.marked, ground); const p = await draw(r.bare, null);
              for (const s of r.moved) {
                // The sticker's own pixels: inside its rounded rect, and painted in the unmarked picture.
                const cv = document.createElement('canvas'); cv.width = Wd; cv.height = Hd;
                const g = cv.getContext('2d');
                g.beginPath(); g.roundRect(ox + s.x * k, oy + s.y * k, s.w * k, s.h * k, s.rx * k); g.fill();
                const mask = g.getImageData(0, 0, Wd, Hd).data;
                let inside = 0; let changed = 0;
                for (let i = 0; i < mask.length; i += 4) {
                  if (mask[i + 3] < 255 || p[i + 3] === 0) continue;
                  inside += 1;
                  if (Math.abs(a[i] - b[i]) > 48 || Math.abs(a[i + 1] - b[i + 1]) > 48 || Math.abs(a[i + 2] - b[i + 2]) > 48) changed += 1;
                }
                out.push({ what, id: r.id, f: s.f, share: inside ? changed / inside : 0 });
              }
            }
          }
          return out;
        }, {
          dpr,
          ground: shown[theme].ground,
          sets: [
            // The book at its drawn width, its height free; a tile's picture box at its narrowest (68 px, plan E9), 15 : 16.
            { what: 'book', w: shown[theme].width, h: shown[theme].width * 2, rows: BOOK_ROWS.map((r) => ({ ...r, bare: r.bare[theme], marked: r.marked[theme] })) },
            { what: 'tile', w: 68, h: (68 * 16) / 15, rows: TILE_ROWS.map((r) => ({ ...r, bare: r.bare[theme], marked: r.marked[theme] })) },
          ],
        });
        // The photographs, taken in this theme at this DPR: the outline is drawn on exactly the visible moved stickers.
        const photos = await page.evaluate(async ({ rows, theme: th }) => {
          const { photographer, stickerShares, theme: setTheme } = window.__photos;
          setTheme(th);
          const out = [];
          for (const r of rows) {
            const shares = await stickerShares(await photographer.photo(r.marked), await photographer.photo(r.bare));
            out.push({ id: r.id, visible: r.visibleMoved, shares });
          }
          return out;
        }, { rows: PHOTO_ROWS, theme });
        assert.deepEqual(photos.filter((e) => e.shares.length !== e.visible).map((e) => `${e.id}: ${e.shares.length} outlined, ${e.visible} visible`), [],
          `${theme} DPR ${dpr}: a photograph outlines other stickers than its visible moved ones`);
        const all = [...flat, ...photos.flatMap((e) => e.shares.map((share) => ({ what: 'photo', id: e.id, f: '', share })))];
        for (const what of ['book', 'tile', 'photo']) {
          const s = all.filter((m) => m.what === what).sort((x, y) => x.share - y.share);
          assert.ok(s.length > 1000, `precondition: ${theme} DPR ${dpr}: only ${s.length} ${what} stickers measured`);
          t.diagnostic(`${theme} DPR ${dpr} ${what}: ${s.length} marked stickers, smallest ${s.slice(0, 3).map((m) => `${m.id}#${m.f} ${(100 * m.share).toFixed(1)}%`).join(', ')}, `
            + `median ${(100 * s[s.length >> 1].share).toFixed(1)}%, under 25%: ${s.filter((m) => m.share < MARK_SEEN).length}`);
        }
        unseen.push(...all.filter((m) => m.share < MARK_SEEN).map((m) => `${theme} DPR ${dpr} ${m.what} ${m.id}#${m.f} ${(100 * m.share).toFixed(1)}%`));
      }
      assert.deepEqual(problems, []);
    } finally {
      await context.close();
    }
  }
  // E8, everywhere a mark is drawn: no theme is measured and let off (Night was, until E14).
  assert.deepEqual(unseen.slice(0, 12), [], `${unseen.length} marked stickers whose marking changes under ${100 * MARK_SEEN}% of the sticker at 48/255`);
});

// ---- WebKit: every photograph paints ------------------------------------------------------------------------------

test('in WebKit every photograph a tile shows decodes and paints its cube', async () => {
  const webkit = await startBrowserFixture();
  try {
    const { page, context, problems } = await photoPage(webkit);
    const shown = SETS.flatMap(([, rows]) => rows).filter((r) => r.photographed);
    const blank = await page.evaluate(async (list) => {
      const { photographer, draw } = window.__photos;
      const out = [];
      for (const r of list) {
        const url = await photographer.photo(r.tileMarked ? r.marked : r.bare);
        if (!url) { out.push(`${r.id}: no photograph`); continue; }
        const { px } = await draw(url);
        let painted = 0;
        for (let i = 3; i < px.length; i += 4) if (px[i] > 0) painted += 1;
        if (painted / (px.length / 4) <= 0.05) out.push(`${r.id}: paints ${(100 * painted / (px.length / 4)).toFixed(2)}% of its box`);
      }
      return out;
    }, shown);
    assert.deepEqual(blank, []);
    assert.deepEqual(problems, []);
    await context.close();
  } finally {
    await webkit.close();
  }
});
