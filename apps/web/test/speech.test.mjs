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

test('a line cuts off the last, is read as English, and hush stops it', () => {
  const voice = speechStandIn();
  useSpeechEngine(voice.make);
  settings.sounds = true;
  assert.equal(say('Got it!'), true);
  assert.equal(say('All done!'), true);
  hush();
  assert.deepEqual(voice.log, [['cancel'], ['speak', 'Got it!', 'en'], ['cancel'], ['speak', 'All done!', 'en'], ['cancel']]);
  assert.deepEqual(voice.cuts, [null, 'Got it!', 'All done!'], 'the line each cut-off ended is not the one that was being said');
});

test('no voice with sounds off, and none where either half of the API is missing', () => {
  const voice = speechStandIn();
  useSpeechEngine(voice.make);
  settings.sounds = false;
  assert.equal(say('Got it!'), false);
  assert.deepEqual(voice.log, [], 'sounds off still spoke');
  settings.sounds = true;
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

test('a line the platform declines is logged and reported; one the app cut off itself is neither', () => {
  // Queued is not heard: the platform speaks asynchronously and can still decline. The caller is the
  // one that knows whether the moment is still there, so it is told — and the app's own cancels, which
  // arrive as `interrupted` and `canceled`, are not failures (audit, 2026-09-19).
  const voice = speechStandIn();
  useSpeechEngine(voice.make);
  settings.sounds = true;
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
