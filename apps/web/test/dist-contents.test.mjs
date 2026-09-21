// What a release's web assets must NOT contain — asserted on an actual assembly, never on a list.
//
// build.mjs copies vendor/ wholesale on purpose (a new bundle is never silently missed), which is
// also how the dev-only MCP guest — 193 KB of eval-capable in-page listeners for an agent bridge
// no release compiles — shipped in every Tauri release until 2026-09-05, beside a comment saying
// the release "ships without it by design". A comment is not a gate. This runs the real assembly
// into a throwaway directory and looks at what came out.

import assert from 'node:assert/strict';
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync,
  symlinkSync, utimesSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { FILES, NEVER_SHIPPED, assembleDist, assertScannerBundlesFresh, bundleInputs, scannerBundles } from '../build.mjs';

const WEB = new URL('../', import.meta.url);
/** The scanner package's real manifest: the synthetic roots below have no package beside them, and
 *  the registry of what the scanner builds into vendor/ is read off its build scripts. */
const MANIFEST = fileURLToPath(new URL('../../packages/cube-scanner/package.json', WEB));

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
    // And every notices file it links: ONNX Runtime's own, for the releases that ship.
    const linked = [...readFileSync(notices, 'utf8').matchAll(/\]\((notices\/[^)]+)\)/g)].map((m) => m[1]);
    assert.ok(linked.length >= 2, `precondition: the notices link ONNX Runtime's notices (${linked})`);
    for (const f of linked) assert.ok(existsSync(join(dist, f)), `${f} is linked from the notices and did not reach dist/`);
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
function makeRoot(parent = tmpdir()) {
  const root = mkdtempSync(join(parent, 'cubus-root-'));
  const put = (rel, body = rel) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  };
  put('index.html', '<!doctype html><link rel="stylesheet" href="./tokens.css"><script type="module" src="./lib/app.js"></script>');
  put('tokens.css', ':root{}');
  put('manifest.webmanifest', JSON.stringify({ icons: [{ src: './icons/icon.png' }] }));
  put('THIRD_PARTY_NOTICES.md', '# Third-party notices\n');
  put('notices/onnxruntime-0.0.0-ThirdPartyNotices.txt', 'THIRD PARTY SOFTWARE NOTICES AND INFORMATION\n');
  put('icons/icon.png', 'png');
  put('lib/app.js', 'export {};');
  // The solving chain build.mjs asserts, file for file — `cube-layout` since the facelet layout left
  // two-phase.js on 2026-09-15.
  for (const f of ['two-phase', 'cube-layout', 'solver-engine', 'solve-worker', 'solve-client', 'cube-pieces']) put(`lib/${f}.js`, 'export {};');
  put('lib/cube-frame.js', 'export const fitDistance = () => 1;');
  put('lib/cubus-cube.js', "import { fitDistance } from './cube-frame.js';\nexport { fitDistance };\n");
  put('vendor/cubejs.js', 'export default {};');
  // Every bundle the scanner's build scripts write into vendor/ — the registry build.mjs reads.
  for (const { file } of scannerBundles(MANIFEST)) put(file, 'export {};');
  put('vendor/cubedet.onnx', 'model');
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
  // `cubeEntry`: the renderer is its own package now, so its real entry is outside any root
  // this test can assemble. The check under test is the timestamp comparison, not the path.
  const cubeEntry = join(root, 'lib', 'cubus-cube.js');
  // The synthetic tree's scanner bundles are placeholders, so the freshness check's bundler seam
  // hands back what the tree holds: this file tests what dist CONTAINS, and the real bundler is
  // run against the real bundles in its own case below.
  const asHeld = (o) => readFileSync(join(dist, 'vendor', o.entryPoints[0].split('/').pop().replace(/\.ts$/, '.js')), 'utf8');
  try { return fn({ root, dist, build: (o = {}) => assembleDist({ root, dist, cubeEntry, scannerManifest: MANIFEST, scannerBuild: asHeld, ...o }) }); }
  finally { rmSync(root, { recursive: true, force: true }); rmSync(dist, { recursive: true, force: true }); }
}

