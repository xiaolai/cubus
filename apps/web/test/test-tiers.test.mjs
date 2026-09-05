// The test tiers (run-tests.mjs) are a claim about WHERE things run, and this is what fails when
// the claim stops being true:
//
//   - the fast tier launches no browser, so it can run before every push and on every pull
//     request without a Playwright install;
//   - the browser tier is exactly the suites that do, so nothing that needs an engine can sit in
//     the fast tier and fail there for a missing executable;
//   - the two together are every test file under apps/web — a suite in neither would never run,
//     which is the "gate nothing runs" AGENTS.md records twice;
//   - a pattern that matches nothing is refused, because `node --test` itself reports "tests 0"
//     and exits 0 for one (measured, Node 24).
//
// And the wiring: the package scripts, the root scripts and the pre-push hook name the tiers by
// the runner, so `pnpm check` cannot quietly drop back to a bare `node --test` whose default
// discovery would make the split decorative.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { TIERS, allTestFiles, expand, resolveTier } from '../run-tests.mjs';

const WEB = fileURLToPath(new URL('../', import.meta.url));
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

// A static import at the start of a line, so this file's own mention of the pattern is not one.
const launchesBrowser = (rel) => /^import\b[^\n]*\bfrom 'playwright'/m.test(readFileSync(WEB + rel, 'utf8'));

test('the fast tier launches no browser, and the browser tier is exactly the suites that do', () => {
  const fast = resolveTier('fast');
  const browser = resolveTier('browser');
  assert.ok(fast.length > 40, `only ${fast.length} fast-tier files — the pattern is broken`);
  assert.ok(browser.length >= 5, `only ${browser.length} browser-tier files — the pattern is broken`);
  assert.deepEqual(
    fast.filter(launchesBrowser),
    [],
    'a suite in the fast tier imports playwright — move it to test/browser/',
  );
  assert.deepEqual(
    browser.filter((f) => !launchesBrowser(f)),
    [],
    'a suite in test/browser/ launches no browser — it belongs in test/, where it runs on every push',
  );
  assert.deepEqual(
    browser.filter((f) => !f.startsWith('test/browser/')),
    [],
    'the browser tier reaches outside test/browser/',
  );
});

test('fast + browser is every test file under apps/web, with nothing counted twice', () => {
  const all = resolveTier('all');
  assert.deepEqual([...all].sort(), allTestFiles());
  assert.equal(new Set(all).size, all.length, 'a file is in both tiers');
  assert.deepEqual(
    [...resolveTier('fast'), ...resolveTier('browser')].sort(),
    all.sort(),
    '`all` is not the union of the two tiers',
  );
});

test('a pattern that matches nothing is refused, not run as zero tests', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tiers-'));
  try {
    mkdirSync(join(dir, 'test'));
    writeFileSync(join(dir, 'test', 'one.test.mjs'), '');
    assert.deepEqual(expand(['test/*.test.mjs'], `${dir}/`), ['test/one.test.mjs']);
    assert.throws(() => expand(['test/browser/*.test.mjs'], `${dir}/`), /matches nothing/);
    assert.throws(() => resolveTier('nope'), /unknown test tier/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a test file that belongs to no tier fails the run rather than never running', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tiers-'));
  try {
    // A tree with every tier populated, plus one file where neither pattern looks.
    mkdirSync(join(dir, 'test', 'browser'), { recursive: true });
    mkdirSync(join(dir, 'test', 'stray'));
    writeFileSync(join(dir, 'serve.test.mjs'), '');
    writeFileSync(join(dir, 'test', 'one.test.mjs'), '');
    writeFileSync(join(dir, 'test', 'browser', 'two.test.mjs'), '');
    writeFileSync(join(dir, 'test', 'stray', 'three.test.mjs'), '');
    assert.throws(() => resolveTier('fast', `${dir}/`), /belong to no tier.*test\/stray\/three\.test\.mjs/);
    rmSync(join(dir, 'test', 'stray'), { recursive: true });
    assert.deepEqual(resolveTier('fast', `${dir}/`), ['serve.test.mjs', 'test/one.test.mjs']);
    assert.deepEqual(resolveTier('browser', `${dir}/`), ['test/browser/two.test.mjs']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the scripts and the pre-push hook run the tiers through the runner', () => {
  const web = JSON.parse(readFileSync(`${WEB}package.json`, 'utf8')).scripts;
  assert.equal(web.test, 'node run-tests.mjs all');
  assert.equal(web['test:fast'], 'node run-tests.mjs fast');
  assert.equal(web['test:browser'], 'node run-tests.mjs browser');
  assert.match(web.check, /node run-tests\.mjs all$/, '`pnpm check` must still be every tier');
  assert.match(web['check:fast'], /node run-tests\.mjs fast$/);

  // One package at a time: each package's runner already fills every core, so running them side
  // by side adds contention and no throughput — a 1.5 s proof in cube-scanner took 180 s that
  // way and timed out (2026-09-05). The budget on that test is a hang detector, not a load meter.
  const root = JSON.parse(readFileSync(`${ROOT}package.json`, 'utf8')).scripts;
  assert.equal(root.check, 'pnpm -r --workspace-concurrency=1 run check');
  assert.equal(root['check:fast'], 'pnpm -r --workspace-concurrency=1 run check:fast');
  for (const pkg of ['packages/cube-scanner', 'packages/gan-driver']) {
    const s = JSON.parse(readFileSync(`${ROOT}${pkg}/package.json`, 'utf8')).scripts;
    assert.ok(s['check:fast'], `${pkg} has no check:fast — \`pnpm check:fast\` would skip it silently`);
    assert.doesNotMatch(s['check:fast'], /coverage/, `${pkg}'s fast tier runs coverage`);
    assert.match(s.check, /coverage/, `${pkg}'s full tier dropped coverage`);
  }

  // Comments stripped: the hook's own header is allowed to SAY what `pnpm check` means.
  const hook = readFileSync(`${ROOT}.githooks/pre-push`, 'utf8')
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
  assert.match(hook, /pnpm check:fast/, 'the pre-push hook does not run the fast tier');
  assert.doesNotMatch(hook, /pnpm check(?!:fast)/, 'the pre-push hook runs the full tier — that is what the tiers exist to avoid');
});

test('the tier patterns are the documented two, so the docs and the runner agree', () => {
  assert.deepEqual(TIERS, { fast: ['serve.test.mjs', 'test/*.test.mjs'], browser: ['test/browser/*.test.mjs'] });
});
