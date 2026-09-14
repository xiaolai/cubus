// The scan screen's record of when each side was read (lib/screens/scan/capture-record.js). A
// scanner report carries what a side shows and never when it was read, so these cases pin the
// record's own idea of a read: a side appearing, or showing other stickers — and a side dropped and
// read again, however alike — and the two changes that are not reads. The screens that ask it are
// pinned in test/reconnect-flow.test.mjs.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCaptureRecord } from '../lib/screens/scan/capture-record.js';

const side = (face, colour) => ({ face, colors: Array(9).fill(colour) });
/** A side's stickers a quarter turn round. */
const quarter = (colors) => [6, 3, 0, 7, 4, 1, 8, 5, 2].map((i) => colors[i]);
/** A record whose connection, report and turn count a case moves by hand. */
const record = () => {
  const at = { over: null, reported: null, turns: 0 };
  return { at, captures: createCaptureRecord(() => ({ ...at })) };
};

test('a side is read when it appears or shows other stickers, at the report in force', () => {
  const { at, captures } = record();
  at.over = {};
  at.reported = 'R0';
  captures.note([side('F', 2)]);
  at.reported = 'R1';
  captures.note([side('F', 2), side('U', 0)]);
  assert.deepEqual(captures.readBeforeReport(), ['F'],
    'a side held across a report is read before it, and a side that appeared since is not');
  const recoloured = side('F', 2);
  recoloured.colors[0] = 1;
  captures.note([recoloured, side('U', 0)]);
  assert.deepEqual(captures.readBeforeReport(), [], 'a side showing other stickers was not read now');
});

test('a side the scanner no longer holds is forgotten, so reading it again alike is a new read', () => {
  const { at, captures } = record();
  at.over = {};
  at.reported = 'R0';
  captures.note([side('F', 2)]);
  at.reported = 'R1';
  captures.note([side('F', 2)]);
  assert.deepEqual(captures.readBeforeReport(), ['F'], 'precondition: the side was read before the report');
  captures.note([]);
  captures.note([side('F', 2)]);
  assert.deepEqual(captures.readBeforeReport(), [], 'a side dropped and read again alike kept its old read');
});

test('the same report over another connection is another report, and the side was read before it', () => {
  const { at, captures } = record();
  at.over = {};
  at.reported = 'R0';
  captures.note([side('F', 2)]);
  at.over = {};
  captures.note([side('F', 2), side('U', 0)]);
  assert.deepEqual(captures.readBeforeReport(), ['F'], 'a side read over the connection that ended was judged current');
  assert.deepEqual(captures.readBeforeConnection(), ['F'], 'a side read over the connection that ended was not read before this one');
});

test('a side read with no cube connected was read before the connection that began — and with none, nothing was', () => {
  const { at, captures } = record();
  captures.note([side('F', 2)]);
  assert.deepEqual(captures.readBeforeConnection(), [], 'with no cube connected, a side was read before a connection');
  at.over = {};
  at.reported = 'R0';
  assert.deepEqual(captures.readBeforeConnection(), ['F'], 'a side read before any cube connected was not read before it');
  captures.note([side('F', 2), side('U', 0)]);
  at.over = null;
  at.reported = null;
  assert.deepEqual(captures.readBeforeConnection(), [], 'the connection ended, and a side was still read before one');
  assert.deepEqual(captures.readBeforeReport(), [], 'the connection ended, and a side was still read before a report');
});

test('the same side turned round is not a read: the scanner settling a finished scan into rotation', () => {
  const { at, captures } = record();
  at.over = {};
  at.reported = 'R0';
  const shown = [2, 0, 1, 3, 2, 5, 0, 4, 2];
  captures.note([{ face: 'F', colors: shown }]);
  at.over = {};
  let turned = shown;
  for (let k = 1; k < 4; k += 1) {
    turned = quarter(turned);
    captures.note([{ face: 'F', colors: turned }]);
    assert.deepEqual(captures.readBeforeConnection(), ['F'], `the side turned ${k} quarter(s) round was taken as a new read`);
    captures.note([{ face: 'F', colors: shown }]);
  }
  const mirrored = [0, 3, 6, 1, 4, 7, 2, 5, 8].map((i) => shown[i]);
  captures.note([{ face: 'F', colors: mirrored }]);
  assert.deepEqual(captures.readBeforeConnection(), [], 'stickers that are no turn of the side were not a new read');
});

test('a sticker painted by hand is not a read, and the painted side is expected once', () => {
  const { at, captures } = record();
  at.over = {};
  at.reported = 'R0';
  captures.note([side('F', 2), side('U', 0)]);
  at.over = {};
  const corrected = side('F', 2);
  corrected.colors[0] = 1;
  captures.paint('F', 0, 1, () => captures.note([corrected, side('U', 0)]));
  assert.deepEqual(captures.readBeforeConnection().sort(), ['F', 'U'], 'a sticker painted by hand made its side a new read');
  const reread = side('F', 2);
  reread.colors[1] = 3;
  captures.note([reread, side('U', 0)]);
  assert.deepEqual(captures.readBeforeConnection(), ['U'], 'a change after the paint was taken as the paint');
  at.over = {};
  captures.note([corrected, side('U', 0)]);
  assert.deepEqual(captures.readBeforeConnection().sort(), ['U'], 'the painted stickers, read again later, were taken as the paint again');
});

// A turn the cube reports is counted at once; the snapshot that shows it follows about a second
// later. Judged on the snapshot alone, a side read before the turn stayed current until that
// snapshot landed — and two such sides could take the Yes (found by verification, 2026-09-14).
test('a turn the cube reported overtakes a side read before it, before the snapshot that follows', () => {
  const { at, captures } = record();
  at.over = {};
  at.reported = 'R0';
  captures.note([side('F', 2)]);
  at.turns = 1;
  assert.deepEqual(captures.readBeforeReport(), ['F'], 'a side read before a counted turn was current until the snapshot');
  captures.note([side('F', 2), side('U', 0)]);
  assert.deepEqual(captures.readBeforeReport(), ['F'],
    'the side read before the turn stopped being asked for, or the one read after it was asked for');
  at.reported = 'R1';
  assert.deepEqual(captures.readBeforeReport().sort(), ['F', 'U'],
    'conservative by design: a report the record cannot match to the turns it counted asks for every side again');
});

test("a connection's first report does not overtake a side read before it, unless a turn came between", () => {
  const { at, captures } = record();
  at.over = {};
  captures.note([side('F', 2)]);
  at.reported = 'R0';
  assert.deepEqual(captures.readBeforeReport(), [], 'the first report overtook a side read before it, with no turn between');
  at.turns = 1;
  assert.deepEqual(captures.readBeforeReport(), ['F'], 'a turn the cube reported before its first report was not a turn');
  const { at: later, captures: second } = record();
  later.over = {};
  later.reported = 'R0';
  second.note([side('F', 2)]);
  later.reported = 'R1';
  assert.deepEqual(second.readBeforeReport(), ['F'], 'a later report with no turn counted — a turn lost on the way — did not overtake the side');
});
