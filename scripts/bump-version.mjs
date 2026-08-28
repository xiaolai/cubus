#!/usr/bin/env node
// Bump the app's version everywhere it is written — `pnpm bump 0.5.0`.
//
// The web app is a static site with no build step to inject a manifest's version into, so the
// number the About card shows is a constant in apps/web/lib/app.js — and the same number sits in
// four manifests and the Cargo lockfile beside it. A test ("every manifest carries the same
// version the app displays", apps/web/test/router-wiring.test.mjs) fails when any of them
// drifts; this script is how they move together. Exact matches only: every file must carry its
// version line exactly once, or nothing is written and the file is named. No dependencies.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** Where the version is written, relative to the repo root, and the exact line that carries it.
 *  Every pattern is anchored to a whole line so a dependency's `version = "2"` (Cargo.toml, inside
 *  braces) or a nested "version" key (deeper indent) cannot match; the lockfile's is the
 *  `cubus-desktop` entry and no other package's. The three capture groups are (before, version,
 *  after). */
export const SITES = [
  { file: 'apps/web/lib/app.js', re: /^(export const VERSION = ')([^']+)(';)$/m },
  { file: 'apps/web/package.json', re: /^(  "version": ")([^"]+)(",)$/m },
  { file: 'apps/desktop/package.json', re: /^(  "version": ")([^"]+)(",)$/m },
  { file: 'apps/desktop/src-tauri/tauri.conf.json', re: /^(  "version": ")([^"]+)(",)$/m },
  { file: 'apps/desktop/src-tauri/Cargo.toml', re: /^(version = ")([^"]+)(")$/m },
  { file: 'Cargo.lock', re: /^(name = "cubus-desktop"\nversion = ")([^"]+)(")$/m },
];

/**
 * Rewrite every site under `root` to `version`. Reads and checks all six before writing any, so
 * a refusal leaves the tree untouched.
 *
 * @param {string} root  the repo root
 * @param {string} version  MAJOR.MINOR.PATCH, optionally -prerelease
 * @returns {{ to: string, sites: { file: string, from: string }[], changed: string[] }}
 *   what each file said before, and which files were written (none when already at `version`)
 */
export function bump(root, version) {
  if (!SEMVER.test(version)) {
    throw new Error(`not a version: "${version}" — want MAJOR.MINOR.PATCH, optionally -prerelease`);
  }
  const plans = SITES.map(({ file, re }) => {
    const p = path.join(root, file);
    const text = readFileSync(p, 'utf8');
    const matches = [...text.matchAll(new RegExp(re.source, `${re.flags}g`))];
    if (matches.length !== 1) {
      throw new Error(`${file}: expected exactly one version line, found ${matches.length} — nothing written`);
    }
    return { file, p, from: matches[0][2], next: text.replace(re, `$1${version}$3`) };
  });
  const changed = plans.filter((plan) => plan.from !== version);
  for (const plan of changed) writeFileSync(plan.p, plan.next);
  return { to: version, sites: plans.map(({ file, from }) => ({ file, from })), changed: changed.map((plan) => plan.file) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = process.argv[2];
  if (!version || process.argv.length !== 3) {
    console.error('usage: pnpm bump <version>   e.g. pnpm bump 0.5.0');
    process.exit(2);
  }
  const root = fileURLToPath(new URL('..', import.meta.url));
  try {
    const r = bump(root, version);
    for (const { file, from } of r.sites) {
      console.log(`${r.changed.includes(file) ? 'bumped ' : 'already'} ${file}  ${from} → ${r.to}`);
    }
    const before = new Set(r.sites.map((s) => s.from));
    if (before.size > 1) console.log(`note: the files disagreed before this bump (${[...before].join(', ')}); they agree now`);
    if (r.changed.length === 0) console.log(`nothing to do: every file already says ${r.to}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
