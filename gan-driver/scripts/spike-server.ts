// Live spike server: runs the driver against the physical cube and streams its
// state to the browser over Server-Sent Events (SSE). This is the "Node sidecar"
// transport from the plan, in miniature — the browser can't do BLE, so Node does
// it and pushes state out. SSE needs no dependency and the browser's EventSource
// auto-reconnects the browser<->server link for free.
//
// Usage: npm run spike:serve   then open http://localhost:4123
import { readFileSync } from 'node:fs';
import { type ServerResponse, createServer } from 'node:http';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import Cube from 'cubejs';
import { GanCube } from '../src/driver.js';
import { extractMacFromManufacturerData } from '../src/mac.js';
import { BlewTransport, scanForCube } from '../src/transport/blew.js';

const PORT = 4123;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_ADV = join(ROOT, 'scripts', 'scan-adv');
const WEB = join(ROOT, '..', 'dev-docs', 'spikes', 'cube-state');

Cube.initSolver(); // ~1s once; solving each state afterwards is fast

// --- shared state broadcast to every SSE client -----------------------------
type Msg =
  | { type: 'status'; status: 'connecting' | 'live' | 'reconnecting' | 'giveup'; detail?: string }
  | { type: 'state'; device: string; facelets: string; setupAlg: string; capturedAt: string };

const clients = new Set<ServerResponse>();
let lastStatus: Msg = { type: 'status', status: 'connecting' };
let lastState: Msg | null = null;

function broadcast(msg: Msg) {
  if (msg.type === 'status') lastStatus = msg;
  if (msg.type === 'state') lastState = msg;
  const line = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of clients) res.write(line);
}

function setupAlgFor(facelets: string): string {
  const solution = Cube.fromString(facelets).solve();
  const invert = (m: string) => (m.endsWith('2') ? m : m.endsWith("'") ? m[0]! : `${m}'`);
  return solution.trim().split(/\s+/).reverse().map(invert).join(' ');
}

// --- driver lifecycle ------------------------------------------------------
// Scan ONCE to recover the MAC (needed for decryption); after that, blew
// connects by device-id on its own — re-scanning was the failure point, so on
// any drop we just spin up a fresh transport, never re-scan.
let cachedFacelets = '';
let cachedAlg = '';
let device: { mac: string; id: string; name: string } | null = null;

async function ensureDevice(): Promise<{ mac: string; id: string; name: string }> {
  if (device) return device;
  // Spike shortcut: if the cube's MAC + CoreBluetooth id are provided, skip
  // scan-adv and let blew connect by id (its own scan is more persistent than
  // our short windows). Both are stable per-Mac and safe to pass in dev.
  if (process.env.GAN_MAC && process.env.GAN_ID) {
    device = {
      mac: process.env.GAN_MAC,
      id: process.env.GAN_ID,
      name: process.env.GAN_NAME ?? 'GAN cube',
    };
    return device;
  }
  broadcast({ type: 'status', status: 'connecting', detail: 'twist the cube to wake it' });
  for (;;) {
    const found = (await scanForCube(SCAN_ADV, 8)).find(
      (d) => /gan/i.test(d.name) && d.manufacturerData,
    );
    const mac = found?.manufacturerData && extractMacFromManufacturerData(found.manufacturerData);
    if (found && mac) {
      device = { mac, id: found.id, name: found.name };
      return device;
    }
  }
}

function startTransport(dev: { mac: string; id: string; name: string }): void {
  const cube = new GanCube({ mac: dev.mac, transport: new BlewTransport(dev.id) });
  cube.on('error', (e: Error) => console.error('driver error:', e.message));
  cube.on('live', () => broadcast({ type: 'status', status: 'live' }));
  cube.on('reconnecting', () => broadcast({ type: 'status', status: 'reconnecting' }));
  cube.onFacelets((f) => {
    if (f.facelets !== cachedFacelets) {
      cachedFacelets = f.facelets;
      cachedAlg = setupAlgFor(f.facelets); // recompute the alg only when the state changes
    }
    // Push on EVERY facelets (~1 Hz while connected) so the page's timestamp
    // keeps advancing — that is how the page proves the feed is live vs. stale.
    broadcast({
      type: 'state',
      device: dev.name,
      facelets: f.facelets,
      setupAlg: cachedAlg,
      capturedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    });
  });
  cube.on('giveup', () => {
    // Keep trying — no slow re-scan, just a fresh transport by the known id.
    broadcast({ type: 'status', status: 'reconnecting', detail: 'retrying' });
    setTimeout(() => startTransport(dev), 1500);
  });
  cube.connect();
}

async function runDriver(): Promise<void> {
  startTransport(await ensureDevice());
}

// --- http + SSE -------------------------------------------------------------
const server = createServer((req, res) => {
  const url = req.url ?? '/';
  if (url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(`retry: 2000\n\n`); // browser reconnect backoff
    clients.add(res);
    res.write(`data: ${JSON.stringify(lastStatus)}\n\n`); // catch new clients up
    if (lastState) res.write(`data: ${JSON.stringify(lastState)}\n\n`);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url === '/retry' && req.method === 'POST') {
    cachedFacelets = '';
    device = null; // force a fresh scan in case the device id changed
    void runDriver();
    res.writeHead(204).end();
    return;
  }
  // static: index.html + state.js — confine to WEB (no path traversal)
  const rel = url === '/' ? 'index.html' : url.replace(/^\//, '').split('?')[0]!;
  const resolved = resolve(WEB, rel);
  if (resolved !== resolve(WEB, 'index.html') && !resolved.startsWith(resolve(WEB) + sep)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const body = readFileSync(resolved);
    const ext = resolved.endsWith('.js') ? 'text/javascript' : 'text/html';
    res.writeHead(200, { 'Content-Type': `${ext}; charset=utf-8` }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

// keep SSE connections from idling out
setInterval(() => {
  for (const res of clients) res.write(': ping\n\n');
}, 15000);

server.listen(PORT, '127.0.0.1', () => {
  console.log(`live cube spike -> http://localhost:${PORT}`);
  console.log('twist the cube to wake it; the page shows live state + connection status.');
  void runDriver();
});
