// Which line the scan says, and when (lib/screens/scan/spoken.js) — as a table over the pure functions.
//
// Every cue has an ENTRY (the report that calls for it), a PERSISTENCE (the reports it is not said
// again on) and an EXIT (the report after which it no longer holds); and where two cues are called for
// by one report, the priority decides. The first version decided by the order of six `if`s, and a
// confirm ask was cut off by "ask a grown-up" because a mismatch notice carried an error tone (audit,
// 2026-09-19). The screen's wiring — events in, the voice out, nothing after leaving — is held by
// test/scan-screen.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// The voice's modules read the settings at import; a stand-in store is all they need here.
const store = new Map();
globalThis.localStorage ??= {
  getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k),
};
const { QUIET, SPOKEN, acceptedCue, capturedCue, createSpokenScan, hear, refusedCue } =
  await import('../lib/screens/scan/spoken.js');
const { sidesIn } = await import('../lib/screens/scan/report-sides.js');
const { useSpeechEngine } = await import('../lib/speech.js');
const { settings } = await import('../lib/app-settings.js');
const { speechStandIn } = await import('./sound-stand-ins.mjs');

const CAM = { deviceId: 'cam', label: 'Webcam' };
/** A report, with only what the voice reads. */
const r = (over = {}) => ({
  phase: 'scanning', message: 'x', captured: [], sides: 0, confirm: null, complete: false,
  shownAgain: false, device: CAM, notice: null, ...over,
});
/** Run reports through `hear` from silence; the line said on each (null for none), and the last cue. */
function run(...reports) {
  let memo = QUIET;
  let cue = null;
  const said = reports.map((p) => {
    ({ memo, cue } = hear(memo, p));
    return cue?.line ?? null;
  });
  return { said, cue, memo };
}

test('the opening: once, only with a camera open and no side held, and again after a restart', () => {
  assert.deepEqual(run(r({ device: null }), r(), r()).said, [null, SPOKEN.open, null]);
  const { cue } = run(r());
  assert.equal(cue.holds(r()), true, 'the opening stopped holding while it was still true');
  assert.equal(cue.holds(r({ sides: 1 })), false, 'the opening outlived the first side');
  assert.equal(cue.holds(r({ phase: 'painting' })), false);
  // A restart throws sides away; a centre collision only moves them out of the NAMED list.
  assert.deepEqual(run(r(), r({ sides: 2 }), r({ sides: 0 })).said, [SPOKEN.open, null, SPOKEN.open]);
  assert.deepEqual(run(r(), r({ sides: 2, captured: [{}] }), r({ sides: 2, captured: [] })).said, [SPOKEN.open, null, null],
    'a collision emptied the named list and the voice started the scan over');
});

test('a side shown again: said on the first refusal of it, not every report, and cut when it goes', () => {
  const said = run(r({ sides: 1 }), r({ sides: 1, shownAgain: true }), r({ sides: 1, shownAgain: true })).said;
  assert.deepEqual(said.slice(1), [SPOKEN.again, null]);
  const { cue } = run(r({ sides: 1, shownAgain: true }));
  assert.equal(cue.holds(r({ sides: 1, shownAgain: true })), true);
  assert.equal(cue.holds(r({ sides: 1 })), false);
});

test('the ask for a side back: said per ask, not per report, and cut when answered', () => {
  const ask = (face, up) => r({ phase: 'confirm', sides: 6, confirm: { face, up } });
  assert.deepEqual(run(ask('R', 'U'), ask('R', 'U'), ask('D', 'F')).said, [SPOKEN.ask, null, SPOKEN.ask]);
  const { cue } = run(ask('R', 'U'));
  assert.equal(cue.holds(ask('R', 'U')), true);
  assert.equal(cue.holds(ask('D', 'F')), false, 'a line about the old ask held over a new one');
  assert.equal(cue.holds(r({ sides: 6 })), false, 'a line about an answered ask held');
});

test('the audit case: a mismatch notice beside a standing ask neither repeats the ask nor says "ask a grown-up"', () => {
  const ask = r({ phase: 'confirm', sides: 6, confirm: { face: 'R', up: 'U' } });
  const mismatch = { ...ask, notice: { title: 'Those looks disagree', tone: 'err', body: 'x' } };
  const { said, memo } = run(ask, mismatch);
  assert.deepEqual(said, [SPOKEN.ask, null]);
  assert.equal(refusedCue(memo), null, 'a refusal spoke over the ask that is still the thing to do');
});

