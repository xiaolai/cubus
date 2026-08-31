// Two independent Gen4 decoders, one set of real packets, and the assertion that they agree.
//
// This is the evidence the decision to LINK smartcube-web-bluetooth rests on
// (dev-docs/universal-cube-driver.md §1). It runs in both directions and that is the point:
// their decoder is checked against captures from hardware they have never seen, and ours is
// checked by a codebase that never saw our cube. Neither is the oracle; agreement is the claim.
//
// It is also what makes retiring gan-driver's Gen4 path safe (§8 Phase 5) — the moment these two
// stop agreeing, the swap has changed behaviour, and this goes red before anyone ships it.
//
// Reaching their decoder: `GanGen4ProtocolDriver` is not a public export and the package declares
// no `exports` subpath map, so it is reached through the `smartcube-internal/*` specifier, which
// tsconfig.json maps to the shipped declarations and vitest.config.ts maps to the real source.
// Upstream's own replay tests reach it the same way. Deliberate and load-bearing — see §2.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as def from 'smartcube-internal/gan-cube-definitions';
import { GanGen4CubeEncrypter } from 'smartcube-internal/gan-cube-encrypter';
import { GanGen4ProtocolDriver } from 'smartcube-internal/gan-cube-protocol';
import { isValidGanGen4Packet } from 'smartcube-internal/gan-gen234-packet-validate';
import { macStringToSaltOrThrow } from 'smartcube-internal/gan-mac-salt';
import { describe, expect, it } from 'vitest';
import { GanGen4Cipher } from '../src/gen4/crypto.js';
import { decodeGen4 } from '../src/gen4/decode.js';

const here = dirname(fileURLToPath(import.meta.url));

interface Capture {
  mac: string;
  packets: { ts: string; enc: string }[];
}

/** What both implementations must produce, reduced to the facts that carry meaning. */
interface Decoded {
  types: Record<string, number>;
  moves: string[];
  facelets: string[];
  /** Packets neither decoded nor explained. Must be zero on a real capture. */
  rejected: number;
  /** Exceptions escaping the decoder. Must be zero: a throw here reaches a notification handler. */
  threw: number;
}

/** Every committed GAN16 ui capture, with the counts the plan records for each.
 *  The packet counts are pinned so a fixture edited or truncated by accident is caught here
 *  rather than silently shrinking the evidence both sides are measured against. */
const CAPTURES = [
  { file: 'gan16-idle.raw.json', packets: 117, moves: 0, facelets: 10 },
  { file: 'gan16-partial-turn-hold.raw.json', packets: 352, moves: 2, facelets: 30 },
  { file: 'gan16-smoke-twist.raw.json', packets: 365, moves: 15, facelets: 30 },
  { file: 'gan16-whole-rotation.raw.json', packets: 408, moves: 0, facelets: 35 },
] as const;

function load(file: string): Capture {
  return JSON.parse(readFileSync(join(here, 'fixtures', file), 'utf8')) as Capture;
}

function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from((hex.match(/../g) ?? []).map((h) => Number.parseInt(h, 16)));
}

/** gan-driver: one event per packet, decrypted with the MAC-salted Gen4 cipher. */
function decodeWithOurs(cap: Capture): Decoded {
  const cipher = new GanGen4Cipher(cap.mac);
  const out: Decoded = { types: {}, moves: [], facelets: [], rejected: 0, threw: 0 };
  for (const p of cap.packets) {
    try {
      const e = decodeGen4(cipher.decrypt(hexToBytes(p.enc)), Date.parse(p.ts));
      out.types[e.type] = (out.types[e.type] ?? 0) + 1;
      if (e.type === 'MOVE') out.moves.push(e.notation);
      if (e.type === 'FACELETS') out.facelets.push(e.facelets);
      if (e.type === 'UNKNOWN') out.rejected++;
    } catch {
      out.threw++;
    }
  }
  return out;
}

