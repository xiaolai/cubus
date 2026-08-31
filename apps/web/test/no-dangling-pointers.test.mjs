// A comment that names a file which does not exist.
//
// Individually this is trivial and that is exactly why it accumulates. A reader follows the
// pointer, finds nothing, and learns that the comments in this repo cannot be trusted — after
// which the genuinely load-bearing ones stop being read too. The comments here carry most of the
// project's reasoning, so that is an expensive thing to let rot.
//
// It rots in bursts, not gradually: a rename or a deletion orphans every pointer to it at once,
// and nothing goes red. Retiring the GAN-only transport left six in one commit — in build.mjs, in
// solve-timer.js twice, in the polyfill and its test, and in the release runbook.
//
// Scope is LIVING source only. dev-docs is deliberately excluded: several of those files are
// marked historical ("Nothing below describes the repo as it is today") or carry dated `Verified:`
// stamps, and a stamp recording what was built on a given day must keep naming what was built —
// renaming it would falsify the record rather than tidy it.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Directories whose comments must not point at anything missing. */
const LIVING = [
  'apps/web/lib',
  'apps/web/test',
  'crates/cube-ble/src',
  'crates/cube-ble/tests',
  'apps/desktop/src-tauri/src',
];

const SOURCE_EXT = /\.(js|mjs|ts|rs)$/;

/** This file names deliberately-missing paths to prove the detector works, so scanning it would
 *  make the gate fail on its own examples. Excluded by name rather than by a marker comment: a
 *  marker is something another file could copy to opt out. */
const SELF = 'no-dangling-pointers.test.mjs';

function sources(dir, out = []) {
  const abs = ROOT + dir;
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs)) {
    const rel = `${dir}/${name}`;
    if (statSync(ROOT + rel).isDirectory()) sources(rel, out);
    else if (SOURCE_EXT.test(name) && name !== SELF) out.push(rel);
  }
  return out;
}

/**
 * Repo-relative paths a comment can be checked against.
 *
 * Two shapes, both unambiguous:
 *   - a path with a directory, rooted at a real top-level dir: `apps/web/lib/foo.js`, `crates/x`
 *   - a bare module filename: `cube-session.js`, `ble-polyfill.test.mjs`
 *
 * A bare name is resolved against the sibling directories a comment would plausibly mean, which
 * is where this class of rot actually happens — a module referring to the one next to it.
 */
const ROOTED = /\b((?:apps|crates|packages|scripts|ml|dev-docs)\/[\w./-]*[\w-])/g;
// The leading lookbehind, not `\b`: after a dot, `\b` matches inside a longer name and captures
// its tail — `ort.bundle.min.mjs` yielded "min.mjs" and `foo.test.mjs` yielded "test.mjs", both
// reported as missing modules that were never named. A checker's own false positives are the
// fastest way to get it deleted.
const BARE = /(?<![\w.-])([a-z][\w-]*\.(?:test\.)?(?:js|mjs|ts|rs))\b/g;

/** Roots a bare filename is looked for under, searched RECURSIVELY.
 *
 *  Recursive because the real references are to nested modules — `decode.ts` means
 *  `packages/gan-driver/src/gen4/decode.ts`, and a flat search would report a live pointer as
 *  dangling. A checker that cries wolf gets deleted, so its resolver has to be at least as good
 *  as the reader it is standing in for. */
const SIBLING_ROOTS = [
  'apps/web/lib',
  'apps/web/test',
  'apps/web/vendor',
  'apps/web',
  'crates',
  'apps/desktop/src-tauri/src',
  'packages/gan-driver/src',
  'packages/cube-scanner',
  'scripts',
  'ml',
];

/**
 * Names that are not repo files and never will be.
 *
 * Not a suppression list for broken pointers — every entry is a thing that genuinely is not a
 * file in this repository. A real dangling pointer must be FIXED, never added here.
 */
