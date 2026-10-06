// A WORKTREE'S IGNORED CONTEXT IS THE SAME DIRECTORY, not a copy of it.
//
// `dev-docs/` is gitignored and nothing under it is tracked, so a `git worktree` starts with whatever
// copy it was made with and drifts in silence — while three gates read it: the feature-ledger check,
// the ADR-index check and `no-dangling-pointers`. Measured three times in one session on 2026-10-06:
// a worktree failed `every screen is in the ledger` for two screens that had been in the real ledger
// for days; it failed `no-dangling-pointers` for four plans that existed; and a `cp` of one copy over
// the other destroyed four rows permanently, because an untracked file has no history to restore from.
//
// The fix is structural rather than a discipline: `AGENTS.md` was already a symlink, and `dev-docs/`
// is one now, so the two cannot differ. This is the assertion that says so — the rule's other half,
// because a rule nothing enforces is a preference.
//
// SKIPS, NEVER PASSES, when there is no second worktree to check: in CI there is one checkout and
// nothing to compare, and a check that quietly passes on an empty set is one change from checking
// nothing at all.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));

/** Every worktree git knows about, or null when git cannot be asked. */
function worktrees() {
  try {
    const out = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: REPO, encoding: 'utf8' });
    return out.split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice('worktree '.length));
  } catch {
    return null;
  }
}

/** What a checkout's ignored context must be: one directory, shared, never a copy. */
const SHARED = ['dev-docs', 'AGENTS.md'];

test('every other worktree shares this checkout\'s ignored context rather than copying it', (t) => {
  const trees = worktrees();
  if (trees === null) return t.skip('git could not be asked for the worktree list');
  const others = trees.filter((dir) => realpathSync(dir) !== realpathSync(REPO));
  if (others.length === 0) return t.skip('only one worktree, so there is no second copy to compare');

  const mine = Object.fromEntries(SHARED.map((name) => [name, realpathSync(join(REPO, name))]));
  const wrong = [];
  for (const dir of others) {
    for (const name of SHARED) {
      const there = join(dir, name);
      if (!existsSync(there)) { wrong.push(`${dir}: ${name} is missing`); continue; }
      // REAL PATHS on both sides: a symlink is the point, so the comparison has to follow it.
      if (realpathSync(there) !== mine[name]) wrong.push(`${dir}: ${name} is a separate copy, not the same directory`);
    }
  }
  assert.deepEqual(wrong, [],
    'a worktree holds its own copy of the ignored context three gates read. Replace it with a symlink '
    + 'to this checkout\'s — and merge anything unique out of it FIRST, row-wise for the ledger, '
    + 'because an untracked file has no history to restore from.');
  t.diagnostic(`${others.length} other worktree(s) share ${SHARED.join(' and ')}`);
});
