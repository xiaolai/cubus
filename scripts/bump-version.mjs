#!/usr/bin/env node
// Bump the app's version everywhere it is written — `pnpm bump 0.5.0`.
//
// The web app is a static site with no build step to inject a manifest's version into, so the
// number the About card shows is a constant in apps/web/lib/version.js — and the same number sits in
// four manifests and the Cargo lockfile beside it. A test ("every manifest carries the same
// version the app displays", apps/web/test/router-wiring.test.mjs) fails when any of them
// drifts; this script is how they move together. Exact matches only: every file must carry its
// version line exactly once, or nothing is written and the file is named. No dependencies.

import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Bare MAJOR.MINOR.PATCH, spelled as strict SemVer spells it: no leading zero in a number. And no
// pre-release: two of the sites are Apple bundle keys, which take at most three period-separated
// integers, and release.yml refuses to ship one, so a pre-release is a version nowhere this
// writes. (It accepted `01.2.3` and `0.5.0-beta.1` alike, and wrote both into all ten; found by
// audit, 2026-09-13.)
const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;

/** Where the version is written, relative to the repo root, and the exact line that carries it.
 *  Every pattern is anchored to a whole line so a dependency's `version = "2"` (Cargo.toml, inside
 *  braces) or a nested "version" key (deeper indent) cannot match; the lockfile's is the
 *  `cubus-desktop` entry and no other package's. The three capture groups are (before, version,
 *  after). The multi-line prefixes take `\r?\n`, so a CRLF checkout bumps and keeps its endings. */
