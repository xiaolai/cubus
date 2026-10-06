// The app's audio starts on a real engine once a person has touched the page (lib/sound.js;
// dev-docs/scan-guidance-plan.md 3.2).
//
// test/sound.test.mjs holds the contract against a stand-in; this asks the engines the builds run
// in whether a real AudioContext actually reaches `running` after one trusted click — WebKit, the
// macOS and iOS webview's engine, and Chromium, WebView2's and Android's. Autoplay policy is the
// thing a stand-in cannot model. What it does NOT check is each shipped webview itself (a WKWebView
// inside the desktop shell, Android's WebView): those are checked on the builds.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { startBrowserFixture } from './harness.mjs';
import { pace } from '../browser-wait.mjs';

// Each engine's browser and server are closed as its own test ends, not at the end of the file: one
// WebKit alive through the Chromium run is two browsers on a runner that has to fit both (audit,
// 2026-09-19). The list is the backstop for a test that threw before its own close.
const fixtures = new Set();
after(async () => { for (const f of fixtures) await f.close().catch(() => {}); });

for (const engine of ['webkit', 'chromium']) {
  test(`${engine}: no audio before a gesture; running after one click, and a chime is made`, async () => {
    const fixture = await startBrowserFixture({ engine });
    fixtures.add(fixture);
    try {
      const context = await fixture.browser.newContext({ viewport: { width: 1280, height: 1012 } });
      const page = pace(await context.newPage());
      // The page's own words, for the assertions below: `say()` logs a line it could not play, and a
      // failure message that cannot quote the app is a failure message that needs another CI round
      // to understand (2026-09-19).
      const logged = [];
      page.on('console', (m) => { if (m.text().includes('[cubus]')) logged.push(m.text()); });
      page.on('pageerror', (e) => logged.push(`pageerror: ${e.message}`));
      await page.goto(`${fixture.base}/#/settings`);
      // The sound control, which is how this test knows Settings is drawn. It was a single toggle
      // until 2026-09-20, then three pills (voice / chime / off), and two since 2026-09-30 when the
      // spoken lines were deleted. This suite is in the BROWSER tier, which `pnpm check:fast` does
      // not run, so each rename has gone unnoticed through a green fast gate —
      // `settings-key-drift.test.mjs` is the guard that makes the next one loud, and waiting on the
      // mode that SURVIVED rather than a named casualty is what stops this line breaking again.
      await page.waitForSelector('[data-set-sound="chime"]');
      const state = () => page.evaluate(async () => (await import('/lib/sound.js')).audioState());
      assert.equal(await state(), 'none', 'audio existed before anyone touched the page');
      await page.mouse.click(4, 4);
      await page.waitForFunction(async () => (await import('/lib/sound.js')).audioState() === 'running', null, { timeout: 10_000 });
      assert.equal(await page.evaluate(async () => (await import('/lib/sound.js')).play('capture')), true);
      // THE SPOKEN LINES ARE GONE (owner, 2026-09-30), and with them the reason this case also
      // asked whether the engine could speak. The app has no voice to offer, so there is no
      // platform capability left to measure here — only whether audio starts, above.
      await context.close();
    } finally {
      await fixture.close();
      fixtures.delete(fixture);
    }
  });
}

// ---- the context does not hold the audio session while nothing plays (2026-09-30) -------------
//
// A running AudioContext holds the platform's audio session for as long as it lives — on macOS and
// iOS that is the "something is playing" indicator and a device that will not idle. Measured on the
// real page: the context reached `running` on the FIRST GESTURE and was still running ten seconds
// later, with nothing scheduled and nothing ever played.
//
// ON A REAL ENGINE BECAUSE AUTOPLAY POLICY IS WHAT A STAND-IN CANNOT MODEL, and suspending is only
// safe if a later chime can WAKE it. A scan capture is driven by the camera, not by a touch, so the
// resume that follows it has no user gesture of its own. Both engines allow it once the page has
// been activated at least once — measured here rather than assumed, because if either stopped
// allowing it this fix would silence every chime after the first quiet spell.
for (const engine of ['webkit', 'chromium']) {
  test(`${engine}: the context goes quiet when idle, and a later chime still wakes it`, async () => {
    const fixture = await startBrowserFixture({ engine });
    fixtures.add(fixture);
    try {
      const context = await fixture.browser.newContext({ viewport: { width: 1280, height: 1012 } });
      const page = pace(await context.newPage());
      await page.goto(`${fixture.base}/index.html#/home`);
      await page.waitForSelector('.screen.active');
      await page.addScriptTag({
        type: 'module',
        content: `
          import { audioState, play, IDLE_SUSPEND_MS } from '/lib/sound.js';
          import { settings } from '/lib/app-settings.js';
          window.__audio = { audioState, play, settings, IDLE_SUSPEND_MS };
        `,
      });
      await page.waitForFunction(() => Boolean(window.__audio));
      const state = () => page.evaluate(() => window.__audio.audioState());
      const grace = await page.evaluate(() => window.__audio.IDLE_SUSPEND_MS);
      /** Wait out the idle grace with room for the engine to act on it. */
      const settle = () => page.waitForTimeout(grace + 1500);
      /**
       * Wait for a state the engine must REACH, rather than sleeping and hoping it already has.
       *
       * `waitForTimeout(200)` then `assert.equal(..., 'running')` is a performance assertion wearing a
       * wait's clothes: it passes alone and fails under a loaded full-tier run, where WebKit needs
       * longer than 200ms to start an audio session. Measured 2026-10-07 — this case failed at its
       * precondition inside `pnpm check` after 4.4s, and passed on its own in 10.2s, having asserted
       * nothing different. The bound here is LIVENESS: the engine must get there, and fifteen seconds
       * is not a claim about how fast.
       */
      const reach = (want, why) => page
        .waitForFunction((w) => window.__audio.audioState() === w, want, { timeout: 15_000 })
        .catch(async (cause) => { throw new Error(`${why} — it was "${await state()}"`, { cause }); });

      // SOUNDS OFF OPENS NOTHING. `unlock` is bound to every pointerdown on the document, so this
      // is the case where a person who wants silence was given an audio session anyway.
      await page.evaluate(() => { window.__audio.settings.soundMode = 'off'; });
      await page.mouse.click(200, 300);
      await page.waitForTimeout(300);
      assert.equal(await state(), 'none', 'a gesture with sound off opened an audio context');

      // Sound on: one real click wakes it, and a chime is played.
      await page.evaluate(() => { window.__audio.settings.soundMode = 'chime'; });
      await page.mouse.click(200, 300);
      await reach('running', 'precondition: a click did not start audio');
      assert.equal(await page.evaluate(() => window.__audio.play('capture')), true, 'precondition: the chime was refused');

      // The grace is slept through first — the claim is about what happens AFTER it — and only then is
      // the engine given time to act on it.
      await settle();
      await reach('suspended', 'the context was left running with nothing to play');

      // THE HALF THAT MAKES SUSPENDING SAFE. No gesture here on purpose: a scan capture is the
      // camera's doing, and this is the resume that follows it.
      assert.equal(await page.evaluate(() => window.__audio.play('done')), true, 'a chime after the idle suspend was refused');
      await page.waitForFunction(() => window.__audio.audioState() === 'running', null, { timeout: 8000 })
        .catch(() => { throw new Error(`${engine}: a chime with no gesture could not wake a suspended context`); });

      // And it goes quiet again afterwards, so this is a cycle rather than a one-off.
      await settle();
      await reach('suspended', 'the context stayed running after the second chime');
    } finally {
      await fixture.close();
      fixtures.delete(fixture);
    }
  });
}
