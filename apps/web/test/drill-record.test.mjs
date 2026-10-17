// The practice record (`lib/drill/record.js`) — dev-docs/algorithm-drill-v2-plan.md §5, work item WI-11.
//
// What must NOT happen is most of this file: an untimed rep must never move a best or a median; a refused
// record must never be written over; a write that failed must never read as saved; a lost turn must never
// count as the child's mistake. The adapter from the engine is checked against REAL engine runs, driven with
// the reports a cube makes (the same shape of harness as test/drill-engine.test.mjs), never against a
// hand-built `done` event that could drift from what the engine emits.
import assert from 'node:assert/strict';
import test from 'node:test';

import { SOLVED, applyAlg, toFacelets } from '../lib/cube-pieces.js';
import { createDrillEngine } from '../lib/drill/engine.js';
import {
  PER_ALG_CAP, PracticeRecordError, RECORD_KEY, RECORD_VERSION, TOTAL_CAP,
  openPracticeRecord, parseRecord, repFromDone, statsOf, watchReps,
} from '../lib/drill/record.js';
import { TIME_REFUSAL } from '../lib/drill/timing.js';

// ---- fakes: a storage and a clock -----------------------------------------------------------------------

/** A storage over a Map, with the failures a real one has: a read that throws, a write that throws (a full
 *  quota), and a write that "succeeds" and keeps nothing. `writes` counts every setItem that was ATTEMPTED. */
function fakeStorage(initial = null, { readThrows = false, writeThrows = false, writeDrops = false } = {}) {
  const map = new Map();
  if (initial !== null) map.set(RECORD_KEY, initial);
  const s = {
    writes: 0,
    getItem(k) {
      if (readThrows) throw new Error('SecurityError: the read was refused');
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      s.writes += 1;
      if (writeThrows) {
        const e = new Error('QuotaExceededError');
        e.name = 'QuotaExceededError';
        throw e;
      }
      if (!writeDrops) map.set(k, String(v));
    },
    raw: () => (map.has(RECORD_KEY) ? map.get(RECORD_KEY) : null),
  };
  return s;
}

const clockFrom = (t0 = 1_760_000_000_000, step = 1000) => {
  let t = t0;
  return () => { t += step; return t; };
};

const open = (storage, now = clockFrom()) => openPracticeRecord({ storage, now });

/** A rep as `repFromDone` makes them. */
const rep = ({ clean = true, lostTurn = false, ms = 1000, refused = null, turns, pauses = 0, htm = 7 } = {}) => ({
  clean, lostTurn, ms, refused, turns: turns === undefined ? (ms !== null && clean ? htm - 1 : null) : turns, pauses, htm,
});

// ---- the engine, driven the way drill-engine.test.mjs drives it ---------------------------------------

/** An engine on a manual clock, its events piped through `watchReps` into `reps`. */
function drive(alg, { numbersMoves = true } = {}) {
  let clock = 0;
  let id = 0;
  const timers = new Map();
  const reps = [];
  const events = [];
  const sink = watchReps((r, e) => reps.push({ rep: r, event: e }));
  const engine = createDrillEngine({
    alg,
    numbersMoves,
    setTimer: (fn, ms) => { id += 1; timers.set(id, { at: clock + ms, fn }); return id; },
    clearTimer: (handle) => { timers.delete(handle); },
    now: () => clock,
    onEvent: (e) => { events.push(e); sink(e); },
  });
  const advance = (ms) => {
    const until = clock + ms;
    for (;;) {
      const due = [...timers].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      clock = due[1].at;
      timers.delete(due[0]);
      due[1].fn();
    }
    clock = until;
  };
  let serial = 0;
  const turn = (notation, { gap = 100, skip = 0, cubeClock = true } = {}) => {
    advance(gap);
    serial = (serial + 1 + skip) & 0xff;
    engine.report({
      notation, timestamp: clock, cubeTimestamp: cubeClock ? 500_000 + clock : null, serial: numbersMoves ? serial : null,
    });
  };
  engine.start({ facelets: toFacelets(SOLVED) });
  return { engine, reps, events, turn, advance };
}

