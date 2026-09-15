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
import { parseHighlight, pieceKey, resolveHighlight, slotVector } from '../../../apps/web/lib/cube-highlight.js';
import { STICKER_PALETTES } from '../../../apps/web/lib/sticker-palettes.js';
import { HOME, MOVE_DESCRIPTORS, after, poseAll } from './pose.js';

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
  facelets: (el) => el.reset(),
  scramble: (el) => el.reset(),
  alg: (el) => el._replaceAlg(),
  highlight: (el) => { el._readHighlight(); el._syncHighlight(); },
  // focus repaints rather than syncing: it changes sticker COLOUR, which only _paint() writes.
  focus: (el) => { el._readFocus(); el._paint(); },
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
  ];

  static ALIAS = {
    ghostelevation: 'ghost-elevation',
    cameralatitude: 'camera-latitude',
    cameralongitude: 'camera-longitude',
    camerafit: 'camera-fit',
    cameraup: 'camera-up',
    faceletscale: 'facelet-scale',
    temposcale: 'tempo-scale',
    backview: 'back-view',
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
    // NOT part of `alg`, ever. If `alg` took `y`, an `R` after it would mean the new right or the
    // old right, and a letter that sometimes names a fixed face and sometimes a moving one is the
    // exact defect the fixed frame exists to prevent.
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
    this._writePose();
    this._sol = this._parse(this._attrs.alg || '');
    this._cursor = 0; this._applied = 0; this._playing = false;
    this._dirty = true;
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

  /** The 26 cubies, each with its body, its stickers and a ghost per sticker, under `root`. */
  _buildCubies(scene) {
    const root = this.root = new THREE.Group();
    scene.add(root);

    const bodyGeo = new RoundedBoxGeometry(0.94, 0.94, 0.94, 4, 0.1);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1a1712, roughness: 0.62, metalness: 0.04 });
    const stickerGeo = new RoundedBoxGeometry(0.78, 0.78, 0.06, 3, 0.07);
    // Ghosts are flat planes, not boxes — they read as projections rather than solid tiles.
    const ghostGeo = new THREE.PlaneGeometry(0.78, 0.78);
    // A hairline around each ghost, for the reason the scan grid has one: a white ghost at 45%
    // opacity over a pale background has no edge, so it reads as a gap rather than as a sticker.
    // The solid stickers need no such line — they sit inset on the near-black body, which draws
    // their boundary for them. Geometry and material are shared across all 54, and the outline is
    // a CHILD of its ghost, so it inherits that ghost's transform, scale and visibility and needs
    // no bookkeeping of its own in _cullGhosts or the flip path.
    const ghostEdgeGeo = new THREE.EdgesGeometry(ghostGeo);
    const ghostEdgeMat = new THREE.LineBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false,
    });

    this.cubies = [];
    this.stickers = [];
    this._ghostMeshes = [];
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
      if (!x && !y && !z) continue;
      const c = new THREE.Group();
      c.position.set(x, y, z);
      c.add(new THREE.Mesh(bodyGeo, bodyMat));
      for (const f of FACES) {
        const n = f.n;
        if ((n[0] && n[0] === x) || (n[1] && n[1] === y) || (n[2] && n[2] === z)) {
          const m = new THREE.Mesh(stickerGeo, new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0 }));
          m.position.set(n[0] * 0.48, n[1] * 0.48, n[2] * 0.48);
          if (n[0]) m.rotation.y = Math.PI / 2;
          else if (n[1]) m.rotation.x = Math.PI / 2;
          m.userData = { face: f.key, home: [x, y, z] };
          c.add(m);
          this.stickers.push(m);

          // One floating twin per sticker, offset along the same normal. Unlit and
          // depth-write-free so overlapping ghosts stay legible from any angle.
          const g = new THREE.Mesh(ghostGeo, new THREE.MeshBasicMaterial({
            transparent: true, opacity: GHOST_OPACITY, depthWrite: false, side: THREE.DoubleSide,
          }));
          g.rotation.copy(m.rotation); // carries the X-face quarter turn set on the sticker above
          g.userData = { face: f.key, home: [x, y, z], n };
          g.renderOrder = 1;
          const gEdge = new THREE.LineSegments(ghostEdgeGeo, ghostEdgeMat);
          gEdge.renderOrder = 2; // above its own ghost, so the line is never eaten by the fill
          g.add(gEdge);
          c.add(g);
          this._ghostMeshes.push(g);
        }
      }
      root.add(c);
      this.cubies.push(c);
    }
  }

  /** The walk's starting state, with every attribute read in: `_set()` skips an unbuilt cube. */
  _initWalk() {
    this._anim = null;
    this._queue = [];
    this._cursor = 0;
    this._playing = false; // play() intent — lets pause() stop cleanly between moves
    this._applied = 0; // solution moves animated since the last reset (drives 'cubus-step')
    this._sol = this._parse(this._attrs.alg || '');
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
    this.reset();
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
    const owned = new Set();
    this.scene?.traverse((o) => {
      if (o.geometry) owned.add(o.geometry);
      for (const m of [o.material].flat()) if (m) owned.add(m);
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
    const basis = new THREE.Matrix4().set(
      m[0][0], m[0][1], m[0][2], 0,
      m[1][0], m[1][1], m[1][2], 0,
      m[2][0], m[2][1], m[2][2], 0,
      0, 0, 0, 1,
    );
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
    const turned = this._turned();
    if (turned !== this._fitTurned) {
      this._fitTurned = turned;
      this._applyCamera();
    }
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
    const { from, to, phase } = this._turn;
    if (from === to || phase >= 1) return to !== 'U F';
    if (phase <= 0) return from !== 'U F';
    return true;
  }

  _applyOrbit() {
    if (!this.controls) return;
    const free = this._attrs.orbit !== 'locked';
    this.controls.enableRotate = free;
    this.controls.enableZoom = free;
  }

  _applyCamera() {
    if (!this.camera) return;
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
    const geom = { points, vfovDeg: this.camera.fov, aspect: this._drawAspect(), eye, worldUp };
    const d = stable ? fitDistanceStable(geom) : fitDistance(geom);
    // The controls clamp the distance on every update(), so their limits follow the fit: a user
    // may zoom in to look closer, never out past the frame — and a resize puts the fit back.
    if (this.controls) { this.controls.minDistance = d * 0.5; this.controls.maxDistance = d; }
    this.camera.up.set(worldUp[0], worldUp[1], worldUp[2]);
    this.camera.position.set(d * eye[0], d * eye[1], d * eye[2]);
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
        r.render(this.scene, this.camera);
        this._renderOpposite(left, 0, right, h);
      } finally { r.setScissorTest(false); }
      return;
    }

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    r.setViewport(0, 0, w, h);
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
      const d = Object.hasOwn(MOVE_DESCRIPTORS, tok) ? MOVE_DESCRIPTORS[tok] : null;
      if (!d) {
        console.warn(`<cubus-cube> refusing alg — invalid move token "${tok}"`);
        return [];
      }
      out.push({ ...d });
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
  }

  /**
   * What a selector reads off each cubie: the slot it is in and the piece it carries.
   *
   * ONE reading for `focus` and `highlight`. They share a grammar, so `slot:UR` must name the same
   * cubie for both; each used to build this list itself, and two copies of it are two chances to
   * disagree about which cubie that is.
   */
  _selectable() {
    return this.cubies.map((c) => ({
      // Rounded because a selector names SLOTS, and mid-turn a cubie is between two of them: it
      // answers for the one it is nearer rather than for a fractional position nobody can name. At
      // rest the rounding changes nothing — `_writePose` puts a settled cubie on exact integers.
      pos: [Math.round(c.position.x), Math.round(c.position.y), Math.round(c.position.z)],
      piece: c.userData.piece ?? null,
    }));
  }

  /** Grey every sticker and ghost NOT named by `focus`. Called from _paint(), after the colour
   *  loop has written each sticker's true colour — so this is always applied to fresh colours and
   *  never compounds on itself. */
  _applyFocus() {
    const sels = this._fcSels || [];
    if (!sels.length) return;
    const { indices } = resolveHighlight(sels, this._selectable());
    const keep = new Set(indices);
    for (const [i, c] of this.cubies.entries()) {
      if (keep.has(i)) continue;
      for (const m of c.children) {
        if (!m.userData?.face) continue;          // never the shared body material
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
    const { indices, empty } = resolveHighlight(sels, this._selectable());
    if (empty.length) {
      console.warn(`<cubus-cube> highlight matched nothing for ${empty.join(', ')} — this cube has no known identity for it (unread stickers?)`);
    }
    this._hlSet = new Set(indices.map((i) => this.cubies[i]));
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
    for (const c of this._hlSet) {
      for (const m of c.children) {
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
        // The rounded body is skipped on purpose: bodyMat is ONE material shared by all 26 cubies,
        // so lighting it here would light the entire cube instead of the piece being named.
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
    // The state moves; the geometry follows from it. `after()` hands back the frame too — nothing
    // this parser emits turns the whole cube, so it is the frame that came in, and taking it
    // rather than assuming it is what will make `x y z` work the day the parser can say one.
    const landed = after(UPRIGHT, this._state, a.m);
    this._state = landed.state;
    this._writePose();
    // Positions have just changed, so a positional selector (`layer:`, `slot:`) now names a
    // different set. Re-resolved here rather than only on repaint, because a move repaints nothing.
    this._syncHighlight();
    this._anim = null;
    this._applied += a.m.delta ?? 1;
    this.dispatchEvent(new CustomEvent('cubus-step', { detail: { index: this._applied, total: this._sol.length } }));
    this._dirty = true;
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
    const poses = poseAll(UPRIGHT, this._state, move, phase);
    for (let i = 0; i < this.cubies.length; i++) {
      const { pos, m } = poses[POSE_OF[i]];
      const c = this.cubies[i];
      c.position.set(pos[0], pos[1], pos[2]);
      // Row-major, which is the order Matrix4.set() reads and the order pose.js writes.
      this._m4 ||= new THREE.Matrix4();
      this._m4.set(m[0][0], m[0][1], m[0][2], 0, m[1][0], m[1][1], m[1][2], 0, m[2][0], m[2][1], m[2][2], 0, 0, 0, 0, 1);
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
    this._state = SOLVED_STATE;
    // Resolved ONCE for both jobs — painting and the scramble decision — so an invalid string
    // warns once, not twice. A VALID facelet string already encodes the scramble; only apply
    // moves when there isn't one, and an invalid string does not count.
    // HOME BEFORE PAINT. `_paint()` resolves `focus` as it goes, and a positional selector answers
    // for whatever is in the slot AT THAT MOMENT — so painting before the cubies are put back left
    // focus naming the piece the previous cube had there (found by audit, 2026-09-14: set
    // `focus="slot:UR"`, turn R, reset, and the FR piece stayed coloured). The version this
    // replaced moved every cubie home first for exactly this reason; writing the pose is how that
    // is said now.
    this._writePose();
    const fl = this._facelets();
    this._paint(fl);
    if (!fl) {
      for (const m of this._parse(this._attrs.scramble || '')) this._state = after(UPRIGHT, this._state, m).state;
    }
    this._writePose();
    // AFTER the scramble, not only inside _paint(). _paint() resolves the highlight while every
    // cubie is still at home, and the loop above then moves them — so a positional selector set
    // before reset() named the pre-scramble occupant of the slot. Unconditional rather than tucked
    // inside the `if`: the invariant is "when reset() returns, the highlight matches the final
    // positions", and stating it here survives someone adding a second transform later.
    this._syncHighlight();
    this._dirty = true;
    if (!this._quiet) {
      this.dispatchEvent(new CustomEvent('cubus-step', { detail: { index: 0, total: this._sol.length } }));
    }
  }

  play() { this._playing = true; this._next(); }
  pause() { this._playing = false; } // the in-flight quarter turn finishes, then it stops
  step() { if (this._cursor < this._sol.length) { this._queue.push(this._sol[this._cursor++]); this._next(); } }
  // Animated undo — the same turn played backwards. seek() also moves back a step but jumps there
  // instantly; this is for showing someone what the last move actually was.
  stepBack() {
    if (this._cursor <= 0) return;
    const m = this._sol[--this._cursor];
    this._queue.push({ ...m, angle: -m.angle, delta: -1 });
    this._next();
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
    for (let i = 0; i < target; i++) this._state = after(UPRIGHT, this._state, this._sol[i]).state;
    this._writePose();
    // Same reason as reset(): the moves above land after reset() painted, so a highlight set
    // before the seek would still be pointing at wherever those pieces used to be.
    this._syncHighlight();
    this._cursor = target; this._applied = target;
    this._dirty = true;
    this.dispatchEvent(new CustomEvent('cubus-step', { detail: { index: target, total: this._sol.length } }));
  }
}
for (const name of Object.keys(REACTIONS)) {
  if (!CubusCube.observedAttributes.includes(name)) throw new Error(`<cubus-cube> reacts to "${name}", which it does not observe`);
}
customElements.define('cubus-cube', CubusCube);
