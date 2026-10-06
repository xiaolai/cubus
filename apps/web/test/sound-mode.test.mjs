// The scan's sound mode: two exclusive choices, and what becomes of the boolean and the third mode
// that preceded them (2026-09-20, amended 2026-09-30).
//
// `sounds` was one boolean over the chime and the voice together, so the only way to stop a repeated
// spoken line was to silence the bell a child depends on. It was split into `voice` / `chime` / `off`
// for that reason — and on 2026-09-30 the owner judged the spoken lines worse than nothing and had
// them deleted, so `voice` is gone and a sound per state says what they said.
//
// WHAT STILL HAS TO HOLD IS THE HALF THAT ALWAYS MATTERED: somebody who asked for silence must keep
// it. There is no second chance at that — once the legacy key is deleted the intent is gone — and an
// app that came back making noise would be worse than either thing this has been changed for.
//
// WHAT NO LONGER HAS TO HOLD, and it is worth being explicit rather than quietly dropping cases:
// `sounds: true` used to mean "the bell AND the words", kept distinct from the default precisely
// because the two had stopped being the same answer. With the words gone there is one affirmative
// answer left, so a pre-split install and a fresh one now agree — not because the distinction was
// abandoned but because the thing it preserved does not exist.
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

test('a stored choice of silence survives every change to the modes', async () => {
  // THE CASE THAT MATTERS, and the one that has survived a boolean, three modes and now two.
  const off = await loadWith({ sounds: false });
  assert.equal(off.settings.soundMode, 'off', 'someone who turned sounds off got an app that makes noise');
  // And `sounds: true` — every other pre-split install — lands on the one sounding mode there is.
  const on = await loadWith({ sounds: true });
  assert.equal(on.settings.soundMode, 'chime');
  const fresh = await loadWith(undefined);
  assert.equal(fresh.settings.soundMode, 'chime', 'a first launch was not given the default');
});

test('an install that chose the deleted voice mode keeps its sounds, and is not silenced', async () => {
  // `voice` was a SOUNDING mode: a bell and a spoken line. Deleting it must not read as "this person
  // wanted quiet" — the only intent recorded there is that they wanted to hear something, and the
  // bell is what is left of it. It is no longer a mode, so the repair lands it on the default.
  const wasVoice = await loadWith({ soundMode: 'voice' });
  assert.equal(wasVoice.settings.soundMode, 'chime', 'an install that wanted sound was silenced');
  assert.ok(wasVoice.written && wasVoice.written.soundMode === 'chime',
    'the dead mode was left in storage to be re-read on every launch');
});

test('the legacy key is read once and then dropped, and never outranks an explicit mode', async () => {
  const migrated = await loadWith({ sounds: false });
  assert.ok(!('sounds' in migrated.settings), 'the legacy key was left to be re-read later');
  assert.ok(migrated.written && !('sounds' in migrated.written), 'the legacy key was written back to storage');
  // A record carrying BOTH — a half-migrated install, or a hand-edited one — is decided by the mode,
  // because that is the value the app writes and the boolean is the one it is leaving behind.
  const both = await loadWith({ sounds: false, soundMode: 'chime' });
  assert.equal(both.settings.soundMode, 'chime', 'a stale boolean overruled an explicit mode');
});

test('only the ABSENCE of a mode lets the legacy boolean speak', async () => {
  // The distinction the default moving to `chime` created, and the one a reader is most likely to
  // collapse again: a record carrying `sounds: true` is only a pre-split install while it has no
  // `soundMode` of its own. Give it an unusable one and it is a modern record that got corrupted,
  // so it takes the DEFAULT -- not the bell-and-words the boolean used to mean.
  // Both land on `chime` now, so this case can no longer tell the two apart by the ANSWER — and
  // asserting two equal values proves nothing about the branch. What it can still hold is that the
  // legacy key is only consulted when there is no mode, which is what `written` shows: a pre-split
  // record is migrated and rewritten, a corrupted one is repaired to the same value either way.
  const preSplit = await loadWith({ sounds: true });
  assert.equal(preSplit.settings.soundMode, 'chime');
  assert.ok(!('sounds' in preSplit.settings), 'the legacy key survived the migration');
  const corrupted = await loadWith({ sounds: true, soundMode: 'deafening' });
  assert.equal(corrupted.settings.soundMode, 'chime', 'a corrupted modern record was not repaired');
  // AND THE ONE PLACE THE BRANCH STILL SHOWS: silence. A pre-split `sounds: false` is quiet; the
  // same boolean beside an unusable mode is a corrupted modern record and takes the default.
  assert.equal((await loadWith({ sounds: false })).settings.soundMode, 'off');
  assert.equal((await loadWith({ sounds: false, soundMode: 'deafening' })).settings.soundMode, 'chime',
    'a corrupted modern record was read as a pre-split choice of silence');
});

test('a mode that does not exist is the default, and the modes are exactly two', async () => {
  for (const bad of ['deafening', '', 0, null, true, ['chime'], { mode: 'chime' }, 'voice']) {
    const { settings } = await loadWith({ soundMode: bad });
    assert.equal(settings.soundMode, 'chime', `a soundMode of ${JSON.stringify(bad)} was believed`);
  }
  const { SOUND_MODES } = await loadWith(undefined);
  assert.deepEqual(Object.values(SOUND_MODES).sort(), ['chime', 'off'],
    'a mode arrived or left with no decision recorded for it');
});
