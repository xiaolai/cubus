// A line every few seconds while the CLI waits on the cube — the visible half of AGENTS.md's rule that a
// network call a person is waiting on needs a bound AND a pulse ("either alone still reads as stuck").
//
// The bound already existed: the transport gives up after twelve dead attempts. The pulse did not. On
// 2026-09-17 `monitor` printed "connecting to GAN16ui_C8D3 — keep the cube moving…" and then nothing for
// about twenty seconds while a single `blew sub` waited on the radio, and the person holding the cube
// reported it as not responding. It was working. A retry message would not have helped: there was no
// retry, only one long attempt — so what is printed is time, not attempts.

export interface PulseTimers {
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
  now: () => number;
}

const realTimers: PulseTimers = {
  setInterval: (fn, ms) => {
    const handle = setInterval(fn, ms);
    // A pulse is commentary, and commentary must never be what keeps a finished process alive.
    handle.unref();
    return handle;
  },
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
  now: () => Date.now(),
};

/**
 * Say `line(seconds)` every `everyMs` until the returned function is called. Idempotent to stop: the
 * first report of a connection stops it, and so does a shutdown, in whichever order they come.
 */
export function startPulse(
  say: (line: string) => void,
  line: (seconds: number) => string,
  { everyMs = 5000, timers = realTimers }: { everyMs?: number; timers?: PulseTimers } = {},
): () => void {
  const started = timers.now();
  let handle: unknown = timers.setInterval(() => {
    say(line(Math.round((timers.now() - started) / 1000)));
  }, everyMs);
  return () => {
    if (handle === null) return;
    timers.clearInterval(handle);
    handle = null;
  };
}
