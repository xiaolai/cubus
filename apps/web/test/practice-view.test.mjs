// The Practice screen's pure parts, in node: what the library draws, what the page prints, what the record's
// figures say — and the lesson's way in (dev-docs/algorithm-drill-v2-plan.md §4, WI-10 and WI-12;
// dev-docs/practice-redesign-plan.md §4, WI-3: the library as tiles).
//
// The relation the browser suite proves end to end — the page prints the moves the engine judges — has its
// first half here, over EVERY ledger row: the chips are the row's own text, one turn per chip, in order.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, test } from 'node:test';

import Cube from 'cubejs';
import { Window } from 'happy-dom';

import * as lib from '../lib/alg-library.js';
import { isLibraryKey } from '../lib/app-settings.js';
import { parse } from '../lib/cube-notation.js';
import { netSvg } from '../lib/cube-flat.js';
import { PAUSE_FACTOR, TIME_REFUSAL } from '../lib/drill/timing.js';
import { fingersOf, statsOf } from '../lib/drill/record.js';
import { catalogueOf, pendingName } from '../lib/drill/library-client.js';
import { registerLocale, setLocale, t } from '../lib/i18n.js';
import { methodById } from '../lib/methods/registry.js';
import { targetPicture } from '../lib/stage-picture.js';
import {
  aboutHtml, bodyHtml, captionOf, casePicture, gridIds, libraryKey, libraryMethods, openingKey, pendingHtml, purposeOf, railHtml, ringSvg,
  BOOK_OUTLINE, TILE_OUTLINE, bookPicture, markedPicture, rowName, stageIds, tileLabel, tilePicture, tileRing, tilesHtml,
} from '../lib/screens/practice/library-view.js';
import { isMarked, isPhotographed, markInk } from '../lib/case-photo.js';
import { contrastOf } from '../lib/contrast.js';
import { THEME_INKS } from './fixtures/theme-inks.mjs';
import { movedPieces } from '../lib/drill/case-of.js';
import { isAbsent } from './dom-assert.mjs';
import { paletteFor } from '../lib/scheme.js';
import { STICKER_PALETTES } from '../lib/sticker-palettes.js';
import {
  RECORD_READING, REFUSAL_CODES, beadsHtml, chipsHtml, figuresHtml, fingersWords, lastRepsHtml, pageHtml, partsWords, refusalWords,
  segmentsOf, writtenTokens,
} from '../lib/screens/practice/page-view.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const catalogue = await catalogueOf(lib);
const look = { palette: 'classic', scheme: 'western', inks: THEME_INKS.white };
const ico = (name) => `<svg class="ic" data-icon="${name}"></svg>`;
// ONE window for the file: a happy-dom window per row cost a minute.
const win = new Window();
after(() => win.happyDOM.close());
const parsed = (html) => {
  const box = win.document.createElement('div');
  box.innerHTML = html;
  return box;
};
/** Every method's library as it first draws — its rail and its stages, every grid empty — parsed once. */
const drawn = catalogue.groups.map((g) => ({ group: g, rail: parsed(railHtml(g, catalogue, look, esc)), body: parsed(bodyHtml(g, catalogue, look, esc, ico)) }));
/** Every grid of every method filled as the screen fills a grid that comes near the view (`tilesHtml`) — rendered
 *  ONCE and parsed once: five hundred tiles with their pictures cost seconds to parse. */
const filled = drawn.map(({ group }) => {
  const body = parsed(bodyHtml(group, catalogue, look, esc, ico));
  for (const grid of body.querySelectorAll('.tiles')) grid.innerHTML = tilesHtml(gridIds(catalogue, grid.dataset.set, grid.dataset.part), catalogue, look, esc);
  return { group, body };
});
const allTiles = filled.flatMap(({ body }) => [...body.querySelectorAll('[data-alg]')]);

test('the library draws every stage of its method with its grids EMPTY, and a grid\'s tiles are exactly its rows, in the source\'s order', () => {
  // What must NOT happen: every tile and picture of a method built at every visit (audit row 26, 208 ms in WebKit).
  for (const { group, body } of drawn) {
    assert.equal(body.querySelectorAll('[data-alg]').length, 0, `${libraryKey(group)}: a tile was built before its grid came near the view`);
    assert.equal(body.querySelectorAll('.tiles svg, .tiles .case-photo').length, 0, `${libraryKey(group)}: a case picture was drawn`);
    const sections = [...body.querySelectorAll('.stage-sec')];
    assert.equal(sections.length, group.phases.length, `${libraryKey(group)}: a stage is not drawn`);
    for (const [i, sec] of sections.entries()) {
      // A stage's grids hold its rows, each once, and every grid keeps the source's order inside it — OLL's edges-up
      // groups are the one regrouping (the OLL case below), so the stage as a whole is compared as a set.
      const grids = [...sec.querySelectorAll('.tiles')];
      const ids = grids.flatMap((g) => gridIds(catalogue, g.dataset.set, g.dataset.part));
      assert.deepEqual([...ids].sort(), [...stageIds(catalogue, group.phases[i])].sort(), `${libraryKey(group)}/${group.phases[i].phase}: the grids do not hold the stage's rows`);
      assert.equal(new Set(ids).size, ids.length, 'a row in two grids of one stage');
      for (const g of grids) {
        const here = gridIds(catalogue, g.dataset.set, g.dataset.part);
        assert.deepEqual(here, catalogue.sets[g.dataset.set].ids.filter((id) => here.includes(id)), `${g.dataset.set}: a grid out of the source's order`);
      }
    }
  }
  for (const set of Object.values(catalogue.sets)) {
    const box = parsed(tilesHtml(set.ids, catalogue, look, esc));
    assert.deepEqual([...box.querySelectorAll('[data-alg]')].map((c) => c.dataset.alg), set.ids, `${set.id}: its tiles are not its rows, in order`);
  }
});

test('the library lists every ledger row, and nothing the ledger does not hold', async () => {
  const ids = await lib.algIds();
  assert.ok(ids.length > 300, `the ledger read as ${ids.length} rows`);
  const listed = new Set(catalogue.groups.flatMap((g) => g.phases.flatMap((p) => stageIds(catalogue, p))));
  assert.deepEqual([...listed].sort(), [...ids].sort(), 'a row is missing from the library, or one is listed that the ledger lacks');
  // The proved tables are taught by no method, and still listed — last, as their own entry.
  const last = catalogue.groups.at(-1);
  assert.equal(last.method, null);
  assert.equal(libraryKey(last), 'tables');
  for (const id of ['f2l-full', 'oll-full', 'pll-full']) assert.ok(last.phases[0].sets.includes(id), `${id} is not listed`);
  // Rendered, every row is a tile (a set taught by several methods is listed under each).
  assert.deepEqual([...new Set(allTiles.map((b) => b.dataset.alg))].sort(), [...ids].sort());
});

test('the methods the library offers: one key each, a level each, and the solve tab\'s levels for the methods it walks', () => {
  const methods = libraryMethods(catalogue);
  assert.deepEqual(methods.map((m) => m.id), catalogue.groups.map(libraryKey));
  assert.equal(new Set(methods.map((m) => m.id)).size, methods.length, 'two methods share a key');
  for (const m of methods) assert.ok(isLibraryKey(m.id), `${m.id} is not a key settings would keep`);
  assert.deepEqual(methods.map((m) => m.id), ['beginner', 'cfop-4lll', 'cfop', 'roux', 'mehta', 'mehta-beginner-path', 'corners-first', 'tables']);
  for (const [i, g] of catalogue.groups.entries()) {
    // A method the app's solver walks sits under its registry level; the rest under the library's two groups.
    const want = g.method ? methodById(g.method).level : g.label ? 'not-in-solver' : 'tables';
    assert.equal(methods[i].level, want, `${methods[i].id} is filed under ${methods[i].level}`);
  }
  // Quick teaches no algorithm (D1): it is not a library method, and Petrus and ZZ are not listed (D5).
  for (const absent of ['quick', 'petrus', 'zz']) assert.ok(!methods.some((m) => m.id === absent), `${absent} is offered`);
});

