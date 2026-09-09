// Fetch a published last-layer algorithm set to a scratch path OUTSIDE this repository, and
// record where it came from.
//
// Plan B5 (dev-docs/method-solver-return-plan.md §9), and the rule it enforces is the plan's
// containment rule, stated there as non-negotiable:
//
//   > reference sets are fetched to a scratch path **outside the repository**, are never
//   > committed, never vendored, never bundled. What enters `dev-docs/` is a **comparison
//   > report** — our numbers, and whether they agreed — plus provenance: which repository, which
//   > commit SHA, which licence, retrieved when.
//
// **Why a script rather than a `curl` in a note.** The failure this guards against has happened
// in this repository: `vendor/min2phase.PROVENANCE.md` records a third-party artifact vendored
// before anyone checked its licence, on the evidence of a directory name. A checkout is easy; the
// discipline is remembering, every time, that the thing must land outside the tree and that its
// provenance must be written down at the moment it arrives rather than reconstructed later.
// A script forgets neither, and it FAILS CLOSED — it refuses to write anywhere inside the
// repository, whatever it is asked to do.
//
// **Failing closed is about the write, not about the string.** Three ways a containment check
// made of string arithmetic lets a write inside the tree through, all of them fixed here and all
// of them pinned by `apps/web/test/reference-sets.test.mjs`:
//
//   - a prefix test on `..` reads `REPO_ROOT/..scratch` as an escape, because the name STARTS
//     with two dots. Containment is a question about path COMPONENTS, so it is asked that way;
//   - `resolve()` does not follow symlinks, so `/tmp/out -> REPO_ROOT/inside` passes a check on
//     the literal path and then writes into the repository. Every existing ancestor is
//     canonicalized with `realpathSync` before the question is asked, and the canonical path is
//     what is handed to `git`;
//   - the provenance file sits BESIDE the checkout, and `writeFileSync` follows a symlink at its
//     destination. That path is refused if it is a link, and written through a temporary file and
//     a rename, which replaces a directory entry rather than writing through one.
//
// **What we take, and what we do not.** Integers and structure: how many cases a set has, and
// what HTM length each of its algorithms normalizes to. Reading a set to compare numbers is not
// copying it, and it is exactly `why-our-own-proven-data.md`'s pattern — published data is what
// our numbers are checked against. Nothing from a set is ever an input to what we ship, and
// §7a finding F sets the reason out: generation survives on face-turns-only, provable minimality
// and regenerability, independently of any licence question.
//
//   node scripts/fetch-reference-sets.mjs --list
//   node scripts/fetch-reference-sets.mjs cubing-algs
//   node scripts/fetch-reference-sets.mjs cubing-algs --scratch ~/scratch/cubus-reference
//
// The default scratch root is `$TMPDIR/cubus-reference-sets`, which is outside every checkout.

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The sets worth consulting, and what each one is actually good for.
 *
 * `licence` is what the project STATES, recorded verbatim rather than interpreted — the min2phase
 * note is the standing reminder that a classification is not a grant. Nothing here is relied on
 * being permissive: the containment rule holds under every answer, which is why it is cheap.
 */
export const SETS = Object.freeze({
  'cubing-algs': {
    repo: 'https://github.com/Logiqx/cubing-algs',
    licence: 'GPL-3.0 (as stated by the project)',
    covers: 'OLL and PLL algorithm sets, in standard notation with slice and wide moves',
    note:
      'The set §7a finding F is about. Consulted for per-case HTM lengths and for the ' +
      'case-set structure check; never copied, and never an input to a generated table.',
  },
});

/** A wrong command line, as distinct from a refused destination or a failed `git`. */
export class UsageError extends Error {}

