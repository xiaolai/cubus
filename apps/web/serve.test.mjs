// Integration tests for the dev server. Zero dependencies — Node's built-in test runner
// (`node --test`) + global fetch. Spawns serve.mjs on a test port and exercises the
// security-sensitive guards (path traversal, symlink escape, the Host header) plus MIME, 404,
// HTML injection, and the SSE endpoint.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, sep } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { freePort } from './test/free-port.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// From the OS, not chosen by hand. `free-port.mjs` was written for exactly this failure — a run
// killed between spawning serve.mjs and reaching its `after` hook leaves the port held, and every
// later run then dies at startup with "server did not start within 5s", which reads as a
// regression in whatever changed most recently. Its own note records that being misdiagnosed
// twice; this file and solve-worker-browser.test.mjs were simply never moved over, and both were
// still squatting a port hours after the runs that spawned them had been killed.
let PORT;
let BASE;
let proc;
let escape = null;

before(async () => {
  PORT = await freePort();
  BASE = `http://127.0.0.1:${PORT}`;
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
  if (escape?.created) {
    rmSync(escape.created.link, { force: true });
    rmSync(escape.created.marker, { force: true });
  }
});

/** A GET with exactly these headers (fetch will not let a test set Host), resolving to the status. */
const statusOf = (path, headers) =>
  new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: PORT, path, method: 'GET', headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });

/**
 * A URL under the served root whose symlink resolves OUTSIDE it. pnpm's layout provides one for
 * free — apps/web/node_modules/<pkg> links into the monorepo root's node_modules/.pnpm — and that
 * is the exact hole this pins: the pnpm store, served through the link. If the layout ever stops
 * providing one, a link into the OS temp dir is created instead and removed in `after`.
 */
function escapingLink() {
  const rootReal = realpathSync(HERE);
  const outsideRoot = (p) => p !== rootReal && !p.startsWith(rootReal + sep);
  const nm = join(HERE, 'node_modules');
  if (existsSync(nm)) {
    for (const name of readdirSync(nm)) {
      if (name.startsWith('.')) continue;
      const p = join(nm, name);
      try {
        if (lstatSync(p).isSymbolicLink() && outsideRoot(realpathSync(p)) && existsSync(join(p, 'package.json'))) {
          return { url: `/node_modules/${name}/package.json`, created: null };
        }
      } catch { /* a dangling link is not the one wanted */ }
    }
  }
  const outside = realpathSync(tmpdir());
  const marker = join(outside, `cubus-escape-${process.pid}.txt`);
  const link = join(HERE, `__escape-probe-${process.pid}`);
  writeFileSync(marker, 'outside the root');
  symlinkSync(outside, link);
  return { url: `/${basename(link)}/${basename(marker)}`, created: { link, marker } };
}

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

// The traversal guard above reasons about the TEXT of a path. A symlink's text stays inside the
// root while its bytes live outside it, and with CUBUS_DEV_HOST=0.0.0.0 that served the monorepo's
// entire pnpm store to the LAN through apps/web/node_modules/<pkg>. The real location is what has
// to be inside the root.
test('a symlink that resolves outside the root is refused with 403, not served', async () => {
  escape = escapingLink();
  const res = await fetch(`${BASE}${escape.url}`);
  await res.text().catch(() => {});
  assert.equal(res.status, 403, `${escape.url} resolved outside apps/web and was served anyway`);
});

// DNS rebinding: a page on an attacker's name re-points that name at 127.0.0.1 and reads this
// server same-origin. The name is in the Host header, because a name is the only thing that can
// be rebound — so a Host that is neither loopback nor an IP literal is refused before routing.
test('a Host header naming a foreign origin is refused with 403', async () => {
  assert.equal(await statusOf('/', { host: 'evil.example' }), 403);
  assert.equal(await statusOf('/', { host: `evil.example:${PORT}` }), 403);
  assert.equal(await statusOf('/__livereload', { host: `evil.example:${PORT}` }), 403, 'the SSE endpoint too');
});

test('loopback names and IP literals are this server\'s and are served', async () => {
  assert.equal(await statusOf('/serve.mjs', { host: `localhost:${PORT}` }), 200);
  assert.equal(await statusOf('/serve.mjs', { host: `app.localhost:${PORT}` }), 200);
  assert.equal(await statusOf('/serve.mjs', { host: `127.0.0.1:${PORT}` }), 200);
  assert.equal(await statusOf('/serve.mjs', { host: `192.168.1.20:${PORT}` }), 200, 'a phone on the LAN reaches the machine by its address');
  assert.equal(await statusOf('/serve.mjs', { host: `[::1]:${PORT}` }), 200);
});

test('a request with no Host header at all is a 400, not a served file', async () => {
  // Node's http client always sends Host, so this goes down to the socket: an HTTP/1.0 request
  // line and nothing else, which the server used to answer with the file.
  const statusLine = await new Promise((resolve, reject) => {
    const sock = connect(PORT, '127.0.0.1', () => sock.write('GET /serve.mjs HTTP/1.0\r\n\r\n'));
    let data = '';
    sock.on('data', (d) => { data += d.toString(); });
    sock.on('end', () => resolve(data.split('\r\n')[0]));
    sock.on('error', reject);
  });
  assert.match(statusLine, /^HTTP\/1\.[01] 400 /, statusLine);
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
