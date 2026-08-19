// The thin, camera-driven shell around the pure ScanSession. This is the public
// `CubeScanner` contract from the plan. Only `attach`/`detach` touch the webcam;
// the capture path (grab -> sample -> session) runs on an injected FrameSource,
// so it can be exercised in tests without hardware. Excluded from the coverage
// gate — the camera lifecycle is verified manually in the app.

import { type CameraOptions, type FrameSource, openCamera } from './camera.js';
import { type RegionFn, ScanSession, defaultRegion, sampleFace } from './scanner.js';
import type { Face, ScanResult } from './types.js';

/** The public scanner contract (guided 6-face capture over a live video). */
export interface CubeScanner {
  /** Start the webcam into the given <video> element. */
  attach(video: HTMLVideoElement): Promise<void>;
  /** Sample the current frame as one face. */
  captureFace(face: Face): void;
  /** The next face to show, or null when all 6 are captured. */
  next(): Face | null;
  /** Faces captured so far. */
  progress(): Face[];
  /** The validated result once all 6 are in, else null. */
  result(): ScanResult | null;
  /** Discard captures and start over. */
  reset(): void;
  /** Stop the webcam and release it. */
  detach(): void;
}

export interface CubeScannerOptions {
  order?: readonly Face[];
  lowConfidenceThreshold?: number;
  /** Where the 3x3 grid sits in the frame; defaults to a centered square. */
  region?: RegionFn;
  camera?: CameraOptions;
  /** Inject a frame source instead of the webcam (used by tests). */
  source?: FrameSource;
}

class LiveCubeScanner implements CubeScanner {
  private readonly session: ScanSession;
  private readonly region: RegionFn;
  private readonly camera: CameraOptions;
  private source: FrameSource | null;
  private attachGen = 0;
  private attachController: AbortController | null = null;

  constructor(opts: CubeScannerOptions = {}) {
    this.session = new ScanSession({
      order: opts.order,
      lowConfidenceThreshold: opts.lowConfidenceThreshold,
    });
    this.region = opts.region ?? defaultRegion;
    this.camera = opts.camera ?? {};
    this.source = opts.source ?? null;
  }

  async attach(video: HTMLVideoElement): Promise<void> {
    // Cancel any in-flight open and stop the current camera, so a double
    // attach() (or a detach() mid-attach) can't leave an orphan stream running.
    this.attachController?.abort();
    this.source?.stop();
    this.source = null;
    const controller = new AbortController();
    this.attachController = controller;
    const gen = ++this.attachGen;

    let source: FrameSource;
    try {
      source = await openCamera(video, this.camera, controller.signal);
    } catch (err) {
      // A superseding attach()/detach() aborted this open — not a real failure.
      if (controller.signal.aborted) return;
      throw err;
    }
    if (gen !== this.attachGen) {
      source.stop(); // resolved just as it was superseded
      return;
    }
    this.source = source;
  }

  captureFace(face: Face): void {
    if (!this.source) throw new Error('scanner not attached: call attach(video) first');
    this.session.captureFace(face, sampleFace(this.source.grab(), this.region));
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
  }

  detach(): void {
    this.attachController?.abort(); // cancel any in-flight open
    this.attachController = null;
    this.attachGen++;
    this.source?.stop();
    this.source = null;
  }
}

/** Create a live cube scanner. Attach a <video>, then capture the 6 faces. */
export function createCubeScanner(opts: CubeScannerOptions = {}): CubeScanner {
  return new LiveCubeScanner(opts);
}
