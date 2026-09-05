// Our own two-phase solver — Kociemba's algorithm, implemented from the published method.
//
// This replaces the vendored min2phase. Why: dev-docs/two-phase-plan.md (an unresolved licence
// contradiction in code that ships). What was and was not consulted while writing it:
// dev-docs/two-phase-provenance.md — the method is public and decades old, and no existing
// solver's source was opened for this file.
//
// The algorithm, in one paragraph: phase 1 drives the cube into the subgroup
// G1 = ⟨U, D, L2, R2, F2, B2⟩ — every corner untwisted, every edge unflipped, the four E-slice
// edges somewhere in their slice. Phase 2 finishes inside G1, where only those ten moves are
// needed. Each phase searches over COORDINATES: the state is projected onto small integers, a
// move becomes a table lookup, and pruning tables over coordinate pairs give IDA* its lower
// bound. Tables are megabytes, not gigabytes — the largest dimension is 8! = 40,320.
//
// The state model is cube-pieces.js's {cp, co, ep, eo} — cubejs's ordering, which is Kociemba's.
// Every move table below is COMPOSED from cube-pieces' MOVES rather than typed here, and
// two-phase.test.mjs re-checks every one of the 18 moves against cube-pieces on random states.
// That test is not ceremony: a wrong table still produces well-formed algs that simply do not
// solve, so the failure it guards against is silent by construction.
//
// The search's hot path allocates nothing: the DFS walks coordinate tables, and each probe
// replays its phase-1 maneuver through preallocated per-depth buffers. That is what makes a
// probe budget (~tens of thousands per tier) affordable — measured in solver-move-count.md.

import { CORNERS, EDGES, MOVES, MOVE_NAMES, SOLVED, applyMove } from './cube-pieces.js';
// One parity, not two. It was computed identically here and in random-state.js, and a cycle
// decomposition that drifted in one copy would make a legal cube unparseable or an illegal one
// parseable — silently, in the file that decides which states exist at all.
//
// This direction and not the other: random-state.js imports nothing, so the worker pays nothing
// for it, while app.js imports random-state.js for scrambles and does NOT import this module.
// Exporting the parity from here would have pulled the whole engine — tables, rotations, the DFS
// — into the main bundle to read one function, which is the duplication solver-engine.js's
// VIEW_COUNT comment already refuses for one integer.
import { permutationParity } from './random-state.js';

// ---- the move set -----------------------------------------------------------------------------

/** Move indices are positions in cube-pieces' MOVE_NAMES: faces in U,R,F,D,L,B order, each as
 *  [quarter, half, inverse quarter]. So `face = (idx / 3) | 0`, and opposite faces share an
 *  axis (U-D, R-L, F-B): `axis = face % 3`. */
export const ALL_MOVES = Object.freeze(Array.from({ length: 18 }, (_, i) => i));

/** The ten moves that exist inside G1, as indices into MOVE_NAMES. */
export const PHASE2_MOVES = Object.freeze(
  ['U', 'U2', "U'", 'R2', 'F2', 'D', 'D2', "D'", 'L2', 'B2'].map((n) => MOVE_NAMES.indexOf(n)),
);
if (PHASE2_MOVES.includes(-1)) {
  throw new Error('two-phase: cube-pieces MOVE_NAMES no longer contains the G1 move set');
}

// Table row widths, defined once beside the move sets they index. Every `coord * width + mi`
// below uses these — a literal 18 or 10 that drifted from the move lists would misindex every
// table silently.
const P1_WIDTH = ALL_MOVES.length;
const P2_WIDTH = PHASE2_MOVES.length;

/** Each move's cubie-level permutation, straight from cube-pieces — the probe path reads these
 *  rather than composing whole states, which is what keeps it allocation-free. */
const MOVE_CP = ALL_MOVES.map((m) => MOVES[MOVE_NAMES[m]].cp);
const MOVE_EP = ALL_MOVES.map((m) => MOVES[MOVE_NAMES[m]].ep);

// ---- coordinates ------------------------------------------------------------------------------
// Each is a bijection between one component of the state and [0, count), with the solved state
// at 0. rank(unrank(i)) == i for every i is asserted by the test suite, not assumed.

export const TWIST_COUNT = 2187; //  3^7 — corner orientations; the eighth twist is determined
export const FLIP_COUNT = 2048; //   2^11 — edge orientations; the twelfth flip is determined
export const SLICE_COUNT = 495; //   C(12,4) — which four slots hold the E-slice edges
export const PERM8_COUNT = 40320; // 8! — corner permutation, and U/D-edge permutation in G1
export const PERM4_COUNT = 24; //    4! — the slice edges' order among themselves, in G1

/** Corner orientation as a base-3 number over the first seven corners. */
export function twistOf(co) {
  let t = 0;
  for (let i = 0; i < 7; i++) t = t * 3 + co[i];
  return t;
}

export function twistTo(t) {
  const co = new Array(8);
  let sum = 0;
  for (let i = 6; i >= 0; i--) {
    co[i] = t % 3;
    sum += co[i];
    t = (t / 3) | 0;
  }
  co[7] = (3 - (sum % 3)) % 3; // legal states twist to a multiple of three
  return co;
}

/** Edge orientation as a base-2 number over the first eleven edges. */
export function flipOf(eo) {
  let f = 0;
  for (let i = 0; i < 11; i++) f = f * 2 + eo[i];
  return f;
}

export function flipTo(f) {
  const eo = new Array(12);
  let sum = 0;
  for (let i = 10; i >= 0; i--) {
    eo[i] = f % 2;
    sum += eo[i];
    f = (f / 2) | 0;
  }
  eo[11] = sum % 2; // legal states flip an even number of edges
  return eo;
}

/** C(n, k) for n ≤ 12, k ≤ 4 — all the binomials the slice coordinate needs. */
const CNK = (() => {
  const c = Array.from({ length: 13 }, () => new Array(5).fill(0));
  for (let n = 0; n < 13; n++) {
    c[n][0] = 1;
    for (let k = 1; k <= Math.min(n, 4); k++) c[n][k] = c[n - 1][k - 1] + c[n - 1][k];
  }
  return c;
})();

/**
 * Which four slots hold the E-slice edges (cubies 8..11), ranked so that solved — slice edges
 * at home in slots 8..11 — is 0. The order of the slice edges among themselves is deliberately
 * ignored: in phase 1 only membership matters, and 495 beats 11,880.
 */
const SLICE_MAX = SLICE_COUNT - 1; // the home set's colex rank, and the flip point

export function sliceOf(ep) {
  // Colexicographic rank of the ascending slot set {s1 < s2 < s3 < s4}: C(s1,1) + C(s2,2) +
  // C(s3,3) + C(s4,4). The home set {8,9,10,11} ranks highest at SLICE_MAX, so it is flipped
  // to 0.
  let colex = 0;
  let k = 0;
  for (let slot = 0; slot < 12; slot++) if (ep[slot] >= 8) colex += CNK[slot][++k];
  return SLICE_MAX - colex;
}

export function sliceTo(r) {
  let rem = SLICE_MAX - r;
  const slots = [];
  for (let k = 4; k >= 1; k--) {
    // The largest v with C(v, k) ≤ what remains is the k-th largest occupied slot.
    let v = k - 1;
    while (v + 1 <= 11 && CNK[v + 1][k] <= rem) v++;
    slots.push(v);
    rem -= CNK[v][k];
  }
  const ep = new Array(12).fill(-1);
  slots.sort((a, b) => a - b).forEach((s, i) => {
    ep[s] = 8 + i; // slice cubies in ascending order — sliceOf ignores their order anyway
  });
  let next = 0;
  for (let i = 0; i < 12; i++) if (ep[i] < 0) ep[i] = next++;
  return ep;
}

const FACT = [1, 1, 2, 6, 24, 120, 720, 5040]; // (n-1-i)! lookups for permutations of n ≤ 8

/** Lehmer rank of `n` entries starting at `start`, allocation-free. Only relative order
 *  matters, so it ranks slice edges 8..11 as readily as a permutation of 0..7. The identity
 *  is 0, and each position weighs by how many later entries are smaller. One implementation
 *  under every ranking below. */
function rankSpan(p, start, n) {
  const last = start + n - 1;
  let r = 0;
  for (let i = start; i <= last; i++) {
    let smaller = 0;
    for (let j = i + 1; j <= last; j++) if (p[j] < p[i]) smaller++;
    r += smaller * FACT[last - i];
  }
  return r;
}

/** Lehmer rank of a whole permutation (length ≤ 8). */
export function permRank(p) {
  return rankSpan(p, 0, p.length);
}

export function permUnrank(r, n) {
  const avail = Array.from({ length: n }, (_, i) => i);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const f = FACT[n - 1 - i];
    out[i] = avail.splice((r / f) | 0, 1)[0];
    r %= f;
  }
  return out;
}

/** The probe path's rankers: the U/D-edge (or corner) coordinate over slots 0..7, and the
 *  slice edges' order over slots 8..11. In G1 those spans hold exactly those cubies. */
const rankFirst8 = (p) => rankSpan(p, 0, 8);
const rankSlice4 = (ep) => rankSpan(ep, 8, 4);

// ---- move tables ------------------------------------------------------------------------------
// table[coord * width + mi] is the coordinate after the move at index mi of the table's move
// list. Built by unranking, applying the move at cubie level, re-ranking. The appliers below are
// cube-pieces' compose() restricted to one component — each coordinate transforms independently
// of the rest of the state, which is what the agreement test proves on full random states.

/** Slot i receives the occupant of slot mp[i] — cube-pieces' permutation composition. */
const applyPerm = (p, mp) => {
  const out = new Array(mp.length);
  for (let i = 0; i < mp.length; i++) out[i] = p[mp[i]];
  return out;
};

const applyCo = (co, m) => {
  const out = new Array(8);
  for (let i = 0; i < 8; i++) out[i] = (co[m.cp[i]] + m.co[i]) % 3;
  return out;
};

const applyEo = (eo, m) => {
  const out = new Array(12);
  for (let i = 0; i < 12; i++) out[i] = (eo[m.ep[i]] + m.eo[i]) % 2;
  return out;
};

/**
 * @param {object|null} into  a view to fill INSTEAD of allocating — how a build targets memory it
 *   does not own (a SharedArrayBuffer the whole pool reads; see `shareTables`). Its length is
 *   CHECKED rather than trusted: a view one entry short would otherwise be filled to its end and
 *   the table would simply stop, which no search reports and no answer reveals.
 */