// ---- the adapter round-trips real engine runs -----------------------------------------------------------

test('a real engine run goes through watchReps and add, and reads back as the engine reported it', () => {
  const storage = fakeStorage();
  const record = open(storage);
  const d = drive("R U R' U'");
  // Rep 1: clean and timed. Rep 2: a wrong turn held past the window (an excursion), then back. `L` after
  // `R` is off in every hold — one axis cannot be two of the algorithm's.
  for (const q of ['R', 'U', "R'", "U'"]) d.turn(q);
  d.turn('R');
  d.turn('L');
  d.advance(1000);
  assert.ok(d.events.some((e) => e.type === 'off'), 'the wrong turn never went off');
  d.turn("L'");
  for (const q of ['U', "R'", "U'"]) d.turn(q);
  // Rep 3: the serial jumps — a lost turn — and the cube's arrangement is handed back so the rep completes.
  d.turn('R');
  d.turn('U', { skip: 1 });
  d.engine.resync(d.engine.facelets);
  for (const q of ["R'", "U'"]) d.turn(q);
  assert.equal(d.reps.length, 3, 'three reps finished');
  for (const { rep: r } of d.reps) assert.equal(record.add('test-sexy', r).saved, true);

  const stored = record.reps('test-sexy');
  const results = d.reps.map(({ event }) => event.result);
  assert.deepEqual(stored.map((r) => r.ms), results.map((r) => r.ms));
  assert.deepEqual(stored.map((r) => r.refused), results.map((r) => r.refused));
  assert.deepEqual(stored.map((r) => r.htm), [4, 4, 4]);
  assert.deepEqual(stored.map((r) => r.clean), [true, false, false]);
  assert.deepEqual(stored.map((r) => r.lostTurn), [false, false, true]);
  assert.equal(stored[0].turns, results[0].tps.turns, 'a clean timed rep keeps the turns its time spans');
  assert.equal(stored[1].turns, null, 'a rep that left the algorithm keeps no turn count');
  assert.equal(stored[2].refused, TIME_REFUSAL.STREAM_GAP);

  const s = record.stats('test-sexy');
  // The lost-turn rep is not judged: one clean and one excursion among two judged reps.
  assert.deepEqual({ reps: s.reps, judged: s.judged, cleanReps: s.cleanReps, errorRate: s.errorRate },
    { reps: 3, judged: 2, cleanReps: 1, errorRate: 0.5 });
  assert.equal(s.best, results[0].ms, 'the only clean timed rep is the best');
  assert.equal(s.median, results[0].ms);
});

test('a lost turn is never counted as the child\'s error, even on a one-turn algorithm whose time hides it', () => {
  // `R2` times nothing (one-turn), so its result does not say the stream broke; only the uncertain event does.
  // The second quarter goes missing; the app proves the loss (`gap`) and hands back the cube as it is.
  const d = drive('R2');
  d.turn('R');
  d.engine.gap();
  assert.ok(d.events.some((e) => e.type === 'uncertain'));
  d.engine.resync(toFacelets(applyAlg(SOLVED, 'R2')));
  assert.equal(d.reps.length, 1, 'the mended rep did not complete');
  const last = d.reps.at(-1).rep;
  assert.equal(last.lostTurn, true);
  assert.equal(last.clean, false);
  assert.equal(statsOf([{ ...last, at: 1 }]).errorRate, null, 'an unjudged rep made an error rate');
});

