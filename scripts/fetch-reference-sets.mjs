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
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** Where a scratch checkout may live: anywhere that is NOT inside this repository. */
function checkScratch(path) {
  const target = resolve(path.replace(/^~(?=$|\/)/, homedir()));
  const rel = relative(REPO_ROOT, target);
  const inside = rel === '' || (!rel.startsWith('..') && !resolve(rel).startsWith('..'));
  if (inside) {
    throw new Error(
      `refusing to fetch into ${target}: it is inside the repository (${REPO_ROOT}).\n` +
        'A reference set is never committed, never vendored and never bundled — see the ' +
        'containment rule in dev-docs/method-solver-return-plan.md and the caution in ' +
        'apps/web/vendor/min2phase.PROVENANCE.md.',
    );
  }
  return target;
}

/** Shallow clone, or `git fetch` if it is already there. Returns the commit SHA. */
function checkout(set, dir) {
  if (existsSync(`${dir}/.git`)) {
    execFileSync('git', ['-C', dir, 'fetch', '--depth', '1', 'origin'], { stdio: 'inherit' });
    execFileSync('git', ['-C', dir, 'checkout', '--force', 'FETCH_HEAD'], { stdio: 'inherit' });
  } else {
    mkdirSync(dirname(dir), { recursive: true });
    execFileSync('git', ['clone', '--depth', '1', set.repo, dir], { stdio: 'inherit' });
  }
  return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

/**
 * The provenance record, written beside the checkout and NEVER inside the repository.
 *
 * Written at the moment the set arrives. Reconstructing "which commit did we read, and when" a
 * month later is the thing that does not happen, and a comparison report whose provenance is a
 * guess is a report nobody can act on.
 */
function writeProvenance(name, set, dir, sha) {
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
  writeFileSync(path, body);
  return path;
}

function usage() {
  console.error('usage: node scripts/fetch-reference-sets.mjs <set|--list> [--scratch <dir>]');
  console.error(`sets: ${Object.keys(SETS).join(', ')}`);
  process.exit(1);
}

function main(argv) {
  if (argv.includes('--list') || argv.length === 0) {
    for (const [name, set] of Object.entries(SETS)) {
      console.log(`${name}\n  ${set.repo}\n  licence: ${set.licence}\n  ${set.covers}\n`);
    }
    if (argv.length === 0) usage();
    return;
  }
  const name = argv[0];
  const set = SETS[name];
  if (!set) usage();
  const scratchAt = argv.indexOf('--scratch');
  const root = scratchAt >= 0 ? argv[scratchAt + 1] : `${tmpdir()}/cubus-reference-sets`;
  if (!root) usage();
  const dir = checkScratch(`${root}/${name}`);
  const sha = checkout(set, dir);
  const provenance = writeProvenance(name, set, dir, sha);
  console.log(`\n${name} @ ${sha}\n  ${dir}\n  ${provenance}`);
  console.log('\nNothing here may be committed, vendored or bundled. Integers only.');
}

// A tiny self-check the test suite runs: the refusal must hold for every path inside the repo.
export { REPO_ROOT, checkScratch };

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main(process.argv.slice(2));
}

// The other half of F5 is the move-count convention, and it is not here: it lives in
// `crates/optimal-solver/src/notation.rs`, which expands slice and wide moves into face turns and
// states what "how many moves" means when the two sides count differently. Both are prerequisites
// of Layer 4's comparison — this one so the set can be read at all, that one so the numbers mean
// the same thing on both sides.
