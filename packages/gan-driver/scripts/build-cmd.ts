import { buildCommand, type SafeCommand } from '../src/gen4/commands.js';
// Print the encrypted hex for a safe Gen4 command. Usage: build-cmd <MAC> <CMD>
import { GanGen4Cipher } from '../src/gen4/crypto.js';

const SAFE: SafeCommand[] = ['REQUEST_FACELETS', 'REQUEST_HARDWARE', 'REQUEST_BATTERY'];

const [, , mac, cmd] = process.argv;
// Checked before the cipher is constructed, because that is where a missing MAC used to land:
// `mac.trim()` on undefined, deep in src/gen4/crypto.ts, with a stack trace naming a file the
// caller never invoked. The script knows what it wanted; it says so.
if (!mac || !cmd) {
  process.stderr.write(`usage: build-cmd <MAC> <CMD>\n  CMD is one of: ${SAFE.join(', ')}\n`);
  process.exit(1);
}
const cipher = new GanGen4Cipher(mac);
process.stdout.write(Buffer.from(cipher.encrypt(buildCommand(cmd as SafeCommand))).toString('hex'));
