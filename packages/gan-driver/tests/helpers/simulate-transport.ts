// A Transport with no cube behind it, for the driver tests that are about the driver.
//
// One subscription emitter is handed back to every subscribe() call, because a real cube has one
// FFF6 characteristic — that is what makes a second connect() observable as doubled delivery
// rather than as two independent streams. Writes are recorded and their completion is the test's
// to control: `onWrite` can delay or reject, which is how the write/notification ordering the
// driver depends on gets exercised without hardware.

import { EventEmitter } from 'node:events';
import type { Transport } from '../../src/transport/blew.js';

export interface SimulatedTransport {
  transport: Transport;
  /** The one subscription every subscribe() returns. Emit 'packet' on it to feed the driver. */
  sub: EventEmitter;
  /** Hex payloads written to the command characteristic, in order. */
  writes: string[];
  /** How many subscriptions the driver asked for — one per connect() that did anything. */
  subscribes: number;
  disconnects: number;
  /** What a write does before it completes. Replace to delay or to fail. */
  onWrite: (charUuid: string, hex: string) => Promise<void>;
}

export function simulateTransport(): SimulatedTransport {
  const sub = new EventEmitter();
  const sim: SimulatedTransport = {
    sub,
    writes: [],
    subscribes: 0,
    disconnects: 0,
    onWrite: () => Promise.resolve(),
    transport: {
      subscribe: () => {
        sim.subscribes++;
        return sub;
      },
      read: () => Promise.resolve(''),
      write: async (charUuid, hex) => {
        sim.writes.push(hex);
        await sim.onWrite(charUuid, hex);
      },
      disconnect: () => {
        sim.disconnects++;
      },
    },
  };
  return sim;
}
