// GAN Gen4 message encryption.
//
// Protocol derived from afedotov/gan-web-bluetooth (MIT). Verified against a
// physical GAN16 ui on 2026-08-19: base key/iv below decrypt live FFF6 packets
// into valid Gen4 events (see captures/ and tests/fixtures/).
//
// Scheme: AES-128-CBC applied to two 16-byte chunks of each BLE message — the
// chunk at the start and the chunk aligned to the end (they overlap for the
// 20-byte messages GAN uses). Key and IV are per-device: the first 6 bytes are
// salted by adding the cube's MAC bytes (in reverse) modulo 0xFF.

import { createCipheriv, createDecipheriv } from 'node:crypto';

/** Base key/iv shared by GAN Gen2/Gen3/Gen4 cubes (afedotov/gan-web-bluetooth). */
export const GAN_GEN4_BASE_KEY = Uint8Array.from([
  0x01, 0x02, 0x42, 0x28, 0x31, 0x91, 0x16, 0x07, 0x20, 0x05, 0x18, 0x54, 0x42, 0x11, 0x12, 0x53,
]);
export const GAN_GEN4_BASE_IV = Uint8Array.from([
  0x11, 0x03, 0x32, 0x28, 0x21, 0x01, 0x76, 0x27, 0x20, 0x95, 0x78, 0x14, 0x32, 0x12, 0x02, 0x43,
]);

/**
 * Derive the device-specific key and IV from the 6-byte MAC salt.
 * @param salt MAC bytes in the order used for salting (reversed MAC — see macToSalt).
 */
export function deriveKeyIv(
  salt: Uint8Array,
  baseKey = GAN_GEN4_BASE_KEY,
  baseIv = GAN_GEN4_BASE_IV,
): { key: Buffer; iv: Buffer } {
  if (salt.length !== 6) throw new Error('salt must be 6 bytes');
  const key = Buffer.from(baseKey);
  const iv = Buffer.from(baseIv);
  for (let i = 0; i < 6; i++) {
    // i < 6 <= length of every operand (key/iv are 16, salt is checked 6 above).
    key[i] = (baseKey[i]! + salt[i]!) % 0xff;
    iv[i] = (baseIv[i]! + salt[i]!) % 0xff;
  }
  return { key, iv };
}

/** Convert a MAC string ("54:6C:50:89:C8:D3") to the reversed-byte salt. */
export function macToSalt(mac: string): Uint8Array {
  const bytes = mac.split(/[:\-\s]+/).map((h) => Number.parseInt(h, 16));
  if (bytes.length !== 6 || bytes.some((b) => Number.isNaN(b))) {
    throw new Error(`invalid MAC: ${mac}`);
  }
  return Uint8Array.from(bytes.reverse());
}

export class GanGen4Cipher {
  private readonly key: Buffer;
  private readonly iv: Buffer;

  constructor(mac: string) {
    ({ key: this.key, iv: this.iv } = deriveKeyIv(macToSalt(mac)));
  }

  /** Decrypt one 16-byte block (single CBC block, no padding). */
  private decChunk(buf: Buffer, offset: number): void {
    const d = createDecipheriv('aes-128-cbc', this.key, this.iv);
    d.setAutoPadding(false);
    const out = Buffer.concat([d.update(buf.subarray(offset, offset + 16)), d.final()]);
    out.copy(buf, offset);
  }

  private encChunk(buf: Buffer, offset: number): void {
    const c = createCipheriv('aes-128-cbc', this.key, this.iv);
    c.setAutoPadding(false);
    const out = Buffer.concat([c.update(buf.subarray(offset, offset + 16)), c.final()]);
    out.copy(buf, offset);
  }

  decrypt(data: Uint8Array): Uint8Array {
    if (data.length < 16) throw new Error('message must be at least 16 bytes');
    const res = Buffer.from(data);
    if (res.length > 16) this.decChunk(res, res.length - 16); // end chunk first
    this.decChunk(res, 0); // then start chunk
    return res;
  }

  encrypt(data: Uint8Array): Uint8Array {
    if (data.length < 16) throw new Error('message must be at least 16 bytes');
    const res = Buffer.from(data);
    this.encChunk(res, 0); // start chunk first
    if (res.length > 16) this.encChunk(res, res.length - 16); // then end chunk
    return res;
  }
}
