// Offline analysis of a raw FFF6 capture (blew -o kv output).
// Decodes every packet, prints the MOVE sequence and event histogram, and
// checks the move stream against an expected repeating pattern if given.
//
// Usage: analyze-capture <capture.kv> <MAC> [expected e.g. "R U R' U'"]

import { readFileSync } from 'node:fs';
import { GanGen4Cipher } from '../src/gen4/crypto.js';
import { decodeGen4 } from '../src/gen4/decode.js';

const [, , file, mac, expected] = process.argv;
const cipher = new GanGen4Cipher(mac);

const lines = readFileSync(file, 'utf8').split('\n');
const events: {
  ts: number;
  type: string;
  notation?: string;
  serial?: number;
  facelets?: string;
}[] = [];
const hist: Record<string, number> = {};

for (const line of lines) {
  const v = line.match(/value=([0-9a-fA-F]{40})/);
  const t = line.match(/ts=([^ ]+)/);
  if (!v) continue;
  const ev = decodeGen4(cipher.decrypt(Buffer.from(v[1], 'hex')), t ? Date.parse(t[1]) : 0);
  hist[ev.type] = (hist[ev.type] ?? 0) + 1;
  if (ev.type === 'MOVE')
    events.push({ ts: ev.timestamp, type: 'MOVE', notation: ev.notation, serial: ev.serial });
  else if (ev.type === 'FACELETS')
    events.push({ ts: ev.timestamp, type: 'FACELETS', facelets: ev.facelets, serial: ev.serial });
}

console.log('event histogram:', hist);

const moves = events.filter((e) => e.type === 'MOVE');
console.log(`\nMOVES (${moves.length}):`);
console.log(`  ${moves.map((m) => m.notation).join(' ')}`);

// Serial continuity check
let gaps = 0;
for (let i = 1; i < moves.length; i++) {
  if (((moves[i].serial! - moves[i - 1].serial!) & 0xff) !== 1) gaps++;
}
console.log(`serial continuity: ${gaps === 0 ? 'OK (all +1)' : `${gaps} gap(s)`}`);

if (expected) {
  const pat = expected.trim().split(/\s+/);
  const seq = moves.map((m) => m.notation!);
  let matched = 0;
  let mismatched = 0;
  for (let i = 0; i < seq.length; i++) {
    if (seq[i] === pat[i % pat.length]) matched++;
    else mismatched++;
  }
  // Find best rotation of the pattern to align (user may start mid-cycle).
  let best = { off: 0, ok: -1 };
  for (let off = 0; off < pat.length; off++) {
    let ok = 0;
    for (let i = 0; i < seq.length; i++) if (seq[i] === pat[(i + off) % pat.length]) ok++;
    if (ok > best.ok) best = { off, ok };
  }
  console.log(`\nexpected pattern: ${pat.join(' ')} (repeating)`);
  console.log(
    `best alignment: offset ${best.off}, ${best.ok}/${seq.length} match (${((100 * best.ok) / seq.length).toFixed(0)}%)`,
  );
}
