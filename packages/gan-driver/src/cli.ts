#!/usr/bin/env -S npx tsx
// gan16 — diagnostic CLI for the GAN16 ui smart cube on macOS.
//
//   gan16 scan                 discover the cube, print id / MAC / RSSI
//   gan16 inspect              dump the GATT tree + initial characteristic reads
//   gan16 state                connect, request facelets, print the cube state
//   gan16 monitor              live human-readable events (MOVE / FACELETS / GYRO)
//   gan16 raw [char]           timestamped raw + decrypted packets (default FFF6)
//   gan16 record <name>        save a lossless capture under captures/

import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GanCube } from './driver.js';
import { GanGen4Cipher } from './gen4/crypto.js';
import { decodeGen4 } from './gen4/decode.js';
import { extractMacFromManufacturerData, macMatchesName } from './mac.js';
import { BlewTransport, scanForCube } from './transport/blew.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_ADV = join(ROOT, 'scripts', 'scan-adv');

/** Discover the cube, retrying across several scan windows — it only advertises
 *  while moving, so a single scan often misses a resting cube. */
async function findCube(windowSecs = 10, attempts = 6) {
  for (let i = 0; i < attempts; i++) {
    const devices = await scanForCube(SCAN_ADV, windowSecs);
    const cube = devices.find((d) => /gan/i.test(d.name) && d.manufacturerData);
    if (cube?.manufacturerData) {
      const mac = extractMacFromManufacturerData(cube.manufacturerData);
      if (!mac)
        throw new Error(
          `found ${cube.name} but could not recover MAC from ${cube.manufacturerData}`,
        );
      return { ...cube, mac, macOk: macMatchesName(mac, cube.name) };
    }
    if (i === 0) console.error('no cube yet — give it a twist to wake it…');
  }
  throw new Error('no GAN cube found — keep it moving and retry');
}

/** Render a Kociemba facelet string as a labelled 6-face map. */
function faceMap(facelets: string): string {
  const seg = (i: number): string[] => facelets.slice(i, i + 9).match(/.{3}/g) ?? [];
  const [U, R, F, D, L, B] = [0, 9, 18, 27, 36, 45].map(seg) as [
    string[],
    string[],
    string[],
    string[],
    string[],
    string[],
  ];
  const pad = '         ';
  const out = [...U.map((r) => `${pad} ${r}`)];
  for (let i = 0; i < 3; i++) out.push(`${L[i]} ${F[i]} ${R[i]} ${B[i]}`);
  out.push(...D.map((r) => `${pad} ${r}`));
  const solved = facelets === 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
  return `${out.join('\n')}\n\nsolved: ${solved ? 'YES' : 'no (scrambled)'}`;
}

async function cmdScan() {
  const c = await findCube();
  console.log(`FOUND  ${c.name}`);
  console.log(`  id    ${c.id}`);
  console.log(`  mac   ${c.mac}${c.macOk ? '  (name-suffix ✓)' : '  (⚠ name mismatch)'}`);
  console.log(`  rssi  ${c.rssi} dBm`);
  console.log(`  mfg   ${c.manufacturerData}`);
}

/** Keep the Node event loop alive for long-running commands (an unresolved
 * promise alone does not; a bare `blew sub` child can exit and drain the loop). */
function keepAlive(): void {
  setInterval(() => {}, 1 << 30);
}

function blew(args: string[]): Promise<void> {
  return new Promise((res) => {
    const p = spawn('blew', args, { stdio: 'inherit' });
    p.on('close', () => res());
  });
}

async function cmdInspect() {
  const c = await findCube();
  console.log(`# ${c.name}  (${c.id})  mac ${c.mac}\n`);
  await blew(['-o', 'kv', 'gatt', 'tree', '--id', c.id]);
  console.log('\n# initial reads');
  for (const ch of ['FFF4', 'FFF5', 'FFF6', 'FFF7']) {
    await blew(['-o', 'kv', 'read', '--id', c.id, ch]);
  }
}

async function cmdState() {
  const c = await findCube();
  const cube = new GanCube({ mac: c.mac, transport: new BlewTransport(c.id) });
  cube.on('live', () => console.log(`CONNECTED ${c.name}`));
  cube.on('error', (e) => console.error('error:', e.message));
  cube.on('giveup', (e) => console.error(e.message));
  cube.connect();
  console.log('reading state — keep the cube gently moving (no face turns)…');
  try {
    // The cube emits FACELETS ~1 Hz once connected; wait passively with a
    // generous window to ride out the connect/sleep cycle.
    const st = await cube.getState({ timeoutMs: 20000 });
    console.log(`\nfacelets (URFDLB): ${st.facelets}\n`);
    console.log(faceMap(st.facelets));
  } finally {
    cube.disconnect();
  }
}

