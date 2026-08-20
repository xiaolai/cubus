// The live loop: the integration glue an app drives with camera frames. Per frame it
// runs the motion gate (frame diff → stable?), localizes EVERY frame to define the ROI
// (§12/#17), and folds the result into the tracker. This is the piece the Electron app
// instantiates; its loop logic is tested offline with an injected localizer, and only
// the real camera + real detector remain hardware-bound.

import type { CubeState, Face } from './cube.js';
import type { Localizer } from './perception/localize.js';
import { type Frame, StabilityGate, frameDiff } from './perception/motion.js';
import type { RecoveryOptions } from './recovery.js';
import { CubeTracker } from './tracker.js';
import type { TrackStatus, TrackUpdate, TrackerConfig } from './types.js';

export interface LiveTrackerOptions {
  config?: TrackerConfig;
  recOpts?: RecoveryOptions;
  stabilityThreshold?: number; // max frame-diff to count as "still"
  stabilityFrames?: number; // consecutive still frames before a stable read
}

export class LiveTracker {
  private readonly tracker: CubeTracker;
  private readonly gate: StabilityGate;
  private prev: Frame | null = null;

  constructor(
    private readonly localizer: Localizer,
    opts: LiveTrackerOptions = {},
  ) {
    this.tracker = new CubeTracker(opts.config, opts.recOpts);
    this.gate = new StabilityGate(opts.stabilityThreshold, opts.stabilityFrames);
  }

  /** Seed with an acquired start state (from acquisition). */
  seed(state: CubeState): void {
    this.tracker.seed(state);
  }

  /** Drive one camera frame through motion-gate → localize → track. */
  pushFrame(frame: Frame, t: number): TrackUpdate {
    const diff = this.prev ? frameDiff(frame, this.prev) : Number.POSITIVE_INFINITY;
    const stable = this.gate.push(diff);
    this.prev = frame;
    const { cells, alignedGeometry } = this.localizer.detect(frame);
    return this.tracker.update({ cells, stable, alignedGeometry, t });
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
    this.prev = null;
  }
}
