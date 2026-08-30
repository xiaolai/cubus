// A free port from the OS, rather than a number chosen by hand.
//
// The WebKit suites each spawn their own serve.mjs. With fixed ports (5197, 5201) an interrupted
// run leaves the server holding one, and every later run then fails at startup — four times on
// 2026-08-30, twice misdiagnosed as a regression in whatever had just changed. Fixed ports also
// mean two checkouts of this repo cannot run their tests at the same time.
//
// Asking the OS removes the class: it hands back a port nothing is using, so a stale orphan is
// irrelevant. The listener is closed before the port is returned, which leaves a theoretical gap
// before serve.mjs binds it — but the OS does not hand the same ephemeral port to two callers in
// that window, and the alternative (a fixed number) fails in practice rather than in theory.
import { createServer } from 'node:net';

export const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
