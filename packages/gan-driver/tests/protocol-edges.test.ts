// The protocol layer's guards and boundaries, exercised directly.
//
// The captures in cross-implementation.test.ts prove the decoder against 1,242 real packets, and
// real packets never take these branches: a salt that is not six bytes, a message shorter than one
// AES block, a MOVE_HISTORY event (the cubes on hand never emitted one), a facelet string of the
// wrong length, a read past the end of a frame. Each is a guard that exists to fail loud or to
// tolerate a malformed frame, and a guard nobody has ever tripped is a claim with no test. Added
// 2026-09-05 when the coverage gate started running (vitest 5 counts every branch, and found
// eighteen of them untouched).

import { describe, expect, it } from 'vitest';

import { deriveKeyIv, GanGen4Cipher, macToSalt } from '../src/gen4/crypto.js';
import { decodeGen4, GEN4_EVENT } from '../src/gen4/decode.js';
import { isValidFaceletCounts, SOLVED_FACELETS } from '../src/gen4/facelets.js';
import { MessageView } from '../src/gen4/message-view.js';

const MAC = '54:6C:50:89:C8:D3';

describe('deriveKeyIv', () => {
  it('refuses a salt that is not six bytes — a wrong-length salt would derive a wrong key silently', () => {
    expect(() => deriveKeyIv(new Uint8Array(5))).toThrow('salt must be 6 bytes');
    expect(() => deriveKeyIv(new Uint8Array(7))).toThrow('salt must be 6 bytes');
    expect(() => deriveKeyIv(macToSalt(MAC))).not.toThrow();
  });
});

describe('GanGen4Cipher', () => {
  const cipher = new GanGen4Cipher(MAC);

  it('refuses a message shorter than one AES block, in both directions', () => {
    expect(() => cipher.decrypt(new Uint8Array(15))).toThrow('at least 16 bytes');
    expect(() => cipher.encrypt(new Uint8Array(15))).toThrow('at least 16 bytes');
    expect(() => cipher.decrypt(new Uint8Array(0))).toThrow('at least 16 bytes');
  });

  it('round-trips an exactly-16-byte message through the single start chunk', () => {
    const plain = Uint8Array.from({ length: 16 }, (_, i) => (i * 37) & 0xff);
    const enc = cipher.encrypt(plain);
    expect(enc).not.toEqual(plain);
    expect(cipher.decrypt(enc)).toEqual(plain);
  });

  it('round-trips a longer message whose start and end chunks overlap', () => {
    // 20 bytes: the end chunk covers bytes 4..19, so bytes 4..15 are transformed twice on the
    // way in (start, then end) and undone in the reverse order on the way out (end, then start).
    const plain = Uint8Array.from({ length: 20 }, (_, i) => (i * 53 + 7) & 0xff);
    const enc = cipher.encrypt(plain);
    expect(enc).not.toEqual(plain);
    expect(cipher.decrypt(enc)).toEqual(plain);
    // The input is never mutated: the cipher works on a copy.
    expect(plain[0]).toBe(7);
  });
});

describe('decodeGen4 MOVE_HISTORY', () => {
  // Layout: byte 0 event, byte 1 data length (count = (length - 1) * 2 moves), byte 2 start
  // serial, then one nibble per move: 3 bits of face code (history's own encoding) + 1 bit of
  // direction, MSB-first. Face codes: 1=U 5=R 3=F 0=D 4=L 2=B; 6 and 7 encode nothing.
  const history = (startSerial: number, nibbles: number[], dataLength: number): Uint8Array => {
    const bytes = new Uint8Array(20);
    bytes[0] = GEN4_EVENT.MOVE_HISTORY;
    bytes[1] = dataLength;
    bytes[2] = startSerial;
    nibbles.forEach((n, i) => {
      const at = 3 + (i >> 1);
      bytes[at] = (bytes[at] ?? 0) | (i % 2 === 0 ? n << 4 : n);
    });
    return bytes;
  };

  it('decodes each nibble as a face and a direction, keeping the slot of a code it cannot name', () => {
    // U cw (1,0) · R ccw (5,1) · code 7 (unnamed) · D ccw (0,1)
    const nibbles = [(1 << 1) | 0, (5 << 1) | 1, (7 << 1) | 0, (0 << 1) | 1];
    const out = decodeGen4(history(42, nibbles, 3), 0);
    expect(out.type).toBe('MOVE_HISTORY');
    if (out.type !== 'MOVE_HISTORY') return;
    expect(out.startSerial).toBe(42);
    // The unnamed code is dropped, but the moves after it keep their original offsets, so a
    // consumer replaying history can still tell that a slot went missing.
    expect(out.moves).toEqual([
      { face: 'U', direction: 'cw', offset: 0 },
      { face: 'R', direction: 'ccw', offset: 1 },
      { face: 'D', direction: 'ccw', offset: 3 },
    ]);
  });

  it('a history with data length 1 carries no moves', () => {
    const out = decodeGen4(history(7, [], 1), 0);
    expect(out).toEqual({ type: 'MOVE_HISTORY', startSerial: 7, moves: [] });
  });
});

describe('isValidFaceletCounts', () => {
  it('refuses any length but 54 before counting anything', () => {
    expect(isValidFaceletCounts('U'.repeat(53))).toBe(false);
    expect(isValidFaceletCounts(`${SOLVED_FACELETS}U`)).toBe(false);
    expect(isValidFaceletCounts('')).toBe(false);
  });

  it('accepts nine of each colour and refuses a swapped count at the right length', () => {
    expect(isValidFaceletCounts(SOLVED_FACELETS)).toBe(true);
    expect(isValidFaceletCounts(`U${SOLVED_FACELETS.slice(1)}`)).toBe(true);
    expect(isValidFaceletCounts(`R${SOLVED_FACELETS.slice(1)}`)).toBe(false); // 8 U, 10 R
  });
});

describe('MessageView', () => {
  it('reports its length, reads bytes, and treats reads past the end as zero', () => {
    const view = new MessageView(Uint8Array.from([0xab, 0xcd]));
    expect(view.length).toBe(2);
    expect(view.byte(1)).toBe(0xcd);
    expect(view.byte(2)).toBe(0);
    expect(view.getBitWord(12, 8)).toBe(0xd0); // low nibble of 0xcd then four zero bits
    expect(view.getBitWord(64, 8)).toBe(0);
  });

  it('assembles multi-byte words in either byte order', () => {
    const view = new MessageView(Uint8Array.from([0x12, 0x34, 0x56]));
    expect(view.getBitWord(0, 16)).toBe(0x1234);
    expect(view.getBitWord(0, 16, true)).toBe(0x3412);
    expect(view.getBitWord(0, 24, true)).toBe(0x563412);
    // A length that is not a multiple of eight is read as WHOLE bytes (two 8-bit reads here,
    // not 12 bits): the protocol only ever asks for 8, 16 or 32, and a caller asking for 12
    // would get 16. Pinned so the quirk is a documented fact rather than a surprise.
    expect(view.getBitWord(4, 12)).toBe(0x2345);
  });
});
