// The source list and the block reader the text-reading tests stand on — test/app-source.mjs.
//
// Every wiring test that cuts a function out of the app's source trusts `blockAt` to return exactly
// that function or throw. A reader that quietly returned a shorter span, a longer one or an empty
// one would turn every negative assertion built on it into a pass, which is the failure the reader
// was written to end — so its refusals are pinned here, not assumed.

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { APP_SOURCES, LIBRARY_SOURCES, blockAt, readAppSource } from './app-source.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
/** Every relative module a file names — static, side-effect, re-export and dynamic — resolved against it. */
const importsOf = (q) => [...read(q).matchAll(/(?:^|\s)(?:import|export)\s[^'";]*?['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)|^import\s+['"](\.{1,2}\/[^'"]+)['"]/gm)]
  .map((m) => path.posix.normalize(path.posix.join(path.posix.dirname(q), m[1] ?? m[2] ?? m[3])));

test('the source list names real files, app.js first, and carries no module the app does not use', () => {
  assert.equal(APP_SOURCES[0], 'lib/app.js', 'app.js leads, so a first match in it is still found first');
  for (const p of APP_SOURCES) assert.ok(existsSync(new URL(`../${p}`, import.meta.url)), `${p} is listed and missing`);
  // A listed module nothing imports is a stale entry: the scans would go on reading code the app
  // no longer runs, and a claim there would be checked while the one that replaced it is not.
  const imported = new Set(APP_SOURCES.flatMap(importsOf));
  for (const p of APP_SOURCES.slice(1)) {
    assert.ok(imported.has(p), `${p} is listed, but nothing in the app's source imports it`);
  }
  const src = readAppSource();
  for (const p of APP_SOURCES) assert.ok(src.includes(read(p)), `readAppSource() left out ${p}`);
});

test('every module under lib/ is the app\'s own source or a library it uses — never both, never neither', () => {
  // The scans read APP_SOURCES only, so a module in neither list is a module no scan covers and
  // nothing says so. That is how an extracted screen would escape the rules the rest of the app
  // is held to — the reverse of the check above, and the one that fails on a NEW file.
  const onDisk = readdirSync(new URL('../lib/', import.meta.url), { recursive: true })
    .map((f) => `lib/${f.replaceAll('\\', '/')}`).filter((f) => f.endsWith('.js'));
  const app = new Set(APP_SOURCES);
  const library = new Set(LIBRARY_SOURCES);
  for (const f of onDisk) {
    assert.ok(app.has(f) !== library.has(f),
      `${f} must be in exactly one of APP_SOURCES and LIBRARY_SOURCES (test/app-source.mjs) — decide which`);
  }
  for (const f of LIBRARY_SOURCES) assert.ok(onDisk.includes(f), `${f} is listed as a library and missing`);
  // A library that imports the app's own modules is app code filed where the scans cannot see it.
  for (const f of LIBRARY_SOURCES) {
    const intoApp = importsOf(f).filter((i) => app.has(i));
    assert.deepEqual(intoApp, [], `${f} imports the app's own modules — it belongs in APP_SOURCES`);
  }
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
