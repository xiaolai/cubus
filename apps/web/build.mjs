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

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import path, { basename, join, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// The same bundler that BUILDS vendor/cubus-cube.js, asked which files went into it. It is
// already required here: tauri.conf.json's beforeBuildCommand runs `build:cube` (esbuild) two
// steps before this file, so a tree that can reach build.mjs can reach esbuild.
import { buildSync } from 'esbuild';

import { isOwnedAsset, ownedAssetsIn } from './copy-ort.mjs';

const here = dirname(fileURLToPath(import.meta.url));

// Whole directories, so a new import never silently misses the bundle. lib/ is
// source (app.js and its siblings load as ES modules directly); vendor/ is
// esbuild output plus the onnxruntime wasm and the detector model; notices/ is
// ONNX Runtime's own third-party notices, which THIRD_PARTY_NOTICES.md links.
export const DIRS = ['lib', 'vendor', 'icons', 'notices'];
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

/**
 * Where the renderer's source lives, named from this app's root.
 *
 * It is not under `lib/` any more — `<cubus-cube>` is `packages/cubus-cube/` since 2026-09-14 —
 * and the bundle it produces still lands in this app's `vendor/`. A constant rather than an
 * inline join, because the disposability guard and the freshness check both have to know, and a
 * stale copy of this path would make it check nothing while staying green.
 */
const CUBE_ENTRY = '../../packages/cubus-cube/src/cubus-cube.js';

/**
 * The scanner package's manifest, named from this app's root: where the bundles it builds into
 * this app's `vendor/` are declared. The scanner check reads its registry from there
 * (`scannerBundles`), so a worker the package starts building is guarded here the day its build
 * script lands, with nothing to remember.
 */
const SCANNER_MANIFEST = '../../packages/cube-scanner/package.json';

/**
 * The bundles the scanner package builds into this app's `vendor/`, read off its build scripts —
 * `{ file, script }`: the path as dist/ names it, and the `pnpm --filter cube-scanner <script>`
 * that produces it.
 *
 * ONE REGISTRY (audit-fix, 2026-09-21). The scanner reaches each worker by a URL computed from its
 * own bundle (`new URL('./letterbox-worker.js', import.meta.url)`), so no HTML names them and the
 * reference scan cannot see them; this check listed them by hand, and vendor-bundles.test.mjs
 * derived the same set from these scripts — two registries, and the letterbox worker joined the
 * repo with only one of them knowing. The build script is where a bundle's name is actually
 * decided, so it is what both read now. Loud when it names none: a manifest whose scripts stopped
 * spelling `--outfile=…vendor/` is a check that would otherwise verify nothing.
 */
export function scannerBundles(manifest) {
  if (!existsSync(manifest)) {
    throw new Error(`build: the scanner package's manifest is not at ${manifest} — SCANNER_MANIFEST is out of date`);
  }
  const scripts = JSON.parse(readFileSync(manifest, 'utf8')).scripts ?? {};
  const bundles = Object.entries(scripts).flatMap(([script, cmd]) => {
    const m = /--outfile=\S*?vendor\/([\w.-]+\.js)/.exec(String(cmd));
    return m ? [{ file: `vendor/${m[1]}`, script }] : [];
  });
  if (!bundles.length) {
    throw new Error(`build: ${manifest} declares no build script that writes into vendor/ — has the scanner's build moved?`);
  }
  return bundles;
}


// ONE grammar for the onnxruntime assets, used for BOTH directions of the scanner check below —
// what the shipped loader NAMES (`ownedAssetsIn`), and what vendor/ HOLDS (`isOwnedAsset`). It is
// copy-ort.mjs's own, IMPORTED: this file used to carry a second spelling of it that a test held
// equal to the first by comparing their source text. That was the same rule written twice and
// agreeing by hand, which is how it broke before — this file once spelled it
// `ort-wasm-simd-threaded.*.wasm` in two places, so the `.mjs` glue the loader fetches beside the
// binary was never checked at all.

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

/**
 * Filesystem identity — the (device, inode) pair a path names, or null when nothing is there.
 *
 * ASKED OF THE FILESYSTEM, not of two strings (2026-09-05). The guard below used to compare paths
 * lexically, which answers a question about SPELLING when the delete is about a DIRECTORY, and a
 * filesystem hands out more than one name for the same one. An audit walked straight through it
 * with an equivalent path and reached the deletion call.
 *
 * Realpath does not close that door, which is why this is dev/ino and not a canonical string:
 * macOS stitches its read-only system volume to the data volume with FIRMLINKS, so `/Users/x` and
 * `/System/Volumes/Data/Users/x` are one directory — and a firmlink is a mount, not a symlink, so
 * `realpathSync.native` returns the second spelling exactly as it was given (measured; pinned by
 * dist-contents.test.mjs, which asserts both halves). The dev/ino pair is what the two spellings
 * actually share, and taking it closes the symlink and case-insensitive-volume doors in the same
 * move rather than one door at a time.
 *
 * ENOENT and ENOTDIR are the filesystem answering "nothing there". Anything else is an UNANSWERED
 * question about a path we are about to delete into, so it raises rather than reading as absent.
 */
const identity = (p) => {
  try {
    const s = statSync(p);
    return `${s.dev}:${s.ino}`;
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null;
    throw err;
  }
};

/** Add the identity of `start` and of every lexical parent above it to `ids`. */
const walkUp = (start, ids) => {
  for (let at = start; ; at = dirname(at)) {
    const id = identity(at);
    if (id) ids.add(id);
    if (dirname(at) === at) return ids;
  }
};

/**
 * `p` with every symlink in it resolved: its nearest existing ancestor through `realpath`, and the
 * components that do not exist yet appended as written.
 *
 * WHY BOTH WALKS. `identity()` stats through a symlink but `dirname()` steps up the path as TEXT,
 * so the lexical walk alone went from the target of a link straight to the link's own parent:
 * through `alias -> apps/web/lib/screens`, `alias/cube` visited `screens` and then `/tmp`, never
 * `lib` or the app root, and reached the recursive delete of a real source directory (found by
 * audit, 2026-09-14). The canonical walk closes that. The lexical one stays because realpath is not
 * the whole answer either — it does not resolve a macOS firmlink, which is why this guard compares
 * device and inode rather than strings at all. A destination is refused if EITHER walk reaches a
 * protected tree.
 */
const canonical = (p) => {
  const missing = [];
  for (let at = resolve(p); ;) {
    try {
      return join(realpathSync(at), ...missing);
    } catch (err) {
      if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') throw err;
      const up = dirname(at);
      if (up === at) return resolve(p);
      missing.unshift(basename(at));
      at = up;
    }
  }
};

/** Every directory that holds `p`, and `p` itself, as identities. A destination that does not
 *  exist yet contributes its nearest existing ancestor and everything above it — the parts that
 *  could already BE something; the missing leading components cannot be, and a delete does not
 *  touch them. */
const ancestry = (p) => walkUp(canonical(p), walkUp(p, new Set()));

/** Is `inner` the same directory as `outer`, or somewhere beneath it — however either is SPELLED?
 *  `outer` has to exist to be either: an identity is a thing that is there. A whole path component
 *  is still required and now by construction, so `.../dist2` is not beneath `.../dist`. */
const beneath = (inner, outer) => {
  const id = identity(outer);
  return id !== null && ancestry(inner).has(id);
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
 * The first version of this guard compared the paths as text, and a second audit walked through it
 * the same day by spelling the destination another way — the same directory reached through a
 * firmlink. `beneath` asks the filesystem now, so a destination is refused for BEING one of these
 * trees rather than for being written like one.
 *
 * Named and thrown from here rather than inlined, because the order is the contract — this must
 * be the thing that happens before the delete, not beside it.
 */
function assertDistIsDisposable(src, out, entry) {
  if (beneath(src, out)) {
    throw new Error(
      `build: refusing to assemble into ${out} — it is the source tree ${src} (or holds it), and the first thing an assembly does is delete its destination`,
    );
  }
  // BOTH DIRECTIONS, because a recursive delete destroys everything on either side of the relation.
  // This asked only whether the destination sits inside a copied tree; a copied tree sitting inside the
  // DESTINATION is destroyed just as thoroughly, and a symlink is how that happens without anyone
  // spelling it: with `apps/web/vendor` linked to `/assets/vendor`, `assembleDist({ dist: '/assets' })`
  // passed every check and deleted the vendor tree it was about to copy (Codex audit, 2026-09-16). The
  // renderer guard below has asked both ways since it was written; this is the same question.
  for (const p of [...DIRS, ...FILES]) {
    const copied = join(src, p);
    if (beneath(out, copied)) {
      throw new Error(
        `build: refusing to assemble into ${out} — it is ${posix(src, copied)}, which the assembly copies FROM, and the destination is deleted first`,
      );
    }
    if (beneath(copied, out)) {
      throw new Error(
        `build: refusing to assemble into ${out} — it holds ${posix(src, copied)}, which the assembly copies FROM, and the destination is deleted first`,
      );
    }
  }
  // AND THE RENDERER, which stopped being inside `src` when it became its own package
  // (packages/cubus-cube, 2026-09-14). Everything above asks whether the destination is this app
  // or something this app copies from; the renderer's SOURCE is neither, so `assembleDist({ dist:
  // 'packages/cubus-cube' })` walked straight past every guard to the recursive delete, and the
  // freshness check that would have noticed runs afterwards (found by audit, 2026-09-14).
  //
  // `entry` is the ONE resolved renderer entry this assembly uses, handed in by assembleDist. This
  // guard used to name its own from CUBE_ENTRY while the freshness check honoured a caller's
  // `cubeEntry`, so a caller that supplied one had its renderer checked for freshness and the
  // default protected from deletion — two halves of one change describing different directories
  // (found by audit, 2026-09-14).
  const renderer = dirname(dirname(entry));
  if (beneath(out, renderer) || beneath(renderer, out)) {
    throw new Error(
      `build: refusing to assemble into ${out} — it is the renderer package at ${renderer} (or holds it), whose source this build is built from, and the destination is deleted first`,
    );
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

/**
 * Where a reference resolves, INSIDE dist/ — or why it does not: `{ where }` for a path beneath
 * dist/ that is either absent or really there; `{ escapes }` for one that leaves it.
 *
 * Confined both ways (audit-fix, 2026-09-21). Lexically, so `../package.json` is refused rather
 * than found wherever the checkout happens to keep one — the guarantee this function makes is that
 * every asset the page names is IN the folder Tauri bundles, and a reference that resolves outside
 * it passed whenever the file existed there. And through the filesystem, so a symlink inside dist/
 * whose target is outside it is refused too: `cpSync` copies a link as a link, and one that was
 * relative in vendor/ comes out pointing back into the SOURCE tree, where the file is — until the
 * app is installed somewhere the source tree is not.
 */
function locateInDist(dist, ref) {
  const where = resolve(dist, ref);
  const rel = relative(dist, where);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return { escapes: `${ref} → ${where}` };
  if (!existsSync(where)) return { where };
  const real = realpathSync(where);
  const inside = relative(realpathSync(dist), real);
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) return { escapes: `${ref} → ${real} (through a link)` };
  return { where };
}

/** Every asset index.html and the manifest NAME must resolve inside dist/. Returns how many were
 *  checked, which is what the CLI prints. */
function assertReferencedAssets(dist) {
  // Assert every asset the app actually references resolves inside dist. A copy
  // step that quietly drops a file looks exactly like one that worked, and the
  // failure would surface only as a blank window in a packaged app.
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  // EVERY LOCAL REFERENCE, however it is spelt. This matched one spelling — double quotes and a leading
  // `./` — so `src='./app.js'` and `src="app.js"` were skipped in silence, and a dist missing either
  // passed the check that exists to catch exactly that (Codex audit, 2026-09-16). Then it matched
  // quoted values in lower case only, so `SRC=lib/app.js` — valid HTML — was skipped the same way,
  // while `data-src=` was read as a reference (audit-fix, 2026-09-21): the attribute is matched
  // whole — an attribute name begins after WHITESPACE in a tag, so `data-src=` and `foo:src=` are
  // no reference (a lookbehind for "not a word character" let the colon through; verification of
  // the audit fix, 2026-09-21) — in either case, quoted or bare. What is skipped is said
  // out loud: a remote URL, a data URI and an in-page anchor are not files this build copies.
  const referenced = new Set(
    [...html.matchAll(/(?<=\s)(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi)]
      .map((m) => (m[1] ?? m[2] ?? m[3]).trim())
      .filter((url) => url && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(url))
      .map((url) => url.replace(/^\.\//, '').replace(/[?#].*$/, '')),
  );
  for (const icon of JSON.parse(readFileSync(join(dist, 'manifest.webmanifest'), 'utf8')).icons ?? []) {
    referenced.add(icon.src.replace(/^\.\//, ''));
  }

  const located = [...referenced].map((r) => [r, locateInDist(dist, r)]);
  const escapes = located.flatMap(([, at]) => (at.escapes ? [at.escapes] : []));
  if (escapes.length) {
    throw new Error(`build: index.html references assets outside dist/, which a packaged app cannot reach:\n  ${escapes.join('\n  ')}`);
  }
  const missing = located.flatMap(([r, at]) => (existsSync(at.where) ? [] : [r]));
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
    'lib/cube-layout.js',
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

/** What puts each kind of scanner asset back, and what its absence costs — one line per KIND, so
 *  a missing worker is not told to run `copy-ort`, which cannot build one (audit-fix, 2026-09-21).
 *  A missing worker is not a scanner that cannot scan: the panel falls back to the page's thread
 *  for the work the worker exists to move off it, which is a performance regression this build
 *  refuses to ship rather than a blank screen. */
const SCANNER_REMEDY = {
  runtime: 'Run `pnpm --filter cubus-web copy-ort` — without the onnxruntime loader and its assets the app loads but cannot scan.',
  model: 'vendor/cubedet.onnx is committed: restore it from the repository, or re-export it (ml/export.py) — without the model the app loads but cannot scan.',
  panel: (script) => `Run \`pnpm --filter cube-scanner ${script}\` — without the panel bundle the app loads but cannot scan.`,
  worker: (script) => `Run \`pnpm --filter cube-scanner ${script}\` — without this worker the scanner still runs, but falls back to the page's thread for the work the worker moves off it: a performance regression this build refuses to ship.`,
};

/** The scanner's runtime, which no HTML names either — and whose set is derived from the SHIPPED
 *  loader and from the scanner's own build scripts, never from a list kept here. */
function assertScannerAssets(root, dist, manifest) {
  // Same problem, the scanner's half. ort.mjs is reached by a COMPUTED url (`${wasmPaths}ort.mjs`),
  // the .wasm by onnxruntime from its own import.meta.url, and the model by an attribute the panel
  // reads — so none of them appears in index.html and the scan above is blind to all three. They are
  // gitignored too, so a checkout that skips `pnpm copy-ort` builds a dist/ that looks complete and
  // silently cannot scan.
  //
  // ort.mjs in particular must stay a SEPARATE file: onnxruntime spawns its inference worker from
  // its own import.meta.url, so bundling it into the panel puts inference back on the main thread.
  //
  // ort.proxied.mjs is the SAME loader under its second name — the identity onnxruntime needs for
  // the proxied wasm instance where a query string cannot serve it (a Tauri asset protocol; see
  // copy-ort.mjs). It is published with ort.mjs and it is fetched at runtime, so a dist/ carrying
  // one and not the other is a scanner that works in one proxy mode and 404s in the other.
  //
  // And every bundle the scanner package builds into vendor/ (`scannerBundles`): the panel, and the
  // workers the panel reaches by URLs computed from its own bundle (`new URL('./misread-worker.js',
  // import.meta.url)`; the letterbox worker since 2026-09-20) — in no HTML either, and their
  // absence degrades QUIETLY, back to the three-second main-thread decode and the 14 ms-a-tick
  // letterbox they exist to move off the page. They are committed rather than generated, so this
  // catches a dist/ assembled before their build ever ran. Read off the build scripts rather than
  // listed here, because listed here they drifted: the letterbox worker joined with only the test's
  // registry knowing (audit-fix, 2026-09-21).
  /** What is absent, by the kind of remedy it needs. */
  const absent = new Map();
  const miss = (file, kind, script = null) => absent.set(file, { kind, script });
  for (const f of ['vendor/ort.mjs', 'vendor/ort.proxied.mjs']) if (!existsSync(join(dist, f))) miss(f, 'runtime');
  if (!existsSync(join(dist, 'vendor/cubedet.onnx'))) miss('vendor/cubedet.onnx', 'model');
  for (const { file, script } of scannerBundles(manifest)) {
    if (!existsSync(join(dist, file))) miss(file, file.endsWith('-worker.js') ? 'worker' : 'panel', script);
  }
  // The runtime's own assets, DERIVED FROM THE SHIPPED LOADER rather than from a filename shape.
  //
  // onnxruntime picks its binary inside its own worker, so which variant it wants is not knowable
  // from here — but the loader in dist/ names exactly the ones it can request, and it is right
  // there to be read. That is what makes this check neither vacuous nor over-strict, and it is
  // what the old pair of `ort-wasm-simd-threaded.*.wasm` scans could not be: they asserted the
  // BINARY and never the `.mjs` glue beside it (a missing glue file is a scanner that cannot
  // start), and their expectation came from vendor/, so an unrelated variant sitting there passed
  // both while the loader asked for a file nobody had copied.
  if (existsSync(join(dist, 'vendor', 'ort.mjs'))) {
    const named = ownedAssetsIn(readFileSync(join(dist, 'vendor', 'ort.mjs'), 'utf8'));
    // Loud rather than trivially green: a loader that names none of its assets means onnxruntime
    // has changed how it fetches them, and this check would otherwise silently verify nothing.
    if (!named.length) miss('vendor/ort.mjs names no ort-wasm-* runtime asset (has onnxruntime-web changed?)', 'runtime');
    for (const f of named) if (!existsSync(join(dist, 'vendor', f))) miss(`vendor/${f}`, 'runtime');
    // And the other direction, one grammar: everything copy-ort published into vendor/ must
    // survive the copy into dist/. The loader-derived set above cannot see a file the filter
    // dropped on the way in if the loader never names it, and vendor/ is what actually ships.
    for (const f of readdirSync(join(root, 'vendor')).filter(isOwnedAsset)) {
      if (!existsSync(join(dist, 'vendor', f))) miss(`vendor/${f}`, 'runtime');
    }
  }
  if (absent.size) {
    const lines = [...absent].map(([file, { kind, script }]) => {
      const remedy = SCANNER_REMEDY[kind];
      return `${file}\n    ${typeof remedy === 'function' ? remedy(script) : remedy}`;
    });
    throw new Error(`build: dist/ is missing vendored scanner files:\n  ${lines.join('\n  ')}`);
  }
}

/** The bundle must be newer than every source that went into it. */
/**
 * Every scanner bundle in dist/ is byte-for-byte what its build script produces from the sources
 * as they are now (audit-fix 2026-09-21, finding 9). The check above asks whether a bundle is NEWER
 * than its sources, which on a fresh checkout (every mtime is checkout time) says nothing — so the
 * scanner's bundles, which are committed and reached by computed URLs no page names, could be
 * packaged stale by a direct `build:dist` while every existence check passed. Rebuilt here in
 * memory, with the same entry and flags the script names, and compared: a difference is a stale
 * commit or a script that no longer builds what is shipped, and either is a refused dist.
 *
 * @param {string} dist the assembled dist
 * @param {string} manifest the scanner package's package.json (its build scripts are the registry)
 * @param {(o: import('esbuild').BuildOptions) => string} [build] the in-memory bundler — a seam for
 *   the tests, which cannot afford an esbuild run per case
 */
export function assertScannerBundlesFresh(dist, manifest, build = (o) => buildSync(o).outputFiles[0].text) {
  const scannerDir = dirname(manifest);
  const scripts = JSON.parse(readFileSync(manifest, 'utf8')).scripts ?? {};
  const stale = [];
  for (const { file, script } of scannerBundles(manifest)) {
    const words = String(scripts[script]).split('&&')[0].trim().split(/\s+/);
    if (words[0] !== 'esbuild') throw new Error(`build: ${script} is not a plain esbuild command, so its output cannot be rebuilt here`);
    const entry = words.slice(1).find((w) => !w.startsWith('-'));
    const flag = (name) => words.find((w) => w.startsWith(`--${name}=`))?.slice(name.length + 3);
    const fresh = build({
      absWorkingDir: scannerDir, entryPoints: [entry], bundle: true, write: false, logLevel: 'silent',
      format: flag('format'), target: flag('target'), legalComments: flag('legal-comments'),
    });
    const shipped = readFileSync(join(dist, file), 'utf8');
    if (shipped !== fresh) stale.push(`${file} (rebuild it with \`pnpm --filter cube-scanner ${script}\` and commit)`);
  }
  if (stale.length) throw new Error(`build: a scanner bundle in dist/ is not what its sources build now — ${stale.join('; ')}`);
}

function assertBundleFresh(root, entry) {
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
  // Loud when the entry is not there: the renderer moved out of this package once, and a check
  // pointed at a file that no longer exists is a check that passes for the wrong reason.
  if (!existsSync(entry)) {
    throw new Error(`build: the renderer's entry is not at ${entry} — CUBE_ENTRY is out of date`);
  }
  const built = statSync(join(root, 'vendor', 'cubus-cube.js')).mtimeMs;
  const newer = bundleInputs(entry)
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
 * @param {{ root?: string, dist?: string, freshness?: boolean, cubeEntry?: string, scannerManifest?: string, scannerBuild?: (o: import('esbuild').BuildOptions) => string }} [o]
 *   `cubeEntry` is the renderer's source entry, defaulting to the package beside this one. A
 *   parameter because the dist tests assemble a synthetic root and need an entry inside it.
 *   `scannerManifest` is the scanner package's package.json, whose build scripts say which
 *   bundles it puts in vendor/ (`scannerBundles`); a parameter for the same reason.
 *   `freshness` (default on) is the bundle-newer-than-source check at the end: the CLI's
 *   guarantee that beforeBuildCommand ran its steps in order. A test of what dist CONTAINS
 *   turns it off, because a working tree with an edited source and a not-yet-rebuilt bundle is
 *   the ordinary state mid-change, and vendor-bundles.test.mjs already fails that state by
 *   comparing content — which is the better message for it.
 * @returns {{ dist: string, referenced: number }}
 */
export function assembleDist({ root = here, dist = join(root, 'dist'), freshness = true, cubeEntry, scannerManifest, scannerBuild } = {}) {
  // Absolute from here down, so "is the destination inside the source" is a question about
  // directories rather than about whoever's cwd this ran under — and so the walk up to the
  // filesystem root that answers it has a root to reach: `dirname` on a relative path stops at
  // '.', which would hide every real ancestor from the guard.
  const src = resolve(root);
  const out = resolve(dist);
  // Resolved once, before anything is deleted, and handed to BOTH checks that need it.
  const entry = cubeEntry ? resolve(cubeEntry) : resolve(src, CUBE_ENTRY);
  const manifest = scannerManifest ? resolve(scannerManifest) : resolve(src, SCANNER_MANIFEST);
  assertDistIsDisposable(src, out, entry);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  copyWebAssets(src, out);
  const referenced = assertReferencedAssets(out);
  assertSolverAssets(out);
  assertScannerAssets(src, out, manifest);
  if (freshness) {
    assertBundleFresh(src, entry);
    // `scannerBuild` is the in-memory bundler seam `assertScannerBundlesFresh` documents.
    assertScannerBundlesFresh(out, manifest, scannerBuild);
  }
  return { dist: out, referenced };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { referenced } = assembleDist();
  console.log(`build: dist/ assembled — ${referenced} referenced assets verified present`);
}
