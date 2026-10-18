// A practice-record store in memory, with lib/drill/record-store.js's contract, for the node tests.
//
// It keeps what the record relies on IndexedDB for, and nothing more: every window's store over one database runs
// its transactions ONE AT A TIME, in the order they were asked for, each in a later task — so a test can start
// several windows' operations together and they interleave as a browser's would, between transactions and never
// inside one; and a value goes in and comes out as a structured clone, so nothing read can reach what is stored.
// What it cannot show — that IndexedDB itself keeps that contract — test/browser/practice-record.test.mjs shows in
// both engines.
import { PracticeRecordError } from '../../lib/drill/record.js';

/** One origin's database: its value (undefined when none is stored) and how many writes landed in it. */
export function memoryDatabase(value) {
  return { value: value === undefined ? undefined : structuredClone(value), writes: 0, tail: Promise.resolve() };
}

/**
 * One window's connection to `db`. `faults` may be set at any time, each a way the real store fails:
 *
 *   open    a PracticeRecordError code (`unavailable`, `blocked`, `closed`): every operation fails with it and
 *           `problem()` says it, until it is cleared and an operation reaches the database again
 *   read    the read inside the next transactions fails (`unreadable`)
 *   write   the write inside the next transactions fails, as a full quota does (`write-failed`, QuotaExceededError)
 *
 * `closed` counts calls to `close()`; after the first, every transaction asked for is refused (`closed`), as the real
 * store's are, and one already asked for runs to its end.
 */
export function memoryStore(db) {
  let problem = null;
  let listener = null;
  const s = { faults: { open: null, read: false, write: false }, closed: 0, shut: false };
  const say = (error) => {
    const changed = (problem?.code ?? null) !== (error?.code ?? null);
    problem = error;
    if (changed) listener?.();
  };
  const transact = (body) => {
    // As IndexedDB refuses a transaction on a connection its owner has closed — one already made runs to its end.
    if (s.shut) return Promise.reject(new PracticeRecordError('closed', 'the practice record was closed by this page'));
    const step = db.tail.then(() => new Promise((resolve) => setImmediate(resolve))).then(() => {
      if (s.faults.open) {
        const error = new PracticeRecordError(s.faults.open, `the database is ${s.faults.open} (test)`);
        say(error);
        throw error;
      }
      say(null);
      if (s.faults.read) throw new PracticeRecordError('unreadable', 'the read failed (test)', new Error('UnknownError'));
      return body(structuredClone(db.value));
    });
    db.tail = step.then(() => {}, () => {});
    return step;
  };
  return Object.assign(s, {
    get: () => transact((value) => value),
    update: (fn) => transact((value) => {
      const { value: next, result } = fn(value);
      if (next !== undefined) {
        if (s.faults.write) {
          throw new PracticeRecordError('write-failed', 'the write failed (test)', Object.assign(new Error('the quota is spent'), { name: 'QuotaExceededError' }));
        }
        db.value = structuredClone(next);
        db.writes += 1;
      }
      return result;
    }),
    problem: () => problem,
    listen(fn) { listener = fn; },
    close() { s.closed += 1; s.shut = true; listener = null; },
    /** The connection goes, as a versionchange or the browser closing it takes it: said now, and cleared by the
     *  next operation that reaches the database. */
    lose(code = 'closed') { say(new PracticeRecordError(code, `the connection was ${code} (test)`)); },
  });
}
