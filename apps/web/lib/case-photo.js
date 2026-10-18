// The library's case photographs: the app's own <cubus-cube>, borrowed while the library draws no cube, set to a
// row's case in the hold the learner starts in, its moved pieces lit, and read off its canvas as a still
// (dev-docs/practice-redesign-plan.md §3; WI-1).
//
// WHY A PHOTOGRAPH OF THE RENDERER, NOT A DRAWING OF A CUBE. The picture must be the cube in the learner's hand as
// this app draws it — their palette, their colour scheme, the tuned view — and only the app's renderer draws that.
// A net at tile size is a 12-wide strip of 5 px stickers that looks like no cube anyone holds (§1).
//
// ONE RENDERER. The library shows no cube, so the session's one parked renderer (lib/cube-drawing.js) is idle while
// it is on screen: `newCube` hands it over, and leaving the screen parks it again as every screen does. It sits in
// a slot that is ON SCREEN and invisible (`opacity: 0`) — the renderer stops drawing when its IntersectionObserver
// says it is off screen, so a `display: none` or an off-viewport slot would photograph nothing.
//
// A STILL OF THE HIGHLIGHT, from the renderer's own `clock` seam: a highlight set at a pinned instant starts at the
// top of its breath, so every photograph is the marking at full strength and the same frame every time, whatever
// the reader's motion preference. The clock is let go before the renderer is shown live in a tile and before the
// screen parks it — a parked renderer with a pinned clock would freeze the next screen's turns.
//
// THE MARK IS SEEN, NOT ONLY PRESENT (E8). The highlight brightens a sticker in its own colour with nothing unmarked
// beside it, so at tile size it reads as lighting: on four F2L tiles it changed 0% of the picture by 48/255. So every
// sticker the highlight lit, on a face the camera sees, is also OUTLINED in the ink colour — projected through the
// renderer's own camera and stroked over the still, INSIDE the sticker's edge so none of it is lost on the dark
// body. The same mark the flat pictures carry (`outlineMoved`); no sticker changes colour and nothing greys.
//
// FRAMED TO THE CUBE (E9). The renderer frames a turned cube for every angle at once, which leaves it about two
// thirds of its canvas's width. The still is cut to the cube's painted box, widened to `PHOTO_FRAME`'s shape, so a
// tile's picture box is the cube and not the margin round it.
//
// THE SAME ELEMENT IS THE PULSE. Pointing at or focusing a photographed tile moves the renderer into that tile,
// unpinned, where the highlight breathes (the renderer freezes it under reduced motion); leaving puts it back in
// its slot. A grid at rest is stills only.

import { SOLVED as SOLVED_FACELETS } from './app-state.js';
import { newCube } from './cube-drawing.js';
import { caseOf, movedPieces } from './drill/case-of.js';
import { holdSpec } from './solving-hold.js';

/** The box a photograph is taken in, CSS px, before the still is cut to the cube (`PHOTO_FRAME`). */
export const PHOTO_BOX = Object.freeze({ w: 110, h: 96 });

/** The SHAPE a still is cut to around the cube's painted box (width : height): the cube's own at the app's camera,
 *  measured at 68.5% × 84% of `PHOTO_BOX`, which is 15 : 16. A tile's picture box has this shape. */
export const PHOTO_FRAME = Object.freeze({ w: 15, h: 16 });

/** How many outline widths make a sticker's width on a photograph: the THINNEST band that meets E8's gate — every
 *  visible moved sticker has at least 25% of its own painted pixels changed by 48/255 against the photograph unmarked.
 *  Measured 2026-10-18 in Chromium over all 312 marked photographs (3,574 stickers): the smallest share is 25.2% at 9,
 *  21.3% at 10, 15.5% at 12. */
const OUTLINE_PER_STICKER = 9;

/**
 * The sets whose cases a photograph cannot tell apart as well as today's net does, so they keep the net — COMPUTED,
 * not chosen: drawn as a tile shows them and cropped to what they paint, the photographs make more of their pairs look
 * alike than the nets do (§3.3, E8 amended). Re-derived
 * both ways by test/browser/case-photos.test.mjs; widening or narrowing it is a measurement, never an edit.
 */
export const NET_KEPT = Object.freeze(['mehta-l5ep', 'cf-last-ledge', 'cf-middle-edges']);

