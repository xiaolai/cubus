// Session recorder: collects a live camera stream + the smart-cube ground truth into
// a scorable Session (dev-only). The app drives it — `addFrame` from camera.grab on
// each requestVideoFrameCallback, `addMove` from the gan-driver move events — and
// `finish()` yields a Session the replay runner scores offline. Decoupled from the
// concrete camera / driver so it is unit-testable.

import type { CubeState, Move } from './cube.js';
import type { Frame } from './perception/motion.js';
import type { Session, SessionFrame } from './replay.js';

export interface RecordedMove {
  move: Move;
  t: number; // smart-cube hardware timestamp (ms)
}

export class SessionRecorder {
  private frames: SessionFrame[] = [];
  private moves: RecordedMove[] = [];

  constructor(private readonly initialState: CubeState) {}

  /** A camera frame at its media time (ms) — call from requestVideoFrameCallback. */
  addFrame(frame: Frame, t: number): void {
    this.frames.push({ frame, t });
  }

  /** A ground-truth move at its hardware timestamp — call from the gan-driver stream. */
  addMove(move: Move, t: number): void {
    this.moves.push({ move, t });
  }

  frameCount(): number {
    return this.frames.length;
  }
  moveCount(): number {
    return this.moves.length;
  }

  /**
   * Produce a scorable Session. `clockOffsetMs` is added to the recorded move
   * timestamps to align the smart-cube clock onto camera media time (fit once from a
   * shared sync marker); it is used to KEEP only moves within the recorded frame span,
   * so an off-camera pre-roll turn is not scored (§12/#21).
   */
  finish(clockOffsetMs = 0): Session {
    let truth = this.moves;
    if (this.frames.length > 0) {
      const first = this.frames[0]!.t;
      const last = this.frames[this.frames.length - 1]!.t;
      truth = this.moves.filter((m) => {
        const mt = m.t + clockOffsetMs;
        return mt >= first && mt <= last;
      });
    }
    return {
      frames: [...this.frames],
      truthMoves: truth.map((m) => m.move),
      initialState: this.initialState,
    };
  }

  reset(): void {
    this.frames = [];
    this.moves = [];
  }
}
