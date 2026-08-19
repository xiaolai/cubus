// Bit-field reader over a decrypted Gen4 message.
//
// GAN Gen4 packs fields at arbitrary bit offsets, MSB-first within each byte.
// getBitWord(start, length) reads `length` bits starting at absolute bit `start`.
// With littleEndian=true and length>8, the value is assembled from little-endian
// byte order (used for multi-byte timestamps and serials).
//
// Equivalent to GanProtocolMessageView in afedotov/gan-web-bluetooth (MIT).

export class MessageView {
  constructor(private readonly bytes: Uint8Array) {}

  get length(): number {
    return this.bytes.length;
  }

  byte(i: number): number {
    return this.bytes[i] ?? 0; // reads past the end are tolerated as 0
  }

  getBitWord(startBit: number, bitLength: number, littleEndian = false): number {
    if (bitLength <= 8) {
      let result = 0;
      for (let i = 0; i < bitLength; i++) {
        const bit = startBit + i;
        const byteIdx = bit >>> 3;
        const bitOff = 7 - (bit & 7);
        // Out-of-range reads count as 0 — a tolerant parser over fixed frames.
        result = (result << 1) | (((this.bytes[byteIdx] ?? 0) >>> bitOff) & 1);
      }
      return result >>> 0;
    }
    // Multi-byte: split into 8-bit reads and reassemble.
    const nBytes = Math.ceil(bitLength / 8);
    const parts: number[] = [];
    for (let i = 0; i < nBytes; i++) parts.push(this.getBitWord(startBit + 8 * i, 8));
    let result = 0;
    if (littleEndian) {
      for (let i = 0; i < nBytes; i++) result |= (parts[i] ?? 0) << (8 * i);
    } else {
      for (let i = 0; i < nBytes; i++) result = (result << 8) | (parts[i] ?? 0);
    }
    return result >>> 0;
  }
}
