// BlewTransport against a fake `blew`, because everything hard about it is about a child process.
//
// `runBlew` had tests; the transport itself had none, and it is the half with the failure modes:
// the respawn loop, the framing, and three things an audit named on 2026-09-05 that all share one
// shape — a pipe, a timer and a regex each answering a question nobody asked them.
//
//   stderr nobody reads        — spawn() pipes it by default, and a pipe with no consumer fills at
//                                the OS buffer and BLOCKS the child mid-write. For `blew sub` that
//                                is notifications stopping while the process is still alive, with
//                                nothing anywhere reporting a problem.
//   a timer nobody cancels     — the respawn was scheduled with a bare setTimeout, so disconnect()
//                                set `stopped` and left a referenced handle holding Node awake for
//                                up to eight seconds, only to wake and do nothing.
//   a regex that always matches — `value=([0-9a-fA-F]*)` matches the empty string, so output with
//                                no reading in it at all, and output with a malformed one, both
//                                came back as a successful empty value.
//
// The fakes are POSIX shell scripts, which is the point twice over: the properties are about a
// child process's pipes and exit status rather than about Bluetooth, and a shell writes to its
// stderr with a blocking write(2) — a Node fake would buffer in memory and never reproduce the
// blockage at all.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { BlewTransport, scanForCube } from '../src/transport/blew.js';

