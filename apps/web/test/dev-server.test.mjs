// The dev server's request handling, in-process (`dev-server.mjs`), where a test can see what a spawned
// server hides: a descriptor closing when a download is abandoned, the length declared against the bytes
// sent when a file is replaced mid-request, and the status a failure is answered with. `serve.test.mjs`
// holds the server as a whole — host guard, traversal, types, the course mount — through a real spawn.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { appendFileSync, chmodSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { open as fsOpen, realpath as fsRealpath } from 'node:fs/promises';
import { get, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { createDevServer } from '../dev-server.mjs';

const made = [];
after(() => { for (const dir of made) rmSync(dir, { recursive: true, force: true }); });

/** A throwaway root holding a page and a large asset. */
function rootWithFiles() {
  const dir = mkdtempSync(join(tmpdir(), 'cubus-dev-server-'));
  made.push(dir);
  writeFileSync(join(dir, 'index.html'), '<html><head></head><body>app</body></html>');
  writeFileSync(join(dir, 'big.bin'), Buffer.alloc(8 * 1024 * 1024, 7));
  writeFileSync(join(dir, 'small.txt'), 'first');
  return dir;
}

/** A log that remembers, so a test can say what was — and was not — worth a line. */
function recordingLog() {
  const lines = [];
  const say = (level) => (...args) => lines.push([level, args.map(String).join(' ')]);
  return { lines, log: say('log'), warn: say('warn'), error: say('error') };
}

/** A server over `dir`, listening on a free port. */
async function start(dir, options = {}) {
  const log = options.log ?? recordingLog();
  const dev = createDevServer({ root: dir, rootReal: realpathSync(dir), liveReload: false, log, ...options });
  await new Promise((resolve) => dev.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${dev.server.address().port}`;
  return { dev, log, base, stop: () => dev.close() };
}

/** Wait for `check` to hold, or fail saying what it was waiting for. */
async function until(check, what, ms = 3000) {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** One request, no pooled connection; resolves with the status, the declared length and the body. */
function fetchWhole(url) {
  return new Promise((resolve, reject) => {
    get(url, { agent: false }, (res) => {
      const parts = [];
      res.on('data', (d) => parts.push(d));
      res.on('end', () => resolve({ status: res.statusCode, length: res.headers['content-length'], body: Buffer.concat(parts) }));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/** A request line sent as written — `fetch` and `get` would normalise the path before it left. */
function requestRaw(base, path) {
  const { hostname, port } = new URL(base);
  return new Promise((resolve, reject) => {
    const req = request({ hostname, port, path, agent: false }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
    req.end();
  });
}

test('a download the client abandons lets go of its file', async () => {
  const dir = rootWithFiles();
  const s = await start(dir);
  try {
    await new Promise((resolve, reject) => {
      const req = get(`${s.base}/big.bin`, { agent: false }, (res) => {
        res.once('data', () => { req.destroy(); resolve(); });
      });
      req.on('error', (err) => { if (err.code !== 'ECONNRESET') reject(err); });
    });
    await until(() => s.dev.openFiles() === 0, 'the abandoned download to close its descriptor');
  } finally {
    await s.stop();
  }
});

test('a client gone before the file was even open does not leave it open', async () => {
  const dir = rootWithFiles();
  let letOpen;
  const opening = new Promise((r) => { letOpen = r; });
  let opened = 0;
  const io = { realpath: fsRealpath, open: async (...a) => { await opening; opened += 1; return fsOpen(...a); } };
  const s = await start(dir, { io });
  try {
    const req = get(`${s.base}/big.bin`, { agent: false });
    req.on('error', () => {});
    await new Promise((r) => setTimeout(r, 50));
    req.destroy();
    await new Promise((r) => setTimeout(r, 50));
    letOpen();
    await until(() => opened === 1, 'the open to happen');
    await until(() => s.dev.openFiles() === 0, 'the file opened for a departed client to close');
  } finally {
    await s.stop();
  }
});

test('a file replaced between being found and being opened is sent whole, under its own length', async () => {
  const dir = rootWithFiles();
  const path = join(dir, 'small.txt');
  const io = {
    // The course rebuild's move: a new file renamed over the old, right after the path was resolved.
    realpath: async (p) => {
      const real = await fsRealpath(p);
      if (p.endsWith('small.txt')) { writeFileSync(`${path}.new`, 'the second, longer version'); renameSync(`${path}.new`, path); }
      return real;
    },
    open: fsOpen,
  };
  const s = await start(dir, { io });
  try {
    const r = await fetchWhole(`${s.base}/small.txt`);
    assert.equal(r.status, 200);
    assert.equal(Number(r.length), r.body.length, 'the length declared is not the length sent');
    assert.equal(r.body.toString(), 'the second, longer version');
  } finally {
    await s.stop();
  }
});

test('a file that grows while it is sent puts no more on the wire than it declared', async () => {
  const dir = rootWithFiles();
  const path = join(dir, 'small.txt');
  const io = {
    realpath: fsRealpath,
    open: async (...a) => {
      const fh = await fsOpen(...a);
      const stat = fh.stat.bind(fh);
      // Appended after the size was read: the same file, longer by the time it is streamed.
      fh.stat = async () => { const st = await stat(); appendFileSync(path, ' and more'); return st; };
      return fh;
    },
  };
  const s = await start(dir, { io });
  try {
    const r = await fetchWhole(`${s.base}/small.txt`);
    assert.equal(r.body.toString(), 'first', 'bytes past the declared length were sent');
    assert.equal(Number(r.length), 5);
  } finally {
    await s.stop();
  }
});

test('each failure is answered with its own status, and only the ones worth knowing are logged', async () => {
  const dir = rootWithFiles();
  let failWith = null;
  const io = { realpath: fsRealpath, open: async (...a) => { if (failWith) throw failWith; return fsOpen(...a); } };
  const s = await start(dir, { io });
  try {
    const status = async (path) => (await fetchWhole(`${s.base}${path}`)).status;
    assert.equal(await status('/%E0%A4%A'), 400, 'a path that is not valid percent-encoding is not a missing file');
    assert.equal(await status('/no-such-file.js'), 404);
    // Request lines that name no path: a NUL the file system would refuse as an argument, and an authority
    // the URL parser refuses. Both were 500s (verify pass, 2026-09-21).
    assert.equal(await requestRaw(s.base, '/%00'), 400, 'a NUL in the path is a bad request');
    assert.equal(await requestRaw(s.base, '//['), 400, 'a request line that is not a URL is a bad request');
    assert.deepEqual(s.log.lines, [], 'an ordinary 400 or 404 was logged');

    failWith = Object.assign(new Error('too many open files'), { code: 'EMFILE' });
    assert.equal(await status('/small.txt'), 503);
    failWith = new TypeError('a bug in the server');
    assert.equal(await status('/small.txt'), 500);
    failWith = null;
    assert.equal(s.log.lines.filter(([level]) => level === 'error').length, 2, 'a server failure went unlogged');
  } finally {
    await s.stop();
  }
});

// Root reads a mode-000 file, so there the case cannot be made -- and is SKIPPED, never counted as passed.
const asRoot = process.getuid?.() === 0;
test('a file the server may not read is forbidden and logged, not a missing file', { skip: asRoot && 'running as root, which reads a mode-000 file' }, async () => {
  const dir = rootWithFiles();
  const locked = join(dir, 'locked.txt');
  writeFileSync(locked, 'secret');
  chmodSync(locked, 0o000);
  const s = await start(dir);
  try {
    assert.equal((await fetchWhole(`${s.base}/locked.txt`)).status, 403);
    assert.match(s.log.lines.at(-1)[1], /locked\.txt → 403/);
  } finally {
    chmodSync(locked, 0o600);
    await s.stop();
  }
});

/** A watcher double: an emitter that can be told to fail, and that says when it was closed. */
function fakeWatch({ refuse = [] } = {}) {
  const made = new Map();
  const watch = (dir) => {
    if (refuse.includes(dir)) throw new Error('watch refused');
    const w = Object.assign(new EventEmitter(), { closed: false, close() { this.closed = true; } });
    made.set(dir, w);
    return w;
  };
  return { watch, made };
}

test('a watcher that fails later takes only live-reload with it, and the page stops being offered it', async () => {
  const dir = rootWithFiles();
  const watched = fakeWatch();
  const s = await start(dir, { liveReload: true, watch: watched.watch });
  try {
    assert.deepEqual(s.dev.watching(), ['web/']);
    assert.match((await fetchWhole(`${s.base}/`)).body.toString(), /EventSource/);
    // With no error listener this was an uncaught 'error' event: the process ended.
    watched.made.get(dir).emit('error', new Error('the watched directory went away'));
    assert.deepEqual(s.dev.watching(), []);
    assert.equal(watched.made.get(dir).closed, true);
    assert.match(s.log.lines.at(-1)[1], /stopped watching web\//);
    const page = await fetchWhole(`${s.base}/`);
    assert.equal(page.status, 200, 'serving stopped with the watcher');
    assert.doesNotMatch(page.body.toString(), /EventSource/, 'a page was handed a reload client nothing will ever push to');
  } finally {
    await s.stop();
  }
});

test('a course that cannot be watched leaves the app watched, and says which one is not', async () => {
  const dir = rootWithFiles();
  const courseDir = mkdtempSync(join(tmpdir(), 'cubus-dev-course-'));
  made.push(courseDir);
  const watched = fakeWatch({ refuse: [courseDir] });
  const course = { mount: 'course', root: courseDir, real: realpathSync(courseDir) };
  const s = await start(dir, { liveReload: true, watch: watched.watch, course, courseMeta: '<meta name="cubus-course" content="course/">' });
  try {
    assert.deepEqual(s.dev.watching(), ['web/'], 'the app watcher was either dropped or not reported');
    assert.match(s.log.lines.map(([, line]) => line).join('\n'), /cannot watch the course/);
    assert.match((await fetchWhole(`${s.base}/`)).body.toString(), /EventSource/, 'the app is still watched, so its pages still reload');
  } finally {
    await s.stop();
  }
});
