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
import { existsSync, readFileSync } from 'node:fs';

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

// Cream is :root — the default, and what Auto shows on a light system.
const light = blockAfter(css, ':root {', '\n}');
const white = blockAfter(css, ':root[data-theme="white"], :root:not([data-theme]) {', '\n}');
// The two night blocks are hand-duplicated: one for the explicit [data-theme] pin, one for the OS
// preference. A media query cannot join a selector list, so the duplication is unavoidable.
const darkPinned = blockAfter(css, ':root[data-theme="night"] {', '\n}');
const darkAuto = blockAfter(css, ':root:not([data-theme="cream"]):not([data-theme="white"]) {', '\n  }');

test('every theme block only overrides :root — none introduces a property of its own', () => {
  for (const block of [white, darkPinned, darkAuto]) {
    const introduced = [...block.keys()].filter((k) => !light.has(k)).sort();
    assert.deepEqual(
      introduced,
      [],
      `declared in a theme block but not in :root — these render as \`unset\` in cream, silently`,
    );
  }
});

test('the two night blocks stay in lockstep', () => {
  assert.deepEqual([...darkPinned.keys()].sort(), [...darkAuto.keys()].sort(), 'key sets diverged');
  const drifted = [...darkPinned.keys()].filter((k) => darkPinned.get(k) !== darkAuto.get(k)).sort();
  assert.deepEqual(drifted, [], 'same property, different value in the two night blocks');
});

