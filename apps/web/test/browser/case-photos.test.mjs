// The library's case photographs, taken by the app's own photographer (lib/case-photo.js) in real browsers
// (dev-docs/practice-redesign-plan.md §3.3, §3.5, §3.6; WI-1).
//
// CHROMIUM measures. It draws WebGL with the same software rasteriser on every machine (AGENTS.md §7), so its pixels
// can decide things: every net row is photographed, bare and marked, and the plan's criterion is applied to every
// set — two pictures LOOK ALIKE when, drawn as a tile shows them (contained in its picture box at DPR 2, on white) and
// cropped to their painted content, fewer than 2% of those pixels differ by more than 48/255 in any channel. From that the keep list and the unmarked list are
// RE-DERIVED, both ways, by the rules that made them; a list that no longer matches its rule fails here, and is
// changed by measuring, never by editing.
//
// WEBKIT checks only that every photograph decodes and paints: its pixels are not reproducible across machines.
//
// Any warning the renderer prints fails a case: "highlight matched nothing" is a marking that silently drew nothing.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import * as lib from '../../lib/alg-library.js';
import { NET_KEPT, UNMARKED, isMarked, isPhotographed, photoAttrs } from '../../lib/case-photo.js';
import { movedPieces } from '../../lib/drill/case-of.js';
import { catalogueOf } from '../../lib/drill/library-client.js';
import { casePicture, outlineMoved } from '../../lib/screens/practice/library-view.js';
import { LIVENESS_MS, startBrowserFixture } from './harness.mjs';

