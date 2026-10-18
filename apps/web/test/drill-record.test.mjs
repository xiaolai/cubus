// The practice record (`lib/drill/record.js`) — dev-docs/algorithm-drill-v2-plan.md §5, work item WI-11.
//
// What must NOT happen is most of this file: an untimed rep must never move a best or a median; a refused
// record must never be written over; a write that failed must never read as saved; a lost turn must never
// count as the child's mistake; two windows saving at once must never lose or refuse a rep; and the old
// localStorage record must never be deleted unread, nor any of its reps put in twice. The adapter from the engine
// is checked against REAL engine runs, driven with the reports a cube makes (the same shape of harness as
// test/drill-engine.test.mjs), never against a hand-built `done` event that could drift from what the engine emits.
//
// The record runs here over a store in memory with IndexedDB's contract (test/fixtures/memory-store.mjs);
// test/browser/practice-record.test.mjs runs it over IndexedDB itself, in both engines.
import assert from 'node:assert/strict';
import test from 'node:test';

import { SOLVED, applyAlg, toFacelets } from '../lib/cube-pieces.js';
import { createDrillEngine } from '../lib/drill/engine.js';
import {
  PER_ALG_CAP, PracticeRecordError, RECORD_KEY, RECORD_VERSION, TOTAL_CAP,
  openPracticeRecord, repFromDone, statsOf, watchReps,
} from '../lib/drill/record.js';
import { TIME_REFUSAL } from '../lib/drill/timing.js';
import { memoryDatabase, memoryStore } from './fixtures/memory-store.mjs';

// ---- fakes: a database, the old localStorage record, a clock --------------------------------------------

const clockFrom = (t0 = 1_760_000_000_000, step = 1000) => {
  let t = t0;
  return () => { t += step; return t; };
};

/** A record over its own window's store on `db`, and the store, with `onChange` counted unless given. */
function open({ db = memoryDatabase(), now = clockFrom(), onChange, ...rest } = {}) {
  const store = memoryStore(db);
  const heard = { changes: 0 };
  const record = openPracticeRecord({ store, now, onChange: onChange ?? (() => { heard.changes += 1; }), ...rest });
  return { record, store, db, heard };
}

/** localStorage as far as the record uses it: the old record under its key, and a read that throws as a real one
 *  can. It has no `removeItem`, so a record that tried to delete the old record would throw: it never may (header). */
function fakeLocal(text, { readThrows = false } = {}) {
  const map = new Map(text === null ? [] : [[RECORD_KEY, text]]);
  return {
    readThrows,
    getItem(k) {
      if (this.readThrows) throw Object.assign(new Error('the read was refused'), { name: 'SecurityError' });
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) { map.set(k, String(v)); },
    raw: () => (map.has(RECORD_KEY) ? map.get(RECORD_KEY) : null),
  };
}

/** A rep as `repFromDone` makes them. */
const rep = ({ clean = true, lostTurn = false, ms = 1000, refused = null, turns, pauses = 0, htm = 7 } = {}) => ({
  clean, lostTurn, ms, refused, turns: turns === undefined ? (ms !== null && clean ? htm - 1 : null) : turns, pauses, htm,
});

/** Each algorithm's times, oldest first: what a read says, in a form a test compares. */
const msOf = (algs) => Object.fromEntries([...algs].map(([id, reps]) => [id, reps.map((r) => r.ms)]));

/** A rep id: 24 hex digits, here one repeated digit and then a count. */
const rid = (n, page = 'a') => page.repeat(16) + n.toString(16).padStart(8, '0');

/** A stored rep in short keys. */
const GOOD = Object.freeze({ i: rid(0), s: 1, t: 5, c: true, l: false, ms: 900, r: null, n: 6, p: 0, h: 7 });

/** A stored value holding `n` reps per algorithm, oldest first, a millisecond apart from `from` and saved in that
 *  order. */
function stored(perAlg, { from = 1_000_000, page = 'a', shape = {} } = {}) {
  let t = from;
  let k = 0;
  const algs = {};
  for (const [id, n] of perAlg) {
    algs[id] = Array.from({ length: n }, () => ({ ...GOOD, i: rid(k, page), s: (k += 1), t: (t += 1), ...shape }));
  }
  return { v: RECORD_VERSION, algs };
}

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

