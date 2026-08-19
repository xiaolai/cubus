// Per-byte variance of GYRO packets: does any byte OUTSIDE the known
// quaternion/velocity region (upstream uses bytes 2-11) carry data — e.g. a
// hidden partial-turn angle? Usage: gyro-bytes <capture.kv> <MAC>
import { readFileSync } from 'node:fs';
import { GanGen4Cipher } from '../src/gen4/crypto.js';

const cipher = new GanGen4Cipher(process.argv[3]);
const gyros: Buffer[] = [];
for (const line of readFileSync(process.argv[2], 'utf8').split('\n')) {
  const v = line.match(/value=([0-9a-fA-F]{40})/);
  if (!v) continue;
  const dec = Buffer.from(cipher.decrypt(Buffer.from(v[1], 'hex')));
  if (dec[0] === 0xec) gyros.push(dec);
}
console.log(`GYRO packets: ${gyros.length}\n`);
console.log('byte : distinct  min  max   region');
for (let b = 0; b < 20; b++) {
  const vals = gyros.map((g) => g[b]);
  const distinct = new Set(vals).size;
  const region = b <= 1 ? 'header' : b <= 9 ? 'quaternion' : b <= 11 ? 'quat/velocity' : 'unused-by-upstream';
  console.log(
    `  ${String(b).padStart(2)} : ${String(distinct).padStart(4)}     ${String(Math.min(...vals)).padStart(3)} ${String(Math.max(...vals)).padStart(3)}   ${region}`,
  );
}
