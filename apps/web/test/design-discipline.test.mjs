// Design discipline — the stylesheet is held to the token system it claims to be built on.
//
// The drift this guards is the kind with no symptom: three different hand-typed blacks for the
// same sticker hairline under a comment claiming they were "in line"; five controls easing with
// the motion token while ten beside them snapped; a radius of 12px sitting next to the token that
// IS 12px; a var() fallback quietly diverging from the token it shadows. Each of those shipped,
// none of them failed anything, and every one was found by reading. These tests make the reading
// mechanical:
//
//   - every colour literal in the sheet is NAMED, with a reason, at its exact count — a new
//     literal fails until it is either tokenized or added here with its justification, and a
//     removed one fails until the list stops claiming it;
//   - radii come from the scale (or are 0 / 50% / the pill), full stop;
//   - durations come from the motion tokens — a transition or animation carrying a bare number
//     is a second timing system;
//   - every :hover in the sheet lands on a control the motion rule eases — a control that snaps
//     reads as a different product from the one beside it that fades;
//   - no var() carries a fallback for a token that tokens.css defines — a fallback that can
//     drift from its token is a second value wearing the token's name.
//
// app.js is held to the colour rule only: its inline styles are template-drawn (pictograms,
// chart marks) and its two colour tables are data, not theme — the palette mirror and the
// traffic-light portraits are stripped before the sweep, so anything else with a colour in it
// is a finding.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const appJs = readFileSync(new URL('../lib/app.js', import.meta.url), 'utf8');
const tokensCss = readFileSync(new URL('../tokens.css', import.meta.url), 'utf8');

