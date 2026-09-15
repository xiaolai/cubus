// Turn a Kociemba facelet string into a "setup algorithm": a move sequence that,
// applied to a solved cube, reproduces that state. Written when the app drew with
// cubing.js's twisty-player, which took an alg and not a raw facelet string; its
// replacement, <cubus-cube>, takes a `facelets` attribute directly, so the app no
// longer needs this bridge. Uses the cubejs oracle (solve, then invert the solution).
//
// Usage: tsx scripts/state-to-alg.ts <54-char facelets>
import Cube from 'cubejs';

const facelets = process.argv[2] ?? '';
if (facelets.length !== 54) {
  console.error('need a 54-char URFDLB facelet string');
  process.exit(1);
}

Cube.initSolver();
const solution = Cube.fromString(facelets).solve(); // solves state -> solved

// Setup alg = inverse of the solution: applying it to a solved cube yields the state.
const invertMove = (m: string) => (m.endsWith('2') ? m : m.endsWith("'") ? m[0]! : `${m}'`);
const setupAlg = solution.trim().split(/\s+/).reverse().map(invertMove).join(' ');

// Self-check: apply setupAlg to solved and confirm it matches the input.
const check = new Cube();
check.move(setupAlg);
if (check.asString() !== facelets) {
  console.error('self-check FAILED: setup alg does not reproduce the state');
  process.exit(2);
}
process.stdout.write(setupAlg);
