// The stage contract's fixture tables are tested claims.
//
// Two tables of numbers: what the reference box does on every iPad, iPhone and Android size, and
// what the desktop window is on four monitors. A number stated as fact is exactly the kind of claim
// AGENTS.md says must be backed by a test, so every row here is checked against lib/stage.js. Edit
// a constant without re-running the tables, or type a cell by hand, and this fails.
//
// The rows live in fixtures/stage-contract.json, NOT in the document they came from. This file used
// to read dev-docs/stage-contract.md directly, at module scope — and dev-docs is gitignored, so on
// any machine without it (CI, a fresh clone) the import threw and took the whole suite with it. A
// test whose fixtures are not in the repository is not a test anywhere but on one laptop.
//
// Moving them did not lose the document check, it inverted it: the fixture is authoritative for the
// numbers, and where the document IS present it must agree with the fixture, verbatim. So the
// document still cannot drift, and the drift is now caught on the machine where the edit happened.
//
// The oracle itself is checked first, on the cases the tables cannot express: the fall-through
// when the long axis is too short, the square, and a viewport with nothing left.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';

import { DESKTOP, RATIO, desktopWindow, fitStage } from '../lib/stage.js';

const TABLES = JSON.parse(readFileSync(new URL('./fixtures/stage-contract.json', import.meta.url), 'utf8'));

/** The document the fixture was taken from. Absent on any machine that only has the repository. */
const DOC_URL = new URL('../../../dev-docs/stage-contract.md', import.meta.url);
const doc = existsSync(DOC_URL) ? readFileSync(DOC_URL, 'utf8') : null;

/** `1376×1032` → [1376, 1032]; the first such pair in a string, or null. */
const size = (s) => {
  const m = /(\d+)×(\d+)/.exec(s);
  return m ? [Number(m[1]), Number(m[2])] : null;
};
/** The cells of every fixture row whose first cell starts with `label`. */
const rowsStartingWith = (label) => TABLES.devices.filter((cells) => cells[0].startsWith(label));

// ---- the oracle -------------------------------------------------------------------------------

test('a landscape client with room on the long axis: the box is 4:3 on the height, the rest is surplus', () => {
  const r = fitStage({ width: 1600, height: 900 });
  assert.equal(r.orientation, 'landscape');
  assert.deepEqual(r.ref, { w: 1200, h: 900 });
  assert.equal(r.surplus, 400);
  assert.equal(r.stretch, 0);
});

test('a portrait client with room on the long axis: the box is 3:4 on the width, the rest is surplus', () => {
  const r = fitStage({ width: 300, height: 800 });
  assert.equal(r.orientation, 'portrait');
  assert.deepEqual(r.ref, { w: 300, h: 400 });
  assert.equal(r.surplus, 400);
  assert.equal(r.stretch, 0);
});

test('a long axis too short for the reference: the box shrinks to it and the short axis stretches', () => {
  // The amendment of 2026-09-06 is entirely in the last line: the reference box is what it always
  // was (4:3 on 900 would be 1200 wide, so it shrinks to the 1000 available), and the 150px the
  // short axis has left over is now the flexible regions' to take rather than two 75px margins of
  // paper. The box moving would be a different amendment: it is what sets the primary region's
  // reference dimension. Not that a fixed box means a fixed drawing — the region's OTHER dimension
  // is the column's, and the cube fitted to it grew 4.9% on the desktop portrait window.
  const r = fitStage({ width: 1000, height: 900 });
  assert.deepEqual(r.ref, { w: 1000, h: 750 });
  assert.equal(r.surplus, 0);
  assert.equal(r.stretch, 150);
});

test('a square is landscape — the orientation the desktop reference is designed in', () => {
  assert.equal(fitStage({ width: 800, height: 800 }).orientation, 'landscape');
});

test('insets and bars come off before anything is fit', () => {
  const r = fitStage({ width: 393, height: 852, insets: { top: 59, bottom: 34 }, bars: { top: 44, bottom: 49 } });
  assert.deepEqual(r.safe, { w: 393, h: 666 });
});

test('a client with nothing left after insets and bars is an error, not a zero-sized stage', () => {
  assert.throws(() => fitStage({ width: 100, height: 100, bars: { top: 60, bottom: 60 } }), RangeError);
});

test('the desktop window is the stage plus its title bar, and never exceeds the work area', () => {
  for (const orientation of ['landscape', 'portrait']) {
    for (const [workW, workH, bar] of [[1470, 850, 52], [2560, 1410, 52], [1366, 720, 44], [1280, 672, 44], [1024, 600, 44]]) {
      const { stage, window } = desktopWindow({ workW, workH, bar, orientation });
      assert.equal(window.w, stage.w);
      assert.equal(window.h, stage.h + bar);
      assert.ok(window.w <= workW && window.h <= workH, `${orientation} ${workW}×${workH}: window ${window.w}×${window.h}`);
      const ratio = orientation === 'landscape' ? stage.w / stage.h : stage.h / stage.w;
      assert.ok(Math.abs(ratio - RATIO) < 1e-9, `stage ratio ${ratio}`);
    }
  }
});

