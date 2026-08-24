// Theme-token integrity for tokens.css.
//
// These check one thing the browser will never tell you about. A `var(--x)` naming a property
// that no rule declares does NOT fall back to anything and does NOT warn: the whole declaration
// becomes `unset`, so `background: var(--invert-bg)` silently renders transparent and
// `color: var(--invert-fg)` silently inherits. The element still draws, just wrong — which is
// how --invert-bg/--invert-fg/--track/--on-ink-2 sat declared in the dark blocks ONLY, leaving
// every primary button, dark card and current-move chip unpainted in light mode.
//
// The invariant that makes that unrepresentable: a theme block may only OVERRIDE :root, never
// introduce a property of its own.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const css = read('../tokens.css');
const html = read('../index.html');
const appJs = read('../lib/app.js');

/** Every `--name: value` pair inside one brace-delimited block, comments stripped. */
const declsIn = (text) =>
  new Map(
    [...text.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map(([, k, v]) => [k, v.split('/*')[0].trim()]),
  );

const blockAfter = (source, opener, closer) => {
  const at = source.indexOf(opener);
  assert.notEqual(at, -1, `tokens.css no longer contains the block "${opener}" — update this test`);
  const from = at + opener.length;
  const to = source.indexOf(closer, from);
  assert.notEqual(to, -1, `no closing "${closer.trim()}" after "${opener}"`);
  return declsIn(source.slice(from, to));
};

const light = blockAfter(css, ':root {', '\n}');
// The two dark blocks are hand-duplicated: one for the explicit [data-theme] pin, one for the OS
// preference. A media query cannot join a selector list, so the duplication is unavoidable.
const darkPinned = blockAfter(css, '[data-theme="dark"] {', '\n}');
const darkAuto = blockAfter(css, ':root:not([data-theme="light"]) {', '\n  }');

test('every dark-theme property is also declared in light', () => {
  for (const block of [darkPinned, darkAuto]) {
    const introduced = [...block.keys()].filter((k) => !light.has(k)).sort();
    assert.deepEqual(
      introduced,
      [],
      `declared in a dark block but not in :root — these render as \`unset\` in light mode, silently`,
    );
  }
});

test('the two dark blocks stay in lockstep', () => {
  assert.deepEqual([...darkPinned.keys()].sort(), [...darkAuto.keys()].sort(), 'key sets diverged');
  const drifted = [...darkPinned.keys()].filter((k) => darkPinned.get(k) !== darkAuto.get(k)).sort();
  assert.deepEqual(drifted, [], 'same property, different value in the two dark blocks');
});

test('every var() without a fallback names a property something declares', () => {
  // Declared anywhere the app can declare: the token file, index.html's own rules, and the
  // properties app.js writes at runtime (the 2D net's six face colours).
  const declared = new Set([
    ...light.keys(),
    ...declsIn(html).keys(),
    ...[...appJs.matchAll(/setProperty\('(--[a-z0-9-]+)'/g)].map((m) => m[1]),
    // Composed at runtime: `setProperty('--net-' + k, …)` for k in URFDLB.
    ...[...'URFDLB'].map((f) => `--net-${f}`),
  ]);

  const orphans = new Set();
  for (const source of [html, appJs]) {
    // A trailing "," means the author supplied a fallback, which is legal on its own.
    for (const [, name, next] of source.matchAll(/var\(\s*(--[a-z0-9-]+)\s*([,)])/g)) {
      if (next === ')' && !declared.has(name)) orphans.add(name);
    }
  }
  assert.deepEqual([...orphans].sort(), [], 'used with no fallback and never declared');
});

test('the design kit and the app ship the same token file', () => {
  // dev-docs/design/tokens.css is the source that was adopted verbatim (design/README.md).
  // Letting the copies drift is how a fix to one silently fails to reach the app.
  assert.equal(css, read('../../../dev-docs/design/tokens.css'), 'apps/web/tokens.css has drifted');
});
