// Browser glue for the AI-scan path, kept dependency-free so the core stays pure and
// Node-testable: `preprocess` is a pure letterbox+normalize, and the model run itself is
// INJECTED by the panel (which owns onnxruntime-web). That way cube-scanner never imports
// a heavy wasm runtime, and the whole path is exercised in tests with a fake `run`.
//
// COLOUR STRATEGY: the detector is used for LOCALIZATION (finding the 9 sticker boxes), which
// is robust. Its absolute colour class is NOT trusted for the final read — an offline detector
// suffers "colour drifting" (red↔orange flip under lighting; measured ceiling ~94%). Instead we
// sample each sticker's true pixel colour here and let `assemble` classify it RELATIVE to the
// cube's own 6 centres (CIEDE2000) — invariant to lighting, ~100% red/orange on held-out data.

import { type FitReason, decodeDetections, fitFace, nms } from './onnx-postprocess.js';
import type { Frame, RGB } from './types.js';

export const IMG_SIZE = 640;
const PAD = 114 / 255; // Ultralytics letterbox pad colour (grey 114), normalized

export interface Preprocessed {
  data: Float32Array; // CHW RGB, [0,1], length 3*imgsz*imgsz
  imgsz: number;
  scale: number; // model-space coord = frame-space coord * scale
  padX: number; // left pad in model space (px)
  padY: number; // top pad in model space (px)
}

/**
 * Letterbox an RGBA frame to imgsz×imgsz (aspect-preserving, grey pad) and emit a CHW RGB
 * float tensor in [0,1] — the exact input Ultralytics YOLO expects. Bilinear resample so
 * it matches the training-time resize. Pure: no canvas, no DOM. Returns the scale/pad so a
 * detected box can be mapped back to frame pixels for colour sampling.
 */
export function preprocess(frame: Frame, imgsz: number = IMG_SIZE): Preprocessed {
  const { data: src, width: w, height: h } = frame;
  const scale = imgsz / Math.max(w, h);
  const newW = Math.max(1, Math.round(w * scale));
  const newH = Math.max(1, Math.round(h * scale));
  const padX = Math.floor((imgsz - newW) / 2);
  const padY = Math.floor((imgsz - newH) / 2);
  const plane = imgsz * imgsz;
  const out = new Float32Array(3 * plane).fill(PAD);

  for (let y = 0; y < newH; y++) {
    const sy = Math.min(h - 1, Math.max(0, (y + 0.5) / scale - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(h - 1, y0 + 1);
    const fy = sy - y0;
    const oy = y + padY;
    for (let x = 0; x < newW; x++) {
      const sx = Math.min(w - 1, Math.max(0, (x + 0.5) / scale - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(w - 1, x0 + 1);
      const fx = sx - x0;
      const o = oy * imgsz + (x + padX);
      for (let ch = 0; ch < 3; ch++) {
        const p00 = src[(y0 * w + x0) * 4 + ch]!;
        const p01 = src[(y0 * w + x1) * 4 + ch]!;
        const p10 = src[(y1 * w + x0) * 4 + ch]!;
        const p11 = src[(y1 * w + x1) * 4 + ch]!;
        const top = p00 + (p01 - p00) * fx;
        const bot = p10 + (p11 - p10) * fx;
        out[ch * plane + o] = (top + (bot - top) * fy) / 255;
      }
    }
  }
  return { data: out, imgsz, scale, padX, padY };
}

/**
 * Median sRGB of a box's central region, coords in FRAME pixels. Median over the central 50%
 * rejects gridline bleed at the edges and glare specks. Returns mid-grey if the box is off-frame.
 */
export function sampleMedianRgb(frame: Frame, cx: number, cy: number, w: number, h: number): RGB {
  const { data, width, height } = frame;
  const x0 = Math.max(0, Math.floor(cx - w * 0.25));
  const x1 = Math.min(width - 1, Math.ceil(cx + w * 0.25));
  const y0 = Math.max(0, Math.floor(cy - h * 0.25));
  const y1 = Math.min(height - 1, Math.ceil(cy + h * 0.25));
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * width + x) * 4;
      rs.push(data[i]!);
      gs.push(data[i + 1]!);
      bs.push(data[i + 2]!);
    }
  }
  if (rs.length === 0) return [128, 128, 128];
  const med = (a: number[]): number => {
    a.sort((p, q) => p - q);
    return a[a.length >> 1]!;
  };
  return [med(rs), med(gs), med(bs)];
}

/** The injected model call: input CHW tensor → flat output tensor + its anchor count. */
export type RunModel = (
  input: Float32Array,
  imgsz: number,
) => Promise<{ data: Float32Array; anchors: number }>;

export interface DetectOptions {
  numClasses?: number;
  confThreshold?: number;
  iouThreshold?: number;
  minConf?: number;
}

/**
 * One detected face: the detector's colour classes (fast live preview / prior) PLUS the sampled
 * true pixel colour of each sticker, in reading order. The sampled RGB — not the class — is the
 * lighting-robust input the relative classifier (`assemble`) uses for the final colour verdict.
 */
export interface DetectedFace {
  colors: number[];
  confidence: number[];
  rgb: RGB[];
}

export type DetectResult = { ok: true; face: DetectedFace } | { ok: false; reason: FitReason };

/**
 * One face detection: preprocess → run model → decode → NMS → fit the front 3×3 grid → sample
 * each grid sticker's true pixel colour. Returns a DetectedFace or an abstention
 * (NO_FACE / PARTIAL_FACE / BAD_GEOMETRY).
 */
export async function detectFace(
  frame: Frame,
  run: RunModel,
  opts: DetectOptions = {},
): Promise<DetectResult> {
  const { numClasses = 6, confThreshold = 0.25, iouThreshold = 0.45, minConf = 0.25 } = opts;
  const pre = preprocess(frame);
  const { data, anchors } = await run(pre.data, pre.imgsz);
  const dets = nms(decodeDetections(data, numClasses, anchors, confThreshold), iouThreshold);
  const fit = fitFace(dets, minConf);
  if (!fit.ok) return fit;
  // Map each grid box from model space back to frame pixels, then sample its true colour.
  const rgb = fit.face.boxes.map((d) =>
    sampleMedianRgb(
      frame,
      (d.cx - pre.padX) / pre.scale,
      (d.cy - pre.padY) / pre.scale,
      d.w / pre.scale,
      d.h / pre.scale,
    ),
  );
  return { ok: true, face: { colors: fit.face.colors, confidence: fit.face.confidence, rgb } };
}
