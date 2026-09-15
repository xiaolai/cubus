// Which pieces a highlight names — the selector half of <cubus-cube>'s highlight channel.
//
// Pure on purpose, and free of three.js. The renderer applies the pulse, but WHICH pieces pulse is
// a question about a cube, answerable from cubie positions and sticker letters alone. Keeping that
// half here is what lets it be tested in plain node: the renderer needs a WebGL context and cannot
// be. Same split `cube-frame.js` and `cube-pieces.js` already make.
//
// Two ways to name a piece, and the difference between them is the whole point:
//
//   slot:UF    whatever piece is sitting in the UF position right now
//   piece:UF   the UF piece itself, wherever the scramble threw it
//
// A lesson needs both — "the top-front position" and "the white-green edge" are different
// sentences — and conflating them is how a tutorial ends up pointing at the wrong cubie the
// moment anyone scrambles.
//
// AND ONE STICKER OF A PIECE (plan item 4.1 of dev-docs/tutorial-capability-plan.md), in the same two
// ways — "the sticker on top" and "the green sticker" are different sentences too:
//
//   slot:UF/U    the sticker in the UF position that faces U, whichever piece that is
//   piece:UF/F   the UF piece's own F sticker, wherever it has gone and whichever way it faces
//
// And SETS, read left to right: `,` and `+` add, `-` takes away. `layer:U - corners` is the top layer's
// edges and centre; `edges - layer:U + slot:UF` is every edge off the top layer, and UF put back.

/** Face letter -> which coordinate it fixes, and to what. */
const FACE_AXIS = { R: [0, 1], L: [0, -1], U: [1, 1], D: [1, -1], F: [2, 1], B: [2, -1] };

/** How many of a cubie's coordinates are non-zero: 1 a centre, 2 an edge, 3 a corner. True by
 *  construction — the renderer builds every cubie of the 3x3x3 except the core — which is why
 *  "six centres, twelve edges, eight corners" needs no piece table to answer. */
export const KIND = Object.freeze({ centers: 1, edges: 2, corners: 3 });

/**
 * The position a face-letter name points at: 'UF' -> [0, 1, 1], 'URF' -> [1, 1, 1].
 * Null when the letters name nothing that exists on a cube.
 */
export function slotVector(letters) {
  const s = String(letters ?? '').toUpperCase();
  if (!/^[URFDLB]{1,3}$/.test(s)) return null;
  const pos = [0, 0, 0];
  const used = new Set();
  for (const ch of s) {
    const [axis, sign] = FACE_AXIS[ch];
    // One coordinate per axis. 'UU' names a piece twice over, and 'UD' names one with stickers on
    // opposite faces — which no cubie has. Both land here rather than silently resolving to
    // whichever letter happened to be written last.
    if (used.has(axis)) return null;
    used.add(axis);
    pos[axis] = sign;
  }
  return pos;
}

/**
 * A piece's identity key, order-independent: 'UF' and 'FU' are the same edge.
 *
 * The order matters because nothing guarantees one. A cubie's letters are collected in the order
 * its sticker meshes were built, which is an artifact of the renderer's build loop and not a fact
 * about the piece — so both the stamp and the selector are sorted, and the comparison is honest.
 */
export function pieceKey(letters) {
  if (slotVector(letters) === null) return null;
  return [...String(letters).toUpperCase()].sort().join('');
}

/** One selector token -> a selector, or null when it names nothing. */
function parseToken(tok) {
  // hasOwn, never `tok in KIND`: the token is whatever an author typed, and 'constructor' would
  // otherwise resolve to a function and be treated as a piece kind.
  if (Object.hasOwn(KIND, tok)) return { kind: KIND[tok], token: tok };
  const m = /^(layer|slot|piece):([URFDLB]{1,3})(?:\/([URFDLB]))?$/i.exec(tok);
  if (!m) return null;
  const what = m[1].toLowerCase();
  const arg = m[2].toUpperCase();
  if (m[3] !== undefined) {
    // A STICKER. Its face must be one of the piece's or the slot's own — `slot:UF/R` names a sticker no
    // cubie has — and a layer has no one sticker to name.
    const face = m[3].toUpperCase();
    if (what === 'layer' || !arg.includes(face)) return null;
    if (what === 'slot') {
      const pos = slotVector(arg);
      return pos && { slot: pos, facing: face, token: tok };
    }
    const key = pieceKey(arg);
    return key && { piece: key, face, token: tok };
  }
  if (what === 'layer') {
    if (arg.length !== 1) return null; // a layer is one face, not a piece name
    // Copied, never shared. FACE_AXIS is module state, so handing out the live array lets a
    // caller who mutates its own selector corrupt slotVector() for every later call in the
    // process — 'UF' would start resolving to a position that is not UF.
    return { layer: [...FACE_AXIS[arg]], token: tok };
  }
  if (what === 'slot') {
    const pos = slotVector(arg);
    return pos && { slot: pos, token: tok };
  }
  const key = pieceKey(arg);
  return key && { piece: key, token: tok };
}

