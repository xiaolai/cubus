// The solving-methods note's table, checked against the code it describes.
//
// `dev-docs/solving-method-phases.md` prints a row per phase with three counts. Hand-typed numbers in
// a document drift, and a drifted table is worse than no table because it still looks authoritative.
// So the table is READ OUT OF THE DOCUMENT and every row checked, the same way `stage.test.mjs` reads
// the layout contract's fixture table rather than trusting it.
//
// **dev-docs is gitignored** (AGENTS.md, owner's call 2026-09-06), so a clean clone does not carry it.
// When the file is absent this SKIPS. It does not pass: a check that did not run must never be counted
// green, which is the rule `scanner-gpu.test.mjs` already follows with `t.skip()` rather than a bare
// diagnostic — a diagnostic still tallies under `pass`, and that is how a gate becomes decoration.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { SOLVER_PHASES } from '../bench/solver-phases.mjs';
import { ALGORITHM_SETS } from './fixtures/algorithm-ledger.mjs';

const ROOT = new URL('../../../', import.meta.url);
const NOTE = fileURLToPath(new URL('dev-docs/solving-method-phases.md', ROOT));

/**
 * A wrong path must FAIL, not skip.
 *
 * The first version of this file pointed one directory too high and skipped both cases, reporting
 * "absent — gitignored" about a file that was sitting there. A skip that means "your arithmetic is
 * wrong" is indistinguishable from a skip that means "a clean clone has no dev-docs", and the whole
 * value of the skip is that it distinguishes those. So the anchor is checked against a file that is
 * always present, and a bad anchor throws.
 */
const anchor = fileURLToPath(new URL('apps/web/lib/cube-pieces.js', ROOT));
if (!existsSync(anchor)) {
  throw new Error(`this test's path arithmetic is wrong: ${anchor} does not exist, so ${NOTE} proves nothing`);
}

/**
 * The anchor above proves the arithmetic reaches the repository. It says nothing about the FILENAME,
 * and an audit showed the same weakness in the sibling test this one is the model for: misspell the
 * note and both cases skip, reporting the misspelling as "gitignored". The directory is the
 * discriminator — absent means a clean clone, present-without-the-file means the name is wrong or the
 * note has been deleted while a test still claimed to check it.
 */
const DEV_DOCS = fileURLToPath(new URL('dev-docs', ROOT));
function noteOrSkip(t, why) {
  if (!existsSync(DEV_DOCS)) {
    t.skip(why);
    return null;
  }
  if (!existsSync(NOTE)) {
    throw new Error(`dev-docs exists but ${NOTE} does not: the filename is wrong, or the note this `
      + 'test checks has been deleted. Either way this is not the clean-clone case.');
  }
  return readFileSync(NOTE, 'utf8');
}

/** The phase table's rows, as `{ method, phase, settled, narrowed, free }`. */
function readTable(text) {
  const rows = [];
  let method = null;
  let inTable = false;
  for (const line of text.split('\n')) {
    const cells = line.trim().startsWith('|') ? line.trim().split('|').slice(1, -1).map((c) => c.trim()) : null;
    if (!cells || cells.length !== 5) { if (inTable && rows.length) break; continue; }
    if (cells[1] === 'phase') { inTable = true; continue; }        // the header
    if (cells.every((c) => /^-+:?$/.test(c.replace(/:/g, '-')))) continue; // the rule
    if (!inTable) continue;
    if (cells[0]) method = cells[0];
    const num = (c) => (c === '—' || c === '-' ? 0 : Number(c));
    if (!Number.isFinite(num(cells[2]))) continue;
    rows.push({ method, phase: cells[1], settled: num(cells[2]), narrowed: num(cells[3]), free: num(cells[4]) });
  }
  return rows;
}

