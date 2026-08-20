// The live loop: the integration glue an app drives with camera frames. Per frame it
// localizes FIRST to define the cube ROI (§12/#17), measures motion on an OWNED luma
// snapshot restricted to that ROI (so background motion / a reused capture buffer can't
// fool the gate — §12/#14), and folds the result into the tracker. Loop logic is tested
// offline with an injected localizer; only the real camera + detector are hardware-bound.

import type { CubeState, Face } from './cube.js';
import type { RGB } from './perception/color.js';
import type { Localizer } from './perception/localize.js';
import {
  type Frame,
  type LumaGrid,
  type Rect,
  StabilityGate,
  lumaDiff,
  toLuma,
} from './perception/motion.js';
import type { RecoveryOptions } from './recovery.js';
import { CubeTracker } from './tracker.js';
import type { TrackStatus, TrackUpdate, TrackerConfig } from './types.js';

export interface LiveTrackerOptions {
  config?: TrackerConfig;
  recOpts?: RecoveryOptions;
  stabilityThreshold?: number; // max frame-diff to count as "still"
  stabilityFrames?: number; // consecutive still frames before a stable read
}

/** Per-frame inspection data — what the detector saw and what the gate/tracker did. */
export interface FrameDebug {
  facesDetected: number;
  cellsSeen: number;
  diff: number; // motion diff (∞ = first frame / size mismatch)
  stable: boolean;
  alignedGeometry: boolean;
  roi?: Rect;
  centers: { slot: Face; rgb: RGB }[]; // raw center colors read this frame
  status: TrackStatus;
  lastUpdate: TrackUpdate['kind'];
}

export class LiveTracker {
  private readonly tracker: CubeTracker;
  private readonly gate: StabilityGate;
  private prevLuma: LumaGrid | null = null;
  private frameDebug: FrameDebug | null = null;

  constructor(
    private readonly localizer: Localizer,
    opts: LiveTrackerOptions = {},
  ) {
    this.tracker = new CubeTracker(opts.config, opts.recOpts);
    // StabilityGate validates its args and fails loud on invalid options (§12/#11).
    this.gate = new StabilityGate(opts.stabilityThreshold, opts.stabilityFrames);
  }

  /** Seed with an acquired start state (from acquisition) — a fresh session. */
  seed(state: CubeState): void {
    this.tracker.seed(state);
    this.gate.reset();
    this.prevLuma = null;
  }

  /** Drive one camera frame through localize → ROI motion-gate → track. */
  pushFrame(frame: Frame, t: number): TrackUpdate {
    const { cells, alignedGeometry, roi, centers } = this.localizer.detect(frame); // localize first (§12/#17)
    const cur = toLuma(frame);
    // Motion measured within the cube ROI when known, else full-frame (re-entry search).
    const diff = this.prevLuma ? lumaDiff(this.prevLuma, cur, roi) : Number.POSITIVE_INFINITY;
    const stable = this.gate.push(diff);
    this.prevLuma = cur; // owned snapshot — never a reference to caller-mutable memory
    const u = this.tracker.update({ cells, stable, alignedGeometry, t });
    this.frameDebug = {
      facesDetected: centers?.length ?? Math.floor(cells.length / 9),
      cellsSeen: cells.length,
      diff,
      stable,
      alignedGeometry,
      roi,
      centers: centers ?? [],
      status: this.tracker.status(),
      lastUpdate: u.kind,
    };
    return u;
  }

  /** The last frame's inspection data (for a debug overlay / logs). */
  lastDebug(): FrameDebug | null {
    return this.frameDebug;
  }

  state(): CubeState | null {
    return this.tracker.state();
  }
  status(): TrackStatus {
    return this.tracker.status();
  }
  disambiguationPrompt(): Face | null {
    return this.tracker.disambiguationPrompt();
  }
  reset(): void {
    this.tracker.reset();
    this.gate.reset();
    this.prevLuma = null;
  }
}
