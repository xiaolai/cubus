// The supported surface, pinned — so breaking a downstream project fails HERE, on the commit that
// breaks it, rather than in someone else's build.
//
// cubus-im (the lesson course) consumes this repository read-only and has no way to tell us when
// we move something out from under it. Its own rule for the boundary is stated in its
// `docs/preflight.md` rule 23 — a new dependency gets a check at the boundary, in the build, that
// names what to do about it — and it has been keeping that rule with the only instrument we ever
// gave it, which is a grep over a bundle. This is our half.
//
// The names are a promise, and this is where the promise is written down. REMOVING or renaming one
// fails. And since 2026-09-15 ADDING one fails too until it is written into `PROMISED` and its module
// is registered below (dev-docs/adr/0005-the-renderer-plays-scripts-methods-choose.md, decision 4): the
// rule used to be "adding is free", and measured, that left a new export a consumer could adopt with
// nothing to stop it being removed again.
import assert from 'node:assert/strict';
import test from 'node:test';

import * as kit from '../lib/cube-kit.js';
import * as frame from '../lib/cube-frame.js';
import * as highlight from '../lib/cube-highlight.js';
import * as moves from '../lib/cube-moves.js';
import * as notation from '../lib/cube-notation.js';
import * as questions from '../lib/cube-questions.js';
import * as orientation from '../lib/cube-orientation.js';
import * as pieces from '../lib/cube-pieces.js';
import * as format from '../lib/lesson-format.js';
import * as player from '../lib/lesson-player.js';
import * as schedule from '../lib/lesson-schedule.js';
import * as scriptQuestions from '../lib/script-questions.js';
import * as view from '../lib/cube-view.js';
import { CUBE_VIEW, CUBE_VIEW_ATTRS } from '../lib/cube-view.js';

/** Every name a consumer is entitled to find. Sorted, so a diff reads as one line per change. */
const PROMISED = [
  'CORNER', 'CORNERS', 'CUBE_VIEW', 'CUBE_VIEW_ATTRS', 'EDGE', 'EDGES', 'FACE_LETTERS', 'KIND',
  'MOVES', 'MOVE_NAMES', 'ORIENTATIONS', 'SOLVED',
  'allSolved', 'applyAlg', 'applyMove', 'cameraAxes', 'cornerSlot', 'cornerSolved', 'determinant',
  'edgeSlot', 'edgeSolved', 'eyeDirection', 'fitDistance', 'fitDistanceStable', 'fromCube',
  'invert', 'moveCount', 'movesOf', 'orientationMatrix', 'orientationPerm', 'orientationRelabel',
  'parseHighlight', 'pieceKey', 'project', 'resolveHighlight', 'rotateAlg', 'rotateState',
  'sameAxis', 'selects', 'silhouette', 'slotVector', 'turnFacelets',
  // Notation (plan item 1.1).
  'formatMoves', 'parse',
  // The interpreter (plan items 1.2 and 1.3).
  'convertSelectors', 'run',
  // Questions about one cube (plan item 1.4).
  'edgesInLayerWithout', 'inLayerWithout', 'isHome', 'layerSlots', 'pairOf', 'pieceIn', 'piecesAway',
  'readCube', 'whereIs',
  // The episode runtime.
  'CAM_DEFAULT', 'CAM_EASE', 'GHOST_ELEV', 'GHOST_REVEAL', 'MIN_PER_MOVE', 'QUARTER_GAP',
  'SPAN_LEAD', 'buildSchedule', 'cameraAt', 'checkEpisode', 'createLessonPlayer', 'lineAt',
  'numberAt', 'resolveSpanning', 'segmentAt', 'viewAt',
  // The script runtime (plan item 3.1): the format both drivers read, and the questions a cue names.
  'STEP_CUES', 'STEP_KINDS', 'checkLesson', 'checkScript', 'heldFace', 'identityFace',
  'QUESTIONS', 'TAKES_ARGUMENT', 'ask', 'readAsk',
];

/** The modules whose names the kit re-exports. A new owning module is added here with its first name. */
const SOURCES = [pieces, frame, highlight, moves, notation, questions, orientation, view, format, schedule, player, scriptQuestions];

/** Promised names the kit does not export. */
export const missingFrom = (exports, promised) => promised.filter((n) => !Object.hasOwn(exports, n)).sort();

/** Exported names nobody promised. */
export const unpromised = (exports, promised) => Object.keys(exports).filter((n) => !promised.includes(n)).sort();

/** Promised names that belong to no registered module, and names re-exported as something other than the original. */
export function unowned(exports, promised, sources) {
  const noOwner = [];
  const copies = [];
  for (const name of promised) {
    const owner = sources.find((m) => Object.hasOwn(m, name));
    if (!owner) { noOwner.push(name); continue; }
    if (exports[name] !== owner[name]) copies.push(name);
  }
  return { noOwner, copies };
}

test('every promised name is exported, and none has quietly gone', () => {
  assert.deepEqual(missingFrom(kit, PROMISED), [],
    'these names are promised to cubus-im and are no longer exported — renaming one breaks its build');
  for (const name of PROMISED) {
    assert.notEqual(kit[name], undefined, `${name} is exported as undefined`);
  }
});

test('every exported name is promised — a name cannot be adopted before it is protected', () => {
  assert.deepEqual(unpromised(kit, PROMISED), [],
    'these names are exported and not in PROMISED — add each one, and register its module below');
});

