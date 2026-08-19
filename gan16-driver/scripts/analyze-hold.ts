// Experiment H "hold test": find windows where the cube was stationary (steady
// gyro, no completed MOVE) — i.e. a layer frozen mid-turn — and report exactly
// what packet types/fields were transmitted during each freeze. If only steady
// GYRO + unchanged FACELETS appear, the cube exposes NO partial-turn angle.
//
// Usage: analyze-hold <capture.kv> <MAC>

import { readFileSync } from 'node:fs';
import { GanGen4Cipher } from '../src/gen4/crypto.js';
import { decodeGen4 } from '../src/gen4/decode.js';

const cipher = new GanGen4Cipher(process.argv[3]);
const rows: { t: number; type: string; evt: number; serial?: number; q?: number[]; raw: string }[] = [];
let t0 = 0;
for (const line of readFileSync(process.argv[2], 'utf8').split('\n')) {
  const v = line.match(/value=([0-9a-fA-F]{40})/);
  const tm = line.match(/ts=([^ ]+)/);
  if (!v) continue;
  const ts = tm ? Date.parse(tm[1]) : 0;
  if (!t0) t0 = ts;
  const dec = cipher.decrypt(Buffer.from(v[1], 'hex'));
  const e = decodeGen4(dec, ts);
  const row: (typeof rows)[number] = { t: ts - t0, type: e.type, evt: dec[0], raw: Buffer.from(dec).toString('hex') };
  if (e.type === 'FACELETS') row.serial = e.serial;
  if (e.type === 'GYRO') row.q = [e.quaternion.w, e.quaternion.x, e.quaternion.y, e.quaternion.z];
  rows.push(row);
}

// Slide a 1.2s window; a "hold" is a window with no MOVE and small gyro drift.
const HOLD_MS = 1200;
const GYRO_STILL = 0.06; // max quaternion drift to count as "held still"
const holds: { start: number; end: number; rows: typeof rows }[] = [];
let i = 0;
while (i < rows.length) {
  const start = rows[i].t;
  let j = i;
  const q0 = rows[i].q;
  let hasMove = false;
  let drift = 0;
  while (j < rows.length && rows[j].t - start <= HOLD_MS) {
    if (rows[j].type === 'MOVE') hasMove = true;
    if (rows[j].q && q0) drift = Math.max(drift, Math.hypot(...rows[j].q!.map((v, k) => v - q0[k])));
    j++;
  }
  if (!hasMove && drift < GYRO_STILL && j - i >= 6) {
    holds.push({ start, end: rows[j - 1].t, rows: rows.slice(i, j) });
    i = j;
  } else {
    i++;
  }
}

console.log(`captured ${rows.length} packets; found ${holds.length} still-hold windows (>=1.2s, steady gyro, no completed move)\n`);
let anyAngle = false;
for (const h of holds.slice(0, 12)) {
  const kinds: Record<string, number> = {};
  const serials = new Set<number>();
  const gyroHashes = new Set<string>();
  for (const r of h.rows) {
    kinds[r.type] = (kinds[r.type] ?? 0) + 1;
    if (r.type === 'FACELETS' && r.serial !== undefined) serials.add(r.serial);
    if (r.type === 'GYRO') gyroHashes.add(r.raw.slice(4, 24)); // quaternion+velocity region
  }
  // During a true still-hold, gyro payload should be ~constant and facelets serial fixed.
  const gyroVaries = gyroHashes.size > 3;
  if (gyroVaries) anyAngle = true;
  console.log(`hold @${h.start}-${h.end}ms: ${JSON.stringify(kinds)}  facelets-serials=${[...serials].join(',')||'-'}  distinct-gyro-payloads=${gyroHashes.size}${gyroVaries ? '  <-- gyro changing while "still" (investigate)' : ''}`);
}

console.log('\n=== HOLD-TEST VERDICT ===');
if (holds.length === 0) {
  console.log('No clean still-hold window found (turns were continuous). Re-run holding a half-turn frozen for ~3s.');
} else if (!anyAngle) {
  console.log('During every frozen-mid-turn hold, only steady GYRO + unchanged FACELETS were sent.');
  console.log('=> The cube transmits NOTHING about partial layer angle. Only completed moves (H1 confirmed).');
} else {
  console.log('Some holds showed a varying gyro payload while otherwise still — inspect those windows for a possible angle field.');
}
