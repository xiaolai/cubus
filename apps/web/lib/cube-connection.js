// The smart cube's connection: pairing one attempt at a time, the battery, what this host can
// reach a radio with, and the test seam that stands in for a paired cube. Each session it takes
// hold of reports into lib/cube-reports.js, which opens the reconnect question and ends the
// connection. What the app remembers about a cube is lib/cube-memory.js; whether it knows what the
// connected cube looks like, and what on screen says so, is lib/cube-trust-state.js; the answer to
// the reconnect question is lib/reconnect-answer.js, which sits above this module; and the session
// itself is held in lib/live-session.js, beneath all of them. It sits beneath the screens and
// reaches neither the shell nor a mounted screen.
//
// Lifted out of app.js on 2026-09-13, when that file was split into modules.

import { hostPlatform } from './host.js';
// The smart-cube strands, recovered from v0 (2026-08-27): the transport seam (Web Bluetooth in a
// browser, native BLE events under Tauri), one durable record per cube, and the trust model that
// keeps "connected" from standing in for "known".
import { connectCube, VERDICT } from './cube-session.js';
import { normaliseMac } from './cube-registry.js';
// What the host can actually reach a radio with. Imported rather than re-derived: the list of
// platforms whose native BLE is not yet proved on a device is one line in one file by design
// ("THE FLIP IS THIS LINE"), and a second copy here would let the app offer Pair on a platform
// that file had already refused.
import { NATIVE_BLE_UNSUPPORTED } from './ble-bridge.js';

import { state } from './app-state.js';
import { Cube, loadSolver } from './solver-service.js';
import { ingestFacelets, takeDerivation } from './cube-subject.js';
import { isTauri } from './window-chrome.js';
import { lastCubeMac, sessionIdentity } from './cube-memory.js';
import { markStale, markTrusted, repaintSettings } from './cube-trust-state.js';
import { conn, holdSession } from './live-session.js';
import {
  adoptConnection, onCubeMove, onDisconnect, onFacelets, onMovesLost, reportSilence,
} from './cube-reports.js';

// ---- smart cube: the connection (recovered from v0) -----------------------------

/**
 * Can this host reach a radio at all, and by which route?
 *
 * The SAME ladder `installBleBridge` walks, asked without building a bridge: a bridge registers
 * native event listeners, and one constructed at render time beside a live session would sit
 * there warning about every packet it could not place. The one line that can drift — which
 * native platforms are refused until somebody has run the app on a real device — is imported
 * rather than copied, because that list is deliberately kept in one place ("THE FLIP IS THIS
 * LINE", ble-bridge.js).
 *
 * Answered at RENDER time, never memoised: `?platform=` pins the answer for design review, and a
 * value cached before boot published `<html data-platform>` would be the wrong one forever.
 *
 * @returns {'native'|'browser'|'refused-host'|'none'}
 */
export function bleReach() {
  if (isTauri && NATIVE_BLE_UNSUPPORTED.includes(hostPlatform())) return 'refused-host';
  if (isTauri) return 'native';
  if (globalThis.navigator?.bluetooth) return 'browser';
  return 'none';
}

/** Whether the Pair button is drawn at all. A control that can never work on this platform is
 *  furniture: it invites a press, fails, and explains afterwards in words written for a
 *  different host. The row still says what the platform can do — the capability is named
 *  everywhere, it is only OFFERED where it exists. */
export const canPair = () => bleReach() === 'native' || bleReach() === 'browser';

/** Why, in the user's terms. Host-specific, because "this cannot work here" is useless without
 *  "and here is what does". Every branch keeps the camera in view: it is the path that works on
 *  every platform, and a beginner reading a Bluetooth refusal needs to know the app still does
 *  its job. */
export function bleReachNote() {
  switch (bleReach()) {
    case 'native':
      return 'Pairing scans for a nearby cube — turn it first so its radio is awake.';
    case 'browser':
      return 'Pairing opens your browser’s device chooser — turn the cube first so it appears in the list.';
    case 'refused-host':
      // Named for the platform, and true: the Rust and Kotlin BLE paths compile and have never
      // spoken to a radio, so the app refuses rather than offering a connect that would fail in
      // a way nobody could read (ble-bridge.js says what a device run must show first).
      return hostPlatform() === 'ios'
        ? 'Smart cubes are off on iPhone and iPad for now — cubus has not been tried against a real cube on this hardware, and offering it before that would mean guessing. The camera reads your cube here exactly as it does everywhere else.'
        : 'Smart cubes are off on Android for now — cubus has not been tried against a real cube on an Android phone, and offering it before that would mean guessing. The camera reads your cube here exactly as it does everywhere else.';
    default:
      return 'This browser cannot use Bluetooth. Chrome, Edge or the desktop app can — and the camera works either way.';
  }
}