export const SITES = [
  { file: 'apps/web/lib/version.js', re: /^(export const VERSION = ')([^']+)(';)$/m },
  { file: 'apps/web/package.json', re: /^(  "version": ")([^"]+)(",)$/m },
  { file: 'apps/desktop/package.json', re: /^(  "version": ")([^"]+)(",)$/m },
  { file: 'apps/desktop/src-tauri/tauri.conf.json', re: /^(  "version": ")([^"]+)(",)$/m },
  { file: 'apps/desktop/src-tauri/Cargo.toml', re: /^(version = ")([^"]+)(")$/m },
  { file: 'Cargo.lock', re: /^(name = "cubus-desktop"\r?\nversion = ")([^"]+)(")$/m },
  // The iOS bundle's two, added 2026-08-31 — they were missed by the first cross-platform bump
  // and the iPhone build would have gone to TestFlight reading 0.1.3 while the app said 0.2.0.
  // xcodegen builds Info.plist FROM this file, so this is the source and the plist is an output.
  { file: 'apps/desktop/src-tauri/gen/apple/project.yml', re: /^(        CFBundleShortVersionString: )([^\s]+)()$/m },
  { file: 'apps/desktop/src-tauri/gen/apple/project.yml', re: /^(        CFBundleVersion: ")([^"]+)(")$/m },
  // gen/apple/.../Info.plist is xcodegen's OUTPUT from project.yml above — and it is committed,
  // so it ships whatever it last said until someone regenerates it. AGENTS.md claimed the wiring
  // test asserted both; it did not, and the plist sat at 0.2.0 through a bump to 0.2.1 with every
  // gate green. That is the same defect the iOS pair itself was added for: a bundle reporting a
  // version the app denies. An output that is committed has to be maintained like a source.
  { file: 'apps/desktop/src-tauri/gen/apple/cubus-desktop_iOS/Info.plist',
    re: /^(\t<key>CFBundleShortVersionString<\/key>\r?\n\t<string>)([^<]+)(<\/string>)$/m },
  { file: 'apps/desktop/src-tauri/gen/apple/cubus-desktop_iOS/Info.plist',
    re: /^(\t<key>CFBundleVersion<\/key>\r?\n\t<string>)([^<]+)(<\/string>)$/m },
];

/**
 * Rewrite every site under `root` to `version`. Reads and checks every site before writing any,
 * and stages each new file beside the one it replaces before renaming any into place — so a
 * refusal, a write that fails, or a rename that fails leaves the tree exactly as it was — unless
 * putting a moved file back fails too, and then no file is left empty, nothing is left staged, and
 * the error names every file still at the new version. A crash between two renames can still land
 * part of a bump; nothing short of a filesystem transaction closes that.
 *
 * @param {string} root  the repo root
 * @param {string} version  MAJOR.MINOR.PATCH
 * @param {{ write?: (path: string, text: string) => void }} [io]  the staging and restoring write:
 *   a test seam, so a disk that fills part-way through can be reproduced
 * @returns {{ to: string, sites: { file: string, from: string, bumped: boolean }[],
 *   changed: string[] }}  what each SITE said before and whether it moved, and each FILE
 *   written, once (none when already at `version`)
 */
export function bump(root, version, { write = writeFileSync } = {}) {
  if (!SEMVER.test(version)) {
    throw new Error(`not a version: "${version}" — want MAJOR.MINOR.PATCH, with no pre-release`);
  }
  // Each file is read ONCE and every site in it is applied to the same evolving text. Mapping
  // over SITES independently looks equivalent and is not: two sites in one file both computed
  // their replacement from the ORIGINAL text, so writing them in order silently clobbered the
  // first with the second. That is exactly what happened the day gen/apple/project.yml gained a
  // second version line — it reported both as bumped and moved one.
  const texts = new Map();
  // What each file said before this bump: the text a failed rename puts back.
  const originals = new Map();
  const readOnce = (p) => {
    if (!texts.has(p)) {
      texts.set(p, readFileSync(p, 'utf8'));
      originals.set(p, texts.get(p));
    }
    return texts.get(p);
  };
  const plans = SITES.map(({ file, re }) => {
    const p = path.join(root, file);
    const text = readOnce(p);
    const matches = [...text.matchAll(new RegExp(re.source, `${re.flags}g`))];
    if (matches.length !== 1) {
      throw new Error(`${file}: expected exactly one version line, found ${matches.length} — nothing written`);
    }
    texts.set(p, text.replace(re, `$1${version}$3`));
    return { file, p, from: matches[0][2] };
  });
  const changed = plans.filter((plan) => plan.from !== version);
  // Written per PATH, not per site: a file with two sites is written once, with both. And in two
  // phases. Every new text goes to a sibling staging file first, and only when all of them exist is
  // any renamed over its original: written straight over, a failure at the sixth file left five at
  // the new version and the rest at the old — the drift this script exists to prevent (found by
  // audit, 2026-09-13). A rename within one directory does not half-happen.
  const staged = [];
  try {
    for (const p of new Set(changed.map((plan) => plan.p))) {
      staged.push(p); // before the write, so a staging file that failed half-written is removed too
      write(`${p}.bump-tmp`, texts.get(p));
    }
  } catch (err) {
    for (const p of staged) rmSync(`${p}.bump-tmp`, { force: true });
    throw err;
  }
  // Renamed the way it was staged: a rename that FAILS part-way puts back every file already
  // moved, from the text read at the start, and clears what is still staged. Staging alone kept
  // only the writes safe, and a failed third rename left two files bumped and six staging files
  // behind (found by verification, 2026-09-14).
  const moved = [];
  try {
    for (const p of staged) {
      renameSync(`${p}.bump-tmp`, p);
      moved.push(p);
    }
  } catch (err) {
    // Put back the way it was bumped — staged beside the file, then renamed over it — and every
    // file tried whatever another does. Written straight over, a restore the disk refused left its
    // file EMPTY and stopped the rest: the files after it stayed bumped, and every staging file
    // stayed behind (found by verification, 2026-09-14). A file that cannot be put back is named.
    const unrestored = [];
    for (const p of moved) {
      try {
        write(`${p}.bump-restore`, originals.get(p));
        renameSync(`${p}.bump-restore`, p);
      } catch {
        unrestored.push(path.relative(root, p));
      }
    }
    for (const p of staged) {
      rmSync(`${p}.bump-tmp`, { force: true });
      rmSync(`${p}.bump-restore`, { force: true });
    }
    if (unrestored.length) {
      throw new Error(`${err.message} — and the rollback could not put back ${unrestored.join(', ')}, which now `
        + `${unrestored.length === 1 ? 'says' : 'say'} ${version}`, { cause: err });
    }
    throw err;
  }
  return {
    to: version,
    // Per SITE, so a field already at the version is not called bumped because its sibling moved.
    sites: plans.map(({ file, from }) => ({ file, from, bumped: from !== version })),
    // Per FILE, once: a file with two sites was named twice (found by audit, 2026-09-13).
    changed: [...new Set(changed.map((plan) => plan.file))],
  };
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
    for (const { file, from, bumped } of r.sites) {
      console.log(`${bumped ? 'bumped ' : 'already'} ${file}  ${from} → ${r.to}`);
    }
    const before = new Set(r.sites.map((s) => s.from));
    if (before.size > 1) console.log(`note: the files disagreed before this bump (${[...before].join(', ')}); they agree now`);
    if (r.changed.length === 0) console.log(`nothing to do: every file already says ${r.to}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