test('the library opens on its own choice, else the solve tab\'s method, and Quick opens on Beginner\'s 12', () => {
  const rows = (key) => catalogue.groups.find((g) => libraryKey(g) === key).phases.flatMap((p) => stageIds(catalogue, p));
  assert.equal(openingKey(catalogue, { practiceMethod: null, solveMethod: 'quick' }), 'beginner', 'Quick does not open on Beginner');
  assert.equal(rows('beginner').length, 12, 'Beginner does not hold the 12 the plan counted');
  assert.equal(openingKey(catalogue, { practiceMethod: null, solveMethod: 'cfop' }), 'cfop');
  assert.equal(openingKey(catalogue, { practiceMethod: null, solveMethod: 'roux' }), 'roux');
  // CFOP (full): 124 across three stages.
  const cfop = catalogue.groups.find((g) => libraryKey(g) === 'cfop');
  assert.deepEqual([cfop.phases.length, rows('cfop').length], [3, 124], 'CFOP (full) is not 124 tiles across three stages');
  // The library's own choice wins — a method the solve tab cannot walk included.
  assert.equal(openingKey(catalogue, { practiceMethod: 'mehta', solveMethod: 'cfop' }), 'mehta');
  // A well-shaped key the library does not hold (a method renamed since it was stored) follows the solve tab.
  assert.equal(openingKey(catalogue, { practiceMethod: 'petrus', solveMethod: 'cfop' }), 'cfop');
});

test('a tile\'s caption is the name its source gives the case, or nothing — never the row\'s id', () => {
  // Plan WI-2 (dev-docs/practice-redesign-plan.md §4.2, owner decision D5): a hand-written row is picture-only, and an
  // id is a key, not a name a learner can say. Over EVERY row, with the totals counted so a sweep over nothing fails.
  const rows = Object.values(catalogue.rows);
  assert.equal(rows.length, 583, 'the catalogue is not the 583 rows the plan counted');
  let unnamed = 0;
  for (const row of rows) {
    const caption = captionOf(row);
    assert.notEqual(caption, row.id, `${row.id}: captioned by its id`);
    if (row.nickname === null && row.label === null) {
      assert.equal(caption, null, `${row.id}: the source names no case, and the tile is captioned "${caption}"`);
      unnamed += 1;
      continue;
    }
    // The source's own words, the nickname first ("Sune", not "OLL 27"), and never empty.
    assert.equal(caption, row.nickname ?? row.label, `${row.id}: the caption is not the source's name`);
    assert.ok(typeof caption === 'string' && caption.trim().length > 0, `${row.id}: an empty caption`);
  }
  assert.equal(unnamed, 422, 'the rows with no sourced name are not the 422 the plan counted');
  // D5, read off the set's kind rather than a list: no hand-written or proved row has a name to show.
  for (const row of rows.filter((r) => ['hand-written', 'proved'].includes(catalogue.sets[r.set].kind))) {
    assert.equal(captionOf(row), null, `${row.id} is ${catalogue.sets[row.set].kind} and is captioned`);
  }
  // What must not happen: a row the source does not name, captioned by what the old card fell back to.
  assert.equal(captionOf({ id: 'sune', label: null, nickname: null }), null);
  assert.notEqual(rowName({ id: 'sune', label: null, nickname: null }), null, 'rowName still names a row for assistive tech');
  // Drawn: a tile carries its caption, or no caption element at all — never an id.
  for (const tile of allTiles) {
    const row = catalogue.rows[tile.dataset.alg];
    const cap = tile.querySelector('.cap');
    if (captionOf(row) === null) assert.equal(cap, null, `${row.id}: a caption element with no name`);
    else assert.equal(cap?.textContent, captionOf(row), `${row.id}: the tile is not captioned with its name`);
  }
});

test('OLL is grouped by how many top edges are up: counted from each case, 8 / 42 / 7 in both OLL sets', () => {
  // Re-derived OUTSIDE the catalogue (AGENTS.md §5): cubejs plays the row's algorithm backwards from solved — its own
  // parser, not this repository's interpreter, which drew `solves.facelets` — and the top face's edge stickers that
  // match the top centre are counted. Every algorithm ends held as it began, so the top centre is still on top.
  const counted = Object.entries(catalogue.sets).filter(([, s]) => s.edgesUp !== null).map(([id]) => id);
  assert.deepEqual(counted.sort(), ['oll-full', 'oll-human'], 'the sets grouped by top edges up are not the two full OLL sets');
  for (const id of counted) {
    const set = catalogue.sets[id];
    assert.deepEqual(Object.keys(set.edgesUp).sort(), [...set.ids].sort(), `${id}: a row is not counted, or a stranger is`);
    const totals = { 0: 0, 2: 0, 4: 0 };
    for (const rowId of set.ids) {
      const cube = new Cube();
      cube.move(Cube.inverse(catalogue.rows[rowId].alg));
      const top = cube.asString();
      const up = [1, 3, 5, 7].filter((i) => top[i] === top[4]).length;
      assert.equal(set.edgesUp[rowId], up, `${id}/${rowId}: ${set.edgesUp[rowId]} top edges up, and cubejs counts ${up}`);
      totals[up] += 1;
    }
    assert.deepEqual(totals, { 0: 8, 2: 42, 4: 7 }, `${id}: the edges-up groups are not 8 / 42 / 7`);
    // DRAWN as three captioned grids, none to all four, the source's order inside each.
    for (const { body } of drawn) {
      const grids = [...body.querySelectorAll(`.tiles[data-set="${id}"]`)];
      if (!grids.length) continue;
      assert.deepEqual(grids.map((g) => g.dataset.part), ['0', '2', '4'], `${id}: not three edges-up grids`);
      assert.deepEqual(grids.map((g) => g.previousElementSibling?.textContent), ['No top edge up', 'Two top edges up', 'All four top edges up']);
      for (const g of grids) {
        const ids = gridIds(catalogue, id, g.dataset.part);
        assert.deepEqual(ids, set.ids.filter((r) => String(set.edgesUp[r]) === g.dataset.part), `${id}/${g.dataset.part}: not the source's order`);
      }
    }
  }
});

test('the sources not yet in the ledger are named, from their ids, as pending', () => {
  assert.deepEqual(catalogue.pending.map((p) => p.id), lib.PENDING_SOURCES.map((p) => p.id));
  assert.equal(pendingName('mehta-algs'), 'Mehta');
  assert.equal(pendingName('corners-first-algs'), 'Corners first');
  const note = parsed(pendingHtml(catalogue, esc)).querySelector('[data-pending]');
  if (lib.PENDING_SOURCES.length) {
    assert.ok(note, 'nothing says the pending sources are missing');
    for (const p of catalogue.pending) assert.match(note.textContent, new RegExp(p.name));
  } else assert.equal(note, null, 'a pending note with nothing pending');
  // And one made up, so the words are checked even while nothing is pending.
  const made = parsed(pendingHtml({ pending: [{ id: 'x-algs', name: 'Xmethod' }] }, esc)).querySelector('[data-pending]');
  assert.match(made.textContent, /Xmethod/);
});

