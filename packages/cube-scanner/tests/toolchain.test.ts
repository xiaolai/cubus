// The toolchain's one deliberate oddity, held to its reason (2026-09-18).
//
// TypeScript 7 is the native compiler: `tsc` is a platform binary and its JavaScript API is a new
// RPC client. typescript-eslint's type-aware rules are built on the in-process compiler API that 7
// does not have, and even its canary still asks for TypeScript below 6.1. So both TS packages
// type-check with 7, installed under the alias `typescript-7` and called by path (both installs
// are named `tsc`, so `.bin/tsc` could be either), while `typescript` stays at 6.0.x for the lint
// alone. The last case here fails the day typescript-eslint admits 7: the second copy has then
// outlived its reason, and the two collapse back into one `typescript` at 7.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const packages = join(import.meta.dirname, '..', '..');
const read = (...path: string[]) => JSON.parse(readFileSync(join(packages, ...path), 'utf8'));
const major = (version: string) => Number(version.split('.')[0]);

/** The two packages that type-check TypeScript, and so both carry the second install. */
const TS_PACKAGES = ['cube-scanner', 'gan-driver'] as const;

/**
 * The peer range typescript-eslint asks for today, pinned as TEXT.
 *
 * Not evaluated: a hand-rolled range reader is wrong in the ways semver is subtle — unions, carets,
 * inclusive bounds — and the first version of this file called `^6.0.0` an acceptance of 7 and
 * `>=4.8.4 <6.1.0 || >=7.0.0 <8.0.0` a refusal (audit, 2026-09-19). What this file needs is not an
 * evaluator but a tripwire: the day this range is anything else, someone reads it and decides.
 */
const PEER_RANGE = '>=4.8.4 <6.1.0';

describe('the TypeScript toolchain', () => {
  for (const pkg of TS_PACKAGES) {
    it(`${pkg} type-checks with TypeScript 7, called by path`, () => {
      expect(read(pkg, 'package.json').scripts.typecheck).toBe(
        'node node_modules/typescript-7/bin/tsc --noEmit',
      );
      expect(major(read(pkg, 'node_modules', 'typescript-7', 'package.json').version)).toBe(7);
    });

    it(`${pkg} keeps TypeScript 6 only while its typescript-eslint cannot load 7`, () => {
      // Each package is asked for ITSELF: the two can be updated apart, and one of them holding a
      // typescript-eslint that still wants 6 is the whole reason the second install exists (audit,
      // 2026-09-19).
      const range: string = read(pkg, 'node_modules', 'typescript-eslint', 'package.json')
        .peerDependencies.typescript;
      // A change here is news either way: if the range now admits 7, drop `typescript@6`, make
      // `typescript` the 7 install in both packages, point `typecheck` back at plain `tsc`, and
      // delete the alias and this file. If it moved for some other reason, read it and re-pin.
      expect(range, `${pkg}'s typescript-eslint now asks for TypeScript ${range}`).toBe(PEER_RANGE);
      expect(major(read(pkg, 'node_modules', 'typescript', 'package.json').version)).toBe(6);
    });
  }
});
