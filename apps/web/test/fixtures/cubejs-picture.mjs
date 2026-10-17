// A route played by CUBEJS, read as the app reads a cube: white up, green in front.
//
// cubejs shares no code with the app's interpreter (`lib/cube-moves.js`) or its piece model, which is the
// whole reason to replay through it — and it moves real centres. A route with a slice in it (Six Spots is
// `M E M' E'`) leaves the white centre somewhere other than on top, while the app reads every cube by its
// centres. So the cube is turned in the hands, centres and all, until white is up and green in front, and
// THAT is the picture to compare with what the app draws.

import Cube from 'cubejs';

import { FACE_ORDER, ROTATIONS } from '../../bench/cube-look.mjs';

/** `facelets` with the whole cube carried round by rotation `r`, colours unchanged — turned in the hands. */
function turnWhole(facelets, r) {
  const out = new Array(54);
  for (let i = 0; i < 54; i++) out[ROTATIONS[r].to[i]] = facelets[i];
  return out.join('');
}

/** A cube turned until its centres are home. Throws if no rotation does it: the centres of any real cube
 *  are a rotation of a solved one's, so that would mean the facelets were not a cube. */
export function centresHome(facelets) {
  for (let r = 0; r < ROTATIONS.length; r++) {
    const turned = turnWhole(facelets, r);
    if (FACE_ORDER.every((face, k) => turned[k * 9 + 4] === face)) return turned;
  }
  throw new Error('no rotation brings the centres home — the centres are not a rotation of solved');
}

/** `alg` played on a solved cube by cubejs, white up and green in front again. */
export function cubejsPicture(alg) {
  const cube = new Cube();
  if (alg.trim()) cube.move(alg);
  return centresHome(cube.asString());
}
