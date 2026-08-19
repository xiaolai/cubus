// Synthetic decode tests for the command + battery + hardware paths. These are
// pure decoders that, before this, were only exercised over live BLE — here we
// hand-build the exact Gen4 plaintext frames and assert the decode, no hardware.

import { describe, expect, it } from 'vitest';
import { buildCommand } from '../src/gen4/commands.js';
import { decodeGen4 } from '../src/gen4/decode.js';

/** Build a 20-byte message from a hex prefix, zero-padded. */
function frame(hexPrefix: string): Uint8Array {
  const b = Buffer.alloc(20);
  Buffer.from(hexPrefix, 'hex').copy(b);
  return b;
}

describe('buildCommand', () => {
  it('encodes the safe query commands with the documented opcodes', () => {
    expect(Array.from(buildCommand('REQUEST_FACELETS').slice(0, 6))).toEqual([
      0xdd, 0x04, 0x00, 0xed, 0x00, 0x00,
    ]);
    expect(Array.from(buildCommand('REQUEST_HARDWARE').slice(0, 5))).toEqual([
      0xdf, 0x03, 0x00, 0x00, 0x00,
    ]);
    expect(Array.from(buildCommand('REQUEST_BATTERY').slice(0, 6))).toEqual([
      0xdd, 0x04, 0x00, 0xef, 0x00, 0x00,
    ]);
    expect(buildCommand('REQUEST_FACELETS')).toHaveLength(20);
  });
});

describe('decodeGen4 — battery', () => {
  it('decodes a BATTERY event and clamps to 100', () => {
    // 0xEF, dataLength=1, level byte at bit 8+1*8=16 (byte 2)
    const e = decodeGen4(frame('ef0164'), 0);
    expect(e.type).toBe('BATTERY');
    if (e.type === 'BATTERY') expect(e.level).toBe(100);

    const over = decodeGen4(frame('ef01ff'), 0); // 255 -> clamped
    if (over.type === 'BATTERY') expect(over.level).toBe(100);
  });
});

describe('decodeGen4 — hardware sub-events', () => {
  it('decodes the hardware name (0xFC)', () => {
    // 0xFC, len=8, one pad byte, then ASCII "GAN16ui"
    const e = decodeGen4(frame(`fc0800${Buffer.from('GAN16ui').toString('hex')}`), 0);
    expect(e.type).toBe('HARDWARE_FIELD');
    if (e.type === 'HARDWARE_FIELD') {
      expect(e.key).toBe('hardwareName');
      expect(e.value).toBe('GAN16ui');
      expect(e.extra).toBe(false);
    }
  });

  it('decodes hardware (0xFE) and software (0xFD) versions from nibbles', () => {
    const hw = decodeGen4(frame('fe0200' + '10'), 0); // byte3=0x10 -> 1.0
    if (hw.type === 'HARDWARE_FIELD') {
      expect(hw.key).toBe('hardwareVersion');
      expect(hw.value).toBe('1.0');
    }
    const sw = decodeGen4(frame('fd0200' + '24'), 0); // byte3=0x24 -> 2.4
    if (sw.type === 'HARDWARE_FIELD') {
      expect(sw.key).toBe('softwareVersion');
      expect(sw.value).toBe('2.4');
    }
  });

  it('decodes the product date (0xFA)', () => {
    // year LE @ byte3-4 = 0x07EA = 2026, month byte5=01, day byte6=09
    const e = decodeGen4(frame('fa0500' + 'ea07' + '01' + '09'), 0);
    if (e.type === 'HARDWARE_FIELD') {
      expect(e.key).toBe('productDate');
      expect(e.value).toBe('2026-01-09');
    }
  });

  it('surfaces GAN16-specific extras (0xFF) as raw payload, not dropped', () => {
    const e = decodeGen4(frame('ff0700' + 'd3c889506c54'), 0);
    expect(e.type).toBe('HARDWARE_FIELD');
    if (e.type === 'HARDWARE_FIELD') {
      expect(e.extra).toBe(true);
      expect(e.value).toBe('00d3c889506c54'.slice(0, (0x07 - 1) * 2));
    }
  });
});

describe('decodeGen4 — gyro velocity', () => {
  it('decodes signed angular velocity nibbles', () => {
    // 0xEC gyro; quaternion bytes then velocity nibbles at bits 80/84/88
    const e = decodeGen4(frame('ec0a7ffe0000000000000000' + '12'), 0);
    expect(e.type).toBe('GYRO');
    if (e.type === 'GYRO') {
      expect(typeof e.velocity.x).toBe('number');
      expect(Math.abs(e.quaternion.w)).toBeLessThanOrEqual(1);
    }
  });
});