test('the constants are frozen: a screen cannot retune the window by assignment', () => {
  assert.ok(Object.isFrozen(DESKTOP) && Object.isFrozen(DESKTOP.landscape) && Object.isFrozen(DESKTOP.portrait));
});

// ---- the document's fixture table -------------------------------------------------------------

// Per device: the OS insets the table was computed with. The document states them in prose above
// the table; every device here is a touch device, so the top bar is the 52px one (44px controls
// need it), and the bottom tab bar is 49 in portrait only.
const FIXTURES = [
  { row: 'iPad 13" landscape', insets: { top: 24, bottom: 26 } },
  { row: 'iPad 11" landscape', insets: { top: 24, bottom: 26 } },
  { row: 'iPad mini landscape', insets: { top: 24, bottom: 26 } },
  { row: 'iPad 13" portrait', insets: { top: 24, bottom: 26 } },
  { row: 'iPad 11" portrait', insets: { top: 24, bottom: 26 } },
  { row: 'iPad mini portrait', insets: { top: 24, bottom: 26 } },
  { row: 'iPhone 16 Pro Max', insets: { top: 62, bottom: 34 } },
  { row: 'iPhone 16 393', insets: { top: 59, bottom: 34 } },
  { row: 'iPhone SE', insets: { top: 20, bottom: 0 } },
  { row: 'Android phone', insets: { top: 24, bottom: 24 } },
];

for (const { row, insets } of FIXTURES) {
  test(`fixture table: ${row.trim()}`, () => {
    const rows = rowsStartingWith(row);
    assert.equal(rows.length, 1, `expected exactly one table row starting with "| ${row}"`);
    const [client, safeCell, compositionCell, tailCell] = rows[0];
    const [width, height] = size(client);
    const bars = width >= height ? { top: 52 } : { top: 52, bottom: 49 };
    const r = fitStage({ width, height, insets, bars });

    assert.deepEqual([r.safe.w, r.safe.h], size(safeCell), `safe content area for ${client}`);
    const [ratio, boxCell] = compositionCell.split(' at ');
    assert.equal(ratio, r.orientation === 'landscape' ? '4:3' : '3:4', `orientation for ${client}`);
    assert.deepEqual([Math.round(r.ref.w), Math.round(r.ref.h)], size(boxCell), `reference box for ${client}`);

    // The last cell says where the room the box did not take went. Three forms, one per region
    // that can take it, each anchored and exact about its unit word — the axis is half the claim,
    // and `sheet +136 tall` on a landscape client would be a wrong cell that a loose regex reads
    // as a right one. Anything else fails: a cell nobody parsed is a cell nobody checked.
    const asSheet = /^sheet \+(\d+) (tall|wide)$/.exec(tailCell);
    const asColumns = /^columns \+(\d+) wide$/.exec(tailCell); // portrait: the two columns share it
    const asRows = /^rows \+(\d+) tall$/.exec(tailCell); // landscape: the right-hand column's rows
    const portrait = r.orientation === 'portrait';
    assert.ok(asSheet || asColumns || asRows,
      `the last cell must say "sheet +N tall|wide", "columns +N wide" or "rows +N tall": "${tailCell}"`);
    if (asSheet) {
      // The sheet takes the LONG axis, which is the height in portrait and the width in landscape.
      assert.equal(asSheet[2], portrait ? 'tall' : 'wide', `the sheet's axis for ${client}`);
      assert.equal(Math.round(r.surplus), Number(asSheet[1]), `surplus for ${client}`);
      assert.equal(r.stretch, 0, `${client} cannot stretch and have long-axis surplus at once`);
    } else {
      assert.ok(portrait ? asColumns : asRows,
        `${client} is ${r.orientation}, so its short-axis room goes to the ${portrait ? 'columns' : 'rows'}: "${tailCell}"`);
      assert.equal(Math.round(r.stretch), Number((asColumns ?? asRows)[1]), `stretch for ${client}`);
      assert.equal(r.surplus, 0, `${client} cannot stretch and have long-axis surplus at once`);
    }
  });
}

test('no fixture shows paper: the reference plus its stretch is the whole stage', () => {
  // The amendment of 2026-09-06, as one claim over every row rather than per device: the
  // composition box IS the stage content box, on both axes, everywhere. Long axis = ref + surplus,
  // short axis = ref + stretch, and both hold in both branches of the fit — which is why this is
  // asserted unconditionally instead of only where the long axis is short. A row that letterboxed
  // would leave the short-axis sum short by twice its margin.
  //
  // Within 1e-9 px, not exactly: the long-axis identity goes through `short × 4/3`, and 4/3 is not
  // a binary fraction, so a sum that is exact in decimal need not be in doubles. A billionth of a
  // logical pixel is not a layout claim; treating one as a failure would be.
  const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);
  for (const { row, insets } of FIXTURES) {
    const [client, , , tailCell] = rowsStartingWith(row)[0];
    const [width, height] = size(client);
    const bars = width >= height ? { top: 52 } : { top: 52, bottom: 49 };
    const r = fitStage({ width, height, insets, bars });
    const portrait = r.orientation === 'portrait';
    near(r.ref[portrait ? 'h' : 'w'] + r.surplus, portrait ? r.safe.h : r.safe.w, `${client}: long axis (${tailCell})`);
    near(r.ref[portrait ? 'w' : 'h'] + r.stretch, portrait ? r.safe.w : r.safe.h, `${client}: short axis (${tailCell})`);
    assert.ok(r.stretch >= 0 && r.surplus >= 0, `${client}: neither remainder may be negative`);
  }
});

