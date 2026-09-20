// The scan's sound mode: three exclusive choices, and what becomes of the boolean it replaced
// (2026-09-20).
//
// `sounds` was one boolean over the chime and the voice together, so the only way to stop a repeated
// spoken line was to silence the bell a child depends on. Splitting it into `voice` / `chime` / `off`
// is only safe if the split is READ correctly on every install that already had a choice stored:
// somebody who turned sounds off asked for silence, and an app that came back talking would be worse
// than the repetition this change is for.
//
// The settings module reads storage AT IMPORT, so each case here prepares a store and imports a fresh
// copy of it with a cache-busting query. That is the only way to test a migration that happens once.

import assert from 'node:assert/strict';
import { test } from 'node:test';

let stamp = 0;
/** Load a fresh `lib/app-settings.js` over `stored`, and report what it settled on and what it wrote. */
async function loadWith(stored) {
  const store = new Map();
  if (stored !== undefined) store.set('cubusSettings', JSON.stringify(stored));
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const mod = await import(`../lib/app-settings.js?sound-mode=${++stamp}`);
  const written = store.get('cubusSettings');
  return { settings: mod.settings, SOUND_MODES: mod.SOUND_MODES, written: written ? JSON.parse(written) : null };
}

test('a stored choice of silence survives the split into three modes', async () => {
  // The case that matters. `sounds: false` is a person who asked for quiet, and there is no second
  // chance to read it: once the key is deleted the intent is gone.
  const off = await loadWith({ sounds: false });
  assert.equal(off.settings.soundMode, 'off', 'someone who turned sounds off got an app that talks');
  // And `sounds: true` — every other install — lands on the mode that behaves as it did before:
  // the bell AND the words.
  const on = await loadWith({ sounds: true });
  assert.equal(on.settings.soundMode, 'voice');
  const fresh = await loadWith(undefined);
  assert.equal(fresh.settings.soundMode, 'voice', 'a first launch was not given the default');
});

test('the legacy key is read once and then dropped, and never outranks an explicit mode', async () => {
  const migrated = await loadWith({ sounds: false });
  assert.ok(!('sounds' in migrated.settings), 'the legacy key was left to be re-read later');
  assert.ok(migrated.written && !('sounds' in migrated.written), 'the legacy key was written back to storage');
  // A record carrying BOTH — a half-migrated install, or a hand-edited one — is decided by the mode,
  // because that is the value the app writes and the boolean is the one it is leaving behind.
  const both = await loadWith({ sounds: false, soundMode: 'voice' });
  assert.equal(both.settings.soundMode, 'voice', 'a stale boolean overruled an explicit mode');
});

test('a mode that does not exist is the default, and the modes are exactly three', async () => {
  for (const bad of ['deafening', '', 0, null, true, ['voice'], { mode: 'voice' }]) {
    const { settings } = await loadWith({ soundMode: bad });
    assert.equal(settings.soundMode, 'voice', `a soundMode of ${JSON.stringify(bad)} was believed`);
  }
  const { SOUND_MODES } = await loadWith(undefined);
  assert.deepEqual(Object.values(SOUND_MODES).sort(), ['chime', 'off', 'voice'],
    'a fourth mode arrived with no decision recorded for it');
});

test('the edited spoken lines are an object, whatever storage held', async () => {
  for (const bad of ['a line', 7, null, ['x'], true]) {
    const { settings } = await loadWith({ spokenLines: bad });
    assert.equal(typeof settings.spokenLines, 'object');
    assert.ok(settings.spokenLines && !Array.isArray(settings.spokenLines),
      `spokenLines of ${JSON.stringify(bad)} was believed`);
  }
  // A real record is kept as it is: WHICH keys are usable is the voice's to decide, not this file's.
  const { settings } = await loadWith({ spokenLines: { open: 'Hello.', nonsense: 'x' } });
  assert.equal(settings.spokenLines.open, 'Hello.');
});
