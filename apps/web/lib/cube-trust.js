// The tracking offset — how a smart cube is repaired without being solved.
//
// A smart cube does not know its arrangement. It knows how far it has been turned since someone
// last told it where it was. Break the chain — disconnect, sleep, flat battery — turn the cube,
// and it resumes reporting a state that is confidently and silently wrong.
//
// The old repair was "solve it, then re-anchor". For this app's audience that is not a recovery
// path at all: a beginner who could solve the cube would not need the app, and this is precisely
// where a new player gives up.
//
// There is a better one. When the chain breaks, the physical cube and the cube's own tracking
// differ by a CONSTANT permutation, and one camera scan is enough to pin it down:
//
//     offset = scanned · reported⁻¹      derived once, at repair time
//     truth  = offset · reported         applied to every report thereafter
//
// Why it stays constant: let H be the turns made before the break, D the turns made while nobody
// was counting, and M any turns made afterwards. Physically the cube is at H·D·M; it reports H·M.
// So truth = offset · reported requires offset = H·D·H⁻¹ — fixed the moment H and D are, and
// exactly what scanned·reported⁻¹ evaluates to at repair time.
//
// Pure: no DOM, no globals. cubejs is INJECTED rather than imported, so this file is testable in
// Node under `node --test` exactly like packages/*/src, and so the app keeps one cubejs instance.

/** The solved cube. Also the identity offset: correcting by it changes nothing. */
export const IDENTITY = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';

const FACELET_RE = /^[URFDLB]{54}$/;

/** Is `arr` a permutation of 0..n-1?
 *
 *  Indexed rather than iterated. `for…of`, `every` and `reduce` all SKIP holes in a sparse array,
 *  so `Object.assign([], {length: 8})` would sail through every check below while carrying no
 *  values at all. */
function isPermutation(arr, n) {
  if (!Array.isArray(arr) || arr.length !== n) return false;
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    const v = arr[i];
    if (!Number.isInteger(v) || v < 0 || v >= n || seen.has(v)) return false;
    seen.add(v);
  }
  return true;
}

/** Sum of a dense array of integers, or NaN if it is not one. Same reason as above: `reduce`
 *  skips holes, so a sparse array would sum to a plausible number. */
function denseSum(arr, n, hi) {
  if (!Array.isArray(arr) || arr.length !== n) return Number.NaN;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const v = arr[i];
    if (!Number.isInteger(v) || v < 0 || v >= hi) return Number.NaN;
    total += v;
  }
  return total;
}

/** Which face each centre must show. Centres never move under URFDLB notation, so a state whose
 *  centres are not these is not in the frame the whole app is written in. */
const CENTRES = [[4, 'U'], [13, 'R'], [22, 'F'], [31, 'D'], [40, 'L'], [49, 'B']];

/** The STRUCTURAL half of the gate: right alphabet and length, nine of each colour, centres
 *  pinned — everything checkable without the cube library. Exported for callers that must refuse
 *  a non-state before the (lazily loaded) library exists — the registry parse at boot — or that
 *  guard a path where the library is optional, like the confirmation's candidate. toCube() runs
 *  this first, so the exported check and the full gate can never drift apart. */
export function looksLikeCubeState(facelets) {
  if (typeof facelets !== 'string' || !FACELET_RE.test(facelets)) return false;
  const counts = new Map();
  for (const ch of facelets) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  for (const n of counts.values()) if (n !== 9) return false;
  for (const [i, face] of CENTRES) if (facelets[i] !== face) return false;
  return true;
}

/**
 * Can this arrangement be reached by turning a real cube?
 *
 * cubejs does NOT check: `Cube.fromString('nonsense')` returns a cube-shaped object rather than
 * throwing. Everything downstream would then be quietly wrong, so the check happens here.
 *
 * The classical four conditions — corners and edges each permuted, corner twists summing to zero
 * mod 3, edge flips to zero mod 2, equal permutation parities — are complete only ONCE the state
 * has been decoded correctly and its centres pinned. Both of those happen in toCube() before this
 * runs, and neither is optional: without them these four checks pass for cubes that cannot exist.
 */
function isSolvable(c) {
  if (!c || !isPermutation(c.cp, 8) || !isPermutation(c.ep, 12)) return false;
  const twist = denseSum(c.co, 8, 3);
  const flip = denseSum(c.eo, 12, 2);
  if (!Number.isFinite(twist) || twist % 3 !== 0) return false;
  if (!Number.isFinite(flip) || flip % 2 !== 0) return false;
  // Centres are read by invert(), so they have to be a permutation too — and in this app's frame,
  // the identity one. Swapping two centres otherwise passes every other check here.
  if (!isPermutation(c.center, 6)) return false;
  for (let i = 0; i < 6; i++) if (c.center[i] !== i) return false;
  if (typeof c.cornerParity !== 'function' || typeof c.edgeParity !== 'function') return false;
  // The results validated, not just compared: two equal GARBAGE values (99 === 99, undefined ===
  // undefined) would otherwise pass the parity gate for a cube that cannot exist.
  const cp = c.cornerParity();
  const ep = c.edgeParity();
  if ((cp !== 0 && cp !== 1) || (ep !== 0 && ep !== 1)) return false;
  return cp === ep;
}

/** Is the injected library one we can actually use? Both halves are needed: `fromString` to read
 *  a state, and the constructor itself to build the inverse. Checking only the first let a plain
 *  object through as far as `new Cube()`, where it threw a TypeError out of a function documented
 *  to return `string | null` — a caller reading the docs would not have caught it. */
