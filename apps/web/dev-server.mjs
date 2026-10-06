// The dev server's parts, importable without starting anything. `serve.mjs` is the entry: it reads the
// environment, refuses a bad course directory, and listens. Everything a request meets is here, split by
// what it decides — the host, the route, the file, the answer — because it was one 131-line handler whose
// branches shared a catch-all that answered every failure 404 (audit, 2026-09-21). In-process, a test can
// see what a spawned server hides: a descriptor closing, a status chosen for a failure.
//
// MIME correctness matters: .wasm must be served as application/wasm and .mjs/.js as text/javascript, or
// ES-module imports and WebAssembly streaming instantiation fail.

import { constants, watch as fsWatch } from 'node:fs';
import { mkdir, open as fsOpen, realpath as fsRealpath } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { pipeline } from 'node:stream';

import { writeRecording } from './record-file.mjs';

export const RELOAD_PATH = '/__livereload';
/** Where a scan recording is POSTed. The client supplies the BODY and never a name, so there is no path
 *  for it to traverse; `serve.mjs` decides the directory. */
export const RECORD_PATH = '/__record';
/** Refuse a body past this. A stuck session is ~30 MB; 256 MB is a runaway, not a scan.
 *  It is also the DEFAULT of a `recordLimit` option rather than a fixed number, because a guard that can
 *  only be exercised by posting 256 MB is a guard nobody runs — and this one refuses mid-stream, which is
 *  the part worth holding. */
export const RECORD_LIMIT = 256 * 1024 * 1024;

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  // Audio, because a course is narration: without these a lesson's track is served as
  // application/octet-stream and the element refuses to decode it. The dev server could not serve
  // a course at all until this was here (found by audit, 2026-09-20).
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  // Pictures and silent clips, because a course may show one where the cube is (ADR 0007). A `<video>`
  // refuses a stream served as application/octet-stream; an `<img>` mostly sniffs, and is given its type
  // anyway rather than left to guess.
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.md': 'text/markdown; charset=utf-8', // THIRD_PARTY_NOTICES.md, linked from the About card
  '.txt': 'text/plain; charset=utf-8', // notices/*.txt, linked from THIRD_PARTY_NOTICES.md
};

