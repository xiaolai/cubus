// Statistics over a session's solves.
//
// The screen these feed used to be entirely fabricated: a 14.82 single, a 21.44 ao5, a twenty-bar
// chart from a literal array, and a five-solve history invented at boot — all shown to someone who
// had never solved a cube. So the assertions here are mostly about what must NOT appear.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { averageOf, best, byDay, moveStats, summarize, times } from '../lib/solve-stats.js';

const solve = (time, extra = {}) => ({ time: String(time), ...extra });

test('an empty session produces nothing, not zeroes', () => {
  // Zero is a claim ("your best is 0.00s"). Null is the absence of one, and the screen renders it
  // as an em dash. The distinction is the entire point of this module.
  for (const empty of [[], null, undefined, 'nonsense', {}]) {
    const s = summarize(empty, Date.now());
    assert.equal(s.count, 0);
    assert.equal(s.best, null);
    assert.equal(s.ao5, null);
    assert.equal(s.moves, null);
    assert.equal(s.week.length, 7, 'the week still has seven days, all empty');
    assert.ok(s.week.every((d) => d.count === 0 && d.best === null));
  }
});

test('unusable times are dropped rather than counted as zero', () => {
  const list = [solve('12.5'), solve('nonsense'), solve(''), solve('-3'), solve('0'), { time: null }];
  assert.deepEqual(times(list), [12.5]);
  assert.equal(best(list), 12.5, 'a junk row must not become the best time');
});

test('an average of n needs n solves, and drops the fastest and slowest', () => {
  const list = [10, 20, 30, 40, 100].map((t) => solve(t));
  // WCA ao5 over these: drop 10 and 100, mean of 20/30/40.
  assert.equal(averageOf(list, 5), 30);
  // Four solves is not an ao5. Computing one anyway would be a different statistic under the same
  // name, which is exactly the kind of quiet lie this replaces.
  assert.equal(averageOf(list.slice(0, 4), 5), null);
  assert.equal(averageOf(list, 12), null, 'and certainly not an ao12');
});

test('the trim is proportional: an ao100 drops five each end, not one', () => {
  // ao5 and ao12 drop one at each end, which makes "drop the best and the worst" look like the
  // general rule. It is not — WCA trims 5% — and hardcoding one gave 13.3061 here instead of 10.
  const list = [
    ...Array.from({ length: 5 }, () => solve(1)),
    ...Array.from({ length: 90 }, () => solve(10)),
    ...Array.from({ length: 5 }, () => solve(100)),
  ];
  assert.equal(averageOf(list, 100), 10, 'the five fastest and five slowest are dropped');
  // And the small averages keep dropping exactly one, which is the same rule, not an exception.
  assert.equal(averageOf([10, 20, 30, 40, 100].map(solve), 5), 30, 'ao5 trims one');
  assert.equal(averageOf([1, ...Array(10).fill(10), 100].map(solve), 12), 10, 'ao12 trims one');
});

test('one unusable solve inside the window means there is no average', () => {
  // Filtering before choosing the window let an OLDER solve slide in and stand in for the missing
  // one, producing a confident ao5 over solves that were not the last five.
  const list = [solve(10), solve(20), solve('bad'), solve(40), solve(50), solve(60)];
  assert.equal(averageOf(list, 5), null, 'no honest ao5 exists here');
  // The same list with the bad row repaired does have one, so it is the row and not the length.
  const repaired = [solve(10), solve(20), solve(30), solve(40), solve(50), solve(60)];
  assert.equal(averageOf(repaired, 5), 30);
});

test('an invalid n is refused rather than averaging something else', () => {
  const list = Array.from({ length: 12 }, (_, i) => solve(10 + i));
  for (const n of [undefined, null, '5', 2, 0, -5, 5.5, Number.NaN, Infinity, 1e9]) {
    assert.equal(averageOf(list, n), null, `n = ${String(n)}`);
  }
});

test('coercible types never become statistics', () => {
  // Untrusted localStorage. Number() turns `true` into 1 second, ["12.5"] into 12.5 and "0x10"
  // into 16 — each of which could take over as a personal best.
  for (const bad of [true, false, ['12.5'], '0x10', '1e3', ' 12.5 ', '+12.5', 'Infinity', 12.5, null, {}]) {
    assert.equal(best([{ time: bad }]), null, `time: ${JSON.stringify(bad)}`);
    assert.deepEqual(times([{ time: bad }]), []);
  }
  assert.equal(best([solve('12.5')]), 12.5, 'while the documented form still works');

  // Move counts are integers a cube reported. `true` is not one turn, and 3.5 is not three.
  for (const bad of [true, '40', 3.5, [40], null, Infinity]) {
    assert.equal(moveStats([{ time: '10.00', moves: bad }]), null, `moves: ${JSON.stringify(bad)}`);
  }
});