function usable(Cube) {
  // In a try: `Cube.fromString` is a property READ, and a hostile or broken library can define it
  // as a throwing getter — which escaped both exported functions before this guard was inside one.
  try {
    return typeof Cube === 'function' && typeof Cube.fromString === 'function';
  } catch { return false; }
}

/** Every check a facelet string must survive before any cube maths runs on it. Null, never a
 *  half-checked object — an unusable input must produce nothing rather than a plausible-looking
 *  wrong answer, which is the entire reason this module exists. */
function toCube(facelets, Cube) {
  if (!usable(Cube)) return null;
  // Structure first — including the centres, which pin the frame: a state whose centres have
  // moved is not one this app's URFDLB notation can describe.
  if (!looksLikeCubeState(facelets)) return null;

  try {
    const cube = Cube.fromString(facelets);
    // THE round-trip. cubejs does not report a failed decode: handed a triple it does not
    // recognise, it leaves that cubie at its SOLVED default and returns a cube-shaped object with
    // no complaint. An earlier version of this file assumed a sentinel and checked only the
    // permutation, which let 579 of the 1215 two-sticker transpositions of a solved cube through —
    // 412 of them deriving the IDENTITY offset, i.e. silently reporting "nothing to correct" for a
    // cube that cannot exist. Re-serialising is what makes a dropped cubie visible.
    if (cube?.asString?.() !== facelets) return null;
    return isSolvable(cube) ? cube : null;
  } catch {
    // Parsing and validation are guarded together: a throwing getter or parity method would
    // otherwise escape a function documented to return null.
    return null;
  }
}

/**
 * The inverse of a cube state, computed directly from its permutation.
 *
 * NOT via `solve()`. Solving would work, but Kociemba solvers assume solvable input and can run
 * unboundedly on anything else — a search on the repair path, in an app whose whole point is that
 * repair must be cheap. Inverting a permutation is a fixed, bounded number of array writes and
 * cannot hang, whatever it is handed.
 *
 * Only ever called on a state toCube() has already validated, which is what makes indexing into
 * cp/ep here safe.
 */
function invert(c, Cube) {
  const o = new Cube();
  for (let i = 0; i < 8; i++) { o.cp[c.cp[i]] = i; o.co[c.cp[i]] = (3 - c.co[i]) % 3; }
  for (let i = 0; i < 12; i++) { o.ep[c.ep[i]] = i; o.eo[c.ep[i]] = c.eo[i]; }
  for (let i = 0; i < c.center.length; i++) o.center[c.center[i]] = i;
  return o;
}

/** Is this string a real, reachable cube arrangement? The full gate deriveOffset and applyOffset
 *  put their own inputs through — round-trip included — exported for callers that must refuse a
 *  forged state without wanting an offset: the remembered-arrangement record (cube-registry.js)
 *  and the reconnect readings (cube-reconnect.js) are both parsed with exactly this check, so a
 *  string they accept and a string this module accepts can never drift apart. */
export function isCubeState(facelets, Cube) {
  return toCube(facelets, Cube) !== null;
}

/** Is this offset a no-op? A missing offset and the solved one mean the same thing: nothing to
 *  correct. One predicate, so the two can never be treated differently by accident.
 *
 *  The absent values are named rather than tested for falsiness: `!offset` would also swallow
 *  `false`, `0` and `NaN`, none of which mean "no correction" and all of which indicate a caller
 *  bug worth surfacing rather than absorbing. */
export function isIdentity(offset) {
  return offset === null || offset === undefined || offset === '' || offset === IDENTITY;
}

/**
 * The constant correction between what the cube reports and what it physically is.
 *
 * @param {string} scanned   what the camera established — the truth, right now
 * @param {string} reported  what the cube claimed at the same moment
 * @param {Function} Cube    the cubejs constructor, injected
 * @returns {string|null} offset facelets, or null if either input is unusable
 */
export function deriveOffset(scanned, reported, Cube) {
  const s = toCube(scanned, Cube);
  const r = toCube(reported, Cube);
  if (!s || !r) return null;
  try {
    return multiplyToState(s, invert(r, Cube), Cube);
  } catch { return null; }
}

/** left · right, serialised and re-validated — the shared last step of both trust operations,
 *  one body so the two cannot drift. The product is itself a cube state, and everything
 *  downstream assumes so: validated with the SAME function the inputs went through, not a looser
 *  regex — an alphabet-and-length check would accept a wrong colour count, moved centres, or an
 *  object whose toString() merely looks like facelets, and would then escape a function
 *  documented as string|null. Null on anything unusable, including a throw mid-multiply. */
function multiplyToState(left, right, Cube) {
  try {
    left.multiply(right);
    const out = left.asString();
    return toCube(out, Cube) ? out : null;
  } catch { return null; }
}

/**
 * Correct one cube report.
 *
 * @returns the cube's true arrangement, or **null** when it could not be established.
 *
 * Null matters, and this used to return `reported` instead. That failed OPEN: with a correction
 * active, the raw report is precisely the value the offset exists to say is NOT true, and handing
 * it back is indistinguishable from a successful correction. The caller then treats a known-wrong
 * arrangement as the cube's position — the exact failure this whole module was written to prevent,
 * reintroduced at the last step.
 *
 * A report that cannot be validated is also null, offset or no offset. Nothing downstream should
 * proceed on a string that is not a cube.
 */
export function applyOffset(offset, reported, Cube) {
  const rep = toCube(reported, Cube);
  if (!rep) return null;
  if (isIdentity(offset)) return reported;
  const off = toCube(offset, Cube);
  if (!off) return null;
  return multiplyToState(off, rep, Cube);
}
