// The library's case pictures, in node: what the photographer is asked to draw, which pieces a tile marks, and the
// outline a flat picture marks them with (dev-docs/practice-redesign-plan.md §3.1, §3.5, §3.6; WI-1).
//
// Every expectation is re-derived here from the case itself — the row's facelets, the layout's sticker tables and
// the ledger's own viewed case — never read back from the code under test, so a photograph of another case, a
// marking of another piece or an outline that recolours a sticker fails. The pixels (do the photographs tell the
// cases apart, does the marking show) are the browser suite's: test/browser/case-photos.test.mjs.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Window } from 'happy-dom';

import * as lib from '../lib/alg-library.js';
import { NET_KEPT, PHOTO_ATTRS, UNMARKED, casePhotographer, isMarked, isPhotographed, photoAttrs } from '../lib/case-photo.js';
import { CORNER_FACELETS, EDGE_FACELETS } from '../lib/cube-layout.js';
import { orientationPerm } from '../lib/cube-orientation.js';
import { CORNERS, EDGES } from '../lib/cube-pieces.js';
import { TOP_FREE, caseOf, movedPieces } from '../lib/drill/case-of.js';
import { catalogueOf } from '../lib/drill/library-client.js';
import { casePicture, outlineMoved } from '../lib/screens/practice/library-view.js';
import { THEME_INKS } from './fixtures/theme-inks.mjs';
import { holdSpec } from '../lib/solving-hold.js';

const catalogue = await catalogueOf(lib);
const rows = Object.values(catalogue.rows);
const netRows = rows.filter((r) => r.solves.picture === 'net');
/** The set's goal region as the LEDGER declares it — not as the catalogue carries it. */
const GOAL = Object.fromEntries(lib.ALG_SETS.map((s) => [s.id, s.goal?.region ?? null]));
const regionOf = (row) => catalogue.sets[row.set].region;
const LOOK = { palette: 'classic', scheme: 'western' };

/**
 * The pieces a case moves, re-derived from its FACELETS: a piece is moved when its home stickers do not read its own
 * name in order, and it is found where its colours now sit. The code under test reads the piece model's permutation
 * instead; the two must agree.
 */
function movedFromFacelets(row) {
  const { facelets, hold } = caseOf(row);
  const viewedOf = new Map(orientationPerm(...hold).map((scan, v) => [scan, v]));
  const out = [];
  for (const [names, slots] of [[CORNERS, CORNER_FACELETS], [EDGES, EDGE_FACELETS]]) {
    names.forEach((name, home) => {
      if (slots[home].map((f) => facelets[f]).join('') === name) return;
      const at = slots.findIndex((s) => [...s.map((f) => facelets[f])].sort().join('') === [...name].sort().join(''));
      assert.ok(at >= 0, `${row.id}: piece ${name} is nowhere on its case`);
      out.push({ name, viewed: slots[at].map((f) => viewedOf.get(f)) });
    });
  }
  // The F2L family's top layer is free: its pieces move, and the case is not about them.
  const top = hold[0];
  return TOP_FREE.includes(GOAL[row.set]) ? out.filter((p) => !p.name.includes(top)) : out;
}

test('the catalogue carries each set\'s goal region exactly as the ledger declares it', () => {
  for (const [id, set] of Object.entries(catalogue.sets)) assert.equal(set.region, GOAL[id], `${id}: region ${set.region}`);
  assert.deepEqual([...TOP_FREE].sort(), ['bottom-corners', 'cross', 'first-layer', 'first-two-layers']);
});

test('the photographer is asked for every net row\'s case exactly as the page\'s cube draws it, in the hold it starts in', () => {
  assert.ok(netRows.length >= 300, `${netRows.length} net rows`);
  for (const row of netRows) {
    const attrs = photoAttrs(row, regionOf(row));
    const c = caseOf(row);
    assert.equal(attrs.facelets, c.facelets, `${row.id}: photographs another case`);
    assert.equal(attrs.orientation, holdSpec(c.hold), `${row.id}: photographs another hold`);
  }
});

