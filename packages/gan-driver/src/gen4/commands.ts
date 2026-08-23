// Gen4 command packets (written to FFF5, encrypted). Only the safe, documented
// query commands are exposed. REQUEST_RESET exists in the protocol but is
// intentionally NOT included here: it rewrites the cube's internal solved
// reference, which would desync driver state from the physical cube.
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