// The grammar for the runtime's assets is used in two files — copy-ort.mjs owns the COPY,
// build.mjs owns the CHECK — and copy-ort's own comment records what happens when two spellings
// of one rule are kept in step by hand: a rename inside the ort-wasm family stranded a
// multi-megabyte .wasm in vendor/, and vendor/ ships. So there is one spelling: copy-ort exports
// its predicates and build.mjs imports them. Until 2026-09-14 each file had its own copy and this
// test compared the two strings — which is the hand-kept agreement, moved into a test.
test('the check imports the copy\'s grammar for the runtime\'s assets, and spells none of its own', () => {
  const code = readFileSync(new URL('build.mjs', WEB), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  assert.match(code, /^import \{ isOwnedAsset, ownedAssetsIn \} from '\.\/copy-ort\.mjs';$/m,
    'build.mjs no longer takes its asset grammar from copy-ort.mjs');
  for (const spelling of [/ort-wasm\[/, /ort-wasm-simd/]) {
    assert.doesNotMatch(code, spelling, `build.mjs spells an asset pattern of its own (${spelling})`);
  }
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

// ---- the scanner's bundles: one registry, and a remedy per kind (audit-fix, 2026-09-21) --------
//
// The worker bundles are reached by URLs computed from the panel's own bundle and appear in no
// HTML, so only this check sees them in dist/ — and it listed them by hand while
// vendor-bundles.test.mjs derived the same set from the scanner's build scripts. Two registries:
// the letterbox worker joined with only one of them knowing, and deleting it from the list here
// left every test green (rows 8 and 10). The list is read off the build scripts now, and every
// bundle they emit has a negative test.
test("the scanner's bundles are read off its build scripts, and a manifest that names none is refused", () => {
  const bundles = scannerBundles(MANIFEST);
  const files = bundles.map((b) => b.file).sort();
  for (const f of ['vendor/ai-scan-panel.js', 'vendor/misread-worker.js', 'vendor/letterbox-worker.js']) {
    assert.ok(files.includes(f), `${f} is built by the scanner package and the registry does not know it`);
  }
  for (const { file, script } of bundles) {
    assert.match(script, /^build:/, `${file} is emitted by a script that is not a build (${script})`);
  }
  const bare = join(mkdtempSync(join(tmpdir(), 'cubus-manifest-')), 'package.json');
  try {
    writeFileSync(bare, JSON.stringify({ scripts: { test: 'vitest run' } }));
    assert.throws(() => scannerBundles(bare), /declares no build script that writes into vendor/);
    assert.throws(() => scannerBundles(join(dirname(bare), 'missing.json')), /manifest is not at/);
  } finally {
    rmSync(dirname(bare), { recursive: true, force: true });
  }
});

test('a missing worker bundle fails the build, naming the worker and the build that makes it — not copy-ort', () => {
  const workers = scannerBundles(MANIFEST).filter((b) => b.file.endsWith('-worker.js'));
  assert.ok(workers.length >= 2, `precondition: the scanner builds ${workers.length} workers`);
  for (const { file, script } of workers) {
    withRoot(({ root, build }) => {
      rmSync(join(root, file));
      assert.throws(build, (err) => {
        assert.ok(err.message.includes(file), `${file}: the failure does not name the missing worker`);
        assert.ok(err.message.includes(`pnpm --filter cube-scanner ${script}`), `${file}: the remedy is not the build that makes it`);
        assert.match(err.message, /page's thread/, `${file}: a missing worker is a performance regression, not a scanner that cannot scan`);
        assert.doesNotMatch(err.message, /copy-ort/, `${file}: copy-ort cannot build a worker`);
        return true;
      }, `a dist/ without ${file} was assembled`);
    });
  }
});

test('a missing panel bundle or runtime file names its own remedy, and no other', () => {
  withRoot(({ root, build }) => {
    rmSync(join(root, 'vendor', 'ai-scan-panel.js'));
    assert.throws(build, (err) => /ai-scan-panel\.js[^]*build:panel/.test(err.message) && !/copy-ort/.test(err.message),
      'a missing panel bundle must be told to build the panel');
  });
  withRoot(({ root, build }) => {
    rmSync(join(root, 'vendor', 'ort.proxied.mjs'));
    assert.throws(build, (err) => /ort\.proxied\.mjs[^]*copy-ort/.test(err.message) && !/cube-scanner build:/.test(err.message),
      'a missing runtime file must be told to run copy-ort, and not to build a worker');
  });
  withRoot(({ root, build }) => {
    rmSync(join(root, 'vendor', 'cubedet.onnx'));
    assert.throws(build, (err) => /cubedet\.onnx[^]*committed/.test(err.message) && !/copy-ort/.test(err.message),
      'the model is committed, and copy-ort does not produce it');
  });
});

// ---- the reference scan: every spelling, and only inside dist/ (audit-fix, 2026-09-21) ----------

test('a reference is found in any case, quoted or bare — and an attribute merely ending in src is not one', () => {
  withRoot(({ root, build }) => {
    writeFileSync(join(root, 'index.html'), [
      '<!doctype html>',
      '<link rel="stylesheet" href="./tokens.css">',
      '<script type="module" SRC=lib/app.js></script>',      // upper case, unquoted: valid HTML
      '<img data-src="ghost.png" srcset="ghost2.png 2x">',   // not references this build copies
      '<use foo:src="ghost3.png">',                           // nor a name that merely ends in :src
    ].join(''));
    const { referenced } = build({ freshness: false });
    assert.equal(referenced, 3, `checked ${referenced} assets, not the stylesheet, the script and the manifest's icon`);
    rmSync(join(root, 'lib', 'app.js'));
    assert.throws(() => build({ freshness: false }), (err) => err.message.includes('lib/app.js'),
      'a reference written in upper case and unquoted was skipped in silence');
  });
});

test('a reference that resolves outside dist/ is refused as such — whether or not a file is there', () => {
  withRoot(({ root, dist, build }) => {
    writeFileSync(join(dirname(dist), 'outside.css'), ':root{}');
    try {
      writeFileSync(join(root, 'index.html'), [
        '<!doctype html>',
        '<link rel="stylesheet" href="../outside.css">',   // exists, outside: passed as present
        '<link rel="stylesheet" href="../nowhere.css">',   // does not exist: was reported as merely missing
        '<script type="module" src="./lib/app.js"></script>',
      ].join(''));
      assert.throws(() => build({ freshness: false }), (err) => {
        assert.match(err.message, /outside dist/, 'a reference escaping dist/ passed because the file happened to exist where it pointed');
        assert.ok(err.message.includes('../outside.css') && err.message.includes('../nowhere.css'), 'both escapes are named');
        assert.doesNotMatch(err.message, /missing referenced assets/, 'an escape is a wrong reference, not a file to go and create outside dist/');
        return true;
      });
    } finally {
      rmSync(join(dirname(dist), 'outside.css'), { force: true });
    }
  });
});

test('a symlink inside dist/ whose target is outside it is refused, not counted as present', (t) => {
  withRoot(({ root, build }) => {
    const away = mkdtempSync(join(tmpdir(), 'cubus-away-'));
    try {
      writeFileSync(join(away, 'away.js'), 'export {};');
      try {
        symlinkSync(join(away, 'away.js'), join(root, 'lib', 'away.js'));
      } catch (err) {
        t.skip(`this platform refused a file symlink (${err.code})`);
        return;
      }
      writeFileSync(join(root, 'index.html'), '<!doctype html><link rel="stylesheet" href="./tokens.css"><script type="module" src="./lib/away.js"></script>');
      assert.throws(() => build({ freshness: false }), (err) => /outside dist/.test(err.message) && /through a link/.test(err.message),
        'a link that leaves dist/ was counted as an asset inside it');
    } finally {
      rmSync(away, { recursive: true, force: true });
    }
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

// Which files the bundle is MADE of is a question about a module graph, and it used to be
// answered by a regular expression over the source text — which cannot tell code from what
// merely looks like it. Both directions were wrong, and both fail the build in ways nothing on
// screen could explain (found by audit, 2026-09-05).
test('a commented-out import is not an input — text that looks like code is not code', () => {
  withRoot(({ root, build }) => {
    writeFileSync(join(root, 'lib', 'cubus-cube.js'),
      "// import './removed.js';\nconst dead = \"import './gone.js'\";\nimport { fitDistance } from './cube-frame.js';\nexport { fitDistance, dead };\n");
    const old = Date.now() / 1000 - 600;
    utimesSync(join(root, 'lib', 'cubus-cube.js'), old, old);
    build(); // must not throw: nothing here imports removed.js, so nothing is missing
  });
});

test('an import behind a comment is still an input — the freshness check must not lose it', () => {
  withRoot(({ root, build }) => {
    writeFileSync(join(root, 'lib', 'cubus-cube.js'),
      "import { fitDistance } from /* the silhouette lives here */ './cube-frame.js';\nexport { fitDistance };\n");
    const old = Date.now() / 1000 - 600;
    utimesSync(join(root, 'lib', 'cubus-cube.js'), old, old);
    const soon = Date.now() / 1000 + 600;
    utimesSync(join(root, 'lib', 'cube-frame.js'), soon, soon);
    assert.throws(build, (err) => err.message.includes('cube-frame.js'),
      'a comment between `from` and its specifier hid a bundled module from the freshness check');
  });
});

// An import that points at nothing is a bundle that cannot be built, and reading past it would
// silently shrink the set being compared. The message changed with the mechanism; the refusal
// must not have.
test('an import of a file that does not exist still fails the build, loudly', () => {
  withRoot(({ root, build }) => {
    writeFileSync(join(root, 'lib', 'cubus-cube.js'), "import './removed.js';\nexport const fitDistance = () => 1;\n");
    const old = Date.now() / 1000 - 600;
    utimesSync(join(root, 'lib', 'cubus-cube.js'), old, old);
    assert.throws(build, (err) => err.message.includes('removed.js'),
      'a specifier that resolves to nothing must stop the build, not shrink the input set');
  });
});

// ---- what a DESTRUCTIVE call must refuse ---------------------------------------------------
//
// The first line of assembleDist is `rmSync(dist, { recursive: true, force: true })`, and until
// 2026-09-05 nothing above it asked what it was about to delete. Every case here erased real
// source before a single check ran, and the function is exported precisely so it can be called
// with arguments (found by audit). The assertions are about a directory that must SURVIVE.
test('an assembly into the source tree is refused before anything is deleted', () => {
  withRoot(({ root }) => {
    assert.throws(() => assembleDist({ root, dist: root, freshness: false }),
      (err) => /source tree/.test(err.message),
      'dist === root deletes apps/web — sources, tests, node_modules — and then reports a missing index.html');
    assert.ok(existsSync(join(root, 'index.html')), 'the source tree was deleted');
    assert.ok(existsSync(join(root, 'lib', 'cubus-cube.js')), 'the source tree was deleted');
  });
});

test('an assembly into a parent of the source tree is refused too', () => {
  // The same delete, one level wider: everything root's parent holds, not only root. The nesting
  // is the point of writing this one by hand — the root sits inside a throwaway of its own, so a
  // regression in the guard destroys a directory this test made. Pointed at the tmpdir every
  // other fixture here lives in, it would have taken the system temp directory with it, which is
  // not a thing a test suite may be one edit away from doing.
  const base = mkdtempSync(join(tmpdir(), 'cubus-base-'));
  try {
    const root = makeRoot(base);
    assert.equal(dirname(root), base, 'precondition: the fixture root is nested inside a throwaway');
    assert.throws(() => assembleDist({ root, dist: base, freshness: false }),
      (err) => /source tree/.test(err.message));
    assert.ok(existsSync(join(root, 'index.html')), 'the source tree was deleted');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('an assembly into a directory the copy reads FROM is refused', () => {
  withRoot(({ root }) => {
    for (const inside of ['lib', join('vendor', 'nested'), 'index.html']) {
      assert.throws(() => assembleDist({ root, dist: join(root, inside), freshness: false }),
        (err) => /copies FROM/.test(err.message), `dist: ${inside}`);
    }
    assert.ok(existsSync(join(root, 'lib', 'cube-frame.js')), 'lib/ was deleted');
    assert.ok(existsSync(join(root, 'vendor', 'cubejs.js')), 'vendor/ was deleted');
    assert.ok(existsSync(join(root, 'index.html')), 'index.html was deleted');
  });
});

// Found by a Codex audit, 2026-09-16. The reference scan read ONE spelling — double quotes and a leading
// `./` — so a file referenced with single quotes or a bare relative path was skipped in silence, and a
// dist missing it passed the check written to catch exactly that. A check that quietly skips its subject
// is the failure generator this repository keeps digging back out.
test('every local reference is checked, however it is spelt — and remote ones are not', () => {
  withRoot(({ root, build }) => {
    writeFileSync(join(root, 'index.html'), [
      '<!doctype html>',
      '<link rel="stylesheet" href="./tokens.css">',
      "<link rel=icon href='icons/icon.png'>",                        // single quotes, no ./
      '<script type="module" src="lib/app.js"></script>',              // bare relative
      '<script src="https://example.invalid/x.js"></script>',          // remote: not this build\'s file
      '<img src="data:image/png;base64,AAAA">',                        // a data URI is not a file either
      '<a href="#main">skip</a>',                                      // nor an in-page anchor
    ].join(''));
    const { referenced } = build({ freshness: false });
    // Three distinct files: the stylesheet, the script and the icon — which the manifest names too, and
    // one file referenced twice is one file.
    assert.equal(referenced, 3, `checked ${referenced} assets, not the three local files`);
    // And a missing one is now found whichever way it was written.
    rmSync(join(root, 'icons', 'icon.png'));
    assert.throws(() => build({ freshness: false }), /missing referenced assets/);
  });
});

test('an assembly into a directory that HOLDS a copied tree is refused', () => {
  // The same delete from the other side. The guard asked whether the DESTINATION sits inside a copied
  // tree and not whether a copied tree sits inside the destination — and a symlink is how the second
  // happens without anyone spelling it: vendor/ living elsewhere and linked back in is still what the
  // assembly copies from, and a dist at its real home deletes it before reading it (Codex audit,
  // 2026-09-16).
  withRoot(({ root }) => {
    const away = mkdtempSync(join(tmpdir(), 'cubus-away-'));
    try {
      const moved = join(away, 'vendor');
      renameSync(join(root, 'vendor'), moved);
      symlinkSync(moved, join(root, 'vendor'));
      assert.ok(existsSync(join(root, 'vendor', 'cubejs.js')), 'precondition: the copy still reads vendor/');
      assert.throws(() => assembleDist({ root, dist: away, freshness: false }),
        (err) => /copies FROM/.test(err.message), 'a destination holding a copied tree was accepted');
      assert.ok(existsSync(join(moved, 'cubejs.js')), 'the copied tree was deleted');
    } finally {
      rmSync(away, { recursive: true, force: true });
    }
  });
});

test('the ordinary destination — a dist inside root — is still assembled', () => {
  // The positive control for the three refusals above: the guard must reject the destination
  // that eats its source and nothing else. `root/dist` is inside root, which is exactly why the
  // check is asymmetric rather than "do these two paths overlap".
  withRoot(({ root }) => {
    const { dist } = assembleDist({ root, dist: join(root, 'dist'), freshness: false, scannerManifest: MANIFEST });
    assert.ok(existsSync(join(dist, 'index.html')), 'the ordinary assembly stopped working');
    assert.ok(existsSync(join(root, 'lib', 'cubus-cube.js')), 'and it must not have eaten its own source');
    // Not `dist2` either: the guard compares whole path components, or a sibling directory whose
    // name merely starts with a copied one would be refused for no reason.
    assert.ok(assembleDist({ root, dist: join(root, 'libx'), freshness: false, scannerManifest: MANIFEST }).referenced > 0);
  });
});

// ---- and the same delete, spelled differently ------------------------------------------------
//
// The three refusals above all compared STRINGS, which answers a question about spelling rather
// than about directories — and a filesystem hands out more than one name for the same directory.
// An audit walked through the guard with one on 2026-09-05 and reached the deletion call. Both
// shapes below are the identical delete, arriving under a name the lexical check saw as unrelated.

test('an assembly into a symlinked twin of the source tree is refused', (t) => {
  withRoot(({ root }) => {
    const twin = join(mkdtempSync(join(tmpdir(), 'cubus-twin-')), 'ln');
    try {
      symlinkSync(root, twin, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (err) {
      // Never a pass: a platform that will not make the link cannot be asked the question here.
      t.skip(`this platform refused a directory symlink (${err.code})`);
      return;
    }
    try {
      assert.throws(() => assembleDist({ root, dist: twin, freshness: false }),
        (err) => /source tree/.test(err.message),
        'a second name for root is still root, and an assembly deletes its destination first');
      assert.throws(() => assembleDist({ root, dist: join(twin, 'lib'), freshness: false }),
        (err) => /copies FROM/.test(err.message));
      assert.ok(existsSync(join(root, 'index.html')), 'the source tree was deleted through its other name');
      assert.ok(existsSync(join(root, 'lib', 'cube-frame.js')), 'lib/ was deleted through its other name');
    } finally {
      // The link goes first and by name, so the recursive delete of its parent never has to
      // decide whether to follow one — and recursively, because a regression in the guard leaves
      // a real directory of build output where the link used to be.
      rmSync(twin, { recursive: true, force: true });
      rmSync(dirname(twin), { recursive: true, force: true });
    }
  });
});

test('an assembly into a macOS firmlink twin of the source tree is refused', (t) => {
  // The shape that was actually measured, and the reason the guard compares device/inode rather
  // than realpath. macOS stitches its read-only system volume to the data volume with FIRMLINKS,
  // so `/Users/x` and `/System/Volumes/Data/Users/x` are one directory — and a firmlink is a
  // mount, not a symlink, so realpath leaves the second spelling exactly as it found it. The two
  // preconditions below assert both halves of that, because a comment in build.mjs claims them.
  //
  // A THROWAWAY root, never the repo's own apps/web: every assertion here is that a directory
  // SURVIVED, so a regression in the guard deletes whatever this test pointed at.
  if (process.platform !== 'darwin') {
    t.skip('firmlinks are a macOS filesystem feature');
    return;
  }
  withRoot(({ root }) => {
    const twin = join('/System/Volumes/Data', realpathSync.native(root));
    if (!existsSync(twin)) {
      t.skip('this Mac does not expose its data volume at /System/Volumes/Data');
      return;
    }
    const [a, b] = [statSync(root), statSync(twin)];
    assert.equal(`${a.dev}:${a.ino}`, `${b.dev}:${b.ino}`, 'precondition: the twin is the same directory');
    assert.equal(realpathSync.native(twin), twin,
      'precondition: realpath does not collapse a firmlink — if it now does, build.mjs says otherwise and must be re-read');
    assert.throws(() => assembleDist({ root, dist: twin, freshness: false }),
      (err) => /source tree/.test(err.message),
      'the firmlink twin of root IS root, and an assembly deletes its destination first');
    assert.throws(() => assembleDist({ root, dist: join(twin, 'vendor'), freshness: false }),
      (err) => /copies FROM/.test(err.message));
    assert.ok(existsSync(join(root, 'index.html')), 'the source tree was deleted through its firmlink twin');
    assert.ok(existsSync(join(root, 'vendor', 'cubejs.js')), 'vendor/ was deleted through its firmlink twin');
  });
});

// A path spelled from the repo root is the ordinary way a person and a CI step name a file, and
// it reached esbuild as `absWorkingDir` — which refuses anything relative, so this threw before
// it could look at one import (found by audit, 2026-09-05).
test('a relative entry is scanned for its imports, not refused for being relative', () => {
  const rel = relative(process.cwd(), fileURLToPath(new URL('../../packages/cubus-cube/src/cubus-cube.js', WEB)));
  assert.ok(!rel.startsWith('/'), 'precondition: the entry under test is a relative path');
  const inputs = bundleInputs(rel);
  assert.ok(inputs.length > 1, 'a relative entry yielded no module graph');
  assert.ok(inputs.every((f) => f.startsWith('/')), 'inputs must come back absolute, whatever went in');
  assert.deepEqual(
    new Set(inputs),
    new Set(bundleInputs(fileURLToPath(new URL('../../packages/cubus-cube/src/cubus-cube.js', WEB)))),
    'the same entry named two ways must yield the same inputs',
  );
});

test('a relative root reaches the freshness check the same way an absolute one does', () => {
  // assembleDist builds the freshness check's entry out of `root`, so a relative root made that
  // check throw on its own argument — a build that cannot say whether the bundle is stale.
  withRoot(({ root, dist }) => {
    const rel = relative(process.cwd(), root);
    const soon = Date.now() / 1000 + 600;
    utimesSync(join(root, 'lib', 'cube-frame.js'), soon, soon);
    assert.throws(() => assembleDist({ root: rel, dist, freshness: true, cubeEntry: join(root, 'lib', 'cubus-cube.js'), scannerManifest: MANIFEST }),
      (err) => err.message.includes('cube-frame.js'),
      'the freshness check must fail over the STALE BUNDLE, not over how its root was spelled');
  });
});

test('app.js tolerates the guest\'s absence — the import is caught, not awaited bare', () => {
  const app = readFileSync(new URL('lib/app.js', WEB), 'utf8');
  const site = app.indexOf("import('../vendor/tauri-mcp-guest.js')");
  assert.notEqual(site, -1, 'the guest import moved or was removed — update this test and NEVER_SHIPPED together');
  const after = app.slice(site, site + 400);
  assert.match(after, /\.catch\(/, 'the guest import is not caught: a dist without the guest would fail to boot');
});

// The renderer left this package on 2026-09-14, and every guard above asks whether the destination
// is this app or something this app copies FROM. The renderer's source is neither, so a destination
// pointed at it reached the recursive delete with nothing in the way (found by audit, 2026-09-14).
test('assembling into the renderer package is refused, not carried out', () => {
  const renderer = fileURLToPath(new URL('../../packages/cubus-cube', WEB));
  assert.throws(() => assembleDist({ dist: renderer, freshness: false }),
    (err) => /refusing to assemble into .*cubus-cube/.test(err.message),
    'a build aimed at the renderer package would have deleted it');
  // And the other way round: a destination that CONTAINS the renderer is the same delete.
  assert.throws(() => assembleDist({ dist: fileURLToPath(new URL('../../packages', WEB)), freshness: false }),
    (err) => /refusing to assemble into/.test(err.message),
    'a build aimed at packages/ would have taken the renderer with it');
});

// The guard and the freshness check once resolved the renderer's entry separately: the guard from
// the default, the freshness check from a caller's `cubeEntry`. So a caller that supplied its own
// entry had that renderer checked for freshness while the DEFAULT was the one protected from the
// delete (found by audit, 2026-09-14).
test('the renderer a caller names is the renderer the deletion guard protects', () => {
  withRoot(({ root }) => {
    // A renderer outside the synthetic root, named through `cubeEntry` — and the destination aimed
    // straight at the package that holds it.
    const outside = mkdtempSync(join(tmpdir(), 'cubus-renderer-'));
    try {
      mkdirSync(join(outside, 'src'), { recursive: true });
      writeFileSync(join(outside, 'src', 'cubus-cube.js'), 'export {};');
      assert.throws(
        () => assembleDist({ root, dist: outside, freshness: false, cubeEntry: join(outside, 'src', 'cubus-cube.js') }),
        (err) => /refusing to assemble into/.test(err.message),
        'a build aimed at the renderer the caller named would have deleted it');
      assert.ok(existsSync(join(outside, 'src', 'cubus-cube.js')), 'and the renderer it named is gone');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

// A SYMLINK INTO A NESTED SOURCE DIRECTORY. The guard's ancestry walked `dirname()` as TEXT while
// `statSync` followed the link: through `alias -> <root>/lib/screens`, the walk visited `screens`
// and then stepped to the alias's own lexical parent, never reaching `lib` or the root — so a
// destination of `alias/cube` passed every check and reached the recursive delete of a real
// source directory (found by audit, 2026-09-14). Aimed at a SYNTHETIC tree on purpose: when this
// guard fails, the delete runs.
test('a destination reached through a symlink into the source is refused, however deep the link', () => {
  withRoot(({ root }) => {
    const nested = join(root, 'lib', 'screens', 'cube');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, 'keep.js'), 'export {};');
    const links = mkdtempSync(join(tmpdir(), 'cubus-alias-'));
    try {
      symlinkSync(join(root, 'lib', 'screens'), join(links, 'alias'));
      assert.throws(() => assembleDist({ root, dist: join(links, 'alias', 'cube'), freshness: false }),
        (err) => /refusing to assemble into/.test(err.message),
        'a destination reached through a symlink into lib/ passed the guard');
      assert.ok(existsSync(join(nested, 'keep.js')), 'and the source directory it pointed at is gone');

      // The renderer's package, reached the same way.
      const renderer = mkdtempSync(join(tmpdir(), 'cubus-renderer-alias-'));
      try {
        mkdirSync(join(renderer, 'src'), { recursive: true });
        writeFileSync(join(renderer, 'src', 'cubus-cube.js'), 'export {};');
        symlinkSync(join(renderer, 'src'), join(links, 'renderer-src'));
        assert.throws(
          () => assembleDist({ root, dist: join(links, 'renderer-src'), freshness: false, cubeEntry: join(renderer, 'src', 'cubus-cube.js') }),
          (err) => /refusing to assemble into/.test(err.message),
          'a destination reached through a symlink into the renderer passed the guard');
        assert.ok(existsSync(join(renderer, 'src', 'cubus-cube.js')), 'and the renderer source is gone');
      } finally {
        rmSync(renderer, { recursive: true, force: true });
      }
    } finally {
      rmSync(links, { recursive: true, force: true });
    }
  });
});

// ---- the scanner's bundles are what their sources build NOW (audit-fix 2026-09-21, finding 9) ----
//
// The renderer's freshness check compares mtimes, which a fresh checkout makes meaningless; the
// scanner's bundles are committed and reached by computed URLs, so a direct `build:dist` could
// package one that its sources no longer build. `assertScannerBundlesFresh` rebuilds each in
// memory and compares bytes. The real bundler runs once here, on the real bundles, so the check is
// proved against what ships; the negative cases use the builder seam.
test('the shipped scanner bundles are byte-for-byte what their build scripts produce', () => {
  const dist = mkdtempSync(join(tmpdir(), 'cubus-scanner-fresh-'));
  try {
    mkdirSync(join(dist, 'vendor'));
    for (const { file } of scannerBundles(MANIFEST)) copyFileSync(fileURLToPath(new URL(file, WEB)), join(dist, file));
    assert.doesNotThrow(() => assertScannerBundlesFresh(dist, MANIFEST), 'a committed bundle is behind its source — rebuild and commit it');
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

test('a scanner bundle that differs from its sources by one byte is a refused dist, naming the bundle and its build', () => {
  const dist = mkdtempSync(join(tmpdir(), 'cubus-scanner-stale-'));
  try {
    mkdirSync(join(dist, 'vendor'));
    const bundles = scannerBundles(MANIFEST);
    const shipped = new Map(bundles.map(({ file }) => [file, readFileSync(fileURLToPath(new URL(file, WEB)), 'utf8')]));
    for (const [file, text] of shipped) writeFileSync(join(dist, file), text);
    // The builder seam hands back exactly what is shipped, so the check passes on identity…
    const asShipped = (o) => shipped.get(`vendor/${o.entryPoints[0].split('/').pop().replace(/\.ts$/, '.js')}`);
    assert.doesNotThrow(() => assertScannerBundlesFresh(dist, MANIFEST, asShipped));
    // …and one byte off in the letterbox worker is refused, by name, with the command that fixes it.
    const worker = bundles.find((b) => b.file.endsWith('letterbox-worker.js'));
    writeFileSync(join(dist, worker.file), `${shipped.get(worker.file)}\n// stale\n`);
    assert.throws(() => assertScannerBundlesFresh(dist, MANIFEST, asShipped),
      (err) => err.message.includes(worker.file) && err.message.includes(worker.script) && !err.message.includes('ai-scan-panel.js'),
      'a stale worker was packaged, or the wrong bundle was blamed');
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

