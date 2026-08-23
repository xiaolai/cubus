// Public API surface of cube-scanner. The pure core (types, color, grid,
// classify, assemble, facelet-cube, scanner) is DOM-free and Node-testable; the
// camera + live scanner are the thin browser shell. The view web component is
// published separately from `cube-scanner/view/scanner-panel.ts`.

export type { Face, RGB, Lab, Frame, Rect, StickerSample, ScanResult } from './types.js';
export { FACES } from './types.js';

export { toLab, ciede2000, rgbDistance } from './color.js';

export {
  centersOk,
  CENTER_INDEX,
  type CubeState,
  decodeFacelets,
  encodeFacelets,
  isSolvable,
  isStructurallyValid,
  SOLVED_FACELETS,
} from './facelet-cube.js';

export { gridCells, sampleCell, sampleGrid } from './grid.js';
export { type Classification, classify } from './classify.js';
export { assemble, LOW_CONFIDENCE_THRESHOLD } from './assemble.js';

export {
  CORNER_ANCHORS,
  CORNER_SHOTS,
  type CornerScanOptions,
  CornerScanSession,
  type CornerShotResult,
  assignCornerShot,
} from './corner-scan.js';

export { type OrientationResult, rotateFace, solveOrientations } from './orient.js';

// AI-scan path: the ONNX detector LOCATES stickers; their sampled pixel colours feed the SAME
// relative classifier + verifier as the classical path (`assemble`), so red↔orange is resolved
// by lighting-invariant per-cube comparison, not the detector's drifting absolute class.
export {
  type Detection,
  type FaceFit,
  type FitReason,
  type FitResult,
  decodeDetections,
  fitFace,
  nms,
} from './onnx-postprocess.js';
export {
  type DetectOptions,
  type DetectResult,
  type DetectedFace,
  type Preprocessed,
  type RunModel,
  IMG_SIZE,
  detectFace,
  preprocess,
  sampleMedianRgb,
} from './onnx-detect.js';

export {
  type GridResult,
  type StickerCell,
  cropFrame,
  dedupeCells,
  detectStickerGrid,
  downscaleFrame,
  findGrid,
  patchColor,
  ringColor,
} from './grid-detect.js';

export {
  defaultRegion,
  type RegionFn,
  sampleFace,
  ScanSession,
  type ScanSessionOptions,
} from './scanner.js';

export { type CameraOptions, type FrameSource, openCamera } from './camera.js';
export {
  createCubeScanner,
  type CubeScanner,
  type CubeScannerOptions,
} from './live-scanner.js';

export { applyCalibration, calibrationTransform, inverse, multiply } from './calibrate.js';
