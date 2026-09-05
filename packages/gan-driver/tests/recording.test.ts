// The capture pipeline: what a packet becomes, and what "saved" is allowed to mean.
//
// `gan16 record` is how every fixture in this package was taken, so its two critical paths are the
// ones that decide whether a session with a physical cube is evidence or a wasted afternoon — and
// until 2026-09-05 both lived inside an argv-dispatching script and had no tests at all, on the
// grounds that recording needs hardware. It does not: a subscription is an EventEmitter and a file
// is a Writable, and the failures worth catching are about neither the cube nor the disk.
//
//   a packet that will not decode   — the decoder throws on a corrupt FACELETS frame, and that
//                                     exception came straight out of a notification handler,
//                                     killing the recorder before the encrypted bytes had been
//                                     written anywhere. The corrupt frame is the one worth most.
//   a shutdown that truncates       — out.end() returns before the buffer drains, and the old
//                                     Ctrl-C handler called process.exit() on the next line, over
//                                     a message reading "saved."
//   a flush that fails              — waiting for the drain is not the same as checking it. The
//                                     error of a write that fails WHILE the file closes arrives
//                                     as end()'s callback argument, before any 'error' event, so
//                                     ignoring it put the same "saved" over the same truncation
//                                     by a different route (found 2026-09-05).
//
// Every packet fed in below is a real GAN16 ui frame from tests/fixtures, so the recorded lines go
// through the same decrypt/decode path the hardware does.

import { EventEmitter } from 'node:events';
import { createWriteStream, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';

import {
  decodePacket,
  MAX_QUEUED_LINES,
  type Recording,
  recordingShutdown,
  startRecording,
} from '../src/capture.js';
import { GanGen4Cipher } from '../src/gen4/crypto.js';
import {
  CAPTURE_MAC,
  corruptFaceletsPacket,
  faceletsPacket,
  movePacket,
} from './helpers/packets.js';

const cipher = new GanGen4Cipher(CAPTURE_MAC);
const tick = () => new Promise((r) => setTimeout(r, 0));

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

/** A real file, in a directory this test owns and removes afterwards. */
async function tempFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gan-record-'));
  dirs.push(dir);
  return join(dir, 'capture.jsonl');
}

interface Line {
  meta?: Record<string, unknown>;
  enc?: string;
  dec?: string;
  event?: { type: string; serial?: number };
  decodeError?: string;
}

const parse = (text: string): Line[] =>
  text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Line);

describe('decodePacket — one pipeline, and it never throws', () => {
  it('decrypts and decodes a real frame', () => {
    const { dec, event, error } = decodePacket(cipher, movePacket(7), 0);
    expect(event).toMatchObject({ type: 'MOVE', serial: 7 });
    expect(dec).toHaveLength(40);
    expect(error).toBeNull();
  });

  it('reports a frame that is not a Gen4 message rather than decrypting it', () => {
    const { dec, event, error } = decodePacket(cipher, 'abcd', 0);
    expect(event).toBeNull();
    expect(dec).toBe('');
    expect(error).toMatch(/2 bytes/);
  });

  // The reason this returns a value instead of propagating: the caller is a notification handler.
  it('turns a decoder throw into a reason, keeping the decrypted bytes', () => {
    const { dec, event, error } = decodePacket(cipher, corruptFaceletsPacket(), 0);
    expect(event).toBeNull();
    expect(error).toBeTruthy();
    expect(dec).toHaveLength(40); // decryption succeeded; it was the decode that failed
  });
});