function buildTable(Type, count, moveIdx, unrank, step, into = null) {
  const width = moveIdx.length;
  const table = into ?? new Type(count * width);
  if (table.length !== count * width) {
    throw new Error(`two-phase: a supplied move table holds ${table.length} entries, not ${count * width}`);
  }
  for (let c = 0; c < count; c++) {
    const st = unrank(c);
    for (let mi = 0; mi < width; mi++) table[c * width + mi] = step(st, MOVES[MOVE_NAMES[moveIdx[mi]]]);
  }
  return table;
}

let tables = null;

/** All six coordinate move tables, built once and shared. ~1M entries in all — trivial. */
export function moveTables() {
  if (tables) return tables;
  tables = Object.freeze(buildMoveTables(null));
  return tables;
}

/** The six move tables as fresh allocations, or written into `into`'s views of the same names.
 *  One builder for both, so a shared table and a private one cannot come to differ. */
function buildMoveTables(into) {
  const identity4 = [8, 9, 10, 11];
  const slot = (name) => into?.[name] ?? null;
  return {
    // Phase 1: all 18 moves.
    twistMove: buildTable(Uint16Array, TWIST_COUNT, ALL_MOVES, twistTo, (co, m) => twistOf(applyCo(co, m)), slot('twistMove')),
    flipMove: buildTable(Uint16Array, FLIP_COUNT, ALL_MOVES, flipTo, (eo, m) => flipOf(applyEo(eo, m)), slot('flipMove')),
    sliceMove: buildTable(Uint16Array, SLICE_COUNT, ALL_MOVES, sliceTo, (ep, m) => sliceOf(applyPerm(ep, m.ep)), slot('sliceMove')),
    // Phase 2: the ten G1 moves, which map U/D slots to U/D slots and slice slots to slice
    // slots — that closure is what makes the two smaller permutation coordinates well-defined.
    cpermMove: buildTable(Uint16Array, PERM8_COUNT, PHASE2_MOVES, (r) => permUnrank(r, 8), (cp, m) => permRank(applyPerm(cp, m.cp)), slot('cpermMove')),
    epermMove: buildTable(
      Uint16Array,
      PERM8_COUNT,
      PHASE2_MOVES,
      (r) => [...permUnrank(r, 8), ...identity4],
      (ep, m) => permRank(applyPerm(ep, m.ep).slice(0, 8)),
      slot('epermMove'),
    ),
    spermMove: buildTable(
      Uint8Array,
      PERM4_COUNT,
      PHASE2_MOVES,
      (r) => [0, 1, 2, 3, 4, 5, 6, 7, ...permUnrank(r, 4).map((x) => x + 8)],
      (ep, m) => permRank(applyPerm(ep, m.ep).slice(8).map((x) => x - 8)),
      slot('spermMove'),
    ),
  };
}

// ---- pruning tables ---------------------------------------------------------------------------
// dist[a * countB + b] is the exact number of moves to bring the coordinate PAIR home. For the
// full cube state it is a lower bound — which is all IDA* needs, and why max() of two tables is
// a better bound than either alone.

/**
 * @param {Uint8Array|null} into  a view to fill INSTEAD of allocating, so the BFS can target
 *   memory the whole pool will read. Filled with 255 here rather than relying on fresh zeros:
 *   a supplied view has whatever was in it, and 0 means "already home", which would end the
 *   search at the first entry and leave a table that prunes everything.
 */
function bfsPrune(countA, countB, tableA, tableB, width, into = null) {
  const size = countA * countB;
  const dist = into ?? new Uint8Array(size);
  if (dist.length !== size) {
    throw new Error(`two-phase: a supplied pruning table holds ${dist.length} entries, not ${size}`);
  }
  dist.fill(255);
  const queue = new Int32Array(size);
  dist[0] = 0;
  let head = 0;
  let tail = 1;
  while (head < tail) {
    const idx = queue[head++];
    const a = (idx / countB) | 0;
    const b = idx % countB;
    const d = dist[idx] + 1;
    for (let mi = 0; mi < width; mi++) {
      const next = tableA[a * width + mi] * countB + tableB[b * width + mi];
      if (dist[next] === 255) {
        dist[next] = d;
        queue[tail++] = next;
      }
    }
  }
  // Every pair is reachable in pair dynamics (the generators cover both parities of both
  // components), so a hole here is a broken move table, and a search that later stepped onto a
  // 255 would treat a reachable state as infinitely far away — silently, forever.
  if (tail !== size) {
    throw new Error(`two-phase: pruning BFS reached ${tail} of ${size} entries — a move table is wrong`);
  }
  return dist;
}

let pruning = null; // published LAST in initialize(), so a half-built solver cannot exist

// The search reads these module-level views, assigned once by initialize(). Hoisted because the
// DFS visits millions of nodes and a property load per node is measurable where a closure
// variable is not.
let TWIST_MOVE = null;
let FLIP_MOVE = null;
let SLICE_MOVE = null;
let CPERM_MOVE = null;
let EPERM_MOVE = null;
let SPERM_MOVE = null;
let PRUNE1T = null;
let PRUNE1F = null;
let PRUNE1TF = null;
let PRUNE2C = null;
let PRUNE2E = null;

/** The five pruning tables as fresh allocations, or written into `into`'s views of the same
 *  names. Needs the move tables it prunes over, which is why they are a parameter and not a
 *  `moveTables()` call: a shared build hands it the shared move tables. */
function buildPruning(t, into) {
  const slot = (name) => into?.[name] ?? null;
  return {
    prune1t: bfsPrune(TWIST_COUNT, SLICE_COUNT, t.twistMove, t.sliceMove, P1_WIDTH, slot('prune1t')),
    prune1f: bfsPrune(FLIP_COUNT, SLICE_COUNT, t.flipMove, t.sliceMove, P1_WIDTH, slot('prune1f')),
    prune1tf: bfsPrune(TWIST_COUNT, FLIP_COUNT, t.twistMove, t.flipMove, P1_WIDTH, slot('prune1tf')),
    prune2c: bfsPrune(PERM8_COUNT, PERM4_COUNT, t.cpermMove, t.spermMove, P2_WIDTH, slot('prune2c')),
    prune2e: bfsPrune(PERM8_COUNT, PERM4_COUNT, t.epermMove, t.spermMove, P2_WIDTH, slot('prune2e')),
  };
}

/** The publish step, shared by every way of getting tables: point the hoisted views at them and
 *  set `pruning` LAST. Called only with everything already built and checked. */
function publish(t, built, builtRotations) {
  ({ twistMove: TWIST_MOVE, flipMove: FLIP_MOVE, sliceMove: SLICE_MOVE } = t);
  ({ cpermMove: CPERM_MOVE, epermMove: EPERM_MOVE, spermMove: SPERM_MOVE } = t);
  ({ prune1t: PRUNE1T, prune1f: PRUNE1F, prune1tf: PRUNE1TF, prune2c: PRUNE2C, prune2e: PRUNE2E } = built);
  rotations = builtRotations;
  tables = Object.freeze(t);
  pruning = built; // the publish — everything above succeeded
}

/**
 * Build everything the search needs. Idempotent; measured 0.4-2.6 s once, machine- and
 * load-dependent (dev-docs/solver-move-count.md §7). Everything is built into locals first
 * and published together at the end — a throw mid-build must leave the module un-initialized,
 * not half-initialized behind a truthy flag.
 *
 * @param {object|null} [options.adopt]  a bundle published by `shareTables()` on another thread.
 *   With one, nothing is built at all: the eleven tables are VIEWS of memory another thread
 *   already filled, verified byte for byte before a single one is installed (2026-09-05). Not
 *   guarded by `pruning`, because adopting is worth doing even where a local build already
 *   happened — it is what frees this thread's 9.8 MiB copy.
 */
export function initialize({ adopt = null } = {}) {
  if (adopt) {
    // Validate first, commit together — the rule setBounds already follows. A bundle that fails
    // its checksum must leave this thread exactly as it was, building its own tables on the next
    // search, rather than half-pointed at memory nobody can vouch for.
    const shared = viewsOf(adopt);
    const builtRotations = buildRotations();
    publish(pick(shared, MOVE_TABLE_NAMES), pick(shared, PRUNE_TABLE_NAMES), builtRotations);
    adopted = adopt;
    return;
  }
  if (pruning) return;
  const t = moveTables();
  const built = buildPruning(t, null);
  const builtRotations = buildRotations();
  publish(t, built, builtRotations);
}

/** For tests: the built pruning tables. */
export function pruningTables() {
  initialize();
  return pruning;
}

// ---- one build for the whole pool ---------------------------------------------------------------
// Added 2026-09-05 (dev-docs/deferred-plans-2026-09-05.md §2). Six pool workers each built these
// same eleven tables — 9.82 MiB and 0.4-2.6 s apiece, concurrently — so a cold session paid six
// builds and then HELD six identical copies for the life of the page. One worker builds into a
// SharedArrayBuffer now and the rest take views of it.
//
// Four things this rests on, each of which was a real way to get it wrong:
//
//   * **One buffer, eleven regions at eleven byte OFFSETS.** That makes the stop word's recorded
//     trap structural rather than incidental: every table starts somewhere other than 0, so a
//     descriptor that dropped its offset addresses the wrong bytes and the checksum says so
//     immediately. A buffer per table would have hidden the whole class behind offset 0.
//   * **A seal, stored and loaded atomically**, so the builder's writes are visible to the
//     adopters by the memory model rather than by luck. See SEALED.
//   * **A checksum per table, computed at build time and verified before a single view is
//     installed.** Shared memory is shared damage: one stray write corrupts all six searches at
//     once, and the symptom — an alg that does not solve — surfaces at the cubejs oracle three
//     layers away with nothing pointing back here.
//   * **The verification is at ADOPTION only, and that is a decision with a cost.** Re-checking
//     all eleven costs 2.3 ms (measured, 32-bit FNV-1a over 9.82 MiB), against a median warm
//     solve of ~4 ms — a per-solve re-check would more than halve the warm path to catch a class
//     that cannot happen while the search stays read-only. So the read-only property is what is
//     asserted instead: `verifyAdopted()` is public, and shared-solver-tables.test.mjs runs a real
//     solve on adopted tables and re-verifies afterwards. If the search ever starts writing, that
//     test goes red rather than the app going quietly wrong.

