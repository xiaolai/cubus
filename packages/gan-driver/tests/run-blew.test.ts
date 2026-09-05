// Running the `blew` binary, and what its exit status is allowed to mean.
//
// `gan16 inspect` shells out five times — a GATT tree and four characteristic reads — and until
// 2026-09-05 it looked at none of the results: the wrapper resolved on 'close' whatever the status
// was, so a read that failed printed its error to the inherited stderr and was then reported as
// part of a successful dump. With no 'error' listener it was worse than that: a missing or
// unexecutable binary threw asynchronously, past the command's own catch, as an uncaught
// exception with no useful message.
//
// The tests use /bin/sh rather than blew, which is the point — the property is about a child
// process's status, and blew itself needs a cube. `bin` exists on the wrapper for exactly this.

import { describe, expect, it } from 'vitest';

import { runBlew } from '../src/transport/blew.js';

describe('runBlew — a non-zero exit is a failure, not a finished command', () => {
  it('resolves on a clean exit', async () => {
    await expect(runBlew(['-c', 'exit 0'], '/bin/sh')).resolves.toBeUndefined();
  });

  it('rejects on a non-zero exit, naming the status', async () => {
    await expect(runBlew(['-c', 'exit 3'], '/bin/sh')).rejects.toThrow(/exited 3/);
  });

  it('rejects when the process is killed by a signal', async () => {
    await expect(runBlew(['-c', 'kill -TERM $$'], '/bin/sh')).rejects.toThrow(/killed by SIGTERM/);
  });

  // The uncaught-exception path: spawn reports this on the child, not by throwing, so with no
  // 'error' listener it escaped every catch in the CLI.
  it('rejects when the binary is not there, and says how to install it', async () => {
    await expect(runBlew(['gatt', 'tree'], '/nonexistent/blew')).rejects.toThrow(
      /could not run \/nonexistent\/blew.*brew install stass\/tap\/blew/s,
    );
  });
});
