#!/usr/bin/env -S npx tsx
// gan16 — diagnostic CLI for the GAN16 ui smart cube on macOS.
//
//   gan16 scan                 discover the cube, print id / MAC / RSSI
//   gan16 inspect              dump the GATT tree + initial characteristic reads
//   gan16 state                connect, request facelets, print the cube state
//   gan16 monitor              live human-readable events (MOVE / FACELETS / GYRO)
//   gan16 raw [char]           timestamped raw + decrypted packets (default FFF6)
//   gan16 record <name>        save a lossless capture under captures/

import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePacket, startRecording } from './capture.js';
import { GanCube } from './driver.js';
import { GanGen4Cipher } from './gen4/crypto.js';
import { extractMacFromManufacturerData, macMatchesName } from './mac.js';
import { BlewTransport, runBlew, scanForCube } from './transport/blew.js';

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

async function cmdInspect() {
  const c = await findCube();
  console.log(`# ${c.name}  (${c.id})  mac ${c.mac}\n`);
  await runBlew(['-o', 'kv', 'gatt', 'tree', '--id', c.id]);
  console.log('\n# initial reads');
  for (const ch of ['FFF4', 'FFF5', 'FFF6', 'FFF7']) {
    // A characteristic that will not read is itself a finding, not a reason to abandon the other
    // three — so the failure is named where it happened and the dump continues. The tree above is
    // not treated that way on purpose: without it there is nothing to inspect.
    await runBlew(['-o', 'kv', 'read', '--id', c.id, ch]).catch((e: unknown) =>
      console.error(`  ! read ${ch} failed: ${e instanceof Error ? e.message : String(e)}`),
    );
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
  // A move the counter refused. Printed because a packet dropped on purpose still happened, and
  // a run where these appear is the evidence that the link is repeating or re-ordering packets.
  cube.on('stale', (s) =>
    console.log(`↩ STALE ${s.reason} serial=${s.serial} (counter at ${s.lastSerial})`),
  );
  // The counter moving on its own, across a link break. Printed for the same reason as STALE: the
  // driver adopting a new baseline is a decision about the move stream, not an implementation
  // detail, and the reconnect experiment is exactly where it needs to be visible.
  cube.on('rebase', (r) =>
    console.log(`⟲ REBASE cube counter restarted: ${r.from} -> ${r.to} (${r.reason})`),
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
    const { dec, event, error } = decodePacket(cipher, hex, ts);
    const evt = event
      ? event.type + (event.type === 'MOVE' ? ` ${event.notation}` : '')
      : `undecoded: ${error}`;
    console.log(`${new Date(ts).toISOString()}  enc=${hex}  dec=${dec}  ${evt}`);
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
  const transport = new BlewTransport(c.id);
  const sub = transport.subscribe('FFF6');
  const rec = startRecording({
    sub,
    cipher: new GanGen4Cipher(c.mac),
    out,
    path,
    meta: {
      device: c.name,
      id: c.id,
      mac: c.mac,
      experiment: name,
      startedAt: new Date().toISOString(),
    },
    onPacket: (packets) => process.stdout.write(`\rrecorded ${packets} packets -> ${path}`),
    // finish() reports the failure from stop(), naming the path — printing it here as well would
    // say the same thing twice.
    onError: () => void finish(1),
  });

  let finishing = false;
  /**
   * The one way a recording ends, whichever way it was asked to. Ctrl-C used to call out.end() and
   * process.exit() on the next line: end() returns before the stream's buffer drains, so the last
   * packets were still unwritten when the process went away, under a message saying "saved."
   * The packets are stopped first, the flush is awaited, and only then is anything claimed.
   */
  async function finish(code: number): Promise<void> {
    if (finishing) return;
    finishing = true;
    transport.disconnect(); // no more packets while the file is closing
    try {
      const packets = await rec.stop();
      console.log(`\nsaved ${packets} packets -> ${path}`);
      process.exit(code);
    } catch (e) {
      console.error(`\n${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
  }

  sub.on('error', (e: Error) => console.error('error:', e.message));
  sub.on('giveup', (e: Error) => {
    console.error(e.message);
    void finish(1);
  });
  process.on('SIGINT', () => void finish(0));
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
