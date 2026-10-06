// The catalogue's shape: what the app holds, per dial, per stage, and per effect.
//
//   node bench/alg-catalogue.mjs            report
//   node bench/alg-catalogue.mjs --emit     rewrite test/fixtures/alg-catalogue.mjs
//
// Built the way `bench/algorithm-ledger.mjs` is, and for its reason: the ENTRIES are not copied
// here. They live in `lib/alg-catalogue.js`, computed from the repertoires, and a copy would be a
// second place for an algorithm to be wrong. What this records is the SHAPE — how many, of what
// kind, with which effects — plus one digest over the whole catalogue, so a change to any field of
// any entry fails the test even when it moves no count.
//
// The digest is what makes the census safe to read. A census alone says what changed in the
// dimensions somebody thought to count; the digest says that nothing changed in the ones they did
// not. Neither is enough on its own, so both are emitted.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ALG_ENTRIES, NOT_ALGORITHMS, SET_IDS } from '../lib/alg-catalogue.js';
import { signatureOf } from '../lib/alg-effect.js';

const tally = (items, keyOf) => {
  const out = {};
  for (const item of items) { const k = keyOf(item); out[k] = (out[k] ?? 0) + 1; }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
};

/** Every field of every entry, in a fixed order, as the bytes the digest is taken over. A field
 *  added to an entry and not added here would be invisible to the digest, so the key list is read
 *  off the entry rather than written down. */
function canonical(entries) {
  return JSON.stringify(entries.map((e) => Object.fromEntries(
    Object.keys(e).sort().map((k) => [k, e[k]]),
  )));
}

export function census(entries = ALG_ENTRIES) {
  const signatures = tally(entries, (e) => signatureOf(e.effect));
  return {
    count: entries.length,
    byDial: tally(entries, (e) => e.dial),
    byStage: tally(entries, (e) => e.stage),
    byHold: tally(entries, (e) => e.hold),
    provenanceCounts: tally(entries, (e) => String(e.provenance.length)),
    signatures: Object.keys(signatures).length,
    signatureCensus: signatures,
    orders: tally(entries, (e) => String(e.effect.order)),
    moveLengths: {
      shortest: Math.min(...entries.map((e) => e.effect.moves)),
      longest: Math.max(...entries.map((e) => e.effect.moves)),
    },
    sets: SET_IDS,
    notAlgorithms: NOT_ALGORITHMS,
    digest: createHash('sha256').update(canonical(entries)).digest('hex'),
  };
}

const FIXTURE = new URL('../test/fixtures/alg-catalogue.mjs', import.meta.url);
export { FIXTURE };

/**
 * Exactly what `--emit` would write, WITHOUT writing it.
 *
 * Split out so the test can assert the no-op-diff property — emit twice, nothing changes — by
 * comparing this with the file on disk. A test that proved it by actually writing would be a test
 * that edits a tracked file to pass, which is how a stale fixture gets rewritten into agreement
 * instead of being caught.
 */
export function fixtureText() {
  return `// The catalogue's shape. GENERATED — do not hand-edit.
//
//   regenerate: node apps/web/bench/alg-catalogue.mjs --emit
//   re-verify:  node --test apps/web/test/alg-catalogue.test.mjs
//
// The entries themselves are NOT here: they live in lib/alg-catalogue.js, computed from the
// repertoires. This records how many there are, of what kind, with which effects — and a digest
// over every field of every entry, so a change the census cannot see still fails.

export const CATALOGUE_CENSUS = Object.freeze(${JSON.stringify(census(), null, 2)});
`;
}

function emit() {
  const body = fixtureText();
  writeFileSync(FIXTURE, body);
  return body;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--emit')) {
    emit();
    console.log(`wrote ${fileURLToPath(FIXTURE)}`);
  } else {
    const c = census();
    console.log(`${c.count} algorithms, ${c.signatures} distinct effects`);
    console.log('by dial :', JSON.stringify(c.byDial));
    console.log('by stage:', JSON.stringify(c.byStage));
    console.log('orders  :', JSON.stringify(c.orders));
    console.log('digest  :', c.digest);
  }
}

export { emit };
