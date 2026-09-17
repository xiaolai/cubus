// ONE THING DRIVES THE ELEMENT on the cube screen — plan item 6.5, read off the source.
//
// The port's whole claim is that the walk's transport has a single owner: the script player, which
// owns the stop driver, which owns the element writer. Before it there were two hand-rolled
// transports — `walk-presenter.js` pressed `cube.step()` and `cube.seek()` for the buttons, and
// `walk-follow.js` kept its own `drawn` counter and a `drawTo` beside them — so "where the drawing
// is" had two owners that agreed by construction and nothing checked.
//
// Read as TEXT because that is the only way to state "and nowhere else". A behavioural test can show
// that a press moves the cube; it cannot show that no other line in the module moves it too, and the
// second transport is exactly the thing that grows back one convenience call at a time.

import assert from 'node:assert/strict';
import test from 'node:test';

import { readFileSync } from 'node:fs';

/** One module's text. Not `readAppSource()`: every case here is about ONE file's calls, and the
 *  joined source cannot say which module a line came from. */
const readSource = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/** The renderer's transport: the methods that MOVE the cube, as opposed to drawing a state on it. */
const TRANSPORT = ['step', 'stepBack', 'stepStop', 'stepBackStop', 'playTo', 'seek', 'play', 'pause'];

/** Every `cube.<method>(` call in `src`, with the line it is on, comments stripped. */
function transportCalls(src) {
  const found = [];
  src.split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;          // a comment may name what the code may not do
    for (const name of TRANSPORT) {
      if (new RegExp(`\\bcube\\.${name}\\s*\\(`).test(line)) found.push({ name, line: i + 1, text: line.trim() });
    }
  });
  return found;
}

for (const file of ['lib/walk-presenter.js', 'lib/walk-follow.js', 'lib/walk-session.js']) {
  test(`${file} moves the cube through the player and nowhere else`, () => {
    const calls = transportCalls(readSource(file));
    assert.deepEqual(calls, [], calls.map((c) => `${file}:${c.line} ${c.text}`).join('\n')
      + '\n\nA second transport beside the player is how "where the drawing is" gets two owners again'
      + ' (plan item 6.5). Move the walk with `player.next/back/seek/halt/play/pause`; the stop driver'
      + ' owns what the element is told.');
  });
}

test('the screen declares what it owns, and every entry is an attribute the writer would otherwise write', () => {
  // A name in `HOST_OWNED` that the writer never writes protects nothing and reads as though it did —
  // which is worse than not listing it, because the next person trusts the list. Read against the
  // writer's own writes so the two cannot drift apart silently.
  const owned = [...readSource('lib/walk-session.js').matchAll(/const HOST_OWNED = Object\.freeze\(\[([\s\S]*?)\]\)/g)]
    .flatMap((m) => [...m[1].matchAll(/'([a-z-]+)'/g)].map((a) => a[1]));
  assert.ok(owned.length >= 5, `the screen owns ${owned.length} attributes — HOST_OWNED was not found`);

  const writes = new Set([...readSource('lib/script-drive.js').matchAll(/\bwrite\('([a-z-]+)'/g)].map((m) => m[1]));
  const idle = owned.filter((name) => !writes.has(name));
  assert.deepEqual(idle, [], `${idle.join(', ')} is owned against a writer that never writes it`);
});

test('every tuned-view attribute a script could write is owned by the screen', () => {
  // `VIEW_ATTRS` and `ghosts` in lib/screens/cube.js are read from `cubeView` at mount — the look a
  // child tuned. A script that wrote any of them back would undo that on every press, which is the
  // first of the three reasons this screen could not become a driver consumer.
  const screen = readSource('lib/screens/cube.js');
  const tuned = [...screen.matchAll(/\[\s*'[A-Za-z]+',\s*'([a-z-]+)'\s*\]/g)].map((m) => m[1]);
  assert.ok(tuned.includes('camera-latitude') && tuned.includes('ghost-elevation'),
    `VIEW_ATTRS was not found in lib/screens/cube.js — read ${tuned.join(', ')}`);

  const session = readSource('lib/walk-session.js');
  const owned = new Set([...session.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]));
  const writes = new Set([...readSource('lib/script-drive.js').matchAll(/\bwrite\('([a-z-]+)'/g)].map((m) => m[1]));
  // Only the ones the writer would actually fight over: `facelet-scale` is tuned too and no script
  // touches it, so owning it would be noise.
  const contested = tuned.filter((name) => writes.has(name));
  const unowned = contested.filter((name) => !owned.has(name));
  assert.deepEqual(unowned, [], `${unowned.join(', ')} is tuned by the child and writable by a script`);
});
