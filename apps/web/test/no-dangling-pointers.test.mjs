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
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Directories whose comments must not point at anything missing.
 *
 *  `apps/web/bench` joined on 2026-09-12. It was left out when this gate was written, on the
 *  reasoning that a benchmark is not shipped — but a benchmark is where the measurements behind a
 *  design note live, and its comments cite more files than any other directory here. Nothing in it
 *  was stale when it was added, which is the only moment adding a directory is cheap. */
const LIVING = [
  'apps/web/lib',
  'apps/web/test',
  'apps/web/bench',
  'apps/desktop/src-tauri/src',
  // Every crate, every package and the repository's scripts, since 2026-09-14. Moving the renderer
  // out of apps/web/lib took its comments out of this scan with nothing noticing, and most of the
  // rest had never been in. Widened, the scan found two stale pointers, both to that move.
  'crates',
  'packages/cubus-cube',
  'packages/cube-scanner/src',
  'packages/cube-scanner/view',
  'packages/cube-scanner/tests',
  'packages/cube-scanner/scripts',
  'packages/gan-driver/src',
  'packages/gan-driver/tests',
  'packages/gan-driver/scripts',
  'scripts',
];

const SOURCE_EXT = /\.(js|mjs|ts|rs)$/;

/** This file names deliberately-missing paths to prove the detector works, so scanning it would
 *  make the gate fail on its own examples. Excluded by name rather than by a marker comment: a
 *  marker is something another file could copy to opt out. */
const SELF = 'no-dangling-pointers.test.mjs';

/**
 * The repository's files as a clone has them: tracked, plus untracked files git does not ignore.
 *
 * Asked of git, never walked off the disk. A walk counted whatever was lying there, and
 * `apps/web/dist/` is ignored build output: a stale local build still held `lib/cubus-cube.js`
 * after the renderer left that path, so a comment naming the old path resolved on the one machine
 * with the stale build and would not have on any clone (found 2026-09-14). No node_modules, no
 * target/, no dist/ — by construction, not by a skip list.
 */
const REPO_FILES = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  cwd: ROOT,
  encoding: 'utf8',
  maxBuffer: 1 << 26,
})
  .split('\n')
  .filter((f) => f && existsSync(ROOT + f));

function sources(dir) {
  return REPO_FILES.filter((f) => f.startsWith(`${dir}/`) && SOURCE_EXT.test(f) && basename(f) !== SELF);
}

/**
 * Repo-relative paths a comment can be checked against.
 *
 * Two shapes, both unambiguous:
 *   - a path with a directory, rooted at a real top-level dir: `apps/web/lib/foo.js`, `crates/x`
 *   - a module, bare or with the directories the comment wrote before it: `cube-session.js`,
 *     `lib/cube-session.js`, `../src/gen4/crypto.js`
 *
 * A module is resolved against the sibling directories a comment would plausibly mean, which is
 * where this class of rot actually happens — a module referring to the one next to it.
 */
const ROOTED = /\b((?:apps|crates|packages|scripts|ml|dev-docs)\/[\w./-]*[\w-])/g;
// The leading lookbehind, not `\b`: after a dot, `\b` matches inside a longer name and captures
// its tail — `ort.bundle.min.mjs` yielded "min.mjs" and `foo.test.mjs` yielded "test.mjs", both
// reported as missing modules that were never named. A checker's own false positives are the
// fastest way to get it deleted.
//
// And not after a `/` either, so a module is captured with its directories rather than from its
// last segment. Reading `lib/cubus-cube.js` as `cubus-cube.js` resolved it against the renderer's
// new home in packages/, and a pointer to the path it had left stood green (found 2026-09-14).
const MODULE = /(?<![\w./-])((?:\.{1,2}\/)*(?:[\w-]+\/)*[a-z][\w-]*\.(?:test\.)?(?:js|mjs|ts|rs))\b/g;

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
  // The renderer, its build and its manifest reader, since 2026-09-14. Without this root every
  // comment that names one of them dangles — which is how the move was noticed here first.
  'packages/cubus-cube',
  'packages/gan-driver/tests',
  'packages/gan-driver/scripts',
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
  // npm packages and their entry points, named in comments as dependencies. `cubing.js` is the
  // library the app drew with before <cubus-cube>, named where that history is told.
  'aes-js', 'index.mjs', 'index.cjs', 'ort.mjs', 'three.js', 'cubejs.js', 'cubing.js',
  // Files inside dependencies, discussed by name.
  'gan-cube-protocol.ts', 'gan.ts', 'types.ts', 'connect.ts', 'ble-utils.ts',
  'address-hints.ts', 'profile-rank.ts', 'build-picker-options.ts', 'gan-mac-salt.ts',
  'gan-cube-encrypter.ts', 'gan-cube-definitions.ts', 'gan-gen234-packet-validate.ts',
  'mock-bluetooth.ts', 'traffic-replayer.ts', 'load-fixture.ts', 'fixture-replay.ts',
  'events.ts', 'gan-bit-reader.ts', 'gan-driver-select.ts', 'gan-smart-cube.ts',
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
    modules: [...new Set([...joined.matchAll(MODULE)].map((m) => m[1]))],
  };
}

/** Every repository file under the sibling roots, computed once. */
const KNOWN_PATHS = REPO_FILES.filter((f) => SIBLING_ROOTS.some((r) => f.startsWith(`${r}/`)));

/**
 * Does `name` — a bare filename or a partial path — end some file under the sibling roots?
 *
 * Leading `./` and `../` are dropped: a comment quoting an import is relative to the file that
 * does the importing, which is rarely the file the comment sits in. And a `.js` name also matches
 * its `.ts` source, because that is how a TypeScript ES module import names one.
 */
