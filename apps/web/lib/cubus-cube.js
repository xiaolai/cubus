// <cubus-cube> — the cubus 3x3x3 renderer. Draws only: state and solving stay with
// cubejs / cubing.js search. Two ways in, both valid by construction:
//   facelets="…54 chars, URFDLB order…"   paint from a scanner/solver state
//   scramble="R U' F2 …"                  apply moves to a solved cube
// alg="R U R' U' …" is the animatable solution; play() / step() / reset() drive it.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

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
    'camera-distance', 'cameradistance',
    'camera-latitude', 'cameralatitude',
    'camera-longitude', 'cameralongitude',
    'facelet-scale', 'faceletscale',
    'tempo-scale', 'temposcale',
    'back-view', 'backview',
  ];

  static ALIAS = {
    ghostelevation: 'ghost-elevation',
    cameradistance: 'camera-distance',
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
  set cameraDistance(v) { this._set('camera-distance', v); }
  set cameraLatitude(v) { this._set('camera-latitude', v); }
  set cameraLongitude(v) { this._set('camera-longitude', v); }
  set faceletScale(v) { this._set('facelet-scale', v); }
  set tempoScale(v) { this._set('tempo-scale', v); }
  set backView(v) { this._set('back-view', v); }

  constructor() {
    super();
    // Defaults match the codebase player's control panel, except ghosts:
    // those are opt-in here because they crowd a small embedded cube.
    this._attrs = {
      palette: 'muted', ghosts: 'none', 'ghost-elevation': '4',
      'camera-distance': '12', 'camera-latitude': '35', 'camera-longitude': '45',
      'facelet-scale': '0.9', 'tempo-scale': '1', 'back-view': 'none',
    };
  }
  attributeChangedCallback(name, _old, val) { this._set(name, val); }
  _set(name, val) {
    name = CubusCube.ALIAS[String(name).toLowerCase()] || name;
    this._attrs[name] = val;
    if (!this._ghostMeshes) return;
    if (name === 'palette') this._paint();
    else if (name === 'ghosts') { this._ghostVisible(); this._paint(); this._applyCamera(); }
    else if (name === 'ghost-elevation') { this._ghostPlace(); this._applyCamera(); }
    else if (name === 'facelet-scale') this._applyScale();
    else if (name === 'camera-distance' || name === 'camera-latitude' || name === 'camera-longitude') this._applyCamera();
    else if (name === 'back-view') this._dirty = true;
    else if (name === 'facelets' || name === 'scramble') this.reset();
    else if (name === 'alg') { this._sol = this._parse(this._attrs.alg || ''); this._cursor = 0; this._applied = 0; this._playing = false; }
  }

  connectedCallback() {
    if (this.scene) return;
    this.style.cssText = 'display:block;width:100%;height:100%;' + (this.style.cssText || '');

    const scene = this.scene = new THREE.Scene();
    const camera = this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    this._framed = true; // camera comes from distance/latitude/longitude, not from framing

    const renderer = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping; // exact palette fidelity
    renderer.domElement.style.cssText = 'width:100%;height:100%;display:block';
    this.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xfffaf0, 0x4a4030, 1.0));
    const key = new THREE.DirectionalLight(0xffffff, 0.95);
    key.position.set(5, 8, 6);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xdfe6ff, 0.45);
    fill.position.set(-6, 2, -4);
    scene.add(fill);

    const controls = this.controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 5;
    controls.maxDistance = 22;
    controls.rotateSpeed = 0.75;
    this._applyCamera();

    const root = this.root = new THREE.Group();
    scene.add(root);

    const bodyGeo = new RoundedBoxGeometry(0.94, 0.94, 0.94, 4, 0.1);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1a1712, roughness: 0.62, metalness: 0.04 });
    const stickerGeo = new RoundedBoxGeometry(0.78, 0.78, 0.06, 3, 0.07);
    // Ghosts are flat planes, not boxes — they read as projections rather than solid tiles.
    const ghostGeo = new THREE.PlaneGeometry(0.78, 0.78);

    this.cubies = [];
    this.stickers = [];
    this._ghostMeshes = [];
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
      if (!x && !y && !z) continue;
      const c = new THREE.Group();
      c.position.set(x, y, z);
      c.userData.home = [x, y, z];
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
          g.rotation.copy(m.rotation);
          if (n[0]) g.rotation.y = Math.PI / 2;
          g.userData = { face: f.key, home: [x, y, z], n };
          g.renderOrder = 1;
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
      this._dirty = true;
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
      if (!this._visible) return;
      if (this._anim) {
        const a = this._anim;
        const k = Math.min(1, (performance.now() - a.t0) / a.dur);
        a.temp.setRotationFromAxisAngle(AXES[a.m.axis], a.m.angle * EASE(k));
        if (k >= 1) {
          this._bake(a.temp);
          this._anim = null;
          // A move queued by stepBack() carries delta -1: it undoes a solution move, so the step
          // index must count down. Anything else is a forward move and counts up.
          this._applied += a.m.delta ?? 1;
          // Host apps sync a move list / 2D net / scrubber to this.
          this.dispatchEvent(new CustomEvent('cubus-step', { detail: { index: this._applied, total: this._sol.length } }));
          this._next();
        }
        this._dirty = true;
      }
      if (this._attrs.autorotate != null) { root.rotation.y += 0.0035; this._dirty = true; }
      const moving = this.controls.update();
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
  _applyCamera() {
    if (!this.camera) return;
    // The player's distance 12 frames a bare cube at our 30° fov ≈ 10 units.
    let d = this._num('camera-distance', 12) * 0.85;
    // Ghosts widen the silhouette, so give them the room they occupy.
    const on = this._attrs.ghosts !== 'none' && this._attrs.ghosts !== 'false';
    if (on) d += this._num('ghost-elevation', 4) * 0.42;
    const lat = this._num('camera-latitude', 35) * Math.PI / 180;
    const lon = this._num('camera-longitude', 45) * Math.PI / 180;
    this.camera.position.set(
      d * Math.cos(lat) * Math.sin(lon),
      d * Math.sin(lat),
      d * Math.cos(lat) * Math.cos(lon),
    );
    this.camera.lookAt(0, 0, 0);
    this.controls?.update();
    this._dirty = true;
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
    if (!this._ghostMeshes.length) return;
    const on = this._attrs.ghosts !== 'none' && this._attrs.ghosts !== 'false';
    if (!on) return;
    const eye = this.camera.position.clone().normalize();
    const n = new THREE.Vector3();
    for (const g of this._ghostMeshes) {
      n.set(...g.userData.n).applyQuaternion(g.parent.getWorldQuaternion(this._q ||= new THREE.Quaternion()));
      // Facing away from the eye → hidden face → show its ghost.
      g.visible = n.dot(eye) < -0.15;
    }
  }

  _draw() {
    const r = this.renderer, w = this.clientWidth || 1, h = this.clientHeight || 1;
    this._cullGhosts();
    const bv = this._attrs['back-view'] || 'none';

    if (bv === 'side-by-side') {
      const half = Math.floor(w / 2);
      this.camera.aspect = half / h;
      this.camera.updateProjectionMatrix();
      r.setScissorTest(true);
      r.setViewport(0, 0, half, h); r.setScissor(0, 0, half, h);
      r.render(this.scene, this.camera);
      this._renderOpposite(0 + half, 0, half, h);
      r.setScissorTest(false);
      return;
    }

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    r.setViewport(0, 0, w, h);
    r.render(this.scene, this.camera);

    if (bv === 'top-right') {
      const iw = Math.floor(w * 0.32), ih = Math.floor(h * 0.32);
      r.setScissorTest(true);
      r.clearDepth();
      this._renderOpposite(w - iw - 10, h - ih - 10, iw, ih);
      r.setScissorTest(false);
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
    const on = this._attrs.ghosts !== 'none' && this._attrs.ghosts !== 'false';
    if (on) {
      const eye = cam.position.clone().normalize();
      const n = new THREE.Vector3();
      for (const g of this._ghostMeshes) {
        n.set(...g.userData.n).applyQuaternion(g.parent.getWorldQuaternion(this._q ||= new THREE.Quaternion()));
        if (n.dot(eye) < -0.15) { g.visible = true; hidden.push(g); }
      }
    }
    r.setViewport(x, y, w, h);
    r.setScissor(x, y, w, h);
    r.render(this.scene, cam);
    for (const g of hidden) g.visible = false;
    for (const g of flipped) g.visible = true;
  }

  _parse(alg) {
    return String(alg).trim().split(/\s+/).filter(Boolean).map((tok) => {
      const f = FACES.find((x) => x.key === tok[0]);
      if (!f) return null;
      const turns = tok.includes('2') ? 2 : 1;
      const dir = tok.includes("'") ? -1 : 1;
      return { axis: f.axis, layer: f.sign, angle: -dir * f.sign * turns * Math.PI / 2, turns };
    }).filter(Boolean);
  }

  _paint() {
    if (!this.stickers) return;
    const pal = PALETTES[this._attrs.palette] || PALETTES.muted;
    const fl = (this._attrs.facelets || '').replace(/\s+/g, '');
    for (const s of this.stickers) {
      const [x, y, z] = s.userData.home;
      let letter = s.userData.face;
      if (fl.length === 54) {
        const idx = FACELET_INDEX[s.userData.face](x, y, z);
        const ch = fl[idx];
        if (ch === '?') { s.material.color.set(UNKNOWN_STICKER); continue; }
        if (pal[ch]) letter = ch;
      }
      s.material.color.set(pal[letter]);
    }
    for (const g of this._ghostMeshes) {
      const [x, y, z] = g.userData.home;
      let letter = g.userData.face;
      if (fl.length === 54) {
        const ch = fl[FACELET_INDEX[g.userData.face](x, y, z)];
        if (ch === '?') { g.material.color.set(UNKNOWN_STICKER); continue; }
        if (pal[ch]) letter = ch;
      }
      g.material.color.set(pal[letter]);
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
    const on = this._attrs.ghosts !== 'none' && this._attrs.ghosts !== 'false';
    for (const g of this._ghostMeshes) g.visible = on; // _cullGhosts refines this per frame
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
    this._queue = []; this._anim = null; this._cursor = 0; this._playing = false; this._applied = 0;
    let i = 0;
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
      if (!x && !y && !z) continue;
      const c = this.cubies[i++];
      c.position.set(x, y, z);
      c.quaternion.identity();
      this.root.add(c);
    }
    this._paint();
    // A facelet string already encodes the scramble; only apply moves when it doesn't.
    if ((this._attrs.facelets || '').replace(/\s+/g, '').length !== 54) {
      for (const m of this._parse(this._attrs.scramble || '')) {
        const t = this._grab(m);
        t.rotateOnAxis(AXES[m.axis], m.angle);
        this._bake(t);
      }
    }
    this._dirty = true;
    this.dispatchEvent(new CustomEvent('cubus-step', { detail: { index: 0, total: this._sol.length } }));
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
  // Instant seek to solution move k (no animation) — drives the playback scrubber.
  seek(k) {
    const target = Math.max(0, Math.min(Math.round(k), this._sol.length));
    this.reset();
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
