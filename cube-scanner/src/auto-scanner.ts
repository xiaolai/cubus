// The auto-capture, confirm-per-side orchestrator. For each face it waits for
// the frame to hold still, asks the injected detector to locate the face, samples
// the 9 stickers from that quad, and PROPOSES them — the caller shows the colors
// and the user accepts (advance) or rejects (re-scan the same face). The final
// classification + solvability check still happen once in `assemble`.
//
// Pure given its injected dependencies (a FrameSource and a FaceDetector), so the
// whole flow is Node-testable with a fake camera + fake detector — OpenCV.js
// lives only inside the detector the app supplies.

import type { FrameSource } from './camera.js';
import { type Quad, sampleQuad } from './homography.js';
import { ScanSession } from './scanner.js';
import { SteadyDetector, type SteadyOptions } from './stability.js';
import type { Face, Frame, RGB, ScanResult } from './types.js';

/** A face located in a frame -> its 9 sampled sticker colors, awaiting confirmation. */
export interface FaceProposal {
  face: Face;
  samples: RGB[];
  quad: Quad;
}

/** What the current frame yielded this tick. */
export type AutoStatus =
  | { kind: 'searching'; reason: 'moving' | 'no-face' }
  | { kind: 'proposed'; proposal: FaceProposal }
  | { kind: 'complete'; result: ScanResult }
  | { kind: 'idle' };

/** Locate a cube face in a frame (returns its 4 corners), or null if none. */
export type FaceDetector = (frame: Frame) => Quad | null;

export interface AutoScannerOptions {
  source: FrameSource;
  detectFace: FaceDetector;
  order?: readonly Face[];
  lowConfidenceThreshold?: number;
  steady?: SteadyOptions;
  /** Override the sampler (defaults to the perspective sampler). */
  sample?: (frame: Frame, quad: Quad) => RGB[];
}

export class AutoCubeScanner {
  private readonly session: ScanSession;
  private readonly steady: SteadyDetector;
  private readonly source: FrameSource;
  private readonly detectFace: FaceDetector;
  private readonly sample: (frame: Frame, quad: Quad) => RGB[];
  private pending: FaceProposal | null = null;

  constructor(opts: AutoScannerOptions) {
    this.session = new ScanSession({
      order: opts.order,
      lowConfidenceThreshold: opts.lowConfidenceThreshold,
    });
    this.steady = new SteadyDetector(opts.steady);
    this.source = opts.source;
    this.detectFace = opts.detectFace;
    this.sample = opts.sample ?? sampleQuad;
  }

  /** Process one camera frame and report what to do next. */
  tick(): AutoStatus {
    if (this.session.complete()) return { kind: 'complete', result: this.session.result()! };
    if (this.pending) return { kind: 'proposed', proposal: this.pending };

    const frame = this.source.grab();
    if (!this.steady.push(frame)) return { kind: 'searching', reason: 'moving' };

    const quad = this.detectFace(frame);
    if (!quad) return { kind: 'searching', reason: 'no-face' };

    const face = this.session.next();
    if (!face) return { kind: 'complete', result: this.session.result()! };
    this.pending = { face, samples: this.sample(frame, quad), quad };
    return { kind: 'proposed', proposal: this.pending };
  }

  /** Accept the proposed face and advance; returns the next status. */
  confirm(): AutoStatus {
    if (!this.pending) throw new Error('no proposed face to confirm');
    this.session.captureFace(this.pending.face, this.pending.samples);
    this.pending = null;
    this.steady.reset(); // require the cube to settle again for the next face
    return this.session.complete()
      ? { kind: 'complete', result: this.session.result()! }
      : { kind: 'idle' };
  }

  /** Discard the proposed face and keep scanning the same side. */
  reject(): void {
    this.pending = null;
    this.steady.reset();
  }

  next(): Face | null {
    return this.session.next();
  }

  progress(): Face[] {
    return this.session.progress();
  }

  result(): ScanResult | null {
    return this.session.result();
  }

  reset(): void {
    this.session.reset();
    this.steady.reset();
    this.pending = null;
  }
}
