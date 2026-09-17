// The feature ledger, held to the repository it describes.
//
// `dev-docs/feature-ledger.md` is the index of what this product does: one row per capability,
// naming where it is implemented, what holds it, and where it was decided. It deliberately does
// NOT restate any of those things — the decision lives in its ADR or design note, the behaviour
// lives in its tests, and a second copy would be a second place for one to be wrong. That is the
// same split `algorithm-ledger.test.mjs` draws for the algorithms, and it makes DRIFT the whole
// risk: a ledger row that names a file which moved is worse than no row, because it is believed.
//
// WHY THIS FILE IS CHECKED WHEN ITS NEIGHBOURS ARE NOT. `no-dangling-pointers.test.mjs` scans
// living source for comments naming missing files and excludes `dev-docs/` on purpose: most of
// those notes are dated records, and a stamp recording what was built on a given day must keep
// naming what was built — renaming it would falsify the record rather than tidy it. The ledger is
// the one file in that directory which is NOT a record of a day. It is a live index, it claims to
// describe the repository as it is now, and a claim in this repository is backed by a check that
// fails when it stops being true. So this scan is the ledger's alone, and widening it to the rest
// of dev-docs would break the neighbours' reasoning, not extend it.
//
// WHAT THIS CANNOT CHECK, stated so nobody mistakes a green run for more than it is: that a row's
// prose is TRUE. Nothing here reads whether "Timer" really times, only that the paths it names
// exist, that a shipped row names something that holds it, and that no screen, workspace member or
// ADR is missing from the ledger entirely. The last of those is the direction that matters — it is
// an assertion about what must NOT happen, which is that a capability lands with no row at all.
//
// `dev-docs/` is gitignored (2026-09-06, the maintainer's decision record). A clone does not have
// it, so every case here SKIPS when the ledger is absent and says so. A skip is never a pass:
// `t.skip()` and not a bare `t.diagnostic()`, for the reason `scanner-gpu.test.mjs` records — a
// diagnostic still tallies the case under `pass`, and cases counted green where none ran is the
// exact failure this repository refuses everywhere else.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const LEDGER_PATH = `${ROOT}dev-docs/feature-ledger.md`;

/** The statuses a row may carry. Small and closed on purpose: a vocabulary that grows a synonym
 *  per row stops sorting anything. Their meanings are defined in the ledger's own header, and the
 *  header is checked against this list below so the two cannot drift apart. */
const STATUSES = Object.freeze(['shipped', 'partial', 'planned', 'declined', 'removed']);

/** Statuses that assert something is in the product today, and so must name what holds it. */
const LIVE = Object.freeze(['shipped', 'partial']);

/** The columns a ledger table must have, in order. */
const COLUMNS = Object.freeze(['Feature', 'Status', 'Code', 'Tests', 'Decided in']);

/**
 * Every row of every ledger table.
 *
 * Parsed by SHAPE rather than by position in the file: any markdown table whose header is exactly
 * `COLUMNS` is a ledger table, wherever it sits and however many there are. That way the document
 * can be reorganised into new sections without the parser needing to know the section names — the
 * failure mode of a positional parser is that it silently reads fewer rows than the file has, and
 * a completeness check that reads half the ledger passes for the wrong reason.
 */
function parseLedger(text) {
  const lines = text.split('\n');
  const rows = [];
  let header = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) { header = null; continue; }
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (header === null) {
      // A header, or the `---` rule under one. Only a header matching COLUMNS opens a table.
      if (cells.every((c) => /^:?-{3,}:?$/.test(c))) continue;
      header = cells.length === COLUMNS.length && cells.every((c, k) => c === COLUMNS[k]) ? cells : null;
      continue;
    }
    if (cells.every((c) => /^:?-{3,}:?$/.test(c))) continue;
    assert.equal(cells.length, COLUMNS.length,
      `dev-docs/feature-ledger.md:${i + 1}: a row has ${cells.length} cells, not ${COLUMNS.length}: ${line}`);
    const [feature, status, code, tests, decided] = cells;
    rows.push({ line: i + 1, feature, status, code, tests, decided });
  }
  return rows;
}

