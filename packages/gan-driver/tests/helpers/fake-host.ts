// The `record` command's hardware, faked — loaded by src/cli.ts only when GAN16_HOST names it.
//
// It lives here rather than in src/ on purpose: the CLI owns one seam and no test double. What it
// hands back is a cube that exists (with the capture fixture's MAC, so the recorder's decrypt and
// decode paths are the real ones) and a transport that emits real captured frames on a timer.
//
// The knobs come from the environment because the CLI under test is a child process, so there is
// nowhere else to put them:
//
//   GAN16_FAKE_DIR      where captures go — a directory the test owns and deletes
//   GAN16_FAKE_PACKETS  how many frames to emit before falling quiet
//   GAN16_FAKE_ENDING   'quiet' (default; the test sends the signal), or 'giveup' (the transport
//                       stops retrying, which the command must treat as a terminal failure)

import { EventEmitter } from 'node:events';
import type { Transport } from '../../src/transport/blew.js';
import { CAPTURE_MAC, movePacket } from './packets.js';

const captures = process.env.GAN16_FAKE_DIR ?? '';
const total = Number(process.env.GAN16_FAKE_PACKETS ?? '20');
const ending = process.env.GAN16_FAKE_ENDING ?? 'quiet';

/** Encrypting a frame costs an AES block, so the stream reuses a small ring of real ones. */
const frames = Array.from({ length: 8 }, (_, i) => movePacket(i + 1));

class FakeTransport implements Transport {
  private readonly sub = new EventEmitter();
  private timer: ReturnType<typeof setInterval> | null = null;
  private sent = 0;

  subscribe(): EventEmitter {
    // On a timer, not inline: the command installs its packet, error and giveup listeners after
    // subscribe() returns, and a burst delivered before them would be a recording the test wrote
    // rather than one the CLI did.
    this.timer = setInterval(() => {
      for (let i = 0; i < 25 && this.sent < total; i++) {
        this.sub.emit('packet', frames[this.sent % frames.length], Date.now());
        this.sent++;
      }
      if (this.sent < total) return;
      this.stopTimer();
      if (ending === 'giveup') {
        this.sub.emit('giveup', new Error('gave up reconnecting to FAKE after 12 attempts'));
      }
    }, 1);
    return this.sub;
  }

  read(): Promise<string> {
    return Promise.resolve('');
  }
  write(): Promise<void> {
    return Promise.resolve();
  }
  disconnect(): void {
    this.stopTimer();
    this.sub.removeAllListeners();
  }
  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export const host = {
  findCube: () =>
    Promise.resolve({ id: 'FAKE-CUBE', name: 'GAN16ui_TEST', mac: CAPTURE_MAC, macOk: true }),
  transport: (): Transport => new FakeTransport(),
  captureDir: () => captures,
};
