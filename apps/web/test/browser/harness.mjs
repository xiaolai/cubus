// The server-and-WebKit lifecycle every browser test needs, in one place.
//
// Three suites had grown near-verbatim copies of this — start serve.mjs on a free port, wait for
// it to say the port, launch WebKit, tear both down. Copies drift: a fix for warning attribution
// or for a disposal leak lands in one and the others keep the bug. Extracted when a fourth was
// about to be written.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

import { freePort } from '../free-port.mjs';

const SERVE = fileURLToPath(new URL('../../serve.mjs', import.meta.url));

/**
 * How long a page may take to navigate, or a suite to wait for something a page must do, before it is a
 * HANG. A liveness bound, not a speed claim: the browser tier runs three browsers at once, and the scan
 * screen — about 150 unbundled modules from the dev server, `load` in about 1 s alone — missed
 * Playwright's 30 s navigation default at the end of a full run (2026-10-17), failing a suite whose
 * subject is where the model runs. `scanner-gpu.test.mjs` had already needed 180 s for the same reason.
 */
export const LIVENESS_MS = 180_000;

/** The calls that wait for a page's `load`, each reported on when it times out. */
const LOAD_WAITS = ['goto', 'reload', 'waitForLoadState'];
/** How long the report may wait for the page to say its own state: the page may be the thing that is stuck. */
const ASK_PAGE_MS = 2000;
/** The most pending requests the report lists; the rest are counted. */
const LISTED = 20;

/**
 * Make every wait for `load` on `page` that TIMES OUT say what the page was still waiting on.
 *
 * WHY. CI 39607667813 (2026-10-21): a WebKit `page.goto` of the scan screen waited the whole 180 s bound
 * and said only `navigating to "…/#/scan", waiting until "load"`. That cannot tell apart the three things
 * that hold `load` back — a document that never arrived, a request that was never answered or never
 * finished, and a page with nothing in flight whose `load` was delayed some other way — so the occurrence
 * was not a finding, and geometry.test.mjs had already met the same signature twice without one. The
 * report names each request asked and not finished (answered or not, and how long after the wait began),
 * the document's URL and `readyState`, and when DOMContentLoaded and `load` fired since the wait began.
 *
 * The error is the same object, still a `TimeoutError`, with the report added to its message and stack:
 * a caller that tells a timeout by its name (geometry's `openAt`) sees no difference. Any other error, and
 * every wait that succeeds, passes through untouched.
 *
 * Two things a reader of a WebKit report should know (measured 2026-10-22, macOS and Linux WPE):
 * - On the app's pages, WebKit's Playwright raised no `requestfinished` for the top-level document even
 *   when the page loaded, so the app's own URL listed "answered 200, body unfinished" is ordinary there;
 *   `readyState` says whether the document arrived. (A plain test page's document did finish.)
 * - WebKit hands a response to the page only once it has the bytes to sniff its type: an image answered
 *   with 10 bytes of its body read as "no answer", with 600 as "answered". So "no answer" there means no
 *   response reached the page, which includes one whose first few hundred bytes have not arrived.
 */
function reportStalledLoads(page) {
  const pending = new Map();
  page.on('request', (request) => pending.set(request, { asked: Date.now(), status: null }));
  page.on('response', (response) => {
    const entry = pending.get(response.request());
    if (entry) entry.status = response.status();
  });
  page.on('requestfinished', (request) => pending.delete(request));
  page.on('requestfailed', (request) => pending.delete(request));
  const fired = { domcontentloaded: null, load: null };
  page.on('domcontentloaded', () => { fired.domcontentloaded = Date.now(); });
  page.on('load', () => { fired.load = Date.now(); });

  const report = async (began) => {
    const since = (at) => (at !== null && at >= began ? `after ${at - began} ms` : 'not since the wait began');
    let timer;
    const state = await Promise.race([
      page.evaluate(() => ({ url: location.href, readyState: document.readyState }))
        .then((s) => `the document ${s.url} is readyState "${s.readyState}"`, (e) => `the page could not say its state (${String(e?.message ?? e).split('\n')[0]})`),
      new Promise((r) => { timer = setTimeout(() => r(`the page did not answer for its state within ${ASK_PAGE_MS} ms`), ASK_PAGE_MS); }),
    ]).finally(() => clearTimeout(timer));
    const open = [...pending.entries()].sort((a, b) => a[1].asked - b[1].asked);
    const lines = open.slice(0, LISTED).map(([request, { asked, status }]) => {
      const answer = status === null ? 'no answer' : `answered ${status}, body unfinished`;
      const when = asked >= began ? `${asked - began} ms after` : `${began - asked} ms before`;
      return `    ${request.method()} ${request.url()} (${request.resourceType()}): ${answer}, asked ${when} the wait began`;
    });
    if (open.length > LISTED) lines.push(`    … and ${open.length - LISTED} more`);
    return [
      `[harness] ${state}; DOMContentLoaded ${since(fired.domcontentloaded)}, load ${since(fired.load)}.`,
      `[harness] ${open.length} request(s) still pending${open.length ? ':' : '.'}`,
      ...lines,
    ].join('\n');
  };

  for (const name of LOAD_WAITS) {
    const wait = page[name].bind(page);
    page[name] = async (...args) => {
      const began = Date.now();
      try {
        return await wait(...args);
      } catch (error) {
        if (error?.name !== 'TimeoutError' || page.isClosed()) throw error;
        const said = error.message;
        error.message = `${said}\n${await report(began)}`;
        if (typeof error.stack === 'string') error.stack = error.stack.replace(said, error.message);
        throw error;
      }
    };
  }
}