test('no prose in the library: no set\'s purpose and no row\'s sentence anywhere it draws — they wait in the book menu', () => {
  // R1 (dev-docs/practice-redesign-plan.md §0): the library is pictures until a reader asks. Asserted as an absence
  // over every method's rail, stages and filled grids, so a sentence that crept onto a tile or a header fails here.
  const sentences = [...new Set([
    ...Object.values(catalogue.sets).map((s) => s.purpose),
    ...Object.values(catalogue.rows).flatMap((r) => [r.says, r.purpose]),
  ].filter((s) => typeof s === 'string' && s.length > 24))];
  assert.ok(sentences.length > 100, `precondition: ${sentences.length} sentences to look for`);
  const text = [...drawn.map(({ rail }) => rail.textContent), ...filled.map(({ body }) => body.textContent)].join('\n');
  const said = sentences.filter((s) => text.includes(s));
  assert.deepEqual(said, [], 'a purpose or a sentence is drawn in the library');
  assert.equal(filled.reduce((n, { body }) => n + body.querySelectorAll('[aria-describedby]').length, 0), 0, 'a tile is described by a sentence');
  // The book menu says each of the stage's sets' purpose, once, under the set's name.
  for (const { group } of drawn) {
    for (const phase of group.phases) {
      const about = parsed(aboutHtml(phase, catalogue, esc));
      for (const id of phase.sets) {
        const set = catalogue.sets[id];
        if (!set.purpose) continue;
        assert.equal(about.textContent.split(set.purpose).length - 1, 1, `${id}: its purpose is not said once in the book menu`);
      }
    }
  }
});

test('a tile is ONE button named for its row — and for its progress only once the record has been read', () => {
  for (const tile of allTiles) {
    const row = catalogue.rows[tile.dataset.alg];
    assert.equal(tile.tagName, 'BUTTON');
    assert.equal(tile.getAttribute('aria-label'), rowName(row), `${row.id}: named for something else before the record is read`);
    assert.equal(tile.querySelectorAll('button, a').length, 0, `${row.id}: a control inside a tile`);
    // No ring before the record is read: the badge is there to be filled, and empty.
    assert.equal(tile.querySelector('.badge')?.childElementCount, 0, `${row.id}: a ring drawn before any read`);
  }
  const row = catalogue.rows.sune ?? Object.values(catalogue.rows)[0];
  assert.equal(tileLabel(row, 0, 7), rowName(row), 'zero clean reps is said as something');
  assert.equal(tileLabel(row, 3, 7), `${rowName(row)}, 3 of 7 in a row`);
  assert.equal(tileLabel(row, 7, 7), `${rowName(row)}, in the fingers`);
  assert.equal(tileLabel(row, 40, 7), `${rowName(row)}, in the fingers`);
});

test('the ring: N segments with the streak lit, a tick at N, and one arc past twelve', () => {
  const box = (k, n) => parsed(ringSvg(k, n, 24)).querySelector('svg');
  for (const n of [3, 7, 12]) {
    for (const k of [0, 1, n - 1]) {
      const r = box(k, n);
      assert.equal(r.querySelectorAll('.seg').length, n, `${k}/${n}: not ${n} segments`);
      assert.equal(r.querySelectorAll('.seg.on').length, k, `${k}/${n}: not ${k} lit`);
      assert.ok(!r.classList.contains('done') && !r.querySelector('.tick'), `${k}/${n}: done before N`);
    }
    const done = box(n, n);
    assert.ok(done.classList.contains('done') && done.querySelector('.tick'), `${n}/${n}: no tick at N`);
  }
  // Past twelve segments one continuous arc: the groove, and the lit part of it.
  assert.equal(box(0, 30).querySelectorAll('.seg').length, 1, 'an empty ring past twelve is not the groove alone');
  assert.equal(box(15, 30).querySelectorAll('.seg.on').length, 1);
  assert.ok(box(30, 30).classList.contains('done'));
  assert.throws(() => ringSvg(-1, 7, 24), /ring/);
  assert.throws(() => ringSvg(1, 0, 24), /ring/);
});

test('a stage shows what it BUILDS — the stop it ends at, drawn as the Shapes screen draws a target — or no picture', () => {
  let pictured = 0;
  for (const { group, rail, body } of drawn) {
    const items = [...rail.querySelectorAll('[data-jump]')];
    const heads = [...body.querySelectorAll('.stage-sec .sec-head')];
    for (const [i, phase] of group.phases.entries()) {
      for (const [where, el] of [['rail', items[i]], ['header', heads[i]]]) {
        const pic = el.querySelector('.pic svg');
        if (phase.endsAt === null) {
          assert.equal(pic, null, `${libraryKey(group)}/${phase.phase}: a ${where} picture where no stop fits`);
          continue;
        }
        const want = parsed(netSvg(targetPicture(phase.endsAt), { ...look, width: 66, title: 'What this stage builds' })).querySelector('svg');
        assert.equal(pic?.outerHTML, want.outerHTML, `${libraryKey(group)}/${phase.phase}: the ${where} picture is not ${phase.endsAt}`);
        pictured += 1;
      }
    }
  }
  assert.ok(pictured >= 20, `precondition: ${pictured} stage pictures checked`);
});

test('a set\'s name and purpose are said in the active language; a row\'s own sentence is the ledger\'s English', () => {
  // No locale ships today (nothing outside the tests calls registerLocale), so this is the claim in library-view.js's
  // header held to a locale made for the test: every FIXED sentence the ledger declares goes through t(). A row's
  // `says` is assembled by the ledger, which a catalogue keyed by whole sentences cannot translate, and stays English.
  const sets = Object.values(catalogue.sets).filter((set) => set.purpose);
  // Keyed by the sentence, as a catalogue is: two sets that share a purpose share its translation.
  registerLocale('qa-library', Object.fromEntries(sets.flatMap((set) => [set.name, set.purpose]).map((en) => [en, `«${en}»`])));
  try {
    setLocale('qa-library');
    // A stage of several sets captions each with its name; its book menu says each purpose.
    const group = catalogue.groups.find((g) => g.phases.some((p) => p.sets.length > 1));
    const phase = group.phases.find((p) => p.sets.length > 1);
    const body = parsed(bodyHtml(group, catalogue, look, esc, ico));
    const caps = [...body.querySelectorAll('.set-cap')].map((c) => c.textContent);
    for (const id of phase.sets) assert.ok(caps.includes(`«${catalogue.sets[id].name}»`), `${id}: its name is not translated`);
    const about = parsed(aboutHtml(phase, catalogue, esc)).textContent;
    for (const id of phase.sets) {
      if (catalogue.sets[id].purpose) assert.ok(about.includes(`«${catalogue.sets[id].purpose}»`), `${id}: its purpose is not translated`);
    }
    // The page says the purpose through the same door.
    const row = catalogue.rows[sets[0].ids[0]];
    assert.equal(purposeOf(row, sets[0]), `«${row.purpose ?? sets[0].purpose}»`, 'the page\'s purpose is not translated');
  } finally {
    setLocale('en');
  }
});


test('every stage of every method carries its mixed practice button, and the button names its stage, not a set (D2, WI-8)', () => {
  for (const { group, body } of drawn) {
    group.phases.forEach((p, i) => {
      const head = body.querySelector(`.stage-sec[data-sec="${i}"] > .sec-head`);
      const mix = head.querySelector(`:scope > button.pill[data-mix="${i}"]`);
      assert.ok(mix, `${libraryKey(group)} stage ${i}: no mixed practice button in its header`);
      // A WORD, not an icon (E14): `repeat` is Start over's, and one symbol must not do two jobs. The name says what a
      // press does — every row of the stage, weakest first — and holds the word it shows (WCAG 2.5.3).
      assert.equal(mix.textContent.trim(), 'Mixed', `${libraryKey(group)} stage ${i}: the button does not say Mixed`);
      isAbsent(mix.querySelector('svg'), 'an icon on the mixed button');
      assert.equal(mix.getAttribute('aria-label'), 'Practise this stage mixed, weakest first');
      // One button per stage, and the stage's own: a stage of several sets has ONE, never one per set.
      assert.equal(body.querySelectorAll(`[data-mix="${i}"]`).length, 1, `${libraryKey(group)} stage ${i}: more than one mixed button`);
      isAbsent(body.querySelector(`.tiles [data-mix], .set-cap [data-mix]`), 'a mixed button for a set');
    });
  }
});

