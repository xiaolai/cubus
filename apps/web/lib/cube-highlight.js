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
  const m = /^(layer|slot|piece):([URFDLB]{1,3})$/i.exec(tok);
  if (!m) return null;
  const what = m[1].toLowerCase();
  const arg = m[2].toUpperCase();
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
  for (const tok of raw.split(',').map((t) => t.trim()).filter(Boolean)) {
    const sel = parseToken(tok);
    if (!sel) return { selectors: [], invalid: tok };
    selectors.push(sel);
  }
  return { selectors, invalid: null };
}

/** Does `sel` name this cubie? `cubie` is `{ pos: [x, y, z], piece: key | null }`. */
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
      if (selects(selectors[s], cubies[i])) {
        on = true;
        hit[s] = true;
      }
    }
    if (on) indices.push(i);
  }
  const empty = selectors.filter((_, s) => !hit[s]).map((sel) => sel.token);
  return { indices, empty };
}
