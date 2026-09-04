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
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
    //
    // EVERY FILE THE BUNDLE CONTAINS, not the ones somebody remembered. `esbuild --metafile` says
    // the panel bundle is built from fourteen sources plus cubejs; this list named eight of them,
    // so seven files could be edited and left un-rebuilt with nothing red — including
    // misread-decode.ts, which decides what the app is allowed to CLAIM about a bad scan, and
    // onnx-postprocess.ts, which decides whether a frame is a face at all. detector.ts is the
    // fifteenth: type-only, so nothing of it survives compilation, and listed anyway because it is
    // the seam both implementations answer to and a reader looking for the set should find it here.
    sources: [
      '../../../packages/cube-scanner/view/ai-scan-panel.ts',
      '../../../packages/cube-scanner/view/camera-session.ts',
      '../../../packages/cube-scanner/view/onnx-runtime.ts',
      '../../../packages/cube-scanner/view/pick-detector.ts',
      '../../../packages/cube-scanner/view/stillness.ts',
      // The Detector seam and both implementations: the panel drives capture + inference through
      // these now, so an edit to any must be rebuilt into the bundle the app loads. native-detector
      // is dormant in the browser (it needs __TAURI__) but is bundled, so it is guarded too.
      '../../../packages/cube-scanner/src/detector.ts',
      '../../../packages/cube-scanner/view/web-detector.ts',
      '../../../packages/cube-scanner/view/native-detector.ts',
      '../../../packages/cube-scanner/src/ai-assemble.ts',
      '../../../packages/cube-scanner/src/camera.ts',
      '../../../packages/cube-scanner/src/facelet-cube.ts',
      '../../../packages/cube-scanner/src/misread-decode.ts',
      '../../../packages/cube-scanner/src/onnx-detect.ts',
      '../../../packages/cube-scanner/src/onnx-postprocess.ts',
      '../../../packages/cube-scanner/src/types.ts',
    ],
    // Exported from the package entry and used by its tests, but never by the panel — so esbuild
    // drops them and their absence is correct, not stale. Listed rather than silently ignored: if
    // the panel ever starts using one, delete it here and the guard covers it again.
    // `detectFace` is the composed preprocess→run→fit convenience the package entry offers and the
    // tests exercise; the panel drives the two halves through a `Detector`, so esbuild drops it.
    treeShaken: ['SOLVED_FACELETS', 'encodeFacelets', 'detectFace'],
  },
  {
    // The protocol layer for every smart cube: an unpublished git dependency, pinned by commit
    // sha and bundled here because its published ESM build is not Node-importable. The staleness
    // guard that MATTERS for this one is smartcube-pin.test.mjs — a re-export entry has almost no
    // declarations to compare, so the checks below are close to vacuous and the revision is what
    // is actually pinned. Listed here anyway because the meta-test above requires every emitted
    // bundle to appear, and an unlisted one is an unguarded one.
    name: 'smartcube',
    build: 'pnpm --filter cubus-web build:smartcube',
    bundle: '../vendor/smartcube.js',
    sources: ['../lib/smartcube-entry.js'],
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
        // Messages that live inside tree-shaken functions can never reach the bundle; each entry
        // names its own, and the same delete-when-used contract as `treeShaken` applies.
        if ((b.treeShakenMessages ?? []).some((s) => lit.includes(s))) continue;
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
  // The proxy is now CONDITIONAL, and the condition is the point. A ~200 ms wasm run has to leave
  // the page's thread or the UI is blocked the whole time the camera is open; a 15 ms GPU run does
  // not, and keeping the worker there would mean reaching the GPU device from a worker onnxruntime
  // spawned for its own reasons. Pinned as the rule rather than the literal, so "someone turned the
  // proxy off for wasm" still fails while the GPU exemption stays legible.
  assert.match(src, /env\.wasm\.proxy\s*=\s*!gpu/, 'wasm inference must still be proxied to a worker');
});