/**
 * Parse a highlight attribute: comma-separated selectors, unioned.
 *
 *   centers | edges | corners     by piece kind
 *   layer:U                       every cubie in a layer
 *   slot:UF                       by position
 *   piece:UF                      by identity
 *
 * Whole-or-nothing, the same stance `<cubus-cube>`'s alg parser takes: a spec with one bad token
 * is a bad spec. Highlighting the tokens that happened to parse would point at a subset nobody
 * asked for, and a tutorial that quietly highlights the wrong pieces is worse than one that
 * highlights none and says why.
 *
 * Returns `{ selectors, invalid }`. `invalid` is the offending token, so the caller can name it.
 */
export function parseHighlight(spec) {
  const raw = String(spec ?? '').trim();
  if (!raw || raw === 'none') return { selectors: [], invalid: null };
  const selectors = [];
  // Operators and tokens in the order written. Each selector carries the operator before it (`+` for the
  // first), so a resolver applies them left to right and a caller that only reads the list still has them.
  const parts = raw.split(/\s*([,+-])\s*/);
  let op = '+';
  for (const part of parts) {
    if (part === ',' || part === '+') { op = '+'; continue; }
    if (part === '-') { op = '-'; continue; }
    if (!part) continue;
    const sel = parseToken(part);
    if (!sel) return { selectors: [], invalid: part };
    // A set that begins by taking away has nothing to take from: `- corners` is a typo, not a selection.
    if (!selectors.length && op === '-') return { selectors: [], invalid: raw };
    selectors.push({ ...sel, op });
    op = '+';
  }
  return { selectors, invalid: null };
}

/**
 * Does `sel` name this cubie? `cubie` is `{ pos: [x, y, z], piece: key | null }`.
 *
 * A sticker selector names the cubie its sticker is on: this is the cubie-level question, and
 * `selectsSticker` is the finer one.
 */
export function selects(sel, cubie) {
  const [x, y, z] = cubie.pos;
  if (sel.kind !== undefined) return Math.abs(x) + Math.abs(y) + Math.abs(z) === sel.kind;
  if (sel.layer) return cubie.pos[sel.layer[0]] === sel.layer[1];
  if (sel.slot) return sel.slot[0] === x && sel.slot[1] === y && sel.slot[2] === z;
  // A cube with unread stickers has no identity for that piece, so `piece:` matches nothing rather
  // than guessing at one. The caller reports the empty selector; see `empty` below.
  return cubie.piece != null && cubie.piece === sel.piece;
}

/**
 * Resolve selectors against the cubies, as indices into `cubies`.
 *
 * `empty` lists the tokens that matched no cubie at all. Only `piece:` can do that — every other
 * selector matches a fixed count by construction — and it means the cube's identity is unknown
 * (an unscanned face) rather than that the author mistyped, since a mistyped token would have been
 * refused at parse time. Reported rather than swallowed: a highlight that silently does nothing is
 * exactly the quiet failure this codebase keeps having to dig back out.
 */
export function resolveHighlight(selectors, cubies) {
  const indices = [];
  const hit = new Array(selectors.length).fill(false);
  for (let i = 0; i < cubies.length; i++) {
    let on = false;
    for (let s = 0; s < selectors.length; s++) {
      const sel = selectors[s];
      if (!selects(sel, cubies[i])) continue;
      hit[s] = true;
      // Taking away a sticker leaves the rest of its cubie lit, so only a whole-cubie selector takes a
      // cubie away at this level; `resolveStickers` is where one sticker comes off.
      if (sel.op === '-') { if (!isSticker(sel)) on = false; } else on = true;
    }
    if (on) indices.push(i);
  }
  const empty = selectors.filter((_, s) => !hit[s]).map((sel) => sel.token);
  return { indices, empty };
}

const isSticker = (sel) => sel.facing !== undefined || sel.face !== undefined;

/**
 * Does `sel` name this sticker of this cubie? `sticker` is `{ face, dir }`: the face it was painted for
 * (its colour, on a cube built from moves) and the direction it faces now.
 */
export function selectsSticker(sel, cubie, sticker) {
  if (!selects(sel, cubie)) return false;
  if (sel.facing !== undefined) return sticker.dir === sel.facing;
  if (sel.face !== undefined) return sticker.face === sel.face;
  return true;
}

/**
 * Resolve selectors to STICKERS, as `[cubieIndex, stickerIndex]` pairs, the operators applied left to
 * right. `cubies[i].stickers` is the cubie's stickers as `selectsSticker` reads them.
 */
export function resolveStickers(selectors, cubies) {
  const stickers = [];
  const hit = new Array(selectors.length).fill(false);
  cubies.forEach((cubie, i) => {
    (cubie.stickers ?? []).forEach((sticker, j) => {
      let on = false;
      selectors.forEach((sel, s) => {
        if (!selectsSticker(sel, cubie, sticker)) return;
        hit[s] = true;
        on = sel.op !== '-';
      });
      if (on) stickers.push([i, j]);
    });
  });
  const empty = selectors.filter((_, s) => !hit[s]).map((sel) => sel.token);
  return { stickers, empty };
}
