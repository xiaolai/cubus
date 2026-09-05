// Assemble apps/web/dist/ — the isolated web-asset folder Tauri bundles.
//
// Why this exists: tauri.conf.json's frontendDist used to point at apps/web
// itself, which also holds node_modules, package.json, serve.mjs and the tests.
// Tauri refuses that outright:
//
//   The configured frontendDist includes the `["node_modules"]` folder.
//   Please isolate your web assets on a separate folder.
//
// So `pnpm tauri build` could never produce a bundle. dist/ is that isolated
// folder: only what the browser actually loads, nothing else.
//
// Run AFTER the esbuild steps and copy-ort, because both write into vendor/ and
// this copies vendor/ wholesale. tauri.conf.json's beforeBuildCommand sequences
// them; the freshness check below fails loud if that order is ever broken.
//
// dist/ is generated and gitignored — never edit it, edit lib/ or index.html.
//
// The assembly is a function so a test can run it into a throwaway directory
// and look at what came out; `node build.mjs` runs it into dist/.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path, { join, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// The same bundler that BUILDS vendor/cubus-cube.js, asked which files went into it. It is
// already required here: tauri.conf.json's beforeBuildCommand runs `build:cube` (esbuild) two
// steps before this file, so a tree that can reach build.mjs can reach esbuild.
import { buildSync } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));

// Whole directories, so a new import never silently misses the bundle. lib/ is
// source (app.js and its siblings load as ES modules directly); vendor/ is
// esbuild output plus the onnxruntime wasm and the YOLO model.
export const DIRS = ['lib', 'vendor', 'icons'];
// THIRD_PARTY_NOTICES.md ships beside the app: the About card links it, and a
// licence notice that is not in the bundle is a notice nobody received.
export const FILES = ['index.html', 'tokens.css', 'manifest.webmanifest', 'THIRD_PARTY_NOTICES.md'];

// What vendor/ holds that a RELEASE must not. The wholesale copy is the point —
// a new bundle is never silently missed — so exclusions are named here one by
// one, each with its reason:
//
//   vendor/tauri-mcp-guest.js   The dev-only MCP guest: in-page listeners that
//       let an agent click selectors and eval JS through tauri-plugin-mcp. Inert
//       without the Rust side, which no release compiles — but 193 KB of
//       eval-capable code is not "inert" in a shipped bundle, and app.js imports
//       it inside a try/catch precisely so a dist without it loads clean. It
//       shipped in every Tauri release until 2026-09-05.
//   vendor/min2phase.PROVENANCE.md   The licence record of a solver that was
//       REMOVED on 2026-08-29: a note about code that is not in the app.
export const NEVER_SHIPPED = ['vendor/tauri-mcp-guest.js', 'vendor/min2phase.PROVENANCE.md'];

// ONE grammar for the onnxruntime assets, written once as a source string and used for BOTH
// directions of the scanner check below — what the shipped loader NAMES, and what vendor/ HOLDS.
// It is copy-ort.mjs's `OWNED_ASSET` predicate, and that file records why it is one string: the
// two uses need different anchoring (a global scan of a bundle's text, an exact test of a
// filename), and writing the pattern out twice is how this contract broke before. It broke again
// here, differently: this file spelled it `ort-wasm-simd-threaded.*.wasm` in two places, so the
// `.mjs` glue the loader fetches beside the binary was never checked at all.
const ORT_ASSET = 'ort-wasm[a-z0-9.\\-]*\\.(?:wasm|mjs)';
/** Every runtime asset `text` names. A bundle cannot fetch a filename it does not contain, so
 *  what the loader names IS the complete set of what it can reach at runtime. */
const ortAssetsNamedBy = (text) => [...new Set([...text.matchAll(new RegExp(ORT_ASSET, 'g'))].map((m) => m[0]))];
/** Is this filename one of the runtime's own? Anchored, so it matches a whole name, not a part. */
const isOrtAsset = (f) => new RegExp(`^${ORT_ASSET}$`).test(f);

/**
 * The entry and every LOCAL module it pulls in, transitively — an esbuild bundle's own sources.
 *
 * Bare specifiers (`three`) are deliberately not followed: those are node_modules, re-stamped by
 * every install and asked for by name, so they are not what a freshness check is about.
 * `packages: 'external'` is exactly that rule, spelled in esbuild's own terms.
 *
 * ASKED OF THE BUNDLER, not of a regular expression (2026-09-05). A regex over the source text
 * cannot tell code from what merely looks like it, and it was wrong in both directions: a
 * commented-out `import './removed.js'` broke the build over a file nothing imports, while a
 * block comment sitting between `from` and its specifier was no match at all, so that module
 * silently left the set the freshness check compares. Both are questions
 * about a JavaScript module graph, and esbuild is the thing in this repo that already answers
 * them: it is what BUILT the bundle two steps earlier in the same command chain, so the inputs it
 * reports are the inputs, by construction rather than by agreement.
 *
 * Throws when a specifier does not resolve: an import that points at nothing is a bundle that
 * cannot be built, and reading past it here would silently shrink the set being compared.
 */
