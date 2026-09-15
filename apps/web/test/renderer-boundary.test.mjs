// The renderer's boundary, enforced (plan item 1.5 of dev-docs/tutorial-capability-plan.md;
// dev-docs/adr/0005-the-renderer-plays-scripts-methods-choose.md, decisions 2 and 5).
//
// Two rules, both about what a module is ALLOWED TO IMPORT, because that is the one property a module
// cannot have by accident:
//
//   The renderer's modules — notation, interpreter, questions, layout, the script runtime, the element
//   and its pose — and the cube-domain modules they stand on import only each other and three.js. A
//   screen, a service, the shell, or a solver or method module is refused: the renderer plays, a method
//   chooses, and an import is how a choice would creep in.
//
//   A QUESTION module imports only a short list of read-only names. A ban on move-applying imports was
//   beaten twice in review — six lines with `applyAlg` + `MOVE_NAMES` found `R'` from `R`, and six more
//   through the pose module's `after` + `MOVE_DESCRIPTORS` — so the rule is an allow-list of what a
//   question may read, and anything it does not name is refused.
//
// Imports are READ, not grepped: comments and strings are stripped first, specifiers are resolved to
// repository paths, re-exports count, and a dynamic import that is not a literal is refused because it
// cannot be checked. Every rule is also run on fixtures written to break it.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** The renderer's own modules. */
export const RENDERER = Object.freeze([
  'apps/web/lib/cube-notation.js',
  'apps/web/lib/cube-moves.js',
  'apps/web/lib/cube-questions.js',
  'apps/web/lib/cube-layout.js',
  'apps/web/lib/lesson-format.js',
  'apps/web/lib/script-questions.js',
  'apps/web/lib/script-view.js',
  'apps/web/lib/lesson-schedule.js',
  'apps/web/lib/lesson-player.js',
  'packages/cubus-cube/src/cubus-cube.js',
  'packages/cubus-cube/src/pose.js',
]);

/** The cube-domain modules the renderer stands on. Held to the same rule. */
export const DOMAIN = Object.freeze([
  'apps/web/lib/cube-pieces.js',
  'apps/web/lib/cube-orientation.js',
  'apps/web/lib/cube-highlight.js',
  'apps/web/lib/cube-frame.js',
  'apps/web/lib/cube-view.js',
  'apps/web/lib/sticker-palettes.js',
]);

/** Question modules, and the names each may import from where (ADR 0005 decision 2). */
export const QUESTION_MODULES = Object.freeze(['apps/web/lib/cube-questions.js']);
export const QUESTION_ALLOW = Object.freeze({
  'apps/web/lib/cube-pieces.js': ['CORNER', 'CORNERS', 'EDGE', 'EDGES', 'SOLVED', 'cornerSlot', 'edgeSlot', 'cornerSolved', 'edgeSolved', 'allSolved'],
  'apps/web/lib/cube-orientation.js': ['FACE_LETTERS', 'ORIENTATIONS', 'orientationRelabel', 'sameAxis'],
  'apps/web/lib/cube-highlight.js': ['KIND', 'pieceKey', 'slotVector'],
  // The facelet layout: which sticker is which slot's. Tables, no arithmetic.
  'apps/web/lib/cube-layout.js': ['CORNER_FACELETS', 'EDGE_FACELETS', 'CENTERS', 'FACE_LETTERS', 'SLOT_FACELETS'],
});