/** The eleven tables, in one place: what each is called, how wide an entry is, and how many.
 *  A single source for building, for laying out the shared buffer, and for checking a bundle that
 *  arrives from another thread — a second copy of these lengths is how an adopted table ends up
 *  the right size and the wrong shape. */
const TABLE_LAYOUT = Object.freeze([
  { name: 'twistMove', kind: 'u16', length: TWIST_COUNT * P1_WIDTH },
  { name: 'flipMove', kind: 'u16', length: FLIP_COUNT * P1_WIDTH },
  { name: 'sliceMove', kind: 'u16', length: SLICE_COUNT * P1_WIDTH },
  { name: 'cpermMove', kind: 'u16', length: PERM8_COUNT * P2_WIDTH },
  { name: 'epermMove', kind: 'u16', length: PERM8_COUNT * P2_WIDTH },
  { name: 'spermMove', kind: 'u8', length: PERM4_COUNT * P2_WIDTH },
  { name: 'prune1t', kind: 'u8', length: TWIST_COUNT * SLICE_COUNT },
  { name: 'prune1f', kind: 'u8', length: FLIP_COUNT * SLICE_COUNT },
  { name: 'prune1tf', kind: 'u8', length: TWIST_COUNT * FLIP_COUNT },
  { name: 'prune2c', kind: 'u8', length: PERM8_COUNT * PERM4_COUNT },
  { name: 'prune2e', kind: 'u8', length: PERM8_COUNT * PERM4_COUNT },
]);

const VIEW_TYPES = Object.freeze({ u8: Uint8Array, u16: Uint16Array });
const MOVE_TABLE_NAMES = Object.freeze(['twistMove', 'flipMove', 'sliceMove', 'cpermMove', 'epermMove', 'spermMove']);
const PRUNE_TABLE_NAMES = Object.freeze(['prune1t', 'prune1f', 'prune1tf', 'prune2c', 'prune2e']);

/** The bundle's tag. Versioned because it crosses a thread boundary as plain data: a page that
 *  reloaded onto new code while a worker held old tables must be refused, not adopted. */
export const TABLES_FORMAT = 'cubus-two-phase-tables/1';

const pick = (from, names) => Object.fromEntries(names.map((n) => [n, from[n]]));

/**
 * The seal, and why one exists at all.
 *
 * It is not a second format tag. It is the RELEASE half of a release/acquire pair: the builder
 * fills nine and a half megabytes with ordinary writes and then stores this word with
 * `Atomics.store`, and an adopter loads it with `Atomics.load` before reading a single table
 * byte. That pair is what the memory model actually defines — it is the only thing that makes
 * the builder's writes guaranteed visible to another agent, rather than visible because every
 * engine's postMessage happens to take a lock on the way past.
 *
 * The checksum would CATCH a stale read, loudly, which is why this is belt as well as braces.
 * But "detected" is a worse guarantee than "cannot happen", and the difference costs two atomic
 * operations per session.
 */
const SEAL_WORD_BYTES = 4;
const SEALED = 0x7ab1e5; // arbitrary and non-zero, so a zeroed buffer is never mistaken for one

/**
 * Where each table sits in the one shared buffer, and how big that buffer has to be.
 *
 * The seal takes byte 0..3, so every table starts at a non-zero offset — which is the stop word's
 * trap made impossible to hide from: there is no table whose descriptor would still address the
 * right bytes if its offset were dropped in transit.
 *
 * Every region starts on a 4-byte boundary — Uint16Array needs 2 and the checksum below reads
 * 32-bit words, so 4 satisfies both and costs at most three padding bytes per table.
 */
export function sharedLayout() {
  let byteOffset = SEAL_WORD_BYTES;
  const regions = TABLE_LAYOUT.map((entry) => {
    const byteLength = entry.length * VIEW_TYPES[entry.kind].BYTES_PER_ELEMENT;
    const region = Object.freeze({ ...entry, byteOffset, byteLength });
    byteOffset = (byteOffset + byteLength + 3) & ~3;
    return region;
  });
  return Object.freeze({ regions: Object.freeze(regions), byteLength: byteOffset });
}

/**
 * FNV-1a over a table's bytes, read 32 bits at a time.
 *
 * Not a cryptographic digest and not trying to be: nothing here is defending against a chosen
 * collision, only against a table that is not the one that was built — a dropped offset, a
 * truncated region, a stray write. Word-at-a-time because it is 4x the byte-at-a-time loop
 * (2.3 ms against 9.4 ms for all eleven, measured), and the tail is folded in per byte so a
 * region whose length is not a multiple of four is still covered to its last byte.
 */
function checksumOf(view) {
  const { buffer, byteOffset, byteLength } = view;
  if (byteOffset % 4 !== 0) {
    throw new Error(`two-phase: a table at byte offset ${byteOffset} is not 4-byte aligned`);
  }
  let h = 0x811c9dc5 | 0;
  const words = byteLength >>> 2;
  const u32 = new Uint32Array(buffer, byteOffset, words);
  for (let i = 0; i < words; i++) {
    h = Math.imul(h ^ u32[i], 0x01000193);
  }
  const tail = new Uint8Array(buffer, byteOffset + words * 4, byteLength - words * 4);
  for (let i = 0; i < tail.length; i++) {
    h = Math.imul(h ^ tail[i], 0x01000193);
  }
  return h >>> 0;
}

/** The bundle this thread adopted, kept so `verifyAdopted()` can re-check the same bytes. */
let adopted = null;

/**
 * Build the eleven tables into a fresh SharedArrayBuffer and describe them for other threads.
 *
 * This thread ends up on the shared copy too — there is one set of bytes on the page, not a
 * private set beside a published one, or the builder would be the one worker whose tables nobody
 * is checking.
 *
 * Two paths, because the caller may have solved already: with no tables yet it BUILDS straight
 * into shared memory and pays nothing extra; with tables already built it COPIES them across
 * (a 9.82 MiB memcpy, single-digit milliseconds) rather than spending another 0.4-2.6 s
 * reproducing bytes it already has.
 *
 * @returns {{format: string, buffer: SharedArrayBuffer, tables: object[]}} a structured-cloneable
 *   bundle: the buffer, and per table its name, element kind, BYTE OFFSET, length and checksum.
 */
export function shareTables() {
  if (typeof SharedArrayBuffer === 'undefined') {
    // Loud, never a quiet private build: the caller asked for a shared table set and would
    // otherwise hand its pool a bundle it silently could not share.
    throw new Error('two-phase: this thread has no SharedArrayBuffer, so the tables cannot be shared');
  }
  const { regions, byteLength } = sharedLayout();
  const buffer = new SharedArrayBuffer(byteLength);
  const views = {};
  for (const r of regions) views[r.name] = new VIEW_TYPES[r.kind](buffer, r.byteOffset, r.length);

  if (pruning) {
    for (const r of regions) views[r.name].set(currentTable(r.name));
    publish(pick(views, MOVE_TABLE_NAMES), pick(views, PRUNE_TABLE_NAMES), rotations);
  } else {
    const t = buildMoveTables(views);
    const built = buildPruning(t, views);
    publish(t, built, buildRotations());
  }

  const bundle = {
    format: TABLES_FORMAT,
    buffer,
    tables: regions.map((r) => ({
      name: r.name,
      kind: r.kind,
      byteOffset: r.byteOffset,
      length: r.length,
      checksum: checksumOf(views[r.name]),
    })),
  };
  // LAST, and atomic: every table byte above is written before this store, so an agent that
  // loads SEALED sees all of them. Sealing earlier would publish a buffer that is only partly
  // filled and perfectly checksummed by whoever wrote it.
  Atomics.store(new Int32Array(buffer, 0, 1), 0, SEALED);
  adopted = bundle;
  return bundle;
}

/** This thread's live view of one table, whatever built it. */
function currentTable(name) {
  return (MOVE_TABLE_NAMES.includes(name) ? tables : pruning)[name];
}

/**
 * A bundle from another thread as eleven checked views, or a throw naming what is wrong.
 *
 * Everything is checked against TABLE_LAYOUT — this thread's own idea of the tables — and never
 * against the bundle's own claims about itself, which is the difference between validating input
 * and believing it.
 */
function viewsOf(bundle) {
  if (bundle?.format !== TABLES_FORMAT) {
    throw new Error(`two-phase: shared tables are tagged "${bundle?.format}", not "${TABLES_FORMAT}"`);
  }
  // A plain ArrayBuffer here means the crossing COPIED rather than shared, which costs the memory
  // the whole exercise exists to save while looking exactly like success.
  if (typeof SharedArrayBuffer === 'undefined' || !(bundle.buffer instanceof SharedArrayBuffer)) {
    throw new Error('two-phase: shared tables must arrive on a SharedArrayBuffer');
  }
  // The ACQUIRE half, and it comes before every read below. See SEALED.
  if (bundle.buffer.byteLength < SEAL_WORD_BYTES || Atomics.load(new Int32Array(bundle.buffer, 0, 1), 0) !== SEALED) {
    throw new Error('two-phase: the shared table buffer is not sealed — it was never finished, or it is not a table set');
  }
  const { regions } = sharedLayout();
  if (!Array.isArray(bundle.tables) || bundle.tables.length !== regions.length) {
    throw new Error(`two-phase: shared tables describe ${bundle.tables?.length} of ${regions.length} tables`);
  }
  const views = {};
  for (const r of regions) {
    const d = bundle.tables.find((x) => x?.name === r.name);
    if (!d) throw new Error(`two-phase: shared tables are missing ${r.name}`);
    if (d.kind !== r.kind || d.length !== r.length) {
      throw new Error(`two-phase: shared ${r.name} is ${d.length} ${d.kind} entries, not ${r.length} ${r.kind}`);
    }
    if (!Number.isInteger(d.byteOffset) || d.byteOffset < 0 || d.byteOffset + r.byteLength > bundle.buffer.byteLength) {
      throw new Error(`two-phase: shared ${r.name} does not fit the buffer at byte offset ${d.byteOffset}`);
    }
    const view = new VIEW_TYPES[r.kind](bundle.buffer, d.byteOffset, r.length);
    const seen = checksumOf(view);
    if (seen !== d.checksum) {
      throw new Error(
        `two-phase: shared ${r.name} checksum ${seen} does not match the published ${d.checksum} — ` +
          'the table was written to after it was published, or its offset was lost in transit',
      );
    }
    views[r.name] = view;
  }
  return views;
}

