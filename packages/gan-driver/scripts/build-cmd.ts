import { buildCommand, type SafeCommand } from '../src/gen4/commands.js';
// Print the encrypted hex for a safe Gen4 command. Usage: build-cmd <MAC> <CMD>
import { GanGen4Cipher } from '../src/gen4/crypto.js';

const [, , mac, cmd] = process.argv;
const cipher = new GanGen4Cipher(mac);
process.stdout.write(Buffer.from(cipher.encrypt(buildCommand(cmd as SafeCommand))).toString('hex'));