function resolvesModule(name) {
  const tail = name.replace(/^(?:\.{1,2}\/)+/, '');
  const spellings = tail.endsWith('.js') ? [tail, `${tail.slice(0, -3)}.ts`] : [tail];
  return KNOWN_PATHS.some((p) => spellings.some((sp) => p === sp || p.endsWith(`/${sp}`)));
}

/** The nearest package or crate above `file`: inside one, `scripts/x.ts` is ITS scripts. */
function packageRootOf(file) {
  for (let d = dirname(file); d !== '.' && d !== '/'; d = dirname(d)) {
    if (existsSync(`${ROOT}${d}/package.json`) || existsSync(`${ROOT}${d}/Cargo.toml`)) return d;
  }
  return null;
}

const ROOTED_SHAPE = /^(?:apps|crates|packages|scripts|ml|dev-docs)\//;

/** Is `path` a repository file, or a directory holding one? Asked of git's list, like the rest. */
const inRepo = (path) => REPO_FILES.includes(path) || REPO_FILES.some((f) => f.startsWith(`${path}/`));

/**
 * What a full-path pointer can be said to be: `exists`, `ignored` or `dangling`.
 *
 * Existence on the DISK was the test here, and a path under a gitignored directory made that a fact
 * about the machine: `ml/venv/bin/python`, named in a scanner test's comment, exists wherever the
 * venv was made and nowhere else, so this passed on the Mac and failed on CI (2026-09-15). A path
 * git ignores is something a checkout makes, not something it has, so it is UNCHECKED — counted
 * and reported, never passed and never failed, the stance dev-docs already takes.
 */
function rootedVerdict(file, path) {
  const home = packageRootOf(file);
  if (inRepo(path) || (home && inRepo(`${home}/${path}`))) return 'exists';
  const ignored = (candidate) => {
    try {
      execFileSync('git', ['check-ignore', '--no-index', '-q', candidate], { cwd: ROOT, stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  };
  if (ignored(path) || (home && ignored(`${home}/${path}`))) return 'ignored';
  return 'dangling';
}

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
  let ignored = 0;
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
      // dev-docs is gitignored too, but checked where it is present (see DEV_DOCS_PRESENT).
      if (clean.startsWith('dev-docs/')) {
        if (!existsSync(ROOT + clean)) dangling.push(`${file}: ${clean}`);
        continue;
      }
      const verdict = rootedVerdict(file, clean);
      if (verdict === 'ignored') ignored += 1;
      else if (verdict === 'dangling') dangling.push(`${file}: ${clean}`);
    }
  }
  if (unchecked) {
    t.diagnostic(`${unchecked} dev-docs pointer(s) NOT CHECKED — dev-docs is gitignored and absent here`);
  }
  if (ignored) {
    t.diagnostic(`${ignored} pointer(s) into gitignored paths NOT CHECKED — what a checkout makes, not what it has`);
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
    const { modules, rooted } = extractCandidates(text);
    for (const name of modules) {
      if (ROOTED_SHAPE.test(name)) continue; // a rooted path, which the case above checks exactly
      if (NOT_REPO_FILES.has(basename(name).toLowerCase())) continue;
      // Named beside its full path — `state.js (dev-docs/spikes/cube-state/state.js)` — which the
      // rooted case checks exactly, dev-docs rule and all. Resolving the short name as well would
      // check it against the wrong set of files.
      if (rooted.some((r) => r.endsWith(`/${basename(name)}`) && r.endsWith(name.replace(/^(?:\.{1,2}\/)+/, '')))) continue;
      if (resolvesModule(name)) continue;
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
  assert.ok(probe.modules.includes('cube-session.js'), 'must see bare module names');
  assert.ok(
    !probe.rooted.includes('apps/web/lib/not-a-comment.js'),
    'must NOT read code as a comment — that would make every string literal a pointer',
  );
  assert.equal(existsSync(ROOT + 'apps/web/lib/definitely-not-here.js'), false);
  assert.ok(resolvesModule('cube-session.js'), 'and must resolve a real sibling');

  // A path is read whole and resolved whole. The real file's NAME behind a wrong directory must
  // not resolve — that is exactly how `lib/cubus-cube.js` stood green after the renderer moved.
  assert.ok(extractCandidates('// see lib/cube-session.js').modules.includes('lib/cube-session.js'),
    'must capture a module with its directories, not only its last segment');
  assert.ok(resolvesModule('lib/cube-session.js'), 'must resolve a real partial path');
  assert.equal(resolvesModule('nowhere/cube-session.js'), false, 'a real name under a wrong directory resolved');
  assert.ok(resolvesModule('../src/gen4/crypto.js'), 'must resolve a TypeScript import spelling');
  // A full path is judged the same way on every machine: a gitignored one is unchecked wherever it
  // happens to exist, a tracked one exists, and one that is neither dangles.
  assert.equal(rootedVerdict('packages/cube-scanner/tests/x.test.ts', 'ml/venv/bin/python'), 'ignored');
  assert.equal(rootedVerdict('apps/web/lib/app.js', 'apps/web/lib/cube-session.js'), 'exists');
  assert.equal(rootedVerdict('apps/web/lib/app.js', 'apps/web/lib/definitely-not-here.js'), 'dangling');
  // And the files it resolves against are the repository's, not the disk's.
  const outputs = REPO_FILES.filter((f) => /(^|\/)(node_modules|dist|target)\//.test(f));
  assert.deepEqual(outputs, [], 'ignored build output is being counted as repository files');
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