// onnxruntime-web ships eight `ort-wasm-simd-threaded.*` files — plain / jsep / asyncify / jspi,
// each a .wasm and a .mjs, ~90 MB in all — but the loader we ship (`ort.webgpu.bundle.min.mjs`) references
// exactly ONE pair by name and can fetch no other, because a bundle cannot request a filename it
// does not contain. copy-ort therefore copies only that pair; it used to glob all eight, which put
// ~50 MB of unreachable wasm in every dist/. This pins two things that must move together: the
// loader still references a single variant, and copy-ort derives-not-globs so it follows a version
// bump instead of silently shipping the wrong file or all of them again.
test('copy-ort ships only the wasm variant the loader can actually request', () => {
  const copyOrt = readFileSync(new URL('../copy-ort.mjs', import.meta.url), 'utf8');
  // Derive-not-glob: the wanted set comes from the loader's own text, and the all-variants glob is
  // gone. A future editor who reintroduces `startsWith('ort-wasm-simd-threaded.')` reinflates dist.
  assert.doesNotMatch(copyOrt, /startsWith\('ort-wasm-simd-threaded\.'\)/,
    'must not copy every ort-wasm-simd-threaded.* variant');

  // ONE grammar for "our asset", written once and used by discovery and cleanup alike. They were
  // two spellings agreeing by hand: discovery took any `ort-wasm*` the loader named, cleanup only
  // pruned `ort-wasm-simd-threaded.*`, so a rename within that family stranded the old multi-MB
  // wasm in vendor/ — which ships.
  const grammars = [...copyOrt.matchAll(/ort-wasm\[a-z0-9/g)];
  assert.equal(grammars.length, 1,
    `the owned-asset pattern must be written exactly once (found ${grammars.length})`);

  // WHICH entrypoint is read off copy-ort rather than named again here. This test hardcoded
  // `ort.bundle.min.mjs` while copy-ort had already moved to the WebGPU build, so it went on
  // checking the variant of a file the app no longer ships — green, and about nothing. Two places
  // naming the same artifact is the bug; one place naming it and the other reading that name is
  // the fix.
  const entry = /const ORT_ESM = '([^']+)'/.exec(copyOrt)?.[1];
  assert.ok(entry, 'copy-ort no longer declares ORT_ESM — this test cannot tell what ships');

  // With the dependency installed (locally, and in CI after `pnpm install`), compute the same set
  // copy-ort computes and pin it: exactly one variant, the asyncify pair. If onnxruntime-web is not
  // installed, skip rather than fail — mirrors the optional-bundle guard above.
  const loaderPath = new URL(
    `../../../packages/cube-scanner/node_modules/onnxruntime-web/dist/${entry}`, import.meta.url);
  if (!existsSync(loaderPath)) return;
  const referenced = [...new Set(
    [...readFileSync(loaderPath, 'utf8').matchAll(/ort-wasm[a-z0-9.\-]*\.(?:wasm|mjs)/g)].map((m) => m[0]))].sort();
  // ASYNCIFY, not jsep, since 2026-09-02. We ship `ort.webgpu.bundle.min.mjs` now — the wasm-only
  // `ort.bundle.min.mjs` cannot reach a GPU however many "webgpu" strings it contains, because the
  // EP-name registry is shared across builds. Naming the expected pair here is what turns a silent
  // switch back to a CPU-only runtime into a red test.
  assert.deepEqual(referenced, ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm'],
    'the shipped loader references exactly the asyncify variant pair, and nothing else');
});