export function bundleInputs(entry) {
  // RESOLVED FIRST. esbuild's `absWorkingDir` means what it says and refuses anything else
  // ("The working directory ... is not an absolute path"), so a relative entry made this throw
  // before it could look at a single import — and the entry is relative whenever the caller
  // spelled a path from the repo root, `assembleDist({ root: 'apps/web' })` included, since its
  // freshness check builds this argument out of `root` (found by audit, 2026-09-05).
  const file = resolve(entry);
  if (!existsSync(file)) throw new Error(`build: missing bundle entry ${entry}`);
  const cwd = dirname(file);
  let meta;
  try {
    ({ metafile: meta } = buildSync({
      entryPoints: [file],
      absWorkingDir: cwd,
      bundle: true,
      packages: 'external',
      format: 'esm',
      write: false,      // nothing is being produced here; the input list is the whole point
      metafile: true,
      logLevel: 'silent', // a failure is raised below, in this file's words
    }));
  } catch (err) {
    const why = (err?.errors ?? []).map((e) => e.text).join('; ') || String(err?.message ?? err);
    throw new Error(`build: ${entry} cannot be scanned for its imports — ${why}`);
  }
  // Keys are relative to absWorkingDir, in posix form; a mtime comparison needs real paths.
  return Object.keys(meta.inputs).map((f) => resolve(cwd, f));
}

/** A path as dist/ names it: relative to `root`, with forward slashes on every platform — the
 *  spelling NEVER_SHIPPED is written in. */
const posix = (root, p) => relative(root, p).split(sep).join('/');

/** Is `inner` the same path as `outer`, or somewhere beneath it? Both already absolute. A whole
 *  path component is required, so `.../dist2` is not beneath `.../dist`. */
const beneath = (inner, outer) => {
  const rel = relative(outer, inner);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !path.isAbsolute(rel));
};

/**
 * Refuse a destination the assembly would destroy on its way in.
 *
 * assembleDist's first act is an unconditional recursive delete, and nothing above it asked what
 * it was deleting: `assembleDist({ dist: root })` erased apps/web — sources, tests, node_modules —
 * before a single check ran, and the same for any ancestor of root or any of the trees the copy
 * reads (found by audit, 2026-09-05). The ordinary `root/dist` is untouched by this: it lives
 * inside root, but root does not live inside IT and it is none of the copied paths.
 *
 * Named and thrown from here rather than inlined, because the order is the contract — this must
 * be the thing that happens before the delete, not beside it.
 */
function assertDistIsDisposable(src, out) {
  if (beneath(src, out)) {
    throw new Error(
      `build: refusing to assemble into ${out} — it is the source tree ${src} (or holds it), and the first thing an assembly does is delete its destination`,
    );
  }
  for (const p of [...DIRS, ...FILES]) {
    const copied = join(src, p);
    if (beneath(out, copied)) {
      throw new Error(
        `build: refusing to assemble into ${out} — it is ${posix(src, copied)}, which the assembly copies FROM, and the destination is deleted first`,
      );
    }
  }
}

/** Everything the browser loads, and nothing else. Whole directories on purpose (a new import is
 *  never silently missed), with the never-ship list applied on the way in AND asserted on what
 *  came out. */
function copyWebAssets(root, dist) {
  for (const f of FILES) {
    const src = join(root, f);
    if (!existsSync(src)) throw new Error(`build: missing required file ${f}`);
    cpSync(src, join(dist, f));
  }
  for (const d of DIRS) {
    const src = join(root, d);
    if (!existsSync(src)) throw new Error(`build: missing required directory ${d}/`);
    cpSync(src, join(dist, d), { recursive: true, filter: (from) => !NEVER_SHIPPED.includes(posix(root, from)) });
  }
  // The exclusion is asserted on the OUTPUT as well as applied on the way in: a
  // filter that stopped matching — a rename, a path spelt differently — would
  // ship the guest again with every other check green.
  const leaked = NEVER_SHIPPED.filter((f) => existsSync(join(dist, f)));
  if (leaked.length) {
    throw new Error(`build: dist/ carries files that must never ship:\n  ${leaked.join('\n  ')}`);
  }
}