/** `lstat` without the throw when there is simply nothing there. Anything else propagates. */
function lstatIfPresent(path) {
  try {
    return lstatSync(path);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * `target` with every EXISTING ancestor resolved through its symlinks.
 *
 * `resolve()` alone answers a question about a string; containment is a question about the file
 * the write will land in. Walk up to the deepest component that exists, canonicalize THAT with
 * `realpathSync`, and re-attach the components that do not exist yet — a checkout directory is
 * normally one of them. A symlink that cannot be resolved (dangling, or a loop) raises rather
 * than being silently treated as absent, because a path we cannot canonicalize is a path whose
 * containment we cannot decide.
 */
function canonicalize(target) {
  const missing = [];
  let cur = resolve(target);
  for (;;) {
    if (lstatIfPresent(cur)) return join(realpathSync(cur), ...missing);
    const parent = dirname(cur);
    if (parent === cur) return join(cur, ...missing);
    missing.unshift(basename(cur));
    cur = parent;
  }
}

/**
 * Where a scratch checkout may live: anywhere that is NOT inside this repository.
 *
 * Returns the CANONICAL destination, so the caller writes through the path this function judged
 * rather than through a differently-spelt one that resolves somewhere else.
 */
export function checkScratch(path) {
  const target = canonicalize(path.replace(/^~(?=$|\/)/, homedir()));
  const rel = relative(realpathSync(REPO_ROOT), target);
  // Outside means the relative path leaves the root as a whole COMPONENT, or does not start from
  // it at all (a different drive or root, where `relative` returns an absolute path). `rel === ''`
  // is the repository root itself, and is inside.
  const outside = rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
  if (!outside) {
    throw new Error(
      `refusing to fetch into ${target}: it is inside the repository (${REPO_ROOT}).\n` +
        'A reference set is never committed, never vendored and never bundled — see the ' +
        'containment rule in dev-docs/method-solver-return-plan.md and the caution in ' +
        'apps/web/vendor/min2phase.PROVENANCE.md.',
    );
  }
  return target;
}

/** Two spellings of the same GitHub repository, compared as one. */
function sameRepo(a, b) {
  const canon = (url) => url.trim().replace(/\.git$/, '').replace(/\/+$/, '').toLowerCase();
  return canon(a) === canon(b);
}

function git(dir, args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
}

/**
 * Shallow clone, or `git fetch` if it is already there. Returns the commit SHA.
 *
 * A directory that already holds a `.git` is NOT taken on trust. The provenance file this run is
 * about to write names `set.repo`, so reusing a checkout of anything else would attribute one
 * project's algorithms to another — and `checkout --force` would throw away whatever local work
 * was sitting in it on the way. Both are refused: the origin has to be the repository we asked
 * for, and the tree has to be clean. The fetch then names the URL rather than the remote, so the
 * commit that arrives comes from the repository the provenance record claims.
 */
function checkout(set, dir) {
  if (existsSync(`${dir}/.git`)) {
    let origin;
    try {
      origin = git(dir, ['remote', 'get-url', 'origin']);
    } catch {
      throw new Error(`${dir} is a git checkout with no \`origin\` remote — refusing to reuse it.`);
    }
    if (!sameRepo(origin, set.repo)) {
      throw new Error(
        `${dir} is a checkout of ${origin}, not ${set.repo}.\n` +
          'Refusing to fetch over it: the provenance record would name the wrong project. ' +
          'Delete the directory, or pass a different --scratch root.',
      );
    }
    const dirty = git(dir, ['status', '--porcelain']);
    if (dirty) {
      throw new Error(
        `${dir} has local changes — refusing to \`checkout --force\` over them:\n${dirty}`,
      );
    }
    execFileSync('git', ['-C', dir, 'fetch', '--depth', '1', set.repo], { stdio: 'inherit' });
    execFileSync('git', ['-C', dir, 'checkout', '--force', 'FETCH_HEAD'], { stdio: 'inherit' });
  } else {
    mkdirSync(dirname(dir), { recursive: true });
    execFileSync('git', ['clone', '--depth', '1', set.repo, dir], { stdio: 'inherit' });
  }
  return git(dir, ['rev-parse', 'HEAD']);
}

/**
 * The provenance record, written beside the checkout and NEVER inside the repository.
 *
 * Written at the moment the set arrives. Reconstructing "which commit did we read, and when" a
 * month later is the thing that does not happen, and a comparison report whose provenance is a
 * guess is a report nobody can act on.
 *
 * `writeFileSync` FOLLOWS a symlink at its destination, and this path is a sibling of the
 * checkout rather than the checkout itself — so it is the one path `checkScratch` never saw. A
 * link there is refused outright, and the write goes through a temporary file and a rename, which
 * replaces a directory entry instead of writing through one.
 */
export function writeProvenance(name, set, dir, sha) {
  const path = `${dir}.PROVENANCE.md`;
  const body = `# ${name}: where it came from

**Fetched by \`scripts/fetch-reference-sets.mjs\` on ${new Date().toISOString()}.**

| | |
|---|---|
| Repository | ${set.repo} |
| Commit | \`${sha}\` |
| Licence, as the project states it | ${set.licence} |
| Covers | ${set.covers} |
| Scratch path | \`${dir}\` |

${set.note}

## The containment rule

This checkout is **outside the cubus repository** and must stay there. It is never committed,
never vendored, never bundled. What may enter \`dev-docs/\` is a comparison REPORT — our numbers,
and whether they agreed — together with this provenance.

Reading a set to compare integers is not copying it. Copying an algorithm, a test, or a case
listing is, and carries the licence with it.

Delete this directory when the comparison is done; \`fetch-reference-sets.mjs\` will fetch it
again, and the SHA above is what makes a later run reproducible.
`;
  const existing = lstatIfPresent(path);
  if (existing?.isSymbolicLink()) {
    throw new Error(
      `refusing to write ${path}: it is a symlink, and a write through it lands wherever it points.`,
    );
  }
  const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    writeFileSync(tmp, body, { flag: 'wx' });
    renameSync(tmp, path);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // The temporary file is already gone, or was never created. Report the original failure.
    }
    throw err;
  }
  return path;
}

