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

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const FORK =
  process.argv[2] ??
  process.env.SMARTCUBE_REPO ??
  join(homedir(), 'github/poliva/smartcube-web-bluetooth');

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

const git = (args) =>
  execFileSync('git', ['-C', FORK, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const count = (range) => {
  try {
    return Number(git(['rev-list', '--count', range]));
  } catch {
    return null;
  }
};

const pin = pinnedRev();
say(`pinned      ${pin.owner}/${pin.repo}#${pin.sha.slice(0, 12)}`);

if (!existsSync(join(FORK, '.git'))) {
  // Informational, and loudly so. Silence here would read exactly like "nothing has drifted".
  fail(`no clone at ${FORK} — pass the path, or set SMARTCUBE_REPO. Cannot answer without it.`);
}

let head;
try {
  head = git(['rev-parse', 'integration']);
} catch {
  fail(`${FORK} has no 'integration' branch — is this the right clone?`);
}
say(`fork HEAD   integration ${head.slice(0, 12)}`);

// A fetch, because a stale remote-tracking ref answers the upstream question with yesterday's
// news — which is the one way this report could mislead rather than merely fail.
let fetched = true;
try {
  git(['fetch', '--quiet', 'upstream']);
} catch {
  fetched = false;
}

const behindFork = count(`${pin.sha}..integration`);
const aheadUpstream = count('upstream/main..integration');
const behindUpstream = count('integration..upstream/main');

say('');
if (behindFork === null) {
  say('pin vs fork  UNKNOWN — the pinned sha is not in this clone (fetch it, or the pin is wrong)');
} else if (behindFork === 0) {
  say('pin vs fork  current — cubus ships what the fork holds');
} else {
  say(`pin vs fork  ${behindFork} commit(s) BEHIND — cubus is not running your improvements`);
}

if (aheadUpstream === null || behindUpstream === null) {
  say(`fork vs up   UNKNOWN — no 'upstream' remote in ${FORK}`);
} else {
  say(`fork vs up   ${aheadUpstream} ahead, ${behindUpstream} behind${fetched ? '' : '  (STALE: fetch failed)'}`);
  if (behindUpstream > 0) {
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
  3. update SMARTCUBE_REV in apps/web/lib/smartcube-entry.js to match
  4. gates, in this order — each answers a different question:
       packages/gan-driver  npx vitest run tests/cross-implementation.test.ts
                            (does their decoder still agree with ours on 1,242 real packets)
       apps/web             node --test test/ble-polyfill.test.mjs
                            (do all twelve captures still replay through our transport)
       apps/web             node --test test/ble-called-surface.test.mjs
                            (does the library now call something the polyfill lacks)
       apps/web             node --test test/smartcube-pin.test.mjs
                            (do manifest, entry constant and shipped bundle name one revision)`);
