// The session around the packets: connecting, disconnecting, and what an active request is
// allowed to believe.
//
// Three separate defects, found by audit on 2026-09-05, all of the same shape — the driver
// treating a step as done because something ELSE happened:
//
//   connect() twice   installed a second set of listeners on the same subscription, so every
//                     packet decoded twice and every move arrived twice.
//   disconnect()      left `live` true, so the next active request skipped the readiness barrier
//                     and wrote a command to a transport that was already torn down.
//   request()         resolved on the next matching notification whether or not the write that
//                     asked for it had succeeded. The cube emits FACELETS ~1 Hz on its own, so a
//                     write that failed outright still produced a successful getState() — and
//                     that is exactly the pre-read anchorSolved() uses as its readiness barrier
//                     before REQUEST_RESET, the one command that can permanently desync the
//                     driver from the cube.

import { describe, expect, it } from 'vitest';

import { GanCube } from '../src/driver.js';
import { buildUnsafeCommand } from '../src/gen4/commands.js';
import { GanGen4Cipher } from '../src/gen4/crypto.js';
import { bytesToHex } from '../src/hex.js';
import {
  CAPTURE_MAC,
  corruptFaceletsPacket,
  faceletsPacket,
  movePacket,
  unknownPacket,
} from './helpers/packets.js';
import { simulateTransport } from './helpers/simulate-transport.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

/** A connected driver whose subscription has already delivered a packet, so it is live. */
function connected() {
  const sim = simulateTransport();
  const cube = new GanCube({ mac: CAPTURE_MAC, transport: sim.transport });
  cube.connect();
  // onPacket marks the subscription live before it validates framing, so a short frame is enough.
  sim.sub.emit('packet', '00', 0);
  return { sim, cube };
}

describe('connect() is idempotent', () => {
  it('a second connect() does not double the move stream', () => {
    const sim = simulateTransport();
    const cube = new GanCube({ mac: CAPTURE_MAC, transport: sim.transport });
    cube.connect();
    cube.connect();
    const moves: number[] = [];
    cube.onMove((m) => moves.push(m.serial));
    sim.sub.emit('packet', movePacket(7), 0);
    expect(moves).toEqual([7]);
  });

  it('asks the transport for one subscription, not one per call', () => {
    const sim = simulateTransport();
    const cube = new GanCube({ mac: CAPTURE_MAC, transport: sim.transport });
    cube.connect();
    cube.connect();
    cube.connect();
    expect(sim.subscribes).toBe(1);
  });

  it('a disconnected driver can connect again, with a fresh subscription', () => {
    const { sim, cube } = connected();
    cube.disconnect();
    cube.connect();
    expect(sim.subscribes).toBe(2);
    const moves: number[] = [];
    cube.onMove((m) => moves.push(m.serial));
    sim.sub.emit('packet', movePacket(7), 0);
    expect(moves).toEqual([7]);
  });

  it('stops decoding packets once disconnected', () => {
    const { sim, cube } = connected();
    const moves: number[] = [];
    cube.onMove((m) => moves.push(m.serial));
    cube.disconnect();
    sim.sub.emit('packet', movePacket(7), 0);
    expect(moves).toEqual([]);
    expect(sim.disconnects).toBe(1);
  });
});

describe('readiness does not survive the link', () => {
  it('an active request after disconnect() waits for readiness instead of writing', async () => {
    const { sim, cube } = connected();
    cube.disconnect();
    await expect(cube.getState({ active: true, timeoutMs: 30 })).rejects.toThrow(
      /subscription to go live/i,
    );
    // The point of the barrier: nothing was written to a transport that is gone.
    expect(sim.writes).toEqual([]);
  });

  it('a request in flight when the link drops is rejected, not left waiting', async () => {
    const { cube } = connected();
    const pending = cube.getState({ timeoutMs: 2000 });
    cube.disconnect();
    await expect(pending).rejects.toThrow(/disconnect/i);
  });

  it('a subscription that closes clears readiness and rejects what was waiting', async () => {
    const { sim, cube } = connected();
    const pending = cube.getState({ timeoutMs: 2000 });
    sim.sub.emit('close', 0);
    await expect(pending).rejects.toThrow(/subscription closed/i);
    await expect(cube.getState({ active: true, timeoutMs: 30 })).rejects.toThrow(
      /subscription to go live/i,
    );
    expect(sim.writes).toEqual([]);
  });
});