/**
 * Re-check the bundle this thread is running on, byte for byte.
 *
 * Public because the freeze is a CLAIM, and a claim needs somewhere to be checked: the test suite
 * runs a real solve on adopted tables and calls this afterwards, so "the search never writes to
 * the tables" fails loudly the day it stops being true. 2.3 ms, measured — cheap enough for a
 * diagnostic, too dear for the warm path (see the section header).
 */
export function verifyAdopted() {
  if (!adopted) throw new Error('two-phase: no shared tables were adopted, so there is nothing to re-verify');
  viewsOf(adopted);
  return true;
}

/** Whether this thread's tables are shared ones. For tests and diagnostics — a pool that silently
 *  fell back to private builds looks exactly like one that did not. */
export const usingSharedTables = () => adopted !== null;

// ---- phase 1: into G1 -------------------------------------------------------------------------

const FACE_OF = (m) => (m / 3) | 0; // 0 U, 1 R, 2 F, 3 D, 4 L, 5 B
const AXIS_OF = (f) => f % 3; //       0 UD, 1 RL, 2 FB

/** Same face twice never helps; of a commuting opposite-face pair, keep one order only. */
function moveAllowed(prevMove, m) {
  if (prevMove < 0) return true;
  const face = FACE_OF(m);
  const prev = FACE_OF(prevMove);
  if (face === prev) return false;
  return AXIS_OF(face) !== AXIS_OF(prev) || face < prev;
}

/**
 * The two questions every node of either phase asks before doing any work: is the budget spent,
 * and has some other search already made this one pointless. True means stop.
 *
 * ONE copy (2026-09-05). Phase 1 and phase 2 each carried these three checks, identical but for
 * the polarity their callers read — phase 1's "stop" is `true` (abort the enumeration), phase 2's
 * is `false` (report no solution) — and the polarity is exactly why they had to be read carefully
 * to be seen as the same thing. That is not a hypothetical cost: phase 2 did not poll the stop
 * word AT ALL until it was noticed, so a worker already inside an expensive probe went on spending
 * its whole budget after a shallower sibling had won. A cancellation fix has one place to land now.
 *
 * Argument-free and allocation-free, reading module state exactly as the two DFS functions do, for
 * the same reason: the search is one synchronous walk with nowhere to thread a parameter through.
 * It is on the hottest path in the app — one call per search node, ~15 ns of work between calls —
 * so it was measured rather than assumed, interleaved so machine drift hits both sides: five frozen
 * states, 11,130,753 nodes per run (identical either way, as it must be), fifteen runs a side.
 * Best 170.5 / 163.5 ms before, 166.6 / 164.9 after; medians 178.1 / 164.5 against 168.2 / 166.3.
 * The two orders disagree about which is faster, which is the answer: the call is inside the
 * run-to-run spread, and V8 inlines a function this small.
 */
function mustStop() {
  if (exhausted) return true; // the abort channel — nothing below spends what is not there
  if (--nodesLeft < 0) {
    exhausted = true;
    return true;
  }
  // The same abort channel, reached from outside. `exhausted` already stops both phases
  // wherever it is set, so a stop needs no new plumbing — only somewhere to be asked.
  if ((nodesLeft & STOP_POLL_MASK) === 0 && stopRequested(currentDepth)) {
    exhausted = true;
    return true;
  }
  return false;
}

const IS_PHASE2 = (() => {
  const flags = new Array(P1_WIDTH).fill(false);
  for (const m of PHASE2_MOVES) flags[m] = true;
  return flags;
})();

/**
 * Enumerate phase-1 maneuvers of EXACTLY `depth` moves that land in G1, in lexicographic move
 * order. `onSolution(path)` is called for each; returning true from it aborts the enumeration
 * (found what we wanted, or out of budget).
 *
 * Maneuvers ending with a G1 move are skipped: that move can open phase 2 instead, so keeping
 * them would only spend probes on duplicates. The empty maneuver (a state already in G1) is the
 * one exception.
 *
 * What that skip costs, stated exactly, because the completeness argument upstream rests on it:
 * a solution S of length L is reachable at ONE split only — before its maximal trailing run of
 * G1 moves. (The prefix really does land in G1: the state after all L moves is solved, which is
 * in G1, and the trailing moves are all in G1, so the state before them is too. Its last move is
 * not a G1 move, by maximality, so it survives this skip.) Every longer prefix ends in a G1 move
 * and is rejected here; every shorter one need not be in G1 at all. So S is found only if that
 * trailing run fits under the phase-2 cap, MAX_PHASE2 = 12. See solve-target.js's GODS_NUMBER
 * for what that leaves the promise resting on, and `two-phase.test.mjs`'s "the phase-2 cap is
 * what makes the trailing-G1 split reachable" for the mechanism at cap 1.
 */
function phase1DFS(t, f, s, depthLeft, prevMove, path, onSolution) {
  if (mustStop()) return true; // true is phase 1's "stop": abort the enumeration
  searchStats.p1Nodes++; // counted only inside the budget, so spent === budget on exhaustion
  if (depthLeft === 0) {
    if (t === 0 && f === 0 && s === 0 && (path.length === 0 || !IS_PHASE2[path[path.length - 1]])) {
      return onSolution(path);
    }
    return false;
  }
  const bound1 = Math.max(PRUNE1T[t * SLICE_COUNT + s], PRUNE1F[f * SLICE_COUNT + s]);
  if (bound1 > depthLeft || PRUNE1TF[t * FLIP_COUNT + f] > depthLeft) return false;
  for (let m = 0; m < P1_WIDTH; m++) {
    if (!moveAllowed(prevMove, m)) continue;
    path.push(m);
    const abort = phase1DFS(
      TWIST_MOVE[t * P1_WIDTH + m],
      FLIP_MOVE[f * P1_WIDTH + m],
      SLICE_MOVE[s * P1_WIDTH + m],
      depthLeft - 1,
      m,
      path,
      onSolution,
    );
    path.pop();
    if (abort) return true;
  }
  return false;
}

/**
 * The shortest maneuver taking `state` into G1, as move names. Exists for tests and for
 * development probing — the full solver drives the same DFS with a phase-2 continuation.
 *
 * @throws if nothing is found within `maxDepth` — the published diameter of this coset space
 *         is 12, so an empty answer at 12 means broken tables, not a hard cube.
 */
export function solveIntoG1(state, { maxDepth = 12 } = {}) {
  initialize();
  resetStats();
  nodesLeft = Number.MAX_SAFE_INTEGER; // the 12-deep minimal search is small; no budget needed
  exhausted = false;
  // This reaches phase1DFS, so it owns currentDepth for the duration. -1 rather than the loop's
  // depth: there is no parallel slice behind this search, so no stop decision should be made
  // about it — and a leftover depth from the last solvePattern is worse than none.
  currentDepth = -1;
  const t = twistOf(state.co);
  const f = flipOf(state.eo);
  const s = sliceOf(state.ep);
  for (let depth = 0; depth <= maxDepth; depth++) {
    let found = null;
    phase1DFS(t, f, s, depth, -1, [], (path) => {
      found = path.map((m) => MOVE_NAMES[m]);
      return true;
    });
    if (found) return found;
  }
  if (maxDepth >= 12) {
    throw new Error(`two-phase: no phase-1 maneuver within ${maxDepth} moves — the tables are wrong`);
  }
  // Below the published diameter an empty answer can simply mean a deep state — that is the
  // caller's bound, not a broken solver.
  throw new Error(`two-phase: no phase-1 maneuver within ${maxDepth} moves — the diameter is 12`);
}

// ---- facelets ---------------------------------------------------------------------------------
// The 54-character facelet string, in the standard order every solver and cubejs share: faces
// U R F D L B, nine stickers each, row-major with the face held as the published convention
// holds it. Colors are named by their home face's letter. cube-pieces' CORNERS/EDGES names
// double as the color sequences — letter k of 'URF' is the color at the cubie's k-th sticker —
// and the test suite pins this whole convention to cubejs by round-tripping random states.

/** Facelet indices of each corner slot's three stickers, U/D sticker first. */
const CORNER_FACELETS = [
  [8, 9, 20], [6, 18, 38], [0, 36, 47], [2, 45, 11],
  [29, 26, 15], [27, 44, 24], [33, 53, 42], [35, 17, 51],
];

/** Facelet indices of each edge slot's two stickers, the EDGES-name order first. */
const EDGE_FACELETS = [
  [5, 10], [7, 19], [3, 37], [1, 46], [32, 16], [28, 25], [30, 43], [34, 52],
  [23, 12], [21, 41], [50, 39], [48, 14],
];

const CENTERS = [4, 13, 22, 31, 40, 49];
const FACE_LETTERS = 'URFDLB';

/**
 * A facelet string as a cubie state, or null when it is not a solvable cube.
 *
 * null covers every way a scan can be wrong: colors that are not the six, a center out of
 * place, a sticker set that spells no real cubie, a twisted corner, a flipped edge, two
 * swapped pieces (parity). The caller's contract is "no answer for this", which is the same
 * null an exhausted search returns — and the tiered search upstream turns a first-answer null
 * into a loud error rather than a quiet shrug.
 */
export function parseFacelets(facelets) {
  if (typeof facelets !== 'string' || facelets.length !== 54) return null;
  for (let i = 0; i < 6; i++) {
    if (facelets[CENTERS[i]] !== FACE_LETTERS[i]) return null; // centers define the color frame
  }
  const counts = new Map();
  for (const ch of facelets) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  if (counts.size !== 6 || [...counts.values()].some((n) => n !== 9)) return null;

  const corners = parseCornerSlots(facelets);
  if (corners === null) return null;
  const edges = parseEdgeSlots(facelets);
  if (edges === null) return null;
  const { cp, co } = corners;
  const { ep, eo } = edges;

  // A real cube has each piece exactly once, orientations that cancel out, and matching
  // permutation parities — anything else is scanner noise or a twisted/reassembled cube.
  if (new Set(cp).size !== 8 || new Set(ep).size !== 12) return null;
  if (co.reduce((x, y) => x + y, 0) % 3 !== 0) return null;
  if (eo.reduce((x, y) => x + y, 0) % 2 !== 0) return null;
  if (permutationParity(cp) !== permutationParity(ep)) return null;
  return { cp, co, ep, eo };
}