/** The sets whose tiles are NOT marked, computed by the same rule: marking makes more of their pairs alike than the
 *  same pictures bare (§3.6). Re-derived both ways by the same browser suite. `cf-middle-edges` left it on 2026-10-18,
 *  when alike came to be measured on what a tile shows: its outlined nets make no pair alike there. */
export const UNMARKED = Object.freeze(['mehta-l5ep', 'cf-last-ledge']);

/** The attributes the photographer sets on the renderer — and the only ones. Never `focus`, which greys stickers. */
export const PHOTO_ATTRS = Object.freeze(['orientation', 'facelets', 'highlight', 'ghosts']);

/** A row drawn as a photograph: a net row outside the keep list. Every other row keeps its flat picture. */
export const isPhotographed = (row) => row.solves.picture === 'net' && !NET_KEPT.includes(row.set);

/** A row whose tile marks its moved pieces. */
export const isMarked = (row) => !UNMARKED.includes(row.set);

/**
 * What the renderer is set to for a row's photograph: its case and hold (`caseOf`, the page's own), the pieces it is
 * about lit, and the ghost faces off — the photographer's one override of the tuned view, measured: at tile size the
 * ghosts shrink the cube to make room for themselves and three pairs of F2L cases come out alike (§3.3).
 *
 * @param {{ alg: string, hold: string[], set: string }} row
 * @param {string|null} region  the row's set's goal region
 * @param {{ mark?: boolean }} [options]  whether the moved pieces are lit (the row's own rule unless said)
 */
export function photoAttrs(row, region, { mark = isMarked(row) } = {}) {
  const { facelets, hold } = caseOf(row);
  const names = mark ? movedPieces(row, region).names : [];
  return Object.freeze({
    orientation: holdSpec(hold),
    facelets,
    highlight: names.length ? names.map((n) => `piece:${n}`).join(',') : 'none',
    ghosts: 'none',
  });
}

/** What the photographers have done this session, for a reader who needs to know rather than guess: photographs
 *  taken, answered from the cache, and photographers that found no renderer to borrow. */
export const casePhotoCounts = { taken: 0, cached: 0, unavailable: 0 };

/** Photographs already taken, by everything that decides what they look like. In memory for the session. */
const cache = new Map();

/** Where the still is cut from the renderer's box, for each look — the same for every case of it, because the 24
 *  holds are the cube's own symmetries. The live pulse is placed by it, so the cube does not jump on hover. */
const frames = new Map();

/** Each photograph's marked stickers, by its URL: the polygons its outline was drawn on, in the still's pixels. */
const marks = new Map();

/**
 * The stickers a photograph marks, as polygons in its own pixels — one per visible moved sticker, exactly where its
 * outline was stroked — or null for a URL this session did not take. For a reader who measures the mark sticker by
 * sticker (test/browser/case-photos.test.mjs, plan E8) rather than guessing where it is.
 */
export const photoMarks = (url) => marks.get(url) ?? null;

/** Forget every photograph — the object URLs released. The next asking takes each again. */
export function clearCasePhotos() {
  for (const p of cache.values()) p.then((url) => URL.revokeObjectURL(url), () => {});
  cache.clear();
  marks.clear();
}

/** What the pulse changes on the renderer's style to put it in a well, and gives back after. */
const FRAMED = Object.freeze(['inset', 'left', 'top', 'right', 'bottom', 'width', 'height']);

/** The instant the renderer's clock is pinned at for a still: any number does; one, so every still is alike. */
const PIN = 1_000_000;

/**
 * The renderer's next frame, on its own clock — never a timer. The renderer's loop asked for this frame during the
 * last one, so its callback runs before ours: by the time ours runs, what was just set has been drawn. A photograph
 * read before that would be the case before it, which the browser suite's forwards-and-backwards case catches.
 */
const frame = () => new Promise((resolve) => { requestAnimationFrame(() => resolve()); });

/**
 * The stickers to outline on a still: every one the renderer's highlight LIT (its emissive light is on) on a face the
 * camera sees, as polygons in canvas pixels, projected through the renderer's own camera. Lit, not re-derived: the
 * outline is exactly the highlight, which test/case-photo.test.mjs holds to the moved pieces. A sticker facing the
 * camera on a cube is never hidden behind another, so nothing more decides what is drawn.
 *
 * `camera` and `stickers` are the renderer's fields, not its published API: a renderer without them refuses here,
 * loudly, rather than photographing an unmarked case as a marked one.
 */
