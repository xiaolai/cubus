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

import { decodePacket, startRecording } from '../src/capture.js';
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
  event?: { type: string };
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

/** A stream that holds every write until the test releases it — a slow disk, deterministically. */
class HeldStream extends Writable {
  readonly chunks: string[] = [];
  private waiting: (() => void)[] = [];
  override _write(chunk: Buffer, _enc: string, cb: () => void): void {
    this.chunks.push(chunk.toString());
    this.waiting.push(cb);
  }
  /** Let everything currently queued through, repeatedly, until the stream has nothing left. */
  async drain(): Promise<void> {
    for (let i = 0; i < 50; i++) {
      for (const cb of this.waiting.splice(0)) cb();
      await tick();
    }
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
});

// The CLI's half of the two properties above. `cli.ts` is an argv-dispatching script — importing
// it runs a command — so these are asserted on the source, the way REQUEST_RESET containment is in
// unsafe-commands.test.ts. A green run here says the command is wired to the flush and to the one
// pipeline; the behaviour of both is established above, by running them.
describe('the record command is wired to the flush, not around it', () => {
  const cli = readFileSync(new URL('../src/cli.ts', import.meta.url), 'utf8');
  const record = /async function cmdRecord\([\s\S]*?\n\}/.exec(cli)?.[0];
  // Positions are compared, so comments are removed first: the defect this replaced is worth
  // naming in the source, and a sweep that read that mention as code would forbid describing it.
  const code = (record ?? '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('awaits the flush before every exit', () => {
    expect(record, 'cmdRecord not found — did it get renamed?').toBeTruthy();
    const flush = code.indexOf('await rec.stop()');
    expect(flush).toBeGreaterThan(0);
    // The defect: out.end() and then process.exit() on the next line, over a "saved." message.
    for (const m of code.matchAll(/process\.exit\(/g)) {
      expect(m.index).toBeGreaterThan(flush);
    }
  });

  it('stops the packets before it closes the file', () => {
    const disconnect = code.indexOf('transport.disconnect()');
    expect(disconnect).toBeGreaterThan(0);
    expect(disconnect).toBeLessThan(code.indexOf('await rec.stop()'));
  });

  it('routes Ctrl-C, a giveup and a stream failure through one shutdown', () => {
    expect(record).toMatch(/process\.on\('SIGINT', \(\) => void finish\(0\)\)/);
    expect(record).toMatch(/sub\.on\('giveup'[\s\S]*?void finish\(1\)/);
    expect(record).toMatch(/onError: \(\) => void finish\(1\)/);
  });

  // One pipeline, not two. The raw and record commands had each grown their own copy of the
  // length check, decrypt, hex conversion and decode, so a fix to one silently missed the other.
  it('leaves decrypting and decoding to the shared pipeline', () => {
    expect(cli).toMatch(/import \{ decodePacket, startRecording \}/);
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
