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
    // A failure to even launch the helper (missing/uncompiled binary, no permission) must
    // surface, not masquerade as "no cube found".
    if (e.code === 'ENOENT') {
      throw new Error(
        `scan helper not found at ${scanAdvPath} — build it: swiftc -O -o scripts/scan-adv scripts/scan-adv.swift`,
      );
    }
    // Every other abnormal exit is a failure too, and was swallowed the moment the helper had
    // printed anything at all: the comment here claimed a finished scan window exits non-zero,
    // and it does not — scan-adv exits 0 both when the window ends and when it finds the cube
    // early. What DOES exit non-zero is Bluetooth being off, unauthorized or unsupported
    // (status 2), so an advertisement seen just before the radio went down was reported as a
    // clean scan that simply found no cube, and the caller retried into a dead radio six times.
    // The partial output is not used, but how much of it there was is evidence, so it is named.
    const seen = (e.stdout ?? '').split('\n').filter((l) => l.startsWith('{')).length;
    throw new Error(
      `scan helper ${scanAdvPath} failed after ${seen} advertisement line(s): ${e.message.trim()}`,
    );
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

/**
 * How much of a child's stderr is kept. Enough for a stack of blew's own complaints, small enough
 * that a chatty child cannot grow the process without bound — the same trade the packet queue in
 * capture.ts makes, for the same reason.
 */
const DIAGNOSTIC_TAIL = 2000;

export class BlewTransport implements Transport {
  private procs: ReturnType<typeof spawn>[] = [];
  /** Pending respawns. Held so disconnect() can cancel them — see disconnect(). */
  private readonly retries = new Set<ReturnType<typeof setTimeout>>();
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
      // stderr is a pipe, and a pipe nobody reads fills at the OS buffer (64 KB here) and blocks
      // the child mid-write. For `blew sub` that means notifications stop arriving while the
      // process is still alive and nothing anywhere reports a problem — the quietest failure this
      // transport can have. Drained, and the tail kept: when the respawn loop finally gives up,
      // what the child was complaining about is the only evidence of why.
      let diagnostics = '';
      proc.stderr.on('data', (chunk: Buffer) => {
        diagnostics = (diagnostics + chunk.toString()).slice(-DIAGNOSTIC_TAIL);
      });
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
              `gave up reconnecting to ${this.deviceId} after ${deadAttempts} attempts with no data${
                diagnostics ? `; last output from ${this.blew}: ${diagnostics.trim()}` : ''
              }`,
            ),
          );
          return;
        }
        emitter.emit('reconnecting');
        // Read again on the far side of the emit, because a listener may disconnect FROM this
        // event — it is the one that says the link is unhealthy — and it runs synchronously, while
        // the timer below does not exist yet. disconnect() cleared the timers there were, and this
        // handler then made one it could not have cleared: a stopped transport still holding a
        // live handle, which is the whole defect the clearing was for. The flag is checked at both
        // ends: here before scheduling, and again in spawnOne() when the timer fires.
        if (this.stopped) return;
        const backoff = gotPacket ? 500 : Math.min(500 * 2 ** deadAttempts, 8000);
        // Held, because a timer is a live handle: an unreferenced respawn kept Node awake for up
        // to eight seconds after disconnect() had declared the transport stopped, and then woke to
        // find `stopped` set and do nothing. A shutdown that takes eight seconds to be believed is
        // the same defect as a shutdown that does not happen.
        const timer = setTimeout(() => {
          this.retries.delete(timer);
          spawnOne();
        }, backoff);
        this.retries.add(timer);
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
    // `?? ''` stood in for two different things — a characteristic that is genuinely empty, and
    // output with no value= field at all — and the second is a read that did not happen. A blew
    // whose output shape changed, or which answered with something other than a reading, became
    // an empty successful value that the caller went on to decrypt. The field has to be there,
    // and what it holds has to be hex, in whole bytes: `[0-9a-fA-F]*` matched the empty string in
    // front of `value=zz` and reported that as a reading too.
    const value = /(?:^|\s)value=(\S*)/.exec(stdout)?.[1];
    if (value === undefined) {
      throw new Error(
        `blew read ${charUuid}: no value= field in the output: ${stdout.trim() || '(nothing)'}`,
      );
    }
    if (!/^(?:[0-9a-fA-F]{2})*$/.test(value)) {
      throw new Error(`blew read ${charUuid}: value is not whole-byte hex: ${value}`);
    }
    return value;
  }

  async write(charUuid: string, hex: string, withoutResponse = false): Promise<void> {
    const args = ['write', '--id', this.deviceId];
    args.push(withoutResponse ? '--without-response' : '--with-response');
    args.push('--format', 'hex', charUuid, hex);
    await execFileP(this.blew, args);
  }

  disconnect(): void {
    this.stopped = true;
    // Timers first: `stopped` alone only makes the respawn a no-op when it eventually fires, and
    // a pending setTimeout is a referenced handle that holds the event loop open until it does.
    for (const t of this.retries) clearTimeout(t);
    this.retries.clear();
    for (const p of this.procs) p.kill();
    this.procs = [];
  }
}
