// The packet pipeline the `raw` and `record` commands share, and the recorder that persists it.
//
// Split out of cli.ts on 2026-09-05, for two reasons an audit named separately. The two commands
// had each grown their own copy of the length check, the decrypt, the hex conversion and the
// decode, so a fix to one silently missed the other. And the recorder's two critical paths — a
// packet reaching the file, and a shutdown that does not truncate it — could only be reached
// through hardware while they lived inside an argv-dispatching script; here they take a
// subscription emitter and a writable stream, so a fake transport and a temp file are enough.
//
// Node-only, and deliberately not re-exported from index.ts: the browser-safe surface is the
// driver and the protocol layer.

import type { EventEmitter } from 'node:events';
import type { Writable } from 'node:stream';
import type { GanGen4Cipher } from './gen4/crypto.js';
import { type DecodeResult, decodeGen4 } from './gen4/decode.js';
import { bytesToHex, hexToBytes } from './hex.js';

/** A Gen4 message is 20 bytes on the wire — 40 hex characters. Anything else is not one. */
const FRAME_HEX_LENGTH = 40;

export interface DecodedPacket {
  /** The decrypted bytes as hex, or '' when the frame never got as far as being decrypted. */
  dec: string;
  /** The decoded event, or null when there was none to decode. */
  event: DecodeResult | null;
  /** Why there is no event. Non-null exactly when `event` is null. */
  error: string | null;
}

/**
 * Decrypt and decode one notification, reporting failure as a value instead of throwing.
 *
 * The decoder CAN throw on a corrupt frame — a FACELETS whose parity-derived eighth corner falls
 * outside the cubie table indexes past the end of it — and it did so straight out of a
 * notification handler, where the exception took the process down before the encrypted bytes had
 * been written anywhere. That is precisely the packet whose evidence is worth most, so a failure
 * here is a value the caller can persist beside the raw frame rather than an exception that
 * destroys it.
 */