test('the adapter refuses a done event that contradicts the caller about a lost turn', () => {
  const d = drive("R U R' U'");
  d.turn('R');
  d.turn('U', { skip: 1 });
  d.engine.resync(d.engine.facelets);
  for (const q of ["R'", "U'"]) d.turn(q);
  const done = d.events.find((e) => e.type === 'done');
  assert.equal(done.result.refused, TIME_REFUSAL.STREAM_GAP);
  // Missing the uncertain event would file a lost turn as a mistake: thrown, never recorded.
  assert.throws(() => repFromDone(done, { uncertain: false }), /lost turn/);
  assert.equal(repFromDone(done, { uncertain: true }).lostTurn, true);
  const clean = drive("R U R' U'");
  for (const q of ['R', 'U', "R'", "U'"]) clean.turn(q);
  assert.throws(() => repFromDone(clean.events.find((e) => e.type === 'done'), { uncertain: true }), /clean, yet went uncertain/);
  assert.throws(() => repFromDone({ type: 'off', result: {} }, { uncertain: false }), /not a done event/);
});

// ---- derived figures: from timed clean reps only --------------------------------------------------------

test('an untimed rep never moves the best or the median; nor does a timed rep that was not clean', () => {
  const record = open(fakeStorage());
  for (const ms of [1200, 1000, 1400]) record.add('oll-27', rep({ ms }));
  const before = record.stats('oll-27');
  assert.deepEqual([before.best, before.median, before.timed], [1000, 1200, 3]);
  // Untimed — every refusal — and one far faster but not clean, and one with a lost turn.
  for (const refused of Object.values(TIME_REFUSAL)) record.add('oll-27', rep({ ms: null, refused }));
  record.add('oll-27', rep({ ms: 10, clean: false }));
  record.add('oll-27', rep({ ms: null, refused: TIME_REFUSAL.STREAM_GAP, clean: false, lostTurn: true }));
  const after = record.stats('oll-27');
  assert.deepEqual([after.best, after.median, after.timed], [1000, 1200, 3], 'an untimed or unclean rep moved a time');
  assert.equal(after.reps, 3 + Object.keys(TIME_REFUSAL).length + 2);
});

test('with no timed rep there is no best, median or pace — null, never zero', () => {
  const s = statsOf([{ ...rep({ ms: null, refused: TIME_REFUSAL.NO_CUBE_CLOCK }), at: 1 }]);
  assert.deepEqual([s.best, s.median, s.pace, s.timed], [null, null, null, 0]);
  assert.equal(s.errorRate, 0);
  const none = statsOf([]);
  assert.deepEqual([none.reps, none.errorRate, none.streak, none.best, none.median, none.pace], [0, null, 0, null, null, null]);
});

test('the streak counts clean reps from the newest back, stops at an unclean one, and steps over a lost turn', () => {
  const r = (o) => ({ ...rep(o), at: 1 });
  const lost = r({ ms: null, refused: TIME_REFUSAL.STREAM_GAP, clean: false, lostTurn: true });
  assert.equal(statsOf([r(), r({ clean: false }), r(), lost, r(), r()]).streak, 3);
  assert.equal(statsOf([r(), r(), r({ clean: false })]).streak, 0);
  assert.equal(statsOf([lost, lost]).streak, 0, 'reps nobody could judge made a streak');
  // Pace is per turn spanned, so two lengths compare.
  assert.equal(statsOf([r({ ms: 600, htm: 7, turns: 6 }), r({ ms: 300, htm: 4, turns: 3 })]).pace, 100);
});

// ---- caps ----------------------------------------------------------------------------------------------

test(`each algorithm keeps its newest ${PER_ALG_CAP} reps`, () => {
  const storage = fakeStorage();
  const record = open(storage);
  for (let i = 1; i <= PER_ALG_CAP + 5; i++) assert.equal(record.add('pll-t', rep({ ms: i })).saved, true);
  const reps = record.reps('pll-t');
  assert.equal(reps.length, PER_ALG_CAP);
  assert.deepEqual(reps.map((r) => r.ms), Array.from({ length: PER_ALG_CAP }, (_, i) => i + 6), 'not the newest');
});

