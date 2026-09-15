// What a <cubus-cube> puts on screen, read back from the canvas: the instrument the appearance
// suites use instead of the renderer's materials.
//
// A material property is what the renderer MEANT to draw. A test on it passes when the value is
// set and the pixels are wrong — a shared material, a light that never reaches the sticker, an
// emissive the shader ignores — so the plan (dev-docs/renderer-v2-plan.md §3c) asks the highlight
// and focus tests to read the output instead. Everything here runs in the page: `installSampler`
// is handed to `page.evaluate` once, and defines `window.__appearance`.

/** Install `window.__appearance` in the page. Passed to `page.evaluate` as a function. */
export function installSampler() {
  /** Two opposite eyes: between them every one of the 54 stickers faces the camera once. */
  const VIEWS = [[35, 45], [-35, 225]];

  /** Draw now and read the whole drawing buffer. Rows come back bottom row first. */
  const frame = (el) => {
    el._dirty = true;
    el._draw();
    const gl = el.renderer.getContext();
    const w = gl.drawingBufferWidth; const h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return { w, h, px };
  };

  /** The mean colour of the 3x3 pixels around a world point, or null when it is off the canvas. */
  const sampleAt = (el, { w, h, px }, world) => {
    const p = world.clone().project(el.camera);
    const x = Math.round(((p.x + 1) / 2) * w); const y = Math.round(((p.y + 1) / 2) * h);
    if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) return null;
    const sum = [0, 0, 0];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const i = ((y + dy) * w + (x + dx)) * 4;
        for (let c = 0; c < 3; c++) sum[c] += px[i + c];
      }
    }
    return sum.map((s) => s / 9);
  };

  /** Does a surface at `world`, facing `outward`, face the eye squarely enough to sample? */
  const faces = (el, world, outward) => {
    const toEye = el.camera.position.clone().sub(world).normalize();
    return outward.dot(toEye) > 0.35;
  };

  /** Run `read` from each view with the element's own camera attributes put back afterwards. */
  const fromEachView = (el, read) => {
    const saved = ['camera-latitude', 'camera-longitude'].map((a) => [a, el.getAttribute(a)]);
    try {
      for (const [lat, lon] of VIEWS) {
        el.setAttribute('camera-latitude', String(lat));
        el.setAttribute('camera-longitude', String(lon));
        el.scene.updateMatrixWorld(true);
        read(frame(el));
      }
    } finally {
      for (const [a, v] of saved) { if (v === null) el.removeAttribute(a); else el.setAttribute(a, v); }
      el._dirty = true;
    }
  };

  window.__appearance = {
    /**
     * Every sticker's colour as drawn, keyed `cubie:face` — the cubie's index in `el.cubies` and
     * the sticker's face letter — taken from the first view in which it faces the eye.
     */
    stickers(el = window.__cube) {
      const V3 = el.camera.position.constructor;
      const out = {};
      fromEachView(el, (shot) => {
        el.cubies.forEach((c, i) => {
          const centre = c.getWorldPosition(new V3());
          for (const m of c.children) {
            if (!m.userData?.face || m.userData.n) continue;
            const key = `${i}:${m.userData.face}`;
            if (key in out) continue;
            const at = m.getWorldPosition(new V3());
            if (!faces(el, at, at.clone().sub(centre).normalize())) continue;
            const rgb = sampleAt(el, shot, at);
            if (rgb) out[key] = rgb;
          }
        });
      });
      return out;
    },

    /**
     * The body between neighbouring cubies, as drawn: for each visible face, the midpoint between
     * two adjacent sticker centres, where no sticker is. Keyed `cubie-cubie:face`.
     */
    bodies(el = window.__cube) {
      const V3 = el.camera.position.constructor;
      const out = {};
      fromEachView(el, (shot) => {
        const stickers = el.cubies.flatMap((c, i) => c.children
          .filter((m) => m.userData?.face && !m.userData.n)
          .map((m) => ({ i, face: m.userData.face, at: m.getWorldPosition(new V3()), centre: c.getWorldPosition(new V3()) })));
        for (const a of stickers) {
          for (const b of stickers) {
            if (a.face !== b.face || a.i >= b.i || a.at.distanceTo(b.at) > 1.01) continue;
            const key = `${a.i}-${b.i}:${a.face}`;
            if (key in out) continue;
            const mid = a.at.clone().add(b.at).multiplyScalar(0.5);
            if (!faces(el, mid, a.at.clone().sub(a.centre).normalize())) continue;
            const rgb = sampleAt(el, shot, mid);
            if (rgb) out[key] = rgb;
          }
        }
      });
      return out;
    },

    /**
     * One sticker as the frame ON SCREEN shows it — the last one the element drew, read without
     * drawing again — or null when it does not face the eye. For the pulse, which is only
     * observable across frames the element draws on its own.
     */
    presented(cubieIndex, face, el = window.__cube) {
      const V3 = el.camera.position.constructor;
      const gl = el.renderer.getContext();
      const w = gl.drawingBufferWidth; const h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const c = el.cubies[cubieIndex];
      const m = c.children.find((x) => x.userData?.face === face && !x.userData.n);
      el.scene.updateMatrixWorld(true);
      const at = m.getWorldPosition(new V3());
      if (!faces(el, at, at.clone().sub(c.getWorldPosition(new V3())).normalize())) return null;
      return sampleAt(el, { w, h, px }, at);
    },

    /**
     * Each ghost the current view SHOWS, as drawn, keyed `cubie:face`. A ghost the view draws can
     * still be hidden behind the cube: the one below the D face sits inside the silhouette from the
     * default eye, and sampling it read the body. So a ghost is kept only where its pixel differs
     * from a render with every ghost made fully transparent. Ghosts are not re-aimed.
     */
    ghosts(el = window.__cube) {
      const V3 = el.camera.position.constructor;
      el.scene.updateMatrixWorld(true);
      const shot = frame(el);
      const saved = new Map();
      el.scene.traverse((o) => {
        const ghostly = o.userData?.n || (o.isLineSegments && o.parent?.userData?.n);
        if (ghostly && !saved.has(o.material)) { saved.set(o.material, o.material.opacity); o.material.opacity = 0; }
      });
      let bare;
      try { bare = frame(el); } finally { for (const [m, v] of saved) m.opacity = v; el._dirty = true; }
      const out = {};
      el.cubies.forEach((c, i) => {
        for (const m of c.children) {
          if (!m.userData?.n || m.visible === false) continue;
          const at = m.getWorldPosition(new V3());
          const rgb = sampleAt(el, shot, at); const under = sampleAt(el, bare, at);
          if (rgb && under && Math.max(...rgb.map((v, k) => Math.abs(v - under[k]))) > 2) out[`${i}:${m.userData.face}`] = rgb;
        }
      });
      return out;
    },
  };
}

/** Relative luminance of a sampled colour, 0..255. */
export const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** The largest channel difference between two samples. */
export const channelDelta = (a, b) => Math.max(...a.map((v, c) => Math.abs(v - b[c])));