test('a marked flat picture draws the very case its marking is worked out from', () => {
  // The flat picture is the ledger's case; the marking is the page's case's moved pieces. Where a source writes a
  // finishing turn after the algorithm (Mehta's "(D)"), the two differ — so no marked flat picture may be such a row.
  let flat = 0;
  for (const row of rows.filter((r) => !isPhotographed(r) && isMarked(r))) {
    const c = caseOf(row);
    const viewed = orientationPerm(...c.hold).map((scan) => c.facelets[scan]).join('');
    assert.equal(viewed, row.solves.facelets, `${row.id}: outlines the pieces of another case than it draws`);
    flat += 1;
  }
  assert.ok(flat > 200, `${flat} marked flat pictures`);
});

test('the photographer sets the case, its hold, its marking and ghosts off — and nothing else: never `focus`', () => {
  for (const row of rows) {
    const attrs = photoAttrs(row, regionOf(row));
    assert.deepEqual(Object.keys(attrs).sort(), [...PHOTO_ATTRS].sort(), `${row.id}: sets ${Object.keys(attrs)}`);
    assert.equal(attrs.ghosts, 'none');
    assert.ok(!('focus' in attrs), `${row.id}: greys stickers`);
  }
  assert.deepEqual([...PHOTO_ATTRS].sort(), ['facelets', 'ghosts', 'highlight', 'orientation']);
});

test('a photograph marks exactly the pieces its case moves, re-derived from the facelets — and the F2L family\'s free top is not marked', () => {
  let marked = 0;
  for (const row of rows) {
    const want = movedFromFacelets(row);
    const got = movedPieces(row, regionOf(row));
    assert.deepEqual([...got.names].sort(), want.map((p) => p.name).sort(), `${row.id}: marks other pieces`);
    const byName = new Map(want.map((p) => [p.name, p.viewed]));
    got.names.forEach((n, i) => assert.deepEqual(got.viewed[i], byName.get(n), `${row.id}: ${n} marked where it is not`));
    const { highlight } = photoAttrs(row, regionOf(row));
    if (!isMarked(row)) { assert.equal(highlight, 'none', `${row.id}: a set on the unmarked list is marked`); continue; }
    assert.ok(want.length > 0, `${row.id}: a case that moves nothing`);
    assert.deepEqual(highlight.split(',').sort(), want.map((p) => `piece:${p.name}`).sort(), `${row.id}: highlights other pieces`);
    marked += 1;
  }
  assert.ok(marked > 500, `${marked} rows marked`);
});

test('the outline marks exactly the moved pieces\' drawn stickers, and recolours nothing', () => {
  const win = new Window();
  try {
    const rects = (svg) => {
      const box = win.document.createElement('div');
      box.innerHTML = svg;
      return [...box.querySelectorAll('rect')];
    };
    for (const row of rows) {
      const plain = casePicture(row, LOOK);
      const { viewed } = movedPieces(row, regionOf(row));
      const before = rects(plain);
      const after = rects(outlineMoved(plain, viewed.flat(), { inks: THEME_INKS.white }));
      assert.equal(after.length, before.length, `${row.id}: the outline added or lost stickers`);
      const drawn = new Set(before.map((r) => Number(r.getAttribute('data-facelet'))));
      const want = movedFromFacelets(row).flatMap((p) => p.viewed).filter((f) => drawn.has(f)).sort((a, b) => a - b);
      const outlined = after.filter((r) => r.classList.contains('moved')).map((r) => Number(r.getAttribute('data-facelet'))).sort((a, b) => a - b);
      assert.deepEqual(outlined, want, `${row.id}: outlines other stickers`);
      before.forEach((r, i) => {
        const a = after[i];
        assert.equal(a.getAttribute('data-facelet'), r.getAttribute('data-facelet'));
        // Never greyed, never recoloured (AGENTS.md §2): every fill and its opacity as the bare picture has them.
        for (const k of ['fill', 'fill-opacity', 'style']) {
          assert.equal(a.getAttribute(k), r.getAttribute(k), `${row.id}: sticker ${r.getAttribute('data-facelet')} changed its ${k}`);
        }
        // Never resized: a moved sticker's band lies INSIDE its edge (E14), so the stroke's outer edge is the sticker's.
        const half = a.classList.contains('moved') ? Number(a.getAttribute('stroke-width')) / 2 : 0;
        for (const [k, sign] of [['x', -1], ['y', -1], ['width', 2], ['height', 2]]) {
          const outer = Number(a.getAttribute(k)) + sign * half;
          assert.ok(Math.abs(outer - Number(r.getAttribute(k))) <= 0.011, `${row.id}: sticker ${r.getAttribute('data-facelet')} changed its ${k}`);
        }
        if (!a.classList.contains('moved')) assert.equal(a.outerHTML, r.outerHTML, `${row.id}: an unmoved sticker changed`);
      });
    }
  } finally {
    win.happyDOM.close();
  }
});

