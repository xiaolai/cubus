// The app's view of one connected cube.
//
// Everything between the protocol layer and the screens lives here: choosing a transport, running
// the §6 self-check on the live stream, recording the capture, and presenting the handful of facts
// a screen actually needs. `app.js` talks to a session; it never touches `connectSmartCube`, the
// polyfill, or an rxjs Observable.
//
// Why a seam rather than app.js calling the library directly:
//   - The library's event model is theirs (rxjs, their field names). Letting it reach `app.js`
//     would put a dependency's shape into three hundred call sites, and pin us to it.
//   - The self-check has to see EVERY move and facelet report, before any screen does. A screen
//     that installs its own listener would see a stream the checker has not vetted.
//   - The capture tap and the checker want the same events. One subscription, two consumers.
//
// See dev-docs/universal-cube-driver.md §5-7.

import { installBleBridge } from './ble-bridge.js';
import { createCaptureRecorder } from './cube-report.js';
import { VERDICT, createSelfCheck, mayFollowMoves, maySourceOffset } from './cube-selfcheck.js';
import { IDENTITY } from './cube-trust.js';

/**
 * Connect to a cube and start watching it.
 *
 * @param {object} opts
 * @param {Function} opts.Cube cubejs, injected — the self-check's oracle.
 * @param {(mac: string|null) => Promise<string|null>} [opts.macProvider] the app's remembered
 *   address for this device, if it has one. Consulted only when the advertisement does not carry
 *   one; most cubes broadcast theirs.
 * @param {(reason: string) => void} [opts.onStatus] progress, for the connect button's label.
 * @param {Function} [opts.connect] the protocol layer's connect, injected. Defaults to the real
 *   one; tests supply a fake connection so this seam can be exercised without a radio, a bundle,
 *   or rxjs.
 * @param {Function} [opts.installBridge] transport installation, injected for the same reason.
 * @param {() => number} [opts.now] injected clock. The anchor precondition depends on HOW OLD the
 *   last report is, and a test that cannot advance time cannot exercise the stale branch — which
 *   is the branch that matters.
 */