const strip = (s) => s.replace(/\*\*/g, '').replace(/\(.*?\)/g, '').trim();
const firstWord = (s) => strip(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').trim().split(/\s+/)[0];

test('the solving-methods note\'s table matches the phases it describes', (t) => {
  const text = noteOrSkip(t, 'dev-docs is absent — gitignored, so a clean clone cannot check the note');
  if (text === null) return;
  const rows = readTable(text);

  assert.equal(rows.length, SOLVER_PHASES.length,
    `the note lists ${rows.length} phases and the code has ${SOLVER_PHASES.length}`);

  rows.forEach((row, i) => {
    const p = SOLVER_PHASES[i];
    const where = `row ${i + 1} (${row.method} / ${row.phase})`;
    // Loose on the name — the note edits them for reading — and exact on every number.
    assert.equal(firstWord(row.phase), firstWord(p.name),
      `${where}: the note and the code are describing different phases, or the order has changed`);
    assert.equal(row.method, p.method, `${where}: method`);
    assert.equal(row.settled, p.settled, `${where}: settled stickers`);
    assert.equal(row.narrowed, p.narrowed, `${where}: narrowed stickers`);
    assert.equal(row.free, p.free, `${where}: free stickers`);
  });
});

test('the note\'s prose counts match too', (t) => {
  const text = noteOrSkip(t, 'dev-docs is absent — gitignored');
  if (text === null) return;
  const methods = new Set(SOLVER_PHASES.map((p) => p.method));
  assert.match(text, new RegExp(`${SOLVER_PHASES.length} phases across ${methods.size} methods`),
    `the note should say "${SOLVER_PHASES.length} phases across ${methods.size} methods"`);
  const bothWays = SOLVER_PHASES.filter((p) => p.checkedBothWays).length;
  assert.match(text, new RegExp(`${['zero', 'One', 'Two', 'Three', 'Four'][bothWays] ?? bothWays} phases admit both`, 'i'),
    `the note should say ${bothWays} phases admit both generators`);
  // THE PROSE, not the code. An audit found these asserting code values instead: change "Both are 38."
  // to "Both are 999." in the note and every case still passed, which is precisely the drift a
  // document test exists to catch. Each number the note states in words is now read back out of the
  // note and compared with the code.
  const byId = Object.fromEntries(SOLVER_PHASES.map((p) => [p.id, p]));
  // `Number('1,216')` is NaN, so a count with a thousands separator has to have it stripped here.
  // The first version returned the NaN and the caller papered over it with `|| <second match>` —
  // an expression whose first operand was ALWAYS NaN, and which would therefore have kept passing
  // if the second had been wrong. A number this cannot read is a failure, not a fallback.
  const prose = (re, what) => {
    const m = text.match(re);
    assert.ok(m, `the note no longer states ${what} in the form this test reads`);
    const n = Number(m[1].replace(/,/g, ''));
    assert.ok(Number.isFinite(n), `${what}: the note says "${m[1]}", which is not a number`);
    return n;
  };
  assert.equal(prose(/Both are (\d+)\./, 'that stage 5 and the top cross settle the same count'),
    byId['corners-home'].settled, "the note's \"Both are N\" disagrees with the code");
  assert.equal(byId['corners-home'].settled, byId['top-cross'].settled,
    'and the two phases no longer settle the same number at all');

  assert.match(text, /ZZ's first phase settles ten stickers/,
    `the note should say EOLine settles ten; the code says ${byId['zz-eoline'].settled}`);
  assert.equal(byId['zz-eoline'].settled, 10, 'the code no longer agrees with the word "ten"');

  assert.equal(prose(/Every one of the (\d+) non-centre stickers is narrowed/, "G3's narrowed count"),
    byId.g3.narrowed, "the note's G3 count disagrees with the code");
  assert.match(text, /G3 has nothing free at all/, 'the note should say G3 has nothing free');
  assert.equal(byId.g3.free, 0, 'G3 has nothing free, which the note says in words');

  // The algorithm section's headline numbers, read back out of the prose and compared with the
  // ledger. An audit found "999 entries, 999 moves" passing both cases, because nothing was reading
  // the sentence that states them.
  assert.equal(prose(/(\d+) algorithms at the bottom, (?:\d+) at the top/, "the ladder's bottom"), 18);
  assert.equal(prose(/\d+ algorithms at the bottom, (\d+) at the top/, "the ladder's top"), 124);
  const entries = ALGORITHM_SETS.reduce((a, x) => a + x.count, 0);
  const moves = ALGORITHM_SETS.reduce((a, x) => a + x.moves, 0);
  assert.equal(prose(/(\d+) entries, [\d,]+ moves of material/, "the algorithm ledger's entry count"), entries);
  assert.equal(prose(/\d+ entries, ([\d,]+) moves of material/, "the ledger's move total"), moves);
  const proved = ALGORITHM_SETS.filter((x) => x.kind === 'proved').reduce((a, x) => a + x.count, 0);
  const hand = ALGORITHM_SETS.filter((x) => x.kind === 'hand-written').reduce((a, x) => a + x.count, 0);
  assert.equal(prose(/\*\*(\d+) are proven minimal and certified\*\*/, 'the proved count'), proved);
  assert.equal(prose(/\*\*(\d+) are hand-written\*\*/, 'the hand-written count'), hand);
});
