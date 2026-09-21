// Integration tests for the dev server. Zero dependencies — Node's built-in test runner
// (`node --test`) + global fetch. Spawns serve.mjs on a test port and exercises the
// security-sensitive guards (path traversal, symlink escape, the Host header) plus MIME, 404,
// HTML injection, and the SSE endpoint.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

/** The environment this process runs in, minus a course directory it might have inherited. */
function withoutCourse() {
  const { CUBUS_COURSE_DIR: _inherited, ...rest } = process.env;
  return rest;
}

before(async () => {
  PORT = await freePort();
  BASE = `http://127.0.0.1:${PORT}`;
  proc = spawn(process.execPath, [join(HERE, 'serve.mjs')], {
    // WITHOUT an inherited course: a developer who exported CUBUS_COURSE_DIR in their shell would
    // otherwise turn every "no course is mounted" case below into a case about their course.
    env: { ...withoutCourse(), PORT: String(PORT) },
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

// THIRD_PARTY_NOTICES.md links ONNX Runtime's notices as plain-text files; served as
// application/octet-stream they download instead of opening.
test('serves the notices .txt files as plain text', async () => {
  const res = await fetch(`${BASE}/notices/onnxruntime-1.29.0-ThirdPartyNotices.txt`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /^text\/plain/);
  await res.text();
});

// A course may show a picture or a silent clip where the cube is (ADR 0007). Served as
// application/octet-stream, a `<video>` refuses the stream outright.
test('pictures and clips are served with types a browser will decode', async () => {
  for (const [path, type] of [['test/fixtures/picture.png', /^image\/png/], ['test/fixtures/clip.mp4', /^video\/mp4/]]) {
    const res = await fetch(`${BASE}/${path}`);
    assert.equal(res.status, 200, path);
    assert.match(res.headers.get('content-type') ?? '', type, path);
    await res.arrayBuffer();
  }
});

test('SSE endpoint uses text/event-stream', async () => {
  const ctrl = new AbortController();
  const res = await fetch(`${BASE}/__livereload`, { signal: ctrl.signal });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
  ctrl.abort(); // don't read the never-ending stream
});

// ---- A course mounted beside the app, for authoring (ADR 0007) ---------------------------------
//
// `CUBUS_COURSE_DIR` serves a course directory that lives OUTSIDE this repository at `/course/`, same
// origin as the app — so the release CSP's `connect-src 'self'` and `media-src 'self'` already cover it —
// and tells the page so with a `<meta name="cubus-course">`. It is a second root on a file whose every
// guard exists because something once leaked through it, so each guard is asked again of the new root.

/** Spawn serve.mjs with `env`, resolving to `{ base, proc, said }` once it is listening, or rejecting. */
async function serveWith(env) {
  const port = await freePort();
  const child = spawn(process.execPath, [join(HERE, 'serve.mjs')], {
    env: { ...withoutCourse(), PORT: String(port), CUBUS_LIVE_RELOAD: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let said = '';
  child.stdout.on('data', (d) => { said += d.toString(); });
  child.stderr.on('data', (d) => { said += d.toString(); });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`server did not start within 5s: ${said}`)), 5000);
    const poll = setInterval(() => {
      if (said.includes(`:${port}`)) { clearTimeout(timeout); clearInterval(poll); resolve(); }
    }, 20);
    child.on('exit', (code) => { clearTimeout(timeout); clearInterval(poll); reject(Object.assign(new Error(said), { code })); });
  });
  return { base: `http://127.0.0.1:${port}`, proc: child, said: () => said };
}

/** A course directory in the OS temp dir: a shelf, one lesson, one recording, and a link out. */
function courseDir() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'cubus-course-')));
  mkdirSync(join(dir, 'voice', 'a-lesson'), { recursive: true });
  writeFileSync(join(dir, 'index.json'), JSON.stringify([{ id: 'a-lesson', title: 'A lesson' }]));
  writeFileSync(join(dir, 'a-lesson.json'), JSON.stringify({ schema: 2, steps: [{ say: 'line 0', voice: 'voice/a-lesson/l0.wav' }] }));
  writeFileSync(join(dir, 'voice', 'a-lesson', 'l0.wav'), 'RIFF');
  const outside = join(realpathSync(tmpdir()), `cubus-course-outside-${process.pid}.txt`);
  writeFileSync(outside, 'outside the course');
  symlinkSync(outside, join(dir, 'escape.txt'));
  return { dir, outside };
}

test('with no course mounted, /course/ is not there and the page is told nothing', async () => {
  const res = await fetch(`${BASE}/course/index.json`);
  await res.text().catch(() => {});
  assert.equal(res.status, 404);
  assert.doesNotMatch(await (await fetch(`${BASE}/`)).text(), /name="cubus-course"/);
});

