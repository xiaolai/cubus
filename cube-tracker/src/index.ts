// Public API for @cubus/perception (cube-tracker).

// Core cube engine
export {
  applyMove,
  applySequence,
  type CubeState,
  cloneState,
  decodeFacelets,
  encodeFacelets,
  type Face,
  faceIndices,
  isSolvable,
  isStructurallyValid,
  type Move,
  MOVE_NAMES,
  MOVES,
  type Orientation,
  ORIENTATIONS,
  SOLVED_STATE,
  stateKey,
  statesEqual,
} from './cube.js';

// Contract types
export {
  DEFAULT_CONFIG,
  type FaceObs,
  type Hypothesis,
  type MoveEvent,
  type Observation,
  type SoftColor,
  type Tracker,
  type TrackerConfig,
  type TrackStatus,
  type TrackUpdate,
} from './types.js';

// Belief + likelihood
export { Belief } from './belief.js';
export { type CubeView, discrimCells, scoreView, type ViewCell } from './likelihood.js';

// Orientation
export {
  bestOrientationMatch,
  type CameraCell,
  faceMapOf,
  ORIENTATION_COUNT,
  render,
  resolveOrientations,
  toCubeView,
} from './orientation.js';

// Recovery + acquisition
export {
  acquireState,
  ballWithinDepth,
  DEFAULT_RECOVERY,
  exactDepthShell,
  recoverState,
  type RecoveryOptions,
  type RecoveryResult,
} from './recovery.js';

// Orchestrator + live loop
export { type CameraObservation, CubeTracker } from './tracker.js';
export { LiveTracker, type LiveTrackerOptions } from './live.js';

// Perception (pure parts)
export { CANONICAL_CENTERS, classifySoft, ciede2000, type RGB } from './perception/color.js';
export {
  type Frame,
  frameDiff,
  type LumaGrid,
  lumaDiff,
  type Rect,
  StabilityGate,
  toLuma,
} from './perception/motion.js';
export {
  classifyCells,
  computeHomography,
  createLocalizer,
  type DetectedFace,
  type Localizer,
  type LocalizerResult,
  nullDetector,
  type Point,
  projectQuad,
  type Quad,
  type QuadDetector,
  sampleQuad,
} from './perception/localize.js';

// Camera (impure shell)
export { type CameraHandle, openCamera } from './camera.js';

// Harness
export { eventsMatch, scoreSession, type SessionMetrics, toQuarterTurns } from './harness.js';

// e2e: record → replay → score (dev-only, smart-cube oracle)
export {
  type LatencyMs,
  replaySession,
  type Session,
  type SessionFrame,
  type SessionReport,
} from './replay.js';
export { type RecordedMove, SessionRecorder } from './record.js';
export { assignSlots, centroid, orderCorners } from './perception/geometry.js';
export {
  DEFAULT_OPENCV,
  opencvDetector,
  type OpencvDetectorOptions,
} from './perception/opencv-detector.js';
