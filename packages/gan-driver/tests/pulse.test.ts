// The CLI's "still waiting" line. Every case is about a person watching a terminal: silence while the
// cube is being reached reads as a hang (2026-09-17), and a line that keeps coming after the cube has
// answered — or after the command has ended — is noise that hides the reports it was waiting for.

import { describe, expect, it } from 'vitest';
import { type PulseTimers, startPulse } from '../src/pulse.js';

/** Timers a test moves by hand. */
function clock() {
  let now = 0;
  let next = 1;
  const intervals = new Map<number, { fn: () => void; ms: number; due: number }>();
  const timers: PulseTimers = {
    setInterval: (fn, ms) => {
      const id = next++;
      intervals.set(id, { fn, ms, due: now + ms });
      return id;
    },
    clearInterval: (id) => intervals.delete(id as number),
    now: () => now,
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = [...intervals.values()]
        .filter((t) => t.due <= end)
        .sort((a, b) => a.due - b.due)[0];
      if (!due) break;
      now = due.due;
      due.due += due.ms;
      due.fn();
    }
    now = end;
  };
  return { timers, advance, live: () => intervals.size };
}

describe('startPulse', () => {
  it('says how long it has been waiting, every interval, while nothing has answered', () => {
    const { timers, advance } = clock();
    const said: string[] = [];
    startPulse(
      (l) => said.push(l),
      (s) => `waiting ${s} s`,
      { everyMs: 5000, timers },
    );
    advance(4999);
    expect(said).toEqual([]); // not before the first interval: a quick connection says nothing extra
    advance(11_000);
    expect(said).toEqual(['waiting 5 s', 'waiting 10 s', 'waiting 15 s']);
  });

  it('stops for good when stopped, and stopping twice is harmless', () => {
    const { timers, advance, live } = clock();
    const said: string[] = [];
    const stop = startPulse(
      (l) => said.push(l),
      (s) => `waiting ${s} s`,
      { everyMs: 5000, timers },
    );
    advance(5000);
    stop();
    stop(); // the first report and a shutdown can both stop it, in either order
    advance(60_000);
    expect(said).toEqual(['waiting 5 s']);
    expect(live()).toBe(0);
  });

  it('never keeps a finished process alive', () => {
    // The real timer is unref'd: a pulse is commentary, and Node must be free to exit under it. Read
    // off the handle Node actually made, not assumed from the source.
    const real = globalThis.setInterval;
    let made: ReturnType<typeof setInterval> | undefined;
    globalThis.setInterval = ((fn: () => void, ms: number) => {
      made = real(fn, ms);
      return made;
    }) as typeof setInterval;
    try {
      const stop = startPulse(
        () => {},
        () => '',
        { everyMs: 60_000 },
      );
      expect(made?.hasRef()).toBe(false);
      stop();
    } finally {
      globalThis.setInterval = real;
    }
  });
});
