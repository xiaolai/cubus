/**
 * Run the WHOLE pipeline over a recorded session, at the cadence it was recorded at or at another
 * one, and report what happened (`dev-docs/scan-pipeline-audit-2026-09-23.md` §4, Stage 0.2).
 *
 * THE REAL PANEL, NOT A MODEL OF IT. The frames go in through `Detector`, the seam both shipped
 * runtimes sit behind, and everything after it — decode, NMS, nested-box removal, isolation, fit,
 * the stillness gate, filing, assembly — is the code the app runs. A harness that re-implemented
 * any of those would measure the re-implementation, and the six fixes in §1.1 were each judged on
 * exactly that kind of stand-in.
 *
 * CADENCE IS A PARAMETER BECAUSE IT CHANGES THE ANSWER (T1). The stillness gate needs an unbroken
 * run of max(3, ⌈0.5·fps⌉+1) reads, so the FASTER runtime needs the LONGER run: 4 frames at 5 fps,
 * 9 at 15.7, 16 at 30. A fix measured only at the cadence of the machine it was written on is not
 * measured. `tickMs` re-serves the same recording to the same pipeline at a different rate, and the
 * frames are placed by their recorded timestamps, so a slower tick sees fewer of them — which is
 * what a slower machine sees.
 *
 * THE CLOCK IS THE CALLER'S. Driving a scan in real time would make a corpus run take as long as
 * the scans did; every caller fakes timers. So `advance` is injected, and the blocking measurement
 * takes a SEPARATE real clock, because the faked one cannot see how long a tick actually took —
 * which is the one thing the blocking metric is for (A3: 606 ms of centre resolution on the UI
 * thread).
 */

import type { CameraDevice } from '../src/camera.js';
import type { Detector, ModelOutput } from '../src/detector.js';
import type { SessionOutcome, SideOutcome } from '../src/session-metrics.js';
import type { RecordedFrame, RecordedSession } from '../src/session-record.js';
import { sessionFps } from '../src/session-record.js';
import { AiScanPanel, type ScanCapture, type ScanProgress } from './ai-scan-panel.js';

/**
 * The recorded detections of one frame as the tensor a detector hands over.
 *
 * The recording keeps candidates from BEFORE non-maximum suppression (see `session-recorder.ts`),
 * so re-running the panel's own decode, NMS and nested-box removal on them reproduces the set the
 * scan actually had — rather than a set already thinned by a different threshold, which is the trap
 * the 09-18 clip fixture sits in and the reason it cannot answer a question about NMS.
 */
export function frameTensor(frame: RecordedFrame, numClasses = 6): ModelOutput {
  const rows = 4 + numClasses;
  const anchors = Math.max(frame.detections.length, 1);
  const data = new Float32Array(rows * anchors);
  frame.detections.forEach((d, a) => {
    data[0 * anchors + a] = d.cx;
    data[1 * anchors + a] = d.cy;
    data[2 * anchors + a] = d.w;
    data[3 * anchors + a] = d.h;
    const scores = d.scores ?? [];
    for (let c = 0; c < numClasses; c++) data[(4 + c) * anchors + a] = scores[c] ?? 0;
  });
  return { data, anchors, rows };
}

/**
 * A recorded session as a `Detector`: whichever frame was in front of the camera when asked.
 *
 * `seen` counts how many ticks each frame was served to — the harness's own measurement of C3, and
 * the thing that makes "how many DISTINCT frames did this decision rest on" answerable at all. A
 * tick that arrives before the first recorded frame gets null, which is what a camera that has
 * opened but delivered nothing returns.
 */
export class RecordedDetector implements Detector {
  device: CameraDevice | null = null;
  /** Frame id → how many ticks were served it. Read after a replay. */
  readonly served = new Map<number, number>();
  private t0: number | null = null;

  constructor(
    private readonly session: RecordedSession,
    private readonly now: () => number = () => performance.now(),
  ) {}

  async use(): Promise<void> {
    this.device = { deviceId: `replay:${this.session.id}`, label: this.session.conditions.camera };
  }

  async load(): Promise<void> {}

