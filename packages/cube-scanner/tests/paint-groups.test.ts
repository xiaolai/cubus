import { describe, expect, it } from 'vitest';
import { NUM_COLORS, PER_COLOR, STICKERS } from '../src/nine-of-each';
import { colorsFromPaint, groupByPaint, type StickerLab } from '../src/paint-groups';

/** Where the six paints sit in the a*b* plane, roughly as a cube photographs under neutral light. */
const PAINT: [number, number][] = [
  [0, 2], // white
  [55, 40], // red
  [-50, 35], // green
  [-5, 70], // yellow
  [35, 60], // orange
  [10, -50], // blue
];

/** Per-face lighting a real scan has: six photographs of one cube, taken in one sitting. */
const SHIFTS: [number, number][] = [
  [0, 0],
  [6, -7],
  [-5, 6],
  [3, 8],
  [-7, -6],
  [4, 4],
];
/** Lighting differences wider than the gap between two paints — a case this cannot answer. */
const WILD: [number, number][] = [
  [0, 0],
  [18, -22],
  [-14, 20],
  [8, 25],
  [-20, -18],
  [12, 12],
];

/**
 * Nine of each colour, shuffled deterministically so a failure reproduces — AND each face's centre a
 * different colour, because that is what a cube is: centres never move, so face f's centre is
 * colour f. A plain shuffle is not a cube, and the code refuses one.
 */
function legalCube(): number[] {
  const rest: number[] = [];
  for (let c = 0; c < NUM_COLORS; c++) for (let k = 0; k < PER_COLOR - 1; k++) rest.push(c);
  let seed = 98765;
  for (let i = rest.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const j = seed % (i + 1);
    [rest[i], rest[j]] = [rest[j]!, rest[i]!];
  }
  const cube: number[] = [];
  for (let face = 0; face < NUM_COLORS; face++) {
    for (let k = 0; k < PER_COLOR; k++) cube.push(k === 4 ? face : rest.pop()!);
  }
  return cube;
}

/**
 * The pixels a camera would report: each sticker's paint, plus a per-FACE illuminant shift, which is
 * what a real scan has — six photographs, six lightings, one cube.
 */
function labFor(cube: readonly number[], shift: (face: number) => [number, number]): StickerLab {
  return cube.map((colour, i) => {
    const [da, db] = shift(Math.floor(i / 9));
    const [a, b] = PAINT[colour]!;
    return [60, a + da, b + db] as [number, number, number];
  });
}

describe('groupByPaint', () => {
  it('finds the six paints through a per-face lighting shift', () => {
    const cube = legalCube();
    // Each face lit differently, and every shift larger than the gap between red and orange.
    const lab = labFor(cube, (face) => SHIFTS[face]!);
    const groups = groupByPaint(lab)!;
    expect(groups).not.toBeNull();
    // A group is a set of stickers, not a colour: check the PARTITION matches, whatever it is called.
    const mapping = new Map<number, number>();
    for (const [i, g] of groups.entries()) {
      const colour = cube[i]!;
      if (!mapping.has(g)) mapping.set(g, colour);
      expect(mapping.get(g)).toBe(colour);
    }
    expect(mapping.size).toBe(NUM_COLORS);
  });

  it('gives every colour exactly nine stickers', () => {
    const cube = legalCube();
    const groups = groupByPaint(labFor(cube, () => [0, 0]))!;
    const counts = new Array<number>(NUM_COLORS).fill(0);
    for (const g of groups) counts[g]! += 1;
    expect(counts).toEqual(new Array<number>(NUM_COLORS).fill(PER_COLOR));
  });

  it('refuses anything that is not a whole cube of finite Lab', () => {
    expect(groupByPaint([])).toBeNull();
    const short = labFor(legalCube(), () => [0, 0]).slice(0, STICKERS - 1);
    expect(groupByPaint(short)).toBeNull();
    const broken = labFor(legalCube(), () => [0, 0]).map((row, i) =>
      i === 3 ? ([60, Number.NaN, 0] as [number, number, number]) : row,
    );
    expect(groupByPaint(broken)).toBeNull();
  });
});

describe('colorsFromPaint', () => {
  /** The centre of each face, in face order — what the assembly has already validated and filed by. */
  const centresOf = (cube: readonly number[]): number[] =>
    [0, 1, 2, 3, 4, 5].map((face) => cube[face * PER_COLOR + 4]!);

  it('repairs a whole pair the detector confidently misread', () => {
    // The scores are not consulted at all: whatever the detector said about these stickers, the
    // pixels group them and the centres name the groups. Nine stickers misread the same way -- the
    // failure the count repair cannot afford -- costs nothing here.
    const cube = legalCube();
    const colors = colorsFromPaint(
      labFor(cube, (face) => SHIFTS[face]!),
      centresOf(cube),
    )!;
    expect(colors).toEqual(cube);
  });

  it('refuses when the grouping puts two centres together', () => {
    // Two centres in one group means the pixels disagree with something the assembly has already
    // checked -- six distinct centres -- so the grouping is not to be trusted, not patched.
    const cube = legalCube();
    const lab = labFor(cube, () => [0, 0]).map((row, i) =>
      // paint the white centre exactly like the yellow one
      i === 4 ? ([60, PAINT[3]![0], PAINT[3]![1]] as [number, number, number]) : row,
    );
    expect(colorsFromPaint(lab, centresOf(cube))).toBeNull();
  });

  it('refuses a lighting difference wider than the gap between two paints', () => {
    const cube = legalCube();
    expect(
      colorsFromPaint(
        labFor(cube, (face) => WILD[face]!),
        centresOf(cube),
      ),
    ).toBeNull();
  });

  it('refuses centres that are not six distinct colours', () => {
    const cube = legalCube();
    const lab = labFor(cube, () => [0, 0]);
    expect(colorsFromPaint(lab, [0, 1, 2, 3, 4])).toBeNull();
    expect(colorsFromPaint(lab, [0, 1, 2, 3, 4, 4])).toBeNull();
    expect(colorsFromPaint(lab, [0, 1, 2, 3, 4, 9])).toBeNull();
  });
});

describe('a frame with no colour in it', () => {
  /**
   * The gate's whole job. Balanced k-means always answers, so a blown-out or monochrome capture —
   * every sticker the same a*b* — still comes back as six groups of nine. Nothing about that
   * grouping is evidence, and reading a cube out of it would be inventing one.
   */
  it('is refused, however confidently the grouping splits it', () => {
    const flat: StickerLab = Array.from({ length: STICKERS }, () => [62, 4, 4]);
    const centres = Array.from({ length: NUM_COLORS }, (_, f) => f);
    expect(colorsFromPaint(flat, centres)).toBeNull();
  });

  it('is refused when the paints differ only in lightness, which shading moves', () => {
    const shaded: StickerLab = Array.from({ length: STICKERS }, (_, i) => [
      30 + (i % NUM_COLORS) * 10,
      4,
      4,
    ]);
    const centres = Array.from({ length: NUM_COLORS }, (_, f) => f);
    expect(colorsFromPaint(shaded, centres)).toBeNull();
  });
});
