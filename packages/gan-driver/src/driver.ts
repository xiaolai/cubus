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

  constructor(opts: GanCubeOptions) {
    super();
    this.cipher = new GanGen4Cipher(opts.mac);
    this.transport = opts.transport;
  }

  /** Subscribe to state notifications and start decoding. */
  connect(): void {
    const sub = this.transport.subscribe(STATE_CHAR);
    sub.on('packet', (hex: string, ts: number) => this.onPacket(hex, ts));
    sub.on('error', (e) => this.emit('error', e));
    sub.on('reconnecting', () => {
      this.live = false;
      this.emit('reconnecting');
    });
    sub.on('giveup', (e) => this.emit('giveup', e));
    sub.on('close', (code) => this.emit('disconnect', code));
  }

  /** Resolves once at least one notification has arrived (subscription is live). */
  private waitLive(timeoutMs = 5000): Promise<void> {
    if (this.live) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const onLive = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        this.off('live', onLive); // don't leak the listener on the timeout path
        reject(new Error('subscription did not go live'));
      }, timeoutMs);
      this.once('live', onLive);
    });
  }

  disconnect(): void {
    this.transport.disconnect();
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
    if (ev.type === 'MOVE') {
      this.detectGap(ev);
    }
    if (ev.type === 'FACELETS') {
      this.lastFacelets = ev;
      if (this.lastSerial === -1) this.lastSerial = ev.serial & 0xff;
    }
    if (ev.type === 'UNKNOWN') {
      this.emit('unknown', ev);
    }
    this.emit('event', ev);
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

  /** Emit a 'gap' event when the move serial skips — never lose moves silently. */
  private detectGap(move: CubeMove): void {
    const serial = move.serial & 0xff;
    if (this.lastSerial !== -1) {
      const diff = (serial - this.lastSerial) & 0xff;
      if (diff > 1 && diff < 128) {
        this.emit('gap', { missing: diff - 1, from: this.lastSerial, to: serial });
      }
    }
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
   */
  private request<T = CubeEvent>(
    event: string,
    cmd: SafeCommand | null,
    timeoutMs: number,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off(event, onEvt);
        reject(new Error(`timeout waiting for ${event}${cmd ? ` after ${cmd}` : ''}`));
      }, timeoutMs);
      const onEvt = (e: T) => {
        clearTimeout(timer);
        this.off(event, onEvt);
        resolve(e);
      };
      this.once(event, onEvt);
      if (cmd) {
        // Wait for the subscription within the caller's own budget, not a
        // shorter hardcoded one — a slow BLE connect must not cap the timeout.
        this.waitLive(timeoutMs)
          .then(() => this.send(cmd!))
          .catch((e) => {
            clearTimeout(timer);
            this.off(event, onEvt);
            reject(e);
          });
      }
    });
  }

  get currentFacelets(): CubeFacelets | null {
    return this.lastFacelets;
  }
}
