// EVERY CUBE THE APP DRAWS IS MADE IN ONE PLACE, so the tuned view reaches all of them.
//
// `applyCubeView` exists because a look the cube screen owned alone never reached the others: ghost
// faces and the camera first, and then `tempo-scale`, left out of the same fix — measured on the Drill
// page at 200ms per quarter turn against 1620ms at Normal, which is what "the drills have no
// animation" meant. `cube-tempo.test.mjs` holds the applier: given a cube, it writes the tempo.
//
// NOTHING HELD THE OTHER HALF. The applier only reaches a cube that goes through the one function that
// makes one, and a module constructing `<cubus-cube>` for itself would draw at the renderer's bare
// 190ms with no ghosts and the wrong camera — silently, and in a screen nobody had thought to check.
// The shape has already shipped twice; this is the assertion that stops a third.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { blockAt } from './app-source.mjs';

const LIB = fileURLToPath(new URL('../lib/', import.meta.url));

/** The module that is allowed to make one, and the only one. */
const OWNER = 'lib/cube-drawing.js';

/** Every module under `lib/`, read off the disk rather than off a list — a list goes stale exactly
 *  where this check is needed, which is a module nobody has thought about yet. */
const modules = () => {
  const out = [];
  const walkDir = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}${entry.name}`;
      const label = `${prefix}${entry.name}`;
      if (entry.isDirectory()) walkDir(`${path}/`, `${label}/`);
      else if (entry.name.endsWith('.js')) out.push({ label, text: readFileSync(path, 'utf8') });
    }
  };
  walkDir(LIB, 'lib/');
  return out;
};

/** Source with its comments gone: a line of prose naming the element is not a module making one. */
const stripped = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Does this module CONSTRUCT the element — by name, or by writing the tag into markup? */
const makesACube = (text) => {
  const src = stripped(text);
  return /createElement\s*\(\s*['"`]cubus-cube['"`]\s*\)/.test(src) || /<cubus-cube[\s>]/.test(src);
};

test('only one module makes a cube element', () => {
  const all = modules();
  assert.ok(all.length > 40, `only ${all.length} modules found under lib/ — the walk is broken`);
  const makers = all.filter(({ text }) => makesACube(text)).map((m) => m.label).sort();
  assert.deepEqual(makers, [OWNER],
    `a cube element is made outside ${OWNER}, so the tuned view — ghosts, camera, tempo — never reaches it. `
    + 'Draw it with `newCube`/`reuseCube` from lib/cube-drawing.js instead.');
});

test('the one module that makes a cube puts the tuned view on it', () => {
  // The join between this file and `cube-tempo.test.mjs`: that one proves the applier writes the view,
  // this one proves the maker calls the applier. Either alone passes while a cube is drawn untuned.
  const src = readFileSync(new URL(`../${OWNER}`, import.meta.url), 'utf8');
  const block = blockAt(src, 'export function newCube(');
  assert.ok(block, `${OWNER} has no newCube to read — this check went blind`);
  assert.match(stripped(block), /applyCubeView\s*\(/,
    'newCube hands back an element the tuned view was never put on');
});