describe('an active request waits for its own write', () => {
  it('rejects when the write fails, even though the cube answered meanwhile', async () => {
    const { sim, cube } = connected();
    sim.onWrite = () => {
      // The cube's periodic state notification lands while the write is still in flight — this
      // is the ~1 Hz stream, not an answer to anything.
      sim.sub.emit('packet', faceletsPacket(), 0);
      return Promise.reject(new Error('write failed: characteristic not writable'));
    };
    await expect(cube.getState({ active: true, timeoutMs: 500 })).rejects.toThrow(/write failed/);
  });

  it('holds an early answer until the write completes, rather than dropping it', async () => {
    const { sim, cube } = connected();
    let release!: () => void;
    sim.onWrite = () => {
      sim.sub.emit('packet', faceletsPacket(), 0);
      return new Promise<void>((r) => {
        release = r;
      });
    };
    const pending = cube.getState({ active: true, timeoutMs: 2000 });
    // The notification has already arrived; the write has not finished. Nothing may resolve yet.
    expect(await Promise.race([pending.then(() => 'resolved'), tick().then(() => 'waiting')])).toBe(
      'waiting',
    );
    release();
    await expect(pending).resolves.toMatchObject({ type: 'FACELETS' });
  });

  it('a passive read still resolves on the notification alone — there is no write to wait for', async () => {
    const { sim, cube } = connected();
    const pending = cube.getState({ timeoutMs: 2000 });
    sim.sub.emit('packet', faceletsPacket(), 0);
    await expect(pending).resolves.toMatchObject({ type: 'FACELETS' });
    expect(sim.writes).toEqual([]);
  });
});

// The other half of holding an early answer: how long it stays valid. A respawn deliberately does
// NOT fail what is waiting — the link is coming back and the cube emits FACELETS ~1 Hz on its own,
// so failing there would turn a recoverable respawn into an error every caller has to handle. But
// a reading taken before the break belongs to a session that has ended, and the write completing
// afterwards delivered it anyway: reproduced 2026-09-05, getState() resolving with the old
// session's facelets while `live` was already false.
describe('an answer does not outlive the link it arrived on', () => {
  it('drops a held answer when the link respawns, and waits for the new one', async () => {
    const { sim, cube } = connected();
    let release!: () => void;
    sim.onWrite = () => {
      sim.sub.emit('packet', faceletsPacket(1), 0); // the old session answers
      return new Promise<void>((r) => {
        release = r;
      });
    };
    const pending = cube.getState({ active: true, timeoutMs: 2000 });
    await tick();

    sim.sub.emit('reconnecting'); // the subprocess respawned; the cube may have slept in between
    release(); // …and only now does the write that was outstanding complete
    expect(await Promise.race([pending.then(() => 'resolved'), tick().then(() => 'waiting')])).toBe(
      'waiting',
    );

    // The link's own reading is what answers it — not the one from before the break.
    sim.sub.emit('packet', faceletsPacket(2), 0);
    await expect(pending).resolves.toMatchObject({ type: 'FACELETS', serial: 2 });
  });

  // The respawn must stay recoverable: dropping the stale answer is not the same as failing the
  // request, and turning one into the other would be the cure the comment in connect() refuses.
  it('does not reject on the respawn itself', async () => {
    const { sim, cube } = connected();
    const pending = cube.getState({ timeoutMs: 2000 });
    sim.sub.emit('reconnecting');
    sim.sub.emit('packet', faceletsPacket(3), 0);
    await expect(pending).resolves.toMatchObject({ type: 'FACELETS', serial: 3 });
  });

  it('times out saying what it was waiting for rather than answering from the old session', async () => {
    const { sim, cube } = connected();
    let release!: () => void;
    sim.onWrite = () => {
      sim.sub.emit('packet', faceletsPacket(1), 0);
      return new Promise<void>((r) => {
        release = r;
      });
    };
    const pending = cube.getState({ active: true, timeoutMs: 40 });
    await tick();
    sim.sub.emit('reconnecting');
    release();
    await expect(pending).rejects.toThrow(/timeout waiting for facelets/);
  });
});

// A frame that decrypts and then will not decode. decodeGen4 sat one line BELOW the catch, so the
// throw came out of a transport notification callback, past every caller — in the CLI's monitor
// and raw commands, straight out of the process. The recorder learned this on 2026-09-05
// (capture.ts, decodePacket); the driver had the same line and no test.
describe('a packet the decoder cannot read is an error event, not a thrown exception', () => {
  it('emits error instead of throwing through the transport callback', () => {
    const { sim, cube } = connected();
    const errors: unknown[] = [];
    cube.on('error', (e) => errors.push(e));
    expect(() => sim.sub.emit('packet', corruptFaceletsPacket(), 5)).not.toThrow();
    expect(errors).toHaveLength(1);
  });

  it('keeps decoding afterwards — one bad frame is not the end of the stream', () => {
    const { sim, cube } = connected();
    cube.on('error', () => {});
    const moves: number[] = [];
    cube.onMove((m) => moves.push(m.serial));
    sim.sub.emit('packet', corruptFaceletsPacket(), 5);
    sim.sub.emit('packet', movePacket(7), 6);
    expect(moves).toEqual([7]);
  });
});

