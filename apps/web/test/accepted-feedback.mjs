// "The cube checked out" is the one sound and the one line allowed to outlive the scan screen.
//
// An accepted scan can leave at once — auto-solve (test/scan-screen.test.mjs), or a scan answering a
// reconnect question (test/reconnect-flow.test.mjs) — and leaving silences the screen. That sound and
// that line are the exception: what they say is still true where the app went, and cut at the jump a
// child never hears them (round-3 audit). Both suites ask the same question of the same stand-ins, so
// they ask it through here rather than each spelling it out (audit, 2026-09-19).

import assert from 'node:assert/strict';

/**
 * Assert the finished-scan chime and line were made and then left to finish.
 *
 * @param {object} what `made`, the oscillators the stand-in context made (test/sound-stand-ins.mjs);
 *   `voice`, the speech stand-in; `done`, the line the screen says when it accepts a scan; `notes`,
 *   how many notes that chime is made of.
 */
export function assertFinishedFeedbackSurvived({ made, voice, done, notes = 4 }) {
  assert.equal(made.length, notes, 'the accepted scan made no checked-out sound');
  assert.ok(made.every((o) => o.stops.length === 1), 'the checked-out sound was cut off at the jump');
  assert.equal(voice.said.at(-1), done, 'the accepted scan was not said');
  assert.equal(voice.cuts.filter((line) => line === done).length, 0, '"All done" was cut off at the jump');
}
