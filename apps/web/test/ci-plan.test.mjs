// scripts/ci-plan.mjs decides which CI jobs a run needs, and this pins the decisions that
// matter, in the direction that matters:
//
//   - `main`, the nightly schedule and a dispatch are ALWAYS the full tier — the release gate
//     reads the push-event run, so nothing may make that run skip a job;
//   - a pull request is the fast tier unless it carries the `e2e` label, or touches the
//     workflow or the plan, in which case the plan itself is what is under test;
//   - a pull request runs a platform job when it touches that platform's inputs, and the
//     inputs named here are the ones the jobs actually read;
//   - and the workflow wires every skippable job to an output the plan actually emits — an
//     `if:` on a misspelt output is `false` forever, i.e. a job that never runs and says nothing.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { FILTERS, FULL_TIER_LABEL, format, plan } from '../../../scripts/ci-plan.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CI = readFileSync(`${ROOT}.github/workflows/ci.yml`, 'utf8');
const RELEASE = readFileSync(`${ROOT}.github/workflows/release.yml`, 'utf8');

const everything = { full: true, rust: true, ml: true, android: true, icons: true, deps: true };
const nothingExtra = { full: false, rust: false, ml: false, android: false, icons: false, deps: false };

test('main, the schedule and a dispatch are the full tier whatever changed', () => {
  for (const event of ['push', 'schedule', 'workflow_dispatch']) {
    assert.deepEqual(plan({ event }), everything, event);
    assert.deepEqual(plan({ event, changed: ['README.md'] }), everything, `${event} with a docs change`);
  }
});

test('a pull request that touches only the app is the fast tier and no platform job', () => {
  assert.deepEqual(
    plan({ event: 'pull_request', changed: ['apps/web/lib/app.js', 'apps/web/test/router.test.mjs', 'README.md'] }),
    nothingExtra,
  );
  assert.deepEqual(plan({ event: 'pull_request', changed: [] }), nothingExtra, 'an empty change');
});

test('the e2e label asks for the full tier on a pull request', () => {
  assert.equal(FULL_TIER_LABEL, 'e2e');
  assert.deepEqual(plan({ event: 'pull_request', labels: ['e2e'], changed: ['README.md'] }), everything);
  assert.deepEqual(plan({ event: 'pull_request', labels: ['bug'], changed: ['README.md'] }), nothingExtra);
});

test('a change to the workflow or the plan runs everything — the plan is what is under test', () => {
  for (const path of ['.github/workflows/ci.yml', '.github/workflows/release.yml', 'scripts/ci-plan.mjs']) {
    assert.deepEqual(plan({ event: 'pull_request', changed: [path] }), everything, path);
  }
});

test('a pull request runs a platform job when it touches that platform', () => {
  const only = (job) => ({ ...nothingExtra, [job]: true });
  const cases = [
    ['crates/optimal-solver/src/search.rs', only('rust')],
    ['Cargo.lock', { ...only('rust'), deps: true }],
    ['apps/desktop/src-tauri/src/lib.rs', { ...only('rust'), android: true }],
    ['apps/desktop/src-tauri/gen/android/app/src/main/res/mipmap-hdpi/ic_launcher.png', { ...only('rust'), android: true, icons: true }],
    ['ml/golden/expected.json', only('ml')],
    ['crates/cube-vision/swift/Sources/Model.swift', { ...only('rust'), ml: true }],
    // The TypeScript scanner is the ts job's, on every tier; the golden gate never reads it.
    ['packages/cube-scanner/src/letterbox.ts', nothingExtra],
    ['scripts/verify-icons.py', { ...only('icons'), deps: true }],
    ['scripts/sign-macos.sh', only('deps')],
    ['.githooks/pre-push', only('deps')],
    ['packages/gan-driver/package.json', only('deps')],
    ['pnpm-lock.yaml', only('deps')],
    ['apps/web/THIRD_PARTY_NOTICES.md', only('deps')],
  ];
  for (const [path, expected] of cases) {
    assert.deepEqual(plan({ event: 'pull_request', changed: [path] }), expected, path);
  }
});

test('a file-name entry matches the name in any directory, and a directory entry only under it', () => {
  // `package.json` means every package.json; `crates/` means nothing called `crates.md`.
  assert.equal(plan({ event: 'pull_request', changed: ['apps/web/package.json'] }).deps, true);
  assert.equal(plan({ event: 'pull_request', changed: ['crates.md'] }).rust, false);
  assert.equal(plan({ event: 'pull_request', changed: ['docs/Cargo.toml.md'] }).rust, false);
});

test('the inputs the filters name exist in the tree, so a rename cannot leave a job unreachable', () => {
  const missing = [];
  for (const [job, entries] of Object.entries(FILTERS)) {
    for (const entry of entries) {
      // Bare file names are matched anywhere; only rooted paths and directories are checked.
      if (!entry.includes('/')) continue;
      if (!existsSync(ROOT + entry)) missing.push(`${job}: ${entry}`);
    }
  }
  assert.deepEqual(missing, [], 'a filter names a path that does not exist — the job it gates would never run for it');
});

