// <cubus-cube> — the cubus 3x3x3 renderer. Draws only: state and solving stay with
// cubejs / the two-phase search. Two ways in, both valid by construction:
//   facelets="…54 chars, URFDLB order…"   paint from a scanner/solver state
//   scramble="R U' F2 …"                  apply moves to a solved cube
// alg="R U R' U' …" is the animatable solution; play() / step() / reset() drive it.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { eyeDirection, fitDistance, fitDistanceStable, silhouette } from '../../../apps/web/lib/cube-frame.js';
import { isFace, orientationMatrix, sameAxis } from '../../../apps/web/lib/cube-orientation.js';
import { parseHighlight, pieceKey, resolveStickers, slotVector } from '../../../apps/web/lib/cube-highlight.js';
import { STICKER_PALETTES } from '../../../apps/web/lib/sticker-palettes.js';
import { MARK_BODY, MARK_BODY_ALPHA, MARK_SHADOW, MARK_SHADOW_ALPHA, PLASTIC, TEXT_INK } from '../../../apps/web/lib/annotation-inks.js';
import { HOME, after, poseAll } from './pose.js';
import { readToken } from '../../../apps/web/lib/cube-notation.js';
import { faceTurnsOf } from '../../../apps/web/lib/cube-moves.js';

// The six sticker colours of each set, by position on a Western cube: the one table, shared with
// the app's flat nets (lib/sticker-palettes.js). The `scheme` attribute remaps it (ADR 0001).
const PALETTES = STICKER_PALETTES;

/**
 * The palette a cube of `scheme` wears. Only D and B trade places: on a Japanese cube blue is
 * under white and yellow is at the back (ADR 0001 §2).
 *
 * A REMAP, never a fourth palette. Each set's six hexes were chosen together — `colorsafe` most
 * obviously so — and a Japanese cube must inherit that work rather than re-derive it. The tables
 * are written in Western positions, and a Western position IS its colour's name, so this is only
 * "read each position's colour out of the table under the name that colour has".
 *
 * Local arithmetic rather than an import, deliberately: this file is bundled as the renderer and
 * depends on nothing in the app, and the fact it needs — which two positions trade — is one line.
 * `apps/web/test/scheme.test.mjs` holds it against `lib/scheme.js`'s table, so the two cannot
 * come to disagree about what Japanese means.
 */
const SWAPPED = { U: 'U', R: 'R', F: 'F', L: 'L', D: 'B', B: 'D' };
function paletteFor(name, scheme) {
  // hasOwn: `palette` is whatever an author wrote, and `PALETTES.toString` is a function — which
  // skipped the fallback and painted every sticker `undefined`, leaving the old colours standing
  // (found by audit, 2026-09-14). The third time this class of lookup has turned up in this
  // package's reach, after the move parser and lib/cube-highlight.js.
  const base = Object.hasOwn(PALETTES, name) ? PALETTES[name] : PALETTES.muted;
  if (scheme !== 'japanese') return base;
  const out = {};
  for (const position of Object.keys(base)) out[position] = base[SWAPPED[position]];
  return out;
}
// A sticker whose colour is not known YET — '?' in a facelet string. Deliberately not a member of
// PALETTES: those are puzzle data, six real sticker colours, and "unknown" is not one of them. It
// exists so a half-finished scan can be drawn honestly; without it an unread sticker falls through
// to its own face colour below and a cube nobody has scanned renders as solved.
//
// Light on purpose. It is drawn at two weights — solid on a face you can see, and again at 0.45
// as a floating ghost for one you cannot — and a mid grey that looked right as a ghost read as a
// dark stone slab on the cube itself. Pitched so the two weights sit close together, and so an
// unread face still reads as absent rather than as another sticker colour.
const UNKNOWN_STICKER = '#C4BFB4';

// Each face's letter and outward normal — what the sticker meshes are built from. Axis and sign
// used to sit here too, for the move parser; the parser takes its moves from pose.js now.
const FACES = [
  { key:'R', n:[ 1, 0, 0] },
  { key:'L', n:[-1, 0, 0] },
  { key:'U', n:[ 0, 1, 0] },
  { key:'D', n:[ 0,-1, 0] },
  { key:'F', n:[ 0, 0, 1] },
  { key:'B', n:[ 0, 0,-1] },
];
/** The face a unit vector points out of — the letter a sticker facing that way is on. */
const faceOfVector = (v) => FACES.find((f) => f.n.every((c, i) => Math.round(v[i]) === c))?.key ?? null;

// Facelet index for a sticker at cubie (x,y,z) on face `key`, in URFDLB order.
const FACELET_INDEX = {
  U: (x, y, z) => 0  + (z + 1) * 3 + (x + 1),
  R: (x, y, z) => 9  + (1 - y) * 3 + (1 - z),
  F: (x, y, z) => 18 + (1 - y) * 3 + (x + 1),
  D: (x, y, z) => 27 + (1 - z) * 3 + (x + 1),
  L: (x, y, z) => 36 + (1 - y) * 3 + (z + 1),
  B: (x, y, z) => 45 + (1 - y) * 3 + (1 - x),
};
const EASE = (t) => (t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3)/2);
/** The autorotate axis — the one axis this file still turns anything about itself. */
const Y_AXIS = new THREE.Vector3(0, 1, 0);
/** Autorotate's rate: the 0.0035 rad a frame it used to add, at the 60 Hz it was tuned on. */
const SPIN_PER_MS = 0.0035 * 60 / 1000;
/** The identity frame handed to `poseAll`. How the cube is HELD stays where it has always been —
 *  on the root group, which also carries the autorotate spin and interpolates `turnTo`. The pose
 *  module's own frame argument is for a caller that has no scene graph to put it on. */
const UPRIGHT = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
/**
 * The positions a sequence stops at: 0, the position after every move that changes the pieces
 * relative to the centres, and the end.
 *
 * A whole-cube turn is a REGRIP, not a step: nothing about the cube's arrangement changed, so a walk a
 * child follows cannot observe it and must not wait at it. It belongs to the group of the move it leads
 * into — `x y R` is one stop, not three — and a sequence that ENDS on one still stops there, because a
 * hold the lesson asked for is where the sequence leaves the cube
 * (dev-docs/adr/0004-orientation-notation-and-colour-are-three-things.md, decision 9). With no
 * whole-cube turn, stops and tokens coincide and every host behaves as it did.
 */
const stopsOf = (sol) => {
  const stops = [0];
  sol.forEach((m, i) => { if (faceTurnsOf(m).turns.some((t) => t.name)) stops.push(i + 1); });
  if (stops[stops.length - 1] !== sol.length) stops.push(sol.length);
  return Object.freeze(stops);
};

/** Is a frame the identity — the cube held as `orientation` says, with no turn of the sequence on top? */
const isUpright = (m) => m.every((row, i) => row.every((v, j) => v === (i === j ? 1 : 0)));
/** A solved cube, as the pose module wants it: pieces, and the twist of each centre. */
const SOLVED_STATE = Object.freeze({
  cp: [0, 1, 2, 3, 4, 5, 6, 7], co: [0, 0, 0, 0, 0, 0, 0, 0],
  ep: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], eo: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ct: [0, 0, 0, 0, 0, 0],
});
/** `this.cubies` is built in a plain x,y,z sweep; the pose module speaks in cube-pieces' order.
 *  Resolved once, by home position, so neither list has to know the other's ordering. */
const POSE_OF = (() => {
  const out = [];
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
    if (!x && !y && !z) continue;
    const at = HOME.findIndex((h) => h[0] === x && h[1] === y && h[2] === z);
    if (at < 0) throw new Error(`<cubus-cube> no cubie of pose.js sits at ${x},${y},${z}`);
    out.push(at);
  }
  return out;
})();

// The highlight pulse — the channel a lesson uses to say "these pieces" while it narrates.
// Subtle by intent: it points, it does not shout, and it has to stay legible under a turn playing
// over the top of it.
const HL_PEAK = 0.38;        // emissiveIntensity at the top of the breath
// A sticker outside the focus set keeps its LUMINANCE and loses its hue, then is pulled part-way
// to a flat mid grey. Keeping luminance is what stops the cube reading as broken: it is still
// visibly a cube with light and dark faces, it has just stopped telling you anything.
const FOCUS_FLATTEN = 0.62;  // how far an out-of-focus sticker is pulled toward FOCUS_MID
const FOCUS_MID = 0.44;
const HL_PERIOD = 1200;      // ms for one full breath
const ARROW_OPACITY = MARK_BODY_ALPHA;

/**
 * The shadow every mark wears, and how far outside its body it reaches.
 *
 * IT USED TO BE A LIGHT RIM around a coloured body, which is the same idea with the values the other way up,
 * and it failed on the question it was meant to answer: which colour is the body? Every hue collides with a
 * sticker or with the plastic (`lib/annotation-inks.js`). A white body with a dark shadow has no hue to
 * choose, and the two parts between them clear every surface the mark crosses.
 *
 * `grow` is how far the shadow stands outside the body, in the cube's own units — a constant width and not a
 * fraction of the mark, because that is what a shadow IS: an arrow and a thinner trail want the same edge,
 * not edges in proportion to their bodies.
 */
const RIM = Object.freeze({ colour: MARK_SHADOW, alpha: MARK_SHADOW_ALPHA, grow: 0.026 });

/**
 * Where the 26 cubies sit, in the order the build produces them — x outermost, then y, then z, with the
 * hidden core left out. A TABLE and not three nested loops, because the order is load-bearing (`POSE_OF`
 * indexes `cubies` by it) and an order that is a side effect of loop nesting is one nobody can check.
 */
const CUBIE_AT = Object.freeze(
  [-1, 0, 1].flatMap((x) => [-1, 0, 1].flatMap((y) => [-1, 0, 1].map((z) => [x, y, z])))
    .filter(([x, y, z]) => x || y || z)
    .map((at) => Object.freeze(at)),
);

/** Whether the cubie at `at` carries face `f` — it does when that face's normal points out of it. */
const showsFace = (at, f) => f.n.some((component, axis) => component && component === at[axis]);

/**
 * The eight corners of `mesh`'s own bounding box, in its PARENT's frame — what the camera has to fit.
 *
 * A mark's extent is its geometry's, not its path's: the spine of a tube is not its surface, a cone sits
 * past the last point of the line it ends, and a numeral is a plane beside the arc it names. Taken through
 * the mesh's local matrix so a numeral's position and billboard rotation count, and returned as plain
 * arrays because that is what the fit takes.
 */
function meshCorners(mesh) {
  if (!mesh.geometry) return [];
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox;
  if (!box) return [];
  mesh.updateMatrix();
  const out = [];
  const v = new THREE.Vector3();
  // A BILLBOARD HAS NO FIXED ORIENTATION TO MEASURE. `_faceCamera` turns it on every render, AFTER the fit
  // has run, so a box measured in the orientation it happens to be in now is a bound on a picture that is
  // about to change: a numeral for `alg="U" trail="piece:UF"` at latitude 85 projected to x = -1.007 on a
  // 320x640 frame, outside the frame the fit had just certified (verify pass, 2026-09-16). What IS invariant
  // is its distance from its own centre, so it is bounded by the cube that contains it at every rotation —
  // the smallest bound that cannot be invalidated by turning it.
  if (mesh.userData.billboard) {
    const reach = box.min.distanceTo(box.max) / 2;
    const at = mesh.position;
    for (const x of [-reach, reach]) {
      for (const y of [-reach, reach]) {
        for (const z of [-reach, reach]) out.push([at.x + x, at.y + y, at.z + z]);
      }
    }
    return out;
  }
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) out.push(v.set(x, y, z).applyMatrix4(mesh.matrix).toArray());
    }
  }
  return out;
}

/**
 * A 3x3 rotation from `pose.js` written into a `Matrix4`, ROW-MAJOR — which is the order `Matrix4.set()`
 * reads and the order `pose.js` writes.
 *
 * Once, because it was three times: the arrow's frame, `_pose`'s basis and `_writePose`'s cubie quaternion
 * each spelled out the same twelve arguments (audit, 2026-09-16). An explicitly error-prone convention is
 * exactly the one that must not be re-typed — a single transposed pair in one copy is a cube that draws
 * correctly everywhere except the one path that copy serves.
 */
const setBasis = (out, m) => out.set(
  m[0][0], m[0][1], m[0][2], 0,
  m[1][0], m[1][1], m[1][2], 0,
  m[2][0], m[2][1], m[2][2], 0,
  0, 0, 0, 1,
);

/** What a face letter is written on: a light plate, so its contrast is against the plate (15.1:1) and never
 *  against the sticker under it (as little as 1.5:1 on a blue one). */
const LETTER_PLATE = Object.freeze({ plate: { colour: MARK_BODY, alpha: 0.94 } });
/** And a trail's numeral, likewise — DARK text, not white (owner's call, 2026-09-16: white is not
 *  appropriate for text). A mark is traced and a numeral is READ, and reading wants dark on light: the
 *  white-on-shadow it briefly wore matched the trail it labels at the cost of the one job it has. */
const NUMERAL_PLATE = Object.freeze({ plate: { colour: MARK_BODY, alpha: 0.9 } });
const rgbaOf = ({ colour, alpha }) => `rgba(${(colour >> 16) & 255},${(colour >> 8) & 255},${colour & 255},${alpha})`;

/**
 * What draws over what, among the things drawn ON the cube rather than as part of it.
 *
 * None of them writes depth — a mark is drawn where it can be SEEN, over the stickers it passes — so this
 * order is the whole answer wherever two of them overlap, and it is not a preference: a rim that drew over
 * its own ink would erase the mark it exists to make legible.
 */
const ORDER = Object.freeze({ rim: 2, mark: 3, letter: 4 });

/** How thin a `ribbon` trail starts, as a fraction of how thick it ends. */
const RIBBON_TAPER = 0.34;

/** How far a face letter sits from the cube's centre. The stickers' own surface is at 1.5, so this is a
 *  hair above the CENTRE sticker it is written on — painted on the cube, not floating over it. */
const LABEL_LIFT = 1.513;
/** Each letter's plane turned into its own face: the sides read upright, U and D from the front. A letter is
 *  written ON the centre sticker and lies in that face's plane (owner's call, 2026-09-16) — briefly it was
 *  turned to the camera instead, which floated it off the cube and is not what "written facing the reader"
 *  meant: it meant the right way up, on the face, as the reader sees it. */
const LABEL_TURN = Object.freeze({
  F: [0, 0, 0], B: [0, Math.PI, 0], R: [0, Math.PI / 2, 0], L: [0, -Math.PI / 2, 0], U: [-Math.PI / 2, 0, 0], D: [Math.PI / 2, 0, 0],
});
/** The fonts written ON the cube. UI text is `system-ui` and numerals are the system mono stack, as
 *  everywhere else in this app — no web fonts anywhere (AGENTS.md, Design system). */
const LABEL_FONT = '700 92px system-ui, -apple-system, "Segoe UI", sans-serif';
const NUMERAL_FONT = '700 76px ui-monospace, SFMono-Regular, Menlo, monospace';

/**
 * Text drawn on a small canvas: dark ink inside a light rim, so it reads on a white sticker, a blue one and
 * the near-black plastic between them alike.
 *
 * ONE ROUTINE for the face letters and the trail numerals. They are the same mark — a word laid over the
 * cube — and the rim they share has already had to be single-sourced once (`RIM`); a second copy of the
 * drawing would be the same drift one level up. Returns the aspect too, because a numeral like `2.3` is
 * three times the width of a `U` and a plane built square would squash it.
 */
function textTexture(text, font, { fill = TEXT_INK, stroke = RIM, plate = null } = {}) {
  const canvas = document.createElement('canvas');
  const height = 128;
  const pad = 26; // room for the rim's stroke, which straddles the glyph's edge
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = font;
  const width = Math.max(height, Math.ceil(probe.measureText(text).width) + pad * 2);
  canvas.width = width; canvas.height = height;
  const g = canvas.getContext('2d');
  // A PLATE UNDER THE GLYPH, when it is asked for: the letter's contrast is then against the plate and not
  // against whatever sticker it happens to be written on. A near-black letter measures 15.1:1 on the plate
  // and as little as 1.5:1 on a blue sticker (colorsafe), with 8 of the 18 sticker-and-palette combinations
  // under the 4.5:1 a reader needs — measured 2026-09-16, after the owner said the letters were hard to read
  // on green and blue. A thicker halo would have been the same idea done vaguely; a plate is measurable.
  if (plate) {
    g.fillStyle = rgbaOf(plate);
    const r = height * 0.22; const pad = 5;
    g.beginPath();
    g.roundRect(pad, pad, width - pad * 2, height - pad * 2, r);
    g.fill();
  }
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 14;
  g.strokeStyle = rgbaOf(stroke);
  g.strokeText(text, width / 2, height / 2 + 6);
  g.fillStyle = `#${fill.toString(16).padStart(6, '0')}`;
  g.fillText(text, width / 2, height / 2 + 6);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, aspect: width / height };
}

/**
 * A flat, textured plane that will be turned to face the camera every frame (`_faceCamera`).
 *
 * `userData.billboard` is what marks it, rather than a list kept beside the meshes: a list is a second
 * place to register a mesh and so a place to forget one, and this element has already paid for that.
 */
function billboard(text, font, height, renderOrder, colours) {
  const { texture, aspect } = textTexture(text, font, colours);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(height * aspect, height),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  mesh.renderOrder = renderOrder;
  mesh.userData.billboard = true;
  // What it SAYS, recorded beside it: the glyphs live in a canvas texture, which nothing can read back, so
  // without this a test could only check that some numeral was drawn — never that it was the right one.
  mesh.userData.text = text;
  return mesh;
}

/** Where the FIRST trail floats: on the shell whose faces sit just outside the stickers' (at 1.5). */
const TRAIL_SHELL = 1.64;
/** And how much further out each trail after it sits. Several pieces of one algorithm pass over the same
 *  stickers — a U permutation's three edges all cross the top-front-right corner — so on ONE shell they meet
 *  there and intersect. */
