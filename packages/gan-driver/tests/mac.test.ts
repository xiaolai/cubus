// Regression tests for MAC recovery, incl. the malformed-hex guard (audit #8).

import { describe, expect, it } from 'vitest';
import { macToSalt } from '../src/gen4/crypto.js';
import { extractMacFromManufacturerData, macMatchesName, sightCube } from '../src/mac.js';

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

// 2026-09-17: a GAN Robot on the desk made the cube beside it undiscoverable. Its advertisement is
// the real one, read off the scan that failed. Every case here is about a scan that must NOT stop
// at the first GAN-named thing it sees.
const CUBE = {
  name: 'GAN16ui_C8D3',
  manufacturerData: '0100000000d3c889506c5464636f6e00ffffffffffff',
};
const ROBOT = { name: 'GANBOT-2600D0', manufacturerData: '47414e524f32' }; // ASCII "GANRO2"

describe('sightCube', () => {
  it('finds the cube behind a GAN device that carries no recoverable MAC', () => {
    const { cube, passedOver } = sightCube([ROBOT, CUBE]);
    expect(cube?.name).toBe('GAN16ui_C8D3');
    expect(cube?.mac).toBe('54:6C:50:89:C8:D3');
    expect(cube?.macOk).toBe(true);
    // Passing over the robot is reported even on success: it is why the scan took an extra look.
    expect(passedOver).toEqual([
      { name: 'GANBOT-2600D0', why: 'no MAC in manufacturer data 47414e524f32' },
    ]);
  });

  it('carries the cube through with every other field of the advertisement intact', () => {
    const { cube } = sightCube([{ ...CUBE, id: 'ABC-123', rssi: -54 }]);
    expect(cube).toMatchObject({ id: 'ABC-123', rssi: -54, mac: '54:6C:50:89:C8:D3' });
  });

  it('says WHICH GAN devices it passed over, so an empty room reads differently from a wrong one', () => {
    const empty = sightCube([]);
    expect(empty.cube).toBeNull();
    expect(empty.passedOver).toEqual([]);

    const onlyRobot = sightCube([ROBOT, { name: 'GAN-something' }]);
    expect(onlyRobot.cube).toBeNull();
    expect(onlyRobot.passedOver).toEqual([
      { name: 'GANBOT-2600D0', why: 'no MAC in manufacturer data 47414e524f32' },
      { name: 'GAN-something', why: 'no manufacturer data' },
    ]);
  });

  it('ignores advertisers that never claimed to be GAN at all', () => {
    const { cube, passedOver } = sightCube([{ name: 'AirPods', manufacturerData: '4c0012' }, CUBE]);
    expect(cube?.name).toBe('GAN16ui_C8D3');
    expect(passedOver).toEqual([]); // not a candidate, so not evidence about a failed scan
  });

  it('reports a MAC that does not match the name suffix rather than refusing it', () => {
    // macOk is a sanity check the caller prints, not a filter: a renamed cube is still a cube, and
    // refusing it here would trade a warning for an undiscoverable device.
    const { cube } = sightCube([{ ...CUBE, name: 'GAN16ui_AAAA' }]);
    expect(cube?.mac).toBe('54:6C:50:89:C8:D3');
    expect(cube?.macOk).toBe(false);
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