/** Source with comments and string contents removed — quotes kept, so import specifiers survive. */
export function strip(source) {
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '/') { while (i < n && source[i] !== '\n') i++; continue; }
    if (c === '/' && next === '*') { i += 2; while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++; i += 2; continue; }
    if (c === "'" || c === '"' || c === '`') {
      // Keep the quotes and the text of a string that could be a specifier; a template literal's
      // body is blanked, so a string that merely contains the word `import` is not read as one.
      const quote = c;
      let body = '';
      i++;
      while (i < n && source[i] !== quote) {
        if (source[i] === '\\') { body += source[i] + (source[i + 1] ?? ''); i += 2; continue; }
        body += source[i];
        i++;
      }
      i++;
      out += quote + (quote === '`' ? '' : body) + quote;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Every import of a module: `{ specifier, names, namespace, dynamic, literal }`. */
export function importsOf(source) {
  const text = strip(source);
  const found = [];
  const bindings = (clause) => {
    const names = [];
    let namespace = false;
    const braces = /\{([^}]*)\}/.exec(clause);
    if (braces) {
      for (const part of braces[1].split(',').map((s) => s.trim()).filter(Boolean)) names.push(part.split(/\s+as\s+/)[0].trim());
    }
    if (/\*\s+as\s+\w+/.test(clause) || /^\s*\*\s*$/.test(clause)) namespace = true;
    const rest = clause.replace(/\{[^}]*\}/, '').replace(/\*\s+as\s+\w+/, '').replace(/,/g, ' ').trim();
    if (rest && rest !== '*' && !/^type$/.test(rest)) names.push('default');
    return { names, namespace };
  };
  for (const m of text.matchAll(/(?:^|[;\n])\s*import\s+([^'";]*?)\s*from\s*(['"])([^'"]+)\2/g)) {
    found.push({ specifier: m[3], ...bindings(m[1]), dynamic: false, literal: true });
  }
  for (const m of text.matchAll(/(?:^|[;\n])\s*import\s*(['"])([^'"]+)\1/g)) {
    found.push({ specifier: m[2], names: [], namespace: true, dynamic: false, literal: true });
  }
  for (const m of text.matchAll(/(?:^|[;\n])\s*export\s+([^'";]*?)\s*from\s*(['"])([^'"]+)\2/g)) {
    found.push({ specifier: m[3], ...bindings(m[1]), dynamic: false, literal: true });
  }
  for (const m of text.matchAll(/\bimport\s*\(\s*([^)]*)\)/g)) {
    const literal = /^(['"])([^'"]+)\1$/.exec(m[1].trim());
    found.push({ specifier: literal ? literal[2] : m[1].trim(), names: [], namespace: true, dynamic: true, literal: !!literal });
  }
  return found;
}

/** A specifier, from the file that imports it, as a repository path — or `three` for three.js. */
export function resolve(fromFile, specifier) {
  if (specifier === 'three' || specifier.startsWith('three/')) return 'three';
  if (!specifier.startsWith('.')) return `bare:${specifier}`;
  return normalize(relative(ROOT, join(ROOT, dirname(fromFile), specifier))).split('\\').join('/');
}

/** The violations of both rules for a set of `{ path, source }` modules. */
export function violations(modules, { renderer = RENDERER, domain = DOMAIN, questions = QUESTION_MODULES, allow = QUESTION_ALLOW } = {}) {
  const permitted = new Set([...renderer, ...domain]);
  const out = [];
  for (const { path, source } of modules) {
    for (const imp of importsOf(source)) {
      if (!imp.literal) { out.push(`${path}: a dynamic import of a computed specifier cannot be checked (${imp.specifier})`); continue; }
      const target = resolve(path, imp.specifier);
      if (target !== 'three' && !permitted.has(target)) out.push(`${path}: imports ${target}, which is not a renderer or cube-domain module`);
      if (questions.includes(path) && !questions.includes(target)) {
        const names = allow[target];
        if (!names) { out.push(`${path}: a question module imports ${target}, which is not on its allow-list`); continue; }
        if (imp.namespace) { out.push(`${path}: a question module imports all of ${target} (namespace or side effect)`); continue; }
        for (const name of imp.names) {
          if (!names.includes(name)) out.push(`${path}: a question module imports "${name}" from ${target}, which is not on its allow-list`);
        }
      }
    }
  }
  return out;
}

const read = (path) => ({ path, source: readFileSync(join(ROOT, path), 'utf8') });

test('every module the boundary names exists, so the rule cannot pass over a file that moved', () => {
  for (const path of [...RENDERER, ...DOMAIN]) assert.ok(existsSync(join(ROOT, path)), `${path} does not exist`);
  for (const path of Object.keys(QUESTION_ALLOW)) assert.ok(existsSync(join(ROOT, path)), `${path} does not exist`);
});

test('the renderer and the cube-domain modules import only each other and three.js; questions only their allow-list', () => {
  const modules = [...RENDERER, ...DOMAIN].map(read);
  assert.ok(importsOf(read('packages/cubus-cube/src/cubus-cube.js').source).length >= 6, 'precondition: the element\'s imports were read');
  assert.deepEqual(violations(modules), []);
});

test('the rule can fail: a renderer module importing a solver is refused', () => {
  const fixture = { path: 'apps/web/lib/cube-moves.js', source: "import { solve } from './two-phase.js';\nexport const x = solve;" };
  assert.deepEqual(violations([fixture]), ['apps/web/lib/cube-moves.js: imports apps/web/lib/two-phase.js, which is not a renderer or cube-domain module']);
  const screen = { path: 'apps/web/lib/lesson-player.js', source: "export { state } from './app-state.js';" };
  assert.equal(violations([screen]).length, 1, 'a re-export is an import');
});

test('the rule can fail: the six-line search through applyAlg and MOVE_NAMES, pasted into a question', () => {
  const search = [
    "import { SOLVED, applyAlg, MOVE_NAMES } from './cube-pieces.js';",
    'export function solveOne(state) {',
    '  for (const m of MOVE_NAMES) if (JSON.stringify(applyAlg(state, m)) === JSON.stringify(SOLVED)) return m;',
    '  return null;',
    '}',
  ].join('\n');
  const found = violations([{ path: 'apps/web/lib/cube-questions.js', source: search }]);
  assert.deepEqual(found.sort(), [
    'apps/web/lib/cube-questions.js: a question module imports "MOVE_NAMES" from apps/web/lib/cube-pieces.js, which is not on its allow-list',
    'apps/web/lib/cube-questions.js: a question module imports "applyAlg" from apps/web/lib/cube-pieces.js, which is not on its allow-list',
  ]);
});

test('the rule can fail: the six-line search through the pose module\'s after and MOVE_DESCRIPTORS, pasted into a question', () => {
  const search = [
    "import { after, MOVE_DESCRIPTORS } from '../../../packages/cubus-cube/src/pose.js';",
    "import { SOLVED } from './cube-pieces.js';",
    'export function solveOne(frame, state) {',
    '  for (const [name, d] of Object.entries(MOVE_DESCRIPTORS)) if (after(frame, state, d).state === SOLVED) return name;',
    '}',
  ].join('\n');
  const found = violations([{ path: 'apps/web/lib/cube-questions.js', source: search }]);
  assert.ok(found.some((v) => v.includes('packages/cubus-cube/src/pose.js, which is not on its allow-list')), found.join('\n'));
});

test('the reader reads imports, not text: comments, strings, namespaces and computed specifiers', () => {
  const fixture = [
    "// import { solve } from './two-phase.js';",
    "/* export * from './app-state.js'; */",
    "const doc = `import x from './screen-shell.js'`;",
    "import * as P from './cube-pieces.js';",
    'const mod = await import(pathOfTheDay);',
  ].join('\n');
  const found = violations([{ path: 'apps/web/lib/cube-questions.js', source: fixture }]);
  assert.deepEqual(found.sort(), [
    'apps/web/lib/cube-questions.js: a dynamic import of a computed specifier cannot be checked (pathOfTheDay)',
    'apps/web/lib/cube-questions.js: a question module imports all of apps/web/lib/cube-pieces.js (namespace or side effect)',
  ], 'a comment or a string was read as an import, or a namespace import or a computed import was missed');
});
