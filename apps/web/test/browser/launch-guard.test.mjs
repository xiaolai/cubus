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
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';

import { launchBrowser } from './harness.mjs';

let browser;
before(async () => { browser = await launchBrowser('webkit'); });
after(async () => { await browser?.close(); });

/**
 * A server whose page never reaches `load`: `/never.png` is never answered and `/half.png` is answered
 * and its body never ended, while `/done.js` completes — the shape of a navigation that waits on one
 * stuck request among many that finished. Every held response is let go when the server closes.
 */
async function stallingServer() {
  const server = createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><script src="/done.js"></script><img src="/never.png"><img src="/half.png">');
    } else if (req.url === '/done.js') {
      res.writeHead(200, { 'content-type': 'text/javascript', 'content-length': '0' });
      res.end();
    } else if (req.url === '/half.png') {
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': '1000' });
      // 600 bytes, not a handful: WebKit gives the page no response until it has enough to sniff the
      // type, and with 10 bytes this read as "no answer" (2026-10-22).
      res.write(Buffer.alloc(600));
    } else if (req.url === '/never.png') {
      // Held: no status, no headers, no body.
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => { server.closeAllConnections(); return new Promise((r) => server.close(r)); },
  };
}

// CI 39607667813 (2026-10-21): a WebKit `page.goto` waited 180 s for a `load` that never came, and its
// error said only "navigating to …, waiting until load" — nothing about what the page was waiting on, so
// the occurrence could not be told from a document that never arrived, a request that never finished,
// or a page with nothing in flight. The guard makes a navigation that times out SAY which.
for (const [call, run] of [
  ['page.goto', (page, base) => page.goto(`${base}/`, { timeout: 3000 })],
  ['page.reload', async (page, base) => { await page.goto(`${base}/`, { waitUntil: 'commit' }); return page.reload({ timeout: 3000 }); }],
  ['page.waitForLoadState', async (page, base) => { await page.goto(`${base}/`, { waitUntil: 'commit' }); return page.waitForLoadState('load', { timeout: 3000 }); }],
]) {
  test(`${call} that never reaches load fails naming the requests still pending, and the document's state`, async () => {
    const server = await stallingServer();
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const error = await run(page, server.base).then(() => null, (e) => e);
      assert.ok(error, `${call} reached load on a page whose images are held`);
      // Still the error a caller tells a timeout by: geometry's openAt retries on exactly this name.
      assert.equal(error.name, 'TimeoutError', `the timeout came back as ${error.name}`);
      const said = error.message;
      assert.match(said, /still pending/, `no pending-request report:\n${said}`);
      assert.match(said, /GET \S*\/never\.png \(image\): no answer/, `the unanswered request is not named:\n${said}`);
      assert.match(said, /GET \S*\/half\.png \(image\): answered 200, body unfinished/, `the half-sent request is not named:\n${said}`);
      assert.match(said, /readyState "interactive"/, `the document's state is not said:\n${said}`);
      assert.match(said, /DOMContentLoaded after \d+ ms/, `DOMContentLoaded is not said:\n${said}`);
      // What must NOT be in it: a request that finished is not a suspect.
      assert.doesNotMatch(said, /done\.js/, `a request that finished is reported as pending:\n${said}`);
      // The stack carries the report too, since a runner prints the stack, not the message.
      assert.match(String(error.stack), /never\.png/, 'the report is in the message but not the stack');
    } finally {
      await context.close();
      await server.close();
    }
  });
}

test('a navigation that reaches load is untouched: it answers its response, and reports nothing', async () => {
  const server = await stallingServer();
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const response = await page.goto(`${server.base}/done.js`);
    assert.equal(response?.status(), 200);
  } finally {
    await context.close();
    await server.close();
  }
});

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

// A browser that DISCONNECTS without being killed — WPE's MiniBrowser aborting on its own — left a
// `context.newPage()` in flight pending for good, `disconnected` notwithstanding (noble image, 2026-10-22: the
// call was still pending minutes after the process exited). A kill rejects every call; this abort did not. So
// every call on anything the harness hands out races the browser's disconnect, and loses it by name. The event
// is raised by hand, as `crash` is above: aborting a browser is not something a suite may do to its machine.
test('a browser that disconnects fails every call in flight on what it handed out, and every call after, naming it', async () => {
  const own = await launchBrowser('webkit');
  try {
    const context = await own.newContext();
    const page = await context.newPage();
    await page.setContent('<p id="x">a</p>');
    const handle = await page.$('#x');
    const never = () => new Promise(() => {});
    const inFlight = {
      'page.evaluate': page.evaluate(never),
      'frame.evaluate': page.mainFrame().evaluate(never),
      'locator.evaluate': page.locator('#x').evaluate(never),
      'elementHandle.evaluate': handle.evaluate(never),
      'page.waitForFunction': page.waitForFunction(() => false, null, { timeout: 0 }),
      'locator.waitFor': page.locator('#never').waitFor({ timeout: 0 }),
    };
    const settled = new Set();
    for (const [name, p] of Object.entries(inFlight)) { p.then(() => settled.add(name), () => settled.add(name)); }

    // What must NOT happen first: with the browser connected, a frame passes and nothing has settled.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    assert.deepEqual([...settled], [], 'a call settled with the browser still connected');

    const said = [];
    const error = console.error;
    console.error = (...args) => { said.push(args.join(' ')); };
    try {
      own.emit('disconnected', own);
      let timer;
      const bound = (p) => Promise.race([p, new Promise((r) => { timer = setTimeout(() => r('still pending'), STILL_PENDING_MS); })]).finally(() => clearTimeout(timer));
      for (const [name, p] of Object.entries(inFlight)) {
        const outcome = await bound(p.then(() => 'resolved', (e) => e));
        assert.ok(outcome instanceof Error, `${name} in flight was ${outcome}, not rejected, after the browser disconnected`);
        assert.match(outcome.message, /disconnected/, `${name} rejected without naming the disconnect: ${outcome.message}`);
      }
      for (const [name, call] of [
        ['browser.newContext', () => own.newContext()],
        ['context.newPage', () => context.newPage()],
        ['page.goto', () => page.goto('about:blank')],
        ['page.keyboard.press', () => page.keyboard.press('a')],
      ]) {
        const outcome = await bound(call().then(() => 'resolved', (e) => e));
        assert.ok(outcome instanceof Error, `${name} made after the disconnect was ${outcome}, not rejected`);
        assert.match(outcome.message, /disconnected/, `${name} after the disconnect did not name it: ${outcome.message}`);
      }
    } finally {
      console.error = error;
    }
    assert.ok(said.some((s) => s.includes('disconnected')), `the disconnect was not said: ${JSON.stringify(said)}`);
  } finally {
    await own.close().catch(() => {});
  }
});
