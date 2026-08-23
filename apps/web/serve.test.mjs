// Integration tests for the dev server. Zero dependencies — Node's built-in test runner
// (`node --test`) + global fetch. Spawns serve.mjs on a test port and exercises the
// security-sensitive traversal guard plus MIME, 404, HTML injection, and the SSE endpoint.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 5199;
const BASE = `http://127.0.0.1:${PORT}`;
let proc;

before(async () => {
  proc = spawn(process.execPath, [join(HERE, 'serve.mjs')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('server did not start within 5s')), 5000);
    proc.stdout.on('data', (d) => {
      if (d.toString().includes(`:${PORT}`)) {
        clearTimeout(timeout);
        resolve();
      }
    });
    proc.on('error', reject);
  });
});

after(() => {
  proc?.kill('SIGTERM');
});

test('serves index.html with the live-reload client injected', async () => {
  const res = await fetch(`${BASE}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/html/);
  const body = await res.text();
  assert.match(body, /EventSource\("\/__livereload"\)/);
});

test('rejects encoded path traversal with 403', async () => {
  const res = await fetch(`${BASE}/%2e%2e%2fpackage.json`);
  await res.text().catch(() => {});
  assert.equal(res.status, 403);
});

test('unknown path is 404', async () => {
  const res = await fetch(`${BASE}/does-not-exist.xyz`);
  await res.text().catch(() => {});
  assert.equal(res.status, 404);
});

test('serves .mjs with a JavaScript MIME type', async () => {
  const res = await fetch(`${BASE}/serve.mjs`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/javascript/);
  await res.text();
});

test('SSE endpoint uses text/event-stream', async () => {
  const ctrl = new AbortController();
  const res = await fetch(`${BASE}/__livereload`, { signal: ctrl.signal });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
  ctrl.abort(); // don't read the never-ending stream
});