describe('a recording is what reached the file', () => {
  it('writes the metadata line first, then one line per packet', async () => {
    const path = await tempFile();
    const sub = new EventEmitter();
    const rec = startRecording({
      sub,
      cipher,
      out: createWriteStream(path),
      path,
      meta: { device: 'GAN16ui_C8D3', experiment: 'unit' },
    });
    sub.emit('packet', movePacket(1), 111);
    sub.emit('packet', faceletsPacket(), 222);
    expect(await rec.stop()).toBe(2);

    const lines = parse(readFileSync(path, 'utf8'));
    expect(lines).toHaveLength(3);
    expect(lines[0]?.meta).toMatchObject({ device: 'GAN16ui_C8D3', experiment: 'unit' });
    expect(lines[1]).toMatchObject({ ts: 111, char: 'FFF6', enc: movePacket(1) });
    expect(lines[1]?.event).toMatchObject({ type: 'MOVE', serial: 1 });
    expect(lines[2]?.event).toMatchObject({ type: 'FACELETS' });
  });

  // The whole point of recording a session with a physical cube is the frames nothing understands.
  it('keeps a packet the decoder cannot read, with the reason beside it', async () => {
    const path = await tempFile();
    const sub = new EventEmitter();
    const corrupt = corruptFaceletsPacket();
    const rec = startRecording({
      sub,
      cipher,
      out: createWriteStream(path),
      path,
      meta: {},
    });
    // A throw here used to end the process. Nothing may escape into the emitter.
    expect(() => sub.emit('packet', corrupt, 5)).not.toThrow();
    sub.emit('packet', movePacket(2), 6);
    expect(await rec.stop()).toBe(2);

    const lines = parse(readFileSync(path, 'utf8'));
    expect(lines[1]?.enc).toBe(corrupt);
    expect(lines[1]?.decodeError).toBeTruthy();
    expect(lines[1]?.event).toBeUndefined();
    // …and the packet after it was still recorded, because nothing died.
    expect(lines[2]?.event).toMatchObject({ type: 'MOVE', serial: 2 });
  });

  it('records which characteristic the packets came from', async () => {
    const path = await tempFile();
    const sub = new EventEmitter();
    const rec = startRecording({
      sub,
      cipher,
      out: createWriteStream(path),
      path,
      meta: {},
      char: 'FFF7',
    });
    sub.emit('packet', movePacket(1), 0);
    await rec.stop();
    expect(parse(readFileSync(path, 'utf8'))[1]).toMatchObject({ char: 'FFF7' });
  });

  it('stops recording once stopped', async () => {
    const path = await tempFile();
    const sub = new EventEmitter();
    const rec = startRecording({ sub, cipher, out: createWriteStream(path), path, meta: {} });
    sub.emit('packet', movePacket(1), 0);
    await rec.stop();
    sub.emit('packet', movePacket(2), 0);
    expect(parse(readFileSync(path, 'utf8'))).toHaveLength(2);
    expect(rec.packets).toBe(1);
  });

  it('answers a second stop() the same way rather than ending a closed stream again', async () => {
    const path = await tempFile();
    const sub = new EventEmitter();
    const rec = startRecording({ sub, cipher, out: createWriteStream(path), path, meta: {} });
    sub.emit('packet', movePacket(1), 0);
    expect(await rec.stop()).toBe(1);
    expect(await rec.stop()).toBe(1);
  });
});

/**
 * A stream that holds every write until the test releases it — a slow disk, deterministically.
 *
 * With `failAt` it is also a disk that fills up mid-flush: the write of that chunk (1-based, the
 * metadata line being chunk 1) reports an error and the rest succeed. Both halves of a shutdown
 * failure are the same stream on purpose — the ordering between them is the whole finding.
 */
class HeldStream extends Writable {
  readonly chunks: string[] = [];
  private waiting: ((e?: Error) => void)[] = [];
  constructor(private readonly failAt = 0) {
    super();
  }
  override _write(chunk: Buffer, _enc: string, cb: (e?: Error) => void): void {
    this.chunks.push(chunk.toString());
    this.waiting.push(cb);
  }
  /** Let everything currently queued through, repeatedly, until the stream has nothing left. */
  async drain(): Promise<void> {
    for (let i = 0; i < 50; i++) {
      for (const cb of this.waiting.splice(0)) {
        cb(
          this.chunks.length === this.failAt ? new Error('EIO: write failed mid-flush') : undefined,
        );
      }
      await tick();
    }
  }
}

