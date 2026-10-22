// `fakeScan` (fake-scan.mjs) in both of its outcomes. A refused camera, which is every test context: the faked
// scan is adopted and STAYS, after the camera's refusal has certainly landed. A camera that answered: the helper
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

test('on a refused camera, a faked scan is adopted and is still there once the refusal has landed', async () => {
  const context = await webkit.browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(`${webkit.base}/#/scan`);
    await fakeScan(page, SCANNED, { timeout: LIVENESS_MS });
    await page.waitForFunction(() => document.querySelector('#stageCard')?.hidden === false, null, { timeout: LIVENESS_MS });
    // What must NOT happen: the card taken down by a report that lands after the fake. Two frames after a
    // refusal the screen has already painted are not enough to prove much, so the refusal is asserted first.
    assert.doesNotMatch(await page.locator('#scanHow').textContent(), /^Opening the camera/, 'the camera had not answered yet');
    await page.evaluate(() => new Promise((r) => setTimeout(r, 500)));
    assert.equal(await page.evaluate(() => document.querySelector('#stageCard').hidden), false, 'the faked scan was taken down');
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
