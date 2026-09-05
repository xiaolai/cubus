// Which MOVE packets reach the caller, and which the driver refuses.
//
// This package is the independent oracle the app's protocol layer is measured against, so its
// move stream has to mean something exact: an emitted move is one the cube made, delivered once
// and in order, and a 'gap' means moves were genuinely missed. Until 2026-09-05 the serial
// counter advanced for ANY move packet, including one from behind — so the sequence 10, 9, 11
// forwarded 9 after 10 and then reported move 10 as MISSING, a move it had already delivered.
// A false gap is worse than a silent one here: it is the signal the app uses to decide its
// tracking is broken and to ask for a camera scan.
//
// The packets are real. Each test frame is a captured GAN16 ui MOVE packet, decrypted,
// re-serialled at the 16-bit field docs/protocol.md pins (@bit48, little-endian) and re-encrypted
// — so these run through the same decrypt/decode path as the hardware, not around it.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { GanCube } from '../src/driver.js';
import { GanGen4Cipher } from '../src/gen4/crypto.js';
import { decodeGen4 } from '../src/gen4/decode.js';
import type { CubeMove } from '../src/gen4/types.js';
import { hexToBytes } from '../src/hex.js';
import { CAPTURE_MAC, movePacket } from './helpers/packets.js';
import { simulateTransport } from './helpers/simulate-transport.js';

interface Gap {
  missing: number;
  from: number;
  to: number;
}

/** Feed a serial sequence through the whole packet path and record what came out. */
function feed(serials: number[]) {
  const sim = simulateTransport();
  const cube = new GanCube({ mac: CAPTURE_MAC, transport: sim.transport });
  const moves: CubeMove[] = [];
  const gaps: Gap[] = [];
  const refused: { serial: number; reason: string }[] = [];
  cube.connect();
  cube.onMove((m) => moves.push(m));
  cube.on('gap', (g: Gap) => gaps.push(g));
  cube.on('stale', (s: { serial: number; reason: string }) =>
    refused.push({ serial: s.serial, reason: s.reason }),
  );
  for (const [i, s] of serials.entries()) sim.sub.emit('packet', movePacket(s), i);
  return { moves: moves.map((m) => m.serial), gaps, refused };
}

// The template frame must decode as a MOVE with the serial asked for, or every assertion below
// is testing the forger rather than the driver.
describe('the forged frames are real MOVE packets', () => {
  it('decodes back to the serial it was built with', () => {
    for (const serial of [0, 9, 200, 0xffff]) {
      const ev = decodeGen4(
        new GanGen4Cipher(CAPTURE_MAC).decrypt(hexToBytes(movePacket(serial))),
        0,
      );
      expect(ev.type).toBe('MOVE');
      expect((ev as CubeMove).serial).toBe(serial);
    }
  });
});

describe('a move from behind is refused, not forwarded', () => {
  // The exact sequence from the audit. Before the fix: three moves out, and a gap claiming
  // move 10 was missed.
  it('10, 9, 11 delivers 10 and 11, and reports no gap', () => {
    const { moves, gaps } = feed([10, 9, 11]);
    expect(moves).toEqual([10, 11]);
    expect(gaps).toEqual([]);
  });

  it('a repeated serial is delivered exactly once', () => {
    const { moves } = feed([10, 10, 11]);
    expect(moves).toEqual([10, 11]);
  });

  // A refusal is a packet the cube sent and the caller never sees. Dropping it in silence is the
  // failure this driver refuses everywhere else (bad framing, unknown event types), so the
  // refusal is announced with the serial that caused it.
  it('says so rather than dropping in silence', () => {
    const { refused } = feed([10, 10, 9, 11]);
    expect(refused).toEqual([
      { serial: 10, reason: 'duplicate' },
      { serial: 9, reason: 'behind' },
    ]);
  });
});

describe('a genuine skip is still a gap', () => {
  it('10 then 13 reports the two moves in between', () => {
    const { moves, gaps } = feed([10, 13]);
    expect(moves).toEqual([10, 13]);
    expect(gaps).toEqual([{ missing: 2, from: 10, to: 13 }]);
  });
});

// The counter is compared modulo the width the DECODER delivers — 16 bits (protocol.md: "16-bit
// serial @bit48"). It used to be compared modulo 256, which put the behind/ahead boundary at 128:
// any forward jump of 128 or more read as a packet from the past. That was merely a missing gap
// while stale packets were still forwarded; now that a refusal drops the move, the wrong width
// would silently delete real moves after a reconnect that missed a long burst.
describe('the counter wraps at the width the decoder delivers', () => {
  it('0xFFFE → 0xFFFF → 0x0000 → 0x0001 is four moves and no gap', () => {
    const { moves, gaps } = feed([0xfffe, 0xffff, 0x0000, 0x0001]);
    expect(moves).toEqual([0xfffe, 0xffff, 0x0000, 0x0001]);
    expect(gaps).toEqual([]);
  });

  it('a 190-move jump is a real move with a real gap, not a packet from the past', () => {
    const { moves, gaps, refused } = feed([10, 200]);
    expect(moves).toEqual([10, 200]);
    expect(gaps).toEqual([{ missing: 189, from: 10, to: 200 }]);
    expect(refused).toEqual([]);
  });

  it('a serial from behind the wrap is still refused', () => {
    const { moves, refused } = feed([0xffff, 0x0000, 0xffff]);
    expect(moves).toEqual([0xffff, 0x0000]);
    expect(refused).toEqual([{ serial: 0xffff, reason: 'behind' }]);
  });
});

// The refusal rule DROPS packets, so it is measured against every committed capture before it is
// believed: four recordings from the physical GAN16 ui, replayed whole. Not one real move may be
// refused. Everything above feeds forged serials, which is the input least likely to catch a
// boundary set at the wrong width — this is the input that would.
describe('no move the cube actually sent is refused', () => {
  const CAPTURES = [
    { file: 'gan16-idle.raw.json', moves: 0 },
    { file: 'gan16-partial-turn-hold.raw.json', moves: 2 },
    { file: 'gan16-smoke-twist.raw.json', moves: 15 },
    { file: 'gan16-whole-rotation.raw.json', moves: 0 },
  ] as const;
  const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

  it.each(CAPTURES)('$file delivers all $moves of its moves, with nothing refused', (capture) => {
    const { mac, packets } = JSON.parse(readFileSync(join(fixtures, capture.file), 'utf8')) as {
      mac: string;
      packets: { enc: string }[];
    };
    const sim = simulateTransport();
    const cube = new GanCube({ mac, transport: sim.transport });
    const delivered: number[] = [];
    const refused: unknown[] = [];
    const gaps: unknown[] = [];
    cube.connect();
    cube.onMove((m) => delivered.push(m.serial));
    cube.on('stale', (s) => refused.push(s));
    cube.on('gap', (g) => gaps.push(g));
    for (const p of packets) sim.sub.emit('packet', p.enc, 0);

    expect(refused).toEqual([]);
    expect(gaps).toEqual([]);
    expect(delivered).toHaveLength(capture.moves);
    // Consecutive, which is what makes "nothing was refused" mean "nothing was missing" too.
    for (let i = 1; i < delivered.length; i++) {
      expect(delivered[i]! - delivered[i - 1]!).toBe(1);
    }
  });
});
