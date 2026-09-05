// What a release's web assets must NOT contain — asserted on an actual assembly, never on a list.
//
// build.mjs copies vendor/ wholesale on purpose (a new bundle is never silently missed), which is
// also how the dev-only MCP guest — 193 KB of eval-capable in-page listeners for an agent bridge
// no release compiles — shipped in every Tauri release until 2026-09-05, beside a comment saying
// the release "ships without it by design". A comment is not a gate. This runs the real assembly
// into a throwaway directory and looks at what came out.

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { FILES, NEVER_SHIPPED, assembleDist } from '../build.mjs';

const WEB = new URL('../', import.meta.url);

// The exclusion names real files, or it excludes nothing. A rename on either side would leave the
// list guarding a path that no longer exists while the renamed file shipped.
test('every never-shipped path names a file that exists in vendor/ today', () => {
  for (const f of NEVER_SHIPPED) {
    assert.ok(existsSync(new URL(f, WEB)), `${f} is on the never-ship list but does not exist — the list is stale`);
  }
  assert.ok(NEVER_SHIPPED.includes('vendor/tauri-mcp-guest.js'), 'the MCP guest must never ship');
  assert.ok(NEVER_SHIPPED.includes('vendor/min2phase.PROVENANCE.md'), 'the removed solver\'s provenance note must never ship');
});

test('dist never carries the MCP guest or the min2phase provenance note, and does carry the notices', () => {
  const dist = mkdtempSync(join(tmpdir(), 'cubus-dist-'));
  try {
    // `freshness: false`: this asks what dist CONTAINS, not whether the bundle is newer than its
    // source — a working tree mid-change fails the latter, and vendor-bundles.test.mjs is the
    // test that says so, by content. The CLI keeps the check on (build.mjs, assembleDist).
    assembleDist({ dist, freshness: false });
    for (const f of NEVER_SHIPPED) {
      assert.ok(!existsSync(join(dist, f)), `${f} reached dist/`);
    }
    // The copy still happened: the exclusion is a filter, not a skipped directory.
    assert.ok(existsSync(join(dist, 'vendor/cubus-cube.js')), 'vendor/ was not copied');
    assert.ok(existsSync(join(dist, 'vendor/cubejs.js')), 'vendor/ was not copied');
    // And the licence notices ship with the app they describe.
    assert.ok(FILES.includes('THIRD_PARTY_NOTICES.md'));
    const notices = join(dist, 'THIRD_PARTY_NOTICES.md');
    assert.ok(existsSync(notices), 'THIRD_PARTY_NOTICES.md did not reach dist/');
    assert.match(readFileSync(notices, 'utf8'), /^# Third-party notices/m);
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

// The guest is loaded by app.js under Tauri with a `.catch`, which is what makes leaving it out of
// dist a clean absence rather than a broken boot. Pinned here beside the exclusion, because the
// two are one decision: remove the catch and the exclusion becomes a blank window.
// ---- what a BROKEN assembly must refuse ---------------------------------------------------------
//
// Everything above asks what a good assembly produced. These ask the other question, which is the
// one a check is actually for: does it FAIL when the thing it guards is broken? Every case here
// passed the old build.mjs, and each of them ships an app that loads and cannot scan — the exact
// failure the scanner block was written to prevent, in the three shapes it could not see:
//
//   * the loader's `.mjs` glue missing (only the `.wasm` was ever checked),
//   * `ort.proxied.mjs` missing (never checked at all — a 404 on Windows/Linux/Android, where
//     wasm is the only inference path),
//   * a wasm variant in vendor/ that the shipped loader never names (both old checks derived
//     their expectation from vendor/, so an unrelated variant satisfied them both).
//
// A synthetic root rather than the real one: these are about assets being ABSENT, and the real
// vendor/ is 36 MB of files that must not be deleted to ask the question.
const ORT_WASM = 'ort-wasm-simd-threaded.asyncify.wasm';
const ORT_GLUE = 'ort-wasm-simd-threaded.asyncify.mjs';

/** The smallest tree assembleDist() accepts: every required file, with the runtime named by the
 *  loader exactly as onnxruntime-web names it (measured against the shipped vendor/ort.mjs). */
function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'cubus-root-'));
  const put = (rel, body = rel) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  };
  put('index.html', '<!doctype html><link rel="stylesheet" href="./tokens.css"><script type="module" src="./lib/app.js"></script>');
  put('tokens.css', ':root{}');
  put('manifest.webmanifest', JSON.stringify({ icons: [{ src: './icons/icon.png' }] }));
  put('THIRD_PARTY_NOTICES.md', '# Third-party notices\n');
  put('icons/icon.png', 'png');
  put('lib/app.js', 'export {};');
  for (const f of ['two-phase', 'solver-engine', 'solve-worker', 'solve-client', 'cube-pieces']) put(`lib/${f}.js`, 'export {};');
  put('lib/cube-frame.js', 'export const fitDistance = () => 1;');
  put('lib/cubus-cube.js', "import { fitDistance } from './cube-frame.js';\nexport { fitDistance };\n");
  put('vendor/cubejs.js', 'export default {};');
  put('vendor/misread-worker.js', 'export {};');
  put('vendor/cube-yolo.onnx', 'model');
  // The loader names its own assets; that text is what build.mjs now derives the check from.
  const loader = `const wasm = "${ORT_WASM}"; const glue = "${ORT_GLUE}";`;
  put('vendor/ort.mjs', loader);
  put('vendor/ort.proxied.mjs', loader);
  put(`vendor/${ORT_WASM}`, 'wasm');
  put(`vendor/${ORT_GLUE}`, 'glue');
  put('vendor/cubus-cube.js', 'bundled');
  // The bundle is newer than every input, which is the state a correct build leaves behind.
  const old = Date.now() / 1000 - 600;
  for (const f of ['lib/cubus-cube.js', 'lib/cube-frame.js']) utimesSync(join(root, f), old, old);
  return root;
}

