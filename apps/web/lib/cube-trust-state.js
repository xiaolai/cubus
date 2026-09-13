// Whether the app KNOWS what the connected cube looks like, and everything on screen that says so:
// trust lapsing (markStale), the tracking correction thrown away (clearOffset), "connected" itself
// (setConnected), the title-bar indicator, and the Settings repaint that waits for typing to stop.
//
// Trust is GRANTED in lib/cube-connection.js (markTrusted), because granting it first asks the
// session whether it has refused the cube — a question this module cannot ask without reaching up
// to the connection. That grant repaints through trustChanged, here. This module sits beneath the
// connection code and the screens: it reaches the shell only through `shell`, and a mounted screen
// only through `hooks`.
//
// Lifted out of lib/cube-connection.js on 2026-09-13 (the connection design's second unit).
import { $, state } from './app-state.js';
import { liveCubeLabel } from './cube-memory.js';
import { normaliseIdentity } from './cube-registry.js';
import { hooks, shell } from './screen-slots.js';

/** Is the live CHAIN trusted — trusted knowledge of the cube itself, not of a generated
 *  subject? 'generated' sets `trusted` too (a scramble is perfectly known), but that is
 *  knowledge of a scramble, and filing it as what the cube looked like is exactly the
 *  confidently-wrong record this distinction exists to prevent. One predicate, because the places
 *  that ask it — the trusted-update write, the disconnect timestamp, the walk's live distance and
 *  the timer's hint — must never drift. */
export const chainTrusted = () =>
  state.cube.trusted && (state.cube.source === 'cube' || state.cube.source === 'camera');

/** Throw the correction away. NOT called on `gap`: a serial skip means moves were missed, not
 *  that the reference moved — what was lost is the moves in between, not the relationship. */
export function clearOffset() {
  state.cube.offset = null;
  state.cube.offsetAt = 0;
  state.cube.offsetFrom = '';
}

/** Is someone mid-typing in a cube-settings input? Async repaints of Settings defer rather than
 *  discard what is being typed. ONE predicate on purpose — it had two copies, and two copies of
 *  a focus check is how one repaint path eats input while the other politely waits. */
const editingCubeSettings = () => {
  const el = document.activeElement;
  return Boolean(el && (el.id === 'macIn' || el.dataset?.renameCube));
};
/** A Settings repaint that arrived mid-typing. DEFERRED is not DROPPED: without the flush on
 *  focusout (wired in the Settings mount), a battery or trust change landing while a nickname
 *  was being typed stayed stale on screen indefinitely. */
export let settingsRepaintPending = false;
export const repaintSettings = () => {
  if (state.screen !== 'settings') return;
  if (editingCubeSettings()) { settingsRepaintPending = true; return; }
  settingsRepaintPending = false;
  shell.renderScreen();
};

/** Everything on screen that is derived from trust, repainted together. Trust is the one claim
 *  this model exists to make honestly; every place that repeats it changes at the same moment. */
export function trustChanged() {
  const live = $('#cubeLive');
  if (live) paintTrust(live);
  // The read-from-cube button this used to relabel is gone: its job — naming whether the screen's
  // subject is the cube in your hand — is done by the reconnect question's Yes / camera pair,
  // which renders with the screen rather than being repainted here.
  // Settings derives its setup checklist from trust; deferred while an input there has focus,
  // for the same reason the battery redraw is.
  repaintSettings();
}

/** Something happened that we cannot see through. The state is NOT discarded — a loudly-flagged
 *  stale cube is more useful than an empty screen. */
export function markStale(why) {
  if (!state.cube.trusted && state.cube.staleWhy === why) return;
  const lapsed = state.cube.trusted;
  state.cube.trusted = false;
  state.cube.staleWhy = why;
  // Only an actual lapse notifies — a stale cube going stale for a new reason is a wording
  // change, not an event a screen needs to stand down for.
  if (lapsed && hooks.onTrustLost) { try { hooks.onTrustLost(); } catch {} }
  trustChanged();
}

/** One indicator, three states — absent, stale, trusted — because "connected" was never the
 *  question a user needs answered. */
function paintTrust(el) {
  const on = state.connected;
  const say = $('#cubeLiveSay');
  el.hidden = !on;
  if (!on) {
    // An absent cube announces nothing rather than announcing an absence: the region is emptied,
    // so leaving Settings after a disconnect does not read the last state out again.
    if (say) say.textContent = '';
    return;
  }
  const ok = state.cube.trusted;
  el.classList.toggle('stale', !ok);
  const who = liveCubeLabel();
  // The button's NAME says what it is and where it goes — it is a control, and its name has to
  // survive the state changing under it. The STATE is the status region's, beside it.
  el.setAttribute('aria-label', `${who} — smart cube settings`);
  const words = ok
    ? `${who}: tracking`
    : `${who}: position unverified — ${state.cube.staleWhy || 'read the cube again'}`;
  if (say && say.textContent !== words) say.textContent = words;
  el.title = ok
    ? `${who} connected${Number.isFinite(state.battery) ? ` · ${state.battery}% battery` : ''} · tracking`
    : `${who} connected, but ${state.cube.staleWhy || 'its position is unverified'} — read the cube again`;
}

export function setConnected(on, name = '', mac = '') {
  // Compared so a call that changes nothing does not re-render: doConnect's failure path calls
  // setConnected(false) while already disconnected, and the resulting teardown discarded the DOM
  // the caller's catch was about to write its error into.
  const before = `${state.connected}|${state.cubeName}|${state.cubeMac}`;
  // normaliseIdentity, not normaliseMac: five of the ten protocols never expose an address, and
  // stripping their `name:` key here emptied state.cubeMac — which every registry write then
  // bailed on (`!state.cubeMac`), so those cubes were never remembered and never matched their
  // own row in Settings.
  state.connected = on; state.cubeName = name; state.cubeMac = on ? normaliseIdentity(mac) : '';
  state.battery = null;
  // The anchor belongs to a connection, not to the app.
  if (!on) state.anchored = false;
  const live = $('#cubeLive');
  if (live) paintTrust(live);
  if (state.screen === 'settings' && before !== `${state.connected}|${state.cubeName}|${state.cubeMac}`) {
    shell.renderScreen();
  }
}