/**
 * A stream that takes every byte the moment it is offered and then fails to let go of the file.
 *
 * A close is itself a write on any filesystem that defers, and it can fail on its own after every
 * byte was accepted — so 'finish' (the buffer drained) and 'close' (the descriptor was released)
 * are two different claims, and only the second is what "saved" is about.
 */
class UncloseableStream extends Writable {
  readonly chunks: string[] = [];
  override _write(chunk: Buffer, _enc: string, cb: (e?: Error) => void): void {
    this.chunks.push(chunk.toString());
    cb();
  }
  override _destroy(_err: Error | null, cb: (e?: Error | null) => void): void {
    cb(new Error('EIO: close failed'));
  }
}

/**
 * A stream that accepts nothing until it is released, with a high-water mark small enough that the
 * very first line puts it over — a stalled disk, deterministically. `writableLength` is then the
 * memory the recorder is costing while it waits, which is the whole of the finding.
 *
 * release() is synchronous on purpose: a write callback invoked from outside the stream runs
 * Node's afterWrite path inline, which issues the next buffered write inline too, so one loop
 * drains the queue without needing a tick per chunk.
 */
class StalledStream extends Writable {
  readonly chunks: string[] = [];
  private waiting: (() => void)[] = [];
  constructor() {
    super({ highWaterMark: 32 });
  }
  override _write(chunk: Buffer, _enc: string, cb: () => void): void {
    this.chunks.push(chunk.toString());
    this.waiting.push(cb);
  }
  release(): void {
    for (let i = 0; i < 1e6 && this.waiting.length > 0; i++) (this.waiting.shift() as () => void)();
  }
}

describe('stopping means the bytes are on disk', () => {
  it('does not resolve until the stream has flushed', async () => {
    const out = new HeldStream();
    const sub = new EventEmitter();
    const rec = startRecording({ sub, cipher, out, path: '/held', meta: {} });
    for (let i = 1; i <= 6; i++) sub.emit('packet', movePacket(i), i);

    const stopped = rec.stop();
    // This is the frame the old shutdown exited on: end() has been called, most of the packets
    // are still in the stream's buffer, and "saved." was already on the screen.
    expect(out.chunks.length).toBeLessThan(7);
    expect(await Promise.race([stopped.then(() => 'done'), tick().then(() => 'waiting')])).toBe(
      'waiting',
    );

    await out.drain();
    expect(await stopped).toBe(6);
    expect(out.chunks).toHaveLength(7); // metadata + six packets
  });

  // 'finish' and 'close' are two claims, and "saved" is about the second. Resolving on the first
  // reported a saved capture while the descriptor was still open, and a close that then failed had
  // nowhere left to be reported: exit code 0, count 3, EIO on the close (measured 2026-09-05).
  it('rejects when every byte was written but the file would not close', async () => {
    const out = new UncloseableStream();
    const sub = new EventEmitter();
    const rec = startRecording({ sub, cipher, out, path: '/captures/unclosed.jsonl', meta: {} });
    for (let i = 1; i <= 3; i++) sub.emit('packet', movePacket(i), i);

    await expect(rec.stop()).rejects.toThrow(
      /recording to \/captures\/unclosed\.jsonl failed: EIO: close failed/,
    );
    // The distinction the assertion above rests on: nothing was ever refused on the way in.
    expect(out.chunks).toHaveLength(4);
  });
});

