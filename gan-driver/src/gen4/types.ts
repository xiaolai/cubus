// Public event and value types for the GAN16 (Gen4) driver.

export type Face = 'U' | 'R' | 'F' | 'D' | 'L' | 'B';
export type Direction = 'cw' | 'ccw';

/** A completed quarter-turn face move. */
export interface CubeMove {
  type: 'MOVE';
  /** Standard notation, e.g. "R" or "R'". */
  notation: string;
  face: Face;
  direction: Direction;
  amount: 1;
  /** Cube move counter (0..255, wraps). Used to detect missed moves. */
  serial: number;
  /** Host receive time (ms since epoch). */
  timestamp: number;
  /** Cube-internal hardware timestamp (ms), monotonic while connected. */
  cubeTimestamp: number | null;
}

/** Full cube state as a Kociemba facelet string plus raw permutation arrays. */
export interface CubeFacelets {
  type: 'FACELETS';
  serial: number;
  timestamp: number;
  facelets: string;
  state: { CP: number[]; CO: number[]; EP: number[]; EO: number[] };
}

/** Orientation of the whole cube in space (unit quaternion) + angular velocity. */
export interface CubeGyro {
  type: 'GYRO';
  timestamp: number;
  quaternion: { w: number; x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
}

export interface CubeBattery {
  type: 'BATTERY';
  timestamp: number;
  level: number;
}

export interface CubeHardware {
  type: 'HARDWARE';
  timestamp: number;
  hardwareName: string;
  hardwareVersion: string;
  softwareVersion: string;
  productDate: string;
  gyroSupported: boolean;
}

/** A recognized event type whose fields we have NOT yet mapped. Never dropped. */
export interface CubeUnknown {
  type: 'UNKNOWN';
  timestamp: number;
  eventType: number;
  rawHex: string;
}

export type CubeEvent =
  | CubeMove
  | CubeFacelets
  | CubeGyro
  | CubeBattery
  | CubeHardware
  | CubeUnknown;