test('the oracle has no paper left in it, and no fixture cell describes any', () => {
  // "Paper" as a layout outcome is gone (2026-09-06); "paper" as the app's background colour is
  // not, and the word is all over the codebase in that second sense — `--bg`, "a strip of paper
  // under the tab bar", paper-one. So this scans two files and looks for the FIELD, not the word:
  // a live read (`.paper`) or a live write (`paper:`). The module may still say the word in prose,
  // as history of what it used to return. This file is not scanned — it is where the claim is
  // written, so it necessarily names the thing it forbids.
  const stage = readFileSync(new URL('../lib/stage.js', import.meta.url), 'utf8');
  for (const dead of ['.paper', 'paper:']) {
    assert.ok(!stage.includes(dead), `lib/stage.js still has a live \`${dead}\`: the field was removed on 2026-09-06`);
  }
  // A table cell is a different matter: the fixture is the contract's numbers, and under the
  // amendment no client letterboxes, so the word itself must not appear in one.
  const fixture = readFileSync(new URL('./fixtures/stage-contract.json', import.meta.url), 'utf8');
  assert.ok(!/paper/i.test(fixture), 'a fixture cell still describes paper — the contract says nothing letterboxes');
});

test('the fixture table has no rows this test does not know the insets of', () => {
  const unknown = TABLES.devices
    .map((cells) => cells[0])
    .filter((client) => !FIXTURES.some(({ row }) => client.startsWith(row)));
  assert.deepEqual(unknown, [], 'a fixture row with no declared insets cannot be checked');
});

// ---- the desktop table --------------------------------------------------------------------------

test('desktop table: every row is what the formulas give for its work area', () => {
  const rows = TABLES.desktop;
  assert.ok(rows.length >= 4, 'the desktop table lost rows');
  for (const [monitor, workCell, landCell, portCell] of rows) {
    const [workW, workH] = size(workCell);
    const bar = monitor.startsWith('Windows') ? 44 : 52;
    const land = desktopWindow({ workW, workH, bar, orientation: 'landscape' }).stage;
    const port = desktopWindow({ workW, workH, bar, orientation: 'portrait' }).stage;
    assert.deepEqual([Math.round(land.w), Math.round(land.h)], size(landCell), `landscape for ${monitor}`);
    assert.deepEqual([Math.round(port.w), Math.round(port.h)], size(portCell), `portrait for ${monitor}`);
  }
});

// ---- the document, where it exists ---------------------------------------------------------------
//
// dev-docs is gitignored, so these run on a machine that has the document and are reported as
// skipped on one that does not. Skipped, never quietly passed: a check that cannot run has verified
// nothing, and saying so is the difference between a gate and a decoration (AGENTS.md, the
// verify-icons precedent). Everything above this line runs everywhere, because the numbers moved
// into the repository — this section only asks whether the prose still matches them.

const describeDoc = (t) => {
  if (doc === null) {
    t.diagnostic('dev-docs/stage-contract.md is not on this machine (it is gitignored) — SKIPPED, not passed');
    t.skip();
    return false;
  }
  return true;
};

test('the document\'s tables are verbatim what the fixture holds', (t) => {
  if (!describeDoc(t)) return;
  const table = (header) => {
    const start = doc.indexOf(header);
    assert.notEqual(start, -1, `the table header moved: ${header}`);
    return doc.slice(start).split('\n\n')[0].split('\n').slice(2)
      .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
  };
  // Verbatim, because a re-parsed copy can drift from its source in ways that still parse.
  assert.deepEqual(table('| Client | Safe content |'), TABLES.devices,
    'the document and fixtures/stage-contract.json disagree — run scripts/regen-stage-contract.mjs');
  assert.deepEqual(table('| Monitor (logical) | Work area |'), TABLES.desktop,
    'the document and fixtures/stage-contract.json disagree — run scripts/regen-stage-contract.mjs');
});

test('the document states the constants the oracle uses', (t) => {
  if (!describeDoc(t)) return;
  // The prose names each constant; if one is retuned in code the sentence must follow.
  for (const s of [
    `\`k = ${DESKTOP.landscape.k}\``,
    `\`k = ${DESKTOP.portrait.k}\``,
    `\`minW = ${DESKTOP.landscape.min}\``,
    `\`maxW = ${DESKTOP.landscape.max}\``,
    `\`minH = ${DESKTOP.portrait.min}\``,
    `\`maxH = ${DESKTOP.portrait.max}\``,
    `\`margin\` = ${DESKTOP.margin}`,
  ]) {
    assert.ok(doc.includes(s), `the document no longer says ${s}`);
  }
});
