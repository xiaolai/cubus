// D2's BROWSER half, measured in real engines rather than read off a specification.
//
// `dev-docs/scan-pipeline-audit-2026-09-23.md` §3, C3: nothing downstream could tell a re-served
// frame from a new one, so ONE physical frame could satisfy the stillness gate's "three identical
// reads spanning 500 ms" on its own, and any design that accumulates evidence would have counted it
// several times. The native half is measured end to end by `NextDetectionTests` and is
// mutation-checked. This half was not: `FrameSource.frameId()` reads
// `getVideoPlaybackQuality().totalVideoFrames`, and whether a browser reports that as a per-frame
// COUNTER for a live `MediaStream` is a claim only an engine can settle.
//
// It is settled here without a camera. `canvas.captureStream(0)` gives a real `MediaStream` whose
// frames this test produces one at a time with `requestFrame()`, so the number of frames the
// element has been given is known exactly — which is the one thing a counter has to agree with.
//
// WHY THIS IS NOT A CAMERA TEST. A webcam would add nothing the mechanism needs: the element's
// counter does not know where its stream came from. What a camera would add is the frame RATE, and
// the rate is the thing under test only in the sense that the counter must not move between frames
// — which is exactly what `requestFrame` lets this drive deterministically, and a camera would not.
//
// Both engines the app ships in. WebKit is the desktop and iOS webview; Chromium is the Android
// webview and the browser build's usual home.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { chromium, webkit } from 'playwright';

/** The rule under test, as `camera.ts` states it — copied so the page can run it standalone. */
const RULE = `
  (video) => {
    if (video.videoWidth === 0 || video.videoHeight === 0) return null;
    const frames = video.getVideoPlaybackQuality?.().totalVideoFrames;
    return typeof frames === 'number' && Number.isFinite(frames) ? frames : null;
  }
`;

/**
 * Watch a canvas-backed `MediaStream` through a `<video>` and record what the counter said on every
 * sample.
 *
 * SAMPLED FASTER THAN THE STREAM TICKS, which is the whole shape of the question: the scan loop
 * runs at up to sixteen ticks a second over a camera delivering thirty frames, and the case D2
 * exists for is two ticks landing between two frames. Sampling at 20 ms over a 30 fps stream
 * reproduces that by construction.
 *
 * NOT `captureStream(0)` plus `requestFrame()`, though that would make each frame's arrival exact:
 * measured 2026-09-23, headless WebKit never gives the `<video>` its dimensions from such a stream
 * (width stays 0 through 30 attempts), so the counter could not be exercised there at all. A
 * ticking stream works in both engines, and the property under test — repeats between frames,
 * advances across them — is visible either way.
 *
 * AND `play()` IS NOT AWAITED. In headless WebKit that promise does not settle for a
 * MediaStream-backed element, and awaiting it hangs the probe outright — which looks exactly like a
 * failing engine rather than a failing harness.
 */
const PROBE = `
  async () => {
    const frameId = ${RULE};
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (typeof canvas.captureStream !== 'function') {
      return { error: 'this engine has no canvas.captureStream' };
    }
    const stream = canvas.captureStream(30);
    const video = document.createElement('video');
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = stream;
    document.body.appendChild(video);

    const supported = typeof video.getVideoPlaybackQuality === 'function';
    // Before the element has a frame there is nothing to identify.
    const beforeAnyFrame = frameId(video);

    video.play().catch(() => {});
    const samples = [];
    for (let i = 0; i < 120; i++) {
      ctx.fillStyle = i % 2 ? '#c00' : '#0c0';
      ctx.fillRect(0, 0, 64, 64);
      await wait(20);
      if (video.videoWidth > 0) samples.push(frameId(video));
      if (samples.length >= 40) break;
    }
    if (samples.length === 0) return { error: 'the video never received a frame', supported };
    return { beforeAnyFrame, samples, supported };
  }
`;

