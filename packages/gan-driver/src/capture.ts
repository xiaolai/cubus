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
import { finished, type Writable } from 'node:stream';
import type { GanGen4Cipher } from './gen4/crypto.js';
import { type DecodeResult, decodeGen4 } from './gen4/decode.js';
import { bytesToHex, hexToBytes } from './hex.js';

/** A Gen4 message is 20 bytes on the wire — 40 hex characters. Anything else is not one. */
const FRAME_HEX_LENGTH = 40;

/**
 * How many recorded lines may wait for a stalled stream before the capture is called failed.
 *
 * `write()` returns false once the stream is over its high-water mark, and ignoring that answer is
 * how a slow disk becomes unbounded memory: measured on 2026-09-05, a stream with a 32-byte
 * high-water mark had 878,902 bytes queued inside it and still climbing, because every packet was
 * pushed in whatever the stream said. A notification handler cannot wait, so the choice is bounded
 * memory or lost evidence — this takes bounded memory up to here and then fails loudly, because a
 * capture that quietly dropped frames is worse than one that stopped and said so.
 *
 * 10,000 lines is ~1.5 MB of JSONL, and the four committed captures all ran at ~12 packets/s, so
 * it is about fourteen minutes of a stream accepting nothing at all. A disk that has not taken a
 * byte in fourteen minutes is not slow.
 */
export const MAX_QUEUED_LINES = 10_000;

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
   * Stop capturing and close the file. Resolves once the stream has CLOSED — 'close', which comes
   * after 'finish', not merely the end() call — so a caller may exit the process on it. Rejects,
   * naming the path, if the stream failed at any point, including while it was draining and
   * including on the close itself. Idempotent: repeated calls get the same answer, which for a
   * failure is the same Error.
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
  /** True while the stream is over its high-water mark: lines go to `queued` until it drains. */
  let full = false;
  /** Lines the stream has refused for now, in order. Bounded by MAX_QUEUED_LINES. */
  const queued: string[] = [];

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

  /** Hand the queue back to the stream, stopping again the moment it says it is full. */
  const drainQueue = () => {
    while (queued.length > 0) {
      const line = queued.shift() as string;
      if (!opts.out.write(line)) {
        opts.out.once('drain', drainQueue);
        return;
      }
    }
    full = false;
  };

  /**
   * One line to the stream, honouring its answer. False means the line was neither written nor
   * kept — the queue overflowed, which is reported exactly like any other stream failure because
   * it is one: the bytes are not reaching the file.
   */
  const writeLine = (line: string): boolean => {
    if (full) {
      if (queued.length >= MAX_QUEUED_LINES) {
        onStreamError(
          new Error(
            `the stream has not drained for ${MAX_QUEUED_LINES} packets — the capture is not reaching the disk`,
          ),
        );
        return false;
      }
      queued.push(line);
      return true;
    }
    if (!opts.out.write(line)) {
      full = true;
      opts.out.once('drain', drainQueue);
    }
    return true;
  };

  const onPacket = (hex: string, ts: number) => {
    const { dec, event, error } = decodePacket(opts.cipher, hex, ts);
    const line: Record<string, unknown> = { ts, char, enc: hex };
    if (dec) line.dec = dec;
    if (event) line.event = event;
    if (error) line.decodeError = error;
    if (!writeLine(`${JSON.stringify(line)}\n`)) return;
    packets++;
    opts.onPacket?.(packets);
  };

  opts.out.on('error', onStreamError);
  writeLine(`${JSON.stringify({ meta: opts.meta })}\n`);
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
        // Whatever the stream refused while it was full goes in now. The bound above protects a
        // LIVE capture, where packets keep arriving and memory is the only thing that can give;
        // end() below does not settle until every byte has drained, so the last write of a
        // recording has nothing to protect against and everything to lose by dropping a line.
        for (const line of queued.splice(0)) opts.out.write(line);
        // 'finish' says the buffer drained; 'close' says the file descriptor was released, and
        // only the second is what "saved" is a claim about — closing a file is itself a write on
        // any filesystem that defers, and it can fail on its own after every byte was accepted.
        // end(cb) calls back on 'finish', so a version built on it resolved with the count while
        // the close was still pending, and a close that then failed printed "saved" over a file
        // nobody could open (measured 2026-09-05: exit code 0, count 3, EIO on the close).
        //
        // finished() answers on 'close' when the stream emits one and on 'finish' when it does
        // not, and its error argument covers every way this can go wrong at once: a write that
        // fails while the buffer drains (Node reports that through end()'s callback FIRST and
        // then emits 'error', so the event is still what settles this), a stream destroyed
        // underneath the flush, and a close that failed. It is attached before end() so none of
        // those can land in the gap.
        finished(opts.out, (err) => {
          if (err) reject(named(err));
          else resolve(packets);
        });
        opts.out.end();
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

const reason = (e: unknown): string => (e instanceof Error ? e.message : String(e));

async function endRecording(opts: ShutdownOptions, code: number): Promise<number> {
  // stopPackets() is the transport's, and a transport can fail to stop: a child process that will
  // not die, a handle already gone. That is not a reason to abandon the file. It threw from
  // OUTSIDE this try until 2026-09-05, so rec.stop() was never reached — the buffered packets
  // never flushed, and the rejection went to a caller that only ever calls .then(), so the process
  // stayed up under no verdict at all. The file is closed either way now; the failure is reported
  // and costs the exit code, because a run that could not stop its own transport is not a clean
  // one and its last lines may have been written while the file was closing.
  let stuck: string | null = null;
  try {
    opts.stopPackets();
  } catch (e) {
    stuck = reason(e);
  }
  try {
    const packets = await opts.rec.stop();
    if (stuck) {
      opts.warn(
        `\nsaved ${packets} packets -> ${opts.path}, but the packet source would not stop: ${stuck}`,
      );
      return 1;
    }
    opts.say(`\nsaved ${packets} packets -> ${opts.path}`);
    return code;
  } catch (e) {
    opts.warn(`\n${reason(e)}`);
    return 1;
  }
}
