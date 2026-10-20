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
// every mark judged at its sticker, are asserted in all three — on the photographs, the flat tiles and the book alike.
//
// EVERY MARK IS JUDGED ON THE PAGE, IN BOTH ENGINES (plan E15): WCAG 1.4.11 per marked sticker on the real library and
// book (marks-on-page.mjs) — contrast as the page resolves it, the band's width and the colour it leaves from the drawing
// at the size the page draws it, and that it renders. Thresholds, not goldens, so WebKit decides them too. For
// everything else WEBKIT checks only that every photograph decodes and paints: its pixels are not reproducible.
//
// Any warning the renderer prints fails a case: "highlight matched nothing" is a marking that silently drew nothing.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import * as lib from '../../lib/alg-library.js';
import { NET_KEPT, UNMARKED, isMarked, isPhotographed, photoAttrs } from '../../lib/case-photo.js';
import { caseOf, movedPieces } from '../../lib/drill/case-of.js';
import { orientationPerm } from '../../lib/cube-orientation.js';
import { catalogueOf } from '../../lib/drill/library-client.js';
import { bookPicture, casePicture, libraryKey, outlineMoved } from '../../lib/screens/practice/library-view.js';
import { THEME_INKS } from '../fixtures/theme-inks.mjs';
import { LIVENESS_MS, startBrowserFixture } from './harness.mjs';
import { MARK_COLOUR_KEPT, MARK_CONTRAST, MARK_FIXTURES, MARK_STROKE_LEAST_PX, measureBook, measureLibrary, practiceAt } from './marks-on-page.mjs';

const catalogue = await catalogueOf(lib);
const LOOK = { palette: 'classic', scheme: 'western' };
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
    const hash = async (url) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await (await fetch(url)).arrayBuffer()))]
      .map((b) => b.toString(16).padStart(2, '0')).join('');
    /** The page in `theme`, as Settings puts it there: the photographer reads its two inks where the library is drawn. */
    const theme = (th) => { document.documentElement.setAttribute('data-theme', th); getComputedStyle(document.documentElement).color; };
    window.__photos = { photo, photographer, draw, differ, alike, hash, done, theme };
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


// ---- the book's marks are this theme's, drawn in their tokens, and Auto follows the system -----------------------------

test('the book draws each mark in the token this theme chooses, and Auto turning dark with the book open draws Night\'s', async (t) => {
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
    /** The book open, read: its ground, and each mark's token and the colour it is drawn in. */
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
});

// ---- E15: every mark judged ON THE PAGE by WCAG 1.4.11, in both engines -----------------------------------------------
//
// The real library's flat tiles and photographs and the real book (test/browser/marks-on-page.mjs), sticker by sticker:
// (a) the band's colour against the sticker's own is at least 3:1; (b) the band is at least a CSS px at the size the
// page draws the picture, from the one function the drawing uses; (c) at least 35% of the sticker keeps its own colour;
// and the mark renders. Every theme, DPR 1 and 2, the iPhone SE and a landscape window. It supersedes E8's "25% of a
// sticker's pixels changed at 48/255", a number chosen for a gate, which the page could meet only by repainting stickers.

/** The library's methods, from the catalogue: every tile of every one is measured. */
const METHODS = catalogue.groups.map(libraryKey);
/** What the library must be found to mark: every marked flat tile, and every marked photograph with its visible moved
 *  stickers' count — the polygons a photograph is measured on are held to it. */
const TILE_IDS = Object.values(catalogue.rows).filter((row) => isMarked(row) && !isPhotographed(row)).map((row) => row.id).sort();
const VISIBLE_MOVED = Object.fromEntries(SETS.flatMap(([, rows]) => rows).filter((r) => r.photographed && r.tileMarked).map((r) => [r.id, r.visibleMoved]));
/**
 * The book's pages, CHOSEN BY WHAT THEY HOLD: the fewest rows (greedy) whose book pictures, in the three themes, mark
 * every (picture, sticker place, sticker colour, mark token) any row marks — a sticker's pixels on the page are decided
 * by those and by where the picture lies, so every distinct marked sticker the book can draw is measured. Opening every
 * row's page in 24 configurations would take an hour.
 */
const BOOK_IDS = (() => {
  const keysOf = (row) => new Set(THEMES.flatMap((th) => {
    const svg = bookPicture(row, regionOf(row), { ...LOOK, inks: THEME_INKS[th] });
    const frame = /viewBox="([^"]+)"/.exec(svg)[1];
    return [...svg.matchAll(/<rect class="moved" data-facelet="(\d+)" data-mark="(\w+)"([^>]*)>/g)]
      .map(([, f, mark, rest]) => `${th}|${frame}|${f}|${/ fill="([^"]+)"/.exec(rest)?.[1]}${/ fill-opacity="([^"]+)"/.exec(rest)?.[1] ?? ''}|${mark}`);
  }));
  const rows = Object.values(catalogue.rows).filter(isMarked).map((row) => [row.id, keysOf(row)]);
  const left = new Set(rows.flatMap(([, k]) => [...k]));
  const chosen = [];
  while (left.size) {
    let best = null; let most = 0;
    for (const [id, keys] of rows) { let n = 0; for (const k of keys) if (left.has(k)) n += 1; if (n > most) { most = n; best = [id, keys]; } }
    chosen.push(best[0]);
    for (const k of best[1]) left.delete(k);
  }
  return chosen;
})();
const DPRS = Object.freeze([1, 2]);

