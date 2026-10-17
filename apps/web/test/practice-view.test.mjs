// The Practice screen's pure parts, in node: what the library lists, what the page prints, what the record's
// figures say — and the lesson's way in (dev-docs/algorithm-drill-v2-plan.md §4, WI-10 and WI-12).
//
// The relation the browser suite proves end to end — the page prints the moves the engine judges — has its
// first half here, over EVERY ledger row: the chips are the row's own text, one turn per chip, in order.

import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { Window } from 'happy-dom';

import * as lib from '../lib/alg-library.js';
import { parse } from '../lib/cube-notation.js';
import { PAUSE_FACTOR, TIME_REFUSAL } from '../lib/drill/timing.js';
import { statsOf } from '../lib/drill/record.js';
import { catalogueOf, pendingName } from '../lib/drill/library-client.js';
import { libraryHtml } from '../lib/screens/practice/library-view.js';
import {
  REFUSAL_CODES, chipsHtml, fingersWords, partsWords, refusalWords, segmentsOf, writtenTokens,
} from '../lib/screens/practice/page-view.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const catalogue = await catalogueOf(lib);
// ONE window for the file: a happy-dom window per row cost a minute.
const win = new Window();
after(() => win.happyDOM.close());
/** The library, rendered ONCE and parsed once — four hundred cards with their pictures cost seconds to parse. */
const libraryDoc = (() => {
  const box = win.document.createElement('div');
  box.innerHTML = libraryHtml(catalogue, { palette: 'classic', scheme: 'western' }, esc);
  return box;
})();

test('the library lists every ledger row, and nothing the ledger does not hold', async () => {
  const ids = await lib.algIds();
  assert.ok(ids.length > 300, `the ledger read as ${ids.length} rows`);
  const listed = new Set(catalogue.groups.flatMap((g) => g.phases.flatMap((p) => p.sets.flatMap((s) => catalogue.sets[s].ids))));
  assert.deepEqual([...listed].sort(), [...ids].sort(), 'a row is missing from the library, or one is listed that the ledger lacks');
  // The proved tables are taught by no method, and still listed — last, under no method.
  const last = catalogue.groups.at(-1);
  assert.equal(last.method, null);
  for (const id of ['f2l-full', 'oll-full', 'pll-full']) assert.ok(last.phases[0].sets.includes(id), `${id} is not listed`);
  // Rendered, every row is a card (a set taught by several methods is listed under each).
  const doc = libraryDoc;
  const carded = new Set([...doc.querySelectorAll('[data-alg]')].map((b) => b.dataset.alg));
  assert.deepEqual([...carded].sort(), [...ids].sort());
});

test('the sources not yet in the ledger are named, from their ids, as pending', () => {
  assert.deepEqual(catalogue.pending.map((p) => p.id), lib.PENDING_SOURCES.map((p) => p.id));
  assert.equal(pendingName('mehta-algs'), 'Mehta');
  assert.equal(pendingName('corners-first-algs'), 'Corners first');
  const doc = libraryDoc;
  const note = doc.querySelector('[data-pending]');
  if (lib.PENDING_SOURCES.length) {
    assert.ok(note, 'nothing says the pending sources are missing');
    for (const p of catalogue.pending) assert.match(note.textContent, new RegExp(p.name));
  } else assert.equal(note, null, 'a pending note with nothing pending');
});

test('a set says its purpose once, under its heading; each card says its own row\'s sentence', () => {
  const doc = libraryDoc;
  for (const card of doc.querySelectorAll('[data-alg]')) {
    const row = catalogue.rows[card.dataset.alg];
    assert.equal(card.querySelector('.alg-say').textContent, row.says, `${row.id}: the card does not say its own sentence`);
    // What must NOT happen: a card standing in the set's shared purpose for its own sentence.
    const set = catalogue.sets[row.set];
    if (set.purpose && set.purpose !== row.says) assert.ok(!card.textContent.includes(set.purpose), `${row.id}: the set's purpose is on the card`);
  }
  for (const block of doc.querySelectorAll('details.alg-set')) {
    const set = catalogue.sets[block.dataset.set];
    const said = [...block.querySelectorAll('.alg-set-purpose')].map((e) => e.textContent);
    assert.deepEqual(said, set.purpose ? [set.purpose] : [], `${set.id}: the purpose is not said exactly once`);
    assert.ok(block.querySelector('summary .alg-set-purpose') || !set.purpose, `${set.id}: the purpose is not readable with the set closed`);
  }
  // The ledger now gives every set a purpose; a library that showed none would pass the loop above vacuously.
  assert.ok(doc.querySelectorAll('.alg-set-purpose').length > 10, 'no set purposes were drawn');
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