// The move counter is the cube's, and the cube may restart it — a GAN16 stops advertising ~1 s
// after coming to rest, so a link that respawns has often been through a sleep. The baseline used
// to outlive the link: the cube counted from zero again, every serial read as BEHIND the old
// baseline, acceptMove refused it, and a refusal never advances the counter either — so every
// move the cube made from then on was refused, permanently, with nothing able to repair it.
//
// The fix is not "rebase on any break", which would cost the other half. A counter that ADVANCED
// across the break is moves made while the link was down, and that is exactly what 'gap' reports.
// Only a counter that went backwards is a restart.
describe('a serial baseline does not outlive its session', () => {
  interface Rebase {
    from: number;
    to: number;
    reason: string;
  }

  /** Watch everything the counter can say about a move: delivered, refused, gapped, rebased. */
  function watch(cube: GanCube) {
    const seen = {
      moves: [] as number[],
      refused: [] as number[],
      gaps: [] as unknown[],
      rebases: [] as Rebase[],
    };
    cube.onMove((m) => seen.moves.push(m.serial));
    cube.on('stale', (s: { serial: number }) => seen.refused.push(s.serial));
    cube.on('gap', (g) => seen.gaps.push(g));
    cube.on('rebase', (r: Rebase) => seen.rebases.push(r));
    return seen;
  }

  it('a counter that restarted across a reconnect is rebased, not refused for good', () => {
    const { sim, cube } = connected();
    const seen = watch(cube);
    for (const s of [5000, 5001]) sim.sub.emit('packet', movePacket(s), 0);
    sim.sub.emit('reconnecting'); // the subprocess respawned; the cube slept in between
    for (const s of [1, 2, 3]) sim.sub.emit('packet', movePacket(s), 0);
    expect(seen.moves).toEqual([5000, 5001, 1, 2, 3]);
    expect(seen.refused).toEqual([]);
  });

  // A baseline the driver moves on its own is still a decision about the move stream, and the
  // rule that keeps a refused move visible applies to it too.
  it('announces the rebase rather than adopting the new counter in silence', () => {
    const { sim, cube } = connected();
    const seen = watch(cube);
    sim.sub.emit('packet', movePacket(5001), 0);
    sim.sub.emit('reconnecting');
    sim.sub.emit('packet', movePacket(1), 0);
    expect(seen.rebases).toEqual([{ from: 5001, to: 1, reason: 'counter-restart' }]);
    expect(seen.gaps).toEqual([]);
  });

  it('an explicit disconnect and reconnect ends the session too', () => {
    const { sim, cube } = connected();
    sim.sub.emit('packet', movePacket(5000), 0);
    cube.disconnect();
    cube.connect();
    sim.sub.emit('packet', '00', 0);
    const seen = watch(cube);
    sim.sub.emit('packet', movePacket(1), 0);
    expect(seen.moves).toEqual([1]);
  });

  // The FACELETS half of the same question: the cube emits state ~1 Hz, so after a reconnect one
  // usually arrives before any turn does, and it carries the counter.
  it('a FACELETS serial rebases before any move arrives', () => {
    const { sim, cube } = connected();
    sim.sub.emit('packet', movePacket(5000), 0);
    sim.sub.emit('reconnecting');
    sim.sub.emit('packet', faceletsPacket(2), 0); // the cube is counting from 2 again
    const seen = watch(cube);
    sim.sub.emit('packet', movePacket(3), 0);
    expect(seen.moves).toEqual([3]);
    expect(seen.refused).toEqual([]);
  });

  // The half a blanket rebase would have destroyed. Moves made while the link was down are the
  // signal the app uses to decide its tracking is broken and ask for a camera scan.
  it('a counter that survived the break still reports the gap across it', () => {
    const { sim, cube } = connected();
    const seen = watch(cube);
    sim.sub.emit('packet', movePacket(10), 0);
    sim.sub.emit('reconnecting');
    sim.sub.emit('packet', movePacket(13), 0);
    expect(seen.moves).toEqual([10, 13]);
    expect(seen.gaps).toEqual([{ missing: 2, from: 10, to: 13 }]);
    expect(seen.rebases).toEqual([]);
  });

  // A repeated frame is a repeated frame under either reading, and refusing it locks nothing out
  // — the next move still advances. Only a counter that went BACKWARDS is unrecoverable.
  it('a duplicate across the break is still refused', () => {
    const { sim, cube } = connected();
    const seen = watch(cube);
    sim.sub.emit('packet', movePacket(10), 0);
    sim.sub.emit('reconnecting');
    sim.sub.emit('packet', movePacket(10), 0);
    expect(seen.moves).toEqual([10]);
    expect(seen.refused).toEqual([10]);
    expect(seen.rebases).toEqual([]);
  });

  it('nothing is rebased within one unbroken session', () => {
    const { sim, cube } = connected();
    const seen = watch(cube);
    for (const s of [10, 9, 11]) sim.sub.emit('packet', movePacket(s), 0);
    expect(seen.moves).toEqual([10, 11]);
    expect(seen.refused).toEqual([9]);
    expect(seen.rebases).toEqual([]);
  });
});

