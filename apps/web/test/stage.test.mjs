// The stage contract's fixture tables are tested claims.
//
// dev-docs/stage-contract.md carries two tables of numbers: what the reference box does on every
// iPad, iPhone and Android size, and what the desktop window is on four monitors. A number in a
// document is exactly the kind of claim AGENTS.md says must be backed by a test, so this file
// reads both tables OUT OF THE DOCUMENT and checks every row against lib/stage.js. Edit a
// constant without re-running the table, or type a cell by hand, and this fails.
//
// The oracle itself is checked first, on the cases the tables cannot express: the fall-through
// when the long axis is too short, the square, and a viewport with nothing left.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import { DESKTOP, RATIO, desktopWindow, fitStage } from '../lib/stage.js';

const doc = readFileSync(new URL('../../../dev-docs/stage-contract.md', import.meta.url), 'utf8');

/** `1376×1032` → [1376, 1032]; the first such pair in a string, or null. */
const size = (s) => {
  const m = /(\d+)×(\d+)/.exec(s);
  return m ? [Number(m[1]), Number(m[2])] : null;
};
/** The cells of every table row whose first cell starts with `label`. */
const rowsStartingWith = (label) =>
  doc
    .split('\n')
    .filter((l) => l.startsWith(`| ${label}`))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));

// ---- the oracle -------------------------------------------------------------------------------

test('a landscape client with room on the long axis: the box is 4:3 on the height, the rest is surplus', () => {
  const r = fitStage({ width: 1600, height: 900 });
  assert.equal(r.orientation, 'landscape');
  assert.deepEqual(r.ref, { w: 1200, h: 900 });
  assert.equal(r.surplus, 400);
  assert.equal(r.paper, 0);
});

test('a portrait client with room on the long axis: the box is 3:4 on the width, the rest is surplus', () => {
  const r = fitStage({ width: 300, height: 800 });
  assert.equal(r.orientation, 'portrait');
  assert.deepEqual(r.ref, { w: 300, h: 400 });
  assert.equal(r.surplus, 400);
  assert.equal(r.paper, 0);
});

test('a long axis too short for the reference: the box shrinks to it and the short axis pads', () => {
  const r = fitStage({ width: 1000, height: 900 }); // 4:3 on 900 would be 1200 wide
  assert.deepEqual(r.ref, { w: 1000, h: 750 });
  assert.equal(r.surplus, 0);
  assert.equal(r.paper, 75);
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

    const surplus = /sheet \+(\d+)/.exec(tailCell);
    const paper = /paper (\d+)/.exec(tailCell);
    assert.ok(surplus || paper, `the last cell must say "sheet +N …" or "paper N …": "${tailCell}"`);
    if (surplus) {
      assert.equal(Math.round(r.surplus), Number(surplus[1]), `surplus for ${client}`);
      assert.equal(r.paper, 0);
    } else {
      assert.equal(Math.round(r.paper), Number(paper[1]), `paper for ${client}`);
      assert.equal(r.surplus, 0);
    }
  });
}

test('the fixture table has no rows this test does not know the insets of', () => {
  const start = doc.indexOf('| Client | Safe content |');
  assert.notEqual(start, -1, 'the fixture table header moved — update this test');
  const table = doc.slice(start).split('\n\n')[0].split('\n').slice(2);
  const unknown = table.filter((l) => !FIXTURES.some(({ row }) => l.startsWith(`| ${row}`)));
  assert.deepEqual(unknown, [], 'a fixture row with no declared insets cannot be checked');
});

// ---- the document's desktop table -------------------------------------------------------------

test('desktop table: every row is what the formulas give for its work area', () => {
  const start = doc.indexOf('| Monitor (logical) | Work area |');
  assert.notEqual(start, -1, 'the desktop table header moved — update this test');
  const rows = doc.slice(start).split('\n\n')[0].split('\n').slice(2).map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
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

test('the document states the constants the oracle uses', () => {
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
