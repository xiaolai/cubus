// The highlight selector, checked without a browser — which is the reason the selector lives in
// its own module at all (lib/cube-highlight.js; the renderer that applies it needs WebGL).
//
// The load-bearing claim is the piece-kind parity: "six centres, twelve edges, eight corners" is
// answered by counting a cubie's non-zero coordinates, with no piece table anywhere. That holds
// only because the renderer builds every cubie of the 3x3x3 except the core, so the test builds
// the same 26 and checks the three counts AND that they partition the set — a parity rule that
// counted 6/12/8 but left a cubie unclaimed would be wrong in a way the counts alone would miss.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  KIND,
  parseHighlight,
  pieceKey,
  resolveHighlight,
  selects,
  slotVector,
} from '../lib/cube-highlight.js';

/** The 26 cubies a solved cube presents, in the renderer's own build order. */
function solvedCubies() {
  const out = [];
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        if (!x && !y && !z) continue;
        const letters = [
          x === 1 ? 'R' : x === -1 ? 'L' : '',
          y === 1 ? 'U' : y === -1 ? 'D' : '',
          z === 1 ? 'F' : z === -1 ? 'B' : '',
        ].join('');
        out.push({ pos: [x, y, z], piece: pieceKey(letters) });
      }
    }
  }
  return out;
}

const resolve = (spec, cubies = solvedCubies()) => {
  const { selectors, invalid } = parseHighlight(spec);
  assert.equal(invalid, null, `expected "${spec}" to parse`);
  return resolveHighlight(selectors, cubies);
};

test('a cube has six centres, twelve edges and eight corners', () => {
  const cubies = solvedCubies();
  assert.equal(cubies.length, 26);
  assert.equal(resolve('centers', cubies).indices.length, 6);
  assert.equal(resolve('edges', cubies).indices.length, 12);
  assert.equal(resolve('corners', cubies).indices.length, 8);
});

test('the three kinds partition every cubie, leaving none unclaimed', () => {
  const cubies = solvedCubies();
  const all = resolve('centers,edges,corners', cubies).indices;
  assert.equal(all.length, cubies.length);
  assert.deepEqual(all, [...Array(cubies.length).keys()]);
});

test('a union counts a cubie once, not once per matching selector', () => {
  // `corners` and `layer:U` overlap on four cubies. 8 + 9 - 4 = 13.
  assert.equal(resolve('corners,layer:U').indices.length, 13);
});

test('a layer is nine cubies', () => {
  for (const face of ['U', 'D', 'R', 'L', 'F', 'B']) {
    assert.equal(resolve(`layer:${face}`).indices.length, 9, `layer:${face}`);
  }
});

test('a slot names exactly one cubie, at the position its letters spell', () => {
  assert.deepEqual(slotVector('UF'), [0, 1, 1]);
  assert.deepEqual(slotVector('URF'), [1, 1, 1]);
  assert.deepEqual(slotVector('U'), [0, 1, 0]);
  assert.deepEqual(slotVector('DBL'), [-1, -1, -1]);

  const cubies = solvedCubies();
  const { indices } = resolve('slot:UF', cubies);
  assert.equal(indices.length, 1);
  assert.deepEqual(cubies[indices[0]].pos, [0, 1, 1]);
});

test('letters that name no real cubie are refused, not coerced', () => {
  assert.equal(slotVector('UD'), null, 'opposite faces are not one piece');
  assert.equal(slotVector('UU'), null, 'the same face twice is not one piece');
  assert.equal(slotVector('RL'), null);
  assert.equal(slotVector('URFD'), null, 'no cubie has four stickers');
  assert.equal(slotVector(''), null);
  assert.equal(slotVector('X'), null);
  assert.equal(slotVector(null), null);
});

test('piece identity is order-independent, because sticker order is an artifact', () => {
  assert.equal(pieceKey('UF'), pieceKey('FU'));
  assert.equal(pieceKey('URF'), pieceKey('FRU'));
  assert.equal(pieceKey('URF'), pieceKey('RUF'));
  assert.notEqual(pieceKey('UF'), pieceKey('UR'));
});

