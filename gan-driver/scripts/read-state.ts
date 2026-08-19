// One-shot "what is the cube right now" reader: scan → connect → print the
// first FACELETS snapshot as a labelled face map, then exit. Tolerates the
// cube's sleep/advertise cycle with a generous window.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GanCube } from '../src/driver.js';
import { extractMacFromManufacturerData } from '../src/mac.js';
import { BlewTransport, scanForCube } from '../src/transport/blew.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_ADV = join(ROOT, 'scripts', 'scan-adv');

function pretty(facelets: string): string {
  // Kociemba order: U(0-8) R(9-17) F(18-26) D(27-35) L(36-44) B(45-53)
  const seg = (i: number) => facelets.slice(i, i + 9).match(/.{3}/g)!;
  const [U, R, F, D, L, B] = [0, 9, 18, 27, 36, 45].map(seg);
  const pad = '         ';
  const out: string[] = [];
  U.forEach((r) => out.push(`${pad} ${r}`));
  for (let i = 0; i < 3; i++) out.push(`${L[i]} ${F[i]} ${R[i]} ${B[i]}`);
  D.forEach((r) => out.push(`${pad} ${r}`));
  const solved = facelets === 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
  return `${out.join('\n')}\n\nsolved: ${solved ? 'YES' : 'no (scrambled)'}`;
}

async function main() {
  process.stdout.write('waking cube… gently jostle it (no face turns)\n');
  let cube;
  for (let i = 0; i < 6 && !cube; i++) {
    const devs = await scanForCube(SCAN_ADV, 10);
    cube = devs.find((d) => /gan/i.test(d.name) && d.manufacturerData);
  }
  if (!cube?.manufacturerData) throw new Error('cube never advertised — keep it moving and retry');
  const mac = extractMacFromManufacturerData(cube.manufacturerData)!;
  const gan = new GanCube({ mac, transport: new BlewTransport(cube.id) });
  gan.connect();
  const st = await gan.getState({ timeoutMs: 25000 });
  gan.disconnect();
  console.log(`\n${cube.name}  facelets:\n${st.facelets}\n`);
  console.log(pretty(st.facelets));
  // Let stdout flush and the (now-disconnected) event loop drain naturally.
  // Do NOT call process.exit() here — it truncates buffered stdout to a file.
}
main().catch((e) => {
  console.error('error:', e.message);
  process.exitCode = 1;
});
