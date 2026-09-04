// Public API surface of cube-scanner. The pure core (types, facelet-cube, ai-assemble) is
// DOM-free and Node-testable; the camera + ONNX detector are the thin browser shell. The view
// web component is published separately from `cube-scanner/view/ai-scan-panel.ts`.
//
// The AI (YOLOv11) sticker detector is the only scanner. The classical OpenCV path was removed;
// see git history if you need it.

export type { Face, RGB, Lab, Frame, Rect, StickerSample, ScanResult } from './types.js';
export { FACES } from './types.js';

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

export {
  type CameraDevice,
  type CameraOptions,
  type FrameSource,
  FrameNotReadyError,
  openCamera,
} from './camera.js';

// The capture-and-inference seam: one interface both the browser (WebDetector, wasm) and the native
// desktop/mobile builds (NativeDetector, a Tauri plugin) satisfy. The panel consumes only this.
export type { Detector, DetectorSource, ModelOutput } from './detector.js';

// AI-scan path: the ONNX detector locates the 9 stickers per face; assembleColors maps the 6
// faces' colour classes to a validated cube state — solving each face's rotation by search — and
// gates it with the facelet-parity + cubejs dual verifier.
export {
  type ColorFace,
  type AiScanResult,
  LOW_CONFIDENCE_THRESHOLD,
  assembleColors,
  assemblePainted,
} from './ai-assemble.js';
export {
  type Detection,
  type FaceFit,
  type FitReason,
  type FitResult,
  MIN_STICKER_CONFIDENCE,
  decodeDetections,
  fitFace,
  nms,
} from './onnx-postprocess.js';
export {
  type DetectOptions,
  type Preprocessed,
  type RunModel,
  IMG_SIZE,
  detectFace,
  fitFromOutput,
  preprocess,
} from './onnx-detect.js';
