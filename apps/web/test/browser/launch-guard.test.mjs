// `launchBrowser` closes a page whose web content process crashed, naming the crash, so a call in
// flight on it FAILS rather than waits on a page that is gone. Without it a `keyboard.press` on a
// WebKit page whose process was killed was still pending 120 s later (Linux WPE, 2026-10-22): it
// takes no timeout, so no default timeout bounds it, and a focus-visible run waited 35 minutes so.
//
// The crash is Playwright's own `crash` event, raised here by hand: killing a content process is
// not something a suite may do to the machine it runs on — on macOS the content processes of every
// WebKit app share one name. What this holds is the guard's half: on `crash`, the page closes and
// what was waiting on it rejects; with no crash, nothing is closed and nothing is cut short.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { launchBrowser } from './harness.mjs';

let browser;
before(async () => { browser = await launchBrowser('webkit'); });
after(async () => { await browser?.close(); });

// A liveness bound on the guard itself: if the guard is gone, the call below never settles, and
// this turns a hang of the very kind under test into a failure that says so.
const STILL_PENDING_MS = 10_000;

for (const [made, open] of [
  ['browser.newPage()', () => browser.newPage()],
  ['context.newPage()', async () => (await browser.newContext()).newPage()],
]) {
  test(`a page from ${made} that crashes is closed and the call in flight on it fails, naming the crash`, async () => {
    const page = await open();
    await page.setContent('<button>a</button>');
    let settled = false;
    const inFlight = page.evaluate(() => new Promise(() => {})).finally(() => { settled = true; });
    inFlight.catch(() => {});

    // What must NOT happen first: with no crash, a frame passes and the page is open, the call still waiting.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    assert.equal(page.isClosed(), false, 'the page closed with no crash');
    assert.equal(settled, false, 'the call in flight settled with no crash');

    const said = [];
    const error = console.error;
    console.error = (...args) => { said.push(args.join(' ')); };
    try {
      // The call rejects as the close BEGINS, before Playwright marks the page closed, so the close is
      // waited for by its event rather than read off `isClosed()` the moment the call fails.
      const closed = new Promise((r) => page.once('close', () => r('closed')));
      page.emit('crash', page);
      let timer;
      const bound = (p) => Promise.race([p, new Promise((r) => { timer = setTimeout(() => r('still pending'), STILL_PENDING_MS); })]).finally(() => clearTimeout(timer));
      const outcome = await bound(inFlight.then(() => 'resolved', (e) => e));
      assert.ok(outcome instanceof Error, `the call in flight on a crashed page was ${outcome}, not rejected`);
      assert.equal(await bound(closed), 'closed', 'a crashed page was left open');
    } finally {
      console.error = error;
    }
    assert.ok(said.some((s) => s.includes('crashed')), `the crash was not named: ${JSON.stringify(said)}`);
  });
}
