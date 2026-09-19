// The letterbox: how a camera picture of any shape is fitted into the model's square, and the way
// back (2026-09-19).
//
// ONE place for the arithmetic, because it was written out twice — the forward fit in `preprocess`
// and the inverse in `toFrameBox` — and a third copy was about to be added for the boxes the scan
// screen draws. Two copies of one formula agree only until one of them is edited. Every native
// runtime letterboxes the same way (Swift `Letterbox.swift`, Kotlin `VisionPlugin.kt`), which
// `ml/golden_frames.py` holds byte-exact; this is the JavaScript side of that contract.

/** How a `width`×`height` picture sits in an `imgsz` square: scaled to fit, centred, the rest padded. */
export interface Letterbox {
  scale: number;
  /** The picture's size once scaled, in whole pixels. */
  newW: number;
  newH: number;
  /** The padding before it, in whole pixels (the remainder goes after). */
  padX: number;
  padY: number;
}

export function letterboxOf(width: number, height: number, imgsz: number): Letterbox {
  const scale = imgsz / Math.max(width, height);
  const newW = Math.max(1, Math.round(width * scale));
  const newH = Math.max(1, Math.round(height * scale));
  return {
    scale,
    newW,
    newH,
    padX: Math.floor((imgsz - newW) / 2),
    padY: Math.floor((imgsz - newH) / 2),
  };
}