test('slot: and piece: disagree on a scrambled cube — which is the whole point', () => {
  // UF and DR have traded places. Swapped rather than overwritten: every identity still appears
  // exactly once, because a cube cannot hold two of the same edge — an earlier version of this
  // fixture wrote DR into the UF slot and left the real DR where it was, and the selector
  // correctly found both.
  const at = (cubies, letters) => cubies.findIndex((c) => {
    const want = slotVector(letters);
    return c.pos[0] === want[0] && c.pos[1] === want[1] && c.pos[2] === want[2];
  });
  const cubies = solvedCubies();
  const uf = at(cubies, 'UF');
  const dr = at(cubies, 'DR');
  cubies[uf] = { ...cubies[uf], piece: pieceKey('DR') };
  cubies[dr] = { ...cubies[dr], piece: pieceKey('UF') };

  // "the top-front position" — the slot, whoever is in it
  assert.deepEqual(resolve('slot:UF', cubies).indices, [uf]);
  assert.equal(cubies[uf].piece, pieceKey('DR'));

  // "the white-green edge" — the piece, wherever it went
  assert.deepEqual(resolve('piece:DR', cubies).indices, [uf], 'the DR edge is up in the UF slot');
  assert.deepEqual(resolve('piece:UF', cubies).indices, [dr], 'the UF edge has gone down to DR');

  // Identity is unique: exactly one cubie answers to each.
  for (const spec of ['piece:UF', 'piece:DR']) {
    assert.equal(resolve(spec, cubies).indices.length, 1, spec);
  }
});

test('an unread cube matches no piece: selector, and says so', () => {
  const cubies = solvedCubies().map((c) => ({ ...c, piece: null }));
  const { indices, empty } = resolve('piece:UF', cubies);
  assert.deepEqual(indices, []);
  assert.deepEqual(empty, ['piece:UF'], 'an empty selector is reported, not swallowed');
});

test('a selector that matched something is not reported as empty', () => {
  assert.deepEqual(resolve('edges').empty, []);
  assert.deepEqual(resolve('piece:UF').empty, []);
});

test('one bad token refuses the whole spec', () => {
  // Whole-or-nothing, the stance the alg parser takes: highlighting the half that parsed would
  // point at a set nobody asked for, and a lesson pointing at the wrong pieces is worse than one
  // pointing at none.
  const { selectors, invalid } = parseHighlight('edges,slot:UD,corners');
  assert.deepEqual(selectors, []);
  assert.equal(invalid, 'slot:UD');
});

test('the invalid token is named, so the warning can say which one', () => {
  assert.equal(parseHighlight('nonsense').invalid, 'nonsense');
  assert.equal(parseHighlight('edges,layer:UF').invalid, 'layer:UF', 'a layer is one face');
  assert.equal(parseHighlight('slot:').invalid, 'slot:');
  assert.equal(parseHighlight('edges,,corners').invalid, null, 'empty items are skipped, not fatal');
});

test('an empty or absent spec selects nothing and is not an error', () => {
  for (const spec of ['', '   ', 'none', null, undefined]) {
    const { selectors, invalid } = parseHighlight(spec);
    assert.deepEqual(selectors, [], `spec ${JSON.stringify(spec)}`);
    assert.equal(invalid, null);
  }
});

test('inherited object keys are not piece kinds', () => {
  // `tok in KIND` would resolve 'constructor' to a function and treat it as a selector.
  for (const tok of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    assert.equal(parseHighlight(tok).invalid, tok, tok);
  }
  assert.deepEqual(Object.keys(KIND), ['centers', 'edges', 'corners']);
});

test('prefixes and face letters are case-insensitive, kind words are not', () => {
  assert.deepEqual(resolve('SLOT:uf').indices, resolve('slot:UF').indices);
  assert.deepEqual(resolve('Piece:Uf').indices, resolve('piece:UF').indices);
  // Kind words stay exact: they are a closed vocabulary, and accepting 'Edges' invites 'EDGE'.
  assert.equal(parseHighlight('Edges').invalid, 'Edges');
});

test('selects() reads position parity directly, with no lookup table', () => {
  assert.equal(selects({ kind: KIND.centers }, { pos: [0, 1, 0], piece: 'U' }), true);
  assert.equal(selects({ kind: KIND.edges }, { pos: [0, 1, 1], piece: 'FU' }), true);
  assert.equal(selects({ kind: KIND.corners }, { pos: [1, 1, 1], piece: 'FRU' }), true);
  assert.equal(selects({ kind: KIND.edges }, { pos: [1, 1, 1], piece: 'FRU' }), false);
});

test('a layer selector does not hand out the module\'s own axis table', () => {
  // parseToken used to return FACE_AXIS[arg] directly. A caller who mutated its own selector then
  // corrupted the table for every later call in the process — 'UF' would stop resolving to UF.
  const { selectors } = parseHighlight('layer:U');
  assert.deepEqual(selectors[0].layer, [1, 1]);
  selectors[0].layer[1] = -1;
  assert.deepEqual(slotVector('UF'), [0, 1, 1], 'the shared table must be unharmed');
  assert.deepEqual(parseHighlight('layer:U').selectors[0].layer, [1, 1], 'and a fresh parse too');
});