const rawSheet = html.slice(html.indexOf('<style>') + '<style>'.length, html.indexOf('</style>'));
/** Comments talk ABOUT values ("the net's .28…"), so they are stripped before any sweep. */
const sheet = rawSheet.replace(/\/\*[\s\S]*?\*\//g, '');

// ---- colours ----------------------------------------------------------------------------------

/** Every colour literal the sheet is allowed to carry, at its exact count, with the reason it is
 *  a literal rather than a token. The count is part of the contract: reusing an allowed value in
 *  a NEW place is a new decision, and it comes here to be written down. */
const COLOR_ALLOWLIST = new Map([
  ['#C42B1C', { count: 2, why: 'the Windows close-button red — OS-owned, theme-invariant (tokens.css); a token would invite theming it' }],
  ['#fff', { count: 3, why: 'ink on the OS close red (×2), and the centre-rescan glyph that must read on all six sticker colours' }],
  ['rgba(0,0,0,.18)', { count: 1, why: 'the traffic-light preview hairline — a portrait of macOS, not a theme colour' }],
  ['rgba(0,0,0,.25)', { count: 1, why: 'the toggle knob’s shadow — an 18px knob; the elevation tokens are surface-scale' }],
  ['rgba(255,255,255,.26)', { count: 1, why: 'the sticker bevel’s light edge — drawn ON sticker colours, not on a theme surface' }],
  ['rgba(0,0,0,.10)', { count: 1, why: 'the sticker bevel’s dark edge — same' }],
  ['rgba(0,0,0,.95)', { count: 1, why: 'the rescan glyph’s tight halo — contrast against arbitrary sticker colours' }],
  ['rgba(0,0,0,.55)', { count: 1, why: 'the rescan glyph’s soft halo — same' }],
]);

const colourLiterals = (css) => css.match(/#[0-9A-Fa-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g) ?? [];

test('every colour literal in the sheet is named, justified, and counted', () => {
  const found = new Map();
  for (const c of colourLiterals(sheet)) found.set(c, (found.get(c) ?? 0) + 1);
  for (const [value, n] of found) {
    const allowed = COLOR_ALLOWLIST.get(value);
    assert.ok(allowed, `colour literal ${value} (×${n}) is not in the allowlist — tokenize it, or name it here with its reason`);
    assert.equal(n, allowed.count, `${value} appears ${n}× but the allowlist says ${allowed.count} — a new use of an allowed literal is a new decision; write it down`);
  }
  for (const [value, { count }] of COLOR_ALLOWLIST) {
    assert.ok(found.has(value), `the allowlist claims ${value} (×${count}) but the sheet no longer carries it — the list must not outlive the literal`);
  }
});

test('app.js carries no colour literals outside its two data tables', () => {
  // The palette mirror (NET_COLORS) is puzzle data — the same colours cubus-cube.js paints —
  // and the preview traffic lights are a portrait of macOS. Both stripped whole; anything left
  // holding a colour is a finding.
  const stripped = appJs
    .replace(/const NET_COLORS = \{[\s\S]*?\n\};/, '')
    .replace(/^.*\['#E8695E', '#E0B341', '#5FB55F'\].*$/m, '');
  const leftovers = colourLiterals(stripped);
  assert.deepEqual(leftovers, [], `app.js colour literals outside the data tables: ${leftovers.join(', ')} — use a token`);
});

// ---- radii ------------------------------------------------------------------------------------

test('every border-radius in the sheet comes from the scale', () => {
  const decls = [...sheet.matchAll(/border-radius:\s*([^;}]+)/g)].map((m) => m[1].trim());
  assert.ok(decls.length > 5, 'precondition: the sheet declares radii');
  for (const value of decls) {
    for (const part of value.split(/\s+/)) {
      assert.match(part, /^(var\(--r-[a-z0-9-]+\)|0|50%)$/,
        `border-radius "${value}" — every radius is a token (var(--r-*)), 0, or 50%; a bare number is a scale of one`);
    }
  }
});

// ---- motion -----------------------------------------------------------------------------------

const BARE_DURATION = /(?:^|[\s,(])\.?\d+(?:\.\d+)?m?s\b/;

test('transitions and animations take their time from the motion tokens', () => {
  for (const [, value] of sheet.matchAll(/(?:transition|animation):\s*([^;}]+)/g)) {
    assert.ok(!BARE_DURATION.test(value),
      `"${value.trim()}" carries a bare duration — use var(--fade), var(--turn-ms), var(--pulse) or var(--pulse-alert); a literal is a second timing system`);
  }
});

/** The controls the shared motion rule eases. Mirrored here BY HAND: the test below holds every
 *  :hover in the sheet against this list, so adding a hoverable control means adding it to the
 *  motion rule in index.html AND here — the pair is what keeps the claim and the sheet aligned. */
const EASED = [
  '.btn', '.pill', '.nav-item', '.tb-ctl', '.tbtn', '.tb-cap', '.menu > button',
  '.card-tools > button', '.eyebrow-row > button', '.chip-m', '.swatches > button',
  '.field', '.link', '.toggle', '.tgrid > .cell',
];

test('every control the sheet eases is really in a transition rule', () => {
  const easedRules = [...sheet.matchAll(/([^{}]+)\{[^{}]*transition:[^{}]*\}/g)].map((m) => m[1]);
  const easedSelectors = easedRules.join('\n');
  for (const sel of EASED) {
    assert.ok(easedSelectors.includes(sel), `${sel} is listed as eased but no transition rule covers it`);
  }
});

test('every :hover in the sheet lands on an eased control', () => {
  const hoverSelectors = [...sheet.matchAll(/([^{}]+):hover[^{}]*\{/g)].map((m) => `${m[1]}:hover`);
  assert.ok(hoverSelectors.length > 10, 'precondition: the sheet has hover rules');
  for (const sel of hoverSelectors) {
    assert.ok(EASED.some((key) => sel.includes(key)),
      `"${sel.trim()}" hovers a control the motion rule does not ease — add it to the :is() rule in index.html and to EASED here`);
  }
});

// ---- fallbacks --------------------------------------------------------------------------------

test('no var() shadows a defined token with a fallback', () => {
  const defined = new Set([...tokensCss.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  for (const [, name, fallback] of sheet.matchAll(/var\((--[a-z0-9-]+)\s*,\s*([^)]+)\)/g)) {
    assert.ok(!defined.has(name),
      `var(${name}, ${fallback.trim()}) — the token is defined in tokens.css, so the fallback never fires and can silently drift from it; drop it`);
  }
});

// ---- the sticker tokens do the job they were made for ----------------------------------------

test('drawn stickers wear the shared edge and corner', () => {
  const edges = (sheet.match(/var\(--sticker-edge\)/g) ?? []).length;
  const corners = (sheet.match(/var\(--r-sticker\)/g) ?? []).length;
  assert.ok(edges >= 5, `--sticker-edge is used ${edges}× — the net, the scan grid and the three swatch rings all wear it; fewer means one drifted back to a literal`);
  assert.ok(corners >= 2, `--r-sticker is used ${corners}× — the net and the scan grid corners come from it`);
});