/** Run `fn` against a fresh synthetic root, then delete both it and whatever it assembled. */
function withRoot(fn) {
  const root = makeRoot();
  const dist = mkdtempSync(join(tmpdir(), 'cubus-dist-'));
  try { return fn({ root, dist, build: (o = {}) => assembleDist({ root, dist, ...o }) }); }
  finally { rmSync(root, { recursive: true, force: true }); rmSync(dist, { recursive: true, force: true }); }
}

// The grammar for the runtime's assets is written in two files — copy-ort.mjs owns the COPY,
// build.mjs owns the CHECK — and copy-ort's own comment records what happens when two spellings
// of one rule are kept in step by hand: a rename inside the ort-wasm family stranded a
// multi-megabyte .wasm in vendor/, and vendor/ ships. Neither file can import the other's private
// constant, so this is the thing that keeps them one rule.
test('the copy and the check share one grammar for the runtime\'s assets', () => {
  const patternIn = (file, name) => {
    const src = readFileSync(new URL(file, WEB), 'utf8');
    const m = new RegExp(`const ${name} = '([^']+)';`).exec(src);
    assert.ok(m, `${file} no longer declares ${name} — the two files must still share one pattern`);
    return m[1];
  };
  assert.equal(
    patternIn('build.mjs', 'ORT_ASSET'),
    patternIn('copy-ort.mjs', 'OWNED_ASSET'),
    'build.mjs checks for a different set of files than copy-ort.mjs publishes',
  );
});

// The positive control. Without it every assertion below could be passing because the synthetic
// root is broken in some other way, and a negative test that throws for the wrong reason is worse
// than no test: it reports the check working when the check is gone.
test('the synthetic root assembles cleanly, freshness check and all', () => {
  withRoot(({ build, dist }) => {
    build();
    assert.ok(existsSync(join(dist, `vendor/${ORT_WASM}`)), 'the runtime reached dist/');
  });
});

test('a missing runtime glue module fails the build — the .wasm alone is not the runtime', () => {
  withRoot(({ root, build }) => {
    rmSync(join(root, 'vendor', ORT_GLUE));
    assert.throws(build, (err) => err.message.includes(ORT_GLUE),
      `the loader fetches ${ORT_GLUE} by name; a dist/ without it loads and cannot scan`);
  });
});

test('a missing ort.proxied.mjs fails the build — the proxied loader is fetched by path', () => {
  withRoot(({ root, build }) => {
    rmSync(join(root, 'vendor', 'ort.proxied.mjs'));
    assert.throws(build, (err) => err.message.includes('ort.proxied.mjs'),
      'a custom protocol answers 404 for the name it has not seen — the model never loads');
  });
});

test('a wasm variant the loader never names does not satisfy the check', () => {
  withRoot(({ root, build }) => {
    // vendor/ holds a perfectly plausible pair, and the shipped loader asks for neither.
    for (const [from, to] of [[ORT_WASM, 'ort-wasm-simd-threaded.jsep.wasm'], [ORT_GLUE, 'ort-wasm-simd-threaded.jsep.mjs']]) {
      renameSync(join(root, 'vendor', from), join(root, 'vendor', to));
    }
    assert.throws(build, (err) => err.message.includes(ORT_WASM),
      'the check passed on the presence of A wasm file rather than THE one the loader requests');
  });
});

test('a loader that names no runtime asset is a loud failure, not a green one', () => {
  withRoot(({ root, build }) => {
    writeFileSync(join(root, 'vendor', 'ort.mjs'), 'nothing here names a runtime asset');
    assert.throws(build, (err) => /names no ort-wasm/.test(err.message),
      'a check that derives its expectation from a file must fail when that file yields nothing');
  });
});

// The freshness half. This check was decorative once already (it compared the COPIES in dist/,
// whose timestamps cpSync rewrites), and it was half-blind again until now: it watched the bundle
// ENTRY and none of the modules bundled into it.
test('a bundle older than any of its inputs fails the build, not just older than its entry', () => {
  withRoot(({ root, build }) => {
    const soon = Date.now() / 1000 + 600;
    utimesSync(join(root, 'lib', 'cube-frame.js'), soon, soon);
    assert.throws(build, (err) => err.message.includes('cube-frame.js'),
      'lib/cube-frame.js is bundled into vendor/cubus-cube.js — editing it and shipping without a rebuild passed');
  });
});

test('the freshness check is what `freshness: false` turns off, and nothing else', () => {
  withRoot(({ root, build }) => {
    const soon = Date.now() / 1000 + 600;
    utimesSync(join(root, 'lib', 'cube-frame.js'), soon, soon);
    build({ freshness: false }); // the contents are sound; only the timestamps are not
  });
});

test('app.js tolerates the guest\'s absence — the import is caught, not awaited bare', () => {
  const app = readFileSync(new URL('lib/app.js', WEB), 'utf8');
  const site = app.indexOf("import('../vendor/tauri-mcp-guest.js')");
  assert.notEqual(site, -1, 'the guest import moved or was removed — update this test and NEVER_SHIPPED together');
  const after = app.slice(site, site + 400);
  assert.match(after, /\.catch\(/, 'the guest import is not caught: a dist without the guest would fail to boot');
});
