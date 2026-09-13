// What the app remembers about smart cubes across connections: the registry of known cubes, the
// arrangement each was last seen in, and the words a remembered cube is shown in.
//
// It owns `cubes` and `registryWriteBad`, and nothing else writes them: Settings renames and forgets
// through the operations below, boot re-parses, and a connection is remembered through
// `rememberConnection`. It sits beneath the connection code and the screens and reaches up to neither
// — `rememberArrangement` returns whether a write's health flipped, and the caller repaints.
//
// Lifted out of lib/cube-connection.js on 2026-09-13 (the connection design's first unit).
import { state } from './app-state.js';
import { Cube } from './solver-service.js';
import { locale } from './i18n.js';
import { load, save } from './app-settings.js';
import {
  cubeLabel, forgetCube, listCubes, NAME_PREFIX, normaliseIdentity, normaliseMac, parseRegistry,
  rememberCube, rememberLast, renameCube,
} from './cube-registry.js';

// One durable record per cube. Only durable facts live here — trust, the tracking offset, the
// battery and the anchor flag are properties of a CONNECTION and are deliberately excluded
// (see lib/cube-registry.js).
export let cubes = parseRegistry(load('cubusCubes', {}));

/** The address a bare "Pair" should try: whichever cube was used most recently — and only if it
 *  HAS one. Since a cube with no address is remembered under `name:<its name>` (normaliseIdentity),
 *  the most recent record's key is not necessarily an address, and handing `name:green cube` to
 *  the protocol layer as a Bluetooth address is a connect that cannot work and cannot say why. */
export const lastCubeMac = () => listCubes(cubes).map((c) => normaliseMac(c.mac)).find(Boolean) || '';

/** Did the last registry write fail? Announced in Settings: a memory that failed to save must
 *  not look like one that saved — on the next reconnect the app would ask its question over
 *  nothing and call a known cube new. */
export let registryWriteBad = false;

/**
 * "Tuesday 21:40" — the dress a memory wears. A remembered arrangement is a memory with a
 * timestamp and is shown as one, never as the truth. Empty parts when the stamp is missing.
 *
 * Through `Intl`, in the app's locale, for two separate reasons. The weekday names were a
 * hard-coded English array and the clock a hard-coded 24-hour pad, so a translated app would have
 * said "Tuesday" in the middle of a Chinese sentence and shown 21:40 to a reader whose region
 * writes 9:40 PM — the mechanism was there, this was simply outside it.
 *
 * And a weekday ALONE IS A DATE THAT LIES once it is more than a week old. "Tuesday 21:40" for a
 * cube last seen five weeks ago names this week's Tuesday to every reader. Inside six days a
 * weekday is the friendliest true form; past that it takes a date (found by audit, 2026-09-04).
 */
const SIX_DAYS_MS = 6 * 24 * 60 * 60 * 1000;
export function whenWords(ts, now = Date.now()) {
  if (!ts) return { day: '', full: '' };
  const d = new Date(ts);
  const fmt = (opts) => {
    try { return new Intl.DateTimeFormat(locale(), opts).format(d); } catch { return ''; }
  };
  const recent = now - ts < SIX_DAYS_MS && ts <= now;
  const day = recent ? fmt({ weekday: 'long' }) : fmt({ day: 'numeric', month: 'short' });
  const time = fmt({ hour: 'numeric', minute: '2-digit' });
  return { day, full: day && time ? `${day} ${time}` : day || time };
}

/** How a registry KEY reads on screen. An address is shown as itself; a `name:` key is a filing
 *  detail and is shown as the fact behind it, so no screen ever prints a string a user might
 *  mistake for something they could type into the address field. */
export const idWords = (id) => (String(id).startsWith(NAME_PREFIX) ? '(no address)' : `at ${id}`);

/** What to call the connected cube. The user's own word wins; the cube's own name is the
 *  fallback. One helper so a nickname cannot appear on one screen and not another. */
export const liveCubeLabel = () =>
  cubeLabel({ ...cubes[state.cubeMac], mac: state.cubeMac, name: state.cubeName }) || 'Smart cube';

