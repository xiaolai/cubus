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

/** @param manufacturerHex full CoreBluetooth manufacturer data as hex. */
export function extractMacFromManufacturerData(manufacturerHex: string): string | null {
  // Reject malformed hex up front — Buffer.from(...,'hex') silently truncates
  // on odd length or non-hex chars, which would yield a plausible-but-wrong MAC.
  if (!/^[0-9a-fA-F]*$/.test(manufacturerHex) || manufacturerHex.length % 2 !== 0) return null;
  const bytes = Buffer.from(manufacturerHex, 'hex');
  if (bytes.length < 11) return null;
  // company id little-endian; GAN uses 0xXX01, i.e. low byte 0x01
  if (bytes[0] !== 0x01) return null;
  const payload = bytes.subarray(2); // strip company id
  if (payload.length < 9) return null;
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