/** Read the cube's battery and publish it. The cube answers on request only. */
export async function refreshBattery() {
  if (!conn) return;
  // Scoped to the connection that asked: a slow reply from a cube you have since disconnected
  // must not land as the current cube's battery level.
  const asked = conn;
  try {
    // `null` means the cube would not say, and it must stay unknown. `Number(null)` is 0, which
    // is finite — so the old line drew a flat battery for a cube that simply had not answered,
    // which is the "never invent data" rule broken in the most alarming direction available.
    const answer = await conn.requestBattery();
    if (conn !== asked) return;
    const level = answer === null || answer === undefined ? Number.NaN : Number(answer);
    if (Number.isFinite(level)) {
      state.battery = Math.max(0, Math.min(100, Math.round(level)));
      // A reply can land while someone is typing a nickname or an address into this very card,
      // and rebuilding the card discards what they typed — so the redraw is deferred, not faked.
      repaintSettings();
    }
  } catch {
    if (conn !== asked) return;
    // A cube that will not answer its battery is still a usable cube. Leave the level unknown
    // and let the UI say so, rather than drawing a fictional meter.
    state.battery = null;
  }
}

let connecting = null;
export async function doConnect(macFromUi) {
  // Single-flight: two overlapping attempts raced through the shared transport/conn state, the
  // loser tearing down the winner's transport half-way through its own handshake.
  if (connecting) return connecting;
  connecting = (async () => {
    try { return await connectOnce(macFromUi); } finally { connecting = null; }
  })();
  return connecting;
}

async function connectOnce(macFromUi) {
  if (conn) { try { await conn.disconnect(); } catch {} holdSession(null); }
  try {
    // The self-check needs cubejs, and a cube paired before the solver finished loading would be
    // REFUSED for a reason that has nothing to do with the cube — an alarming verdict caused by
    // our own start-up ordering. Wait for it instead; it is already loading.
    if (!Cube) await loadSolver().catch(() => {});
    if (!Cube) throw new Error('still starting up — try again in a moment');
    // Validated before it is offered as an address. The field accepts whatever was typed and a
    // remembered key may be a `name:` id, and the protocol layer takes this as a MAC — so
    // anything that is not one is no answer at all, and letting it through asked the cube to be
    // found at an address that does not exist.
    const typed = normaliseMac(String(macFromUi ?? '').trim()) || lastCubeMac();
    // The typed address is a FALLBACK, not the source. Nearly every cube broadcasts its own and
    // the protocol layer reads it per brand; this only answers when the advertisement did not
    // carry one. It used to be mandatory in the browser, which asked a beginner for a hexadecimal
    // address before they could connect at all.
    //
    // It is an ANSWER TO THE PROTOCOL LAYER and never an identity: what it supplies here is
    // checked against the cube (the library verifies a provided MAC before the connection stands)
    // and comes back as `session.mac` if it holds. Feeding it to the registry directly is what
    // made an addressless cube inherit the last cube's record — see sessionIdentity.
    const session = await connectCube({
      Cube,
      macProvider: typed ? async () => typed : undefined,
    });

    // Every callback is scoped to ITS session: a slow packet or a late disconnect from a
    // connection since replaced must not mutate the new cube's state or tear it down.
    session.onFacelets((facelets, serial) => { if (conn === session) onFacelets(facelets, serial); });
    // Following runs on moves (immediate); snapshots (~1Hz) only correct drift — a turn sequence
    // completed inside one second has no intermediate snapshots.
    // Through onCubeMove, not straight to `liveMove`: the self-check's gate lives there so the
    // test seam passes through the same one the driver does, and so does the one piece of
    // bookkeeping that must happen on EVERY turn whether or not a screen is following.
    session.onMove((m) => { if (conn === session) onCubeMove(m); });
    session.onDisconnect(() => { if (conn === session) onDisconnect(); });
    // Trust lapses HERE rather than in a screen's handler, so a verdict changing while you are in
    // Settings is not dropped. This replaces the driver's `gap` event and is a better trigger: the
    // old one fired on a serial jump, this one fires when the cube's own moves and its own
    // reported state stop agreeing — which is what a lost turn actually IS, proved rather than
    // inferred, and available on every brand instead of only those that number their moves.
    session.onVerdict((verdict) => {
      if (conn !== session) return;
      if (verdict === VERDICT.REFUSED) markStale('its reports stopped adding up');
    });
    // A lost turn is its OWN signal, not a shade of the verdict (2026-09-04). The whole point of
    // tolerating a loss is that a trusted cube SURVIVES it — so on the cube this matters most for,
    // the verdict and the reason are identical before and after, and a screen watching the verdict
    // announces nothing. Standing follow down, refusing the timer's result and saying what
    // happened all live behind onMovesLost, and this is the door they arrive through.
    session.onMovesLost(() => { if (conn === session) onMovesLost(); });

    holdSession(session);
    adoptConnection(sessionIdentity(session), session.name || 'Smart cube');
    // The reply is NOT fed to onFacelets here. It arrives on the event stream too, and the
    // permanent listener above already handles it — passing it on as well delivered the
    // connection's first report twice, which runs the reconnect classification against a question
    // its own first answer had already closed.
    session.requestState().catch((e) => {
      // Said, not swallowed: this rejection used to vanish into an empty catch, and the screen
      // showed a connected cube that had said nothing. The passive stream may still deliver a
      // first report later; until it does, the reading is 'no report' and the screens say so.
      if (conn !== session) return;
      console.warn('the cube did not answer its state request', e);
      reportSilence();
    });
    // Ask the cube rather than inventing a number — a flat battery is what disconnects a cube
    // mid-solve, and a mid-solve disconnect is what silently desyncs its tracking from reality.
    void refreshBattery();
  } catch (err) {
    if (conn) { try { await conn.disconnect(); } catch {} }
    onDisconnect();
    throw err;
  }
}

