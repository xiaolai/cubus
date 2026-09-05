// GAN16 ui driver: turns encrypted FFF6 notifications into typed cube events,
// and sends safe query commands via FFF5. Transport-agnostic (see Transport).

import { TinyEmitter } from './emitter.js';
import {
  buildCommand,
  buildUnsafeCommand,
  type SafeCommand,
  type UnsafeCommand,
} from './gen4/commands.js';
import { GanGen4Cipher } from './gen4/crypto.js';
import { type DecodeResult, decodeGen4 } from './gen4/decode.js';
import { SOLVED_FACELETS } from './gen4/facelets.js';
import type { CubeEvent, CubeFacelets, CubeGyro, CubeMove } from './gen4/types.js';
import { bytesToHex, hexToBytes } from './hex.js';
import type { Transport } from './transport/blew.js';

const STATE_CHAR = 'FFF6'; // notify: state/events
const CMD_CHAR = 'FFF5'; // write: commands

// The decoder delivers a 16-bit move serial (docs/protocol.md: "16-bit serial @bit48"), so every
// comparison of one against another is modulo that width, and "behind" is the far half of the ring.
const SERIAL_MASK = 0xffff;
const SERIAL_HALF = 0x8000;

export type Unsubscribe = () => void;

export interface GanCubeOptions {
  /** Device MAC (recovered from advertisement) — needed for key derivation. */
  mac: string;
  transport: Transport;
}

export class GanCube extends TinyEmitter {
  private readonly cipher: GanGen4Cipher;
  private readonly transport: Transport;
  private lastSerial = -1;
  /**
   * True from the moment the link breaks until the next serial-bearing packet answers the one
   * question a break leaves open: did the cube's move counter survive it? Only a MOVE or a
   * FACELETS carries a serial, so only those clear it — see acceptMove.
   */
  private sessionBreak = false;
  /**
   * Bumped by anything that makes an already-read state stop describing the cube in front of you:
   * a MOVE packet (the cube turned), and a link that dropped or respawned (moves may have happened
   * unobserved, and the channel that would carry a write is no longer the one that was checked).
   * anchorSolved() compares it across its pre-read, because REQUEST_RESET anchors the cube's
   * CURRENT position rather than the one that was read.
   */
  private readEpoch = 0;
  /**
   * Bumped whenever the LINK changes identity — a respawn, or a close. A reading taken before the
   * bump belongs to a session that has ended, however recently. Separate from readEpoch on
   * purpose: a MOVE invalidates a position without ending a session, and only the session question
   * decides whether an answer already in hand may still be delivered.
   */
  private linkEpoch = 0;
  private lastFacelets: CubeFacelets | null = null;
  private live = false;
  private hwFields: Record<string, string> = {};
  private hwExtras: { eventType: number; value: string }[] = [];
  /** Removes this driver's listeners from the current subscription. Null when not connected. */
  private releaseSub: (() => void) | null = null;
  /** Everything waiting on the link: failed together the moment the link is gone. */
  private readonly pending = new Set<(reason: Error) => void>();

  constructor(opts: GanCubeOptions) {
    super();
    this.cipher = new GanGen4Cipher(opts.mac);
    this.transport = opts.transport;
  }

