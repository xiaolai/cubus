// decrypt-probe.mjs — offline H1/H2/H3 test.
// Implements the upstream GAN Gen4 crypto (AES-128-CBC, first+last 16-byte chunk,
// key/iv salted with reversed-MAC bytes) using only Node's built-in crypto,
// then decrypts real captured FFF6 packets and classifies the plaintext.
//
// Usage: node decrypt-probe.mjs <capture.kv> <MAC e.g. 54:6C:50:89:C8:D3>

import { createDecipheriv } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Upstream GAN_ENCRYPTION_KEYS[0] — shared by Gen2/Gen3/Gen4.
const BASE_KEY = [
  0x01, 0x02, 0x42, 0x28, 0x31, 0x91, 0x16, 0x07, 0x20, 0x05, 0x18, 0x54, 0x42, 0x11, 0x12, 0x53,
];
const BASE_IV = [
  0x11, 0x03, 0x32, 0x28, 0x21, 0x01, 0x76, 0x27, 0x20, 0x95, 0x78, 0x14, 0x32, 0x12, 0x02, 0x43,
];

function saltedKeyIv(macStr) {
  // salt = MAC bytes in reverse order (upstream gan-smart-cube.ts)
  const salt = macStr
    .split(/[:\-\s]+/)
    .map((h) => Number.parseInt(h, 16))
    .reverse();
  const key = Uint8Array.from(BASE_KEY);
  const iv = Uint8Array.from(BASE_IV);
  for (let i = 0; i < 6; i++) {
    key[i] = (BASE_KEY[i] + salt[i]) % 0xff;
    iv[i] = (BASE_IV[i] + salt[i]) % 0xff;
  }
  return { key: Buffer.from(key), iv: Buffer.from(iv) };
}

// Decrypt one 16-byte chunk in place at offset (single CBC block, no padding).
function decryptChunk(buf, offset, key, iv) {
  const d = createDecipheriv('aes-128-cbc', key, iv);
  d.setAutoPadding(false);
  const chunk = Buffer.concat([d.update(buf.subarray(offset, offset + 16)), d.final()]);
  chunk.copy(buf, offset);
}

function decrypt(data, key, iv) {
  const res = Buffer.from(data);
  if (res.length > 16) decryptChunk(res, res.length - 16, key, iv); // end chunk first
  decryptChunk(res, 0, key, iv); // then start chunk
  return res;
}

const [, , file, mac] = process.argv;
if (!file || !mac) {
  console.error('usage: decrypt-probe.mjs <capture.kv> <MAC>');
  process.exit(1);
}
const { key, iv } = saltedKeyIv(mac);
console.log(`MAC=${mac}\nkey=${key.toString('hex')}\niv =${iv.toString('hex')}\n`);

const lines = readFileSync(file, 'utf8')
  .split('\n')
  .filter((l) => l.includes('value='));
const eventCounts = {};
let shown = 0;
for (const line of lines) {
  const m = line.match(/value=([0-9a-fA-F]+)/);
  if (!m || m[1].length !== 40) continue;
  const enc = Buffer.from(m[1], 'hex');
  const dec = decrypt(enc, key, iv);
  const evt = dec[0]; // Gen4: first byte = event type
  eventCounts[evt] = (eventCounts[evt] || 0) + 1;
  if (shown < 24) {
    console.log(`evt=0x${evt.toString(16).padStart(2, '0')} len=${dec[1]}  ${dec.toString('hex')}`);
    shown++;
  }
}
console.log('\n--- event-type histogram (first plaintext byte) ---');
for (const [k, v] of Object.entries(eventCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`0x${Number(k).toString(16).padStart(2, '0')}: ${v}`);
}
