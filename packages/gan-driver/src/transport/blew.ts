// BLE transport backed by the `blew` CLI (brew install stass/tap/blew).
//
// Why a subprocess instead of a native BLE module: on this Mac (macOS 15,
// Node 24) blew is already proven to scan, dump GATT, read, subscribe, and
// write reliably, with zero native-build risk. The GanCube driver depends only
// on the Transport interface below, so a noble-based transport can replace this
// without touching the protocol or driver code.

import { execFile, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export interface AdvDevice {
  id: string;
  name: string;
  rssi: number;
  manufacturerData?: string;
  services?: string[];
}

export interface Transport {
  /** Subscribe to a characteristic; emits 'packet' (hex string) per notification. */
  subscribe(charUuid: string): EventEmitter;
  /** Read a characteristic once, returns hex. */
  read(charUuid: string): Promise<string>;
  /** Write hex bytes to a characteristic. */
  write(charUuid: string, hex: string, withoutResponse?: boolean): Promise<void>;
  disconnect(): void;
}

/**
 * Run one `blew` subcommand to completion with its output inherited, rejecting on anything that is
 * not a clean exit.
 *
 * It lived in the CLI and resolved on 'close' whatever had happened, so a read that failed printed
 * its error to the inherited stderr and was then reported as part of a successful dump — and with
 * no 'error' listener, a missing or unexecutable binary threw asynchronously, past the caller's
 * own catch, as an uncaught exception. Both are the same defect: the exit status of the thing that
 * mattered was never looked at.
 */
export function runBlew(args: string[], bin = 'blew'): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: 'inherit' });
    p.on('error', (e) =>
      reject(
        new Error(`could not run ${bin}: ${e.message} — install it: brew install stass/tap/blew`),
      ),
    );
    p.on('close', (code, signal) => {
      if (signal) reject(new Error(`${bin} ${args.join(' ')} was killed by ${signal}`));
      else if (code !== 0) reject(new Error(`${bin} ${args.join(' ')} exited ${code}`));
      else resolve();
    });
  });
}

/** One-shot advertisement scan via the compiled scan-adv helper (full mfg data). */
export async function scanForCube(scanAdvPath: string, seconds = 12): Promise<AdvDevice[]> {
  const { stdout } = await execFileP(scanAdvPath, [String(seconds), 'gan'], {
    maxBuffer: 16 * 1024 * 1024,
  }).catch((e: NodeJS.ErrnoException & { stdout?: string }) => {
    // A non-zero exit that still produced output (e.g. scan window ended) is
    // fine — parse what we got. But a failure to even launch the helper
    // (missing/uncompiled binary, no permission) must surface, not masquerade
    // as "no cube found".
    if (e.code === 'ENOENT') {
      throw new Error(
        `scan helper not found at ${scanAdvPath} — build it: swiftc -O -o scripts/scan-adv scripts/scan-adv.swift`,
      );
    }
    if (!e.stdout) throw e;
    return { stdout: e.stdout };
  });
  const byId = new Map<string, AdvDevice>();
  for (const line of stdout.split('\n')) {
    if (!line.startsWith('{')) continue;
    try {
      const o = JSON.parse(line);
      byId.set(o.id, {
        id: o.id,
        name: o.name || '',
        rssi: o.rssi,
        manufacturerData: o.manufacturerData,
        services: o.services,
      });
    } catch {
      /* ignore partial lines */
    }
  }
  return [...byId.values()];
}

export class BlewTransport implements Transport {
  private procs: ReturnType<typeof spawn>[] = [];
  private stopped = false;
  constructor(
    private readonly deviceId: string,
    private readonly blew = 'blew',
  ) {}

  /**
   * Subscribe to a characteristic. The cube stops advertising ~1 s after coming
   * to rest, so `blew sub` can drop; we auto-respawn until disconnect() is
   * called, emitting 'reconnecting' on each respawn so callers can log it.
   *
   * Backoff grows on consecutive respawns that never delivered a packet (a
   * genuinely gone device or a bad id, where `blew` exits immediately) and
   * resets the moment data flows again. After too many dead attempts we give up
   * and emit 'giveup' rather than spin `blew` forever.
   */
  subscribe(charUuid: string): EventEmitter {
    const emitter = new EventEmitter();
    const MAX_DEAD_ATTEMPTS = 12;
    let deadAttempts = 0;
    const spawnOne = () => {
      if (this.stopped) return;
      const proc = spawn(this.blew, ['-o', 'kv', 'sub', '--id', this.deviceId, charUuid]);
      this.procs.push(proc);
      let gotPacket = false;
      let buf = '';
      proc.stdout.on('data', (chunk: Buffer) => {
        buf += chunk.toString();
        for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          const m = line.match(/value=([0-9a-fA-F]+)/);
          const t = line.match(/ts=([^ ]+)/);
          if (m) {
            gotPacket = true;
            deadAttempts = 0; // a live connection resets the failure count
            emitter.emit('packet', m[1], t?.[1] ? Date.parse(t[1]) : Date.now());
          }
        }
      });
      proc.on('error', (e) => emitter.emit('error', e));
      proc.on('close', () => {
        this.procs = this.procs.filter((p) => p !== proc); // don't retain dead handles
        if (this.stopped) return;
        if (!gotPacket && ++deadAttempts >= MAX_DEAD_ATTEMPTS) {
          emitter.emit(
            'giveup',
            new Error(
              `gave up reconnecting to ${this.deviceId} after ${deadAttempts} attempts with no data`,
            ),
          );
          return;
        }
        emitter.emit('reconnecting');
        const backoff = gotPacket ? 500 : Math.min(500 * 2 ** deadAttempts, 8000);
        setTimeout(spawnOne, backoff);
      });
    };
    spawnOne();
    return emitter;
  }

  async read(charUuid: string): Promise<string> {
    const { stdout } = await execFileP(this.blew, [
      '-o',
      'kv',
      'read',
      '--id',
      this.deviceId,
      charUuid,
    ]);
    return stdout.match(/value=([0-9a-fA-F]*)/)?.[1] ?? '';
  }

  async write(charUuid: string, hex: string, withoutResponse = false): Promise<void> {
    const args = ['write', '--id', this.deviceId];
    args.push(withoutResponse ? '--without-response' : '--with-response');
    args.push('--format', 'hex', charUuid, hex);
    await execFileP(this.blew, args);
  }

  disconnect(): void {
    this.stopped = true;
    for (const p of this.procs) p.kill();
    this.procs = [];
  }
}