const dir = mkdtempSync(join(tmpdir(), 'gan-blew-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Real setTimeout, captured before any test fakes it — the fakes below are child processes, and
 *  a child takes real milliseconds to start and stop however the clock is mocked. */
const realSetTimeout = globalThis.setTimeout;
const realSleep = (ms: number): Promise<void> =>
  new Promise((r) => {
    realSetTimeout(r, ms);
  });

/** Write an executable fake and return its path. */
function fake(name: string, body: string): string {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${body}`, { mode: 0o755 });
  return path;
}

const PACKET = 'ts=2026-09-05T00:00:00.000Z value=aabbccddee';

/** One notification, then gone — a `blew sub` whose link dropped. */
const oneShot = fake('one-shot', `echo '${PACKET}'\n`);

/** Nothing at all, with a complaint on stderr — a bad id, or a cube that is asleep. */
const dead = fake('dead', `echo 'blew: no such device' >&2\nexit 1\n`);

const transports: BlewTransport[] = [];
afterEach(() => {
  for (const t of transports.splice(0)) t.disconnect();
  vi.useRealTimers();
});

function transport(bin: string): BlewTransport {
  const t = new BlewTransport('CUBE', bin);
  transports.push(t);
  return t;
}

/** Run the real clock until `done()` holds — for anything a child process does by itself. */
async function untilReal(done: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 2000 && !done(); i++) await realSleep(2);
  if (!done()) throw new Error(`${label} never happened`);
}

/**
 * Run the real clock and the fake one together until `done()` holds.
 *
 * Both are needed and neither will do: a child takes real milliseconds to start and stop however
 * the clock is mocked, and the respawn backoff reaches eight seconds — twelve dead attempts is 71
 * seconds of waiting, which is a test nobody runs.
 */
async function until(done: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 2000 && !done(); i++) {
    await realSleep(2);
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(8000);
  }
  if (!done()) throw new Error(`${label} never happened`);
}

describe('a notification becomes a packet, whatever shape the child writes it in', () => {
  it('parses value= and ts=, and ignores every other line', async () => {
    const bin = fake(
      'framing',
      [
        `echo 'connected to CUBE'`,
        `echo '${PACKET}'`,
        `echo 'notice: link quality poor'`,
        `echo 'ts=2026-09-05T00:00:01.000Z value=0011'`,
        '',
      ].join('\n'),
    );
    const seen: [string, number][] = [];
    transport(bin)
      .subscribe('FFF6')
      .on('packet', (hex: string, ts: number) => seen.push([hex, ts]));
    await until(() => seen.length >= 2, 'two packets');
    expect(seen[0]).toEqual(['aabbccddee', Date.parse('2026-09-05T00:00:00.000Z')]);
    expect(seen[1]?.[0]).toBe('0011');
  });

  // A pipe hands over whatever the kernel had, not whatever the child printed.
  it('reassembles a line split across two chunks', async () => {
    const bin = fake(
      'split',
      // No newline on the first write, and a pause, so the halves cannot arrive together.
      `printf 'ts=2026-09-05T00:00:00.000Z val'\nsleep 0.2\nprintf 'ue=beef\\n'\nsleep 1\n`,
    );
    const seen: string[] = [];
    transport(bin)
      .subscribe('FFF6')
      .on('packet', (hex: string) => seen.push(hex));
    await until(() => seen.length > 0, 'the rejoined packet');
    expect(seen).toEqual(['beef']);
  });

  // spawn reports this on the child rather than by throwing, so with no 'error' listener it
  // escapes every catch around it.
  it('emits error rather than throwing when the binary is not there', async () => {
    const errors: Error[] = [];
    transport('/nonexistent/blew')
      .subscribe('FFF6')
      .on('error', (e: Error) => errors.push(e));
    await until(() => errors.length > 0, 'the spawn failure');
    expect(errors[0]?.message).toMatch(/ENOENT/);
  });
});

// The quietest failure this transport can have: the child is alive, the loop is running, and no
// notification will ever arrive again because the process is blocked writing to a pipe nobody
// reads.
//
// The volume is measured, not guessed. Node does not block on the OS pipe buffer alone — a paused
// stdio stream still fills its own 64 KB high-water mark first — so on macOS the child gets about
// 128 KB through before it stops. 600 KB is past that with room to spare; 120 KB is not, and a
// version of this test using 120 KB passed against the unfixed code and proved nothing.
describe('a child that talks on stderr is not a child that has stopped', () => {
  it('drains stderr, so a packet behind 600 KB of diagnostics still arrives', async () => {
    const bin = fake(
      'chatty',
      [
        `pad='${'x'.repeat(290)}'`,
        'i=0',
        'while [ "$i" -lt 2000 ]; do',
        `  printf 'blew: %s\\n' "$pad" >&2`,
        '  i=$((i + 1))',
        'done',
        `echo '${PACKET}'`,
        'sleep 5',
        '',
      ].join('\n'),
    );
    const seen: string[] = [];
    transport(bin)
      .subscribe('FFF6')
      .on('packet', (hex: string) => seen.push(hex));
    await untilReal(() => seen.length > 0, 'the packet behind the diagnostics');
    expect(seen).toEqual(['aabbccddee']);
  });
});

describe('the respawn loop stops, and says why', () => {
  it('gives up after twelve dead attempts and quotes what the child was complaining about', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const sub = transport(dead).subscribe('FFF6');
    let giveup: Error | null = null;
    let respawns = 0;
    sub.on('reconnecting', () => respawns++);
    sub.on('giveup', (e: Error) => {
      giveup = e;
    });

    await until(() => giveup !== null, 'the giveup');
    const err = giveup as unknown as Error;
    expect(err.message).toMatch(/gave up reconnecting to CUBE after 12 attempts with no data/);
    // Without this the operator is told a count and nothing else. The child said why every time.
    expect(err.message).toMatch(/last output from .*dead: blew: no such device/);
    // Eleven respawns and then the twelfth close, which gives up instead of announcing another.
    expect(respawns).toBe(11);
  });

  // The cube stops advertising ~1 s after coming to rest, so a link that was delivering and then
  // dropped is the ordinary case and gets the short backoff. Only attempts that never saw data
  // grow it.
  it('comes straight back after a link that was delivering, without the dead-attempt backoff', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const seen: string[] = [];
    transport(oneShot)
      .subscribe('FFF6')
      .on('packet', (hex: string) => seen.push(hex));
    await untilReal(() => seen.length === 1, 'the first packet');
    await untilReal(() => vi.getTimerCount() === 1, 'the respawn timer');

    await vi.advanceTimersByTimeAsync(499);
    expect(seen).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await untilReal(() => seen.length === 2, 'the packet from the respawned child');
  });

  // A live connection resets the failure count — otherwise a long session that dropped eleven
  // times over an afternoon would refuse to come back the twelfth.
  it('a packet resets the count, so a later drop is not the twelfth attempt', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const counter = join(dir, 'attempts');
    const bin = fake(
      'revives',
      [
        `n=$(cat ${counter} 2>/dev/null || echo 0)`,
        'n=$((n + 1))',
        `echo "$n" > ${counter}`,
        // Dead eleven times, then one live connection, then dead for good.
        `[ "$n" = "12" ] && echo '${PACKET}'`,
        'exit 1',
        '',
      ].join('\n'),
    );
    const sub = transport(bin).subscribe('FFF6');
    let giveup: Error | null = null;
    const seen: string[] = [];
    sub.on('packet', (hex: string) => seen.push(hex));
    sub.on('giveup', (e: Error) => {
      giveup = e;
    });

    await until(() => seen.length > 0, 'the one live connection');
    // The eleventh close would have given up on the next one; the packet put the count back to 0.
    expect(giveup).toBeNull();
    await until(() => Number(execFileSync('cat', [counter]).toString().trim()) >= 18, 'more tries');
    expect(giveup).toBeNull();
  });

  // A timer is a live handle: `stopped` alone only makes the respawn a no-op when it eventually
  // fires, and Node stays awake until it does.
  it('disconnect() cancels a pending respawn instead of leaving it to fire', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const t = transport(dead);
    const sub = t.subscribe('FFF6');
    let respawns = 0;
    sub.on('reconnecting', () => respawns++);

    // The real clock only: 'reconnecting' is emitted in the close handler, and advancing the fake
    // one would fire the very timer this test is about before it could be looked at.
    await untilReal(() => respawns > 0, 'the first respawn');
    expect(vi.getTimerCount()).toBe(1);
    t.disconnect();
    expect(vi.getTimerCount()).toBe(0);

    // …and nothing comes back after it, however far the clock is wound on.
    const after = respawns;
    await vi.advanceTimersByTimeAsync(60_000);
    await realSleep(50);
    expect(respawns).toBe(after);
  });
});

describe('a read is a reading, or it is a failure', () => {
  const reader = (out: string, code = 0) =>
    fake(
      `read-${Buffer.from(out).toString('hex').slice(0, 12)}-${code}`,
      `echo '${out}'\nexit ${code}\n`,
    );

  it('returns the hex a characteristic answered with', async () => {
    await expect(transport(reader('handle=0x0e value=00112233')).read('FFF6')).resolves.toBe(
      '00112233',
    );
  });

  // The one case the old `?? ''` was right about, and the reason a refusal has to be narrow.
  it('returns empty for a characteristic that really is empty', async () => {
    await expect(transport(reader('handle=0x0e value=')).read('FFF6')).resolves.toBe('');
  });

  it('refuses output with no value= field at all', async () => {
    await expect(
      transport(reader('error: characteristic not readable')).read('FFF6'),
    ).rejects.toThrow(/no value= field.*characteristic not readable/s);
  });

  it('refuses a value that is not whole-byte hex', async () => {
    await expect(transport(reader('value=zzz')).read('FFF6')).rejects.toThrow(
      /not whole-byte hex: zzz/,
    );
    await expect(transport(reader('value=abc')).read('FFF6')).rejects.toThrow(
      /not whole-byte hex: abc/,
    );
  });

  it('surfaces a child that failed outright', async () => {
    await expect(transport('/nonexistent/blew').read('FFF6')).rejects.toThrow(/ENOENT/);
  });
});

describe('a write carries the characteristic, the bytes and the response mode', () => {
  it('asks for a response by default and without one when told', async () => {
    const log = join(dir, 'write-args');
    const bin = fake('writer', `echo "$@" >> ${log}\n`);
    const t = transport(bin);
    await t.write('FFF5', 'ddee');
    await t.write('FFF5', 'ddee', true);
    const lines = execFileSync('cat', [log]).toString().trim().split('\n');
    expect(lines[0]).toMatch(/write --id CUBE --with-response --format hex FFF5 ddee/);
    expect(lines[1]).toMatch(/--without-response/);
  });

  it('rejects when the child fails', async () => {
    await expect(transport(fake('write-fail', 'exit 4\n')).write('FFF5', 'dd')).rejects.toThrow();
  });
});

// The scan helper exits 0 both when its window ends and when it finds the cube early, so a
// non-zero exit is always a failure — including the one that matters, Bluetooth going off or
// unauthorized (status 2). Accepting any partial output turned that into a clean scan that simply
// found no cube, and findCube() then retried into a dead radio six times.
describe('a scan that failed is not a scan that found nothing', () => {
  it('parses advertisements from a clean run, one entry per id', async () => {
    const bin = fake(
      'scan-ok',
      [
        `echo '{"id":"A","name":"GAN16ui_C8D3","rssi":-50,"manufacturerData":"aabb"}'`,
        `echo 'scanning...'`,
        `echo '{"id":"A","name":"GAN16ui_C8D3","rssi":-48,"manufacturerData":"aabb"}'`,
        `echo '{"id":"B","name":"","rssi":-70}'`,
        '',
      ].join('\n'),
    );
    const found = await scanForCube(bin, 1);
    expect(found).toHaveLength(2);
    expect(found[0]).toMatchObject({ id: 'A', rssi: -48, manufacturerData: 'aabb' });
    expect(found[1]).toMatchObject({ id: 'B', name: '' });
  });

  it('rejects an abnormal exit even when advertisements were printed, and counts them', async () => {
    const bin = fake(
      'scan-then-die',
      [
        `echo '{"id":"A","name":"GAN16ui_C8D3","rssi":-50,"manufacturerData":"aabb"}'`,
        `echo 'bluetooth state: 4 (need poweredOn=5)' >&2`,
        'exit 2',
        '',
      ].join('\n'),
    );
    await expect(scanForCube(bin, 1)).rejects.toThrow(
      /scan helper .*scan-then-die failed after 1 advertisement line\(s\)/,
    );
  });

  it('names the build step when the helper has not been compiled', async () => {
    await expect(scanForCube(join(dir, 'never-built'), 1)).rejects.toThrow(
      /scan helper not found.*swiftc -O -o scripts\/scan-adv/s,
    );
  });

  it('ignores a partial line rather than failing the whole scan', async () => {
    const bin = fake('scan-partial', `echo '{"id":"A"'\necho '{"id":"B","name":"x","rssi":-1}'\n`);
    await expect(scanForCube(bin, 1)).resolves.toMatchObject([{ id: 'B' }]);
  });
});
