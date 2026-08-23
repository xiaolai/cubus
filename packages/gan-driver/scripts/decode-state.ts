// Decode the latest FACELETS snapshot from a blew .kv capture and print it as a
// labelled face map. Usage: decode-state <capture.kv> <MAC>
import { readFileSync } from 'node:fs';
import { GanGen4Cipher } from '../src/gen4/crypto.js';
import { decodeGen4 } from '../src/gen4/decode.js';

const cipher = new GanGen4Cipher(process.argv[3]);
let last: string | null = null;
let count = 0;
for (const line of readFileSync(process.argv[2], 'utf8').split('\n')) {
  const v = line.match(/value=([0-9a-fA-F]{40})/);
  if (!v) continue;
  count++;
  const e = decodeGen4(cipher.decrypt(Buffer.from(v[1], 'hex')), 0);
  if (e.type === 'FACELETS') last = e.facelets;
}
if (!last) {
  console.log(
    `no FACELETS in capture (${count} packets). Cube likely never connected — keep it moving and retry.`,
  );
  process.exitCode = 1;
} else {
  const seg = (i: number) => last!.slice(i, i + 9).match(/.{3}/g)!;
  const [U, R, F, D, L, B] = [0, 9, 18, 27, 36, 45].map(seg);
  const pad = '         ';
  console.log(`facelets (URFDLB): ${last}\n`);
  U.forEach((r) => console.log(`${pad} ${r}`));
  for (let i = 0; i < 3; i++) console.log(`${L[i]} ${F[i]} ${R[i]} ${B[i]}`);
  D.forEach((r) => console.log(`${pad} ${r}`));
  const solved = last === 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
  console.log(`\nsolved: ${solved ? 'YES' : 'no (scrambled)'}   (${count} packets captured)`);
}
