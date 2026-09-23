// The renderer ships as a bundle, so editing the source is only half of a change.
//
// packages/cubus-cube/src/cubus-cube.js is bundled to apps/web/vendor/cubus-cube.js, and
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
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Every (source, bundle) pair the repo builds. Adding one here is what makes it guarded.
const BUNDLES = [
  {
    name: 'cubus-cube',
    build: 'pnpm --filter cubus-cube build',
    bundle: '../vendor/cubus-cube.js',
    // The entry is its own package since 2026-09-14; the four it imports are cube DOMAIN and stay
    // in this app, where browser-loaded modules reach them by relative path.
    sources: [
      '../../../packages/cubus-cube/src/cubus-cube.js', '../lib/cube-frame.js',
      '../lib/cube-highlight.js', '../lib/cube-orientation.js', '../lib/sticker-palettes.js',
      // What a MARK on the cube is coloured in, beside the table for what a sticker is coloured in, and
      // in this app for the same reason: the arrow's ink has to be chosen against the stickers and against
      // the plastic, and a table in the renderer's package could not be measured against either.
      '../lib/annotation-inks.js',
      // Where a cubie IS, since the renderer stopped keeping that in its scene graph — and
      // cube-pieces with it, because the pose is arithmetic over the piece model. So the model
      // this repository publishes as its API is now IN the bundle it draws with, which is the
      // whole point of A1: one implementation, not two.
      '../../../packages/cubus-cube/src/pose.js', '../lib/cube-pieces.js',
      // The notation it reads `alg` through, and the interpreter whose face-turn arithmetic the pose
      // runs (dev-docs/tutorial-capability-plan.md items 2.1 and 2.2): the model the tutorials are
      // tested against is the one the element draws with.
      '../lib/cube-notation.js', '../lib/cube-moves.js',
      // The facelet layout, which the piece model reads to write a state as stickers (`toFacelets`).
      '../lib/cube-layout.js',
    ],
    // The renderer imports three of cube-orientation.js's exports (isFace, orientationMatrix,
    // sameAxis); esbuild drops the rest, and the messages inside them. Same delete-when-used
    // contract as the panel's list below.
    //
    // And from cube-pieces.js the pose needs four — CORNERS, EDGES, MOVES, applyMove — so the
    // solver-facing half of the piece model is dropped. That list being LONG is the point: the
    // renderer takes the model's move tables and none of its searching, and an entry that stops
    // being tree-shaken means the bundle just grew a dependency nobody asked for.
    treeShaken: [
      'orientationPerm', 'orientationRelabel', 'permCache', 'turnFacelets',
      'Y_FACES', 'allSolved', 'applyAlg', 'cornerSlot', 'cornerSolved', 'edgeSlot', 'edgeSolved',
      'fromCube', 'moveCount', 'movesOf', 'rotateAlg', 'rotateState',
      // `everyIndex` serves `pieceStateError`, which is itself shaken out: the element is handed a painted
      // string and never validates a piece state. `composited` answers what a mark LOOKS like over a
      // surface, which only the measuring test asks — the renderer states the colours and the alphas and
      // lets the compositor do the mixing.
      'everyIndex', 'composited',
      // From the interpreter the element takes the face-turn arithmetic of an identity-frame move
      // (`faceTurnsOf`, `turnPieces`) and none of the HOLD: reading a child's letters in a hold is the
      // host's job, and the element is handed identity tokens (ADR 0004 decision 7). From the notation it
      // takes `readToken` and not the formatter.
      'SELECTOR', 'applyIdentity', 'checkHold', 'convertSelectors', 'heldFace', 'holdOfRows',
      'identityFace', 'toIdentity', 'tokenOf', 'turnVector', 'formatMoves',
      // Naming an identity move for a hold, and a walk's moves as face turns (plan item 6.1), are the
      // display's and the method's: the element draws identity tokens and names nothing.
      'faceTurnsAlg', 'heldMove', 'heldToken', 'relabelSelectors',
      // Writing a state back out as 54 stickers is the app's and the script player's question; the
      // renderer is handed the string it paints, so `toFacelets` goes. The layout TABLES it reads stay in
      // the bundle — esbuild cannot prove a frozen, mapped array free of side effects — and are guarded
      // as the declarations they are.
      'toFacelets',
      // The renderer resolves both channels to STICKERS (plan item 4.1), so the cubie-level resolver — kept
      // for the script view and the kit — and its sticker test are not in the bundle.
      'resolveHighlight', 'isSticker',
      // Whether four arrays are a well-formed piece state is asked by the app's readers and validators
      // (2026-09-16): the element is handed a state the host has already read, and reads no cube of its
      // own. (`inverseOf` is NOT here — `rotateState` builds its `Y_INVERSE` from it at module scope, so
      // it rides into the bundle as a declaration that survived.)
      'pieceStateError',
    ],
    treeShakenMessages: [
      'cube-orientation: sticker', 'cube-orientation: rotation is not a bijection',
      'relabelling is not a bijection', 'cube-orientation: expected 54 facelets, got',
      'cube-moves: a hold is [up, front]', 'cube-moves: no token for axis', 'quarter turns is not an amount',
      // The piece-state validator's refusals go with the validator.
      'must be an array of', 'must be whole numbers 0 to', 'names one cubie twice',
      'expected a piece state of',
    ],
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
      '../../../packages/cube-scanner/src/scheme.ts',
      '../../../packages/cube-scanner/src/types.ts',
      // The misread decode's client half: the panel spawns the worker below and falls back to
      // running the decode here when a page has no `Worker`, so both halves ship in this bundle.
      '../../../packages/cube-scanner/view/misread-client.ts',
      '../../../packages/cube-scanner/view/misread-protocol.ts',
      // The centre resolution's client half, for the same reason (D3, 2026-09-23): the panel spawns
      // the worker below and falls back to resolving here when a page has no `Worker`.
      '../../../packages/cube-scanner/view/centres-client.ts',
      '../../../packages/cube-scanner/view/centres-protocol.ts',
      // The session recorder (D9, 2026-09-23), off unless `localStorage.cubusScanRecord` is '1':
      // the scan trace could never become a replayable fixture, so a bug report could not become a
      // test. It ships in the panel because the panel is what sees the frames.
      '../../../packages/cube-scanner/view/session-recorder.ts',
      '../../../packages/cube-scanner/src/session-record.ts',
      // The colour repair, which arrived with the permissive detector: the constraint a cube's
      // paint satisfies (`nine-of-each`), the pixels a sticker actually carries, read at the one
      // moment a frame and a fitted grid are both in hand (`sticker-pixels`), and the question
      // that survives an unknown illuminant — which stickers share paint, asked only after the
      // scores have been refused (`paint-groups`). All three decide what the app may CLAIM about a
      // scan, which is the reason misread-decode.ts is on this list too.
      '../../../packages/cube-scanner/src/nine-of-each.ts',
      '../../../packages/cube-scanner/src/paint-groups.ts',
      '../../../packages/cube-scanner/src/sticker-pixels.ts',
      // The scan trace (2026-09-18), switched on by `localStorage.cubusScanTrace = '1'` and silent
      // otherwise. It ships in the bundle dormant; guarded like any other source, because a trace
      // edited and not rebuilt would describe the scan with code the scan no longer runs.
      '../../../packages/cube-scanner/src/fit-trace.ts',
      '../../../packages/cube-scanner/view/scan-trace.ts',
      // The letterbox, forward and back (2026-09-19): `preprocess` fits a picture into the model's
      // square with it, and `ScanProgress.seen` places each box back in the picture with the same
      // arithmetic — so a bundle built before an edit to it would place stickers somewhere else.
      '../../../packages/cube-scanner/src/letterbox.ts',
      // The letterbox's client half and its wire (2026-09-20): the detector hands each frame to
      // `letterbox-worker.js` through these, and runs the letterbox here when a page has no worker,
      // so both halves ship in this bundle — as the misread decoder's do.
      '../../../packages/cube-scanner/view/letterbox-client.ts',
      '../../../packages/cube-scanner/view/letterbox-protocol.ts',
      // The model's client half and its wire (2026-09-22): the detector loads the model into
      // `inference-worker.js` through these, and on the page's thread where a page has no worker,
      // so both halves ship here as the letterbox's do. `detect-head.ts` is the output shape both
      // this bundle and the worker hold a model to.
      '../../../packages/cube-scanner/view/inference-client.ts',
      '../../../packages/cube-scanner/view/inference-protocol.ts',
      '../../../packages/cube-scanner/src/detect-head.ts',
    ],
    // Exported from the package entry and used by its tests, but never by the panel — so esbuild
    // drops them and their absence is correct, not stale. Listed rather than silently ignored: if
    // the panel ever starts using one, delete it here and the guard covers it again.
    // `detectFace` is the composed preprocess→run→fit convenience the package entry offers and the
    // tests exercise; the panel drives the two halves through a `Detector`, so esbuild drops it.
    // `COLOUR_NAMES` was listed here until 2026-09-18, when the scan trace began naming colours in
    // its summary ("white", not "class 0") and so began importing it. Removed, as this comment asks,
    // so the guard now covers it like any other name the panel uses.
    // `fitFromOutput` joined on 2026-09-18: the panel now decodes a frame once with
    // `detectionsFromOutput` and hands the same boxes to `fitFace` and the scan trace, so
    // it no longer calls the composed form. The package entry and its tests still use it.
    // `setChainTimeoutForTests` (2026-09-20) is the runtime's one test-only export — the knob that
    // shortens the run-chain timeout so a hung inference can be reproduced in seconds — and the
    // panel never calls it.
    // `latticeOf` (2026-09-21) is the lattice-only view the package entry and the tests read; the
    // panel reads `fitLattice`, which carries the refusal's reason, so esbuild drops the view.
    // …and every READER in session-record.ts (2026-09-23): the panel RECORDS, and parsing a
    // recording is the corpus scripts' and the tests' job, so `parseSession` and its helpers are
    // dropped along with every refusal message they carry. What survives is the two constants the
    // recorder needs — `NEAR_FLOOR_RECORD` and `SESSION_SCHEMA` — which is the whole of what
    // writing a session requires. Same delete-when-used contract as the rest of this list.
    treeShaken: [
      'SOLVED_FACELETS', 'encodeFacelets', 'detectFace', 'fitFromOutput',
      'setChainTimeoutForTests', 'latticeOf',
      'isRecord', 'num', 'parseConditions', 'parseDetection', 'parseFrame', 'parseTruth',
      'sessionDurationMs', 'sessionFps', 'sessionTicks',
    ],
    // encodeFacelets' refusal of a malformed state (2026-09-13) leaves with the function: the
    // message is in facelet-cube.ts and, correctly, nowhere in a bundle that never encodes. The
    // session reader's refusals leave with `parseSession`, for the same reason.
    treeShakenMessages: [
      'encodeFacelets: not a well-formed cube state',
      '.detections must be an array',
      '.facelets is not a well-formed cube',
      ".handling must be 'careful' or 'careless'",
      '.id must be an integer',
      ".scheme must be 'western' or 'japanese' when present",
      '.scores must list all',
      '.detail must be an object when present',
      'must be an ISO 8601 instant, got',
      '.served must be a whole number of ticks, at least 1',
      ".state must be 'scrambled' or 'near-solved'",
      'a session must be an object',
      'decisions must be an array',
      'detector measures the detector against itself',
      'does not increase on',
      'frames must be a non-empty array',
      'interpret it, and guessing would corrupt the measurement',
      'is not a decision kind',
      'is not a frame of this session',
      'model must be an object',
      'must be a finite number',
      'must be a non-empty string',
    ],
  },
  {
    // The misread decoder, on its own thread (2026-09-05). A refusal used to spend up to 3.0 s of
    // the page's thread proving how much of a scan was misread; the panel now publishes the
    // refusal at once and this answers the count afterwards. Its own entry because a worker is a
    // separate script by definition, and the panel reaches it by a same-origin URL beside itself
    // (`new URL('./misread-worker.js', import.meta.url)`), which nothing in index.html mentions —
    // so a stale or missing bundle here is invisible outside this guard and build.mjs's set.
    name: 'misread-worker',
    build: 'pnpm --filter cube-scanner build:misread-worker',
    bundle: '../vendor/misread-worker.js',
    // Every file esbuild puts in it, plus cubejs. Deliberately NOT misread-client.ts: the client's
    // spawn half is dropped here, and listing a source whose declarations are legitimately absent
    // is how a guard acquires an exception list that then goes off for every private method added.
    sources: [
      '../../../packages/cube-scanner/view/misread-worker.ts',
      '../../../packages/cube-scanner/view/misread-protocol.ts',
      '../../../packages/cube-scanner/src/misread-decode.ts',
      '../../../packages/cube-scanner/src/facelet-cube.ts',
      '../../../packages/cube-scanner/src/scheme.ts',
      '../../../packages/cube-scanner/src/types.ts',
    ],
    // The two facelet-cube exports the decoder never calls; same delete-when-used contract as the
    // panel's list above.
    // And scheme.ts, of which the decoder imports five exports (colourOf, colourOfSlot, positionOf,
    // SCHEMES, slotOf); esbuild drops the rest.
    treeShaken: [
      'SOLVED_FACELETS', 'encodeFacelets', 'COLOURS', 'COLOUR_NAMES', 'adjacentIn', 'commonNeighbours',
      'heldUpColour', 'holdOffset', 'isColour', 'neighbourColour', 'neighbourColours', 'schemeOfCentres',
    ],
    treeShakenMessages: ['encodeFacelets: not a well-formed cube state'],
  },
  {
    // The centre resolution, on its own thread (D3, 2026-09-23;
    // dev-docs/scan-pipeline-audit-2026-09-23.md §3). `resolveCentres` enumerates every way the
    // unnamed sides could fill the free slots and runs a whole assembly per filing — 26/54/148/509
    // ms for one to four unnamed sides on the dev Mac, all of it on the page's thread, at the
    // moment after the sixth capture when a child is waiting to be told the cube is done. Reached
    // exactly as the misread worker is, by a same-origin URL computed from the panel's own bundle
    // and named in no HTML, and it degrades the same way — quietly back to the page thread — which
    // is why it needs the same guard.
    name: 'centres-worker',
    build: 'pnpm --filter cube-scanner build:centres-worker',
    bundle: '../vendor/centres-worker.js',
    // Every file esbuild puts in it, plus cubejs. Deliberately NOT centres-client.ts: the client's
    // spawn half is dropped here, exactly as misread-client.ts is dropped from the misread worker.
    sources: [
      '../../../packages/cube-scanner/view/centres-worker.ts',
      '../../../packages/cube-scanner/view/centres-protocol.ts',
      '../../../packages/cube-scanner/src/ai-assemble.ts',
      '../../../packages/cube-scanner/src/facelet-cube.ts',
      '../../../packages/cube-scanner/src/misread-decode.ts',
      '../../../packages/cube-scanner/src/nine-of-each.ts',
      '../../../packages/cube-scanner/src/paint-groups.ts',
      '../../../packages/cube-scanner/src/scheme.ts',
      '../../../packages/cube-scanner/src/types.ts',
    ],
    // The worker's one entry is `resolveCentres`, so everything the PANEL reaches ai-assemble for
    // — the top-level assemblies, the side-recognition helpers the filing uses, the centre-owner
    // map — is dropped here, along with the two scheme exports only the panel calls. Same
    // delete-when-used contract as the lists above.
    treeShaken: [
      'SOLVED_FACELETS', 'encodeFacelets', 'MAX_REPAIR_COST', 'SAME_SIDE_BY_CENTRE',
      'SAME_SIDE_STICKERS', 'assembleColors', 'assemblePainted', 'buildCentreOwner', 'sameSide',
      'COLOUR_NAMES', 'schemeOfCentres',
    ],
    treeShakenMessages: [
      'encodeFacelets: not a well-formed cube state',
      'a sticker is not one of the six centre colours',
      'not a solvable cube yet',
    ],
  },
  {
    // The letterbox, on its own thread (2026-09-20; dev-docs/scanner-audit-2026-09-20.md §2.10).
    // `preprocess` on a 720p frame took 14 ms median of the page's thread on every tick, beside the
    // pixel readback it needs; the detector hands the worker an ImageBitmap and gets the tensor
    // back by transfer. Reached exactly as the misread worker is — a same-origin URL computed from
    // the panel's own bundle, in no HTML — and it degrades the same way, quietly back to the page
    // thread, which is why it needs the same guard.
    name: 'letterbox-worker',
    build: 'pnpm --filter cube-scanner build:letterbox-worker',
    bundle: '../vendor/letterbox-worker.js',
    // Every file esbuild puts in it — the letterbox and nothing else of the detector, which is why
    // `preprocess` lives in letterbox.ts and not beside the detect head. NOT letterbox-client.ts,
    // for the reason misread-client.ts is not listed above: the client is the page's half, and
    // none of it is in the worker.
    sources: [
      '../../../packages/cube-scanner/view/letterbox-worker.ts',
      '../../../packages/cube-scanner/view/letterbox-protocol.ts',
      '../../../packages/cube-scanner/src/letterbox.ts',
    ],
  },
  {
    // The detector's model, in a worker the page owns (2026-09-22). onnxruntime used to live on the
    // page (or in its own proxy worker), where nothing could give its memory back; hosted here, the
    // page releases it by terminating the worker. Reached exactly as the letterbox worker is — a
    // same-origin URL computed from the panel's own bundle, in no HTML — and it degrades the same
    // way, back to the page thread, which is why it needs the same guard.
    name: 'inference-worker',
    build: 'pnpm --filter cube-scanner build:inference-worker',
    bundle: '../vendor/inference-worker.js',
    // Every file esbuild puts in it: the runner, the wire, and the two leaf modules the runner takes
    // its constants from — `detect-head.ts` and `letterbox.ts`, and not `onnx-detect.ts`, whose
    // decoder has no business in a worker that only runs the model. NOT inference-client.ts: the
    // client is the page's half, and none of it is in the worker.
    sources: [
      '../../../packages/cube-scanner/view/inference-worker.ts',
      '../../../packages/cube-scanner/view/inference-protocol.ts',
      '../../../packages/cube-scanner/view/onnx-runtime.ts',
      '../../../packages/cube-scanner/src/detect-head.ts',
      '../../../packages/cube-scanner/src/letterbox.ts',
    ],
    // From letterbox.ts the runner takes `IMG_SIZE` and nothing else, so the letterbox itself is
    // dropped (its pad constant stays — esbuild keeps a top-level value — and is guarded as the
    // declaration it is); and the runtime's one test-only knob, which nothing in a worker calls.
    // Same delete-when-used contract as the lists above, messages included.
    treeShaken: ['letterboxOf', 'preprocess', 'validatedFrame', 'setChainTimeoutForTests'],
    treeShakenMessages: [
      'bytes, but this one holds',
      'is not a positive whole number of pixels',
      'preprocess: a frame of',
    ],
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

// The `sources` above are what the two checks below READ, so a file a bundle is built from that
// no list names is guarded by nothing: an edit to it ships in a stale bundle with every check
// green. Hand-kept, the lists had drifted for three bundles at once (found by audit, 2026-09-13),
// so esbuild is asked, from the build script that emits each bundle. A listed file esbuild drops
// (a type-only seam) is allowed; an unlisted one it keeps is not.
test('every repo file a bundle is built from is one its checks read', async () => {
  const { build } = await import('esbuild');
  const packages = [
    { dir: new URL('../', import.meta.url), json: '../package.json' },
    { dir: new URL('../../../packages/cube-scanner/', import.meta.url), json: '../../../packages/cube-scanner/package.json' },
    { dir: new URL('../../../packages/cubus-cube/', import.meta.url), json: '../../../packages/cubus-cube/package.json' },
  ];
  const here = fileURLToPath(new URL('./', import.meta.url));
  const unlisted = [];
  for (const b of BUNDLES) {
    const file = b.bundle.split('/').pop();
    const emitters = packages.flatMap(({ dir, json }) => Object.values(JSON.parse(read(json)).scripts ?? {})
      .map(String)
      .filter((cmd) => cmd.split(/\s+/).some((w) => w.startsWith('--outfile=') && w.endsWith(`vendor/${file}`)))
      .map((cmd) => ({ cwd: fileURLToPath(dir), cmd })));
    assert.equal(emitters.length, 1, `${b.name}: ${emitters.length} build scripts emit ${file}`);
    const words = emitters[0].cmd.split('&&')[0].trim().split(/\s+/);
    assert.equal(words[0], 'esbuild', `${b.name}: its build is not a plain esbuild command, so its inputs cannot be derived`);
    const flag = (name) => words.find((w) => w.startsWith(`--${name}=`))?.slice(name.length + 3);
    const { metafile } = await build({
      absWorkingDir: emitters[0].cwd,
      entryPoints: [words.slice(1).find((w) => !w.startsWith('-'))],
      bundle: true, write: false, metafile: true, logLevel: 'silent',
      format: flag('format'), target: flag('target'),
    });
    for (const input of Object.keys(metafile.inputs)) {
      if (input.includes('node_modules')) continue;
      const listed = relative(here, resolve(emitters[0].cwd, input)).split(sep).join('/');
      if (!b.sources.includes(listed)) unlisted.push(`${b.name}: ${listed}`);
    }
  }
  assert.deepEqual(unlisted.sort(), [], 'a bundle is built from a file its sources do not name, so nothing guards it');
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

  // The other half of "delete it here when it is used", which was a comment until plan item 3.2 found a
  // list naming three layout tables the bundle does carry: an entry that is not really dropped exempts a
  // live declaration from the check above, silently. So a name listed as tree-shaken must be ABSENT.
  test(`${b.name}: every name listed as tree-shaken really is absent from the bundle`, (t) => {
    if (b.optional && !existsSync(new URL(b.bundle, import.meta.url))) {
      t.skip(`${b.bundle} not built yet — run \`${b.build}\``);
      return;
    }
    const bundle = read(b.bundle);
    const kept = (b.treeShaken ?? []).filter((n) => new RegExp(`(?<![\\w$])${n}(?![\\w$])`).test(bundle));
    assert.deepEqual(kept, [], 'listed as tree-shaken and still in the bundle — remove it from the list so the guard covers it');
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
  const src = read('../../../packages/cubus-cube/src/cubus-cube.js');
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
  // Nor into the inference worker (2026-09-22), for the same reason one level down: onnxruntime
  // spawns its THREADS from its own `import.meta.url`, and inlined there that URL is the worker
  // bundle — every thread would boot another copy of the worker instead of the runtime.
  for (const file of ['ai-scan-panel.js', 'inference-worker.js']) {
    const bundle = readFileSync(new URL(`../vendor/${file}`, import.meta.url), 'utf8');
    // These strings exist only inside onnxruntime's own dist.
    for (const marker of ['ort-wasm-simd-threaded', 'onnxruntime-web', 'no available backend found']) {
      assert.ok(!bundle.includes(marker), `"${marker}" in ${file} means onnxruntime got inlined`);
    }
  }
  // And it must still be reached, by a computed URL rather than a bare specifier.
  const src = readFileSync(
    new URL('../../../packages/cube-scanner/view/onnx-runtime.ts', import.meta.url), 'utf8');
  // Any IDENTIFIER, not the one name `url` (2026-09-21): what keeps the runtime out of the bundle
  // is that esbuild cannot resolve a variable, whatever it is called — the retire path names its
  // re-numbered URL `target`, and a guard on the spelling would have refused it for nothing. A
  // string literal is what must never appear, so that is refused by name below.
  assert.match(
    src, /import\(\s*(?:\/\*[^*]*\*\/\s*)?[A-Za-z_$][\w$]*\s*\)/, 'must import a URL variable');
  assert.doesNotMatch(src, /import\(\s*(?:\/\*[^*]*\*\/\s*)?['"`]/, 'a literal specifier would be bundled');
  assert.doesNotMatch(src, /^\s*import\s+\*\s+as\s+ort\s+from\s+'onnxruntime-web'/m, 'no static runtime import');
  // The proxy is now CONDITIONAL, and the condition is the point. A ~200 ms wasm run has to leave
  // the page's thread or the UI is blocked the whole time the camera is open; a 15 ms GPU run does
  // not, and keeping the worker there would mean reaching the GPU device from a worker onnxruntime
  // spawned for its own reasons. Pinned as the rule rather than the literal, so "someone turned the
  // proxy off for wasm" still fails while the GPU exemption stays legible.
  //
  // And a SECOND exemption since 2026-09-22: a caller already off the page's thread — the
  // inference worker — has no thread to protect, and onnxruntime would not proxy from a worker
  // anyway. The rule is both halves, and then the flag is written from it.
  assert.match(src, /const proxied = !gpu && !opts\.offPageThread;/,
    'wasm inference ON THE PAGE must still be proxied to a worker');
  assert.match(src, /env\.wasm\.proxy\s*=\s*proxied\b/, 'the proxy flag must be written from that rule');
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
  writeFileSync(join(dest, 'cubedet.onnx'), 'NOT-OURS');

  const wanted = publishRuntime({ src, dest, ortEsm: loader });
  assert.deepEqual(wanted.sort(),
    ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']);

  const present = readdirSync(dest).sort();
  assert.deepEqual(present, [
    'cubedet.onnx',                        // not ours — never touched
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