// A notification handler cannot wait, and write() returning false is the stream saying it is full.
// Ignoring that answer made a stalled disk into unbounded memory: measured on 2026-09-05, 878,902
// bytes queued inside a stream whose high-water mark was 32, still climbing, with the recorder
// reporting every one of them as recorded.
describe('a stream that is full is not written to anyway', () => {
  it('queues the overflow instead of pushing it into the stream, and loses none of it', async () => {
    const out = new StalledStream();
    const sub = new EventEmitter();
    const rec = startRecording({ sub, cipher, out, path: '/captures/slow.jsonl', meta: {} });
    const packet = movePacket(1);
    for (let i = 0; i < 2000; i++) sub.emit('packet', packet, i);

    // One line in flight, and that is all — not two thousand of them behind a 32-byte mark.
    expect(out.writableLength).toBeLessThan(1024);
    expect(rec.packets).toBe(2000);

    const stopped = rec.stop(); // the last write of a recording has nothing left to protect
    out.release();
    expect(await stopped).toBe(2000);
    expect(out.chunks).toHaveLength(2001); // metadata + every packet, in order
    expect(out.chunks[1]).toContain(packet);
  });

  // A disk that catches up is the ordinary case, and the recording has to continue through it in
  // order — a queue that is handed back but not emptied would silently reorder a capture.
  it('hands the queue back when the stream drains, and keeps recording in order', async () => {
    const out = new StalledStream();
    const sub = new EventEmitter();
    const rec = startRecording({ sub, cipher, out, path: '/captures/recovers.jsonl', meta: {} });
    for (let i = 1; i <= 30; i++) sub.emit('packet', movePacket(i), i);
    expect(out.chunks.length).toBeLessThan(31); // most of it is queued, not written

    out.release(); // the disk catches up, and 'drain' fires
    await tick();
    expect(out.chunks).toHaveLength(31); // metadata + thirty, all of it through

    // …and the recorder is writing straight to the stream again, not into a queue nobody empties.
    for (let i = 31; i <= 35; i++) sub.emit('packet', movePacket(i), i);
    out.release();
    const stopped = rec.stop();
    out.release();
    expect(await stopped).toBe(35);
    const serials = out.chunks.slice(1).map((l) => (JSON.parse(l) as Line).event?.serial);
    expect(serials).toEqual(Array.from({ length: 35 }, (_, i) => i + 1));
  });

  it('fails loudly rather than queueing without limit, and stops counting', async () => {
    const out = new StalledStream();
    const sub = new EventEmitter();
    const seen: Error[] = [];
    const rec = startRecording({
      sub,
      cipher,
      out,
      path: '/captures/wedged.jsonl',
      meta: {},
      onError: (e) => seen.push(e),
    });
    const packet = movePacket(1);
    for (let i = 0; i < MAX_QUEUED_LINES + 2; i++) sub.emit('packet', packet, i);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.message).toMatch(
      /recording to \/captures\/wedged\.jsonl failed: the stream has not drained/,
    );
    // The bound held, and the count says what actually got in rather than what was offered. One
    // more than the bound: the first packet is the one the stream itself accepted before saying
    // it was full, and the limit governs the queue that forms behind it.
    expect(rec.packets).toBe(MAX_QUEUED_LINES + 1);
    sub.emit('packet', packet, 0);
    expect(rec.packets).toBe(MAX_QUEUED_LINES + 1);
    await expect(rec.stop()).rejects.toThrow(/has not drained/);
  });
});

