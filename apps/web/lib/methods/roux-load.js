// Roux's tables, loaded: the shipped files read and checked, the small ones built, all held for the session.
//
// Asynchronous because a file is: a worker fetches it, node reads it. SOLVING stays synchronous — the driver
// and every stage are — so the lesson worker awaits `prepareRoux()` before it solves, and a stage that runs
// before then throws rather than building a table on the spot (the owner's call, 2026-10-17: the tables ship).
//
// A loaded table is checked before it is trusted: its length against the manifest, and its bytes against the
// manifest's checksum. A short or corrupted file would otherwise give descents that wander, refused only after
// a whole stage had been worked out.

import { ROUX_TABLES } from '../data/roux-manifest.js';
import { buildSideTables } from './roux-build.js';
import { fnv1a } from './roux-tables.js';

let loaded = null;
let loading = null;

/** The bytes of a shipped table, from a page or worker by fetch, from node by its file. */
async function readShipped(file) {
  const url = new URL(`../data/roux/${file}`, import.meta.url);
  if (url.protocol === 'file:') {
    const { readFile } = await import('node:fs/promises');
    return new Uint8Array(await readFile(url));
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`roux-load: ${file} answered ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** One table's bytes, or a throw naming what is wrong with them. */
export function checkedTable(row, bytes) {
  if (bytes.length !== row.bytes) throw new Error(`roux-load: ${row.file} is ${bytes.length} bytes, not ${row.bytes}`);
  const fnv = fnv1a(bytes);
  if (fnv !== row.fnv) throw new Error(`roux-load: ${row.file} does not match its checksum`);
  return bytes;
}

/**
 * Load every table once, and the same promise for every caller while it loads. A failure is not remembered:
 * the next call tries again, so one dropped fetch does not take Roux away for the session. `read` is
 * injected by the tests.
 */
export function prepareRoux({ read = readShipped } = {}) {
  if (loaded) return Promise.resolve(loaded);
  loading ??= (async () => {
    const shipped = {};
    for (const row of ROUX_TABLES) shipped[row.id] = checkedTable(row, await read(row.file));
    const built = buildSideTables();
    loaded = Object.freeze({ ...shipped, sides: built.sides, finish: built.finish });
    return loaded;
  })().finally(() => { loading = null; });
  return loading;
}

/** The loaded tables, or a throw: a Roux stage reached before `prepareRoux()` finished is a caller's defect. */
export function rouxTables() {
  if (!loaded) throw new Error('roux-load: the Roux tables are not loaded — await prepareRoux() before solving');
  return loaded;
}

/** For tests only: forget what was loaded, so a test of loading starts cold. */
export function forgetRouxTables() {
  loaded = null;
}
