// The shape of the STORED RECORD itself, which is a different question from the shape of the
// fields inside it.
//
// `hostile-settings.test.mjs` boots the whole app over one deliberately corrupt settings OBJECT and
// requires every screen to draw. It cannot ask this file's question, because it is one process and
// one boot by design, and because every record it writes is already an object. What was missing was
// the case where the stored JSON is valid and is not a record at all: `localStorage.cubusSettings =
// "null"` parses fine, and `'soundMode' in null` throws at module scope — so the app did not start,
// with no screen left to say why (audit, 2026-09-29).
//
// Each case re-evaluates the module behind a unique query string, which is how one process gets
// several first launches.
import assert from 'node:assert/strict';
import test from 'node:test';

let seq = 0;
/** Boot `app-settings` over `raw` exactly as storage would hand it back, and return the module. */
async function bootOver(raw) {
  const store = new Map();
  if (raw !== null) store.set('cubusSettings', raw);
  const written = [];
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => { written.push([k, v]); store.set(k, String(v)); },
    removeItem: (k) => store.delete(k),
  };
  const mod = await import(`../lib/app-settings.js?record=${seq++}`);
  return { mod, written };
}

// Valid JSON that is not a record. Every one of these reached the `in` operator.
const NOT_RECORDS = ['null', 'false', 'true', '7', '0', '"text"', '[]', '[1,2]'];

test('a stored record that is not an object never stops the app starting', async () => {
  for (const raw of NOT_RECORDS) {
    const { mod } = await bootOver(raw);
    assert.equal(typeof mod.settings, 'object', `${raw}: no settings object survived`);
    assert.ok(mod.settings, `${raw}: settings is null`);
  }
});

test('a record that is not an object takes the DEFAULT sound mode, not the legacy boolean', async () => {
  // The legacy branch exists for an install that predates the soundMode split, recognised by the
  // ABSENCE of the key in a real record. Corruption is not such an install, and reading it as one
  // would hand `voice` to someone who never asked for spoken lines.
  for (const raw of NOT_RECORDS) {
    const { mod } = await bootOver(raw);
    assert.equal(mod.settings.soundMode, mod.DEFAULT_SETTINGS.soundMode, `${raw}: did not take the default`);
  }
  // And the two real records either side of it still mean what they always meant.
  assert.equal((await bootOver('{"sounds":false}')).mod.settings.soundMode, 'off', 'a chosen silence was lost');
  // `{}` predates the soundMode split. It used to land on `voice` — the bell AND the words — and
  // with the words deleted (2026-09-30) the bell is what is left of that intent.
  assert.equal((await bootOver('{}')).mod.settings.soundMode, 'chime', 'an install predating the split lost its sounds');
  assert.equal((await bootOver('{"soundMode":"off"}')).mod.settings.soundMode, 'off', 'a modern record was not read');
  assert.equal((await bootOver(null)).mod.settings.soundMode, 'chime', 'a first launch did not take the default');
});

test('a stored string does not become numeric settings keys', async () => {
  // `{...'text'}` spreads to {0:'t',1:'e',2:'x',3:'t'}. Those keys then reached `save()` and were
  // written back, so one corrupt record grew every launch.
  const { mod } = await bootOver('"text"');
  const numeric = Object.keys(mod.settings).filter((k) => /^[0-9]+$/.test(k));
  assert.deepEqual(numeric, [], `a string record became settings keys: ${numeric.join(',')}`);
});

test('the stored record is read once, so a store that changes cannot persist the older answer', async () => {
  // Two reads of one key cannot be assumed to agree. The module used to read `cubusSettings` for
  // the write comparison and the sound migration, and again inside `load()` for the settings.
  const reads = [];
  const answers = ['{"sounds":true}', '{"soundMode":"off"}'];
  globalThis.localStorage = {
    getItem: (k) => { reads.push(k); return k === 'cubusSettings' ? (answers.shift() ?? '{}') : null; },
    setItem: () => {}, removeItem: () => {},
  };
  const mod = await import(`../lib/app-settings.js?record=${seq++}`);
  const settingsReads = reads.filter((k) => k === 'cubusSettings').length;
  assert.equal(settingsReads, 1, `cubusSettings was read ${settingsReads} times during one boot`);
  assert.equal(mod.settings.soundMode, 'chime', 'the first answer is the one that was used');
});
