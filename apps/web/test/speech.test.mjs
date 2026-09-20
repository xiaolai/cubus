// The system voice (lib/speech.js), against the shared stand-in engine (test/sound-stand-ins.mjs —
// happy-dom has none, and whether each shipped webview has one is checked on the builds).
//
// The contract the scan's spoken lines rest on: nothing where the platform has no voice — either half
// of the API missing is no voice — nothing with sounds off, a new line cuts off the last rather than
// queueing behind it, the words are read as English (D6), `hush` stops whatever is being said, and a
// line the platform declines is logged AND reported to the caller, while one the app cut off itself
// is neither.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { speechStandIn } from './sound-stand-ins.mjs';

const store = new Map();
globalThis.localStorage ??= {
  getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k),
};
const { settings } = await import('../lib/app-settings.js');
const { hush, say, useSpeechEngine } = await import('../lib/speech.js');

/**
 * A stand-in voice in `mode`, with everything it changes put back when the test ends.
 *
 * Both halves were written out in every test and restored in none (audit, 2026-09-20): the module's
 * engine is a MODULE GLOBAL and `settings.soundMode` is shared, so each case left the next one a
 * platform and a mode it never asked for. Nothing failed — the order happened to suit — which is the
 * kind of coupling that only ever surfaces when somebody adds a fourth test.
 */
function voiceRig(t, mode = 'voice') {
  const voice = speechStandIn();
  const wasEngine = useSpeechEngine(voice.make);
  const wasMode = settings.soundMode;
  settings.soundMode = mode;
  t.after(() => {
    useSpeechEngine(wasEngine);
    settings.soundMode = wasMode;
  });
  return voice;
}

test('a line cuts off the last, is read as English, and hush stops it', (t) => {
  const voice = voiceRig(t);
  assert.equal(say('Got it!'), true);
  assert.equal(say('All done!'), true);
  hush();
  assert.deepEqual(voice.log, [['cancel'], ['speak', 'Got it!', 'en'], ['cancel'], ['speak', 'All done!', 'en'], ['cancel']]);
  assert.deepEqual(voice.cuts, [null, 'Got it!', 'All done!'], 'the line each cut-off ended is not the one that was being said');
});

test('no voice with sounds off, and none where either half of the API is missing', (t) => {
  const voice = voiceRig(t, 'off');
  assert.equal(say('Got it!'), false);
  assert.deepEqual(voice.log, [], 'sounds off still spoke');
  // …and `chime` is the bell WITHOUT the words: the mode the owner asked for after finding the
  // lines repetitive (2026-09-20). Silence here is the feature, not a missing voice.
  settings.soundMode = 'chime';
  assert.equal(say('anything'), false, 'the voice spoke in the bell-only mode');
  assert.deepEqual(voice.log, [], 'the bell-only mode queued a line');
  settings.soundMode = 'voice';
  // Each half is asked for separately: a guard that wanted BOTH missing would speak on a platform
  // with one of them (audit, 2026-09-19).
  const { synth, Utterance } = voice.make();
  for (const half of [{ synth, Utterance: null }, { synth: null, Utterance }, { synth: null, Utterance: null }]) {
    useSpeechEngine(() => half);
    assert.equal(say('Got it!'), false, `spoke with ${half.synth ? 'no Utterance' : 'no speechSynthesis'}`);
    hush(); // and stopping a voice that does not exist raises nothing
  }
  assert.deepEqual(voice.said, [], 'a line was spoken through half an API');
});

test('a line the platform declines is logged and reported; one the app cut off itself is neither', (t) => {
  // Queued is not heard: the platform speaks asynchronously and can still decline. The caller is the
  // one that knows whether the moment is still there, so it is told — and the app's own cancels, which
  // arrive as `interrupted` and `canceled`, are not failures (audit, 2026-09-19).
  const voice = voiceRig(t);
  const warned = [];
  const failures = [];
  const warn = console.warn;
  console.warn = (...args) => warned.push(args.join(' '));
  try {
    say('Show me any side of your cube.', 'en', { onFail: (e) => failures.push(e) });
    voice.fail('synthesis-unavailable');
    say('Got it!', 'en', { onFail: (e) => failures.push(e) });
    voice.fail('interrupted');
    say('All done!', 'en', { onFail: (e) => failures.push(e) });
    voice.fail('canceled');
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(failures, ['synthesis-unavailable'], 'a cut-off was reported as a failure, or a real one was not');
  assert.equal(warned.length, 1, 'a cut-off was logged as a failure, or a real one was not logged');
  assert.match(warned[0], /synthesis-unavailable/);
  assert.match(warned[0], /Show me any side/);
});

test('a line that ENDED is not a line anybody cut off', (t) => {
  // `finish()` had no caller anywhere in the suite (audit, 2026-09-20) — it was either dead code or
  // an untested behaviour, and it is the second: the platform finishing a line leaves nothing being
  // said, so the next `hush()` must be attributed to no line at all. Recording it against the line
  // that had already ended would make `cuts` say the app interrupted something it did not.
  const voice = voiceRig(t);
  say('All done! Your cube is ready.');
  voice.finish();
  hush();
  assert.deepEqual(voice.cuts, [null, null], 'a line that ended on its own was recorded as cut off');
});
