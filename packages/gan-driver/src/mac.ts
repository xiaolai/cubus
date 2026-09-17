// Recover a GAN cube's MAC address from BLE advertisement manufacturer data.
//
// macOS CoreBluetooth never exposes the peripheral MAC directly (it gives a
// random per-Mac UUID), but GAN cubes broadcast the MAC inside manufacturer
// specific data. The MAC is required to salt the AES key/IV, so this is the
// one piece of device-specific key material — recovered at runtime from the
// air, never hard-coded.
//
// Layout (verified on GAN16 ui, 2026-08-19): CoreBluetooth manufacturer data =
// [company-id LE (2 bytes)][payload]. Company id is 0xXX01 for GAN. Following
// afedotov/gan-web-bluetooth, the MAC is the 6 bytes at payload offset 3..8,
// read in reverse. Cross-check: it must end with the 2 bytes in the device
// name suffix (e.g. "GAN16ui_C8D3" -> ...:C8:D3).

import { hexToBytes } from './hex.js';

/** @param manufacturerHex full CoreBluetooth manufacturer data as hex. */
export function extractMacFromManufacturerData(manufacturerHex: string): string | null {
  // Reject malformed hex up front — Buffer.from(...,'hex') silently truncates
  // on odd length or non-hex chars, which would yield a plausible-but-wrong MAC.
  if (!/^[0-9a-fA-F]*$/.test(manufacturerHex) || manufacturerHex.length % 2 !== 0) return null;
  const bytes = hexToBytes(manufacturerHex);
  if (bytes.length < 11) return null;
  // company id little-endian; GAN uses 0xXX01, i.e. low byte 0x01
  if (bytes[0] !== 0x01) return null;
  // Strip the company id. No second length check: `bytes.length >= 11` above already puts at
  // least nine bytes here, and a guard that cannot fire is a branch no test can reach
  // (removed 2026-09-05).
  const payload = bytes.subarray(2);
  const macBytes = Array.from(payload.subarray(3, 9)).reverse();
  return macBytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(':');
}

/** Sanity-check a recovered MAC against the device-name suffix (e.g. _C8D3). */
export function macMatchesName(mac: string, name: string): boolean {
  const m = name.match(/_([0-9a-fA-F]{4})$/);
  if (!m?.[1]) return true; // no suffix to check against
  const suffix = m[1].toUpperCase();
  const tail = mac.replace(/:/g, '').toUpperCase().slice(-4);
  return tail === suffix;
}

/** What a scan says about one advertiser — the part that picking the cube depends on. */
export interface Advertiser {
  name: string;
  manufacturerData?: string;
}

/** The cube among a scan's advertisers, and the GAN-named ones that are not it. */
export interface Sighting<D extends Advertiser> {
  cube: (D & { mac: string; macOk: boolean }) | null;
  /** GAN-named advertisers passed over, and why — the evidence a failed scan reports. */
  passedOver: { name: string; why: string }[];
}

/**
 * Which advertiser is the cube.
 *
 * A GAN name is a CANDIDATE, never the answer. The discriminator is a recoverable MAC, because that
 * MAC is the key material: a device without one cannot be decrypted whatever it calls itself, and
 * one with a valid-looking name and no MAC is not a cube that needs a nudge — it is a different
 * product. So every candidate is tried and a failure moves to the next rather than ending the scan.
 *
 * Found by a GAN Robot on 2026-09-17: `GANBOT-2600D0` advertises the six ASCII bytes `GANRO2`
 * (`47414e524f32`) as its manufacturer data, matched `/gan/i`, was picked as the only candidate,
 * and threw — so a robot on the desk made the cube beside it undiscoverable. The reason each
 * candidate was passed over travels with the answer for the same reason the scan helper names its
 * own failures: "no GAN cube found" says the same thing to an empty room and to a room with the
 * wrong GAN device in it, and those need different things done about them.
 */
export function sightCube<D extends Advertiser>(devices: readonly D[]): Sighting<D> {
  const passedOver: { name: string; why: string }[] = [];
  for (const d of devices) {
    if (!/gan/i.test(d.name)) continue;
    const mac = d.manufacturerData ? extractMacFromManufacturerData(d.manufacturerData) : null;
    if (mac) return { cube: { ...d, mac, macOk: macMatchesName(mac, d.name) }, passedOver };
    passedOver.push({
      name: d.name,
      why: d.manufacturerData
        ? `no MAC in manufacturer data ${d.manufacturerData}`
        : 'no manufacturer data',
    });
  }
  return { cube: null, passedOver };
}
