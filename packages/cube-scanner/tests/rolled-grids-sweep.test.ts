// A seeded sweep of generated 3x3 faces — rolled, sheared, jittered, foreshortened, their centre
// box pushed off — read by `fitFace` and pinned in `fixtures/rolled-grids-sweep.json`, which
// `ml/test_pipeline.py` reads too (2026-09-21).
//
// WHY A GENERATED FILE AND NOT A GENERATOR IN EACH LANGUAGE. The lattice fit is written twice, in
// `src/onnx-postprocess.ts` and `ml/cube_infer.py`, and the 23 hand-made cases in
// `rolled-grids.json` could only show the two agreeing where somebody had thought to look. Three
// hundred cases across the whole space of holds is broad enough to catch a boundary the hand cases
// miss — but a generator run in both languages would feed each its own `cos`/`sin`, which differ in
// the last place between engines, and a case on a decision boundary would then be two different
// cases. So the detections are generated ONCE, here, stored to the last bit (JSON round-trips a
// double exactly in both languages), and both implementations are held to the same numbers.
//
// Two claims per case. The pinned one: the order (or the refusal) is what the TypeScript said the
// day the file was written, so a change in either implementation shows as a diff against the file.
// The semantic one, which does not depend on the pin: an accepted face is always a ROTATION of the
// truth — the detections are listed in true reading order, so the order must be one of the four
// rotations of 0..8 — never the corner/edge scramble of `dev-docs/scanner-audit-2026-09-20.md` §1.1.
//
// Re-generate only for a change you have explained: `ROLLED_SWEEP_WRITE=1 vitest run
// tests/rolled-grids-sweep.test.ts`. That mode also re-checks `rolled-grids.json`'s hand cases and
// refuses to write if a case not named in `EXPECTED_TO_CHANGE` would change.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type Detection, fitFace, ROLL_TIE_BAND_DEG } from '../src/onnx-postprocess.js';

const SWEEP = new URL('./fixtures/rolled-grids-sweep.json', import.meta.url);
const HAND = new URL('./fixtures/rolled-grids.json', import.meta.url);
const SEED = 20260921;
/** How far a regenerated coordinate may sit from the pinned one: one engine's libm against
 *  another's, and nothing more (see the regeneration test for the arithmetic). */
const LIBM_TOLERANCE_PX = 1e-9;
const CASES = 300;

interface SweepCase {
  name: string;
  /** The nominal roll in degrees, for a reader; the detections are what is pinned. */
  roll: number;
  detections: Detection[];
  order: number[] | null;
  reason?: string;
}
interface HandCase {
  name: string;
  detections: Detection[];
  order: number[] | null;
  reason?: string;
}

/** mulberry32: a 32-bit PRNG small enough to read, seeded so the sweep is the same every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Nine square stickers on a pitch, in TRUE reading order, under a hold: rolled by `roll` degrees,
 * columns leaning by `shear` steps per row, the far row `perspective` of the near row's size, each
 * centre jittered by up to `jitter` steps, the middle box pushed by `offset` (in steps), boxes
 * axis-aligned round the rolled sticker unless `tight`.
 */
function face(
  roll: number,
  opts: {
    shear?: number;
    perspective?: number;
    jitter?: number;
    offset?: [number, number];
    tight?: boolean;
  } = {},
  rand: () => number = () => 0.5,
): Detection[] {
  const { shear = 0, perspective = 1, jitter = 0, offset = [0, 0], tight = false } = opts;
  const th = (roll * Math.PI) / 180;
  const sticker = 74;
  const step = sticker + 10;
  const out: Detection[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let x = (c - 1) * step + shear * (r - 1) * step;
      let y = (r - 1) * step;
      if (r === 1 && c === 1) {
        x += offset[0] * step;
        y += offset[1] * step;
      }
      x += (rand() * 2 - 1) * jitter * step;
      y += (rand() * 2 - 1) * jitter * step;
      const scale = 1 - ((1 - perspective) * r) / 2;
      const side = sticker * scale * (tight ? 1 : Math.abs(Math.cos(th)) + Math.abs(Math.sin(th)));
      out.push({
        cx: 320 + x * Math.cos(th) - y * Math.sin(th),
        cy: 320 + x * Math.sin(th) + y * Math.cos(th),
        w: side,
        h: side,
        classId: (r * 3 + c) % 6,
        confidence: 0.9,
      });
    }
  }
  return out;
}

