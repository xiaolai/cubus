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
    browser = await engines[engine].launch(launch);
  } catch (cause) {
    proc.kill('SIGTERM');
    throw new Error(`${engine} for Playwright did not launch — if it is not installed: pnpm --filter cubus-web exec playwright install ${engine}`, { cause });
  }

  // EVERY context the fixture's browser makes gets the bound, `newPage`'s own included — it makes its
  // context through `newContext` — so no suite inherits the 30 s default by not thinking of it.
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...options) => {
    const context = await newContext(...options);
    context.setDefaultNavigationTimeout(LIVENESS_MS);
    return context;
  };

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
