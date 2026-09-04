// The licence notices name everything that ships — derived from the build, not remembered.
//
// apps/web/THIRD_PARTY_NOTICES.md is generated (scripts/make-third-party-notices.mjs) and
// committed, like the vendored bundles, because the web app has no build step to produce it at
// deploy time and the About card links it. This holds the committed text to the things it must
// cover, without needing cargo: every package a bundle entry imports, every runtime dependency of
// the web packages, every dataset the model was trained on, every fixture photograph, and the
// crates Cargo.lock pins for the load-bearing native pieces. A dependency that appears in one of
// those places and not in the notices fails here; the full Rust section is held by `pnpm notices
// --check` in CI, which has cargo.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const notices = read('../THIRD_PARTY_NOTICES.md');
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Bare package names imported by a bundle's entry file — `three/addons/x` is `three`. Comments
 * are stripped first: prose like "the host draws from 'scan-progress'" is not an import, and the
 * first version of this read it as one.
 */
function importedPackages(entryPath) {
  const src = read(entryPath).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const names = new Set();
  const statements = [
    /^\s*(?:import|export)\b[^;'"]*?\bfrom\s+['"]([^'".][^'"]*)['"]/gm, // import x from 'pkg'; export * from 'pkg'
    /^\s*import\s+['"]([^'".][^'"]*)['"]/gm, // import 'pkg' (side effects)
    /\bimport\(\s*['"]([^'".][^'"]*)['"]\s*\)/g, // import('pkg')
  ];
  for (const re of statements) {
    for (const m of src.matchAll(re)) {
      const spec = m[1];
      if (spec.startsWith('node:')) continue;
      names.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);
    }
  }
  return names;
}

// The notices wrap prose at 100 columns; the claims below are read with the wrapping folded away.
const prose = notices.replace(/\s+/g, ' ');

// Every esbuild entry in the repo, from the scripts that build the bundles — the same derivation
// vendor-bundles.test.mjs uses, so an entry added there is covered here without being remembered.
function bundleEntries() {
  const out = [];
  for (const [pkgJson, base] of [['../package.json', '../'], ['../../../packages/cube-scanner/package.json', '../../../packages/cube-scanner/']]) {
    for (const cmd of Object.values(JSON.parse(read(pkgJson)).scripts ?? {})) {
      const m = /^esbuild (\S+) .*--outfile=\S*vendor\/([\w.-]+\.js)/.exec(String(cmd));
      if (m) out.push({ entry: `${base}${m[1]}`, bundle: m[2] });
    }
  }
  assert.ok(out.length >= 5, `only ${out.length} bundle entries found — the derivation is broken`);
  return out;
}

test('every package a shipped bundle imports has a notice, and the unshipped one is named as unshipped', () => {
  const shipped = new Set();
  const unshipped = new Set();
  for (const { entry, bundle } of bundleEntries()) {
    const target = bundle === 'tauri-mcp-guest.js' ? unshipped : shipped;
    for (const name of importedPackages(entry)) target.add(name);
  }
  // Type-only imports leave no code in a bundle, but onnxruntime-web is the scanner's runtime:
  // the panel loads it through view/onnx-runtime.ts, and the package's own files are copied to
  // vendor/ by copy-ort.mjs. It is a runtime dependency of the scanner package for that reason.
  for (const name of Object.keys(JSON.parse(read('../../../packages/cube-scanner/package.json')).dependencies ?? {})) shipped.add(name);
  for (const name of Object.keys(JSON.parse(read('../package.json')).dependencies ?? {})) shipped.add(name);

  assert.ok(shipped.size >= 4, `only ${[...shipped].join(', ')} — the import scan is broken`);
  for (const name of shipped) {
    assert.match(notices, new RegExp(`^### ${escape(name)} \\d`, 'm'), `${name} ships in a bundle and has no notice`);
  }
  for (const name of unshipped) {
    assert.doesNotMatch(notices, new RegExp(`^### ${escape(name)} `, 'm'), `${name} is not shipped and must not be listed as if it were`);
    assert.match(notices, new RegExp(`Not shipped: \`${escape(name)}\``), `${name}'s exclusion must be stated, so its absence reads as deliberate`);
  }
});

test('the model\'s training data and tooling are credited: Ultralytics, every Roboflow dataset, Poly Haven', () => {
  assert.match(prose, /Ultralytics[^.]*AGPL-3\.0/i);
  const fetched = [...read('../../../ml/fetch_roboflow.py').matchAll(/\("([^"]+)",\s*"([^"]+)"\)/g)].map((m) => [m[1], m[2]]);
  assert.ok(fetched.length >= 5, 'the DATASETS list in ml/fetch_roboflow.py was not read');
  for (const [workspace, project] of fetched) {
    assert.match(
      notices,
      new RegExp(`^- "${escape(project)}" by ${escape(workspace)}, Roboflow Universe, <https://universe\\.roboflow\\.com/${escape(workspace)}/${escape(project)}>, licensed under CC BY 4\\.0`, 'm'),
      `${workspace}/${project} was trained on and is not credited in the CC BY 4.0 form`,
    );
  }
  assert.match(notices, /Poly Haven[^\n]*CC0/);
});

test('every fixture photograph in ml/golden/SOURCES.json is credited with its URL and licence', () => {
  const photos = JSON.parse(read('../../../ml/golden/SOURCES.json')).filter((e) => /^https?:\/\//.test(e.source));
  assert.ok(photos.length >= 5, 'no photographic fixtures found — the read is broken');
  for (const p of photos) {
    assert.ok(notices.includes(`<${p.source}> — ${p.licence}`), `${p.file} (${p.source}) is not credited`);
  }
});

// The Rust section is generated from Cargo.lock; these are the crates a reader would look for
// first, at the versions the lockfile pins, so a bump that forgot `pnpm notices` is caught without
// cargo. `pnpm notices --check` in CI holds the rest.
test('the load-bearing native crates are listed at the versions Cargo.lock pins', () => {
  const lock = read('../../../Cargo.lock');
  for (const name of ['tauri', 'tauri-plugin-updater', 'btleplug', 'ort', 'objc2', 'nokhwa']) {
    const m = new RegExp(`\\[\\[package\\]\\]\\nname = "${escape(name)}"\\nversion = "([^"]+)"`).exec(lock);
    assert.ok(m, `${name} is not in Cargo.lock — update this list`);
    assert.match(notices, new RegExp(`^- \\*\\*${escape(name)}\\*\\* ${escape(m[1])} \\(`, 'm'), `${name} ${m[1]} is not in the notices — run pnpm notices`);
  }
  assert.match(prose, /Rust standard library[^.]*MIT OR Apache-2\.0/);
});

test('the platform runtimes that are not crates are named: DirectML, the Swift runtime, TensorFlow Lite', () => {
  assert.match(prose, /DirectML\.dll[^.]*Microsoft Software License Terms/);
  assert.match(prose, /Swift standard libraries[^;]*?Apache License 2\.0 with the Runtime Library Exception/);
  for (const coord of [...read('../../../apps/desktop/src-tauri/gen/android/app/build.gradle.kts').matchAll(/^\s*implementation\("([^"]+)"\)/gm)].map((m) => m[1])) {
    assert.ok(notices.includes(`\`${coord}\``), `Android dependency ${coord} is not in the notices`);
  }
});
