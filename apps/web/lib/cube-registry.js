// Cube identity — the durable half of "which cube is this?".
//
// A smart cube names itself: its Bluetooth address is stable, unforgeable by accident, and
// already required to decrypt anything it says. So the app never has to ask which cube it is
// talking to, and never has to trust an answer it cannot check.
//
// Not every smart cube broadcasts one, though — Giiker, GoCube, MoYu v1, MoYu MHC and GAN gen1
// connect with no address the app ever sees. Those are remembered under their DEVICE NAME instead
// (`name:<label>`), which is weaker and is treated as weaker: see `normaliseIdentity`.
//
// A plain cube has no identity at all. Two identical shop cubes produce the same camera reading,
// so there is nothing to key on and nothing worth storing. This module is therefore only ever
// about smart cubes, and its absence for camera users is the design, not a gap.
//
// What lives here is DURABLE: it survives disconnects, reloads and different cubes. Trust, the
// tracking offset, the battery level and the anchor flag deliberately do NOT — each describes a
// connection rather than a cube, and persisting one under a cube's name is how yesterday's
// correction gets applied to today's session while looking perfectly reasonable.
//
// Pure: no DOM, no localStorage, no globals. The caller does the I/O.

import { isCubeState, looksLikeCubeState } from './cube-trust.js';

/** Long enough for "Mum's green one", short enough that storage cannot be used as a bucket. */
export const MAX_LABEL = 40;

const MAC_RE = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;
// Escape sequences, not literal bytes: a regex holding raw control characters is
// invisible in a diff and one careless copy-paste from being wrong.
//
// C1 (U+0080-U+009F) and the bidi overrides are here for the same reason as C0. A device name is
// chosen by whatever is advertising, and U+202E reverses everything after it — enough to make one
// remembered cube's row read as another's. Escaping stops it becoming markup; it does not stop it
// lying about which cube you are looking at.
// C0 and C1 controls, plus the whole Unicode "format" category. Enumerating the interesting ones
// by hand kept missing members — U+061C first, then U+00AD and U+FFF9..U+FFFB — because the set is
// 170 code points and growing. \p{Cf} is the set, so it cannot fall behind.
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]|\p{Cf}|\p{Cs}|\p{Co}|\p{Cn}/gu;

/** Oldest timestamp we will believe: 2001-09-09. Anything earlier is not a cube this app has seen,
 *  it is a coercion accident or a corrupted record. */
const EPOCH_FLOOR = 1_000_000_000_000;
/** And the far end: roughly the year 5138. Bounded so one absurd value cannot pin itself to the
 *  top of the list for ever. */
const EPOCH_CEIL = 100_000_000_000_000;

/** A timestamp we are willing to sort by, or 0 for "never used". Deliberately not `Number(v)`:
 *  coercion turns `true` into 1, `"123"` into 123 and `[123]` into 123, and a value between 0 and 1
 *  floors straight onto the 0 sentinel — so a hostile record could claim any position in the list. */
function cleanStamp(value) {
  return Number.isSafeInteger(value) && value >= EPOCH_FLOOR && value <= EPOCH_CEIL ? value : 0;
}

/** How many cubes we will keep. Someone owning more than this many smart cubes is not the case
 *  this bounds — a corrupt or hostile localStorage filling the quota with valid-looking records is,
 *  and every one of them would be parsed, cloned, sorted and rendered on the Settings screen. */
export const MAX_CUBES = 32;

/** The upper bound on a remembered move serial — a validation bound, not a claim about the wire.
 *
 *  The wire value is 16 bits: the GAN gen3/gen4 drivers read `getBitWord(…, 16)` from the FACELETS
 *  frame. What REACHES this app is that counter masked to 8 (`& 0xFF`, in the protocol layer, on
 *  both channels), so every serial stored here is in fact below 256. The bound stays at 2¹⁶
 *  deliberately: it is the width of the counter the cube maintains, so a driver that one day
 *  passes the full value through is accepted rather than silently cleaned to null — and nothing
 *  reads the serial as a number, only as "same or different".
 *
 *  It is information for wording, never proof for trust: the GAN16's counter restarts per
 *  connection, so it says nothing across a break, and `cube-reconnect.js` ignores it on purpose
 *  (measured with the driver's CLI; dev-docs/smart-cube-ux-prd.md, "Reconnecting a known cube"). */
