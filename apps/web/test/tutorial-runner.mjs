// How a tutorial scenario is run, and what it is allowed to touch (plan item 0.3 of
// dev-docs/tutorial-capability-plan.md).
//
// Two rules make the corpus a definition of done rather than a list of hopes:
//
//   A scenario is WRITTEN against the public surface only. The model half hands it `cube-kit` wrapped
//   so an export that does not exist throws by name instead of reading as undefined; the element half
//   (test/browser/tutorial-scenarios.test.mjs) hands it the element wrapped so a member the manifest
//   does not list throws. Its CHECKS may read anything — pixels, internals, the oracle.
//
//   A scenario whose capability is not built is a GAP registered against the plan item that closes it
//   (`OPEN_ITEMS`). A gap that fails is reported as a todo, never a pass; a gap that PASSES fails the
//   run, because the registry is then lying about what exists; and a failure that is not a registered
//   gap fails the run.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import Cube from '../vendor/cubejs.js';
import { SOLVED_FACELETS, applyMoves, faceletAt, held, identityOf, play } from './cube-oracle.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** The plan items whose scenarios are gaps today. An item leaves this list in the change that closes it. */
export const OPEN_ITEMS = Object.freeze(['2.4', '3.1', '3.3']);

/** `cube-kit`, as a scenario may see it: a name that is not exported throws, naming itself. */
export function strictKit(kit) {
  return new Proxy(kit, {
    get(target, name) {
      if (typeof name === 'symbol' || name === 'then') return undefined;
      if (!Object.hasOwn(target, name)) throw new Error(`cube-kit exports no "${String(name)}"`);
      return target[name];
    },
  });
}

/**
 * Run `check` under the gap rules. `open` is whether the scenario's plan item is still open.
 * Returns nothing; throws for a real failure or a stale gap; calls `t.todo` for an open gap.
 */
export async function underGapRules(t, { id, closedBy }, open, check) {
  let failure = null;
  try { await check(); } catch (e) { failure = e; }
  if (open) {
    if (!failure) {
      assert.fail(`${id} passes, but its plan item ${closedBy} is still in OPEN_ITEMS — the gap is closed; remove the item`);
    }
    t.todo(`gap, closed by plan item ${closedBy}: ${failure.message.split('\n')[0]}`);
    return;
  }
  if (failure) throw failure;
}

/** The piece-model state behind identity facelets, through the public surface's own converter. */
export const stateOf = (kit, facelets) => kit.fromCube(Cube.fromString(facelets));

/** A scenario's start: identity facelets and the hold, from its held setup, by the oracle. */
export function startOf(sc) {
  const setup = sc.start?.setup ?? '';
  const world = applyMoves(held(SOLVED_FACELETS, sc.start.hold), setup);
  const back = identityOf(world);
  assert.equal(back.hold, sc.start.hold, `${sc.id}: the setup nets a whole-cube turn — fix the scenario`);
  return back.identity;
}

const holdPair = (hold) => hold.split(' ');

/** Sorted letters, the renderer's own convention for naming a piece. */
const pieceName = (letters) => [...letters].sort().join('');

/** The world U layer's edges as their letters, by the oracle's facelet layout. */
function topEdges(world) {
  // U edge facelets and the side facelet each shares a cubie with, in URFDLB order.
  const pairs = [[1, 46], [3, 37], [5, 10], [7, 19]];
  return pairs.map(([u, side]) => world[u] + world[side]);
}

/** The model half's runners, keyed by scenario kind. Each is written against `kit` alone. */
export const MODEL_RUNNERS = Object.freeze({
  // Held moves through the interpreter: the hold at every position and the pieces at the end.
  moves(sc, kit) {
    const identity = startOf(sc);
    const moves = kit.parse(sc.moves);
    const oracle = play(identity, sc.start.hold, sc.moves);
    const state = stateOf(kit, identity);
    for (let k = 1; k <= moves.length; k++) {
      const out = kit.run(moves.slice(0, k), holdPair(sc.start.hold), state);
      assert.equal(out.hold.join(' '), oracle.holds[k], `${sc.id}: hold after ${k} moves`);
    }
    const end = kit.run(moves, holdPair(sc.start.hold), state);
    assert.deepEqual(end.state, stateOf(kit, oracle.end.identity), `${sc.id}: pieces at the end`);
    for (const [k, hold] of Object.entries(sc.expect?.holdAfter ?? {})) assert.equal(oracle.holds[k], hold, `${sc.id}: the oracle's own hold ${k}`);
    if (sc.expect?.solvedAtEnd) assert.equal(oracle.end.identity, SOLVED_FACELETS, `${sc.id}: the oracle's own end`);
  },

  // A question asked of one cube, after the child's moves, answered in identity piece names.
  question(sc, kit) {
    const identity = startOf(sc);
    const oracle = play(identity, sc.start.hold, sc.moves);
    const world = oracle.worlds.at(-1);
    const top = world[4];
    const expected = topEdges(world).filter((letters) => !letters.includes(top)).map(pieceName).sort();
    assert.ok(expected.length > 0, `${sc.id}: precondition — the oracle finds at least one such edge`);
    const out = kit.run(kit.parse(sc.moves), holdPair(sc.start.hold), stateOf(kit, identity));
    const [up] = out.hold;
    const answer = kit.edgesInLayerWithout(out.state, up, up);
    assert.deepEqual([...answer.unknown], [], `${sc.id}: a state has no unknown slots`);
    assert.deepEqual(answer.pieces.map(pieceName).sort(), expected, `${sc.id}: top edges carrying none of the top colour`);
  },

  // A selector written in the child's frame, converted to the identity frame.
  selectors(sc, kit) {
    const [kind, where] = sc.selector.split(':');
    assert.equal(kind, 'piece', `${sc.id}: only piece selectors are scenarios yet`);
    // Read off the solved cube as the child holds it: the colours on the stickers of the position the
    // child names are the identity piece that lives there.
    const world = held(SOLVED_FACELETS, sc.hold);
    const letters = [...where].map((face) => world[stickerOn(face, where)]).join('');
    const got = kit.convertSelectors(sc.selector, holdPair(sc.hold));
    const [gotKind, gotLetters] = got.split(':');
    assert.equal(`${gotKind}:${pieceName(gotLetters)}`, `piece:${pieceName(letters)}`, `${sc.id}: ${sc.selector} held ${sc.hold}`);
  },
});

const NORMAL = Object.freeze({ U: [0, 1, 0], R: [1, 0, 0], F: [0, 0, 1], D: [0, -1, 0], L: [-1, 0, 0], B: [0, 0, -1] });

/** The facelet of `face`'s sticker on the cubie at the position `where` names, on the oracle's layout. */
function stickerOn(face, where) {
  const pos = [...where].reduce((p, f) => p.map((v, i) => v + NORMAL[f][i]), [0, 0, 0]);
  const i = faceletAt(pos, NORMAL[face]);
  if (i < 0) throw new Error(`no sticker of ${face} on the cubie at ${where}`);
  return i;
}

/** A `covered` scenario's test must exist where it says, by its exact name. */
export function assertCovered(sc) {
  const [file, name] = sc.coveredBy;
  // Read the source the way JavaScript reads its string literals: a test named "the walk's" is
  // written `'the walk\'s'` in a single-quoted title, and a check on the raw text would call a
  // present test missing.
  const text = readFileSync(`${ROOT}${file}`, 'utf8').replace(/\\(['"`])/g, '$1');
  assert.ok(text.includes(name), `${sc.id}: ${file} has no test named "${name}"`);
}
