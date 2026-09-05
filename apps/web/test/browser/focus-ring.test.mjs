// The screen is focused on every navigation, and it must not wear a focus ring.
//
// renderScreen (app.js) focuses the screen region after each route change so a screen reader
// announces the route and a keyboard user starts inside it rather than at the top of the
// document (2026-09-05). That region is tabindex −1 — reachable by script, never by Tab — so a
// focus ring on it tells nobody anything. WebKit painted one anyway: at launch no pointer has
// been touched, its focus-visible heuristic counts a script focus as keyboard-driven, and the
// default `outline: auto` drew a blue box round the whole stage. A CSS test can only show that a
// rule exists; this shows what the engine every shipped build actually is resolves for the
// element the app really focuses.
//
// Two facts, asserted together: the focus HAPPENED (or the outline check would be measuring an
// unfocused element and pass for the wrong reason), and the computed outline is none.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright';

import { freePort } from '../free-port.mjs';

const SERVE = fileURLToPath(new URL('../../serve.mjs', import.meta.url));
let proc;
let browser;
let base;

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

/** Load the app fresh — no pointer interaction before the first render, as at launch. */
async function freshScreen(page) {
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.waitForSelector('.screen.active', { state: 'attached' });
  return page.evaluate(() => {
    const screen = document.querySelector('.screen.active');
    const style = getComputedStyle(screen);
    return {
      focused: document.activeElement === screen,
      focusVisible: screen.matches(':focus-visible'),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
    };
  });
}

test('at launch the screen region is focused and draws no focus ring', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
  try {
    const got = await freshScreen(page);
    assert.equal(got.focused, true, 'renderScreen no longer focuses the screen — the outline check below would be vacuous');
    assert.equal(got.outlineStyle, 'none', `the focused screen wears a focus ring: outline ${got.outlineStyle} ${got.outlineWidth} (focus-visible: ${got.focusVisible})`);
  } finally {
    await page.close();
  }
});

test('a navigation focuses the new screen, and it draws no ring either', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
  try {
    await freshScreen(page);
    // Keyboard, not pointer: a Tab is what makes every engine's heuristic paint rings from then
    // on, which is exactly the state a keyboard user navigates in.
    await page.keyboard.press('Tab');
    await page.evaluate(() => location.assign('#/settings'));
    await page.waitForFunction(() => document.querySelector('.screen.active')?.getAttribute('aria-label') !== 'Cubus');
    const got = await page.evaluate(() => {
      const screen = document.querySelector('.screen.active');
      return { focused: document.activeElement === screen, outlineStyle: getComputedStyle(screen).outlineStyle };
    });
    assert.equal(got.focused, true, 'the new screen was not focused after a navigation');
    assert.equal(got.outlineStyle, 'none', `the navigated-to screen wears a focus ring: outline ${got.outlineStyle}`);
  } finally {
    await page.close();
  }
});