function litOutlines(el, canvas) {
  const { camera, stickers } = el;
  if (!camera || !Array.isArray(stickers) || !stickers.length) {
    throw new Error('case-photo: the renderer has no camera or stickers to project the marking through');
  }
  camera.updateMatrixWorld();
  const V = stickers[0].position.constructor;
  const eye = camera.getWorldPosition(new V());
  const out = [];
  for (const m of stickers) {
    if (!(m.material?.emissiveIntensity > 0)) continue;
    m.updateWorldMatrix(true, false);
    const at = m.getWorldPosition(new V());
    const outward = at.clone().sub(m.parent.getWorldPosition(new V())).normalize();
    if (outward.dot(eye.clone().sub(at)) <= 0) continue;
    m.geometry.boundingBox ?? m.geometry.computeBoundingBox();
    const { min, max } = m.geometry.boundingBox;
    // The sticker's OUTER face: of its two faces, the one further out.
    const z = [min.z, max.z].reduce((a, b) => (new V(0, 0, b).applyMatrix4(m.matrixWorld).dot(outward)
      > new V(0, 0, a).applyMatrix4(m.matrixWorld).dot(outward) ? b : a));
    out.push([[min.x, min.y], [max.x, min.y], [max.x, max.y], [min.x, max.y]].map(([x, y]) => {
      const p = new V(x, y, z).applyMatrix4(m.matrixWorld).project(camera);
      return [((p.x + 1) / 2) * canvas.width, ((1 - p.y) / 2) * canvas.height];
    }));
  }
  return out;
}

/** Stroke each polygon INSIDE its own edge, `OUTLINE_PER_STICKER` to a sticker's width, in `ink`. */
function strokeInside(g, polygons, ink) {
  for (const poly of polygons) {
    const area = Math.abs(poly.reduce((a, [x, y], i) => {
      const [nx, ny] = poly[(i + 1) % poly.length];
      return a + x * ny - nx * y;
    }, 0)) / 2;
    const path = new Path2D();
    poly.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
    path.closePath();
    g.save();
    g.clip(path);
    g.lineWidth = (2 * Math.sqrt(area)) / OUTLINE_PER_STICKER;
    g.lineJoin = 'round';
    g.strokeStyle = ink;
    g.stroke(path);
    g.restore();
  }
}

/** The painted box of a canvas — its pixels that are not transparent — widened to `PHOTO_FRAME`'s shape round the
 *  same centre, in whole pixels. Null when nothing is painted. */
