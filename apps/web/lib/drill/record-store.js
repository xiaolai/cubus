// Where the practice record lives: one IndexedDB database holding one entry, the whole record (lib/drill/record.js).
//
// WHY INDEXEDDB. A `readwrite` transaction is a step no other window can cut into: the browser runs readwrite
// transactions on one object store one at a time, across every window of the origin, each after the ones created
// before it. So `update(fn)` reads the record, decides and writes as ONE step, and two windows saving at once are
// two steps, one after the other — there is nothing to merge. The localStorage record this replaces had no such
// step: each window wrote from its own copy, and every repair of crossed writes was found wrong in turn.
//
// THE SEAM. lib/drill/record.js asks a store for `get`, `update`, `problem`, `listen` and `close`, and nothing
// else; the node tests hand it a store in memory with the same contract (test/fixtures/memory-store.mjs), and
// test/browser/practice-record.test.mjs holds this one to it in both engines.
//
// FAIL LOUD. Every way the database is out of reach is a STATE (`problem()`), told to the one listener when it
// changes, never swallowed:
//
//   unavailable  the open failed: no IndexedDB, a newer version of the app has upgraded the database (VersionError),
//                or the browser refused it
//   blocked      an upgrade waits on another connection that does not close
//   closed       this connection was closed: another context deleted or upgraded the database (`versionchange` —
//                this connection lets go at once, as every connection must for that to proceed), or the browser
//                closed it (clear site data)
//
// and the next operation opens the database again, which clears the state when it succeeds. An operation that
// could not finish rejects with a PracticeRecordError: `unreadable` for a read that failed, `write-failed` for a
// write that did not commit — a full quota among them, its cause kept — and the connection's code when there was
// no connection. A write is resolved only at the transaction's `complete`, asked for with `durability: 'strict'`.
import { PracticeRecordError } from './record.js';

/** The database, its object store, and the one key in it whose value is the whole record. */
export const RECORD_DB = 'cubusPractice';
export const RECORD_STORE = 'record';
export const RECORD_ENTRY = 'record';

const WRITE = { durability: 'strict' };

/**
 * The practice record's store over an injected IndexedDB factory (the page's `indexedDB`).
 *
 * @param {IDBFactory|undefined} indexedDB
 * @param {{ name?: string, version?: number }} [o]  another name or version — for tests only
 */
