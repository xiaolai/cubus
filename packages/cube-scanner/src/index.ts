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

export { type CameraOptions, type FrameSource, openCamera } from './camera.js';

// AI-scan path: the ONNX detector locates the 9 stickers per face; assembleColors maps the 6
// faces' colour classes to a validated cube state — solving each face's rotation by search — and
// gates it with the facelet-parity + cubejs dual verifier.
export { type ColorFace, type AiScanResult, assembleColors } from './ai-assemble.js';
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
  type Preprocessed,
  type RunModel,
  IMG_SIZE,
  detectFace,
  preprocess,
} from './onnx-detect.js';