/** Stored text holding `n` reps spread over algorithms, the oldest `at` first. */
function storedText(perAlg) {
  let t = 1_000_000;
  const algs = {};
  for (const [id, n] of perAlg) {
    algs[id] = Array.from({ length: n }, () => ({ t: (t += 1), c: true, l: false, ms: 900, r: null, n: 6, p: 0, h: 7 }));
  }
  return JSON.stringify({ v: RECORD_VERSION, algs });
}

test(`the record keeps ${TOTAL_CAP} reps overall, dropping the oldest across every algorithm`, () => {
  // Fifty algorithms full to the per-algorithm cap: exactly the overall cap. `old` is written first, so its
  // reps are the oldest of all.
  const ids = ['old', ...Array.from({ length: TOTAL_CAP / PER_ALG_CAP - 1 }, (_, i) => `alg-${i}`)];
  const storage = fakeStorage(storedText(ids.map((id) => [id, PER_ALG_CAP])));
  const record = open(storage, clockFrom(2_000_000_000_000));
  assert.equal(record.add('new', rep()).saved, true);
  const all = record.read();
  const total = [...all.values()].reduce((n, reps) => n + reps.length, 0);
  assert.equal(total, TOTAL_CAP);
  assert.equal(all.get('old').length, PER_ALG_CAP - 1, 'the oldest rep overall was not the one dropped');
  assert.equal(all.get('alg-0').length, PER_ALG_CAP);
  assert.equal(all.get('new').length, 1);
  // A record past either cap was never written by this module: refused on read.
  assert.throws(() => parseRecord(storedText([['x', PER_ALG_CAP + 1]])), (e) => e.code === 'corrupt');
  assert.throws(() => parseRecord(storedText([...ids, 'one-more'].map((id) => [id, PER_ALG_CAP]))), (e) => e.code === 'corrupt');
});

// ---- refused, and never overwritten -------------------------------------------------------------------

const GOOD = { t: 5, c: true, l: false, ms: 900, r: null, n: 6, p: 0, h: 7 };
const CORRUPT = [
  ['not JSON', '{"v":1,', 'not-json'],
  ['an array', '[]', 'foreign'],
  ['JSON null', 'null', 'foreign'],
  ['another version', JSON.stringify({ v: 2, algs: {} }), 'foreign'],
  ['algs not a record', JSON.stringify({ v: 1, algs: [] }), 'foreign'],
  ['an empty rep list', JSON.stringify({ v: 1, algs: { a: [] } }), 'corrupt'],
  ['a rep that is a string', JSON.stringify({ v: 1, algs: { a: ['fast'] } }), 'corrupt'],
  ['timed and refused', JSON.stringify({ v: 1, algs: { a: [{ ...GOOD, r: 'one-turn' }] } }), 'corrupt'],
  ['neither timed nor refused', JSON.stringify({ v: 1, algs: { a: [{ ...GOOD, ms: null, n: null }] } }), 'corrupt'],
  ['an unknown refusal', JSON.stringify({ v: 1, algs: { a: [{ ...GOOD, ms: null, n: null, r: 'slow' }] } }), 'corrupt'],
  ['clean with a lost turn', JSON.stringify({ v: 1, algs: { a: [{ ...GOOD, l: true }] } }), 'corrupt'],
  ['a missing field', JSON.stringify({ v: 1, algs: { a: [{ ...GOOD, p: undefined }] } }), 'corrupt'],
  ['a string time', JSON.stringify({ v: 1, algs: { a: [{ ...GOOD, ms: '900' }] } }), 'corrupt'],
  ['a negative time', JSON.stringify({ v: 1, algs: { a: [{ ...GOOD, ms: -1 }] } }), 'corrupt'],
  ['more turns than the algorithm', JSON.stringify({ v: 1, algs: { a: [{ ...GOOD, n: 8 }] } }), 'corrupt'],
  ['a clean timed rep with no turn count', JSON.stringify({ v: 1, algs: { a: [{ ...GOOD, n: null }] } }), 'corrupt'],
  ['reps out of order', JSON.stringify({ v: 1, algs: { a: [{ ...GOOD, t: 9 }, { ...GOOD, t: 8 }] } }), 'corrupt'],
  ['an empty id', JSON.stringify({ v: 1, algs: { '': [GOOD] } }), 'corrupt'],
];

