// Where the maintainer's notes are: dev-docs/ is a separate repository BESIDE the main checkout, not
// inside it (workspace layout, 2026-10-23):
//
//   <workspace>/main/                 this repository
//   <workspace>/dev-docs/             the notes, their own repository, never in a clone
//   <workspace>/worktrees/<name>/     linked worktrees of main
//
// So the notes are found from the MAIN checkout, never from the one a script runs in: a worktree's
// parent is worktrees/, where no notes are. Git's common directory names the main checkout from any
// worktree of it. A tree git cannot see (a copied export) falls back to its own parent, which in a
// fresh clone is a dev-docs that is not there — every reader treats that as SKIPPED, never passed.
//
// Every reader of dev-docs builds its path from here, so the notes cannot be looked for in two places.
// Pinned by apps/web/test/dev-docs-dir.test.mjs.
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));

/** The main checkout owning `from`'s git repository, or `from` itself when git cannot say. */
function mainCheckout(from) {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: from,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (common) return dirname(common);
  } catch {
    // Not a repository, or no git: the fallback below.
  }
  return resolve(from);
}

/** The absolute path of dev-docs for the checkout holding `from` (default: this one). It may not exist. */
export function devDocsDir(from = REPO) {
  return join(dirname(mainCheckout(from)), 'dev-docs');
}

/** This checkout's dev-docs. */
export const DEV_DOCS = devDocsDir();

/** Where a repo-style citation is on disk: `dev-docs/…` in the notes beside the main checkout,
 *  anything else under `root` (this checkout's root). Comments and the feature ledger keep writing
 *  `dev-docs/…`, so a reader that resolves one resolves it here. */
export function citedPath(root, rel) {
  if (rel === 'dev-docs' || rel.startsWith('dev-docs/')) return join(DEV_DOCS, rel.slice('dev-docs'.length));
  return join(root, rel);
}
