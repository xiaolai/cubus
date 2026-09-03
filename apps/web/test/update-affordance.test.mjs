// The self-updater is REACHED, not just correct.
//
// This is the test that was missing when the feature shipped inert in 0.2.4. `makeUpdater` and
// `selfUpdateSupported` were both right and both covered; the wiring between them and the host was
// not, and that is where it broke — `const updater = … hostPlatform() …` evaluated at module load,
// before `boot()` publishes `<html data-platform>`, so the gate asked which platform it was on
// before anything had said, got null, and disabled itself on every platform at once. No Settings
// row, no launch check, nothing to see, and every unit test still green.
//
// So this one boots the REAL app in a REAL engine with a REAL platform, and looks for the button
// with its eyes. A unit test could not have caught it and a second unit test would not either.
//
// Runs in headless WebKit, the engine every shipped build uses.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright';

import { pace } from './browser-wait.mjs';
import { freePort } from './free-port.mjs';

const SERVE = fileURLToPath(new URL('../serve.mjs', import.meta.url));
let BASE;
let proc;
let browser;

before(async () => {
  const port = await freePort();
  BASE = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, [SERVE], {
    env: { ...process.env, PORT: String(port), CUBUS_LIVE_RELOAD: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('serve.mjs did not start within 20s')), 20_000);
    proc.stdout.on('data', (d) => {
      if (d.toString().includes(`:${port}`)) {
        clearTimeout(t);
        resolve();
      }
    });
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

/**
 * Open Settings on a given platform, with the Tauri API injected or not, and report what the
 * About card offers.
 *
 * `?platform=` is the app's own pin (detectPlatform), which is what makes a desktop-only
 * affordance testable from one machine — and what makes a phone's ABSENCE testable at all.
 */
async function settingsOn(platform, { tauri = true } = {}) {
  const page = await browser.newPage();
  pace(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  if (tauri) {
    await page.addInitScript(() => {
      window.__TAURI__ = {
        core: { invoke: () => Promise.resolve(null) },
        event: { listen: () => Promise.resolve(() => {}) },
        window: { getCurrentWindow: () => ({ setTitle() {}, minimize() {}, close() {} }) },
        // Present but never called here: the launch check is throttled and the button is not
        // pressed. Its absence would be indistinguishable from the bug this file exists for.
        updater: { check: () => Promise.resolve(null) },
        process: { relaunch: () => Promise.resolve() },
        dialog: { ask: () => Promise.resolve(false), message: () => Promise.resolve() },
      };
    });
  }
  await page.goto(`${BASE}/?platform=${platform}#/settings`);
  await page.waitForSelector('.screen.active');
  const seen = await page.evaluate(() => ({
    platform: document.documentElement.dataset.platform,
    host: document.documentElement.dataset.host,
    check: !!document.querySelector('#checkUpdate'),
  }));
  await page.close();
  assert.deepEqual(errors, [], `the page threw on ${platform}`);
  return seen;
}

// The three desktops. Each is a separate case rather than a loop, so a failure names the platform
// in the test title instead of only in an assertion message.
for (const platform of ['macos', 'windows', 'linux']) {
  test(`a Tauri ${platform} build offers Check now in Settings`, async () => {
    const seen = await settingsOn(platform);
    assert.equal(seen.platform, platform, 'the platform pin did not take');
    assert.equal(seen.host, 'tauri', 'the app did not see the injected API');
    assert.ok(
      seen.check,
      `no #checkUpdate button on ${platform}. This is exactly how the feature shipped inert in ` +
        '0.2.4: the gate ran before boot published <html data-platform>, so it read null and ' +
        'disabled itself everywhere. See appUpdater() in lib/app.js.',
    );
  });
}

// The other half of the seam, and the reason the gate is not just "is Tauri present": the phone
// shells inject the identical API. An affordance that appeared there would be a screen that exists
// on one build only, which is the line AGENTS.md draws.
for (const platform of ['ios', 'android']) {
  test(`a Tauri ${platform} build offers nothing to update`, async () => {
    const seen = await settingsOn(platform);
    assert.equal(seen.host, 'tauri', 'the phone shells inject the same API — that is the point');
    assert.ok(!seen.check, `${platform} updates through its store and must not offer Check now`);
  });
}

test('the browser build offers nothing to update', async () => {
  // No injected API at all: whatever the server last served is already the newest there is.
  const seen = await settingsOn('macos', { tauri: false });
  assert.equal(seen.host, 'web');
  assert.ok(!seen.check, 'a browser has nothing to self-update');
});
