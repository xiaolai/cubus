// Regression tests for MAC recovery, incl. the malformed-hex guard (audit #8).

import { describe, expect, it } from 'vitest';
import { macToSalt } from '../src/gen4/crypto.js';
import { extractMacFromManufacturerData, macMatchesName } from '../src/mac.js';

describe('extractMacFromManufacturerData', () => {
  it('recovers the MAC from a real GAN16 advertisement', () => {
    // company id 0x0001, MAC bytes reversed at payload offset 3..8
    const mfg = '0100000000d3c889506c5464636f6e00ffffffffffff';
    expect(extractMacFromManufacturerData(mfg)).toBe('54:6C:50:89:C8:D3');
  });

  it('returns null for a non-GAN company id', () => {
    expect(extractMacFromManufacturerData(`4c00${'00'.repeat(10)}`)).toBeNull();
  });

  it('rejects malformed hex instead of silently truncating', () => {
    expect(extractMacFromManufacturerData('0100xyz')).toBeNull(); // non-hex
    expect(extractMacFromManufacturerData('010')).toBeNull(); // odd length
  });

  it('returns null when the payload is too short', () => {
    expect(extractMacFromManufacturerData('0100')).toBeNull();
  });
});

describe('macMatchesName', () => {
  it('accepts a MAC whose tail matches the name suffix', () => {
    expect(macMatchesName('54:6C:50:89:C8:D3', 'GAN16ui_C8D3')).toBe(true);
  });
  it('rejects a mismatched suffix', () => {
    expect(macMatchesName('54:6C:50:89:C8:D3', 'GAN16ui_AAAA')).toBe(false);
  });
  it('passes through when the name has no checkable suffix', () => {
    expect(macMatchesName('54:6C:50:89:C8:D3', 'GAN16ui')).toBe(true);
  });
});

// audit-fix #6: a permissive parseInt read "5G" as 0x05, deriving a wrong key and decoding valid
// packets as garbage instead of rejecting the MAC. macToSalt must fail loud on any bad octet.
describe('macToSalt', () => {
  it('reverses a valid MAC into salt bytes', () => {
    expect(Array.from(macToSalt('54:6C:50:89:C8:D3'))).toEqual([
      0xd3, 0xc8, 0x89, 0x50, 0x6c, 0x54,
    ]);
  });
  it('rejects a non-hex octet instead of silently truncating it', () => {
    expect(() => macToSalt('5G:6C:50:89:C8:D3')).toThrow(/invalid MAC/);
  });
  it('rejects wrong octet count and mis-sized octets', () => {
    expect(() => macToSalt('54:6C:50:89:C8')).toThrow(/invalid MAC/); // 5 octets
    expect(() => macToSalt('54:6C:50:89:C8:123')).toThrow(/invalid MAC/); // 3 hex digits
    expect(() => macToSalt('5:6C:50:89:C8:D3')).toThrow(/invalid MAC/); // 1 hex digit
  });
});