/** Corner slots from stickers: which cubie sits in each slot, and how it is twisted. null when
 *  any sticker triple spells no real corner. */
function parseCornerSlots(facelets) {
  const cp = new Array(8);
  const co = new Array(8);
  for (let slot = 0; slot < 8; slot++) {
    const [a, b, c] = CORNER_FACELETS[slot];
    const stickers = [facelets[a], facelets[b], facelets[c]];
    const ori = stickers.findIndex((sticker) => sticker === 'U' || sticker === 'D');
    if (ori < 0) return null; // a corner with no U/D sticker is not a corner of this cube
    const name = stickers[ori] + stickers[(ori + 1) % 3] + stickers[(ori + 2) % 3];
    const cubie = CORNERS.indexOf(name);
    if (cubie < 0) return null;
    cp[slot] = cubie;
    co[slot] = ori;
  }
  return { cp, co };
}

/** Edge slots from stickers, trying both orientations. null when a pair spells no real edge. */
function parseEdgeSlots(facelets) {
  const ep = new Array(12);
  const eo = new Array(12);
  for (let slot = 0; slot < 12; slot++) {
    const [a, b] = EDGE_FACELETS[slot];
    const upright = EDGES.indexOf(facelets[a] + facelets[b]);
    const flipped = EDGES.indexOf(facelets[b] + facelets[a]);
    if (upright >= 0) {
      ep[slot] = upright;
      eo[slot] = 0;
    } else if (flipped >= 0) {
      ep[slot] = flipped;
      eo[slot] = 1;
    } else {
      return null;
    }
  }
  return { ep, eo };
}

/** The inverse of parseFacelets, for tests: a cubie state as its facelet string. */
export function toFacelets(state) {
  const out = new Array(54);
  for (let i = 0; i < 6; i++) out[CENTERS[i]] = FACE_LETTERS[i];
  for (let slot = 0; slot < 8; slot++) {
    const name = CORNERS[state.cp[slot]];
    for (let k = 0; k < 3; k++) out[CORNER_FACELETS[slot][(k + state.co[slot]) % 3]] = name[k];
  }
  for (let slot = 0; slot < 12; slot++) {
    const name = EDGES[state.ep[slot]];
    for (let k = 0; k < 2; k++) out[EDGE_FACELETS[slot][(k + state.eo[slot]) % 2]] = name[k];
  }
  return out.join('');
}

// ---- phase 2: inside G1 -----------------------------------------------------------------------

/**
 * Exact-depth DFS inside G1. On success the winning maneuver is LEFT IN `path` (indices into
 * MOVE_NAMES) — the caller owns the array and reads it on true.
 */
function phase2DFS(c, e, s, depthLeft, prevMove, path) {
  // false is phase 2's "stop": not found. The ladder above and phase 1 both stop on `exhausted`
  // itself, which is what makes the two polarities safe to share one check — see mustStop.
  if (mustStop()) return false;
  searchStats.p2Nodes++;
  if (depthLeft === 0) return c === 0 && e === 0 && s === 0;
  if (Math.max(PRUNE2C[c * PERM4_COUNT + s], PRUNE2E[e * PERM4_COUNT + s]) > depthLeft) return false;
  for (let mi = 0; mi < P2_WIDTH; mi++) {
    const m = PHASE2_MOVES[mi];
    if (!moveAllowed(prevMove, m)) continue;
    path.push(m);
    if (phase2DFS(CPERM_MOVE[c * P2_WIDTH + mi], EPERM_MOVE[e * P2_WIDTH + mi], SPERM_MOVE[s * P2_WIDTH + mi], depthLeft - 1, m, path)) {
      return true;
    }
    path.pop();
  }
  return false;
}

// ---- axis conjugation -------------------------------------------------------------------------
// The published multi-axis technique: the same cube viewed along another axis is a different
// search problem with the same answer length, and a state that is stubborn along one axis is
// almost always easy along another. The search below interleaves three views — identity, x, z —
// which is what collapses the worst case; min2phase's speed comes from the same idea.

/** Facelet sources for the whole-cube rotations: rotated[i] = original[perm[i]]. DERIVED from
 *  cubejs (the same discipline as cube-pieces' quarter-turn tables — never typed from memory)
 *  and re-derived against cubejs by the test suite on every run. */
export const ROTATION_PERMS = Object.freeze({
  x: Object.freeze([18, 19, 20, 21, 22, 23, 24, 25, 26, 15, 12, 9, 16, 13, 10, 17, 14, 11, 27, 28, 29, 30, 31, 32, 33, 34, 35, 53, 52, 51, 50, 49, 48, 47, 46, 45, 38, 41, 44, 37, 40, 43, 36, 39, 42, 8, 7, 6, 5, 4, 3, 2, 1, 0]),
  z: Object.freeze([42, 39, 36, 43, 40, 37, 44, 41, 38, 6, 3, 0, 7, 4, 1, 8, 5, 2, 24, 21, 18, 25, 22, 19, 26, 23, 20, 15, 12, 9, 16, 13, 10, 17, 14, 11, 33, 30, 27, 34, 31, 28, 35, 32, 29, 47, 50, 53, 46, 49, 52, 45, 48, 51]),
});

/** The group inverse: where each piece CAME FROM, with the twist undone. Solving the inverse
 *  and inverting the answer is a fourth-through-sixth view of the same cube — the published
 *  companion to axis conjugation, and worth having for the same reason: independent luck. */
function inverseState(state) {
  const cp = new Array(8);
  const co = new Array(8);
  const ep = new Array(12);
  const eo = new Array(12);
  for (let i = 0; i < 8; i++) {
    cp[state.cp[i]] = i;
    co[state.cp[i]] = (3 - state.co[i]) % 3;
  }
  for (let i = 0; i < 12; i++) {
    ep[state.ep[i]] = i;
    eo[state.ep[i]] = state.eo[i];
  }
  return { cp, co, ep, eo };
}

/** U <-> U', F2 <-> F2 — the inverse move at the index level. */
const invMoveIdx = (m) => m - (m % 3) + (2 - (m % 3));

const statesEqual = (a, b) =>
  a.cp.every((v, i) => v === b.cp[i]) &&
  a.co.every((v, i) => v === b.co[i]) &&
  a.ep.every((v, i) => v === b.ep[i]) &&
  a.eo.every((v, i) => v === b.eo[i]);

let rotations = null; // [{ rotate(facelets), mapBack[18] }], one per extra orientation

/**
 * Build the two extra orientations. Everything here is DERIVED, then asserted: the color
 * relabelling comes from where the rotation puts the centers, and the move mapping µ (with
 * T(state·m) = T(state)·µ(m)) is found by matching cubie states over all 18 moves — a search
 * that either finds exactly one match per move or throws.
 */
function buildRotations() {
  const built = [];
  for (const perm of [ROTATION_PERMS.x, ROTATION_PERMS.z]) {
    const solvedFacelets = toFacelets(SOLVED);
    const relabel = {};
    for (let c = 0; c < 6; c++) relabel[solvedFacelets[perm[CENTERS[c]]]] = FACE_LETTERS[c];
    if (new Set(Object.values(relabel)).size !== 6) {
      throw new Error('two-phase: rotation color relabelling is not a bijection');
    }
    const rotate = (facelets) => {
      let out = '';
      for (let i = 0; i < 54; i++) out += relabel[facelets[perm[i]]];
      return out;
    };
    const mapBack = new Array(P1_WIDTH).fill(-1);
    for (let m = 0; m < P1_WIDTH; m++) {
      const image = parseFacelets(rotate(toFacelets(applyMove(SOLVED, MOVE_NAMES[m]))));
      const matches = [];
      for (let m2 = 0; m2 < P1_WIDTH; m2++) {
        if (statesEqual(image, applyMove(SOLVED, MOVE_NAMES[m2]))) matches.push(m2);
      }
      if (matches.length !== 1) {
        throw new Error(`two-phase: rotation maps ${MOVE_NAMES[m]} to ${matches.length} moves`);
      }
      mapBack[matches[0]] = m; // µ(m) = matches[0], so the way back from it is m
    }
    if (mapBack.includes(-1)) throw new Error('two-phase: rotation move map is not a bijection');
    built.push({ rotate, mapBack });
  }
  return built;
}

// ---- the whole search -------------------------------------------------------------------------

/**
 * min2phase-shaped bounds, which is the shape lib/solver-engine.js already drives:
 * `solLen` is EXCLUSIVE — accept nothing that long or longer. `probeMax` budgets the search in
 * SEARCH NODES across both phases, so a slow phone and a fast laptop do the same work and only
 * the waiting differs — and unlike min2phase's phase-2 probes, a node costs the same few
 * nanoseconds wherever it falls, so the budget is proportional to time as well as
 * deterministic.
 */
/** What the bounds are before anyone sets them.
 *
 *  `solLen` matches LOOSEST_BOUND and `probeMax` matches DEFAULT_NODE_BUDGET, both in
 *  solver-engine.js — the wrapper always sets both bounds explicitly, so these exist for direct
 *  module use and must not quietly disagree with it. Exported as a frozen constant rather than
 *  left as two literals so the agreement is a runtime fact a test can hold the two files to;
 *  reading the live BOUNDS instead would only report whatever the last setBounds left behind. */
export const DEFAULT_BOUNDS = Object.freeze({ solLen: 23, probeMax: 100_000_000 });

const BOUNDS = { ...DEFAULT_BOUNDS };

/** Diagnostics for the last search — what it cost, in the same units the budget is spent in,
 *  and `view` = which of the six views produced the answer (-1 while none has). TREAT AS
 *  READ-ONLY, like moveTables() and pruningTables(): these are live internals, exposed because
 *  copies would cost megabytes on a hot path, and the test suite pins the budget to these
 *  numbers so "probeMax bounds the work" is a checked claim, not a comment. */
/** How many views the search has: three axes x normal/inverse. Exported because the parallel
 *  client has to divide them, and a second copy of this number elsewhere is how a slice ends up
 *  searching nothing or a filter ends up out of range. */
export const VIEW_COUNT = 6;

export const searchStats = { probes: 0, p1Nodes: 0, p2Nodes: 0, view: -1, depth: -1 };