/**
 * The identity a connected cube is remembered under — ITS OWN, and nothing else's.
 *
 * A cube with no address is remembered under its NAME rather than under an empty string. Only the
 * GAN protocols expose a MAC; the others report '', and keying the registry on that makes every
 * such cube the same cube — one nickname, one shared last-seen record, and a reconnect that
 * greets a stranger with another cube's memory.
 *
 * `name:` is the registry's own prefix (NAME_PREFIX), spelled once there: every path that stores
 * or looks up a record runs the id through `normaliseIdentity`, which is what makes this a key
 * rather than a string that merely looks like one. It was a bare template literal here and
 * `normaliseMac` everywhere else, so these cubes were documented as remembered and were in fact
 * never written at all.
 *
 * ONE ARGUMENT, and that is the fix of 2026-09-05. This used to fall back to the address the
 * connect attempt had been GIVEN — `macFromUi` or, failing that, `lastCubeMac()`, the most
 * recently used remembered cube. So connecting an addressless cube while a GAN was the last cube
 * used filed it under the GAN's MAC: two cubes, one record, each inheriting the other's nickname,
 * history and remembered arrangement, and a reconnect question about the wrong cube. The session's
 * resolved address is the only evidence there is — the protocol layer publishes `deviceMAC` when
 * it has one, including one it took from the provider and then VERIFIED against the cube — so an
 * empty one means no address was established, and the name is the honest key.
 */
export function sessionIdentity(session) {
  return normaliseIdentity(session?.mac)
    || normaliseIdentity(NAME_PREFIX + (session?.name || 'cube'));
}

/** Write the remembered arrangement: the truth the app is currently sure of, and the cube's own
 *  raw report at the same moment. Called on every update that arrives on a trusted chain;
 *  deduplicated on content so the ~1 Hz resend of an unchanged state does not become a storage
 *  write per second — and `force` refreshes the timestamp anyway at moments worth naming (a
 *  confirmation, a repair, the disconnect that ends the chain).
 *
 *  Returns whether the write's health FLIPPED, so the caller repaints what shows it: the memory sits
 *  beneath the screens and does not reach up to them. `serial` is the connection's, passed in. */
export function rememberArrangement(how, { force = false, serial = null } = {}) {
  if (!state.connected || !state.cubeMac || !state.live || !state.reported) return false;
  const prev = cubes[state.cubeMac]?.last;
  if (!force && prev && prev.facelets === state.live && prev.reported === state.reported
    && prev.serial === serial && prev.how === how) return false;
  cubes = rememberLast(cubes, state.cubeMac, {
    facelets: state.live, reported: state.reported, serial, at: Date.now(), how,
  }, Cube);
  const ok = save('cubusCubes', cubes);
  if (ok === !registryWriteBad) return false;
  registryWriteBad = !ok;
  return true;
}

/** Record a live connection in the registry. A memory that failed to save must not look like one that
 *  saved: on the next reconnect the app would greet a known cube as a stranger. save() already logs;
 *  Settings says it in words. */
export function rememberConnection(mac, name) {
  cubes = rememberCube(cubes, { mac, name, at: Date.now() }, Cube);
  registryWriteBad = !save('cubusCubes', cubes);
}

/** The user's word for a cube. Stored because it is useful, never branched on. A failed save is the
 *  caller's to say — it is not a registry-health change (that flag is about remembering connections). */
export function renameKnownCube(id, label) {
  cubes = renameCube(cubes, id, label);
  return { saved: save('cubusCubes', cubes), record: cubes[normaliseIdentity(id)] };
}

/** Forget a cube: the one registry change the app cannot re-derive. Returns whether it was stored. */
export function forgetKnownCube(id) {
  cubes = forgetCube(cubes, id);
  return save('cubusCubes', cubes);
}

/** Re-parse what storage held once the cube library exists: the load-time parse had only the
 *  structural checks, so a forged arrangement that merely looks like facelets is dropped here. */
export function reparseRegistry() {
  cubes = parseRegistry(cubes, Cube);
}
