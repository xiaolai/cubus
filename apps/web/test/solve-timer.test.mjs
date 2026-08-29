// The claims solve-timer.js rests on. Each test fails if one stops being true.
import assert from 'node:assert/strict';
import test from 'node:test';
import { SOLVED, createSolveTimer } from '../lib/solve-timer.js';

const TARGET = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB'.replace('UUU', 'RRR');

/** A move as the driver delivers it: a cube clock, a host clock, and a serial. */
const mv = (cubeTimestamp, { host = null, serial = 0 } = {}) => ({
  notation: 'R',
  serial,
  cubeTimestamp,
  timestamp: host,
});

const make = (opts = {}) =>
  createSolveTimer({
    target: opts.target ?? (() => TARGET),
    trusted: opts.trusted ?? (() => true),
    ...(opts.now ? { now: opts.now } : {}),
  });

test('arms only on the exact scramble arrangement, never on a heuristic', () => {
  const t = make();
  assert.equal(t.state, 'idle');
  t.facelets('UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB', 1);
  assert.equal(t.state, 'idle', 'a solved cube is not the scramble target');
  t.facelets(TARGET, 2);
  assert.equal(t.state, 'armed');
});

test('the clock runs from the cube hardware clock, not the host clock', () => {
  const t = make();
  t.facelets(TARGET, 1);
  // Host times deliberately disagree in SHAPE with the cube's — BLE jitter. The reported span
  // must follow the cube.
  t.move(mv(1_000, { host: 500_000, serial: 1 }));
  t.move(mv(5_000, { host: 508_400, serial: 2 }));
  t.move(mv(13_400, { host: 512_000, serial: 3 }));
  t.facelets(SOLVED, 3);
  const r = t.result();
  assert.equal(r.ms, 12_400, 'elapsed is the cube-stamp span, 13400 - 1000');
  assert.equal(r.seconds, '12.40');
  assert.equal(r.moves, 3);
});

test('a solve is not timed at all when the cube did not stamp its moves', () => {
  const t = make();
  t.facelets(TARGET, 1);
  t.move(mv(null, { serial: 1 }));
  t.move(mv(null, { serial: 2 }));
  t.facelets(SOLVED, 2);
  assert.equal(t.result(), null, 'no invented time');
  assert.match(t.refusal, /did not timestamp/);
});

test('dropped moves are detected by serial and refuse to report a short time', () => {
  // The snapshot is ahead of the last move we hold, so the move that finished the solve never
  // arrived — timing to the last move we DID see would undercount.
  const t = make();
  t.facelets(TARGET, 10);
  t.move(mv(1_000, { serial: 11 }));
  t.move(mv(4_000, { serial: 12 }));
  t.facelets(SOLVED, 17);
  assert.equal(t.result(), null);
  assert.match(t.refusal, /dropped/);
});

test('a backwards cube clock (a reconnect resets it) is refused, not reported', () => {
  const t = make();
  t.facelets(TARGET, 1);
  t.move(mv(90_000, { serial: 1 }));
  t.move(mv(120, { serial: 2 })); // hardware clock restarted
  t.facelets(SOLVED, 2);
  assert.equal(t.result(), null);
});

test('an absurd span is refused — the cube was put down, not solved', () => {
  const t = make();
  t.facelets(TARGET, 1);
  t.move(mv(0, { serial: 1 }));
  t.move(mv(4 * 60 * 60 * 1000, { serial: 2 }));
  t.facelets(SOLVED, 2);
  assert.equal(t.result(), null);
});

test('gross host/cube disagreement is refused — one of the two clocks is lying', () => {
  const t = make();
  t.facelets(TARGET, 1);
  t.move(mv(1_000, { host: 1_000, serial: 1 }));
  t.move(mv(9_000, { host: 90_000, serial: 2 })); // cube says 8 s, host says 89 s
  t.facelets(SOLVED, 2);
  assert.equal(t.result(), null);
});

test('an untrusted cube never arms — its arrangement is not evidence', () => {
  let ok = false;
  const t = make({ trusted: () => ok });
  t.facelets(TARGET, 1);
  assert.equal(t.state, 'idle');
  ok = true;
  t.facelets(TARGET, 2);
  assert.equal(t.state, 'armed');
});

test('losing trust mid-solve abandons the timing rather than reporting it', () => {
  let ok = true;
  const t = make({ trusted: () => ok });
  t.facelets(TARGET, 1);
  t.move(mv(1_000, { serial: 1 }));
  assert.equal(t.state, 'running');
  ok = false;
  t.facelets(SOLVED, 2);
  assert.equal(t.state, 'idle', 'reset rather than stopped');
  assert.equal(t.result(), null);
});

