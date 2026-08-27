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
import { existsSync, readFileSync } from 'node:fs';

// Every (source, bundle) pair the repo builds. Adding one here is what makes it guarded.
const BUNDLES = [
  {
    name: 'cubus-cube',
    build: 'pnpm build:cube',
    bundle: '../vendor/cubus-cube.js',
    sources: ['../lib/cubus-cube.js'],
  },
  {
    name: 'cubejs',
    build: 'pnpm --filter cubus-web build:cubejs',
    bundle: '../vendor/cubejs.js',
    sources: ['../lib/cubejs-entry.js'],
    // Gitignored and regenerated, so a fresh checkout has not built it yet.
    optional: true,
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
      // The Detector seam and both implementations: the panel drives capture + inference through
      // these now, so an edit to any must be rebuilt into the bundle the app loads. native-detector
      // is dormant in the browser (it needs __TAURI__) but is bundled, so it is guarded too.
      '../../../packages/cube-scanner/src/detector.ts',
      '../../../packages/cube-scanner/view/web-detector.ts',
      '../../../packages/cube-scanner/view/native-detector.ts',
    ],
    // Exported from the package entry and used by its tests, but never by the panel — so esbuild
    // drops them and their absence is correct, not stale. Listed rather than silently ignored: if
    // the panel ever starts using one, delete it here and the guard covers it again.
    treeShaken: ['SOLVED_FACELETS', 'encodeFacelets'],
  },
  {
    // The dev-only Tauri MCP guest (selector clicks, DOM queries, JS eval for the agent bridge).
    // Bundled from the pinned npm package; inert unless the desktop crate's `mcp` feature and
    // CUBUS_MCP=1 activate the Rust side, which release builds never contain.
    name: 'tauri-mcp-guest',
    build: 'pnpm --filter cubus-web build:mcp-guest',
    bundle: '../vendor/tauri-mcp-guest.js',
    sources: ['../lib/tauri-mcp-guest-entry.js'],
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

// Every emitter of a vendored bundle in the repo must appear above. Derived from the build
// scripts rather than remembered: a pair added to package.json and not added here is invisible,
// which is exactly how one bundle went unguarded while two of its siblings were covered.
test('every source -> bundle pair in the repo is guarded here', () => {
  const scripts = ['../package.json', '../../../packages/cube-scanner/package.json']
    .flatMap((f) => Object.values(JSON.parse(read(f)).scripts ?? {}));
  const emitted = scripts
    .flatMap((cmd) => [...String(cmd).matchAll(/--outfile=\S*?vendor\/([\w.-]+\.js)/g)])
    .map((m) => m[1]);
  const guarded = BUNDLES.map((b) => b.bundle.split('/').pop());
  const unguarded = [...new Set(emitted)].filter((f) => !guarded.includes(f)).sort();
  assert.deepEqual(unguarded, [], 'a build script emits a bundle nothing in BUNDLES checks');
});

for (const b of BUNDLES) {
  test(`${b.name}: every declaration in its sources survived into the bundle`, (t) => {
    if (b.optional && !existsSync(new URL(b.bundle, import.meta.url))) {
      t.skip(`${b.bundle} not built yet — run \`${b.build}\``);
      return;
    }
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

  // Names are not enough, and this is the fourth time that has mattered.
  //
  // A stale bundle keeps every declaration the source has — the edit changed a method BODY, not
  // its name — so the check above once waved through a driver bundle that was two
  // safety fixes behind the source it claims to be built from. The app imports the bundle, so the
  // shipped behaviour was the old one while every test and the source both said otherwise.
  //
  // String literals move when code moves. esbuild copies them through verbatim, so a message the
  // source has and the bundle does not means the bundle predates it. Only plain-ASCII literals
  // with no interpolation or escapes are compared, because those are the ones that survive
  // bundling unchanged.
  test(`${b.name}: the bundle carries the messages its sources contain`, (t) => {
    if (b.optional && !existsSync(new URL(b.bundle, import.meta.url))) {
      t.skip(`${b.bundle} not built yet — run \`${b.build}\``);
      return;
    }
    const bundle = read(b.bundle);
    const missing = [];
    for (const srcPath of b.sources) {
      // Comments first: they are full of quoted prose that is not a literal and never reaches a
      // bundle. Then quoted strings that contain no quote of their own, so the match cannot run
      // from the end of one literal into the start of the next.
      const src = read(srcPath)
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
      const literals = [
        ...[...src.matchAll(/'([^'\\\n]{20,})'/g)].map((m) => m[1]),
        ...[...src.matchAll(/"([^"\\\n]{20,})"/g)].map((m) => m[1]),
        // Template literals too, split on their interpolations. The STATIC chunks are copied
        // through verbatim, and skipping backticks entirely missed most of the driver's messages —
        // including the two whose absence proved the bundle was stale.
        ...[...src.matchAll(/`([^`\\]*)`/g)]
          .flatMap((m) => m[1].split(/\$\{[^}]*\}/))
          .map((chunk) => chunk.trim())
          .filter((chunk) => chunk.length >= 20),
      ];
      for (const lit of literals) {
        // A message, not an identifier or a type union: it has to read like a sentence.
        if (!/ [a-z]/.test(lit) || lit.includes('${') || lit.includes('|')) continue;
        // Plain ASCII only. esbuild emits non-ASCII as escapes (an em dash becomes \u2014), so a
        // literal containing one is never found verbatim and every such message reads as stale.
        if (!/^[ -~]+$/.test(lit)) continue;
        // And nothing that looks like code: the match can still run through a template literal,
        // which is not a string the bundler copies through as written.
        if (/[(){}]|=>|\?\?/.test(lit)) continue;
        if (!bundle.includes(lit)) missing.push(`${srcPath.split('/').pop()}: ${lit.slice(0, 60)}…`);
      }
    }
    assert.deepEqual(missing.sort(), [], `the bundle is behind its source — run \`${b.build}\``);
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

// onnxruntime-web ships eight `ort-wasm-simd-threaded.*` files — plain / jsep / asyncify / jspi,
// each a .wasm and a .mjs, ~90 MB in all — but the loader we ship (`ort.bundle.min.mjs`) references
// exactly ONE pair by name and can fetch no other, because a bundle cannot request a filename it
// does not contain. copy-ort therefore copies only that pair; it used to glob all eight, which put
// ~50 MB of unreachable wasm in every dist/. This pins two things that must move together: the
// loader still references a single variant, and copy-ort derives-not-globs so it follows a version
// bump instead of silently shipping the wrong file or all of them again.
test('copy-ort ships only the wasm variant the loader can actually request', () => {
  const copyOrt = readFileSync(new URL('../copy-ort.mjs', import.meta.url), 'utf8');
  // Derive-not-glob: the wanted set comes from the loader's own text, and the all-variants glob is
  // gone. A future editor who reintroduces `startsWith('ort-wasm-simd-threaded.')` reinflates dist.
  assert.match(copyOrt, /matchAll\(\/ort-wasm\[[^)]*\)/, 'must derive the variant from the loader text');
  assert.doesNotMatch(copyOrt, /startsWith\('ort-wasm-simd-threaded\.'\)[^\n]*\n[^\n]*copyFileSync/,
    'must not copy every ort-wasm-simd-threaded.* variant');

  // With the dependency installed (locally, and in CI after `pnpm install`), compute the same set
  // copy-ort computes and pin it: exactly one variant, the jsep pair. If onnxruntime-web is not
  // installed, skip rather than fail — mirrors the optional-bundle guard above.
  const loaderPath = new URL(
    '../../../packages/cube-scanner/node_modules/onnxruntime-web/dist/ort.bundle.min.mjs', import.meta.url);
  if (!existsSync(loaderPath)) return;
  const referenced = [...new Set(
    [...readFileSync(loaderPath, 'utf8').matchAll(/ort-wasm[a-z0-9.\-]*\.(?:wasm|mjs)/g)].map((m) => m[0]))].sort();
  assert.deepEqual(referenced, ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm'],
    'the shipped loader references exactly the jsep variant pair, and nothing else');
});
