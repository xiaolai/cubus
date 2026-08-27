// The layout contract's foundation, pinned — dev-docs/stage-contract.md.
//
// Under the contract the viewport is not the stage: on a phone it also holds the OS insets and the
// app's bars, on the desktop it is a window the app itself chose. Every layout decision therefore
// asks a CONTAINER (.app for chrome, .stage for screens) and never the window. A viewport
// width/height media query — or a matchMedia on one — is the wrong signal by construction, and
// the day one appears is the day the two compositions start growing a third. This file makes that
// day fail `pnpm check`.
//
// What stays allowed, deliberately: @container (the mechanism), orientation, prefers-* (colour
// scheme, reduced motion — the pulse animations need it), and pointer (touch floors).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const html = read('../index.html');
const tokens = read('../tokens.css');
const libFiles = readdirSync(new URL('../lib/', import.meta.url)).filter((f) => f.endsWith('.js'));
const lib = Object.fromEntries(libFiles.map((f) => [f, read(`../lib/${f}`)]));
const sources = { 'index.html': html, 'tokens.css': tokens, ...Object.fromEntries(Object.entries(lib).map(([f, s]) => [`lib/${f}`, s])) };

/** `/* … *​/` and `// …` stripped, so a comment explaining the ban does not trip it. */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('no viewport width/height media query anywhere in the app', () => {
  const hits = [];
  for (const [name, s] of Object.entries(sources)) {
    for (const m of code(s).matchAll(/@media[^{]*\b(?:min|max)-(?:width|height)\b[^{]*/g)) hits.push(`${name}: ${m[0].trim()}`);
  }
  assert.deepEqual(hits, [], 'a viewport size query — ask the container instead');
});

test('no matchMedia on a viewport size anywhere in the app', () => {
  const hits = [];
  for (const [name, s] of Object.entries(lib)) {
    for (const m of code(s).matchAll(/matchMedia\([^)]*\b(?:width|height)\b[^)]*\)/g)) hits.push(`lib/${name}: ${m[0]}`);
  }
  assert.deepEqual(hits, []);
});

test('the only media queries left are the allowed features', () => {
  const allowed = /^\(\s*(?:prefers-[a-z-]+|orientation|pointer|hover)\s*:/;
  const features = [];
  for (const [name, s] of Object.entries(sources)) {
    for (const m of code(s).matchAll(/@media\s+([^{]+)\{/g)) features.push([name, m[1].trim()]);
  }
  const offenders = features.filter(([, f]) => !allowed.test(f)).map(([n, f]) => `${n}: @media ${f}`);
  assert.deepEqual(offenders, []);
});

test('app.js no longer reads the viewport to place anything', () => {
  // The popovers were clamped to window.innerWidth/innerHeight; they are clamped to the stage now.
  assert.doesNotMatch(code(lib['app.js']), /window\.inner(?:Width|Height)|documentElement\.client(?:Width|Height)/);
});

// ---- the foundation index.html must declare ---------------------------------------------------

/** The declarations of the first rule whose selector list is exactly `selector`. */
const rule = (selector) => {
  const m = new RegExp(`(?:^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(code(html));
  assert.ok(m, `index.html has no rule for ${selector}`);
  return m[1];
};

test('the page is allowed under the notch and behind the home indicator', () => {
  assert.match(html, /<meta name="viewport" content="[^"]*\bviewport-fit=cover\b[^"]*"/);
});

test('.app is the OS-safe area and a size container named app', () => {
  const app = rule('.app');
  assert.match(app, /height:\s*100dvh/, '100dvh, not 100vh: the dynamic viewport is the one a phone actually shows');
  assert.match(app, /container-type:\s*size/);
  assert.match(app, /container-name:\s*app/);
  for (const side of ['top', 'right', 'bottom', 'left']) {
    assert.match(app, new RegExp(`env\\(safe-area-inset-${side}`), `no safe-area-inset-${side}`);
  }
  assert.doesNotMatch(code(html), /100vh/, 'a 100vh survived somewhere');
});

test('.stage is a positioned size container named stage', () => {
  const stage = rule('.stage');
  assert.match(stage, /container-type:\s*size/);
  assert.match(stage, /container-name:\s*stage/);
  assert.match(stage, /position:\s*relative/, 'the popovers are its absolutely positioned children');
});

test('the reference box is declared for both orientations, on the screen, by asking the stage', () => {
  const src = code(html);
  const landscape = rule('.screen');
  assert.match(landscape, /--ref-w:\s*min\(100cqw,\s*100cqh \* 4 \/ 3\)/);
  assert.match(landscape, /--ref-h:\s*min\(100cqh,\s*100cqw \* 3 \/ 4\)/);
  const portrait = /@container stage \(orientation: portrait\)\s*\{\s*\.screen\s*\{([^}]*)\}/.exec(src);
  assert.ok(portrait, 'no portrait container query on the stage');
  assert.match(portrait[1], /--ref-w:\s*min\(100cqw,\s*100cqh \* 3 \/ 4\)/);
  assert.match(portrait[1], /--ref-h:\s*min\(100cqh,\s*100cqw \* 4 \/ 3\)/);
});

test('the popovers are absolute, not fixed — the stage is their box', () => {
  const pop = rule(':is(.swatches, .menu)');
  assert.match(pop, /position:\s*absolute/);
  assert.doesNotMatch(pop, /100dvh/, 'a viewport-relative cap on a stage-relative surface');
});

test('the desktop shell declares the WebKit floor the container units need', () => {
  const conf = JSON.parse(read('../../desktop/src-tauri/tauri.conf.json'));
  assert.equal(conf.bundle.macOS.minimumSystemVersion, '13.0');
});
