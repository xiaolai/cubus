// A scan recording is never silently overwritten (apps/web/record-file.mjs).
//
// CODEX AUDIT, 2026-09-26. The recording name is a millisecond timestamp and `writeFile` truncates,
// so two recordings arriving in the same millisecond BOTH answered `ok: true` while only the second
// survived. The server logs what landed precisely because "a recording that silently wrote nothing
// looks exactly like one that worked" — and this was the one way it could.

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { RECORD_NAME_TRIES, writeRecording } from '../record-file.mjs';

const withDir = async (run) => {
  const dir = await mkdtemp(join(tmpdir(), 'cubus-record-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

test('two recordings with the SAME stamp both survive, under different names', async () => {
  await withDir(async (dir) => {
    const first = await writeRecording(dir, 'stamp', Buffer.from('one'));
    const second = await writeRecording(dir, 'stamp', Buffer.from('two'));
    assert.notEqual(second, first, 'the second recording took the first one’s name');
    assert.equal(await readFile(first, 'utf8'), 'one', 'the first recording was overwritten');
    assert.equal(await readFile(second, 'utf8'), 'two');
    assert.match(first, /scan-stamp\.json$/);
    assert.match(second, /scan-stamp-1\.json$/);
  });
});

test('a failure that is not a name clash is raised, not retried into a spin', async () => {
  // Only EEXIST is a collision. No permission, no space, no directory — those are what the caller
  // has to hear about, and a loop that swallowed them would hide the failure behind a hang.
  await assert.rejects(
    () => writeRecording(join(tmpdir(), 'cubus-no-such-dir-27182818'), 'stamp', Buffer.from('x')),
    (err) => err.code === 'ENOENT',
  );
});

test('the suffix search is bounded', async () => {
  await withDir(async (dir) => {
    for (let n = 0; n <= RECORD_NAME_TRIES; n++) await writeRecording(dir, 's', Buffer.from(`${n}`));
    await assert.rejects(
      () => writeRecording(dir, 's', Buffer.from('over')),
      (err) => err.code === 'EEXIST',
    );
  });
});
