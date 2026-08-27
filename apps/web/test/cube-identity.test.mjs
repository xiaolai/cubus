// Cube identity — the registry that replaced a single overwritten address slot.
//
// The bug these guard is not hypothetical: the app kept exactly one cube address and rewrote it on
// every connect, so pairing a second cube destroyed the first. A browser on macOS will not read
// the address back off the cube, which made that unrecoverable rather than merely annoying.
//
// Pure module, no DOM — the same discipline packages/*/src gets.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MAX_CUBES, MAX_LABEL, cubeLabel, forgetCube, listCubes, normaliseMac, parseRegistry, rememberCube, renameCube,
} from '../lib/cube-registry.js';

const A = 'AA:BB:CC:DD:EE:FF';
const B = '11:22:33:44:55:66';

// Real epoch milliseconds. The registry refuses timestamps outside a plausible range, because
// coercion is how `true` and `"123"` used to become sortable positions in this list — so toy
// values like 1000 are now (correctly) read as "never used".
const T0 = Date.UTC(2026, 0, 1);
const t = (offsetMinutes) => T0 + offsetMinutes * 60_000;

test('pairing a second cube leaves the first intact', () => {
  // The live bug. If only one assertion in this file survives, it should be this one.
  let reg = rememberCube({}, { mac: A, name: 'GAN-A', at: t(1) });
  reg = rememberCube(reg, { mac: B, name: 'GAN-B', at: t(2) });

  assert.deepEqual(Object.keys(reg).sort(), [B, A].sort());
  assert.equal(reg[A].name, 'GAN-A', 'the first cube kept its own name');
  assert.equal(reg[A].lastSeen, t(1), 'and its own last-seen time');
});

test('an address is canonical, so one cube cannot occupy two rows', () => {
  let reg = rememberCube({}, { mac: 'aa:bb:cc:dd:ee:ff', name: 'lower', at: t(1) });
  reg = rememberCube(reg, { mac: 'AA:BB:CC:DD:EE:FF', name: 'upper', at: t(2) });
  assert.deepEqual(Object.keys(reg), [A]);
  assert.equal(reg[A].name, 'upper', 'the later connect wins on the cube-reported name');
});

test('a known cube reuses its record; an unknown one carries nothing over', () => {
  let reg = rememberCube({}, { mac: A, name: 'GAN-A', at: t(1) });
  reg = renameCube(reg, A, 'The green one');

  reg = rememberCube(reg, { mac: A, name: 'GAN-A', at: t(5) });
  assert.equal(reg[A].nickname, 'The green one', 'a reconnect is not a reason to forget your name for it');
  assert.equal(reg[A].lastSeen, t(5));

  reg = rememberCube(reg, { mac: B, name: 'GAN-B', at: t(6) });
  assert.equal(reg[B].nickname, '', 'a different cube inherits nothing from the one before it');
});

test('a rejected address changes nothing', () => {
  const reg = rememberCube({ [A]: { name: 'GAN-A', nickname: '', lastSeen: t(1) } }, { mac: 'not-a-mac' });
  assert.deepEqual(Object.keys(reg), [A]);
  assert.equal(normaliseMac('not-a-mac'), '');
  assert.equal(normaliseMac('AA:BB:CC:DD:EE'), '', 'five octets is not an address');
  assert.equal(normaliseMac(' aa:bb:cc:dd:ee:ff '), A, 'surrounding space is not a different cube');
});

test('a persisted record can never carry connection state', () => {
  // trusted / offset / battery / anchored describe a CONNECTION. Persisting one under a cube's
  // name is how yesterday's correction gets applied to today's session while looking reasonable.
  // This asserts what must NOT be stored, because that is the failure mode with no symptom.
  const hostile = {
    [A]: { name: 'GAN-A', nickname: 'mine', lastSeen: t(7), trusted: true, offset: 'BADBADBAD', battery: 90, anchored: true },
  };
  assert.deepEqual(parseRegistry(hostile), { [A]: { name: 'GAN-A', nickname: 'mine', lastSeen: t(7) } });

  // And it cannot get in through the write path either — the two directions share one whitelist.
  const written = rememberCube(hostile, { mac: A, name: 'GAN-A', at: t(8) });
  assert.deepEqual(Object.keys(written[A]).sort(), ['lastSeen', 'name', 'nickname']);
});

