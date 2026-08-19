// Convert Gen4 corner/edge permutation+orientation into a Kociemba facelet
// string (URFDLB order, 54 chars). Ported from afedotov/gan-web-bluetooth (MIT).

const CORNER_FACELET = [
  [8, 9, 20],
  [6, 18, 38],
  [0, 36, 47],
  [2, 45, 11],
  [29, 26, 15],
  [27, 44, 24],
  [33, 53, 42],
  [35, 17, 51],
];
const EDGE_FACELET = [
  [5, 10],
  [7, 19],
  [3, 37],
  [1, 46],
  [32, 16],
  [28, 25],
  [30, 43],
  [34, 52],
  [23, 12],
  [21, 41],
  [50, 39],
  [48, 14],
];
const SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';

export function toKociembaFacelets(cp: number[], co: number[], ep: number[], eo: number[]): string {
  // cp/co/ep/eo are validated permutations (built with parity checksums in the
  // decoder), so all table indices below are in range by cube invariants — the
  // non-null assertions document that, they don't paper over unchecked input.
  const f: string[] = SOLVED.split('');
  for (let i = 0; i < 8; i++) {
    const dst = CORNER_FACELET[i]!;
    const src = CORNER_FACELET[cp[i]!]!;
    const ori = co[i]!;
    for (let p = 0; p < 3; p++) {
      f[dst[(p + ori) % 3]!] = SOLVED[src[p]!]!;
    }
  }
  for (let i = 0; i < 12; i++) {
    const dst = EDGE_FACELET[i]!;
    const src = EDGE_FACELET[ep[i]!]!;
    const ori = eo[i]!;
    for (let p = 0; p < 2; p++) {
      f[dst[(p + ori) % 2]!] = SOLVED[src[p]!]!;
    }
  }
  return f.join('');
}

/** True if the string is a structurally valid facelet layout (9 of each color). */
export function isValidFaceletCounts(facelets: string): boolean {
  if (facelets.length !== 54) return false;
  const counts: Record<string, number> = {};
  for (const c of facelets) counts[c] = (counts[c] ?? 0) + 1;
  return ['U', 'R', 'F', 'D', 'L', 'B'].every((c) => counts[c] === 9);
}

export const SOLVED_FACELETS = SOLVED;
