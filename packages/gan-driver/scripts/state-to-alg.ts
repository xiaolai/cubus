// Turn a Kociemba facelet string into a "setup algorithm": a move sequence that,
// applied to a solved cube, reproduces that state. cubing.js twisty-player takes
// an alg, not a raw facelet string, so this bridges our decoded state to the
// renderer. Uses the cubejs oracle (solve, then invert the solution).
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
