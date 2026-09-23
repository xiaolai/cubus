import { describe, expect, it } from 'vitest';
import { assembleColors, type ColorFace } from '../src/ai-assemble';
import { NUM_COLORS } from '../src/nine-of-each';
import { FACES, type Face } from '../src/types';

const SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
const LETTER_CLASS: Record<Face, number> = { U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 };

/** Facelets -> six faces, with a six-way score vector per sticker. */
function facesWithScores(facelets: string, conf = 0.95): Record<Face, ColorFace> {
  const out = {} as Record<Face, ColorFace>;
  FACES.forEach((face, fi) => {
    const colors: number[] = [];
    const scores: number[][] = [];
    for (let k = 0; k < 9; k++) {
      const c = LETTER_CLASS[facelets[fi * 9 + k] as Face]!;
      colors.push(c);
      scores.push(Array.from({ length: NUM_COLORS }, (_, j) => (j === c ? conf : (1 - conf) / 5)));
    }
    out[face] = { colors, confidence: Array(9).fill(conf), scores };
  });
  return out;
}

describe('nine-of-each repair inside assembleColors', () => {
  it('recovers a cube the normal path refuses, when the detector was unsure', () => {
    // One sticker misread: an R sticker called orange. The counts now read eight reds and ten
    // oranges, no orientation is solvable, and before this repair existed the scan was refused.
    const faces = facesWithScores(SOLVED);
    const truth = LETTER_CLASS.R;
    const wrong = LETTER_CLASS.L;
    faces.R!.colors[0] = wrong;
    // The detector narrowly preferred the wrong colour -- 0.40 against 0.38. That margin is
    // exactly what the counts can settle and an argmax cannot.
    faces.R!.scores![0] = Array.from({ length: NUM_COLORS }, (_, j) =>
      j === wrong ? 0.4 : j === truth ? 0.38 : 0.01,
    );

    // ASKED FOR, NOT ASSERTED (D1, 2026-09-23). A repaired sticker is a colour nobody observed, so
    // the repair names it and asks for one look at the side rather than returning a cube. The
    // repair is still the thing that found the answer — without the scores there is nothing to ask
    // about at all, which the next case pins.
    const asked = assembleColors(faces);
    expect(asked.valid).toBe(false);
    expect(asked.confirm?.face).toBe('R');
    expect(asked.repaired).toEqual([{ face: 'R', index: 0, from: wrong, to: truth }]);

    // A second look that agrees settles it, and the cube is the one the detector nearly missed.
    const look = {
      capture: {
        ...faces.R!,
        colors: [...SOLVED.slice(9, 18)].map((l) => LETTER_CLASS[l as Face]!),
      },
      up: asked.confirm!.up,
    };
    const withScores = assembleColors(faces, undefined, { R: look });
    expect(withScores.valid).toBe(true);
    expect(withScores.facelets).toBe(SOLVED);
  });

  it('still refuses when the detector supplied no scores — the repair is evidence-driven', () => {
    // The SAME broken reading, with the score vectors stripped. Without evidence about the
    // alternatives there is nothing to repair from, and a refusal is the honest answer. This is
    // what proves the recovery above came from the scores and not from somewhere else.
    const faces = facesWithScores(SOLVED);
    faces.R!.colors[0] = LETTER_CLASS.L;
    for (const face of FACES) delete faces[face]!.scores;

    const result = assembleColors(faces);
    expect(result.valid).toBe(false);
  });

  it('leaves a correct reading exactly as it found it', () => {
    // The repair runs only after the normal path has failed, so a solvable cube must never reach
    // it. Asserted because the measured cost of running it everywhere is real: it BREAKS 0.5% of
    // the shipped model's cubes and 3.2% of a weaker model's.
    const result = assembleColors(facesWithScores(SOLVED));
    expect(result.valid).toBe(true);
    expect(result.facelets).toBe(SOLVED);
  });

  it('refuses rather than rewriting a reading it would have to overrule too hard', () => {
    // Five confident misreads is not one bad sticker, it is a bad capture. Rewriting it would
    // manufacture a cube nobody held, which is worse than asking for another look.
    const faces = facesWithScores(SOLVED);
    for (let k = 0; k < 5; k++) {
      faces.R!.colors[k] = LETTER_CLASS.L;
      faces.R!.scores![k] = Array.from({ length: NUM_COLORS }, (_, j) =>
        j === LETTER_CLASS.L ? 0.97 : 0.006,
      );
    }
    expect(assembleColors(faces).valid).toBe(false);
  });
});

describe('a sticker a person locked', () => {
  /** The one-misread cube the first test repairs: R0 read as orange, narrowly. */
  function misread(): Record<Face, ColorFace> {
    const faces = facesWithScores(SOLVED);
    faces.R!.colors[0] = LETTER_CLASS.L;
    faces.R!.scores![0] = Array.from({ length: NUM_COLORS }, (_, j) =>
      j === LETTER_CLASS.L ? 0.4 : j === LETTER_CLASS.R ? 0.38 : 0.01,
    );
    return faces;
  }

  it('is never moved by the count repair, even when moving it is the cheap fix', () => {
    const faces = misread();
    faces.R!.locked = Array<boolean>(9).fill(false);
    faces.R!.locked[0] = true; // the user said orange; the repair must take that as given
    expect(assembleColors(faces).valid).toBe(false);
  });

  it('does not stop the repair when the lock agrees with it', () => {
    const faces = misread();
    faces.R!.colors[0] = LETTER_CLASS.R; // corrected to the truth...
    faces.R!.scores![0] = Array.from({ length: NUM_COLORS }, (_, j) =>
      j === LETTER_CLASS.R ? 1 : 0,
    );
    faces.R!.locked = Array<boolean>(9).fill(false);
    faces.R!.locked[0] = true; // ...and locked there
    const result = assembleColors(faces);
    expect(result.valid).toBe(true);
    expect(result.facelets).toBe(SOLVED);
  });
});
