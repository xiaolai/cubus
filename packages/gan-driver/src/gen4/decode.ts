// Decode a single DECRYPTED Gen4 message into a typed event.
//
// This is the pure, stateless heart of the driver: no I/O, no buffering. The
// move-gap recovery and FIFO ordering live in the connection layer; everything
// here is testable directly from captured fixtures.
//
// Bit layouts verified against a physical GAN16 ui (2026-08-19). Protocol from
// afedotov/gan-web-bluetooth (MIT).

import { bytesToHex } from '../hex.js';
import { toKociembaFacelets } from './facelets.js';
import { MessageView } from './message-view.js';
import type { CubeEvent, Face } from './types.js';

export const GEN4_EVENT = {
  MOVE: 0x01,
  MOVE_HISTORY: 0xd1,
  FACELETS: 0xed,
  GYRO: 0xec,
  BATTERY: 0xef,
  DISCONNECT: 0xea,
  // Hardware sub-events are 0xFA..0xFE.
} as const;

const FACE_ORDER: Face[] = ['U', 'R', 'F', 'D', 'L', 'B'];
/** MOVE face field value -> index into FACE_ORDER (afedotov mapping). */
const MOVE_FACE_LUT = [2, 32, 8, 1, 16, 4];

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

/** One hardware-info sub-field. Accumulated by the driver into a HARDWARE event. */
export interface HardwareField {
  type: 'HARDWARE_FIELD';
  timestamp: number;
  eventType: number;
  /** true for 0xF5/0xF6/0xFF — present on GAN16 ui, absent from upstream Gen4. */
  extra: boolean;
  key: string;
  value: string;
  rawHex: string;
}

function decodeHardwareField(
  msg: MessageView,
  eventType: number,
  dataLength: number,
  timestamp: number,
  rawHex: string,
): HardwareField {
  let key = `0x${eventType.toString(16)}`;
  let value = '';
  let extra = false;
  switch (eventType) {
    case 0xfa: {
      // product date
      const year = msg.getBitWord(24, 16, true);
      const month = msg.getBitWord(40, 8);
      const day = msg.getBitWord(48, 8);
      key = 'productDate';
      value = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      break;
    }
    case 0xfc: {
      // hardware name
      key = 'hardwareName';
      let s = '';
      for (let i = 0; i < dataLength - 1; i++) {
        const c = msg.getBitWord(24 + i * 8, 8);
        if (c >= 32 && c < 127) s += String.fromCharCode(c);
      }
      value = s;
      break;
    }
    case 0xfd: // software version
      key = 'softwareVersion';
      value = `${msg.getBitWord(24, 4)}.${msg.getBitWord(28, 4)}`;
      break;
    case 0xfe: // hardware version
      key = 'hardwareVersion';
      value = `${msg.getBitWord(24, 4)}.${msg.getBitWord(28, 4)}`;
      break;
    default: // 0xF5, 0xF6, 0xFF — GAN16-specific, kept as raw hex payload
      extra = true;
      value = rawHex.slice(4, 4 + (dataLength - 1) * 2);
      break;
  }
  return { type: 'HARDWARE_FIELD', timestamp, eventType, extra, key, value, rawHex };
}

export interface RawHistoryMove {
  face: Face;
  direction: 'cw' | 'ccw';
  offset: number; // 0 = newest in this history frame
}

/**
 * Decode one decrypted message. Returns a CubeEvent, or a MOVE_HISTORY marker,
 * or a CubeUnknown for recognized-but-unmapped event types. Never returns null:
 * unknown data is surfaced, not dropped.
 */
export type DecodeResult =
  | CubeEvent
  | HardwareField
  | { type: 'MOVE_HISTORY'; startSerial: number; moves: RawHistoryMove[] };

