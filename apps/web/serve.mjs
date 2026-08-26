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
const HOST = '127.0.0.1';
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
  for (const res of clients) res.write('data: reload\n\n');
}

// A single save often emits several fs events; coalesce a burst into one reload, and
// fire only after the burst settles so we never reload mid-write of a rebuilt bundle.
let debounce = null;
try {
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

const server = createServer(async (req, res) => {
  // SSE endpoint: keep the connection open and register this client for reload pushes.
  if (req.url === RELOAD_PATH) {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    clients.add(res);
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
      // Inject the live-reload client just before </body> (or append if there is none).
      let html = await readFile(target, 'utf8');
      html = html.includes('</body>') ? html.replace('</body>', `${RELOAD_SNIPPET}</body>`) : html + RELOAD_SNIPPET;
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
