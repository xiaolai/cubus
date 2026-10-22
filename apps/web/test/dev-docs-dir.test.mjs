// WHERE THE MAINTAINER'S NOTES ARE: dev-docs/ is a separate repository BESIDE the main checkout, not
// inside it (workspace layout, 2026-10-23): <workspace>/main is the code, <workspace>/dev-docs the
// notes, and linked worktrees sit under <workspace>/worktrees/<name>. Every reader finds the notes
// through scripts/dev-docs-dir.mjs, which asks git for the common directory, so the main checkout and
// every worktree of it name the SAME dev-docs — a worktree's parent is worktrees/, where no notes are.
//
// Run against a throwaway workspace with real `git worktree`s, so the three places a reader can run
// from are the real shapes: the main checkout, a worktree under the sibling worktrees/, and one nested
// inside the checkout (.claude/worktrees/, where agents make theirs). A copied tree with no git falls
// back to its own parent, which is what a fresh clone in CI resolves to: a dev-docs that is not there.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DEV_DOCS, devDocsDir } from '../../../scripts/dev-docs-dir.mjs';

const MODULE = fileURLToPath(new URL('../../../scripts/dev-docs-dir.mjs', import.meta.url));
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const GIT = ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid'];
const git = (cwd, ...args) => execFileSync('git', [...GIT, ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });

function workspace() {
  const ws = realpathSync(mkdtempSync(join(tmpdir(), 'dev-docs-dir-')));
  const main = join(ws, 'main');
  mkdirSync(main);
  writeFileSync(join(main, 'README.md'), 'fixture\n');
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'fixture');
  mkdirSync(join(ws, 'dev-docs'));
  return { ws, main };
}

test('the main checkout, a sibling worktree and a nested one all resolve the same dev-docs', () => {
  const { ws, main } = workspace();
  try {
    const sibling = join(ws, 'worktrees', 'feature');
    const nested = join(main, '.claude', 'worktrees', 'agent');
    git(main, 'worktree', 'add', '-q', '-b', 'feature', sibling);
    git(main, 'worktree', 'add', '-q', '-b', 'agent', nested);
    const want = join(ws, 'dev-docs');
    for (const from of [main, sibling, nested, join(sibling, 'apps')]) {
      if (from.endsWith('apps')) mkdirSync(from);
      assert.equal(devDocsDir(from), want, `from ${from}`);
    }
    // NOT the naive answer from the worktree: its own parent holds no notes.
    assert.notEqual(devDocsDir(sibling), join(ws, 'worktrees', 'dev-docs'));
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test('a tree git cannot see falls back to its own parent, never to a guess further up', () => {
  const ws = realpathSync(mkdtempSync(join(tmpdir(), 'dev-docs-dir-')));
  try {
    const copy = join(ws, 'copy');
    mkdirSync(copy);
    // GIT_CEILING_DIRECTORIES stops git's search at the workspace, as a tree outside any repo is.
    const r = spawnSync(process.execPath, ['--input-type=module', '-e',
      `import { devDocsDir } from ${JSON.stringify(MODULE)}; console.log(devDocsDir(${JSON.stringify(copy)}));`],
    { encoding: 'utf8', env: { ...process.env, GIT_CEILING_DIRECTORIES: ws } });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), join(ws, 'dev-docs'));
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test('this checkout resolves its notes beside the main checkout, never inside it', () => {
  // Inside would be the pre-2026-10-23 layout, and a dev-docs/ inside the checkout is no longer
  // ignored, so it would show as untracked and could be committed.
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    { cwd: REPO, encoding: 'utf8' }).trim();
  const main = join(common, '..');
  assert.equal(DEV_DOCS, join(main, '..', 'dev-docs'));
  assert.ok(!DEV_DOCS.startsWith(realpathSync(REPO)), `${DEV_DOCS} is inside the checkout`);
});
