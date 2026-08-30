// Live-reload is a convenience for a human and a hazard for a test: the watcher is recursive
// over the whole web directory, so ANY write under it pushes location.reload() to every open
// page — mid-evaluate, in whatever browser test happens to be running. That is why it is
// opt-out, and why the opt-out has to be tested from both ends: a server that still injects the
// EventSource is one broadcast away from the race, and a snippet check alone would pass against
// a server whose watcher is still armed.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readFileSync, statSync, writeFileSync, unlinkSync } from 'node:fs';

import { freePort } from './free-port.mjs';

const SERVE = fileURLToPath(new URL('../serve.mjs', import.meta.url));

/** Start the server and hand back its base URL, its stdout so far, and a stop(). */
async function serve(env) {
  const port = await freePort();
  const proc = spawn(process.execPath, [SERVE], {
    env: { ...process.env, PORT: String(port), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let said = '';
  proc.stdout.on('data', (d) => { said += d.toString(); });
  proc.stderr.on('data', (d) => { said += d.toString(); });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`serve.mjs did not start within 20s. It said: ${said.trim() || '(nothing)'}`)),
      20_000,
    );
    proc.stdout.on('data', () => { if (said.includes(`:${port}`)) { clearTimeout(timeout); resolve(); } });
    proc.on('error', reject);
  });
  return { base: `http://127.0.0.1:${port}`, said: () => said, stop: () => proc.kill('SIGTERM') };
}

test('with live-reload off the page is never handed a reload client', async () => {
  const s = await serve({ CUBUS_LIVE_RELOAD: '0' });
  try {
    const html = await (await fetch(`${s.base}/index.html`)).text();
    assert.doesNotMatch(html, /EventSource/, 'the reload client was injected despite the opt-out');
    assert.doesNotMatch(html, /__livereload/, 'the reload endpoint was advertised despite the opt-out');
    // And the log agrees with the behaviour. A server that says it is watching while it is not
    // sends the next person reading a failure down the wrong path.
    assert.match(s.said(), /live-reload: off/, 'the startup log still claims to be watching');
  } finally {
    s.stop();
  }
});

test('a write under web/ cannot navigate a page served with reload off', async () => {
  // The actual failure this prevents: a file appearing and disappearing in apps/web while a
  // browser test runs, which reloaded every page and surfaced as "Execution context was
  // destroyed" attributed to whichever test was unlucky. With the watcher never armed, the
  // SSE endpoint has nothing to push to — so there is no client to push to either.
  const s = await serve({ CUBUS_LIVE_RELOAD: '0' });
  const scratch = fileURLToPath(new URL('../__reload-probe.tmp', import.meta.url));
  try {
    writeFileSync(scratch, 'touch');
    await new Promise((r) => setTimeout(r, 400)); // longer than the watcher's 80ms debounce
    assert.doesNotMatch(s.said(), /reload → browser/, 'a write triggered a reload broadcast');
  } finally {
    try { unlinkSync(scratch); } catch {}
    s.stop();
  }
});

test('with live-reload on the client is served — the opt-out is a choice, not a removal', async () => {
  const s = await serve({});
  try {
    const html = await (await fetch(`${s.base}/index.html`)).text();
    assert.match(html, /EventSource/, 'live-reload is the default for `pnpm dev` and must still work');
  } finally {
    s.stop();
  }
});

test('a large binary asset arrives whole, and declares its length', async () => {
  // The bug this closes cost an hour and pointed at the wrong subsystem entirely. Files were
  // read into a buffer and sent with `res.end(body)` and NO Content-Length, so Node used
  // HTTP/1.1 chunked — and a chunked body that stops early terminates cleanly, so the client
  // has no way to know it is short. The 26.8 MB onnxruntime wasm arrived truncated under the
  // suite's own load and WebKit reported
  // "WebAssembly.Module doesn't parse at byte 24666430", which surfaced as
  // threads-do-not-change-output failing — i.e. as a MODEL regression. The file on disk was
  // byte-identical to its source the whole time.
  //
  // Content-Length is what makes a short read the client's error instead of a corrupt asset it
  // parses, so this asserts the header AND the byte count, not just that a response arrived.
  const s = await serve({ CUBUS_LIVE_RELOAD: '0' });
  try {
    const path = new URL('../vendor/ort-wasm-simd-threaded.jsep.wasm', import.meta.url);
    const onDisk = statSync(path).size;
    assert.ok(onDisk > 20_000_000, `the fixture must be big enough to expose this: ${onDisk} bytes`);

    const res = await fetch(`${s.base}/vendor/ort-wasm-simd-threaded.jsep.wasm`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-length'), String(onDisk),
      'no Content-Length means a truncated body ends cleanly and reads as complete');
    const got = new Uint8Array(await res.arrayBuffer());
    assert.equal(got.byteLength, onDisk, 'the body was short');
    // Cheap end-check: wasm starts \0asm and the last byte must be the file's last byte.
    assert.deepEqual([...got.slice(0, 4)], [0x00, 0x61, 0x73, 0x6d], 'not a wasm module');
    assert.equal(got[got.length - 1], readFileSync(path)[onDisk - 1], 'the tail does not match disk');
  } finally {
    s.stop();
  }
});
