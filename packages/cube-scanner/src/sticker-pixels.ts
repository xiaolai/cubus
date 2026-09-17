// THE PIXELS UNDER A STICKER, in the one form the assembly can use: a median CIE Lab.
//
// The detector's scores answer "what colour is this sticker" and the assembly's last resort answers
// "which stickers carry the same paint" (`paint-groups.ts`). The second question needs the frame, and
// the frame exists for a moment inside the detector and nowhere else afterwards — so it is read here,
// at the only point where a frame and a fitted grid are both in hand, and reduced to 54 triples.
//
// WHY THE MEDIAN, AND WHY THE MIDDLE. A sticker's edges carry the black border and a smear of its
// neighbour, and a mean would pull both in; the median of the middle 60% is the paint. This is the
// same reduction `ml/drop_eval.py::median_lab` performs, so the evaluation asks the assembly the
// question the app asks it.
//
// WHY Lab RATHER THAN RGB. The comparison that matters is between stickers, and Lab's a* and b*
// separate hue from brightness — a face turned away from the window is darker paint-for-paint, and
// the grouping ignores L* for exactly that reason.

import type { Frame } from './types.js';

/** The fraction of a sticker kept, centred: 0.6 leaves the border and the bleed outside. */
export const INNER = 0.6;

/** A box in the coordinates of the frame it was measured in: x, y, width, height. */
export type Box = readonly [number, number, number, number];

/**
 * A box in MODEL space (the letterboxed square the detector saw) mapped back onto the frame.
 *
 * The letterbox is aspect-preserving with a centred pad, so the inverse is the same arithmetic
 * `preprocess` does, read backwards. Kept next to the reader rather than inside it because the
 * detector is the only thing that knows `imgsz`.
 */
export function toFrameBox(box: Box, frame: Frame, imgsz: number): Box {
  const scale = imgsz / Math.max(frame.width, frame.height);
  const padX = Math.floor((imgsz - Math.max(1, Math.round(frame.width * scale))) / 2);
  const padY = Math.floor((imgsz - Math.max(1, Math.round(frame.height * scale))) / 2);
  return [(box[0] - padX) / scale, (box[1] - padY) / scale, box[2] / scale, box[3] / scale];
}

/**
 * The median CIE Lab (D65) of a sticker's middle, from an RGBA frame.
 *
 * Returns null when the box lands outside the frame entirely — a fit that produced one is not a fit
 * whose pixels should be trusted, and a silent zero would look like a very dark sticker.
 */
export function medianLab(frame: Frame, box: Box): [number, number, number] | null {
  const cx = box[0] + box[2] / 2;
  const cy = box[1] + box[3] / 2;
  const x0 = Math.max(0, Math.floor(cx - (box[2] * INNER) / 2));
  const x1 = Math.min(frame.width, Math.ceil(cx + (box[2] * INNER) / 2));
  const y0 = Math.max(0, Math.floor(cy - (box[3] * INNER) / 2));
  const y1 = Math.min(frame.height, Math.ceil(cy + (box[3] * INNER) / 2));
  if (x1 <= x0 || y1 <= y0) return null;

  const l: number[] = [];
  const a: number[] = [];
  const b: number[] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * frame.width + x) * 4;
      const [L, A, B] = rgbToLab(frame.data[i]!, frame.data[i + 1]!, frame.data[i + 2]!);
      l.push(L);
      a.push(A);
      b.push(B);
    }
  }
  return [median(l), median(a), median(b)];
}

/** Every sticker of a fitted grid, or null unless every one of them could be read. */
export function stickerLab(
  frame: Frame,
  boxes: readonly Box[],
  imgsz: number,
): [number, number, number][] | null {
  const out: [number, number, number][] = [];
  for (const box of boxes) {
    const lab = medianLab(frame, toFrameBox(box, frame, imgsz));
    if (!lab) return null;
    out.push(lab);
  }
  return out;
}

/** sRGB (0..255) to CIE Lab, D65 — the conversion `ml/drop_eval.py` mirrors. */
function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const lin = (v: number): number => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function median(values: number[]): number {
  values.sort((p, q) => p - q);
  const mid = values.length >> 1;
  return values.length % 2 ? values[mid]! : (values[mid - 1]! + values[mid]!) / 2;
}
