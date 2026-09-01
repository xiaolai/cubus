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

/** Every test file under apps/web, wherever it sits. */
const testFiles = () => {
  const out = [];
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'vendor' || entry.name === 'dist') continue;
      const path = `${dir}${entry.name}`;
      const label = `${prefix}${entry.name}`;
      if (entry.isDirectory()) walk(`${path}/`, `${label}/`);
      else if (entry.name.endsWith('.test.mjs')) out.push({ label, text: readFileSync(path, 'utf8') });
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

test('the files that spawn a server actually use freePort', () => {
  // The other half: the check above passes for a file that spawns a server on a literal, and it
  // passes for one that spawns nothing at all. This one names the requirement positively.
  const spawners = testFiles().filter(({ text }) => text.includes('serve.mjs'));
  assert.ok(spawners.length >= 5, `only ${spawners.length} server-spawning tests found`);
  const missing = spawners.filter(({ text }) => !text.includes('freePort')).map((f) => f.label);
  assert.deepEqual(missing.sort(), [], 'a test spawns serve.mjs without asking the OS for a port');
});