test('a history that could not be read is never said to be empty', () => {
  // `null` is the record that could not be read (audit round 2, rows 18 and 23): what is in it is unknown.
  const unknown = lastRepsHtml(null, esc);
  assert.doesNotMatch(unknown, /No reps yet/, 'an unreadable history said to be empty');
  assert.match(unknown, /could not be read/);
  // And an empty one that WAS read still says so.
  assert.match(lastRepsHtml([], esc), /No reps yet/);
});

test('a record still being read shows nothing it has not read — no reps, no "No reps yet", no figure', () => {
  // The record answers later (IndexedDB): until a read completes, what is in it is unknown, so neither the reps an
  // earlier read found nor an empty record's words or zeros may stand in for it.
  const pending = lastRepsHtml(RECORD_READING, esc);
  assert.doesNotMatch(pending, /No reps yet|could not be read|<li/, 'a history no read has given');
  assert.match(pending, /aria-busy="true"/);
  const figures = [...figuresHtml(null, esc).matchAll(/<dd class="num">([^<]*)<\/dd>/g)].map((m) => m[1]);
  assert.deepEqual(figures, ['—', '—', '—', '—'], 'a figure no read has given');
  assert.match(beadsHtml(null, 7, esc), /In a row: — of 7/);
  assert.equal(parsed(beadsHtml(null, 7, esc)).querySelectorAll('.bead.on').length, 0, 'a bead lit by no read');
});

test('every tile draws its own row\'s case: one picture, its stickers in the colours they are, net or top face by what the row keeps', () => {
  // The expectations are built here from the facelet layout and the palette table, never from the view's own
  // drawing code: a tile that dropped its picture, drew another row's case, or drew a net as a top face fails.
  const RING = [1, 2, 4, 5].flatMap((face) => [0, 1, 2].map((i) => face * 9 + i));    // R, F, L, B: each top row
  const SHOWS = {
    net: [...Array(54).keys()],
    'top-orientation': [...Array(9).keys(), ...RING].sort((a, b) => a - b),
    'top-colours': [...Array(9).keys(), ...RING].sort((a, b) => a - b),
  };
  const tiles = allTiles;
  assert.ok(tiles.length > 300, `${tiles.length} tiles to check`);
  const colours = paletteFor(STICKER_PALETTES[look.palette], look.scheme);
  let photos = 0;
  for (const card of tiles) {
    const row = catalogue.rows[card.dataset.alg];
    // A photographed row (lib/case-photo.js) draws an EMPTY well, named for its case, which the screen fills with
    // the photograph — and never its net first (test/browser/practice-screen.test.mjs holds the screen to it).
    if (isPhotographed(row)) {
      const wells = card.querySelectorAll('.case-photo');
      assert.equal(wells.length, 1, `${row.id}: ${wells.length} photograph wells on its tile`);
      assert.equal(wells[0].getAttribute('aria-label'), `The case ${rowName(row)} solves`, `${row.id}: the well is named for another case`);
      assert.equal(wells[0].getAttribute('data-photo'), 'pending');
      assert.equal(wells[0].childElementCount, 0, `${row.id}: the well is not empty`);
      assert.equal(card.querySelectorAll('svg').length, 0, `${row.id}: a photographed row drew a flat picture too`);
      assert.equal(row.solves.picture, 'net', `${row.id}: photographed but not a net row`);
      photos += 1;
      continue;
    }
    assert.equal(card.querySelectorAll('.case-photo').length, 0, `${row.id}: a flat row has a photograph well`);
    const pictures = card.querySelectorAll('svg');
    assert.equal(pictures.length, 1, `${row.id}: ${pictures.length} pictures on its tile`);
    assert.equal(pictures[0].getAttribute('aria-label'), `The case ${rowName(row)} solves`, `${row.id}: the picture is named for another case`);
    const { facelets, picture } = row.solves;
    assert.ok(Object.hasOwn(SHOWS, picture), `${row.id}: a case picture of a kind no tile draws: ${picture}`);
    // What the row KEEPS chooses the picture: a top face only for an algorithm that keeps the first two layers.
    assert.equal(picture === 'net', !row.keeps.includes('first-two-layers'), `${row.id}: a ${picture} for a row that keeps ${row.keeps.join(', ')}`);
    const stickers = [...pictures[0].querySelectorAll('rect')];
    assert.deepEqual(stickers.map((r) => Number(r.getAttribute('data-facelet'))).sort((a, b) => a - b), SHOWS[picture], `${row.id}: the ${picture} draws other stickers`);
    for (const r of stickers) {
      const at = Number(r.getAttribute('data-facelet'));
      const letter = facelets[at];
      // An orientation case lights only what shows the top centre's colour; anything else is an empty well.
      const lit = letter !== '?' && (picture !== 'top-orientation' || letter === facelets[4]);
      if (lit) {
        assert.equal(r.getAttribute('fill'), colours[letter], `${row.id}: sticker ${at} is not ${letter}'s colour`);
        assert.equal(r.getAttribute('fill-opacity'), null, `${row.id}: sticker ${at} is drawn as an empty well`);
      } else assert.equal(r.getAttribute('fill-opacity'), '0.35', `${row.id}: sticker ${at} should be an empty well`);
    }
  }
  assert.ok(photos > 250, `${photos} photographed tiles`);
});


test('the page prints every row exactly as written: one chip per turn, in order, the engine\'s own count', () => {
  for (const row of Object.values(catalogue.rows)) {
    const doc = win.document;
    doc.body.innerHTML = chipsHtml(row, catalogue.triggers, esc);
    const chips = [...doc.querySelectorAll('.chip-m')];
    assert.equal(chips.map((c) => c.textContent).join(' '), row.alg.trim().replace(/\s+/g, ' '), `${row.id} is printed differently from its alg`);
    // The engine parses the same text: one chip per move it judges.
    assert.equal(chips.length, parse(row.alg).length, `${row.id}: ${chips.length} chips for ${parse(row.alg).length} moves`);
    assert.deepEqual(chips.map((c) => Number(c.dataset.k)), chips.map((_, i) => i), `${row.id}: the chips are out of order`);
    // Every part is a trigger the ledger found or the run between two, and together they cover the algorithm once.
    const segs = segmentsOf(writtenTokens(row.alg).length, row.chunks);
    assert.equal(segs[0]?.from ?? 0, 0);
    for (let i = 1; i < segs.length; i++) assert.equal(segs[i].from, segs[i - 1].to, `${row.id}: a gap or overlap between parts`);
    assert.equal(segs.at(-1)?.to ?? 0, chips.length);
  }
});

test('every refusal timing.js can give has words, and no words are kept for one it cannot', () => {
  assert.deepEqual([...REFUSAL_CODES].sort(), Object.values(TIME_REFUSAL).sort());
  for (const code of REFUSAL_CODES) assert.ok(refusalWords(code).length > 0);
  assert.throws(() => refusalWords('made-up'), /no words/);
});

