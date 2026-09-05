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
import { decodeGen4 } from './gen4/decode.js';
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
      this.emit('reconnecting');
    };
    const onGiveup = (e: unknown) => this.emit('giveup', e);
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
    let decrypted: Uint8Array;
    try {
      decrypted = this.cipher.decrypt(hexToBytes(hex));
    } catch (e) {
      this.emit('error', e);
      return;
    }
    const ev = decodeGen4(decrypted, ts);
    if (ev.type === 'MOVE_HISTORY') {
      this.emit('moveHistory', ev);
      return;
    }
    if (ev.type === 'HARDWARE_FIELD') {
      this.onHardwareField(ev, ts);
      return;
    }
    // A move the counter refuses is not delivered at all — see acceptMove.
    if (ev.type === 'MOVE' && !this.acceptMove(ev)) return;
    if (ev.type === 'FACELETS') {
      this.lastFacelets = ev;
      if (this.lastSerial === -1) this.lastSerial = ev.serial & SERIAL_MASK;
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
    this.lastSerial = serial;
    return true;
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
    const before = await this.getState({ active: true, timeoutMs });
    if (!force && before.facelets !== SOLVED_FACELETS) {
      throw new Error(
        `refusing to anchor: the cube reports an unsolved state, and anchoring now would adopt it as the new solved reference, desyncing the driver from the cube permanently. Solve the cube first — or, if it IS solved and the cube's own reference has drifted, anchor with { force: true }.\n  reported: ${before.facelets}\n  expected: ${SOLVED_FACELETS}`,
      );
    }

    await this.sendUnsafe('REQUEST_RESET');

    // Re-establish the invariant rather than assuming the write landed. This catches a cube left
    // in any state other than solved, which is what an ignored or failed reset looks like.
    //
    // What it CANNOT catch, in either mode: a reset that worked on the wrong position. A cube that
    // accepted the command reports solved afterwards whether or not it was solved before — that is
    // the nature of the command. Under `force` the caller has taken that risk knowingly; by
    // default the precondition above is what prevents it.
    const after = await this.getState({ active: true, timeoutMs });
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
  private async sendUnsafe(cmd: UnsafeCommand): Promise<void> {
    const enc = this.cipher.encrypt(buildUnsafeCommand(cmd));
    await this.transport.write(CMD_CHAR, bytesToHex(enc));
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
        stop();
        resolve(answer);
      };
      // Kept listening rather than once(): an answer that arrives before the write completes is
      // held, and a fresher one replaces it.
      const onEvt = (e: T) => {
        answer = e;
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