test('corrupt or foreign storage is refused loudly, and the next rep does NOT overwrite it', () => {
  for (const [what, text, code] of CORRUPT) {
    const storage = fakeStorage(text);
    const record = open(storage);
    assert.throws(() => record.read(), (e) => e instanceof PracticeRecordError && e.code === code, what);
    assert.throws(() => record.stats('a'), PracticeRecordError, `${what}: stats read past a refused record`);
    const out = record.add('a', rep());
    assert.equal(out.saved, false, `${what}: a rep was saved over a refused record`);
    assert.equal(out.error.code, code, what);
    assert.equal(storage.writes, 0, `${what}: a write was attempted`);
    assert.equal(storage.raw(), text, `${what}: the stored text changed`);
  }
});

test('a read that throws is not an empty record: the add is refused and nothing is written', () => {
  const storage = fakeStorage(storedText([['a', 3]]), { readThrows: true });
  const record = open(storage);
  assert.throws(() => record.read(), (e) => e.code === 'unreadable');
  const out = record.add('a', rep());
  assert.deepEqual([out.saved, out.error.code, storage.writes], [false, 'unreadable', 0]);
});

test('a write that throws (a full quota) surfaces, and so does one that kept nothing', () => {
  const full = fakeStorage(null, { writeThrows: true });
  const out = open(full).add('a', rep());
  assert.equal(out.saved, false);
  assert.equal(out.error.code, 'write-failed');
  assert.equal(out.error.cause.name, 'QuotaExceededError', 'the cause was lost');
  const dropped = fakeStorage(null, { writeDrops: true });
  const silent = open(dropped).add('a', rep());
  assert.deepEqual([silent.saved, silent.error.code], [false, 'did-not-land']);
});

test('a clock behind the last rep refuses the rep rather than reordering the record', () => {
  const storage = fakeStorage();
  let t = 10_000;
  const record = openPracticeRecord({ storage, now: () => t });
  assert.equal(record.add('a', rep()).saved, true);
  const text = storage.raw();
  t = 9_000;
  const out = record.add('a', rep());
  assert.deepEqual([out.saved, out.error.code], [false, 'clock-behind']);
  assert.equal(storage.raw(), text);
});

test('a malformed rep from the caller throws, and a hostile id is a key like any other', () => {
  const storage = fakeStorage();
  const record = open(storage);
  assert.throws(() => record.add('a', rep({ ms: 10, refused: TIME_REFUSAL.ONE_TURN })), /both timed and refused/);
  assert.throws(() => record.add('a', { ...rep(), clean: 'yes' }), /neither clean/);
  assert.throws(() => record.add('', rep()), /not a ledger id/);
  assert.equal(storage.writes, 0);
  assert.equal(record.add('__proto__', rep()).saved, true);
  assert.equal(record.read().get('__proto__').length, 1);
  assert.equal(Object.getPrototypeOf(JSON.parse(storage.raw()).algs), Object.prototype);
  assert.throws(() => openPracticeRecord({ storage: {}, now: Date.now }), /injected/);
});

test('the storage key and the caps are what the format says', () => {
  assert.equal(RECORD_KEY, 'cubusDrillRecord');
  assert.ok(PER_ALG_CAP > 0 && TOTAL_CAP % PER_ALG_CAP === 0 && TOTAL_CAP >= PER_ALG_CAP);
  // A full record stays well inside an origin's ~5 MB: measured, not assumed.
  const text = storedText(Array.from({ length: TOTAL_CAP / PER_ALG_CAP }, (_, i) => [`cmll-case-${i}`, PER_ALG_CAP]));
  assert.ok(text.length < 500_000, `a full record is ${text.length} characters`);
});