test('byDay refuses arguments it cannot honour instead of hanging', () => {
  const now = new Date(2026, 0, 8, 12, 0).getTime();
  // days: Infinity used to loop forever — decrementing Infinity leaves it unchanged — which is a
  // frozen tab rather than a wrong answer.
  for (const days of [Infinity, Number.NaN, 0, -7, 7.5, '7', 1000]) {
    assert.deepEqual(byDay([], now, days), [], `days: ${String(days)}`);
  }
  for (const bad of [Number.NaN, Infinity, 0, -1, '123', null]) {
    assert.deepEqual(byDay([], bad), [], `now: ${String(bad)}`);
  }
  assert.equal(byDay([], now, 7).length, 7, 'while valid arguments still work');
});

test('a day is a calendar day, not a fixed number of milliseconds', () => {
  // Across a daylight-saving change a local day is 23 or 25 hours. Fixed-width buckets slide off
  // the real days and file solves under the wrong bar twice a year.
  const days = byDay([], new Date(2026, 2, 12, 12, 0).getTime(), 7);
  assert.deepEqual(days.map((d) => d.label), ['F', 'S', 'S', 'M', 'T', 'W', 'T'],
    'seven consecutive weekday labels ending on the given day');
});

test('a day counts solves, not timestamps', () => {
  const now = new Date(2026, 0, 8, 12, 0).getTime();
  // A row with a readable date but an unreadable time is not a solve. Counting it made the daily
  // bars disagree with the session count printed directly above them.
  const week = byDay([solve('bad', { at: now }), solve(10, { at: now })], now);
  assert.equal(week[6].count, 1);
  assert.equal(week[6].best, 10);
  // Nor can a solve have happened later today than now.
  assert.equal(byDay([solve(10, { at: now + 3600000 })], now)[6].count, 0, 'the future is not counted');
});

test('an average uses the most recent n, not the best n', () => {
  // Newest first, as stored. The last five are all slow; the average must reflect them.
  const recent = [50, 60, 70, 80, 90].map((t) => solve(t));
  const older = [1, 1, 1, 1, 1].map((t) => solve(t));
  assert.equal(averageOf([...recent, ...older], 5), 70, 'the old fast solves do not flatter it');
});

test('turn rate is measured or absent — never estimated', () => {
  // A hand-timed solve has no move count. Filling one in from an average would put a number on
  // this screen that no cube ever reported.
  assert.equal(moveStats([solve(20), solve(30)]), null, 'no cube, no turn rate');

  const mixed = [solve(20, { moves: 40 }), solve(30), solve(10, { moves: 30 })];
  const m = moveStats(mixed);
  assert.equal(m.solves, 2, 'only the solves a cube measured');
  assert.equal(m.fewestMoves, 30);
  assert.equal(m.meanMoves, 35);
  assert.equal(m.bestRate, 3, '30 moves in 10s');
  assert.equal(m.meanRate, 2.5, 'mean of 2.0 and 3.0');

  // A move count without a usable time is not a rate either.
  assert.equal(moveStats([solve('nonsense', { moves: 40 })]), null);
  assert.equal(moveStats([solve(20, { moves: 0 })]), null);
});

test('the week counts only dated solves, and puts each on its own day', () => {
  const now = new Date(2026, 0, 8, 12, 0).getTime();  // a Thursday
  const DAY = 86400000;
  const list = [
    solve(10, { at: now }),                  // today
    solve(20, { at: now }),                  // today
    solve(30, { at: now - 2 * DAY }),        // two days ago
    solve(40),                               // undated — from before timestamps existed
  ];
  const week = byDay(list, now);
  assert.equal(week.length, 7);
  assert.equal(week[6].count, 2, 'today');
  assert.equal(week[6].best, 10);
  assert.equal(week[4].count, 1, 'two days ago');
  // An undated solve counted "today" would invent a spike on whatever day the screen was first
  // opened. It belongs to no day, so it is shown on none.
  assert.equal(week.reduce((a, d) => a + d.count, 0), 3, 'the undated solve is counted nowhere');
});

test('a solve older than the window is outside it, not clamped into it', () => {
  const now = new Date(2026, 0, 8, 12, 0).getTime();
  const week = byDay([solve(10, { at: now - 30 * 86400000 })], now);
  assert.equal(week.reduce((a, d) => a + d.count, 0), 0);
});

test('summarize agrees with the parts it is made of', () => {
  const now = Date.now();
  const list = Array.from({ length: 12 }, (_, i) => solve(10 + i, { at: now, moves: 40 + i }));
  const s = summarize(list, now);
  assert.equal(s.count, 12);
  assert.equal(s.best, best(list));
  assert.equal(s.ao5, averageOf(list, 5));
  assert.equal(s.ao12, averageOf(list, 12));
  assert.equal(s.ao100, null, 'twelve solves is not an ao100');
  assert.deepEqual(s.moves, moveStats(list));
});
