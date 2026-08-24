// Gen4 command packets (written to FFF5, encrypted).
//
// Packets from afedotov/gan-web-bluetooth (MIT).

export type SafeCommand = 'REQUEST_FACELETS' | 'REQUEST_HARDWARE' | 'REQUEST_BATTERY';

export function buildCommand(cmd: SafeCommand): Uint8Array {
  const msg = new Uint8Array(20); // zero-filled
  switch (cmd) {
    case 'REQUEST_FACELETS':
      msg.set([0xdd, 0x04, 0x00, 0xed, 0x00, 0x00]);
      break;
    case 'REQUEST_HARDWARE':
      msg.set([0xdf, 0x03, 0x00, 0x00, 0x00]);
      break;
    case 'REQUEST_BATTERY':
      msg.set([0xdd, 0x04, 0x00, 0xef, 0x00, 0x00]);
      break;
  }
  return msg;
}

// ---- Unsafe commands: encoded here, deliberately NOT sendable ---------------
//
// REQUEST_RESET tells the cube to treat its CURRENT physical position as solved,
// rewriting the internal reference the move stream is relative to. Sent while the
// cube is not actually solved, the driver's tracked state and the physical cube
// diverge permanently and silently — the exact failure the state invariant
// (apply decoded moves -> matches hardware facelets) exists to catch.
//
// The encoding lives here so it is reviewable and pinned by a fixture test rather
// than rediscovered from an ellipsis in docs/protocol.md. It is kept OUT of
// `SafeCommand` on purpose: `CubeDriver.send()` accepts only `SafeCommand`, so
// there is no code path that can transmit this, accidentally or otherwise.
// Wiring it up is a separate, deliberate decision that needs hardware
// confirmation first — see docs/protocol.md.

export type UnsafeCommand = 'REQUEST_RESET';

/**
 * Build the REQUEST_RESET packet. Encoding only — nothing in this package sends
 * it, and `SafeCommand` excludes it so nothing can without a deliberate change.
 *
 * The byte sequence is verified against upstream only. Its effect on a physical
 * GAN16 has NOT been confirmed; no fixture test can establish that.
 */
export function buildUnsafeCommand(cmd: UnsafeCommand): Uint8Array {
  const msg = new Uint8Array(20); // zero-filled
  switch (cmd) {
    case 'REQUEST_RESET':
      msg.set([
        0xd2, 0x0d, 0x05, 0x39, 0x77, 0x00, 0x00, 0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0x00, 0x00,
        0x00,
      ]);
      break;
  }
  return msg;
}