test('leaving the target without a move event abandons the arming', () => {
  // The stream is not intact, so a clock started now would not know where it began.
  const t = make();
  t.facelets(TARGET, 1);
  assert.equal(t.state, 'armed');
  t.facelets('DDDDDDDDDRRRRRRRRRFFFFFFFFFUUUUUUUUULLLLLLLLLBBBBBBBBB', 2);
  assert.equal(t.state, 'idle');
});

test('with no scramble there is nothing to arm on', () => {
  const t = make({ target: () => null });
  t.facelets(TARGET, 1);
  assert.equal(t.state, 'idle');
});

test('reaching solved is what stops it — not a move count or a timeout', () => {
  const t = make();
  t.facelets(TARGET, 1);
  t.move(mv(1_000, { serial: 1 }));
  for (let i = 2; i < 40; i++) t.move(mv(1_000 + i * 400, { serial: i }));
  assert.equal(t.state, 'running', 'still running after 39 moves');
  t.facelets(SOLVED, 39);
  assert.equal(t.state, 'stopped');
  assert.equal(t.result().moves, 39);
});

test('result is null until the solve actually finishes', () => {
  const t = make();
  t.facelets(TARGET, 1);
  assert.equal(t.result(), null);
  t.move(mv(1_000, { serial: 1 }));
  assert.equal(t.result(), null, 'running is not finished');
  t.move(mv(3_500, { serial: 2 }));
  assert.equal(t.result(), null, 'still not finished — solved is what ends it');
  t.facelets(SOLVED, 2);
  assert.ok(t.result());
  assert.equal(t.result().ms, 2_500);
});

test('a one-move solve cannot be timed, and says so rather than reporting 0.00', () => {
  // Inherent to measuring between move completions: with a single move, first and last are the
  // same instant. A 0.00 is not a truer number than no number, so it is refused.
  const t = make();
  t.facelets(TARGET, 1);
  t.move(mv(1_000, { serial: 1 }));
  t.facelets(SOLVED, 1);
  assert.equal(t.state, 'stopped');
  assert.equal(t.result(), null);
});


// ── the recorded ready state ───────────────────────────────────────────────────────────────────

test('reaching the scramble RECORDS a ready instant, not just a flag', () => {
  let clock = 1_000;
  const t = make({ now: () => clock });
  assert.equal(t.readyAt, null);
  t.facelets(TARGET, 1);
  assert.equal(t.state, 'armed');
  assert.equal(t.readyAt, 1_000, 'the instant is captured, so it can be reasoned about');
});

test('inspection is reported: how long the solver looked before touching it', () => {
  let clock = 10_000;
  const t = make({ now: () => clock });
  t.facelets(TARGET, 1);           // ready at host 10_000
  t.move(mv(500, { host: 17_400, serial: 1 }));  // first turn 7.4 s later
  t.move(mv(9_000, { host: 26_000, serial: 2 }));
  t.facelets(SOLVED, 2);
  const r = t.result();
  assert.equal(r.inspectionMs, 7_400, 'ready -> first move, on the host clock');
  assert.equal(r.ms, 8_500, 'and the solve itself still comes from the cube clock');
});

test('a stale ready lapses — a cube left at the scramble is furniture, not a solve', () => {
  let clock = 0;
  const t = make({ now: () => clock });
  t.facelets(TARGET, 1);
  assert.equal(t.state, 'armed');
  clock = 11 * 60 * 1000; // eleven minutes on the desk
  t.facelets(TARGET, 2);
  assert.equal(t.state, 'idle', 'the arming lapsed rather than timing someone\'s lunch');
  assert.equal(t.readyAt, null);
});

test('inspection is null rather than fabricated when the host times are unusable', () => {
  let clock = 1_000;
  const t = make({ now: () => clock });
  t.facelets(TARGET, 1);
  t.move(mv(100, { host: null, serial: 1 }));
  t.move(mv(5_100, { host: null, serial: 2 }));
  t.facelets(SOLVED, 2);
  const r = t.result();
  assert.equal(r.ms, 5_000, 'the solve is still timed — it needs only the cube clock');
  assert.equal(r.inspectionMs, null, 'but inspection is not invented');
});

test('a solve whose ready was never recorded cannot be timed', () => {
  // Not reachable through facelets(), which sets both together — a guard against a future caller.
  const t = make();
  t.move(mv(1_000, { serial: 1 }));
  assert.equal(t.state, 'idle', 'a move with nothing armed does nothing');
  assert.equal(t.result(), null);
});
