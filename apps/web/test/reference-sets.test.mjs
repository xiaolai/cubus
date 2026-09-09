// `scripts/fetch-reference-sets.mjs` FAILS CLOSED, and this is what that means concretely.
//
// The script's whole job is a refusal: a reference set may be fetched anywhere except inside this
// repository. A refusal made of string arithmetic is the kind that looks right and is not, so
// every way a write could reach the tree is pinned here rather than argued about in a comment —
// including the two paths the old check could not see (a name that merely STARTS with `..`, and a
// symlink that resolves inward) and the one it never looked at at all (the provenance file, which
// sits beside the checkout rather than in it).
//
// The command line is pinned for the same reason. `--scrtach /somewhere` used to be dropped in
// silence: the typo vanished, the path became a stray positional, and the run reported success
// having fetched into the default directory. A parser that ignores what it does not understand
// turns a wrong command into a confident wrong answer.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  REPO_ROOT,
  SETS,
  UsageError,
  checkScratch,
  parseArgs,
  writeProvenance,
} from '../../../scripts/fetch-reference-sets.mjs';

const scratch = () => mkdtempSync(join(realpathSync(tmpdir()), 'cubus-refsets-'));

test('every path inside the repository is refused, including the ones that look like escapes', () => {
  const inside = [
    REPO_ROOT,
    `${REPO_ROOT}/`,
    `${REPO_ROOT}/apps/web`,
    `${REPO_ROOT}/scratch/cubing-algs`,
    // The prefix test on `..` read both of these as leaving the root. They do not: they are
    // children whose NAMES begin with two dots, and a fetch into either lands in the tree.
    `${REPO_ROOT}/..scratch/cubing-algs`,
    `${REPO_ROOT}/...`,
    // Round trips that end where they started.
    `${REPO_ROOT}/apps/../packages`,
  ];
  for (const path of inside) {
    assert.throws(() => checkScratch(path), /inside the repository/, path);
  }
});