const NOT_REPO_FILES = new Set([
  // npm packages and their entry points, named in comments as dependencies.
  'aes-js', 'index.mjs', 'index.cjs', 'ort.mjs', 'three.js', 'cubejs.js',
  // Files inside dependencies, discussed by name.
  'gan-cube-protocol.ts', 'gan.ts', 'types.ts', 'connect.ts', 'ble-utils.ts',
  'address-hints.ts', 'profile-rank.ts', 'build-picker-options.ts', 'gan-mac-salt.ts',
  'gan-cube-encrypter.ts', 'gan-cube-definitions.ts', 'gan-gen234-packet-validate.ts',
  'mock-bluetooth.ts', 'traffic-replayer.ts', 'load-fixture.ts', 'fixture-replay.ts',
  'events.ts', 'gan-bit-reader.ts', 'gan-driver-select.ts',
  // Generated or platform files referenced by name.
  'info.plist', 'project.yml', 'ic_launcher.xml', 'ic_launcher_round.xml',
  // Another project's file, cited for where a technique came from: app.js credits paper-one's
  // platform.ts for the window-chrome UA sniff. Not ours, and never will be.
  'platform.ts',
]);

function extractCandidates(text) {
  // Comments only: code has its own resolution and a bad import fails loudly on its own.
  const comments = [
    ...text.matchAll(/\/\*[\s\S]*?\*\//g),
    ...text.matchAll(/(?:^|[^:])\/\/([^\n]*)/g),
  ].map((m) => m[0]);
  const joined = comments.join('\n');
  return {
    rooted: [...new Set([...joined.matchAll(ROOTED)].map((m) => m[1]))],
    bare: [...new Set([...joined.matchAll(BARE)].map((m) => m[1]))],
  };
}

/** Every filename under the sibling roots, computed once. */
const KNOWN_FILES = (() => {
  const names = new Set();
  const walk = (dir, depth = 0) => {
    const abs = ROOT + dir;
    if (depth > 6 || !existsSync(abs)) return;
    for (const name of readdirSync(abs)) {
      if (name === 'node_modules' || name === 'target' || name === '.git') continue;
      const rel = `${dir}/${name}`;
      if (statSync(ROOT + rel).isDirectory()) walk(rel, depth + 1);
      else names.add(name);
    }
  };
  for (const r of SIBLING_ROOTS) walk(r);
  return names;
})();

const resolvesBare = (name) => KNOWN_FILES.has(name);

/**
 * A file that no longer exists may be named, PROVIDED the text says it is gone.
 *
 * The history is often the most useful thing in a comment — `scramble-worker.js` is worth naming
 * because someone can then find it in git — and a rule that forbids naming deleted things would
 * quietly delete the reasoning along with the file. What a reader cannot afford is a pointer that
 * dangles in SILENCE: they follow it, find nothing, and cannot tell whether the file moved, was
 * renamed, or never existed.
 *
 * So the requirement is a claim, adjacent to the name, that the thing is gone. It is deliberately
 * not a list of allowed names: a list records the absence, whereas this records the FACT, in the
 * place a reader is already looking. A false claim is itself a defect, and a visible one.
 */
const GONE = /\b(deleted|removed|retired|since-deleted|no longer exists|used to|former(?:ly)?)\b/i;

function namedAsGone(text, name) {
  const i = text.indexOf(name);
  if (i === -1) return false;
  // The sentence around the mention: comments here wrap at ~100 columns, so one line either side
  // is the unit a claim and its subject share.
  return GONE.test(text.slice(Math.max(0, i - 220), i + 120));
}

/**
 * dev-docs is gitignored, so whether it is here is a fact about the MACHINE, not about the pointer.
 *
 * Comments across this repo cite dev-docs constantly — it is where the reasoning lives — and on a
 * clone those citations point at nothing through no fault of their own. Checking them anyway would
 * turn a green gate red everywhere except one laptop; skipping them silently would let a genuinely
 * stale dev-docs pointer rot unnoticed on the machine that could have caught it.
 *
 * So the guard is on the dev-docs PART only, exactly as narrowly as the verify-icons precedent
 * requires (AGENTS.md: guard the tool-using part, never the whole function). Every other path stays
 * hard-checked everywhere, and when dev-docs is absent the count of unchecked pointers is REPORTED
 * rather than passed over in silence.
 */
const DEV_DOCS_PRESENT = existsSync(`${ROOT}dev-docs`);

test('every repo path a living comment names actually exists', (t) => {
  const dangling = [];
  let unchecked = 0;
  for (const file of LIVING.flatMap((d) => sources(d))) {
    const { rooted } = extractCandidates(readFileSync(ROOT + file, 'utf8'));
    for (const p of rooted) {
      // Trailing punctuation from prose, and a fragment like `apps/web/lib/` on its own.
      const clean = p.replace(/[.,;:)]+$/, '');
      if (!clean.includes('/') || clean.endsWith('/')) continue;
      if (clean.startsWith('dev-docs/') && !DEV_DOCS_PRESENT) {
        unchecked += 1;
        continue;
      }
      if (!existsSync(ROOT + clean)) dangling.push(`${file}: ${clean}`);
    }
  }
  if (unchecked) {
    t.diagnostic(`${unchecked} dev-docs pointer(s) NOT CHECKED — dev-docs is gitignored and absent here`);
  }
  assert.deepEqual(
    dangling.sort(),
    [],
    'a comment points at a repo path that does not exist. Fix the pointer — a stale one teaches ' +
      'readers to distrust every other comment in the file.',
  );
});

