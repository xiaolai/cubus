// anchorSolved() — the guard that makes REQUEST_RESET safe to send.
//
// REQUEST_RESET tells the cube to treat its CURRENT position as solved. The danger
// is not the packet, it is the state it is sent in:
//
//   cube reports unsolved -> reset adopts a scrambled position as the origin.
//                            Driver and hardware diverge permanently and silently.
//   cube reports solved   -> reset sets the reference to the value already in
//                            effect. State-neutral, so nothing can diverge.
//
// So the precondition removes the failure mechanism rather than reducing its odds,
// and these tests exist to prove the precondition actually holds — including that
// NO write reaches the transport on the refusal path.
//
// What these tests cannot establish: what a physical GAN16 does on receipt. The
// transport here is a simulator. See docs/protocol.md.

import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';

import { GanCube } from '../src/driver.js';
import { buildUnsafeCommand } from '../src/gen4/commands.js';
import { GanGen4Cipher } from '../src/gen4/crypto.js';
import { SOLVED_FACELETS } from '../src/gen4/facelets.js';
import { bytesToHex } from '../src/hex.js';
import type { Transport } from '../src/transport/blew.js';

const MAC = 'AB:12:34:56:78:90';
const SCRAMBLED = 'UUUUUUUUFRRRRRRRRUFFFFFFFFRDDDDDDDDDLLLLLLLLLBBBBBBBBB';
const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * A cube that answers writes the way the hardware does: a facelets query gets a
 * FACELETS event back. `facelets` is what the cube currently reports, so a test
 * can put it in either state.
 */
function simulateCube(facelets: string) {
  const writes: string[] = [];
  const sub = new EventEmitter();
  // The transport closes over the cube, and the cube is constructed from the
  // transport — a holder breaks that cycle without a forward-declared binding.
  const held: { cube?: GanCube } = {};

  const transport: Transport = {
    subscribe: () => sub,
    read: async () => '',
    write: async (_char, hex) => {
      writes.push(hex);
      // The cube replies to a state query. Emitting the decoded event directly is
      // the seam here: the decrypt/decode path has its own fixture coverage in
      // gen4-decode.test.ts, and re-deriving a valid encrypted FACELETS frame
      // would test that path again rather than this one.
      queueMicrotask(() =>
        held.cube?.emit('facelets', {
          type: 'FACELETS',
          serial: 1,
          timestamp: 0,
          facelets: state.facelets,
          state: { CP: [], CO: [], EP: [], EO: [] },
        }),
      );
    },
    disconnect: () => {},
  };

  const state = { facelets };
  const cube = new GanCube({ mac: MAC, transport });
  held.cube = cube;
  cube.connect();
  // Any packet marks the subscription live; onPacket sets live before it
  // validates length, so a short frame is enough and needs no valid crypto.
  sub.emit('packet', '00', 0);
  return { cube, writes, state };
}

/** The encrypted bytes a real REQUEST_RESET write would carry, for comparison. */
const expectedResetHex = bytesToHex(
  new GanGen4Cipher(MAC).encrypt(buildUnsafeCommand('REQUEST_RESET')),
);

describe('anchorSolved — refuses unless the cube reports solved', () => {
  it('throws when the cube reports an unsolved state', async () => {
    const { cube } = simulateCube(SCRAMBLED);
    await expect(cube.anchorSolved()).rejects.toThrow(/refusing to anchor/i);
  });

  // The critical assertion. A refusal that still transmitted would be worse than
  // no guard, because the error message would say it had not.
  it('sends NO reset packet when it refuses', async () => {
    const { cube, writes } = simulateCube(SCRAMBLED);
    await cube.anchorSolved().catch(() => {});
    await tick();
    expect(writes).not.toContain(expectedResetHex);
  });

  it('names the offending state in the error, so the cause is visible', async () => {
    const { cube } = simulateCube(SCRAMBLED);
    await expect(cube.anchorSolved()).rejects.toThrow(new RegExp(SCRAMBLED));
  });
});

describe('anchorSolved — proceeds when the cube reports solved', () => {
  it('writes exactly the upstream reset packet, encrypted', async () => {
    const { cube, writes } = simulateCube(SOLVED_FACELETS);
    await cube.anchorSolved();
    expect(writes).toContain(expectedResetHex);
  });

  it('resolves with the re-read solved state', async () => {
    const { cube } = simulateCube(SOLVED_FACELETS);
    const after = await cube.anchorSolved();
    expect(after.facelets).toBe(SOLVED_FACELETS);
  });

  it('re-reads the state afterwards rather than assuming the write landed', async () => {
    const { cube, writes } = simulateCube(SOLVED_FACELETS);
    await cube.anchorSolved();
    // Two facelet queries bracket the reset: one to check the precondition, one
    // to re-establish the invariant.
    const queries = writes.filter((w) => w !== expectedResetHex);
    expect(queries.length).toBe(2);
  });
});

describe('anchorSolved — fails loud if the cube ends up elsewhere', () => {
  it('throws when the post-reset state is not solved', async () => {
    const sim = simulateCube(SOLVED_FACELETS);
    // Precondition passes, then the cube comes back scrambled — a cube that did
    // something other than what was asked. Silence here would leave the caller
    // believing it was calibrated.
    let seen = 0;
    const original = sim.state.facelets;
    Object.defineProperty(sim.state, 'facelets', {
      get: () => (seen++ === 0 ? original : SCRAMBLED),
    });
    await expect(sim.cube.anchorSolved()).rejects.toThrow(/anchor failed/i);
  });
});
