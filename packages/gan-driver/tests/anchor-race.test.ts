// The two races around REQUEST_RESET, found by audit on 2026-09-05.
//
// anchorSolved() reads the cube, checks the reported state, and then sends the one command in the
// protocol that rewrites what "solved" means. Both halves of that sentence hide a gap:
//
//   the cube turns in between   — REQUEST_RESET anchors the position the cube is in when the
//                                 packet LANDS, not the one that was read. A move between the two
//                                 means the check was passed about a different position, and the
//                                 driver and the hardware diverge permanently and silently. No
//                                 later check can catch it: a cube that accepted the command
//                                 reports solved either way.
//   the write never settles     — the reset write had no deadline and no disconnect
//                                 cancellation, so a transport that hung left the anchor waiting
//                                 forever, through a disconnect and past the caller's timeout.
//
// The interleavings are exact rather than approximate: each test places the event in the one
// window that matters — after the pre-read and before the send, or while the send is in flight —
// because the two windows have different honest answers. Before the send, nothing has been
// transmitted and the refusal can say so. After it, the packet is gone and the only truthful
// report is that the anchor is uncertain.
//
// What these cannot establish, as everywhere else in this package: what a physical GAN16 does on
// receipt. The transport is a simulator. See docs/protocol.md.

import { describe, expect, it } from 'vitest';

import { GanCube } from '../src/driver.js';
import { buildUnsafeCommand } from '../src/gen4/commands.js';
import { GanGen4Cipher } from '../src/gen4/crypto.js';
import { SOLVED_FACELETS } from '../src/gen4/facelets.js';
import { bytesToHex } from '../src/hex.js';
import { CAPTURE_MAC, movePacket } from './helpers/packets.js';
import { simulateTransport } from './helpers/simulate-transport.js';

/** The encrypted bytes a real REQUEST_RESET write carries — how a write is recognised below. */
const RESET_HEX = bytesToHex(
  new GanGen4Cipher(CAPTURE_MAC).encrypt(buildUnsafeCommand('REQUEST_RESET')),
);

const tick = () => new Promise((r) => setTimeout(r, 0));

/** Run the event loop until `done()` holds, so a test never depends on a fixed number of ticks. */
async function until(done: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !done(); i++) await tick();
  if (!done()) throw new Error('condition never held');
}

interface AnchorSim {
  /** Emitted alongside the answer to the pre-read, i.e. AFTER the read and BEFORE the send. */
  turnDuringRead?: boolean;
  /**
   * Emitted alongside the answer to the VERIFYING read — after the reset has gone and after the
   * solved report that is supposed to confirm it, but before that read resolves. request() holds
   * an answer until its write completes, so this is the window where a solved report describes a
   * position the cube has already left.
   */
  turnDuringVerify?: boolean;
  /** What the reset write does. Omitted, it completes at once. */
  onReset?: () => Promise<void>;
  reports?: string;
}

/**
 * A cube that answers a state query the way the hardware does. The FACELETS answer is emitted as a
 * decoded event — the same seam anchor-solved.test.ts documents: the decrypt/decode path has its
 * own fixture coverage, and forging a SOLVED frame would exercise that path instead of this one.
 * Moves, by contrast, go in as real encrypted packets, because it is the packet path that has to
 * notice them.
 */
function anchorSim(opts: AnchorSim = {}) {
  const sim = simulateTransport();
  const cube = new GanCube({ mac: CAPTURE_MAC, transport: sim.transport });
  const reported = { facelets: opts.reports ?? SOLVED_FACELETS };
  cube.connect();
  sim.sub.emit('packet', '00', 0); // any packet marks the subscription live
  // Which state query this is: the pre-read that establishes the precondition, or the re-read
  // that verifies the reset. They sit on either side of the write and have different windows.
  let reads = 0;
  sim.onWrite = (_char, hex) => {
    if (hex === RESET_HEX) return opts.onReset ? opts.onReset() : Promise.resolve();
    const verifying = ++reads > 1;
    queueMicrotask(() => {
      cube.emit('facelets', {
        type: 'FACELETS',
        serial: 1,
        timestamp: 0,
        facelets: reported.facelets,
        state: { CP: [], CO: [], EP: [], EO: [] },
      });
      // Same microtask as the answer, so the turn is strictly after the state that was read and
      // strictly before anchorSolved's continuation — the window the refusal is about.
      const turn = verifying ? opts.turnDuringVerify : opts.turnDuringRead;
      if (turn) sim.sub.emit('packet', movePacket(9 + reads), 0);
    });
    return Promise.resolve();
  };
  return { sim, cube, reported };
}

