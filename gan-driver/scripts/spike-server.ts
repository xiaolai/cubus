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

// --- driver lifecycle: scan for MAC, connect, auto-recover ------------------
let lastFacelets = '';
async function runDriver(): Promise<void> {
  broadcast({ type: 'status', status: 'connecting' });
  let dev: Awaited<ReturnType<typeof scanForCube>>[number] | undefined;
  while (!dev) {
    const devices = await scanForCube(SCAN_ADV, 10);
    dev = devices.find((d) => /gan/i.test(d.name) && d.manufacturerData);
    if (!dev)
      broadcast({ type: 'status', status: 'connecting', detail: 'twist the cube to wake it' });
  }
  const mac = extractMacFromManufacturerData(dev.manufacturerData!);
  if (!mac) throw new Error('could not recover MAC');
  const device = dev.name;

  const cube = new GanCube({ mac, transport: new BlewTransport(dev.id) });
  cube.on('error', (e: Error) => console.error('driver error:', e.message));
  cube.on('live', () => broadcast({ type: 'status', status: 'live' }));
  cube.on('reconnecting', () => broadcast({ type: 'status', status: 'reconnecting' }));
  cube.onFacelets((f) => {
    if (f.facelets === lastFacelets) return; // only push on real change
    lastFacelets = f.facelets;
    broadcast({
      type: 'state',
      device,
      facelets: f.facelets,
      setupAlg: setupAlgFor(f.facelets),
      capturedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    });
  });
  cube.on('giveup', () => {
    broadcast({ type: 'status', status: 'giveup', detail: 'cube unreachable — retrying in 5s' });
    setTimeout(() => void runDriver(), 5000); // auto-reconnector
  });
  cube.connect();
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
    lastFacelets = '';
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