test('untrusted storage yields nothing rather than a half-built record', () => {
  for (const junk of [null, undefined, 'a string', 42, [], [{ mac: A }], { [A]: 'not an object' }, { [A]: null }, { [A]: [] }]) {
    assert.deepEqual(parseRegistry(junk), {}, `rejected: ${JSON.stringify(junk)}`);
  }
  // A key that is not an address is dropped even when its value looks perfectly well-formed.
  assert.deepEqual(parseRegistry({ 'hello': { name: 'x', nickname: '', lastSeen: t(1) } }), {});

  // An unusable timestamp becomes 0, never NaN. NaN compares false against everything, so it
  // would not throw — it would quietly make listCubes() order-dependent on insertion, and
  // JSON.stringify would write it back as null. A silent wrong order is the whole failure mode.
  //
  // Coercible types are here too, and they are the interesting half: `Number(true)` is 1,
  // `Number("123")` is 123, `Number([123])` is 123, and any value between 0 and 1 floors straight
  // onto the 0 sentinel. Each of those was previously accepted as a position in the list.
  for (const bad of [
    'yesterday', NaN, -1, 0, Infinity, null, undefined, {}, true, false,
    '1767225600000', [1767225600000], 0.5, 12.7, 1e21, Number.MAX_SAFE_INTEGER,
  ]) {
    const rec = parseRegistry({ [A]: { name: 'x', nickname: '', lastSeen: bad } })[A];
    assert.equal(rec.lastSeen, 0, `unusable lastSeen rejected: ${String(bad)}`);
  }
  // A record whose ONLY field was an unusable timestamp has nothing left worth keeping, and
  // promoting it to a full row contradicted this function's own promise about half-built records.
  assert.deepEqual(parseRegistry({ [A]: { lastSeen: 12.7 } }), {}, 'nothing usable, nothing kept');
  assert.deepEqual(parseRegistry({ [A]: {} }), {}, 'and an empty record is not a cube');
  // While a real epoch millisecond is kept exactly as given.
  assert.equal(parseRegistry({ [A]: { lastSeen: t(9) } })[A].lastSeen, t(9));
});

test('a bidi override cannot disguise one cube as another', () => {
  // A device name is chosen by whatever is advertising. U+202E reverses everything after it, which
  // is enough to make one remembered row read as another's — escaping stops it becoming markup, it
  // does not stop it lying about which cube you are looking at.
  const reg = rememberCube({}, { mac: A, name: 'GAN\u202Elacitirc', at: t(1) });
  assert.ok(!/[\u202A-\u202E\u2066-\u2069\u200E\u200F]/.test(reg[A].name), 'bidi controls stripped');
  assert.equal(reg[A].name, 'GANlacitirc');
  // And C1 controls, which the first version of the cleaner missed alongside C0.
  assert.equal(rememberCube({}, { mac: A, name: 'GAN\u0085x', at: t(1) })[A].name, 'GANx');
});

test('a label is clamped by character, not by code unit', () => {
  // `slice` cuts UTF-16 units, so a name ending in an emoji at the boundary was stored with half
  // of one — a lone surrogate that renders as a replacement box.
  const name = `${'a'.repeat(MAX_LABEL - 1)}😀b`;
  const stored = rememberCube({}, { mac: A, name, at: t(1) })[A].name;
  assert.equal(Array.from(stored).length, MAX_LABEL, 'clamped by character');
  // isWellFormed(), not a surrogate-range regex: a VALID pair is also two code units in that
  // range, so the regex flagged the correct answer. This asks the real question — is there a lone
  // surrogate — which is the only thing that can go wrong here.
  assert.ok(stored.isWellFormed(), 'and never split a surrogate pair');
  assert.equal(stored, `${'a'.repeat(MAX_LABEL - 1)}😀`);
});

