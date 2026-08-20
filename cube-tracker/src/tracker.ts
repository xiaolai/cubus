// The orchestrator: composes the belief core, orientation resolution, and recovery
// into one continuous tracker. Given a camera observation it resolves the joint
// (state, orientation) — trying the 19 successors against all 24 orientations —
// maps the view to cube coordinates, and folds it into the belief. On `lost` it
// runs bounded-depth recovery: resync the STATE, or fall back to re-acquisition.
//
// This module is the integration LOGIC and is fully testable offline from synthetic
// camera observations. The only piece it cannot verify without hardware is the live
// camera + real localizer (camera.ts / perception), which produce the
// CameraObservation this consumes.

import { Belief } from './belief.js';
import {
  type CubeState,
  FACES,
  type Face,
  IDENTITY_ORIENTATION,
  MOVE_NAMES,
  applyMove,
  encodeFacelets,
  faceIndices,
} from './cube.js';
import { type CameraCell, bestOrientationMatch, toCubeView } from './orientation.js';
import { DEFAULT_RECOVERY, type RecoveryOptions, recoverState } from './recovery.js';
import {
  DEFAULT_CONFIG,
  type Hypothesis,
  type TrackStatus,
  type TrackUpdate,
  type TrackerConfig,
} from './types.js';

/** A camera-frame observation: cells at camera slots, plus the gates from perception. */
export interface CameraObservation {
  cells: CameraCell[];
  stable: boolean; // motion gate — the cube is momentarily still
  alignedGeometry: boolean; // layer-alignment gate — not a paused mid-turn (§12/#14)
  t: number;
}

function argmaxFace(soft: { [k in Face]: number }): Face {
  let best: Face = 'U';
  let bestV = Number.NEGATIVE_INFINITY;
  for (const f of ['U', 'R', 'F', 'D', 'L', 'B'] as Face[]) {
    if (soft[f] > bestV) {
      bestV = soft[f];
      best = f;
    }
  }
  return best;
}
function hashCells(cells: CameraCell[]): string {
  return cells
    .map((c) => `${c.slot}:${argmaxFace(c.soft)}`)
    .sort()
    .join('|');
}

export class CubeTracker {
  private beliefState: Belief | null = null;
  private readonly cfg: TrackerConfig;
  private readonly recOpts: RecoveryOptions;
  private lastStatus: TrackStatus = 'lost';
  private wasStable = false; // for detecting the motion→still transition (a new episode)
  private ambiguousCandidates: CubeState[] = []; // the real set when recovery is ambiguous (§12/#22)

  constructor(cfg: TrackerConfig = DEFAULT_CONFIG, recOpts: RecoveryOptions = DEFAULT_RECOVERY) {
    this.cfg = cfg;
    this.recOpts = recOpts;
  }

  /** Seed the tracker with an acquired start state (from acquisition). */
  seed(state: CubeState): void {
    this.beliefState = new Belief(state, IDENTITY_ORIENTATION, this.cfg);
    this.lastStatus = 'tracking';
  }

  state(): CubeState | null {
    return this.beliefState ? this.beliefState.currentState() : null;
  }
  status(): TrackStatus {
    return this.lastStatus;
  }
  belief(): Hypothesis[] {
    return this.beliefState ? this.beliefState.hypotheses() : [];
  }

  /**
   * When ambiguous, the face whose reveal most splits the top hypotheses — the
   * MAX-INFORMATION face, not a fixed "show yellow" (§12/#22). Null if not ambiguous
   * or if no face separates the candidates.
   */
  disambiguationPrompt(): Face | null {
    if (this.lastStatus !== 'ambiguous') return null;
    const states =
      this.ambiguousCandidates.length >= 2
        ? this.ambiguousCandidates
        : (this.beliefState?.hypotheses(4).map((h) => h.state) ?? []);
    if (states.length < 2) return null;
    const facelets = states.map(encodeFacelets);
    let bestFace: Face | null = null;
    let bestSpread = 1;
    for (const face of FACES) {
      const idxs = faceIndices(face);
      const patterns = new Set(facelets.map((f) => idxs.map((i) => f[i]).join('')));
      if (patterns.size > bestSpread) {
        bestSpread = patterns.size;
        bestFace = face;
      }
    }
    return bestFace;
  }

  reset(): void {
    this.beliefState = null;
    this.lastStatus = 'lost';
  }

  update(obs: CameraObservation): TrackUpdate {
    if (!this.beliefState) return { kind: 'lost' };
    // Perception gates: only stable, layer-aligned frames advance the belief (§12/#14).
    if (!obs.stable || !obs.alignedGeometry || obs.cells.length === 0) {
      this.wasStable = false; // motion / mid-turn — the next still frame starts a new episode
      return {
        kind: 'hold',
        status: this.lastStatus,
        confidence: this.beliefState.currentConfidence(),
      };
    }
    // First still frame after motion: reset the evidence window so a move performed
    // during the gap is scored fresh, not penalised by pre-move still frames.
    if (!this.wasStable) this.beliefState.newEpisode();
    this.wasStable = true;
    this.ambiguousCandidates = []; // fresh each frame; set only by an ambiguous recovery

    const committed = this.beliefState.currentState();
    // Joint (state, orientation) resolution: score the 19 candidates × 24 orientations.
    const candidates = [committed, ...MOVE_NAMES.map((m) => applyMove(committed, m))];
    let bestO = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const c of candidates) {
      const { score, orientations } = bestOrientationMatch(encodeFacelets(c), obs.cells);
      if (score > bestScore) {
        bestScore = score;
        bestO = orientations[0]!;
      }
    }

    // If no single-move explanation fits well, the observation is off-model (a
    // multi-move gap, occlusion, or a lost track) — recover directly rather than
    // letting the joint resolution "explain it away" as a wrong single move (§12/#4).
    if (bestScore < this.recOpts.fitFloor) return this.runRecovery(committed, obs.cells);

    const u = this.beliefState.update(
      toCubeView(obs.cells, bestO),
      hashCells(obs.cells),
      String(bestO),
    );
    if (u.kind === 'lost') return this.runRecovery(committed, obs.cells);
    if (u.kind === 'move') this.lastStatus = 'tracking';
    else if (u.kind === 'hold') this.lastStatus = u.status;
    return u;
  }

  private runRecovery(committed: CubeState, cells: CameraCell[]): TrackUpdate {
    const rec = recoverState(committed, cells, this.recOpts);
    if (rec.kind === 'resync') {
      this.beliefState!.reset(rec.state);
      this.lastStatus = 'tracking';
      return { kind: 'resync', state: rec.state, confidence: rec.confidence };
    }
    if (rec.kind === 'reacquire') {
      this.beliefState = null; // beyond the ball — re-acquisition needed (§12/#6)
      this.lastStatus = 'lost';
      return { kind: 'lost' };
    }
    this.ambiguousCandidates = rec.candidates;
    this.lastStatus = 'ambiguous';
    return { kind: 'hold', status: 'ambiguous', confidence: 0 };
  }
}