export function indexedDbStore(indexedDB, { name = RECORD_DB, version = 1 } = {}) {
  let db = null;          // the open connection
  let opening = null;     // the open in flight — rejected, and still in flight, while it is blocked
  let problem = null;
  let listener = null;
  let shut = false;       // closed by its owner: nothing opens again

  const say = (error) => {
    const changed = (problem?.code ?? null) !== (error?.code ?? null);
    problem = error;
    if (changed) listener?.();
  };
  /** The connection went: said, unless a newer one has already replaced it. */
  const lose = (connection, error) => {
    if (db !== connection) return;
    db = null;
    say(error);
  };
  const unavailable = (cause) => new PracticeRecordError('unavailable',
    cause?.name === 'VersionError'
      ? 'the practice record was changed by a newer version of the app, so this one cannot use it — reload the app'
      : `the practice record could not be opened${cause?.message ? ` (${cause.message})` : ''}`, cause);

  const connect = () => {
    if (shut) return Promise.reject(new PracticeRecordError('closed', 'the practice record was closed by this page'));
    if (db) return Promise.resolve(db);
    if (opening) return opening;
    let request;
    try {
      if (typeof indexedDB?.open !== 'function') throw new Error('this browser offers no IndexedDB');
      request = indexedDB.open(name, version);
    } catch (e) {
      const error = unavailable(e);
      say(error);
      return Promise.reject(error);
    }
    opening = new Promise((resolve, reject) => {
      request.onupgradeneeded = () => {
        const upgrading = request.result;
        if (!upgrading.objectStoreNames.contains(RECORD_STORE)) upgrading.createObjectStore(RECORD_STORE);
      };
      // Operations fail at once while the open waits; if it is let through later, its connection is taken up then.
      request.onblocked = () => {
        const error = new PracticeRecordError('blocked', 'the practice record is waiting for another window of the app to let go of it');
        say(error);
        reject(error);
      };
      request.onerror = () => {
        opening = null;
        const error = unavailable(request.error);
        say(error);
        reject(error);
      };
      request.onsuccess = () => {
        const connection = request.result;
        opening = null;
        if (shut) { connection.close(); return; }
        connection.onversionchange = (event) => {
          connection.close();
          lose(connection, new PracticeRecordError('closed', event.newVersion === null
            ? 'the practice record was deleted in another window or by the browser'
            : 'a newer version of the app asked for the practice record, so this page let go of it'));
        };
        connection.onclose = () => lose(connection, new PracticeRecordError('closed', 'the browser closed the practice record (its site data may have been cleared)'));
        db = connection;
        say(null);
        resolve(connection);
      };
    });
    return opening;
  };

  /** A transaction on the store, or the reason there is none. Made in the same task as its first request. */
  const begin = (connection, mode) => {
    try {
      return mode === 'readwrite' ? connection.transaction(RECORD_STORE, mode, WRITE) : connection.transaction(RECORD_STORE, mode);
    } catch (e) {
      // A connection closing under a versionchange refuses new transactions (InvalidStateError).
      if (e?.name === 'InvalidStateError') {
        const error = new PracticeRecordError('closed', 'the practice record was being closed', e);
        lose(connection, error);
        throw error;
      }
      throw unavailable(e);
    }
  };

  return Object.freeze({
    /** The stored value, or undefined when none is stored. */
    async get() {
      const connection = await connect();
      const tx = begin(connection, 'readonly');
      return new Promise((resolve, reject) => {
        const request = tx.objectStore(RECORD_STORE).get(RECORD_ENTRY);
        tx.oncomplete = () => resolve(request.result);
        tx.onabort = () => reject(new PracticeRecordError('unreadable', 'the practice record could not be read', tx.error));
      });
    },

    /**
     * One readwrite transaction: `fn(value)` — the stored value, or undefined — returns `{ value, result }`, and
     * `value` (unless undefined) is written in the same transaction. Resolves to `result` once the transaction has
     * COMMITTED. Anything `fn` throws aborts the transaction, so nothing is written, and is what this rejects with.
     */
    async update(fn) {
      const connection = await connect();
      const tx = begin(connection, 'readwrite');
      return new Promise((resolve, reject) => {
        const store = tx.objectStore(RECORD_STORE);
        const read = store.get(RECORD_ENTRY);
        let outcome = null;
        let failed = null;   // why this transaction was aborted from here: what `fn` threw, or a put refused
        const abort = (error) => { failed = error; tx.abort(); };
        read.onsuccess = () => {
          let decided;
          try { decided = fn(read.result); } catch (e) { abort(e); return; }
          if (decided.value !== undefined) {
            // A put can refuse at once: a value that cannot be cloned, a quota already known to be spent.
            try { store.put(decided.value, RECORD_ENTRY); } catch (e) {
              abort(new PracticeRecordError('write-failed', 'the practice record could not be written', e));
              return;
            }
          }
          outcome = decided;
        };
        tx.oncomplete = () => resolve(outcome.result);
        tx.onabort = () => reject(failed ?? (outcome === null
          ? new PracticeRecordError('unreadable', 'the practice record could not be read', tx.error)
          : new PracticeRecordError('write-failed', 'the practice record could not be written', tx.error)));
      });
    },

    /** Why the database is out of reach now (`unavailable`, `blocked`, `closed`), or null. */
    problem: () => problem,

    /** `fn` is called whenever `problem()` changes to another code. One listener: the record that owns this store. */
    listen(fn) { listener = fn; },

    /** Let go of the database for good. */
    close() {
      shut = true;
      listener = null;
      db?.close();
      db = null;
    },
  });
}