function resetStats() {
  searchStats.probes = 0;
  searchStats.p1Nodes = 0;
  searchStats.p2Nodes = 0;
  searchStats.view = -1;
  searchStats.depth = -1;
}

/** The running budget, decremented once per search node of either phase, and the flag that
 *  aborts every level of both searches the moment it runs out. Module-level so the DFS
 *  functions see them without threading parameters through every recursive call. */
let nodesLeft = 0;

/** Asked, periodically, whether this search has been made pointless by another one.
 *
 *  Injected — this module has no idea that workers exist, and should not. The parallel client
 *  supplies a function that reads one word of a SharedArrayBuffer; everything else supplies
 *  nothing and pays a predicate that returns false.
 *
 *  It is polled rather than pushed because the search is SYNCHRONOUS: a worker in the middle of
 *  phase 1 never returns to its event loop, so a postMessage asking it to stop is not read until
 *  the search it was meant to stop has finished. One shared word is the only channel that
 *  reaches inside a running search. */
let stopRequested = () => false;

/** The phase-1 depth the outer loop is currently exploring, so the stop predicate can be asked
 *  a question it can answer: not "should I stop" but "can anything I find from here still be
 *  better than what someone else already has". Module-level for the same reason the bounds are:
 *  the search is one synchronous walk with nowhere to thread a parameter through.
 *
 *  -1 means "no depth applies", and every entry point that reaches phase1DFS must leave it that
 *  way. solveIntoG1 is such an entry point and has no depth of its own; without the reset it
 *  would hand the predicate a depth left over from the last solvePattern, and a stop decision
 *  would be made about a search that had already finished. */
let currentDepth = -1;

/** How often to ask. Every 65536 nodes: a node is ~20 ns, so the question costs well under a
 *  thousandth of the work between asks, and the latency it adds to a stop is ~1 ms. Checking
 *  every node would be correct and measurably slower; checking every million would make a stop
 *  arrive too late to matter. */
const STOP_POLL_MASK = 0xffff;

/**
 * Install the predicate the search polls, or clear it with null.
 *
 * Module-level like the bounds, and for the same reason: the search is one synchronous walk with
 * no per-call context to thread a callback through. A caller that sets it owns clearing it.
 */
export function setStopSignal(fn) {
  if (fn !== null && typeof fn !== 'function') {
    throw new TypeError('two-phase: the stop signal must be a function or null');
  }
  stopRequested = fn ?? (() => false);
}


let exhausted = false;

/** How deep a phase-2 tail is worth searching. A failing probe costs the whole IDA* ladder up
 *  to its depth limit, so this cap is what makes a probe's worst case affordable; solutions
 *  with longer tails are rare and their totals keep being found from other phase-1 prefixes.
 *  12 was chosen by measurement (dev-docs/solver-move-count.md §7 — a cap of 10 measured
 *  WORSE); settable only as a measurement knob for the ladder benchmark. */
let MAX_PHASE2 = 12;

/**
 * Partial update: only the fields present change, and the change persists until the next call
 * — which is why lib/solver-engine.js passes explicit bounds on every solve rather than
 * trusting what a previous caller left here. Everything is validated on the way in: a NaN
 * budget would otherwise defeat the decrement-based termination check and search forever.
 */
export function setBounds(b) {
  // Validate everything FIRST, commit together after: a call like {solLen: 10, probeMax: NaN}
  // must change nothing at all, not leave solLen moved behind a thrown budget.
  if (b.solLen !== undefined) {
    // ≥ 1 (asking for a zero-move solution is answerable — by a solved cube); ≤ 24 keeps the
    // replay stacks in bounds. The app's own ceiling is tighter (LOOSEST_BOUND, solver-engine).
    if (!Number.isInteger(b.solLen) || b.solLen < 1 || b.solLen > 24) {
      throw new RangeError(`two-phase: solLen ${b.solLen} is not an integer in 1..24`);
    }
  }
  if (b.probeMax !== undefined && (!Number.isSafeInteger(b.probeMax) || b.probeMax < 1)) {
    throw new RangeError(`two-phase: probeMax ${b.probeMax} is not a positive integer`);
  }
  if (b.maxPhase2 !== undefined && (!Number.isInteger(b.maxPhase2) || b.maxPhase2 < 1 || b.maxPhase2 > 18)) {
    throw new RangeError(`two-phase: maxPhase2 ${b.maxPhase2} is not an integer in 1..18`);
  }
  if (b.solLen !== undefined) BOUNDS.solLen = b.solLen;
  if (b.probeMax !== undefined) BOUNDS.probeMax = b.probeMax;
  if (b.maxPhase2 !== undefined) MAX_PHASE2 = b.maxPhase2;
}

// Per-depth replay buffers for the probe path. A probe replays its phase-1 maneuver from the
// start state through these — 20 writes per move, no allocation, no aliasing (one buffer per
// depth). 24 is the deepest a maneuver can go under the loosest bound.
const CP_STACK = Array.from({ length: 24 }, () => new Array(8).fill(0));
const EP_STACK = Array.from({ length: 24 }, () => new Array(12).fill(0));

/** Six views of the same cube: three axes, each forward and inverted. A rotation of a legal
 *  cube is legal, so the extra parses cannot fail once the first one succeeded. */
function buildViews(facelets, state) {
  const identityMap = Array.from({ length: P1_WIDTH }, (_, i) => i);
  const frames = [{ st: state, mapBack: identityMap }];
  for (const { rotate, mapBack } of rotations) {
    frames.push({ st: parseFacelets(rotate(facelets)), mapBack });
  }
  const views = [];
  for (const { st, mapBack } of frames) {
    views.push({ st, mapBack, inverted: false });
    views.push({ st: inverseState(st), mapBack, inverted: true });
  }
  for (const [index, view] of views.entries()) {
    view.index = index;
    view.t = twistOf(view.st.co);
    view.f = flipOf(view.st.eo);
    view.s = sliceOf(view.st.ep);
  }
  return views;
}

// The probe path's scratch: the phase-2 tail under construction. Module-level like the replay
// stacks — the search is synchronous and single-threaded, so one is enough.
const TAIL = [];

/**
 * One probe: replay the phase-1 maneuver to the view's G1 permutations, then try phase-2
 * completions from the pruning bound up to the depth left (capped by MAX_PHASE2). Returns the
 * answer mapped back into the caller's frame, or null.
 */
function probeView(view, path, d2max) {
  searchStats.probes++;
  let cp = view.st.cp;
  let ep = view.st.ep;
  for (let k = 0; k < path.length; k++) {
    const mcp = MOVE_CP[path[k]];
    const mep = MOVE_EP[path[k]];
    const ncp = CP_STACK[k];
    const nep = EP_STACK[k];
    for (let i = 0; i < 8; i++) ncp[i] = cp[mcp[i]];
    for (let i = 0; i < 12; i++) nep[i] = ep[mep[i]];
    cp = ncp;
    ep = nep;
  }
  const c = rankFirst8(cp);
  const e = rankFirst8(ep); // in G1 the U/D slots hold exactly the U/D edges
  const sp = rankSlice4(ep);
  const h2 = Math.max(PRUNE2C[c * PERM4_COUNT + sp], PRUNE2E[e * PERM4_COUNT + sp]);
  const d2cap = d2max < MAX_PHASE2 ? d2max : MAX_PHASE2;
  if (h2 > d2cap) return null;
  const prev = path.length ? path[path.length - 1] : -1;
  for (let d2 = h2; d2 <= d2cap && !exhausted; d2++) {
    TAIL.length = 0;
    if (phase2DFS(c, e, sp, d2, prev, TAIL)) {
      // Under the exclusive bound by construction: d1 + d2 <= solLen - 1. An inverted view's
      // maneuver solves the inverse, so it is reversed and inverted; then µ⁻¹ brings every
      // move back into the caller's frame.
      let moves = [...path, ...TAIL];
      if (view.inverted) moves = moves.reverse().map(invMoveIdx);
      return moves.map((m) => MOVE_NAMES[view.mapBack[m]]).join(' ');
    }
  }
  return null;
}

// ---- a search that is continued rather than started again ---------------------------------------
// Added 2026-09-05 (dev-docs/deferred-plans-2026-09-05.md §3). When a promised target refuses,
// `solveWithinGodsNumber` doubles the budget and asks again, and until now the new search began at
// d1 = 0 and re-walked every node the last one had already walked. Measured over five exhausted
// runs, the work BELOW the depth the search died in — a lower bound on what a resume skips, since
// this one banks per (depth, VIEW) pair and so also keeps the views that finished at that depth —
// was 32/48/50/52/88 % of the budget (dev-docs/solver-move-count.md §7).
//
// It was deferred for one reason, and that reason is what the code below is shaped by: the plan
// named the hazard as "a resumed search whose key mismatches would skip depths and MISS a solution
// while reporting a search that ran out". So:
//
//   * **The resume point is an OBJECT with a key, never module state.** Nothing here is picked up
//     implicitly by the next call. A continuation states which search it is continuing, and the key
//     is CHECKED — a mismatch throws where it happens rather than searching the wrong enumeration.
//   * **The key is everything that decides which nodes are visited and in what order**: the
//     facelets, `solLen` (which fixes the maximum phase-1 depth), `MAX_PHASE2` (which is a settable
//     knob and changes which probes succeed), the view filter, and a format tag that names both the
//     search's own shape and the table set it walks.
//   * **`probeMax` is a FRONTIER, not an increment.** A continuation to `probeMax: P` leaves the
//     search having visited exactly the first P nodes of the enumeration — the same nodes, in the
//     same order, that a from-scratch `solvePattern` at `probeMax: P` visits. It costs P minus what
//     earlier attempts banked, which is the whole saving; the ANSWER is bit-for-bit the from-scratch
//     answer at P, which is what makes the resume provably equivalent rather than merely plausible.
//     `escalation-resume.test.mjs` is that equality, over the frozen states.
//   * **A (depth, view) pair is banked only when it walked to its END.** The pair the budget died
//     inside is re-walked from its first node, because the DFS keeps no stack across calls — that
//     re-walk is the price of a resume point that is a position in the enumeration rather than a
//     snapshot of a recursion.

