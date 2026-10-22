// `fakeScan` (fake-scan.mjs) in both of its outcomes. A refused camera, which is every test context: the faked
// scan is adopted and STAYS, after the camera's refusal has certainly landed — refused late on purpose. A camera that answered: the helper
// refuses, loudly, rather than fake a scan the panel's next report would take down.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { fakeScan } from './fake-scan.mjs';
import { LIVENESS_MS, startBrowserFixture } from './harness.mjs';

const SCANNED = 'DDDUURFDURDRRRLBBULLFUFFFLLDUUFDDDLRBBUBLRBULFFLFBRBBR';
let webkit;
let chromium;
before(async () => {
  webkit = await startBrowserFixture({ engine: 'webkit' });
  // A camera that answers: Chromium's fake device, granted without a prompt.
  chromium = await startBrowserFixture({
    engine: 'chromium',
    launch: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  });
});
after(async () => { await Promise.all([webkit?.close(), chromium?.close()]); });

/** How long after it is asked the camera is refused, in the case below: long enough that a scan faked before the
 *  refusal is certainly faked first, on any machine — the race the helper exists for, made to happen every time.
 *  Loading the scan screen directly, the refusal usually beat the dispatch (0 of 25 lost it there; 4 of 25 only
 *  via Home), so without this the case passed with the wait removed (verifier, 2026-10-23). */
const LATE_REFUSAL_MS = 700;

test('on a camera refused LATE, a faked scan waits for the refusal and is still there after it', async () => {
  const context = await webkit.browser.newContext();
  try {
    await context.addInitScript((ms) => {
      MediaDevices.prototype.getUserMedia = () => new Promise((_, reject) => {
        setTimeout(() => reject(new DOMException('refused late, on purpose', 'NotAllowedError')), ms);
      });
    }, LATE_REFUSAL_MS);
    const page = await context.newPage();
    await page.goto(`${webkit.base}/#/scan`);
    await fakeScan(page, SCANNED, { timeout: LIVENESS_MS });
    await page.waitForFunction(() => document.querySelector('#stageCard')?.hidden === false, null, { timeout: LIVENESS_MS });
    // The refusal has landed — waited on here, so this holds whether or not the helper waited for it…
    await page.waitForFunction(() => !/^Opening the camera/.test(document.querySelector('#scanHow')?.textContent.trim() ?? ''), null, { timeout: LIVENESS_MS });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    // …and what must NOT happen: the faked scan taken down by it.
    assert.equal(await page.evaluate(() => document.querySelector('#stageCard').hidden), false, 'the faked scan was taken down by the late refusal');
  } finally {
    await context.close();
  }
});

test('on a camera that answered, fakeScan refuses loudly rather than fake a scan the panel would undo', async () => {
  const context = await chromium.browser.newContext({ permissions: ['camera'] });
  try {
    const page = await context.newPage();
    await page.goto(`${chromium.base}/#/scan`);
    // Precondition, so this cannot pass by the camera simply being refused here too.
    await page.waitForSelector('.screen.active[data-screen="scan"] .scan-cam.on', { timeout: LIVENESS_MS });
    await assert.rejects(fakeScan(page, SCANNED, { timeout: LIVENESS_MS }), /the camera ANSWERED/);
    assert.equal(await page.evaluate(() => document.querySelector('#stageCard').hidden), true, 'a scan was faked anyway');
  } finally {
    await context.close();
  }
});
