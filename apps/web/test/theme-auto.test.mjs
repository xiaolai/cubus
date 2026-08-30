// What Auto resolves to, in a real cascade.
//
// Auto is not a theme, it is a policy: follow the system. As of 2026-08-31 the light half of
// that policy is WHITE — cream became the warm option you choose rather than the default you
// get. That is expressed by one selector list in tokens.css, and the whole thing turns on
// specificity, which no amount of reading the file proves.
//
// The trap it is really guarding: `:root:not([data-theme])` is (0,2,0) and OUTRANKS the
// `@media (prefers-color-scheme: dark) { :root { color-scheme: dark } }` rule, which is (0,1,0).
// Putting `color-scheme: light` in the shared rule would therefore light-scheme every dark Auto
// window — light scrollbars and form controls over dark surfaces — while every colour token
// stayed correctly dark. Static CSS tests cannot see that; a browser resolving the cascade can.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright';

import { freePort } from './free-port.mjs';

const SERVE = fileURLToPath(new URL('../serve.mjs', import.meta.url));
let proc;
let browser;
let base;

const WHITE = 'rgb(255, 255, 255)';
const CREAM = 'rgb(246, 242, 233)'; // #F6F2E9
const NIGHT = 'rgb(27, 24, 20)';    // #1B1814

before(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, [SERVE], {
    env: { ...process.env, PORT: String(port), CUBUS_LIVE_RELOAD: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let said = '';
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`serve.mjs did not start within 20s. It said: ${said.trim() || '(nothing)'}`)),
      20_000,
    );
    const note = (d) => { said += d.toString(); if (said.includes(`:${port}`)) { clearTimeout(timeout); resolve(); } };
    proc.stdout.on('data', note);
    proc.stderr.on('data', (d) => { said += d.toString(); });
    proc.on('error', reject);
  });
  try {
    browser = await webkit.launch();
  } catch (cause) {
    throw new Error('WebKit for Playwright is not installed — run: pnpm --filter cubus-web exec playwright install webkit', { cause });
  }
});

after(async () => {
  await browser?.close();
  proc?.kill('SIGTERM');
});

/** Resolve the window's surface and colour-scheme under a stored theme and a system preference. */
async function resolved(stored, colorScheme) {
  const page = await browser.newPage({ colorScheme });
  await page.addInitScript((theme) => {
    localStorage.setItem('cubusSettings', JSON.stringify({
      theme, palette: 'muted', autosolve: false, cameraId: '', navHidden: [],
      navDefaults: 99, language: '', dragRotate: false,
    }));
  }, stored);
  await page.goto(`${base}/index.html`);
  // The attribute is what applyTheme() writes; read it too, so a test that passes because the
  // app quietly stopped storing the theme is distinguishable from one that passes correctly.
  const out = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return {
      bg: cs.getPropertyValue('--bg').trim(),
      body: getComputedStyle(document.body).backgroundColor,
      scheme: cs.colorScheme,
      attr: document.documentElement.getAttribute('data-theme'),
    };
  });
  await page.close();
  return out;
}

const hex = (v) => v.toLowerCase();

test('Auto on a light system is WHITE, not cream', async () => {
  const r = await resolved('auto', 'light');
  assert.equal(r.attr, null, 'Auto must leave the attribute off — that is what the selector keys on');
  assert.equal(hex(r.bg), '#ffffff', `Auto/light resolved --bg to ${r.bg}`);
  assert.equal(r.body, WHITE, 'and the window itself must actually be white');
  assert.match(r.scheme, /light/, 'a light system under Auto is a light colour-scheme');
});

test('Auto on a dark system is still Night — colour AND colour-scheme', async () => {
  // The specificity trap, in the direction that fails silently. If `color-scheme: light` ever
  // rides along in the shared white rule, the tokens below still pass and only `scheme` breaks.
  const r = await resolved('auto', 'dark');
  assert.equal(r.attr, null);
  assert.equal(hex(r.bg), '#1b1814', `Auto/dark resolved --bg to ${r.bg}`);
  assert.equal(r.body, NIGHT, 'the window must be night, not white');
  assert.match(r.scheme, /dark/,
    'colour-scheme went light on a dark Auto window — the shared white rule outranks the media '
    + 'query that sets it, so `color-scheme` must not be declared there');
});

test('Cream is still reachable — it is the warm choice, not the default', async () => {
  for (const system of ['light', 'dark']) {
    const r = await resolved('cream', system);
    assert.equal(r.attr, 'cream');
    assert.equal(r.body, CREAM, `cream under a ${system} system came out ${r.body}`);
    assert.match(r.scheme, /light/, 'cream is a light theme whatever the system says');
  }
});

test('an explicit choice still beats the system, both ways', async () => {
  const w = await resolved('white', 'dark');
  assert.equal(w.body, WHITE, 'White pinned under a dark system must stay white');
  assert.match(w.scheme, /light/);

  const n = await resolved('night', 'light');
  assert.equal(n.body, NIGHT, 'Night pinned under a light system must stay night');
  assert.match(n.scheme, /dark/);
});
