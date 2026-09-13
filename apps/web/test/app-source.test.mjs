// The source list and the block reader the text-reading tests stand on — test/app-source.mjs.
//
// Every wiring test that cuts a function out of the app's source trusts `blockAt` to return exactly
// that function or throw. A reader that quietly returned a shorter span, a longer one or an empty
// one would turn every negative assertion built on it into a pass, which is the failure the reader
// was written to end — so its refusals are pinned here, not assumed.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

import { APP_SOURCES, blockAt, readAppSource } from './app-source.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the source list names real files, app.js first, and carries no module the app does not use', () => {
  assert.equal(APP_SOURCES[0], 'lib/app.js', 'app.js leads, so a first match in it is still found first');
  for (const p of APP_SOURCES) assert.ok(existsSync(new URL(`../${p}`, import.meta.url)), `${p} is listed and missing`);
  // A listed module nothing imports is a stale entry: the scans would go on reading code the app
  // no longer runs, and a claim there would be checked while the one that replaced it is not.
  for (const p of APP_SOURCES.slice(1)) {
    const specifier = `from './${p.slice('lib/'.length)}'`;
    assert.ok(APP_SOURCES.some((q) => q !== p && read(q).includes(specifier)),
      `${p} is listed, but nothing in the app's source imports it`);
  }
  const src = readAppSource();
  for (const p of APP_SOURCES) assert.ok(src.includes(read(p)), `readAppSource() left out ${p}`);
});

test('a block is read to its own closing brace, however it is indented', () => {
  for (const indent of ['', '  ', '      ']) {
    const src = [
      'function before() { return 1; }',
      'function subject(a) {',
      "  if (a) { log('}'); }",
      '  const t = `${a ? `}` : "{"}`;',
      '  const r = /\\}/g;',
      '  // a } in a comment',
      '  return a;',
      '}',
      'function after() { return 2; }',
    ].map((line) => indent + line).join('\n');
    const block = blockAt(src, 'function subject(a)');
    assert.ok(block.startsWith('function subject(a) {'), `${indent.length}-space indent: the block starts at its anchor`);
    assert.ok(block.endsWith(`return a;\n${indent}}`),
      `${indent.length}-space indent: a } in a string, template, regex or comment ended the block early`);
    assert.doesNotMatch(block, /after/, `${indent.length}-space indent: the block ran on into the next function`);
  }
});

test('blockAt refuses rather than guesses, and every refusal is loud', () => {
  const src = 'const a = () => { x(); };\nconst b = () => { y(); };\n';
  assert.throws(() => blockAt(src, 'const c = () =>'), /is not in the source/);
  // Two candidates is the case a first-match regex resolved silently, by position.
  assert.throws(() => blockAt(src, '() =>'), /appears more than once/);
  assert.throws(() => blockAt("f('x', '{'); g() { }", 'f('), /a literal opens between/);
  assert.throws(() => blockAt('const d = 1;', 'const d'), /nothing opens a block/);
  // The scanner's own end-of-input check names the construct left open — here, the block.
  assert.throws(() => blockAt('function e() { if (x) {', 'function e()'), /ended inside a block/);
});
