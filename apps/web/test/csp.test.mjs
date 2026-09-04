// The desktop app's Content Security Policy, pinned — because it was `null` for as long as the
// app existed, and a null CSP is the one setting Tauri's own security guide calls a hole.
//
// The policy lives in tauri.conf.json ONLY. index.html carries no <meta http-equiv> for it,
// deliberately: Tauri injects the policy on every HTML it serves through its custom protocol and
// adds a hash for each script it injects itself, so a meta tag would be a second, weaker copy that
// the browser build would enforce on itself for no reader. (The browser build is a test harness,
// not a supported viewport.)
//
// What the policy has to permit, and why each source is there — so the next person tightening it
// knows which one breaks which feature rather than finding out from a blank scan screen:
//   script-src  'self' 'wasm-unsafe-eval'  — the ONNX runtime compiles WebAssembly; without
//                                            wasm-unsafe-eval WebAssembly.instantiate is refused.
//                                            No 'unsafe-eval': nothing in the app uses eval or
//                                            Function (the MCP dev guest does, see devCsp).
//   style-src   'self' 'unsafe-inline'     — index.html's own <style> block and the renderer's
//                                            element styles.
//   img-src     'self' blob: data:         — canvas readbacks and the scan panel's frames.
//   media-src   'self' blob:               — the camera's MediaStream on a <video>.
//   worker-src  'self' blob:               — the runtime's threaded wasm spawns a blob: worker.
//   connect-src 'self' ipc: http://ipc.localhost — Tauri's IPC, in its macOS/Linux and Windows
//                                            spellings. Nothing else: the updater fetches from
//                                            Rust, and the app makes no other request.
//   object-src 'none'; base-uri 'none'; frame-ancestors 'none' — the belts with no feature
//                                            behind them.
//
// VERIFIED BEHAVIOURALLY on 2026-09-05 against a `tauri build --debug --no-bundle` binary (which
// serves through the custom protocol, where the policy applies — with `devUrl` set, `tauri dev`
// loads the dev server directly and Tauri applies NO policy there, so devCsp is inert in
// practice): the policy was live (eval refused with the CSP text), and with a temporary
// `report-uri` pointing at a local receiver, Home, the scan screen and Settings produced zero
// violation reports. The receiver's log is the evidence; this file pins the text that was tested.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const confUrl = new URL('../../desktop/src-tauri/tauri.conf.json', import.meta.url);
const conf = JSON.parse(readFileSync(confUrl, 'utf8'));
const security = conf.app?.security ?? {};

const RELEASE =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' blob: data:; media-src 'self' blob:; worker-src 'self' blob:; " +
  "connect-src 'self' ipc: http://ipc.localhost; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

/** A CSP string as a map of directive → the set of its sources. */
function parse(csp) {
  const out = new Map();
  for (const part of String(csp).split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const [directive, ...sources] = tokens;
    out.set(directive, new Set(sources));
  }
  return out;
}

test('the desktop CSP is non-null and is exactly the documented policy', () => {
  assert.ok(security.csp, 'tauri.conf.json app.security.csp is null or missing — the webview runs with no policy');
  assert.equal(security.csp, RELEASE,
    'the release CSP drifted from the policy this file documents and that was verified in the app — ' +
      'change both, and re-run the behavioural check described at the top of this file');
});

test('the release policy carries the belts that have no feature behind them', () => {
  const p = parse(security.csp);
  assert.deepEqual([...p.get('object-src')], ["'none'"]);
  assert.deepEqual([...p.get('base-uri')], ["'none'"]);
  assert.deepEqual([...p.get('frame-ancestors')], ["'none'"]);
  assert.ok(!p.get('script-src').has("'unsafe-eval'"), 'the release policy must not allow eval');
  assert.ok(!p.get('script-src').has("'unsafe-inline'"), 'the release policy must not allow inline scripts');
  assert.ok(p.get('script-src').has("'wasm-unsafe-eval'"), 'the ONNX runtime needs to compile WebAssembly');
  assert.ok(p.get('worker-src').has('blob:'), 'the threaded wasm runtime spawns a blob: worker');
});