// 'giveup' is the transport saying it has stopped retrying. It used to be only announced, which
// left two things behind: requests waiting on a link that will never deliver again, and a
// subscription the driver still believed it held — so connect() saw itself as connected and
// returned without resubscribing, making an explicit reconnect a no-op.
describe('a transport that gives up is terminal, and is handled as such', () => {
  const gaveUp = () => new Error('gave up reconnecting to CUBE after 12 attempts with no data');

  it('fails what was waiting instead of leaving it to time out', async () => {
    const { sim, cube } = connected();
    const pending = cube.getState({ timeoutMs: 5000 });
    sim.sub.emit('giveup', gaveUp());
    await expect(pending).rejects.toThrow(/gave up reconnecting/i);
  });

  it('releases the subscription, so an explicit connect() actually resubscribes', () => {
    const { sim, cube } = connected();
    sim.sub.emit('giveup', gaveUp());
    cube.connect();
    expect(sim.subscribes).toBe(2);
    const moves: number[] = [];
    cube.onMove((m) => moves.push(m.serial));
    sim.sub.emit('packet', movePacket(7), 0);
    expect(moves).toEqual([7]);
  });

  // Tearing the transport down would set its stopped flag, and the next subscribe() would spawn
  // nothing — taking the retry away instead of handing it back.
  it('does not disconnect the transport it is about to be asked to reuse', () => {
    const { sim } = connected();
    sim.sub.emit('giveup', gaveUp());
    expect(sim.disconnects).toBe(0);
  });

  it('still announces it, once', () => {
    const { sim, cube } = connected();
    const seen: unknown[] = [];
    cube.on('giveup', (e) => seen.push(e));
    sim.sub.emit('giveup', gaveUp());
    expect(seen).toHaveLength(1);
  });

  it('drops readiness, so the next active request waits rather than writing into nothing', async () => {
    const { sim, cube } = connected();
    sim.sub.emit('giveup', gaveUp());
    await expect(cube.getState({ active: true, timeoutMs: 30 })).rejects.toThrow(
      /subscription to go live/i,
    );
    expect(sim.writes).toEqual([]);
  });
});

describe('an unrecognised event is announced once', () => {
  it('emits unknown a single time per packet', () => {
    const { sim, cube } = connected();
    let unknowns = 0;
    let events = 0;
    cube.on('unknown', () => unknowns++);
    cube.on('event', () => events++);
    sim.sub.emit('packet', unknownPacket(), 0);
    expect(unknowns).toBe(1);
    expect(events).toBe(1);
  });

  it('still announces a frame of the wrong length, once', () => {
    const { sim, cube } = connected();
    const seen: { reason?: string }[] = [];
    cube.on('unknown', (u: { reason?: string }) => seen.push(u));
    sim.sub.emit('packet', 'abcd', 0);
    expect(seen).toEqual([{ reason: 'bad-length', rawHex: 'abcd', timestamp: 0 }]);
  });
});

// What the two-condition rule is FOR. anchorSolved() reads the cube before it sends REQUEST_RESET,
// and that read is the barrier proving the channel works — the cube's own ~1 Hz state stream used
// to satisfy it, so a pre-read whose write never landed still let the most destructive command in
// the protocol through.
describe('the barrier anchorSolved takes before REQUEST_RESET', () => {
  it('a failed pre-read write stops the anchor, and nothing is reset', async () => {
    const { sim, cube } = connected();
    sim.onWrite = () => {
      sim.sub.emit('packet', faceletsPacket(), 0);
      return Promise.reject(new Error('write failed: characteristic not writable'));
    };
    await expect(cube.anchorSolved({ timeoutMs: 500 })).rejects.toThrow(/write failed/);
    const reset = bytesToHex(
      new GanGen4Cipher(CAPTURE_MAC).encrypt(buildUnsafeCommand('REQUEST_RESET')),
    );
    expect(sim.writes).not.toContain(reset);
  });
});
