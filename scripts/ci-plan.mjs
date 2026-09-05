// Which tier a CI run is, and which of its jobs the change actually touches.
//
// Two tiers (the same two as apps/web/run-tests.mjs, seen from the workflow's side):
//
//   fast   a pull request. The TypeScript packages' typecheck, lint and tests without
//          coverage; the web app's node-only suites; the vendored-bundle diff; gitleaks.
//   full   everything: coverage, the browser suites under xvfb, the icon measurements, the
//          Rust matrix on three operating systems and two mobile targets, the golden-frame
//          gate on Linux and macOS, the Android shell's Kotlin tests, the supply-chain checks.
//          A push to `main`, the nightly schedule, a manual dispatch — and a pull request that
//          carries the `e2e` label, which is how a contributor asks for the full tier on a
//          branch before it merges.
//
// On top of the tier, a pull request runs a platform job only when it touched that platform's
// inputs: a change to app.js does not need Windows, Android and macOS runners to prove it did
// not break Rust it never went near. The lists below are the inputs; a change to the workflow,
// or to this file, is treated as touching all of them, because the thing under test is then
// the plan itself.
//
// Never the other way round: on `main` every job runs regardless, so the release gate
// (release.yml polls the push-event run) is always looking at a full-tier verdict.
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The label that asks for the full tier on a pull request. */
export const FULL_TIER_LABEL = 'e2e';

/**
 * Inputs per job group. An entry ending in `/` is a directory prefix; any other entry is a file
 * name matched at the root or in any directory (`package.json` means every package.json).
 */
export const FILTERS = Object.freeze({
  rust: Object.freeze([
    'crates/', 'apps/desktop/',
    'Cargo.toml', 'Cargo.lock', 'rust-toolchain', 'rust-toolchain.toml', 'clippy.toml', 'rustfmt.toml',
  ]),
  // The golden gate reads the model, the fixtures and its own Python letterbox (ml/cube_infer.py),
  // and the native leg builds cube-vision's Swift package. It does not read the TypeScript
  // scanner: that letterbox's parity with the pinned bytes is the browser tier's
  // threads-do-not-change-output suite, which runs with the full tier.
  ml: Object.freeze(['ml/', 'crates/cube-vision/']),
  android: Object.freeze(['apps/desktop/', 'ml/models/cube-yolo.tflite', 'scripts/tauri-android.mjs']),
  icons: Object.freeze([
    'apps/desktop/src-tauri/icons/',
    'apps/desktop/src-tauri/gen/apple/Assets.xcassets/',
    'apps/desktop/src-tauri/gen/android/app/src/main/res/',
    'scripts/verify-icons.py',
  ]),
  // cargo audit, pnpm audit, shellcheck, the licence notices.
  deps: Object.freeze([
    'scripts/', '.githooks/',
    'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc', 'package.json', 'Cargo.lock', 'Cargo.toml',
    'THIRD_PARTY_NOTICES.md',
  ]),
});

/** Files whose change means the plan itself is under test, so nothing may be skipped. */
const PLAN_INPUTS = ['.github/workflows/', 'scripts/ci-plan.mjs'];

const matches = (path, entry) =>
  entry.endsWith('/') ? path.startsWith(entry) : path === entry || path.endsWith(`/${entry}`);

const touches = (changed, entries) => changed.some((path) => entries.some((entry) => matches(path, entry)));

/**
 * @param {{ event: string, labels?: string[], changed?: string[] }} run
 *   `event` is GITHUB_EVENT_NAME; `labels` the pull request's label names; `changed` the paths
 *   the pull request changes, relative to the repository root. The last two are ignored for
 *   anything but a pull request.
 * @returns {{ full: boolean, rust: boolean, ml: boolean, android: boolean, icons: boolean, deps: boolean }}
 */
export function plan({ event, labels = [], changed = [] }) {
  const pullRequest = event === 'pull_request';
  const full = !pullRequest || labels.includes(FULL_TIER_LABEL) || touches(changed, PLAN_INPUTS);
  const out = { full };
  for (const [job, entries] of Object.entries(FILTERS)) {
    out[job] = full || touches(changed, entries);
  }
  return out;
}

/** The plan as `key=value` lines, the form $GITHUB_OUTPUT takes. */
export const format = (result) =>
  Object.entries(result)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

function main() {
  const event = process.env.GITHUB_EVENT_NAME;
  if (!event) throw new Error('GITHUB_EVENT_NAME is not set — this runs inside a workflow');
  let labels = [];
  if (event === 'pull_request') {
    const payload = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    labels = (payload.pull_request?.labels ?? []).map((label) => label.name);
  }
  const changed = readFileSync(0, 'utf8').split('\n').filter(Boolean);
  const result = plan({ event, labels, changed });
  const lines = format(result);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines}\n`);
  console.log(`event=${event} labels=${JSON.stringify(labels)} changed=${changed.length}\n${lines}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
