// The library's case photographs, taken by the app's own photographer (lib/case-photo.js) in real browsers
// (dev-docs/practice-redesign-plan.md §3.3, §3.5, §3.6; WI-1).
//
// CHROMIUM measures. It draws WebGL with the same software rasteriser on every machine (AGENTS.md §7), so its pixels
// can decide things: every net row is photographed, bare and marked, and the plan's criterion is applied to every
// set — two pictures LOOK ALIKE when, drawn contained into the 62×54 tile box at DPR 2 on white, fewer than 2% of the
// box's pixels differ by more than 48/255 in any channel. From that the keep list and the unmarked list are
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
    const done = new AbortController();
    const photographer = photo.casePhotographer({ host: document.querySelector('.practice-screen'), signal: done.signal });
    const W = 62 * 2; const H = 54 * 2;
    const load = (src) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error(`a picture did not decode: ${src.slice(0, 60)}`)); i.src = src; });
    const srcOf = (p) => (p.startsWith('<svg') ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(p)}` : p);
    /** A picture drawn contained into the tile box at DPR 2 — on white, or on nothing to see what it paints. */
    const draw = async (p, white = true) => {
      const img = await load(srcOf(p));
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const g = cv.getContext('2d');
      if (white) { g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, W, H); }
      const k = Math.min(W / img.width, H / img.height);
      g.drawImage(img, (W - img.width * k) / 2, (H - img.height * k) / 2, img.width * k, img.height * k);
      return g.getImageData(0, 0, W, H).data;
    };
    /** The share of the box two pictures differ on by more than `by` in any channel — 48/255 is the criterion's. */
    const differ = (a, b, by = 48) => {
      let d = 0;
      for (let i = 0; i < a.length; i += 4) if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > by) d += 1;
      return d / (W * H);
    };
    /** Pairs of different cases that look alike, and the nearest pair. */
    const alike = (px, keys) => {
      let n = 0; let min = 1;
      for (let i = 0; i < px.length; i += 1) {
        for (let j = i + 1; j < px.length; j += 1) {
          if (keys[i] === keys[j]) continue;
          const v = differ(px[i], px[j]);
          min = Math.min(min, v);
          if (v < 0.02) n += 1;
        }
      }
      return { alike: n, min: Number(min.toFixed(4)) + 0 };
    };
    const hash = async (url) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await (await fetch(url)).arrayBuffer()))]
      .map((b) => b.toString(16).padStart(2, '0')).join('');
    window.__photos = { photo, photographer, draw, differ, alike, hash, done };
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
      const { photographer, draw, differ, alike } = window.__photos;
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
          const bare = r.bare ? await draw(await shot(r.bare)) : today;
          const marked = r.marked ? await draw(await shot(r.marked)) : outlined;
          px.today.push(today); px.outlined.push(outlined); px.bare.push(bare); px.marked.push(marked);
          // What the tile shows: a photograph, marked unless unmarked; a flat picture, outlined unless unmarked.
          px.shown.push(r.photographed ? (r.tileMarked ? marked : bare) : (r.tileMarked ? outlined : today));
          if (r.photographed && r.tileMarked) emphasis.push({ id: r.id, share: differ(marked, bare), changed: differ(marked, bare, 0) });
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
    for (const [id, m] of Object.entries(measured)) {
      t.diagnostic(`${id}: today ${m.today.alike}/${m.today.min}, photographed ${m.bare.alike}/${m.bare.min}, marked ${m.marked.alike}/${m.marked.min}, shown ${m.shown.alike}/${m.shown.min}`);
    }
    assert.deepEqual(keeps, [...NET_KEPT].sort(), 'the keep list is not what its rule computes');
    assert.deepEqual(unmarked, [...UNMARKED].sort(), 'the unmarked list is not what its rule computes');
    // R8: as the tiles show them, no two cases of any set look alike.
    for (const [id, m] of Object.entries(measured)) assert.equal(m.shown.alike, 0, `${id}: ${m.shown.alike} pairs of cases look alike as shown`);
    // Every photographed tile's marking changes its picture — a highlight that resolved to nothing would not. Counted
    // as ANY change: the renderer's highlight is light in each sticker's own colour, and on already-light stickers it
    // changes a tile by less than the 48/255 the alike criterion uses (measured 2026-10-18: four tiles, by at most 45).
    const shares = Object.values(measured).flatMap((m) => m.emphasis);
    assert.ok(shares.length > 250, `${shares.length} marked photographs`);
    for (const { id, changed } of shares) assert.ok(changed > 0, `${id}: its marking changes nothing in its picture`);
    const sorted = [...shares].sort((a, b) => a.share - b.share);
    t.diagnostic(`marking on photographs, by the criterion's 48/255: ${sorted.length} tiles, median ${sorted[sorted.length >> 1].share.toFixed(4)}, `
      + `under 0.5%: ${sorted.filter((x) => x.share < 0.005).length}, none: ${sorted.filter((x) => x.share === 0).map((x) => `${x.id} (any change ${x.changed.toFixed(4)})`).join(', ') || 'no tile'}`);
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
        const px = await draw(url, false);
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
