// Compare a driver facelet string against the user's hand-read cube (white up,
// green front). Per face we compare the COLOR MULTISET, which is independent of
// how each face was rotated while reading — so it says definitively whether the
// driver decoded the SAME physical configuration, isolating "stale state" from
// "wrong decode/anchor". Usage: tsx scripts/compare-reading.ts <facelets>

// User's reading (row-major as written), keyed by face letter (by center colour).
const userFaces: Record<string, string> = {
  U: 'BOOWWGYBO', // white-center
  R: 'WRWORBWGY', // red-center
  F: 'OYGOGBOGG', // green-center
  D: 'BYYBYORYR', // yellow-center
  L: 'RRGGOWRRB', // orange-center
  B: 'BYWRBWGWY', // blue-center
};
const toColor: Record<string, string> = { U: 'W', R: 'R', F: 'G', D: 'Y', L: 'O', B: 'B' };
const multiset = (s: string) => [...s].sort().join('');

const facelets = process.argv[2] ?? '';
if (facelets.length !== 54) {
  console.error('need a 54-char facelet string');
  process.exit(1);
}

let allMatch = true;
for (const [i, f] of ['U', 'R', 'F', 'D', 'L', 'B'].entries()) {
  const driverColors = [...facelets.slice(i * 9, i * 9 + 9)].map((c) => toColor[c] ?? '?').join('');
  const dm = multiset(driverColors);
  const um = multiset(userFaces[f]!);
  const match = dm === um;
  allMatch &&= match;
  console.log(
    `${f}  driver=${driverColors} (${dm})  user=${userFaces[f]} (${um})  ${match ? 'MATCH' : 'DIFFER'}`,
  );
}
console.log(
  allMatch
    ? '\n=> same physical configuration — decode/anchor correct; earlier mismatch was stale state.'
    : '\n=> different configuration — still stale, or a real decode/anchor issue.',
);
