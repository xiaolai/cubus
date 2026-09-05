#!/usr/bin/env node
// Where the protocol layer stands: what cubus pins, what the fork holds, how far either has
// drifted from upstream.
//
// The app links `smartcube-web-bluetooth` from a FORK that is deliberately allowed to diverge
// (dev-docs/universal-cube-driver.md §8e). Deliberate drift is a reasonable policy and a bad
// accident: the difference is entirely whether anyone can still answer "how far?" without
// guessing. Three numbers make that answerable, and none of them is knowable from this repository
// alone — hence a script rather than a test.
//
// It is NOT a gate. It needs a local clone of the fork and a network fetch to be useful, and a
// check that cannot run everywhere must not be able to fail a build. Run it before a bump, and
// whenever you want to know whether upstream has woken up.
//
//   node scripts/smartcube-status.mjs [path-to-fork-clone]
//   SMARTCUBE_REPO=/some/where node scripts/smartcube-status.mjs
//
// Exit codes: 0 when it could answer, 1 when it could not. Never non-zero merely because the pin
// is behind — being behind is a state to report, not an error to fail on.
//
// **Every default here is DERIVED, and that is the fix of 2026-09-04.** It used to default to a
// clone of `poliva/…` and to require an `integration` branch, while the pin lives on the fork's
// `main` — so for a pin that was exactly current it printed UNKNOWN, which is the one answer a
// drift report must never give wrongly. The owner and repo now come from the dependency spec and
// the branch from `smartcube-entry.js`, so a repin moves them all at once.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const say = (...a) => console.log(...a);
const fail = (msg) => {
  console.error(`smartcube-status: ${msg}`);
  process.exit(1);
};

/** The revision the app actually ships, read from the manifest rather than remembered. */
function pinnedRev() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'apps/web/package.json'), 'utf8'));
  const spec = pkg.devDependencies?.['smartcube-web-bluetooth'];
  if (!spec) fail('apps/web/package.json does not depend on smartcube-web-bluetooth');
  const m = /^github:([\w.-]+)\/([\w.-]+)#([0-9a-f]{40})$/.exec(spec);
  if (!m) fail(`the dependency is not pinned to a full sha: ${spec}`);
  return { owner: m[1], repo: m[2], sha: m[3] };
}

/** The fork branch the pin is expected to live on, declared beside the rev it belongs with. */
function pinnedBranch() {
  const entry = readFileSync(join(ROOT, 'apps/web/lib/smartcube-entry.js'), 'utf8');
  const m = /SMARTCUBE_BRANCH\s*=\s*'([^']+)'/.exec(entry);
  if (!m) fail('apps/web/lib/smartcube-entry.js does not declare SMARTCUBE_BRANCH');
  return m[1];
}

const pin = pinnedRev();
const BRANCH = pinnedBranch();
// The clone to measure against: the OWNER of the pin, so a repin to a different fork moves this
// too. An explicit path or SMARTCUBE_REPO still wins.
const FORK =
  process.argv[2] ?? process.env.SMARTCUBE_REPO ?? join(homedir(), 'github', pin.owner, pin.repo);

