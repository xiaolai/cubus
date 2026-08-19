// Shared data types for the scanner. The pure core speaks only these plain
// shapes — no DOM classes — so every pipeline stage is Node-testable from
// stored frames, exactly like the driver's fixture tests.

/** The six cube faces, in Kociemba / URFDLB order. */
export type Face = 'U' | 'R' | 'F' | 'D' | 'L' | 'B';

/** The faces in canonical URFDLB order — the order facelets are laid out in. */
export const FACES: readonly Face[] = ['U', 'R', 'F', 'D', 'L', 'B'] as const;

/** sRGB triple, each channel 0..255. */
export type RGB = [number, number, number];

/** CIELAB color: L* 0..100, a* and b* roughly -128..127. */
export interface Lab {
  l: number;
  a: number;
  b: number;
}

/**
 * A raw RGBA frame. Deliberately NOT the DOM `ImageData` class, so the pure
 * core can be constructed and tested in Node without a canvas.
 */
export interface Frame {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Axis-aligned pixel rectangle. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One sampled sticker: its median color plus the cell it was sampled from. */
export interface StickerSample {
  rgb: RGB;
  cell: Rect;
}

/** The validated output of a full 6-face scan. */
export interface ScanResult {
  /** Kociemba facelet string, URFDLB order, 54 chars. */
  facelets: string;
  /** cubejs + parity invariants agree the state is a solvable, well-formed cube. */
  valid: boolean;
  /** 0..1, the minimum per-sticker confidence across all 54 stickers. */
  confidence: number;
  /** Sticker indices (0..53) whose classification was ambiguous — re-check. */
  lowConfidence: number[];
}
