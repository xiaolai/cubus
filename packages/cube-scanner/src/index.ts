// Public API surface of cube-scanner. The pure core (types, facelet-cube, ai-assemble) is
// DOM-free and Node-testable; the camera + ONNX detector are the thin browser shell. The view
// web component is published separately from `cube-scanner/view/ai-scan-panel.ts`.
//
// The AI (YOLOv11) sticker detector is the only scanner. The classical OpenCV path was removed;
// see git history if you need it.

// AI-scan path: the ONNX detector locates the 9 stickers per face; assembleColors maps the 6
// faces' colour classes to a validated cube state — solving each face's rotation by search — and
// gates it with the facelet-parity + cubejs dual verifier.
export {
  type AiScanResult,
  assembleColors,
  assemblePainted,
  type CentreResolution,
  type ColorFace,
  type Confirmation,
  type ConfirmRequest,
  LOW_CONFIDENCE_THRESHOLD,
  resolveCentres,
  SAME_SIDE_STICKERS,
  type StickerSuspect,
  sameSide,
  type UnnamedSide,
  withCentre,
} from './ai-assemble.js';
export {
  type CameraDevice,
  type CameraOptions,
  FrameNotReadyError,
  type FrameSource,
  openCamera,
} from './camera.js';
// The capture-and-inference seam: one interface both the browser (WebDetector, wasm) and the native
// desktop/mobile builds (NativeDetector, a Tauri plugin) satisfy. The panel consumes only this.
export type { Detector, DetectorSource, ModelOutput } from './detector.js';
export {
  CENTER_INDEX,
  type CubeState,
  centersOk,
  decodeFacelets,
  encodeFacelets,
  isSolvable,
  isStructurallyValid,
  SOLVED_FACELETS,
} from './facelet-cube.js';
export { diagnoseAcrossSchemes, type SchemeDiagnosis } from './misread-decode.js';
export {
  type DetectOptions,
  detectFace,
  fitFromOutput,
  IMG_SIZE,
  type Preprocessed,
  preprocess,
  type RunModel,
} from './onnx-detect.js';
export {
  type Detection,
  decodeDetections,
  dropNested,
  type FaceFit,
  type FitReason,
  type FitResult,
  fitFace,
  MIN_STICKER_CONFIDENCE,
  nms,
} from './onnx-postprocess.js';
// The colour scheme (ADR 0001): a capture is a COLOUR, its place on the cube a POSITION under a
// scheme, and these are the only functions allowed to turn one into the other.
export {
  adjacentIn,
  COLOUR_NAMES,
  COLOURS,
  type Colour,
  colourOf,
  colourOfSlot,
  commonNeighbours,
  holdOffset,
  isColour,
  neighbourColours,
  positionOf,
  SCHEME_COLOURS,
  SCHEMES,
  type Scheme,
  schemeOfCentres,
  slotOf,
} from './scheme.js';
export type { Face, Frame, Lab, Rect, RGB, ScanResult, StickerSample } from './types.js';
export { FACES } from './types.js';