async function cmdMonitor() {
  const c = await findCube();
  const transport = new BlewTransport(c.id);
  const cube = new GanCube({ mac: c.mac, transport });
  console.log(`connecting to ${c.name} (${c.mac}) — keep the cube moving…`);
  cube.on('live', () => console.log(`CONNECTED ${c.name}`));
  cube.on('error', (e) => console.error('error:', e.message));
  cube.on('giveup', (e) => {
    console.error(e.message);
    process.exit(1);
  });
  cube.connect();
  keepAlive();
  // The serial too: the reconnect experiment in dev-docs/smart-cube-ux-prd.md compares the
  // state AND the counter across a disconnect, and a STATE line without it recorded only half.
  cube.onFacelets((f) => console.log(`STATE  ${f.facelets}  serial=${f.serial}`));
  cube.onMove((m) =>
    console.log(`MOVE   ${m.notation.padEnd(3)}  serial=${m.serial}  t=${m.cubeTimestamp}`),
  );
  cube.on('gap', (g) =>
    console.log(`⚠ GAP   missed ${g.missing} move(s) between serial ${g.from}->${g.to}`),
  );
  cube.on('unknown', (u) =>
    console.log(`? UNKNOWN evt=0x${(u.eventType ?? 0).toString(16)} ${u.rawHex ?? ''}`),
  );
  let lastGyro = 0;
  cube.onGyro((g) => {
    const now = Date.now();
    if (now - lastGyro > 500) {
      // throttle the fast gyro stream for readability
      lastGyro = now;
      const q = g.quaternion;
      console.log(
        `ORIENT q=(${q.w.toFixed(2)},${q.x.toFixed(2)},${q.y.toFixed(2)},${q.z.toFixed(2)})`,
      );
    }
  });
  await new Promise(() => {}); // run until Ctrl-C
}

async function cmdRaw(char = 'FFF6') {
  const c = await findCube();
  const cipher = new GanGen4Cipher(c.mac);
  const transport = new BlewTransport(c.id);
  console.log(`RAW ${char}  ${c.name}  (Ctrl-C to stop)`);
  const sub = transport.subscribe(char);
  sub.on('error', (e: Error) => console.error('error:', e.message));
  sub.on('giveup', (e: Error) => {
    console.error(e.message);
    process.exit(1);
  });
  sub.on('packet', (hex: string, ts: number) => {
    let decHex = '';
    let evt = '';
    if (hex.length === 40) {
      const dec = cipher.decrypt(Buffer.from(hex, 'hex'));
      decHex = Buffer.from(dec).toString('hex');
      const e = decodeGen4(dec, ts);
      evt = e.type + (e.type === 'MOVE' ? ` ${e.notation}` : '');
    }
    console.log(`${new Date(ts).toISOString()}  enc=${hex}  dec=${decHex}  ${evt}`);
  });
  keepAlive();
  await new Promise(() => {});
}

async function cmdRecord(name: string) {
  if (!name) throw new Error('usage: gan16 record <experiment-name>');
  const c = await findCube();
  const dir = join(ROOT, 'captures', 'recordings');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = join(dir, `${stamp}-${name}.jsonl`);
  const out = createWriteStream(path);
  out.write(
    `${JSON.stringify({
      meta: {
        device: c.name,
        id: c.id,
        mac: c.mac,
        experiment: name,
        startedAt: new Date().toISOString(),
      },
    })}\n`,
  );
  const cipher = new GanGen4Cipher(c.mac);
  const transport = new BlewTransport(c.id);
  const sub = transport.subscribe('FFF6');
  sub.on('error', (e: Error) => console.error('error:', e.message));
  sub.on('giveup', (e: Error) => {
    out.end();
    console.error(e.message);
    process.exit(1);
  });
  let n = 0;
  sub.on('packet', (hex: string, ts: number) => {
    const rec: Record<string, unknown> = { ts, char: 'FFF6', enc: hex };
    if (hex.length === 40) {
      const dec = cipher.decrypt(Buffer.from(hex, 'hex'));
      rec.dec = Buffer.from(dec).toString('hex');
      rec.event = decodeGen4(dec, ts);
    }
    out.write(`${JSON.stringify(rec)}\n`);
    n++;
    process.stdout.write(`\rrecorded ${n} packets -> ${path}`);
  });
  process.on('SIGINT', () => {
    out.end();
    console.log('\nsaved.');
    process.exit(0);
  });
  console.log(`RECORDING '${name}' -> ${path}  (Ctrl-C to stop)`);
  keepAlive();
  await new Promise(() => {});
}

const [cmd, ...rest] = process.argv.slice(2);
const run: Record<string, () => Promise<void>> = {
  scan: cmdScan,
  inspect: cmdInspect,
  state: cmdState,
  monitor: cmdMonitor,
  raw: () => cmdRaw(rest[0]),
  record: () => cmdRecord(rest[0] ?? ''),
};
(
  run[cmd ?? ''] ??
  (async () => {
    console.log('usage: gan16 <scan|inspect|state|monitor|raw|record>');
    process.exit(1);
  })
)().catch((e: unknown) => {
  console.error('error:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