test('the barrel re-exports the real thing, not a copy of it', () => {
  // EVERY promised name, not a hand-picked nine. The earlier version checked thirteen, so
  // substituting `{}` for `CUBE_VIEW_ATTRS` — a public export — passed the whole file, because the
  // assertions that used it read it from the source module directly.
  const { noOwner, copies } = unowned(kit, PROMISED, SOURCES);
  assert.deepEqual(noOwner, [], 'these promised names belong to no module this test imports');
  assert.deepEqual(copies, [], 'cube-kit re-exports these as something other than what lib/ exports');
});

test('the three rules can fail: an unpromised export, a promise with no registered module, a copy', () => {
  const surprise = { ...kit, surprise: () => 1 };
  assert.deepEqual(unpromised(surprise, PROMISED), ['surprise'], 'an added, unpromised export passed');
  const promised = [...PROMISED, 'surprise'];
  assert.deepEqual(unpromised(surprise, promised), []);
  assert.deepEqual(unowned(surprise, promised, SOURCES).noOwner, ['surprise'], 'a promise with no registered module passed');
  const owner = { surprise: surprise.surprise };
  assert.deepEqual(unowned(surprise, promised, [...SOURCES, owner]), { noOwner: [], copies: [] }, 'promised and registered, it passes');
  assert.deepEqual(unowned({ ...surprise, applyAlg: () => 0 }, promised, [...SOURCES, owner]).copies, ['applyAlg']);
  assert.deepEqual(missingFrom({}, ['applyAlg']), ['applyAlg']);
});

// The numbers cubus-im's `pipeline/paths.py::cube_preset()` reads. It used to scrape them out of
// `app.js` with a regular expression, which made one line of an application file a public API.
test('the cube view is frozen, and its attribute names match its fields', () => {
  assert.equal(Object.isFrozen(CUBE_VIEW), true, 'an exported mutable default is a defect waiting');
  assert.equal(Object.isFrozen(CUBE_VIEW_ATTRS), true);
  assert.deepEqual(Object.keys(CUBE_VIEW).sort(), ['camLat', 'camLon', 'facScale', 'ghosts', 'hintElev']);
  assert.deepEqual(CUBE_VIEW_ATTRS, {
    'ghost-elevation': CUBE_VIEW.hintElev,
    'camera-latitude': CUBE_VIEW.camLat,
    'camera-longitude': CUBE_VIEW.camLon,
    'facelet-scale': CUBE_VIEW.facScale,
  });
});

// Every attribute name the preset claims is one `<cubus-cube>` actually observes. A mapping to an
// attribute the renderer ignores is the `camera-up` failure in miniature: written, never read, and
// nothing downstream can tell the result from a correct one.
//
// Read from the manifest, which is generated from the BUILT bundle — so this is asking the artefact
// the consumer inlines, not a source file that may be ahead of it.
test('every attribute the preset names is one the shipped bundle reads', async () => {
  const { readFileSync } = await import('node:fs');
  const manifest = JSON.parse(
    readFileSync(new URL('../vendor/cubus-cube.manifest.json', import.meta.url), 'utf8'),
  );
  const observed = new Set(manifest.attributes);
  for (const name of Object.keys(CUBE_VIEW_ATTRS)) {
    assert.equal(observed.has(name), true, `${name} is not an attribute the renderer reads`);
  }
});

// The app must keep USING the exported preset rather than drifting back to its own literal.
// BEHAVIOUR, not a regex over the source. The earlier version matched raw text, so a changed
// inline preset with the original call left in a COMMENT satisfied both assertions. This asks the
// module what it actually does with an empty store.
test('app.js reads the preset rather than keeping a second copy of it', async () => {
  const { readAppSource } = await import('./app-source.mjs');
  const src = readAppSource();
  // Comments stripped first, so a commented-out call cannot stand in for a live one.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(code, /load\('cubeView',\s*CUBE_VIEW\)/,
    'cubeScreen no longer loads the exported preset');
  assert.doesNotMatch(code, /hintElev\s*:\s*\d/,
    'app.js has grown its own copy of the cube view again');
  // And the values the screen would actually use come from the constant, whatever the source says.
  assert.deepEqual({ ...CUBE_VIEW }, {
    hintElev: 9, camLat: 35, camLon: 45, facScale: 1, ghosts: true,
  });
});

// RESOLUTION, which the barrel does not provide and is often confused with it. A consumer cannot
// put an environment variable in an import specifier, so relocating a checkout needs a resolvable
// package name — this export map plus a link — or a resolver using dynamic `import()`. Pinned
// because the three names are what a downstream project writes down.
test('the package declares the three things a consumer may import by name', async () => {
  const { readFileSync } = await import('node:fs');
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(pkg.exports, {
    './cube-kit': './lib/cube-kit.js',
    './element': './vendor/cubus-cube.js',
    './element-manifest': './vendor/cubus-cube.manifest.json',
  });
  // Each target exists. An export map naming a file nobody ships is a promise that fails at the
  // consumer's import, which is the worst place to find out.
  for (const target of Object.values(pkg.exports)) {
    assert.ok(readFileSync(new URL(`../${target}`, import.meta.url)).length > 0, `${target} is empty or missing`);
  }
});
