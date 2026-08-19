// Fixture-based tests. Runs with no hardware: decrypts real captured GAN16 ui
// packets and asserts the decoder produces valid Gen4 events.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GanGen4Cipher } from '../src/gen4/crypto.js';
import { decodeGen4 } from '../src/gen4/decode.js';
import { isValidFaceletCounts } from '../src/gen4/facelets.js';
import type { CubeEvent } from '../src/gen4/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(here, 'fixtures/gan16-smoke-twist.raw.json'), 'utf8'),
) as { mac: string; packets: { ts: string; enc: string }[] };

const cipher = new GanGen4Cipher(fixture.mac);
const decoded = fixture.packets.map((p) =>
  decodeGen4(cipher.decrypt(Buffer.from(p.enc, 'hex')), Date.parse(p.ts)),
);

describe('GAN16 ui = GAN Gen4 (fixture regression)', () => {
  it('decrypts every packet into a known event type (nothing dropped)', () => {
    const types = new Set(decoded.map((e) => e.type));
    // Only the Gen4 event set appears; no UNKNOWN leaked through.
    expect([...types].sort()).toEqual(['FACELETS', 'GYRO', 'MOVE']);
  });

  it('produces MOVE events with monotonic serials and valid notation', () => {
    const moves = decoded.filter(
      (e): e is Extract<CubeEvent, { type: 'MOVE' }> => e.type === 'MOVE',
    );
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves) {
      expect('URFDLB').toContain(m.face);
      expect(m.notation.replace("'", '')).toBe(m.face);
      expect(m.serial).toBeGreaterThanOrEqual(0);
      expect(m.serial).toBeLessThanOrEqual(0xffff);
    }
    // Serials increase by 1 per move (mod 256 on the low byte).
    for (let i = 1; i < moves.length; i++) {
      expect((moves[i]!.serial - moves[i - 1]!.serial) & 0xff).toBe(1);
    }
  });

  it('decodes FACELETS to a structurally valid cube (9 of each colour)', () => {
    const fl = decoded.filter(
      (e): e is Extract<CubeEvent, { type: 'FACELETS' }> => e.type === 'FACELETS',
    );
    expect(fl.length).toBeGreaterThan(0);
    for (const f of fl) {
      expect(f.facelets).toHaveLength(54);
      expect(isValidFaceletCounts(f.facelets)).toBe(true);
      expect([...f.state.CP].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
      expect([...f.state.EP].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    }
  });

  it('decodes GYRO to unit quaternions (|q| ~= 1)', () => {
    const g = decoded.filter((e): e is Extract<CubeEvent, { type: 'GYRO' }> => e.type === 'GYRO');
    expect(g.length).toBeGreaterThan(0);
    for (const ev of g) {
      const { w, x, y, z } = ev.quaternion;
      const mag = Math.sqrt(w * w + x * x + y * y + z * z);
      expect(mag).toBeGreaterThan(0.98);
      expect(mag).toBeLessThan(1.02);
    }
  });
});

describe('crypto round-trip', () => {
  it('encrypt(decrypt(x)) == x for a real packet', () => {
    const enc = Buffer.from(fixture.packets[0]!.enc, 'hex');
    const plain = cipher.decrypt(enc);
    const reenc = cipher.encrypt(plain);
    expect(Buffer.from(reenc).toString('hex')).toBe(fixture.packets[0]!.enc);
  });
});