  async next(): Promise<ModelOutput | null> {
    const now = this.now();
    if (this.t0 === null) this.t0 = now;
    const elapsed = now - this.t0;
    const first = this.session.frames[0]!;
    let current: RecordedFrame | null = null;
    for (const f of this.session.frames) {
      if (f.t - first.t > elapsed) break;
      current = f;
    }
    if (!current) return null;
    this.served.set(current.id, (this.served.get(current.id) ?? 0) + 1);
    return frameTensor(current);
  }

  async cameras(): Promise<CameraDevice[]> {
    return this.device ? [this.device] : [];
  }

  stop(): void {
    this.device = null;
  }
}

export interface ReplayOptions {
  /** How often the panel is ticked, in ms. Defaults to the session's own recorded cadence. */
  tickMs?: number;
  /**
   * How long the replay runs before the scan is called unfinished, in ms.
   *
   * Every uncaptured side is censored AT this time, so it is part of every number the run reports
   * and must be stated rather than defaulted silently per caller. Defaults to the session's own
   * length plus two seconds — long enough for a scan that was going to finish to finish.
   */
  deadlineMs?: number;
  /** Advance the caller's (usually faked) timers. The harness never sleeps on its own. */
  advance: (ms: number) => Promise<void>;
  /**
   * A clock that is NOT faked, for measuring how long each tick really blocked.
   *
   * Omitted means the run reports no blocking spans at all, rather than spans taken off a faked
   * clock — which would read as zero and pass a gate that exists to catch a frozen UI.
   */
  realNow?: () => number;
  /** Where the panel is mounted. Defaults to `document.body`. */
  host?: HTMLElement;
}

/**
 * Replay one recorded session and report how it went.
 *
 * The panel is driven headless: the host draws from `scan-progress`, so nothing here depends on
 * layout, and a corpus run is not a rendering benchmark.
 */
export async function replaySession(
  session: RecordedSession,
  options: ReplayOptions,
): Promise<SessionOutcome> {
  const fps = sessionFps(session);
  const tickMs = options.tickMs ?? (fps && fps > 0 ? Math.max(1, Math.round(1000 / fps)) : 60);
  const first = session.frames[0]!;
  const last = session.frames[session.frames.length - 1]!;
  const deadlineMs = options.deadlineMs ?? last.t - first.t + 2000;
  const host = options.host ?? document.body;

  const panel = new AiScanPanel();
  panel.setAttribute('headless', '');
  host.appendChild(panel);

  const sides: SideOutcome[] = [];
  const blockingMs: number[] = [];
  let reported: string | null = null;
  let completed = false;
  let looksAsked = 0;
  let confirming = false;
  let elapsed = 0;

  panel.addEventListener('scan-capture', (e) => {
    const detail = (e as CustomEvent<ScanCapture>).detail;
    sides.push({ face: detail.face ?? null, capturedAt: elapsed });
  });
  panel.addEventListener('scan-progress', (e) => {
    const detail = (e as CustomEvent<ScanProgress>).detail;
    // A LOOK IS AN EDGE, NOT A STATE. `confirm` stays set for every report while the scan waits,
    // so counting reports would count one request a hundred times and make "looks asked" a measure
    // of how long the wait was. The transition from no-request to request is the ask.
    const asking = detail.confirm !== null;
    if (asking && !confirming) looksAsked += 1;
    confirming = asking;
  });
  panel.addEventListener('scan-complete', (e) => {
    reported = (e as CustomEvent<{ facelets: string }>).detail.facelets;
    completed = true;
  });

  panel.useDetector(new RecordedDetector(session), 'native');
  await panel.start();

  const realNow = options.realNow;
  while (elapsed < deadlineMs && !completed) {
    const before = realNow?.();
    await options.advance(tickMs);
    if (before !== undefined && realNow) blockingMs.push(realNow() - before);
    elapsed += tickMs;
  }

  panel.remove();

  return {
    sessionId: session.id,
    cube: session.cube,
    deadlineMs,
    completed,
    reported,
    truth: session.truth.facelets,
    sides,
    looksAsked,
    blockingMs,
  };
}