const git = (args) =>
  execFileSync('git', ['-C', FORK, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** Does this clone hold the object at all? The question UNKNOWN is allowed to answer, and only it. */
const hasCommit = (rev) => {
  try {
    git(['cat-file', '-e', `${rev}^{commit}`]);
    return true;
  } catch {
    return false;
  }
};

/**
 * Commits in `range`, or a REASON it could not be counted.
 *
 * Two outcomes, kept apart on purpose. "The object is not in this clone" is UNKNOWN and is
 * actionable — fetch it, or the pin is wrong. Anything else is a broken invocation and used to be
 * reported as UNKNOWN too, which turned every failure into the same shrug and is how a
 * hard-coded branch name went unnoticed for as long as it did.
 */
const count = (range, ends) => {
  for (const end of ends) {
    if (!hasCommit(end)) return { n: null, why: `${end} is not in this clone` };
  }
  try {
    return { n: Number(git(['rev-list', '--count', range])), why: null };
  } catch (e) {
    return { n: null, why: String(e.stderr || e.message).trim().split('\n')[0] };
  }
};

say(`pinned      ${pin.owner}/${pin.repo}#${pin.sha.slice(0, 12)}  (branch ${BRANCH})`);

if (!existsSync(join(FORK, '.git'))) {
  // Informational, and loudly so. Silence here would read exactly like "nothing has drifted".
  fail(`no clone at ${FORK} — pass the path, or set SMARTCUBE_REPO. Cannot answer without it.`);
}

// A fetch, because a stale remote-tracking ref answers both questions with yesterday's news —
// which is the one way this report could mislead rather than merely fail. `origin` first: the
// pinned sha may have been pushed since this clone was last updated, and reporting "not in this
// clone" for a commit that is simply unfetched is the wrong answer, not a missing one.
const fetched = { origin: true, upstream: true };
for (const remote of ['origin', 'upstream']) {
  try {
    git(['fetch', '--quiet', remote]);
  } catch {
    fetched[remote] = false;
  }
}

// The branch, local or remote-tracking, so a clone that has never checked it out still answers.
const head = [BRANCH, `origin/${BRANCH}`].find((ref) => hasCommit(ref));
if (!head) {
  fail(
    `${FORK} has no '${BRANCH}' branch (nor origin/${BRANCH}) — is this the right clone? ` +
      'The branch name comes from SMARTCUBE_BRANCH in apps/web/lib/smartcube-entry.js.',
  );
}
say(`fork HEAD   ${head} ${git(['rev-parse', head]).slice(0, 12)}`);
if (!fetched.origin) say('            (origin fetch failed — offline? this report may be stale)');

const behindFork = count(`${pin.sha}..${head}`, [pin.sha, head]);
// Both directions. "Zero commits between the pin and the branch" is NOT the same fact as "the pin
// is current": a clone whose branch is 18 commits behind the pin also answers zero, and reporting
// that as "cubus ships what the fork holds" would be a false all-clear from a stale checkout.
const aheadOfFork = count(`${head}..${pin.sha}`, [pin.sha, head]);
const aheadUpstream = count(`upstream/main..${head}`, ['upstream/main', head]);
const behindUpstream = count(`${head}..upstream/main`, ['upstream/main', head]);

say('');
if (behindFork.n === null) {
  say(`pin vs fork  UNKNOWN — ${behindFork.why}`);
  say('             (fetch it, or the pin names a commit this fork does not have)');
} else if (behindFork.n > 0) {
  say(`pin vs fork  ${behindFork.n} commit(s) BEHIND — cubus is not running your improvements`);
} else if (aheadOfFork.n) {
  say(`pin vs fork  ${aheadOfFork.n} commit(s) AHEAD of ${head} — this clone is stale, or the pin`);
  say('             names a commit that never landed on that branch');
} else {
  say('pin vs fork  current — cubus ships what the fork holds');
}

if (aheadUpstream.n === null || behindUpstream.n === null) {
  const why = aheadUpstream.why ?? behindUpstream.why;
  say(`fork vs up   UNKNOWN — ${why} (add an 'upstream' remote in ${FORK})`);
} else {
  const stale = fetched.upstream ? '' : '  (STALE: fetch failed)';
  say(`fork vs up   ${aheadUpstream.n} ahead, ${behindUpstream.n} behind${stale}`);
  if (behindUpstream.n > 0) {
    // The number that changes the policy. Drift is cheap while upstream is static; the moment it
    // moves, every further commit here is a rebase someone has to do, and the fork stops being
    // something that can be handed back.
    say('');
    say('  UPSTREAM HAS MOVED. Deliberate drift assumed a static upstream — reconsider now,');
    say('  while rebasing is still cheap, rather than after the next round of divergence.');
  }
}

say('');
say(`bump procedure, in order (dev-docs/universal-cube-driver.md §8e):
  1. repin apps/web/package.json AND packages/gan-driver/package.json to the same full sha
  2. pnpm install && pnpm --filter cubus-web build:smartcube
  3. update SMARTCUBE_REV in apps/web/lib/smartcube-entry.js to match (and SMARTCUBE_BRANCH if
     the pin moved to a different branch)
  4. gates, in this order — each answers a different question:
       packages/gan-driver  npx vitest run tests/cross-implementation.test.ts
                            (does their decoder still agree with ours on 1,242 real packets)
       apps/web             node --test test/ble-polyfill.test.mjs
                            (do all twelve captures still replay through our transport)
       apps/web             node --test test/ble-called-surface.test.mjs
                            (does the library now call something the polyfill lacks)
       apps/web             node --test test/smartcube-pin.test.mjs
                            (do manifest, lockfile, entry constant and shipped bundle agree)`);
