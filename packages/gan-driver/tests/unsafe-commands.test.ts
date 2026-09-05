// REQUEST_RESET: encoding pinned, and proof that only the guard can send it.
//
// This command tells the cube to treat its current physical position as solved,
// rewriting the reference the move stream is relative to. Sent while the cube is
// not actually solved, the driver's state and the hardware diverge permanently
// and silently — the failure the state invariant exists to catch.
//
// It IS sent now, but only through CubeDriver.anchorSolved(), which refuses
// unless the cube already reports a solved state — at which point resetting the
// reference to solved is state-neutral and nothing can diverge. That guard's
// behaviour is tested in anchor-solved.test.ts.
//
// This file covers the two structural properties that keep the guard the only
// way in, and pins the encoding:
//
//   1. the bytes are what upstream says they are          (pinned below)
//   2. the ONLY path to transmitting them is anchorSolved (asserted below)
//   3. the physical cube's response to them               (NOT VERIFIABLE — needs
//      a GAN16 and a person turning it; see docs/protocol.md)
//
// A green run of this file says the packet is correctly formed and unreachable
// except through the guard. It never says the cube does what upstream claims.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { buildCommand, buildUnsafeCommand } from '../src/gen4/commands.js';

// Verbatim from afedotov/gan-web-bluetooth (MIT), the same source as the three
// safe packets — those match this repo byte for byte, which is what gives this
// sequence its credibility. docs/protocol.md previously recorded it as
// `D2 0D 05 …`, and the first three bytes agree.
const UPSTREAM_RESET = [
  0xd2, 0x0d, 0x05, 0x39, 0x77, 0x00, 0x00, 0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0x00, 0x00, 0x00,
];

describe('buildUnsafeCommand — REQUEST_RESET', () => {
  it('encodes the upstream byte sequence exactly', () => {
    const msg = buildUnsafeCommand('REQUEST_RESET');
    expect(Array.from(msg.slice(0, UPSTREAM_RESET.length))).toEqual(UPSTREAM_RESET);
  });

  it('pads to the 20-byte frame the cipher expects', () => {
    const msg = buildUnsafeCommand('REQUEST_RESET');
    expect(msg).toHaveLength(20);
    // Everything past the 16 upstream bytes must be zero, not uninitialised.
    expect(Array.from(msg.slice(UPSTREAM_RESET.length))).toEqual([0, 0, 0, 0]);
  });

  it('is distinguishable from every safe command by its opcode', () => {
    const reset = buildUnsafeCommand('REQUEST_RESET')[0];
    for (const safe of ['REQUEST_FACELETS', 'REQUEST_HARDWARE', 'REQUEST_BATTERY'] as const) {
      expect(buildCommand(safe)[0]).not.toBe(reset);
    }
  });
});

// The containment guarantee. If someone later adds REQUEST_RESET to SafeCommand
// or calls it from the driver, these fail — which is the point. The encoding
// being present must not quietly become the encoding being reachable.
describe('REQUEST_RESET containment', () => {
  const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

  it('is absent from the SafeCommand union', () => {
    const commands = src('../src/gen4/commands.ts');
    const union = /export type SafeCommand =([^;]*);/.exec(commands)?.[1] ?? '';
    expect(union).not.toMatch(/REQUEST_RESET/);
    // Guard against the regex silently matching nothing and passing vacuously.
    expect(union).toMatch(/REQUEST_FACELETS/);
  });

  it('is built in exactly one place in the driver, inside sendUnsafe', () => {
    const driver = src('../src/driver.ts');
    const calls = driver.match(/buildUnsafeCommand\(/g) ?? [];
    expect(calls).toHaveLength(1);
    // …and that call sits in sendUnsafe, not scattered somewhere new.
    const sendUnsafe = /private (?:async )?sendUnsafe\([^)]*\)[^{]*\{([\s\S]*?)\n {2}\}/.exec(
      driver,
    )?.[1];
    expect(sendUnsafe, 'sendUnsafe not found — did it get renamed?').toBeTruthy();
    expect(sendUnsafe).toMatch(/buildUnsafeCommand\(/);
  });

  it('is transmitted only via anchorSolved, which owns the precondition', () => {
    const driver = src('../src/driver.ts');
    // Every sendUnsafe call site except its own declaration.
    const callers = (driver.match(/this\.sendUnsafe\(/g) ?? []).length;
    expect(callers).toBe(1);
    const anchor = /async anchorSolved\([\s\S]*?\n {2}\}/.exec(driver)?.[0];
    expect(anchor, 'anchorSolved not found — did it get renamed?').toBeTruthy();
    // The deadline is pinned with the call site: an unsafe write with no budget is the defect
    // fixed on 2026-09-05, where a transport that never settled left the anchor waiting forever.
    expect(anchor).toMatch(/this\.sendUnsafe\('REQUEST_RESET', timeoutMs\)/);
    // The guards must precede the send, not follow it — both of them. The second is the one that
    // rechecks the pre-read after the wait: a cube that turned in between has not been checked.
    expect(anchor!.indexOf('refusing to anchor')).toBeLessThan(anchor!.indexOf('this.sendUnsafe'));
    expect(anchor!.indexOf('this.readEpoch !== readAt')).toBeLessThan(
      anchor!.indexOf('this.sendUnsafe'),
    );
  });

  it('cannot reach the safe send() path', () => {
    const driver = src('../src/driver.ts');
    const send = /private async send\(cmd: SafeCommand\)[\s\S]*?\n {2}\}/.exec(driver)?.[0];
    expect(send, 'send() not found — did its signature change?').toBeTruthy();
    expect(send).not.toMatch(/Unsafe|REQUEST_RESET/);
  });

  it('is not re-exported from the package entry point', () => {
    // Keeping it off the public surface means an app cannot reach it without
    // deep-importing, which is a deliberate act rather than an accident.
    expect(src('../src/index.ts')).not.toMatch(/buildUnsafeCommand|UnsafeCommand/);
  });
});