/**
 * Launch a browser for a test. EVERY browser a suite drives comes from here — `browser-launch.test.mjs`
 * refuses a direct `webkit.launch()` — because three guards hold only for a browser that has them:
 *
 * - Every context gets the navigation bound, `newPage`'s own included — it makes its context through
 *   `newContext` — so no suite inherits the 30 s default by not thinking of it.
 * - A page whose web content process DIES is closed at once, naming the crash. Playwright fires
 *   `crash` and rejects a later `evaluate`, but a call already waiting on that page may never settle:
 *   `keyboard.press` takes no timeout, and with WebKit's content process killed it was still pending
 *   after 20 s on macOS — a focus-visible run on Linux waited 35 minutes with no web process left.
 *   Closing the page rejects every call in flight on it, with the reason in its message, so the test
 *   fails where the page died and says so rather than waiting on a page that is gone. A browser that
 *   is killed rejects every call on its own connection — but not every abort is a kill: a `newPage` in
 *   flight when WPE's `MiniBrowser` aborted on its own never settled, `disconnected` notwithstanding
 *   (noble image, 2026-10-22; dev-docs/agents-reference.md has the trigger).
 * - A wait for `load` that times out says what the page was still waiting on (`reportStalledLoads`).
 *
 * @param {'webkit' | 'chromium'} engine
 * @param {import('playwright').LaunchOptions} [options]
 * @returns {Promise<import('playwright').Browser>}
 */
export async function launchBrowser(engine, options = {}) {
  const engines = { webkit, chromium };
  if (!Object.hasOwn(engines, engine)) throw new Error(`launchBrowser: no engine "${engine}"`);
  const browser = await engines[engine].launch(options);
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...args) => {
    const context = await newContext(...args);
    context.setDefaultNavigationTimeout(LIVENESS_MS);
    context.on('page', (page) => {
      page.once('crash', () => {
        const reason = `${engine}'s web content process crashed under ${page.url()}`;
        console.error(`[harness] ${reason}`);
        page.close({ reason }).catch(() => {});
      });
      reportStalledLoads(page);
    });
    return context;
  };
  return browser;
}

/**
 * Start the dev server and a browser: WebKit, the engine the desktop app runs in, unless a suite
 * asks for Chromium — the appearance goldens do, because Chromium draws with the same software
 * rasteriser on every machine they are compared on. `launch` is passed to Playwright's launch().
 *
 * @param {{ engine?: 'webkit' | 'chromium', launch?: import('playwright').LaunchOptions }} [options]
 * @returns {Promise<{base: string, browser: import('playwright').Browser, close: () => Promise<void>}>}
 */
export async function startBrowserFixture({ engine = 'webkit', launch = {} } = {}) {
  const engines = { webkit, chromium };
  if (!Object.hasOwn(engines, engine)) throw new Error(`startBrowserFixture: no engine "${engine}"`);
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const proc = spawn(process.execPath, [SERVE], {
    env: { ...process.env, PORT: String(port), CUBUS_LIVE_RELOAD: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Every failure below has to kill the server, and the caller cannot do it: it has no reference
  // until this function RETURNS. The suite this was extracted from kept `proc` in a module
  // variable, so its `after` hook could still reach it after a startup timeout; extracting the
  // lifecycle took that away and left the process running.
  let timer;
  try {
    let said = '';
    await new Promise((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`serve.mjs did not start within 20s. It said: ${said.trim() || '(nothing)'}`)),
        20_000,
      );
      const note = (d) => { said += d.toString(); if (said.includes(`:${port}`)) resolve(); };
      proc.stdout.on('data', note);
      proc.stderr.on('data', (d) => { said += d.toString(); });
      proc.on('error', reject);
      proc.on('exit', (code) => reject(new Error(`serve.mjs exited with ${code} before it was ready. It said: ${said.trim() || '(nothing)'}`)));
    });
  } catch (cause) {
    proc.kill('SIGTERM');
    throw cause;
  } finally {
    // Cleared on the success path too: a pending 20s timer keeps the event loop alive and the
    // node test runner waiting for it.
    clearTimeout(timer);
  }

  let browser;
  try {
    browser = await launchBrowser(engine, launch);
  } catch (cause) {
    proc.kill('SIGTERM');
    throw new Error(`${engine} for Playwright did not launch — if it is not installed: pnpm --filter cubus-web exec playwright install ${engine}`, { cause });
  }

  let closed = null;
  return {
    base,
    browser,
    /** Idempotent and bounded: a second call returns the first one's promise rather than waiting
     *  another two seconds for a process that is already gone. */
    close() {
      closed ??= (async () => {
        // Bounded FIRST. An unbounded `browser.close()` that hangs would stop the server ever
        // being signalled, which is the leak this whole function exists to prevent.
        await Promise.race([
          browser.close().catch(() => {}),
          new Promise((r) => { const t = setTimeout(r, 5000); t.unref?.(); }),
        ]);
        proc.kill('SIGTERM');
        // SIGTERM leaves `exitCode` null even once the process is gone, so wait on the event and
        // cap it — and clear the cap, or a resolved wait still holds the event loop open.
        if (proc.exitCode === null && proc.signalCode === null) {
          await new Promise((r) => {
            const t = setTimeout(r, 2000);
            t.unref?.();
            proc.once('exit', () => { clearTimeout(t); r(); });
          });
        }
      })();
      return closed;
    },
  };
}
