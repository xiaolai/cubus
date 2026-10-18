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
// THE SAME ELEMENT IS THE PULSE. Pointing at or focusing a photographed tile moves the renderer into that tile,
// unpinned, where the highlight breathes (the renderer freezes it under reduced motion); leaving puts it back in
// its slot. A grid at rest is stills only.

import { SOLVED as SOLVED_FACELETS } from './app-state.js';
import { newCube } from './cube-drawing.js';
import { caseOf, movedPieces } from './drill/case-of.js';
import { holdSpec } from './solving-hold.js';

/** The box a photograph is taken in, CSS px: the tile picture's shape the plan measured (§3.3) — a cube fits it
 *  height-bound, and contained into the 62×54 and 74×64 tile boxes it loses nothing to letterboxing. */
export const PHOTO_BOX = Object.freeze({ w: 110, h: 96 });

/**
 * The sets whose cases a photograph cannot tell apart as well as today's net does, so they keep the net — COMPUTED,
 * not chosen: at the 62×54 box, the photographs make more of their pairs look alike than the nets do (§3.3). Re-derived
 * both ways by test/browser/case-photos.test.mjs; widening or narrowing it is a measurement, never an edit.
 */
export const NET_KEPT = Object.freeze(['mehta-l5ep', 'cf-last-ledge', 'cf-middle-edges']);

/** The sets whose tiles are NOT marked, computed by the same rule: marking makes more of their pairs alike than the
 *  same pictures bare (§3.6). Re-derived both ways by the same browser suite. */
export const UNMARKED = Object.freeze(['mehta-l5ep', 'cf-last-ledge', 'cf-middle-edges']);

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

/** Forget every photograph — the object URLs released. The next asking takes each again. */
export function clearCasePhotos() {
  for (const p of cache.values()) p.then((url) => URL.revokeObjectURL(url), () => {});
  cache.clear();
}

/** The instant the renderer's clock is pinned at for a still: any number does; one, so every still is alike. */
const PIN = 1_000_000;

/**
 * The renderer's next frame, on its own clock — never a timer. The renderer's loop asked for this frame during the
 * last one, so its callback runs before ours: by the time ours runs, what was just set has been drawn. A photograph
 * read before that would be the case before it, which the browser suite's forwards-and-backwards case catches.
 */
const frame = () => new Promise((resolve) => { requestAnimationFrame(() => resolve()); });

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
  const queue = [];

  signal?.addEventListener('abort', () => {
    // Before the screen parks it: a pinned clock on a parked renderer freezes the next screen's cube.
    if (cube) cube.clock = null;
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
    look = [...el.attributes].filter((a) => !PHOTO_ATTRS.includes(a.name) && a.name !== 'role' && !a.name.startsWith('aria-'))
      .map((a) => `${a.name}=${a.value}`).sort().join(';');
    return cube;
  }

  const set = (attrs) => { for (const k of PHOTO_ATTRS) cube.setAttribute(k, attrs[k]); };

  /** Put the renderer where it belongs between photographs: live in the wanted tile, or back in its slot. */
  function place() {
    if (!cube || busy || signal?.aborted) return;
    const at = wanted?.well.isConnected ? wanted : null;
    if (!at) {
      if (cube.parentElement !== slot) { cube.clock = null; slot.appendChild(cube); }
      return;
    }
    cube.clock = null;
    set(at.attrs);
    if (cube.parentElement !== at.well) at.well.appendChild(cube);
  }

  async function shoot(attrs) {
    cube.clock = PIN;
    set(attrs);
    if (cube.parentElement !== slot) slot.appendChild(cube);
    await frame();
    if (signal?.aborted) return null;
    const blob = await new Promise((resolve) => { cube.querySelector('canvas').toBlob(resolve, 'image/png'); });
    if (!blob) throw new Error('case-photo: the renderer\'s canvas gave no picture');
    casePhotoCounts.taken += 1;
    return URL.createObjectURL(blob);
  }

  async function pump() {
    if (busy) return;
    busy = true;
    try {
      while (queue.length && !signal?.aborted) {
        const job = queue.shift();
        try { job.resolve(await shoot(job.attrs)); } catch (err) { job.reject(err); }
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
      const key = `${look}|${attrs.orientation}|${attrs.facelets}|${attrs.highlight}|${box.w}x${box.h}|${Math.min(devicePixelRatio, 2)}`;
      const kept = cache.get(key);
      if (kept) { casePhotoCounts.cached += 1; return kept; }
      const taken = new Promise((resolve, reject) => { queue.push({ attrs, resolve, reject }); });
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
