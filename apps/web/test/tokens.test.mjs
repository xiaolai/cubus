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

/**
 * The OTHER direction, and the one that was missing.
 *
 * The check above catches a var() naming nothing. This catches a token naming nothing — a value
 * that outlived the layout it was written for and now sits in the file being read as current.
 * Eight pane tokens and eight mobile-chrome tokens were in exactly that state (removed
 * 2026-09-04): a leading pane the navigation replaced, a resizable window the layout contract
 * made fixed, and a per-platform mobile chrome the two compositions replaced.
 *
 * KIT_ONLY is the escape hatch, and it is a list rather than a pattern on purpose: tokens.css is
 * shared verbatim with dev-docs/design, whose mockups legitimately declare a vocabulary the app
 * does not use all of. Adding a name here is a decision somebody has to write down.
 */
const KIT_ONLY = new Set([
  // Surfaces and inks the mockups paint that the app never does: the "desk" outside the window,
  // the selected-row wash, and the inverted-surface text pair (the app's inverted surfaces take
  // their colours from --invert-fg).
  '--desk', '--row-sel', '--on-ink', '--on-ink-dim', '--on-ink-2',
  // Hover and wash variants the kit uses and the app has not needed yet.
  '--accent-hover', '--accent-wash', '--accent-ink', '--accent-ink-2',
  // The camera surfaces. The app draws no viewfinder at all (the scan screen deliberately shows
  // what was READ, never what the lens saw), so the lens palette is the kit's alone.
  '--lens', '--on-lens', '--on-lens-dim', '--on-lens-inverse',
  // Platform type stacks, and the type/space/radius scale in full. The app uses a subset; the
  // scale is the design system's vocabulary and is meant to be complete.
  '--font-ios', '--font-md',
  '--fs-title-l', '--fs-wordmark', '--fs-display-l', '--lh-tight', '--lh-prose',
  '--s-1', '--s-2', '--s-3', '--s-4', '--s-5', '--s-6', '--s-7', '--s-8',
  '--s-10', '--s-11', '--s-12', '--s-13', '--r-1', '--r-card',
  // Elevation the app applies through composed rules rather than by name.
  '--shadow-card', '--shadow-win', '--shadow-sheet',
  // Window chrome the STYLESHEET hard-codes per platform (see the .win rules) and the Rust side
  // owns; kept here because they are measured values worth stating once.
  '--turn-ms', '--r-win-macos', '--r-win-windows', '--r-win-linux',
  '--sys-zone-windows', '--sys-zone-linux',
  // The concentric inset. Not applied by name anywhere: it is the DERIVATION behind --r-card
  // (--r-win-macos − --inset), stated so the relationship between the window's corner and the
  // card's is written down rather than being two numbers that happen to differ by eight.
  '--inset',
  // The renderer's own defaults, documented here and implemented in cubus-cube.js DEFAULTS. A
  // test in that file's suite is what keeps the two agreeing; this is the readable copy.
  '--cube-camera-distance', '--cube-camera-latitude', '--cube-camera-longitude',
  '--cube-facelet-scale', '--cube-ghost-elevation', '--cube-ghost-opacity',
]);

test('every declared token is used, or is named as the kit\'s', () => {
  const used = new Set();
  for (const source of [html, appJs, css]) {
    for (const [, name] of source.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) used.add(name);
  }
  const stranded = [...light.keys()].filter((k) => !used.has(k) && !KIT_ONLY.has(k)).sort();
  assert.deepEqual(stranded, [], 'declared, never used, and not named as kit-only — dead or unwired');
  // And the escape hatch cannot rot either: a name here that the app has since started using is
  // a stale exception, which is how an allowlist quietly becomes a second source of truth.
  const stale = [...KIT_ONLY].filter((k) => used.has(k)).sort();
  assert.deepEqual(stale, [], 'listed as kit-only but the app uses it — drop it from KIT_ONLY');
});

