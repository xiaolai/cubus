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
   * if the stream failed. Idempotent: repeated calls get the same answer.
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

  const onStreamError = (err: Error) => {
    // A stream that cannot be written to is not a recording. Stop capturing at once rather than
    // counting packets into a file that is not receiving them, and name the file — the failure is
    // about a path the caller chose, and "EACCES" alone does not say which.
    failure = new Error(`recording to ${opts.path} failed: ${err.message}`);
    opts.sub.off('packet', onPacket);
    opts.onError?.(failure);
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
        opts.out.on('error', reject);
        // end(cb) calls back on 'finish', i.e. after everything buffered has been written.
        opts.out.end(() => resolve(packets));
      });
      return stopping;
    },
  };
}
