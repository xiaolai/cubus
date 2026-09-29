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
      // until 2026-09-20 and is three pills now (voice / chime / off); this suite is in the BROWSER
      // tier, which `pnpm check:fast` does not run, so the rename went unnoticed through a green
      // fast gate. `settings-key-drift.test.mjs` is the guard that makes the next one loud.
      await page.waitForSelector('[data-set-sound="voice"]');
      const state = () => page.evaluate(async () => (await import('/lib/sound.js')).audioState());
      assert.equal(await state(), 'none', 'audio existed before anyone touched the page');
      await page.mouse.click(4, 4);
      await page.waitForFunction(async () => (await import('/lib/sound.js')).audioState() === 'running', null, { timeout: 10_000 });
      assert.equal(await page.evaluate(async () => (await import('/lib/sound.js')).play('capture')), true);
      // The system voice (lib/speech.js): offered where the engine has one, and saying a line raises
      // nothing. Whether a voice is actually HEARD is not something a headless engine can tell.
      // Queued is not spoken: the platform fails a line asynchronously, after `say()` has returned and
      // after this evaluate would have (audit, 2026-09-19). So the failure channel is armed first and
      // the page is given time to use it, and the line is only called good if nothing came back.
      const spoke = await page.evaluate(async () => {
        const speech = await import('/lib/speech.js');
        // VOICE IS ASKED FOR, NOT INHERITED. The default sound mode became `chime` on 2026-09-21, and
        // `say()` is gated on the mode — so a test about whether the PLATFORM can speak has to select
        // the mode that speaks, or it measures the default instead of the engine.
        (await import('/lib/app-settings.js')).settings.soundMode = 'voice';
        const can = typeof speechSynthesis === 'object' && typeof SpeechSynthesisUtterance === 'function';
        if (!can) return { can, said: null, failure: null, settled: null };
        // Every call, as it arrived: a message saying "null" cannot tell a handler that never ran from
        // one that reported nothing, and one CI round per guess is too slow (2026-09-19).
        const failures = [];
        const calls = [];
        // The utterance's OWN terminal event, not a fixed wait: a failure arriving a moment after
        // whatever span this test guessed would go unseen (audit, 2026-09-19). A line that neither
        // ends nor fails inside the bound is reported as that, rather than as a pass.
        let settle;
        const done = new Promise((r) => {
          settle = r;
        });
        let reason = null;
        let spoken = null;
        /** Every utterance this engine made, so "which line failed" is answerable. */
        const made = [];
        const engine = {
          synth: speechSynthesis,
          Utterance: class extends SpeechSynthesisUtterance {
            constructor(text) {
              super(text);
              spoken = this;
              made.push(text);
              this.addEventListener('end', () => settle('ended'));
              this.addEventListener('error', (e) => {
                // Only the line THIS test asked for: another utterance failing would be a different
                // claim, and the two channels below are about one line (CI, 2026-09-19).
                if (this !== spoken) return;
                reason = e.error ?? 'unnamed';
                settle('error');
              });
            }
          },
        };
        const was = speech.useSpeechEngine(() => engine);
        const said = speech.say('Got it!', 'en', {
          onFail: (e) => {
            calls.push(String(e));
            failures.push(e);
          },
        });
        const settled = await Promise.race([
          done,
          new Promise((r) => setTimeout(() => r('still speaking after 10s'), 10_000)),
        ]);
        // LET THE REST OF THE LISTENERS RUN. `done` resolves inside the FIRST listener on the
        // utterance, and a promise taken there resumes at the microtask checkpoint between listeners —
        // so reading the app's failure channel here reads it before the app's own listener has run.
        // On a runner with no voices that looked exactly like a channel that never fires: 0 calls, an
        // empty page log, and an utterance that had plainly failed (CI, 2026-09-19).
        await new Promise((r) => setTimeout(r, 50));
        speech.hush();
        speech.useSpeechEngine(was);
        return {
          can, said, settled, reason, calls,
          failure: failures[0] ?? null,
          voices: speechSynthesis.getVoices().length,
          utterances: made.length,
        };
      });
      assert.equal(spoke.can, true, `${engine} has no speechSynthesis`);
      assert.equal(spoke.said, true);
      // A line either FINISHES, or the platform says it cannot speak — a CI runner has the API and no
      // voices installed, and that is a fact about the machine, not a defect (CI, 2026-09-19). What
      // must never happen is the one reason that WOULD be ours: `not-allowed`, which is the engine
      // saying a gesture was needed, after this test has already clicked.
      assert.notEqual(spoke.reason, 'not-allowed', `${engine} wanted another gesture after the click`);
      const voiceless = new Set(['canceled', 'interrupted', 'synthesis-failed', 'synthesis-unavailable',
        'voice-unavailable', 'language-unavailable', 'audio-busy', 'audio-hardware']);
      assert.ok(spoke.settled === 'ended' || voiceless.has(spoke.reason),
        `${engine} ended the line as ${spoke.settled} (${spoke.reason}), with ${spoke.voices} voices`);
      // …and whichever happened, the two channels agree: a failure the caller was told about is a
      // failure the utterance reported, and a cut-off is not reported as a failure at all.
      assert.equal(spoke.failure, spoke.reason && !['canceled', 'interrupted'].includes(spoke.reason) ? spoke.reason : null,
        `${engine}: onFail was called ${spoke.calls.length} time(s) with [${spoke.calls}] and the utterance `
        + `said ${spoke.reason}, over ${spoke.utterances} line(s) with ${spoke.voices} voices; `
        + `the page said: ${logged.join(' | ') || '(nothing)'}`);
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

      // SOUNDS OFF OPENS NOTHING. `unlock` is bound to every pointerdown on the document, so this
      // is the case where a person who wants silence was given an audio session anyway.
      await page.evaluate(() => { window.__audio.settings.soundMode = 'off'; });
      await page.mouse.click(200, 300);
      await page.waitForTimeout(300);
      assert.equal(await state(), 'none', 'a gesture with sound off opened an audio context');

      // Sound on: one real click wakes it, and a chime is played.
      await page.evaluate(() => { window.__audio.settings.soundMode = 'chime'; });
      await page.mouse.click(200, 300);
      await page.waitForTimeout(200);
      assert.equal(await state(), 'running', 'precondition: a click did not start audio');
      assert.equal(await page.evaluate(() => window.__audio.play('capture')), true, 'precondition: the chime was refused');

      await settle();
      assert.equal(await state(), 'suspended', 'the context was left running with nothing to play');

      // THE HALF THAT MAKES SUSPENDING SAFE. No gesture here on purpose: a scan capture is the
      // camera's doing, and this is the resume that follows it.
      assert.equal(await page.evaluate(() => window.__audio.play('done')), true, 'a chime after the idle suspend was refused');
      await page.waitForFunction(() => window.__audio.audioState() === 'running', null, { timeout: 8000 })
        .catch(() => { throw new Error(`${engine}: a chime with no gesture could not wake a suspended context`); });

      // And it goes quiet again afterwards, so this is a cycle rather than a one-off.
      await settle();
      assert.equal(await state(), 'suspended', 'the context stayed running after the second chime');
    } finally {
      await fixture.close();
      fixtures.delete(fixture);
    }
  });
}