test('no two cases of any set agree on every sticker the photograph shows — the up, right and front faces', () => {
  for (const [id, set] of Object.entries(catalogue.sets)) {
    const seen = new Map();
    for (const rowId of set.ids) {
      const f = catalogue.rows[rowId].solves.facelets;
      const shown = f.slice(0, 27);
      const other = seen.get(shown);
      assert.ok(other === undefined || other === f, `${id}: ${rowId} differs from another case only on faces the camera cannot see`);
      seen.set(shown, f);
    }
  }
});

test('the keep list and the unmarked list name sets that hold net rows, and decide which rows are photographed and marked', () => {
  for (const id of [...NET_KEPT, ...UNMARKED]) {
    assert.ok(catalogue.sets[id], `${id} is not a set`);
    assert.ok(catalogue.sets[id].ids.some((r) => catalogue.rows[r].solves.picture === 'net'), `${id} holds no net row`);
  }
  for (const row of rows) {
    assert.equal(isPhotographed(row), row.solves.picture === 'net' && !NET_KEPT.includes(row.set), `${row.id}`);
    assert.equal(isMarked(row), !UNMARKED.includes(row.set), `${row.id}`);
  }
});

test('the photographer refuses anything but the four attributes it may set, before it borrows a renderer', async () => {
  const photographer = casePhotographer({ host: null, signal: new AbortController().signal });
  const row = netRows[0];
  await assert.rejects(photographer.photo({ ...photoAttrs(row, regionOf(row)), focus: 'piece:URF' }), /sets only/);
  const { ghosts, ...noGhosts } = photoAttrs(row, regionOf(row));
  assert.equal(ghosts, 'none');
  await assert.rejects(photographer.photo(noGhosts), /sets only/);
  await assert.rejects(photographer.photo({ ...photoAttrs(row, regionOf(row)), ghosts: 'floating' }), /ghosts/);
});

// MEASUREMENT 2 of the plan (§3.6), re-run: of each tile's moved pieces, how many have a sticker its picture draws —
// the camera's up, right and front faces (viewed 0-26) for a photograph, the drawn rects for a flat picture. Recorded,
// never asserted as a target: the plan's numbers are a measurement, and the totals are what the reader compares.
test('measurement 2: how many tiles show every piece they mark (recorded)', (t) => {
  const totals = { tiles: 0, photographs: 0, allVisible: 0, someHidden: 0, noneVisible: 0 };
  for (const row of rows) {
    totals.tiles += 1;
    const photo = isPhotographed(row);
    if (photo) totals.photographs += 1;
    const pieces = movedPieces(row, regionOf(row)).viewed;
    const drawn = new Set([...casePicture(row, LOOK).matchAll(/data-facelet="(\d+)"/g)].map((m) => Number(m[1])));
    const seen = pieces.filter((vs) => vs.some((f) => (photo ? f < 27 : drawn.has(f)))).length;
    if (seen === pieces.length) totals.allVisible += 1; else if (seen === 0) totals.noneVisible += 1; else totals.someHidden += 1;
  }
  t.diagnostic(`measurement 2: ${JSON.stringify(totals)}`);
  assert.equal(totals.tiles, rows.length);
});
