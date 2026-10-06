// No test may choose its own port number.
//
// `free-port.mjs` exists because fixed ports fail in a way that reads as someone else's bug: a run
// killed between spawning `serve.mjs` and reaching its `after` hook leaves the port held, and
// every later run then dies at startup with "server did not start within 5s". Its own note records
// that being misdiagnosed as a regression twice on 2026-08-30.
//
// It happened a third time. Seven test files were moved onto `freePort()` and two were not —
// `serve.test.mjs` on 5199 and `solve-worker-browser.test.mjs` on 5196, the latter carrying a
// comment that spelled out the hand-allocated scheme as though it were the design. Sixteen tests
// went red, at HEAD, for two orphaned `serve.mjs` processes that had outlived the runs that
// spawned them by half an hour. Migrating the two removes today's failure; this test is what stops
// the next file being written the old way, because the fix and the guard are not the same artifact.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const WEB = fileURLToPath(new URL('../', import.meta.url));
/** This file, as `testFiles()` labels it. A rule does not police itself: it quotes every name it looks
 *  for, so it matches its own detector and passes only because it also quotes `freePort` — which would
 *  turn a rename of that helper into a failure in the rule rather than in the thing it guards. Derived
 *  rather than written down, so moving this file does not quietly re-admit it. */
const SELF = fileURLToPath(import.meta.url).slice(WEB.length);

/** Every test file under apps/web, wherever it sits. */
const testFiles = () => {
  const out = [];
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'vendor' || entry.name === 'dist') continue;
      const path = `${dir}${entry.name}`;
      const label = `${prefix}${entry.name}`;
      if (entry.isDirectory()) walk(`${path}/`, `${label}/`);
      else if (entry.name.endsWith('.test.mjs') && label !== SELF) out.push({ label, text: readFileSync(path, 'utf8') });
    }
  };
  walk(WEB, '');
  return out;
};

test('no test picks its own port — they all ask the OS', () => {
  const files = testFiles();
  assert.ok(files.length > 10, `only ${files.length} test files found — the walk is broken`);
  // A port assigned to a constant is the shape that outlives the run. `freePort()` results are
  // assigned too, so the pattern is deliberately about a NUMBER in the 1024-65535 range.
  const fixed = [];
  for (const { label, text } of files) {
    for (const line of text.split('\n')) {
      if (/^\s*(\/\/|\*)/.test(line)) continue; // the comments above are allowed to name the old ones
      const m = /\b(?:const|let|var)\s+\w*PORT\w*\s*=\s*(\d{4,5})\b/i.exec(line);
      if (m) fixed.push(`${label}: ${m[1]}`);
    }
  }
  assert.deepEqual(
    fixed.sort(),
    [],
    'a test hardcodes a port. Use `freePort()` from test/free-port.mjs: a fixed number is held by ' +
      'any run that was killed before its cleanup, and every run after it then fails at startup ' +
      'for a reason that has nothing to do with the code.',
  );
});

/** Does this file START a server, as opposed to talking about one? Comments do not count — a line of
 *  prose that names `serve.mjs` is not a spawn, and classifying by a bare `includes` over the whole text
 *  made every file that MENTIONED the server a spawner (audit, 2026-10-06). `dev-server.test.mjs` was
 *  failed by its own header sentence while listening on a port the OS chose. */
const startsAServer = (text) => text.split('\n')
  .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
  .some((line) => line.includes('serve.mjs') || /\.listen\s*\(/.test(line));

/** Does it ASK for a port, by either of the two ways that are safe? `listen(0)` hands the choice to the
 *  OS exactly as `freePort()` does — the rule is about a NUMBER nobody can release, not about one helper. */
const asksForAPort = (text) => text.includes('freePort') || /\.listen\s*\(\s*0\s*[,)]/.test(text);

test('the files that start a server actually ask the OS for a port', () => {
  // The other half: the check above passes for a file that spawns a server on a literal, and it
  // passes for one that spawns nothing at all. This one names the requirement positively.
  const spawners = testFiles().filter(({ text }) => startsAServer(text));
  assert.ok(spawners.length >= 5, `only ${spawners.length} server-starting tests found`);
  const missing = spawners.filter(({ text }) => !asksForAPort(text)).map((f) => f.label);
  assert.deepEqual(missing.sort(), [], 'a test starts a server without asking the OS for a port');
});
