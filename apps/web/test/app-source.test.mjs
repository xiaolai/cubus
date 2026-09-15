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

test('a function whose parameters destructure an object is read to its body, never its parameter pattern', () => {
  // Anchored inside the parameter list, the first brace after the anchor is the destructuring pattern.
  // Read as the block, it held no body at all: the case that found it needed two lines of the body to
  // exist, and a negative assertion on that "block" would have passed over nothing.
  for (const head of ['function subject(', 'async function subject(']) {
    const src = [
      'function before() { return 1; }',
      `${head}{ scrambling, fresh = () => true }) {`,
      '  if (scrambling) { return fresh(); }',
      '  return null;',
      '}',
      'function after() { return 2; }',
    ].join('\n');
    const block = blockAt(src, head);
    assert.ok(block.includes('return null;'), `${head}: the block stopped at the parameter pattern`);
    assert.ok(block.endsWith('return null;\n}'), `${head}: the block did not end at the body's own brace`);
    assert.doesNotMatch(block, /after/, `${head}: the block ran on into the next function`);
  }
  // A CALL's open paren is not a parameter list: the first brace after it is the callback's body, which
  // is the block every anchor like `panel.addEventListener('scan-complete'` wants.
  let callBlock = '';
  assert.doesNotThrow(() => { callBlock = blockAt('on(() => { go(); }, { once: true });', 'on('); },
    "a call's open paren was read as a function's parameter list");
  assert.match(callBlock, /go\(\);/, "a call's open paren was read as a function's parameter list");
  assert.doesNotMatch(callBlock, /once/, 'the callback block ran on past its own brace');
  // An anchor that carries its own brace opens the block with it: the else branch, not the first object
  // literal inside it.
  const elseBlock = blockAt('if (a) { x(); } else { y({ z: 1 }); w(); }', '} else {');
  assert.ok(elseBlock.includes('w();'), "an anchor's own brace was skipped, and the block was an object inside it");
  // And a string in the parameters is refused, as a string before any brace already is.
  assert.throws(() => blockAt("function f({ a = '}' }) { return a; }", 'function f('), /a literal opens/);
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

test('no test reads a block with a lazy regex — blockAt reads it, and refuses when it is not there', () => {
  // A lazy "anything" span that starts at a block's opening brace, or stops at a closing one, is a
  // regex standing in for brace matching. It stops at the first brace that fits: re-indent the block
  // and it runs on into the next one; lose its anchor and the fallback after it hands every negative
  // assertion an empty string to pass over. Thirty-four such lines stood in eleven files until
  // 2026-09-13. Spelled both ways a test can write one — a regex literal, and a RegExp string whose
  // backslashes are doubled — and built from pieces, so this case is not a match for itself.
  const doubled = (s) => s.replaceAll('\\', '\\\\');
  const either = (s) => [s, doubled(s)].map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const span = `(?:${either('[\\s\\S]*?')}|${either('[^]*?')})`;
  const standIn = new RegExp(
    `(?:${either('\\{')})\\(?${span}|${span}\\)?(?:${either('\\n')})?(?: \\{\\d+\\}| *)(?:${either('\\}')})`,
  );
  const found = readdirSync(new URL('.', import.meta.url), { recursive: true })
    .map(String)
    .filter((f) => f.endsWith('.mjs'))
    .sort()
    .flatMap((f) => read(`test/${f}`).split('\n').flatMap((line, i) => (standIn.test(line) ? [`test/${f}:${i + 1}`] : [])));
  assert.deepEqual(found, [], `a lazy regex stands in for brace matching — read the block with blockAt: ${found.join(', ')}`);
});

test('a number rounded to be compared never keeps the sign of a zero', () => {
  // `+(-1e-17).toFixed(4)` is -0, and deepStrictEqual holds -0 and 0 to be different values. A
  // rounding that leaves one therefore passes only while every float residue keeps its sign: on
  // 2026-09-14 a light-rig case went red because a refit moved the camera's quaternion by one ULP
  // (the largest light coordinate changed by 1.8e-15), and six more read the same way. `+ 0` turns
  // -0 into 0 and nothing else. Line-based, and the patterns are built from pieces, as above.
  const call = '(?:[^()]|\\((?:[^()]|\\([^()]*\\))*\\))*';
  const kept = '(?!\\s*\\+\\s*0\\b)';
  const unary = '(?<![\\w$)\\]\'"`]\\s*)\\+\\s*';
  const fixed = `\\.to${'Fixed'}\\(\\d+\\)`;
  const rounded = [
    new RegExp(`${unary}[\\w$]+(?:\\.[\\w$]+|\\(${call}\\))*${fixed}${kept}`),
    new RegExp(`${unary}\\(${call}\\)${fixed}${kept}`),
    new RegExp(`Number\\(${call}${fixed}\\)${kept}`),
    new RegExp(`\\.map\\(\\(?[\\w$]+\\)? => Math\\.${'round'}\\(${call}\\)(?:\\s*\\/\\s*[\\d.e]+)?\\)`),
  ];
  const flags = (line) => rounded.some((p) => p.test(line));
  const tf = `to${'Fixed'}`, mr = `Math.${'round'}`;
  for (const bad of [`[x].map((n) => +n.${tf}(4))`, `{ t: +(a - b).${tf}(1) }`, `(v) => Number(v.${tf}(3))`,
    `f(() => +el.camera.position.length().${tf}(6))`, `q.map((n) => ${mr}(n))`, `m.map((v) => ${mr}(v * 1e6) / 1e6)`]) {
    assert.equal(flags(bad), true, `the guard misses a rounding that keeps -0: ${bad}`);
  }
  for (const good of [`[x].map((n) => +n.${tf}(4) + 0)`, `{ t: +(a - b).${tf}(1) + 0 }`, `\`\${n.${tf}(2)} ms\``,
    `'x' + n.${tf}(2)`, `m.map((v) => ${mr}(v * 1e6) / 1e6 + 0)`, `q.map((n) => ${mr}(n) + 0)`]) {
    assert.equal(flags(good), false, `the guard refuses a rounding that is fine: ${good}`);
  }
  const found = readdirSync(new URL('.', import.meta.url), { recursive: true })
    .map(String)
    .filter((f) => f.endsWith('.mjs'))
    .sort()
    .flatMap((f) => read(`test/${f}`).split('\n').flatMap((line, i) => (flags(line) ? [`test/${f}:${i + 1}`] : [])));
  assert.deepEqual(found, [], `a rounding for comparison can keep -0 — add \`+ 0\`: ${found.join(', ')}`);
});