  /**
   * Subscribe to state notifications and start decoding.
   *
   * Idempotent, and that is a fix rather than a nicety: a second connect() used to add a second
   * set of listeners to the SAME subscription — a cube has one FFF6 characteristic — so every
   * packet decoded twice and every move was delivered twice, and nothing ever removed either set.
   * The subscription is owned here now, and released by disconnect().
   */
  connect(): void {
    if (this.releaseSub) return;
    const sub = this.transport.subscribe(STATE_CHAR);
    const onPacket = (hex: string, ts: number) => this.onPacket(hex, ts);
    const onError = (e: unknown) => this.emit('error', e);
    const onReconnecting = () => {
      // Readiness only. A reconnect is the link coming BACK, so anything waiting on a packet may
      // still be answered once it does — failing those here would turn a recoverable respawn into
      // an error the caller has to handle.
      this.live = false;
      // What the respawned link brings back is an open question, not a continuation: the cube may
      // have slept and restarted its move counter, and moves made while it was down were not seen.
      this.sessionBreak = true;
      this.readEpoch++;
      this.linkEpoch++;
      this.emit('reconnecting');
    };
    const onGiveup = (e: unknown) => {
      // Terminal, so it is handled like a close and not merely announced. The transport has
      // stopped retrying: nothing further will ever arrive on this subscription, so everything
      // waiting on it is already answered — with a failure — and the subscription must be let go.
      // Leaving releaseSub set made connect() see itself as still connected and return without
      // resubscribing, which turned an explicit reconnect into a no-op. The transport itself is
      // NOT disconnected here: that would set its stopped flag and make the next subscribe()
      // spawn nothing, taking the retry away instead of handing it back.
      const release = this.releaseSub;
      this.releaseSub = null;
      release?.();
      this.goDark(e instanceof Error ? e.message : 'the transport gave up reconnecting');
      this.emit('giveup', e);
    };
    const onClose = (code: unknown) => {
      // Readiness dies with the link, and so does everything waiting on it. The listeners stay:
      // a transport that reconnects does it on this same emitter, and dropping them here would
      // silence the driver permanently.
      this.goDark('the subscription closed');
      this.emit('disconnect', code);
    };
    sub.on('packet', onPacket);
    sub.on('error', onError);
    sub.on('reconnecting', onReconnecting);
    sub.on('giveup', onGiveup);
    sub.on('close', onClose);
    this.releaseSub = () => {
      sub.off('packet', onPacket);
      sub.off('error', onError);
      sub.off('reconnecting', onReconnecting);
      sub.off('giveup', onGiveup);
      sub.off('close', onClose);
    };
  }

