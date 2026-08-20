// The public data contract. The core speaks only these plain shapes — no DOM
// classes — so the whole belief/recovery brain is Node-testable from synthetic or
// recorded observations (dev-docs/cube-tracker-plan.md §4).

import type { CubeState, Face, Move, Orientation } from './cube.js';

/**
 * A soft distribution over the 6 face colors plus an explicit `unknown` mass for
 * occluded / glare / off-sticker pixels. Every component is ε-floored (never 0, so
 * never `log 0`) and the seven values sum to 1 (algorithm §12/#18).
 */
export type SoftColor = Record<Face, number> & { unknown: number };

/**
 * One visible face, read in the FACE'S OWN frame (not cube coordinates): its 9
 * sticker soft-colors row-major and the soft-color of its center. The core infers
 * which physical face this is and its in-plane roll — the observation never asserts
 * orientation (algorithm §12/#2).
 */
export interface FaceObs {
  center: SoftColor;
  cells: SoftColor[]; // length 9, row-major in the face's own reading frame
  quadConfidence: number; // 0..1, how sure the localizer is of the quad
}

/** One perception frame handed to the tracker. */
export interface Observation {
  faces: FaceObs[]; // 0..3 visible faces
  stable: boolean; // motion gate: the cube is momentarily still
  alignedGeometry: boolean; // layers are aligned (not a paused mid-turn) — §12/#14
  t: number; // timestamp (ms)
}

export type TrackStatus = 'tracking' | 'partial' | 'ambiguous' | 'lost';

/** A completed move the tracker actually observed. */
export interface MoveEvent {
  move: Move;
  confidence: number;
  state: CubeState;
  t: number;
}

/** The result of feeding one observation to `update`. */
export type TrackUpdate =
  | { kind: 'move'; move: Move; confidence: number; state: CubeState } // observed move
  | { kind: 'resync'; state: CubeState; confidence: number } // after occlusion: state, moves unknown (§12/#1)
  | { kind: 'hold'; status: TrackStatus; confidence: number } // nothing committed this frame
  | { kind: 'lost' }; // poor absolute fit / null hypothesis wins (§12/#4)

/** One joint hypothesis: a legal state, an orientation, and the pending transition. */
export interface Hypothesis {
  state: CubeState;
  orientation: Orientation;
  pending: Move[]; // provenance since the last committed state (§12/#5)
  weight: number;
}

export interface TrackerConfig {
  beamWidth: number; // K, default 16
  commitThreshold: number; // θ_commit, default 0.95
  commitStableFrames: number; // N distinct-viewpoint confirmations, default 3
  recoveryMaxDepth: number; // N_max, default 4
  noMovePrior: number; // mild bias toward identity, default 0.5
  absoluteFitFloor: number; // min mean per-cell likelihood to ALLOW a commit (§12/#4)
  lostFitFloor: number; // below this mean per-cell fit for the best candidate → lost/recovery (§12/#4)
  maxEmptyFrames: number; // consecutive no-detection frames before status → lost (§12/#7)
}

export const DEFAULT_CONFIG: TrackerConfig = {
  beamWidth: 16,
  commitThreshold: 0.95,
  commitStableFrames: 3,
  recoveryMaxDepth: 4,
  noMovePrior: 0.5,
  absoluteFitFloor: 0.5,
  lostFitFloor: 0.35,
  maxEmptyFrames: 10,
};

export interface Tracker {
  acquire(obs: Observation): { done: boolean; state: CubeState | null; confidence: number };
  update(obs: Observation): TrackUpdate;
  state(): CubeState | null;
  belief(): Hypothesis[];
  status(): TrackStatus;
  disambiguationPrompt(): Face | null;
  reset(): void;
}

export type { CubeState, Face, Move, Orientation };