test('a real engine run goes through watchReps and add, and reads back as the engine reported it', async () => {
  const { record } = open();
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
  for (const { rep: r } of d.reps) assert.equal((await record.add('test-sexy', r)).saved, true);

  const stored = await record.reps('test-sexy');
  const results = d.reps.map(({ event }) => event.result);
  assert.deepEqual(stored.map((r) => r.ms), results.map((r) => r.ms));
  assert.deepEqual(stored.map((r) => r.refused), results.map((r) => r.refused));
  assert.deepEqual(stored.map((r) => r.htm), [4, 4, 4]);
  assert.deepEqual(stored.map((r) => r.clean), [true, false, false]);
  assert.deepEqual(stored.map((r) => r.lostTurn), [false, false, true]);
  assert.equal(stored[0].turns, results[0].tps.turns, 'a clean timed rep keeps the turns its time spans');
  assert.equal(stored[1].turns, null, 'a rep that left the algorithm keeps no turn count');
  assert.equal(stored[2].refused, TIME_REFUSAL.STREAM_GAP);

  const s = await record.stats('test-sexy');
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

test('an untimed rep never moves the best or the median; nor does a timed rep that was not clean', async () => {
  const { record } = open();
  for (const ms of [1200, 1000, 1400]) assert.equal((await record.add('oll-27', rep({ ms }))).saved, true);
  const before = await record.stats('oll-27');
  assert.deepEqual([before.best, before.median, before.timed], [1000, 1200, 3]);
  // Untimed — every refusal a seven-turn algorithm can carry, a lost turn among them — and one far faster but
  // not clean.
  const untimed = refusedReps(7);
  assert.deepEqual(untimed.map((r) => r.refused).sort(), Object.values(TIME_REFUSAL).filter((r) => r !== TIME_REFUSAL.ONE_TURN).sort());
  for (const r of untimed) assert.equal((await record.add('oll-27', r)).saved, true, r.refused);
  assert.equal((await record.add('oll-27', rep({ ms: 10, clean: false }))).saved, true);
  const after = await record.stats('oll-27');
  assert.deepEqual([after.best, after.median, after.timed], [1000, 1200, 3], 'an untimed or unclean rep moved a time');
  assert.equal(after.reps, 3 + untimed.length + 1);
  // A one-turn algorithm is never timed, and its every rep is refused as one turn — with or without a lost turn.
  const one = refusedReps(1);
  assert.deepEqual(one.map((r) => r.refused), [TIME_REFUSAL.ONE_TURN]);
  assert.equal((await record.add('r2', one[0])).saved, true);
  assert.equal((await record.add('r2', { ...one[0], clean: false, lostTurn: true })).saved, true);
  const r2 = await record.stats('r2');
  assert.deepEqual([r2.timed, r2.judged], [0, 1]);
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

test(`each algorithm keeps its newest ${PER_ALG_CAP} reps`, async () => {
  const { record } = open();
  for (let i = 1; i <= PER_ALG_CAP + 5; i++) assert.equal((await record.add('pll-t', rep({ ms: i }))).saved, true);
  const reps = await record.reps('pll-t');
  assert.equal(reps.length, PER_ALG_CAP);
  assert.deepEqual(reps.map((r) => r.ms), Array.from({ length: PER_ALG_CAP }, (_, i) => i + 6), 'not the newest');
});

test(`the record keeps ${TOTAL_CAP} reps overall, dropping the oldest across every algorithm`, async () => {
  // Fifty algorithms full to the per-algorithm cap: exactly the overall cap. `old` is written first, so its
  // reps are the oldest of all.
  const ids = ['old', ...Array.from({ length: TOTAL_CAP / PER_ALG_CAP - 1 }, (_, i) => `alg-${i}`)];
  const { record } = open({ db: memoryDatabase(stored(ids.map((id) => [id, PER_ALG_CAP]))), now: clockFrom(2_000_000) });
  assert.equal((await record.add('new', rep())).saved, true);
  const all = await record.read();
  const total = [...all.values()].reduce((n, reps) => n + reps.length, 0);
  assert.equal(total, TOTAL_CAP);
  assert.equal(all.get('old').length, PER_ALG_CAP - 1, 'the oldest rep overall was not the one dropped');
  assert.equal(all.get('alg-0').length, PER_ALG_CAP);
  assert.equal(all.get('new').length, 1);
});

// ---- refused, and never overwritten -------------------------------------------------------------------

/** One algorithm's reps as a stored value, with the record's own fields overridden by `top`. */
const one = (reps, top = {}) => ({ v: RECORD_VERSION, algs: { a: reps }, ...top });
const CORRUPT = [
  ['an array', [], 'foreign'],
  ['null', null, 'foreign'],
  ['text', '{"v":3,"algs":{}}', 'foreign'],
  ['another version', one([GOOD], { v: 2 }), 'foreign'],
  ['a version given as text', one([GOOD], { v: '3' }), 'foreign'],
  ['algs not a record', one([GOOD], { algs: [] }), 'foreign'],
  ['an empty rep list', one([]), 'corrupt'],
  ['a rep list that is not a list', one({ 0: GOOD }), 'corrupt'],
  ['a rep that is a string', one(['fast']), 'corrupt'],
  ['a rep with no id', one([{ ...GOOD, i: undefined }]), 'corrupt'],
  ['a rep id that is not 24 hex digits', one([{ ...GOOD, i: 'a'.repeat(23) }]), 'corrupt'],
  ['one id on two reps', { v: RECORD_VERSION, algs: { a: [GOOD], b: [{ ...GOOD, s: 2, t: 6 }] } }, 'corrupt'],
  ['a rep that does not say when it was saved', one([{ ...GOOD, s: undefined }]), 'corrupt'],
  ['a save count that is not a positive whole number', one([{ ...GOOD, s: 1.5 }]), 'corrupt'],
  ['two reps saved as one', { v: RECORD_VERSION, algs: { a: [GOOD], b: [{ ...GOOD, i: rid(1), t: 6 }] } }, 'corrupt'],
  // In one millisecond, so that only the list's own order is broken: its last rep is not its newest.
  ['reps saved out of their list\'s order', one([{ ...GOOD, s: 2 }, { ...GOOD, i: rid(1), s: 1 }]), 'corrupt'],
  ['a rep saved later stamped earlier, across two algorithms', { v: RECORD_VERSION, algs: { a: [{ ...GOOD, t: 9 }], b: [{ ...GOOD, i: rid(1), s: 2, t: 8 }] } }, 'corrupt'],
  ['an empty id', { v: RECORD_VERSION, algs: { '': [GOOD] } }, 'corrupt'],
  ['an id no ledger row could have', { v: RECORD_VERSION, algs: { ['x'.repeat(81)]: [GOOD] } }, 'corrupt'],
  ['timed and refused', one([{ ...GOOD, r: 'one-turn' }]), 'corrupt'],
  ['neither timed nor refused', one([{ ...GOOD, ms: null, n: null }]), 'corrupt'],
  ['an unknown refusal', one([{ ...GOOD, ms: null, n: null, r: 'slow' }]), 'corrupt'],
  ['clean with a lost turn', one([{ ...GOOD, l: true }]), 'corrupt'],
  ['a missing field', one([{ ...GOOD, p: undefined }]), 'corrupt'],
  ['a string time', one([{ ...GOOD, ms: '900' }]), 'corrupt'],
  ['a negative time', one([{ ...GOOD, ms: -1 }]), 'corrupt'],
  ['no time of day', one([{ ...GOOD, t: 0 }]), 'corrupt'],
  ['more turns than the algorithm', one([{ ...GOOD, n: 8 }]), 'corrupt'],
  ['a clean timed rep with no turn count', one([{ ...GOOD, n: null }]), 'corrupt'],
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
  ['a list past the per-algorithm cap', stored([['x', PER_ALG_CAP + 1]]), 'corrupt'],
  ['a record past the overall cap', stored(Array.from({ length: TOTAL_CAP / PER_ALG_CAP + 1 }, (_, i) => [`alg-${i}`, PER_ALG_CAP])), 'corrupt'],
];

test('every shape the engine gives a rep is read back', async () => {
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
  // Two reps in one millisecond, too: the save count orders them, never the time alone.
  const { record } = open({ db: memoryDatabase(one(shapes.map((x, i) => ({ ...x, i: rid(i), s: i + 1, t: 1 + (i >> 1) })))) });
  assert.equal((await record.reps('a')).length, shapes.length);
});

test('a refused record is refused loudly by every read, and no add writes over it', async () => {
  for (const [what, value, code] of CORRUPT) {
    const db = memoryDatabase(value);
    const { record } = open({ db });
    await assert.rejects(record.read(), (e) => e instanceof PracticeRecordError && e.code === code, what);
    await assert.rejects(record.stats('a'), (e) => e.code === code, `${what}: stats read past a refused record`);
    const out = await record.add('a', rep());
    assert.equal(out.saved, false, `${what}: a rep was saved over a refused record`);
    assert.equal(out.error.code, code, what);
    assert.equal(db.writes, 0, `${what}: a write was made`);
    assert.deepEqual(db.value, value, `${what}: the stored value changed`);
  }
});

test('a read that fails is not an empty record: it rejects, the add is refused, and nothing is written', async () => {
  const db = memoryDatabase(stored([['a', 3]]));
  const { record, store } = open({ db });
  store.faults.read = true;
  await assert.rejects(record.read(), (e) => e.code === 'unreadable');
  const out = await record.add('a', rep());
  assert.deepEqual([out.saved, out.error.code, db.writes], [false, 'unreadable', 0]);
  store.faults.read = false;
  assert.equal((await record.reps('a')).length, 3, 'a read that failed once changed what is read');
});

test('a write that does not commit (a full quota) is saved:false with its cause, and nothing is kept', async () => {
  const db = memoryDatabase(stored([['a', 2]]));
  const before = structuredClone(db.value);
  const { record, store } = open({ db, now: clockFrom(2_000_000) });
  store.faults.write = true;
  const out = await record.add('a', rep());
  assert.deepEqual([out.saved, out.error.code, out.error.cause.name], [false, 'write-failed', 'QuotaExceededError']);
  assert.deepEqual(db.value, before, 'a write that failed changed the record');
  assert.equal((await record.reps('a')).length, 2, 'a rep not saved is read back');
  // The quota frees up: the next rep is saved, and the one that failed is not there.
  store.faults.write = false;
  assert.equal((await record.add('a', rep())).saved, true);
  assert.equal((await record.reps('a')).length, 3);
});

test('a clock behind the newest rep on record refuses the rep — of that algorithm or any — and a clock at it does not', async () => {
  // Fifty algorithms full to the per-algorithm cap, stamped 1_000_001 to 1_005_000, and a rep for an algorithm
  // with none yet: checking the clock against that algorithm alone would find nothing to be behind, and the cap
  // would then drop the new rep as the oldest of all — while `add` said it was saved.
  const ids = Array.from({ length: TOTAL_CAP / PER_ALG_CAP }, (_, i) => `alg-${i}`);
  const value = stored(ids.map((id) => [id, PER_ALG_CAP]));
  for (const [when, at] of [['behind every rep', 999_999], ['behind the newest rep only', 1_004_999]]) {
    const db = memoryDatabase(value);
    const out = await open({ db, now: () => at }).record.add('new', rep());
    assert.deepEqual([out.saved, out.error?.code], [false, 'clock-behind'], `${when}: not refused`);
    assert.match(out.error.message, /alg-49/, `${when}: the message does not name the newest rep's algorithm`);
    assert.deepEqual([db.writes, db.value], [0, value], `${when}: the record was written`);
  }
  // At the newest rep's millisecond, or after it: saved, and the rep it says it saved is read back.
  for (const at of [1_005_000, 1_005_001]) {
    const { record } = open({ db: memoryDatabase(value), now: () => at });
    assert.equal((await record.add('new', rep())).saved, true, `at ${at}`);
    assert.equal((await record.reps('new')).length, 1, `at ${at}: said saved, and not kept`);
  }
});

test('reps saved in one millisecond keep the order they were saved in, and the cap drops the first saved first', async () => {
  const db = memoryDatabase();
  const { record } = open({ db, now: () => 10_000 });
  // A clock that has not moved, and two algorithms: each rep is still the newest, by the order of the saves.
  for (const [id, ms] of [['y', 111], ['y', 222], ['x', 333]]) assert.equal((await record.add(id, rep({ ms }))).saved, true, `${id} ${ms}`);
  const saves = Object.values(db.value.algs).flat().sort((a, b) => a.s - b.s).map((r) => [r.t, r.ms]);
  assert.deepEqual(saves, [[10_000, 111], [10_000, 222], [10_000, 333]], 'the save counts are not the order of the saves');
  // Full to the cap with newer reps, then one more: of the three saved in one millisecond, the first goes.
  const full = structuredClone(db.value);
  let s = 3;
  for (let i = 0; s < TOTAL_CAP; i++) {
    const n = Math.min(PER_ALG_CAP, TOTAL_CAP - s);
    full.algs[`fill-${i}`] = Array.from({ length: n }, () => { s += 1; return { ...GOOD, i: rid(s, 'f'), s, t: 20_000 + s }; });
  }
  const later = open({ db: memoryDatabase(full), now: () => 30_000 }).record;
  assert.equal((await later.add('z', rep())).saved, true);
  assert.deepEqual([(await later.reps('y')).map((r) => r.ms), (await later.reps('x')).map((r) => r.ms)], [[222], [333]], 'the cap dropped another rep than the first saved');
});

// ---- two windows, one database ------------------------------------------------------------------------
//
// IndexedDB runs one origin's readwrite transactions on a store one at a time (lib/drill/record-store.js), and
// the store in memory does too. So these are about the record, not the storage: nothing it keeps per window can
// change what another window's save does.

test('two windows saving in the same millisecond both keep their rep, and neither is refused', async () => {
  for (const ids of [['x', 'y'], ['x', 'x']]) {
    const db = memoryDatabase(stored([['seed', 1]]));
    const [a, b] = [open({ db, now: () => 2_000_000 }).record, open({ db, now: () => 2_000_000 }).record];
    const outs = await Promise.all([a.add(ids[0], rep({ ms: 1 })), b.add(ids[1], rep({ ms: 2 })), a.add(ids[0], rep({ ms: 3 })), b.add(ids[1], rep({ ms: 4 }))]);
    assert.deepEqual(outs.map((o) => o.saved), [true, true, true, true], `${ids}: refused ${JSON.stringify(outs.map((o) => o.error?.code))}`);
    const all = Object.values(db.value.algs).flat().filter((r) => r.ms < 10).sort((p, q) => p.s - q.s);
    assert.deepEqual(all.map((r) => r.ms).sort(), [1, 2, 3, 4], `${ids}: a rep was lost`);
  }
});

test('Codex\'s verify of 669c81d2: a read that saw no record has no consequence — every order of two windows\' reads and saves ends with both reps', async () => {
  // Before: a window whose copy of localStorage read EMPTY took its own surviving rep for removed, and then withdrew
  // it from the record (record.js:511 → 492 → 484 → 554), leaving {z} where {x, z} was saved. Now a read is a readonly
  // transaction and a window keeps nothing between operations, so no read can take anything away. Every
  // interleaving of window B's [add x, read, read] with window A's [read, add z, read] — A's first read seeing no
  // record whenever it runs before x is saved — started all at once and one after the other.
  const B = [(w) => w.add('x', rep({ ms: 1 })), (w) => w.read(), (w) => w.read()];
  const A = [(w) => w.read(), (w) => w.add('z', rep({ ms: 2 })), (w) => w.read()];
  const orders = [];
  const weave = (i, j, path) => {
    if (i === B.length && j === A.length) { orders.push(path); return; }
    if (i < B.length) weave(i + 1, j, [...path, 'B']);
    if (j < A.length) weave(i, j + 1, [...path, 'A']);
  };
  weave(0, 0, []);
  assert.equal(orders.length, 20);
  let sawEmpty = 0;
  for (const order of orders) {
    for (const together of [true, false]) {
      const db = memoryDatabase();
      const w = { A: open({ db }).record, B: open({ db }).record };
      const next = { A: 0, B: 0 };
      const ops = order.map((who) => () => (who === 'A' ? A : B)[next[who]++](w[who]).then((out) => ({ who, out })));
      const outs = together ? await Promise.all(ops.map((op) => op())) : await ops.reduce((p, op) => p.then(async (acc) => [...acc, await op()]), Promise.resolve([]));
      const firstRead = outs.find(({ who, out }) => who === 'A' && out instanceof Map);
      if (firstRead.out.size === 0) sawEmpty += 1;
      for (const { out } of outs) if (!(out instanceof Map)) assert.equal(out.saved, true, `${order} ${together}: refused`);
      assert.deepEqual(Object.keys(db.value.algs).sort(), ['x', 'z'], `${order.join('')} ${together ? 'at once' : 'in turn'}: a rep was lost`);
      assert.equal(db.writes, 2, `${order.join('')}: a read wrote`);
    }
  }
  assert.ok(sawEmpty >= 10, `precondition: A's first read saw no record in only ${sawEmpty} runs`);
});

test('random runs of four windows saving and reading at once: every rep said saved is on record, none refused, none twice', async () => {
  let seed = 20261018;
  const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 2 ** 32; };
  for (let run = 0; run < 60; run++) {
    const db = memoryDatabase();
    // One clock for every window, standing still for a few calls at a time: saves in one millisecond, as two
    // windows on one machine make them.
    let calls = 0;
    const now = () => 1_000_000 + Math.floor(calls++ / 3);
    const windows = Array.from({ length: 4 }, () => open({ db, now }).record);
    const ops = [];
    let made = 0;
    for (let k = 0; k < 24; k++) {
      const w = windows[Math.floor(rnd() * windows.length)];
      const id = ['a', 'b', 'c'][Math.floor(rnd() * 3)];
      ops.push(rnd() < 0.7 ? w.add(id, rep({ ms: ++made })) : w.read());
      if (rnd() < 0.3) await new Promise((resolve) => setImmediate(resolve));
    }
    const outs = await Promise.all(ops);
    const said = outs.filter((o) => !(o instanceof Map));
    assert.ok(said.every((o) => o.saved), `run ${run}: refused ${JSON.stringify(said.filter((o) => !o.saved).map((o) => o.error.code))}`);
    const kept = Object.values(db.value?.algs ?? {}).flat().map((r) => r.ms).sort((p, q) => p - q);
    assert.deepEqual(kept, Array.from({ length: made }, (_, i) => i + 1), `run ${run}: the reps on record are not the reps saved`);
    assert.equal(db.writes, made, `run ${run}: a read wrote`);
  }
});

test('one record\'s operations run in the order asked for, after its one import: a read asked for after an add sees it', async () => {
  const db = memoryDatabase();
  const store = memoryStore(db);
  let updates = 0;
  const update = store.update;
  store.update = (fn) => { updates += 1; return update(fn); };
  const record = openPracticeRecord({ store, now: clockFrom(), onChange() {}, legacy: fakeLocal(V1) });
  // Nothing awaited: the import, a save and a read are all asked for before any has begun.
  const saving = record.add('a', rep({ ms: 7 }));
  const seen = await record.read();
  assert.deepEqual(msOf(seen), { ...V1_MS, a: [7] });
  assert.equal((await saving).saved, true);
  assert.equal(updates, 2, `the old record was imported ${updates - 1} times`);
});

test('another window\'s committed write is heard through the channel; this window\'s own save is not, and a refused one is never announced', async () => {
  const db = memoryDatabase();
  const ctl = new AbortController();
  let heardB;
  const bHeard = new Promise((resolve) => { heardB = resolve; });
  const LIVENESS_MS = 20_000;
  const a = open({ db, broadcast: BroadcastChannel, signal: ctl.signal });
  const b = open({ db, broadcast: BroadcastChannel, signal: ctl.signal, onChange: () => heardB() });
  try {
    assert.equal((await a.record.add('x', rep())).saved, true);
    const bound = new Promise((resolve) => { setTimeout(resolve, LIVENESS_MS).unref(); });
    assert.equal(await Promise.race([bHeard.then(() => 'heard'), bound.then(() => 'not heard')]), 'heard', 'B was not told of A\'s write');
    assert.deepEqual((await b.record.reps('x')).length, 1, 'B heard before the write it heard of could be read');
    assert.equal(a.heard.changes, 0, 'a window was told of its own save');
  } finally {
    ctl.abort();
  }
  // A refused save, a failed one and a saved one, each announced or not — counted on the channel itself.
  const posts = [];
  class Spy { constructor(name) { this.name = name; } postMessage(m) { posts.push([this.name, m]); } close() { this.closed = true; } }
  const spied = open({ db: memoryDatabase(stored([['a', 1]], { from: 5_000_000 })), now: () => 1, broadcast: Spy });
  assert.equal((await spied.record.add('a', rep())).error.code, 'clock-behind');
  const t = open({ db: memoryDatabase(), broadcast: Spy });
  t.store.faults.write = true;
  assert.equal((await t.record.add('a', rep())).error.code, 'write-failed');
  assert.deepEqual(posts, [], 'a rep that was not saved was announced');
  t.store.faults.write = false;
  assert.equal((await t.record.add('a', rep())).saved, true);
  assert.deepEqual(posts, [['cubusPracticeRecord', 'written']]);
});

test('Codex\'s audit of 6e61bf60: a page that goes keeps every save already asked for — the store closes only once they have settled', async () => {
  // Before: the signal closed the store at once, so a finished rep's save queued behind a read came back
  // `saved: false` (`closed`) and was never written — a rep the child made, dropped because they tapped Back.
  const db = memoryDatabase();
  const ctl = new AbortController();
  const posts = [];
  const channels = [];
  class Spy { constructor() { channels.push(this); } postMessage(m) { posts.push(m); } close() { this.closed = true; } }
  const { record, store, heard } = open({ db, broadcast: Spy, signal: ctl.signal });
  const reading = record.read();
  const saving = record.add('x', rep({ ms: 1 }));
  const savingMore = record.add('x', rep({ ms: 2 }));
  ctl.abort();
  // Asked for while the page is going: run too, before the store closes.
  const late = record.add('x', rep({ ms: 3 }));
  assert.deepEqual(await reading, new Map());
  for (const out of [await saving, await savingMore, await late]) assert.equal(out.saved, true);
  assert.deepEqual(db.value.algs.x.map((r) => r.ms), [1, 2, 3], 'a save asked for before the page went was not kept');
  // Other windows are told of those writes; this page, gone, is told of nothing.
  assert.deepEqual(posts, ['written', 'written', 'written']);
  await new Promise((resolve) => { setImmediate(resolve); });
  assert.deepEqual([store.closed, channels[0].closed], [1, true], 'the store or the channel was left open');
  channels[0].onmessage?.();
  store.lose('closed');
  assert.equal(heard.changes, 0, 'a record whose page has gone said something');
  // Asked for after the store has closed: settled at once and said, never left waiting.
  assert.deepEqual([(await record.add('x', rep())).error?.code], ['closed']);
  await assert.rejects(record.read(), (e) => e.code === 'closed');
  // Opened under a signal already aborted: the import is tried, and then it closes.
  const gone = open({ broadcast: Spy, signal: ctl.signal, legacy: fakeLocal(V1) });
  await gone.record.ready;
  await new Promise((resolve) => { setImmediate(resolve); });
  assert.deepEqual([gone.store.closed, channels[1].closed, Object.keys(gone.db.value.algs).length], [1, true, 3]);
});

// ---- the database out of reach: a state, said and cleared ---------------------------------------------

test('a database out of reach is a state: said once through onChange, every operation fails with it, and the next one that reaches it clears it', async () => {
  for (const code of ['unavailable', 'blocked', 'closed']) {
    const db = memoryDatabase(stored([['a', 1]]));
    const { record, store, heard } = open({ db, now: clockFrom(2_000_000) });
    store.faults.open = code;
    await assert.rejects(record.read(), (e) => e.code === code, code);
    const out = await record.add('a', rep());
    assert.deepEqual([out.saved, out.error.code, db.writes], [false, code, 0], code);
    assert.equal(record.status().error.code, code);
    assert.equal(heard.changes, 1, `${code}: said ${heard.changes} times`);
    store.faults.open = null;
    assert.equal((await record.add('a', rep())).saved, true, code);
    assert.deepEqual([record.status().error, heard.changes], [null, 2], `${code}: not cleared, or the clearing was not said`);
  }
  // A connection lost between operations (a versionchange, the browser closing it): said at once.
  const { record, store, heard } = open();
  store.lose('closed');
  assert.deepEqual([record.status().error.code, heard.changes], ['closed', 1]);
  assert.deepEqual(await record.read(), new Map());
  assert.deepEqual([record.status().error, heard.changes], [null, 2]);
});

// ---- the old localStorage record is imported at every open, and never deleted ----------------------------
//
// Versions 1 and 2 lived in localStorage. A valid one is put into the database in one transaction, as a union by
// rep id, and its key is left as it is; one invalid as both versions is left as it is too, and said.

/** A rep as version 1 stored it — no id — and a version-1 record. */
const V1_REP = Object.freeze({ t: 5, c: true, l: false, ms: 900, r: null, n: 6, p: 0, h: 7 });
const v1Text = (algs) => JSON.stringify({ v: 1, algs });
/** A version-1 record as this branch's earliest commits wrote one: three algorithms, every shape of rep, and a tie
 *  in one millisecond INSIDE one algorithm, which version 1 kept in its list's order. */
const V1 = v1Text({
  'oll-27': [{ ...V1_REP, t: 1_000 }, { ...V1_REP, t: 3_000, ms: 800 }, { ...V1_REP, t: 3_000, ms: 700, c: false, n: null, p: 2 }],
  'pll-t': [{ ...V1_REP, t: 2_000, c: false, l: true, ms: null, n: null, r: 'stream-gap' }, { ...V1_REP, t: 4_000, ms: null, n: null, r: 'no-cube-clock' }],
  r2: [{ ...V1_REP, t: 5_000, h: 1, ms: null, n: null, r: 'one-turn' }],
});
const V1_MS = { 'oll-27': [900, 800, 700], 'pll-t': [null, null], r2: [null] };
/** A version-2 record: ids drawn by a page, and a generation. */
const V2 = JSON.stringify({
  v: 2,
  gen: '1'.repeat(16),
  algs: {
    x: [{ ...V1_REP, i: rid(0, 'b'), t: 1_000 }, { ...V1_REP, i: rid(2, 'b'), t: 3_000, ms: 600 }],
    y: [{ ...V1_REP, i: rid(1, 'b'), t: 2_000, ms: 700 }, { ...V1_REP, i: rid(0, 'c'), t: 3_000, ms: 500 }],
  },
});

test('a version-1 record is imported whole, in its order, with ids from each rep itself — and its key left as it is', async () => {
  const local = fakeLocal(V1);
  const db = memoryDatabase();
  const { record, heard } = open({ db, legacy: local });
  await record.ready;
  const now = await record.read();
  assert.deepEqual(msOf(now), V1_MS, 'a rep was lost, changed or moved');
  // An id from the rep's time and its place among its algorithm's reps at that time — the tie inside oll-27 in
  // its list's order.
  assert.deepEqual(now.get('oll-27').map((r) => r.repId), ['00000000000000000003e800', '0000000000000000000bb800', '0000000000000000000bb801']);
  assert.equal(statsOf(now.get('oll-27')).median, 850, 'the import moved a figure');
  const order = Object.entries(db.value.algs).flatMap(([id, reps]) => reps.map((r) => [r.s, id, r.t])).sort((a, b) => a[0] - b[0]);
  assert.deepEqual(order.map(([, id, t]) => `${id}@${t}`), ['oll-27@1000', 'pll-t@2000', 'oll-27@3000', 'oll-27@3000', 'pll-t@4000', 'r2@5000']);
  assert.deepEqual([local.raw(), db.writes, record.status().legacy, heard.changes], [V1, 1, null, 0]);
  // And the practice after it is saved beside the old reps.
  assert.equal((await record.add('pll-t', rep({ ms: 600 }))).saved, true);
  assert.deepEqual(msOf(await record.read()), { ...V1_MS, 'pll-t': [null, null, 600] });
});

test('a version-2 record is imported with its own ids, in its order', async () => {
  const local = fakeLocal(V2);
  const db = memoryDatabase();
  const { record } = open({ db, legacy: local });
  const now = await record.read();
  assert.deepEqual(msOf(now), { x: [900, 600], y: [700, 500] });
  assert.deepEqual([...now.values()].flat().map((r) => r.repId).sort(), [rid(0, 'b'), rid(1, 'b'), rid(2, 'b'), rid(0, 'c')].sort());
  // (time, id) was version 2's one order: x's 3000 rep (b…) before y's (c…).
  const order = Object.values(db.value.algs).flat().sort((a, b) => a.s - b.s).map((r) => r.ms);
  assert.deepEqual(order, [900, 700, 600, 500]);
  assert.equal(local.raw(), V2);
});

test('the import is a union by rep id: two windows importing at once, or one import made twice, put each rep in once', async () => {
  for (const text of [V1, V2]) {
    // Two windows opened together, each reading the old record before either has imported it.
    const local = fakeLocal(text);
    const db = memoryDatabase();
    const [a, b] = [open({ db, legacy: local }).record, open({ db, legacy: local }).record];
    const [ra, rb] = await Promise.all([a.read(), b.read()]);
    assert.deepEqual(msOf(ra), msOf(rb));
    const ids = Object.values(db.value.algs).flat().map((r) => r.i);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(ids.length, text === V1 ? 6 : 4, 'a rep was put in twice, or not at all');
    assert.deepEqual([db.writes, local.raw(), a.status().legacy, b.status().legacy], [1, text, null, null]);
    // Every later open imports it again, and writes nothing.
    const before = structuredClone(db.value);
    await open({ db, legacy: local }).record.ready;
    assert.deepEqual([db.value, db.writes, local.raw()], [before, 1, text], 'a second import changed the record');
  }
});

test('an import the caps cut is cut the same way again: a second import writes nothing', async () => {
  // In the database: `x` full to its cap with reps newer than the old record's, and `y` holding one. The old record
  // holds five older `x` reps, which the per-algorithm cap drops, and two `y` reps, which stay.
  const value = stored([['x', PER_ALG_CAP], ['y', 1]], { from: 10_000 });
  const old = JSON.stringify({
    v: 2,
    gen: '1'.repeat(16),
    algs: {
      x: Array.from({ length: 5 }, (_, k) => ({ ...V1_REP, i: rid(k, 'd'), t: 1_000 + k })),
      y: [{ ...V1_REP, i: rid(9, 'd'), t: 1_000 }, { ...V1_REP, i: rid(10, 'd'), t: 10_050 }],
    },
  });
  const db = memoryDatabase(value);
  await open({ db, legacy: fakeLocal(old) }).record.ready;
  const first = structuredClone(db.value);
  assert.equal(first.algs.x.length, PER_ALG_CAP);
  assert.ok(first.algs.x.every((r) => !r.i.startsWith('d')), 'the cap kept an older rep over a newer one');
  assert.deepEqual(first.algs.y.map((r) => r.t), [1_000, 10_050, 10_101], 'the old reps did not go in by their time');
  assert.equal(db.writes, 1);
  await open({ db, legacy: fakeLocal(old) }).record.ready;
  assert.deepEqual([db.value, db.writes], [first, 1], 'the second import changed the record');
  // When the caps drop every rep the old record holds, nothing is written at all.
  const x5 = JSON.stringify({ v: 2, gen: '1'.repeat(16), algs: { x: JSON.parse(old).algs.x } });
  await open({ db, legacy: fakeLocal(x5) }).record.ready;
  assert.deepEqual([db.value, db.writes], [first, 1]);
  // Two old reps in one millisecond, the cap dropping the first: imported again, it goes in before the second as it
  // did the first time — never after it, where the cap would keep it and drop the second instead.
  const tie = memoryDatabase(stored([['x', PER_ALG_CAP - 1]], { from: 10_000 }));
  const pair = JSON.stringify({ v: 2, gen: '1'.repeat(16), algs: { x: [{ ...V1_REP, i: rid(0, 'e'), t: 1_000, ms: 1 }, { ...V1_REP, i: rid(1, 'e'), t: 1_000, ms: 2 }] } });
  await open({ db: tie, legacy: fakeLocal(pair) }).record.ready;
  const once = structuredClone(tie.value);
  assert.deepEqual([once.algs.x[0].ms, once.algs.x.length, tie.writes], [2, PER_ALG_CAP, 1], 'precondition: the cap dropped the first of the two');
  await open({ db: tie, legacy: fakeLocal(pair) }).record.ready;
  assert.deepEqual([tie.value, tie.writes], [once, 1], 'importing again swapped which of the two the cap kept');
});

test('a window saving while another imports keeps its rep, and every old rep is in once', async () => {
  const local = fakeLocal(V1);
  const db = memoryDatabase();
  const saver = open({ db }).record;
  const importer = open({ db, legacy: local }).record;
  const [out] = await Promise.all([saver.add('new', rep({ ms: 1 })), importer.ready]);
  assert.equal(out.saved, true);
  assert.deepEqual(msOf(await importer.read()), { ...V1_MS, new: [1] });
});

/** Old records neither version reads, each with the code it is refused for. */
const LEGACY_REFUSED = [
  ['not JSON', '{"v":2,', 'not-json'],
  ['an array', '[]', 'foreign'],
  ['JSON null', 'null', 'foreign'],
  ['version 3 in localStorage', JSON.stringify({ v: 3, algs: {} }), 'foreign'],
  ['a version given as text', JSON.stringify({ ...JSON.parse(V2), v: '2' }), 'foreign'],
  ['a version-1 algs that is a list', JSON.stringify({ v: 1, algs: [] }), 'foreign'],
  ['version 2 with no generation', JSON.stringify({ ...JSON.parse(V2), gen: undefined }), 'corrupt'],
  ['a version-2 record whose reps have no ids', JSON.stringify({ v: 2, gen: '1'.repeat(16), algs: { a: [V1_REP] } }), 'corrupt'],
  ['one id on two version-2 reps', JSON.stringify({ v: 2, gen: '1'.repeat(16), algs: { a: [{ ...V1_REP, i: rid(0) }], b: [{ ...V1_REP, i: rid(0), t: 6 }] } }), 'corrupt'],
  ['version-2 reps in one millisecond out of id order', JSON.stringify({ v: 2, gen: '1'.repeat(16), algs: { a: [{ ...V1_REP, i: rid(2) }, { ...V1_REP, i: rid(1) }] } }), 'corrupt'],
  ['a version-1 rep clean with a lost turn', v1Text({ a: [{ ...V1_REP, l: true }] }), 'corrupt'],
  ['a version-1 rep with no length', v1Text({ a: [{ ...V1_REP, h: undefined }] }), 'corrupt'],
  ['version-1 reps out of order', v1Text({ a: [{ ...V1_REP, t: 9 }, { ...V1_REP, t: 8 }] }), 'corrupt'],
  ['two algorithms at one time in version 1', v1Text({ a: [V1_REP], b: [V1_REP] }), 'corrupt'],
  ['an empty version-1 list', v1Text({ a: [] }), 'corrupt'],
  ['a version-1 list past the cap', v1Text({ a: Array.from({ length: PER_ALG_CAP + 1 }, (_, k) => ({ ...V1_REP, t: k + 1 })) }), 'corrupt'],
];

test('an old record neither version reads is left exactly as it is and said — and practice is saved from then on', async () => {
  for (const [what, text, code] of LEGACY_REFUSED) {
    const local = fakeLocal(text);
    const db = memoryDatabase();
    const { record, heard } = open({ db, legacy: local });
    await record.ready;
    assert.equal(record.status().legacy?.code, code, what);
    assert.equal(heard.changes, 1, `${what}: not said through onChange`);
    assert.deepEqual([local.raw(), db.writes], [text, 0], `${what}: the old record was touched`);
    assert.equal((await record.add('a', rep())).saved, true, `${what}: practice was not saved`);
    assert.deepEqual([local.raw(), record.status().legacy.code], [text, code], `${what}: the old record was touched, or it stopped being said`);
  }
});

test('an import the store could not make is said, the old record stays, and the next operation makes it', async () => {
  const local = fakeLocal(V1);
  const db = memoryDatabase();
  const { record, store, heard } = open({ db, legacy: local });
  store.faults.write = true;
  await record.ready;
  assert.deepEqual([record.status().legacy?.code, heard.changes, local.raw()], ['write-failed', 1, V1]);
  assert.equal(record.status().legacy.cause.cause.name, 'QuotaExceededError', 'the cause was lost');
  store.faults.write = false;
  assert.deepEqual(msOf(await record.read()), V1_MS);
  assert.deepEqual([record.status().legacy, heard.changes, local.raw()], [null, 2, V1]);
});

test('an old record that cannot be read is said, and read again before the next operation', async () => {
  const local = fakeLocal(V1, { readThrows: true });
  const { record, heard } = open({ legacy: local });
  await record.ready;
  assert.deepEqual([record.status().legacy?.code, heard.changes], ['unreadable', 1]);
  assert.deepEqual(await record.read(), new Map());
  local.readThrows = false;
  assert.deepEqual(msOf(await record.read()), V1_MS);
  assert.deepEqual([record.status().legacy, local.raw()], [null, V1]);
});

test('Codex\'s audit of 6e61bf60: a rep another window appends after the import is never deleted — the next open imports it', async () => {
  // Before: the import removed the key when this window's copy of localStorage still held the text it imported. A
  // window's copy can be behind the storage itself, so another window's appended rep was deleted unread.
  const more = JSON.parse(V2);
  more.algs.y.push({ ...V1_REP, i: rid(3, 'b'), t: 4_000, ms: 400 });
  let storage = JSON.stringify(more);
  // This window's copy still holds the text before the append; a removal would reach the storage itself.
  const behind = { getItem: () => V2, removeItem: () => { storage = null; } };
  const db = memoryDatabase();
  await open({ db, legacy: behind }).record.ready;
  assert.notEqual(storage, null, 'the old record was deleted, and the rep appended to it with it');
  const { record } = open({ db, legacy: { getItem: () => storage } });
  assert.deepEqual(msOf(await record.read()), { x: [900, 600], y: [700, 500, 400] });
});

test('an old record that grows is imported again at the next open, adding only what is new', async () => {
  const local = fakeLocal(V2);
  const db = memoryDatabase();
  await open({ db, legacy: local }).record.ready;
  const more = JSON.parse(V2);
  more.algs.y.push({ ...V1_REP, i: rid(3, 'b'), t: 4_000, ms: 400 });
  local.setItem(RECORD_KEY, JSON.stringify(more));
  const { record } = open({ db, legacy: local });
  assert.deepEqual(msOf(await record.read()), { x: [900, 600], y: [700, 500, 400] });
  assert.equal(db.writes, 2);
  await open({ db, legacy: local }).record.ready;
  assert.equal(db.writes, 2, 'an import with nothing new wrote');
});

// ---- the API's edges ------------------------------------------------------------------------------------

test('a read is a fresh snapshot: its lists and reps are frozen, and editing its Map changes nothing stored', async () => {
  const db = memoryDatabase();
  const { record } = open({ db });
  assert.equal((await record.add('a', rep())).saved, true);
  const value = structuredClone(db.value);
  const first = await record.read();
  first.set('b', Object.freeze([]));
  first.delete('a');
  const again = await record.read();
  assert.notEqual(again, first, 'two reads handed out one Map');
  assert.deepEqual([...again.keys()], ['a'], 'editing one read changed the next');
  assert.deepEqual(db.value, value, 'editing a read changed what is stored');
  assert.ok(Object.isFrozen(again.get('a')) && Object.isFrozen(again.get('a')[0]), 'a rep list or a rep can be edited');
  assert.throws(() => again.get('a').push({}), TypeError);
  assert.ok(Object.isFrozen(await record.reps('none')), 'an algorithm with no reps hands out an editable list');
});

test('a malformed rep or id from the caller throws at once, and a hostile id is a key like any other', async () => {
  const db = memoryDatabase();
  const { record } = open({ db });
  assert.throws(() => record.add('a', rep({ ms: 10, refused: TIME_REFUSAL.ONE_TURN })), /both timed and refused/);
  assert.throws(() => record.add('a', { ...rep(), clean: 'yes' }), /neither clean/);
  assert.throws(() => record.add('', rep()), /not a ledger id/);
  assert.throws(() => record.reps('x'.repeat(81)), /not a ledger id/);
  assert.equal(db.writes, 0);
  assert.equal((await record.add('__proto__', rep())).saved, true);
  assert.equal((await record.read()).get('__proto__').length, 1);
  assert.equal(Object.getPrototypeOf(db.value.algs), Object.prototype);
  // A clock that gives no time is the caller's defect: rejected, and nothing written.
  const broken = open({ now: () => Number.NaN });
  await assert.rejects(broken.record.add('a', rep()), /the clock gave NaN/);
  assert.equal(broken.db.writes, 0);
  const store = memoryStore(memoryDatabase());
  for (const bad of [{}, { store }, { store, now: Date.now }, { store, now: Date.now, onChange() {}, legacy: {} }, { store, now: Date.now, onChange() {}, broadcast: {} }]) {
    assert.throws(() => openPracticeRecord(bad), /injected|getItem|BroadcastChannel/);
  }
});

test('the legacy key, the version and the caps are what the format says', () => {
  assert.equal(RECORD_KEY, 'cubusDrillRecord');
  assert.equal(RECORD_VERSION, 3);
  assert.ok(PER_ALG_CAP > 0 && TOTAL_CAP % PER_ALG_CAP === 0 && TOTAL_CAP >= PER_ALG_CAP);
});

test('rep ids are drawn from the cryptographic source, never Math.random, and a source that gives no 32-bit value throws', async () => {
  // What must NOT happen: an id from Math.random, which nothing would notice until two ids met.
  const was = Math.random;
  Math.random = () => { throw new Error('Math.random was called'); };
  try {
    const { record } = open();
    assert.equal((await record.add('x', rep())).saved, true);
    assert.equal((await record.add('x', rep())).saved, true);
    assert.equal(new Set((await record.reps('x')).map((r) => r.repId)).size, 2);
  } finally {
    Math.random = was;
  }
  const draws = [0x01234567, 0x89abcdef, 0xdeadbeef];
  const { record } = open({ random: () => draws.shift() });
  assert.equal((await record.add('x', rep())).saved, true);
  assert.deepEqual((await record.reps('x')).map((r) => r.repId), ['0123456789abcdefdeadbeef']);
  for (const bad of [-1, 2 ** 32, 1.5, Number.NaN, '7']) {
    assert.throws(() => open({ random: () => bad }).record.add('x', rep()), /32-bit unsigned/, String(bad));
  }
});

test('nothing is written that the reader would refuse: a rep id already on record rejects the add, and the record stands', async () => {
  // Reachable only through a broken random source; a write of it would make every later read refuse the record.
  const db = memoryDatabase();
  const { record } = open({ db, random: () => 7 });
  assert.equal((await record.add('x', rep())).saved, true);
  const value = structuredClone(db.value);
  await assert.rejects(record.add('y', rep()), /refused to write a record its own reader refuses.*id of another rep/);
  assert.deepEqual([db.value, db.writes], [value, 1]);
  assert.equal((await record.reps('x')).length, 1, 'the record stopped reading');
});