/**
 * The tag a resume point is only valid under.
 *
 * Two versions in one string, because a resume point is a claim about an ENUMERATION and both
 * halves of the engine decide it: the search's own shape (the move order, the trailing-G1 skip, the
 * pruning), and the tables it walks. A page that reloaded onto new code while something still held
 * a resume point from the old one must be refused rather than continued.
 */
export const SEARCH_FORMAT = `cubus-two-phase-search/1 over ${TABLES_FORMAT}`;

/** A view filter as the engine will actually use it: null for all six, or a sorted, de-duplicated,
 *  range-checked array. Sorted because it goes into a key that is compared field by field — two
 *  filters naming the same slice in a different order are the same search and must compare equal.
 *
 *  Checked HERE rather than after the state is parsed, which is a deliberate change from the old
 *  `solvePattern`: this module's own rule everywhere else is validate first, commit together, and a
 *  filter that is rejected must be rejected whether or not the facelets happen to be a cube. */
function normaliseViewFilter(viewFilter) {
  if (viewFilter === null || viewFilter === undefined) return null;
  const wanted = new Set(viewFilter);
  if (wanted.size === 0) throw new RangeError('two-phase: an empty view filter searches nothing');
  for (const i of wanted) {
    if (!Number.isInteger(i) || i < 0 || i >= VIEW_COUNT) {
      throw new RangeError(`two-phase: view ${i} is not one of the ${VIEW_COUNT} views`);
    }
  }
  return Object.freeze([...wanted].sort((a, b) => a - b));
}

/** Everything that decides which nodes the enumeration visits, and in what order. Read from the
 *  live bounds at OPEN time, so a continuation that arrives under different bounds is a different
 *  key and is refused rather than silently searching a different tree. */
function searchKeyOf(facelets, views) {
  return Object.freeze({
    format: SEARCH_FORMAT,
    facelets,
    solLen: BOUNDS.solLen,
    maxPhase2: MAX_PHASE2,
    views,
  });
}

const sameViews = (a, b) =>
  (a === null || b === null
    ? a === b
    : Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]));

/** The hazard guard, in one place: a carried key that is not THIS key throws, naming the field that
 *  differs. Never a silent fresh search — a caller that asked to continue and got a restart has
 *  been told nothing, and a caller that asked to continue and got the wrong enumeration would be
 *  handed a miss dressed as a search that ran out. */
function assertSameKey(carried, here) {
  if (carried === null || typeof carried !== 'object') {
    throw new TypeError(
      'two-phase: this resume point carries no key, so nothing says which search it belongs to',
    );
  }
  const differs = ['format', 'facelets', 'solLen', 'maxPhase2'].find((f) => carried[f] !== here[f])
    ?? (sameViews(carried.views ?? null, here.views) ? null : 'views');
  if (differs !== null) {
    throw new Error(
      `two-phase: this resume point is for ${differs} ${JSON.stringify(carried[differs] ?? null)}, ` +
        `not ${JSON.stringify(here[differs])} — continuing it would skip depths of a DIFFERENT ` +
        'search and report a solution it never looked for as a search that ran out',
    );
  }
}

/** A search that has visited nothing. `frontier` is how many nodes it has been GIVEN in all;
 *  `covered` is how many of those are banked in (depth, view) pairs that walked to their end. */
function freshPoint(key) {
  return { key, depth: 0, cursor: 0, covered: 0, frontier: 0, done: false, alg: null, foundDepth: -1, foundView: -1 };
}

/** A resume point that arrived from somewhere else — another thread, in the app — as this thread's
 *  own record, or a throw. Every field is checked rather than believed: this crosses a structured
 *  clone, and a `cursor` past the last view or a `covered` larger than the budget that produced it
 *  would both SKIP nodes, which is the one failure this whole mechanism exists to make impossible. */
function adoptPoint(resume, key) {
  assertSameKey(resume?.key ?? null, key);
  const point = freshPoint(key);
  for (const field of ['depth', 'cursor', 'covered', 'frontier']) {
    const value = resume[field];
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`two-phase: a resume point's ${field} is ${value}, which is not a count`);
    }
    point[field] = value;
  }
  if (point.covered > point.frontier) {
    throw new RangeError(
      `two-phase: a resume point banks ${point.covered} nodes out of the ${point.frontier} it was ever given`,
    );
  }
  point.done = resume.done === true;
  point.alg = typeof resume.alg === 'string' ? resume.alg : null;
  point.foundDepth = Number.isInteger(resume.foundDepth) ? resume.foundDepth : -1;
  point.foundView = Number.isInteger(resume.foundView) ? resume.foundView : -1;
  checkOutcome(point, key);
  return point;
}

// ---- what a position in this enumeration is ----------------------------------------------------
//
// Three checks ask about a resume point's POSITION, and until 2026-09-05 they were three places to
// get the same rule right: an unfinished point (`runSearch`), a finished one carrying an answer
// (`checkOutcome`), and a finished one carrying none. The first two ask the same question — is
// (depth, cursor) INSIDE the enumeration — in different words and against different spellings of the
// same numbers, which is precisely how a gap hides. They ask it through one predicate now; the
// wording of each refusal stays with the caller, because a reader of one message needs to know which
// kind of point was refused.
//
// Why a FINISHED point needs its position checked here at all: `runSearch` returns a done point's
// answer before it reads `depth` or `cursor`, so the bounds check that guards every unfinished point
// is never reached for one — which is how `cursor: 999` rode in (2026-09-05, round 2).

/** A position the loop could still be at: a depth the bound allows, and a view this slice has.
 *  `solLen` is EXCLUSIVE, so the last searchable depth is `solLen - 1`. */
const insideEnumeration = (point, solLen, viewCount) => point.depth < solLen && point.cursor < viewCount;

/** The one position an enumeration that ran out of DEPTHS can be left at: the loop increments past
 *  `solLen - 1` and resets the cursor as it goes, so it stops at the bound itself, view 0. */
const atEndOfEnumeration = (point, solLen) => point.depth === solLen && point.cursor === 0;

/**
 * The OUTCOME half of a resume point — `done`, `alg`, and the (depth, view) the winner published.
 *
 * These four fields were the only ones nothing checked, and they are the ones a search never
 * re-derives: `runSearch` returns a finished point's algorithm and its sort key straight back
 * without searching. So a forged or corrupted completed record was believed entirely — the
 * 2026-09-05 audit answered a search bounded at `solLen: 2` with "U U U", from view 999. That is
 * every property the engine promises, broken at once: the bound, the metric, the cube, and the key
 * a pooled caller sorts on.
 *
 * THREE outcomes, three validators (split 2026-09-05, round 3 of the audit): a search still going, a
 * finish with nothing, and a finish with an answer. They have nothing in common but the position
 * rules above, and the complaint the split answers is that a gap in one of them was invisible from
 * the other two — every check had to be read to see which outcome it guarded.
 */
function checkOutcome(point, key) {
  // The view count is the SLICE's, not the engine's: a two-view search finishes at cursor 2, and
  // measuring it against six would accept a position it can never be at.
  const viewCount = key.views === null ? VIEW_COUNT : key.views.length;
  if (!point.done) return checkUnfinished(point);
  if (point.alg === null) return checkEmptyFinish(point, key, viewCount);
  return checkAnsweredFinish(point, key, viewCount);
}

/** A search still going carries no outcome. A record with one is not a position in this enumeration;
 *  `runSearch` would search on and then overwrite it, so believing it silently would hide whatever
 *  produced it. */
function checkUnfinished(point) {
  if (point.alg !== null || point.foundDepth !== -1 || point.foundView !== -1) {
    throw new RangeError(
      'two-phase: this resume point is unfinished and yet carries an answer, so it is not a ' +
        'position any search of this enumeration left',
    );
  }
}

/**
 * A finish with NO answer — and there are exactly two of those: a state that is not a cube, and an
 * enumeration walked out of depths. Neither ever published a winner.
 *
 * The cheapest forgery in the protocol lives here: `{...freshPoint, done: true}` made `runSearch`
 * answer null after ZERO nodes for a cube whose real answer the audit measured at one move (`U'`).
 * A null from an exhausted enumeration and a null from an unstarted one are the same value, and
 * `solveWithinGodsNumber` reads the second as a budget that was too small — so a forged record
 * would burn every escalation and then raise about a cube that is one turn from solved.
 */
function checkEmptyFinish(point, key, viewCount) {
  if (point.foundDepth !== -1 || point.foundView !== -1) {
    throw new RangeError(
      `two-phase: this resume point found nothing and yet names depth ${point.foundDepth}, ` +
        `view ${point.foundView} as its winner`,
    );
  }
  if (parseFacelets(key.facelets) === null) {
    // Not a cube: no budget makes it solvable, so `done` is right whatever position it names,
    // and the search would answer null from any of them.
    return;
  }
  // Out of DEPTHS is the only other way to finish empty, and it lands in exactly one place — see
  // `atEndOfEnumeration`. Anything else is a search that ran out of NODES, which is not finished.
  if (!atEndOfEnumeration(point, key.solLen)) {
    throw new RangeError(
      `two-phase: this resume point claims a finished search of a real cube with no answer, but ` +
        `it sits at depth ${point.depth}, view ${point.cursor} — an enumeration that ran out of ` +
        `depths ends at depth ${key.solLen}, view 0, and one that ran out of nodes is not finished`,
    );
  }
  // And that it did the WORK. The position is a claim about where the search stopped; `covered` is
  // the only evidence anywhere in the record that it ever ran (2026-09-05 round 3 — the position
  // check alone accepted a fresh point patched with `done: true` and a depth of `solLen`, which then
  // answered null after zero nodes for a cube one turn from solved, permanently, because a finished
  // point is never searched again).
  //
  // The bound is arithmetic, not a heuristic: every (depth, view) pair costs at least one node,
  // because `phase1DFS` spends one in `mustStop` before it prunes anything, and only pairs that ran
  // to their END are banked. An enumeration that walked all `solLen` depths of `viewCount` views
  // therefore banked at least that many. It is tight as well as sound — a cube whose root is pruned
  // at every depth banks exactly one node per pair, measured at 12 for `solLen: 2` over the six
  // views — so it refuses the forgery without refusing the cheapest real finish.
  const leastWork = key.solLen * viewCount;
  if (point.covered < leastWork) {
    throw new RangeError(
      `two-phase: this resume point claims a finished search of a real cube with no answer, but ` +
        `banks ${point.covered} nodes — walking every one of the ${key.solLen} depths of ` +
        `${viewCount} views costs at least ${leastWork}, so this search never ran`,
    );
  }
}

