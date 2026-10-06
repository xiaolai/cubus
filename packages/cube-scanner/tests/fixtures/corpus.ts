// The corpus of recorded scans, as it stands (`dev-docs/scan-pipeline-audit-2026-09-23.md` §4,
// Stage 0.3) — one real sitting, and the honest description of what one sitting can measure.
//
// BUILT FROM THE CLIP RATHER THAN COPIED FROM IT. `logo-cube-clip.json` already holds the frames:
// twenty seconds of a person at a desk showing all six sides of a cube whose white centre carries a
// blue logo, recorded 2026-09-18 on the camera the desktop app uses, read frame by frame by the
// shipped detector. Writing the same 316 KB out again in the session format would be two files that
// can disagree about what the camera saw, and the one lesson this whole audit rests on is that
// evidence must not be duplicated into a shape that can drift.
//
// WHAT IT IS NOT. One cube in one light on one camera is not the corpus §4 asks for — that is five
// cubes, three lightings, three cameras, careful and careless handling, and it needs a person and
// hardware. `describeCorpus` reports every one of those shortfalls, and the baseline measured over
// this entry says out loud that it is a statement about one sitting.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  parseSession,
  type RecordedDetection,
  type RecordedFrame,
  type RecordedSession,
  SESSION_SCHEMA,
} from '../../src/session-record.js';

/** The clip: `fps`, and per frame a list of `[cx, cy, w, h, s0…s5]`. No image is in it. */
interface Clip {
  fps: number;
  frames: number[][][];
}

/**
 * The cube as it physically was.
 *
 * `manual-verified` and not `smart-cube`: it was reached two ways that share nothing but the
 * detector — the clip completes to it on its own, and the full-precision replay of the same clip
 * reached it after the one tap the scan asked for. Two runs that file different frames agreeing on
 * one cube is agreement about the CUBE, which is what the format's `source` is asking about.
 */
export const LOGO_CUBE_TRUTH = 'RLFDUDFBUFLLRRFUBFUULFFULBRDRBRDLUDDBRRLLUBFBDUDDBFRBL';

/** One recorded box as the format wants it: the winner named, every score kept. */
function detectionOf(row: number[]): RecordedDetection {
  const scores = row.slice(4, 10);
  let classId = 0;
  for (let c = 1; c < scores.length; c++) if (scores[c]! > scores[classId]!) classId = c;
  return {
    cx: row[0]!,
    cy: row[1]!,
    w: row[2]!,
    h: row[3]!,
    classId,
    confidence: scores[classId]!,
    scores,
  };
}

/**
 * The 09-18 sitting as a `RecordedSession`.
 *
 * Every frame gets its own id: the clip is a real camera's output at 30 fps, one picture per entry,
 * so the frames ARE distinct and `served` is one. A recording made by `SessionRecorder` today would
 * carry the camera's own ids and a `served` above one wherever a frame was re-served; this clip
 * predates that, and saying so is better than inventing the counts.
 */
export function logoCubeSession(dir: string): RecordedSession {
  const clip = JSON.parse(readFileSync(join(dir, 'logo-cube-clip.json'), 'utf8')) as Clip;
  const step = 1000 / clip.fps;
  const frames: RecordedFrame[] = clip.frames.map((boxes, i) => ({
    id: i,
    t: Math.round(i * step),
    served: 1,
    detections: boxes.map(detectionOf),
  }));
  // Through the reader, so a corpus entry cannot be built in a shape the reader refuses.
  return parseSession({
    schema: SESSION_SCHEMA,
    id: 'logo-cube-2026-09-18',
    startedAt: '2026-09-18T00:00:00Z',
    cube: 'logo-white-centre',
    conditions: {
      camera: 'studio-display',
      lighting: 'indoor-warm',
      handling: 'careful',
      state: 'scrambled',
      note: 'a white centre printed with a blue logo; the cube family six fixes failed on',
    },
    model: { hash: 'cubedet-0.6.0', name: 'cubedet', runtime: 'web' },
    // WESTERN, and measured rather than assumed (2026-09-25): `real-clip.test.ts` asks
    // `schemeShownIn` of the five sides this sitting captures and gets Western with a clear margin
    // — a Japanese reading would corrupt every Down and Back sticker, and the best ring agreement
    // here is 8 of 8. Recorded because a truth with no arrangement cannot say which COLOUR is in
    // the middle of a side, so a replay's answer policy would abstain on every question (ADR 0001,
    // and `SessionTruth.scheme` is optional exactly so that an unknown one is not invented).
    truth: { facelets: LOGO_CUBE_TRUTH, source: 'manual-verified', scheme: 'western' },
    frames,
    decisions: [],
  });
}

/** Every sitting the corpus holds, ready for `loadCorpus`. */
export function corpusEntries(dir: string): { source: string; value: unknown }[] {
  return [{ source: 'logo-cube-2026-09-18', value: logoCubeSession(dir) }];
}
