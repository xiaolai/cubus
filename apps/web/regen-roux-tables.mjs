// Build Roux's shipped distance tables and the manifest that names them.
//
//   node regen-roux-tables.mjs           # writes lib/data/roux/*.bin and lib/data/roux-manifest.js
//   node regen-roux-tables.mjs --check   # builds them and exits 1 if what is on disk differs
//
// The owner's call (2026-10-17): ship them rather than build them on the device, where the first block alone
// was measured at 2.1 s of CPU here and estimated at several seconds on an iPhone 8. `roux-tables.test.mjs`
// runs `--check`'s comparison, so a table cannot drift from the code that defines it.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildRouxTables } from './lib/methods/roux-build.js';

const here = dirname(fileURLToPath(import.meta.url));
const DATA = join(here, 'lib', 'data');
const DIR = join(DATA, 'roux');
const MANIFEST = join(DATA, 'roux-manifest.js');

/** The manifest's source text: every table's file, its code count, its byte length and its checksum. */
export function manifestSource(tables) {
  const rows = tables.map((t) => `  Object.freeze({ id: '${t.id}', file: '${t.id}.bin', codes: ${t.codes}, bytes: ${t.packed.length}, fnv: 0x${t.fnv.toString(16).padStart(8, '0')} }),`);
  return [
    '// GENERATED FILE — do not edit by hand.',
    '//',
    '//   node regen-roux-tables.mjs',
    '//',
    "// The shipped Roux tables (lib/data/roux/*.bin): each one's size and the checksum a loaded copy must match",
    '// (lib/methods/roux-load.js). `roux-tables.test.mjs` rebuilds every table and requires this file and the',
    '// bytes on disk to be what the build makes.',
    '',
    'export const ROUX_TABLES = Object.freeze([',
    ...rows,
    ']);',
    '',
  ].join('\n');
}

/** Whether the files on disk are exactly what `tables` would write. */
export function onDiskMatches(tables) {
  try {
    if (readFileSync(MANIFEST, 'utf8') !== manifestSource(tables)) return false;
    return tables.every((t) => Buffer.compare(readFileSync(join(DIR, `${t.id}.bin`)), Buffer.from(t.packed)) === 0);
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const tables = buildRouxTables();
  if (process.argv.includes('--check')) {
    if (!onDiskMatches(tables)) {
      console.error('regen-roux-tables: the shipped tables are not what the build makes — run node regen-roux-tables.mjs');
      process.exit(1);
    }
    console.log('regen-roux-tables: the shipped tables match the build');
  } else {
    mkdirSync(DIR, { recursive: true });
    for (const t of tables) writeFileSync(join(DIR, `${t.id}.bin`), t.packed);
    writeFileSync(MANIFEST, manifestSource(tables));
    for (const t of tables) console.log(`${t.id}: ${t.codes} codes, ${t.reached} reached, ${t.packed.length} bytes, deepest ${t.deepest}`);
  }
}