test('"all done" is not a report\'s to say: only the screen accepting the scan says it', () => {
  // The scanner's `complete` can still be refused by the screen (sides read before a smart cube moved,
  // a tracking contradiction), so no report — however complete — calls for it (audit, 2026-09-19).
  assert.deepEqual(run(r({ sides: 6 }), r({ phase: 'done', sides: 6, complete: true })).said, [null, null]);
  const cue = acceptedCue();
  assert.equal(cue.line, SPOKEN.done);
  assert.equal(cue.holds(r({ phase: 'done', sides: 6, complete: true })), true);
  assert.equal(cue.holds(r({ sides: 6 })), false, 'all done held over a scan reopened');
});

test('a camera in trouble: said on entering the error, whatever its messages, and nothing else while it lasts', () => {
  const broken = (message) => r({ phase: 'error', message, device: null });
  assert.deepEqual(run(broken('The camera did not open'), broken('The scanner stopped')).said, [SPOKEN.camera, null],
    'one failure with two messages was said twice');
  const both = r({ phase: 'error', message: 'x', confirm: { face: 'R', up: 'U' }, shownAgain: true });
  assert.equal(run(both).said[0], SPOKEN.camera, 'another cue outranked a camera that is not working');
  assert.deepEqual(run(broken('x'), { ...both }).said, [SPOKEN.camera, null], 'an ask was said while the camera was down');
  const { cue } = run(broken('x'));
  assert.equal(cue.holds(r()), false);
});

test('an ask held back by a camera error is said once the camera recovers', () => {
  const ask = { face: 'R', up: 'U' };
  const { said } = run(
    r({ phase: 'confirm', sides: 6, confirm: ask }),
    r({ phase: 'error', message: 'x', sides: 6, confirm: ask }),
    r({ phase: 'confirm', sides: 6, confirm: ask }),
  );
  assert.deepEqual(said, [SPOKEN.ask, SPOKEN.camera, null], 'an ask said once was said again after an error');
  const heldBack = run(
    r({ phase: 'error', message: 'x', sides: 6, confirm: ask }),
    r({ phase: 'confirm', sides: 6, confirm: ask }),
  ).said;
  assert.deepEqual(heldBack, [SPOKEN.camera, SPOKEN.ask], 'an ask that arrived during an error was never said');
});

test('overlaps are decided by priority, not by order of arrival: camera, ask, again, opening', () => {
  const ask = { face: 'R', up: 'U' };
  assert.equal(run(r({ sides: 6, confirm: ask, shownAgain: true })).said[0], SPOKEN.ask);
  assert.equal(run(r({ shownAgain: true })).said[0], SPOKEN.again, 'the opening outranked a side shown again');
});

test('a capture: its line by how many sides are held, nothing for a confirm look, cut by painting or a restart', () => {
  assert.equal(capturedCue({ kind: 'confirm', sides: 6 }), null);
  assert.equal(capturedCue({ kind: 'side', sides: 2 }).line, SPOKEN.saved);
  assert.equal(capturedCue({ kind: 'side', sides: 6 }).line, SPOKEN.lastSaved);
  assert.equal(capturedCue({ kind: 'reread', sides: 6 }).line, SPOKEN.lastSaved);
  const { holds } = capturedCue({ kind: 'side', sides: 2 });
  assert.equal(holds(r({ sides: 2 })), true);
  assert.equal(holds(r({ sides: 3 })), true, 'the next side cut the last one off before its own line could');
  assert.equal(holds(r({ sides: 0 })), false);
  // "Show me another side" only while the scanner can take one.
  for (const phase of ['painting', 'loading', 'starting', 'checking', 'done', 'error']) {
    assert.equal(holds(r({ phase, sides: 2 })), false, `"show me another side" held in the ${phase} phase`);
  }
  // "Let me check" also through the check the sixth side starts, and no further.
  const last = capturedCue({ kind: 'side', sides: 6 }).holds;
  assert.equal(last(r({ phase: 'checking', sides: 6 })), true);
  for (const phase of ['done', 'painting', 'loading', 'error']) {
    assert.equal(last(r({ phase, sides: 6 })), false, `"let me check" held in the ${phase} phase`);
  }
});