// What copy-ort DOES, against real directories — as opposed to what its source text says.
//
// The assertions this replaces were `indexOf('copyFileSync(...)') < indexOf('rmSync(')`: green for
// any arrangement of those two strings including a broken one, red for a correct rewrite that
// spells them differently, and silent about the thing that actually matters — whether vendor/ is
// left in a loadable state. It went red on exactly that rewrite, which is the clearest evidence a
// source-text assertion can give about its own value.
test('copy-ort publishes atomically and prunes what the loader no longer names', async (t) => {
  const { publishRuntime } = await import('../copy-ort.mjs');
  const root = mkdtempSync(join(tmpdir(), 'copy-ort-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const src = join(root, 'src');
  const dest = join(root, 'vendor');
  mkdirSync(src, { recursive: true });
  mkdirSync(dest, { recursive: true });

  // A loader that names one variant pair, exactly as the real one does.
  const loader = 'loader.mjs';
  writeFileSync(join(src, loader),
    'fetch("ort-wasm-simd-threaded.asyncify.wasm"); import("ort-wasm-simd-threaded.asyncify.mjs");');
  writeFileSync(join(src, 'ort-wasm-simd-threaded.asyncify.wasm'), 'NEW-WASM');
  writeFileSync(join(src, 'ort-wasm-simd-threaded.asyncify.mjs'), 'NEW-GLUE');
  // …and a vendor/ still holding the PREVIOUS variant, which is what pruning is for.
  writeFileSync(join(dest, 'ort-wasm-simd-threaded.jsep.wasm'), 'OLD-WASM');
  writeFileSync(join(dest, 'cube-yolo.onnx'), 'NOT-OURS');

  const wanted = publishRuntime({ src, dest, ortEsm: loader });
  assert.deepEqual(wanted.sort(),
    ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']);

  const present = readdirSync(dest).sort();
  assert.deepEqual(present, [
    'cube-yolo.onnx',                        // not ours — never touched
    'ort-wasm-simd-threaded.asyncify.mjs',
    'ort-wasm-simd-threaded.asyncify.wasm',
    'ort.mjs',
    // The SAME loader under a second name, for the proxied wasm module instance. onnxruntime reads
    // env.wasm.proxy once per module, so the two modes need two module identities; the query form
    // (?cubus-runtime=proxied) is what an http origin gives, and a Tauri asset protocol that
    // resolves by path alone has never been shown to. A second file cannot be misread by any
    // protocol, and both come from one source here so they cannot drift.
    'ort.proxied.mjs',
  ], 'the stale variant must be pruned, both loader names published, and foreign files left alone');
  assert.equal(readFileSync(join(dest, 'ort-wasm-simd-threaded.asyncify.wasm'), 'utf8'), 'NEW-WASM');
  // NO STAGING LEFTOVERS. The temp files are how the publish is made atomic; one surviving a
  // successful run would ship in vendor/, which is the cost of that safety being paid for nothing.
  assert.equal(present.filter((f) => f.startsWith('.tmp-')).length, 0, 'staging files must not survive');
});

// A publish REFUSED before it starts must not have touched vendor/ — the preflight half.
test('copy-ort refuses a loader whose assets are not installed, before writing anything', async (t) => {
  const { publishRuntime } = await import('../copy-ort.mjs');
  const root = mkdtempSync(join(tmpdir(), 'copy-ort-preflight-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const src = join(root, 'src');
  const dest = join(root, 'vendor');
  mkdirSync(src, { recursive: true });
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(src, 'loader.mjs'), 'fetch("ort-wasm-simd-threaded.asyncify.wasm");');
  writeFileSync(join(dest, 'ort.mjs'), 'PREVIOUS-LOADER');

  assert.throws(() => publishRuntime({ src, dest, ortEsm: 'loader.mjs' }), /not installed/);
  assert.equal(readFileSync(join(dest, 'ort.mjs'), 'utf8'), 'PREVIOUS-LOADER',
    'a refused publish must not have replaced the runtime that was working');
});

// A publish that fails MID-COPY must leave the previous runtime loadable. This is the entire
// argument for staging, and the case the preflight test above does not reach: the first test
// written for it supplied a missing asset, so it never got past validation and proved nothing
// about copying at all.
//
// The failure is forced with a DIRECTORY where an asset should be — it passes `existsSync`, so
// preflight admits it, and `copyFileSync` then throws EISDIR. Portable and deterministic, unlike
// a permissions trick, which does nothing when CI runs as root.
test('copy-ort leaves the old runtime intact when a copy fails part-way', async (t) => {
  const { publishRuntime } = await import('../copy-ort.mjs');
  const root = mkdtempSync(join(tmpdir(), 'copy-ort-fail-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const src = join(root, 'src');
  const dest = join(root, 'vendor');
  mkdirSync(src, { recursive: true });
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(src, 'loader.mjs'),
    'fetch("ort-wasm-simd-threaded.asyncify.wasm"); import("ort-wasm-simd-threaded.asyncify.mjs");');
  writeFileSync(join(src, 'ort-wasm-simd-threaded.asyncify.wasm'), 'NEW-WASM');
  mkdirSync(join(src, 'ort-wasm-simd-threaded.asyncify.mjs')); // exists, and cannot be copied
  // vendor/ as a WORKING INSTALL — all three files, seeded, and all three must survive together.
  writeFileSync(join(dest, 'ort-wasm-simd-threaded.asyncify.wasm'), 'OLD-WASM');
  writeFileSync(join(dest, 'ort-wasm-simd-threaded.asyncify.mjs'), 'OLD-GLUE');
  writeFileSync(join(dest, 'ort.mjs'), 'PREVIOUS-LOADER');

  assert.throws(() => publishRuntime({ src, dest, ortEsm: 'loader.mjs' }));
  // THE WHOLE SET, not just the file that failed. The asset whose copy succeeded must not have been
  // published either: new wasm beside old glue is a pairing that never shipped and cannot load, and
  // it is exactly what per-file publishing leaves behind when a later file fails.
  assert.equal(readFileSync(join(dest, 'ort-wasm-simd-threaded.asyncify.wasm'), 'utf8'), 'OLD-WASM');
  assert.equal(readFileSync(join(dest, 'ort-wasm-simd-threaded.asyncify.mjs'), 'utf8'), 'OLD-GLUE');
  assert.equal(readFileSync(join(dest, 'ort.mjs'), 'utf8'), 'PREVIOUS-LOADER');
  // Nothing half-written left behind for the next run to publish by accident.
  assert.deepEqual(readdirSync(dest).filter((f) => f.startsWith('.tmp-')), []);
});

// The test command must PROVISION what the tests read, and this asserts the wiring rather than the
// files.
//
// The defect it closes ran red in CI for three days. `copy-ort.mjs` produces three gitignored
// artifacts — the ort loader, and the one wasm variant pair — and only `predev` ran it. CI runs
// `pnpm --filter cubus-web test`, never `dev`, so on every runner those three files simply did not
// exist: `serve-reload` died on an ENOENT for the wasm, and both golden-fixture tests died on
// "Importing a module script failed" for the loader. On a developer's machine all three pass,
// because `pnpm dev` was run once months ago and the artifacts have been sitting in vendor/ ever
// since. That is the shape worth guarding: a suite that cannot pass anywhere except where someone
// happened to run a different command first.
//
// Asserting only that the files exist would reproduce exactly that blindness — it passes on the
// machine that provisioned them and says nothing about the machine that did not. So the assertion
// is on the SCRIPT GRAPH: whatever `pnpm test` triggers must reach `copy-ort`. Remove the hook and
// this goes red on the developer's own machine, where the files are still present.
test('`pnpm test` provisions the onnxruntime files that tests read', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const scripts = pkg.scripts ?? {};

  // Expand `pnpm <script>` / `npm run <script>` references so the check follows the chain
  // (pretest -> vendor:libs -> copy-ort) instead of pinning one arrangement of it.
  const expand = (name, seen = new Set()) => {
    if (seen.has(name) || !scripts[name]) return '';
    seen.add(name);
    const body = scripts[name];
    const refs = [...body.matchAll(/(?:pnpm(?:\s+run)?|npm\s+run)\s+([\w:.-]+)/g)].map((m) => m[1]);
    return [body, ...refs.map((r) => expand(r, seen))].join(' ');
  };

  const reached = expand('pretest') + ' ' + expand('test');
  assert.match(reached, /copy-ort/,
    'nothing `pnpm test` runs reaches copy-ort, so a clean checkout tests against missing ' +
      'onnxruntime files — which is exactly how this was red in CI while green locally');

  // And the artifacts themselves, with the command to fix it — because the ENOENT this replaces
  // named a path and no remedy.
  for (const f of ['ort.mjs', 'ort.proxied.mjs', 'ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']) {
    assert.ok(existsSync(new URL(`../vendor/${f}`, import.meta.url)),
      `vendor/${f} is missing — run \`pnpm --filter cubus-web copy-ort\``);
  }
});