test('every sibling module a living comment names actually exists', () => {
  const dangling = [];
  for (const file of LIVING.flatMap((d) => sources(d))) {
    const text = readFileSync(ROOT + file, 'utf8');
    const { bare } = extractCandidates(text);
    for (const name of bare) {
      if (NOT_REPO_FILES.has(name.toLowerCase())) continue;
      if (resolvesBare(name)) continue;
      if (namedAsGone(text, name)) continue;
      dangling.push(`${file}: ${name}`);
    }
  }
  assert.deepEqual(
    dangling.sort(),
    [],
    'a comment names a module that is not in this repository. If it is a dependency file, add it ' +
      'to NOT_REPO_FILES with that reason; if it is ours, the pointer is stale and must be fixed.',
  );
});

test('the scan is looking at something, and would notice a break', () => {
  // The failure mode of a checker like this is finding nothing because it read nothing. Both
  // halves are pinned: real files were scanned, and a known-bad pointer is detected.
  const files = LIVING.flatMap((d) => sources(d));
  assert.ok(files.length > 20, `only ${files.length} living sources found — the walk is broken`);

  const probe = extractCandidates(`
    // see apps/web/lib/definitely-not-here.js and cube-session.js
    const real = 'apps/web/lib/not-a-comment.js';
  `);
  assert.ok(probe.rooted.includes('apps/web/lib/definitely-not-here.js'), 'must see rooted paths');
  assert.ok(probe.bare.includes('cube-session.js'), 'must see bare module names');
  assert.ok(
    !probe.rooted.includes('apps/web/lib/not-a-comment.js'),
    'must NOT read code as a comment — that would make every string literal a pointer',
  );
  assert.equal(existsSync(ROOT + 'apps/web/lib/definitely-not-here.js'), false);
  assert.ok(resolvesBare('cube-session.js'), 'and must resolve a real sibling');
});

test('a deleted file may be named only when the text says it is gone', () => {
  // The carve-out must not become a loophole: naming a missing file still fails unless the
  // comment makes the absence explicit, which is the whole difference between history and rot.
  assert.equal(
    namedAsGone('// the since-deleted lib/gone-forever.js carried the tables', 'gone-forever.js'),
    true,
    'an explicit claim of absence is allowed',
  );
  assert.equal(
    namedAsGone('// see gone-forever.js for how the tables are built', 'gone-forever.js'),
    false,
    'a silent pointer to a missing file is exactly what this gate is for',
  );
});