export const SERIAL_MOD = 0x10000;

const LAST_HOW = new Set(['camera', 'cube', 'confirmed']);

/** Is this string an arrangement worth remembering? The structural half is cube-trust's own
 *  `looksLikeCubeState` — one predicate, shared, so this parse and the offset maths can never
 *  disagree about what a facelet string is. The full reachability round-trip runs whenever the
 *  caller injects cubejs; injected, not imported, so this module stays loadable before the
 *  (lazily loaded) solver bundle: a record kept on the structural check alone is re-parsed with
 *  the full one as soon as the library exists, and the reconnect readings validate through
 *  cube-trust again before showing anything. */
function usableState(s, Cube) {
  if (!looksLikeCubeState(s)) return false;
  // Absent means "the library has not loaded yet" and defers to the structural check; anything
  // ELSE goes through the full gate, which fails closed. `typeof Cube === 'function'` here
  // silently downgraded a broken injected library to the weaker check — the one caller mistake
  // this module must not absorb quietly.
  return Cube === null || Cube === undefined ? true : isCubeState(s, Cube);
}

/**
 * The remembered arrangement — the last one the app was SURE of, and what the cube itself said at
 * that moment. Both, not one: after a camera repair the truth and the cube's raw report differ by
 * the offset, and the offset dies on disconnect, so the reconnect comparison is raw-to-raw while
 * the picture shown is the truth.
 *
 * Whitelisted like everything else in this file, and stricter: `facelets`, `reported` and `how`
 * are the load-bearing fields, so a record where any of them is unusable is dropped WHOLE — a
 * half-remembered arrangement is worse than none. The serial and timestamp are cleaned per field
 * (an out-of-range serial becomes null, a bad stamp becomes 0), and anything else is dropped
 * rather than read. Never `trusted`, never `offset`: a memory is a candidate to confirm, not a
 * claim to rely on, and nothing parsed here may reintroduce a session property by being stored.
 */
function cleanLast(value, Cube) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { facelets, reported, serial, at, how } = value;
  if (!usableState(facelets, Cube) || !usableState(reported, Cube)) return null;
  if (!LAST_HOW.has(how)) return null;
  return {
    facelets,
    reported,
    serial: Number.isSafeInteger(serial) && serial >= 0 && serial < SERIAL_MOD ? serial : null,
    at: cleanStamp(at),
    how,
  };
}

/** Newest first, ties broken on address so a list built from this cannot reorder itself between
 *  two renders. ONE comparator: it had three copies, and three copies of an ordering rule is how
 *  two screens end up disagreeing about which cube is "most recent". */
const byRecency = ([am, a], [bm, b]) => b.lastSeen - a.lastSeen || am.localeCompare(bm);

/** Canonical form of a cube address, or '' if the input is not one. Upper case because that is
 *  how every GAN tool prints it, and a registry keyed case-sensitively would hold the same cube
 *  twice. Strings only — no coercion: `String([mac])` would launder an array into an address,
 *  and an object with a throwing toString would escape a function documented to return ''.
 *
 *  MAC-only, deliberately: it answers "is this an address", and callers that need "is this a cube
 *  we can file something under" ask `normaliseIdentity` instead. Widening this one would make
 *  every address check quietly accept a name. */
export function normaliseMac(value) {
  if (typeof value !== 'string') return '';
  const s = value.trim();
  return MAC_RE.test(s) ? s.toUpperCase() : '';
}

/** The prefix that marks a record keyed by device name rather than by address. Spelled once. */
export const NAME_PREFIX = 'name:';

