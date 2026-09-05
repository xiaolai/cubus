// `gan16 record`, run as the process it is.
//
// Everything about this command that can be wrong is about a lifecycle: a signal arriving, a
// buffer flushing, a verdict printed, an exit code coming back. None of that could be reached
// without a physical GAN16 until 2026-09-05, so recording.test.ts asserted on the SOURCE TEXT of
// cmdRecord instead — which can say that the shutdown is wired up, and can never say that it runs.
// The seam is GAN16_HOST (see cli.ts); the fake behind it is tests/helpers/fake-host.ts.
//
// What each case here is actually about:
//
//   Ctrl-C            — the file must hold every packet the screen counted. end() returns before
//                       the buffer drains, and the old handler called process.exit() on the next
//                       line, over a message reading "saved".
//   SIGTERM           — the same, for the signal a kill, a timeout wrapper, a supervisor or a
//                       closing terminal actually sends. It was unhandled: the process died at
//                       once, with no flush, no verdict and the BLE child still running.
//   a terminal giveup — a run that ended in failure exits non-zero, and still keeps what it got.
//   an escaping name  — `record ../../x` walked out of captures/recordings and truncated whatever
//                       it landed on. It is refused before anything is opened.
//   a bad command     — `gan16 toString` reached Object.prototype and died of a TypeError where a
//                       usage line was the whole answer.

import { type ChildProcess, spawn } from 'node:child_process';
import { chmodSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'src', 'cli.ts');
const FAKE_HOST = join(ROOT, 'tests', 'helpers', 'fake-host.ts');

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => {
    setTimeout(r, ms);
  });

