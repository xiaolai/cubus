#!/usr/bin/env node
// Where a release actually is, from the version number to the Homebrew tap.
//
// WHY THIS EXISTS. `dev-docs/release-runbook.md` §3 used to end at `git push origin vX.Y.Z`, and a
// release does not. Publishing the draft is not the last step either — it is the step that STARTS
// two more: `update-homebrew.yml` fires on `release: published` and can fail, and the updater's
// endpoint is `releases/latest/download/latest.json`, which a draft does not answer, so no existing
// user is offered anything until the draft is published. On 2026-09-18 v0.6.0 was tagged, built and
// reported as finished while both of those were still outstanding, because the checklist being
// followed genuinely stopped at the tag. A release is not done because a workflow went green; it is
// done when every line below says so.
//
//   node scripts/release-status.mjs 0.6.0
//
// Exit 0 when every step is done, 1 when a step FAILED, and 2 when nothing failed but something is
// still pending or could not be checked. The 0/1/2 split is `scripts/check-on-clone.sh`'s, for its
// reason: a step that could not run is reported and never counted as a pass, so a missing `gh` can
// never make this print a green it did not earn.
//
// NOTHING HERE IS A SECOND DEFINITION of something the repository already owns. The platform keys
// the manifest must carry are asked of `make-updater-manifest.mjs` (`platformsFor`), which is what
// writes them; this file lists the ASSET NAMES only, and those are checked against the two releases
// that have carried them (v0.5.3 and v0.6.0 are byte-identical in shape).

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { platformsFor } from './make-updater-manifest.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** What a step can be. `unchecked` is not a pass and never becomes one. */
export const DONE = 'done';
export const PENDING = 'pending';
export const FAILED = 'failed';
export const UNCHECKED = 'unchecked';

/** Where the cask lives, and the line in it that states the version. */
export const TAP_REPO = 'xiaolai/homebrew-tap';
export const TAP_CASK = 'Casks/cubus.rb';

/**
 * Every asset a release carries, by name.
 *
 * The `.dmg` has no `.sig` and that is correct, not an omission: it is how macOS INSTALLS, and the
 * updater applies the universal `.app.tar.gz` instead — `platformsFor` says the same thing by
 * returning no platform keys for it. Checked against v0.5.3 and v0.6.0, whose asset lists are
 * identical once the version is substituted out.
 */
export function expectedAssets(version) {
  const v = version;
  return [
    `cubus_${v}_universal.dmg`,
    'cubus.app.tar.gz', 'cubus.app.tar.gz.sig',
    `cubus_${v}_x64_en-US.msi`, `cubus_${v}_x64_en-US.msi.sig`,
    `cubus_${v}_x64-setup.exe`, `cubus_${v}_x64-setup.exe.sig`,
    `cubus_${v}_amd64.deb`, `cubus_${v}_amd64.deb.sig`,
    `cubus-${v}-1.x86_64.rpm`, `cubus-${v}-1.x86_64.rpm.sig`,
    `cubus_${v}_amd64.AppImage`, `cubus_${v}_amd64.AppImage.sig`,
    'latest.json',
  ].sort();
}

/** The platform keys the manifest must carry — derived, never listed here. */
export function expectedPlatformKeys(version) {
  return [...new Set(expectedAssets(version).flatMap((name) => platformsFor(name)))].sort();
}

/** What is missing from a release's asset list, and what nobody expected to find. */
export function assetReport(version, present) {
  const want = expectedAssets(version);
  const have = new Set(present);
  return {
    missing: want.filter((n) => !have.has(n)),
    unexpected: [...present].filter((n) => !want.includes(n)).sort(),
  };
}

/** Everything wrong with a manifest, as sentences. Empty means nothing is. */
export function manifestReport(version, manifest) {
  const problems = [];
  if (!manifest || typeof manifest !== 'object') return ['latest.json is not an object'];
  if (manifest.version !== version) {
    problems.push(`latest.json says version ${JSON.stringify(manifest.version)}, not ${version}`);
  }
  const keys = Object.keys(manifest.platforms ?? {}).sort();
  if (keys.length === 0) return [...problems, 'latest.json carries no platforms at all'];
  for (const want of expectedPlatformKeys(version)) {
    if (!keys.includes(want)) {
      // The failure this catches is silent on the publisher's side and daily on the user's: the
      // plugin looks up its INSTALLER key first, and `install_deb`/`install_rpm` refuse foreign
      // bytes, so a manifest missing `linux-x86_64-deb` prompts every .deb user forever.
      problems.push(`latest.json has no ${want} entry, so those installs are offered nothing they can apply`);
    }
  }
  return problems;
}

