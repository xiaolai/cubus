// BLE transport backed by the `blew` CLI (brew install stass/tap/blew).
//
// Why a subprocess instead of a native BLE module: on this Mac (macOS 15,
// Node 24) blew is already proven to scan, dump GATT, read, subscribe, and
// write reliably, with zero native-build risk. The GanCube driver depends only
// on the Transport interface below, so a noble-based transport can replace this
// without touching the protocol or driver code.

import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';

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

/** One-shot advertisement scan via the compiled scan-adv helper (full mfg data). */
export async function scanForCube(
  scanAdvPath: string,
  seconds = 12,
): Promise<AdvDevice[]> {
  const { stdout } = await execFileP(scanAdvPath, [String(seconds), 'gan'], {
    maxBuffer: 16 * 1024 * 1024,
  }).catch((e) => ({ stdout: e.stdout ?? '' }));
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
  constructor(private readonly deviceId: string, private readonly blew = 'blew') {}

  /**
   * Subscribe to a characteristic. The cube stops advertising ~1 s after coming
   * to rest, so `blew sub` can drop; we auto-respawn until disconnect() is
   * called, emitting 'reconnecting' on each respawn so callers can log it.
   */
  subscribe(charUuid: string): EventEmitter {
    const emitter = new EventEmitter();
    const spawnOne = () => {
      if (this.stopped) return;
      const proc = spawn(this.blew, ['-o', 'kv', 'sub', '--id', this.deviceId, charUuid]);
      this.procs.push(proc);
      let buf = '';
      proc.stdout.on('data', (chunk: Buffer) => {
        buf += chunk.toString();
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          const m = line.match(/value=([0-9a-fA-F]+)/);
          const t = line.match(/ts=([^ ]+)/);
          if (m) emitter.emit('packet', m[1], t ? Date.parse(t[1]) : Date.now());
        }
      });
      proc.on('error', (e) => emitter.emit('error', e));
      proc.on('close', () => {
        if (this.stopped) return;
        emitter.emit('reconnecting');
        setTimeout(spawnOne, 500); // brief backoff, then retry
      });
    };
    spawnOne();
    return emitter;
  }

  async read(charUuid: string): Promise<string> {
    const { stdout } = await execFileP(this.blew, [
      '-o', 'kv', 'read', '--id', this.deviceId, charUuid,
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