test('the output form is what $GITHUB_OUTPUT takes', () => {
  assert.equal(format({ full: false, rust: true }), 'full=false\nrust=true');
});

test('every skippable CI job is gated on an output the plan emits, and the always-on ones are not', () => {
  // Job blocks: a two-space-indented key under `jobs:`, up to the next one.
  const jobsText = CI.slice(CI.indexOf('\njobs:\n') + 7);
  const blocks = new Map();
  let current = null;
  for (const line of jobsText.split('\n')) {
    const m = /^  ([a-z][\w-]*):\s*$/.exec(line);
    if (m) {
      current = m[1];
      blocks.set(current, '');
    } else if (current) blocks.set(current, `${blocks.get(current)}${line}\n`);
  }
  const outputs = new Set(Object.keys(plan({ event: 'push' })));
  const referenced = [...CI.matchAll(/needs\.plan\.outputs\.([\w-]+)/g)].map((m) => m[1]);
  assert.ok(referenced.length > 0, 'no job reads the plan');
  assert.deepEqual(
    [...new Set(referenced)].filter((k) => !outputs.has(k)),
    [],
    'a job is gated on an output the plan never emits — that `if:` is false forever',
  );

  const gated = new Map([
    ['rust', 'rust'],
    ['rust-platforms', 'rust'],
    ['rust-macos', 'rust'],
    ['android-shell', 'android'],
    ['golden-linux', 'ml'],
    ['golden-macos', 'ml'],
    ['supply-chain', 'deps'],
  ]);
  for (const [job, output] of gated) {
    const block = blocks.get(job);
    assert.ok(block, `job ${job} is gone from ci.yml — update this map or restore it`);
    assert.match(block, /^    if: /m, `${job} has no job-level if:`);
    assert.match(block, new RegExp(`needs\\.plan\\.outputs\\.${output} == 'true'`), `${job} is not gated on plan.${output}`);
    assert.match(block, /^    needs: \[plan\]/m, `${job} does not declare needs: [plan]`);
  }
  for (const job of ['plan', 'ts', 'secrets']) {
    assert.ok(blocks.has(job), `job ${job} is gone from ci.yml`);
    assert.doesNotMatch(blocks.get(job), /^    if: /m, `${job} must run on every tier`);
  }
  // Inside the ts job, the full-tier steps are the ones that name the browsers, coverage and
  // icons, and the fast-tier steps are the `:fast` scripts. Steps are split on their `- ` and
  // read with comments stripped, so prose ABOUT a tier does not count as a step of it.
  const steps = blocks
    .get('ts')
    .split(/\n(?=      - )/)
    .map((chunk) => chunk.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n'))
    .filter((chunk) => /^\s*- /.test(chunk));
  const stepsNaming = (needle) => steps.filter((s) => s.includes(needle));
  for (const needle of ['playwright install', 'xvfb-run', 'verify-icons.py', 'cube-scanner run check\n', 'gan-driver run check\n']) {
    const named = stepsNaming(needle);
    assert.ok(named.length > 0, `ts job no longer has a step containing "${needle.trim()}"`);
    for (const s of named) {
      assert.match(s, /needs\.plan\.outputs\.full == 'true'/, `a step containing "${needle.trim()}" is not full-tier only:\n${s}`);
    }
  }
  for (const needle of ['check:fast', 'test:fast']) {
    const named = stepsNaming(needle);
    assert.ok(named.length > 0, `ts job has no fast-tier step containing "${needle}"`);
    for (const s of named) {
      assert.match(s, /needs\.plan\.outputs\.full != 'true'/, `a step containing "${needle}" is not fast-tier only:\n${s}`);
    }
  }
});

test('the triggers carry the three ways to ask for the full tier, and the plan sees the label', () => {
  const on = CI.slice(CI.indexOf('\non:\n'), CI.indexOf('\npermissions:'));
  assert.match(on, /^  schedule:\n    - cron: /m, 'no nightly schedule');
  assert.match(on, /^  workflow_dispatch:/m, 'no manual dispatch');
  assert.match(on, /^  pull_request:\n(?:.*\n)*?    types: \[.*\blabeled\b.*\]/m, 'adding the e2e label does not start a run');
  const concurrency = CI.slice(CI.indexOf('\nconcurrency:'), CI.indexOf('\njobs:'));
  assert.match(concurrency, /github\.event_name/, 'a nightly run and a push run on main would cancel each other');
});

test('the release gate reads the push-event run, which is always the full tier', () => {
  assert.match(RELEASE, /gh run list --workflow CI --event push --commit "\$GITHUB_SHA"/);
});