export async function connectCube({
  Cube,
  macProvider,
  onStatus,
  connect,
  installBridge = installBleBridge,
  now = () => Date.now(),
} = {}) {
  const capture = createCaptureRecorder({ now });
  const bridge = installBridge({
    onRawPacket: (p) => capture.onPacket(p),
    // Without these the capture holds only inbound notifications, and a protocol whose handshake
    // is a WRITE replays as a conversation the cube was never having.
    onTraffic: (e) => {
      if (e.op === 'write') capture.onWrite(e);
      else if (e.op === 'read') capture.onRead(e);
      else if (e.op === 'discover-service') capture.onServiceDiscovered(e.service);
      else if (e.op === 'discover-char') capture.onCharacteristicDiscovered(e.service, e.characteristic);
    },
  });
  if (bridge.kind === 'none') {
    bridge.uninstall();
    // Named honestly rather than left to fail later as a timeout. Safari and Firefox have no Web
    // Bluetooth and no Tauri; a beginner deserves "not available here", not a cube that seems
    // broken.
    throw new Error('smart cubes need Chrome, Edge, or the desktop app — this browser cannot reach one');
  }

  let conn;
  try {
    // Inside the try: a missing or corrupt bundle is exactly as fatal as a failed connect, and
    // leaking the installed transport past it would leave a polyfill attached to nothing.
    const connectSmartCube = connect ?? (await import('../vendor/smartcube.js')).connectSmartCube;
    conn = await connectSmartCube({
      macAddressProvider: macProvider ? (device) => macProvider(device?.id ?? null) : undefined,
      onStatus,
    });
  } catch (e) {
    bridge.uninstall();
    throw e;
  }

  // The MAC is the only per-DEVICE identifier the protocol layer exposes; `protocol.id` names the
  // brand, so using it here gave every cube of a given brand the same identity in its report.
  capture.describeDevice({ name: conn.deviceName, id: conn.deviceMAC ?? '', mac: conn.deviceMAC });
  capture.describeProtocol(conn.protocol ?? { id: '', name: '' });

  const check = createSelfCheck({ Cube });
  // Declared, never inferred from silence: the library tells us whether this cube reports state at
  // all, and "no facelets yet" is a different thing from "no facelets ever" (§5).
  if (conn.capabilities && conn.capabilities.facelets === false) check.declareNoStateReports();

  const listeners = { facelets: null, move: null, disconnect: null, verdict: null };
  let alive = true;
  /** The last serial the protocol layer supplied, or null if it supplies none.
   *
   *  Deliberately NOT backfilled from a local counter. Counting the moves we received orders the
   *  events we have seen; the cube's serial says which turn the CUBE thinks it is on, and only
   *  that can reveal a turn that never reached us. A synthesised number would look identical to
   *  the real one and mean something strictly weaker, which is the worst of both. */
  let lastMoveSerial = null;
  /** The last RAW report — what the cube itself claims, before any correction. anchorSolved's
   *  precondition is about the cube's own view, so it must not read a corrected value. */
  let lastReported = null;
  let lastReportedAt = 0;

  const sub = conn.events$.subscribe({
    next: (ev) => {
      if (!alive) return;
      capture.onEvent(ev);
      switch (ev.type) {
        case 'FACELETS': {
          lastReported = ev.facelets;
          lastReportedAt = now();
          check.onFacelets(ev.facelets);
          notifyVerdict();
          listeners.facelets?.(ev.facelets, ev.serial);
          break;
        }
        case 'MOVE': {
          // A turn invalidates the cached report, whatever its age. Freshness in SECONDS is the
          // wrong question for the anchor precondition — what matters is whether the cube has
          // moved since, and one turn inside the freshness window is exactly the case that would
          // otherwise anchor a scrambled cube on a "solved" reading from a moment ago.
          lastReportedAt = 0;
          if (Number.isFinite(ev.serial)) lastMoveSerial = ev.serial;
          check.onMove(ev.move);
          notifyVerdict();
          listeners.move?.({
            notation: ev.move,
            face: ev.face,
            direction: ev.direction,
            timestamp: ev.localTimestamp ?? ev.timestamp,
            cubeTimestamp: ev.cubeTimestamp,
            // Passed through, and undefined when the protocol layer does not expose it. Never
            // synthesised — see lastMoveSerial.
            serial: ev.serial,
          });
          break;
        }
        case 'DISCONNECT':
          teardown();
          listeners.disconnect?.();
          break;
        default:
          break;
      }
    },
    error: () => {
      teardown();
      listeners.disconnect?.();
    },
  });

  let lastVerdict = check.verdict;
  let lastReason = check.reason;
  /** Announce a change in EITHER the verdict or the reason.
   *
   *  Comparing the verdict alone silently dropped the whole resync signal: a reconciliation
   *  failure below the refusal threshold leaves the verdict where it was and only moves the
   *  reason to `resynced`, so the app's "a turn went unrecorded" never fired. That signal is
   *  precisely what replaced the driver's `gap` event, which made this a one-line hole under the
   *  branch's central claim. */
  function notifyVerdict() {
    if (check.verdict === lastVerdict && check.reason === lastReason) return;
    lastVerdict = check.verdict;
    lastReason = check.reason;
    listeners.verdict?.(check.verdict, check.reason);
  }

  function teardown() {
    if (!alive) return;
    alive = false;
    try {
      sub.unsubscribe();
    } catch {}
    bridge.uninstall();
  }

  return {
    name: conn.deviceName,
    mac: conn.deviceMAC,
    protocol: conn.protocol,
    get capabilities() {
      return conn.capabilities;
    },
    /** True while this session is the live one. Every callback checks it; a late reply from a
     *  cube you have since let go must not land as the current cube's anything. */
    get alive() {
      return alive;
    },
    get verdict() {
      return check.verdict;
    },
    get reason() {
      return check.reason;
    },
    get evidence() {
      return check.evidence;
    },
    /** The correction the camera established for THIS cube, or null. */
    get offset() {
      return check.offset;
    },
    mayFollow: () => mayFollowMoves(check.verdict),
    maySourceOffset: () => maySourceOffset(check.verdict),

    /**
     * Does this cube number its moves?
     *
     * Load-bearing for the solve timer, which uses the fact that moves and snapshots share a
     * serial to tell whether a snapshot is ahead of the moves it holds. With no serial both of its
     * "moves were dropped" refusals go inert and it would report a span it cannot vouch for —
     * so the timer asks this and declines to time rather than timing unverifiably.
     */
    numbersMoves: () => lastMoveSerial !== null,

    onFacelets(cb) {
      listeners.facelets = cb;
    },
    onMove(cb) {
      listeners.move = cb;
    },
    onDisconnect(cb) {
      listeners.disconnect = cb;
    },
    onVerdict(cb) {
      listeners.verdict = cb;
    },

    /** Tell the checker what the camera saw, and get the repaired offset if there is one. */
    cameraScan(scanned, reported) {
      check.onCameraScan(scanned, reported);
      notifyVerdict();
      return check.offset;
    },

    /** Ask for a fresh full state. Resolves when one arrives, or rejects — never silently. */
    async requestState({ timeoutMs = 5000 } = {}) {
      return awaitEvent('FACELETS', () => conn.sendCommand({ type: 'REQUEST_FACELETS' }), timeoutMs);
    },

    /** Ask for the battery level. Null when the cube will not say — never a fictional number. */
    async requestBattery({ timeoutMs = 5000 } = {}) {
      // The snapshot already holds it when the cube volunteered one during connect, which saves a
      // round trip and a five-second wait on a cube that has already answered.
      const cached = conn.getSnapshot?.()?.battery?.value;
      if (Number.isFinite(cached)) return cached;
      try {
        const ev = await awaitEvent('BATTERY', () => conn.sendCommand({ type: 'REQUEST_BATTERY' }), timeoutMs);
        return Number.isFinite(ev.batteryLevel) ? ev.batteryLevel : null;
      } catch {
        return null;
      }
    },

    /**
     * Tell the cube it is solved right now — move its own internal reference.
     *
     * The library's REQUEST_RESET. Named for what it means to the app rather than for the wire
     * command, because the caller's concern is the reference moving, and the consequence is that
     * every correction derived against the OLD reference now describes a relationship that no
     * longer exists. `app.js` clears the offset before calling this, deliberately.
     */
    async anchorSolved({ force = false, timeoutMs = 3000 } = {}) {
      if (conn.capabilities && conn.capabilities.reset === false) {
        throw new Error('this cube cannot be told where its solved position is');
      }
      // The precondition is the feature, and the refusal is what teaches the step: anchoring a
      // SCRAMBLED cube permanently sets its reference to a scramble, and nothing afterwards looks
      // wrong — every later report is confidently, invisibly off. So the cube must already report
      // solved, unless the person holding it overrides.
      //
      // The override exists because the precondition can dead-end an honest user: a cube whose own
      // reference has drifted reports unsolved WHILE SITTING SOLVED on the desk, and a reset is
      // the only repair. Nothing here can tell that from a scrambled cube; the user can.
      //
      // The wording matters — Settings matches /refusing to anchor/ to decide whether to offer the
      // override — so it is asserted by test rather than left to a careful edit.
      if (!force) {
        // Bounded staleness rather than a blind cache OR an unconditional round trip.
        //
        // Reports arrive about once a second, so the cached one is almost always current and
        // asking again would put a needless wait behind the button. But a second is long enough
        // to turn a face, and anchoring on a stale "solved" writes a SCRAMBLED position as the
        // cube's reference — after which nothing looks wrong and every later report is
        // confidently, invisibly off. So: use the cached report while it is demonstrably fresh,
        // and go and ask when it is not.
        const FRESH_MS = 1500;
        let reported = now() - lastReportedAt <= FRESH_MS ? lastReported : null;
        if (reported === null) {
          try {
            reported = (await this.requestState({ timeoutMs })).facelets;
          } catch {
            // A cube that will not say where it is cannot be anchored safely. Refusing names the
            // real problem; falling back to a stale value would hide it behind a wrong reference.
            throw new Error('refusing to anchor: the cube did not say where it is');
          }
        }
        if (reported !== IDENTITY) {
          throw new Error(
            'refusing to anchor: the cube does not report itself solved',
          );
        }
      }
      await conn.sendCommand({ type: 'REQUEST_RESET' });

      // CONFIRM, do not assume. `sendCommand` resolves when the command has been written, not when
      // the cube has acted on it — so the caller was previously told "the cube agrees it is
      // solved" on the strength of a write having left the host. If the reset silently failed, the
      // app would mark the cube trusted with its reference unchanged: confidently wrong, and wrong
      // in the one place the user was explicitly asked to trust.
      let confirmed;
      try {
        confirmed = (await this.requestState({ timeoutMs })).facelets;
      } catch {
        throw new Error('the reset was sent but the cube did not confirm it — treat it as unset');
      }
      if (confirmed !== IDENTITY) {
        throw new Error('the reset was sent but the cube still does not report itself solved');
      }
    },

    /** The compatibility report for this session (§7). */
    report(meta = {}) {
      return capture.build({
        ...meta,
        selfCheck: {
          verdict: check.verdict,
          reason: check.reason,
          evidence: check.evidence,
          // Whether this cube numbers its moves is a FACT about the protocol that a reader of the
          // report needs: it decides whether a dropped turn is detectable from the move stream at
          // all, or only through reconciliation against a state report.
          numbersMoves: lastMoveSerial !== null,
          capabilities: conn.capabilities ?? null,
        },
      });
    },

    async disconnect() {
      teardown();
      try {
        await conn.disconnect();
      } catch {}
    },
  };

  /** Send a command and wait for the event it should produce. */
  function awaitEvent(type, send, timeoutMs) {
    return new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        s.unsubscribe();
        reject(new Error(`the cube did not answer with ${type} within ${timeoutMs}ms`));
      }, timeoutMs);
      // `let`, assigned after subscribe returns — and `settle` must tolerate it being unset.
      // An Observable is allowed to deliver synchronously, in which case `settle` runs INSIDE
      // `subscribe()` before the binding exists; with a `const` that was a ReferenceError from the
      // temporal dead zone, turning a delivered answer into a crash.
      let s = null;
      const settle = (fn) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        // Null only on the synchronous path, where the subscription is torn down just below.
        try {
          s?.unsubscribe();
        } catch {}
        fn();
      };
      s = conn.events$.subscribe({
        next: (ev) => {
          if (done) return;
          // A cube that goes away mid-request must not leave the caller waiting out the full
          // timeout for an answer that can no longer come. DISCONNECT is a definite no.
          if (ev.type === 'DISCONNECT') {
            settle(() => reject(new Error(`the cube disconnected before answering with ${type}`)));
            return;
          }
          if (ev.type !== type) return;
          settle(() => resolve(ev));
        },
        error: (e) => settle(() => reject(e instanceof Error ? e : new Error(String(e)))),
        complete: () => settle(() => reject(new Error(`the event stream ended before ${type} arrived`))),
      });
      // If the stream settled synchronously during subscribe, `s` was null inside settle — so
      // release it here, now that the binding exists.
      if (done) {
        try {
          s.unsubscribe();
        } catch {}
      }
      Promise.resolve(send()).catch((e) => settle(() => reject(e)));
    });
  }
}

export { VERDICT };
