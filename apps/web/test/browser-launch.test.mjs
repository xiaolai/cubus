// Every browser a test or a bench drives is launched by `launchBrowser` in test/browser/harness.mjs,
// because the guards it adds hold only for a browser that has them: the navigation bound on every
// context, and a page whose web content process dies being closed at once, naming the crash, so a
// call in flight on it fails rather than waits forever. A `keyboard.press` on a page whose WebKit
// process was killed was still pending 120 s later without that guard, and 5 ms after the kill with it
// (Linux WPE, 2026-10-22).
//
// THE RELATION, not a list of suites: harness.mjs is the one module under apps/web that may import
// Playwright, so a suite written tomorrow cannot launch a browser around the guard. The imports are
// read by acorn's PARSER, never a regex — a comment or a string that names the package is not an import.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { Parser } from 'acorn';

const WEB = fileURLToPath(new URL('../', import.meta.url));
const HARNESS = 'test/browser/harness.mjs';
// Not ours to police: installed packages, and the vendored bundles `pnpm vendor:libs` writes.
const SKIP = new Set(['node_modules', 'vendor']);

function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (SKIP.has(entry.name)) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(m?js)$/.test(entry.name) ? [path] : [];
  });
}

const PLAYWRIGHT = /^playwright(-core)?(\/|$)/;

/** Every module specifier `src` loads, static or dynamic, re-exports and `require` included. */
function specifiers(src) {
  const found = [];
  const visit = (node) => {
    if (!node || typeof node.type !== 'string') return;
    const literal = (n) => (n?.type === 'Literal' && typeof n.value === 'string' ? n.value : n ? '(computed)' : null);
    if (['ImportDeclaration', 'ExportAllDeclaration', 'ExportNamedDeclaration'].includes(node.type) && node.source) found.push(literal(node.source));
    if (node.type === 'ImportExpression') found.push(literal(node.source));
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'require') found.push(literal(node.arguments[0]));
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  };
  visit(Parser.parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true }));
  return found;
}

test('harness.mjs is the only module under apps/web that imports Playwright', () => {
  const files = sources(WEB).map((p) => relative(WEB, p).split('\\').join('/'));
  // The null beside the measurement: the walk reaches the suites, and the harness is seen importing it.
  assert.ok(files.length > 300, `only ${files.length} modules found under apps/web — the walk is broken`);
  assert.ok(specifiers(readFileSync(join(WEB, HARNESS), 'utf8')).some((s) => PLAYWRIGHT.test(s)), `${HARNESS} no longer imports Playwright — this check would hold vacuously`);

  const around = files.filter((f) => f !== HARNESS && specifiers(readFileSync(join(WEB, f), 'utf8')).some((s) => PLAYWRIGHT.test(s)));
  assert.deepEqual(around, [], 'launch the browser with launchBrowser from test/browser/harness.mjs, never Playwright directly');
});

test('a dynamic import of Playwright and a computed one are both seen, and a comment is not', () => {
  assert.deepEqual(specifiers("const { webkit } = await import('playwright');"), ['playwright']);
  assert.deepEqual(specifiers('const m = await import(name);'), ['(computed)']);
  assert.deepEqual(specifiers("// import { webkit } from 'playwright';\nconst s = \"from 'playwright'\";"), []);
});
