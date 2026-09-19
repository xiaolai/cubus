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
      await page.goto(`${fixture.base}/#/settings`);
      await page.waitForSelector('[data-toggle="sounds"]');
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
        const can = typeof speechSynthesis === 'object' && typeof SpeechSynthesisUtterance === 'function';
        if (!can) return { can, said: null, failure: null, settled: null };
        const failures = [];
        // The utterance's OWN terminal event, not a fixed wait: a failure arriving a moment after
        // whatever span this test guessed would go unseen (audit, 2026-09-19). A line that neither
        // ends nor fails inside the bound is reported as that, rather than as a pass.
        let settle;
        const done = new Promise((r) => {
          settle = r;
        });
        let reason = null;
        const engine = {
          synth: speechSynthesis,
          Utterance: class extends SpeechSynthesisUtterance {
            constructor(text) {
              super(text);
              this.addEventListener('end', () => settle('ended'));
              this.addEventListener('error', (e) => {
                reason = e.error ?? 'unnamed';
                settle('error');
              });
            }
          },
        };
        const was = speech.useSpeechEngine(() => engine);
        const said = speech.say('Got it!', 'en', { onFail: (e) => failures.push(e) });
        const settled = await Promise.race([
          done,
          new Promise((r) => setTimeout(() => r('still speaking after 10s'), 10_000)),
        ]);
        speech.hush();
        speech.useSpeechEngine(was);
        return { can, said, failure: failures[0] ?? null, settled, reason, voices: speechSynthesis.getVoices().length };
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
        `${engine}: onFail said ${spoke.failure} and the utterance said ${spoke.reason}`);
      await context.close();
    } finally {
      await fixture.close();
      fixtures.delete(fixture);
    }
  });
}
