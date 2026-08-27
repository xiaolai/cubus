// Static file server for the Web-Bluetooth spike. Web Bluetooth needs a secure
// context, and http://localhost counts — so the page must be served, not opened
// as a file://. All BLE now happens in the browser via gan-web-bluetooth; this
// server does nothing but hand over the page. Open it in Chrome or Edge.
//
// Usage: npm run spike:serve   then open http://localhost:4123 in Chrome
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 4123;
const WEB = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'dev-docs',
  'spikes',
  'cube-state',
);

createServer((req, res) => {
  const rel =
    req.url === '/' ? 'index.html' : ((req.url ?? '').replace(/^\//, '').split('?')[0] ?? '');
  const target = resolve(WEB, rel);
  if (target !== resolve(WEB, 'index.html') && !target.startsWith(resolve(WEB) + sep)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const body = readFileSync(target);
    const ext = target.endsWith('.js') ? 'text/javascript' : 'text/html';
    res.writeHead(200, { 'Content-Type': `${ext}; charset=utf-8` }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`spike -> http://localhost:${PORT}`);
  console.log('Open it in Chrome or Edge (Web Bluetooth), click Connect, pick your cube.');
});