const USAGE = [
  'usage: node scripts/fetch-reference-sets.mjs <set|--list> [--scratch <dir>]',
  `sets: ${Object.keys(SETS).join(', ')}`,
].join('\n');

/**
 * The command line, parsed STRICTLY.
 *
 * A permissive parser is how `--scrtach /somewhere` becomes a silent fetch into the default
 * directory: the typo is dropped, the path becomes a stray positional, and the run reports
 * success having ignored the only argument the caller cared about. Everything unrecognized —
 * an unknown option, a second set name, a repeated flag, a `--scratch` with nothing after it —
 * is a `UsageError`. The set name is looked up with `Object.hasOwn`, so `toString` and
 * `__proto__` are unknown sets rather than inherited truthy ones.
 */
export function parseArgs(argv) {
  let list = false;
  let name;
  let scratch;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--list') {
      if (list) throw new UsageError('--list given twice');
      list = true;
    } else if (arg === '--scratch') {
      if (scratch !== undefined) throw new UsageError('--scratch given twice');
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('-')) {
        throw new UsageError('--scratch needs a directory');
      }
      scratch = value;
      i += 1;
    } else if (arg.startsWith('-')) {
      throw new UsageError(`unknown option: ${arg}`);
    } else if (name !== undefined) {
      throw new UsageError(`unexpected argument: ${arg}`);
    } else {
      name = arg;
    }
  }
  if (list) {
    if (name !== undefined) throw new UsageError('--list takes no set name');
    if (scratch !== undefined) throw new UsageError('--list takes no --scratch');
    return { list: true };
  }
  if (name === undefined) throw new UsageError('a set name is required');
  if (!Object.hasOwn(SETS, name)) throw new UsageError(`unknown set: ${name}`);
  return { list: false, name, root: scratch ?? `${tmpdir()}/cubus-reference-sets` };
}

export function main(argv) {
  const parsed = parseArgs(argv);
  if (parsed.list) {
    for (const [name, set] of Object.entries(SETS)) {
      console.log(`${name}\n  ${set.repo}\n  licence: ${set.licence}\n  ${set.covers}\n`);
    }
    return;
  }
  const set = SETS[parsed.name];
  const dir = checkScratch(`${parsed.root}/${parsed.name}`);
  const sha = checkout(set, dir);
  const provenance = writeProvenance(parsed.name, set, dir, sha);
  console.log(`\n${parsed.name} @ ${sha}\n  ${dir}\n  ${provenance}`);
  console.log('\nNothing here may be committed, vendored or bundled. Integers only.');
}

// The surface `apps/web/test/reference-sets.test.mjs` drives: the refusal must hold for every
// path inside the repo, however it is spelt, the parser must refuse every command line that does
// not mean exactly what it says, and the provenance write must refuse a symlink at its
// destination — the one path the containment check never sees.
export { REPO_ROOT, USAGE };

/**
 * Was this file run, or imported?
 *
 * Two ways the obvious spelling gets this wrong, and both end the same way — the module imports
 * cleanly, runs nothing, and exits 0, which is a fetch that reported success and did not happen:
 *
 *   - `new URL(\`file://${process.argv[1]}\`)` is a hand-spelt URL. A checkout path containing
 *     `#`, `?` or `%` means something to a URL parser, so the href stops matching. `pathToFileURL`
 *     percent-encodes those characters the way the loader does;
 *   - `import.meta.url` is the REALPATH of this file, while `process.argv[1]` is whatever the
 *     caller typed. On macOS `/tmp` alone is enough to make them differ, so the entry path is
 *     canonicalized before it is compared, and the raw spelling is still tried in case it cannot
 *     be (`--preserve-symlinks`, or an entry that has since moved).
 */
function isDirectEntry() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    if (import.meta.url === pathToFileURL(realpathSync(entry)).href) return true;
  } catch {
    // Not resolvable — fall through to the literal comparison rather than assuming "imported".
  }
  return import.meta.url === pathToFileURL(entry).href;
}

if (isDirectEntry()) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    console.error(`${err.message}\n${USAGE}`);
    process.exit(1);
  }
}

// The other half of F5 is the move-count convention, and it is not here: it lives in
// `crates/optimal-solver/src/notation.rs`, which expands slice and wide moves into face turns and
// states what "how many moves" means when the two sides count differently. Both are prerequisites
// of Layer 4's comparison — this one so the set can be read at all, that one so the numbers mean
// the same thing on both sides.