/** The version a cask states, or null when the text does not state one. */
export function caskVersion(text) {
  return /^\s*version\s+"([^"]+)"/m.exec(String(text))?.[1] ?? null;
}

/** 0 when every step is done, 1 when one failed, 2 when one is pending or unchecked. */
export function exitCodeFor(steps) {
  if (steps.some((s) => s.status === FAILED)) return 1;
  if (steps.every((s) => s.status === DONE)) return 0;
  return 2;
}

// ---------------------------------------------------------------------------------------------
// The effects. Every one answers `null` rather than throwing, so one missing tool degrades a
// single line to `unchecked` instead of taking the whole report down.

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

const gh = (args) => run('gh', args);
const git = (args) => run('git', args);

/** A step, ready to print. */
const step = (name, status, detail) => ({ name, status, detail });

function localVersion() {
  const file = `${ROOT}apps/web/lib/version.js`;
  if (!existsSync(file)) return null;
  return /VERSION\s*=\s*'([^']+)'/.exec(readFileSync(file, 'utf8'))?.[1] ?? null;
}

function collect(version) {
  const tag = `v${version}`;
  const steps = [];

  // PROBED ONCE, because "gh answered nothing" and "gh is not here" are different facts and only
  // one of them is about the release. Without this, a broken or unauthenticated gh reports "no
  // release or draft for vX.Y.Z" — a statement about GitHub made by a process that never reached
  // it, which is the kind of confident wrong answer this repository refuses everywhere else.
  const ghUsable = run('gh', ['--version']) !== null;
  const noGh = (what) => step(what, UNCHECKED, 'gh is not available or not authenticated');

  // 1. The number the app itself shows.
  const shown = localVersion();
  steps.push(shown === null
    ? step('version.js', UNCHECKED, 'apps/web/lib/version.js could not be read')
    : shown === version
      ? step('version.js', DONE, `VERSION is ${shown}`)
      : step('version.js', FAILED, `VERSION is ${shown}, not ${version} — run \`pnpm bump ${version}\``));

  // 2 and 3. The tag, its kind, and whether origin has it. A lightweight tag is refused by the
  // release gate, so it is worth naming here rather than at the end of a failed build.
  const kind = git(['cat-file', '-t', tag]);
  steps.push(kind === null
    ? step('tag exists', PENDING, `no local tag ${tag}`)
    : kind === 'tag'
      ? step('tag exists', DONE, `${tag} is annotated`)
      : step('tag exists', FAILED, `${tag} is a ${kind}, not an annotated tag — the gate refuses it`));
  const remote = git(['ls-remote', '--tags', 'origin', `refs/tags/${tag}`]);
  steps.push(remote === null
    ? step('tag pushed', UNCHECKED, 'could not reach origin')
    : remote === ''
      ? step('tag pushed', PENDING, `${tag} is not on origin`)
      : step('tag pushed', DONE, `${tag} is on origin`));

  // 4. CI for the tagged commit. The release gate reads this and nothing else.
  const sha = git(['rev-list', '-n', '1', tag]);
  const ci = sha === null ? null : gh(['run', 'list', '--commit', sha, '--workflow', 'CI', '--limit', '1',
    '--json', 'status,conclusion', '--jq', '.[0] | "\\(.status) \\(.conclusion // "-")"']);
  if (ci === null || ci === '') {
    steps.push(step('CI on the tagged commit', sha === null ? PENDING : UNCHECKED,
      sha === null ? 'no tag to resolve' : 'gh reported no CI run (is gh installed and authenticated?)'));
  } else {
    const [status, conclusion] = ci.split(' ');
    steps.push(status !== 'completed'
      ? step('CI on the tagged commit', PENDING, `CI is ${status}`)
      : conclusion === 'success'
        ? step('CI on the tagged commit', DONE, `CI succeeded on ${sha.slice(0, 7)}`)
        : step('CI on the tagged commit', FAILED, `CI ${conclusion} on ${sha.slice(0, 7)} — the release gate refuses this`));
  }

  // 5, 6, 7, 8. The release itself: that it exists, carries what it should, says the right version
  // in the file the updater reads, and whether it is still a draft.
  const view = ghUsable ? gh(['release', 'view', tag, '--json', 'isDraft,assets']) : null;
  if (view === null) {
    for (const what of ['release exists', 'assets', 'latest.json', 'published']) {
      steps.push(ghUsable
        ? step(what, PENDING, what === 'release exists' ? `no release or draft for ${tag}` : 'no release to inspect')
        : noGh(what));
    }
  } else {
    let parsed = null;
    try { parsed = JSON.parse(view); } catch { /* handled below */ }
    if (parsed === null) {
      steps.push(step('release exists', UNCHECKED, 'gh returned something that is not JSON'));
      steps.push(step('assets', UNCHECKED, 'release could not be read'));
      steps.push(step('latest.json', UNCHECKED, 'release could not be read'));
      steps.push(step('published', UNCHECKED, 'release could not be read'));
    } else {
      steps.push(step('release exists', DONE, parsed.isDraft ? 'a draft exists' : 'a published release exists'));

      const names = (parsed.assets ?? []).map((a) => a.name);
      const { missing, unexpected } = assetReport(version, names);
      steps.push(missing.length
        ? step('assets', FAILED, `missing: ${missing.join(', ')}`)
        : step('assets', DONE, `all ${expectedAssets(version).length} present${unexpected.length ? ` (also: ${unexpected.join(', ')})` : ''}`));

      // Downloaded rather than trusted: the manifest is what every existing install reads, and a
      // wrong one is invisible here and daily for them.
      const tmp = gh(['release', 'download', tag, '--pattern', 'latest.json', '--output', '-']);
      if (tmp === null) {
        steps.push(step('latest.json', UNCHECKED, 'could not download latest.json from the release'));
      } else {
        let manifest = null;
        try { manifest = JSON.parse(tmp); } catch { /* handled below */ }
        const problems = manifest === null ? ['latest.json is not valid JSON'] : manifestReport(version, manifest);
        steps.push(problems.length
          ? step('latest.json', FAILED, problems.join('; '))
          : step('latest.json', DONE, `version ${version}, ${expectedPlatformKeys(version).length} platform keys`));
      }

      steps.push(parsed.isDraft
        ? step('published', PENDING, 'still a DRAFT — nobody is offered this, and the tap cannot update until it is published')
        : step('published', DONE, 'published'));
    }
  }

  // 9. The tap. It updates itself on `release: published`, so a mismatch here after publishing
  // means the job failed and wants re-running with its workflow_dispatch input.
  const cask = gh(['api', `repos/${TAP_REPO}/contents/${TAP_CASK}`, '--jq', '.content']);
  if (cask === null) {
    steps.push(step('homebrew tap', UNCHECKED, `could not read ${TAP_REPO}/${TAP_CASK}`));
  } else {
    const got = caskVersion(Buffer.from(cask.replace(/\s/g, ''), 'base64').toString('utf8'));
    steps.push(got === version
      ? step('homebrew tap', DONE, `cask is at ${got}`)
      : step('homebrew tap', PENDING,
        `cask is at ${got ?? 'an unreadable version'}, not ${version} — it updates on publish; if it stays behind, ` +
        're-run "Update Homebrew Tap" with the version as its input'));
  }

  return steps;
}

function main(argv) {
  const version = argv[0];
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    console.error('usage: node scripts/release-status.mjs X.Y.Z   (bare semver, no leading v)');
    return 2;
  }
  const steps = collect(version);
  const width = Math.max(...steps.map((s) => s.name.length));
  const mark = { [DONE]: 'ok  ', [PENDING]: 'wait', [FAILED]: 'FAIL', [UNCHECKED]: '?   ' };
  console.log(`release ${version}\n`);
  for (const s of steps) console.log(`  ${mark[s.status]}  ${s.name.padEnd(width)}  ${s.detail}`);
  const code = exitCodeFor(steps);
  const unchecked = steps.filter((s) => s.status === UNCHECKED).length;
  console.log(`\n${
    code === 0 ? 'DONE: every step of this release is finished.'
      : code === 1 ? 'FAILED: a step is wrong. Nothing below it is trustworthy until it is fixed.'
        : `NOT FINISHED: ${steps.filter((s) => s.status === PENDING).length} pending${unchecked ? `, ${unchecked} unchecked (a step that could not run is never a pass)` : ''}.`
  }`);
  return code;
}

if (process.argv[1] && process.argv[1].endsWith('release-status.mjs')) {
  process.exitCode = main(process.argv.slice(2));
}
