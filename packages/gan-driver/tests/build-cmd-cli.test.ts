// scripts/build-cmd.ts — the one-liner that prints an encrypted command packet for hand-testing
// against a cube.
//
// Run with no arguments it used to reach `new GanGen4Cipher(undefined)` and die inside
// src/gen4/crypto.ts with `Cannot read properties of undefined (reading 'trim')` — a stack trace
// naming a file the user never called, for the one mistake everybody makes with a two-argument
// script. The arguments are checked before anything is constructed now, and the script says what
// it wanted. These run the real script in a real process: an exit status is only worth asserting
// where the process actually exits.

import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { buildCommand } from '../src/gen4/commands.js';
import { GanGen4Cipher } from '../src/gen4/crypto.js';
import { bytesToHex } from '../src/hex.js';

const execFileP = promisify(execFile);
const tsx = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url));
const script = fileURLToPath(new URL('../scripts/build-cmd.ts', import.meta.url));

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

async function run(...args: string[]): Promise<Run> {
  return await execFileP(tsx, [script, ...args]).then(
    ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
    (e: { code?: number; stdout?: string; stderr?: string }) => ({
      code: e.code ?? -1,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
    }),
  );
}

describe('build-cmd refuses missing arguments before it builds anything', () => {
  it('with no arguments, prints usage to stderr and exits non-zero', async () => {
    const { code, stdout, stderr } = await run();
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/usage: build-cmd <MAC> <CMD>/);
    // The failure the fix is for: a crash inside the cipher, from a script that never checked.
    expect(stderr).not.toMatch(/TypeError|crypto\.ts/);
    expect(stdout).toBe('');
  }, 20000);

  it('with a MAC but no command, says the same thing', async () => {
    const { code, stdout, stderr } = await run('AB:12:34:56:78:90');
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/usage: build-cmd <MAC> <CMD>/);
    expect(stdout).toBe('');
  }, 20000);

  it('names the commands it will accept, so the next run works', async () => {
    const { stderr } = await run();
    expect(stderr).toMatch(/REQUEST_FACELETS/);
    expect(stderr).toMatch(/REQUEST_HARDWARE/);
    expect(stderr).toMatch(/REQUEST_BATTERY/);
  }, 20000);
});

describe('build-cmd still builds what it always did', () => {
  it('prints the encrypted packet for a complete invocation', async () => {
    const mac = 'AB:12:34:56:78:90';
    const { code, stdout } = await run(mac, 'REQUEST_FACELETS');
    expect(code).toBe(0);
    expect(stdout).toBe(
      bytesToHex(new GanGen4Cipher(mac).encrypt(buildCommand('REQUEST_FACELETS'))),
    );
  }, 20000);
});
