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
import { STICKER_PALETTES } from '../lib/sticker-palettes.js';
import { paletteFor } from '../lib/scheme.js';
import * as CASE_TABLES from '../lib/data/case-tables.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** The plan items whose scenarios are gaps today. An item leaves this list in the change that closes it. */
export const OPEN_ITEMS = Object.freeze([]);

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

  // Plan item 4.5: the flat views of a cube paint every sticker the colour the oracle's cube has there, under
  // each scheme — the net all 54, the ringed case diagram the top face and the top layer's sides.
  'flat-view'(sc, kit) {
    const identity = startOf(sc);
    const state = stateOf(kit, identity);
    const fills = (svg) => new Map([...svg.matchAll(/data-facelet="(\d+)"[^>]*fill="([^"]+)"/g)].map(([, i, fill]) => [Number(i), fill]));
    for (const scheme of sc.schemes) {
      const colours = paletteFor(STICKER_PALETTES.muted, scheme);
      const net = fills(kit.netSvg(state, { scheme }));
      assert.equal(net.size, 54, `${sc.id}: the net drew ${net.size} stickers`);
      for (const [i, fill] of net) assert.equal(fill, colours[identity[i]], `${sc.id} ${scheme}: net sticker ${i}`);
      const top = fills(kit.topFaceSvg(state, { scheme, ring: true }));
      assert.equal(top.size, 21, `${sc.id}: the case diagram drew ${top.size} stickers`);
      for (const [i, fill] of top) assert.equal(fill, colours[identity[i]], `${sc.id} ${scheme}: diagram sticker ${i}`);
    }
  },

  // Plan item 5.2: a page's count of pieces away from home comes from the model — the child's moves through the
  // interpreter and `piecesAway` — and counts lesson 2's rule: out of the slot, or in it the wrong way round.
  // cubejs, which shares no code with either, decides the number at every position.
  'piece-state'(sc, kit) {
    const moves = kit.parse(sc.moves);
    const cube = new Cube();
    for (let k = 0; k <= moves.length; k++) {
      if (k > 0) cube.move(sc.moves.split(' ')[k - 1]);
      let away = 0;
      for (let i = 0; i < 8; i++) if (cube.cp[i] !== i || cube.co[i] !== 0) away++;
      for (let i = 0; i < 12; i++) if (cube.ep[i] !== i || cube.eo[i] !== 0) away++;
      const state = kit.run(moves.slice(0, k), ['U', 'F'], kit.SOLVED).state;
      assert.equal(kit.piecesAway(state).pieces.length, away, `${sc.id}: pieces away after ${k} moves`);
    }
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

/**
 * The player half's kinds that need a drawing, and so run in `test/browser/tutorial-scenarios.test.mjs`.
 * Every other player kind runs in node, from `PLAYER_RUNNERS`. The corpus checks that each kind has
 * exactly one home, because a scenario neither suite claims is one nobody runs — and it would not say so.
 */
export const BROWSER_PLAYER_KINDS = Object.freeze(['episode-hold-timeline', 'walk-stops', 'walk-reports', 'timed-trailing-rotation']);

/** The player half's runners that need no element. Written against `kit` alone, like the model's. */
export const PLAYER_RUNNERS = Object.freeze({
  // R9: a cue written once and inherited binds ONCE, where it was written. Three positions after the
  // directive, the cue in force still names the pieces it named there — not whatever has moved into
  // its slot since — and says so by the position it took effect at.
  'selector-provenance'(sc, kit) {
    const built = kit.buildScript({
      schema: 2,
      steps: [
        { move: sc.moves, focus: sc.selector, hl: sc.selector, say: 'watch this piece' },
        { move: 'U', say: 'keep watching' },
        { move: "U'", say: 'still the same piece' },
        { move: "R'", say: 'and back' },
      ],
    });
    const bound = built.positions[1];
    const views = built.positions.slice(1).map((p) => kit.viewAtPosition(built, p.index));
    for (const view of views) {
      assert.equal(view.bound.focus.at, bound.index, `${sc.id}: focus took effect at ${view.bound.focus.at}, not at its directive`);
      assert.equal(view.cues.focus, views[0].cues.focus, `${sc.id}: the inherited focus was re-bound at position ${view.position}`);
    }
    // The piece it binds is the one in the slot WHEN IT WAS WRITTEN, which the oracle says independently.
    const world = play(SOLVED_FACELETS, 'U F', sc.moves).worlds.at(-1);
    const [, where] = sc.selector.split(':');
    const letters = [...where].map((face) => world[stickerOn(face, where)]).join('');
    assert.equal(views[0].cues.focus, `piece:${pieceName(letters)}`, `${sc.id}: bound to the wrong piece`);
    // And a later position, where a different piece sits in that slot, still names the first one.
    const later = play(SOLVED_FACELETS, 'U F', `${sc.moves} U`).worlds.at(-1);
    const nowThere = [...where].map((face) => later[stickerOn(face, where)]).join('');
    assert.notEqual(pieceName(nowThere), pieceName(letters), `${sc.id}: precondition — the slot's occupant changes`);
  },
});

/**
 * A scenario as a SCRIPT (plan item 3.1): the same tutorial, written in the format both drivers read.
 *
 * This is what "every scenario is expressible" means, and it is a conversion rather than a
 * transcription: a script's moves are the CHILD's letters, so the scenarios written the way
 * `<cubus-cube>`'s `alg` reads them — the cube's own frame, whatever the hold — are relabelled
 * through the interpreter on the way in. A scenario nothing can express comes back null, and the
 * corpus says which ones those are rather than skipping them quietly.
 */
export function scriptFor(sc, kit) {
  const hold = sc.start?.hold ?? sc.orientation ?? sc.hold ?? 'U F';
  const identityFramed = sc.kind === 'identity' || sc.kind === 'identity-all-holds';
  const held = (alg) => (identityFramed
    ? alg.trim().split(/\s+/).filter(Boolean).map((t) => t.replace(/^[URFDLB]/, (f) => kit.heldFace(f, hold.split(' ')))).join(' ')
    : alg);
  const algs = sc.algs ?? sc.walks ?? [sc.moves ?? sc.alg ?? sc.planned].filter(Boolean);
  if (!algs.length && !sc.selector && !sc.ask && !sc.holds && !sc.start?.setup && !sc.table && !sc.palettes) return null;
  const start = {};
  if (sc.start?.setup) start.scramble = sc.start.setup;
  const steps = [];
  if (sc.selector) steps.push({ hl: sc.selector, say: 'the piece this lesson is about' });
  for (const alg of algs) steps.push({ move: held(alg), say: 'watch this' });
  if (sc.ask) steps.push({ ask: sc.ask, hl: `ask:${sc.ask}`, say: 'which ones are these?' });
  // A lesson about the letters: the same cube held several ways, the letters on.
  for (const [k, h] of (sc.holds ?? []).entries()) steps.push({ hold: h, say: 'which face is on top?', ...(k === 0 ? { labels: 'position' } : {}) });
  if (sc.kind === 'arrow') steps.forEach((step) => { if (step.move) step.arrow = 'next'; });
  // A gallery: a cut to each case's cube in turn — the position its algorithm solves, stated as a setup.
  for (const { name, alg } of CASE_TABLES[sc.table] ?? []) {
    const inverse = alg.trim().split(/\s+/).reverse().map((t) => (t.endsWith("'") ? t.slice(0, -1) : t.endsWith('2') ? t : `${t}'`)).join(' ');
    steps.push({ setup: inverse, say: name });
  }
  // A cube and nothing done to it — a sheet's picture: the page draws the view's cube flat.
  if (!steps.length) steps.push({ say: 'this is the cube' });
  return { schema: 2, start: { ...start, hold }, steps };
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
