// The supported surface, pinned — so breaking a downstream project fails HERE, on the commit that
// breaks it, rather than in someone else's build.
//
// cubus-im (the lesson course) consumes this repository read-only and has no way to tell us when
// we move something out from under it. Its own rule for the boundary is stated in its
// `docs/preflight.md` rule 23 — a new dependency gets a check at the boundary, in the build, that
// names what to do about it — and it has been keeping that rule with the only instrument we ever
// gave it, which is a grep over a bundle. This is our half.
//
// ADDING a name to `cube-kit.js` needs no change here. REMOVING or renaming one fails, which is
// the whole point: the names are a promise, and this is where the promise is written down.
import assert from 'node:assert/strict';
import test from 'node:test';

import * as kit from '../lib/cube-kit.js';
import * as frame from '../lib/cube-frame.js';
import * as highlight from '../lib/cube-highlight.js';
import * as moves from '../lib/cube-moves.js';
import * as notation from '../lib/cube-notation.js';
import * as orientation from '../lib/cube-orientation.js';
import * as pieces from '../lib/cube-pieces.js';
import * as format from '../lib/lesson-format.js';
import * as player from '../lib/lesson-player.js';
import * as schedule from '../lib/lesson-schedule.js';
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
  // The interpreter (plan item 1.2).
  'run',
  // The episode runtime.
  'CAM_DEFAULT', 'CAM_EASE', 'GHOST_ELEV', 'GHOST_REVEAL', 'MIN_PER_MOVE', 'QUARTER_GAP',
  'SPAN_LEAD', 'buildSchedule', 'cameraAt', 'checkEpisode', 'createLessonPlayer', 'lineAt',
  'numberAt', 'resolveSpanning', 'segmentAt', 'viewAt',
];

test('every promised name is exported, and none has quietly gone', () => {
  const actual = Object.keys(kit).sort();
  const missing = PROMISED.filter((n) => !actual.includes(n));
  assert.deepEqual(missing, [],
    'these names are promised to cubus-im and are no longer exported — renaming one breaks its build');
  // Not `deepEqual` against the whole list: adding an export is free and should not need a test
  // edit. Only disappearance is a breaking change.
  for (const name of PROMISED) {
    assert.notEqual(kit[name], undefined, `${name} is exported as undefined`);
  }
});

test('the barrel re-exports the real thing, not a copy of it', () => {
  // EVERY promised name, not a hand-picked nine. The earlier version checked thirteen, so
  // substituting `{}` for `CUBE_VIEW_ATTRS` — a public export — passed the whole file, because the
  // assertions that used it read it from the source module directly.
  const sources = [pieces, frame, highlight, moves, notation, orientation, view, format, schedule, player];
  const unchecked = [];
  for (const name of PROMISED) {
    const owner = sources.find((m) => name in m);
    if (!owner) { unchecked.push(name); continue; }
    assert.equal(kit[name], owner[name], `cube-kit's ${name} is not the one lib/ exports`);
  }
  assert.deepEqual(unchecked, [], 'these promised names belong to no module this test imports');
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
