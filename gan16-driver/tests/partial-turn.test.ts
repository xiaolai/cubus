// Experiment H regression: GAN16 exposes NO partial-turn angular data over BLE.
// Locks in the two proofs from the hold-test capture.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { GanGen4Cipher } from '../src/gen4/crypto.js';
import { decodeGen4 } from '../src/gen4/decode.js';

const here = dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(
  readFileSync(join(here, 'fixtures/gan16-partial-turn-hold.raw.json'), 'utf8'),
) as { mac: string; packets: { enc: string }[] };
const cipher = new GanGen4Cipher(fx.mac);
const decrypted = fx.packets.map((p) => Buffer.from(cipher.decrypt(Buffer.from(p.enc, 'hex'))));

describe('Experiment H — no partial-turn angular data', () => {
  it('only MOVE / GYRO / FACELETS event types appear (no hidden angle event)', () => {
    const evts = new Set(decrypted.map((d) => d[0]));
    for (const e of evts) {
      expect([0x01, 0xec, 0xed]).toContain(e); // no 0xF*, no unknown types
    }
  });

  it('GYRO bytes 18-19 are a deterministic checksum of bytes 0-17 (not angle data)', () => {
    const map = new Map<string, Set<string>>();
    for (const d of decrypted) {
      if (d[0] !== 0xec) continue;
      const head = d.subarray(0, 18).toString('hex');
      const tail = d.subarray(18, 20).toString('hex');
      if (!map.has(head)) map.set(head, new Set());
      map.get(head)!.add(tail);
    }
    // If bytes 18-19 were an independent field (counter/angle), some identical
    // payloads would carry different trailers. A checksum never does.
    const collisions = [...map.values()].filter((s) => s.size > 1).length;
    expect(map.size).toBeGreaterThan(50); // enough distinct payloads to be meaningful
    expect(collisions).toBe(0);
  });

  it('decoded stream carries GYRO and FACELETS during the frozen holds', () => {
    const types = new Set(decrypted.map((d) => decodeGen4(d, 0).type));
    expect(types.has('GYRO')).toBe(true);
    expect(types.has('FACELETS')).toBe(true);
  });
});
