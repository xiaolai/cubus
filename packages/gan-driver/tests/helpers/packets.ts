// Real GAN16 ui packets, re-cut for the driver tests.
//
// Every frame here starts as one the cube actually sent (tests/fixtures/gan16-smoke-twist.raw.json)
// and is decrypted, edited at one documented field, and re-encrypted with the capture's own MAC.
// So a driver test still runs the whole decrypt -> decode path the hardware runs, instead of
// hand-feeding decoded objects past the two layers most likely to disagree.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GanGen4Cipher } from '../../src/gen4/crypto.js';
import { decodeGen4 } from '../../src/gen4/decode.js';
import { bytesToHex, hexToBytes } from '../../src/hex.js';

const here = dirname(fileURLToPath(import.meta.url));
const capture = JSON.parse(
  readFileSync(join(here, '..', 'fixtures', 'gan16-smoke-twist.raw.json'), 'utf8'),
) as { mac: string; packets: { enc: string }[] };

/** The capture's own MAC — the driver under test must be constructed with it, or nothing decrypts. */
export const CAPTURE_MAC = capture.mac;

const cipher = new GanGen4Cipher(CAPTURE_MAC);

/** The first captured packet of a given decoded type, decrypted. */
function template(type: string): Uint8Array {
  for (const p of capture.packets) {
    const decrypted = cipher.decrypt(hexToBytes(p.enc));
    if (decodeGen4(decrypted, 0).type === type) return decrypted;
  }
  throw new Error(`no ${type} packet in the capture — the fixture has changed shape`);
}

const MOVE_TEMPLATE = template('MOVE');
const FACELETS_TEMPLATE = template('FACELETS');

/** A real MOVE frame carrying the serial asked for (16-bit field @bit48, little-endian). */
export function movePacket(serial: number): string {
  const bytes = Uint8Array.from(MOVE_TEMPLATE);
  bytes[6] = serial & 0xff;
  bytes[7] = (serial >>> 8) & 0xff;
  return bytesToHex(cipher.encrypt(bytes));
}

/** A real FACELETS frame — what the cube emits ~1 Hz, and answers a state query with. */
export function faceletsPacket(): string {
  return bytesToHex(cipher.encrypt(FACELETS_TEMPLATE));
}

/** A frame whose event type the decoder recognises as nothing: it must surface, not vanish. */
export function unknownPacket(): string {
  const bytes = Uint8Array.from(MOVE_TEMPLATE);
  bytes[0] = 0x02; // no Gen4 event uses 0x02
  return bytesToHex(cipher.encrypt(bytes));
}