test('a timed rep says each named part\'s time and its marked pauses; a part nobody timed and a refused rep say nothing', () => {
  const name = (s) => `part ${s.from}-${s.to}`;
  const timed = { ms: 1500, splits: [{ from: 0, to: 4, ms: 500 }, { from: 4, to: 7, ms: null }], pauses: [{ afterReport: 3, ms: 900 }] };
  assert.equal(partsWords(timed, name), `part 0-4 0.50 s · 1 pause over ${PAUSE_FACTOR}× your usual gap between turns`);
  assert.equal(partsWords({ ...timed, pauses: [{}, {}] }, name), `part 0-4 0.50 s · 2 pauses over ${PAUSE_FACTOR}× your usual gap between turns`);
  // What must NOT be said: a time for a part the clock could not time, any pause at all with none marked,
  // and anything for a rep whose time was refused.
  assert.equal(partsWords({ ...timed, splits: [], pauses: [] }, name), '');
  assert.doesNotMatch(partsWords(timed, name), /part 4-7/);
  assert.equal(partsWords({ ms: null, refused: 'stream-gap', splits: timed.splits, pauses: [] }, name), '');
  assert.equal(partsWords(null, name), '');
});

// ---- WI-12: in the fingers after N clean reps in a row -----------------------------------------------------

const rep = (clean, extra = {}) => ({ at: 1, clean, lostTurn: false, ms: null, refused: 'no-cube-clock', turns: null, pauses: 0, htm: 7, ...extra });

test('"in the fingers" appears exactly at the Nth clean rep in a row, and not at N-1', () => {
  for (const n of [3, 7, 12]) {
    const reps = [];
    for (let i = 1; i <= n; i++) {
      reps.push(rep(true));
      const said = fingersWords(statsOf(reps), n);
      assert.equal(said.reached, i >= n, `n=${n}: after ${i} clean reps the badge was ${said.reached ? 'shown' : 'not shown'}`);
      if (i < n) assert.match(said.text, new RegExp(`${i} of ${n}`));
    }
  }
});

test('an unclean rep resets the progress; a rep with a lost turn neither counts nor resets', () => {
  const reps = Array.from({ length: 6 }, () => rep(true));
  assert.equal(fingersWords(statsOf(reps), 7).reached, false);
  reps.push(rep(false));
  assert.match(fingersWords(statsOf(reps), 7).text, /0 of 7/, 'a slip did not reset the streak');
  const reached = Array.from({ length: 7 }, () => rep(true));
  assert.equal(fingersWords(statsOf(reached), 7).reached, true);
  assert.equal(fingersWords(statsOf([...reached, rep(false)]), 7).reached, false, 'the badge stayed after a slip');
  // A lost turn is the cube's, never the child's (plan §3.4).
  assert.equal(fingersWords(statsOf([...reached.slice(1), rep(false, { lostTurn: true }), rep(true)]), 7).reached, true);
});

test('the Settings row says that a pause breaks the row of clean reps', async () => {
  const { practiceTargetRow } = await import('../lib/screens/settings/practice-target.js');
  assert.match(practiceTargetRow(), /A pause breaks the row\./);
});

test('with nothing on record the streak is a dash, never a zero nobody measured', () => {
  assert.match(fingersWords(statsOf([]), 7).text, /— of 7/);
  assert.match(fingersWords(null, 7).text, /— of 7/);
});

// ---- the lesson's way in: "practise this", only for algorithms the ledger holds ----------------------------

test('a lesson step offers practice only for a named algorithm the ledger holds, once the ledger has said so', async () => {
  const { offerPractice, practiceIdOf } = await import('../lib/practice-link.js');
  const ids = new Set(await lib.algIds());
  // Named and held: a sourced row and a hand-written one.
  assert.equal(practiceIdOf({ kind: 'case', caseName: 'oll-27' }), 'oll-27');
  assert.equal(practiceIdOf({ kind: 'case', caseName: 'right-hand' }), 'right-hand');
  // Not offered: a generated case (no name a learner would know), a step made of parts, a search.
  assert.equal(practiceIdOf({ kind: 'case', caseName: 'oll:02220000' }), null);
  assert.equal(practiceIdOf({ kind: 'case', caseName: 'right-hand', parts: ['turn', 'right-hand'] }), null);
  assert.equal(practiceIdOf({ kind: 'search' }), null);
  assert.equal(practiceIdOf(null), null);

  const button = win.document.createElement('button');
  const ask = () => Promise.resolve(ids);
  offerPractice(button, { kind: 'case', caseName: 'oll-27' }, { ids: ask });
  assert.equal(button.hidden, true, 'offered before the ledger answered');
  await new Promise((r) => { setTimeout(r, 0); });
  assert.equal(button.hidden, false, 'a held algorithm was not offered');
  assert.match(button.textContent, /OLL 27/);
  // `align` is a named step and NOT an algorithm: the ledger files it as such, and it is never offered.
  offerPractice(button, { kind: 'case', caseName: 'align' }, { ids: ask });
  await new Promise((r) => { setTimeout(r, 0); });
  assert.equal(button.hidden, true, 'a step the ledger does not hold was offered');
  // An answer that lands after the walk moved on does not put the old offer back.
  let release;
  offerPractice(button, { kind: 'case', caseName: 'sune' }, { ids: () => new Promise((r) => { release = r; }) });
  offerPractice(button, { kind: 'search' }, { ids: ask });
  release(ids);
  await new Promise((r) => { setTimeout(r, 0); });
  assert.equal(button.hidden, true, 'a late answer offered practice for a step no longer shown');
});

test('a ledger that cannot be asked is said where the offer would be, and a press asks it again', async () => {
  const { offerPractice } = await import('../lib/practice-link.js');
  const ids = new Set(await lib.algIds());
  const tick = () => new Promise((r) => { setTimeout(r, 0); });
  const logged = [];
  const quiet = console.error;
  console.error = (...args) => { logged.push(args); };
  try {
    const button = win.document.createElement('button');
    let asked = 0;
    // The library worker fails once, then answers.
    const flaky = () => { asked += 1; return asked === 1 ? Promise.reject(new Error('the library worker stopped')) : Promise.resolve(ids); };
    offerPractice(button, { kind: 'case', caseName: 'oll-27' }, { ids: flaky });
    await tick();
    // What must NOT happen: the failure leaving the offer hidden, with only the console knowing why.
    assert.equal(button.hidden, false, 'the ledger failed and nothing on screen says so');
    assert.match(button.textContent, /could not/i, `the button says "${button.textContent}"`);
    assert.match(button.getAttribute('aria-label') ?? '', /the library worker stopped/, 'the reason is not in what the control says');
    assert.equal(logged.length, 1, 'the failure was not logged as an error');
    button.onclick();
    await tick();
    assert.equal(asked, 2, 'a press did not ask the ledger again');
    assert.equal(button.hidden, false);
    assert.match(button.textContent, /OLL 27/, 'the second answer did not become the offer');
    assert.equal(button.getAttribute('aria-label'), null, 'the failure is still said after the ledger answered');
    // A failure that lands after the walk moved on says nothing about the step now shown.
    let reject;
    offerPractice(button, { kind: 'case', caseName: 'sune' }, { ids: () => new Promise((_, no) => { reject = no; }) });
    offerPractice(button, { kind: 'search' }, { ids: () => Promise.resolve(ids) });
    reject(new Error('late'));
    await tick();
    assert.equal(button.hidden, true, 'a late failure was said over a step that names no algorithm');
  } finally {
    console.error = quiet;
  }
});