/** smartcube-web-bluetooth: validate, then a stateful driver that may emit 0..n events per packet.
 *  `conn` is the two-method stub their own replay tests use — nothing is written back. */
async function decodeWithTheirs(cap: Capture): Promise<Decoded> {
  const salt = macStringToSaltOrThrow(cap.mac);
  const key = def.GAN_ENCRYPTION_KEYS[0];
  if (!key) throw new Error('smartcube-web-bluetooth exposes no GAN encryption keys');
  const enc = new GanGen4CubeEncrypter(new Uint8Array(key.key), new Uint8Array(key.iv), salt);
  const driver = new GanGen4ProtocolDriver();
  const conn = { sendCommandMessage: async () => {}, disconnect: async () => {} };
  const out: Decoded = { types: {}, moves: [], facelets: [], rejected: 0, threw: 0 };
  for (const p of cap.packets) {
    let plain: Uint8Array;
    try {
      plain = enc.decrypt(hexToBytes(p.enc));
    } catch {
      out.threw++;
      continue;
    }
    if (!isValidGanGen4Packet(plain)) {
      out.rejected++;
      continue;
    }
    try {
      const evs = (await driver.handleStateEvent(conn as never, plain)) as {
        type: string;
        move?: string;
        facelets?: string;
      }[];
      for (const e of evs) {
        out.types[e.type] = (out.types[e.type] ?? 0) + 1;
        if (e.type === 'MOVE' && e.move) out.moves.push(e.move);
        if (e.type === 'FACELETS' && e.facelets) out.facelets.push(e.facelets);
      }
    } catch {
      out.threw++;
    }
  }
  return out;
}

describe.each(CAPTURES)('$file', ({ file, packets, moves, facelets }) => {
  const cap = load(file);
  const ours = decodeWithOurs(cap);

  it('is the capture this test was written against', () => {
    expect(cap.packets.length).toBe(packets);
  });

  it('decodes identically in both implementations', async () => {
    const theirs = await decodeWithTheirs(cap);

    // Same events, same order, same content. Move NOTATION rather than face+direction, because
    // notation is what a screen shows and what a walk is built from.
    expect(theirs.moves).toEqual(ours.moves);
    expect(theirs.facelets).toEqual(ours.facelets);
    expect(theirs.types).toEqual(ours.types);

    // And the pinned shape, so agreement on nothing cannot pass as agreement.
    expect(ours.moves.length).toBe(moves);
    expect(ours.facelets.length).toBe(facelets);
  });

  it('leaves no packet unexplained and throws on none', async () => {
    // The negative half, and the half that matters most. A decoder that silently drops what it
    // cannot read agrees with anything; a decoder that throws takes the notification handler with
    // it (§4, "never let one bad packet kill the stream"). Both must be zero on a real capture.
    const theirs = await decodeWithTheirs(cap);
    expect(ours.rejected).toBe(0);
    expect(ours.threw).toBe(0);
    expect(theirs.rejected).toBe(0);
    expect(theirs.threw).toBe(0);
  });
});

describe('the corpus as a whole', () => {
  it('is large enough to mean something', () => {
    // 1,242 packets across four captures. Pinned because "both implementations agree" is only
    // evidence in proportion to how much they agreed about.
    const total = CAPTURES.reduce((n, c) => n + c.packets, 0);
    expect(total).toBe(1242);
    expect(CAPTURES.length).toBe(4);
  });

  it('covers the three event kinds a cube reports, and at least one real turn', () => {
    const seen = new Set<string>();
    let moves = 0;
    for (const { file } of CAPTURES) {
      const d = decodeWithOurs(load(file));
      for (const t of Object.keys(d.types)) seen.add(t);
      moves += d.moves.length;
    }
    expect([...seen].sort()).toEqual(['FACELETS', 'GYRO', 'MOVE']);
    expect(moves).toBeGreaterThan(0);
  });
});
