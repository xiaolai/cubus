#!/usr/bin/env node
// Run `tauri android …` under a JDK Gradle can actually start on.
//
// Why this exists rather than a line in a README: with this machine's default JDK (26), the whole
// Android build dies with
//
//   > Unsupported class file major version 70
//
// which names neither Java, nor 26, nor what to do about it. Gradle 8.14.3 with AGP 8.11.0 runs on
// 17–21; class file 70 is Java 26. The failure is entirely opaque and costs a search every time, so
// the check belongs in the build path where it can say the useful thing once.
//
// The fix is not to change the machine's default `java` — other things want it — but to hand Gradle
// a supported one for this command only.
//
// Usage: pnpm --filter cubus-desktop android build --debug --target aarch64

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Gradle 8.14.3 + AGP 8.11.0 run on these, inclusive. Raise them together with the wrapper. */
export const JDK_MIN = 17;
export const JDK_MAX = 21;

/**
 * Major version of a JDK version string. Handles the modern form ("21.0.5", "26.0.2.1") and the
 * legacy 1.x form ("1.8.0_402" is Java 8), which is still what some vendors report.
 * @param {string} s
 * @returns {number | null}
 */
export function majorVersion(s) {
  const m = /^(\d+)(?:\.(\d+))?/.exec(String(s).trim());
  if (!m) return null;
  const first = Number(m[1]);
  if (first === 1) return m[2] === undefined ? null : Number(m[2]);
  return first;
}

/** Can Gradle start on this JDK? @param {number | null} major */
export function supported(major) {
  return Number.isInteger(major) && major >= JDK_MIN && major <= JDK_MAX;
}

/**
 * First usable JDK, newest first — a deterministic choice, so two machines with the same JDKs
 * installed build with the same one.
 * @param {{home: string, version: string}[]} candidates
 * @returns {string | null} the JAVA_HOME to use
 */
export function chooseJdk(candidates) {
  const usable = candidates
    .map((c) => ({ ...c, major: majorVersion(c.version) }))
    .filter((c) => supported(c.major) && c.home);
  if (usable.length === 0) return null;
  usable.sort((a, b) => b.major - a.major);
  return usable[0].home;
}

/** Ask macOS for every JDK it knows about. Returns [] anywhere java_home does not exist. */
function installedJdks() {
  const out = [];
  for (let v = JDK_MAX; v >= JDK_MIN; v--) {
    const r = spawnSync('/usr/libexec/java_home', ['-v', String(v), '--failfast'], {
      encoding: 'utf8',
    });
    if (r.status === 0 && r.stdout.trim()) out.push({ home: r.stdout.trim(), version: String(v) });
  }
  // Homebrew's keg-only JDKs are invisible to java_home until they are symlinked, and installing
  // one is the documented remedy below — so look where that remedy puts them.
  for (let v = JDK_MAX; v >= JDK_MIN; v--) {
    const home = `/opt/homebrew/opt/openjdk@${v}/libexec/openjdk.jdk/Contents/Home`;
    if (existsSync(home)) out.push({ home, version: String(v) });
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('usage: tauri-android.mjs <tauri android subcommand> [args…]');
    process.exit(2);
  }

  // An explicit JAVA_HOME wins if it is usable — someone who set it meant it — but not if it is
  // one Gradle cannot start on, which is exactly the case that produced the opaque message.
  const explicit = process.env.JAVA_HOME;
  let home = null;
  if (explicit) {
    const r = spawnSync(`${explicit}/bin/java`, ['-version'], { encoding: 'utf8' });
    const version = /version "([^"]+)"/.exec(`${r.stderr || ''}${r.stdout || ''}`)?.[1] ?? '';
    if (supported(majorVersion(version))) home = explicit;
    else {
      console.error(
        `JAVA_HOME points at Java ${version || '(unreadable)'}, which Gradle cannot start on.`,
      );
    }
  }
  home ??= chooseJdk(installedJdks());

  if (!home) {
    console.error(
      [
        '',
        `No JDK between ${JDK_MIN} and ${JDK_MAX} was found, and Gradle cannot run without one.`,
        '',
        'Gradle 8.14.3 / AGP 8.11.0 refuse anything newer, and the message they give is',
        '"Unsupported class file major version NN" — which is why this check exists.',
        '',
        '  brew install openjdk@21',
        '',
        'It installs keg-only, so the machine\'s default `java` is left alone; this script finds it.',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }

  const r = spawnSync('tauri', ['android', ...args], {
    stdio: 'inherit',
    env: { ...process.env, JAVA_HOME: home },
  });
  process.exit(r.status ?? 1);
}

/**
 * Is this module the program being run, rather than an import?
 *
 * `import.meta.url` is a file URL, PERCENT-ENCODED — a space in the path is `%20` — while
 * `process.argv[1]` is the raw path. The old guard compared `file://${argv[1]}` against the URL,
 * so from any checkout whose path contained a space the two never matched, `main()` never ran,
 * and the wrapper exited 0 having built nothing (audit 2026-09-04, mobile A6). `pathToFileURL`
 * produces the same encoding the loader does, so the comparison is URL to URL.
 * @param {string | undefined} argv1
 * @param {string} metaUrl
 */
export function isMain(argv1, metaUrl) {
  if (!argv1) return false;
  return pathToFileURL(argv1).href === metaUrl;
}

// Importable for tests without running the build.
if (isMain(process.argv[1], import.meta.url)) main();