// The band over the cube card is sized by every label the button can carry (E12.8). Asked of the ledger, that list came
// late — when the library worker answered — and the reserve grew after the walk was drawn, shrinking the cube under the
// child's eyes (geometry's "the band leaves the cube its size", which failed on whichever fixture the worker was slow).
test('every label the practise-step button can carry is known at once — never a late answer — and covers every offer', async () => {
  const { practiseLabels, PRACTISE_SAYS } = await import('../lib/practice-link.js');
  const { NAMEABLE_IDS, caseNameOf, hasCaseName } = await import('../lib/method-lesson.js');
  const labels = practiseLabels();
  assert.ok(Array.isArray(labels), `the labels are not known at once: ${Object.prototype.toString.call(labels)}`);
  assert.ok(labels.includes(t(PRACTISE_SAYS.unchecked)), 'the could-not-check label is not among them');
  // An UPPER BOUND on what a step can offer: every ledger id a step can name is in the list the labels are drawn from…
  // An offer is an id `caseNameOf` names (`practiceIdOf`); `hasCaseName` asks that without refusing an id it does not know.
  const ledger = (await lib.algIds()).filter(hasCaseName);
  assert.ok(ledger.length > 0, 'precondition: the ledger names no algorithm');
  const nameable = new Set(NAMEABLE_IDS);
  assert.deepEqual(ledger.filter((id) => !nameable.has(id)), [], 'a ledger algorithm a step can offer is missing from the band\'s list');
  // …and the widest offer by the measure given is among the labels: the band holds the longest the button can say.
  const widthOf = (text) => text.length;
  const offers = ledger.map((id) => t(PRACTISE_SAYS.offer, caseNameOf(id)));
  const most = Math.max(...offers.map(widthOf));
  assert.ok(practiseLabels({ widthOf }).some((l) => widthOf(l) >= most), 'the band is sized under the widest offer');
});

// ---- WI-12 in Settings: the stepper refuses a target below three -------------------------------------------

test('the Settings stepper refuses to go below 3: "fewer" is disabled at 3, and a press there changes nothing', async () => {
  const { practiceTargetRow, mountPracticeTarget } = await import('../lib/screens/settings/practice-target.js');
  const { FINGERS, settings } = await import('../lib/app-settings.js');
  // commitPref writes through the page's storage and repaints the page's notes: lend it this file's window.
  const lent = { document: globalThis.document, localStorage: globalThis.localStorage };
  globalThis.document = win.document;
  globalThis.localStorage = win.localStorage;
  const before = settings.fingersN;
  try {
    settings.fingersN = FINGERS.min;
    const card = win.document.createElement('div');
    card.className = 'card';
    const draw = () => { card.innerHTML = `${practiceTargetRow()}<div data-unsaved="practice" hidden></div>`; mountPracticeTarget(card, draw); };
    draw();
    win.document.body.replaceChildren(card);
    assert.equal(card.querySelector('#setFingers-less').disabled, true, 'fewer is offered at the minimum');
    card.querySelector('#setFingers-less').onclick();
    assert.equal(settings.fingersN, 3, 'a press below the minimum was taken');
    assert.equal(card.querySelector('#fingersN').textContent, '3');
    card.querySelector('#setFingers-more').onclick();
    assert.equal(settings.fingersN, 4, 'more does not step up');
    assert.equal(JSON.parse(win.localStorage.getItem('cubusSettings')).fingersN, 4, 'the change was not saved');
    assert.equal(card.querySelector('#setFingers-less').disabled, false);
    // A value below 3 that reached the setting by any other road is read as 3, never believed.
    settings.fingersN = 2;
    draw();
    assert.equal(card.querySelector('#fingersN').textContent, '3');
    card.querySelector('#setFingers-less').onclick();
    assert.equal(settings.fingersN, 3, 'a stored 2 stepped down to something below 3');
  } finally {
    settings.fingersN = before;
    globalThis.document = lent.document;
    globalThis.localStorage = lent.localStorage;
  }
});

// ---- the page IS the cube player (dev-docs/practice-redesign-plan.md R3, §5.1–§5.3, E11; WI-5) -------------------

/** The classes the page may use: the cube screen's walking composition (§5.2), the page's own additions (§5.3), and
 *  the app's shared primitives. Anything else is a practice-only invention. */
const PAGE_CLASSES = new Set([
  // §5.2, the cube screen's own
  'cols', 'walking', 'card', 'primary', 'card-tools', 'cube-slot', 'aux', 'transport', 'tbtn', 'progress', 'done-mark',
  'aside', 'state-card', 'twin', 'tight', 'solution-card', 'sheet', 'list', 'walk-strip', 'follow-note',
  // §5.3, new and named
  'practice-page', 'beads', 'practice-clock', 'practice-line',
  // E11: the twin's two stacked lines, and the score row the beads and clock share (the modes' pill row left with WI-8)
  'practice-twin', 'practice-said', 'practice-score',
  // E12.3: the record's notice on a row of its own (in the foot band in portrait), never in the follow-note's slot
  'practice-record-say',
  // E14: a card tool that says its job in a word
  'text-tool',
  // shared primitives
  'pill', 'on', 'btn', 'sm', 'outline', 'num', 'sr-only', 'wrap-row', 'ic',
]);

test('the page is the cube player: the walking composition\'s classes, the named additions, and nothing else', () => {
  const box = parsed(pageHtml(esc, ico));
  const root = box.firstElementChild;
  assert.ok(root.matches('.cols.walking.practice-page'), 'the page is not the walking composition');
  const used = new Set([...box.querySelectorAll('[class]')].flatMap((el) => [...el.classList]));
  assert.deepEqual([...used].filter((c) => !PAGE_CLASSES.has(c)).sort(), [], 'a class the cube player does not have');
  // The regions, by the cube screen's names.
  for (const sel of ['.card.primary > .card-tools', '.card.primary .cube-slot#practiceCube', '.card.aux > .transport',
    '.aside > .state-card.twin', '.aside > .card.tight.solution-card.sheet > .list.walk-strip#practiceAlg']) {
    assert.ok(root.querySelector(sel), `no ${sel}`);
  }
  // E11.1: the way back is the FIRST of the cube card's tools, and named.
  const tools = [...root.querySelectorAll('.card-tools > button')].map((b) => b.id);
  assert.deepEqual(tools, ['practiceBack', 'practiceBook', 'speedBtn', 'practiceNext'], 'the cube card\'s tools');
  // WI-8: the way on in mixed practice is a tool of the cube card, drawn only while mixing (the screen shows it).
  const next = root.querySelector('#practiceNext');
  assert.equal(next.getAttribute('aria-label'), 'Next algorithm');
  assert.equal(next.hidden, true, 'the way on is drawn before anything is mixed');
  assert.equal(root.querySelector('#practiceBack').getAttribute('aria-label'), 'All algorithms');
  // E14: the way back and the way on are WORDS. Chevrons are the transport's move back and move on, on the same page.
  for (const [id, word] of [['practiceBack', 'All'], ['practiceNext', 'Next']]) {
    const b = root.querySelector(`#${id}`);
    assert.equal(b.textContent.trim(), word, `#${id} does not say ${word}`);
    isAbsent(b.querySelector('svg'), `an icon on #${id}`);
    assert.ok(b.getAttribute('aria-label').startsWith(word), `#${id}: its name does not hold the word it shows`);
  }
  // The transport (E11.7, E11.8): the four step buttons, Start over as an icon that keeps its name, and the stopwatch
  // last. No step label — the bar carries the position, in words a screen reader hears.
  const transport = root.querySelector('.transport');
  assert.deepEqual([...transport.querySelectorAll('button')].map((b) => b.id),
    ['demoPrev', 'demoRepeat', 'demoNext', 'demoAll', 'practiceRestart', 'practiceClock']);
  assert.equal(transport.querySelector('#practiceRestart').getAttribute('aria-label'), 'Start over');
  assert.equal(transport.querySelector('#practiceRestart').textContent.trim(), '', 'Start over is drawn as words, not its icon');
  isAbsent(transport.querySelector('.num'), 'a step label in the transport');
  const bar = transport.querySelector('.progress');
  assert.equal(bar.getAttribute('role'), 'progressbar');
  assert.ok(bar.hasAttribute('aria-valuetext'), 'the bar does not say the position');
  // The beads row holds no control: the same height with a cube and without (E11.8).
  isAbsent(root.querySelector('.practice-score button'), 'a control in the beads row');
  // The twin: beads and clock, then the line and the note in ONE slot, then the record's notice on a row of its own
  // (E12.3 — the screen moves it into the foot band in portrait). No modes' row: WI-8 took it out (E11.2, E11.6).
  const twin = root.querySelector('.twin');
  assert.deepEqual([...twin.children].filter((c) => !c.classList.contains('sr-only')).map((c) => c.className),
    ['practice-score', 'practice-said', 'practice-record-say']);
  const said = twin.querySelector('.practice-said');
  assert.ok(said.querySelector(':scope > .practice-line') && said.querySelector(':scope > .follow-note#followNote'), 'the note does not share the quiet line\'s slot');
  // MUST NOT: the record's notice in the follow-note's slot, where the two stacked and took the cube's height (E12.3).
  isAbsent(said.querySelector('#practiceRecordSay'), 'the record\'s notice in the follow-note\'s slot');
  assert.equal(twin.querySelector(':scope > #practiceRecordSay')?.getAttribute('role'), 'status', 'the record\'s notice is not said as it changes');
  // MUST NOT: the temporary pills, anywhere (WI-8: a tile opens one algorithm, the stage's button opens it mixed).
  isAbsent(root.querySelector('.practice-modes, #practiceBlocked, #practiceMixed'), 'the modes\' pills');
  // The page's Try again — for a catalogue that could not be read — is the follow-note's action, said where it is seen.
  const retry = root.querySelector('#followNote > #practiceRetry');
  assert.ok(retry && retry.hidden, 'Try again is not the follow-note\'s, or is drawn with nothing to try');
  // E11.3: every other sentence goes to a live region nobody sees.
  const say = root.querySelector('#practiceSay');
  assert.ok(say?.classList.contains('sr-only') && say.getAttribute('aria-live') === 'polite', '#practiceSay is not a hidden live region');
  // MUST NOT: a case picture, or a sentence-holder of the old sheet, outside the book menu.
  isAbsent(root.querySelector('svg:not(.ic), img, .practice-pic, #practiceAbout, #practiceFigures, #practiceReps'),
    'the page draws something the book menu holds');
});

