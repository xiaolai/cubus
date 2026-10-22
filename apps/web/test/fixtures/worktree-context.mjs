// The ignored agent context a worktree shares with the main checkout, read from the ONE tracked list,
// scripts/worktree-context.txt. Tests import it from here rather than keeping a list of their own,
// so the linker, the clean-clone run and the worktree check cannot disagree about what is shared.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const MANIFEST = fileURLToPath(new URL('../../../../scripts/worktree-context.txt', import.meta.url));

/** A repo-relative path with no `.`/`..` segment and nothing a shell would glob. */
const SAFE = /^(?!.*(?:^|\/)\.{1,2}(?:\/|$))[\w.-]+(?:\/[\w.-]+)*$/;

/** The manifest's paths, in order. Throws on a malformed, duplicated or empty list — loud, never a
 *  quietly shorter one, because a check over an empty list checks nothing. */
export function parseManifest(text) {
  const paths = text.split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean);
  for (const p of paths) {
    if (!SAFE.test(p)) throw new Error(`worktree-context.txt: not a plain repo-relative path: ${p}`);
  }
  const dup = paths.find((p, i) => paths.indexOf(p) !== i);
  if (dup) throw new Error(`worktree-context.txt: named twice: ${dup}`);
  if (paths.length === 0) throw new Error('worktree-context.txt names nothing');
  return paths;
}

export const WORKTREE_CONTEXT = parseManifest(readFileSync(MANIFEST, 'utf8'));
