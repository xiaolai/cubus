// What a release's web assets must NOT contain — asserted on an actual assembly, never on a list.
//
// build.mjs copies vendor/ wholesale on purpose (a new bundle is never silently missed), which is
// also how the dev-only MCP guest — 193 KB of eval-capable in-page listeners for an agent bridge
// no release compiles — shipped in every Tauri release until 2026-09-05, beside a comment saying
// the release "ships without it by design". A comment is not a gate. This runs the real assembly
// into a throwaway directory and looks at what came out.

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { FILES, NEVER_SHIPPED, assembleDist } from '../build.mjs';

const WEB = new URL('../', import.meta.url);

// The exclusion names real files, or it excludes nothing. A rename on either side would leave the
// list guarding a path that no longer exists while the renamed file shipped.
test('every never-shipped path names a file that exists in vendor/ today', () => {
  for (const f of NEVER_SHIPPED) {
    assert.ok(existsSync(new URL(f, WEB)), `${f} is on the never-ship list but does not exist — the list is stale`);
  }
  assert.ok(NEVER_SHIPPED.includes('vendor/tauri-mcp-guest.js'), 'the MCP guest must never ship');
  assert.ok(NEVER_SHIPPED.includes('vendor/min2phase.PROVENANCE.md'), 'the removed solver\'s provenance note must never ship');
});

test('dist never carries the MCP guest or the min2phase provenance note, and does carry the notices', () => {
  const dist = mkdtempSync(join(tmpdir(), 'cubus-dist-'));
  try {
    // `freshness: false`: this asks what dist CONTAINS, not whether the bundle is newer than its
    // source — a working tree mid-change fails the latter, and vendor-bundles.test.mjs is the
    // test that says so, by content. The CLI keeps the check on (build.mjs, assembleDist).
    assembleDist({ dist, freshness: false });
    for (const f of NEVER_SHIPPED) {
      assert.ok(!existsSync(join(dist, f)), `${f} reached dist/`);
    }
    // The copy still happened: the exclusion is a filter, not a skipped directory.
    assert.ok(existsSync(join(dist, 'vendor/cubus-cube.js')), 'vendor/ was not copied');
    assert.ok(existsSync(join(dist, 'vendor/cubejs.js')), 'vendor/ was not copied');
    // And the licence notices ship with the app they describe.
    assert.ok(FILES.includes('THIRD_PARTY_NOTICES.md'));
    const notices = join(dist, 'THIRD_PARTY_NOTICES.md');
    assert.ok(existsSync(notices), 'THIRD_PARTY_NOTICES.md did not reach dist/');
    assert.match(readFileSync(notices, 'utf8'), /^# Third-party notices/m);
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

// The guest is loaded by app.js under Tauri with a `.catch`, which is what makes leaving it out of
// dist a clean absence rather than a broken boot. Pinned here beside the exclusion, because the
// two are one decision: remove the catch and the exclusion becomes a blank window.
test('app.js tolerates the guest\'s absence — the import is caught, not awaited bare', () => {
  const app = readFileSync(new URL('lib/app.js', WEB), 'utf8');
  const site = app.indexOf("import('../vendor/tauri-mcp-guest.js')");
  assert.notEqual(site, -1, 'the guest import moved or was removed — update this test and NEVER_SHIPPED together');
  const after = app.slice(site, site + 400);
  assert.match(after, /\.catch\(/, 'the guest import is not caught: a dist without the guest would fail to boot');
});