// The CLI's half of the two properties above. `cli.ts` is an argv-dispatching script — importing
// it runs a command — so these are asserted on the source, the way REQUEST_RESET containment is in
// unsafe-commands.test.ts. A green run here says the command is wired to the flush and to the one
// pipeline; the behaviour of both is established above, by running them.
//
// It says nothing about the lifecycle, which is what an audit named on 2026-09-05: source text
// cannot watch a signal handler run or an exit code come back. cli-record.test.ts does that now,
// by spawning the real CLI against a fake cube. These stay because they guard something that one
// cannot — that the command keeps no SECOND copy of the flush, the message or the exit code.
describe('the record command is wired to the flush, not around it', () => {
  const cli = readFileSync(new URL('../src/cli.ts', import.meta.url), 'utf8');
  const record = /async function cmdRecord\([\s\S]*?\n\}/.exec(cli)?.[0];
  // Positions are compared, so comments are removed first: the defect this replaced is worth
  // naming in the source, and a sweep that read that mention as code would forbid describing it.
  const code = (record ?? '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  // The flush, the "saved" line and the exit code all moved into recordingShutdown on 2026-09-05,
  // where a fake stream reaches them — so what is left to assert on the source is that the command
  // keeps no second copy of any of it. A copy is a second thing to be wrong, and it would be the
  // one nothing runs.
  it('claims nothing itself: the flush, the message and the code come from the shutdown', () => {
    expect(record, 'cmdRecord not found — did it get renamed?').toBeTruthy();
    expect(code).not.toMatch(/rec\.stop\(\)/);
    expect(code).not.toMatch(/saved/);
    // One exit, and it is the code the shutdown handed back after the file closed — never one
    // chosen in advance. The defect: out.end() and then process.exit() on the next line.
    expect([...code.matchAll(/process\.exit\(/g)]).toHaveLength(1);
    expect(code).toMatch(/shutdown\(code\)\.then\(\(c\) => process\.exit\(c\)\)/);
  });

  it('gives the shutdown the packet stop and the path it is claiming about', () => {
    expect(code).toMatch(/stopPackets: \(\) => transport\.disconnect\(\)/);
    expect(code).toMatch(/\bpath,/);
  });

  it('routes Ctrl-C, a giveup and a stream failure through one shutdown', () => {
    expect(record).toMatch(/process\.on\('SIGINT', \(\) => finish\(0\)\)/);
    expect(record).toMatch(/sub\.on\('giveup'[\s\S]*?finish\(1\)/);
    expect(record).toMatch(/onError: \(\) => finish\(1\)/);
  });

  // One pipeline, not two. The raw and record commands had each grown their own copy of the
  // length check, decrypt, hex conversion and decode, so a fix to one silently missed the other.
  it('leaves decrypting and decoding to the shared pipeline', () => {
    expect(cli).toMatch(/import \{ decodePacket, recordingShutdown, startRecording \}/);
    expect(cli).not.toMatch(/decodeGen4|\.decrypt\(/);
  });
});

describe('a stream that fails says so, and names the file', () => {
  /** A stream that refuses the second write — the first is the metadata line. */
  class FailingStream extends Writable {
    private writes = 0;
    override _write(_chunk: Buffer, _enc: string, cb: (e?: Error) => void): void {
      cb(++this.writes > 1 ? new Error('ENOSPC: no space left on device') : undefined);
    }
  }

  it('reports the failure with the path, and stops capturing', async () => {
    const out = new FailingStream();
    const sub = new EventEmitter();
    const seen: Error[] = [];
    const rec = startRecording({
      sub,
      cipher,
      out,
      path: '/captures/recordings/session.jsonl',
      meta: {},
      onError: (e) => seen.push(e),
    });
    sub.emit('packet', movePacket(1), 0);
    await tick();

    expect(seen).toHaveLength(1);
    expect(seen[0]?.message).toMatch(/\/captures\/recordings\/session\.jsonl/);
    expect(seen[0]?.message).toMatch(/ENOSPC/);

    // Capture stopped: counting packets into a file that is not receiving them would be worse
    // than the failure itself.
    const before = rec.packets;
    sub.emit('packet', movePacket(2), 0);
    expect(rec.packets).toBe(before);
  });

  it('rejects stop() rather than reporting a save that did not happen', async () => {
    const out = new FailingStream();
    const sub = new EventEmitter();
    const rec = startRecording({ sub, cipher, out, path: '/tmp/doomed.jsonl', meta: {} });
    sub.emit('packet', movePacket(1), 0);
    await tick();
    await expect(rec.stop()).rejects.toThrow(/\/tmp\/doomed\.jsonl failed: ENOSPC/);
  });
});

// The failure that arrives DURING the shutdown, which is when a capture session is most likely to
// meet one — the disk that filled up is discovered on the flush, not on the write that filled it.
// Both of these resolved successfully until 2026-09-05, because the only report of a write that
// fails while the buffer drains is the ERROR ARGUMENT of end()'s callback, and it was ignored:
// Node calls that callback back BEFORE it emits 'error', so the 'error' listener stop() installs
// arrives to find the promise already resolved. "saved" then went on the screen over a truncated
// file — the exact claim this whole module exists to make true.
describe('a failure while the file is closing is still a failure', () => {
  const settle = (p: Promise<number>): Promise<string> =>
    p.then(
      (n) => `resolved ${n}`,
      (e: Error) => e.message,
    );

  it('rejects when a write fails during the flush, naming the file', async () => {
    const out = new HeldStream(4); // metadata + three packets; the last write fails
    const sub = new EventEmitter();
    const rec = startRecording({ sub, cipher, out, path: '/captures/truncated.jsonl', meta: {} });
    for (let i = 1; i <= 3; i++) sub.emit('packet', movePacket(i), i);

    const stopped = settle(rec.stop()); // end() called, everything still buffered
    await out.drain();
    expect(await stopped).toMatch(/recording to \/captures\/truncated\.jsonl failed: EIO/);
  });

  it('rejects when the stream dies after stop() was already asked for', async () => {
    const out = new HeldStream();
    const sub = new EventEmitter();
    const rec = startRecording({ sub, cipher, out, path: '/captures/vanished.jsonl', meta: {} });
    for (let i = 1; i <= 3; i++) sub.emit('packet', movePacket(i), i);

    const stopped = settle(rec.stop());
    out.destroy(new Error('EIO: device disappeared')); // the disk goes away mid-flush
    // Naming the path matters most in exactly this ordering: the recorder's own 'error' handler
    // never ran before stop(), so nothing else in the message says which file was lost.
    expect(await stopped).toMatch(
      /recording to \/captures\/vanished\.jsonl failed: EIO: device disappeared/,
    );
  });

  it('gives a second stop() the same failure rather than ending a dead stream again', async () => {
    const out = new HeldStream();
    const sub = new EventEmitter();
    const rec = startRecording({ sub, cipher, out, path: '/captures/vanished.jsonl', meta: {} });
    sub.emit('packet', movePacket(1), 1);

    const first = rec.stop().catch((e: Error) => e);
    const second = rec.stop().catch((e: Error) => e);
    out.destroy(new Error('EIO: device disappeared'));
    // The same Error object, so the same settled promise: idempotence has to survive the failure
    // path too, or the three callers of the shutdown each get their own verdict.
    expect(await first).toBeInstanceOf(Error);
    expect(await first).toBe(await second);
  });
});

// The other half of "saved": who is allowed to say it. This is `gan16 record`'s shutdown, running
// against a fake stream instead of a cube.
describe('the shutdown says only what happened', () => {
  /** A recording that never touches a stream — the shutdown's own behaviour, isolated. */
  const stubRecording = (stop: () => Promise<number>): Recording => ({ packets: 0, stop });

  function spy() {
    const said: string[] = [];
    const warned: string[] = [];
    const stops: string[] = [];
    return {
      said,
      warned,
      stops,
      wire: (rec: Recording, path: string) =>
        recordingShutdown({
          rec,
          stopPackets: () => stops.push('packets'),
          path,
          say: (m) => said.push(m.trim()),
          warn: (m) => warned.push(m.trim()),
        }),
    };
  }

  it('stops the packets before it closes the file, then reports the count', async () => {
    const s = spy();
    const shutdown = s.wire(
      stubRecording(() => {
        s.stops.push('file'); // ordering, not decoration: a packet arriving mid-flush is a race
        return Promise.resolve(2);
      }),
      '/captures/ok.jsonl',
    );
    expect(await shutdown(0)).toBe(0);
    expect(s.stops).toEqual(['packets', 'file']);
    expect(s.said).toEqual(['saved 2 packets -> /captures/ok.jsonl']);
    expect(s.warned).toEqual([]);
  });

  it('never says saved for a file that failed, and exits non-zero even on a clean Ctrl-C', async () => {
    const out = new HeldStream(4);
    const sub = new EventEmitter();
    const path = '/captures/truncated.jsonl';
    const rec = startRecording({ sub, cipher, out, path, meta: {} });
    for (let i = 1; i <= 3; i++) sub.emit('packet', movePacket(i), i);

    const s = spy();
    const code = s.wire(rec, path)(0); // 0: the user asked for a clean stop, and did not get one
    await out.drain();

    expect(await code).toBe(1);
    expect(s.said).toEqual([]); // the line that made a truncated capture look like evidence
    expect(s.warned.join('')).toMatch(/recording to \/captures\/truncated\.jsonl failed: EIO/);
  });

  it('ends once, however many ways it is asked to', async () => {
    const s = spy();
    let stops = 0;
    const shutdown = s.wire(
      stubRecording(() => Promise.resolve(++stops)),
      '/captures/ok.jsonl',
    );
    // Ctrl-C and a stream failure racing each other is the ordinary case, not the exotic one.
    expect(await Promise.all([shutdown(0), shutdown(1)])).toEqual([0, 0]);
    expect(stops).toBe(1);
    expect(s.said).toHaveLength(1);
  });

  // stopPackets() is the transport's, and a transport can refuse to stop — a child process that
  // will not die, a handle already gone. It was called from OUTSIDE the try until 2026-09-05, so
  // its throw skipped rec.stop() entirely: the buffered packets never flushed, and the rejection
  // went to a caller that only ever calls .then(), leaving the process up under no verdict at all.
  it('still closes the file when the packet source refuses to stop', async () => {
    const path = await tempFile();
    const sub = new EventEmitter();
    const rec = startRecording({ sub, cipher, out: createWriteStream(path), path, meta: {} });
    for (let i = 1; i <= 3; i++) sub.emit('packet', movePacket(i), i);

    const said: string[] = [];
    const warned: string[] = [];
    const shutdown = recordingShutdown({
      rec,
      stopPackets: () => {
        throw new Error('blew would not die');
      },
      path,
      say: (m) => said.push(m.trim()),
      warn: (m) => warned.push(m.trim()),
    });

    // A failed transport stop costs the exit code — the last lines may have been written while
    // the file was closing — but it never costs the file.
    expect(await shutdown(0)).toBe(1);
    expect(said).toEqual([]);
    expect(warned.join('')).toMatch(/saved 3 packets .*would not stop: blew would not die/);
    expect(parse(readFileSync(path, 'utf8'))).toHaveLength(4);
  });

  it('never says saved for a file that would not close', async () => {
    const out = new UncloseableStream();
    const sub = new EventEmitter();
    const path = '/captures/unclosed.jsonl';
    const rec = startRecording({ sub, cipher, out, path, meta: {} });
    sub.emit('packet', movePacket(1), 1);

    const s = spy();
    expect(await s.wire(rec, path)(0)).toBe(1);
    expect(s.said).toEqual([]);
    expect(s.warned.join('')).toMatch(/failed: EIO: close failed/);
  });

  it('reports a rejection that is not an Error rather than printing an object', async () => {
    const s = spy();
    const shutdown = s.wire(
      stubRecording(() => Promise.reject('the disk is on fire')),
      '/captures/odd.jsonl',
    );
    expect(await shutdown(0)).toBe(1);
    expect(s.warned).toEqual(['the disk is on fire']);
  });
});
