// Experiment H analysis: does a slow partial face turn expose intermediate
// angular data, or only a completed-move event at 90°?
//
// Prints a compact timeline (runs of identical GYRO/FACELETS collapsed),
// highlights every MOVE and every event type outside the known Gen4 set, and
// reports whether the cube body was held still (gyro delta) during turns.
//
// Usage: analyze-partial <capture.kv> <MAC>

import { readFileSync } from 'node:fs';
import { GanGen4Cipher } from '../src/gen4/crypto.js';
import { decodeGen4 } from '../src/gen4/decode.js';

const cipher = new GanGen4Cipher(process.argv[3]);
const lines = readFileSync(process.argv[2], 'utf8').split('\n');

type Row = { t: number; type: string; evt: number; info: string; raw: string };
const rows: Row[] = [];
let t0 = 0;
const known = new Set([0x01, 0xd1, 0xed, 0xec, 0xef, 0xea]);
const hwRange = (e: number) => e >= 0xf5 && e <= 0xff;
const typeHist: Record<string, number> = {};
const evtHist: Record<number, number> = {};

for (const line of lines) {
  const v = line.match(/value=([0-9a-fA-F]{40})/);
  const tm = line.match(/ts=([^ ]+)/);
  if (!v) continue;
  const ts = tm ? Date.parse(tm[1]) : 0;
  if (!t0) t0 = ts;
  const dec = cipher.decrypt(Buffer.from(v[1], 'hex'));
  const e = decodeGen4(dec, ts);
  const evt = dec[0];
  evtHist[evt] = (evtHist[evt] ?? 0) + 1;
  typeHist[e.type] = (typeHist[e.type] ?? 0) + 1;
  let info = '';
  if (e.type === 'MOVE') info = `${e.notation} serial=${e.serial}`;
  else if (e.type === 'FACELETS') info = `serial=${e.serial}`;
  else if (e.type === 'GYRO') {
    const q = e.quaternion;
    info = `q=(${q.w.toFixed(3)},${q.x.toFixed(3)},${q.y.toFixed(3)},${q.z.toFixed(3)})`;
  }
  rows.push({ t: ts - t0, type: e.type, evt, info, raw: Buffer.from(dec).toString('hex') });
}

// Detect any event type outside the known streaming + hardware set.
const unexpected = rows.filter((r) => !known.has(r.evt) && !hwRange(r.evt));

console.log('=== event-type histogram ===');
for (const [k, n] of Object.entries(evtHist).sort((a, b) => b[1] - a[1])) {
  const e = Number(k);
  const tag = known.has(e) ? '' : hwRange(e) ? ' (hardware)' : '  <-- UNEXPECTED';
  console.log(`  0x${e.toString(16).padStart(2, '0')}: ${n}${tag}`);
}
console.log('  by decoded type:', typeHist);

// Timeline around MOVEs: show the 1.5s window before each MOVE to see whether
// anything intermediate was emitted during the turn.
console.log('\n=== MOVE events and what preceded each (1.5s window) ===');
const moves = rows.filter((r) => r.type === 'MOVE');
if (!moves.length) console.log('  (no MOVE events — turn may not have completed a detent)');
for (const m of moves) {
  const win = rows.filter((r) => r.t >= m.t - 1500 && r.t <= m.t && r !== m);
  const kinds = new Set(win.map((r) => r.type));
  console.log(`  MOVE ${m.info} @${m.t}ms  — preceding 1.5s carried: ${[...kinds].join(', ') || 'nothing'} (${win.length} pkts)`);
}

// Gyro stability: max pairwise quaternion drift across the whole capture.
const gy = rows.filter((r) => r.type === 'GYRO');
if (gy.length > 1) {
  const q = gy.map((r) => r.info.match(/[-\d.]+/g)!.map(Number));
  let maxd = 0;
  for (let i = 1; i < q.length; i++) {
    const d = Math.hypot(...q[i].map((v, j) => v - q[i - 1][j]));
    maxd = Math.max(maxd, d);
  }
  console.log(`\ngyro frames: ${gy.length}, max frame-to-frame quaternion delta: ${maxd.toFixed(3)} (small => body held still)`);
}

console.log('\n=== VERDICT ===');
if (unexpected.length === 0) {
  console.log('No event type outside {MOVE, GYRO, FACELETS, hardware} appeared.');
  console.log('=> No dedicated partial-turn/angular BLE data. Face turns surface only as completed MOVE events (H1).');
} else {
  console.log(`Found ${unexpected.length} UNEXPECTED packets — possible partial-turn data. Samples:`);
  unexpected.slice(0, 8).forEach((r) => console.log(`  @${r.t}ms 0x${r.evt.toString(16)} ${r.raw}`));
}