/** The backticked paths in a cell. A cell may also carry prose; only `backticks` are claims. */
function pathsIn(cell) {
  const out = [];
  const re = /`([^`]+)`/g;
  let m;
  while ((m = re.exec(cell)) !== null) {
    const raw = m[1].trim();
    // A section pointer (`foo.md §3`) names the file; the section is prose to a filesystem.
    const path = raw.split(/\s+§/)[0].trim();
    if (path) out.push(path);
  }
  return out;
}

/** A cell's text, stripped of the emphasis and code marks the table uses for readability. The
 *  status column writes `shipped` rather than shipped so the vocabulary reads as a closed set, and
 *  two feature names carry a backticked identifier; neither is a claim about a file. */
const nameOf = (cell) => cell.replace(/\*\*/g, '').replace(/`/g, '').trim();

/** Directory entries, or `[]` when the directory is not there. */
function dirEntries(rel) {
  try {
    return readdirSync(ROOT + rel, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Read the ledger, or skip the case saying why. Returns null when it is absent. */
function readLedger(t) {
  if (!existsSync(LEDGER_PATH)) {
    t.skip('dev-docs/feature-ledger.md NOT CHECKED — dev-docs is gitignored and absent here');
    return null;
  }
  return readFileSync(LEDGER_PATH, 'utf8');
}

test('every path the ledger names exists', (t) => {
  const text = readLedger(t);
  if (text === null) return;
  const rows = parseLedger(text);
  assert.ok(rows.length > 0, 'the ledger has no rows — the parser found no table with the expected header');

  // Code / Tests / Decided in are PATH-ONLY columns: every backticked token in them is a claim
  // that a file is there. Identifiers a row wants to name (`settings.proveMinimum`, `VERSION`)
  // belong in the Feature cell or in the prose around the table, where nothing resolves them.
  const missing = [];
  for (const row of rows) {
    // A `removed` row names what is gone on purpose — its code and tests left with it, and the
    // pointer that matters is to the record of why. So the record is checked and the corpse is not.
    const columns = nameOf(row.status) === 'removed' ? ['decided'] : ['code', 'tests', 'decided'];
    for (const column of columns) {
      for (const path of pathsIn(row[column])) {
        if (!existsSync(ROOT + path)) {
          missing.push(`line ${row.line} (${nameOf(row.feature)}) → ${column}: ${path}`);
        }
      }
    }
  }
  assert.deepEqual(missing, [],
    `the ledger names paths that do not exist — it has drifted from the repository:\n  ${missing.join('\n  ')}`);
});

test('every row carries a status from the ledger\'s own vocabulary', (t) => {
  const text = readLedger(t);
  if (text === null) return;

  // The header defines the vocabulary for a reader; STATUSES defines it for this check. Two
  // definitions of one list is exactly what the ledger exists to prevent, so they are compared.
  for (const status of STATUSES) {
    assert.ok(text.includes(`\`${status}\``),
      `the ledger's header does not define the status \`${status}\`, which this check accepts`);
  }

  const wrong = parseLedger(text)
    .filter((r) => !STATUSES.includes(nameOf(r.status)))
    .map((r) => `line ${r.line} (${nameOf(r.feature)}): "${r.status}"`);
  assert.deepEqual(wrong, [],
    `rows with a status outside ${STATUSES.join(' / ')}:\n  ${wrong.join('\n  ')}`);
});

test('a feature that ships names something that holds it', (t) => {
  const text = readLedger(t);
  if (text === null) return;

  // The repository's contract, applied to the index of itself: a claim is backed by a test that
  // fails when the claim stops being true. A row saying `shipped` with an empty Tests cell is a
  // capability nothing is watching, and the ledger is where that becomes visible rather than a
  // thing someone notices later.
  const unheld = parseLedger(text)
    .filter((r) => LIVE.includes(nameOf(r.status)))
    .filter((r) => pathsIn(r.tests).length === 0)
    .map((r) => `line ${r.line}: ${nameOf(r.feature)}`);
  assert.deepEqual(unheld, [],
    `rows claiming to ship with nothing named that holds them:\n  ${unheld.join('\n  ')}`);
});

test('a feature that ships names the code that implements it', (t) => {
  const text = readLedger(t);
  if (text === null) return;
  const bodiless = parseLedger(text)
    .filter((r) => LIVE.includes(nameOf(r.status)))
    .filter((r) => pathsIn(r.code).length === 0)
    .map((r) => `line ${r.line}: ${nameOf(r.feature)}`);
  assert.deepEqual(bodiless, [],
    `rows claiming to ship with no implementing path named:\n  ${bodiless.join('\n  ')}`);
});

test('a planned feature names where it was decided', (t) => {
  const text = readLedger(t);
  if (text === null) return;

  // Without a decision record a `planned` row is a wish, and a list of wishes filed beside a list
  // of commitments is how the two stop being told apart.
  const undecided = parseLedger(text)
    .filter((r) => nameOf(r.status) === 'planned')
    .filter((r) => pathsIn(r.decided).length === 0)
    .map((r) => `line ${r.line}: ${nameOf(r.feature)}`);
  assert.deepEqual(undecided, [],
    `planned rows with no decision record named:\n  ${undecided.join('\n  ')}`);
});

test('no two rows describe the same feature', (t) => {
  const text = readLedger(t);
  if (text === null) return;
  const seen = new Map();
  const duplicates = [];
  for (const row of parseLedger(text)) {
    const name = nameOf(row.feature).toLowerCase();
    if (seen.has(name)) duplicates.push(`"${nameOf(row.feature)}" at lines ${seen.get(name)} and ${row.line}`);
    else seen.set(name, row.line);
  }
  assert.deepEqual(duplicates, [], `the ledger describes a feature twice:\n  ${duplicates.join('\n  ')}`);
});

test('every screen is in the ledger', (t) => {
  const text = readLedger(t);
  if (text === null) return;

  // The completeness direction, and the reason this file is worth having. A screen is the coarsest
  // unit of "something a user can reach", so a screen absent from the ledger is a capability the
  // index does not know about. This fails when one is added, which is the moment to record it.
  const screens = dirEntries('apps/web/lib/screens')
    .filter((e) => e.isFile() && e.name.endsWith('.js'))
    .map((e) => `apps/web/lib/screens/${e.name}`);
  assert.ok(screens.length > 0, 'no screens found — apps/web/lib/screens/ moved and this check went blind');

  const named = new Set(parseLedger(text).flatMap((r) => [...pathsIn(r.code), ...pathsIn(r.tests)]));
  const absent = screens.filter((s) => !named.has(s));
  assert.deepEqual(absent, [],
    `screens no ledger row names — a user-facing surface with no entry in the index:\n  ${absent.join('\n  ')}`);
});

test('every workspace member is in the ledger', (t) => {
  const text = readLedger(t);
  if (text === null) return;

  // Same direction one level up: an app, a crate or a package is a deliberate unit of the product,
  // and a new one is always a feature. `packages/*` and `crates/*` are read off the disk rather
  // than off the manifests so that a member added to the tree but not yet wired into a workspace
  // is still caught — the gap between those two is exactly where a thing goes unrecorded.
  const members = ['apps', 'crates', 'packages'].flatMap((dir) =>
    dirEntries(dir).filter((e) => e.isDirectory()).map((e) => `${dir}/${e.name}`));
  assert.ok(members.length > 0, 'no workspace members found — the layout moved and this check went blind');

  const text_ = text;
  const absent = members.filter((m) => !text_.includes(`\`${m}`));
  assert.deepEqual(absent, [],
    `workspace members the ledger never mentions:\n  ${absent.join('\n  ')}`);
});

test('every architecture decision record is in the ledger', (t) => {
  const text = readLedger(t);
  if (text === null) return;

  // An ADR is a decision expensive to reverse. If the ledger does not point at one, the feature it
  // governs is being described without its reasoning, and the next person re-derives it.
  const adrs = dirEntries('dev-docs/adr')
    .filter((e) => e.isFile() && e.name.endsWith('.md') && e.name !== 'README.md')
    .map((e) => `dev-docs/adr/${e.name}`);
  assert.ok(adrs.length > 0, 'no ADRs found — dev-docs/adr/ moved and this check went blind');

  const named = new Set(parseLedger(text).flatMap((r) => pathsIn(r.decided)));
  const absent = adrs.filter((a) => !named.has(a));
  assert.deepEqual(absent, [],
    `ADRs no ledger row points at:\n  ${absent.join('\n  ')}`);
});
