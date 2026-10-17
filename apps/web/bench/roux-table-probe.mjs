// The first-block table build alone, importable by Node AND by a page — so the same code is timed under V8
// and under JavaScriptCore, the engine every iPhone runs. Used by bench/roux-engines.mjs.

import Cube from '../vendor/cubejs.js';

const FACE_MOVES = ['U', 'R', 'F', 'D', 'L', 'B'].flatMap((f) => [f, `${f}2`, `${f}'`]);

/** Build the first block's whole distance table (5,322,240 states) by coordinates; return what it cost. */
export function buildFirstBlock(now = () => performance.now()) {
  const t0 = now();
  const edges = [6, 9, 10];
  const corners = [5, 6];
  const action = FACE_MOVES.map((m) => { const c = new Cube(); c.move(m); return c; });
  const edgeStep = action.map((a) => { const t = new Uint8Array(24); for (let i = 0; i < 12; i++) for (let o = 0; o < 2; o++) t[a.ep[i] * 2 + o] = i * 2 + ((o + a.eo[i]) % 2); return t; });
  const cornerStep = action.map((a) => { const t = new Uint8Array(24); for (let i = 0; i < 8; i++) for (let o = 0; o < 3; o++) t[a.cp[i] * 3 + o] = i * 3 + ((o + a.co[i]) % 3); return t; });
  const coord = (n, steps) => {
    const size = 24 ** n;
    const out = steps.map(() => new Int32Array(size));
    const d = new Uint8Array(n);
    for (let code = 0; code < size; code++) {
      let r = code;
      for (let i = n - 1; i >= 0; i--) { d[i] = r % 24; r = (r - d[i]) / 24; }
      for (let m = 0; m < steps.length; m++) { let c = 0; for (let i = 0; i < n; i++) c = c * 24 + steps[m][d[i]]; out[m][code] = c; }
    }
    return { size, out };
  };
  const E = coord(edges.length, edgeStep);
  const C = coord(corners.length, cornerStep);
  const SIZE = E.size * C.size;
  const solved = new Cube();
  let goal = 0;
  for (const x of edges) { const pos = solved.ep.indexOf(x); goal = goal * 24 + pos * 2 + solved.eo[pos]; }
  let gc = 0;
  for (const q of corners) { const pos = solved.cp.indexOf(q); gc = gc * 24 + pos * 3 + solved.co[pos]; }
  goal = goal * C.size + gc;
  const dist = new Uint8Array(SIZE).fill(255);
  const queue = new Int32Array(SIZE);
  dist[goal] = 0;
  queue[0] = goal;
  let head = 0;
  let tail = 1;
  while (head < tail) {
    const code = queue[head++];
    const dd = dist[code] + 1;
    const cc = code % C.size;
    const ec = (code - cc) / C.size;
    for (let m = 0; m < FACE_MOVES.length; m++) {
      const n = E.out[m][ec] * C.size + C.out[m][cc];
      if (dist[n] === 255) { dist[n] = dd; queue[tail++] = n; }
    }
  }
  let sum = 0;
  for (let i = 0; i < SIZE; i++) if (dist[i] !== 255) sum += dist[i];
  return { reached: tail, checksum: sum, ms: now() - t0 };
}