function frameOf(g, w, h) {
  const px = g.getImageData(0, 0, w, h).data;
  let x0 = w; let y0 = h; let x1 = -1; let y1 = -1;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (px[(y * w + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  let fw = x1 - x0 + 1; let fh = y1 - y0 + 1;
  if (fw * PHOTO_FRAME.h < fh * PHOTO_FRAME.w) fw = Math.round((fh * PHOTO_FRAME.w) / PHOTO_FRAME.h);
  else fh = Math.round((fw * PHOTO_FRAME.h) / PHOTO_FRAME.w);
  return { x: Math.round((x0 + x1 + 1 - fw) / 2), y: Math.round((y0 + y1 + 1 - fh) / 2), w: fw, h: fh };
}

function checkAttrs(attrs) {
  const keys = Object.keys(attrs ?? {}).sort();
  if (keys.join() !== [...PHOTO_ATTRS].sort().join()) {
    throw new Error(`case-photo: a photograph sets only ${PHOTO_ATTRS.join(', ')} — not ${keys.join(', ') || 'nothing'}`);
  }
  if (attrs.ghosts !== 'none') throw new Error(`case-photo: a photograph is taken with ghosts "none", not "${attrs.ghosts}"`);
}

/**
 * A photographer for one mount of a screen that draws no cube of its own.
 *
 * @param {object} deps
 * @param {HTMLElement|null} deps.host  where the invisible slot goes: inside the stage, so leaving the screen parks
 *   the renderer with everything else in it
 * @param {AbortSignal} deps.signal  the screen's: once it aborts nothing more is photographed, and the clock is let go
 * @param {{ w: number, h: number }} [deps.box]
 */
export function casePhotographer({ host, signal, box = PHOTO_BOX }) {
  let cube = null;          // the borrowed renderer, once borrowed
  let slot = null;          // where it waits, invisible, between photographs
  let look = null;          // everything about the renderer that decides a picture, besides the case
  let unavailable = false;  // no renderer could be borrowed: tiles keep their flat pictures
  let busy = false;         // a photograph is being taken
  let wanted = null;        // { well, attrs }: the tile the pulse belongs in, while one is pointed at or focused
  let framed = null;        // the renderer's own size and place, kept while the pulse has it sized for a well
  const queue = [];

  signal?.addEventListener('abort', () => {
    // Before the screen parks it: a pinned clock on a parked renderer freezes the next screen's cube.
    if (cube) { cube.clock = null; unframePulse(); }
    for (const job of queue.splice(0)) job.resolve(null);
    wanted = null;
  }, { once: true });

  /** The renderer, borrowed on first need; null when there is none to borrow (no WebGL, no renderer module). */
  function borrow() {
    if (cube || unavailable) return cube;
    slot = document.createElement('div');
    slot.className = 'case-photo-slot';
    slot.setAttribute('aria-hidden', 'true');
    slot.style.cssText = `position:absolute;left:0;top:0;width:${box.w}px;height:${box.h}px;opacity:0;pointer-events:none;overflow:hidden`;
    host.appendChild(slot);
    const el = newCube({ subject: { facelets: SOLVED_FACELETS, moves: [], isPhysical: false } });
    el.setAttribute('ghosts', 'none');
    el.setAttribute('aria-hidden', 'true');
    slot.appendChild(el);
    // `scene` is what the renderer publishes once its WebGL context and meshes exist; a build that could not make a
    // context unwinds and leaves none (vendor/cubus-cube.js `connectedCallback`).
    if (!el.scene || !el.querySelector('canvas')) {
      el.remove();
      slot.remove();
      slot = null;
      unavailable = true;
      casePhotoCounts.unavailable += 1;
      if (host) host.dataset.photos = 'unavailable';
      console.warn('case-photo: no renderer could be made (is WebGL available?), so the library draws its flat pictures');
      return null;
    }
    cube = el;
    // Not `style`: where the element is placed (the pulse sizes it in a well) is not how its cube looks, and a style
    // attribute left behind by an earlier mount would key every photograph of a return visit anew.
    look = [...el.attributes].filter((a) => !PHOTO_ATTRS.includes(a.name) && !['role', 'style'].includes(a.name) && !a.name.startsWith('aria-'))
      .map((a) => `${a.name}=${a.value}`).sort().join(';');
    return cube;
  }

  const set = (attrs) => { for (const k of PHOTO_ATTRS) cube.setAttribute(k, attrs[k]); };

  /** Put the renderer where it belongs between photographs: live in the wanted tile, or back in its slot. */
  function place() {
    if (!cube || busy || signal?.aborted) return;
    const at = wanted?.well.isConnected ? wanted : null;
    if (!at) {
      if (cube.parentElement !== slot) { cube.clock = null; unframePulse(); slot.appendChild(cube); }
      return;
    }
    cube.clock = null;
    set(at.attrs);
    framePulse(at.well);
    if (cube.parentElement !== at.well) at.well.appendChild(cube);
  }

  /** The renderer, live in a well, sized and placed so its cube sits where the still's does: the still is the
   *  renderer's box cut to `frames`' rectangle and contained in the well. */
  function framePulse(well) {
    const f = frames.get(lookKey());
    if (!f) return;
    const k = Math.min(well.clientWidth / (f.w * box.w), well.clientHeight / (f.h * box.h));
    const left = (well.clientWidth - f.w * box.w * k) / 2 - f.x * box.w * k;
    const top = (well.clientHeight - f.h * box.h * k) / 2 - f.y * box.h * k;
    framed ??= FRAMED.map((p) => [p, cube.style.getPropertyValue(p), cube.style.getPropertyPriority(p)]);
    Object.assign(cube.style, { inset: 'auto', left: `${left}px`, top: `${top}px`, width: `${box.w * k}px`, height: `${box.h * k}px` });
  }

  /** Give the renderer back the size and place it had before the pulse: it goes on to the slot, or to the next screen
   *  when this one is left with a tile pointed at — sized for a well, it would draw that screen's cube well-sized. */
  function unframePulse() {
    if (!framed) return;
    for (const p of FRAMED) cube.style.removeProperty(p);
    for (const [p, v, priority] of framed) if (v) cube.style.setProperty(p, v, priority);
    framed = null;
  }

  const lookKey = () => `${look}|${box.w}x${box.h}|${Math.min(devicePixelRatio, 2)}`;

  /** The ink colour the marking is drawn in: the theme's own, read where the library is drawn. */
  function inkNow() {
    const ink = host ? getComputedStyle(host).getPropertyValue('--ink').trim() : '';
    if (!ink) throw new Error('case-photo: no ink colour (--ink) to mark the moved pieces with');
    return ink;
  }

  async function shoot(attrs, ink) {
    cube.clock = PIN;
    set(attrs);
    unframePulse();
    if (cube.parentElement !== slot) slot.appendChild(cube);
    await frame();
    if (signal?.aborted) return null;
    const gl = cube.querySelector('canvas');
    const work = document.createElement('canvas');
    work.width = gl.width;
    work.height = gl.height;
    const g = work.getContext('2d', { willReadFrequently: true });
    g.drawImage(gl, 0, 0);
    // Framed before the outline is drawn: the outline lies inside the stickers, so it cannot widen the cube's box.
    const f = frameOf(g, work.width, work.height);
    if (!f) throw new Error('case-photo: the renderer painted nothing');
    const lit = litOutlines(cube, work);
    strokeInside(g, lit, ink);
    frames.set(lookKey(), { x: f.x / work.width, y: f.y / work.height, w: f.w / work.width, h: f.h / work.height });
    const still = document.createElement('canvas');
    still.width = f.w;
    still.height = f.h;
    still.getContext('2d').drawImage(work, -f.x, -f.y);
    const blob = await new Promise((resolve) => { still.toBlob(resolve, 'image/png'); });
    if (!blob) throw new Error('case-photo: the renderer\'s canvas gave no picture');
    casePhotoCounts.taken += 1;
    const url = URL.createObjectURL(blob);
    marks.set(url, Object.freeze(lit.map((poly) => Object.freeze(poly.map(([x, y]) => Object.freeze([x - f.x, y - f.y]))))));
    return url;
  }

  async function pump() {
    if (busy) return;
    busy = true;
    try {
      while (queue.length && !signal?.aborted) {
        const job = queue.shift();
        try { job.resolve(await shoot(job.attrs, job.ink)); } catch (err) { job.reject(err); }
      }
    } finally {
      busy = false;
      place();
    }
  }

  return Object.freeze({
    /** Whether this photographer found no renderer, and the screen draws flat pictures instead. */
    get unavailable() { return unavailable; },

    /**
     * A photograph of the renderer set to `attrs` (`photoAttrs`), as an object URL — or null when there is no
     * renderer to take it with, or the screen has gone. Photographs are taken one at a time, in the order asked for,
     * and kept for the session.
     */
    photo(attrs) {
      try { checkAttrs(attrs); } catch (err) { return Promise.reject(err); }
      if (signal?.aborted || !borrow()) return Promise.resolve(null);
      let ink;
      try { ink = inkNow(); } catch (err) { return Promise.reject(err); }
      const key = `${lookKey()}|${ink}|${attrs.orientation}|${attrs.facelets}|${attrs.highlight}`;
      const kept = cache.get(key);
      if (kept) { casePhotoCounts.cached += 1; return kept; }
      const taken = new Promise((resolve, reject) => { queue.push({ attrs, ink, resolve, reject }); });
      // A refusal is not kept, and neither is an answer cut short by the screen going: the next asking takes it again.
      const settled = taken.then((url) => { if (url === null) cache.delete(key); return url; });
      settled.catch(() => cache.delete(key));
      cache.set(key, settled);
      pump();
      return settled;
    },

    /** Show the case live in `well`, its marking breathing, while it is pointed at or focused. */
    pulse(well, attrs) {
      checkAttrs(attrs);
      if (signal?.aborted || !borrow()) return;
      wanted = { well, attrs };
      place();
    },

    /** The pointer or focus left `well`: its still shows again. */
    rest(well) {
      if (wanted?.well !== well) return;
      wanted = null;
      place();
    },
  });
}
