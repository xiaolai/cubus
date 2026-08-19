// GAN16 ui driver: turns encrypted FFF6 notifications into typed cube events,
// and sends safe query commands via FFF5. Transport-agnostic (see Transport).

import { EventEmitter } from 'node:events';
import { type SafeCommand, buildCommand } from './gen4/commands.js';
import { GanGen4Cipher } from './gen4/crypto.js';
import { decodeGen4 } from './gen4/decode.js';
import type { CubeEvent, CubeFacelets, CubeGyro, CubeMove } from './gen4/types.js';
import type { Transport } from './transport/blew.js';

const STATE_CHAR = 'FFF6'; // notify: state/events
const CMD_CHAR = 'FFF5'; // write: commands

export type Unsubscribe = () => void;

export interface GanCubeOptions {
  /** Device MAC (recovered from advertisement) — needed for key derivation. */
  mac: string;
  transport: Transport;
}

export class GanCube extends EventEmitter {
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
      decrypted = this.cipher.decrypt(Buffer.from(hex, 'hex'));
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
    await this.transport.write(CMD_CHAR, Buffer.from(enc).toString('hex'));
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