/**
 * A finish WITH an answer — the one outcome `runSearch` hands straight back without searching, so
 * every field of it has to be re-derived here or it is simply believed.
 *
 * The alg is checked by ARITHMETIC: applied to the state the key names, with this module's own move
 * tables, it must land on solved. That costs one parse and at most 22 cubie permutations, on a path
 * that runs once per adoption and never inside the search.
 */
function checkAnsweredFinish(point, key, viewCount) {
  const moves = point.alg.trim() ? point.alg.trim().split(/\s+/) : [];
  for (const name of moves) {
    if (!MOVE_NAMES.includes(name)) {
      throw new RangeError(`two-phase: this resume point's answer contains "${name}", which is not a move`);
    }
  }
  // The bound is EXCLUSIVE, and it is part of the key, so this is the same bound the search that
  // produced the answer was under.
  if (moves.length >= key.solLen) {
    throw new RangeError(
      `two-phase: this resume point carries a ${moves.length}-move answer under a bound of ` +
        `${key.solLen}, which no search of this enumeration can have found`,
    );
  }
  if (!Number.isInteger(point.foundDepth) || point.foundDepth < 0 || point.foundDepth > moves.length) {
    throw new RangeError(
      `two-phase: this resume point's answer was found at phase-1 depth ${point.foundDepth} of a ` +
        `${moves.length}-move solution`,
    );
  }
  if (!Number.isInteger(point.foundView) || point.foundView < 0 || point.foundView >= VIEW_COUNT
    || (key.views !== null && !key.views.includes(point.foundView))) {
    throw new RangeError(
      `two-phase: this resume point's answer was found by view ${point.foundView}, which is not ` +
        `${key.views === null ? `one of the ${VIEW_COUNT} views` : `in the searched slice ${JSON.stringify(key.views)}`}`,
    );
  }
  let state = parseFacelets(key.facelets);
  if (state === null) {
    throw new RangeError('two-phase: this resume point solves a state that is not a cube');
  }
  for (const name of moves) state = applyMove(state, name);
  if (!statesEqual(state, SOLVED)) {
    throw new RangeError(
      'two-phase: this resume point\'s answer does not solve the cube its key names — it is not ' +
        'an answer this search can have produced',
    );
  }
  // And the position it finished FROM. A search that found an answer leaves the loop by `break` and
  // never writes `depth`/`cursor` back, so they are still the position it was resumed at: inside the
  // enumeration, both of them — the SAME question `runSearch` asks of every unfinished point,
  // through the same predicate, which is why it can no longer be asked in one place and not the
  // other (that is how `cursor: 999` rode in).
  if (!insideEnumeration(point, key.solLen, viewCount)) {
    throw new RangeError(
      `two-phase: this resume point's answer was found from depth ${point.depth}, view ` +
        `${point.cursor} of ${viewCount} under a bound of ${key.solLen} — outside the search it ` +
        'claims to have finished',
    );
  }
}

/**
 * Open a search — a new one, or the one `resume` left off in.
 *
 * @param {string} facelets
 * @param {number[]|null} [options.viewFilter]  a slice of the six views, or null for all of them
 * @param {object|null} [options.resume]  a `state` record from an earlier search of the SAME key.
 *   Its key is asserted here, before anything is searched.
 * @returns {{key: object, done: boolean, frontier: number, state: object, continueTo: () => string|null}}
 *   `continueTo()` searches out to `BOUNDS.probeMax` — the frontier, not an increment — and returns
 *   the algorithm or null. `state` is the structured-cloneable record to carry to the next one.
 */
export function openSearch(facelets, { viewFilter = null, resume = null } = {}) {
  initialize();
  const views = normaliseViewFilter(viewFilter);
  const key = searchKeyOf(facelets, views);
  const point = resume === null || resume === undefined ? freshPoint(key) : adoptPoint(resume, key);
  return {
    key,
    get done() { return point.done; },
    get frontier() { return point.frontier; },
    /** A copy, so a caller that holds one cannot move this search's resume point under it. */
    get state() { return { ...point }; },
    continueTo: () => runSearch(facelets, views, point),
  };
}

/**
 * Solve a facelet string within the current bounds: an alg strictly shorter than `solLen`
 * ('' for an already-solved cube), or null — out of budget, or not a solvable cube. Never an
 * error string; that was min2phase's idiom and it stops at this module's edge.
 *
 * One probe is one phase-1 maneuver handed to phase 2. The first solution that satisfies the
 * bound is returned as found — the caller asks again with a tighter bound to improve it, which
 * is exactly how lib/solve-target.js's tiered descent drives this.
 *
 * A from-scratch search IS a resumable one that has never been continued, so there is one loop
 * and not two: the day they were two, they would start to disagree about the enumeration and the
 * equality the resume rests on would quietly stop being checkable.
 */
export function solvePattern(facelets, viewFilter = null) {
  return openSearch(facelets, { viewFilter }).continueTo();
}

/**
 * The loop, from wherever `point` says the last attempt stopped, out to the frontier `BOUNDS`
 * currently names.
 */
function runSearch(facelets, wanted, point) {
  resetStats();
  // The key is asserted on EVERY continuation, against the bounds as they are NOW — not only when
  // the point arrives from another thread. The bounds are module state and a partial update, so an
  // object opened under `solLen: 21` and continued under `solLen: 23` would otherwise keep quietly
  // searching to the first bound while its caller believed the second. That is not hypothetical: it
  // is what the first draft of this code did, and it answered a 21-bounded ask with 22 moves.
  assertSameKey(point.key, searchKeyOf(facelets, wanted));
  if (point.done) {
    // Finished searches stay finished: an answer found, an enumeration walked to its end, or a
    // state that is not a cube. Re-reporting the winner's key matters — a pooled caller sorts on
    // (depth, view) and a -1 there is a reply that cannot win.
    searchStats.depth = point.foundDepth;
    searchStats.view = point.foundView;
    return point.alg;
  }
  const frontier = BOUNDS.probeMax;
  if (frontier <= point.frontier) {
    // A continuation that asks for no more than the last one would search nothing and report it as
    // a search that ran out, which is the exact shape of the failure this mechanism guards against.
    throw new RangeError(
      `two-phase: a continuation must ask for more nodes than the ${point.frontier} this search ` +
        `has already been given, not ${frontier}`,
    );
  }
  const state = parseFacelets(facelets);
  if (state === null) {
    point.frontier = frontier;
    point.done = true; // no budget makes a non-cube solvable
    return null;
  }

  const maxTotal = point.key.solLen - 1;
  // The frontier minus what is banked. This is the whole mechanism: the nodes an earlier attempt
  // walked in (depth, view) pairs that FINISHED are not walked again, so reaching frontier P costs
  // P - covered rather than P — and the set of nodes visited is still exactly the first P.
  nodesLeft = frontier - point.covered;
  exhausted = false;
  // A slice of the six, for a caller searching the rest elsewhere. Filtering rather than
  // rebuilding keeps `view.index` the index within ALL views, which is what makes the answers
  // from separate slices comparable: the sequential engine returns the lowest view index at the
  // lowest depth, and a parallel caller can only reproduce that if the indices still mean the
  // same thing. Null is every view, which is every caller but the parallel client.
  const all = buildViews(facelets, state);
  const views = wanted === null ? all : all.filter((v) => wanted.includes(v.index));
  // The same question `checkOutcome` asks of a finished point that carries an answer, through the
  // same predicate: `maxTotal` is `solLen - 1`, and `views.length` is the slice's view count.
  if (!insideEnumeration(point, point.key.solLen, views.length)) {
    throw new RangeError(
      `two-phase: this resume point sits at depth ${point.depth}, view ${point.cursor} of ` +
        `${views.length} under a bound of ${maxTotal} — outside the search it claims to continue`,
    );
  }

  let answer = null;
  // Phase-1 depth is not capped at the 12-move diameter: with a tight bound the best split may
  // be a LONGER phase-1 maneuver with a short phase-2 tail, and at the limit the whole solution
  // is phase 1 alone. The node budget is what bounds the work, and it is shared across all six
  // views — deterministic however the search's luck falls.
  let d1 = point.depth;
  let cursor = point.cursor;
  outer: for (; d1 <= maxTotal && !exhausted; d1++, cursor = 0) {
    currentDepth = d1;
    // Asked once per depth as well as every 65536 nodes: a slice whose remaining depths cannot
    // beat an answer someone else already holds should not start the next one at all.
    if (stopRequested(d1)) break;
    const d2max = maxTotal - d1;
    for (; cursor < views.length; cursor++) {
      const view = views[cursor];
      // Each of the six views keeps its own resume point, because they die at different depths:
      // `cursor` is a position WITHIN this slice's view list, and it is what stops a continuation
      // re-walking the views that already finished at this depth.
      const before = nodesLeft;
      const aborted = phase1DFS(view.t, view.f, view.s, d1, -1, [], (path) => {
        answer = probeView(view, path, d2max);
        if (answer !== null) {
          searchStats.view = view.index;
          // The phase-1 depth this answer was found at. With the view index it forms the key a
          // parallel caller sorts on — (depth, view) is exactly the order this loop already
          // searches in, so picking the minimum across slices reproduces the sequential answer
          // whatever order the slices finished in.
          searchStats.depth = d1;
          return true;
        }
        return exhausted; // a probe that ran out of budget stops the enumeration too
      });
      if (answer !== null || aborted) break outer;
      // This pair walked to its END, so its nodes are banked and a continuation starts after it.
      // Banked only here: the pair a budget died inside is worth nothing, because the DFS keeps no
      // stack across calls and the next attempt starts it again from its first node.
      point.covered += before - nodesLeft;
    }
  }
  currentDepth = -1; // no depth applies once the loop is done; a stale one is a stop about nothing

  point.frontier = frontier;
  if (answer !== null) {
    point.done = true;
    point.alg = answer;
    point.foundDepth = searchStats.depth;
    point.foundView = searchStats.view;
    return answer;
  }
  point.depth = d1;
  point.cursor = cursor;
  // Out of DEPTHS rather than out of nodes: every maneuver the bound allows has been enumerated,
  // so no budget can change the answer and there is nothing left to continue.
  if (d1 > maxTotal) point.done = true;
  return null;
}