// Unscoped, `[data-theme="dark"]` matched the Settings pill that carried the same attribute, and
// the dark pill drew itself in dark-theme ink on a light page. Every theme selector is rooted.
test('theme blocks are scoped to the root element, not to anything carrying the attribute', () => {
  const bare = [...css.matchAll(/^\s*\[data-theme=[^\n]*/gm)].map((m) => m[0].trim());
  assert.deepEqual(bare, [], 'a theme selector that matches any element with the attribute');
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

test('the design kit and the app ship the same token file', (t) => {
  // dev-docs/design/tokens.css is the source that was adopted verbatim (design/README.md).
  // Letting the copies drift is how a fix to one silently fails to reach the app.
  //
  // dev-docs is gitignored, so the kit is only on a machine that has it. Skipped there rather than
  // passed: this check has verified nothing without the kit, and reporting otherwise would be the
  // exact failure mode the design system's own gate is for. It still runs where the edit would
  // happen — nobody changes the kit on a machine that does not have it.
  const KIT = new URL('../../../dev-docs/design/tokens.css', import.meta.url);
  if (!existsSync(KIT)) {
    t.diagnostic('dev-docs/design/tokens.css is not on this machine (gitignored) — SKIPPED, not passed');
    t.skip();
    return;
  }
  assert.equal(css, readFileSync(KIT, 'utf8'), 'apps/web/tokens.css has drifted');
});

// A `hidden` attribute is the app's only mechanism for "this control is not available yet", and
// the whole DOM suite runs with stylesheet loading and computed styles switched off — so nothing
// there can see whether hidden actually hides. It did not: any class setting `display` beats the
// user-agent [hidden] rule, and `.btn` does. Every component that needed hiding had grown a private
// [hidden] override, six of them, and the two buttons added most recently were left out. A repair
// scan and a destructive "anchor anyway" override were both on screen before they were earned.
//
// These are static checks against the stylesheet text, which is all this suite can do — but they
// pin the CLASS of defect rather than the two instances of it.
test('hidden means hidden, for everything, once', () => {
  // Anchored to the start of a line, so it matches the BARE [hidden] selector and not a
  // component-scoped `.thing[hidden]` that would only cover one case again.
  const global = /^\s*\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/m;
  assert.match(html, global, 'one global [hidden] rule, ahead of any class that sets display');

  // And nothing may quietly re-enable a hidden element by setting display on it.
  const offenders = [...html.matchAll(/([^{}]*\[hidden\][^{}]*)\{([^}]*)\}/g)]
    .filter(([, , body]) => /display\s*:/.test(body) && !/display\s*:\s*none/.test(body))
    .map(([, selector]) => selector.trim());
  assert.deepEqual(offenders, [], 'these selectors give a hidden element a display');
});

// The rule above is only worth having if the app actually uses `hidden` to hide things. If a future
// change switched to a `.is-hidden` class, the guard would still pass while protecting nothing.
test('the app hides controls with the attribute that rule is about', () => {
  const hiddenAttrs = [...appJs.matchAll(/\bhidden\b(?=[\s>=])/g)].length;
  assert.ok(hiddenAttrs > 5, `expected the app to render hidden controls, found ${hiddenAttrs}`);
});

// Eyebrow labels are the smallest text in the app — 11px bold caps in --ink-5 — and since cards
// went flat they sit on --bg, not on --panel. The kit's value was tuned against --panel and read
// 4.25:1 on --bg: under WCAG AA, and a defect no eye reports. tokens.css states the ratio the
// token clears; this is what makes that a claim rather than a hope. --panel stays in the set
// because the nav pane's meta counts are --ink-5 on --panel.
const channel = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const luminance = (hex) => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  assert.ok(m, `expected a #rrggbb colour, got "${hex}"`);
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(m[1].slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// A helper that always said "fine" would pass the test below while guarding nothing. Black on
// white is 21:1 by definition, and the kit's original eyebrow ink on the light window is the
// exact failure this file exists to catch — the helper must be able to see it.
test('the contrast helper can see the defect it guards against', () => {
  assert.ok(contrast('#000000', '#ffffff') > 20.9);
  assert.ok(contrast('#7A7266', '#F6F2E9') < 4.5);
});

test('--ink-5 clears WCAG AA on every surface it sits on, in every theme', () => {
  for (const [theme, block] of [['cream', light], ['white', white], ['night', darkPinned]]) {
    for (const surface of ['--bg', '--panel']) {
      const ratio = contrast(block.get('--ink-5'), block.get(surface));
      assert.ok(ratio >= 4.5, `${theme}: --ink-5 on ${surface} is ${ratio.toFixed(2)}:1, AA needs 4.5:1`);
    }
  }
});

// White is Cream with the warmth taken out, and that is a checkable claim rather than a mood:
// every colour it overrides is a grey (R = G = B), and each has the same relative luminance as
// its Cream counterpart — which is what carries every contrast ratio across unchanged — except
// the four surfaces deliberately pinned to #FFFFFF. The warm-tinted shadows must be redeclared
// too: on a white page the tint is all a warm shadow shows.
test('white is cream with the warmth removed: neutral, luminance-matched, shadows included', () => {
  const pinned = new Set(['--bg', '--panel', '--on-ink', '--invert-fg']);
  let matched = 0;
  for (const [k, v] of white) {
    if (!/^#[0-9a-f]{6}$/i.test(v)) continue;
    const [r, g, b] = [1, 3, 5].map((i) => v.slice(i, i + 2).toLowerCase());
    assert.ok(r === g && g === b, `${k}: ${v} is not a neutral grey`);
    if (pinned.has(k)) { assert.equal(v.toUpperCase(), '#FFFFFF', `${k} is pinned to white`); continue; }
    const drift = Math.abs(luminance(v) - luminance(light.get(k)));
    assert.ok(drift < 0.005, `${k}: luminance ${luminance(v).toFixed(4)} vs cream ${luminance(light.get(k)).toFixed(4)}`);
    matched += 1;
  }
  assert.ok(matched >= 15, `expected the ink, line and surface set to be matched, got ${matched}`);
  for (const k of ['--shadow-card', '--shadow-raise', '--shadow-win', '--shadow-sheet']) {
    assert.ok(white.has(k) && !/36,31,24/.test(white.get(k)), `${k} must be redeclared without the warm tint`);
  }
});
