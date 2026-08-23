import { readFileSync } from 'node:fs';
import { GanGen4Cipher } from '../src/gen4/crypto.js';
import { decodeGen4 } from '../src/gen4/decode.js';

const c = new GanGen4Cipher(process.argv[3]);
const lines = readFileSync(process.argv[2], 'utf8').split('\n');
let prev: string | null = null;
let changes = 0;
const list: { serial: number; f: string }[] = [];
for (const line of lines) {
  const v = line.match(/value=([0-9a-fA-F]{40})/);
  if (!v) continue;
  const e = decodeGen4(c.decrypt(Buffer.from(v[1], 'hex')), 0);
  if (e.type === 'FACELETS') {
    list.push({ serial: e.serial, f: e.facelets });
    if (prev && prev !== e.facelets) changes++;
    prev = e.facelets;
  }
}
console.log('FACELETS count:', list.length, 'transitions:', changes);
console.log('serial range:', list[0]?.serial, '->', list.at(-1)?.serial);
const uniq = [...new Set(list.map((x) => x.f))];
console.log('unique states:', uniq.length);
uniq.slice(0, 8).forEach((u, i) => console.log(`  s${i}: ${u}`));
