// The tutorial oracle is only an oracle if it agrees with an implementation it shares nothing with.
//
// `test/cube-oracle.mjs` is a sticker model written from the published facelet layout; cubejs is a
// third-party cube. Every move cubejs knows — faces, slices, wide moves, rotations, each in all three
// amounts — is applied by both, from a solved cube, from a scrambled one and as long mixed sequences,
// and must give the same 54 letters. A wrong layout row, a wrong rotation sign or a slice turning the
// wrong way fails here, before any scenario leans on it.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import Cube from '../vendor/cubejs.js';
import {
  ROTATIONS, SOLVED_FACELETS, STICKERS, applyMoves, applyToken, faceletAt, held, holdOf, identityOf,
  invertMoves, play,
} from './cube-oracle.mjs';

const CUBEJS_TOKENS = ['U', 'R', 'F', 'D', 'L', 'B', 'M', 'E', 'S', 'x', 'y', 'z', 'u', 'r', 'f', 'd', 'l', 'b']
  .flatMap((t) => [t, `${t}'`, `${t}2`]);

const viaCubejs = (moves) => { const c = new Cube(); c.move(moves); return c.asString(); };

/** A seeded xorshift, so a failing sequence is the same sequence on every run. */
function rng(seed) {
  let s = seed >>> 0;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 2 ** 32; };
}

test('the layout names 54 distinct stickers, one per position and facing', () => {
  assert.equal(STICKERS.length, 54);
  const seen = new Set(STICKERS.map((s, i) => faceletAt(s.pos, s.n) === i && `${s.pos}|${s.n}`));
  assert.equal(seen.size, 54);
  assert.ok(!seen.has(false), 'a sticker does not look itself up');
});

test('every move cubejs knows, from solved: the same 54 letters', () => {
  for (const t of CUBEJS_TOKENS) assert.equal(applyToken(SOLVED_FACELETS, t), viaCubejs(t), t);
});

test('every move cubejs knows, after a scramble and inside long mixed sequences: the same 54 letters', () => {
  const scramble = "R U2 F' L D B2 R' U F2 D' L2 B";
  for (const t of CUBEJS_TOKENS) {
    assert.equal(applyMoves(SOLVED_FACELETS, `${scramble} ${t}`), viaCubejs(`${scramble} ${t}`), `${scramble} ${t}`);
  }
  const next = rng(0x5eed);
  for (let run = 0; run < 40; run++) {
    const seq = Array.from({ length: 30 }, () => CUBEJS_TOKENS[Math.floor(next() * CUBEJS_TOKENS.length)]).join(' ');
    assert.equal(applyMoves(SOLVED_FACELETS, seq), viaCubejs(seq), seq);
  }
});

test('the check can fail: a rotation turned the wrong way no longer reproduces cubejs', () => {
  // `x` is `R`'s direction (WCA 12a4); `x'` is not. A model that swapped them would be caught above.
  assert.notEqual(applyToken(SOLVED_FACELETS, "x'"), viaCubejs('x'));
  assert.notEqual(applyToken(SOLVED_FACELETS, 'M'), viaCubejs("M'"));
});

test('WCA outer-block spelling is the lower-case wide move', () => {
  for (const [w, l] of [['Rw', 'r'], ['Lw', 'l'], ['Uw', 'u'], ['Dw', 'd'], ['Fw', 'f'], ['Bw', 'b']]) {
    for (const s of ['', "'", '2']) assert.equal(applyToken(SOLVED_FACELETS, w + s), applyToken(SOLVED_FACELETS, l + s), w + s);
  }
});

test('holds after one move: the rotations follow WCA 12a4, the slices and wide moves move the centres', () => {
  const holdAfter = (m) => holdOf(applyMoves(SOLVED_FACELETS, m));
  assert.equal(holdAfter('x'), 'F D');
  assert.equal(holdAfter('y'), 'U R');
  assert.equal(holdAfter('z'), 'L F');
  assert.equal(holdAfter('M'), 'B U');
  assert.equal(holdAfter('E'), 'U L');
  assert.equal(holdAfter('S'), 'L F');
  assert.equal(holdAfter('Rw'), 'F D');
  assert.equal(holdAfter('R U R\' U\''), 'U F');
});

test('the 24 holds round-trip: a cube held any way comes back to the same identity facelets', () => {
  assert.equal(Object.keys(ROTATIONS).length, 24);
  const scrambled = applyMoves(SOLVED_FACELETS, "R U2 F' L D B2");
  for (const hold of Object.keys(ROTATIONS)) {
    const world = held(scrambled, hold);
    assert.equal(holdOf(world), hold);
    assert.deepEqual(identityOf(world), { identity: scrambled, hold });
  }
});

test('a slice leaves the pieces where its face turns would, relative to the centres', () => {
  // M relative to the centres is R L' (the centres move the other way round), and Rw is L.
  assert.equal(identityOf(applyMoves(SOLVED_FACELETS, 'M')).identity, applyMoves(SOLVED_FACELETS, "R L'"));
  assert.equal(identityOf(applyMoves(SOLVED_FACELETS, 'Rw')).identity, applyMoves(SOLVED_FACELETS, 'L'));
});

test('play: the owner\'s red-green edge goes home after turning red to the front', () => {
  // Tumbled (white underneath, green at the back), the red-green edge waits on top. The setup is the
  // insert undone, made with red at the front and turned back, so the start is held `D B` as asked.
  const insert = "U R U' R' U' F' U F";
  const setup = held(SOLVED_FACELETS, 'D B');
  const start = identityOf(applyMoves(setup, `y ${invertMoves(insert)} y'`));
  assert.equal(start.hold, 'D B', 'precondition: the setup nets no whole-cube turn');
  assert.notEqual(start.identity, SOLVED_FACELETS, 'precondition: the edge is out');
  const run = play(start.identity, 'D B', `y ${insert}`);
  assert.equal(run.holds[1], 'D R', 'turning red to the front is a y from white-under, green-back');
  assert.equal(run.end.identity, SOLVED_FACELETS, 'the insert did not bring the edge home');
  assert.equal(run.end.hold, 'D R');
});