/** The host name inside a Host header, lower-cased and without its port; null when there is none. */
export function hostnameOf(header) {
  if (typeof header !== 'string' || header.trim() === '') return null;
  const h = header.trim().toLowerCase();
  if (h.startsWith('[')) { // an IPv6 literal: [::1]:15173
    const end = h.indexOf(']');
    return end === -1 ? null : h.slice(1, end);
  }
  const colon = h.lastIndexOf(':');
  return colon === -1 ? h : h.slice(0, colon);
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const IPV6 = /^[0-9a-f:.]+$/; // already unbracketed; loose on purpose — an IP literal is not a DNS name

/**
 * Whether a request's Host header names THIS server rather than a name an attacker controls.
 *
 * DNS rebinding: a page on evil.example, once loaded, re-points its own name at 127.0.0.1 and then
 * reads http://evil.example:15173/ — same-origin to itself, answered by this process, which has no
 * auth and serves the whole app directory. The tell is the Host header: it carries the attacker's
 * NAME, because a name is the only thing that can be rebound. So a Host that is a loopback name or
 * an IP literal is this server's, and anything else is refused before routing. `.localhost` names
 * are loopback by RFC 6761; an IP literal has no DNS record to move (and a cross-origin fetch to
 * one gets no CORS headers from here, so its response is unreadable anyway). CUBUS_DEV_HOST set to
 * a NAME (`bound`) is allowed too, since that is what the operator asked this server to answer as;
 * the wildcard binds (0.0.0.0, ::) are not names and grant nothing.
 */
export function hostAllowed(hostname, bound) {
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
  if (IPV4.test(hostname) || (hostname.includes(':') && IPV6.test(hostname))) return true;
  const name = String(bound).toLowerCase();
  return hostname === name && name !== '0.0.0.0' && name !== '::';
}

/** Is `p` the directory `root`, or somewhere beneath it? A text comparison; see `openServed`. */
export const inside = (p, root) => p === root || p.startsWith(root + sep);

/** A request refused on purpose, with the status it is answered with. */
class Refusal extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * The answer to a failure, and whether it is worth a line in the log.
 *
 * NOT EVERYTHING IS A 404. Every failure used to become an unlogged 404, so a file the server may not
 * read, a path that is not valid percent-encoding, a process out of descriptors and a plain bug all looked
 * like a missing asset, and said nothing (audit, 2026-09-21). A missing file is the ordinary case and is
 * not logged; anything the person running the server would want to know about is.
 */
export function answerFor(err) {
  if (err instanceof Refusal) return { status: err.status, text: err.message, log: false };
  switch (err?.code) {
    case 'ENOENT':
    case 'ENOTDIR':
      return { status: 404, text: 'not found', log: false };
    // ELOOP includes a link put where a checked path was — the open below refuses to follow one.
    case 'EACCES':
    case 'EPERM':
    case 'ELOOP':
      return { status: 403, text: 'forbidden', log: true };
    case 'EMFILE':
    case 'ENFILE':
      return { status: 503, text: 'busy: out of file descriptors', log: true };
    default:
      return { status: 500, text: 'server error', log: true };
  }
}

/**
 * The path a request line asks for, decoded — or a 400 for a request line that names no path at all.
 *
 * EVERY WAY A REQUEST LINE CAN FAIL TO BE A PATH IS A 400, decided here, before anything touches the file
 * system. A bad percent-escape was, but `//[` (an authority with a broken IPv6 literal, which the URL parser
 * refuses) and `/%00` (a NUL, which the file system refuses as an ARGUMENT error — a programming error's
 * code) fell through to the catch-all and were answered 500 (verify pass, 2026-09-21).
 */
export function requestPath(requestUrl) {
  let url;
  // A fixed base: the path is all that is wanted from the request line, and the Host header has already
  // been judged — it must not get a second chance to shape the URL.
  try { url = new URL(requestUrl ?? '/', 'http://localhost'); } catch { throw new Refusal(400, 'bad request: the request line is not a URL'); }
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { throw new Refusal(400, 'bad request: the path is not valid percent-encoding'); }
  if (rel.includes('\0')) throw new Refusal(400, 'bad request: the path holds a NUL, which names no file');
  return rel.replace(/^\/+/, '') || 'index.html';
}

/**
 * Which root a decoded request path is under, and the path inside it.
 *
 * Decided on the DECODED path, so `/course%2F..` is a course request that then fails the course root's own
 * containment check, rather than slipping past it.
 */
export function routeOf(rel, { root, rootReal, course = null }) {
  if (course === null || !(rel === course.mount || rel.startsWith(`${course.mount}/`))) {
    return { root, rootReal, rel, course: false };
  }
  return { root: course.root, rootReal: course.real, rel: rel.slice(course.mount.length + 1), course: true };
}

/** Cross-origin isolation and no caching — see `headersFor`. */
const ISOLATED = Object.freeze({
  'cache-control': 'no-store',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'require-corp',
  'cross-origin-resource-policy': 'same-origin',
});

/**
 * The headers every file is served with.
 *
 * Dev server: never cache, so a plain reload always fetches fresh files. Not for production.
 * Cross-origin isolation, which is the whole reason the scanner can use more than one core.
 *
 * onnxruntime-web ships a THREADED wasm build (copy-ort.mjs picks the
 * `ort-wasm-simd-threaded.asyncify` pair) and it needs SharedArrayBuffer, which the browser only
 * hands out to a cross-origin-isolated page. Without these two headers the runtime silently
 * reports numThreads: 1 and one core does the work of eight — measured at 297 ms per
 * inference in WebKit and 234 ms in Chromium, about 3-4 fps, which is the "same rate as the
 * wasm fallback" the desktop shell's Cargo.toml already complains about.
 *
 * require-corp is safe here in a way it would not be in most apps: this page embeds nothing
 * cross-origin at all. No CDN, no web fonts, no remote model — and solver-offline.test.mjs
 * already fails the build if a CDN import ever creeps in. CORP on every response is the
 * matching half, so a same-origin subresource cannot be refused by its own policy.
 */
const headersFor = (ext) => ({ 'content-type': MIME[ext] ?? 'application/octet-stream', ...ISOLATED });

// A client that vanished mid-response — a tab closed, a test navigated, webkit tore a context
// down — is churn, not a server fault: without handlers, the stream's 'error' event crashes the
// whole process, and under a parallel test run (six webkits opening and closing pages against
// this server) that killed it mid-suite on 2026-08-30, failing every later test with "could not
// connect". ONLY the client-gone class is swallowed; anything else still fails loud.
const CLIENT_GONE = new Set(['ECONNRESET', 'EPIPE', 'ERR_STREAM_DESTROYED', 'ERR_STREAM_WRITE_AFTER_END', 'ERR_STREAM_PREMATURE_CLOSE']);
const ignoreClientLoss = (stream, log, onGone) => {
  stream.on('error', (err) => {
    if (CLIENT_GONE.has(err.code)) {
      onGone?.();
      return;
    }
    log.error('serve: stream error', err);
    throw err; // unhandled on purpose — an unknown stream error must not be absorbed
  });
};

const RELOAD_SNIPPET =
  `\n<script>(() => { const es = new EventSource(${JSON.stringify(RELOAD_PATH)});` +
  ' es.onmessage = () => location.reload(); })();</script>\n';

/**
 * The dev server over `root` (and a course, when one is mounted), not yet listening.
 *
 * `io` and `watch` are the file system, replaceable so a test can put a failure exactly where it wants
 * one: a file replaced between being found and being opened, a watcher that errors after it started.
 */
export function createDevServer({
  root,
  rootReal = root,
  course = null,
  courseMeta = '',
  liveReload = true,
  host = '127.0.0.1',
  log = console,
  io = { realpath: fsRealpath, open: fsOpen },
  watch = fsWatch,
  recordDir = null,
  recordLimit = RECORD_LIMIT,
}) {
  const roots = { root, rootReal, course };

  // --- live-reload plumbing (SSE) ---
  // Open SSE connections; each is an http response we keep writing to.
  const clients = new Set();
  const broadcastReload = () => {
    for (const res of clients) {
      // A dead SSE client throws synchronously on write; it is retired, never mourned.
      try { res.write('data: reload\n\n'); } catch { clients.delete(res); }
    }
  };

  // A single save often emits several fs events; coalesce a burst into one reload, and
  // fire only after the burst settles so we never reload mid-write of a rebuilt bundle.
  let debounce = null;
  const onChange = (_event, filename) => {
    if (filename?.includes('node_modules')) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      if (clients.size) {
        broadcastReload();
        log.log('reload → browser');
      }
    }, 80);
  };

  /**
   * EACH ROOT IS WATCHED ON ITS OWN, and each watcher keeps an error handler. Both were missing: a watcher
   * that errored after it started had no listener, so the error ended the process a comment promised would
   * degrade gracefully; and a course watcher failing to start left the app's running while the log said
   * live-reload was disabled (audit, 2026-09-21). What is watched is now a fact the log and the HTML both
   * read — live-reload is a convenience, and losing it must never take serving with it.
   */
  const watchers = new Map();
  if (liveReload) {
    const wanted = [['web/', root], ...(course ? [['the course', course.root]] : [])];
    for (const [label, dir] of wanted) {
      try {
        const watcher = watch(dir, { recursive: true }, onChange);
        watcher.on('error', (err) => {
          log.warn(`live-reload: stopped watching ${label} (${err.message})`);
          watchers.delete(label);
          try { watcher.close(); } catch { /* already gone */ }
        });
        watchers.set(label, watcher);
      } catch (err) {
        log.warn(`live-reload: cannot watch ${label} (fs.watch failed: ${err.message})`);
      }
    }
  }

  // Every descriptor a request holds, so a test can see one close rather than infer it.
  const openFiles = new Set();

  /**
   * Open what `target` names, or refuse. ONE DESCRIPTOR from here on: the size is read from it and the
   * bytes streamed from it. The size used to come from a stat of the PATH, and the bytes from opening the
   * path again later, so a file replaced in between — a course rebuild writes new files over old — went
   * out under the old one's Content-Length (audit, 2026-09-21).
   *
   * SYMLINKS RESOLVED, and checked again. `normalize` reasons about the TEXT of a path, and a
   * symlink is a file whose text says one thing while its bytes live somewhere else: with
   * CUBUS_DEV_HOST=0.0.0.0, `/node_modules/three/package.json` stayed inside ROOT textually and
   * served the pnpm store — every package in the monorepo, from the repository root — through
   * the link, to anyone on the LAN. So the path is realpath'd, every link in it followed, and
   * the REAL location must be inside the REAL root. ROOT is realpath'd too (`rootReal`), so a
   * checkout that itself sits behind a symlink is not refused wholesale. And the checked path is
   * opened with O_NOFOLLOW, so a link put in its place after the check is refused, not followed.
   */
  const openServed = async (target, rootOf) => {
    const real = await io.realpath(target);
    if (!inside(real, rootOf)) throw new Refusal(403, 'forbidden');
    const fh = await io.open(real, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    openFiles.add(fh);
    fh.once('close', () => openFiles.delete(fh));
    try {
      return { fh, stat: await fh.stat(), target };
    } catch (err) {
      await fh.close();
      throw err;
    }
  };

  /** The file a route names: a directory is its index.html, and anything but a file is not found. */
  const openRequested = async (route) => {
    const target = normalize(join(route.root, route.rel));
    // Reject path traversal: the resolved path must stay inside its root.
    if (!inside(target, route.root)) throw new Refusal(403, 'forbidden');
    let opened = await openServed(target, route.rootReal);
    if (opened.stat.isDirectory()) {
      await opened.fh.close();
      opened = await openServed(join(target, 'index.html'), route.rootReal);
    }
    if (!opened.stat.isFile()) {
      await opened.fh.close();
      throw new Refusal(404, 'not found');
    }
    return opened;
  };

  /** An app page, with the course's tag and the reload client written in. */
  const sendHtml = async (res, fh, headers) => {
    // Inject the live-reload client just before </body> (or append if there is none) — unless
    // nothing is watched, in which case the page must not even open the EventSource: a client
    // that is merely never pushed to is one broadcastReload away from a reload nobody wanted.
    let html = await fh.readFile('utf8');
    if (course) {
      html = html.includes('</head>') ? html.replace('</head>', `${courseMeta}\n</head>`) : courseMeta + html;
    }
    if (watchers.size) {
      html = html.includes('</body>') ? html.replace('</body>', `${RELOAD_SNIPPET}</body>`) : html + RELOAD_SNIPPET;
    }
    res.writeHead(200, headers);
    res.end(html);
  };

  /**
   * Streamed, with an explicit Content-Length, and neither half is cosmetic.
   *
   * This used to `readFile` the whole file and `res.end(buffer)`. With no Content-Length, Node
   * sends HTTP/1.1 chunked — and a chunked body that stops early looks COMPLETE to the client,
   * which is how a truncated 26.8 MB wasm reached WebKit and failed as
   * "WebAssembly.Module doesn't parse at byte 24666430". The file on disk was byte-identical
   * to its source the whole time; the delivery was short. It surfaced as
   * threads-do-not-change-output failing, i.e. as a MODEL regression — the most expensive
   * possible disguise for a dev-server bug.
   *
   * Content-Length makes a short read an error the client raises instead of a corrupt asset it
   * parses. Streaming removes the cause: the suite runs at --test-concurrency=6 and several
   * files each spawn their own server, so buffering ~27 MB per request multiplied by
   * concurrent requests, and a socket write under that memory pressure is where the bytes went.
   *
   * The read is BOUNDED to the size declared, so a file that grows while it is sent cannot put more on the
   * wire than the header promised. And it goes through `pipeline`, not `pipe`: `pipe` leaves its source
   * open when the DESTINATION closes, so every download a client abandoned — a navigation, a closed tab —
   * held a paused stream, 64 KiB of buffer and a descriptor for the life of the process (audit,
   * 2026-09-21). A read that dies mid-flight still breaks the connection rather than ending it tidily:
   * `pipeline` destroys the response, and a clean end after a partial body is exactly the silent
   * truncation this is about.
   */
  /**
   * The one byte range a `Range:` header asks for, or null for "send the whole thing".
   *
   * ONLY the single-range forms, which is what a media element sends: `bytes=START-`, `bytes=START-END`
   * and the suffix `bytes=-N`. A multi-range request is answered with the whole file, which is what the
   * spec allows and what no client here ever asks for. `false` means the range cannot be met and the
   * answer is 416 — never a 200, which would hand a player bytes it did not ask for and let it believe
   * they came from the offset it wanted.
   */
  const rangeOf = (header, size) => {
    if (typeof header !== 'string') return null;
    const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (!m || (m[1] === '' && m[2] === '')) return null;
    if (m[1] === '') {                                   // the last N bytes
      const n = Number(m[2]);
      return n === 0 ? false : { start: Math.max(0, size - n), end: size - 1 };
    }
    const start = Number(m[1]);
    const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
    if (start > end || start >= size) return false;
    return { start, end };
  };

  /**
   * Streamed, with an explicit Content-Length, and neither half is cosmetic. (See the note above
   * `rangeOf` for the range half, added 2026-10-07.)
   *
   * RANGE REQUESTS ARE ANSWERED, because a media element makes them. This server used to reply 200 with
   * the whole file however the request was framed, and never said `Accept-Ranges` — which is a contract
   * a browser's media stack is entitled to rely on. On the Linux CI runner a lesson's recording reached
   * `readyState` 2 with `currentTime` 0 and no error, intermittently, and the lesson stopped on it; macOS
   * WebKit and Chromium tolerate the plain 200, which is the platform split that made it look like an app
   * bug. Serving ranges is right whatever that turns out to be: seeking in a recording needs it too.
   *
   * [The original note, which still holds:] This used to `readFile` the whole file and `res.end(buffer)`.
   * With no Content-Length, Node sends HTTP/1.1 chunked — and a chunked body that stops early looks
   * COMPLETE to the client, which is how a truncated 26.8 MB wasm reached WebKit and failed as
   * "WebAssembly.Module doesn't parse at byte 24666430". The file on disk was byte-identical to its
   * source the whole time; the delivery was short. It surfaced as threads-do-not-change-output failing,
   * i.e. as a MODEL regression — the most expensive possible disguise for a dev-server bug.
   *
   * Content-Length makes a short read an error the client raises instead of a corrupt asset it parses.
   * Streaming removes the cause: the suite runs at --test-concurrency=6 and several files each spawn
   * their own server, so buffering ~27 MB per request multiplied by concurrent requests, and a socket
   * write under that memory pressure is where the bytes went.
   *
   * The read is BOUNDED to the span declared, so a file that grows while it is sent cannot put more on
   * the wire than the header promised. And it goes through `pipeline`, not `pipe`: `pipe` leaves its
   * source open when the DESTINATION closes, so every download a client abandoned — a navigation, a
   * closed tab — held a paused stream, 64 KiB of buffer and a descriptor for the life of the process
   * (audit, 2026-09-21). A read that dies mid-flight still breaks the connection rather than ending it
   * tidily: `pipeline` destroys the response, and a clean end after a partial body is exactly the silent
   * truncation this is about.
   */
  const streamFile = (res, fh, size, headers, rangeHeader) => {
    const want = rangeOf(rangeHeader, size);
    if (want === false) {
      res.writeHead(416, { ...headers, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes */${size}`, 'Content-Length': 0 });
      res.end();
      return fh.close();
    }
    const { start, end } = want ?? { start: 0, end: size - 1 };
    const length = size === 0 ? 0 : end - start + 1;
    res.writeHead(want ? 206 : 200, {
      ...headers,
      'Accept-Ranges': 'bytes',
      'Content-Length': length,
      ...(want ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
    });
    if (length === 0) {
      res.end();
      return fh.close();
    }
    pipeline(fh.createReadStream({ start, end }), res, (err) => {
      if (err && !CLIENT_GONE.has(err.code)) log.error('serve: a file stopped mid-send', err);
    });
    return null;
  };

  /** A file request, from its URL to its last byte, every failure answered with its own status. */
  const serveFile = async (req, res) => {
    // Closed before an answer was ready: the client went, and whatever was opened for it is let go HERE.
    // `pipeline` cannot do it: the response's close has already fired, so it waits on an event that has come
    // and gone, and the file sat open (measured by `dev-server.test.mjs` with this check removed).
    let closed = false;
    res.once('close', () => { closed = true; });
    let held = null;
    try {
      const route = routeOf(requestPath(req.url), roots);
      held = await openRequested(route);
      if (closed) return;
      const ext = extname(held.target);
      if (ext === '.html' && !route.course) {
        await sendHtml(res, held.fh, headersFor(ext));
        return;
      }
      const { fh, stat } = held;
      held = null; // the stream owns it now, and closes it however the send ends
      await streamFile(res, fh, stat.size, headersFor(ext), req.headers.range);
    } catch (err) {
      const answer = answerFor(err);
      if (answer.log) log.error(`serve: ${req.url} → ${answer.status}`, err);
      // Once the head has gone, a status can no longer be said — only the connection broken.
      if (res.headersSent) res.destroy();
      else res.writeHead(answer.status).end(answer.text);
    } finally {
      if (held) await held.fh.close().catch(() => { /* closing is all that was left to do */ });
    }
  };

  /** The reload endpoint: keep the connection open and register this client for reload pushes. */
  const serveReload = (req, res) => {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    clients.add(res);
    ignoreClientLoss(res, log, () => clients.delete(res));
    req.on('close', () => clients.delete(res));
  };

  /**
   * A scan recording arriving from the page: POST only, and this server chooses the name.
   *
   * It answers with the path it WROTE rather than the one it meant to, and logs the size, because a
   * recording that silently wrote nothing looks exactly like one that worked. With no `recordDir` the
   * endpoint is not there at all — a 404 from `serveFile`, which is what a built app should look like.
   */
  const serveRecord = (req, res) => {
    if (recordDir === null) { void serveFile(req, res); return; }
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' }).end('POST a session here');
      return;
    }
    const chunks = [];
    let size = 0;
    let refused = false;
    req.on('data', (chunk) => {
      if (refused) return;
      size += chunk.length;
      if (size > recordLimit) {
        refused = true;
        res.writeHead(413).end(`recording past ${recordLimit} bytes`);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', async () => {
      if (refused) return;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      // The name a collision would have taken, for the failure log below; `writeRecording` answers the
      // one it actually used.
      let file = join(recordDir, `scan-${stamp}.json`);
      try {
        await mkdir(recordDir, { recursive: true });
        file = await writeRecording(recordDir, stamp, Buffer.concat(chunks));
        log.log(`[record] ${size} bytes -> ${file}`);
        res.writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ ok: true, file, bytes: size }));
      } catch (cause) {
        log.error(`[record] could not write ${file}:`, cause);
        res.writeHead(500, { 'content-type': 'application/json' })
          .end(JSON.stringify({ ok: false, error: String(cause) }));
      }
    });
  };

  const server = createServer((req, res) => {
    ignoreClientLoss(req, log);
    ignoreClientLoss(res, log);
    // The Host header before any route — the reload endpoint included, because a rebound name must
    // not get to hold a connection open either. HTTP/1.1 requires the header; a request without one
    // is not a browser's, and there is nothing to check it against.
    const hostname = hostnameOf(req.headers.host);
    if (hostname === null) {
      res.writeHead(400).end('bad request: no Host header');
      return;
    }
    if (!hostAllowed(hostname, host)) {
      res.writeHead(403).end('forbidden: this server answers to localhost and IP literals only');
      return;
    }
    if (req.url === RECORD_PATH) {
      serveRecord(req, res);
      return;
    }
    if (req.url === RELOAD_PATH) {
      serveReload(req, res);
      return;
    }
    void serveFile(req, res);
  });
  // Malformed or aborted connections before a request exists — same churn class.
  server.on('clientError', (_err, socket) => socket.destroy());

  return {
    server,
    /** What is being watched for live-reload, by name: `web/`, `the course`. */
    watching: () => [...watchers.keys()],
    /** How many descriptors requests hold open right now. */
    openFiles: () => openFiles.size,
    /** Stop watching, drop the reload clients, and close the server. */
    close() {
      if (debounce) clearTimeout(debounce);
      for (const watcher of watchers.values()) watcher.close();
      watchers.clear();
      for (const res of clients) res.destroy();
      clients.clear();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
