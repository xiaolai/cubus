import { describe, expect, it } from 'vitest';
import { assignNineOfEach, NUM_COLORS, PER_COLOR, STICKERS } from '../src/nine-of-each';

/** A legal cube: nine of each colour, shuffled deterministically so failures are reproducible. */
function legalCube(): number[] {
  const cube: number[] = [];
  for (let c = 0; c < NUM_COLORS; c++) for (let k = 0; k < PER_COLOR; k++) cube.push(c);
  let seed = 12345;
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = cube.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [cube[i], cube[j]] = [cube[j]!, cube[i]!];
  }
  return cube;
}

/** Scores a confident detector would emit for a known colouring. */
const confident = (classes: number[], conf = 0.95): number[][] =>
  classes.map((c) =>
    Array.from({ length: NUM_COLORS }, (_, k) => (k === c ? conf : (1 - conf) / 5)),
  );

const countsOf = (colors: number[]): number[] => {
  const k = new Array<number>(NUM_COLORS).fill(0);
  for (const c of colors) k[c]!++;
  return k;
};

describe('assignNineOfEach', () => {
  it('leaves a correct reading exactly as it found it', () => {
    // The constraint must be inert when it has nothing to repair. A version that reshuffles a
    // already-legal cube would trade real reads for its own opinion on every scan.
    const truth = legalCube();
    const result = assignNineOfEach(confident(truth));
    expect(result.colors).toEqual(truth);
    expect(result.changed).toEqual([]);
    expect(result.cost).toBe(0);
  });

  it('repairs a single misread the detector was unsure about', () => {
    const truth = legalCube();
    const scores = confident(truth);
    const victim = 7;
    const wrong = (truth[victim]! + 1) % NUM_COLORS;
    // The detector narrowly prefers the wrong colour: 0.40 against 0.38. Exactly the case the
    // counts can settle and the argmax cannot.
    scores[victim] = Array.from({ length: NUM_COLORS }, (_, k) =>
      k === wrong ? 0.4 : k === truth[victim] ? 0.38 : 0.01,
    );
    const result = assignNineOfEach(scores);
    expect(result.colors[victim]).toBe(truth[victim]);
    expect(result.changed).toEqual([victim]);
  });

  it('always returns exactly nine of each colour, whatever it is fed', () => {
    // This is the property the whole file exists for, so it is asserted on noise rather than on
    // tidy inputs: no reading it can produce may be an illegal cube.
    let seed = 999;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let trial = 0; trial < 200; trial++) {
      const scores = Array.from({ length: STICKERS }, () =>
        Array.from({ length: NUM_COLORS }, () => rnd()),
      );
      expect(countsOf(assignNineOfEach(scores).colors)).toEqual(
        new Array(NUM_COLORS).fill(PER_COLOR),
      );
    }
  });

  it('refuses malformed input rather than answering confidently', () => {
    // A NaN would propagate through the matching and yield an arbitrary assignment that looks
    // considered. Fail at the boundary, where the caller can still tell something went wrong.
    const withNaN = confident(legalCube());
    withNaN[3] = [0.1, Number.NaN, 0.1, 0.1, 0.1, 0.1];
    expect(() => assignNineOfEach(withNaN)).toThrow();
    expect(() => assignNineOfEach(confident(legalCube()).slice(0, STICKERS - 1))).toThrow();
    const shortRow = confident(legalCube());
    shortRow[0] = [0.5, 0.5];
    expect(() => assignNineOfEach(shortRow)).toThrow();
  });

  it('reports the likelihood it gave up, so a caller can refuse a repair it does not believe', () => {
    // Cost is the guard against trusting the constraint blindly. `ml/assign_sim.py` measured it
    // BREAKING 0.5% of v3's cubes and 3.2% of the from-scratch arms': it amplifies a good detector
    // and endangers a weak one, so the price has to be visible at the call site.
    const truth = legalCube();
    expect(assignNineOfEach(confident(truth)).cost).toBe(0);

    const overruled = confident(truth);
    overruled[0] = Array.from({ length: NUM_COLORS }, (_, k) =>
      k === (truth[0]! + 1) % NUM_COLORS ? 0.9 : 0.02,
    );
    const result = assignNineOfEach(overruled);
    expect(result.cost).toBeGreaterThan(0);
    expect(result.changed).toContain(0);
  });
});