test('the registry is bounded, however much storage claims to hold', () => {
  // Not about someone owning 40 cubes. A corrupt or hostile localStorage filling the quota with
  // valid-looking records would otherwise be parsed, cloned, sorted and rendered as a list.
  const many = {};
  for (let i = 0; i < MAX_CUBES + 20; i++) {
    const mac = `AA:BB:CC:DD:${String(Math.floor(i / 256)).padStart(2, '0')}:${i.toString(16).padStart(2, '0').slice(-2).toUpperCase()}`;
    many[mac] = { name: `cube ${i}`, nickname: '', lastSeen: t(i) };
  }
  const parsed = parseRegistry(many);
  assert.equal(Object.keys(parsed).length, MAX_CUBES, `bounded to ${MAX_CUBES}`);
  // And it keeps the ones most recently used, not whichever happened to be enumerated first.
  assert.ok(listCubes(parsed)[0].lastSeen > listCubes(parsed)[MAX_CUBES - 1].lastSeen);

  // And through the front door too. rememberCube() appended straight onto an already-full registry,
  // returning MAX_CUBES + 1 — so the bound held for anything read from storage and not for the one
  // path that actually adds cubes.
  const oneMore = rememberCube(parsed, { mac: '99:88:77:66:55:44', name: 'newest', at: t(9999) });
  assert.equal(Object.keys(oneMore).length, MAX_CUBES, 'adding to a full registry stays bounded');
  assert.equal(listCubes(oneMore)[0].name, 'newest', 'and the new cube is the one kept');

  // An address with nothing worth remembering is not a cube either, however it arrives.
  assert.deepEqual(rememberCube({}, { mac: '99:88:77:66:55:44' }), {}, 'no ghost rows via rememberCube');

  // The cube JUST CONNECTED is never the one evicted, even by records claiming newer timestamps.
  // The migration below stores an address this way and then deletes the only other copy of it, so
  // an eviction here loses something a browser on macOS will not give back.
  const future = {};
  for (let i = 0; i < MAX_CUBES; i++) {
    future[`BB:BB:CC:DD:00:${i.toString(16).padStart(2, '0').toUpperCase()}`] =
      { name: `future ${i}`, nickname: '', lastSeen: t(500000 + i) };
  }
  const withMine = rememberCube(future, { mac: A, name: 'in my hand', at: t(1) });
  assert.ok(withMine[A], 'the cube being remembered survives a full registry of newer records');
  assert.equal(Object.keys(withMine).length, MAX_CUBES, 'and the bound still holds');
});

test('every Unicode format character is stripped, not a hand-picked few', () => {
  // Enumerating the interesting ones by hand kept missing members: U+061C first, then U+00AD and
  // the U+FFF9..U+FFFB annotation marks. The category is 170 code points and grows with Unicode.
  for (const ch of ['\u00AD', '\u061C', '\u200B', '\u200E', '\u202E', '\u2066', '\uFEFF', '\uFFF9', '\uFFFB']) {
    const stored = rememberCube({}, { mac: A, name: `a${ch}b`, at: t(1) })[A].name;
    assert.equal(stored, 'ab', `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')} survived`);
  }
  // A lone surrogate is not a character anyone meant to type either.
  assert.equal(rememberCube({}, { mac: A, name: 'a\uD800b', at: t(1) })[A].name, 'ab');
  // While ordinary text, including emoji and non-Latin scripts, is untouched.
  assert.equal(rememberCube({}, { mac: A, name: '绿色的 🟩', at: t(1) })[A].name, '绿色的 🟩');
});

test('two keys for one cube keep the record that was used more recently', () => {
  // Both canonicalise to the same address. Insertion order used to decide, so a stale lowercase
  // duplicate could erase a newer record's nickname and history.
  const both = {
    'aa:bb:cc:dd:ee:ff': { name: 'stale', nickname: 'old name', lastSeen: t(1) },
    'AA:BB:CC:DD:EE:FF': { name: 'fresh', nickname: 'new name', lastSeen: t(9) },
  };
  assert.equal(parseRegistry(both)[A].nickname, 'new name');
  // And the other way round, so it is the timestamp deciding and not the order.
  const reversed = Object.fromEntries(Object.entries(both).reverse());
  assert.equal(parseRegistry(reversed)[A].nickname, 'new name');
});

