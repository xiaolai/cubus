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

/**
 * How many suites run at once, and why it is not one number.
 *
 * A node-only suite costs a process. A suite under `test/browser/` costs a WHOLE BROWSER, and on a
 * two-core CI runner six of those at once is more memory than the box has. On 2026-09-09 that
 * starved `screen-swap`'s `page.goto` for the full 120 s Playwright allows, on a run where the same
 * test passes in about 200 ms alone and 3/3 locally — a timeout caused by the neighbours, reported
 * as a fault in the test.
 *
 * Raising the timeout would have hidden it, and a retry would have hidden it twice. The cause is
 * contention, so the fix is to stop contending: browser suites run three at a time, node-only
 * suites keep six.
 *
 * The repository already knew this hazard — `scanner-gpu.test.mjs` documents a headed Chromium
 * going red at 2.5 s under `--test-concurrency=6` "with a dozen other browsers alive" and passing
 * at 6.8 s alone — but the lesson was written into one suite's retry rather than into the runner.
 */
const CONCURRENCY = { fast: 6, browser: 3 };

/**
 * `all` IS TWO PHASES, NOT ONE NUMBER — and this is the half the 2026-09-09 fix missed.
 *
 * Lowering `all` to 3 stopped six browsers competing with each other, and left the other half of the
 * problem standing: `node --test --test-concurrency=N` treats every FILE as one slot of equal cost, and
 * the costs here are not remotely equal. A node-only solver suite spawns a WORKER POOL and takes the whole
 * machine — measured at 963% CPU across the `fast` tier on an 8-core box, so one slot is many cores — while
 * a browser suite needs very little CPU but carries a 120 s wall-clock bound on `page.goto`. At one flat
 * concurrency a browser gets scheduled next to two of those pools, and on a two-core runner it starves.
 *
 * The evidence that this is the live mechanism, measured 2026-09-17: the `browser` tier alone has never
 * failed this way, the FULL tier fails intermittently, and it fails on a DIFFERENT suite each time —
 * `screen-swap` in 2026-09-09, `scan screen composition` on the nightly of 2026-09-16, and
 * `initsolver-off-main-thread` locally the same day, all at 120 s, all in `page.goto`. A census of live
 * Playwright processes across the browser tier held a flat plateau of 16-20 with nothing left behind, so
 * the browsers are not leaking and three is not too many browsers: the problem is what they are three
 * ALONGSIDE.
 *
 * So the two kinds no longer share the machine. Node suites run first, six at a time, then the browsers run
 * three at a time with the pools finished and gone.
 *
 * IT COSTS ABOUT A HUNDRED SECONDS, and that is the honest trade. Measured on the dev Mac, 2026-09-17: 368 s
 * for the node phase plus 264 s for the browser phase, against 527-559 s for the same suites interleaved at
 * a flat concurrency of 3. The overlap that is being given up was doing real work — a browser waiting on a
 * page is CPU a solver could have used. What it buys is that a `page.goto` is never waiting on a machine
 * some other suite has taken, which is a whole CI run each time it happens, and a red nightly that has to be
 * read by a person before it can be dismissed.
 *
 * (An earlier draft of this comment claimed the split made the tier FASTER, on the reasoning that the node
 * half gains concurrency. It does gain concurrency, and the tier is still slower; the reasoning was fine and
 * the conclusion was wrong, which is the difference between an argument and a measurement.)
 */
export function phasesOf(tier, root = WEB) {
  if (tier !== 'all') return [{ name: tier, files: resolveTier(tier, root), concurrency: CONCURRENCY[tier] ?? 3 }];
  // `resolveTier` is still asked for `all`, so its "every test file belongs to a tier" check runs exactly
  // as it did: splitting the RUN must not split the guard that says nothing is left out.
  const every = new Set(resolveTier('all', root));
  const browser = resolveTier('browser', root);
  const node = [...every].filter((f) => !browser.includes(f));
  return [
    { name: 'node', files: node, concurrency: CONCURRENCY.fast },
    { name: 'browser', files: browser, concurrency: CONCURRENCY.browser },
  ];
}

function main(argv) {
  const [tier = 'all'] = argv;
  const phases = phasesOf(tier);
  for (const phase of phases) {
    console.log(`test tier "${tier}"${phases.length > 1 ? ` · ${phase.name} phase` : ''}: `
      + `${phase.files.length} files, concurrency ${phase.concurrency}`);
    const result = spawnSync(process.execPath, ['--test', `--test-concurrency=${phase.concurrency}`, ...phase.files], {
      cwd: WEB,
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    // STOP AT THE FIRST RED PHASE. Carrying on would spend minutes of browser time on a tree already known
    // to be broken, and — worse — would end on the second phase's exit code, so a red node phase followed
    // by a green browser phase would exit 0.
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2));
}