export function decodePacket(cipher: GanGen4Cipher, hex: string, ts: number): DecodedPacket {
  if (hex.length !== FRAME_HEX_LENGTH) {
    return { dec: '', event: null, error: `not a 20-byte Gen4 frame (${hex.length / 2} bytes)` };
  }
  let dec = '';
  try {
    const bytes = cipher.decrypt(hexToBytes(hex));
    dec = bytesToHex(bytes);
    return { dec, event: decodeGen4(bytes, ts), error: null };
  } catch (e) {
    return { dec, event: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface RecordingOptions {
  /** The subscription to record. Only its 'packet' events are consumed. */
  sub: EventEmitter;
  cipher: GanGen4Cipher;
  out: Writable;
  /** Carried only so a stream failure can name the file the packets did not reach. */
  path: string;
  /** The first line of the file: what was recorded, from where, and when. */
  meta: Record<string, unknown>;
  /** The characteristic the packets came from, recorded on every line. */
  char?: string;
  onPacket?: (packets: number) => void;
  /** A stream that failed. Capture has already stopped by the time this is called. */
  onError?: (err: Error) => void;
}

export interface Recording {
  /** Packets written so far. */
  readonly packets: number;
  /**
   * Stop capturing and close the file. Resolves once the stream has FLUSHED — the 'finish' event,
   * not merely the end() call — so a caller may exit the process on it. Rejects, naming the path,
   * if the stream failed at any point, including while it was draining. Idempotent: repeated calls
   * get the same answer, which for a failure is the same Error.
   */
  stop(): Promise<number>;
}

/**
 * Record every packet of a subscription as one JSON line each, preceded by a metadata line.
 *
 * Two properties this owes the caller, both of which were missing while it lived in the CLI:
 *
 *  - a decode failure costs the decoded fields, never the packet. The encrypted bytes go down
 *    whatever the decoder made of them, with the reason beside them.
 *  - stopping means the bytes are on disk. `out.end()` returns before the buffer drains, so the
 *    old shutdown — end() and then process.exit() on the next line — reported "saved" over a file
 *    that was still missing its last writes.
 */
export function startRecording(opts: RecordingOptions): Recording {
  const char = opts.char ?? 'FFF6';
  let packets = 0;
  let failure: Error | null = null;
  let stopping: Promise<number> | null = null;

  const onPacket = (hex: string, ts: number) => {
    const { dec, event, error } = decodePacket(opts.cipher, hex, ts);
    const line: Record<string, unknown> = { ts, char, enc: hex };
    if (dec) line.dec = dec;
    if (event) line.event = event;
    if (error) line.decodeError = error;
    opts.out.write(`${JSON.stringify(line)}\n`);
    packets++;
    opts.onPacket?.(packets);
  };

  /**
   * The failure, named after the file it is about: "EACCES" alone does not say which path the
   * caller chose. Kept as the FIRST one seen, because a stream that fails once tends to report
   * again on the way down and the later reports are consequences of this one.
   */
  const named = (err: Error): Error =>
    (failure ??= new Error(`recording to ${opts.path} failed: ${err.message}`));

  const onStreamError = (err: Error) => {
    // A stream that cannot be written to is not a recording. Stop capturing at once rather than
    // counting packets into a file that is not receiving them.
    const e = named(err);
    opts.sub.off('packet', onPacket);
    opts.onError?.(e);
  };

  opts.out.on('error', onStreamError);
  opts.out.write(`${JSON.stringify({ meta: opts.meta })}\n`);
  opts.sub.on('packet', onPacket);

  return {
    get packets() {
      return packets;
    },
    stop(): Promise<number> {
      stopping ??= new Promise<number>((resolve, reject) => {
        opts.sub.off('packet', onPacket);
        if (failure) {
          reject(failure);
          return;
        }
        // A failure that lands between the check above and the flush below still has to be
        // answered, or this promise waits on a 'finish' that will never come.
        opts.out.on('error', (err: Error) => reject(named(err)));
        // end(cb) calls back on 'finish' — i.e. after everything buffered has been written — OR
        // with the error that made 'finish' unreachable, and that ARGUMENT is the only timely
        // report of a write failing while the buffer drains: Node invokes this callback with the
        // error before it emits 'error', so a version that ignored the argument resolved here and
        // the listener above arrived to find the promise already settled. Measured on 2026-09-05:
        // a three-packet recording whose last flush failed resolved with 3, and "saved" went on
        // the screen over a truncated file. The disk filling up is discovered on the flush, not on
        // the write that filled it, so this is the ordinary shape of the failure, not an exotic one.
        opts.out.end((err?: Error | null) => {
          if (err) reject(named(err));
          else resolve(packets);
        });
      });
      return stopping;
    },
  };
}

export interface ShutdownOptions {
  rec: Recording;
  /** Stop the packets before the file closes — nothing may arrive while the buffer drains. */
  stopPackets: () => void;
  /** The file being closed. Named in the message, because that is what "saved" is a claim about. */
  path: string;
  /** Where a save that happened is announced. */
  say: (msg: string) => void;
  /** Where a save that did not happen is announced. */
  warn: (msg: string) => void;
}

/**
 * The one way a recording ends, whichever way it was asked to — Ctrl-C, a terminal giveup, or a
 * stream that failed. Returns the process exit code: the one asked for when the file actually
 * closed, and 1 when it did not, because a capture that was not written is a failed run however
 * politely the shutdown was requested.
 *
 * Idempotent by construction: the three callers race each other by nature (a stream failing during
 * Ctrl-C is the ordinary case, not the exotic one), and a second shutdown would end an already
 * closed stream and print a second verdict on the same file.
 *
 * This lives here rather than in the CLI because it is the half of "saved" that can be wrong. It
 * was unreachable without hardware while it sat inside `cmdRecord`; a Recording is an interface
 * and a console is two functions, so nothing here needs the cube.
 */
export function recordingShutdown(opts: ShutdownOptions): (code: number) => Promise<number> {
  let ending: Promise<number> | null = null;
  return (code: number): Promise<number> => (ending ??= endRecording(opts, code));
}

async function endRecording(opts: ShutdownOptions, code: number): Promise<number> {
  opts.stopPackets();
  try {
    const packets = await opts.rec.stop();
    opts.say(`\nsaved ${packets} packets -> ${opts.path}`);
    return code;
  } catch (e) {
    opts.warn(`\n${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}
