// Behavioural fixtures for the controlled experiments, plus robustness cases.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GanGen4Cipher } from '../src/gen4/crypto.js';
import { decodeGen4 } from '../src/gen4/decode.js';

const here = dirname(fileURLToPath(import.meta.url));
function load(name: string) {
  const fx = JSON.parse(readFileSync(join(here, 'fixtures', `${name}.raw.json`), 'utf8')) as {
    mac: string;
    packets: { enc: string }[];
  };
  const cipher = new GanGen4Cipher(fx.mac);
  return fx.packets.map((p) => decodeGen4(cipher.decrypt(Buffer.from(p.enc, 'hex')), 0));
}

describe('Experiment A — idle', () => {
  const ev = load('gan16-idle');
  it('emits GYRO and periodic FACELETS but no MOVE at rest', () => {
    const types = ev.map((e) => e.type);
    expect(types).toContain('GYRO');
    expect(types).toContain('FACELETS');
    expect(types).not.toContain('MOVE');
  });
});

describe('Experiment G — whole-cube rotation', () => {
  const ev = load('gan16-whole-rotation');
  it('produces GYRO but no MOVE (orientation != face turn)', () => {
    expect(ev.some((e) => e.type === 'GYRO')).toBe(true);
    expect(ev.some((e) => e.type === 'MOVE')).toBe(false);
  });
  it('FACELETS serial stays constant (no state change without a face turn)', () => {
    const serials = new Set(
      ev
        .filter((e): e is Extract<typeof e, { type: 'FACELETS' }> => e.type === 'FACELETS')
        .map((e) => e.serial),
    );
    expect(serials.size).toBe(1);
  });
});

describe('robustness — malformed / unknown packets', () => {
  const cipher = new GanGen4Cipher('54:6C:50:89:C8:D3');
  it('an unknown event type is surfaced as UNKNOWN, never dropped', () => {
    // Craft a plaintext with an event type the decoder does not map (0x03).
    const plain = new Uint8Array(20);
    plain[0] = 0x03;
    const e = decodeGen4(plain, 0);
    expect(e.type).toBe('UNKNOWN');
    if (e.type === 'UNKNOWN') expect(e.eventType).toBe(0x03);
  });
  it('decrypt rejects a too-short message loudly', () => {
    expect(() => cipher.decrypt(new Uint8Array(8))).toThrow();
  });
});