test('devCsp only ADDS sources to the release policy, never removes or widens a directive it lacks', () => {
  // The dev server injects an inline live-reload <script> and the MCP guest uses `new Function`,
  // so development needs 'unsafe-inline' and 'unsafe-eval' on script-src. It needs nothing else,
  // and a devCsp that quietly dropped a belt would be a policy nobody runs the app under twice.
  assert.ok(security.devCsp, 'devCsp is missing — dev would fall back to the release policy and block the live-reload snippet');
  const release = parse(security.csp);
  const dev = parse(security.devCsp);
  assert.deepEqual([...dev.keys()].sort(), [...release.keys()].sort(), 'the same directives, no more, no fewer');
  for (const [directive, sources] of release) {
    for (const s of sources) {
      assert.ok(dev.get(directive).has(s), `devCsp dropped ${s} from ${directive}`);
    }
    const extra = [...dev.get(directive)].filter((s) => !sources.has(s));
    if (directive === 'script-src') {
      assert.deepEqual(extra.sort(), ["'unsafe-eval'", "'unsafe-inline'"], 'script-src gains exactly the two dev needs');
    } else {
      assert.deepEqual(extra, [], `devCsp widened ${directive} with ${extra.join(' ')}`);
    }
  }
});

test('Tauri is told to leave style-src alone, so unsafe-inline actually applies to style attributes', () => {
  // MEASURED, not reasoned: the first probe build reported 13 `style-src-attr` violations at boot
  // (app.js 770, 4172, 4232 — `style="…"` attributes in rendered templates), with the policy
  // reading `style-src 'self' 'unsafe-inline' 'nonce-…'`. Tauri appends a nonce to style-src for
  // the <style> block it nonces in index.html, and the CSP spec says a directive that carries a
  // nonce or hash IGNORES 'unsafe-inline' — so Tauri's own hardening silently turned the
  // documented policy into one that blocked every inline style attribute the app sets. Listing
  // the directive here keeps Tauri's hands off style-src only; script-src keeps its hashes, which
  // is the half worth having.
  assert.deepEqual(security.dangerousDisableAssetCspModification, ['style-src'],
    'exactly ["style-src"]: `true` would also stop the script-src hashes, and nothing else needs exempting');
});

test('index.html carries no CSP meta of its own — the config is the one source', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(!/http-equiv\s*=\s*["']Content-Security-Policy["']/i.test(html),
    'a CSP <meta> in index.html would be a second, weaker copy of the policy');
});

test('the MCP socket precedence is spelled identically on both sides', () => {
  // The Rust side computes the socket path (lib.rs `mcp_socket_path_from`: explicit
  // TAURI_MCP_IPC_PATH → $XDG_RUNTIME_DIR → $TMPDIR → /tmp) and .mcp.json cannot expand variables
  // in `env`, so it runs the server through `sh -c` with the same precedence in shell. Two
  // spellings of one rule, pinned to each other here: a change to one without the other is an
  // agent that cannot find the app.
  const mcp = JSON.parse(readFileSync(new URL('../../../.mcp.json', import.meta.url), 'utf8'));
  const server = mcp.mcpServers['tauri-mcp'];
  assert.equal(server.command, 'sh');
  assert.equal(server.args[0], '-c');
  assert.match(server.args[1],
    /TAURI_MCP_IPC_PATH="\$\{TAURI_MCP_IPC_PATH:-\$\{XDG_RUNTIME_DIR:-\$\{TMPDIR:-\/tmp\}\}\/cubus-mcp\.sock\}"/,
    '.mcp.json must derive the socket path with the explicit → XDG_RUNTIME_DIR → TMPDIR → /tmp precedence');
  assert.ok(!server.args[1].includes('/tmp/cubus-mcp.sock"'), 'a bare /tmp socket is world-visible and pre-creatable');
  const rust = readFileSync(new URL('../../desktop/src-tauri/src/lib.rs', import.meta.url), 'utf8');
  for (const v of ['TAURI_MCP_IPC_PATH', 'XDG_RUNTIME_DIR', 'TMPDIR']) {
    assert.ok(rust.includes(`"${v}"`), `lib.rs no longer reads ${v}`);
  }
  assert.ok(!/socket_path\(std::path::PathBuf::from\("\/tmp/.test(rust),
    'lib.rs must not hand the plugin a hardcoded shared /tmp socket');
  assert.match(rust, /\.socket_path\(socket\)/, 'the computed path is what the plugin gets');
});
