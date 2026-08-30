// Cross-origin isolation is the difference between the scanner using one core and using six.
//
// onnxruntime-web's threaded wasm build needs SharedArrayBuffer, the browser only hands that to
// an isolated page, and isolation needs COOP + COEP. We shipped the threaded artifact and sent
// neither header for as long as the scanner has existed: measured at 297 ms per inference in
// WebKit and 234 ms in Chromium — 3-4 fps — on machines with eight and ten cores. Nothing warned,
// because a runtime that cannot have threads does not complain, it just runs on one.
//
// So the headers are load-bearing and silent when absent, which is exactly the combination that
// needs a test. This one fails the moment isolation is lost again, in the engine the app ships.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { webkit } from 'playwright';

import { freePort } from './free-port.mjs';

const SERVE = fileURLToPath(new URL('../serve.mjs', import.meta.url));
let proc;
let browser;
let base;

before(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, [SERVE], {
    env: { ...process.env, PORT: String(port), CUBUS_LIVE_RELOAD: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let said = '';
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`serve.mjs did not start within 20s. It said: ${said.trim() || '(nothing)'}`)),
      20_000,
    );
    const note = (d) => { said += d.toString(); if (said.includes(`:${port}`)) { clearTimeout(timeout); resolve(); } };
    proc.stdout.on('data', note);
    proc.stderr.on('data', (d) => { said += d.toString(); });
    proc.on('error', reject);
  });
  try {
    browser = await webkit.launch();
  } catch (cause) {
    throw new Error('WebKit for Playwright is not installed — run: pnpm --filter cubus-web exec playwright install webkit', { cause });
  }
});

after(async () => {
  await browser?.close();
  proc?.kill('SIGTERM');
});

test('the dev server sends the three headers isolation needs', async () => {
  const res = await fetch(`${base}/index.html`);
  assert.equal(res.headers.get('cross-origin-opener-policy'), 'same-origin');
  assert.equal(res.headers.get('cross-origin-embedder-policy'), 'require-corp');
  // CORP on every response, not just the document: under require-corp a subresource that refuses
  // its own policy is blocked, and the model and the wasm are subresources.
  const wasm = await fetch(`${base}/vendor/cube-yolo.onnx`);
  assert.equal(wasm.headers.get('cross-origin-resource-policy'), 'same-origin');
});

test('the page is actually isolated, and SharedArrayBuffer exists', async () => {
  // The headers being SENT is not the claim. The claim is that the browser accepted them — a
  // header check alone would pass against a page the engine refused to isolate.
  const page = await browser.newPage();
  try {
    await page.goto(`${base}/index.html`);
    const seen = await page.evaluate(() => ({
      isolated: globalThis.crossOriginIsolated,
      sab: typeof SharedArrayBuffer !== 'undefined',
    }));
    assert.equal(seen.isolated, true, 'the page is not cross-origin isolated — the scanner is back to one core');
    assert.equal(seen.sab, true, 'SharedArrayBuffer is absent, so onnxruntime has no threads to use');
  } finally {
    await page.close();
  }
});

test('the packaged builds ask for the same headers as the dev server', async () => {
  // Windows, Linux and Android run the webview, not serve.mjs — and they are exactly the builds
  // that depend on this, because they have no native detector and fall back to the wasm path.
  // A dev server that isolates while the shipped app does not is the worst of both: fast where
  // nobody ships and slow where everybody does.
  const conf = JSON.parse(readFileSync(new URL('../../desktop/src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  const headers = conf.app?.security?.headers ?? {};
  assert.equal(headers['Cross-Origin-Opener-Policy'], 'same-origin');
  assert.equal(headers['Cross-Origin-Embedder-Policy'], 'require-corp');
  assert.equal(headers['Cross-Origin-Resource-Policy'], 'same-origin');
});