const dirs: string[] = [];
const running: ChildProcess[] = [];
afterEach(async () => {
  for (const c of running.splice(0)) if (c.exitCode === null) c.kill('SIGKILL');
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

async function captureDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gan-cli-'));
  dirs.push(dir);
  return dir;
}

interface Ended {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

/** The real CLI, in its own process, with the fake host wired in by environment. */
function launch(args: string[], env: Record<string, string> = {}) {
  const child = spawn(process.execPath, ['--import', 'tsx', CLI, ...args], {
    cwd: ROOT,
    env: { ...process.env, GAN16_HOST: FAKE_HOST, ...env },
  });
  running.push(child);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (c: Buffer) => {
    stdout += c.toString();
  });
  child.stderr.on('data', (c: Buffer) => {
    stderr += c.toString();
  });
  const ended = new Promise<Ended>((res) =>
    child.on('close', (code, signal) => res({ code, signal, stdout, stderr })),
  );
  return {
    child,
    ended,
    /** Wait for something the CLI printed, so a signal lands at a known point in its life. */
    async waits(text: string): Promise<void> {
      for (let i = 0; i < 600 && !stdout.includes(text); i++) await sleep(20);
      if (!stdout.includes(text)) throw new Error(`never printed ${text}\n${stdout}\n${stderr}`);
    },
  };
}

/** The one capture the run produced, as its lines. */
function captured(dir: string): string[] {
  const files = readdirSync(dir);
  expect(files, 'exactly one capture file').toHaveLength(1);
  return readFileSync(join(dir, files[0] as string), 'utf8')
    .split('\n')
    .filter(Boolean);
}

const PACKETS = 4000;

describe('a capture that says it was saved was saved', () => {
  it('flushes every counted packet on Ctrl-C, and exits 0', async () => {
    const dir = await captureDir();
    const run = launch(['record', 'ctrl-c'], {
      GAN16_FAKE_DIR: dir,
      GAN16_FAKE_PACKETS: String(PACKETS),
    });
    await run.waits(`recorded ${PACKETS} packets`);
    run.child.kill('SIGINT');

    const { code, stdout } = await run.ended;
    expect(code).toBe(0);
    expect(stdout).toContain(`saved ${PACKETS} packets`);
    // The claim and the file agree — metadata line plus one line per packet, nothing truncated.
    expect(captured(dir)).toHaveLength(PACKETS + 1);
  }, 60_000);

  // The signal a `kill`, a `timeout`, a supervisor or a closing terminal sends. Unhandled, Node's
  // default terminates immediately: no flush, no verdict, and the transport left behind.
  it('shuts down the same way on SIGTERM', async () => {
    const dir = await captureDir();
    const run = launch(['record', 'sigterm'], {
      GAN16_FAKE_DIR: dir,
      GAN16_FAKE_PACKETS: String(PACKETS),
    });
    await run.waits(`recorded ${PACKETS} packets`);
    run.child.kill('SIGTERM');

    const { code, signal, stdout } = await run.ended;
    expect(signal).toBeNull(); // it decided to exit; it was not killed where it stood
    expect(code).toBe(0);
    expect(stdout).toContain(`saved ${PACKETS} packets`);
    expect(captured(dir)).toHaveLength(PACKETS + 1);
  }, 60_000);

  // A transport that has stopped retrying is terminal. The run failed, and says so with its exit
  // code — but the packets it did get are evidence and still reach the file.
  it('exits 1 when the transport gives up, keeping what it captured', async () => {
    const dir = await captureDir();
    const { ended } = launch(['record', 'giveup'], {
      GAN16_FAKE_DIR: dir,
      GAN16_FAKE_PACKETS: '200',
      GAN16_FAKE_ENDING: 'giveup',
    });
    const { code, stdout, stderr } = await ended;
    expect(code).toBe(1);
    expect(stderr).toMatch(/gave up reconnecting/);
    expect(stdout).toContain('saved 200 packets');
    expect(captured(dir)).toHaveLength(201);
  }, 60_000);

  // The other terminal ending: the file itself. `onError: () => finish(1)` is what routes it, and
  // the property is the same one in reverse — a run whose capture never reached the disk must not
  // print "saved" and must not exit 0 just because nothing else went wrong.
  //
  // Skipped as root, where the permission this rests on does not exist. Skipped, not passed: a
  // check that cannot run has verified nothing.
  const rootless = process.getuid?.() === 0 ? it.skip : it;
  rootless(
    'exits 1 without saying saved when the capture cannot be written',
    async () => {
      const dir = await captureDir();
      chmodSync(dir, 0o555); // the directory is there; nothing may be created in it
      try {
        const { ended } = launch(['record', 'unwritable'], {
          GAN16_FAKE_DIR: dir,
          GAN16_FAKE_PACKETS: '20',
        });
        const { code, stdout, stderr } = await ended;
        expect(code).toBe(1);
        expect(stdout).not.toContain('saved');
        expect(stderr).toMatch(/recording to .*unwritable\.jsonl failed: EACCES/);
      } finally {
        chmodSync(dir, 0o755); // …or the cleanup cannot remove it either
      }
    },
    60_000,
  );
});

describe('an experiment name is a name, not a path', () => {
  // The fake is told to end on its own, so a name that is NOT refused finishes its recording and
  // the assertions below get to run on the file it left. Without that, the failure is a timeout,
  // which says the refusal did not happen and nothing about where the bytes went.
  const endsItself = { GAN16_FAKE_PACKETS: '5', GAN16_FAKE_ENDING: 'giveup' };

  it('refuses one that would leave the capture directory, and opens nothing', async () => {
    const dir = await captureDir();
    const { ended } = launch(['record', '../../escaped'], { ...endsItself, GAN16_FAKE_DIR: dir });
    const { code, stderr } = await ended;
    expect(code).toBe(1);
    expect(stderr).toMatch(/refusing to record to '\.\.\/\.\.\/escaped'/);
    expect(readdirSync(dir)).toEqual([]);
    expect(existsSync(join(dir, '..', '..', 'escaped.jsonl'))).toBe(false);
  }, 60_000);

  it('refuses a bare .. and an empty name', async () => {
    const dir = await captureDir();
    const env = { ...endsItself, GAN16_FAKE_DIR: dir };
    expect((await launch(['record', '..'], env).ended).code).toBe(1);
    expect((await launch(['record'], env).ended).stderr).toMatch(/usage: gan16 record/);
    expect(readdirSync(dir)).toEqual([]);
  }, 60_000);
});

describe('an unknown command is a usage error, whatever it is called', () => {
  // Each of these is an inherited property of the dispatch object, and each died differently:
  // toString returned a string the .catch() then choked on, constructor and __proto__ are not
  // callable at all. All three are the same defect and none printed anything usable.
  for (const cmd of ['toString', 'constructor', '__proto__', 'recor']) {
    it(`answers ${cmd} with the usage line and exit 1`, async () => {
      const { code, stdout, stderr } = await launch([cmd]).ended;
      expect(code).toBe(1);
      expect(stdout).toMatch(/usage: gan16 <scan\|inspect\|state\|monitor\|raw\|record>/);
      expect(stderr).toBe('');
    }, 60_000);
  }
});
