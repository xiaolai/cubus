// The renderer ships as a bundle, so editing the source is only half of a change.
//
// apps/web/lib/cubus-cube.js is bundled to apps/web/vendor/cubus-cube.js by `pnpm build:cube`, and
// the page loads the BUNDLE. Editing the source and forgetting the build fails in the quietest way
// there is: every test that reads the source passes, the app loads, and the new method is simply
// not there at runtime. Nothing goes red until someone clicks the button.
//
// build.mjs already refuses to assemble dist/ when the bundle's MTIME is older than the source.
// This is the complement, not a duplicate: mtimes do not survive a clone or a checkout, so that
// guard goes quiet on exactly the machine that did not do the build, and it cannot run at all
// outside `build:dist`. This compares CONTENT, and runs in the ordinary test suite.
//
// This is a staleness check, not a behaviour test — three.js cannot be driven under happy-dom.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// Every (source, bundle) pair the repo builds. Adding one here is what makes it guarded.
const BUNDLES = [
  {
    name: 'cubus-cube',
    build: 'pnpm build:cube',
    bundle: '../vendor/cubus-cube.js',
    sources: ['../lib/cubus-cube.js'],
  },
  {
    name: 'ai-scan-panel',
    build: 'pnpm --filter cube-scanner build:panel',
    bundle: '../vendor/ai-scan-panel.js',
    // The panel pulls the scanner core in with it, so an edit to any of these must be rebuilt.
    // camera.ts is the one that proved it: a fix landed there and the committed bundle kept the
    // pre-fix code, with nothing red, because only cubus-cube.js was guarded.
    sources: [
      '../../../packages/cube-scanner/view/ai-scan-panel.ts',
      '../../../packages/cube-scanner/src/camera.ts',
      '../../../packages/cube-scanner/src/ai-assemble.ts',
      '../../../packages/cube-scanner/src/facelet-cube.ts',
      '../../../packages/cube-scanner/view/onnx-runtime.ts',
    ],
    // Exported from the package entry and used by its tests, but never by the panel — so esbuild
    // drops them and their absence is correct, not stale. Listed rather than silently ignored: if
    // the panel ever starts using one, delete it here and the guard covers it again.
    treeShaken: ['SOLVED_FACELETS', 'encodeFacelets'],
  },
];

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

/** Top-level and class-body declaration names — the things a bundle must still contain. */
function declaredNames(src) {
  const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'constructor', 'get', 'set', 'new', 'typeof', 'await', 'else', 'do', 'try']);
  const names = new Set();
  for (const m of src.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*[=:]/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^ {2}(?:private\s+|public\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/gm)) names.add(m[1]);
  for (const k of KEYWORDS) names.delete(k);
  return [...names];
}

for (const b of BUNDLES) {
  test(`${b.name}: every declaration in its sources survived into the bundle`, () => {
    const bundle = read(b.bundle);
    const missing = [];
    for (const srcPath of b.sources) {
      const dropped = new Set(b.treeShaken ?? []);
      for (const n of declaredNames(read(srcPath))) {
        const present = new RegExp(`(?<![\\w$])${n}(?![\\w$])`).test(bundle);
        if (!dropped.has(n) && !present) missing.push(`${srcPath.split('/').pop()}:${n}`);
      }
    }
    assert.deepEqual(missing.sort(), [], `source is ahead of the bundle — run \`${b.build}\``);
  });
}

test('the renderer animation floor in the bundle is the one the source sets', () => {
  // The floor stops a non-positive tempo producing an Infinite duration, which freezes the cube
  // mid-turn. It also bounds the slowest speed the app can ask for, so a stale bundle here means
  // the app silently animates at the old speed.
  const src = read('../lib/cubus-cube.js');
  const floor = src.match(/Math\.max\((0\.\d+), this\._num\('tempo-scale'/);
  assert.ok(floor, 'tempo floor not found in the source — update this test');
  assert.ok(
    read('../vendor/cubus-cube.js').includes(`Math.max(${floor[1]}, `),
    `bundle does not carry the ${floor[1]} tempo floor — run \`pnpm build:cube\``,
  );
});

// onnxruntime must stay OUT of the panel bundle, and this is not a size preference.
//
// It spawns its inference worker from its own `import.meta.url`. Inlined here, that URL is the
// PANEL — so the worker boots a custom-element bundle, throws on `document`, and onnxruntime falls
// back to running on the main thread. Measured, that cost ~404ms of blocked UI every 200ms and
// made leaving the scan screen take most of a second.
//
// The failure is silent in the worst way: the scanner still works, just synchronously. Turning the
// dynamic `import(url)` in onnx-runtime.ts back into a static specifier is all it takes, and
// nothing else in the suite would notice.
test('onnxruntime is loaded as its own module, not bundled into the panel', () => {
  const bundle = readFileSync(new URL('../vendor/ai-scan-panel.js', import.meta.url), 'utf8');
  // These strings exist only inside onnxruntime's own dist.
  for (const marker of ['ort-wasm-simd-threaded', 'onnxruntime-web', 'no available backend found']) {
    assert.ok(!bundle.includes(marker), `"${marker}" in the panel bundle means onnxruntime got inlined`);
  }
  // And it must still be reached, by a computed URL rather than a bare specifier.
  const src = readFileSync(
    new URL('../../../packages/cube-scanner/view/onnx-runtime.ts', import.meta.url), 'utf8');
  assert.match(src, /import\(\s*\/\*[^*]*\*\/\s*url\s*\)|import\(\s*url\s*\)/, 'must import a URL variable');
  assert.doesNotMatch(src, /^\s*import\s+\*\s+as\s+ort\s+from\s+'onnxruntime-web'/m, 'no static runtime import');
  assert.match(src, /env\.wasm\.proxy\s*=\s*true/, 'and inference must be proxied to a worker');
});
