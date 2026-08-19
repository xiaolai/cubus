// One-shot live acceptance: scan → connect → passive state → active hardware
// → capture labeled moves. Prints a PASS/FAIL summary. Needs the cube awake.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanForCube, BlewTransport } from '../src/transport/blew.js';
import { extractMacFromManufacturerData, macMatchesName } from '../src/mac.js';
import { GanCube } from '../src/driver.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_ADV = join(ROOT, 'scripts', 'scan-adv');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('scanning up to 60s — twist the cube to wake it...');
  let cube: Awaited<ReturnType<typeof scanForCube>>[number] | undefined;
  for (let i = 0; i < 5 && !cube; i++) {
    const devs = await scanForCube(SCAN_ADV, 12);
    cube = devs.find((d) => /gan/i.test(d.name) && d.manufacturerData);
  }
  if (!cube?.manufacturerData) throw new Error('cube never appeared');
  const mac = extractMacFromManufacturerData(cube.manufacturerData)!;
  console.log(`FOUND ${cube.name}  mac=${mac}  name-suffix ${macMatchesName(mac, cube.name) ? 'OK' : 'MISMATCH'}`);

  const gan = new GanCube({ mac, transport: new BlewTransport(cube.id) });
  const moves: string[] = [];
  gan.onMove((m) => { moves.push(m.notation); console.log(`  MOVE ${m.notation} serial=${m.serial}`); });
  gan.on('gap', (g) => console.log(`  GAP missed ${g.missing}`));
  gan.connect();

  console.log('\n[1] passive getState (no write) — keep turning the cube...');
  const st = await gan.getState({ timeoutMs: 15000 });
  console.log(`  STATE ${st.facelets}`);

  console.log('\n[2] active requestHardware (write path)...');
  const hw = await gan.requestHardware(10000) as any;
  console.log(`  HARDWARE name=${hw.hardwareName} hw=${hw.hardwareVersion} sw=${hw.softwareVersion} date=${hw.productDate} gyro=${hw.gyroSupported} extras=${hw.extras.map((e: any) => '0x' + e.eventType.toString(16)).join(',')}`);

  console.log('\n[3] capturing moves for 15s — turn faces now...');
  await sleep(15000);

  gan.disconnect();
  console.log(`\nRESULT: state=${st.facelets.length === 54 ? 'OK' : 'BAD'} hw=${hw.hardwareName === 'GAN16ui' ? 'OK' : 'BAD'} moves=${moves.length} [${moves.join(' ')}]`);
  process.exit(0);
}
main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