/** What `fitFace` makes of `detections`, as indices into them (by box, as the hand test does). */
function readingOf(detections: Detection[]): { order: number[] | null; reason?: string } {
  const r = fitFace(detections);
  if (!r.ok) return { order: null, reason: r.reason };
  const order = r.face.boxes!.map((b) =>
    detections.findIndex(
      (d) => d.cx - d.w / 2 === b[0] && d.cy - d.h / 2 === b[1] && d.w === b[2] && d.h === b[3],
    ),
  );
  return { order };
}

const ROT90 = [6, 3, 0, 7, 4, 1, 8, 5, 2];
const ROTATIONS = (() => {
  const all: number[][] = [];
  let o = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  for (let k = 0; k < 4; k++) {
    all.push(o);
    o = ROT90.map((i) => o[i]!);
  }
  return all;
})();
const isRotation = (order: number[]): boolean =>
  ROTATIONS.some((rot) => rot.every((v, i) => v === order[i]));

function generate(): SweepCase[] {
  const rand = mulberry32(SEED);
  const cases: SweepCase[] = [];
  for (let k = 0; k < CASES; k++) {
    const roll = -90 + 180 * rand();
    const shear = -0.5 + rand();
    const perspective = 0.8 + 0.2 * rand();
    const jitter = 0.08 * rand();
    const pushed = rand() < 0.5;
    const angle = 2 * Math.PI * rand();
    const reach = 0.25 * rand();
    const offset: [number, number] = pushed
      ? [reach * Math.cos(angle), reach * Math.sin(angle)]
      : [0, 0];
    const tight = rand() < 0.5;
    const detections = face(roll, { shear, perspective, jitter, offset, tight }, rand);
    const name = `sweep ${k}: roll ${roll.toFixed(1)}°, shear ${shear.toFixed(2)}, far row ${perspective.toFixed(2)}, jitter ${jitter.toFixed(3)}, centre off ${offset.map((v) => v.toFixed(2)).join(',')}, ${tight ? 'tight' : 'axis-aligned'} boxes`;
    cases.push({ name, roll, detections, ...readingOf(detections) });
  }
  return cases;
}

/**
 * The hand cases added on 2026-09-21, each pinning one mechanism by name; and the cases a named
 * change was expected to move, which the write mode lets through and nothing else.
 */
const HAND_ADDITIONS: { name: string; detections: Detection[] }[] = [
  {
    name: 'roll 27°, centre pushed (−19, −9) px',
    detections: face(27, { offset: [-19 / 84, -9 / 84] }),
  },
  {
    name: 'roll 30°, centre pushed (−25, −12) px',
    detections: face(30, { offset: [-25 / 84, -12 / 84] }),
  },
  {
    name: 'roll 35°, centre pushed a quarter step up',
    detections: face(35, { offset: [0, -0.25] }),
  },
  {
    name: 'roll 33°, jittered, centre pushed',
    detections: face(33, { jitter: 0.06, offset: [0.2, 0.1] }, mulberry32(7)),
  },
  { name: 'roll 41°, the tie band’s near edge', detections: face(41) },
  { name: 'roll 43°, inside the tie band', detections: face(43) },
  { name: 'roll 47°, inside the tie band', detections: face(47) },
  { name: 'roll 49°, the tie band’s far edge', detections: face(49) },
  {
    name: 'rolled 30°, leaning columns, near the tie in gap',
    detections: face(30, { shear: 0.3 }),
  },
];
const EXPECTED_TO_CHANGE = new Set([
  'roll 44°, axis-aligned boxes',
  'roll 45°, axis-aligned boxes',
  'roll 46°, axis-aligned boxes',
  // Read since the antipodes are matched exactly (2026-09-21); it was pinned refused for a day.
  'roll 30°, centre pushed (−25, −12) px',
]);

