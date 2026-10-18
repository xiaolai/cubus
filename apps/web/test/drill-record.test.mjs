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
 *  quota — `writeThrows` may be changed later, as a quota frees up), and a write that "succeeds" and keeps
 *  nothing. `writes` counts every setItem that was ATTEMPTED. */
function fakeStorage(initial = null, { readThrows = false, writeThrows = false, writeDrops = false } = {}) {
  const map = new Map();
  if (initial !== null) map.set(RECORD_KEY, initial);
  const s = {
    writes: 0,
    writeThrows,
    getItem(k) {
      if (readThrows) throw new Error('SecurityError: the read was refused');
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      s.writes += 1;
      if (s.writeThrows) {
        const e = new Error('QuotaExceededError');
        e.name = 'QuotaExceededError';
        throw e;
      }
      if (!writeDrops) map.set(k, String(v));
    },
    removeItem(k) { map.delete(k); },
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

/** Every refusal a rep of an `htm`-turn algorithm can carry, in the shape the engine gives it: a one-turn
 *  algorithm is refused as one turn and nothing else; a longer one lost a turn exactly when it is refused for a
 *  stream gap, and is then not clean. */
const refusedReps = (htm) => Object.values(TIME_REFUSAL)
  .filter((refused) => (htm === 1) === (refused === TIME_REFUSAL.ONE_TURN))
  .map((refused) => rep({ ms: null, refused, htm, ...(refused === TIME_REFUSAL.STREAM_GAP ? { clean: false, lostTurn: true } : {}) }));

test('an untimed rep never moves the best or the median; nor does a timed rep that was not clean', () => {
  const record = open(fakeStorage());
  for (const ms of [1200, 1000, 1400]) assert.equal(record.add('oll-27', rep({ ms })).saved, true);
  const before = record.stats('oll-27');
  assert.deepEqual([before.best, before.median, before.timed], [1000, 1200, 3]);
  // Untimed — every refusal a seven-turn algorithm can carry, a lost turn among them — and one far faster but
  // not clean.
  const untimed = refusedReps(7);
  assert.deepEqual(untimed.map((r) => r.refused).sort(), Object.values(TIME_REFUSAL).filter((r) => r !== TIME_REFUSAL.ONE_TURN).sort());
  for (const r of untimed) assert.equal(record.add('oll-27', r).saved, true, r.refused);
  assert.equal(record.add('oll-27', rep({ ms: 10, clean: false })).saved, true);
  const after = record.stats('oll-27');
  assert.deepEqual([after.best, after.median, after.timed], [1000, 1200, 3], 'an untimed or unclean rep moved a time');
  assert.equal(after.reps, 3 + untimed.length + 1);
  // A one-turn algorithm is never timed, and its every rep is refused as one turn — with or without a lost turn.
  const one = refusedReps(1);
  assert.deepEqual(one.map((r) => r.refused), [TIME_REFUSAL.ONE_TURN]);
  assert.equal(record.add('r2', one[0]).saved, true);
  assert.equal(record.add('r2', { ...one[0], clean: false, lostTurn: true }).saved, true);
  assert.deepEqual([record.stats('r2').timed, record.stats('r2').judged], [0, 1]);
});

test('with no timed rep there is no best, median or pace — null, never zero', () => {
  const s = statsOf([{ ...rep({ ms: null, refused: TIME_REFUSAL.NO_CUBE_CLOCK }), at: 1 }]);
  assert.deepEqual([s.best, s.median, s.pace, s.timed], [null, null, null, 0]);
  assert.equal(s.errorRate, 0);
  const none = statsOf([]);
  assert.deepEqual([none.reps, none.errorRate, none.streak, none.best, none.median, none.pace], [0, null, 0, null, null, null]);
});

test('the median of two times is their midpoint, never a sum that overflows', () => {
  // Every time the record accepts is a finite number, so every figure it derives is one: two of the largest
  // made `Infinity` when the midpoint was taken as a sum first.
  const big = Number.MAX_VALUE;
  const s = statsOf([{ ...rep({ ms: big }), at: 1 }, { ...rep({ ms: big }), at: 2 }]);
  assert.equal(s.median, big);
  assert.equal(statsOf([{ ...rep({ ms: big / 2 }), at: 1 }, { ...rep({ ms: big }), at: 2 }]).median, big * 0.75);
  assert.equal(statsOf([{ ...rep({ ms: 900 }), at: 1 }, { ...rep({ ms: 1300 }), at: 2 }]).median, 1100);
  for (const k of ['best', 'median', 'pace']) assert.ok(Number.isFinite(s[k]), `${k} is ${s[k]}`);
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


/** A rep id as the record makes them: a page's 16 hex digits — here one repeated digit — then its count. */
const rid = (n, page = 'a') => page.repeat(16) + n.toString(16).padStart(8, '0');
const GEN = '1'.repeat(16);

/** Stored text: `algs` under a generation. */
const recordText = (algs, { gen = GEN } = {}) => JSON.stringify({ v: RECORD_VERSION, gen, algs });

/** Stored text holding `n` reps spread over algorithms, the oldest first, from `from` a millisecond apart. */
function storedText(perAlg, { gen = GEN, from = 1_000_000, page = 'a', shape = {} } = {}) {
  let t = from;
  let k = 0;
  const algs = {};
  for (const [id, n] of perAlg) {
    algs[id] = Array.from({ length: n }, () => ({ i: rid(k++, page), t: (t += 1), c: true, l: false, ms: 900, r: null, n: 6, p: 0, h: 7, ...shape }));
  }
  return recordText(algs, { gen });
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

const GOOD = { i: rid(0), t: 5, c: true, l: false, ms: 900, r: null, n: 6, p: 0, h: 7 };
/** A rep as version 1 stored it — no id — and a version-1 record (no generation). */
const V1_REP = Object.freeze({ t: 5, c: true, l: false, ms: 900, r: null, n: 6, p: 0, h: 7 });
const v1Text = (algs) => JSON.stringify({ v: 1, algs });
/** One algorithm's reps as stored text, with the record's own fields overridden by `top`. */
const one = (reps, top = {}) => JSON.stringify({ v: RECORD_VERSION, gen: GEN, algs: { a: reps }, ...top });
const CORRUPT = [
  ['not JSON', '{"v":2,', 'not-json'],
  ['an array', '[]', 'foreign'],
  ['JSON null', 'null', 'foreign'],
  ['another version', one([GOOD], { v: 3 }), 'foreign'],
  ['a version given as text', one([GOOD], { v: '2' }), 'foreign'],
  ['algs not a record', one([GOOD], { algs: [] }), 'foreign'],
  ['no generation', one([GOOD], { gen: undefined }), 'corrupt'],
  ['a generation that is not 16 lowercase hex digits', one([GOOD], { gen: 'ABCDEF0123456789' }), 'corrupt'],
  ['an empty rep list', one([]), 'corrupt'],
  ['a rep that is a string', one(['fast']), 'corrupt'],
  ['a rep with no id', one([{ ...GOOD, i: undefined }]), 'corrupt'],
  ['a rep id that is not 24 hex digits', one([{ ...GOOD, i: 'a'.repeat(23) }]), 'corrupt'],
  ['one id on two reps', recordText({ a: [GOOD], b: [{ ...GOOD, t: 6 }] }), 'corrupt'],
  ['timed and refused', one([{ ...GOOD, r: 'one-turn' }]), 'corrupt'],
  ['neither timed nor refused', one([{ ...GOOD, ms: null, n: null }]), 'corrupt'],
  ['an unknown refusal', one([{ ...GOOD, ms: null, n: null, r: 'slow' }]), 'corrupt'],
  ['clean with a lost turn', one([{ ...GOOD, l: true }]), 'corrupt'],
  ['a missing field', one([{ ...GOOD, p: undefined }]), 'corrupt'],
  ['a string time', one([{ ...GOOD, ms: '900' }]), 'corrupt'],
  ['a negative time', one([{ ...GOOD, ms: -1 }]), 'corrupt'],
  ['more turns than the algorithm', one([{ ...GOOD, n: 8 }]), 'corrupt'],
  ['a clean timed rep with no turn count', one([{ ...GOOD, n: null }]), 'corrupt'],
  ['reps out of order', one([{ ...GOOD, t: 9 }, { ...GOOD, i: rid(1), t: 8 }]), 'corrupt'],
  ['two reps in one millisecond out of id order', one([{ ...GOOD, i: rid(2) }, { ...GOOD, i: rid(1) }]), 'corrupt'],
  ['an empty id', recordText({ '': [GOOD] }), 'corrupt'],
  // States the engine never makes (timing.js decides one-turn first, then a lost turn), each of which would
  // move a derived figure: a stream gap with no lost turn counts in a streak or as an error, a lost turn that
  // is not refused for it is judged, a timed one-turn rep or a short span makes a pace.
  ['a stream gap that lost no turn, clean', one([{ ...GOOD, ms: null, n: null, r: 'stream-gap' }]), 'corrupt'],
  ['a stream gap that lost no turn, not clean', one([{ ...GOOD, c: false, ms: null, n: null, r: 'stream-gap' }]), 'corrupt'],
  ['a lost turn refused for something else', one([{ ...GOOD, c: false, l: true, ms: null, n: null, r: 'no-cube-clock' }]), 'corrupt'],
  ['a lost turn with a time', one([{ ...GOOD, c: false, l: true, n: null }]), 'corrupt'],
  ['a one-turn algorithm timed', one([{ ...GOOD, h: 1, n: 1 }]), 'corrupt'],
  ['a one-turn algorithm refused for a stream gap', one([{ ...GOOD, c: false, l: true, h: 1, ms: null, n: null, r: 'stream-gap' }]), 'corrupt'],
  ['a long algorithm refused as one turn', one([{ ...GOOD, ms: null, n: null, r: 'one-turn' }]), 'corrupt'],
  ['pauses marked with no time', one([{ ...GOOD, ms: null, n: null, r: 'no-cube-clock', p: 2 }]), 'corrupt'],
  ['a clean time spanning too few turns', one([{ ...GOOD, n: 2 }]), 'corrupt'],
  // Invalid as version 1 too (Codex's round-3 verify, item 3): only a record neither version reads is refused.
  ['a version-2 record whose reps have no ids', one([V1_REP]), 'corrupt'],
  ['a version-1 rep clean with a lost turn', v1Text({ a: [{ ...V1_REP, l: true }] }), 'corrupt'],
  ['a version-1 rep with no length', v1Text({ a: [{ ...V1_REP, h: undefined }] }), 'corrupt'],
  ['version-1 reps out of order', v1Text({ a: [{ ...V1_REP, t: 9 }, { ...V1_REP, t: 8 }] }), 'corrupt'],
  ['two algorithms at one time in version 1', v1Text({ a: [V1_REP], b: [V1_REP] }), 'corrupt'],
  ['an empty version-1 list', v1Text({ a: [] }), 'corrupt'],
  ['a version-1 list past the cap', v1Text({ a: Array.from({ length: PER_ALG_CAP + 1 }, (_, k) => ({ ...V1_REP, t: k + 1 })) }), 'corrupt'],
  ['a version-1 algs that is a list', JSON.stringify({ v: 1, algs: [] }), 'foreign'],
];

test('every shape the engine gives a rep is read back', () => {
  // The other side of the refusals above: the rules refuse what the engine never makes, and nothing it does.
  const shapes = [
    GOOD, { ...GOOD, n: 7 },                                                       // clean, the span is all turns or all but the first
    { ...GOOD, c: false, n: null, p: 2 },                                          // timed, not clean, pauses marked
    { ...GOOD, c: false, l: true, ms: null, n: null, r: 'stream-gap' },           // a lost turn
    { ...GOOD, h: 1, ms: null, n: null, r: 'one-turn' },                           // one turn, clean
    { ...GOOD, h: 1, c: false, l: true, ms: null, n: null, r: 'one-turn' },        // one turn, a lost turn
    ...['no-cube-clock', 'clock-reset', 'no-span'].flatMap((r) => [
      { ...GOOD, ms: null, n: null, r }, { ...GOOD, c: false, ms: null, n: null, r },
    ]),
  ];
  assert.equal(parseRecord(one(shapes.map((x, i) => ({ ...x, i: rid(i), t: i + 1 })))).get('a').length, shapes.length);
});

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

test('a clock behind ANY rep on record refuses the rep — a rep said to be saved is always on record', () => {
  // Fifty algorithms full to the per-algorithm cap, stamped 1_000_001 to 1_005_000, and a rep for an algorithm
  // with none yet: checking the clock against that algorithm alone found nothing to be behind, and the cap
  // then dropped the new rep as the oldest of all — while `add` said it was saved.
  const ids = Array.from({ length: TOTAL_CAP / PER_ALG_CAP }, (_, i) => `alg-${i}`);
  const text = storedText(ids.map((id) => [id, PER_ALG_CAP]));
  for (const [when, at] of [['behind every rep', 999_999], ['behind the newest rep only', 1_004_000]]) {
    const storage = fakeStorage(text);
    const out = openPracticeRecord({ storage, now: () => at }).add('new', rep());
    assert.deepEqual([out.saved, out.error?.code], [false, 'clock-behind'], `${when}: not refused`);
    assert.match(out.error.message, /alg-49/, `${when}: the message does not name the newest rep's algorithm`);
    assert.deepEqual([storage.writes, storage.raw()], [0, text], `${when}: the record was written`);
  }
  // Ahead of every rep: saved, and the rep it says it saved is read back.
  const storage = fakeStorage(text);
  const record = openPracticeRecord({ storage, now: () => 1_005_001 });
  assert.equal(record.add('new', rep()).saved, true);
  assert.equal(record.reps('new').length, 1, 'said saved, and not kept');
});

/** `full` (a parsed record) filled with newer reps, under ids no other rep here has, until it holds `total`. */
function fillTo(full, total, from) {
  let u = from;
  let k = 0;
  let room = total - Object.values(full.algs).reduce((n, reps) => n + reps.length, 0);
  for (let i = 0; room > 0; i++) {
    const n = Math.min(PER_ALG_CAP, room);
    full.algs[`fill-${i}`] = Array.from({ length: n }, () => ({ ...GOOD, i: rid(k++, 'f'), t: (u += 1) }));
    room -= n;
  }
  return u;
}

test('reps one page makes in one millisecond keep the order it made them in, and the cap drops the first made first', () => {
  const storage = fakeStorage();
  const record = openPracticeRecord({ storage, now: () => 10_000 });
  // A clock that has not moved, and two algorithms: each rep is still the newest, by the page's own count.
  for (const [id, ms] of [['y', 111], ['y', 222], ['x', 333]]) assert.equal(record.add(id, rep({ ms })).saved, true, `${id} ${ms}`);
  const made = [...record.read()].flatMap(([, reps]) => reps).sort((a, b) => (a.repId < b.repId ? -1 : 1));
  assert.deepEqual(made.map((r) => [r.at, r.ms]), [[10_000, 111], [10_000, 222], [10_000, 333]], 'the ids are not in the order the reps were made');
  // Full to the cap with newer reps, then one more: of the three made in one millisecond, the first goes.
  const full = JSON.parse(storage.raw());
  const u = fillTo(full, TOTAL_CAP, 20_000);
  const near = fakeStorage(JSON.stringify(full));
  const later = openPracticeRecord({ storage: near, now: () => u + 1 });
  assert.equal(later.add('z', rep()).saved, true);
  assert.deepEqual([later.reps('y').map((r) => r.ms), later.reps('x').map((r) => r.ms)], [[222], [333]], 'the cap dropped another rep than the first made');
});

test('a rep in the millisecond of another page\'s newest rep is saved only if its id orders after it — the record never contradicts the order a page saw', () => {
  const storage = fakeStorage();
  const high = openPracticeRecord({ storage, now: () => 10_000, random: () => 0xffffffff });
  const low = openPracticeRecord({ storage, now: () => 10_000, random: () => 0 });
  assert.equal(high.add('y', rep()).saved, true);
  const text = storage.raw();
  const out = low.add('x', rep());
  assert.deepEqual([out.saved, out.error?.code], [false, 'clock-behind']);
  assert.match(out.error.message, /same millisecond as the newest rep on record \(y's\)/);
  assert.deepEqual([storage.raw(), low.status().error], [text, null], 'a refused rep changed the record, or was taken for trouble with it');
  // The other way round, the new rep's id orders after: saved, and newest.
  const other = fakeStorage();
  const low2 = openPracticeRecord({ storage: other, now: () => 10_000, random: () => 0 });
  const high2 = openPracticeRecord({ storage: other, now: () => 10_000, random: () => 0xffffffff });
  assert.equal(low2.add('y', rep()).saved, true);
  assert.equal(high2.add('x', rep()).saved, true);
});

test('reps of two algorithms in one millisecond are read, and ordered by id for every reader — the cap drops the lower id first', () => {
  // Two pages' reps in one millisecond, neither having seen the other's: ordered by id, which every reader
  // reads alike, whichever list the reps are in and whichever order the lists are stored in.
  const tie = { x: [{ ...GOOD, i: rid(0, 'b'), t: 10 }], y: [{ ...GOOD, i: rid(0, 'c'), t: 10 }] };
  for (const order of [['x', 'y'], ['y', 'x']]) {
    const full = JSON.parse(recordText(Object.fromEntries(order.map((id) => [id, tie[id]]))));
    const u = fillTo(full, TOTAL_CAP, 100);
    const storage = fakeStorage(JSON.stringify(full));
    const record = openPracticeRecord({ storage, now: () => u + 1 });
    assert.equal(record.add('z', rep()).saved, true);
    assert.deepEqual([record.reps('x').length, record.reps('y').length], [0, 1], `stored ${order}: the cap dropped the higher id`);
  }
});

// ---- version 1 is migrated as it is read (Codex's round-3 verify, item 3) ---------------------------------
//
// Before: version 2 refused a valid version-1 record as foreign, so the history in the owner's own installs became
// unreadable and every later add returned `saved: false`, for good.

/** A version-1 record as this branch's earlier commits wrote one: three algorithms, every shape of rep, and a tie
 *  in one millisecond INSIDE one algorithm, which version 1 kept in its list's order. */
const V1 = v1Text({
  'oll-27': [{ ...V1_REP, t: 1_000 }, { ...V1_REP, t: 3_000, ms: 800 }, { ...V1_REP, t: 3_000, ms: 700, c: false, n: null, p: 2 }],
  'pll-t': [{ ...V1_REP, t: 2_000, c: false, l: true, ms: null, n: null, r: 'stream-gap' }, { ...V1_REP, t: 4_000, ms: null, n: null, r: 'no-cube-clock' }],
  r2: [{ ...V1_REP, t: 5_000, h: 1, ms: null, n: null, r: 'one-turn' }],
});
const withoutId = ({ repId, ...rest }) => rest;
/** A random source that counts, so every draw differs and none is `Math.random`'s. */
const counting = () => { let n = 0; return () => { n = (n + 0x01234567) >>> 0; return n; }; };

test('verify item 3: a version-1 record is migrated as it is read — every rep kept in its order, ids from the random source — and written back', () => {
  const was = parseRecord(V1);
  assert.deepEqual([...was.keys()], ['oll-27', 'pll-t', 'r2'], 'precondition: the version-1 record reads as itself');
  const storage = fakeStorage(V1);
  const record = openPracticeRecord({ storage, now: clockFrom(10_000), random: counting() });
  const now = record.read();
  // Every rep kept, in its order, and every figure the same.
  for (const [id, reps] of was) {
    assert.deepEqual(now.get(id).map(withoutId), reps.map(withoutId), `${id}: a rep was lost, changed or moved`);
    assert.deepEqual(statsOf(now.get(id)), statsOf(reps), `${id}: the migration moved a figure`);
  }
  // Written back as version 2, once: a generation, an id on every rep, one page half, all different.
  const stored = JSON.parse(storage.raw());
  assert.equal(stored.v, RECORD_VERSION);
  assert.match(stored.gen, /^[0-9a-f]{16}$/);
  const ids = [...now.values()].flat().map((r) => r.repId);
  assert.ok(ids.every((i) => /^[0-9a-f]{24}$/.test(i)) && new Set(ids).size === ids.length, `ids: ${ids}`);
  assert.equal(new Set(ids.map((i) => i.slice(0, 16))).size, 1, 'the migrated ids were drawn under more than one page half');
  // (time, id) is the order version 1 kept: the tie inside oll-27 in its list's order.
  const oll = now.get('oll-27');
  assert.ok(oll[1].at === oll[2].at && oll[1].repId < oll[2].repId, 'the tie inside one algorithm lost its order');
  assert.deepEqual([storage.writes, statusOf(record)], [1, QUIET]);
  // Read again: already version 2, nothing more is written; and the next rep is saved beside the old ones.
  assert.deepEqual(msOf(record.read()), msOf(now));
  assert.equal(storage.writes, 1, 'a migrated record was written again');
  assert.equal(record.add('pll-t', rep({ ms: 600 })).saved, true);
  assert.deepEqual(msOf(record.read()), { ...msOf(now), 'pll-t': [null, null, 600] });
  // An add as the first thing an instance does migrates too, and keeps every rep.
  const first = fakeStorage(V1);
  const adds = openPracticeRecord({ storage: first, now: clockFrom(10_000) });
  assert.deepEqual(adds.add('r2', rep({ ms: null, refused: TIME_REFUSAL.ONE_TURN, htm: 1 })), { saved: true });
  assert.deepEqual(msOf(adds.read()), { ...msOf(was), r2: [null, null] });
  assert.equal(JSON.parse(first.raw()).v, RECORD_VERSION);
});

test('verify item 3: a version-1 record whose write-back fails still reads, and says why it is not yet version 2', () => {
  const storage = fakeStorage(V1, { writeThrows: true });
  const record = openPracticeRecord({ storage, now: clockFrom(10_000) });
  assert.deepEqual(msOf(record.read()), msOf(parseRecord(V1)), 'a record that could not be written back could not be read');
  assert.deepEqual(statusOf(record), { missing: 0, removed: 0, error: 'write-failed' });
  assert.equal(storage.raw(), V1, 'the version-1 text changed');
  const out = record.add('r2', rep({ ms: null, refused: TIME_REFUSAL.ONE_TURN, htm: 1 }));
  assert.deepEqual([out.saved, out.error?.code], [false, 'write-failed']);
});

test('verify: a version-1 write-back that failed is said only until a read finds the record written as version 2', () => {
  // Codex's final verify: `read` set the error when the write-back failed and never cleared it, so every later read
  // still said `write-failed` after the record had been written.
  const storage = fakeStorage(V1, { writeThrows: true });
  const record = openPracticeRecord({ storage, now: clockFrom(10_000) });
  record.read();
  assert.deepEqual(statusOf(record), { missing: 0, removed: 0, error: 'write-failed' }, 'precondition');
  record.read();
  assert.deepEqual(statusOf(record), { missing: 0, removed: 0, error: 'write-failed' }, 'a write-back that failed again was not said');
  storage.writeThrows = false;
  record.read();
  assert.equal(JSON.parse(storage.raw()).v, RECORD_VERSION, 'precondition: this read wrote it back');
  assert.deepEqual(statusOf(record), QUIET, 'a write-back that landed is still said to have failed');
  // Written back by another instance: the next read finds version 2 and has nothing to say either.
  const other = fakeStorage(V1, { writeThrows: true });
  const c = openPracticeRecord({ storage: other, now: clockFrom(10_000) });
  c.read();
  other.writeThrows = false;
  openPracticeRecord({ storage: other, now: clockFrom(10_000) }).read();
  c.read();
  assert.deepEqual(statusOf(c), QUIET, 'a record another instance wrote back is still said to have failed');
});

test('a read is a fresh snapshot: its lists and reps are frozen, and editing its Map changes nothing stored', () => {
  const storage = fakeStorage();
  const record = open(storage);
  assert.equal(record.add('a', rep()).saved, true);
  const text = storage.raw();
  const first = record.read();
  // The Map is the caller's own copy, so it is an ordinary Map...
  first.set('b', Object.freeze([]));
  first.delete('a');
  // ...and what it held is frozen, so nothing read can be edited under another holder of the same read.
  const again = record.read();
  assert.notEqual(again, first, 'two reads handed out one Map');
  assert.deepEqual([...again.keys()], ['a'], 'editing one read changed the next');
  assert.equal(storage.raw(), text, 'editing a read changed what is stored');
  assert.ok(Object.isFrozen(again.get('a')) && Object.isFrozen(again.get('a')[0]), 'a rep list or a rep can be edited');
  assert.throws(() => again.get('a').push({}), TypeError);
  assert.ok(Object.isFrozen(record.reps('none')), 'an algorithm with no reps hands out an editable list');
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
  // A full record stays under 600 KB, an eighth of an origin's ~5 MB (TOTAL_CAP): measured, not assumed — with
  // this year's clock, a time with a fraction, and the widest counts a rep of a long algorithm carries.
  const text = storedText(Array.from({ length: TOTAL_CAP / PER_ALG_CAP }, (_, i) => [`cmll-case-${i}`, PER_ALG_CAP]),
    { from: 1_760_000_000_000, shape: { c: false, n: null, ms: 12_345.678, p: 12, h: 17 } });
  assert.ok(text.length < 600_000, `a full record is ${text.length} characters`);
});

test('rep ids are drawn from the cryptographic source, never Math.random, and a source that gives no 32-bit value throws', () => {
  // What must NOT happen: an id from Math.random, which nothing would notice until two ids met.
  const was = Math.random;
  Math.random = () => { throw new Error('Math.random was called'); };
  try {
    const record = open(fakeStorage());
    assert.equal(record.add('x', rep()).saved, true);
    assert.equal(record.add('x', rep()).saved, true);
    assert.equal(new Set(record.reps('x').map((r) => r.repId)).size, 2);
  } finally {
    Math.random = was;
  }
  // An injected source: the page's half of each id, then the record's generation, drawn in that order.
  const draws = [0x01234567, 0x89abcdef, 0xdeadbeef, 0x00c0ffee];
  const storage = fakeStorage();
  const record = openPracticeRecord({ storage, now: clockFrom(), random: () => draws.shift() });
  record.add('x', rep());
  record.add('x', rep());
  assert.deepEqual(record.reps('x').map((r) => r.repId), ['0123456789abcdef00000000', '0123456789abcdef00000001']);
  assert.equal(JSON.parse(storage.raw()).gen, 'deadbeef00c0ffee');
  for (const bad of [-1, 2 ** 32, 1.5, Number.NaN, '7']) {
    assert.throws(() => openPracticeRecord({ storage: fakeStorage(), now: Date.now, random: () => bad }), /32-bit unsigned/, String(bad));
  }
});

// ---- two instances, one storage ------------------------------------------------------------------------
//
// Measured 2026-10-18, two pages of one origin in WebKit and Chromium: each page reads its OWN copy of
// localStorage, which another page's write reaches a few milliseconds later as a `storage` event — or, while
// the page's thread is busy, only when it is free again. So a rep added in one window within that gap is
// written over the other's: WebKit lost one of two reps in 20 of 20 trials 0 ms apart, 14 at 1 ms, 5 at 2 ms,
// none at 5 ms; and in 20 of 20 at every gap up to 50 ms while one page was busy. Two instances in ONE page
// share one thread and one copy, and `add` is synchronous, so their adds cannot interleave at all.
//
// Measured again with rep ids and generations (round 3, 2026-10-18), the same trials in both engines, idle and
// busy, two algorithms and one, 0 to 50 ms apart: all 960 kept both reps, none refused, none said lost. Of 240
// that also read back what each page wrote, 159 had crossed — neither write held the other's rep — and every
// one of the 159 was put back.

/** Windows over one origin's storage, as measured: each reads its own copy, which another window's write
 *  reaches only when `deliver()` runs — and then as a `storage` event, never to the writer itself. A change
 *  that arrives after the window has written the key itself does not overwrite its copy (the stored value is
 *  the later write), as the browsers' copies ignore a remote change under a newer local one — a `clear()` of
 *  every key included, key by key. An event's
 *  `oldValue` is what the STORAGE held before the change — measured for a removal in both engines (2026-10-18),
 *  with the remover's own copy stale: the event carried the value it had not seen. `deliver({ events: false })`
 *  updates the copies and holds their events until `fire()`: a page whose copy has a change before its handler
 *  for it has run. One step at a time: `arrive()` takes the next change into the other copies and holds its
 *  events, `fireNext(i)` runs window i's next held event, and `drain()` delivers until nothing moves. A
 *  storage's `refuse` makes its writes throw, as a full quota does; `writes` counts every write it was asked for. */
function windows(n) {
  const backend = new Map();
  const queue = [];
  const held = [];
  let seq = 0;
  const tabs = Array.from({ length: n }, (_, i) => {
    const cache = new Map();
    const ownAt = new Map();
    const events = new EventTarget();
    const own = (k, v) => {
      const old = k !== null && backend.has(k) ? backend.get(k) : null;
      if (k === null) { cache.clear(); backend.clear(); } else if (v === null) { cache.delete(k); backend.delete(k); } else { cache.set(k, v); backend.set(k, v); }
      seq += 1;
      ownAt.set(k, seq);
      queue.push({ from: i, k, v, old, seq });
    };
    const storage = {
      refuse: false,
      writes: 0,
      getItem: (k) => (cache.has(k) ? cache.get(k) : null),
      setItem: (k, v) => {
        storage.writes += 1;
        if (storage.refuse) throw Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' });
        own(k, String(v));
      },
      removeItem: (k) => own(k, null),
      clear: () => own(null, null),
    };
    return { storage, events, cache, ownAt };
  });
  const fire = () => {
    while (held.length) {
      const [t, event] = held.shift();
      t.events.dispatchEvent(event);
    }
  };
  const fireNext = (i) => {
    const at = held.findIndex(([t]) => t === tabs[i]);
    if (at < 0) throw new Error(`window ${i} has no event held`);
    const [[t, event]] = held.splice(at, 1);
    t.events.dispatchEvent(event);
  };
  const arrive = () => {
    if (!queue.length) throw new Error('no change is on its way');
    const { from, k, v, old, seq: at } = queue.shift();
    tabs.forEach((t, i) => {
      if (i === from) return;
      if (k === null) { for (const key of [...t.cache.keys()]) if (!(t.ownAt.get(key) > at)) t.cache.delete(key); }
      else if (!(t.ownAt.get(k) > at)) { if (v === null) t.cache.delete(k); else t.cache.set(k, v); }
      held.push([t, Object.assign(new Event('storage'), { key: k, oldValue: old, newValue: v, storageArea: t.storage })]);
    });
  };
  const deliver = ({ events = true } = {}) => {
    while (queue.length) {
      arrive();
      // A window's handler may write, which queues more: delivered in turn, as a browser would.
      if (events) fire();
    }
  };
  /** Everything on its way, delivered with its events, until no window writes again — bounded, so a pair of
   *  windows that write each other's record back forever fails here rather than hanging. */
  const drain = () => {
    for (let round = 0; queue.length || held.length; round += 1) {
      if (round > 1_000) throw new Error('the windows never stopped writing');
      fire();
      if (queue.length) { arrive(); fire(); }
    }
  };
  const raw = () => (backend.has(RECORD_KEY) ? backend.get(RECORD_KEY) : null);
  const stored = () => parseRecord(raw());
  /** How many changes the storage has taken; whether one is on its way; whether window i has an event held. */
  const changes = () => seq;
  const waiting = () => queue.length > 0;
  const pending = (i) => held.some(([t]) => t === tabs[i]);
  return { tabs, deliver, fire, fireNext, arrive, drain, raw, stored, changes, waiting, pending };
}
const msOf = (algs) => Object.fromEntries([...algs].map(([id, reps]) => [id, reps.map((r) => r.ms)]));
const statusOf = (record) => {
  const s = record.status();
  return { missing: s.missing, removed: s.removed, error: s.error?.code ?? null };
};
const QUIET = Object.freeze({ missing: 0, removed: 0, error: null });

/** Each tab's record, watching its window, with what each heard: the status at every `onChange`. */
function openAll(w, now, extra = () => ({})) {
  const heard = w.tabs.map(() => []);
  const records = w.tabs.map((t, i) => {
    const record = openPracticeRecord({
      storage: t.storage, now, changes: t.events, onChange: () => heard[i].push(statusOf(record)), ...extra(i),
    });
    return record;
  });
  return { records, heard };
}

test('two instances in one page cannot interleave: every rep either adds is kept', () => {
  const storage = fakeStorage();
  const clock = clockFrom();
  const a = openPracticeRecord({ storage, now: clock });
  const b = openPracticeRecord({ storage, now: clock });
  for (let i = 1; i <= 5; i++) {
    assert.equal(a.add('x', rep({ ms: 100 + i })).saved, true);
    assert.equal(b.add('y', rep({ ms: 200 + i })).saved, true);
  }
  assert.deepEqual(msOf(a.read()), { x: [101, 102, 103, 104, 105], y: [201, 202, 203, 204, 205] });
});

test('a rep another window wrote over is put back as soon as that write arrives, and each window hears of the other\'s write', () => {
  const w = windows(2);
  const { records: [a, b], heard } = openAll(w, clockFrom());
  assert.equal(a.add('x', rep({ ms: 100 })).saved, true);
  w.deliver();
  assert.equal(a.add('x', rep({ ms: 111 })).saved, true);
  // The other window has not heard of it yet, and writes from its own copy: the rep is written over.
  assert.equal(b.add('y', rep({ ms: 222 })).saved, true);
  assert.deepEqual(msOf(w.stored()), { x: [100], y: [222] });
  w.deliver();
  assert.deepEqual(msOf(w.stored()), { x: [100, 111], y: [222] }, 'the rep written over was not put back');
  assert.deepEqual([statusOf(a), statusOf(b)], [QUIET, QUIET]);
  assert.ok(heard[0].length > 0 && heard[1].length > 0, 'a window was not told of the other\'s write');
  // Both windows read the same record afterwards.
  assert.deepEqual(msOf(a.read()), msOf(b.read()));
});

test('without storage events, a window puts its rep back at its next add', () => {
  const w = windows(2);
  const clock = clockFrom();
  const [a, b] = w.tabs.map((t) => openPracticeRecord({ storage: t.storage, now: clock }));
  assert.equal(a.add('x', rep({ ms: 100 })).saved, true);
  w.deliver();
  assert.equal(a.add('x', rep({ ms: 111 })).saved, true);
  assert.equal(b.add('y', rep({ ms: 222 })).saved, true);
  w.deliver();
  assert.deepEqual(a.add('x', rep({ ms: 333 })), { saved: true });
  assert.deepEqual(msOf(w.stored()), { x: [100, 111, 333], y: [222] });
  assert.deepEqual(statusOf(a), QUIET);
});

test('row 8: two windows saving the same rep of one algorithm in one millisecond both keep it — whichever page\'s ids order first', () => {
  // Before: the two reps were one string, so the record held one and neither window said a thing.
  // The record both windows have seen is a millisecond OLDER than the crossing reps. In the same millisecond, the
  // second window's rep would have to order after the first's by id — a coin toss between two random page halves,
  // refused when lost by design (`a rep in the millisecond of another page's newest rep …`) — which made this test
  // fail on about half its runs. Each order is driven here, and the platform's own source after them.
  const sources = [['this page\'s ids order last', (i) => (i === 0 ? 0xffffffff : 0)], ['this page\'s ids order first', (i) => (i === 0 ? 0 : 0xffffffff)], ['the platform\'s source', null]];
  for (const [order, draw] of sources) {
    let t = 4_999;
    const w = windows(2);
    const { records: [a, b] } = openAll(w, () => t, (i) => (draw ? { random: () => draw(i) } : {}));
    assert.equal(a.add('x', rep({ ms: 100 })).saved, true);
    w.deliver();
    t = 5_000;
    assert.deepEqual([a.add('x', rep()).saved, b.add('x', rep()).saved], [true, true], `${order}: a rep was refused`);
    w.deliver();
    const kept = (w.stored().get('x') ?? []).slice(1);
    assert.equal(kept.length, 2, `${order}: two reps each said saved are one on record`);
    assert.deepEqual(kept.map((r) => [r.at, r.ms]), [[5_000, 1000], [5_000, 1000]]);
    assert.notEqual(kept[0].repId, kept[1].repId);
    assert.deepEqual([statusOf(a), statusOf(b)], [QUIET, QUIET]);
    assert.deepEqual(msOf(a.read()), msOf(b.read()));
  }
});

test('row 9: a removal whose event arrives late takes only what it removed — a rep saved after it stays, and is put back over a competing write', () => {
  const w = windows(2);
  const { records: [a, b] } = openAll(w, clockFrom());
  assert.equal(a.add('x', rep({ ms: 111 })).saved, true);
  w.deliver();
  w.tabs[1].storage.removeItem(RECORD_KEY);
  w.deliver({ events: false });                         // this window's copy has the removal; its event has not run
  assert.equal(a.add('x', rep({ ms: 222 })).saved, true, 'precondition: a rep saved after the removal');
  assert.deepEqual(statusOf(a), { missing: 0, removed: 1, error: null }, 'the rep that went with the record was not counted');
  w.fire();                                             // the removal's event, late
  assert.deepEqual(msOf(w.stored()), { x: [222] }, 'a late removal event took a rep saved after it');
  // The other window has this one's new record, then this window writes from a copy without its next rep.
  w.deliver();
  assert.equal(a.add('x', rep({ ms: 333 })).saved, true);
  assert.equal(b.add('y', rep({ ms: 444 })).saved, true);
  assert.deepEqual(msOf(w.stored()), { x: [222], y: [444] }, 'precondition: a competing write');
  w.deliver();
  assert.deepEqual(msOf(w.stored()), { x: [222, 333], y: [444] }, 'a rep saved after the removal was lost to a competing write');
  assert.deepEqual([statusOf(a), statusOf(b)], [{ missing: 0, removed: 1, error: null }, QUIET]);
});

test('row 10 (verify item 2): a record removed and started again, once or twice, never takes back the removed reps — the removal\'s event names them', () => {
  // Codex's round-3 verify: this window holds G1; the other removes G1 and starts G2, then removes G2 and starts
  // G3. G3 named only G2 as the record it replaced, so this window put its removed G1 reps back into G3, unsaid.
  // Now the first removal's event carries the removed record (`oldValue`, the storage's value, measured in both
  // engines), which holds this window's rep, so the rep leaves its journal even though its first look finds G3.
  for (const starts of [1, 2]) {
    const w = windows(2);
    const { records: [a, b] } = openAll(w, clockFrom());
    assert.equal(a.add('x', rep({ ms: 111 })).saved, true);
    w.deliver();
    for (let k = 0; k < starts; k += 1) {
      w.tabs[1].storage.removeItem(RECORD_KEY);
      assert.equal(b.add('y', rep({ ms: 200 + k })).saved, true);
    }
    // Every change reaches this window's copy before its first handler runs: it never sees the record gone.
    w.deliver({ events: false });
    w.fire();
    assert.equal(a.add('x', rep({ ms: 333 })).saved, true);
    w.deliver();
    assert.deepEqual(msOf(w.stored()), { y: [199 + starts], x: [333] }, `started ${starts} time(s): a removed rep was put back`);
    assert.deepEqual(statusOf(a), { missing: 0, removed: 1, error: null });
  }
});

/** Every order in which a window can take in `n` changes another window made: its copy takes each change before
 *  that change's event runs, the changes arrive in order and their events run in order, and nothing else is fixed —
 *  the interleavings of n arrivals with n events, the k-th arrival before the k-th event. A Catalan number of them:
 *  2 for two changes, 42 for five. */
function interleavings(n) {
  const out = [];
  const walk = (arrived, fired, path) => {
    if (fired === n) { out.push(path); return; }
    if (arrived < n) walk(arrived + 1, fired, [...path, 'arrive']);
    if (fired < arrived) walk(arrived, fired + 1, [...path, 'fire']);
  };
  walk(0, 0, []);
  return out;
}
/** A record's reps as times, keyed in a fixed order, so two records compare as text whatever order they were
 *  written in. */
const canonical = (algs) => Object.fromEntries([...algs].sort(([p], [q]) => (p < q ? -1 : p > q ? 1 : 0))
  .map(([id, reps]) => [id, reps.map((r) => r.ms)]));
/** Runs `scene` once per order, and returns every end state that is not `want`, with the first order that reached it. */
function endsOtherThan(orders, scene, want) {
  const ends = new Map();
  for (const order of orders) {
    const end = JSON.stringify(scene(order));
    if (!ends.has(end)) ends.set(end, order.join(' '));
  }
  return [...ends].filter(([end]) => end !== JSON.stringify(want));
}

test('verify: the reps a removal took never come back — in every order a window can take in two removals, the records started after them, and its own repair', () => {
  // Codex's final verify of 0841dc5e: A holds a rep of G1; B writes G1, removes it, starts G2, removes it, starts G3.
  // A's look at the queued G1 write found G3 and put the rep back there; the two removal events after it named G1
  // and G2, neither of them A's generation by then, so the removed rep stayed in G3 and `removed` said 0. A window's
  // copy takes each change before that change's event runs, and nothing else about the order is fixed: all 42.
  const orders = interleavings(5);
  assert.equal(orders.length, 42);
  const others = endsOtherThan(orders, (order) => {
    const w = windows(2);
    const { records: [a, b] } = openAll(w, clockFrom());
    assert.equal(a.add('x', rep({ ms: 101 })).saved, true);
    w.deliver();
    assert.equal(b.add('y', rep({ ms: 201 })).saved, true);   // writes G1
    w.tabs[1].storage.removeItem(RECORD_KEY);                  // removes G1
    assert.equal(b.add('y', rep({ ms: 202 })).saved, true);   // starts G2
    w.tabs[1].storage.removeItem(RECORD_KEY);                  // removes G2
    assert.equal(b.add('y', rep({ ms: 203 })).saved, true);   // starts G3
    for (const step of order) (step === 'arrive' ? w.arrive() : w.fireNext(0));
    w.drain();
    return { record: canonical(w.stored()), a: statusOf(a), b: statusOf(b), aReads: canonical(a.read()), bReads: canonical(b.read()) };
  }, {
    record: { y: [203] },
    a: { missing: 0, removed: 1, error: null },
    b: { missing: 0, removed: 2, error: null },
    aReads: { y: [203] },
    bReads: { y: [203] },
  });
  assert.deepEqual(others, [], 'an order of taking the changes in ended with another record or another account of it');
});

/** A rep of an earlier session on record: made by a page long closed, which no open window will ever put back or
 *  withdraw as its own. */
function seedEarlier(w) {
  const earlier = openPracticeRecord({ storage: w.tabs[0].storage, now: () => 1_700_000_000_000 });
  assert.equal(earlier.add('p', rep({ ms: 1 })).saved, true);
  w.deliver();
}

test('a rep saved from a copy a removal had not reached stays, and the removed reps that write carried back go — in every order, an earlier session\'s too', () => {
  // A window that writes before a removal reaches it writes the removed record back, with its new rep — the case
  // the header used to leave NOT REPAIRED. The removal's event names its generation and every rep it took
  // (`oldValue`, the storage's value, measured), so a window that heard it withdraws them from that record written
  // back, and from a copy of it another window wrote before the withdrawal reached it, and names what is left anew.
  // Withdrawing only a window's OWN removed reps left an earlier session's rep, which no open window owns, back on
  // record in 2 of these 10 orders. The rep saved after the removal stays: no removal held it. The add is placed at
  // every point of every order: 2 orders of two changes, 5 places each.
  const orders = interleavings(2).flatMap((base) => Array.from({ length: base.length + 1 }, (_, at) => [...base.slice(0, at), 'add', ...base.slice(at)]));
  assert.equal(orders.length, 10);
  for (const earlier of [false, true]) {
    const others = endsOtherThan(orders, (order) => {
      const w = windows(2);
      if (earlier) seedEarlier(w);
      const { records: [a, b] } = openAll(w, clockFrom());
      assert.equal(a.add('x', rep({ ms: 101 })).saved, true);
      w.deliver();
      w.tabs[1].storage.removeItem(RECORD_KEY);                  // removes G1
      assert.equal(b.add('y', rep({ ms: 201 })).saved, true);   // starts G2
      for (const step of order) {
        if (step === 'arrive') w.arrive();
        else if (step === 'fire') w.fireNext(0);
        else assert.equal(a.add('x', rep({ ms: 102 })).saved, true, `${order.join(' ')}: the rep after the removal was refused`);
      }
      w.drain();
      return { record: canonical(w.stored()), a: statusOf(a), b: statusOf(b), aReads: canonical(a.read()), bReads: canonical(b.read()) };
    }, {
      record: { x: [102], y: [201] },
      a: { missing: 0, removed: 1, error: null },
      b: QUIET,
      aReads: { x: [102], y: [201] },
      bReads: { x: [102], y: [201] },
    });
    assert.deepEqual(others, [], `${earlier ? 'with' : 'without'} an earlier session's rep: an order ended with another record or another account of it`);
  }
});

test('a removal made in a window\'s own page is unnamed to that window: it puts its own rep back, and no window fights it', () => {
  // A page hears no event of its own change (header, THE COST). B removes the record in its own page while holding a
  // rep of it, and A — which hears the removal — has already written the record back from a copy the removal had not
  // reached. A withdraws what the removal named and names the rest anew; B, which never learns of its removal, puts
  // its rep back into the renamed record, and A leaves it there. Had A kept the removed name, every repair of B's
  // would meet another withdrawal of A's for as long as both windows were open: measured, they never stopped writing.
  const w = windows(2);
  const { records: [a, b] } = openAll(w, clockFrom());
  assert.equal(b.add('y', rep({ ms: 201 })).saved, true);
  w.deliver();
  w.tabs[1].storage.removeItem(RECORD_KEY);
  assert.equal(a.add('x', rep({ ms: 102 })).saved, true);  // from a copy that still holds the removed record
  w.drain();                                                // throws when the windows never stop writing
  assert.deepEqual(canonical(w.stored()), { x: [102], y: [201] }, 'the cost is no longer what the header says');
  assert.deepEqual([statusOf(a), statusOf(b)], [QUIET, QUIET]);
});

test('the price of naming: a removed record written back by hand is emptied again by every window that heard the removal, while it is open', () => {
  // The removed record written back under its own name is just what a window whose copy still held it writes, so a
  // window that heard the removal cannot tell the two apart (header, THE COST). Every rep the removal named goes —
  // this window's, another window's, an earlier session's — and what is written after it stays.
  const w = windows(3);
  seedEarlier(w);
  const { records: [a, b, c] } = openAll(w, clockFrom());
  assert.equal(a.add('x', rep({ ms: 111 })).saved, true);
  w.deliver();
  assert.equal(b.add('y', rep({ ms: 222 })).saved, true);
  w.deliver();
  const removed = w.raw();
  w.tabs[2].storage.removeItem(RECORD_KEY);
  w.deliver();
  const heard = { missing: 0, removed: 1, error: null };
  assert.deepEqual([statusOf(a), statusOf(b)], [heard, heard], 'precondition: the removal was heard');
  w.tabs[2].storage.setItem(RECORD_KEY, removed);
  w.deliver();
  assert.deepEqual(canonical(w.stored()), {}, 'a removed rep written back stayed on record');
  assert.notEqual(JSON.parse(w.raw()).gen, JSON.parse(removed).gen, 'what is left of a removed record written back kept its name');
  assert.equal(c.add('z', rep({ ms: 333 })).saved, true);
  w.deliver();
  assert.deepEqual(canonical(w.stored()), { z: [333] });
  assert.deepEqual([statusOf(a), statusOf(b), statusOf(c)], [heard, heard, QUIET]);
});

test('random runs of three windows: every rep saved after the last removal stays, no rep a removal named comes back unless the page that removed it made it, and no window writes forever', () => {
  // The header's claims over 1,500 seeded runs — adds, removals, `clear()`s, and changes taken in and heard in any
  // order — beside every order of the cases above. Measured over 80,000 runs of three and four windows on
  // 2026-10-18. The seeds are fixed, so a failure names its run.
  let state = 0;
  const rnd = () => { state = (state * 1103515245 + 12345) >>> 0; return state / 2 ** 32; };
  const pick = (n) => Math.floor(rnd() * n);
  const msIn = (text) => new Set(text === null ? [] : [...parseRecord(text).values()].flat().map((r) => r.ms));
  const failures = [];
  for (let run = 1; run <= 1_500; run += 1) {
    state = run;
    const w = windows(3);
    if (run % 2) seedEarlier(w);
    let t = 1_760_000_000_000;
    const { records } = openAll(w, () => { t += 1 + pick(3); return t; });
    const owner = new Map();     // ms -> the window that made the rep
    const saved = [];            // { ms, at }: the storage change that saved it
    const removals = [];         // { at, by, held, named }
    let ms = 100;
    const steps = [];
    try {
      for (let s = 8 + pick(20); s > 0; s -= 1) {
        const r = rnd();
        const i = pick(3);
        if (r < 0.40) {
          ms += 1;
          steps.push(`add${i}`);
          if (records[i].add(rnd() < 0.5 ? 'x' : 'y', rep({ ms })).saved) { owner.set(ms, i); saved.push({ ms, at: w.changes() }); }
        } else if (r < 0.48) {
          steps.push(`remove${i}`);
          const held = w.raw();
          w.tabs[i].storage.removeItem(RECORD_KEY);
          removals.push({ at: w.changes(), by: i, held: msIn(held), named: held !== null });
        } else if (r < 0.52) {
          steps.push(`clear${i}`);
          w.tabs[i].storage.clear();
          removals.push({ at: w.changes(), by: i, held: new Set(), named: false });
        } else if (r < 0.76) {
          if (w.waiting()) { steps.push('arrive'); w.arrive(); }
        } else if (w.pending(i)) {
          steps.push(`hear${i}`);
          w.fireNext(i);
        }
      }
      w.drain();
    } catch (e) {
      failures.push(`run ${run} [${steps.join(' ')}]: ${e.message}`);
      continue;
    }
    const final = msIn(w.raw());
    for (const { by, held, named } of removals) {
      for (const m of held) if (named && final.has(m) && owner.get(m) !== by) failures.push(`run ${run} [${steps.join(' ')}]: rep ${m} came back after window ${by} removed it`);
    }
    const last = Math.max(0, ...removals.map((x) => x.at));
    for (const { ms: m, at } of saved) if (at > last && !final.has(m)) failures.push(`run ${run} [${steps.join(' ')}]: rep ${m}, saved after the last removal, was lost`);
    records.forEach((rec, i) => {
      const st = statusOf(rec);
      if (st.missing || st.error) failures.push(`run ${run} [${steps.join(' ')}]: window ${i} ends with ${JSON.stringify(st)}`);
    });
  }
  assert.deepEqual(failures.slice(0, 5), []);
});

test('row 10: a record removed where no event says so stays removed — after an add here, or a record another instance started', () => {
  // In this window: a removal here fires no event here.
  const w = windows(1);
  const { records: [a] } = openAll(w, clockFrom());
  assert.equal(a.add('x', rep({ ms: 111 })).saved, true);
  const removedGen = JSON.parse(w.raw()).gen;
  w.tabs[0].storage.removeItem(RECORD_KEY);
  assert.equal(a.read().size, 0);
  assert.equal(a.add('x', rep({ ms: 222 })).saved, true);
  assert.deepEqual(msOf(w.stored()), { x: [222] }, 'the removed history came back');
  assert.deepEqual(statusOf(a), { missing: 0, removed: 1, error: null });
  assert.notEqual(JSON.parse(w.raw()).gen, removedGen, 'a record started again kept the removed one\'s generation');
  // Codex's round-3 verify, item 1: the record read empty here, a fresh instance started another, and this one's
  // next add put the removed history back into it.
  const storage = fakeStorage();
  const clock = clockFrom();
  const c = openPracticeRecord({ storage, now: clock });
  assert.equal(c.add('x', rep({ ms: 111 })).saved, true);
  storage.removeItem(RECORD_KEY);
  assert.equal(c.read().size, 0);
  assert.equal(openPracticeRecord({ storage, now: clock }).add('y', rep({ ms: 222 })).saved, true);
  assert.equal(c.add('x', rep({ ms: 333 })).saved, true);
  assert.deepEqual(msOf(parseRecord(storage.raw())), { y: [222], x: [333] }, 'the removed history came back');
  assert.deepEqual(statusOf(c), { missing: 0, removed: 1, error: null });
  // In another window, with no `changes` at all.
  const v = windows(2);
  const d = openPracticeRecord({ storage: v.tabs[0].storage, now: clock });
  assert.equal(d.add('x', rep({ ms: 111 })).saved, true);
  v.deliver();
  v.tabs[1].storage.removeItem(RECORD_KEY);
  v.deliver();
  assert.equal(d.add('x', rep({ ms: 222 })).saved, true);
  assert.deepEqual(msOf(v.stored()), { x: [222] }, 'another window\'s removal was undone');
  assert.deepEqual(statusOf(d), { missing: 0, removed: 1, error: null });
});

test('the first-rep race: two windows that each start a record in the same gap both keep their reps — whichever write lands last', () => {
  // Before: a record started where none was stored is another generation, and any other generation was taken
  // for a removal, so the window whose write landed first lost its rep — counted in `removed`, which no screen
  // shows: silent. Measured in both engines, every crossed pair from an empty record lost one (165 of 165). A
  // window now drops a rep only when a removal names it or its own look finds no record; another record standing in
  // its place is the race, and the reps go into it by id. Both orders of landing, and a same-algorithm pair.
  for (const [what, ids, last] of [['b lands last', ['x', 'y'], 1], ['a lands last', ['x', 'y'], 0], ['one algorithm', ['x', 'x'], 1]]) {
    const w = windows(2);
    const { records, heard } = openAll(w, clockFrom());
    const order = last === 1 ? [0, 1] : [1, 0];
    for (const i of order) assert.equal(records[i].add(ids[i], rep({ ms: 111 * (i + 1) })).saved, true, `${what}: precondition`);
    assert.equal(w.stored().size, 1, `${what}: precondition: the later write stands alone`);
    w.deliver();
    const kept = [...w.stored().values()].flat().map((r) => r.ms).sort((p, q) => p - q);
    assert.deepEqual(kept, [111, 222], `${what}: a rep of the first-rep race was lost`);
    assert.deepEqual(records.map(statusOf), [QUIET, QUIET], `${what}: a rep of the race was counted removed`);
    assert.deepEqual(msOf(records[0].read()), msOf(records[1].read()));
    assert.ok(heard[0].length && heard[1].length);
  }
});

test('a wipe of every key, whose event names nothing, is seen at the look its event brings — and when another window has started a record first, or wrote before the wipe reached it, the wiped reps come back rather than any being lost', () => {
  // `clear()` from another window, Chromium's DevTools clear-all and its "Clear site data": an event with no key
  // and no `oldValue` (measured in both engines, 2026-10-18), and the window reads no record when it runs.
  const w = windows(2);
  const { records: [a, b] } = openAll(w, clockFrom());
  assert.equal(a.add('x', rep({ ms: 111 })).saved, true);
  w.deliver();
  w.tabs[1].storage.clear();
  w.deliver();
  assert.deepEqual(statusOf(a), { missing: 0, removed: 1, error: null }, 'a wipe this window looked at was not seen');
  assert.equal(b.add('y', rep({ ms: 222 })).saved, true);
  w.deliver();
  assert.deepEqual(msOf(w.stored()), { y: [222] }, 'a wiped rep came back');
  // THE COST (header): this window's handler runs only after another window has started a record — a busy thread —
  // so its first look finds a record, and nothing named the one wiped.
  const v = windows(2);
  const { records: [c, d] } = openAll(v, clockFrom());
  assert.equal(c.add('x', rep({ ms: 111 })).saved, true);
  v.deliver();
  v.tabs[1].storage.clear();
  assert.equal(d.add('y', rep({ ms: 222 })).saved, true);
  v.deliver({ events: false });
  v.fire();
  assert.deepEqual(msOf(v.stored()), { y: [222], x: [111] }, 'the cost is no longer what the header says');
  assert.deepEqual(statusOf(c), QUIET);
  // And a window that wrote before the wipe reached it wrote the wiped record back: nothing names what was wiped,
  // so another window's wiped rep stays, beside the rep saved after the wipe.
  const u = windows(2);
  const { records: [e, f] } = openAll(u, clockFrom());
  assert.equal(f.add('y', rep({ ms: 111 })).saved, true);
  u.deliver();
  u.tabs[1].storage.clear();
  assert.equal(e.add('x', rep({ ms: 222 })).saved, true);   // from a copy that still holds the wiped record
  u.drain();
  assert.deepEqual(msOf(u.stored()), { y: [111], x: [222] }, 'the cost is no longer what the header says');
  assert.deepEqual([statusOf(e), statusOf(f)], [QUIET, QUIET]);
});

test('row 11: a record another window made unreadable is said at once, and said no more once it reads again', () => {
  const w = windows(2);
  const { records: [a], heard } = openAll(w, clockFrom());
  assert.equal(a.add('x', rep({ ms: 111 })).saved, true);
  w.deliver();
  const good = w.raw();
  w.tabs[1].storage.setItem(RECORD_KEY, '{not json');
  w.deliver();
  assert.deepEqual(heard[0], [{ missing: 0, removed: 0, error: 'not-json' }], 'a write that made the record unreadable was not passed on');
  assert.throws(() => a.read(), (e) => e.code === 'not-json');
  // Nothing is written over it, by the look or by the next add.
  const out = a.add('x', rep());
  assert.deepEqual([out.saved, out.error?.code, w.raw()], [false, 'not-json', '{not json']);
  // Readable again: the next look says so.
  w.tabs[1].storage.setItem(RECORD_KEY, good);
  w.deliver();
  assert.deepEqual(heard[0].at(-1), QUIET, 'trouble that ended is still said');
  assert.deepEqual(msOf(a.read()), { x: [111] });
});

test('row 12: a rep that could not be put back is a state, and the look that puts it back clears it — at an event, or at the next add', () => {
  const w = windows(2);
  const { records: [a, b], heard } = openAll(w, clockFrom());
  assert.equal(a.add('x', rep({ ms: 111 })).saved, true);
  w.deliver();
  const crossed = (mine, theirs) => {
    assert.equal(a.add('x', rep({ ms: mine })).saved, true);
    assert.equal(b.add('y', rep({ ms: theirs })).saved, true);   // from a copy without `mine`
  };
  // Crossed while this window cannot write: said missing, with why.
  crossed(222, 333);
  w.tabs[0].storage.refuse = true;
  w.deliver();
  assert.deepEqual(heard[0].at(-1), { missing: 1, removed: 0, error: 'write-failed' });
  assert.deepEqual(msOf(w.stored()), { x: [111], y: [333] });
  // It can write again, and the other window's next write brings a look: put back, and no longer said.
  w.tabs[0].storage.refuse = false;
  assert.equal(b.add('y', rep({ ms: 444 })).saved, true);
  w.deliver();
  assert.deepEqual(heard[0].at(-1), QUIET, 'a rep put back is still said to be missing');
  assert.deepEqual(msOf(w.stored()), { x: [111, 222], y: [333, 444] });
  // Again, and this time the next add is the look that puts it back.
  crossed(555, 666);
  w.tabs[0].storage.refuse = true;
  w.deliver();
  assert.deepEqual(statusOf(a), { missing: 1, removed: 0, error: 'write-failed' });
  w.tabs[0].storage.refuse = false;
  assert.equal(a.add('x', rep({ ms: 777 })).saved, true);
  assert.deepEqual(statusOf(a), QUIET);
  assert.deepEqual(msOf(w.stored()), { x: [111, 222, 555, 777], y: [333, 444, 666] });
});

test('a read does not clear why a rep is still missing: only the look that puts it back does, or one that finds no record', () => {
  const w = windows(2);
  const { records: [a, b] } = openAll(w, clockFrom());
  assert.equal(a.add('x', rep({ ms: 111 })).saved, true);
  w.deliver();
  assert.equal(a.add('x', rep({ ms: 222 })).saved, true);
  assert.equal(b.add('y', rep({ ms: 333 })).saved, true);
  w.tabs[0].storage.refuse = true;
  w.deliver();
  assert.deepEqual(statusOf(a), { missing: 1, removed: 0, error: 'write-failed' }, 'precondition');
  a.read();
  assert.deepEqual(statusOf(a), { missing: 1, removed: 0, error: 'write-failed' }, 'a read cleared why a rep is still missing');
  // The record removed, its event not yet run: the read that finds it gone has nothing left to put back.
  w.tabs[1].storage.removeItem(RECORD_KEY);
  w.deliver({ events: false });
  a.read();
  assert.deepEqual(statusOf(a), { missing: 0, removed: 2, error: null }, 'a record gone still had a rep missing from it');
});

test('row 13: a rep the caps would drop anyway is neither put back nor called missing', () => {
  const w = windows(2);
  const { records: [a], heard } = openAll(w, () => 5_000);
  assert.equal(a.add('x', rep({ ms: 111 })).saved, true);
  w.deliver();
  const gen = JSON.parse(w.raw()).gen;
  // The per-algorithm cap: another window's write in this generation holds a hundred newer reps of x — and a
  // rep of y in this rep's millisecond, which no longer matters.
  const newer = Array.from({ length: PER_ALG_CAP }, (_, k) => ({ ...GOOD, i: rid(k, 'b'), t: 6_000 + k }));
  const text = recordText({ x: newer, y: [{ ...GOOD, i: rid(PER_ALG_CAP, 'b'), t: 5_000 }] }, { gen });
  const writes = w.tabs[0].storage.writes;
  w.tabs[1].storage.setItem(RECORD_KEY, text);
  w.deliver();
  assert.deepEqual(heard[0].at(-1), QUIET, 'a rep the per-algorithm cap drops was called missing');
  assert.deepEqual([w.raw(), w.tabs[0].storage.writes], [text, writes], 'a rep the per-algorithm cap drops was written back');
  // The overall cap: a record full of newer reps of other algorithms.
  const full = storedText(Array.from({ length: TOTAL_CAP / PER_ALG_CAP }, (_, i) => [`alg-${i}`, PER_ALG_CAP]), { gen, from: 7_000, page: 'c' });
  w.tabs[1].storage.setItem(RECORD_KEY, full);
  w.deliver();
  assert.deepEqual(heard[0].at(-1), QUIET, 'a rep the overall cap drops was called missing');
  assert.deepEqual([w.raw(), w.tabs[0].storage.writes], [full, writes], 'a rep the overall cap drops was written back');
});

test('crossed writes, put back and capped, keep what the same two writes one after the other keep', () => {
  // A record one short of the overall cap, seen by both windows; each adds a rep before hearing of the other's.
  // One after the other, the second write drops the oldest rep of all; crossed and put back, the same.
  const base = JSON.parse(recordText({ old: [{ ...GOOD, i: rid(0, 'd'), t: 10, ms: 1 }] }));
  const u = fillTo(base, TOTAL_CAP - 1, 100);
  const w = windows(2);
  w.tabs[0].storage.setItem(RECORD_KEY, JSON.stringify(base));
  w.deliver();
  const clock = clockFrom(u);
  const { records: [a, b] } = openAll(w, clock);
  assert.equal(a.add('x', rep({ ms: 111 })).saved, true);
  assert.equal(b.add('y', rep({ ms: 222 })).saved, true);
  w.deliver();
  const crossed = w.stored();
  const serial = fakeStorage(JSON.stringify(base));
  const one = openPracticeRecord({ storage: serial, now: clockFrom(u) });
  one.add('x', rep({ ms: 111 }));
  one.add('y', rep({ ms: 222 }));
  assert.deepEqual(msOf(crossed), msOf(parseRecord(serial.raw())));
  assert.equal(crossed.has('old'), false, 'the oldest rep of all was kept');
  assert.deepEqual([statusOf(a), statusOf(b)], [QUIET, QUIET]);
});

test('watching another window needs somewhere to say so', () => {
  assert.throws(() => openPracticeRecord({ storage: fakeStorage(), now: Date.now, changes: new EventTarget() }), /onChange/);
  // And stops at the signal: after it, another window's write is not looked at.
  const w = windows(2);
  const stop = new AbortController();
  let heard = 0;
  openPracticeRecord({ storage: w.tabs[0].storage, now: clockFrom(), changes: w.tabs[0].events, signal: stop.signal, onChange: () => { heard += 1; } });
  stop.abort();
  w.tabs[1].storage.setItem(RECORD_KEY, '{not json');
  w.deliver();
  assert.equal(heard, 0);
});
