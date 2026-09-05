// The web app's test tiers, and the runner that keeps them honest.
//
// Two tiers, keyed on what a test needs from the machine:
//
//   fast     `serve.test.mjs` and `test/*.test.mjs` — node only. Runs before every push
//            (.githooks/pre-push) and on every pull request.
//   browser  `test/browser/*.test.mjs` — every suite that launches Playwright's WebKit or
//            Chromium. Minutes, two browser downloads, xvfb on a runner. Runs on `main`,
//            nightly, on a pull request labelled `e2e`, and on a manual dispatch.
//
// `all` is the union, and `pnpm check` still means `all`: a tier is where a suite runs, never a
// way to leave one out.
//
// WHY A RUNNER rather than `node --test` with two patterns in package.json. A glob that matches
// nothing is not an error to `node --test`: it prints "tests 0" and exits 0 (measured, Node 24),
// so a renamed directory would turn a tier into a green gate that runs nothing — the same trap
// AGENTS.md records for `node --test <missing-file>`. This resolves each pattern itself, refuses
// an empty one, and refuses a test file that belongs to no tier, so "fast + browser = everything"
// is checked on every run and not only by the test that also states it.
import { spawnSync } from 'node:child_process';
import { globSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const WEB = fileURLToPath(new URL('./', import.meta.url));

/** Patterns relative to apps/web. `all` is derived, so the two halves cannot drift apart. */
export const TIERS = Object.freeze({
  fast: Object.freeze(['serve.test.mjs', 'test/*.test.mjs']),
  browser: Object.freeze(['test/browser/*.test.mjs']),
});

/** Directories under apps/web that hold no tests of ours and are never walked. */
const NOT_OURS = new Set(['node_modules', 'vendor', 'dist']);

/** Every test file under `root`, wherever it sits, relative to `root` and sorted. */
export function allTestFiles(root = WEB) {
  const out = [];
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (NOT_OURS.has(entry.name)) continue;
      const rel = `${prefix}${entry.name}`;
      if (entry.isDirectory()) walk(`${dir}${entry.name}/`, `${rel}/`);
      else if (entry.name.endsWith('.test.mjs')) out.push(rel);
    }
  };
  walk(root, '');
  return out.sort();
}

/** Expand patterns against `root`. A pattern that matches nothing is a defect, not a quiet run. */
export function expand(patterns, root = WEB) {
  const files = [];
  for (const pattern of patterns) {
    const matched = globSync(pattern, { cwd: root }).sort();
    if (matched.length === 0) {
      throw new Error(`test pattern matches nothing: ${pattern} (under ${root})`);
    }
    files.push(...matched);
  }
  return files;
}

/** The files of a tier. Unknown tier, empty pattern and an unclaimed test file all throw. */
export function resolveTier(tier, root = WEB) {
  const patterns =
    tier === 'all' ? [...TIERS.fast, ...TIERS.browser] : TIERS[tier];
  if (!patterns) {
    throw new Error(`unknown test tier "${tier}" — one of: ${[...Object.keys(TIERS), 'all'].join(', ')}`);
  }
  const files = expand(patterns, root);
  const claimed = new Set(expand([...TIERS.fast, ...TIERS.browser], root));
  const unclaimed = allTestFiles(root).filter((f) => !claimed.has(f));
  if (unclaimed.length > 0) {
    throw new Error(
      `test files that belong to no tier (they would never run): ${unclaimed.join(', ')}. ` +
        'Put a suite that launches a browser in test/browser/, anything else directly in test/.',
    );
  }
  const seen = new Set();
  return files.filter((f) => !seen.has(f) && seen.add(f));
}

function main(argv) {
  const [tier = 'all'] = argv;
  const files = resolveTier(tier);
  console.log(`test tier "${tier}": ${files.length} files`);
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=6', ...files], {
    cwd: WEB,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2));
}