const TRAIL_SPACING = 0.15;
/**
 * How far each trail is also slid SIDEWAYS from the route it shares, across the surface it lies on.
 *
 * Nesting alone does not stop two trails overlapping, which is the thing actually asked for (owner,
 * 2026-09-16, pointing at the U permutation's ribbon): shells separate trails along the line of sight, and
 * along the line of sight is exactly the direction a picture flattens. Two trails a shell apart running the
 * same way still land on each other in the drawing. Sliding them sideways — perpendicular to their own
 * travel, in the surface — is the separation a reader can see, and it is what a map does with two bus routes
 * down one street. The cost is honest and small: a trail no longer passes over the exact centre of each
 * sticker its piece passes over, it passes a third of a sticker to one side of it. The route is unchanged;
 * `stops` and `curve` still record it exactly, and only the drawing is moved.
 */
const TRAIL_LANE = 0.34;
/** How many points a turn's arc is drawn with. The trail's record and its per-move legs are cut on this same
 *  number: `curve[k * ARC_STEPS]` is where turn `k` landed, which `renderer-trail.test.mjs` asserts, and the
 *  legs a `steps` trail draws are the spans between those. Written twice, a leg silently straddles two turns. */
const ARC_STEPS = 12;
/** How far outside the trail a numeral floats, along its own direction from the cube's centre. */
const NUMERAL_LIFT = 0.26;
/** How much of each end of a leg the `steps` style gives up, in arc points, to leave a gap at every stop. */
const STEP_GAP = 2;

/** A half turn's dot: its radius, and how far behind the line's TAIL its centre sits (owner's call,
 *  2026-09-16). It sat past the HEAD first, which is the one part of the line already carrying a job — the
 *  head says which way, and a mark beyond it competes with the thing a reader looks at first. The tail is
 *  empty, and a dot over the start of a stem is where an `i` keeps its own. */
const HALF_TURN_DOT = 0.078;
const HALF_TURN_GAP = 0.30;
/** The bar tying the lines of a wide move or a rotation together: where along them it crosses, as a fraction
 *  of half their length back from the middle, and how far past the outermost line it reaches. */
const TIE_ALONG = 0.74;
const TIE_OVERHANG = 0.30;

/** Which face a slice's, a wide move's or a regrip's arrow is drawn across, in order of preference: the first
 *  its layer crosses. The front and the top are the faces the default eye sees squarely. */
const ARROW_FACE_PREFERENCE = Object.freeze(['F', 'U', 'R', 'B', 'D', 'L']);

/** A move's axis letter as the unit vector the renderer turns about. */
const AXIS_VECTOR = Object.freeze({ x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] });
const GHOST_OPACITY = 0.45;  // a ghost at rest — single-sourced with its construction below
const GHOST_HL_PEAK = 0.80;  // ghosts are unlit and have no emissive, so they breathe in opacity

// Reduced motion FREEZES the highlight at full strength rather than removing it. Same reasoning
// _next() applies to the turn itself: the pulse is decoration, but the indicator carries meaning —
// it is how the narration says which piece it means — and dropping it loses the sentence.
const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/**
 * What changing each attribute does to an element that is already built, by canonical name. An
 * attribute with no entry here is read where it is used, every frame (`autorotate`,
 * `tempo-scale`), and needs no reaction. Checked against `observedAttributes` when the module
 * loads, so a misspelt key throws there instead of being a reaction that never runs.
 */
const REACTIONS = Object.freeze({
  __proto__: null,
  palette: (el) => el._paint(),
  scheme: (el) => el._paint(),
  ghosts: (el) => { el._ghostVisible(); el._paint(); el._applyCamera(); },
  'ghost-elevation': (el) => { el._ghostPlace(); el._applyCamera(); },
  // The scale is part of the silhouette the camera fits.
  'facelet-scale': (el) => { el._applyScale(); el._applyCamera(); },
  'camera-latitude': (el) => el._applyCamera(),
  'camera-longitude': (el) => el._applyCamera(),
  'camera-fit': (el) => el._applyCamera(),
  'camera-up': (el) => el._applyCamera(),
  // Writing the attribute is a CUT, not a turn: it states where the cube is, and a state that
  // takes 400ms to become true cannot be read back or asserted. `turnTo()` is the animation.
  orientation: (el) => el.showTurn(el._attrs.orientation, el._attrs.orientation, 1),
  // Splitting the view halves the aspect the fit is for.
  'back-view': (el) => el._applyCamera(),
  orbit: (el) => el._applyOrbit(),
  // Turning the spin on or off changes which FIT the cube needs (`_turned`), and neither is an event the
  // draw loop would refit for: spinning is continuous, and stopping it is silence.
  autorotate: (el) => el._applyCamera(),
  // A new cube is a new subject, so a focus bound to pieces is re-bound to the cube in front of you.
  facelets: (el) => { el._rebindFocus(); el.reset(); },
  scramble: (el) => { el._rebindFocus(); el.reset(); },
  alg: (el) => el._replaceAlg(),
  highlight: (el) => { el._readHighlight(); el._syncHighlight(); },
  // focus repaints rather than syncing: it changes sticker COLOUR, which only _paint() writes.
  focus: (el) => { el._readFocus(); el._paint(); },
  arrow: (el) => el._placeArrow(),
  labels: (el) => el._placeLabels(),
  trail: (el) => el._placeTrails(),
  'trail-style': (el) => el._placeTrails(),
});

class CubusCube extends HTMLElement {
  // Kebab is canonical, but a host that writes camelCase props as attributes lands
// on the DOM-lowercased spelling, so both are observed and normalized in _set().
  static observedAttributes = [
    'facelets', 'scramble', 'alg', 'palette', 'scheme', 'autorotate', 'highlight', 'focus',
    'ghosts', 'ghost-elevation', 'ghostelevation',
    'camera-latitude', 'cameralatitude',
    'camera-longitude', 'cameralongitude',
    'camera-fit', 'camerafit',
    'camera-up', 'cameraup',
    'orientation',
    'facelet-scale', 'faceletscale',
    'tempo-scale', 'temposcale',
    'back-view', 'backview',
    'orbit',
    'arrow',
    'labels',
    'trail',
    'trail-style', 'trailstyle',
  ];

  /**
   * The events this element dispatches — part of the contract, so part of the manifest.
   *
   * DECLARED, not discovered. `new CustomEvent('cubus-step', …)` is a string inside a function, and
   * finding it in a bundle means grepping — the very instrument the manifest exists to replace
   * (build-cube-manifest.mjs's header). So the class says what it dispatches and the build reads THAT
   * out of the bundle; `apps/web/test/cube-manifest.test.mjs` checks the list against every
   * `CustomEvent` this source constructs, so an event nobody declared fails there rather than shipping
   * as an undocumented capability.
   */
  static events = Object.freeze(['cubus-step']);

  /**
   * The platform members a consumer may use on the element, and what each argument must be.
   *
   * `attributes`, `methods` and `properties` describe what this element ADDS; a host also does
   * ordinary DOM things to it, and those are a capability too — writing an attribute is how most of
   * this element is driven. `{ args }` is callable, with one rule per argument: `attribute` and
   * `event` must NAME one this manifest lists, `listener` is a handler, `value` and `options` are
   * whatever the platform takes. `{ read: true }` is a member a consumer may read and not call.
   * Anything absent is not part of the contract (ADR 0005 decision 4).
   */
  static operations = Object.freeze({
    setAttribute: Object.freeze({ args: Object.freeze(['attribute', 'value']) }),
    removeAttribute: Object.freeze({ args: Object.freeze(['attribute']) }),
    getAttribute: Object.freeze({ args: Object.freeze(['attribute']) }),
    hasAttribute: Object.freeze({ args: Object.freeze(['attribute']) }),
    addEventListener: Object.freeze({ args: Object.freeze(['event', 'listener', 'options']) }),
    removeEventListener: Object.freeze({ args: Object.freeze(['event', 'listener', 'options']) }),
    remove: Object.freeze({ args: Object.freeze([]) }),
    style: Object.freeze({ read: true }),
    isConnected: Object.freeze({ read: true }),
  });

  /**
   * Members that exist for TESTS and are not capabilities, kept out of the manifest by name.
   *
   * `clock` pins time so a mid-turn frame and a highlight at a chosen point in its breath are
   * reproducible. A consumer that pinned it would stop the cube. Declared here, beside the seam, so
   * leaving one out of the contract is a decision made in the open rather than a rule living in the
   * generator; the generator drops these and lists every other accessor mechanically.
   */
  static seams = Object.freeze(['clock']);

  static ALIAS = {
    ghostelevation: 'ghost-elevation',
    cameralatitude: 'camera-latitude',
    cameralongitude: 'camera-longitude',
    camerafit: 'camera-fit',
    cameraup: 'camera-up',
    faceletscale: 'facelet-scale',
    temposcale: 'tempo-scale',
    backview: 'back-view',
    trailstyle: 'trail-style',
  };

  set facelets(v) { this._set('facelets', v); }
  get facelets() { return this._attrs.facelets; }
  set scramble(v) { this._set('scramble', v); }
  set alg(v) { this._set('alg', v); }
  set palette(v) { this._set('palette', v); }
  set scheme(v) { this._set('scheme', v); }
  set ghosts(v) { this._set('ghosts', v); }
  set ghostElevation(v) { this._set('ghost-elevation', v); }
  set cameraLatitude(v) { this._set('camera-latitude', v); }
  set cameraLongitude(v) { this._set('camera-longitude', v); }
  set cameraUp(v) { this._set('camera-up', v); }
  set orientation(v) { this._set('orientation', v); }
  get orientation() { return this._attrs.orientation; }
  set faceletScale(v) { this._set('facelet-scale', v); }
  set tempoScale(v) { this._set('tempo-scale', v); }
  set backView(v) { this._set('back-view', v); }
  set highlight(v) { this._set('highlight', v); }
  get highlight() { return this._attrs.highlight; }

  /**
   * Is a turn being animated right now?
   *
   * The one question a host asks that is about the element's own timing rather than about the cube:
   * a scrubber that jumps while a turn is in flight has to say so, or the cube finishes a turn the
   * listener has already scrubbed away from. `lesson-player.js` read `_anim` for this, which is a
   * private field — a consumer reaching past the contract because the contract was missing a word
   * (ADR 0005 decision 4).
   */
  get animating() { return this._anim != null; }

  /**
   * Where `alg` stops, as token positions — `seek(el.stops[k])` is the cube at stop `k`.
   *
   * A walk's step `k` is stop `k` (ADR 0004 decision 9), so a host that drives by stops never has to
   * know which tokens are regrips. A frozen copy: the element's own list is not a host's to edit.
   */
  get stops() { return Object.freeze([...(this._stops ?? [0])]); }

  /**
   * A pinned clock, in milliseconds, or null to run on the real one.
   *
   * WHY IT IS A PROPERTY AND NOT AN ATTRIBUTE: the manifest is built from `observedAttributes`,
   * so an attribute here would be advertised to consumers as a capability. This is a test seam —
   * it exists so a mid-turn frame and a highlight at a chosen point in its breath are
   * reproducible, which is what lets one render be compared with another.
   *
   * `v == null` is tested FIRST, before `Number()`: `Number(null)` is 0, so a setter written
   * `Number.isFinite(Number(v)) ? Number(v) : null` freezes time at zero when asked to let it go
   * again — the opposite of what `clock = null` says.
   */
  set clock(v) {
    const next = v == null || !Number.isFinite(Number(v)) ? null : Number(v);
    if (((this._clock ?? null) === null) !== (next === null)) this._changeTimeline(next);
    this._clock = next;
    this._dirty = true;
  }

  /**
   * Carry every stored instant from the timeline in use onto the one `next` selects: a pinned
   * clock when `next` is a number, the real one when it is null. Stepping a pinned clock is not a
   * change of timeline and moves time instead.
   *
   * Four instants are kept — a move's start, a turnTo()'s start, the highlight's breath origin and
   * autorotate's last reading — and each was taken on whichever timeline was running then. Left
   * alone, releasing a clock pinned at 1,000,000 mid-turn measured elapsed time against
   * `performance.now()`, a large negative number, and the turn did not finish. So a move and a
   * turn keep their elapsed time across the change, and autorotate's reading is simply dropped.
   *
   * The breath does NOT keep its elapsed time onto a pinned clock: it restarts at the top at the
   * pinned instant, as a highlight set at that instant would. Kept, the phase at a pinned instant
   * depended on how long the cube had run in real time before it was pinned, so the same pinned
   * clock drew a different highlight on every launch — the golden-image run found it, a fixture
   * that differed on every launch of the same browser (2026-09-15). A breath is decoration with no
   * state behind it; restarting it is what makes it reproducible, which is the seam's purpose.
   */
  _changeTimeline(next) {
    const to = next ?? performance.now();
    const shift = to - this._now();
    if (this._anim?.t0 != null) this._anim.t0 += shift;
    if (this._turning) this._turning.t0 += shift;
    if (this._hlT0 != null) this._hlT0 = next === null ? this._hlT0 + shift : next - HL_PERIOD / 2;
    this._spinAt = null;
  }

  get clock() { return this._clock ?? null; }

  /** The clock everything timed reads: the pinned one when there is one, the real one otherwise. */
  _now() { return this._clock ?? performance.now(); }

  constructor() {
    super();
    // Defaults match the codebase player's control panel, except ghosts:
    // those are opt-in here because they crowd a small embedded cube.
    this._attrs = { ...CubusCube.DEFAULTS };
    // How the cube is held, as a turn between two orientations at a phase in [0,1]. A SETTLED
    // orientation is phase 1 with `from` equal to `to`; everything else is mid-turn.
    //
    // The phase is the primitive and the animation is a caller of it, never the other way round.
    // Written as an animator with a seek bolted on, the two disagree the first time anyone scrubs
    // into a turn: a lesson's cube is a pure function of `t`, so landing on a timestamp by seeking
    // backwards has to give the same pose as playing forwards into it, and an easing that starts
    // from "wherever the cube is now" cannot.
    this._turn = { from: 'U F', to: 'U F', phase: 1 };
    // The autorotate angle, kept as a number rather than written into `root.rotation.y`, because
    // the root now carries the orientation too and two writers of one property is how one of them
    // silently wins.
    this._spin = 0;
    this._turning = null; // an in-flight turnTo(): { from, to, t0, ms, settle }
  }
  /** Attribute defaults. Also what a REMOVED attribute falls back to — see _set(). */
  static DEFAULTS = {
    // No arrow. A move token (`R'`, `M`, `Rw2`, `y`) draws one for that turn; `next` draws the move of
    // `alg` the cube is about to make, and follows the cursor (plan item 4.2).
    arrow: 'none',
    // No letters. `position` writes U R F D L B on the six places a face can be — the face on top is U
    // whichever colour it is, which is what a notation lesson teaches, and it is the only value besides
    // `none`. A `face` mode wrote each face's own letter on its centre and carried it through regrips; it
    // was removed on 2026-09-16 because it said the opposite of the lesson (plan item 4.3).
    labels: 'none',
    // No trail. `piece:UF` (or `slot:UF`, the piece in UF where `alg` starts; comma-separated for several)
    // draws where that piece goes over the whole of `alg` — the arc its cubie travels in each turn — for a
    // PLL cycle or a commutator (plan item 4.4).
    trail: 'none',
    // HOW a trail says which way time ran (the owner's ask of 2026-09-16: over `R U R' U'` the curve was
    // hard to follow). `steps` breaks the route into one directed segment per turn, each with its own head
    // and a gap at every stop, so a path that doubles back over itself is still four countable hops in
    // order; `ribbon` keeps it one unbroken path and says the same thing with width — thin where the piece
    // started, full where it ended — with a chevron at each stop it passes through. Neither invents a
    // route: both draw the same `stops` and the same arcs, and only the marking differs.
    'trail-style': 'steps',
    palette: 'muted',
    // Western unless a host says otherwise: the arrangement PALETTES is written in, and the
    // one the app assumes until a scan proves the cube is the other kind.
    scheme: 'western',
    ghosts: 'none', 'ghost-elevation': '4', highlight: 'none',
    // No camera distance: it is computed from what the view draws and the slot it draws into
    // (lib/cube-frame.js), so nothing is clipped at any slot shape.
    'camera-latitude': '35', 'camera-longitude': '45',
    // Which face points at the top of the frame. 'U' is the world's up and the only value most
    // views ever want; 'D' is a cube held upside down, which is a thing a lesson has to be able to
    // show once a child has been told to turn theirs over. Latitude and longitude alone cannot
    // express it: they place the eye and leave the roll fixed at +Y, so the picture arrives
    // vertically mirrored — worse than not moving the camera, because it looks deliberate.
    'camera-up': 'U',
    // WHICH WAY THE CUBE IS HELD — two face letters, "<up> <front>". A different statement from
    // the camera's, and it needs a different mechanism: `camera-up` moves the OBSERVER, and
    // `_placeLights` bolts the lighting rig to the camera, so rolling the eye rolls the sun.
    // Turning the OBJECT leaves the lamp where it is, which is what "you turned it over in your
    // hands" looks like. Absolute, never relative: "D B" is idempotent and reads the same in a
    // still picture as in an animated one, where a relative `y` accumulates and cannot be
    // asserted without replaying the history that produced it.
    //
    // NOT A MOVE, and not what a whole-cube turn inside `alg` does. `alg` DOES take `y` — a sequence may
    // regrip, and `_seq` carries the frame through it, which is why `_placeArrowFrame` exists and why an
    // `R` after a `y` is drawn about the cube's own x axis rather than the world's. What this attribute
    // states is where the cube STARTS, absolutely; the two answer different questions and only this one is
    // idempotent. (It read "NOT part of `alg`, ever" until an audit checked it against `readToken`,
    // 2026-09-16 — true when written, false since regrips in a sequence were built.)
    orientation: 'U F',
    // 'view' fits the silhouette THIS angle draws — tightest framing, and what a view that never
    // moves programmatically wants. 'stable' fits every angle at once, so swinging the camera
    // rotates the cube without resizing it. Default stays 'view': stable costs ~11% of apparent
    // size with ghosts floating, and dragging to orbit never refits, so the app gains nothing.
    'camera-fit': 'view',
    'facelet-scale': '0.9', 'tempo-scale': '1', 'back-view': 'none',
    orbit: 'free', // 'locked' = dragging does not turn the view; the host decides
  };

