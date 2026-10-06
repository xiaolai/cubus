// "The cube checked out" is the one sound allowed to outlive the scan screen.
//
// An accepted scan can leave at once — auto-solve (test/scan-screen.test.mjs), or a scan answering a
// reconnect question (test/reconnect-flow.test.mjs) — and leaving silences the screen. That sound is
// the exception: what it says is still true where the app went, and cut at the jump a child never
// hears it (round-3 audit). Both suites ask the same question of the same stand-in, so they ask it
// through here rather than each spelling it out (audit, 2026-09-19).
//
// The spoken "All done" that used to be checked beside it is gone with the voice (owner, 2026-09-30).

import assert from 'node:assert/strict';

/**
 * Assert the finished-scan chime was made and then left to finish.
 *
 * @param {object} what `made`, the oscillators the stand-in context made (test/sound-stand-ins.mjs);
 *   `notes`, how many notes that chime is made of.
 */
export function assertFinishedFeedbackSurvived({ made, notes = 4 }) {
  assert.equal(made.length, notes, 'the accepted scan made no checked-out sound');
  assert.ok(made.every((o) => o.stops.length === 1), 'the checked-out sound was cut off at the jump');
}