const catalogue = await catalogueOf(lib);
const LOOK = { palette: 'classic', scheme: 'western' };
/** The share of each visible moved sticker's own painted pixels its marking must change by more than 48/255 (plan E8). */
const MARK_SEEN = 0.25;
const regionOf = (row) => catalogue.sets[row.set].region;
/** Every set that holds rows, and what each of its rows is drawn as, every way the rules compare. */
const SETS = Object.entries(catalogue.sets).filter(([, s]) => s.ids.length).map(([id, s]) => [id, s.ids.map((rowId) => {
  const row = catalogue.rows[rowId];
  const today = casePicture(row, LOOK);
  const net = row.solves.picture === 'net';
  const bare = net ? photoAttrs(row, regionOf(row), { mark: false }) : null;
  return {
    id: rowId,
    // Rows that are one case are one picture by construction, and are not counted as alike.
    key: net ? `${bare.orientation}|${bare.facelets}` : `viewed|${row.solves.facelets}`,
    today,
    outlined: outlineMoved(today, movedPieces(row, regionOf(row)).viewed.flat()),
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
async function photoPage(fixture) {
  const context = await fixture.browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
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
    /** A picture as a tile shows it: contained in the picture box at DPR 2, on nothing, with the box it paints. */
    const draw = async (p) => {
      const img = await load(srcOf(p));
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const g = cv.getContext('2d');
      const k = Math.min(W / img.width, H / img.height);
      g.drawImage(img, (W - img.width * k) / 2, (H - img.height * k) / 2, img.width * k, img.height * k);
      const px = g.getImageData(0, 0, W, H).data;
      // Over white, as the tile's light page shows it.
      const rgb = new Uint8ClampedArray((px.length / 4) * 3);
      for (let i = 0, j = 0; i < px.length; i += 4, j += 3) {
        for (let c = 0; c < 3; c += 1) rgb[j + c] = (px[i + c] * px[i + 3] + 255 * (255 - px[i + 3])) / 255;
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
    window.__photos = { photo, photographer, draw, differ, alike, stickerShares, hash, done };
  });
  return { page, context, problems };
}

// ---- Chromium: the measurement ------------------------------------------------------------------------------------

let chromium;
before(async () => { chromium = await startBrowserFixture({ engine: 'chromium' }); });
after(async () => { await chromium?.close(); });

test('every set tells its cases apart as the tiles show them, and both lists re-derive from their rules, both ways', async (t) => {
  const { page, context, problems } = await photoPage(chromium);
  try {
    const measured = await page.evaluate(async (sets) => {
      const { photographer, draw, alike, stickerShares } = window.__photos;
      const out = {};
      for (const [id, rows] of sets) {
        const shot = async (attrs) => {
          const url = await photographer.photo(attrs);
          if (!url) throw new Error(`${id}: the photographer gave no photograph`);
          return url;
        };
        const keys = rows.map((r) => r.key);
        const px = { today: [], outlined: [], bare: [], marked: [], shown: [] };
        const emphasis = [];
        for (const r of rows) {
          const today = await draw(r.today);
          const outlined = await draw(r.outlined);
          const bareUrl = r.bare ? await shot(r.bare) : null;
          const markedUrl = r.marked ? await shot(r.marked) : null;
          const bare = bareUrl ? await draw(bareUrl) : today;
          const marked = markedUrl ? await draw(markedUrl) : outlined;
          px.today.push(today); px.outlined.push(outlined); px.bare.push(bare); px.marked.push(marked);
          // What the tile shows: a photograph, marked unless unmarked; a flat picture, outlined unless unmarked.
          px.shown.push(r.photographed ? (r.tileMarked ? marked : bare) : (r.tileMarked ? outlined : today));
          if (r.photographed && r.tileMarked) emphasis.push({ id: r.id, visible: r.visibleMoved, shares: await stickerShares(markedUrl, bareUrl) });
        }
        out[id] = Object.fromEntries(Object.entries(px).map(([k, v]) => [k, alike(v, keys)]));
        out[id].emphasis = emphasis;
      }
      return out;
    }, SETS);
    const keeps = Object.keys(measured).filter((id) => measured[id].bare.alike > measured[id].today.alike).sort();
    const unmarked = Object.keys(measured).filter((id) => (keeps.includes(id)
      ? measured[id].outlined.alike > measured[id].today.alike
      : measured[id].marked.alike > measured[id].bare.alike)).sort();
    const emphasis = Object.values(measured).flatMap((m) => m.emphasis);
    const stickers = emphasis.flatMap((e) => e.shares.map((share) => ({ id: e.id, share }))).sort((a, b) => a.share - b.share);
    t.diagnostic(`marking on photographs, per visible moved sticker, by 48/255: ${emphasis.length} photographs, ${stickers.length} stickers, `
      + `median ${stickers[stickers.length >> 1]?.share.toFixed(4)}, smallest ${stickers.slice(0, 4).map((x) => `${x.id} ${x.share.toFixed(4)}`).join(', ')}`);
    for (const [id, m] of Object.entries(measured)) {
      t.diagnostic(`${id}: today ${m.today.alike}/${m.today.min}, photographed ${m.bare.alike}/${m.bare.min}, marked ${m.marked.alike}/${m.marked.min}, shown ${m.shown.alike}/${m.shown.min}`);
    }
    assert.deepEqual(keeps, [...NET_KEPT].sort(), 'the keep list is not what its rule computes');
    assert.deepEqual(unmarked, [...UNMARKED].sort(), 'the unmarked list is not what its rule computes');
    // R8: as the tiles show them, no two cases of any set look alike.
    for (const [id, m] of Object.entries(measured)) assert.equal(m.shown.alike, 0, `${id}: ${m.shown.alike} pairs of cases look alike as shown`);
    // E8 (amended): a mark is SEEN AT ITS STICKER. The outline is drawn on exactly the moved stickers the camera sees —
    // no fewer, no more — and every one of them has at least 25% of its own painted pixels changed by more than 48/255
    // against the photograph unmarked. A share of the whole picture punished a case with one visible moved sticker,
    // whose whole-sticker ceiling is 1.6% (f2l:0c06, measured 2026-10-18).
    assert.ok(emphasis.length > 250, `${emphasis.length} marked photographs`);
    const ids = new Set(emphasis.map((x) => x.id));
    for (const id of ['right-half', 'left-half', 'f2l:0c06', 'f2l:0c07']) assert.ok(ids.has(id), `precondition: ${id} is a marked photograph`);
    assert.deepEqual(emphasis.filter((e) => e.shares.length !== e.visible).map((e) => `${e.id}: ${e.shares.length} outlined, ${e.visible} visible`), [],
      'a photograph outlines other stickers than its visible moved ones');
    assert.deepEqual(stickers.filter((x) => x.share < MARK_SEEN).map((x) => `${x.id} ${(100 * x.share).toFixed(1)}%`), [],
      `marked stickers whose marking changes under ${100 * MARK_SEEN}% of the sticker at 48/255`);
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