for (const engine of ['chromium', 'webkit']) {
  test(`in ${engine}, every mark meets WCAG 1.4.11 on the page — flat tile, photograph and book — in every theme at DPR 1 and 2`, async (t) => {
    assert.ok(TILE_IDS.length > 150, `precondition: only ${TILE_IDS.length} flat tiles mark a moved piece`);
    assert.ok(Object.keys(VISIBLE_MOVED).length > 250, `precondition: only ${Object.keys(VISIBLE_MOVED).length} marked photographs`);
    assert.ok(BOOK_IDS.length > 20, `precondition: only ${BOOK_IDS.length} book pages cover what the book marks`);
    const fixture = engine === 'chromium' ? chromium : await startBrowserFixture({ engine });
    const fails = [];
    const least = { tile: {}, photo: {}, book: {} };
    try {
      const configs = MARK_FIXTURES.flatMap((fx) => THEMES.flatMap((theme) => DPRS.map((dpr) => ({ fx, theme, dpr }))));
      // Three configurations at a time: each is its own context, and nothing judged depends on the clock.
      const run = async ({ fx, theme, dpr }) => {
        const at = `${engine} ${fx.name} ${theme} DPR ${dpr}`;
        const opts = { browser: fixture.browser, base: fixture.base, theme, dpr, timeout: LIVENESS_MS };
        const { page, context, problems } = await practiceAt(fx, opts);
        try {
          const all = [...await measureLibrary(page, { ...opts, methods: METHODS }), ...await measureBook(page, { ...opts, ids: BOOK_IDS })];
          // Every marked tile, photograph and book page judged — a gate that reads an empty list checks nothing.
          const ids = (what) => [...new Set(all.filter((m) => m.what === what).map((m) => m.id))].sort();
          assert.deepEqual(ids('tile'), TILE_IDS, `${at}: the flat tiles judged are not every marked flat tile`);
          assert.deepEqual(ids('photo'), Object.keys(VISIBLE_MOVED).sort(), `${at}: the photographs judged are not every marked photograph`);
          assert.deepEqual(ids('book'), [...BOOK_IDS].sort(), `${at}: the book pages judged are not the ones chosen`);
          const outlined = Object.fromEntries(ids('photo').map((id) => [id, all.filter((m) => m.what === 'photo' && m.id === id).length]));
          assert.deepEqual(Object.entries(outlined).filter(([id, n]) => n !== VISIBLE_MOVED[id]).map(([id, n]) => `${id}: ${n} outlined, ${VISIBLE_MOVED[id]} visible`), [],
            `${at}: a photograph outlines other stickers than its visible moved ones`);
          const say = (m) => `${at} ${m.what} ${m.id}#${m.f}`;
          for (const m of all) {
            if (!(m.contrast >= MARK_CONTRAST)) fails.push(`${say(m)}: (a) the band is ${m.contrast.toFixed(2)}:1 on its sticker`);
            if (!m.named) fails.push(`${say(m)}: (a) the band is not stroked in the token it names (${m.token})`);
            if (!m.drawnAsMeant) fails.push(`${say(m)}: (b) the band drawn is not the one outlineBand gives`);
            if (!(m.stroke >= MARK_STROKE_LEAST_PX - 1e-9)) fails.push(`${say(m)}: (b) the band is ${m.stroke.toFixed(2)} CSS px wide as drawn`);
            if (!(m.kept >= MARK_COLOUR_KEPT)) fails.push(`${say(m)}: (c) ${(100 * m.kept).toFixed(1)}% of the sticker keeps its own colour`);
            if (!(m.rendered > 0)) fails.push(`${say(m)}: the mark draws nothing`);
          }
          for (const what of ['tile', 'photo', 'book']) {
            const s = all.filter((m) => m.what === what);
            const lo = (k) => s.reduce((x, m) => (m[k] < x[k] ? m : x));
            for (const k of ['contrast', 'stroke', 'kept']) if (!least[what][k] || lo(k)[k] < least[what][k][k]) least[what][k] = { ...lo(k), at };
            t.diagnostic(`${at} ${what}: ${s.length} marked stickers; (a) least ${lo('contrast').contrast.toFixed(2)}:1 ${lo('contrast').id}#${lo('contrast').f}, `
              + `(b) least ${lo('stroke').stroke.toFixed(2)} px ${lo('stroke').id}, (c) least ${(100 * lo('kept').kept).toFixed(1)}% ${lo('kept').id}`);
          }
          assert.deepEqual(problems, [], `${at}: the page reported problems`);
        } finally {
          await context.close();
        }
      };
      const queue = [...configs];
      await Promise.all([0, 1, 2].map(async () => { while (queue.length) await run(queue.shift()); }));
    } finally {
      if (fixture !== chromium) await fixture.close();
    }
    for (const [what, l] of Object.entries(least)) {
      t.diagnostic(`${engine} ${what}, least of all: (a) ${l.contrast.contrast.toFixed(2)}:1 (${l.contrast.at} ${l.contrast.id}#${l.contrast.f}), `
        + `(b) ${l.stroke.stroke.toFixed(2)} CSS px (${l.stroke.at} ${l.stroke.id}), (c) ${(100 * l.kept.kept).toFixed(1)}% (${l.kept.at} ${l.kept.id})`);
    }
    assert.deepEqual(fails.slice(0, 12), [], `${fails.length} marks that do not meet WCAG 1.4.11 as E15 states it`);
  });
}

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
