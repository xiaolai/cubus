// Minimal zero-dependency static server for the Cubus SPA (local dev only), with live-reload.
//
// Why this exists: getUserMedia requires a "secure context".
// http://localhost counts as secure, so this server is enough for local dev with
// NO TLS certificates. Production must be served over HTTPS on a real origin.
//
// MIME correctness matters: .wasm must be served as application/wasm and .mjs/.js as
// text/javascript, or ES-module imports and WebAssembly streaming instantiation fail.
//
// Live-reload: the server watches web/ and pushes a reload over Server-Sent Events
// (SSE — a plain text/event-stream, so no WebSocket library is needed). A tiny <script>
// is injected into every HTML response; it opens an EventSource and calls location.reload()
// when a change is broadcast. So editing index.html — or running `npm run build:panel`,
// which writes web/vendor/ai-scan-panel.js — refreshes the open tab on its own.

import { watch } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 15173;
// Loopback by default, on purpose: this server has no auth and serves the whole app directory, so
// it should not appear on the LAN because someone ran `pnpm dev`. CUBUS_DEV_HOST=0.0.0.0 opens it
// for `tauri ios dev --host` / `tauri android dev --host`, where the app runs on a physical phone
// and the dev URL is rewritten to this machine's LAN address — loopback is simply unreachable from
// there. Note that a LAN origin is http, so it is NOT a secure context and getUserMedia is
// unavailable on it; that is survivable only because a device build runs NativeDetector, and it is
// exactly why the web fallback must not be relied on silently. The iOS simulator shares the host's
// loopback and needs none of this.
const HOST = process.env.CUBUS_DEV_HOST || '127.0.0.1';
const RELOAD_PATH = '/__livereload';

const MIME = {
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
};

// --- live-reload plumbing (SSE) ---
// Open SSE connections; each is an http response we keep writing to.
const clients = new Set();

function broadcastReload() {
  for (const res of clients) {
    // A dead SSE client throws synchronously on write; it is retired, never mourned.
    try { res.write('data: reload\n\n'); } catch { clients.delete(res); }
  }
}

// Live-reload is for a human with an editor open, and it is actively hostile to a test.
//
// The watcher is recursive over the whole web directory, so ANY write under it — a save, a
// rebuilt bundle, a scratch file someone drops in and deletes — pushes location.reload() to
// every open page. In a browser test that lands mid-evaluate and surfaces as "Execution
// context was destroyed, most likely because of a navigation", attributed to whichever test
// happened to be running rather than to the write. Measured on 2026-08-30: one scratch file
// created and deleted in apps/web while the suite ran failed three unrelated tests across two
// files, and a different three on the next run.
//
// So it is off unless asked for. `pnpm dev` asks (it wants exactly this); every test spawn
// sets CUBUS_LIVE_RELOAD=0 and gets a server that cannot pull the page out from under it.
// Off means BOTH halves off: no watcher, and no snippet in the HTML, so a page served this way
// never even opens the EventSource.
const LIVE_RELOAD = process.env.CUBUS_LIVE_RELOAD !== '0';

// A single save often emits several fs events; coalesce a burst into one reload, and
// fire only after the burst settles so we never reload mid-write of a rebuilt bundle.
let debounce = null;
if (!LIVE_RELOAD) {
  console.log('live-reload off (CUBUS_LIVE_RELOAD=0)');
} else try {
  watch(ROOT, { recursive: true }, (_event, filename) => {
    if (filename?.includes('node_modules')) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      if (clients.size) {
        broadcastReload();
        console.log('reload → browser');
      }
    }, 80);
  });
} catch (err) {
  // Live-reload is a convenience; if watching fails, keep serving without it.
  console.warn(`live-reload disabled (fs.watch failed): ${err.message}`);
}

const RELOAD_SNIPPET =
  `\n<script>(() => { const es = new EventSource(${JSON.stringify(RELOAD_PATH)});` +
  ' es.onmessage = () => location.reload(); })();</script>\n';

// A client that vanished mid-response — a tab closed, a test navigated, webkit tore a context
// down — is churn, not a server fault: without handlers, the stream's 'error' event crashes the
// whole process, and under a parallel test run (six webkits opening and closing pages against
// this server) that killed it mid-suite on 2026-08-30, failing every later test with "could not
// connect". ONLY the client-gone class is swallowed; anything else still fails loud.
const CLIENT_GONE = new Set(['ECONNRESET', 'EPIPE', 'ERR_STREAM_DESTROYED', 'ERR_STREAM_WRITE_AFTER_END']);
const ignoreClientLoss = (stream, onGone) => {
  stream.on('error', (err) => {
    if (CLIENT_GONE.has(err.code)) {
      onGone?.();
      return;
    }
    console.error('serve: stream error', err);
    throw err; // unhandled on purpose — an unknown stream error must not be absorbed
  });
};

const server = createServer(async (req, res) => {
  ignoreClientLoss(req);
  ignoreClientLoss(res);
  // SSE endpoint: keep the connection open and register this client for reload pushes.
  if (req.url === RELOAD_PATH) {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    clients.add(res);
    ignoreClientLoss(res, () => clients.delete(res));
    req.on('close', () => clients.delete(res));
    return;
  }

  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    let target = normalize(join(ROOT, rel));
    // Reject path traversal: the resolved path must stay inside ROOT.
    if (target !== ROOT && !target.startsWith(ROOT + sep)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const s = await stat(target).catch(() => null);
    if (s?.isDirectory()) target = join(target, 'index.html');
    const ext = extname(target);
    // Dev server: never cache, so a plain reload always fetches fresh files. Not for production.
    const headers = { 'content-type': MIME[ext] ?? 'application/octet-stream', 'cache-control': 'no-store' };

    if (ext === '.html') {
      // Inject the live-reload client just before </body> (or append if there is none) — unless
      // live-reload is off, in which case the page must not even open the EventSource: a client
      // that is merely never pushed to is one broadcastReload away from a reload nobody wanted.
      let html = await readFile(target, 'utf8');
      if (LIVE_RELOAD) {
        html = html.includes('</body>') ? html.replace('</body>', `${RELOAD_SNIPPET}</body>`) : html + RELOAD_SNIPPET;
      }
      res.writeHead(200, headers);
      res.end(html);
      return;
    }

    const body = await readFile(target);
    res.writeHead(200, headers);
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

// Fail with a clear, actionable message instead of an unhandled-error stack trace when the port
// is taken (usually a dev server left running from an earlier session).
// Malformed or aborted connections before a request exists — same churn class.
server.on('clientError', (_err, socket) => socket.destroy());

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use — another dev server is probably still running.`);
    console.error(`  Free it:      lsof -ti tcp:${PORT} | xargs kill`);
    console.error(`  Or pick one:  PORT=15174 npm run dev`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  console.log(`Cubus SPA → http://localhost:${PORT}`);
  console.log('  live-reload: watching web/ (edit HTML, or run `npm run build:panel`, to auto-refresh).');
});
