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
// What the host can actually reach a radio with, asked of the bridge's own resolver: the route
// Settings offers and the transport the bridge installs are one answer, so they cannot disagree.
import { bleRoute } from './ble-bridge.js';

import { state } from './app-state.js';
import { Cube, loadSolver } from './solver-service.js';
import { ingestFacelets, takeDerivation } from './cube-subject.js';
import { lastCubeMac, sessionIdentity } from './cube-memory.js';
import { markStale, markTrusted, repaintIndicator, repaintSettings } from './cube-trust-state.js';
import { conn, holdSession } from './live-session.js';
import {
  adoptConnection, onCubeMove, onDisconnect, onFacelets, onMovesLost, reportSilence,
} from './cube-reports.js';

// ---- smart cube: the connection (recovered from v0) -----------------------------

/**
 * Can this host reach a radio at all, and by which route?
 *
 * The bridge's own resolver (`bleRoute`, lib/ble-bridge.js), asked without building a bridge: a
 * bridge registers native event listeners, and one constructed at render time beside a live
 * session would sit there warning about every packet it could not place.
 *
 * Answered at RENDER time, never memoised: `?platform=` pins the answer for design review, and a
 * value cached before boot published `<html data-platform>` would be the wrong one forever.
 *
 * @returns {'native'|'browser'|'refused-host'|'none'}
 */
export const bleReach = () => bleRoute();

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
  let answer = null;
  try {
    answer = await asked.requestBattery();
  } catch {
    // A cube that will not answer its battery is still a usable cube: the level is unknown, and
    // the UI says so rather than drawing a fictional meter.
  }
  if (conn !== asked) return;
  // `null` means the cube would not say, and the level becomes unknown: a level from an earlier
  // ask is not a current one. `Number(null)` is 0, which is finite — so the old line drew a flat
  // battery for a cube that simply had not answered.
  const level = answer === null || answer === undefined ? Number.NaN : Number(answer);
  publishBattery(Number.isFinite(level) ? Math.max(0, Math.min(100, Math.round(level))) : null);
}

/** The battery level, or null, published to everything that shows it — Settings' meter and the
 *  title-bar indicator's tooltip. One door, so an answer, a silence and a refusal reach both. */
function publishBattery(level) {
  if (state.battery === level) return;
  state.battery = level;
  repaintIndicator();
  // A reply can land while someone is typing a nickname or an address into this very card, and
  // rebuilding the card discards what they typed — so the redraw is deferred, not faked.
  repaintSettings();
}

let connecting = null;
/** Pair a cube, one attempt at a time. `open` is the session factory: lib/cube-session.js's
 *  connectCube, or a test's stand-in — which is how pairing itself is driven by a test at all. */
export async function doConnect(macFromUi, { open = connectCube } = {}) {
  // Single-flight: two overlapping attempts raced through the shared transport/conn state, the
  // loser tearing down the winner's transport half-way through its own handshake.
  if (connecting) return connecting;
  connecting = (async () => {
    try { return await connectOnce(macFromUi, open); } finally { connecting = null; }
  })();
  return connecting;
}

/** The first line of what went wrong, for a sentence. */
const said = (e) => String(e?.message || e).split('\n')[0];

/** Let go of every session the radio may still hold before another is paired: first each whose
 *  release did not complete (see `letGo`), asked again, then the held one, whose app side is ended
 *  as every goodbye ends it. A release that does not complete stops this attempt and says so, and
 *  the next attempt asks again: nothing is paired while one is refused, because the native side may
 *  still hold that peripheral, and pairing over it fails in a way nothing can explain. */
async function releaseHeld() {
  for (const kept of [...unreleased]) {
    const failed = await letGo(kept);
    if (failed) throw notReleased(failed);
  }
  const held = conn;
  if (!held) return;
  const failed = await letGo(held);
  // Scoped to the session let go: one that replaced it meanwhile is not this attempt's to end.
  if (conn === held) onDisconnect();
  if (failed) throw notReleased(failed);
}

/** A release that did not complete, for a sentence. Pairing again asks the radio again. */
const notReleased = (failed) =>
  new Error(`the last cube was not released cleanly (${said(failed)}) — pair again to ask it once more`);