test('a symlink that resolves into the repository is refused, however it is spelt', () => {
  const dir = scratch();
  try {
    // `/tmp/…/pointer -> REPO_ROOT/apps`. `resolve()` sees a path under /tmp and says "outside";
    // the write would land in `apps/`.
    const pointer = join(dir, 'pointer');
    symlinkSync(`${REPO_ROOT}/apps`, pointer);
    assert.throws(() => checkScratch(pointer), /inside the repository/, 'the link itself');
    assert.throws(() => checkScratch(`${pointer}/web`), /inside the repository/, 'through the link');
    assert.throws(
      () => checkScratch(`${pointer}/web/does-not-exist-yet`),
      /inside the repository/,
      'a destination that does not exist yet, under the link',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a genuine scratch path is accepted and comes back canonical', () => {
  const dir = scratch();
  try {
    const nested = join(dir, 'sets', 'cubing-algs');
    assert.equal(checkScratch(nested), nested, 'a destination that does not exist yet');
    mkdirSync(nested, { recursive: true });
    assert.equal(checkScratch(nested), nested, 'and once it does');
    // The caller writes through the path this function judged, not the one it was handed.
    const link = join(dir, 'link');
    symlinkSync(join(dir, 'sets'), link);
    assert.equal(checkScratch(join(link, 'cubing-algs')), nested, 'resolved through a link');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the provenance write refuses a symlink instead of writing through it', () => {
  const dir = scratch();
  try {
    const checkoutDir = join(dir, 'cubing-algs');
    mkdirSync(checkoutDir);
    const decoy = join(dir, 'decoy.md');
    writeFileSync(decoy, 'untouched\n');
    symlinkSync(decoy, `${checkoutDir}.PROVENANCE.md`);
    assert.throws(
      () => writeProvenance('cubing-algs', SETS['cubing-algs'], checkoutDir, 'deadbeef'),
      /symlink/,
    );
    assert.equal(readFileSync(decoy, 'utf8'), 'untouched\n', 'the link target is not written');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the provenance write replaces an ordinary file and leaves no temporary behind', () => {
  const dir = scratch();
  try {
    const checkoutDir = join(dir, 'cubing-algs');
    mkdirSync(checkoutDir);
    const path = `${checkoutDir}.PROVENANCE.md`;
    writeFileSync(path, 'stale\n');
    assert.equal(writeProvenance('cubing-algs', SETS['cubing-algs'], checkoutDir, 'deadbeef'), path);
    const body = readFileSync(path, 'utf8');
    assert.match(body, /deadbeef/);
    assert.match(body, /https:\/\/github\.com\/Logiqx\/cubing-algs/);
    assert.deepEqual(
      readdirSync(dir).filter((f) => f.endsWith('.tmp')),
      [],
      'no temporary file survives a successful write',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the parser refuses every command line that does not mean exactly what it says', () => {
  const refused = [
    [[], /set name is required/],
    [['--scrtach', '/requested/path'], /unknown option/],
    [['cubing-algs', '--scrtach', '/requested/path'], /unknown option/],
    [['cubing-algs', 'extra'], /unexpected argument/],
    [['cubing-algs', '--scratch'], /--scratch needs a directory/],
    [['cubing-algs', '--scratch', '--list'], /--scratch needs a directory/],
    [['cubing-algs', '--scratch', '/a', '--scratch', '/b'], /--scratch given twice/],
    [['--list', '--list'], /--list given twice/],
    [['--list', 'cubing-algs'], /--list takes no set name/],
    [['--list', '--scratch', '/a'], /--list takes no --scratch/],
    [['no-such-set'], /unknown set/],
    // Inherited properties are not sets. Each of these used to pass the `if (!set)` guard and
    // reach `checkout()` with an undefined repository.
    [['toString'], /unknown set/],
    [['constructor'], /unknown set/],
    [['__proto__'], /unknown set/],
    [['hasOwnProperty'], /unknown set/],
  ];
  for (const [argv, message] of refused) {
    assert.throws(() => parseArgs(argv), (err) => err instanceof UsageError && message.test(err.message), argv.join(' '));
  }
});

test('the parser accepts the three command lines the usage line documents', () => {
  assert.deepEqual(parseArgs(['--list']), { list: true });
  const plain = parseArgs(['cubing-algs']);
  assert.equal(plain.list, false);
  assert.equal(plain.name, 'cubing-algs');
  assert.match(plain.root, /cubus-reference-sets$/);
  assert.deepEqual(parseArgs(['cubing-algs', '--scratch', '/somewhere/else']), {
    list: false,
    name: 'cubing-algs',
    root: '/somewhere/else',
  });
  assert.deepEqual(parseArgs(['--scratch', '/somewhere/else', 'cubing-algs']), {
    list: false,
    name: 'cubing-algs',
    root: '/somewhere/else',
  });
});

// THE ENTRY GUARD, end to end. Comparing `import.meta.url` against a hand-interpolated
// `file://` URL puts a real URL next to a spelt-out one, and they stop matching the moment the
// checkout path contains a character a URL means something by. The script then imports cleanly,
// runs nothing, and exits 0 — a fetch that reports success and did not happen.
test('the CLI runs from a path containing URL punctuation, and refuses a bad option there too', () => {
  const dir = scratch();
  try {
    const awkward = join(dir, 'chk#1 ?a=b%20c');
    mkdirSync(awkward, { recursive: true });
    const copy = join(awkward, 'fetch-reference-sets.mjs');
    writeFileSync(copy, readFileSync(new URL('../../../scripts/fetch-reference-sets.mjs', import.meta.url), 'utf8'));

    const listed = spawnSync(process.execPath, [copy, '--list'], { encoding: 'utf8' });
    assert.equal(listed.status, 0, listed.stderr);
    assert.match(listed.stdout, /cubing-algs/, 'main() ran rather than being silently skipped');

    // The same script reached through a symlinked ancestor. `import.meta.url` is the realpath and
    // `process.argv[1]` is not, so an entry check that compares them literally sees "imported".
    const linked = join(dir, 'via-link');
    symlinkSync(awkward, linked);
    const throughLink = spawnSync(process.execPath, [join(linked, 'fetch-reference-sets.mjs'), '--list'], { encoding: 'utf8' });
    assert.equal(throughLink.status, 0, throughLink.stderr);
    assert.match(throughLink.stdout, /cubing-algs/, 'main() ran when reached through a symlink');

    const refused = spawnSync(process.execPath, [copy, 'cubing-algs', '--scrtach', '/tmp/x'], { encoding: 'utf8' });
    assert.equal(refused.status, 1, "a mistyped option is a failure, not a default-directory fetch");
    assert.match(refused.stderr, /unknown option: --scrtach/);
    assert.match(refused.stderr, /usage: node scripts\/fetch-reference-sets\.mjs/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