  attributeChangedCallback(name, _old, val) { this._set(name, val); }
  _set(name, val) {
    name = CubusCube.ALIAS[String(name).toLowerCase()] || name;
    this._store(name, val);
    // Before the build nothing exists to react; `_build()` reads every attribute itself.
    if (!this._ghostMeshes) return;
    if (Object.hasOwn(REACTIONS, name)) REACTIONS[name](this);
  }

  /** Record an attribute's value in `_attrs`, the one place the element reads attributes from. */
  _store(name, val) {
    // removeAttribute() arrives here with val === null. Storing that raw meant `ghosts` read as
    // neither 'none' nor 'false' and so counted as ENABLED — removing the attribute turned ghosts
    // on rather than off. A removed attribute means "back to the default", not "null" — UNLESS
    // the other spelling (canonical or alias) is still on the element: both feed one slot, and
    // removing one must not clobber the survivor.
    if (val == null) {
      const spellings = [name, ...Object.keys(CubusCube.ALIAS).filter((a) => CubusCube.ALIAS[a] === name)];
      const alive = spellings.map((s) => this.getAttribute?.(s)).find((v) => v != null);
      this._attrs[name] = alive != null ? alive : CubusCube.DEFAULTS[name];
    } else {
      this._attrs[name] = val;
    }
  }

  /**
   * A new walk calls off the old one's moves, the one in flight AND the ones queued behind it —
   * exactly what `reset()` does for a new cube. Resetting only the counters left R and U of the
   * old alg playing on and reporting themselves as steps of the new one (found by audit,
   * 2026-09-14). The state only advances when a move COMPLETES, so dropping the move in flight
   * and writing the pose puts the cube back where its last finished move left it.
   */
  _replaceAlg() {
    this._anim = null;
    this._queue = [];
    this._readSol();
    // AND A NEW SEQUENCE STARTS WHERE THE SEQUENCE STARTS. `seek(k)` replays k tokens from the cube the
    // `facelets` or `scramble` describes, and a trail is drawn from that same origin — so playback of a
    // replaced alg has to begin there too, or one position means two different cubes: after finishing `R`,
    // replacing the alg with `U` played `R U` while `seek(1)` drew `U` (Codex audit, 2026-09-16). Quietly,
    // because a replacement is not a step: the host moves its own head, and reporting one here is what the
    // 2026-09-14 defect above looked like from the outside.
    this._quiet = true;
    try { this.reset(); } finally { this._quiet = false; }
    this._cursor = 0; this._applied = 0; this._playing = false;
    // WHICH WALK, AND WHICH TIME THROUGH IT. `_sol` identity says the SEQUENCE has not been replaced; it
    // says nothing about the cube having been sent somewhere else within it, because `reset()` and `seek()`
    // leave `_sol` exactly as it was. A step listener that resets or seeks mid-settle therefore passed the
    // freshness check and the press carried on against a cube that had moved — reproduced by an audit
    // (2026-09-16) as an overrun past the end of the solution on `alg="x y R U"`. Bumped by every one of
    // those, and captured before a settle so the check after it means something.
    this._era = 0;
  }

  /** `alg` as moves, with what follows from it: whether it turns the cube, and where it stops. */
  _readSol() {
    this._sol = this._parse(this._attrs.alg || '');
    this._solMovesCentres = this._sol.some((m) => m.layers.includes(0));
    this._stops = stopsOf(this._sol);
    this._group = null;
  }

  connectedCallback() {
    // Re-inserted, not new: keep the WebGL context and everything hanging off it, and just start
    // drawing again. Building all of this costs a context, ~150 meshes and a shader compile —
    // 21-24ms measured — and the app throws its whole screen away on every render, including
    // renders that are not navigations at all (pressing Random re-enters the screen it is on).
    // An element that cannot be moved in the DOM is an element that can never be re-used, and
    // this one could not: the old pair disposed on the way out and returned early on the way
    // back in, so a second insertion left a live element with a dead renderer and no loop.
    clearTimeout(this._release);
    if (this.scene) { this._start(); return; }
    this.style.cssText = 'display:block;width:100%;height:100%;' + (this.style.cssText || '');
    // TRANSACTIONAL. `this.scene` is what says "built", and it used to be published on the first
    // line of the build — before the WebGL context existed. A page where the context could not be
    // created was left with a half-built element, and the next connect took the "already built"
    // branch above and threw on an observer that was never made (found by audit, 2026-09-14). Now
    // `_build()` publishes it last, and a build that throws is unwound — context, canvas and
    // listeners — before the error is let through. Loud, and nothing left half-held.
    try {
      this._build();
    } catch (err) {
      this.dispose();
      throw err;
    }
    this._start();
  }

  /** Everything a first connect creates: the scene, the renderer, the meshes, the observers and the
   *  frame loop. `this.scene` is published at the very end, as the mark that all of it exists. */
  _build() {
    const scene = new THREE.Scene();
    this._buildView();
    this._buildLights(scene);
    this._buildCubies(scene);
    this._initWalk();
    this._buildLoop();
    this.scene = scene;
  }

  /** The camera, the WebGL renderer and its canvas, and the orbit controls. */
  _buildView() {
    const camera = this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);

    const renderer = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping; // exact palette fidelity
    renderer.domElement.style.cssText = 'width:100%;height:100%;display:block';
    this.appendChild(renderer.domElement);