test('no practice-only layout grid: the page\'s composition is the walking one, in both orientations', () => {
  const sheet = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const gridRules = [...sheet.matchAll(/([^{}]+)\{[^{}]*grid-template[^{}]*\}/g)].map((m) => m[1].trim());
  assert.deepEqual(gridRules.filter((sel) => /practice-page|practice-twin|practice-said/.test(sel)), [], 'a grid of the page\'s own');
});

test('the beads: N of them, the clean streak lit up to N, all of them done at N, and the words for a screen reader', () => {
  for (const [streak, n] of [[0, 3], [2, 7], [7, 7], [12, 7], [5, 30]]) {
    const stats = statsOf(Array.from({ length: streak }, () => rep(true)));
    const box = parsed(beadsHtml(stats, n, esc));
    const beads = box.querySelector('#practiceFingers.beads');
    assert.ok(beads, 'no beads');
    assert.equal(beads.querySelectorAll('.bead').length, n, `${streak}/${n}: bead count`);
    assert.equal(beads.querySelectorAll('.bead.on').length, Math.min(streak, n), `${streak}/${n}: lit`);
    assert.equal(beads.classList.contains('done'), streak >= n, `${streak}/${n}: done`);
    assert.equal(beads.dataset.reached, String(streak >= n));
    assert.equal(beads.querySelector('.sr-only').textContent, fingersWords(stats, n).text);
  }
});

// ---- beads and rings from one source (dev-docs/practice-redesign-plan.md WI-7) --------------------------------

test('the page\'s beads and the library\'s ring are ONE reading of the record: the same number lit, done together', () => {
  const clean = (k) => Array.from({ length: k }, () => rep(true));
  const histories = {
    'nothing on record': [],
    'one clean': clean(1),
    'six clean': clean(6),
    'seven clean': clean(7),
    'forty clean': clean(40),
    'clean, then unclean': [...clean(5), rep(false)],
    'clean, then a paused clean rep': [...clean(5), rep(true, { pauses: 1 })],
    'a paused rep, then two clean': [...clean(5), rep(true, { pauses: 2 }), ...clean(2)],
    'a lost turn inside the row': [...clean(3), rep(false, { lostTurn: true }), ...clean(3)],
    'only lost turns': [rep(false, { lostTurn: true }), rep(true, { lostTurn: true })],
    'timed and untimed': [...clean(2), rep(true, { ms: 1800, refused: null, turns: 7 }), ...clean(1)],
  };
  for (const n of [3, 7, 12]) {
    for (const [what, reps] of Object.entries(histories)) {
      const stats = statsOf(reps);
      const want = Math.min(stats.streak, n);
      assert.deepEqual(fingersOf(stats, n), { lit: want, reached: stats.streak >= n }, `${what}, n=${n}: the reading`);
      const beads = parsed(beadsHtml(stats, n, esc)).querySelector('#practiceFingers');
      const ring = parsed(tileRing(stats, n, 24)).querySelector('svg.ring');
      assert.ok(ring, `${what}, n=${n}: no ring for a record that was read`);
      assert.equal(beads.querySelectorAll('.bead.on').length, want, `${what}, n=${n}: beads lit`);
      assert.equal(ring.querySelectorAll('.seg.on').length, want, `${what}, n=${n}: ring segments lit`);
      assert.equal(beads.classList.contains('done'), ring.classList.contains('done'), `${what}, n=${n}: one done and not the other`);
    }
  }
  // Past twelve segments the ring is one arc: lit exactly when a bead is, done exactly when the beads are.
  for (const [what, reps] of Object.entries(histories)) {
    const stats = statsOf(reps);
    const beads = parsed(beadsHtml(stats, 30, esc)).querySelector('#practiceFingers');
    const ring = parsed(tileRing(stats, 30, 24)).querySelector('svg.ring');
    assert.equal(Boolean(ring.querySelector('.seg.on')), beads.querySelectorAll('.bead.on').length > 0, `${what}, n=30: lit`);
    assert.equal(ring.classList.contains('done'), beads.classList.contains('done'), `${what}, n=30: done`);
  }
  // What must NOT happen: a ring, or a lit bead, for a record nobody has read.
  assert.equal(fingersOf(null, 7), null);
  assert.equal(tileRing(null, 7, 24), '', 'a ring drawn for a record not read');
  assert.equal(parsed(beadsHtml(null, 7, esc)).querySelectorAll('.bead.on').length, 0, 'a bead lit for a record not read');
  assert.throws(() => fingersOf(statsOf([]), 0), /fingers/);
});

// The book's picture is the FLAT one, its moved pieces marked as a flat tile's are (E13): beside the live cube it is a
// second view, not a copy of the photograph.
test('the marked flat picture: every row\'s moved stickers outlined unless its set is unmarked, and a flat tile is exactly it', () => {
  let marked = 0;
  for (const row of Object.values(catalogue.rows)) {
    const region = catalogue.sets[row.set].region;
    const box = parsed(markedPicture(row, region, look));
    const moved = box.querySelectorAll('rect.moved').length;
    // What must NOT happen: a sticker greyed or recoloured by the mark — the fills are the plain picture's.
    const fills = (el) => [...el.querySelectorAll('rect[data-facelet]')].map((r) => `${r.dataset.facelet}:${r.getAttribute('fill')}`).join();
    assert.equal(fills(box), fills(parsed(casePicture(row, look))), `${row.id}: the marking changed a sticker's colour`);
    if (!isMarked(row)) { assert.equal(moved, 0, `${row.id}: a set on the unmarked list is marked`); continue; }
    const drawn = new Set([...box.querySelectorAll('rect[data-facelet]')].map((r) => Number(r.dataset.facelet)));
    const want = movedPieces(row, region).viewed.flat().filter((f) => drawn.has(f)).length;
    assert.equal(moved, want, `${row.id}: ${moved} stickers marked, ${want} moved ones drawn`);
    if (moved) marked += 1;
    if (!isPhotographed(row)) assert.equal(tilePicture(row, region, look, esc), markedPicture(row, region, look), `${row.id}: the tile and the marked picture differ`);
  }
  assert.ok(marked > 500, `precondition: only ${marked} rows marked`);
});