if (process.env.ROLLED_SWEEP_WRITE === '1') {
  it('writes the sweep fixture and brings the hand fixture up to date', () => {
    const hand = JSON.parse(readFileSync(HAND, 'utf8')) as { note: string; cases: HandCase[] };
    const drift: string[] = [];
    for (const c of hand.cases) {
      const now = readingOf(c.detections);
      const same =
        JSON.stringify(now.order) === JSON.stringify(c.order) &&
        (now.reason ?? null) === (c.reason ?? null);
      if (same) continue;
      if (!EXPECTED_TO_CHANGE.has(c.name)) {
        drift.push(
          `${c.name}: pinned ${JSON.stringify(c.order ?? c.reason)}, now ${JSON.stringify(now.order ?? now.reason)}`,
        );
        continue;
      }
      c.order = now.order;
      if (now.reason) c.reason = now.reason;
      else delete c.reason;
    }
    expect(drift, 'a hand case not expected to change would change — explain it first').toEqual([]);
    for (const add of HAND_ADDITIONS) {
      if (hand.cases.some((c) => c.name === add.name)) continue;
      hand.cases.push({ name: add.name, detections: add.detections, ...readingOf(add.detections) });
    }
    writeFileSync(fileURLToPath(HAND), `${JSON.stringify(hand, null, 1)}\n`);
    const sweep = {
      note: `Generated by tests/rolled-grids-sweep.test.ts (seed ${SEED}, ${CASES} cases): nine boxes in TRUE reading order under a random hold, and the reading order fitFace gives them as indices into \`detections\` — always a rotation of 0..8 when accepted — or null with the reason. Read by that test and by ml/test_pipeline.py, so the TypeScript and Python fits cannot drift on holds nobody wrote a case for. Re-generate only for a change you have explained (ROLLED_SWEEP_WRITE=1).`,
      seed: SEED,
      band: ROLL_TIE_BAND_DEG,
      cases: generate(),
    };
    writeFileSync(fileURLToPath(SWEEP), `${JSON.stringify(sweep, null, 1)}\n`);
  });
}

describe('the seeded sweep of generated holds, shared with ml/test_pipeline.py', () => {
  // Read inside each case, not at collection: in write mode the file may not exist yet.
  const load = (): { seed: number; cases: SweepCase[] } => JSON.parse(readFileSync(SWEEP, 'utf8'));

  it('is the sweep this file generates: the same seed, the same detections', () => {
    // A fixture regenerated from a different generator would pin different holds under the same
    // names; the detections themselves are the identity of the sweep.
    //
    // TO WITHIN ONE LIBM, NOT TO THE BIT. This check re-runs the generator, and the generator calls
    // `Math.cos`/`Math.sin`, which ECMAScript leaves "implementation-approximated": the same engine
    // on another CPU or another release may differ in the last place. It did — on 2026-09-21 the
    // fixture written on macOS arm64 (Node 24.18) failed at case 219 on CI's Linux x64 (Node 24.20),
    // while the pinned-reading test below, which feeds `fitFace` the STORED bits, passed there.
    // Nothing in `face()` can amplify that: the PRNG is integer-only, every branch compares a draw
    // with 0.5, each case takes a fixed 26 draws, and every output is linear in cos/sin — so one ulp
    // moves a coordinate by ~1e-13 px. The tolerance sits four orders above that and ten below a
    // 74 px sticker: any change to the generator itself still fails here. The integer fields are
    // exact, and the decisions are pinned by the next test on the stored numbers, not on these.
    const sweep = load();
    expect(sweep.seed).toBe(SEED);
    expect(sweep.cases).toHaveLength(CASES);
    const again = generate();
    for (let k = 0; k < CASES; k++) {
      const { name, detections: pinned } = sweep.cases[k]!;
      const now = again[k]!.detections;
      expect(now, name).toHaveLength(pinned.length);
      pinned.forEach((p, i) => {
        const n = now[i]!;
        expect(n.classId, `${name}, box ${i}: classId`).toBe(p.classId);
        expect(n.confidence, `${name}, box ${i}: confidence`).toBe(p.confidence);
        for (const key of ['cx', 'cy', 'w', 'h'] as const) {
          expect(
            Math.abs(n[key] - p[key]),
            `${name}, box ${i}, ${key}: generated ${n[key]}, pinned ${p[key]}`,
          ).toBeLessThanOrEqual(LIBM_TOLERANCE_PX);
        }
      });
    }
  });

  it('reads every case as pinned, and never as a scramble', () => {
    const sweep = load();
    let accepted = 0;
    for (const c of sweep.cases) {
      const now = readingOf(c.detections);
      expect(now.order, c.name).toEqual(c.order);
      if (c.order === null) {
        expect(now.reason, c.name).toBe(c.reason);
        continue;
      }
      accepted++;
      expect(isRotation(c.order), `${c.name}: ${c.order}`).toBe(true);
    }
    // Not vacuous: the sweep reads faces, and refuses only the few near the tie or pushed too far.
    expect(accepted).toBeGreaterThan(0.8 * CASES);
  });
});