/** Every asset index.html and the manifest NAME must resolve inside dist/. Returns how many were
 *  checked, which is what the CLI prints. */
function assertReferencedAssets(dist) {
  // Assert every asset the app actually references resolves inside dist. A copy
  // step that quietly drops a file looks exactly like one that worked, and the
  // failure would surface only as a blank window in a packaged app.
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  const referenced = new Set(
    [...html.matchAll(/(?:href|src)="\.\/([^"]+)"/g)].map((m) => m[1]),
  );
  for (const icon of JSON.parse(readFileSync(join(dist, 'manifest.webmanifest'), 'utf8')).icons ?? []) {
    referenced.add(icon.src.replace(/^\.\//, ''));
  }

  const missing = [...referenced].filter((r) => !existsSync(join(dist, r)));
  if (missing.length) {
    throw new Error(`build: dist/ is missing referenced assets:\n  ${missing.join('\n  ')}`);
  }
  return referenced.size;
}

/** The solving chain, which no HTML names. */
function assertSolverAssets(dist) {
  // The solving path is reached by dynamic import from app.js, so none of it appears in
  // index.html and the scan above cannot see it. cubejs is also gitignored and regenerated, so a
  // fresh checkout that skips `pnpm vendor:libs` would produce a dist/ that looks complete and
  // silently cannot solve a cube — app.js try/catches the import. Assert the whole chain
  // explicitly: the lib/ files ride the DIRS copy, but a dist/ missing any of them ships an app
  // that loads and cannot solve, which is the one failure nothing else here would catch.
  const SOLVER = [
    'vendor/cubejs.js',
    'lib/two-phase.js',
    'lib/solver-engine.js',
    'lib/solve-worker.js',
    'lib/solve-client.js',
    'lib/cube-pieces.js',
  ];
  const absentSolver = SOLVER.filter((f) => !existsSync(join(dist, f)));
  if (absentSolver.length) {
    throw new Error(
      `build: dist/ is missing vendored solver files:\n  ${absentSolver.join('\n  ')}\n` +
        '  Run `pnpm vendor:libs` first — without it the app loads but cannot solve.',
    );
  }
}

/** The scanner's runtime, which no HTML names either — and whose set is derived from the SHIPPED
 *  loader rather than from a filename shape. */
function assertScannerAssets(root, dist) {
  // Same problem, the scanner's half. ort.mjs is reached by a COMPUTED url (`${wasmPaths}ort.mjs`),
  // the .wasm by onnxruntime from its own import.meta.url, and the model by an attribute the panel
  // reads — so none of them appears in index.html and the scan above is blind to all three. They are
  // gitignored too, so a checkout that skips `pnpm copy-ort` builds a dist/ that looks complete and
  // silently cannot scan.
  //
  // ort.mjs in particular must stay a SEPARATE file: onnxruntime spawns its inference worker from
  // its own import.meta.url, so bundling it into the panel puts inference back on the main thread.
  //
  // misread-worker.js is here for the same reason and one more: the panel reaches it by a URL
  // computed from its own bundle (`new URL('./misread-worker.js', import.meta.url)`), so it
  // appears in no HTML either — and its absence degrades QUIETLY, back to the three-second
  // main-thread decode it exists to move off the page. It is committed rather than generated, so
  // this catches a dist/ assembled before `build:misread-worker` ever ran.
  // ort.proxied.mjs is the SAME loader under its second name — the identity onnxruntime needs for
  // the proxied wasm instance where a query string cannot serve it (a Tauri asset protocol; see
  // copy-ort.mjs). It is published with ort.mjs and it is fetched at runtime, so a dist/ carrying
  // one and not the other is a scanner that works in one proxy mode and 404s in the other.
  const SCANNER = ['vendor/ort.mjs', 'vendor/ort.proxied.mjs', 'vendor/cube-yolo.onnx', 'vendor/misread-worker.js'];
  const absentScanner = new Set(SCANNER.filter((f) => !existsSync(join(dist, f))));
  // The runtime's own assets, DERIVED FROM THE SHIPPED LOADER rather than from a filename shape.
  //
  // onnxruntime picks its binary inside its own worker, so which variant it wants is not knowable
  // from here — but the loader in dist/ names exactly the ones it can request, and it is right
  // there to be read. That is what makes this check neither vacuous nor over-strict, and it is
  // what the old pair of `ort-wasm-simd-threaded.*.wasm` scans could not be: they asserted the
  // BINARY and never the `.mjs` glue beside it (a missing glue file is a scanner that cannot
  // start), and their expectation came from vendor/, so an unrelated variant sitting there passed
  // both while the loader asked for a file nobody had copied.
  if (!absentScanner.size) {
    const named = ortAssetsNamedBy(readFileSync(join(dist, 'vendor', 'ort.mjs'), 'utf8'));
    // Loud rather than trivially green: a loader that names none of its assets means onnxruntime
    // has changed how it fetches them, and this check would otherwise silently verify nothing.
    if (!named.length) absentScanner.add('vendor/ort.mjs names no ort-wasm-* runtime asset (has onnxruntime-web changed?)');
    for (const f of named) if (!existsSync(join(dist, 'vendor', f))) absentScanner.add(`vendor/${f}`);
    // And the other direction, one grammar: everything copy-ort published into vendor/ must
    // survive the copy into dist/. The loader-derived set above cannot see a file the filter
    // dropped on the way in if the loader never names it, and vendor/ is what actually ships.
    for (const f of readdirSync(join(root, 'vendor')).filter(isOrtAsset)) {
      if (!existsSync(join(dist, 'vendor', f))) absentScanner.add(`vendor/${f}`);
    }
  }
  if (absentScanner.size) {
    throw new Error(
      `build: dist/ is missing vendored scanner files:\n  ${[...absentScanner].join('\n  ')}\n` +
        '  Run `pnpm --filter cubus-web copy-ort` first — without these the app loads but cannot scan.',
    );
  }
}

/** The bundle must be newer than every source that went into it. */
function assertBundleFresh(root) {
  // The esbuild bundle must be newer than its source, or beforeBuildCommand ran
  // out of order and we would ship a stale renderer that still looks fine.
  //
  // Compare the SOURCE tree, never the copies in dist/: cpSync does not preserve
  // timestamps, so a copied file always looks freshly modified and the comparison
  // could never fail. That mistake made this check decorative until a negative
  // test (touch the source, expect a throw) caught it returning success.
  //
  // EVERY INPUT, not just the entry. lib/cube-frame.js is bundled into vendor/cubus-cube.js — it
  // is where the silhouette and the camera fit live — so editing it and shipping without a
  // rebuild passed this check while dist/ carried a renderer that behaves differently from its
  // source. That is the same defect the check exists for, one import away from where it looked.
  const built = statSync(join(root, 'vendor', 'cubus-cube.js')).mtimeMs;
  const newer = bundleInputs(join(root, 'lib', 'cubus-cube.js'))
    .filter((f) => statSync(f).mtimeMs > built)
    .map((f) => posix(root, f));
  if (newer.length) {
    throw new Error(
      `build: vendor/cubus-cube.js is older than ${newer.join(', ')} — run build:cube first`,
    );
  }
}

/**
 * Assemble a dist directory from `root` (apps/web). Throws on anything missing
 * or stale, so a bad assembly is a failed build and never a blank window.
 *
 * A SEQUENCE of named stages since 2026-09-05, each of which owns one question and its reasons:
 * the copy, the assets the page names, the two chains no page names, and the freshness of the
 * bundle. They ran here as one body, which made the order look like a detail rather than the
 * contract it is — nothing may be checked before the copy that produces it.
 *
 * @param {{ root?: string, dist?: string, freshness?: boolean }} [o]
 *   `freshness` (default on) is the bundle-newer-than-source check at the end: the CLI's
 *   guarantee that beforeBuildCommand ran its steps in order. A test of what dist CONTAINS
 *   turns it off, because a working tree with an edited source and a not-yet-rebuilt bundle is
 *   the ordinary state mid-change, and vendor-bundles.test.mjs already fails that state by
 *   comparing content — which is the better message for it.
 * @returns {{ dist: string, referenced: number }}
 */
export function assembleDist({ root = here, dist = join(root, 'dist'), freshness = true } = {}) {
  // Absolute from here down, so "is the destination inside the source" is a question about paths
  // rather than about whoever's cwd this ran under.
  const src = resolve(root);
  const out = resolve(dist);
  assertDistIsDisposable(src, out);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  copyWebAssets(src, out);
  const referenced = assertReferencedAssets(out);
  assertSolverAssets(out);
  assertScannerAssets(src, out);
  if (freshness) assertBundleFresh(src);
  return { dist: out, referenced };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { referenced } = assembleDist();
  console.log(`build: dist/ assembled — ${referenced} referenced assets verified present`);
}