test('the book\'s picture and a flat tile\'s: the same stickers marked, the band wholly inside each sticker\'s edge, every fill and every sticker\'s box unchanged', () => {
  // Both inside the edge (E14): astride it, half a tile's band fell on the gap and 1,096 of 3,433 stickers went unseen.
  assert.equal(BOOK_OUTLINE.inside, true);
  assert.equal(TILE_OUTLINE.inside, true);
  // Read as markup, not parsed: three pictures a row through one happy-dom window ran the file out of memory.
  const rects = (svg) => [...svg.matchAll(/<rect( class="moved")? data-facelet="(\d+)"([^>]*)\/>/g)].map(([, moved, f, rest]) => ({
    moved: Boolean(moved), f, fill: `${/ fill="([^"]*)"/.exec(rest)?.[1]}|${/ style="([^"]*)"/.exec(rest)?.[1] ?? ''}`,
    box: ['x', 'y', 'width', 'height'].map((k) => Number(new RegExp(` ${k}="([\\d.]+)"`).exec(rest)[1])),
    band: Number(/ stroke-width="([\d.]+)"/.exec(rest)[1]),
  }));
  let marked = 0;
  for (const row of Object.values(catalogue.rows)) {
    const region = catalogue.sets[row.set].region;
    const book = rects(bookPicture(row, region, look));
    const bare = new Map(rects(casePicture(row, look)).map((r) => [r.f, r]));
    const ids = (list) => list.filter((r) => r.moved).map((r) => r.f).join();
    assert.equal(ids(book), ids(rects(markedPicture(row, region, look))), `${row.id}: the book marks other stickers than a tile does`);
    // What must NOT happen: a sticker recoloured, or a sticker's size changed by its mark.
    assert.deepEqual(book.map((r) => `${r.f}:${r.fill}`), [...bare.values()].map((r) => `${r.f}:${r.fill}`), `${row.id}: the book's marking changed a sticker's colour`);
    const tile = rects(markedPicture(row, region, look));
    assert.deepEqual(tile.map((r) => `${r.f}:${r.fill}`), [...bare.values()].map((r) => `${r.f}:${r.fill}`), `${row.id}: the tile's marking changed a sticker's colour`);
    for (const r of [...book, ...tile].filter((x) => x.moved)) {
      const was = bare.get(r.f).box;
      const half = r.band / 2;
      const [x, y, w, h] = r.box;
      // The stroke's OUTER edge is the sticker's edge: half a band in on every side, to the rounding of two decimals.
      const outer = [x - half, y - half, w + 2 * half, h + 2 * half];
      outer.forEach((v, i) => assert.ok(Math.abs(v - was[i]) <= 0.011, `${row.id}#${r.f}: the band is not inside the sticker (${outer} against ${was})`));
      marked += 1;
    }
  }
  assert.ok(marked > 3000, `precondition: only ${marked} stickers marked`);
});

// D-a (E14): ONE ink for every sticker was not seen in Night — its light ink on a white sticker. Each moved sticker's mark is
// whichever of the theme's ink and its ground contrasts more with THAT sticker, so it is chosen against the sticker's own
// colour as the picture draws it: its fill, or the theme's off-grey at its opacity over the ground.
test('a moved sticker\'s mark is the ink or the ground, whichever contrasts more with that sticker, in every theme', () => {
  const hex = (h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  const counts = {};
  for (const [theme, inks] of Object.entries(THEME_INKS)) {
    const seen = { ink: 0, ground: 0 };
    for (const row of Object.values(catalogue.rows)) {
      const region = catalogue.sets[row.set].region;
      for (const svg of [markedPicture(row, region, { ...look, inks }), bookPicture(row, region, { ...look, inks })]) {
        for (const [, mark, rest] of svg.matchAll(/<rect class="moved" data-facelet="\d+" data-mark="(\w+)"([^>]*)\/>/g)) {
          const a = / fill-opacity="([\d.]+)"/.exec(rest);
          const own = a ? inks.off.map((v, i) => v * Number(a[1]) + inks.ground[i] * (1 - Number(a[1]))) : hex(/ fill="#(\w{6})"/.exec(rest)[1]);
          const other = mark === 'ink' ? 'ground' : 'ink';
          // What must NOT happen: a mark in the token that contrasts LESS with its sticker.
          assert.ok(contrastOf(inks[mark], own) >= contrastOf(inks[other], own), `${theme} ${row.id}: a sticker marked in its weaker token`);
          seen[mark] += 1;
        }
      }
    }
    counts[theme] = seen;
    // Both tokens are in use: a choice that always lands on one is no choice.
    assert.ok(seen.ink > 100 && seen.ground > 100, `${theme}: ${JSON.stringify(seen)}`);
  }
  // The case that opened it: a white sticker in Night is marked in the ground, never in Night's light ink.
  const white = hex(STICKER_PALETTES.classic.U.slice(1));
  assert.equal(markInk(white, THEME_INKS.night), 'ground');
  assert.equal(markInk(white, THEME_INKS.white), 'ink');
  // A picture with no inks to choose between is refused, never drawn in a guessed colour.
  const row = Object.values(catalogue.rows).find(isMarked);
  assert.throws(() => markedPicture(row, catalogue.sets[row.set].region, { palette: 'classic', scheme: 'western' }), /ink and ground/);
});

test('the strip: one section per part, a trigger\'s name the label over its part, and a row with no trigger one whole run', () => {
  for (const row of Object.values(catalogue.rows)) {
    const box = parsed(chipsHtml(row, catalogue.triggers, esc));
    const secs = [...box.querySelectorAll(':scope > .walk-sec')];
    const segs = segmentsOf(writtenTokens(row.alg).length, row.chunks);
    assert.equal(secs.length, segs.length, `${row.id}: sections`);
    segs.forEach((seg, i) => {
      const label = secs[i].querySelector(':scope > .walk-sec-l');
      if (seg.trigger) assert.equal(label?.textContent, catalogue.triggers[seg.trigger].name, `${row.id}: part ${i}'s label`);
      else isAbsent(label, `${row.id}: a label over a part with no trigger`);
      assert.equal(secs[i].querySelectorAll(':scope > .move-chips > .chip-m').length, seg.to - seg.from);
    });
    assert.equal(secs.length === 1 && !segs[0].trigger, secs[0].classList.contains('whole'), `${row.id}: whole`);
  }
});

test('Back to the library goes through practice-link, the one writer of the way in and out', async () => {
  const { openLibrary } = await import('../lib/practice-link.js');
  const { state } = await import('../lib/app-state.js');
  const { shell } = await import('../lib/screen-slots.js');
  const was = shell.renderScreen;
  let rendered = 0;
  shell.renderScreen = () => { rendered += 1; };
  try {
    state.practiceAlg = 'sune';
    openLibrary();
    assert.equal(state.practiceAlg, null);
    assert.equal(rendered, 1);
  } finally {
    shell.renderScreen = was;
  }
});
