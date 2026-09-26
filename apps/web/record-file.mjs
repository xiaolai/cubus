// Writing a scan recording under a name that is not already taken.
//
// ITS OWN MODULE SO THE RULE CAN BE TESTED. `serve.mjs` calls `server.listen` at import, so nothing
// in it can be exercised without starting a server — and the defect this holds is invisible unless
// the clock is controlled: the recording name is a millisecond timestamp and `writeFile` TRUNCATES,
// so two recordings arriving in the same millisecond both answered `ok: true` while only the second
// survived (Codex audit, 2026-09-26). A recording that silently wrote nothing looks exactly like one
// that worked, which is the whole reason the server logs what landed.

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** How many suffixed names to try before giving up, so a clash cannot become a spin. */
export const RECORD_NAME_TRIES = 50;

/**
 * Write `body` into `dir` under `scan-<stamp>.json`, suffixing until the name is free.
 *
 * `wx` FAILS RATHER THAN OVERWRITES, which is what makes a collision something this can see; with
 * the default flag there is nothing to detect. Only `EEXIST` is retried — no permission, no space
 * and every other failure is the thing the caller has to hear about, and looping on one would hide
 * it. Returns the path actually written.
 */
export async function writeRecording(dir, stamp, body, tries = RECORD_NAME_TRIES) {
  for (let n = 0; ; n++) {
    const file = join(dir, n === 0 ? `scan-${stamp}.json` : `scan-${stamp}-${n}.json`);
    try {
      await writeFile(file, body, { flag: 'wx' });
      return file;
    } catch (err) {
      if (err?.code !== 'EEXIST' || n >= tries) throw err;
    }
  }
}