describe('a cube that turns between the read and the send is not anchored', () => {
  it('refuses, and transmits no reset', async () => {
    const { sim, cube } = anchorSim({ turnDuringRead: true });
    await expect(cube.anchorSolved()).rejects.toThrow(/refusing to anchor: the cube turned/i);
    await tick();
    expect(sim.writes).not.toContain(RESET_HEX);
  });

  it('says the cube moved, not that it is unsolved — the causes need different answers', async () => {
    const { cube } = anchorSim({ turnDuringRead: true });
    await expect(cube.anchorSolved()).rejects.toThrow(/nothing was sent/i);
  });

  // `force` vouches for the cube the caller is LOOKING at. A cube that has turned since is not
  // that cube, so the override does not reach this check.
  it('force does not waive it', async () => {
    const { sim, cube } = anchorSim({ turnDuringRead: true });
    await expect(cube.anchorSolved({ force: true })).rejects.toThrow(/the cube turned/i);
    await tick();
    expect(sim.writes).not.toContain(RESET_HEX);
  });

  it('anchors normally when the cube stays still', async () => {
    const { sim, cube } = anchorSim();
    await expect(cube.anchorSolved()).resolves.toMatchObject({ facelets: SOLVED_FACELETS });
    expect(sim.writes).toContain(RESET_HEX);
  });
});

describe('a cube that turns while the reset is in flight is reported, not verified', () => {
  it('rejects as uncertain — the packet has already gone', async () => {
    const { sim, cube } = anchorSim({
      onReset: async () => {
        sim.sub.emit('packet', movePacket(9), 0);
      },
    });
    await expect(cube.anchorSolved()).rejects.toThrow(/anchor uncertain/i);
  });

  it('admits the write happened rather than implying nothing was sent', async () => {
    const { sim, cube } = anchorSim({
      onReset: async () => {
        sim.sub.emit('packet', movePacket(9), 0);
      },
    });
    await cube.anchorSolved().catch(() => {});
    expect(sim.writes).toContain(RESET_HEX);
  });

  it('tells the caller to re-scan, because nothing in the protocol can check it', async () => {
    const { sim, cube } = anchorSim({
      onReset: async () => {
        sim.sub.emit('packet', movePacket(9), 0);
      },
    });
    await expect(cube.anchorSolved()).rejects.toThrow(/untrusted and re-scan/i);
  });
});

// The third window, and the one the read-epoch rule did not reach until 2026-09-05: between the
// FACELETS that verifies the reset and the moment that read resolves. request() holds an answer
// until its write completes, so a MOVE landing in there left anchorSolved() returning a solved
// report about a position the cube had already left — success, from a check that had verified
// nothing. One epoch spans the whole operation now: read, send, verify.
describe('a cube that turns while the reset is being verified has not been verified', () => {
  it('rejects instead of returning the stale solved report', async () => {
    const { cube } = anchorSim({ turnDuringVerify: true });
    await expect(cube.anchorSolved()).rejects.toThrow(/anchor uncertain.*being verified/is);
  });

  it('says the reading is stale, not that the reset failed — the causes need different answers', async () => {
    const { cube } = anchorSim({ turnDuringVerify: true });
    await expect(cube.anchorSolved()).rejects.toThrow(/untrusted and re-scan/i);
    await expect(cube.anchorSolved()).rejects.not.toThrow(/did not report a solved state/i);
  });

  // The reset itself was sent and may well have landed correctly — what is unknown is only
  // whether the read back proves it. The message must not imply nothing happened.
  it('does not claim nothing was sent', async () => {
    const { sim, cube } = anchorSim({ turnDuringVerify: true });
    await cube.anchorSolved().catch(() => {});
    expect(sim.writes).toContain(RESET_HEX);
  });
});

describe('the reset write has a deadline and dies with the link', () => {
  /** A reset write that never settles — a transport wedged mid-write. */
  const hangs = () => new Promise<void>(() => {});

  it('a disconnect fails it now rather than leaving it pending forever', async () => {
    const { sim, cube } = anchorSim({ onReset: hangs });
    const pending = cube.anchorSolved({ timeoutMs: 5000 });
    await until(() => sim.writes.includes(RESET_HEX));
    cube.disconnect();
    await expect(pending).rejects.toThrow(/REQUEST_RESET abandoned.*disconnect/is);
  });

  it('gives up at the caller’s deadline instead of waiting on a wedged write', async () => {
    const { cube } = anchorSim({ onReset: hangs });
    await expect(cube.anchorSolved({ timeoutMs: 30 })).rejects.toThrow(
      /REQUEST_RESET abandoned.*did not complete within 30 ms/is,
    );
  });

  // The write cannot be recalled, so the message must not read as "nothing happened" — that is
  // the one conclusion that would let a caller keep trusting its tracked state.
  it('says the packet may still have landed', async () => {
    const { cube } = anchorSim({ onReset: hangs });
    await expect(cube.anchorSolved({ timeoutMs: 30 })).rejects.toThrow(
      /may still have reached the cube/i,
    );
  });

  it('a write that fails outright still surfaces its own error', async () => {
    const { cube } = anchorSim({
      onReset: () => Promise.reject(new Error('write failed: characteristic not writable')),
    });
    await expect(cube.anchorSolved({ timeoutMs: 500 })).rejects.toThrow(/write failed/);
  });
});