// The OS chrome around the window — a phone's status bar, an installed PWA's title area — is
// painted from these, and they were the cream pair long after Auto resolved to white and night:
// a white window under a cream status bar, and a night window under a lighter brown one. Both
// directions, because a value that is merely PRESENT in the token file proves nothing about
// which token it came from.
test('the chrome colours ARE the Auto theme surfaces, both directions', () => {
  const meta = (scheme) => {
    const m = new RegExp(`<meta name="theme-color" content="(#[0-9A-Fa-f]{6})" media="\\(prefers-color-scheme: ${scheme}\\)"`).exec(html);
    assert.ok(m, `no theme-color meta for ${scheme}`);
    return m[1].toUpperCase();
  };
  // Auto/light is the WHITE block (`:root:not([data-theme])` shares that rule); Auto/dark is the
  // night one. theme-auto.test.mjs proves that resolution in a real cascade.
  assert.equal(meta('light'), white.get('--bg').toUpperCase(), 'light chrome must be the Auto light --bg');
  assert.equal(meta('dark'), darkAuto.get('--bg').toUpperCase(), 'dark chrome must be the Auto dark --bg');

  const manifest = JSON.parse(read('../manifest.webmanifest'));
  for (const key of ['theme_color', 'background_color']) {
    assert.equal(manifest[key].toUpperCase(), white.get('--bg').toUpperCase(),
      `manifest ${key} must be the Auto light --bg (a manifest cannot vary by scheme)`);
  }
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

/** A theme's value for `name`, falling back to :root the way the cascade does. */
const valueIn = (block, name) => block.get(name) ?? light.get(name);
const THEMES = [['cream', light], ['white', white], ['night', darkPinned]];

/**
 * Every token the app sets as `color:` on prose, and the surfaces it sits on.
 *
 * A TABLE, not a sweep, and that is the point: a token's contrast requirement follows from what
 * it is FOR, and only this file can say. Adding a colour to the app without adding it here is
 * possible — no test can read a designer's mind — but the table names every one that exists
 * today, so the class is covered and a new one is a deliberate omission rather than an oversight.
 *
 * Deliberately absent, each for a reason:
 *   --ink-6   disabled text and chevrons. WCAG 1.4.3 exempts inactive components, and the app's
 *             uses are exactly that: the disabled drill placeholder, the unplayed chart bars.
 *   --ok, --warn, --err   the FILLS. They are icon and background colours (a graphic needs 3:1,
 *             checked below), and every SENTENCE in those colours uses the -ink pair.
 *   --on-lens family   text on the camera lens, which is a real dark sensor image in both
 *             themes rather than a theme surface.
 */
const TEXT_ON_SURFACES = [
  '--ink', '--ink-2', '--ink-3', '--ink-4', '--ink-5',
  '--ok-ink', '--warn-ink', '--err-ink',
  '--accent', '--accent-ink', '--accent-ink-2',
];

test('every token used as text clears WCAG AA on --bg and --panel, in every theme', () => {
  const failures = [];
  for (const [theme, block] of THEMES) {
    for (const token of TEXT_ON_SURFACES) {
      for (const surface of ['--bg', '--panel']) {
        const ratio = contrast(valueIn(block, token), valueIn(block, surface));
        if (ratio < 4.5) failures.push(`${theme}: ${token} on ${surface} is ${ratio.toFixed(2)}:1`);
      }
    }
  }
  assert.deepEqual(failures, [], 'AA needs 4.5:1 for text under 18.66px bold / 24px regular');
});

// Text ON a fill is a different pair, and one of them was the worst ratio in the app: white on
// the night --ok is 2.75:1, under even the 3:1 a non-text graphic needs, on the done mark — the
// tick that says you finished. --on-ok exists because of it.
// Text ON a fill is a different pair. --accent-ink is prose on the wash and takes the 4.5:1 text
// floor; --on-accent and --on-ok are ICONS on a saturated fill — the paint-mode roller and the
// done mark, and nothing else — so 1.4.11's 3:1 for a meaningful graphic is the standard that
// applies. If either is ever put on a SENTENCE, it moves to the list above and the floor rises
// with it. The pair that made this worth splitting out is white on the night --ok: 2.75:1, under
// even 3:1, on the tick that says you finished.
test('ink on a saturated fill clears the floor for what it carries', () => {
  const failures = [];
  for (const [theme, block] of THEMES) {
    for (const [ink, fill, floor] of [['--on-accent', '--accent', 3], ['--on-ok', '--ok', 3], ['--accent-ink', '--accent-wash', 4.5]]) {
      const ratio = contrast(valueIn(block, ink), valueIn(block, fill));
      if (ratio < floor) failures.push(`${theme}: ${ink} on ${fill} is ${ratio.toFixed(2)}:1, needs ${floor}:1`);
    }
  }
  assert.deepEqual(failures, []);
});

// The status FILLS are icons and swatches — 1.4.11 asks 3:1 of a graphic that carries meaning,
// and the amber indicator sits on the titlebar's own surface rather than on the window.
// --warn is deliberately absent: since the ink/fill split it is used at exactly one place, the
// battery meter's bar below 40%, which sits inside a bordered box with the percentage printed
// beside it — a graphic whose information is available in text, which 1.4.11 exempts. Every
// warning that is a SHAPE (the unverified badge's border, the anchor-anyway button's) uses
// --warn-ink, which clears the text floor above.
test('every status fill clears the 3:1 a meaningful graphic needs', () => {
  const failures = [];
  for (const [theme, block] of THEMES) {
    for (const token of ['--ok', '--err', '--accent']) {
      for (const surface of ['--bg', '--panel', '--panel-sunk']) {
        const ratio = contrast(valueIn(block, token), valueIn(block, surface));
        if (ratio < 3) failures.push(`${theme}: ${token} on ${surface} is ${ratio.toFixed(2)}:1`);
      }
    }
  }
  assert.deepEqual(failures, [], 'a graphic that carries meaning needs 3:1');
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