    const controls = this.controls = new OrbitControls(camera, renderer.domElement);
    // Where OrbitControls put its capture-phase keydown listener. It binds to
    // `domElement.getRootNode()` and UNBINDS from whatever that returns at dispose time —
    // which is a different node once the canvas has been detached, so the document keeps
    // the listener forever. Remembered here so teardown can put the canvas back first.
    this._controlsRoot = renderer.domElement.getRootNode();
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    // Distance limits are set by _applyCamera from the fitted distance: a fixed maxDistance of
    // 22 clamped the camera on every update() and clipped the ghost faces on narrow slots, where
    // the fit stands further back than that.
    controls.rotateSpeed = 0.75;
    this._applyCamera();
    this._applyOrbit();
  }

  /** The light rig, added to `scene`, with each light's direction fixed relative to the eye. */
  _buildLights(scene) {
    // Lights ride with the camera's ORIENTATION, not the world. Fixed in the world they lit the
    // cube for one angle, and the moment anyone orbited underneath, the underside was lit by the
    // hemisphere's ground colour alone — yellow stickers read as black. Each light keeps a
    // direction expressed relative to the camera, taken from the world positions the look was
    // tuned under at the default orientation, so at that orientation the render is identical
    // at any distance (directional lights do not care how far away they sit) and from any
    // other angle the same rig is simply turned with the eye.
    const hemi = new THREE.HemisphereLight(0xfffaf0, 0x4a4030, 1.0);
    const key = new THREE.DirectionalLight(0xffffff, 0.95);
    const fill = new THREE.DirectionalLight(0xdfe6ff, 0.45);
    scene.add(hemi, key, fill);
    // The DEFAULT view is the reference, never `camera` as it stands. By this point `_applyCamera()`
    // has already posed the camera from whatever camera attributes were present at connect, so
    // taking the inverse of THAT quaternion rotated the rig by the host's settings — and the same
    // final attributes lit the cube two ways depending on whether they were written before
    // connecting or after (found by audit, 2026-09-14). Built from DEFAULTS so the two cannot drift.
    const reference = new THREE.PerspectiveCamera();
    const tuned = eyeDirection(Number(CubusCube.DEFAULTS['camera-latitude']), Number(CubusCube.DEFAULTS['camera-longitude']));
    reference.position.set(tuned[0], tuned[1], tuned[2]);
    reference.up.set(0, 1, 0);
    reference.lookAt(0, 0, 0);
    const inv = reference.quaternion.clone().invert();
    this._lights = [
      [hemi, new THREE.Vector3(0, 1, 0).applyQuaternion(inv)],
      [key, new THREE.Vector3(5, 8, 6).applyQuaternion(inv)],
      [fill, new THREE.Vector3(-6, 2, -4).applyQuaternion(inv)],
    ];
    this._placeLights();
  }

  /**
   * The geometries and materials every cubie shares — made once, because 26 bodies and 54 stickers that
   * each made their own would be 80 uploads of the same buffers.
   *
   * The sticker MATERIAL is the exception and is made per sticker: it carries that sticker's colour, which
   * is the one thing about a sticker that is not shared.
   */
  static _sharedParts() {
    const ghostGeo = new THREE.PlaneGeometry(0.78, 0.78);
    return {
      bodyGeo: new RoundedBoxGeometry(0.94, 0.94, 0.94, 4, 0.1),
      bodyMat: new THREE.MeshStandardMaterial({ color: PLASTIC, roughness: 0.62, metalness: 0.04 }),
      stickerGeo: new RoundedBoxGeometry(0.78, 0.78, 0.06, 3, 0.07),
      // Ghosts are flat planes, not boxes — they read as projections rather than solid tiles.
      ghostGeo,
      // A hairline around each ghost, for the reason the scan grid has one: a white ghost at 45% opacity
      // over a pale background has no edge, so it reads as a gap rather than as a sticker. The solid
      // stickers need no such line — they sit inset on the near-black body, which draws their boundary for
      // them. The outline is a CHILD of its ghost, so it inherits that ghost's transform, scale and
      // visibility and needs no bookkeeping of its own in `_cullGhosts` or the flip path.
      ghostEdgeGeo: new THREE.EdgesGeometry(ghostGeo),
      ghostEdgeMat: new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false }),
    };
  }

  /**
   * One sticker of face `f` on the cubie at `at`, with the floating ghost twin that belongs to it.
   *
   * The two are made TOGETHER because they are one thing seen twice, and the pairing is recorded here —
   * where both exist — rather than recovered later by matching positions (plan item 4.1 lights one sticker,
   * and so one ghost).
   */
  _addSticker(cubie, f, at, parts) {
    const n = f.n;
    const m = new THREE.Mesh(parts.stickerGeo, new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0 }));
    m.position.set(n[0] * 0.48, n[1] * 0.48, n[2] * 0.48);
    if (n[0]) m.rotation.y = Math.PI / 2;
    else if (n[1]) m.rotation.x = Math.PI / 2;
    m.userData = { face: f.key, home: [...at] };
    cubie.add(m);
    this.stickers.push(m);

    // Unlit and depth-write-free so overlapping ghosts stay legible from any angle.
    const g = new THREE.Mesh(parts.ghostGeo, new THREE.MeshBasicMaterial({
      transparent: true, opacity: GHOST_OPACITY, depthWrite: false, side: THREE.DoubleSide,
    }));
    g.rotation.copy(m.rotation); // carries the X-face quarter turn set on the sticker above
    g.userData = { face: f.key, home: [...at], n };
    this._ghostTwin.set(m, g);
    g.renderOrder = 1;
    const edge = new THREE.LineSegments(parts.ghostEdgeGeo, parts.ghostEdgeMat);
    edge.renderOrder = 2; // above its own ghost, so the line is never eaten by the fill
    g.add(edge);
    cubie.add(g);
    this._ghostMeshes.push(g);
  }

  /** The turn arrow's carrier, empty until an arrow is asked for (plan item 4.2). */
  _buildArrow(root) {
    // Under `root`, so it is held however the cube is; its own quaternion carries the sequence's frame.
    this._arrow = new THREE.Group();
    this._arrow.visible = false;
    // Two materials for the two parts of every mark — a white body and the shadow that carries it — made
    // once and kept, because a material per redraw is a material per redraw to dispose.
    this._arrowMat = new THREE.MeshBasicMaterial({ color: MARK_BODY, transparent: true, opacity: ARROW_OPACITY, depthWrite: false, side: THREE.DoubleSide });
    this._arrowRimMat = new THREE.MeshBasicMaterial({ color: RIM.colour, transparent: true, opacity: RIM.alpha, depthWrite: false, side: THREE.DoubleSide });
    root.add(this._arrow);
  }

  /**
   * The 26 cubies, each with its body, its stickers and a ghost per sticker, under `root`.
   *
   * Two levels of control flow, where it was five: a triple loop with a face loop and a visibility test
   * inside it (audit, 2026-09-16). What the nesting hid is that this method does three separable jobs —
   * make the shared parts, build one cubie, carry the arrow — and each is now named. THE ORDER OF
   * `cubies` AND `stickers` IS LOAD-BEARING and unchanged: `POSE_OF` indexes the first by position, and
   * `_paint` walks the second; `CUBIE_AT` is built in exactly the order the loops produced.
   */
  _buildCubies(scene) {
    const root = this.root = new THREE.Group();
    scene.add(root);
    const parts = CubusCube._sharedParts();
    this.cubies = [];
    this.stickers = [];
    this._ghostMeshes = [];
    this._ghostTwin = new Map();
    for (const at of CUBIE_AT) {
      const c = new THREE.Group();
      c.position.set(at[0], at[1], at[2]);
      c.add(new THREE.Mesh(parts.bodyGeo, parts.bodyMat));
      for (const f of FACES) if (showsFace(at, f)) this._addSticker(c, f, at, parts);
      root.add(c);
      this.cubies.push(c);
    }
    this._buildArrow(root);
  }

  /**
   * Draw the turn arrow `arrow` asks for, or none.
   *
   * WHICH LAYER AND WHICH WAY is the whole content of an arrow, so the geometry is computed from the move's
   * own descriptor — the axis, the layers, the signed angle — rather than from a table of pictures.
   *
   * ONE STRAIGHT LINE PER LAYER TURNED (owner's call, 2026-09-16). A face turn used to get an ARC on its own
   * face while a slice, a wide move and a rotation got a straight line, because a ring round a slice's layer
   * passes through the cube at every corner and drew as fragments. That left the app teaching two pictures
   * for one instruction. Straight everywhere is one picture — and it says more than the arc could: the cube
   * is shown FUR-corner-on, its nine layers read as nine lines across the three visible faces, and the
   * number of lines IS the move's width. `R` is one line, `Rw` two, `x` three. An arc cannot say that at all.
   *
   * What it cannot say is 180°, so that is written rather than drawn — see the `×2` below.
   *
   * Its start, end and axis are kept on the group (`userData`), in the cube's own frame, so a test can check
   * the direction without judging the look.
   */
  /**
   * A directed curve: a tube along `points` with a cone on the end, pointing the way the path goes.
   *
   * Both things this element draws as a path are this — the turn arrow and a piece's trail — and they
   * were built twice, differing only in their dimensions and their material (Codex audit, 2026-09-16).
   * The TANGENT is what makes it directed, and it is taken from the last two points rather than from the
   * curve's own derivative: a Catmull-Rom curve through settled positions is smooth enough that the two
   * agree, and the last segment is what a child sees the arrow leaving from.
   */
  static _directedCurve(points, { radius, segments, headRadius, headLength, headSides, lift, material, rim, taper = 0 }) {
    const path = new THREE.CatmullRomCurve3(points);
    const end = points[points.length - 1];
    const tangent = end.clone().sub(points[points.length - 2]).normalize();
    // One body, built at whatever swell it is asked for: the ink at none, the rim a constant width outside it.
    const body = (swell, mat, order) => {
      const tube = new THREE.Mesh(new THREE.TubeGeometry(path, segments, radius + swell, 8, false), mat);
      if (taper) CubusCube._taper(tube, path, taper);
      const head = new THREE.Mesh(new THREE.ConeGeometry(headRadius + swell * 1.8, headLength + swell * 1.8, headSides), mat);
      head.position.copy(end.clone().add(tangent.clone().multiplyScalar(lift)));
      head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
      // Over the stickers it passes, both of them: a path drawn into the cube is a path nobody can see.
      tube.renderOrder = head.renderOrder = order;
      return [tube, head];
    };
    // The rim FIRST and the ink over it. Neither writes depth, so the draw order is the only thing deciding
    // which wins where they overlap — concentric tubes, where the fatter one is nearer the eye everywhere and
    // would hide the thinner one outright if either of them were depth-tested against the other.
    const meshes = rim ? body(rim.grow, rim.material, ORDER.rim) : [];
    const [tube, head] = body(0, material, ORDER.mark);
    meshes.push(tube, head);
    return { meshes, tube, head, end };
  }

  /**
   * Squeeze a tube's start, so how wide the path is says how far along the sequence you are.
   *
   * A tube's vertices are RINGS about the spine — one per tubular segment — so each ring is drawn toward its
   * OWN spine point. Scaled toward the cube's centre instead, the tube would flatten onto the shell rather
   * than thin, which is a different picture that happens to be narrower from one angle. The spine is sampled
   * the way `TubeGeometry` samples it (`getPointAt`, arc-length), so the two agree ring for ring; sampled any
   * other way the rings pull toward points the geometry was never built around, and the tube kinks.
   *
   * No normals are recomputed: every mark here is a `MeshBasicMaterial`, which has no lighting to get wrong.
   */
  static _taper(tube, path, from) {
    const pos = tube.geometry.attributes.position;
    const { tubularSegments, radialSegments } = tube.geometry.parameters;
    const at = new THREE.Vector3(); const v = new THREE.Vector3();
    for (let i = 0; i <= tubularSegments; i++) {
      const t = i / tubularSegments;
      path.getPointAt(t, at);
      const k = from + (1 - from) * t;
      for (let j = 0; j <= radialSegments; j++) {
        const n = i * (radialSegments + 1) + j;
        v.fromBufferAttribute(pos, n).sub(at).multiplyScalar(k).add(at);
        pos.setXYZ(n, v.x, v.y, v.z);
      }
    }
    pos.needsUpdate = true;
  }

  /** A small cone at `at` pointing along `tangent` — the mark a ribbon wears at each stop it passes through. */
  static _chevron(at, tangent, size, material, order) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(size, size * 2, 12), material);
    cone.position.copy(at);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
    cone.renderOrder = order;
    return cone;
  }

  /**
   * WHICH MOVE an arrow is for, or null — the whole of reading `arrow`, and nothing about drawing.
   *
   * `next` follows the cube as it has SETTLED (`_applied`), not the cursor, which runs ahead when turns are
   * queued: a turn in flight keeps its arrow until it lands.
   */
  _arrowMove() {
    const spec = String(this._attrs.arrow ?? 'none').trim();
    if (spec === 'next') return this._sol?.[this._applied] ?? null;
    if (!spec || spec === 'none') return null;
    const read = readToken(spec);
    if (!read.move) {
      console.warn(`<cubus-cube> refusing arrow — "${spec}" is ${read.why}`);
      return null;
    }
    return read.move;
  }

  /**
   * WHERE the lines of `move` go — pure arithmetic over the move's own descriptor, no meshes.
   *
   * One straight line per layer the move turns, across a face that layer crosses, pointing the way that
   * face's stickers travel: a point on a face with normal `n` moves along `axis x n` when the layer turns
   * the positive way. A face whose normal is PARALLEL to the axis cannot host the line — the layer is
   * parallel to it — so the candidates are the four it crosses and the preference picks the one the default
   * eye sees best.
   */
  static _arrowPlan(move) {
    const axis = new THREE.Vector3(...AXIS_VECTOR[move.axis]);
    const across = FACES.map((f) => new THREE.Vector3(...f.n)).filter((v) => Math.abs(v.dot(axis)) < 1e-9);
    const n = ARROW_FACE_PREFERENCE
      .map((key) => new THREE.Vector3(...FACES.find((f) => f.key === key).n))
      .find((c) => across.some((a) => a.equals(c)));
    const d = axis.clone().cross(n).multiplyScalar(Math.sign(move.angle));
    const half = 0.92;
    const centreOf = (layer) => n.clone().multiplyScalar(1.53).add(axis.clone().multiplyScalar(layer));
    const lanes = move.layers.map((layer) => Array.from({ length: 9 }, (_, i) => centreOf(layer)
      .add(d.clone().multiplyScalar(-half + (i / 8) * 2 * half))));
    return {
      axis, n, d, half, lanes, centreOf,
      layers: move.layers,
      quarters: Math.min(2, Math.abs(Math.round(move.angle / (Math.PI / 2)))),
    };
  }

  /**
   * The two passes every mark is drawn in: its shadow, then its body over the top.
   *
   * Yielded rather than written out, because it was written out three times in this method alone — the
   * line, the half-turn dot and the tie — and "a mark is a body carried by a shadow" is one rule
   * (audit, 2026-09-16). `swell` is how much wider the shadow is than what it carries.
   */
  * _markPasses() {
    yield [RIM.grow, this._arrowRimMat, ORDER.rim];
    yield [0, this._arrowMat, ORDER.mark];
  }

  /** A half turn's dot, behind the tail of the first lane — see HALF_TURN_GAP for why it is not at the head. */
  _addHalfTurnDot(plan, tail) {
    for (const [swell, mat, order] of this._markPasses()) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(HALF_TURN_DOT + swell, 16, 12), mat);
      dot.position.copy(tail).sub(plan.d.clone().multiplyScalar(HALF_TURN_GAP));
      dot.renderOrder = order;
      dot.userData.halfTurn = true;
      this._arrow.add(dot);
    }
  }

  /** The bar tying a wide move's lines together, so they read as one grip rather than two instructions. */
  _addTie(plan) {
    const at = (layer) => plan.centreOf(layer).add(plan.d.clone().multiplyScalar(-plan.half * TIE_ALONG));
    const from = at(Math.min(...plan.layers) - TIE_OVERHANG);
    const to = at(Math.max(...plan.layers) + TIE_OVERHANG);
    for (const [swell, mat, order] of this._markPasses()) {
      const bar = new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(from, to), 1, 0.034 + swell, 8, false), mat);
      bar.renderOrder = order;
      bar.userData.tie = true;
      this._arrow.add(bar);
    }
  }

  _placeArrow() {
    if (!this._arrow) return;
    for (const child of [...this._arrow.children]) { child.geometry.dispose(); this._arrow.remove(child); }
    const move = this._arrowMove();
    this._arrow.visible = move !== null;
    this._arrow.userData = {};
    this._dirty = true;
    if (!move) return;

    const plan = CubusCube._arrowPlan(move);
    let end = null;
    for (const lane of plan.lanes) {
      const made = CubusCube._directedCurve(lane, {
        radius: 0.044, segments: 24, headRadius: 0.155, headLength: 0.36, headSides: 20, lift: 0.10,
        material: this._arrowMat, rim: { grow: RIM.grow, material: this._arrowRimMat },
      });
      end ??= made.end;
      this._arrow.add(...made.meshes);
    }
    if (plan.quarters === 2) this._addHalfTurnDot(plan, plan.lanes[0][0]);
    if (plan.lanes.length > 1) this._addTie(plan);

    const points = plan.lanes.flat();
    this._arrow.userData = {
      axis: plan.axis.toArray(),
      start: plan.lanes[0][0].toArray(),
      end: end.toArray(),
      angle: move.angle,
      layers: [...plan.layers],
      lanes: plan.lanes.length,
      points: points.map((q) => q.toArray()),
    };
    this._placeArrowFrame();
  }

  /**
   * Write the face letters `labels` asks for, or none.
   *
   * ONE SENTENCE, and it is about the PLACE (owner's call, 2026-09-16, reversing his own earlier one):
   * however the cube is turned, the face toward you is F, the one on top is U and the one on the right is R.
   * The letters hang off the scene rather than the cube, so the cube turns under them and they do not move.
   *
   * A `face` mode used to exist beside this — a letter riding its own centre, so a regrip carried U underneath
   * — and it is gone. It said the opposite of the rule above, which makes it a trap for whoever writes the
   * next lesson rather than a second way to teach; nothing in the app, and no lesson, ever asked for it.
   *
   * WRITTEN ON THE CENTRE STICKER, lying in that face's plane (owner's call, 2026-09-16). It is a letter
   * painted on the cube, at the place whose name it is — so it is foreshortened with the face it is on, as
   * anything written on a cube is. "Facing the reader" means the right way up as the reader sees it, which is
   * what `LABEL_TURN` does; it briefly meant turned-to-the-camera, and that floated the letters off the cube.
   */
  _placeLabels() {
    if (!this.cubies) return;
    for (const mesh of this._labelMeshes ?? []) { mesh.parent?.remove(mesh); mesh.geometry.dispose(); mesh.material.map?.dispose(); mesh.material.dispose(); }
    this._labelMeshes = [];
    const mode = String(this._attrs.labels ?? 'none').trim();
    this._dirty = true;
    if (mode === 'none' || mode === '') return;
    if (mode !== 'position') {
      console.warn(`<cubus-cube> refusing labels — "${mode}" is not none or position`);
      return;
    }
    const scene = this.root.parent;
    for (const f of FACES) {
      const mesh = billboard(f.key, LABEL_FONT, 0.62, ORDER.letter, LETTER_PLATE);
      // NOT billboarded: it is painted on a face, and `_faceCamera` must leave it alone.
      mesh.userData.billboard = false;
      mesh.userData.label = f.key;
      mesh.userData.mode = mode;
      mesh.rotation.set(...LABEL_TURN[f.key]);
      mesh.position.set(f.n[0] * LABEL_LIFT, f.n[1] * LABEL_LIFT, f.n[2] * LABEL_LIFT);
      scene.add(mesh);
      this._labelMeshes.push(mesh);
    }
  }

  /**
   * Turn every billboarded mark — a trail's numerals — to face `cam`, upright.
   *
   * Per RENDER and not per frame, because the back view renders the same scene from the opposite eye: a
   * letter turned to the main camera would be seen from behind there, and read mirrored. Each render orients
   * for itself, so whichever ran last leaves the state it wanted.
   *
   * The parent's own rotation is divided out rather than assumed away: a numeral hangs off `root`, which
   * carries the orientation AND the autorotate spin, so copying the camera's quaternion straight in would
   * make it counter-rotate with the cube.
   *
   * The face letters are NOT in this: they are painted on their faces and turn with them. The loop still
   * reads `_labelMeshes` rather than trusting that, because "the letters are not billboards" is a fact about
   * another method, and a flag each mesh carries is one this one can check.
   */
  _faceCamera(cam) {
    if (!this.scene) return;
    const q = (this._faceQ ||= new THREE.Quaternion());
    this.scene.updateMatrixWorld(true);
    for (const list of [this._labelMeshes, this._trailMeshes, this._arrow?.children]) {
      for (const mesh of list ?? []) {
        if (!mesh.userData.billboard || !mesh.parent) continue;
        mesh.parent.getWorldQuaternion(q).invert();
        mesh.quaternion.copy(q).multiply(cam.quaternion);
      }
    }
  }

  /**
   * The cubies a `trail` spec names, in the order written — or null when a token is not a trail selector.
   *
   * Null, not an empty list: a spec with a typo in it is refused whole, exactly as `highlight` is, because
   * a trail that silently drew three of four pieces would be read as a statement about the fourth.
   */
  _trailTargets(spec) {
    const settled0 = poseAll(UPRIGHT, this._base ?? this._state);
    const named = [];
    for (const token of spec.split(',').map((t) => t.trim()).filter(Boolean)) {
      const m = /^(piece|slot):([URFDLB]{2,3})$/i.exec(token);
      const key = m && pieceKey(m[2]);
      if (!key) { console.warn(`<cubus-cube> refusing trail — "${token}" is not piece:XX or slot:XX`); return null; }
      const index = m[1].toLowerCase() === 'piece'
        ? this.cubies.findIndex((c) => c.userData.piece === key)
        : this.cubies.findIndex((_, i) => {
          const pos = settled0[POSE_OF[i]].pos; const want = slotVector(m[2]);
          return pos.every((v, k) => v === want[k]);
        });
      if (index < 0) { console.warn(`<cubus-cube> trail matched nothing for ${token} — this cube has no known identity for it`); continue; }
      named.push({ token, index });
    }
    return named;
  }

  /**
   * Where cubie `index` goes over the whole sequence: its settled `stops`, and the `curve` between them.
   *
   * ARITHMETIC ONLY — no mesh, no material, nothing of three.js but the vectors. Between two positions the
   * piece moves along an ARC about the turn's axis, by the turn's angle: a chord would cut through the cube
   * and is not where the piece went.
   */
  _trailPath(index) {
    let frame = UPRIGHT; let state = this._base ?? this._state;
    const stops = [poseAll(frame, state)[POSE_OF[index]].pos];
    const curve = [new THREE.Vector3(...stops[0])];
    for (const move of this._sol ?? []) {
      const from = new THREE.Vector3(...poseAll(frame, state)[POSE_OF[index]].pos);
      const axisWorld = new THREE.Vector3(...AXIS_VECTOR[move.axis]).applyMatrix3(new THREE.Matrix3().set(...frame.flat()));
      const landed = after(frame, state, move);
      frame = landed.frame; state = landed.state;
      const to = poseAll(frame, state)[POSE_OF[index]].pos;
      if (to.every((v, k) => v === stops[stops.length - 1][k])) continue;
      // Only the layers the turn moves carry the cubie; `along` is where it was before the turn.
      const along = from.dot(axisWorld);
      const moved = move.layers.some((l) => Math.abs(l - along) < 0.5) || move.layers.length === 3;
      if (!moved) continue;
      for (let i = 1; i <= ARC_STEPS; i++) curve.push(from.clone().applyAxisAngle(axisWorld, move.angle * (i / ARC_STEPS)));
      stops.push(to);
    }
    return { stops, curve };
  }

  /**
   * Draw the trails `trail` asks for: where each named piece goes over the whole of `alg`.
   *
   * THE PATH THE CUBIE REALLY TRAVELS. Its settled position at every position of the sequence comes from the
   * same arithmetic the pose is written from (`poseAll`, `after`), from position 0; and between two positions
   * it moves along an arc about the turn's axis, by the turn's angle — a chord would cut through the cube,
   * and is not where the piece went. Every point is lifted a little off the surface, so the trail floats
   * over the stickers it passes. A piece the sequence never moves has no trail. The settled points are kept
   * on each trail's `userData`, in the cube's frame, so a test can check the route against an independent
   * model without judging the look.
   */
  /** What a trail is a function of. Two drawings with the same key are the same drawing. */
  _trailKey() {
    return [
      String(this._attrs.trail ?? 'none').trim(),
      String(this._attrs['trail-style'] ?? 'steps').trim().toLowerCase(),
      this._attrs.alg ?? '',
      this._attrs.scramble ?? '',
      this._attrs.facelets ?? '',
    ].join('\u0000');
  }

  /**
   * Where trail `n` of `count` is DRAWN: its path lifted onto its own shell, then slid into its own lane.
   *
   * Arithmetic only — no meshes, no materials. Two separations, because they do different jobs and only one
   * of them is visible: the SHELL keeps trails from intersecting in space, and the LANE keeps them from
   * landing on each other in the picture, which is the one a reader notices (audit, 2026-09-16). The lane is
   * centred, so a single trail is not moved at all and several open outward evenly.
   */
  static _trailLane(curve, n, count) {
    const shell = TRAIL_SHELL + n * TRAIL_SPACING;
    const onShell = curve.map((p) => p.clone().multiplyScalar(shell / Math.max(Math.abs(p.x), Math.abs(p.y), Math.abs(p.z))));
    const offset = (n - (count - 1) / 2) * TRAIL_LANE;
    if (offset === 0) return onShell;
    return onShell.map((p, i) => {
      // The sideways direction is taken per point from the surface's outward direction there crossed with
      // the way the path is going, so it follows the route round a corner instead of being a fixed vector
      // that would cut across it.
      const ahead = onShell[Math.min(i + 1, onShell.length - 1)];
      const behind = onShell[Math.max(i - 1, 0)];
      const alongPath = ahead.clone().sub(behind);
      if (alongPath.lengthSq() < 1e-12) return p.clone();
      const sideways = p.clone().normalize().cross(alongPath.normalize());
      if (sideways.lengthSq() < 1e-12) return p.clone();
      return p.clone().add(sideways.normalize().multiplyScalar(offset));
    });
  }

  /**
   * The numerals for trail `n`: which trail, then which hop — `2.3` is the second piece's third turn.
   *
   * At each hop's MIDDLE, because both ends are taken — a leg's end carries its arrowhead and is also the
   * next leg's start — and STAGGERED by trail, because nesting separates the paths and not the writing: two
   * trails running the same way put their numerals at the same angle a shell apart, which projects to
   * almost nothing.
   */
  static _trailNumerals(lifted, stopCount, n) {
    const out = [];
    const along = Math.round(ARC_STEPS * (0.36 + 0.14 * (n % 3)));
    for (let k = 1; k < stopCount; k++) {
      const at = lifted[(k - 1) * ARC_STEPS + along].clone();
      at.setLength(at.length() + NUMERAL_LIFT);
      const numeral = billboard(`${n + 1}.${k}`, NUMERAL_FONT, 0.34, ORDER.letter, NUMERAL_PLATE);
      numeral.position.copy(at);
      // Into the camera's fit through the same key the path uses: a numeral off the edge of the frame is a
      // numeral that identifies nothing.
      numeral.userData.lifted = [at.toArray()];
      out.push(numeral);
    }
    return out;
  }

  /** Let go of every trail mesh, and the materials and textures they own. */
  _clearTrails() {
    const spent = new Set();
    for (const mesh of this._trailMeshes ?? []) { mesh.parent?.remove(mesh); mesh.geometry.dispose(); spent.add(mesh.material); }
    // `.map` as well as the material: a numeral carries a canvas texture, and a texture is not released with
    // the material that samples it — the same half-release that left the materials behind when only the
    // geometry was disposed, one level further down.
    for (const m of spent) { m.map?.dispose(); m.dispose(); }
    this._trailMeshes = [];
  }

  _placeTrails() {
    if (!this.cubies) return;
    // NOTHING TO DO WHEN NOTHING IT DEPENDS ON CHANGED. `reset()` calls this, and `seek()` calls `reset()`,
    // so every position of a scrub tore down and rebuilt every trail — geometry, materials and a canvas
    // texture per numeral — to draw the identical picture. A trail covers the WHOLE of `alg` from position
    // 0, so the cursor is not one of its inputs and a seek cannot change it (audit, 2026-09-16: measured
    // zero reused meshes after one seek). Keyed on the inputs rather than on "was it a seek", because the
    // caller's reason is not something this method can be told reliably.
    const key = this._trailKey();
    if (this._trailMeshes?.length && this._trailsFor === key) return;
    this._trailsFor = key;
    // Geometry AND material: each trail is drawn in its own ink, so it carries its own material, and a
    // material is not released with the geometry it was drawn with. This method re-runs at every seek —
    // which is every position of a scrub — so the leak was one material per trail per scrub (Codex audit,
    // 2026-09-16). Into a set first: a trail's tube and its head share one material.
    this._clearTrails();
    this._dirty = true;
    const spec = String(this._attrs.trail ?? 'none').trim();
    if (!spec || spec === 'none') { this._applyCamera(); return; }
    const named = this._trailTargets(spec);
    // Through the SAME refit as every other way of ending up with no trails. Returning bare left the camera
    // fitted to the trails that were just removed, so a typo in a selector silently kept the old framing
    // while clearing the trails normally re-fitted (audit, 2026-09-16).
    if (named === null) { this._applyCamera(); return; }
    const style = String(this._attrs['trail-style'] ?? 'steps').trim().toLowerCase();
    if (style !== 'steps' && style !== 'ribbon') {
      console.warn(`<cubus-cube> refusing trail-style — "${style}" is not steps or ribbon`);
      this._applyCamera();
      return;
    }
    // ONE RIM FOR ALL OF THEM. Each trail is drawn in its OWN ink, so an ink is a material per trail; the rim
    // is not a choice — it is the same light edge whatever the body is (see DEFAULTS) — so it is one material
    // however many trails there are. This method re-runs at every seek, which is every position of a scrub, so
    // a material per trail per redraw is the cost that made the original leak worth finding.
    const rim = new THREE.MeshBasicMaterial({ color: RIM.colour, transparent: true, opacity: RIM.alpha, depthWrite: false });
    for (const [n, { token, index }] of named.entries()) {
      const { stops, curve } = this._trailPath(index);
      if (stops.length < 2) continue;
      // Lifted onto a shell just outside every face: scaled so its largest coordinate clears the stickers. A plain
      // scale of the cubie's centre left a top-layer edge's path at 1.2, inside a cube whose faces are at 1.5 —
      // a U permutation's whole trail drew hidden (found looking at the Phase 4 look sheet).
      const lifted = CubusCube._trailLane(curve, n, named.length);
      const material = new THREE.MeshBasicMaterial({ color: MARK_BODY, transparent: true, opacity: MARK_BODY_ALPHA, depthWrite: false });
      const { meshes, body } = style === 'ribbon'
        ? CubusCube._ribbonTrail(lifted, stops.length, material, rim)
        : CubusCube._stepTrail(lifted, stops.length, material, rim);
      if (!body) { material.dispose(); continue; }
      meshes.push(...CubusCube._trailNumerals(lifted, stops.length, n));
      // THE RECORD GOES ON ONE MESH, and on the same one whichever way the trail is drawn: `stops`, the whole
      // `curve` and the whole `lifted` path are a statement about the ROUTE, and the route is what the style
      // does NOT change. Spread across the segments a `steps` trail draws, "where the piece went" would become
      // something every reader had to reassemble, and two readers would reassemble it differently.
      body.userData = { trail: token, stops, curve: curve.map((v) => v.toArray()), lifted: lifted.map((v) => v.toArray()) };
      this.root.add(...meshes);
      this._trailMeshes.push(...meshes);
    }
    // A rim nothing was drawn with is a rim nothing will ever dispose: `_placeTrails` releases what is in
    // `_trailMeshes`, and an unused material never got there. Every selector can miss (a piece the sequence
    // never moves draws nothing), so this is the ordinary path, not the unlucky one.
    if (this._trailMeshes.length === 0) rim.dispose();
    // The fit includes the trails, so a change to them is a change to what must fit.
    this._applyCamera();
  }

  /**
   * A trail as ONE DIRECTED SEGMENT PER TURN, with a gap at every stop (`trail-style: steps`).
   *
   * The complaint this answers, 2026-09-16: over `R U R' U'` the curve was hard to follow. One unbroken tube
   * with one head at the very end says where the piece ENDED and nothing about the order it got there in, and
   * a commutator's path crosses itself — so at a crossing there was no way to tell which strand came first.
   * A head per turn puts the direction on every part of the path, and the gaps make the turns countable.
   *
   * The legs are cut on `ARC_STEPS`, the same number `_trailPath` draws each arc with, so a leg is exactly one
   * turn and never straddles two.
   */
  static _stepTrail(lifted, stopCount, material, rim) {
    const meshes = []; let body = null;
    for (let k = 1; k < stopCount; k++) {
      const leg = lifted.slice((k - 1) * ARC_STEPS + STEP_GAP, k * ARC_STEPS + 1 - STEP_GAP);
      if (leg.length < 2) continue;
      const made = CubusCube._directedCurve(leg, {
        radius: 0.036, segments: leg.length * 3, headRadius: 0.142, headLength: 0.32, headSides: 16, lift: 0.075,
        material, rim: { grow: RIM.grow, material: rim },
      });
      body ??= made.tube;
      meshes.push(...made.meshes);
    }
    return { meshes, body };
  }

  /**
   * A trail as ONE UNBROKEN PATH whose width is time (`trail-style: ribbon`): thin where the piece started,
   * full where it ended, with a chevron at each stop it passed through.
   *
   * The width is readable at a glance along the whole path, which the segmented form gives up in exchange for
   * countability. The chevrons are what keeps it honest where it crosses itself: width alone is a comparison
   * between two places, and at a crossing the eye has both strands at once and no way to rank them.
   */
  static _ribbonTrail(lifted, stopCount, material, rim) {
    const made = CubusCube._directedCurve(lifted, {
      radius: 0.046, segments: lifted.length * 3, headRadius: 0.15, headLength: 0.34, headSides: 16, lift: 0.08,
      material, rim: { grow: RIM.grow, material: rim }, taper: RIBBON_TAPER,
    });
    const meshes = [...made.meshes];
    for (let k = 1; k < stopCount - 1; k++) {
      const at = lifted[k * ARC_STEPS];
      const tangent = lifted[k * ARC_STEPS + 1].clone().sub(at).normalize();
      // The chevron's own rim first, under it, for the same reason the path has one.
      meshes.push(CubusCube._chevron(at, tangent, 0.118 + RIM.grow, rim, ORDER.rim));
      meshes.push(CubusCube._chevron(at, tangent, 0.118, material, ORDER.mark));
    }
    return { meshes, body: made.tube };
  }

  /** Hold the arrow in the sequence's frame, so the next move is drawn about the axis it will turn. */
  _placeArrowFrame() {
    if (!this._arrow) return;
    const m = this._seq ?? UPRIGHT;
    this._m4a ||= new THREE.Matrix4();
    setBasis(this._m4a, m);
    this._arrow.quaternion.setFromRotationMatrix(this._m4a);
  }

  /** The walk's starting state, with every attribute read in: `_set()` skips an unbuilt cube. */
  _initWalk() {
    this._anim = null;
    this._queue = [];
    this._cursor = 0;
    this._playing = false; // play() intent — lets pause() stop cleanly between moves
    this._applied = 0; // solution moves animated since the last reset (drives 'cubus-step')
    this._readSol();
    // _set() returns early until the meshes exist, so an attribute present at parse time has not
    // been read yet. reset() below paints, and painting re-resolves the highlight.
    this._hlSet = null;
    this._readHighlight();
    this._readFocus();
    this._ghostVisible();
    // An orientation written before the element connected has not been read yet — `_set()` returns
    // early until the meshes exist — and `connectedCallback` draws immediately, so without this the
    // first frame is of a cube held the way nobody asked for. The same ordering trap that once made
    // a mounted cube draw itself framed for a ghostless one.
    this.showTurn(this._attrs.orientation, this._attrs.orientation, 1);
    // QUIET, because this one is not a step anybody took. `reset()` reports position 0, and here that report
    // would leave the element mid-construction inside a host's listener — one that calls `dispose()` gets an
    // element whose teardown runs while `_build` is still going, after which `_build` publishes the scene it
    // just tore down and `_start` calls `setSize` on a null renderer (audit, 2026-09-16; the same reasoning
    // `seek()` already used this flag for). A host learns the starting position from the first real event or
    // by reading `stops`; it does not need to be told before the cube exists.
    this._quiet = true;
    try { this.reset(); } finally { this._quiet = false; }
    this._placeLabels();
  }

  /** The resize and visibility observers, and the frame loop itself. */
  _buildLoop() {
    this._resize = () => {
      const w = this.clientWidth || 1, h = this.clientHeight || 1;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this._applyCamera(); // the distance depends on the aspect (see there); it sets _dirty
    };
    this._ro = new ResizeObserver(this._resize);
    // Several of these live on one page — only draw when on screen and moving.
    this._io = new IntersectionObserver((es) => { this._visible = es.some((e) => e.isIntersecting); }, { threshold: 0 });

    this._tick = () => {
      this._raf = requestAnimationFrame(this._tick);
      this._frame();
    };
  }

  /** One frame of the loop: settle any backlog, advance whatever is timed, and draw if needed. */
  _frame() {
    if (!this._drainBacklog()) return;
    // Off screen the loop keeps running but draws nothing, so autorotate's reference time is let
    // go HERE as well as when the loop stops: kept, the first frame back added the whole hidden
    // stretch at once — a cube scrolled away for a minute leapt 12.6 rad on its return (found by
    // verification, 2026-09-14).
    if (!this._visible) { this._spinAt = null; return; }
    // The drain above completes moves without calling _next(), which breaks the pull chain
    // step() and the completion handler otherwise maintain: queued moves — and a playing
    // walk — would sit forever with nothing in flight. Re-arm it.
    if (!this._anim && (this._queue.length || this._playing)) this._next();
    if (!this._advanceMove()) return;
    this._breathe();
    this._advanceTurn();
    this._advanceSpin();
    const moving = this.controls.update();
    if (moving) this._placeLights();
    if (moving || this._dirty) { this._draw(); this._dirty = false; }
  }

  /** Complete every move past the backlog limit. False when a completion stopped the loop. */
  _drainBacklog() {
    // The backlog rule, visible or not: at most two turns may exist as pending ANIMATION;
    // everything older completes instantly. A deeper queue means the element was scrolled out
    // (rAF runs, _visible false), the window was occluded (rAF pauses entirely, so this runs
    // at the first frame back), or a burst outran the tempo — and in every one of those,
    // replaying a stale film move by move helps nobody. Same policy the app's drawTo applies
    // from its side. Off screen the drain is total: animating for nobody banks pure backlog.
    // Only queued work drains — play() pulls from the solution one move at a time, and
    // draining that would fast-forward a whole walk.
    while (
      this._queue.length + (this._anim ? 1 : 0) > 2 ||
      (!this._visible && (this._anim || this._queue.length))
    ) {
      let a = this._anim;
      if (!a) a = { m: this._queue.shift() };
      this._completeMove(a);
      if (!this._running) return false; // see `_advanceMove`
    }
    return true;
  }

  /** Pose the move in flight now, completing it at its end. False when that stopped the loop. */
  _advanceMove() {
    if (this._anim) {
      const a = this._anim;
      const k = Math.min(1, (this._now() - a.t0) / a.dur);
      this._writePose(a.m, EASE(k));
      if (k >= 1) {
        this._completeMove(a);
        // `_completeMove` dispatches `cubus-step`, and a listener is the host's code: a screen that
        // leaves when its walk ends disposes the cube right there. The frame went on and read the
        // controls it had just released (found by audit, 2026-09-14). Disposing or detaching
        // stops the loop, so a stopped loop is the sign to stop using the element.
        if (!this._running) return false;
        this._next();
      }
      this._dirty = true;
    }
    return true;
  }

  /** The highlight's breath, written only when its phase changed. */
  _breathe() {
    // The highlight breathes on its own clock, independent of the move animation: a piece can be
    // named while the cube is still, and it must keep pulsing while a turn plays over it.
    //
    // The phase is evaluated every frame and never branched around, because the reduced-motion
    // preference can flip WHILE a pulse is in flight. Skipping the update in that case froze the
    // highlight at whatever intensity it happened to hold — and at the trough of the breath that
    // is invisible, so the indicator silently vanished for exactly the users who asked for less
    // motion. Writing only on change keeps the static case free: under reduced motion the phase
    // is a constant, so this settles after one frame and stops marking the scene dirty.
    if (this._hlSet?.size) {
      const k = this._hlPhase();
      if (k !== this._hlK) {
        this._applyHighlight(k);
        this._hlK = k;
        this._dirty = true;
      }
    }
  }

  /** An in-flight turnTo(), posed at this instant and settled at its end. */
  _advanceTurn() {
    // An in-flight turnTo() is the only thing that WRITES the phase on a clock. Everything else
    // — the attribute, a scrubber — sets it directly, which is why this is a caller of
    // showTurn() rather than a second way to pose the cube.
    if (this._turning) {
      const t = this._turning;
      const k = Math.min(1, (this._now() - t.t0) / t.ms);
      this._setTurn(t.from, t.to, EASE(k));
      // Settle AFTER the last pose is written, and re-anchor on the destination so the next
      // turn starts from a settled orientation rather than from a finished turn's `from`.
      if (k >= 1) { this._setTurn(t.to, t.to, 1); this._settleTurn(true); }
      this._dirty = true;
    }
  }

  /** Autorotate, by the time elapsed since its last reading. */
  _advanceSpin() {
    // By ELAPSED TIME, on the element's own clock. A fixed step a frame turned the cube twice as
    // fast on a 120 Hz display, and kept turning under a pinned clock — which is the one
    // instrument meant to make a frame reproducible (found by audit, 2026-09-14). `_spinAt` is
    // cleared whenever the loop stops, so resuming continues from where it was rather than
    // leaping by however long the cube was off screen.
    if (this._attrs.autorotate != null) {
      const now = this._now();
      if (this._spinAt != null) this._spin += (now - this._spinAt) * SPIN_PER_MS;
      this._spinAt = now;
      this._applyRoot();
    } else {
      this._spinAt = null;
    }
  }

  /** Begin drawing into whatever slot this is in now. Idempotent. */
  _start() {
    if (this._running || !this.scene) return;
    this._running = true;
    this._ro.observe(this);
    this._io.observe(this);
    // Assume on screen until the observer says otherwise; it reports asynchronously, and a first
    // frame skipped for "not visible yet" is a slot that stays empty until something else moves.
    this._visible = true;
    this._resize(); // a re-used element is very likely in a differently shaped slot
    this._dirty = true;
    this._tick();
  }

  /** Stop drawing, keeping everything needed to start again. */
  _stop() {
    this._running = false;
    this._spinAt = null;
    cancelAnimationFrame(this._raf);
    this._ro?.disconnect();
    this._io?.disconnect();
  }

  disconnectedCallback() {
    this._stop();
    // Moving an element is a disconnect and a connect in the SAME task, and the app deliberately
    // parks one between screen renders (app.js, parkCube) — neither may release the context.
    // But a page gets only so many WebGL contexts, so a cube nobody re-attached and nobody
    // parked must not sit on one forever: still detached and unparked when the task ends, and it
    // lets go of itself. Loud default, not a quiet leak.
    clearTimeout(this._release);
    this._release = setTimeout(() => { if (!this.isConnected && !this.parked) this.dispose(); }, 0);
  }

  /** Release the GPU. The element is spent afterwards — connecting it again builds a new one. */
  dispose() {
    this._stop();
    // The loop that would have finished this turn has just been cancelled, so nothing else will
    // ever answer its caller. An `await cube.turnTo(…)` on a disposed element would hang forever.
    this._settleTurn(false);
    clearTimeout(this._release);
    // OrbitControls registers a capture-phase keydown listener on the canvas's root node, so
    // dropping the reference is not releasing it. Worse, it unbinds from `getRootNode()` as it
    // finds it AT DISPOSE TIME — and the common path here is the release timer, which fires after
    // the element has been detached, when that call resolves to the detached subtree instead of
    // the document. Measured: disposing while connected leaves 0 document listeners, disposing
    // after detachment leaves 1.
    //
    // So put the canvas back where it was bound, just long enough to unbind. Hidden and removed
    // immediately; it is never painted.
    // Taken from the CONTROLS, not from `this.renderer`: the two are nulled together at the end
    // of this method, but a caller that nulled the renderer first would otherwise skip the
    // reattach and leak the listener again.
    const canvas = this.controls?.domElement ?? this.renderer?.domElement;
    const root = this._controlsRoot;
    const host = root && (root.body ?? (root.nodeType === 11 ? root : null));
    const detached = canvas && host && canvas.getRootNode() !== root;
    // The style is put back. A caller may still hold this canvas — `dispose()` releases the GPU,
    // it does not own the element — and leaving `display: none` on it is a permanent change made
    // for the duration of one `appendChild`.
    const wasDisplay = detached ? canvas.style.display : null;
    if (detached) { canvas.style.display = 'none'; host.appendChild(canvas); }
    this.controls?.dispose();
    if (detached) { canvas.remove(); canvas.style.display = wasDisplay; }
    // What the scene owns is released too. `renderer.dispose()` frees the context and nothing the
    // scene holds — four geometries and 110 materials went undisposed (found by audit, 2026-09-14).
    // Collected into sets first because they are shared: every body is one geometry and one
    // material, and disposing a shared one per mesh would dispose it 26 times.
    // The arrow's materials start in the set rather than being found in the scene: they are shared by the
    // tube and the head, which exist only while an arrow is SHOWN, so a cube disposed with no arrow on it
    // left them undisposed. A set, so a shown arrow does not dispose them twice. BOTH of them — the rim is
    // a second material with the same lifetime, and the one the arrow is not currently wearing is exactly
    // the one no traversal can reach.
    const owned = new Set([this._arrowMat, this._arrowRimMat].filter(Boolean));
    this.scene?.traverse((o) => {
      if (o.geometry) owned.add(o.geometry);
      // A material's texture is not freed with it: the face letters' canvases are (plan item 4.3).
      for (const m of [o.material].flat()) if (m) { owned.add(m); if (m.map) owned.add(m.map); }
    });
    for (const r of owned) r.dispose();
    this.renderer?.dispose();
    this.renderer?.domElement?.remove();
    // And let go of it. `root`, `cubies` and `stickers` hold the meshes, and the frame loop and the
    // resize observer are closures over the renderer and camera — kept, a disposed element went on
    // holding the whole old scene alive.
    this.scene = this.renderer = this.camera = this.controls = this._controlsRoot = null;
    this.root = this.cubies = this.stickers = this._ghostMeshes = null;
    this._tick = this._resize = this._ro = this._io = null;
    // The annotations hold the scene too, and each was its own way to keep all of it alive: the arrow is
    // a group whose parent chain runs back to the scene, and the labels and trails are meshes of it. The
    // ghost twins are a 54-entry map of mesh to mesh — CLEARED rather than nulled, because `_stickersNamed`
    // asks it for every selector and a null map would turn a late call into a crash where the release is
    // the point (Codex audit, 2026-09-16).
    this._arrow = this._arrowMat = this._arrowRimMat = this._labelMeshes = this._trailMeshes = null;
    this._trailsFor = null;
    this._ghostTwin?.clear();
    // And the three that hold meshes without being made of them: the lamps, and the two BOUND selector
    // sets. A bound focus or highlight is a set of sticker meshes — the whole point of binding — so it
    // holds the scene exactly as the annotations did (found by the verify pass over this fix, 2026-09-16).
    // Both go through the same doors they always did: `_rebindFocus()` nulls the one, and a highlight with
    // no selectors nulls the other.
    this._lights = this._fcSet = this._hlSet = null;
  }

  /**
   * Hand this element back for a different screen to use: every observed attribute to its
   * default, the puzzle solved, the camera back on its fitted mark.
   *
   * Removing an attribute is not a shortcut here — it is the reset. `_set()` treats a removal as
   * "back to the default" and runs the same repaint/refit each one would run if it had been
   * written, so this cannot drift from what the attributes mean. What removal does NOT cover is
   * state no attribute owns: an autorotation already accumulated, and a camera the user orbited
   * away from while no camera attribute was set.
   */
  recycle() {
    for (const name of CubusCube.observedAttributes) this.removeAttribute(name);
    // A value set through a PROPERTY never became an attribute, so removing attributes did not
    // reach it: a recycled cube came back with the last screen's palette, alg and scramble (found
    // by audit, 2026-09-14). Whatever is still not at its default is put back through `_set()`, the
    // same door a removal uses, so its repaint and refit run exactly as they would have.
    for (const name of CubusCube.observedAttributes) {
      if (Object.hasOwn(CubusCube.ALIAS, name)) continue; // one slot per canonical name
      if (this._attrs[name] !== CubusCube.DEFAULTS[name]) this._set(name, null);
    }
    // A turn in flight belongs to the screen being torn down, and its caller is owed an answer
    // before the cube is handed to the next one. Settled first, so the pose reset below cannot be
    // undone by a frame of the old animation still running.
    this._settleTurn(false);
    this._spin = 0;
    this._turn = { from: 'U F', to: 'U F', phase: 1 };
    this._fitTurned = undefined; // so the next pose re-asks for the fit rather than assuming it
    // The quaternion is the only writer now — `.rotation` is three.js's derived Euler view of it,
    // so zeroing that instead would be undone the next time the quaternion is written.
    this.root?.quaternion.identity();
    this.reset();
    this._applyCamera();
  }

  _num(name, fallback) {
    const v = Number(this._attrs[name]);
    return Number.isFinite(v) ? v : fallback;
  }

  // latitude/longitude in degrees, distance in cubie units — same three knobs the
  // codebase player exposes, and the ones OrbitControls then takes over from.
  /** Is the ghost layer on at all? ONE predicate — it had four copies, and four copies of an
   *  accepted-values check is how 'off' comes to mean different things per feature. */
  _ghostsEnabled() {
    return this._attrs.ghosts !== 'none' && this._attrs.ghosts !== 'false';
  }

  /** Should this ghost show for a camera at `eye`? Facing away → hidden face → show its ghost.
   *  Shared by the main-view cull and the opposite view, which shows the complementary set. */
  _ghostShows(g, eye) {
    const n = (this._n ||= new THREE.Vector3());
    n.set(...g.userData.n).applyQuaternion(g.parent.getWorldQuaternion(this._q ||= new THREE.Quaternion()));
    return n.dot(eye) < -0.15;
  }

  /** Drag-to-orbit is a preference, not a given. For a learner reading a guide, a drag that swings
   *  the cube away from the angle the ghost faces are set up for is a mistake waiting to happen,
   *  so the host can lock it.
   *
   *  LOCKED MEANS LOCKED, zoom included. It used to set `enableRotate` alone, on the reasoning
   *  that only the angle mattered — but a wheel or a trackpad pinch over a locked cube then drove
   *  it to `minDistance` with no way back, because the drag that would restore the view is the
   *  thing that was disabled (found by audit, 2026-09-04). Pan was already off in both states:
   *  the camera is fitted to the slot (lib/cube-frame.js), so a panned cube is a clipped one. */
  /**
   * Parse `"<up> <front>"` into a quaternion, or null if it does not name an orientation.
   *
   * Refuses a pair on one axis rather than picking some third thing: `U D` and `F F` are not
   * orientations, and a renderer that resolved them to something would be inventing a cube.
   */
  _pose(spec) {
    const parts = String(spec ?? '').trim().toUpperCase().split(/\s+/);
    const [up, front] = parts;
    if (parts.length !== 2 || !up || !front) return null;
    // `isFace`, not `'URFDLB'.includes(up)` — that is a SUBSTRING test, so it accepted "UR" and
    // "RFD", and `orientationMatrix` then THREW from inside what is supposed to be a refusal that
    // returns null and warns. One definition of a legal face letter, shared with the module that
    // will have to draw it.
    if (!isFace(up) || !isFace(front) || sameAxis(up, front)) return null;
    // `Matrix4.set` takes its arguments in ROW-major order, and `orientationMatrix` returns rows,
    // so the rows go in as rows. Feeding the columns instead builds the TRANSPOSE, which for a
    // rotation is its inverse — a cube that turns the wrong way while passing every count, every
    // centre check and the determinant. This file shipped that for an hour: the comment here
    // warned about it and the code below did it, and the only case that noticed was the browser
    // check that asks where the named face actually ended up.
    const m = orientationMatrix(up, front);
    const basis = setBasis(new THREE.Matrix4(), m);
    // The canonical spelling travels with the quaternion: `_turned()` compares specs, and it must
    // not be defeated by "u f" or a double space.
    return { q: new THREE.Quaternion().setFromRotationMatrix(basis), spec: `${up} ${front}` };
  }

  /**
   * Hold the cube at `phase` of a turn from one orientation to another. THE PRIMITIVE.
   *
   * Synchronous, idempotent, and a pure function of its three arguments — which is what a lesson
   * scrubber needs: the same `t` gives the same pose whether it was reached by playing forwards,
   * seeking backwards, or landing on it while paused.
   *
   * The path between two poses is the shortest arc, which is deterministic because three.js's
   * slerp flips the sign of the far quaternion when the dot product is negative. Two orientations
   * a half-turn apart have no unique shortest arc; they get a consistent one, which is the
   * property that matters here.
   */
  showTurn(from, to, phase) {
    // VALIDATE FIRST, then cancel. Cancelling first meant a REFUSED orientation — a typo in an
    // attribute — killed a perfectly good turn in flight and left the cube stranded part-way
    // through it. A request the element rejects must change nothing at all.
    if (!this._pose(from) || !this._pose(to)) return this._setTurn(from, to, phase);
    // A public pose change cancels an animation in flight: without this, the pose was written and
    // the very next frame overwrote it from the old animation, whose promise went on running. The
    // animation's own per-frame updates go through `_setTurn`, or a turn would cancel itself.
    this._settleTurn(false);
    return this._setTurn(from, to, phase);
  }

  /** Set the pose without touching an animation in flight. The tick's path. */
  _setTurn(from, to, phase) {
    const a = this._pose(from);
    const b = this._pose(to);
    if (!a || !b) {
      console.warn(`<cubus-cube> refusing orientation "${!a ? from : to}" — expected two perpendicular faces of URFDLB, as in "U F"`);
      return false;
    }
    const p = Number(phase);
    this._turn = {
      from: a.spec,
      to: b.spec,
      phase: Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 1,
    };
    this._applyRoot(a.q, b.q);
    // The fit depends on WHETHER the cube is turned, not on how far — see `_turned()`. So it is
    // re-asked when that boolean flips, not on every pose write: `_applyCamera` rebuilds the
    // silhouette and refits, and calling it once per frame of a turn spent that work sixty times a
    // second to arrive at the same distance.
    this._refitIfTurned();
    return true;
  }

  /**
   * Turn the cube to `up`/`front` over `ms`, resolving when it settles. Sugar over `showTurn`.
   *
   * Resolves rather than rejects when it is superseded, recycled or disposed: the caller asked to
   * be told when the turn is over, and a promise left pending forever is the leak. Callers that
   * need to know whether they were interrupted get `false`.
   */
  turnTo(up, front, { ms = 400 } = {}) {
    const to = `${up} ${front}`;
    if (!this._pose(to)) {
      console.warn(`<cubus-cube> refusing turnTo("${up}", "${front}") — expected two perpendicular faces of URFDLB`);
      return Promise.resolve(false);
    }
    // Settle the old promise rather than leaving its caller waiting on a turn that will never
    // finish. Where the new turn STARTS is the nearest named orientation, not the exact pose the
    // cube is in: the primitive interpolates between two NAMED orientations, which is what makes a
    // scrubber's `t` reproducible, and an arbitrary starting quaternion would give that up. So
    // superseding a turn half way through can step at most half a turn — visible, bounded, and
    // preferable to a pose no `showTurn(from, to, phase)` could ever reproduce.
    const from = this._nearestSpec();
    this._settleTurn(false);
    // A non-finite duration is not a long turn, it is a turn that never ends: `(now - t0) / NaN`
    // is NaN, `NaN >= 1` is false forever, and the promise stays pending until something else
    // cancels it. Treated as "no animation" rather than accepted.
    if (!Number.isFinite(ms) || reducedMotion() || ms <= 0) {
      this.showTurn(to, to, 1);
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      this._turning = { from, to, t0: this._now(), ms, settle: resolve };
      // `_setTurn`, not `showTurn`: the public one cancels an animation in flight, and the one in
      // flight is the one this line just created.
      this._setTurn(from, to, 0);
      this._dirty = true;
    });
  }

  /** The named orientation the cube is nearest to — its own when settled, the closer end mid-turn. */
  _nearestSpec() {
    return this._turn.phase >= 0.5 ? this._turn.to : this._turn.from;
  }

  /** Finish an in-flight turnTo without moving the cube, telling its caller what happened. */
  _settleTurn(completed) {
    const t = this._turning;
    this._turning = null;
    t?.settle(completed);
  }

  /** Write the root's rotation: the held pose, with the autorotate spin on top of it. */
  _applyRoot(a = this._pose(this._turn.from)?.q, b = this._pose(this._turn.to)?.q) {
    if (!this.root || !a || !b) return;
    const q = (this._q0 ||= new THREE.Quaternion());
    if (this._turn.phase >= 1) q.copy(b);
    else if (this._turn.phase <= 0) q.copy(a);
    else q.copy(a).slerp(b, this._turn.phase);
    if (this._spin) {
      // A turntable turns about the WORLD's up, so the spin is applied AFTER the pose. Composed
      // the other way it would spin about the cube's own axis, which for a cube held on its side
      // is a different motion entirely.
      const s = (this._qs ||= new THREE.Quaternion());
      s.setFromAxisAngle(Y_AXIS, this._spin);
      q.premultiply(s);
    }
    this.root.quaternion.copy(q);
    this._dirty = true;
  }

  /**
   * Is the cube held any way other than the way `silhouette()` assumes?
   *
   * Mid-turn is the obvious case — a pose partway between two orientations has an outline that is
   * not a cube's at all. But a SETTLED turn counts too, and that was not obvious: the 24
   * orientations are the cube's own symmetries, so the full point set is unchanged, yet the `view`
   * fit does not use the full set. It culls to the ghosts THIS eye would see, and which ghosts
   * those are depends on how the cube is held — a fact `silhouette()` is never told. So a settled
   * quarter turn under `view` was measured fitting the wrong ghosts and pushing a corner 27% past
   * the frame edge.
   */
  _turned() {
    // A sequence with a whole-cube turn, a slice or a wide move in it turns the cube as it plays, so the
    // silhouette's upright assumption never holds for it: stable from the moment it loads, rather than a
    // fit that jumps when the first such move lands.
    // And the frame the sequence has reached counts while it is turned: a rotation part way through an
    // alg leaves the cube on its side, and the fit has to hold it until a step, a seek or a reset puts
    // it back. (A REPLACED `alg` is one of the things that puts it back — a new sequence starts where
    // the sequence starts, `_replaceAlg`.)
    // AUTOROTATE IS A TURN. `_advanceSpin` rotates the root every frame while it is on, so the upright
    // silhouette the `view` fit assumes is exactly what the cube is not — and the fit never re-ran, because
    // spinning is not an event. A ghost vertex reached 1.062 of the frame at elevation 9, 34 degrees in
    // (audit, 2026-09-16). Asked about the ATTRIBUTE rather than about `_spin`, deliberately: a spin that
    // has been stopped leaves a residual angle, and a fit that flipped back the moment the angle happened
    // to pass zero would resize the cube while it turns, which is the jump the stable fit exists to avoid.
    if (this._attrs.autorotate != null) return true;
    if (this._solMovesCentres || !isUpright(this._seq ?? UPRIGHT)) return true;
    const { from, to, phase } = this._turn;
    if (from === to || phase >= 1) return to !== 'U F';
    if (phase <= 0) return from !== 'U F';
    return true;
  }

  /** Re-ask for the camera fit when whether the cube counts as turned has changed. */
  _refitIfTurned() {
    const turned = this._turned();
    if (turned !== this._fitTurned) {
      this._fitTurned = turned;
      this._applyCamera();
    }
  }

  _applyOrbit() {
    if (!this.controls) return;
    const free = this._attrs.orbit !== 'locked';
    this.controls.enableRotate = free;
    this.controls.enableZoom = free;
  }

  _applyCamera() {
    if (!this.camera) return;
    this._v3a ||= new THREE.Vector3();
    this._v3b ||= new THREE.Vector3();
    // The distance is fitted, not tuned: the silhouette this view draws — the cube, and the
    // ghost faces on the sides the eye cannot see, at their elevation and scale — projected
    // against the canvas's field of view AND aspect, so every corner lands inside the frame with
    // a margin, for any slot shape. A hand-tuned distance ("18 frames the tuned look") was right
    // for one shape and clipped the ghost faces' corners on every other, and pulling back by the
    // aspect only moved which shapes clipped. Re-run on every resize and every relevant attribute.
    const lat = this._num('camera-latitude', 35);
    const lon = this._num('camera-longitude', 45);
    const eye = eyeDirection(lat, lon);
    const worldUp = this._cameraUp();
    // A stable fit has to bound the ghosts on the faces THIS eye can see too, because some other
    // angle will show them and the distance must already have room for them.
    // A TURNED cube gets the stable fit whether or not the attribute asked for it, because `view`
    // is computed from a silhouette that assumes the cube is upright (see `_turned`). Stable needs
    // no such assumption: it bounds the points' enclosing SPHERE, which no rotation can change, so
    // one number frames every pose the cube can take.
    //
    // Costs the real consumer nothing: every surface cubus-im builds already sets `camera-fit` to
    // `stable`. For anyone else it trades about 11% of apparent size for corners that stay on
    // screen, and only while the cube is held some way other than upright.
    const stable = this._attrs['camera-fit'] === 'stable' || this._turned();
    const points = silhouette({
      eye,
      elevation: this._ghostsEnabled() ? this._num('ghost-elevation', 4) : null,
      scale: this._num('facelet-scale', 0.9),
      cull: !stable,
    });
    // A trail floats outside the cube and a loop of one can reach past every corner, so what it draws is part of
    // what the view must fit: a commutator's corner looped off the bottom of the frame before this (plan item 4.4,
    // found on the Phase 4 look sheet). In the cube's own frame, which is the silhouette's.
    //
    // THE GEOMETRY, NOT THE CENTRELINE. This read the recorded path points, which are the spine of a tube a
    // few hundredths thick with a cone on the end and a text plane beside it — none of which are on the
    // spine. An arrowhead for `alg="R" trail="piece:UR"` projected outside a 320x640 frame while every point
    // this fitted was inside it (audit, 2026-09-16), and the fitting TEST checked the same points the fit
    // did, so the two agreed about a picture that was clipped. A mesh's own bounding box knows about its
    // thickness, its head and its lettering, because it is made of them.
    // The recorded path AND the drawn geometry, never the geometry alone: a bounding box is axis-aligned in
    // the mesh's own frame, so for a tube that curves round a corner it is a loose box whose corners can sit
    // somewhere the tube never goes — and a fit computed from those alone came out DIFFERENT, not merely
    // larger. The union is the honest answer: every point the path is known to occupy, plus a bound on the
    // thickness, heads and lettering the path does not describe.
    for (const mesh of this._trailMeshes ?? []) {
      for (const q of mesh.userData.lifted ?? []) points.push(q);
      points.push(...meshCorners(mesh));
    }
    const geom = { points, vfovDeg: this.camera.fov, aspect: this._drawAspect(), eye, worldUp };
    const d = stable ? fitDistanceStable(geom) : fitDistance(geom);
    // The controls clamp the distance on every update(), so their limits follow the fit: a user
    // may zoom in to look closer, never out past the frame — and a resize puts the fit back.
    if (this.controls) { this.controls.minDistance = d * 0.5; this.controls.maxDistance = d; }
    this.camera.up.set(worldUp[0], worldUp[1], worldUp[2]);
    // THE FIT OWNS THE DISTANCE; ONCE SOMEONE HAS ORBITED, THEY OWN THE DIRECTION. This wrote both, so any
    // refit — and `seek()` causes one through `reset()` — snapped a hand-turned view back to the attributes'
    // angle mid-scrub (audit, 2026-09-16). Which is which is decided by comparing the camera against the
    // direction this method last WROTE: if it has moved since, a hand moved it. An explicit new
    // `camera-latitude`/`camera-longitude` still wins, because then the ASK has changed too and a host
    // instruction outranks a drag — without that clause, orbiting once would deafen the element to its own
    // attributes for the rest of its life.
    const askedChanged = !this._eyeAsked || eye.some((v, i) => Math.abs(v - this._eyeAsked[i]) > 1e-9);
    const orbited = !askedChanged && this._eyeWritten !== undefined && this.camera.position.lengthSq() > 0
      && this._v3a.set(...this._eyeWritten).angleTo(this._v3b.copy(this.camera.position).normalize()) > 1e-4;
    const dir = orbited ? this._v3b.toArray() : eye;
    this._eyeAsked = [...eye];
    this._eyeWritten = [...dir];
    this.camera.position.set(d * dir[0], d * dir[1], d * dir[2]);
    this.camera.lookAt(0, 0, 0);
    // OrbitControls builds the quaternion that maps `object.up` onto +Y ONCE, in its constructor
    // (three r185, OrbitControls.js line 406). Changing the camera's up afterwards would leave it
    // orbiting in the old frame while the renderer drew in the new one — dragging up would move
    // the cube down. Rebuilding the two derived fields is the whole fix; `camera-up.test.mjs`
    // pins their names so a three upgrade that renames them fails loudly instead of drifting.
    if (this.controls?._quat) {
      this.controls._quat.setFromUnitVectors(this.camera.up, new THREE.Vector3(0, 1, 0));
      this.controls._quatInverse = this.controls._quat.clone().invert();
    }
    this.controls?.update();
    this._placeLights();
    this._dirty = true;
  }

  /**
   * Which way is up, as a unit vector, from the `camera-up` face letter.
   *
   * Refuses rather than guesses: an unreadable value warns by name and falls back to the world's
   * up, because a silently rolled camera is indistinguishable from a correct one until somebody
   * notices the cube is upside down.
   */
  _cameraUp() {
    const raw = String(this._attrs['camera-up'] ?? 'U').trim().toUpperCase();
    const v = raw.length === 1 ? slotVector(raw) : null;
    if (!v) {
      // `raw`, never the stored value: a Symbol survives `String()` above and then throws inside
      // a template literal, so interpolating the original would turn a warn-and-recover into an
      // exception and never return the fallback at all.
      console.warn(`<cubus-cube> refusing camera-up "${raw}" — expected one of U D R L F B`);
      return [0, 1, 0];
    }
    return v;
  }

  /**
   * The aspect ratio the cube is actually drawn at: half the width when `back-view` splits the
   * element, the whole of it otherwise. The top-right inset keeps the element's own shape, so it
   * needs nothing of its own.
   *
   * ONE definition, for the fit and for `_draw()`. The fit used to read `camera.aspect`, which
   * `_resize()` sets to the WHOLE element — so a side-by-side pane half as wide was framed for
   * twice its width, and at 320x240 the cube ran off both edges of both panes (found by audit,
   * 2026-09-14).
   */
  _drawAspect() {
    const w = this.clientWidth || 1, h = this.clientHeight || 1;
    return this._split(w) ? Math.floor(w / 2) / h : w / h;
  }

  /** Is this element drawn as two panes? Below 4px there is no meaningful split. */
  _split(w = this.clientWidth || 1) {
    return (this._attrs['back-view'] || 'none') === 'side-by-side' && w >= 4;
  }

  /** Turn the light rig with the given camera (the main one by default). */
  _placeLights(cam = this.camera) {
    if (!this._lights || !cam) return;
    for (const [light, dir] of this._lights) light.position.copy(dir).applyQuaternion(cam.quaternion);
  }

  // Sticker size within its tile. 1 = edge to edge, 0.9 = the player's default.
  _applyScale() {
    if (!this.stickers) return;
    const s = Math.max(0.3, Math.min(1, this._num('facelet-scale', 0.9))) / 0.9;
    for (const m of this.stickers) m.scale.set(s, s, 1);
    for (const g of this._ghostMeshes) g.scale.set(s, s, 1);
    this._dirty = true;
  }

  // Ghosts exist to read faces the camera CANNOT see, so a ghost on a face turned
  // toward the viewer is noise — cull per frame by the face normal in world space.
  _cullGhosts() {
    if (!this._ghostMeshes.length || !this._ghostsEnabled()) return;
    const eye = this.camera.position.clone().normalize();
    for (const g of this._ghostMeshes) g.visible = this._ghostShows(g, eye);
  }

  _draw() {
    const r = this.renderer, w = this.clientWidth || 1, h = this.clientHeight || 1;
    this._cullGhosts();
    const bv = this._attrs['back-view'] || 'none';

    if (this._split(w)) {
      // The right pane takes the remainder, so an odd width leaves no stale pixel column.
      const left = Math.floor(w / 2), right = w - left;
      this.camera.aspect = this._drawAspect();
      this.camera.updateProjectionMatrix();
      // finally, because scissor state outlives this frame: a render throw would otherwise
      // leave every later full-frame draw clipped to the last scissor rectangle.
      r.setScissorTest(true);
      try {
        r.setViewport(0, 0, left, h); r.setScissor(0, 0, left, h);
        this._faceCamera(this.camera);
        r.render(this.scene, this.camera);
        this._renderOpposite(left, 0, right, h);
      } finally { r.setScissorTest(false); }
      return;
    }

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    r.setViewport(0, 0, w, h);
    this._faceCamera(this.camera);
    r.render(this.scene, this.camera);

    // A degenerate inset (0×N viewport, 0/0 aspect) draws nothing anyone can see and poisons
    // the projection — below a few pixels the main view alone is the honest picture.
    if (bv === 'top-right' && Math.floor(w * 0.32) > 0 && Math.floor(h * 0.32) > 0) {
      const iw = Math.floor(w * 0.32), ih = Math.floor(h * 0.32);
      const [x, y] = [w - iw - 10, h - ih - 10];
      const autoClear = r.autoClear;
      r.setScissorTest(true);
      try {
        // The inset is drawn OVER the main view, so only depth is cleared, and only inside it. The
        // explicit clearDepth() always said so, but render() clears colour too while autoClear is
        // on, and it cut a hard-edged transparent hole through the main cube's corner — every
        // pixel of the inset's rectangle came back 0,0,0,0 (seen in the appearance golden,
        // 2026-09-15). The scissor is set before the clear because a stale one, left by a
        // side-by-side frame, would clear somewhere else.
        r.setScissor(x, y, iw, ih);
        r.clearDepth();
        r.autoClear = false;
        this._renderOpposite(x, y, iw, ih);
      } finally { r.autoClear = autoClear; r.setScissorTest(false); }
    }
  }

  // The second camera is this one mirrored through the origin: the far side of the cube.
  _renderOpposite(x, y, w, h) {
    const r = this.renderer;
    const cam = this._back ||= new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    cam.position.copy(this.camera.position).negate();
    cam.aspect = w / h;
    cam.up.copy(this.camera.up);
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
    // Ghost culling is camera-relative, so the back view shows the complementary set.
    const flipped = [];
    for (const g of this._ghostMeshes) if (g.visible !== false) { flipped.push(g); g.visible = false; }
    const hidden = [];
    if (this._ghostsEnabled()) {
      const eye = cam.position.clone().normalize();
      for (const g of this._ghostMeshes) {
        if (this._ghostShows(g, eye)) { g.visible = true; hidden.push(g); }
      }
    }
    try {
      // The far side is lit from ITS eye, not the main one — otherwise it faces away from every
      // light and draws black.
      this._placeLights(cam);
      r.setViewport(x, y, w, h);
      r.setScissor(x, y, w, h);
      this._faceCamera(cam);
      r.render(this.scene, cam);
    } finally {
      // The main view's visibility and lighting are borrowed state — a throw in render must not
      // leave the ghosts wearing the back view's culling, or the rig turned its way.
      this._placeLights();
      for (const g of hidden) g.visible = false;
      for (const g of flipped) g.visible = true;
    }
  }

  _parse(alg) {
    // Anchored grammar, whole-or-nothing: an alg with a malformed token is an invalid alg, and a
    // walk that silently skips the move it could not read draws WRONG states with full
    // confidence — worse than drawing nothing and saying why.
    const out = [];
    for (const tok of String(alg).trim().split(/\s+/).filter(Boolean)) {
      // What a token MEANS — which axis, which layers, which way and how far — belongs to the pose
      // module, which is where the cube's move tables already are. Spelling that arithmetic here
      // as well left two definitions of one thing, free to drift apart (found by audit,
      // 2026-09-14). Copied rather than shared, because a caller may negate the angle of what it
      // gets back (see stepBack) and the descriptors are frozen.
      // hasOwn as well as a table with no prototype: either alone is one refactor from the
      // `alg="toString"` crash, and a parser is where an author's arbitrary text first arrives.
      // The notation module reads every spelling a tutorial writes — face turns, outer blocks, slices,
      // rotations — in the identity frame, and refuses the rest with a reason
      // (dev-docs/adr/0004-orientation-notation-and-colour-are-three-things.md, decision 4).
      const { move, why } = readToken(tok);
      if (!move) {
        console.warn(`<cubus-cube> refusing alg — invalid move token "${tok}" (${why})`);
        return [];
      }
      out.push({ axis: move.axis, layers: [...move.layers], angle: move.angle, turns: move.turns });
    }
    return out;
  }

  /** The facelets attribute, normalized — or null when absent or invalid. 54 characters of
   *  URFDLB, or '?' for a sticker the scanner could not read, are the only states this renderer
   *  can draw; anything else is refused LOUDLY rather than silently painted as a solved cube
   *  wearing the wrong label. */
  _facelets() {
    const fl = (this._attrs.facelets || '').replace(/\s+/g, '');
    if (!fl) return null;
    if (/^[URFDLB?]{54}$/.test(fl)) return fl;
    console.warn('<cubus-cube> ignoring invalid facelets attribute', this._attrs.facelets);
    return null;
  }

  _paint(fl = this._facelets()) {
    if (!this.stickers) return;
    const pal = paletteFor(this._attrs.palette, this._attrs.scheme);
    // The colour letter a sticker carries under `fl`, or null for one the scanner could not read.
    // Factored out because _stampPieces needs the same answer, and asking the facelet string twice
    // in two spellings is how the two come to disagree.
    const letterOf = (m) => {
      if (!fl) return m.userData.face;
      const [x, y, z] = m.userData.home;
      const ch = fl[FACELET_INDEX[m.userData.face](x, y, z)];
      return ch === '?' ? null : ch;
    };
    // Stickers and ghosts carry the same userData and take the same colour — one loop.
    for (const m of [...this.stickers, ...this._ghostMeshes]) {
      const letter = letterOf(m);
      m.material.color.set(letter === null ? UNKNOWN_STICKER : pal[letter]);
    }
    this._stampPieces(letterOf);
    this._applyFocus();
    this._ghostPlace();
    this._applyScale();
    // Which cubies a selector names depends on what the cube now holds, so the set is re-resolved
    // here rather than cached from whenever the attribute was last set.
    this._syncHighlight();
    this._dirty = true;
  }

  /**
   * Record which piece each cubie carries, while the cube is still at home.
   *
   * This is the ONE moment the answer is readable: reset() paints BEFORE it applies `scramble`, so
   * at this instant a cubie's letters are exactly its facelet letters. Afterwards the cubie moves
   * — `_writePose` puts it where the state says — and the stamp stays on it, because the group is
   * the cubie and nothing re-parents it. That is what makes `piece:UF` mean "the UF piece, wherever
   * it went" rather than "whatever is in the UF slot", which is a different sentence and the one a
   * scrambled cube gets wrong.
   */
  _stampPieces(letterOf) {
    const carried = new Map();
    for (const m of this.stickers) {
      if (carried.get(m.parent) === null) continue; // already unreadable; one bad sticker is enough
      const letter = letterOf(m);
      carried.set(m.parent, letter === null ? null : (carried.get(m.parent) || '') + letter);
    }
    // pieceKey refuses letters that name no real cubie, so a facelet string claiming two U stickers
    // on one piece reads as unknown rather than as whichever piece it happens to resemble.
    for (const [c, letters] of carried) c.userData.piece = letters === null ? null : pieceKey(letters);
  }

  /** Which pieces still matter. Same grammar as `highlight`, opposite job: highlight says "look at
   *  this one", focus says "none of the others exist". For a whole stage the second is far stronger
   *  — you cannot glow four pieces and expect the eye to ignore twenty-two.
   *
   *  Safe to do per-sticker ONLY because every sticker gets its own material at build time
   *  (`new THREE.MeshStandardMaterial` inside the cubie loop). bodyMat is shared across all 26
   *  cubies and must never be touched this way; the same trap caught the highlight channel once. */
  _readFocus() {
    const { selectors, invalid } = parseHighlight(this._attrs.focus);
    if (invalid !== null) console.warn(`<cubus-cube> refusing focus — invalid selector "${invalid}"`);
    this._fcSels = selectors;
    this._rebindFocus();
  }

  /** Forget which pieces the focus named, so the next paint reads its selectors again. */
  _rebindFocus() { this._fcSet = null; }

  /**
   * What a selector reads off each cubie: the slot it is in and the piece it carries.
   *
   * ONE reading for `focus` and `highlight`. They share a grammar, so `slot:UR` must name the same
   * cubie for both; each used to build this list itself, and two copies of it are two chances to
   * disagree about which cubie that is.
   */
  _selectable() {
    // Where each cubie sits at the cube's last SETTLED position — the state before any turn still in
    // flight — never where the moving geometry happens to be. A selector names SLOTS, and this used
    // to round the animated position to the "nearer" one. There is no nearer one: halfway through R
    // the UR edge is at (1, 0.707, 0.707), which rounds to (1, 1, 1), a CORNER's coordinates, so
    // `slot:UR` lit the URF corner (found by review, 2026-09-15; requirement R8 of
    // dev-docs/adr/0004-orientation-notation-and-colour-are-three-things.md). The settled state is
    // also what the rounding answered for the first half of every turn, so this changes only the
    // half that was wrong. At rest the two readings are identical.
    const settled = poseAll(UPRIGHT, this._state);
    return this.cubies.map((c, i) => {
      const { pos, m } = settled[POSE_OF[i]];
      // Each sticker as a selector reads one: the face it was painted for, and the way it faces at the
      // settled position — its home normal turned by its cubie's settled rotation.
      const meshes = c.children.filter((x) => x.userData?.face && !x.userData.n);
      const stickers = meshes.map((x) => {
        const n = FACES.find((f) => f.key === x.userData.face).n;
        const dir = [0, 1, 2].map((r) => m[r][0] * n[0] + m[r][1] * n[1] + m[r][2] * n[2]);
        return { face: x.userData.face, dir: faceOfVector(dir), mesh: x };
      });
      return { pos, piece: c.userData.piece ?? null, stickers };
    });
  }

  /** The sticker meshes selectors name, each with its ghost twin — what a channel lights or keeps. */
  _stickersNamed(selectors) {
    const cubies = this._selectable();
    const { stickers, empty } = resolveStickers(selectors, cubies);
    const meshes = new Set();
    for (const [i, j] of stickers) {
      const mesh = cubies[i].stickers[j].mesh;
      meshes.add(mesh);
      const twin = this._ghostTwin.get(mesh);
      if (twin) meshes.add(twin);
    }
    return { meshes, empty };
  }

  /** Grey every sticker and ghost NOT named by `focus`. Called from _paint(), after the colour
   *  loop has written each sticker's true colour — so this is always applied to fresh colours and
   *  never compounds on itself. */
  _applyFocus() {
    const sels = this._fcSels || [];
    if (!sels.length) return;
    // BOUND ONCE, WHERE IT WAS WRITTEN. Focus latches (ADR 0004 decision 10): `slot:UR` names the piece
    // that was in UR when the cue was given, and keeps naming it through the turns that follow. Resolving
    // on every paint quietly broke that for `seek`, which resets and repaints — so a lesson that says
    // "watch this piece" and is then scrubbed lit a different piece at every position (R10). The binding
    // is dropped by a new `focus` and by a new cube, and by nothing else.
    // Bound to STICKERS, so a focus on one sticker greys the rest of its own piece too (plan item 4.1).
    this._fcSet ??= this._stickersNamed(sels).meshes;
    const keep = this._fcSet;
    for (const c of this.cubies) {
      for (const m of c.children) {
        if (!m.userData?.face || keep.has(m)) continue;   // never the shared body material
        const col = m.material.color;
        const lum = 0.299 * col.r + 0.587 * col.g + 0.114 * col.b;
        const g = lum * (1 - FOCUS_FLATTEN) + FOCUS_MID * FOCUS_FLATTEN;
        col.setRGB(g, g, g);
      }
    }
  }

  /** Re-read the highlight attribute into selectors, naming a bad token rather than dropping it. */
  _readHighlight() {
    const { selectors, invalid } = parseHighlight(this._attrs.highlight);
    if (invalid !== null) console.warn(`<cubus-cube> refusing highlight — invalid selector "${invalid}"`);
    this._hlSels = selectors;
    // Start at the top of the breath, so a highlight is visible the instant it is set rather than
    // fading in from nothing over half a period.
    this._hlT0 = this._now() - HL_PERIOD / 2;
  }

  /** Where in the breath we are, 0..1. One expression, so the tick and the first paint agree. */
  _hlPhase() {
    if (reducedMotion()) return 1;
    return 0.5 - 0.5 * Math.cos(((this._now() - this._hlT0) / HL_PERIOD) * 2 * Math.PI);
  }

  /** Re-resolve the highlight against the cube as it stands now, and paint one frame of it. */
  _syncHighlight() {
    if (!this.stickers) return;
    this._clearHighlight();
    const sels = this._hlSels || [];
    // _dirty even on the empty path: _clearHighlight() above just reset 108 materials, and on a
    // stationary cube nothing else will ask for a redraw — so the glow this call removed would
    // stay on screen until the user happened to orbit.
    if (!sels.length) { this._hlSet = null; this._hlK = null; this._dirty = true; return; }
    const { meshes, empty } = this._stickersNamed(sels);
    if (empty.length) {
      console.warn(`<cubus-cube> highlight matched nothing for ${empty.join(', ')} — this cube has no known identity for it (unread stickers?)`);
    }
    // STICKERS and their ghost twins, not cubies: a highlight can name one sticker of a piece (plan item
    // 4.1). A whole-piece selector names every sticker of it, which is what lighting a cubie always meant.
    this._hlSet = meshes;
    this._hlK = this._hlPhase();
    this._applyHighlight(this._hlK);
    this._dirty = true;
  }

  /** Return every sticker and ghost to its resting look.
   *
   *  All 54 of each, not just the previous set: clearing by bookkeeping leaves a stale glow on a
   *  piece that dropped out of the selection, and nothing else ever repaints emissive — so the
   *  wrong piece would keep pointing at itself for the rest of the lesson. 108 assignments on a
   *  move boundary is not a cost worth being clever about. */
  _clearHighlight() {
    for (const m of this.stickers) m.material.emissiveIntensity = 0;
    for (const g of this._ghostMeshes) g.material.opacity = GHOST_OPACITY;
  }

  /**
   * Paint the pulse at `k` in 0..1.
   *
   * Emissive rather than colour: on a cube the sticker colour IS the thing being taught, so a
   * highlight that changes it is lying about the puzzle. Lighting a sticker with its OWN colour
   * reads as "this one" and a white centre stays white.
   *
   * It lives on the cubie's materials, not on an overlay mesh, and that is what makes it survive a
   * turn: the cubie is what moves, so anything positioned in world space would tear loose the
   * moment the layer rotated.
   */
  _applyHighlight(k) {
    if (!this._hlSet?.size) return;
    // The set holds sticker meshes and their ghost twins only — never a body, whose material is ONE shared
    // by all 26 cubies, so lighting it would light the entire cube instead of what was named.
    for (const m of this._hlSet) {
      if (m.userData?.n) {
        // A ghost. MeshBasicMaterial is unlit and has no emissive at all, so it breathes in
        // opacity. Its outline is a CHILD carrying a material shared by all 54 ghosts and is
        // deliberately left alone — a steady frame around a breathing fill is the better read,
        // and touching it would light every ghost on the cube at once.
        m.material.opacity = GHOST_OPACITY + k * (GHOST_HL_PEAK - GHOST_OPACITY);
      } else if (m.userData?.face) {
        m.material.emissive.copy(m.material.color);
        m.material.emissiveIntensity = k * HL_PEAK;
      }
    }
  }

  // Elevation is how far the twin floats past its sticker, in cubie units.
  // Matches the codebase player's experimentalHintFaceletsElevation (default 4).
  _ghostPlace() {
    if (!this._ghostMeshes) return;
    const e = Number(this._attrs['ghost-elevation']);
    const d = 0.48 + (Number.isFinite(e) ? e : 4) * 0.42;
    for (const g of this._ghostMeshes) {
      const n = g.userData.n;
      g.position.set(n[0] * d, n[1] * d, n[2] * d);
    }
    this._dirty = true;
  }

  _ghostVisible() {
    if (!this._ghostMeshes) return;
    const on = this._ghostsEnabled();
    for (const g of this._ghostMeshes) g.visible = on; // _cullGhosts refines this per frame
    this._dirty = true;
  }

  /** Completion bookkeeping for one move — shared by the animated path and the instant drain,
   *  so the two can never diverge on what "a move happened" means. A move queued by stepBack()
   *  carries delta -1: it undoes a solution move, so the step index counts down; anything else
   *  counts up. Host apps sync a move list / 2D net / scrubber to the event. */
  _completeMove(a) {
    // The state moves; the geometry follows from it. `after()` hands back the frame too: a rotation,
    // a slice or a wide move turns the whole cube, and the frame is where that turn is kept — the
    // pieces are always relative to the centres, so they cannot carry it.
    const landed = after(this._seq ?? UPRIGHT, this._state, a.m);
    this._state = landed.state;
    this._seq = landed.frame;
    this._writePose();
    // Positions have just changed, so a positional selector (`layer:`, `slot:`) now names a
    // different set. Re-resolved here rather than only on repaint, because a move repaints nothing.
    this._syncHighlight();
    this._anim = null;
    this._applied += a.m.delta ?? 1;
    if (this._attrs.arrow === 'next') this._placeArrow(); else this._placeArrowFrame();
    this._report();
    this._dirty = true;
    // After the report, so a host that reads the element inside the event sees the position that just
    // landed rather than the next token already queued behind it.
    this._advanceGroup();
  }

  /** Say where the cube now is: the token position, and the stop it belongs to (ADR 0004 decision 9). */
  _report() {
    this.dispatchEvent(new CustomEvent('cubus-step', {
      detail: { index: this._applied, total: this._sol.length, stop: this._stopAt(this._applied), stops: this._stops.length - 1 },
    }));
  }

  /**
   * Put every cubie where the cube's STATE says it is — the one place geometry is written.
   *
   * What this replaces: `_grab` re-parented a layer's cubies into a temporary group, `_tick`
   * rotated that group, and `_bake` multiplied the result back into each cubie and rounded its
   * position to the nearest integer. So where a cubie sat was the accumulated residue of every
   * turn it had been in, and the rounding was there because that residue drifts. A pose derived
   * from the state cannot drift, needs no rounding, and makes seeking to a move and playing into
   * it the same picture by construction rather than by care (lib pose.js, A1 of the plan).
   */
  _writePose(move = null, phase = 0) {
    const poses = poseAll(this._seq ?? UPRIGHT, this._state, move, phase);
    for (let i = 0; i < this.cubies.length; i++) {
      const { pos, m } = poses[POSE_OF[i]];
      const c = this.cubies[i];
      c.position.set(pos[0], pos[1], pos[2]);
      // Row-major, which is the order Matrix4.set() reads and the order pose.js writes.
      this._m4 ||= new THREE.Matrix4();
      setBasis(this._m4, m);
      c.quaternion.setFromRotationMatrix(this._m4);
    }
  }

  _next() {
    if (this._anim) return;
    let m = this._queue.shift();
    // While playing, pull the next solution move so pause() can stop cleanly between moves.
    if (!m && this._playing && this._cursor < this._sol.length) m = this._sol[this._cursor++];
    if (!m) { this._playing = false; return; }
    // The floor is a guard, not a speed policy: at tempo <= 0 the duration is Infinity (or
    // negative) and the turn never completes, freezing the cube mid-move. It used to sit at 0.25,
    // which silently doubled as the slowest speed anyone could ask for — 760ms per quarter turn,
    // and a smaller tempo-scale was clamped away with nothing said. 0.05 is 3.8s per quarter turn.
    const tempo = Math.max(0.05, this._num('tempo-scale', 1));
    // Reduced motion SHORTENS the turn; it does not remove it. Everything else the app animates is
    // decoration whose job something else also does, so the stylesheet simply stops it — but a
    // solve guide with no turn is a slideshow of positions, and the turn is the thing being
    // taught. 120ms per quarter is quick enough not to be a sweep and long enough to see which
    // layer moved; at the Slow setting this is a 32x cut, which is the point.
    const reduced = reducedMotion();
    const dur = (190 / tempo) * m.turns;
    this._anim = { m, t0: this._now(), dur: reduced ? Math.min(dur, 120 * m.turns) : dur };
  }

  reset() {
    // Nothing to unpick from the scene: a move in flight is a descriptor and a start time, so
    // dropping it is enough. It used to be a group of re-parented meshes, and a reset mid-turn
    // left the empty carrier in the scene forever.
    this._queue = []; this._anim = null; this._cursor = 0; this._playing = false; this._applied = 0;
    this._group = null;
    this._era = (this._era ?? 0) + 1;
    this._state = SOLVED_STATE;
    // Position 0's frame is the identity: the hold at position 0 is `orientation`, on the root, and a
    // whole-cube turn inside the sequence composes onto this frame as it is made. A scramble describes
    // PIECES only — its moves' frame changes are dropped below — so the cube a scramble loads is held
    // however `orientation` says (dev-docs/adr/0004-orientation-notation-and-colour-are-three-things.md,
    // decisions 7 and 8).
    this._seq = UPRIGHT;
    // Resolved ONCE for both jobs — painting and the scramble decision — so an invalid string
    // warns once, not twice. A VALID facelet string already encodes the scramble; only apply
    // moves when there isn't one, and an invalid string does not count.
    const fl = this._facelets();
    // THE WHOLE OF POSITION 0 BEFORE THE FIRST PAINT — the scramble included. `_paint()` resolves an
    // unbound `focus` as it goes, and a positional selector answers for whatever is in the slot AT THAT
    // MOMENT, so the cube it sees has to be the cube that will be drawn. Painting before the cubies were
    // put back left focus naming the piece the previous cube had there (audit, 2026-09-14: set
    // `focus="slot:UR"`, turn R, reset, and the FR piece stayed coloured); painting before the SCRAMBLE
    // was applied left it naming the piece that STARTS in the slot rather than the one the scramble put
    // there — `scramble="R" focus="slot:UR"` lit the piece at UR of a solved cube (Codex audit,
    // 2026-09-16). One paint, over a settled position 0, answers both.
    //
    // Not by re-binding after the scramble instead: `seek()` resets, and a bound focus is a PIECE that
    // must keep naming the same pieces through a seek (ADR 0004 decision 10 and R10). Throwing the
    // binding away here would re-read the selector at every scrub.
    if (!fl) for (const m of this._parse(this._attrs.scramble || '')) this._state = after(UPRIGHT, this._state, m).state;
    this._writePose();
    this._paint(fl);
    // Position 0, kept: a trail is drawn over the whole sequence from here, wherever the cursor is.
    this._base = this._state;
    this._refitIfTurned();
    this._placeArrow();
    this._placeTrails();
    // AFTER the scramble, not only inside _paint(). _paint() resolves the highlight while every
    // cubie is still at home, and the loop above then moves them — so a positional selector set
    // before reset() named the pre-scramble occupant of the slot. Unconditional rather than tucked
    // inside the `if`: the invariant is "when reset() returns, the highlight matches the final
    // positions", and stating it here survives someone adding a second transform later.
    this._syncHighlight();
    this._dirty = true;
    if (!this._quiet) this._report();
  }

  /**
   * The colour each face is drawn in: `{ U, R, F, D, L, B }` as `#rrggbb`, the colour of that face's centre
   * under the palette and colour scheme in force — or null before the cube is built.
   *
   * THE PUBLIC ANSWER to a question consumers were answering by walking the scene (plan item 5.1): cubus-im's
   * drill swatches and lesson companion find the centre cubies and read their first sticker's material colour,
   * so a swatch matches the cube under either scheme without the page being told which. That walk breaks on
   * any rename of `userData.face`, and reads grey under a focus. This gives the same six colours — through the
   * same colour round trip the materials make, so the two agree to the hex — from the palette and the centres'
   * letters, and a focus does not change it: a swatch is the colour, not the treatment. A centre a picture has
   * not read is the unknown sticker's colour, as it is drawn.
   */
  drawnColours() {
    if (!this.stickers) return null;
    const pal = paletteFor(this._attrs.palette, this._attrs.scheme);
    const fl = this._facelets();
    const out = {};
    for (const f of FACES) {
      const letter = fl ? fl[FACELET_INDEX[f.key](f.n[0], f.n[1], f.n[2])] : f.key;
      const hex = letter === '?' ? UNKNOWN_STICKER : pal[letter];
      out[f.key] = `#${(this._colour ||= new THREE.Color()).set(hex).getHexString()}`;
    }
    return Object.freeze(out);
  }

  play() { this._playing = true; this._next(); }
  // The in-flight quarter turn finishes, then it stops — BOTH transports. Clearing only `_playing` left a
  // stop group advancing through `_advanceGroup`, so pausing a grouped walk paused nothing (audit,
  // 2026-09-16). Whatever is mid-turn still lands: a cube left between two layers is not a paused cube.
  pause() { this._playing = false; this._group = null; }
  step() { if (this._cursor < this._sol.length) { this._queue.push(this._sol[this._cursor++]); this._next(); } }
  // Animated undo — the same turn played backwards. seek() also moves back a step but jumps there
  // instantly; this is for showing someone what the last move actually was.
  stepBack() {
    if (this._cursor <= 0) return;
    const m = this._sol[--this._cursor];
    this._queue.push({ ...m, angle: -m.angle, delta: -1 });
    this._next();
  }
  /**
   * Play forward to the next stop — the transport a walk a child follows is driven by.
   *
   * ONE TOKEN AT A TIME. Queueing a group's tokens together hands them to `_drainBacklog`, whose rule is
   * that more than two pending animations means the oldest completes at once — so `x y R` pressed as one
   * step would have snapped the regrip the child is being asked to make (ADR 0004 R4). Each token is
   * queued as the one before it completes, so nothing is ever more than one deep.
   *
   * A stop command arriving mid-group SETTLES that group first: the child asked for the next stop, so the
   * turns still in flight land at once and the new group animates, rather than the press being dropped or
   * queued behind an animation nobody is watching any more.
   */
  /**
   * Settle whatever is in flight, check the press still means something, then walk to the token `pick`
   * names — the whole body of every stop command.
   *
   * ONE COPY, because the three of them are one procedure with one line different, and each was keeping
   * its own copy of the lifecycle rules (audit, 2026-09-16). `_settleGroup` reports every token it lands,
   * and a host may dispose this element, write a new `alg`, `reset()` or `seek()` from inside one — so the
   * press that started before all that is about a cube that is gone, a walk that is no longer the one being
   * played, or a position the cube has already left. `pick` runs AFTER the settle, because the cursor it
   * reads from is what the settle just moved.
   */
  _walkTo(pick) {
    const sol = this._sol; const era = this._era;
    this._settleGroup();
    if (!this.stickers || this._sol !== sol || this._era !== era) return;
    // A BOUNDED WALK SUPERSEDES CONTINUOUS PLAY — and it supersedes it BEFORE the target is examined. `play()`
    // advances the cursor as each move STARTS, so `play(); playTo(1)` asks for the token already in flight;
    // clearing this after the "already there" return meant the one case where the answer is "you are there"
    // was also the one case where continuous play survived, and the cube ran to the end (audit, 2026-09-16 —
    // and the first fix for it had exactly this ordering bug, caught by its own test).
    this._playing = false;
    const to = pick();
    if (to === undefined || to === this._cursor) return;
    this._group = { to, delta: to > this._cursor ? 1 : -1 };
    if (to > this._cursor) this.step(); else this.stepBack();
  }

  stepStop() {
    this._walkTo(() => this._stops.find((p) => p > this._cursor));
  }

  /**
   * Play to token `k`, one token at a time, the way a stop group plays.
   *
   * WHY A HOST NEEDS THIS. `stepStop` goes to the element's OWN next stop, and the element groups a
   * sequence its own way: a regrip belongs to the turn it leads into, so `x y R` is one group. A script
   * gives every STEP a position, and a step that only regrips therefore ends INSIDE one of those groups —
   * a place the transport could reach only by `seek`, which snaps. That is the one turn D4's "turn the
   * whole cube so the gap is in front of you" exists to show (Codex audit and the verify pass over the
   * first fix, 2026-09-16; plan item 6.5 names the same gap from the screens' side).
   *
   * One token at a time, fed from each completion — never queued in a batch, which the backlog rule would
   * snap. Out-of-range asks are clamped rather than refused: `k` comes from a host's own model of the
   * sequence, and the worst answer to a disagreement about its length is a cube left part way.
   */
  playTo(k) {
    this._walkTo(() => {
      const to = Math.max(0, Math.min(Math.round(Number(k)), this._sol.length));
      return Number.isFinite(to) ? to : undefined;
    });
  }

  /** Undo back to the previous stop — the whole group, one token at a time, the same way round. */
  stepBackStop() {
    this._walkTo(() => [...this._stops].reverse().find((p) => p < this._cursor));
  }

  /** Land a group in flight where it was going, at once: the in-flight turn, the queue, then the rest. */
  _settleGroup() {
    const g = this._group;
    if (!g) return;
    // Cleared FIRST: `_completeMove` advances the group, and a settle is the one path that must not.
    this._group = null;
    // EVERY COMPLETION IS A HOST EVENT. `_completeMove` reports a step synchronously, and a listener may
    // dispose this element or write a new `alg` from inside that report — after which every later token of
    // the group is about a cube that is gone, or one that is no longer walking this sequence (Codex audit,
    // 2026-09-16: two `stepStop()` presses with a listener that disposes on the first).
    const sol = this._sol; const era = this._era;
    // The ERA as well as the sequence. A listener that `seek()`s or `reset()`s changes neither the element
    // nor `_sol`, so this said the walk was still fine while the cursor had jumped somewhere else — and the
    // loop below, which stops when the cursor REACHES `g.to`, then ran past it and off the end of the
    // solution: `_sol[4]` of a four-token walk is undefined, and `_completeMove` crashed reading its delta
    // (audit, 2026-09-16, reproduced on `alg="x y R U"`). Same root as the transport methods' own check.
    const walking = () => Boolean(this.stickers) && this._sol === sol && this._era === era;
    if (this._anim) this._completeMove(this._anim);
    while (walking() && this._queue.length) this._completeMove({ m: this._queue.shift() });
    while (walking() && this._cursor !== g.to) {
      if (g.delta > 0) this._completeMove({ m: this._sol[this._cursor++] });
      else { const m = this._sol[--this._cursor]; this._completeMove({ m: { ...m, angle: -m.angle, delta: -1 } }); }
    }
  }

  /** The next token of the group in flight, queued now that the one before it has landed. */
  _advanceGroup() {
    const g = this._group;
    if (!g) return;
    if (this._cursor === g.to) { this._group = null; return; }
    if (g.delta > 0) this.step(); else this.stepBack();
  }

  /** Which stop a token position is at, or the one behind it while a group is part way through. */
  _stopAt(position) {
    let k = 0;
    for (let i = 0; i < this._stops.length; i++) if (this._stops[i] <= position) k = i;
    return k;
  }

  // Instant seek to solution move k, no animation. The app walks the solution with step()/
  // stepBack() and no longer calls this; it stays as renderer API for jumping to a position
  // (a scrubber, a deep link into a solve) where animating every move in between is wrong.
  seek(k) {
    // A non-finite k made target NaN, which then became _cursor and _applied — and from there
    // step() read _sol[NaN] and the transport quietly stopped responding, with nothing thrown.
    const n = Number(k);
    const target = Number.isFinite(n) ? Math.max(0, Math.min(Math.round(n), this._sol.length)) : 0;
    // reset() announces index 0. Without suppressing it, every seek emitted TWO cubus-step events
    // — 0 then the target — so hosts saw the step counter and progress bar snap to zero and back
    // on each jump.
    this._quiet = true;
    try { this.reset(); } finally { this._quiet = false; }
    for (let i = 0; i < target; i++) {
      const landed = after(this._seq, this._state, this._sol[i]);
      this._state = landed.state;
      this._seq = landed.frame;
    }
    this._writePose();
    // Same reason as reset(): the moves above land after reset() painted, so a highlight set
    // before the seek would still be pointing at wherever those pieces used to be.
    this._syncHighlight();
    this._cursor = target; this._applied = target;
    this._placeArrow();
    this._dirty = true;
    this._report();
  }
}
for (const name of Object.keys(REACTIONS)) {
  if (!CubusCube.observedAttributes.includes(name)) throw new Error(`<cubus-cube> reacts to "${name}", which it does not observe`);
}
customElements.define('cubus-cube', CubusCube);