test('a refusal: "ask a grown-up", not while painting, and cut when the scan moves on or checks again', () => {
  const { memo } = run(r({ phase: 'checking', sides: 6 }));
  const cue = refusedCue(memo);
  assert.equal(cue.line, SPOKEN.help);
  assert.equal(cue.holds(r({ sides: 6, notice: { title: 'Some stickers were misread', tone: 'err' } })), true);
  assert.equal(cue.holds(r({ sides: 5 })), false, 'held over a side thrown away');
  assert.equal(cue.holds(r({ phase: 'checking', sides: 6 })), false, 'held into a new check');
  assert.equal(cue.holds(r({ phase: 'done', sides: 6, complete: true })), false);
  assert.equal(refusedCue(run(r({ phase: 'painting', sides: 6 })).memo), null);
});

test('a report without a side count is refused, never counted by the named list', () => {
  // `captured` leaves out two sides that share a centre, so counting it would take a collision for a
  // restart; the scanner always sends `sides`, and a report without it is a broken contract to say
  // out loud (round-3 audit).
  assert.equal(sidesIn(r({ sides: 2, captured: [] })), 2);
  assert.equal(sidesIn(r({ sides: 6, captured: [] })), 6, 'a whole cube was refused');
  for (const sides of [undefined, null, -1, 1.5, '2', 7, 12]) {
    assert.throws(() => sidesIn(r({ sides, captured: [{}, {}] })), /without a side count/, `sides: ${sides} was counted`);
  }
  assert.throws(() => hear(QUIET, r({ sides: undefined })), /without a side count/, 'the voice counted a report with no side count');
});

/**
 * A voice on a stand-in engine, with a scanner to drive it — one per test, and everything it changes
 * (the engine, the sounds setting, the warning channel) put back when the test ends, so no test can
 * leave the next one a voice it did not ask for (audit, 2026-09-19).
 */
function rig(t) {
  const wasSounds = settings.sounds;
  const warn = console.warn;
  const voice = speechStandIn();
  const wasVoice = useSpeechEngine(voice.make);
  settings.sounds = true;
  console.warn = () => {};
  const panel = new EventTarget();
  const stop = new AbortController();
  createSpokenScan({ panel, signal: stop.signal });
  t.after(() => {
    stop.abort();
    console.warn = warn;
    settings.sounds = wasSounds;
    useSpeechEngine(wasVoice);
  });
  return {
    voice,
    report: (over) => panel.dispatchEvent(new CustomEvent('scan-progress', { detail: r(over) })),
    capture: (detail) => panel.dispatchEvent(new CustomEvent('scan-capture', { detail })),
  };
}

// Queued is not heard: "audio busy" or an untouched webview fails a line after it was queued. The voice
// tries ONCE more at the next report — never for a moment that has passed, never over a newer line,
// never for a reason that will fail again (round-3 audit).
test('a line failed for a passing reason is said once more at the next report, and not a third time', (t) => {
  const { voice, report } = rig(t);
  report({});
  voice.fail('audio-busy');
  report({});
  assert.deepEqual(voice.said, [SPOKEN.open, SPOKEN.open], 'a line failed for a passing reason was not tried again');
  voice.fail('audio-busy');
  report({});
  assert.deepEqual(voice.said, [SPOKEN.open, SPOKEN.open], 'a failing line was tried more than once more');
});

test('a failed line whose moment has passed is not said again', (t) => {
  const { voice, report } = rig(t);
  report({});
  voice.fail('network');
  report({ sides: 1, captured: [{}] });
  assert.deepEqual(voice.said, [SPOKEN.open], 'a line was retried after its moment had gone');
});

test('a failure that will happen again is not retried', (t) => {
  const { voice, report } = rig(t);
  report({});
  voice.fail('language-unavailable');
  report({});
  assert.deepEqual(voice.said, [SPOKEN.open], 'a line was retried for a failure that cannot pass');
});

test('a failure arriving for a line already replaced neither brings it back nor unhooks the current one', (t) => {
  const { voice, report, capture } = rig(t);
  report({});
  const opening = voice.utterances.at(-1);
  capture({ kind: 'side', face: 'U', sides: 1 });
  voice.fail('audio-busy', opening);
  report({ sides: 1, captured: [{}] });
  assert.deepEqual(voice.said, [SPOKEN.open, SPOKEN.saved], 'a late failure of a replaced line brought it back');
  // …and the line now being said is still cut off when its own moment passes.
  report({ phase: 'painting', sides: 1, captured: [{}] });
  assert.equal(voice.cuts.at(-1), SPOKEN.saved, "a replaced line's late failure kept the current line from being cut off");
});