export function decodeGen4(decrypted: Uint8Array, timestamp: number): DecodeResult {
  const msg = new MessageView(decrypted);
  const eventType = msg.getBitWord(0, 8);
  const dataLength = msg.getBitWord(8, 8);
  const rawHex = bytesToHex(decrypted);

  if (eventType === GEN4_EVENT.MOVE) {
    const cubeTimestamp = msg.getBitWord(16, 32, true);
    const serial = msg.getBitWord(48, 16, true);
    const dir = msg.getBitWord(64, 2);
    const faceIdx = MOVE_FACE_LUT.indexOf(msg.getBitWord(66, 6));
    if (faceIdx < 0) return { type: 'UNKNOWN', timestamp, eventType, rawHex };
    const face = FACE_ORDER[faceIdx]!; // faceIdx in 0..5 after the guard
    const direction = dir === 0 ? 'cw' : 'ccw';
    return {
      type: 'MOVE',
      notation: face + (direction === 'ccw' ? "'" : ''),
      face,
      direction,
      amount: 1,
      serial,
      timestamp,
      cubeTimestamp,
    };
  }

  if (eventType === GEN4_EVENT.MOVE_HISTORY) {
    const startSerial = msg.getBitWord(16, 8);
    const count = (dataLength - 1) * 2;
    const HIST_FACE_LUT = [1, 5, 3, 0, 4, 2]; // history uses a different face encoding
    const moves: RawHistoryMove[] = [];
    for (let i = 0; i < count; i++) {
      const faceIdx = HIST_FACE_LUT.indexOf(msg.getBitWord(24 + 4 * i, 3));
      const dir = msg.getBitWord(27 + 4 * i, 1);
      if (faceIdx >= 0) {
        moves.push({ face: FACE_ORDER[faceIdx]!, direction: dir === 0 ? 'cw' : 'ccw', offset: i });
      }
    }
    return { type: 'MOVE_HISTORY', startSerial, moves };
  }

  if (eventType === GEN4_EVENT.FACELETS) {
    const serial = msg.getBitWord(16, 16, true);
    const cp: number[] = [];
    const co: number[] = [];
    const ep: number[] = [];
    const eo: number[] = [];
    for (let i = 0; i < 7; i++) {
      cp.push(msg.getBitWord(32 + i * 3, 3));
      co.push(msg.getBitWord(53 + i * 2, 2));
    }
    cp.push(28 - sum(cp));
    co.push((3 - (sum(co) % 3)) % 3);
    for (let i = 0; i < 11; i++) {
      ep.push(msg.getBitWord(69 + i * 4, 4));
      eo.push(msg.getBitWord(113 + i, 1));
    }
    ep.push(66 - sum(ep));
    eo.push((2 - (sum(eo) % 2)) % 2);
    return {
      type: 'FACELETS',
      serial,
      timestamp,
      facelets: toKociembaFacelets(cp, co, ep, eo),
      state: { CP: cp, CO: co, EP: ep, EO: eo },
    };
  }

  if (eventType === GEN4_EVENT.GYRO) {
    const s16 = (v: number) => ((1 - (v >> 15) * 2) * (v & 0x7fff)) / 0x7fff;
    const s4 = (v: number) => (1 - (v >> 3) * 2) * (v & 0x7);
    return {
      type: 'GYRO',
      timestamp,
      quaternion: {
        w: s16(msg.getBitWord(16, 16)),
        x: s16(msg.getBitWord(32, 16)),
        y: s16(msg.getBitWord(48, 16)),
        z: s16(msg.getBitWord(64, 16)),
      },
      velocity: {
        x: s4(msg.getBitWord(80, 4)),
        y: s4(msg.getBitWord(84, 4)),
        z: s4(msg.getBitWord(88, 4)),
      },
    };
  }

  if (eventType === GEN4_EVENT.BATTERY) {
    const level = msg.getBitWord(8 + dataLength * 8, 8);
    return { type: 'BATTERY', timestamp, level: Math.min(level, 100) };
  }

  // Hardware info is delivered as several single-field sub-events (0xFA..0xFF).
  // Upstream Gen4 maps 0xFA/0xFC/0xFD/0xFE; GAN16 ui additionally emits
  // 0xF5/0xF6/0xFF (0xFF carries the MAC/serial). We decode the mapped fields
  // and surface the rest as hardwareExtra so nothing is silently dropped.
  if (eventType >= 0xf5 && eventType <= 0xff) {
    return decodeHardwareField(msg, eventType, dataLength, timestamp, rawHex);
  }

  return { type: 'UNKNOWN', timestamp, eventType, rawHex };
}