/**
 * The canonical key for a cube: an address where there is one, a device name where there is not.
 *
 * Five of the ten implemented protocols — Giiker, GoCube, MoYu v1, MoYu MHC, GAN gen1 — connect
 * without ever exposing a Bluetooth address, so `normaliseMac` answers '' for them and every
 * registry path keyed on it did nothing at all. Those cubes were documented as "remembered under
 * their NAME" and were in fact never remembered (found 2026-09-04): no nickname, no history, no
 * remembered arrangement, and no row in Settings.
 *
 * A name is a WEAKER identity and the app must not pretend otherwise. Two identical shop cubes
 * broadcast the same name, so `name:` records can collide in a way `mac:` records cannot — which
 * is precisely why the reconnect readings never grant trust from a record and always end at the
 * user confirming the STATE (dev-docs/cube-trust-design.md §0). Nothing here changes that; this
 * only decides where a record is filed.
 *
 * The `name:` prefix is required rather than inferred. Treating any non-address string as a name
 * would file a MISTYPED address — 'AA:BB' — as a cube called "AA:BB", so a caller with a broken
 * address would silently get a record instead of the '' that tells it something is wrong.
 *
 * @returns a canonical MAC, `name:<clean label>`, or '' for anything that is neither.
 */
export function normaliseIdentity(value) {
  const mac = normaliseMac(value);
  if (mac) return mac;
  if (typeof value !== 'string' || !value.startsWith(NAME_PREFIX)) return '';
  const label = cleanLabel(value.slice(NAME_PREFIX.length));
  return label ? NAME_PREFIX + label : '';
}

/** Strip control characters and clamp. Applied to anything a human or a device supplies, because
 *  both end up rendered. */
function cleanLabel(value) {
  if (typeof value !== 'string') return '';
  const clean = value.replace(CONTROL_CHARS, '').trim();
  // By code point, not by code unit. `slice` cuts UTF-16 units, so a name ending in an emoji at the
  // boundary would be stored with half of one — a lone surrogate that renders as a replacement box
  // and compares unequal to itself in the obvious ways.
  return Array.from(clean).slice(0, MAX_LABEL).join('');
}

/**
 * Read a persisted registry back. The argument is UNTRUSTED — it comes from localStorage, which
 * any script on the origin can write and a user can edit by hand.
 *
 * The whitelist is the point: a payload carrying `offset` or `trusted` must not be able to
 * reintroduce them by being stored once, and a half-built record is never preferable to none.
 *
 * @param {unknown} raw
 * @param {Function} [Cube] cubejs constructor; with it, a remembered arrangement must also pass
 *   the full reachability round-trip (cube-trust.js) — without it, the structural checks alone
 * @returns {Record<string, {name: string, nickname: string, lastSeen: number, last?: object}>}
 */
export function parseRegistry(raw, Cube) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    const mac = normaliseIdentity(key);
    if (!mac || !value || typeof value !== 'object' || Array.isArray(value)) continue;
    const rec = {
      name: cleanLabel(value.name),
      nickname: cleanLabel(value.nickname),
      lastSeen: cleanStamp(value.lastSeen),
    };
    const last = cleanLast(value.last, Cube);
    if (last) rec.last = last;
    // Nothing usable survived. Promoting `{}` into a full record contradicted this function's own
    // promise not to build half a one, and turned a corrupt key into a permanent ghost row.
    if (!rec.name && !rec.nickname && !rec.lastSeen) continue;
    // Two raw keys can canonicalise to the same address. Insertion order decided the winner, so a
    // stale lowercase duplicate could erase a newer record's nickname and history; keep whichever
    // has actually been seen more recently.
    const prev = out[mac];
    if (prev && prev.lastSeen >= rec.lastSeen) continue;
    out[mac] = rec;
  }
  // Bounded, most recent first, so a quota-sized registry cannot be rendered as a quota-sized list.
  const kept = Object.entries(out).sort(byRecency).slice(0, MAX_CUBES);
  return Object.fromEntries(kept);
}

/**
 * Record that we have just connected to a cube. Returns a NEW registry: callers hold the old one
 * while comparing, and mutating in place made that a trap.
 *
 * An existing nickname survives — it is the user's word for this cube, and a reconnect is not a
 * reason to forget it. The device-reported name is replaced when the cube supplies a new one,
 * because the cube is the authority on its own name. The remembered arrangement survives too:
 * the reconnect readings exist to compare the fresh connection against it, so the connect that
 * triggers them must not be the write that erases it.
 *
 * `mac` is an IDENTITY, not necessarily an address: `name:<device name>` for the five protocols
 * that never expose one. See `normaliseIdentity`.
 */
