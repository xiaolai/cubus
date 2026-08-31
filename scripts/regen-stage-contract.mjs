#!/usr/bin/env node
// Regenerate stage-contract.json from the contract document.
//
// The document is not in the repository (it is under dev-docs/, which is gitignored), so its two
// fixture tables are copied here to keep them testable on a machine that has never seen it — CI
// included. The cells are stored VERBATIM rather than parsed into numbers, so that
// stage.test.mjs's document-agreement check can compare the two as plain strings: a parsed copy
// could drift from its source in a way that still parsed.
//
// Run this after editing either table in the document. stage.test.mjs fails when the document is
// present and disagrees with this file, so a forgotten run is caught on the machine that has the
// document — which is the only machine where the edit could have happened.
//
//   node scripts/regen-stage-contract.mjs
//
// It lives in scripts/ and not beside the fixture because `node --test` executes every .mjs
// under apps/web/test/, so a plain script parked there is run as a test file and its non-zero
// exit becomes a suite failure. Found exactly that way.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DOC = fileURLToPath(new URL('../dev-docs/stage-contract.md', import.meta.url));
const OUT = fileURLToPath(new URL('../apps/web/test/fixtures/stage-contract.json', import.meta.url));

if (!existsSync(DOC)) {
  console.error(`${DOC} is not here. This script needs the document; it is gitignored, so a clone will not have it.`);
  process.exit(1);
}

const doc = readFileSync(DOC, 'utf8');
const table = (header) => {
  const start = doc.indexOf(header);
  if (start === -1) throw new Error(`the table header moved: ${header}`);
  return doc
    .slice(start)
    .split('\n\n')[0]
    .split('\n')
    .slice(2)
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
};

const out = {
  _comment:
    'Generated from dev-docs/stage-contract.md. Cells are verbatim so the document and this file ' +
    'can be compared as strings. Regenerate with: node apps/web/test/fixtures/regen-stage-contract.mjs',
  source: 'dev-docs/stage-contract.md',
  devices: table('| Client | Safe content |'),
  desktop: table('| Monitor (logical) | Work area |'),
};
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`${OUT}: ${out.devices.length} device rows, ${out.desktop.length} desktop rows`);