/** Make `facelets` the arrangement the app is about.
 *  `physical` says whether it is the cube in the user's hand — a scan or a confirmed cube report
 *  is; a generated scramble is not, however well we know it.
 *  `setupAlg` is for a caller that ALREADY searched for it — see takeDerivation. */
export function adoptCube(facelets, { physical, source, setupAlg = '' } = { physical: false, source: 'generated' }) {
  ingestFacelets(facelets);
  if (setupAlg) takeDerivation(facelets, setupAlg);
  state.cube.isPhysical = physical;
  markTrusted(source);
}

/** Test seam for the cube stream. In production the driver is the only caller of these (see
 * doConnect); following cannot otherwise be exercised without a physical GAN cube in the room,
 * which is precisely why its worst bug survived so long. Same shape as `window.cubusGo` in
 * lib/app.js. */
window.cubusFeed = {
  move: (m) => onCubeMove(m),
  facelets: (f, serial) => onFacelets(f, serial),
  /** A turn that reached the cube but not us. No argument: reconciliation proves the loss and
   *  cannot count it, so a seam that took a number would let a test assert something the app can
   *  never know. */
  movesLost: () => onMovesLost(),
  disconnect: () => onDisconnect(),
  /** The cube answered nothing — what connectOnce's getState rejection reports. Exposed because
   *  that path needs Web Bluetooth to exercise for real, and the silence handling is exactly the
   *  behaviour that was once an empty catch. */
  silence: () => reportSilence(),
  /** Stand in for a paired driver. Setting `state.connected` alone is deliberately not enough —
   *  a flag saying "connected" with nothing behind it must fall back to the camera, which is its
   *  own test. This is the SAME call doConnect makes, not a lookalike: the address is part of a
   *  connection, and identity is what the registry keys on — so the key is RESOLVED here the way
   *  connectOnce resolves it, from the session's own address and its name. `mac` stands in for
   *  the address a real protocol layer would have published on the session; a fake that carries
   *  its own `mac` (including the empty one five of the ten protocols report) overrides it, which
   *  is how an addressless cube can be driven through this seam at all. */
  useConnection: (fake, mac = 'AA:BB:CC:DD:EE:FF') => {
    holdSession(fake);
    if (fake) {
      const session = { mac: fake.mac ?? mac, name: fake.name ?? 'Test cube' };
      adoptConnection(sessionIdentity(session), session.name);
    } else onDisconnect();
    // doConnect reads the battery on connect; a stand-in that skipped it would leave every test
    // looking at the "unknown" state and quietly never exercise the meter at all.
    if (fake) void refreshBattery();
  },
};
