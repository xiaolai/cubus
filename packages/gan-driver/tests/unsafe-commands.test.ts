// REQUEST_RESET: encoding pinned, and proof that nothing can send it.
//
// This command tells the cube to treat its current physical position as solved,
// rewriting the reference the move stream is relative to. Sent while the cube is
// not actually solved, the driver's state and the hardware diverge permanently
// and silently — the failure the state invariant exists to catch.
//
// So there are two things worth testing, and one that CANNOT be tested here:
//
//   1. the bytes are what upstream says they are         (pinned below)
//   2. no code path can transmit them                    (asserted below)
//   3. the physical cube's response to them              (NOT VERIFIABLE — needs
//      a GAN16 and a person turning it; see docs/protocol.md)
//
// Point 3 is why the command is encoded but unwired. A green run of this file
// says the packet is correctly formed, never that it is safe to send.

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

  it('is never referenced by the driver', () => {
    expect(src('../src/driver.ts')).not.toMatch(/REQUEST_RESET|buildUnsafeCommand/);
  });

  it('is not re-exported from the package entry point', () => {
    // Keeping it off the public surface means an app cannot reach it without
    // deep-importing, which is a deliberate act rather than an accident.
    expect(src('../src/index.ts')).not.toMatch(/buildUnsafeCommand|UnsafeCommand/);
  });
});