export function rememberCube(reg, { mac, name = '', at = 0 } = {}, Cube) {
  const id = normaliseIdentity(mac);
  if (!id) return parseRegistry(reg, Cube);
  const next = parseRegistry(reg, Cube);
  const prev = next[id];
  const rec = {
    name: cleanLabel(name) || prev?.name || '',
    nickname: prev?.nickname || '',
    lastSeen: cleanStamp(at) || prev?.lastSeen || 0,
  };
  if (prev?.last) rec.last = prev.last;
  // Nothing usable to remember, so there is nothing to write. Same rule parseRegistry applies to
  // what it reads, applied here to what we are asked to store.
  if (!rec.name && !rec.nickname && !rec.lastSeen) return next;

  // The cube just connected always survives the bound — it is the one in the user's hand, and a
  // registry full of records claiming newer timestamps would otherwise evict it on the spot.
  // Everything else competes for the remaining places, least recently used dropped first.
  //
  // This is not hypothetical bookkeeping: the migration below stores the legacy address this way
  // and then deletes the only other copy of it, so an eviction here loses an address a browser on
  // macOS will not give back.
  const others = Object.entries(next)
    .filter(([m]) => m !== id)
    .sort(byRecency)
    .slice(0, MAX_CUBES - 1);
  return Object.fromEntries([[id, rec], ...others]);
}

/**
 * Remember what a cube looked like at the last moment the app was sure. Returns a NEW registry,
 * like every writer here; the cube must already be on record (a connect writes the record before
 * any report arrives, so an unknown address reaching this is a caller bug, answered by changing
 * nothing rather than by inventing a half-record). A `last` that does not survive cleanLast is
 * refused the same way — a memory is only worth keeping whole.
 */
export function rememberLast(reg, mac, last, Cube) {
  const id = normaliseIdentity(mac);
  const next = parseRegistry(reg, Cube);
  if (!id || !next[id]) return next;
  const clean = cleanLast(last, Cube);
  if (!clean) return next;
  next[id] = { ...next[id], last: clean };
  return next;
}

/** Give a cube a name of the user's own. A label, never a claim: nothing in the app branches on
 *  it, which is what makes it honest to accept something we cannot verify. */
export function renameCube(reg, mac, nickname) {
  const id = normaliseIdentity(mac);
  const next = parseRegistry(reg);
  if (!id || !next[id]) return next;
  next[id] = { ...next[id], nickname: cleanLabel(nickname) };
  return next;
}

/** Forget a cube entirely. */
export function forgetCube(reg, mac) {
  const id = normaliseIdentity(mac);
  const next = parseRegistry(reg);
  delete next[id];
  return next;
}

/** Known cubes, most recently seen first, each as `{ mac, name, nickname, lastSeen }` — plus
 *  `last`, the remembered arrangement, on cubes that have one (deliberately exposed: the
 *  reconnect readings are its consumer, and a projection that stripped it here would force a
 *  second lookup by address). Ties break on the identity so the list cannot reorder itself between
 *  two renders.
 *
 *  `mac` carries the IDENTITY, which is an address for most cubes and `name:<label>` for the five
 *  protocols that never expose one. The field keeps its name because every caller passes it
 *  straight back to the writers here, all of which take an identity. */
export function listCubes(reg) {
  return Object.entries(parseRegistry(reg))
    .sort(byRecency)
    .map(([mac, rec]) => ({ mac, ...rec }));
}

/** What to call a cube on screen. The user's word wins; the device's name is the fallback; the
 *  identity is the last resort, because a cube with no name is still a cube you must be able to
 *  pick out of a list — shown as the address, or as the remembered name for a cube that has no
 *  address, never as the raw `name:` key. */
export function cubeLabel(rec) {
  if (!rec) return '';
  // Cleaned here too. Callers overlay a live device name straight off the wire — the app's own
  // `liveCubeLabel` does exactly that — which walked round the sanitiser the rest of this module
  // applies. A label is rendered; anything rendered goes through the cleaner.
  const id = normaliseIdentity(rec.mac);
  const fromId = id.startsWith(NAME_PREFIX) ? id.slice(NAME_PREFIX.length) : id;
  return cleanLabel(rec.nickname) || cleanLabel(rec.name) || fromId || '';
}