test('cubeLabel cleans what it is handed, whoever handed it over', () => {
  // The live caller overlays a device name straight off the wire, walking round the sanitiser the
  // rest of this module applies.
  assert.equal(cubeLabel({ mac: A, name: 'GAN\u202Ex', nickname: '' }), 'GANx');
  assert.equal(cubeLabel({ mac: A, name: '', nickname: '\u0000hi' }), 'hi');
  assert.equal(cubeLabel({ mac: 'not-a-mac', name: '', nickname: '' }), '', 'and refuses a bogus address');
  for (const bad of [42, [], {}, true]) {
    assert.equal(cubeLabel({ mac: A, name: bad, nickname: bad }), A, `non-string fields: ${JSON.stringify(bad)}`);
  }
});

test('labels are cleaned, not trusted', () => {
  const reg = renameCube(rememberCube({}, { mac: A, at: t(1) }), A, `x\u0000y\u001Bz${'!'.repeat(80)}`);
  assert.ok(!/[\u0000-\u001F\u007F]/.test(reg[A].nickname), 'control characters stripped');
  assert.ok(reg[A].nickname.length <= MAX_LABEL, `clamped to ${MAX_LABEL}`);

  // A device-supplied name gets the same treatment: the cube is not more trusted than the user.
  const fromDevice = rememberCube({}, { mac: B, name: `GAN\u0007${'y'.repeat(80)}`, at: t(1) });
  assert.ok(!/[\u0000-\u001F\u007F]/.test(fromDevice[B].name));
  assert.ok(fromDevice[B].name.length <= MAX_LABEL);
});

test('renaming a cube we do not know is a no-op, not a new record', () => {
  assert.deepEqual(renameCube({}, A, 'ghost'), {});
});

test('the list is ordered most-recent-first and does not wobble between renders', () => {
  let reg = rememberCube({}, { mac: A, name: 'GAN-A', at: t(1) });
  reg = rememberCube(reg, { mac: B, name: 'GAN-B', at: t(3) });
  assert.deepEqual(listCubes(reg).map((c) => c.mac), [B, A]);

  // Equal timestamps must still produce one fixed order, or the list reshuffles under the cursor.
  const tied = { [A]: { name: 'a', nickname: '', lastSeen: t(5) }, [B]: { name: 'b', nickname: '', lastSeen: t(5) } };
  assert.deepEqual(listCubes(tied).map((c) => c.mac), listCubes(tied).map((c) => c.mac));
  assert.deepEqual(listCubes(tied).map((c) => c.mac), [B, A], 'ties break on address');
});

test('forgetting removes exactly one cube', () => {
  let reg = rememberCube({}, { mac: A, name: 'GAN-A', at: t(1) });
  reg = rememberCube(reg, { mac: B, name: 'GAN-B', at: t(2) });
  assert.deepEqual(Object.keys(forgetCube(reg, A)), [B]);
  assert.deepEqual(Object.keys(forgetCube(reg, 'not-a-mac')).sort(), [B, A].sort(), 'a bad address forgets nothing');
});

test('every mutator returns a new registry rather than editing the old one', () => {
  const before = rememberCube({}, { mac: A, name: 'GAN-A', at: t(1) });
  const snapshot = JSON.stringify(before);
  rememberCube(before, { mac: B, name: 'GAN-B', at: t(2) });
  renameCube(before, A, 'renamed');
  forgetCube(before, A);
  assert.equal(JSON.stringify(before), snapshot, 'callers hold the old registry while comparing');
});

test('a cube always has something to call it', () => {
  assert.equal(cubeLabel({ mac: A, name: 'GAN-A', nickname: 'mine' }), 'mine', 'your word wins');
  assert.equal(cubeLabel({ mac: A, name: 'GAN-A', nickname: '' }), 'GAN-A', 'then the cube’s own name');
  assert.equal(cubeLabel({ mac: A, name: '', nickname: '' }), A, 'then the address, so it is still pickable');
  assert.equal(cubeLabel(null), '');
});