for (const [name, engine] of [
  ['WebKit', webkit],
  ['Chromium', chromium],
]) {
  describe(`frame identity in ${name}`, () => {
    let browser;
    let page;
    let result;

    before(async () => {
      try {
        browser = await engine.launch();
      } catch (cause) {
        throw new Error(
          `${name} for Playwright is not installed — run: pnpm --filter cubus-web exec playwright install`,
          { cause },
        );
      }
      page = await browser.newPage();
      await page.goto('about:blank');
      // `(fn)()` — `evaluate` given a string evaluates it as an EXPRESSION, so a bare arrow
      // function comes back as the function rather than as what it returns.
      result = await page.evaluate(`(${PROBE})()`);
    });

    after(async () => {
      await browser?.close();
    });

    /**
     * The harness could not get a frame into the element at all, on this engine, on this machine.
     *
     * NOT AN ENGINE VERDICT, and so not a failure of the rule under test. A `<video>` fed by
     * `canvas.captureStream` needs the engine to decode into it, and a headless build without the
     * media stack does not: this file already records `captureStream(0)` never giving WebKit its
     * dimensions, and CI's LINUX WebKit does the same for a ticking stream that macOS WebKit drives
     * fine (found 2026-09-26, on the first CI run this branch ever had). Reporting that as "the
     * counter is not a per-frame identity" would be a measurement nobody made.
     *
     * SKIPPED, NEVER PASSED — `t.skip`, not a diagnostic, for the reason `scanner-gpu.test.mjs`
     * gives: a diagnostic still tallies under `pass`, and cases counted green where none ran is the
     * exact failure this repository refuses everywhere else. Chromium still measures the property in
     * CI, and both engines measure it on a developer's machine.
     */
    const unmeasurable = () => result.error === 'the video never received a frame';

    test('the engine reports a frame counter at all', (t) => {
      if (unmeasurable()) {
        return t.skip(`${name} here never gave the <video> a frame — the counter was not measured`);
      }
      assert.ok(!result.error, result.error);
      // If an engine ever drops `getVideoPlaybackQuality`, `frameId()` answers null and the gate
      // counts every tick — the documented degradation. This asserts which world we are in, so the
      // day it changes is the day this says so rather than the day a scan settles on one frame.
      assert.equal(result.supported, true, `${name} no longer exposes getVideoPlaybackQuality`);
    });

    test('there is no identity before the element has a frame', (t) => {
      if (unmeasurable()) return t.skip(`${name} here never gave the <video> a frame`);
      assert.equal(
        result.beforeAnyFrame,
        null,
        'a video with no dimensions reported a frame identity; zero would make "before any frame" look like a real frame the scan could count',
      );
    });

    test('the counter repeats between frames — the whole of D2', (t) => {
      if (unmeasurable()) return t.skip(`${name} here never gave the <video> a frame`);
      // The defect this exists to prevent, stated as its measurement: sampled faster than the
      // stream ticks, consecutive reads must sometimes be EQUAL. If every read differed, one
      // physical frame would supply several reads to the stillness gate and a side could settle on
      // a single observation — which is precisely what `currentTime` would have done, and why the
      // rule reads a counter instead.
      const repeats = result.samples.filter((v, i) => i > 0 && v === result.samples[i - 1]).length;
      assert.ok(
        repeats > 0,
        `the counter moved on every one of ${result.samples.length} reads, so it is not a per-frame identity: ${result.samples.join(',')}`,
      );
    });

    test('the counter never goes backwards, and advances as frames arrive', (t) => {
      if (unmeasurable()) return t.skip(`${name} here never gave the <video> a frame`);
      // The other half: an id that never changed would make every frame "the same one" and the gate
      // would never count a second read at all. And a counter that went backwards would make a new
      // frame look like one already seen.
      for (const [i, v] of result.samples.entries()) {
        assert.equal(typeof v, 'number', `sample ${i} was not a number`);
        if (i > 0) {
          assert.ok(v >= result.samples[i - 1], `sample ${i} went backwards`);
        }
      }
      assert.ok(
        result.samples.at(-1) > result.samples[0],
        `the counter never advanced across ${result.samples.length} reads: ${result.samples.join(',')}`,
      );
    });
  });
}
