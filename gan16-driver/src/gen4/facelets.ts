// Convert Gen4 corner/edge permutation+orientation into a Kociemba facelet
// string (URFDLB order, 54 chars). Ported from afedotov/gan-web-bluetooth (MIT).

const CORNER_FACELET = [
  [8, 9, 20], [6, 18, 38], [0, 36, 47], [2, 45, 11],
  [29, 26, 15], [27, 44, 24], [33, 53, 42], [35, 17, 51],
];
const EDGE_FACELET = [
  [5, 10], [7, 19], [3, 37], [1, 46], [32, 16], [28, 25],
  [30, 43], [34, 52], [23, 12], [21, 41], [50, 39], [48, 14],
];
const SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';

export function toKociembaFacelets(
  cp: number[],
  co: number[],
  ep: number[],
  eo: number[],
): string {
  const f: string[] = new Array(54);
  for (let i = 0; i < 54; i++) f[i] = SOLVED[i];
  for (let i = 0; i < 8; i++) {
    for (let p = 0; p < 3; p++) {
      f[CORNER_FACELET[i][(p + co[i]) % 3]] = SOLVED[CORNER_FACELET[cp[i]][p]];
    }
  }
  for (let i = 0; i < 12; i++) {
    for (let p = 0; p < 2; p++) {
      f[EDGE_FACELET[i][(p + eo[i]) % 2]] = SOLVED[EDGE_FACELET[ep[i]][p]];
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
