// The core correctness invariant, verified offline against a real capture:
//
//   apply(decoded MOVE events, hardware FACELETS snapshot) == next hardware FACELETS
//
// cubejs is the trusted cube model. A wrong face or flipped direction in the
// MOVE decoder would desync the predicted state immediately, so passing this
// across many snapshots is strong evidence the move mapping is correct.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Cube from 'cubejs';
import { GanGen4Cipher } from '../src/gen4/crypto.js';
import { decodeGen4 } from '../src/gen4/decode.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(here, 'fixtures/gan16-smoke-twist.raw.json'), 'utf8'),
) as { mac: string; packets: { enc: string }[] };

const cipher = new GanGen4Cipher(fixture.mac);

type Ev =
  | { kind: 'MOVE'; serial: number; notation: string }
  | { kind: 'FACE'; serial: number; facelets: string };

const stream: Ev[] = [];
for (const p of fixture.packets) {
  const e = decodeGen4(cipher.decrypt(Buffer.from(p.enc, 'hex')), 0);
  if (e.type === 'MOVE') stream.push({ kind: 'MOVE', serial: e.serial & 0xff, notation: e.notation });
  else if (e.type === 'FACELETS') stream.push({ kind: 'FACE', serial: e.serial & 0xff, facelets: e.facelets });
}

function runInvariant() {
  let checks = 0;
  let passed = 0;
  let lastFace: { serial: number; facelets: string } | null = null;
  const pending: { serial: number; notation: string }[] = [];
  for (const e of stream) {
    if (e.kind === 'MOVE') {
      pending.push({ serial: e.serial, notation: e.notation });
      continue;
    }
    if (lastFace) {
      const span = (e.serial - lastFace.serial) & 0xff;
      if (span > 0 && span < 32) {
        const moves = pending
          .filter((m) => {
            const d = (m.serial - lastFace!.serial) & 0xff;
            return d >= 1 && d <= span;
          })
          .sort((a, b) => ((a.serial - lastFace!.serial) & 0xff) - ((b.serial - lastFace!.serial) & 0xff));
        if (moves.length === span) {
          const cube = Cube.fromString(lastFace.facelets);
          for (const m of moves) cube.move(m.notation);
          checks++;
          if (cube.asString() === e.facelets) passed++;
        }
      }
    }
    lastFace = { serial: e.serial, facelets: e.facelets };
  }
  return { checks, passed };
}

describe('state consistency invariant (offline, cubejs)', () => {
  it('replaying decoded moves reproduces the next hardware facelet state', () => {
    const { checks, passed } = runInvariant();
    expect(checks).toBeGreaterThan(0);
    expect(passed).toBe(checks);
  });
});
