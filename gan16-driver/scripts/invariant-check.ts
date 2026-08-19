// Self-consistency invariant on a real capture, using cubejs as the trusted
// cube model:  apply(MOVEs between two FACELETS snapshots) == later FACELETS.
// No hardware, no assumptions about solved start.
//
// Usage: invariant-check <capture.kv> <MAC>

import { readFileSync } from 'node:fs';
import Cube from 'cubejs';
import { GanGen4Cipher } from '../src/gen4/crypto.js';
import { decodeGen4 } from '../src/gen4/decode.js';

const cipher = new GanGen4Cipher(process.argv[3]);
const lines = readFileSync(process.argv[2], 'utf8').split('\n');

type Ev =
  | { kind: 'MOVE'; serial: number; notation: string }
  | { kind: 'FACE'; serial: number; facelets: string };
const stream: Ev[] = [];
for (const line of lines) {
  const v = line.match(/value=([0-9a-fA-F]{40})/);
  if (!v) continue;
  const e = decodeGen4(cipher.decrypt(Buffer.from(v[1], 'hex')), 0);
  if (e.type === 'MOVE') stream.push({ kind: 'MOVE', serial: e.serial & 0xff, notation: e.notation });
  else if (e.type === 'FACELETS') stream.push({ kind: 'FACE', serial: e.serial & 0xff, facelets: e.facelets });
}

// Walk the stream; between consecutive FACELETS snapshots, replay the moves.
let checks = 0;
let passed = 0;
let lastFace: { serial: number; facelets: string } | null = null;
const pending: { serial: number; notation: string }[] = [];

for (const e of stream) {
  if (e.kind === 'MOVE') {
    pending.push({ serial: e.serial, notation: e.notation });
  } else {
    if (lastFace) {
      // Moves whose serial falls in (lastFace.serial, e.serial]
      const span = (e.serial - lastFace.serial) & 0xff;
      if (span > 0 && span < 32) {
        const moves = pending.filter((m) => {
          const d = (m.serial - lastFace!.serial) & 0xff;
          return d >= 1 && d <= span;
        });
        // Only check when we captured exactly the right number of moves for the span.
        if (moves.length === span) {
          moves.sort((a, b) => ((a.serial - lastFace!.serial) & 0xff) - ((b.serial - lastFace!.serial) & 0xff));
          const cube = Cube.fromString(lastFace.facelets);
          for (const m of moves) cube.move(m.notation);
          checks++;
          const predicted = cube.asString();
          if (predicted === e.facelets) passed++;
          else {
            console.log(`MISMATCH span ${lastFace.serial}->${e.serial} moves=[${moves.map((m) => m.notation).join(' ')}]`);
            console.log(`  predicted: ${predicted}`);
            console.log(`  hardware : ${e.facelets}`);
          }
        }
      }
    }
    lastFace = { serial: e.serial, facelets: e.facelets };
  }
}

console.log(`\ninvariant checks: ${passed}/${checks} passed`);
process.exit(checks > 0 && passed === checks ? 0 : 1);
