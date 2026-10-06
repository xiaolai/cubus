// Minimal zero-dependency static server for the Cubus SPA (local dev only), with live-reload. This file
// reads the environment and listens; what a request meets is `dev-server.mjs`, where a test can reach it.
//
// Why this exists: getUserMedia requires a "secure context".
// http://localhost counts as secure, so this server is enough for local dev with
// NO TLS certificates. Production must be served over HTTPS on a real origin.
//
// Live-reload: the server watches web/ and pushes a reload over Server-Sent Events
// (SSE — a plain text/event-stream, so no WebSocket library is needed). A tiny <script>
// is injected into every HTML response; it opens an EventSource and calls location.reload()
// when a change is broadcast. So editing index.html — or running `npm run build:panel`,
// which writes web/vendor/ai-scan-panel.js — refreshes the open tab on its own.

import { realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDevServer } from './dev-server.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
// The root with every symlink resolved, because containment is decided on REAL paths (see `openServed`
// in dev-server.mjs): a checkout that itself sits behind a symlink must not be refused wholesale.
const ROOT_REAL = realpathSync(ROOT);
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

// A COURSE, mounted beside the app for authoring (ADR 0007; dev-docs/course-and-drills-plan.md §10,
// item 1). The course is not in this repository and may never be (ADR 0006 decision 1), so it is
// served from wherever `CUBUS_COURSE_DIR` points — at `/course/`, SAME ORIGIN as the app, which is what
// lets the release CSP's `connect-src 'self'` and `media-src 'self'` cover it with no change.
//
// It is a SECOND ROOT on a server whose every guard exists because something once leaked through it, so
// the request handling (`dev-server.mjs`) asks each of them again of this root: the text of the path must
// stay inside it, and so must its real location once every link is followed. A variable naming something
// that is not a directory stops the server here, by name — serving the app with no course, while the author
// believes a course is mounted, is the silent failure this refuses.
const COURSE_MOUNT = 'course';
const COURSE_ROOT = (() => {
  const named = process.env.CUBUS_COURSE_DIR;
  if (!named) return null;
  const dir = resolve(named);
  let isDir = false;
  try { isDir = statSync(dir).isDirectory(); } catch { /* not there at all */ }
  if (!isDir) {
    console.error(`CUBUS_COURSE_DIR=${named} is not a directory, so there is no course to serve.`);
    console.error('  Point it at a built course (the folder holding index.json), or unset it.');
    process.exit(1);
  }
  return dir;
})();
const COURSE_REAL = COURSE_ROOT ? realpathSync(COURSE_ROOT) : null;
// What tells the page it has a course: the app installs one only when this is present. Not a probe for
// `course/index.json` — a packaged build answers a missing file with index.html, not a 404.
const COURSE_META = `<meta name="cubus-course" content="${COURSE_MOUNT}/">`;

// Where a scan recording is POSTed (`dev-docs/scan-recording-session-2026-09-23.md`).
//
// SAME ORIGIN ON PURPOSE. The desktop shell's CSP allows `connect-src 'self'` and nothing else, and under
// `tauri dev` this server IS 'self' — so the page can hand a session over without the CSP being widened
// for a debugging convenience, and without a Tauri command, which would be a seam the browser build does
// not have. A recording is too big to read out any other way: 4,000 frames of every candidate above 0.05
// with all six class scores is tens of megabytes.
//
// The DIRECTORY is decided here and the handling is in `dev-server.mjs`, which is this file's whole
// division of labour: a path read off the environment is this file's, and a request is not. It also makes
// the endpoint reachable by a test, which it was not while it lived in the listener.
//
// Dev only. `build.mjs` produces `dist/` and never includes this server.
const RECORD_DIR = join(ROOT, '..', '..', 'dev-docs', 'recordings');

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
// So it is ON BY DEFAULT and off when asked: `pnpm dev` wants exactly this and passes nothing, and
// every test spawn sets CUBUS_LIVE_RELOAD=0 and gets a server that cannot pull the page out from under
// it. (This said "off unless asked for", which was never what the line below did — audit, 2026-09-21.)
// Off means BOTH halves off: no watcher, and no snippet in the HTML, so a page served this way never
// even opens the EventSource.
const LIVE_RELOAD = process.env.CUBUS_LIVE_RELOAD !== '0';
if (!LIVE_RELOAD) console.log('live-reload off (CUBUS_LIVE_RELOAD=0)');

const dev = createDevServer({
  root: ROOT,
  rootReal: ROOT_REAL,
  course: COURSE_ROOT ? { mount: COURSE_MOUNT, root: COURSE_ROOT, real: COURSE_REAL } : null,
  courseMeta: COURSE_META,
  liveReload: LIVE_RELOAD,
  host: HOST,
  recordDir: RECORD_DIR,
});

// Fail with a clear, actionable message instead of an unhandled-error stack trace when the port
// is taken (usually a dev server left running from an earlier session).
dev.server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use — another dev server is probably still running.`);
    console.error(`  Free it:      lsof -ti tcp:${PORT} | xargs kill`);
    console.error(`  Or pick one:  PORT=15174 npm run dev`);
    process.exit(1);
  }
  throw err;
});

dev.server.listen(PORT, HOST, () => {
  console.log(`Cubus SPA → http://localhost:${PORT}`);
  if (COURSE_ROOT) console.log(`  course: ${COURSE_ROOT} → /${COURSE_MOUNT}/`);
  // Say what is actually true — read from what IS watched, not from what was asked for. This line
  // printed unconditionally, so a server started with live-reload off announced that it was watching;
  // and a watcher that failed to start was reported as live-reload disabled while another still ran.
  const watching = dev.watching();
  if (!LIVE_RELOAD) console.log('  live-reload: off — nothing is watched and no reload client is served.');
  else if (!watching.length) console.log('  live-reload: off — nothing could be watched, so no reload client is served.');
  else console.log(`  live-reload: watching ${watching.join(' and ')} (edit HTML, or run \`npm run build:panel\`, to auto-refresh).`);
});
