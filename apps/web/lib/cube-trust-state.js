// Whether the app KNOWS what the connected cube looks like, and everything on screen that says so:
// trust granted (markTrusted) and lapsing (markStale), the tracking correction thrown away
// (clearOffset), "connected" itself (setConnected), the title-bar indicator, and the Settings
// repaint that waits for typing to stop.
//
// It sits beneath the connection code and the screens. What it asks of the session — whether it has
// refused the cube — it asks lib/live-session.js, beneath it. It reaches the shell only through
// `shell`, and a mounted screen only through `hooks`.
//
// Lifted out of lib/cube-connection.js on 2026-09-13 (the connection design's second unit).
import { $, state } from './app-state.js';
import { liveCubeLabel } from './cube-memory.js';
import { normaliseIdentity } from './cube-registry.js';
import { hooks, shell } from './screen-slots.js';
import { cubeRefused } from './live-session.js';
import { applyOffset, isIdentity } from './cube-trust.js';

/** Is the live CHAIN trusted — trusted knowledge of the cube itself, not of a generated
 *  subject? 'generated' sets `trusted` too (a scramble is perfectly known), but that is
 *  knowledge of a scramble, and filing it as what the cube looked like is exactly the
 *  confidently-wrong record this distinction exists to prevent. 'painted' is the same kind of
 *  knowledge (a cube authored by hand, 2026-09-20) and is excluded for the same reason. One
 *  predicate, because the places that ask it — the trusted-update write, the disconnect
 *  timestamp, the walk's live distance and the timer's hint — must never drift.
 *
 *  A CHAIN is a connected cube's reports, so there is none without a connection (2026-09-21): a
 *  camera scan with no cube paired adopts `trusted` and `source: 'camera'` exactly as one with a
 *  cube does, and this predicate answered yes for it — so the Timer promised "the clock starts
 *  itself" with nothing connected to start it. And a REFUSED cube is followed by nothing at all:
 *  the indicator had carried that clause on its own, beside this predicate, so a refused session
 *  later marked camera-trusted was "tracking" to the walk and the timer and "unverified" to the
 *  dot. Both belong here, once. */
export const chainTrusted = () =>
  state.connected && state.cube.trusted
  && (state.cube.source === 'cube' || state.cube.source === 'camera') && !cubeRefused();

/** Throw the correction away. NOT called on `gap`: a serial skip means moves were missed, not
 *  that the reference moved — what was lost is the moves in between, not the relationship. */
export function clearOffset() {
  state.cube.offset = null;
  state.cube.offsetAt = 0;
  state.cube.offsetFrom = '';
}

/** Install a correction, named for where it came from, and answer the first of `reports` it
 *  corrects. Null when it corrects none, and then NOTHING is committed: a correction recorded as a
 *  scan's or an answer's is a claim, and one that could not be applied must not leave it behind. */
export function installOffset(offset, from, reports, Cube) {
  const next = isIdentity(offset) ? null : offset;
  for (const reported of reports) {
    const corrected = applyOffset(next, reported, Cube);
    if (corrected === null) continue;
    state.cube.offset = next;
    state.cube.offsetAt = next ? Date.now() : 0;
    state.cube.offsetFrom = next ? from : '';
    return corrected;
  }
  return null;
}

/** Is someone mid-typing in a cube-settings input? Async repaints of Settings defer rather than
 *  discard what is being typed. ONE predicate on purpose — it had two copies, and two copies of
 *  a focus check is how one repaint path eats input while the other politely waits. */
const editingCubeSettings = () => {
  const el = document.activeElement;
  return Boolean(el && (el.id === 'macIn' || el.dataset?.renameCube));
};
/** A Settings repaint that arrived mid-typing. DEFERRED is not DROPPED: without the flush on
 *  focusout (wired in the Settings mount, `flushSettingsRepaint`), a battery or trust change
 *  landing while a nickname was being typed stayed stale on screen indefinitely. */
export let settingsRepaintPending = false;
/** The Settings screen the deferral was made UNDER — its root on the stage. A full render of
 *  Settings from anywhere else (a navigation away and back, a caller that redraws the screen
 *  itself after `withRepaintsHeld`) replaces that root and shows the state the deferral was
 *  waiting to show, so it is what says whether a deferral still has anything to repaint. */
let deferredUnder = null;
const stageRoot = () => $('#stage')?.firstElementChild ?? null;
/** True while a caller that redraws the screen itself is running — see withRepaintsHeld. */
let repaintsHeld = false;
export const repaintSettings = () => {
  if (state.screen !== 'settings' || repaintsHeld) return;
  if (editingCubeSettings()) { settingsRepaintPending = true; deferredUnder = stageRoot(); return; }
  settingsRepaintPending = false;
  deferredUnder = null;
  shell.renderScreen();
};

