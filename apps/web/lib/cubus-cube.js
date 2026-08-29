// <cubus-cube> — the cubus 3x3x3 renderer. Draws only: state and solving stay with
// cubejs / the two-phase search. Two ways in, both valid by construction:
//   facelets="…54 chars, URFDLB order…"   paint from a scanner/solver state
//   scramble="R U' F2 …"                  apply moves to a solved cube
// alg="R U R' U' …" is the animatable solution; play() / step() / reset() drive it.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { eyeDirection, fitDistance, silhouette } from './cube-frame.js';

const PALETTES = {
  muted:    { U:'#E8E3D6', D:'#D8B84A', F:'#4E8C6A', B:'#3C6E9E', R:'#B8503F', L:'#C87A3C' },
  classic:  { U:'#F4F2EC', D:'#F0C000', F:'#00A651', B:'#0051BA', R:'#C41E3A', L:'#FF6C00' },
  colorsafe:{ U:'#EFEAE0', D:'#E9C46A', F:'#6A9FB5', B:'#20405C', R:'#D1495B', L:'#8C5E8A' },
};
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

const FACES = [
  { key:'R', axis:'x', sign: 1, n:[ 1, 0, 0] },
  { key:'L', axis:'x', sign:-1, n:[-1, 0, 0] },
  { key:'U', axis:'y', sign: 1, n:[ 0, 1, 0] },
  { key:'D', axis:'y', sign:-1, n:[ 0,-1, 0] },
  { key:'F', axis:'z', sign: 1, n:[ 0, 0, 1] },
  { key:'B', axis:'z', sign:-1, n:[ 0, 0,-1] },
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
const AXES = { x: new THREE.Vector3(1,0,0), y: new THREE.Vector3(0,1,0), z: new THREE.Vector3(0,0,1) };

class CubusCube extends HTMLElement {
  // Kebab is canonical, but a host that writes camelCase props as attributes lands
// on the DOM-lowercased spelling, so both are observed and normalized in _set().
  static observedAttributes = [
    'facelets', 'scramble', 'alg', 'palette', 'autorotate',
    'ghosts', 'ghost-elevation', 'ghostelevation',
    'camera-latitude', 'cameralatitude',
    'camera-longitude', 'cameralongitude',
    'facelet-scale', 'faceletscale',
    'tempo-scale', 'temposcale',
    'back-view', 'backview',
    'orbit',
  ];

  static ALIAS = {
    ghostelevation: 'ghost-elevation',
    cameralatitude: 'camera-latitude',
    cameralongitude: 'camera-longitude',
    faceletscale: 'facelet-scale',
    temposcale: 'tempo-scale',
    backview: 'back-view',
  };

  set facelets(v) { this._set('facelets', v); }
  get facelets() { return this._attrs.facelets; }
  set scramble(v) { this._set('scramble', v); }
  set alg(v) { this._set('alg', v); }
  set palette(v) { this._set('palette', v); }
  set ghosts(v) { this._set('ghosts', v); }
  set ghostElevation(v) { this._set('ghost-elevation', v); }
  set cameraLatitude(v) { this._set('camera-latitude', v); }
  set cameraLongitude(v) { this._set('camera-longitude', v); }
  set faceletScale(v) { this._set('facelet-scale', v); }
  set tempoScale(v) { this._set('tempo-scale', v); }
  set backView(v) { this._set('back-view', v); }

  constructor() {
    super();
    // Defaults match the codebase player's control panel, except ghosts:
    // those are opt-in here because they crowd a small embedded cube.
    this._attrs = { ...CubusCube.DEFAULTS };
  }
  /** Attribute defaults. Also what a REMOVED attribute falls back to — see _set(). */
  static DEFAULTS = {
    palette: 'muted', ghosts: 'none', 'ghost-elevation': '4',
    // No camera distance: it is computed from what the view draws and the slot it draws into
    // (lib/cube-frame.js), so nothing is clipped at any slot shape.
    'camera-latitude': '35', 'camera-longitude': '45',
    'facelet-scale': '0.9', 'tempo-scale': '1', 'back-view': 'none',
    orbit: 'free', // 'locked' = dragging does not turn the view; the host decides
  };

  attributeChangedCallback(name, _old, val) { this._set(name, val); }
  _set(name, val) {
    name = CubusCube.ALIAS[String(name).toLowerCase()] || name;
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
    if (!this._ghostMeshes) return;
    if (name === 'palette') this._paint();
    else if (name === 'ghosts') { this._ghostVisible(); this._paint(); this._applyCamera(); }
    else if (name === 'ghost-elevation') { this._ghostPlace(); this._applyCamera(); }
    else if (name === 'facelet-scale') { this._applyScale(); this._applyCamera(); } // the scale is part of the silhouette
    else if (name === 'camera-latitude' || name === 'camera-longitude') this._applyCamera();
    else if (name === 'back-view') this._dirty = true;
    else if (name === 'orbit') this._applyOrbit();
    else if (name === 'facelets' || name === 'scramble') this.reset();
    else if (name === 'alg') { this._sol = this._parse(this._attrs.alg || ''); this._cursor = 0; this._applied = 0; this._playing = false; }
  }

  connectedCallback() {
    if (this.scene) return;
    this.style.cssText = 'display:block;width:100%;height:100%;' + (this.style.cssText || '');

    const scene = this.scene = new THREE.Scene();
    const camera = this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);

    const renderer = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping; // exact palette fidelity
    renderer.domElement.style.cssText = 'width:100%;height:100%;display:block';
    this.appendChild(renderer.domElement);

    const controls = this.controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    // Distance limits are set by _applyCamera from the fitted distance: a fixed maxDistance of
    // 22 clamped the camera on every update() and clipped the ghost faces on narrow slots, where
    // the fit stands further back than that.
    controls.rotateSpeed = 0.75;
    this._applyCamera();
    this._applyOrbit();

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
    const inv = camera.quaternion.clone().invert();
    this._lights = [
      [hemi, new THREE.Vector3(0, 1, 0).applyQuaternion(inv)],
      [key, new THREE.Vector3(5, 8, 6).applyQuaternion(inv)],
      [fill, new THREE.Vector3(-6, 2, -4).applyQuaternion(inv)],
    ];
    this._placeLights();

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
            transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide,
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

    this._anim = null;
    this._queue = [];
    this._cursor = 0;
    this._playing = false; // play() intent — lets pause() stop cleanly between moves
    this._applied = 0; // solution moves animated since the last reset (drives 'cubus-step')
    this._sol = this._parse(this._attrs.alg || '');
    this._ghostVisible();
    this.reset();

    const resize = () => {
      const w = this.clientWidth || 1, h = this.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      this._applyCamera(); // the distance depends on the aspect (see there); it sets _dirty
    };
    this._ro = new ResizeObserver(resize);
    this._ro.observe(this);
    resize();

    // Several of these live on one page — only draw when on screen and moving.
    this._visible = true;
    this._io = new IntersectionObserver((es) => { this._visible = es.some((e) => e.isIntersecting); }, { threshold: 0 });
    this._io.observe(this);

    const tick = () => {
      this._raf = requestAnimationFrame(tick);
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
        if (!a) { const m = this._queue.shift(); a = { temp: this._grab(m), m }; }
        a.temp.setRotationFromAxisAngle(AXES[a.m.axis], a.m.angle);
        this._completeMove(a);
      }
      if (!this._visible) return;
      // The drain above completes moves without calling _next(), which breaks the pull chain
      // step() and the completion handler otherwise maintain: queued moves — and a playing
      // walk — would sit forever with nothing in flight. Re-arm it.
      if (!this._anim && (this._queue.length || this._playing)) this._next();
      if (this._anim) {
        const a = this._anim;
        const k = Math.min(1, (performance.now() - a.t0) / a.dur);
        a.temp.setRotationFromAxisAngle(AXES[a.m.axis], a.m.angle * EASE(k));
        if (k >= 1) {
          this._completeMove(a);
          this._next();
        }
        this._dirty = true;
      }
      if (this._attrs.autorotate != null) { root.rotation.y += 0.0035; this._dirty = true; }
      const moving = this.controls.update();
      if (moving) this._placeLights();
      if (moving || this._dirty) { this._draw(); this._dirty = false; }
    };
    tick();
  }

  disconnectedCallback() {
    cancelAnimationFrame(this._raf);
    this._ro?.disconnect();
    this._io?.disconnect();
    this.renderer?.dispose();
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
   *  so the host can lock it. Only the angle: zoom and damping are untouched. */
  _applyOrbit() {
    if (!this.controls) return;
    this.controls.enableRotate = this._attrs.orbit !== 'locked';
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
    const points = silhouette({
      eye,
      elevation: this._ghostsEnabled() ? this._num('ghost-elevation', 4) : null,
      scale: this._num('facelet-scale', 0.9),
    });
    const d = fitDistance({ points, vfovDeg: this.camera.fov, aspect: this.camera.aspect || 1, eye });
    // The controls clamp the distance on every update(), so their limits follow the fit: a user
    // may zoom in to look closer, never out past the frame — and a resize puts the fit back.
    if (this.controls) { this.controls.minDistance = d * 0.5; this.controls.maxDistance = d; }
    this.camera.position.set(d * eye[0], d * eye[1], d * eye[2]);
    this.camera.lookAt(0, 0, 0);
    this.controls?.update();
    this._placeLights();
    this._dirty = true;
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

    // Below 4px there is no meaningful split — fall through to the single view rather than
    // build a zero-width projection.
    if (bv === 'side-by-side' && w >= 4) {
      // The right pane takes the remainder, so an odd width leaves no stale pixel column.
      const left = Math.floor(w / 2), right = w - left;
      this.camera.aspect = left / h;
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
      r.setScissorTest(true);
      try {
        r.clearDepth();
        this._renderOpposite(w - iw - 10, h - ih - 10, iw, ih);
      } finally { r.setScissorTest(false); }
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
      const m = /^([URFDLB])(2|')?$/.exec(tok);
      const f = m && FACES.find((x) => x.key === m[1]);
      if (!f) {
        console.warn(`<cubus-cube> refusing alg — invalid move token "${tok}"`);
        return [];
      }
      const turns = m[2] === '2' ? 2 : 1;
      const dir = m[2] === "'" ? -1 : 1;
      out.push({ axis: f.axis, layer: f.sign, angle: -dir * f.sign * turns * Math.PI / 2, turns });
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
    const pal = PALETTES[this._attrs.palette] || PALETTES.muted;
    // Stickers and ghosts carry the same userData and take the same colour — one loop.
    for (const m of [...this.stickers, ...this._ghostMeshes]) {
      const [x, y, z] = m.userData.home;
      let letter = m.userData.face;
      if (fl) {
        const ch = fl[FACELET_INDEX[m.userData.face](x, y, z)];
        if (ch === '?') { m.material.color.set(UNKNOWN_STICKER); continue; }
        letter = ch;
      }
      m.material.color.set(pal[letter]);
    }
    this._ghostPlace();
    this._applyScale();
    this._dirty = true;
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
    this._bake(a.temp);
    this._anim = null;
    this._applied += a.m.delta ?? 1;
    this.dispatchEvent(new CustomEvent('cubus-step', { detail: { index: this._applied, total: this._sol.length } }));
    this._dirty = true;
  }

  _bake(temp) {
    temp.updateMatrix();
    for (const c of [...temp.children]) {
      c.applyMatrix4(temp.matrix);
      c.position.set(Math.round(c.position.x), Math.round(c.position.y), Math.round(c.position.z));
      this.root.add(c);
    }
    this.root.remove(temp);
  }

  _grab(m) {
    const temp = new THREE.Group();
    this.root.add(temp);
    for (const c of this.cubies) if (Math.round(c.position[m.axis]) === m.layer) temp.add(c);
    return temp;
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
    this._anim = { temp: this._grab(m), m, t0: performance.now(), dur: (190 / tempo) * m.turns };
  }

  reset() {
    // An interrupted animation's carrier group must leave the scene here: _bake() removes it on
    // completion, but a reset mid-turn never reaches _bake, and the empty group stayed forever.
    if (this._anim) this.root.remove(this._anim.temp);
    this._queue = []; this._anim = null; this._cursor = 0; this._playing = false; this._applied = 0;
    let i = 0;
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
      if (!x && !y && !z) continue;
      const c = this.cubies[i++];
      c.position.set(x, y, z);
      c.quaternion.identity();
      this.root.add(c);
    }
    // Resolved ONCE for both jobs — painting and the scramble decision — so an invalid string
    // warns once, not twice. A VALID facelet string already encodes the scramble; only apply
    // moves when there isn't one, and an invalid string does not count.
    const fl = this._facelets();
    this._paint(fl);
    if (!fl) {
      for (const m of this._parse(this._attrs.scramble || '')) {
        const t = this._grab(m);
        t.rotateOnAxis(AXES[m.axis], m.angle);
        this._bake(t);
      }
    }
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
    for (let i = 0; i < target; i++) {
      const m = this._sol[i];
      const t = this._grab(m);
      t.rotateOnAxis(AXES[m.axis], m.angle);
      this._bake(t);
    }
    this._cursor = target; this._applied = target;
    this._dirty = true;
    this.dispatchEvent(new CustomEvent('cubus-step', { detail: { index: target, total: this._sol.length } }));
  }
}
customElements.define('cubus-cube', CubusCube);
