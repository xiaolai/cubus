// scripts/link-worktree-context.sh links a worktree's ignored agent context to the main checkout's.
//
// What it must never do is the thing the old advice did: replace a copy that holds something the
// main checkout lacks. A `cp` of one feature ledger over another destroyed four rows permanently
// (2026-10-06), because an untracked file has no history to restore from. So a target that exists as
// a real file or directory is replaced only when its content equals main's; a differing one stops
// the run, by name, before anything at all has moved.
//
// Run against a throwaway WORKSPACE with real `git worktree`s, using the real script and the real
// manifest, so the paths exercised are exactly the ones every worktree gets: <ws>/AGENTS.md is the
// rulebook, <ws>/main the checkout (its AGENTS.md and CLAUDE.md symlinks to ../AGENTS.md), and the
// worktrees sit under <ws>/worktrees/, as the workspace's new-worktree.sh (beside main/, not in this
// repository) makes them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MANIFEST, WORKTREE_CONTEXT } from './fixtures/worktree-context.mjs';

const SCRIPT = fileURLToPath(new URL('../../../scripts/link-worktree-context.sh', import.meta.url));
// No developer hooks, no developer identity: the fixture's commits are git's alone.
const GIT = ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid'];
const git = (cwd, ...args) => execFileSync('git', [...GIT, ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });

/** A workspace: a main checkout holding every manifest path, plus `n` worktrees of it. */
function fixture(n = 1) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'link-context-')));
  const main = join(base, 'main');
  writeFileSync(join(base, 'AGENTS.md'), 'the workspace rulebook\n');
  mkdirSync(join(main, 'scripts'), { recursive: true });
  cpSync(SCRIPT, join(main, 'scripts/link-worktree-context.sh'));
  cpSync(MANIFEST, join(main, 'scripts/worktree-context.txt'));
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'fixture');
  // The ignored context, created after the commit so no worktree is given it by git.
  for (const p of WORKTREE_CONTEXT) {
    mkdirSync(join(main, dirname(p)), { recursive: true });
    if (p === 'AGENTS.md' || p === 'CLAUDE.md') {
      symlinkSync('../AGENTS.md', join(main, p));
    } else if (p === '.codex') {
      mkdirSync(join(main, p));
      writeFileSync(join(main, p, 'config.toml'), 'project_doc_max_bytes = 65536\n');
    } else {
      writeFileSync(join(main, p), `main's ${p}\n`);
    }
  }
  const trees = [];
  for (let i = 0; i < n; i += 1) {
    const wt = join(base, 'worktrees', `wt${i}`);
    git(main, 'worktree', 'add', '-q', '-b', `wt${i}`, wt);
    trees.push(wt);
  }
  return { base, main, trees };
}

const link = (main, target) => spawnSync('bash', [join(main, 'scripts/link-worktree-context.sh'), target], { encoding: 'utf8' });

function assertLinked(main, wt) {
  for (const p of WORKTREE_CONTEXT) {
    assert.ok(lstatSync(join(wt, p)).isSymbolicLink(), `${p} is not a link`);
    assert.equal(realpathSync(join(wt, p)), realpathSync(join(main, p)), `${p} links somewhere else`);
  }
}

test('every manifest path is linked to the main checkout, and a second run changes nothing', () => {
  const { base, main, trees: [wt] } = fixture();
  try {
    const r = link(main, wt);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assertLinked(main, wt);
    const again = link(main, wt);
    assert.equal(again.status, 0, again.stdout + again.stderr);
    assertLinked(main, wt);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('a copy that DIFFERS from main is refused by name, and nothing moves at all', () => {
  const { base, main, trees: [wt] } = fixture();
  try {
    mkdirSync(join(wt, 'apps/web'), { recursive: true });
    writeFileSync(join(wt, 'apps/web/AGENTS.md'), 'a rule only this worktree has\n');
    mkdirSync(join(wt, '.codex'));
    writeFileSync(join(wt, '.codex/config.toml'), 'a setting only this worktree has\n');
    const r = link(main, wt);
    assert.notEqual(r.status, 0, 'a differing copy was not refused');
    assert.match(r.stderr, /apps\/web\/AGENTS\.md/);
    assert.match(r.stderr, /\.codex/);
    // The unique content survives, and the refusal came BEFORE any other path was linked.
    assert.equal(readFileSync(join(wt, 'apps/web/AGENTS.md'), 'utf8'), 'a rule only this worktree has\n');
    assert.equal(readFileSync(join(wt, '.codex/config.toml'), 'utf8'), 'a setting only this worktree has\n');
    assert.equal(existsSync(join(wt, 'AGENTS.md')), false, 'a path was linked although the run refused');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('a copy IDENTICAL to main is replaced by a link', () => {
  const { base, main, trees: [wt] } = fixture();
  try {
    cpSync(join(main, '.codex'), join(wt, '.codex'), { recursive: true });
    cpSync(join(main, 'ml/AGENTS.md'), join(wt, 'ml/AGENTS.md'));
    const r = link(main, wt);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assertLinked(main, wt);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('a link that points somewhere other than main is refused, not redirected', () => {
  const { base, main, trees: [wt] } = fixture();
  try {
    writeFileSync(join(base, 'elsewhere.md'), 'another copy\n');
    symlinkSync(join(base, 'elsewhere.md'), join(wt, 'CLAUDE.md'));
    const r = link(main, wt);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /CLAUDE\.md/);
    assert.equal(realpathSync(join(wt, 'CLAUDE.md')), join(base, 'elsewhere.md'));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('a path the main checkout lacks is refused by name — there is nothing to link to', () => {
  const { base, main, trees: [wt] } = fixture();
  try {
    rmSync(join(main, 'packages/cubus-cube/CLAUDE.md'));
    const r = link(main, wt);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /packages\/cubus-cube\/CLAUDE\.md/);
    assert.equal(existsSync(join(wt, '.codex')), false, 'a path was linked although the run refused');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// The workspace's new-worktree.sh (beside main/) links the rulebook itself, relatively, as the
// layout's own rule says (`../../AGENTS.md`), and then runs this script for the rest. Those links
// resolve to the very file main's do, so they are LINKED, not "a link to somewhere else".
test('rulebook links to the workspace AGENTS.md, as new-worktree.sh makes them, count as linked', () => {
  const { base, main, trees: [wt] } = fixture();
  try {
    symlinkSync('../../AGENTS.md', join(wt, 'AGENTS.md'));
    symlinkSync('../../AGENTS.md', join(wt, 'CLAUDE.md'));
    const r = link(main, wt);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assertLinked(main, wt);
    assert.equal(readFileSync(join(wt, 'CLAUDE.md'), 'utf8'), 'the workspace rulebook\n');
    // Left exactly as made: a relative link survives moving the whole workspace, an absolute one does not.
    assert.equal(readlinkSync(join(wt, 'AGENTS.md')), '../../AGENTS.md');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('the main checkout itself, or a directory that is not one of its worktrees, is refused', () => {
  const { base, main } = fixture(0);
  try {
    const self = link(main, main);
    assert.notEqual(self.status, 0);
    assert.match(self.stderr, /main checkout/);
    const stranger = join(base, 'stranger');
    mkdirSync(stranger);
    const other = link(main, stranger);
    assert.notEqual(other.status, 0);
    assert.match(other.stderr, /not a worktree/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