/** The deferred repaint, once typing has stopped — the Settings mount's focusout.
 *
 *  Made only while the Settings the deferral was made under is still the one on stage. The flag
 *  used to be read bare, and it survived every full render that was not this module's own: a
 *  battery landing mid-typing, then a navigation away and back, left a fresh Settings — already
 *  showing that battery — that a later focusout rebuilt for nothing; a Yes on the reconnect
 *  question rendered Settings itself and then again when the stale flag flushed (audit-fix,
 *  2026-09-21). A render that replaced the root CONSUMED the deferral, so it is dropped here. */
export const flushSettingsRepaint = () => {
  if (!settingsRepaintPending) return;
  if (deferredUnder !== stageRoot()) {
    settingsRepaintPending = false;
    deferredUnder = null;
    return;
  }
  repaintSettings();
};

/** Run `fn` with Settings' repaints held back, for a caller that redraws the screen as soon as it
 *  returns: one answer is one rebuild, not one per trust change made along the way. */
export function withRepaintsHeld(fn) {
  const was = repaintsHeld;
  repaintsHeld = true;
  try { return fn(); } finally { repaintsHeld = was; }
}

/** Everything on screen that is derived from trust, repainted together. Trust is the one claim
 *  this model exists to make honestly; every place that repeats it changes at the same moment. */
function trustChanged() {
  repaintIndicator();
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
  // A screen that throws while standing down is said, and the lapse still reaches the indicator:
  // trust is already cleared, so a swallowed throw left a screen half stood down, in silence.
  if (lapsed && hooks.onTrustLost) {
    try {
      hooks.onTrustLost();
    } catch (err) {
      console.error('a screen failed to stand down as trust lapsed', err);
    }
  }
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
  // The CHAIN's trust, not the subject's: a generated scramble is perfectly known and says nothing
  // about where the connected cube is, and a refused cube is followed by nothing at all — both
  // of which the predicate says, so nothing is added to it here (2026-09-21).
  const ok = chainTrusted();
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

/** The title-bar indicator, repainted from the model as it is now. Trust and the connection
 *  reach it through here, and so does a rename, which changes only what it says. */
export function repaintIndicator() {
  const live = $('#cubeLive');
  if (live) paintTrust(live);
}

export function setConnected(on, name = '', mac = '') {
  // Compared so a call that changes nothing does not re-render: doConnect's failure path calls
  // setConnected(false) while already disconnected, and the resulting teardown discarded the DOM
  // the caller's catch was about to write its error into.
  const identity = () => `${state.connected}|${state.cubeName}|${state.cubeMac}`;
  const before = identity();
  // normaliseIdentity, not normaliseMac: five of the ten protocols never expose an address, and
  // stripping their `name:` key here emptied state.cubeMac — which every registry write then
  // bailed on (`!state.cubeMac`), so those cubes were never remembered and never matched their
  // own row in Settings.
  state.connected = on; state.cubeName = name; state.cubeMac = on ? normaliseIdentity(mac) : '';
  const changed = identity() !== before;
  // A battery level belongs to a connection, so it goes with the connection and stays with it:
  // it was reset on every call, including one that changed nothing — which the comparison below
  // then declined to repaint, leaving Settings' meter showing a level the model no longer held
  // (audit-fix, 2026-09-21). What changes nothing changes nothing.
  if (changed) state.battery = null;
  // The anchor belongs to a connection, not to the app.
  if (!on) state.anchored = false;
  repaintIndicator();
  // Through the typing guard, like every other async repaint of Settings: a cube dropping while a
  // nickname was being typed rebuilt the card under the field, and the text went with it.
  if (changed) repaintSettings();
}

/** We now know what the cube looks like, and by what means. */
export function markTrusted(source) {
  // A refusal is about the CUBE, and only a fresh connection can revisit it. Trust sourced from
  // 'cube' means "its own reports say so", which is exactly the claim the checker has disproved —
  // so an anchor or a confirmation must not be able to buy it back. 'camera', 'generated' and
  // 'painted' are knowledge from elsewhere and are unaffected; the guard is at this choke point
  // rather than at each caller for the same reason every other trust change passes through here.
  if (source === 'cube' && cubeRefused()) return;
  if (state.cube.trusted && state.cube.source === source) return;
  state.cube.trusted = true;
  state.cube.source = source;
  state.cube.staleWhy = '';
  trustChanged();
}