  /** Resolves once at least one notification has arrived (subscription is live). */
  private waitLive(timeoutMs = 5000): Promise<void> {
    if (this.live) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const stop = () => {
        clearTimeout(timer);
        this.off('live', onLive); // don't leak the listener on the timeout path
        this.pending.delete(abort);
      };
      const onLive = () => {
        stop();
        resolve();
      };
      // A link that goes away while this is waiting fails it now rather than at the timeout: the
      // answer is already known, and the caller's next step would be a write into nothing.
      const abort = (reason: Error) => {
        stop();
        reject(reason);
      };
      const timer = setTimeout(() => abort(new Error('subscription did not go live')), timeoutMs);
      this.pending.add(abort);
      this.once('live', onLive);
    });
  }

  disconnect(): void {
    const release = this.releaseSub;
    this.releaseSub = null;
    release?.(); // before the transport goes, so a synchronous 'close' is not reported twice
    // Readiness belongs to the link, not to the driver. Leaving it set let the next active request
    // skip waitLive() entirely and write a command into a transport that was already torn down.
    this.goDark('disconnected');
    this.transport.disconnect();
  }

  /** Drop readiness and fail everything that was waiting on the link, with the reason. */
  private goDark(reason: string): void {
    this.live = false;
    // Same reasoning as a respawn: a link that has gone leaves the counter and any state already
    // read as claims about a session that has ended.
    this.sessionBreak = true;
    this.readEpoch++;
    this.linkEpoch++;
    const waiting = [...this.pending];
    this.pending.clear();
    for (const abort of waiting) abort(new Error(reason));
  }

  private onPacket(hex: string, ts: number): void {
    if (!this.live) {
      this.live = true;
      this.emit('live');
    }
    if (hex.length !== 40) {
      // Unknown framing must never vanish silently.
      this.emit('unknown', { reason: 'bad-length', rawHex: hex, timestamp: ts });
      return;
    }
    let ev: DecodeResult;
    try {
      // The DECODE is inside this too, and that is the fix rather than the tidying. decodeGen4
      // can throw on a frame that decrypts perfectly well — a FACELETS whose parity-derived eighth
      // corner falls outside the cubie table indexes past the end of it — and it sat one line
      // below the catch, so a corrupt packet threw out of a transport notification callback,
      // past every caller, and took the process down with no 'error' ever emitted. The recorder
      // learned this on 2026-09-05 (capture.ts, decodePacket); the driver had the same line.
      ev = decodeGen4(this.cipher.decrypt(hexToBytes(hex)), ts);
    } catch (e) {
      this.emit('error', e);
      return;
    }
    if (ev.type === 'MOVE_HISTORY') {
      this.emit('moveHistory', ev);
      return;
    }
    if (ev.type === 'HARDWARE_FIELD') {
      this.onHardwareField(ev, ts);
      return;
    }
    if (ev.type === 'MOVE') {
      // Counted before the serial counter gets a say, and deliberately: a MOVE packet the counter
      // REFUSES is still evidence that the cube turned, and a link repeating or reordering frames
      // is exactly when "the position I read is still the position" is least safe to assume.
      // A false invalidation costs a retry; a wrongly anchored reset is permanent.
      this.readEpoch++;
      // A move the counter refuses is not delivered at all — see acceptMove.
      if (!this.acceptMove(ev)) return;
    }
    if (ev.type === 'FACELETS') {
      this.lastFacelets = ev;
      this.rebaseSerial(ev.serial & SERIAL_MASK);
    }
    this.emit('event', ev);
    // Also under its own name, lowercased — 'move', 'facelets', 'gyro', 'battery', 'unknown'.
    // UNKNOWN used to be emitted here AND explicitly just above, so every unrecognised packet
    // called an 'unknown' listener twice.
    this.emit(ev.type.toLowerCase(), ev);
  }

  private onHardwareField(
    ev: { key: string; value: string; extra: boolean; eventType: number },
    ts: number,
  ): void {
    if (ev.extra) this.hwExtras.push({ eventType: ev.eventType, value: ev.value });
    else this.hwFields[ev.key] = ev.value;
    // Emit a consolidated HARDWARE event once the 4 mapped fields are in.
    const needed = ['hardwareName', 'hardwareVersion', 'softwareVersion', 'productDate'];
    if (needed.every((k) => k in this.hwFields)) {
      const name = this.hwFields.hardwareName ?? '';
      const hw = {
        type: 'HARDWARE' as const,
        timestamp: ts,
        hardwareName: name,
        hardwareVersion: this.hwFields.hardwareVersion ?? '',
        softwareVersion: this.hwFields.softwareVersion ?? '',
        productDate: this.hwFields.productDate ?? '',
        // GAN16 ui streams gyro; detect empirically (name starts GAN1x ui) rather
        // than by upstream's GAN12uiM-only allowlist.
        gyroSupported: /ui/i.test(name),
        extras: [...this.hwExtras],
      };
      this.hwFields = {};
      this.hwExtras = [];
      this.emit('hardware', hw);
      this.emit('event', hw);
    }
  }

  /**
   * Decide whether a MOVE packet is the next one, and report what is missing before it.
   *
   * The serial counts moves modulo 2^16, so ahead and behind are the two halves of that ring:
   * 1..0x7FFF ahead (a skip means moves were lost — 'gap', so they are never lost silently), 0 the
   * same move again, anything else a packet from behind. The last two are refused, which keeps
   * them out of the move stream AND out of the counter — the part that used to be wrong.
   *
   * Advancing the counter for a stale packet made the NEXT move look like a skip: 10, 9, 11
   * delivered 9 after 10 and then reported move 10 as missing, a move already delivered. A gap is
   * the signal the app uses to decide its tracking is broken and to ask for a camera scan, so
   * inventing one is worse than missing one.
   *
   * A refusal is announced ('stale'), never silent — the rule that keeps bad framing and unmapped
   * event types visible applies to a packet dropped on purpose too.
   */
  private acceptMove(move: CubeMove): boolean {
    const serial = move.serial & SERIAL_MASK;
    if (this.lastSerial !== -1) {
      const diff = (serial - this.lastSerial) & SERIAL_MASK;
      if (diff === 0 || diff >= SERIAL_HALF) {
        // Across a link break, a counter that went BACKWARDS is a cube that restarted counting,
        // not a frame from the past — and refusing it refuses every move the cube makes from then
        // on, permanently, because a refusal never advances the counter either. Rebase on it, and
        // announce it. A duplicate is exempt: the same serial twice is a repeated frame under
        // either reading, and refusing it locks nothing out, since the next move still advances.
        if (this.sessionBreak && diff !== 0) {
          this.rebase(serial);
          return true;
        }
        this.emit('stale', {
          serial,
          lastSerial: this.lastSerial,
          reason: diff === 0 ? 'duplicate' : 'behind',
          move,
        });
        return false;
      }
      if (diff > 1) {
        this.emit('gap', { missing: diff - 1, from: this.lastSerial, to: serial });
      }
    }
    this.sessionBreak = false;
    this.lastSerial = serial;
    return true;
  }

  /**
   * Take a FACELETS serial as the baseline when there is none, and after a link break decide
   * whether the cube's counter survived it.
   *
   * A baseline that outlives the link is what made a restarted cube unusable: the cube counts from
   * zero again, every serial reads as behind the old baseline, and acceptMove refuses them for
   * good. Rebasing UNCONDITIONALLY would fix that and cost the other half — a counter that
   * ADVANCED across the break is moves made while the link was down, which is exactly what 'gap'
   * reports, and adopting the new value silently would delete that signal. So only a counter that
   * went backwards is read as a restart.
   */
  private rebaseSerial(serial: number): void {
    if (this.lastSerial === -1) {
      this.lastSerial = serial;
      this.sessionBreak = false;
      return;
    }
    if (!this.sessionBreak) return;
    this.sessionBreak = false;
    // Same or ahead: the counter survived the break, so the gap rule still owns the difference.
    if (((serial - this.lastSerial) & SERIAL_MASK) < SERIAL_HALF) return;
    this.rebase(serial);
  }

  /** Adopt a restarted counter, announced — the rule that keeps a refused move visible applies
   *  just as much to a baseline the driver moves on its own. */
  private rebase(serial: number): void {
    this.sessionBreak = false;
    this.emit('rebase', { from: this.lastSerial, to: serial, reason: 'counter-restart' });
    this.lastSerial = serial;
  }

  // ---- Typed convenience subscriptions -------------------------------------

  onMove(cb: (m: CubeMove) => void): Unsubscribe {
    this.on('move', cb);
    return () => this.off('move', cb);
  }
  onFacelets(cb: (f: CubeFacelets) => void): Unsubscribe {
    this.on('facelets', cb);
    return () => this.off('facelets', cb);
  }
  onGyro(cb: (g: CubeGyro) => void): Unsubscribe {
    this.on('gyro', cb);
    return () => this.off('gyro', cb);
  }
  onEvent(cb: (e: CubeEvent) => void): Unsubscribe {
    this.on('event', cb);
    return () => this.off('event', cb);
  }

  // ---- Active commands (safe queries only) ---------------------------------

  private async send(cmd: SafeCommand): Promise<void> {
    const enc = this.cipher.encrypt(buildCommand(cmd));
    await this.transport.write(CMD_CHAR, bytesToHex(enc));
  }

  /**
   * Current facelet state. The cube emits FACELETS periodically (~1 Hz), so by
   * default this just waits for the next one — no write, fully robust. Pass
   * {active:true} to also send REQUEST_FACELETS as a nudge.
   */
  getState(opts: { timeoutMs?: number; active?: boolean } = {}): Promise<CubeFacelets> {
    const { timeoutMs = 4000, active = false } = opts;
    return this.request('facelets', active ? 'REQUEST_FACELETS' : null, timeoutMs);
  }
  requestBattery(timeoutMs = 4000): Promise<CubeEvent> {
    return this.request('battery', 'REQUEST_BATTERY', timeoutMs);
  }
  requestHardware(timeoutMs = 4000): Promise<CubeEvent> {
    return this.request('hardware', 'REQUEST_HARDWARE', timeoutMs);
  }

  // ---- Anchor step (the one command that rewrites cube state) ---------------

  /**
   * Anchor the cube's internal solved reference — the pairing flow's
   * "solve once to calibrate" step. Sends REQUEST_RESET only when the cube already reports a
   * solved state, UNLESS the caller passes `{ force: true }` to vouch for it (see below).
   *
   * That precondition is what makes this safe, and it is not a formality.
   * REQUEST_RESET tells the cube to treat its CURRENT position as solved:
   *
   *  - Sent while the cube reports something other than solved, it would adopt a
   *    scrambled position as the new origin. Driver state and hardware then
   *    diverge permanently and silently — the failure the state invariant
   *    (apply decoded moves -> matches hardware facelets) exists to catch.
   *  - Sent while the cube already reports solved, it sets the reference to the
   *    value already in effect. The operation is state-neutral, so there is no
   *    divergence to create.
   *
   * So the guard does not reduce the risk, it removes the mechanism.
   *
   * The residual case the guard cannot see: a cube that REPORTS solved while
   * physically scrambled. Facelets come from the cube's own state, so BLE cannot
   * distinguish that, and this method cannot either. Such a cube has already
   * drifted before this is called; the camera scan is the ground-truth anchor
   * for it. This neither causes that case nor worsens it.
   *
   * Throws rather than returning a status: a silently skipped anchor step would
   * leave the caller believing the cube was calibrated.
   *
   * Two modes, and the difference matters:
   *
   *   default          — the cube must report solved, or this refuses and writes no reset. The
   *                      precondition removes the failure mechanism rather than reducing its odds.
   *   { force: true }  — the caller asserts the cube is solved in front of them. This waives the
   *                      COMPARISON and nothing else: the pre-read, the write and the verifying
   *                      re-read all still happen. Used wrongly it adopts a scrambled position as
   *                      the origin, permanently and silently, and no check here can catch that —
   *                      after a reset the cube reports solved either way. It exists because the
   *                      precondition alone is a catch-22 (see below).
   *
   * NOT CONFIRMED ON HARDWARE. The packet matches upstream and the guard is
   * tested, but no physical GAN16 has been sent this command from this codebase.
   * See docs/protocol.md.
   */
  async anchorSolved(opts: { timeoutMs?: number; force?: boolean } = {}): Promise<CubeFacelets> {
    const { timeoutMs = 4000 } = opts;
    // Rejected outright, not coerced. This flag is the only thing standing between a caller and a
    // command that can permanently desync the driver from the cube, and the package ships to plain
    // JavaScript — where `{ force: 'false' }` is a thing somebody will eventually write, and
    // truthiness reads it as permission.
    if (opts.force !== undefined && typeof opts.force !== 'boolean') {
      throw new TypeError(`anchorSolved: force must be a boolean, got ${typeof opts.force}`);
    }
    const force = opts.force ?? false;

    // `force` exists because the precondition, alone, is a catch-22.
    //
    // A cube whose internal solved-reference has drifted reports an unsolved state WHILE BEING
    // PHYSICALLY SOLVED — and REQUEST_RESET is the one thing that repairs that. Refusing
    // unconditionally makes the repair unreachable in exactly the situation it exists for.
    //
    // The driver cannot tell the two cases apart: "solved cube, drifted reference" and "scrambled
    // cube" both look like a non-solved report from here. Only somebody looking at the cube can
    // say which it is, so the override is theirs to give, never inferred. The post-write re-read
    // below cannot substitute for it — after a reset the cube reports solved either way.
    // The read happens EITHER WAY. `force` waives the comparison below, and nothing else.
    //
    // It used to skip this whole block, which quietly took the readiness barrier with it: this is
    // the only call that waits for the transport to be live, so a forced anchor could write
    // REQUEST_RESET before any subscription existed to hear the reply — the most destructive
    // command in the protocol, sent into a channel nobody was listening to.
    // Captured BEFORE the read, not after: request() holds an early answer until its write
    // completes, so the FACELETS that resolves the read can be older than the resolution, and a
    // move in between would otherwise pass unseen. A cube twisted while it is being read is
    // exactly the cube this must refuse.
    const readAt = this.readEpoch;
    const before = await this.getState({ active: true, timeoutMs });
    if (!force && before.facelets !== SOLVED_FACELETS) {
      throw new Error(
        `refusing to anchor: the cube reports an unsolved state, and anchoring now would adopt it as the new solved reference, desyncing the driver from the cube permanently. Solve the cube first — or, if it IS solved and the cube's own reference has drifted, anchor with { force: true }.\n  reported: ${before.facelets}\n  expected: ${SOLVED_FACELETS}`,
      );
    }

    // The precondition is about the position the cube was IN when it was read, and REQUEST_RESET
    // anchors the position it is in when the packet lands. A move — or a link that dropped and
    // came back — between the two means those are not the same position, so the check that was
    // passed has been passed about something else. `force` does not waive this: it vouches for
    // the cube the caller is LOOKING at, and a cube that has turned since is not that cube.
    if (this.readEpoch !== readAt) {
      throw new Error(
        'refusing to anchor: the cube turned, or the link dropped, while its state was being read — so the state checked above is no longer the position a reset would adopt. Nothing was sent. Hold the cube still and try again.',
      );
    }

    await this.sendUnsafe('REQUEST_RESET', timeoutMs);

    // The same question, now unanswerable: the packet has already gone. This reports rather than
    // verifies, and the re-read below cannot stand in for it — a cube that accepted the command
    // reports solved either way, whatever position it was in when it arrived.
    if (this.readEpoch !== readAt) {
      throw new Error(
        "anchor uncertain: the cube turned, or the link dropped, while REQUEST_RESET was in flight, so it may have anchored a position other than the one that was checked. Treat the driver's tracked state as untrusted and re-scan.",
      );
    }

    // Re-establish the invariant rather than assuming the write landed. This catches a cube left
    // in any state other than solved, which is what an ignored or failed reset looks like.
    //
    // What it CANNOT catch, in either mode: a reset that worked on the wrong position. A cube that
    // accepted the command reports solved afterwards whether or not it was solved before — that is
    // the nature of the command. Under `force` the caller has taken that risk knowingly; by
    // default the precondition above is what prevents it.
    const after = await this.getState({ active: true, timeoutMs });
    // The read-epoch rule runs to the END of the operation, not just up to the write. request()
    // holds an answer that arrives before its write completes, so the FACELETS that verifies the
    // reset can be older than the resolution — a MOVE landing in that window left a solved report
    // describing a position the cube had already left, and this method returned it as proof.
    // Reproduced 2026-09-05. One epoch spans the whole anchor: read, send, verify.
    if (this.readEpoch !== readAt) {
      throw new Error(
        "anchor uncertain: the cube turned, or the link dropped, while the reset was being verified, so the state read back describes a position the cube has already left and cannot confirm the reset landed. Treat the driver's tracked state as untrusted and re-scan.",
      );
    }
    if (after.facelets !== SOLVED_FACELETS) {
      throw new Error(
        `anchor failed: the cube did not report a solved state afterwards. Treat the driver's tracked state as untrusted and re-scan.\n  reported: ${after.facelets}`,
      );
    }
    return after;
  }

  /**
   * Deliberately separate from send(): its parameter type is UnsafeCommand, so no SafeCommand
   * call site can reach this, and no new caller can appear without naming the unsafe type.
   * Used only by anchorSolved() above, which owns the precondition.
   *
   * Two limits worth stating plainly rather than leaving to be discovered. `private` is a
   * TypeScript modifier and is erased at runtime, so this is a compile-time boundary, not a
   * runtime one — plain JavaScript can still reach it. And the precondition anchorSolved() owns
   * is waivable by its `force` option. Both are real gaps in the "nothing else can send this"
   * claim, and closing them means a runtime-private method and a narrower public surface.
   */
  private sendUnsafe(cmd: UnsafeCommand, timeoutMs: number): Promise<void> {
    const enc = this.cipher.encrypt(buildUnsafeCommand(cmd));
    const write = this.transport.write(CMD_CHAR, bytesToHex(enc));
    // The same deadline and the same disconnect-cancellation every other request on this link
    // gets — this write had neither, so a transport that never settled left anchorSolved() waiting
    // forever, through a disconnect and past any timeout the caller asked for. The write itself
    // cannot be recalled, so the message says so: an abandoned reset may still have landed, which
    // is the one outcome the caller must not read as "nothing happened".
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const stop = () => {
        settled = true;
        clearTimeout(timer);
        this.pending.delete(abort);
      };
      const abort = (reason: Error) => {
        if (settled) return;
        stop();
        reject(
          new Error(
            `${cmd} abandoned: ${reason.message}. The packet may still have reached the cube — treat the driver's tracked state as untrusted and re-scan.`,
          ),
        );
      };
      const timer = setTimeout(
        () => abort(new Error(`the write did not complete within ${timeoutMs} ms`)),
        timeoutMs,
      );
      this.pending.add(abort);
      // Both arms are attached, so a write that rejects after this has already given up is still
      // handled rather than surfacing as an unhandled rejection.
      write.then(
        () => {
          if (settled) return;
          stop();
          resolve();
        },
        (e: unknown) => {
          if (settled) return;
          stop();
          reject(e);
        },
      );
    });
  }

  /**
   * Wait for the next `event`, optionally after sending a query command.
   * The command is sent only after the subscription is confirmed live, so the
   * cube's response is never missed to a subscribe/write race.
   *
   * With a command, TWO things must happen before this resolves: the write has to complete, and a
   * matching notification has to arrive. It used to be one — the notification — and the cube emits
   * FACELETS about once a second on its own, so a write that failed outright still produced a
   * successful getState(). anchorSolved() takes exactly this call as its barrier before
   * REQUEST_RESET, the one command that can permanently desync the driver from the cube, and it
   * takes it precisely to establish that the channel works.
   *
   * A notification arriving while the write is still in flight is HELD, not dropped: a transport
   * can deliver the cube's reply before its own write promise settles, and refusing it would
   * trade one race for another. The write is still what unblocks the answer.
   *
   * A held answer does not survive the LINK, though, and that half was missing. A respawn does not
   * fail what is waiting — the link is coming back, and the cube emits FACELETS about once a
   * second on its own, so failing here would turn a recoverable respawn into an error every caller
   * has to handle. But an answer taken before the break is a reading from a session that has
   * ended, and the write completing afterwards used to deliver it: reproduced 2026-09-05, a
   * getState() resolving with the old session's facelets while `live` was already false. The
   * answer is dropped instead and this keeps waiting, within the caller's own deadline, for one
   * the current link produced.
   */
  private request<T = CubeEvent>(
    event: string,
    cmd: SafeCommand | null,
    timeoutMs: number,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let live = cmd === null; // a passive read waits on nothing but the cube
      let written = cmd === null; // ...and has no write to wait on either
      let answer: T | null = null;
      /** Which link the held answer came in on. Compared, never trusted, at the moment it is used. */
      let answerLink = this.linkEpoch;

      const stop = () => {
        settled = true;
        clearTimeout(timer);
        this.off(event, onEvt);
        this.pending.delete(abort);
      };
      const fail = (reason: unknown) => {
        if (settled) return;
        stop();
        reject(reason);
      };
      const settleIfComplete = () => {
        if (settled || !written || answer === null) return;
        if (answerLink !== this.linkEpoch) {
          // The link broke after this answer arrived, so it describes a session that has ended.
          // Drop it and keep waiting: the cube's own ~1 Hz stream refills this on the new link,
          // and a request that never gets one times out saying so, which is the honest outcome.
          answer = null;
          return;
        }
        stop();
        resolve(answer);
      };
      // Kept listening rather than once(): an answer that arrives before the write completes is
      // held, and a fresher one replaces it.
      const onEvt = (e: T) => {
        answer = e;
        answerLink = this.linkEpoch;
        settleIfComplete();
      };
      const abort = (reason: Error) => fail(reason);
      // Name what was actually outstanding. All three are timeouts and only the message tells
      // them apart, so "waiting for facelets" on a link that never came up would send the reader
      // looking at the cube instead of at the connection.
      const timer = setTimeout(() => {
        const outstanding = !live
          ? `the subscription to go live before ${cmd}`
          : answer !== null && !written
            ? `the ${cmd} write to complete`
            : `${event}${cmd ? ` after ${cmd}` : ''}`;
        fail(new Error(`timeout waiting for ${outstanding}`));
      }, timeoutMs);

      this.pending.add(abort);
      this.on(event, onEvt);
      if (cmd) {
        // Wait for the subscription within the caller's own budget, not a
        // shorter hardcoded one — a slow BLE connect must not cap the timeout.
        this.waitLive(timeoutMs)
          .then(() => {
            live = true;
            return settled ? undefined : this.send(cmd!);
          })
          .then(() => {
            written = true;
            settleIfComplete();
          })
          .catch(fail);
      }
    });
  }

  get currentFacelets(): CubeFacelets | null {
    return this.lastFacelets;
  }
}