async function connectOnce(macFromUi, open) {
  await releaseHeld();
  let session = null;
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
    session = await open({
      Cube,
      macProvider: typed ? async () => typed : undefined,
    });
    bindSession(session);
    // A cube that dropped after the session subscribed and before bindSession told nobody: its
    // DISCONNECT found no listener. Adopted, it would stand as a connected cube that never reports.
    if (!session.alive) {
      throw new Error('the cube disconnected as it connected — turn it to wake it, then pair again');
    }
    holdSession(session);
    adoptConnection(sessionIdentity(session), session.name || 'Smart cube');
    askFirstReports(session);
  } catch (err) {
    // What this attempt leaves is let go (`letGoLeftover`), and a release that did not complete is
    // said with the error.
    const failed = await letGoLeftover(session, err);
    if (!conn || conn === session) onDisconnect();
    if (failed) {
      throw new Error(`${said(err)} — and the cube was not released cleanly: ${said(failed)}`, { cause: err });
    }
    throw err;
  }
}

/** Route every report `session` sends to lib/cube-reports.js. Every callback is scoped to ITS
 *  session: a slow packet or a late disconnect from a connection since replaced must not mutate
 *  the new cube's state or tear it down. */
function bindSession(session) {
  session.onFacelets((facelets, serial) => { if (conn === session) onFacelets(facelets, serial); });
  // Following runs on moves (immediate); snapshots (~1Hz) only correct drift — a turn sequence
  // completed inside one second has no intermediate snapshots.
  // Through onCubeMove, not straight to `liveMove`: the self-check's gate lives there so the
  // test seam passes through the same one the driver does, and so does the one piece of
  // bookkeeping that must happen on EVERY turn whether or not a screen is following.
  session.onMove((m) => { if (conn === session) onCubeMove(m); });
  // A session that ends on its own says its own goodbye (lib/cube-session.js) and is let go like
  // any other, so one the radio did not release is kept and asked again before the next pairing.
  session.onDisconnect(() => {
    if (conn === session) onDisconnect();
    void letGo(session);
  });
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
}

/** What a new connection asks its cube at once: where it is, and its battery. */
function askFirstReports(session) {
  // The reply is NOT fed to onFacelets here. It arrives on the event stream too, and the
  // permanent listener in bindSession already handles it — passing it on as well delivered the
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

/** Sessions whose release did not complete, or is still being asked for. Kept, because asking one
 *  to disconnect again asks the radio again (lib/cube-session.js), and a session dropped here is
 *  a peripheral nothing asks about again. `releaseHeld` asks each before anything is paired; one
 *  that lets go leaves. */
const unreleased = new Set();

/**
 * Let `session` go, and answer what went wrong — or null.
 *
 * A session's disconnect() RETURNS a release that did not complete (lib/cube-session.js), and can
 * still throw from the bridge's teardown; every caller dropped both (found by audit, 2026-09-13).
 * One answer here, never a rejection, so a caller can do its own teardown and then say the rest.
 * Every goodbye comes through here, so a session whose release did not complete stays in
 * `unreleased` whichever caller let it go (found on re-audit, 2026-09-14).
 */
export const letGo = async (session) => {
  // Kept from the moment it is asked, so a pairing pressed meanwhile asks it too and waits.
  unreleased.add(session);
  const failed = await Promise.resolve()
    .then(() => session.disconnect())
    .then((answer) => answer ?? null, (thrown) => thrown);
  if (!failed) unreleased.delete(session);
  return failed;
};

/** Let go of what a failed attempt leaves, and answer what went wrong, or null: the session it
 *  opened — alive or not, because one that ended before its listeners were bound is exactly the
 *  session nothing else would ever ask the radio about again (found by verification, 2026-09-14) —
 *  or the handle a failed handshake throws on its error for what it left the radio holding
 *  (`unreleased`, lib/cube-session.js). */
const letGoLeftover = (session, err) => {
  const left = session ?? err?.unreleased;
  return left ? letGo(left) : null;
};