test('a mounted course is served at /course/, with the app\'s own headers and real types', async (t) => {
  const { dir, outside } = courseDir();
  const server = await serveWith({ CUBUS_COURSE_DIR: dir });
  t.after(() => { server.proc.kill('SIGTERM'); rmSync(dir, { recursive: true, force: true }); rmSync(outside, { force: true }); });

  const index = await fetch(`${server.base}/course/index.json`);
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type') ?? '', /application\/json/);
  assert.deepEqual(await index.json(), [{ id: 'a-lesson', title: 'A lesson' }]);
  // Cross-origin isolation on the course's responses too: under require-corp a same-origin file
  // without CORP is still refused by its own page.
  assert.equal(index.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.equal(index.headers.get('cross-origin-embedder-policy'), 'require-corp');

  const clip = await fetch(`${server.base}/course/voice/a-lesson/l0.wav`);
  assert.equal(clip.status, 200);
  assert.match(clip.headers.get('content-type') ?? '', /^audio\/wav/, 'a recording served as anything else will not decode');
  await clip.text();

  // THE PAGE IS TOLD, in its head: the app installs a course only when the page says there is one,
  // because a packaged build answers a missing file with index.html rather than a 404.
  const page = await (await fetch(`${server.base}/`)).text();
  assert.match(page, /<meta name="cubus-course" content="course\/">[\s\S]*<\/head>/);
  assert.match(server.said(), /course/, 'the log does not say a course is mounted');
});

test('the course root is held to the same guards as the app\'s: no traversal, no link out, no listing', async (t) => {
  const { dir, outside } = courseDir();
  const server = await serveWith({ CUBUS_COURSE_DIR: dir });
  t.after(() => { server.proc.kill('SIGTERM'); rmSync(dir, { recursive: true, force: true }); rmSync(outside, { force: true }); });
  const status = async (path) => { const r = await fetch(`${server.base}${path}`); await r.text().catch(() => {}); return r.status; };

  // An encoded SEPARATOR survives URL parsing and is decoded afterwards, so the decoded path climbs —
  // and the course root's own containment check must be what stops it.
  assert.equal(await status('/course/%2e%2e%2f%2e%2e%2fpackage.json'), 403, 'climbed out of the course with an encoded ../');
  assert.equal(await status('/course/..%2f..%2fetc%2fpasswd'), 403, 'climbed out with an encoded separator');
  // A plain or dot-encoded `..` is resolved by the URL parser BEFORE the server sees it: this asks for
  // the app's own `/serve.mjs`, which the app root serves anyway. Pinned, so it is known to be that and
  // not mistaken for an escape.
  assert.equal(await status('/course/%2e%2e/serve.mjs'), 200);
  assert.equal(await status('/course/escape.txt'), 403, 'a link inside the course was followed out of it');
  assert.equal(await status('/course/'), 404, 'the course directory was listed or answered as a page');
  // And the app itself is untouched by the second root.
  assert.equal(await status('/serve.mjs'), 200);
});

test('a course directory that is not there stops the server, naming the variable', async () => {
  for (const bad of [join(tmpdir(), `cubus-no-such-course-${process.pid}`), join(HERE, 'serve.mjs')]) {
    // A server that STARTED is killed here, whatever the assertion then says: left running, it keeps
    // this test process alive and the suite hangs instead of failing.
    const outcome = await serveWith({ CUBUS_COURSE_DIR: bad }).then((s) => { s.proc.kill('SIGTERM'); return null; }, (err) => err);
    assert.ok(outcome, `the server started over ${bad}, which is not a course directory`);
    assert.notEqual(outcome.code, 0, 'it exited cleanly over a course it could not serve');
    assert.match(outcome.message, /CUBUS_COURSE_DIR/);
  }
});

test('a change in the course reloads the page, as a change in the app does', async (t) => {
  const { dir, outside } = courseDir();
  const server = await serveWith({ CUBUS_COURSE_DIR: dir });
  t.after(() => { server.proc.kill('SIGTERM'); rmSync(dir, { recursive: true, force: true }); rmSync(outside, { force: true }); });
  const ctrl = new AbortController();
  const res = await fetch(`${server.base}/__livereload`, { signal: ctrl.signal });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const heard = (async () => {
    let text = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return text;
      text += decoder.decode(value);
      if (text.includes('data: reload')) return text;
    }
  })();
  await new Promise((r) => setTimeout(r, 150));   // the watcher is armed at startup; let the stream open
  writeFileSync(join(dir, 'a-lesson.json'), JSON.stringify({ schema: 2, steps: [{ say: 'line 1' }] }));
  const text = await Promise.race([heard, new Promise((r) => setTimeout(() => r('(timed out)'), 3000))]);
  ctrl.abort();
  heard.catch(() => {});   // the aborted stream rejects its pending read; that is the abort, not a failure
  assert.match(text, /data: reload/, 'rewriting a lesson did not reload the page');
});
