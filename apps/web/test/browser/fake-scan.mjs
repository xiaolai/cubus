// A finished scan, faked the one way every suite fakes it: the panel's own `scan-complete` event, with the
// model and the camera left out. The scan screen's handler, adoption and chip painter are the real ones.
//
// ONLY ONCE THE CAMERA HAS ANSWERED (2026-10-22). The panel knows nothing of a scan faked on it, so every
// report it makes afterwards says `complete: false` — and the scan screen, rightly, takes the stage card
// down on such a report. Mounting the scan screen starts the panel's camera; in a test context the camera is
// refused, and that refusal is a report. A scan faked before it landed was undone by it: traced in the
// noble image, "scan-complete dispatched → card shown → camera refused → progress error complete=false →
// card hidden", and the wait for the card then ran out at 60 s. It had always been a race the dispatch
// usually won; making the camera wait its turn behind the device list (src/camera.ts, `inTurn`) moved the
// refusal some 30–40 ms later and the race was lost in 6 of 25 runs, and in 11 geometry cases under load.
//
// So the camera's answer is waited for first. While it is outstanding the screen says it is opening the
// camera (or loading the scanner, before the panel registers); any other sentence is the outcome. That
// sentence changes BECAUSE the screen was mounted, so the wait is not met by the screen being left or not
// yet drawn.
//
// ONLY A REFUSED CAMERA WILL DO. A camera that ANSWERED keeps the panel scanning, and every report it makes
// says `complete: false` — so a scan faked over a running camera is taken down by the next report, whenever
// it lands. No wait makes that correct, so the helper refuses it loudly instead: the scan screen's camera row
// carries `on` exactly while the panel reports a device (lib/screens/scan/camera-menu.js, `paintCameraRow`).
// Test contexts grant no camera, so this is the case every suite is in; a suite that grants one must stop
// the panel itself before faking anything.

/** The words `#scanHow` holds while the panel's camera attempt has no outcome (lib/screens/scan.js). */
const STILL_OPENING = /^(Opening the camera|Loading the scanner)/;

/**
 * Resolves once the scan screen is up and the panel's camera attempt was REFUSED; throws if the camera answered
 * (see above). A suite that fakes ANY panel event (`scan-complete`, `scan-progress`) waits here first, or the
 * panel's own later report undoes it.
 * @param {import('playwright').Page} page
 * @param {{ timeout?: number }} [options] the page's default bound otherwise
 */
export async function cameraSettled(page, options = {}) {
  await page.waitForFunction((opening) => {
    const how = document.querySelector('.screen.active[data-screen="scan"] #scanHow');
    return how !== null && !new RegExp(opening).test(how.textContent.trim());
  }, STILL_OPENING.source, options);
  const running = await page.evaluate(() => document.querySelector('.screen.active[data-screen="scan"] .scan-cam')?.classList.contains('on') === true);
  if (running) {
    throw new Error('fake-scan: the camera ANSWERED, so the panel is scanning and its next report would take a faked event down. '
      + 'Fake only on a refused camera (a context granted no camera), or stop the panel first.');
  }
}

/**
 * On the scan screen, once the panel's camera attempt has an outcome, fire `scan-complete` with `facelets`.
 * @param {import('playwright').Page} page
 * @param {string} facelets
 * @param {{ timeout?: number }} [options] bounds the wait for the camera's answer
 */
export async function fakeScan(page, facelets, options = {}) {
  await cameraSettled(page, options);
  await page.evaluate((f) => {
    document.querySelector('ai-scan-panel').dispatchEvent(new CustomEvent('scan-complete', {
      detail: { facelets: f, rotations: [0, 0, 0, 0, 0, 0] },
    }));
  }, facelets);
}
