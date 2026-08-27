// Cube identity — the durable half of "which cube is this?".
//
// A smart cube names itself: its Bluetooth address is stable, unforgeable by accident, and
// already required to decrypt anything it says. So the app never has to ask which cube it is
// talking to, and never has to trust an answer it cannot check.
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

/** Canonical form of a cube address, or '' if the input is not one. Upper case because that is
 *  how every GAN tool prints it, and a registry keyed case-sensitively would hold the same cube
 *  twice. */
export function normaliseMac(value) {
  const s = String(value ?? '').trim();
  return MAC_RE.test(s) ? s.toUpperCase() : '';
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
 * @returns {Record<string, {name: string, nickname: string, lastSeen: number}>}
 */
export function parseRegistry(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    const mac = normaliseMac(key);
    if (!mac || !value || typeof value !== 'object' || Array.isArray(value)) continue;
    const rec = {
      name: cleanLabel(value.name),
      nickname: cleanLabel(value.nickname),
      lastSeen: cleanStamp(value.lastSeen),
    };
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
  const kept = Object.entries(out)
    .sort(([am, a], [bm, b]) => b.lastSeen - a.lastSeen || am.localeCompare(bm))
    .slice(0, MAX_CUBES);
  return Object.fromEntries(kept);
}

/**
 * Record that we have just connected to a cube. Returns a NEW registry: callers hold the old one
 * while comparing, and mutating in place made that a trap.
 *
 * An existing nickname survives — it is the user's word for this cube, and a reconnect is not a
 * reason to forget it. The device-reported name is replaced when the cube supplies a new one,
 * because the cube is the authority on its own name.
 */
export function rememberCube(reg, { mac, name = '', at = 0 } = {}) {
  const id = normaliseMac(mac);
  if (!id) return parseRegistry(reg);
  const next = parseRegistry(reg);
  const prev = next[id];
  const rec = {
    name: cleanLabel(name) || prev?.name || '',
    nickname: prev?.nickname || '',
    lastSeen: cleanStamp(at) || prev?.lastSeen || 0,
  };
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
    .sort(([am, a], [bm, b]) => b.lastSeen - a.lastSeen || am.localeCompare(bm))
    .slice(0, MAX_CUBES - 1);
  return Object.fromEntries([[id, rec], ...others]);
}

/** Give a cube a name of the user's own. A label, never a claim: nothing in the app branches on
 *  it, which is what makes it honest to accept something we cannot verify. */
export function renameCube(reg, mac, nickname) {
  const id = normaliseMac(mac);
  const next = parseRegistry(reg);
  if (!id || !next[id]) return next;
  next[id] = { ...next[id], nickname: cleanLabel(nickname) };
  return next;
}

/** Forget a cube entirely. */
export function forgetCube(reg, mac) {
  const id = normaliseMac(mac);
  const next = parseRegistry(reg);
  delete next[id];
  return next;
}

/** Known cubes, most recently seen first, each as `{ mac, name, nickname, lastSeen }`.
 *  Ties break on address so the list cannot reorder itself between two renders. */
export function listCubes(reg) {
  return Object.entries(parseRegistry(reg))
    .map(([mac, rec]) => ({ mac, ...rec }))
    .sort((a, b) => b.lastSeen - a.lastSeen || a.mac.localeCompare(b.mac));
}

/** What to call a cube on screen. The user's word wins; the device's name is the fallback; the
 *  address is the last resort, because a cube with no name is still a cube you must be able to
 *  pick out of a list. */
export function cubeLabel(rec) {
  if (!rec) return '';
  // Cleaned here too. Callers overlay a live device name straight off the wire — the app's own
  // `liveCubeLabel` does exactly that — which walked round the sanitiser the rest of this module
  // applies. A label is rendered; anything rendered goes through the cleaner.
  return cleanLabel(rec.nickname) || cleanLabel(rec.name) || normaliseMac(rec.mac) || '';
}
