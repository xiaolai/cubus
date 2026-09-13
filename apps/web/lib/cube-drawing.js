// Drawing the cube: the one parked <cubus-cube> every screen reuses, the 2D net, its colours, and
// the theme and colour scheme they follow.
//
// Lifted out of app.js on 2026-09-13, when that file was split into modules.

// Translation is wired at the render choke points (nav labels, window titles, the scan aside,
// Settings) and is an identity function until a catalog registers — see dev-docs/i18n.md for the
// convention and for the surfaces still to be converted.
import { plural, t } from './i18n.js';
import { isScheme, paletteFor } from './scheme.js';

import { $, SOLVED, state } from './app-state.js';
import { DEFAULT_PALETTE, save, settings } from './app-settings.js';
import { classifyCube } from './cube-subject.js';

// ---- cube element helpers --------------------------------------------------------------------
//
// ONE renderer is kept alive across screen renders. Building a <cubus-cube> costs a WebGL
// context, ~150 meshes and a shader compile — 21-24ms measured in WebKit — and renderScreen()
// throws the whole screen away every time, including on renders that are not navigations at all:
// pressing Random re-enters the screen it is already on. Rebuilding the renderer to show the
// same kind of picture is the largest remaining cost of that.
//
// At most one is ever held, so the page never carries more than one idle GL context — and a cube
// that is neither re-attached nor parked releases itself rather than sitting on one (see
// cubus-cube.js, disconnectedCallback). The parked one OUTLIVES screens that have no cube, which
// is the whole point: coming back to Home from Settings must not pay for a new context either.
let parkedCube = null;

/** Is this a <cubus-cube> the renderer module has actually upgraded?
 *
 *  Until vendor/cubus-cube.js runs — and forever, if it fails to load, or in the node --test
 *  harness which deliberately loads no scripts — the tag is an unknown element with none of these
 *  methods on it. Re-use is an optimisation, so it must degrade to building a fresh element
 *  rather than take the app down: nothing here may be the reason a screen fails to mount. */
const isRenderer = (el) => Boolean(el) && typeof el.recycle === 'function' && typeof el.dispose === 'function';

/** Lift the screen's cube out of the stage before renderScreen wipes it, so it survives. */
export function parkCube() {
  const found = $('#stage')?.querySelector('cubus-cube');
  if (!isRenderer(found)) return; // nothing parkable here; whatever is already parked stays parked
  if (parkedCube && parkedCube !== found) { parkedCube.parked = false; parkedCube.dispose(); }
  found.parked = true;
  found.remove(); // detach BEFORE the innerHTML wipe, which would otherwise take it with it
  parkedCube = found;
}

/** The parked renderer, wiped back to its defaults — or a new one when there is none. */
function reuseCube() {
  const el = parkedCube;
  parkedCube = null;
  if (!isRenderer(el)) return document.createElement('cubus-cube');
  el.parked = false;
  // Every attribute back to its default, the puzzle solved, the camera on its fitted mark. A
  // caller that forgets to set something must get the renderer's default, never the last
  // screen's setting.
  el.recycle();
  return el;
}

/** What the 3D cube is SHOWING, in words. A canvas is nothing to a screen reader — the element
 *  had no role and no name at all, so the largest thing on most screens was silent. The label
 *  names the state rather than the picture, because the state is the information. */
function cubeLabelWords() {
  const c = state.cube;
  if (c.facelets === SOLVED) return t('A solved cube');
  const who = c.isPhysical ? t('Your cube') : t('A scrambled cube');
  return c.moves.length
    ? `${who} — ${plural(c.moves.length, { one: '%1 move from solved', other: '%1 moves from solved' })}`
    : who;
}

export function newCube({ animate = false } = {}) {
  const el = reuseCube();
  // A drawing, with a description. `role="img"` is what makes the label be READ rather than the
  // element being walked into as a container of nothing.
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', cubeLabelWords());
  // The stored key IS the renderer's attribute value — validated at load, so there is nothing
  // left to map. There used to be a PALETTE_ATTR identity map here, which read as a translation
  // between two vocabularies that have always been the same one.
  el.setAttribute('palette', settings.palette);
  // …and the arrangement that palette is read in: the scan's verdict for this cube, else what
  // the app assumes. Without it a Japanese cube is solved correctly and drawn wrong.
  el.setAttribute('scheme', drawScheme());
  // Off by default: every cube in the app is set up at a chosen angle (the ghost faces depend on
  // it), and a stray drag on a touch screen or a trackpad swung it away with no way back.
  el.setAttribute('orbit', settings.dragRotate ? 'free' : 'locked');
  const c = state.cube;
  // A walk is animated only when the alg it would animate is KNOWN — which now means the pool has
  // answered and `reaches()` has agreed the alg builds this very cube (takeSetupAlg). The setup
  // alg used to be a Kociemba search this call could force on the UI thread, so "walking" and
  // "the alg is in hand" were the same instant; they are not any more, and `scramble=""` draws a
  // SOLVED cube — one presented frame of a solved cube beside a scrambled walk, which is the
  // exact class the die invariant forbids ("the die solves before it swaps", AGENTS.md).
  //
  // So an unknown alg draws the ARRANGEMENT instead, with no animation, and loadWalk swaps the
  // attributes the moment the answer lands. Nothing waits, and nothing lies in the meantime.
  if (animate && classifyCube().solvable && c.setupAlg) {
    el.setAttribute('scramble', c.setupAlg);
    el.setAttribute('alg', c.solution || '');
  } else el.setAttribute('facelets', c.facelets);
  return el;
}

// ---- 2D net ----------------------------------------------------------------------------------
export const NET_FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
const NET_POS = { U: [1, 4], L: [4, 1], F: [4, 4], R: [4, 7], B: [4, 10], D: [7, 4] };
export function buildNet(root) {
  root.innerHTML = '';
  const cells = [];
  for (const f of NET_FACES) {
    const d = document.createElement('div'); d.className = 'face';
    const [r, col] = NET_POS[f]; d.style.gridRow = `${r}/span 3`; d.style.gridColumn = `${col}/span 3`;
    for (let i = 0; i < 9; i++) { const s = document.createElement('div'); s.className = 'sticker'; d.appendChild(s); cells.push(s); }
    root.appendChild(d);
  }
  // `?` means "this target does not fix this sticker" (lib/stage-picture.js) and becomes `free`,
  // which the stylesheet draws as an empty well. Mapped HERE rather than at the call site because
  // `?` is not a valid class token: `class="sticker ?"` matches no rule and renders as a plain
  // outline, which is what an unpainted net looks like — the failure would be invisible.
  return (facelets) => {
    for (let i = 0; i < 54; i++) cells[i].className = `sticker ${facelets[i] === '?' ? 'free' : facelets[i]}`;
  };
}
// Net sticker colours track the selected palette (puzzle data lives in cubus-cube's PALETTES; we
// mirror the muted set here for the flat net).
export const NET_COLORS = {
  muted: { U: '#E8E3D6', D: '#D8B84A', F: '#4E8C6A', B: '#3C6E9E', R: '#B8503F', L: '#C87A3C' },
  classic: { U: '#F4F2EC', D: '#F0C000', F: '#00A651', B: '#0051BA', R: '#C41E3A', L: '#FF6C00' },
  colorsafe: { U: '#EFEAE0', D: '#E9C46A', F: '#6A9FB5', B: '#20405C', R: '#D1495B', L: '#8C5E8A' },
};
/**
 * The net's colours for the cube being SHOWN — the palette remapped for its arrangement.
 *
 * `scheme` is the app's assumption; a cube the scan proved is drawn in ITS scheme instead, which
 * is what the argument is for. Only D and B ever move (ADR 0001 §2), and `lib/scheme.js` owns the
 * arithmetic so this file and the renderer cannot come to disagree about what Japanese means.
 */
export function netPalette(scheme = settings.scheme) {
  return paletteFor(NET_COLORS[settings.palette] || NET_COLORS[DEFAULT_PALETTE], scheme);
}

/**
 * The arrangement to DRAW a cube in: the one a scan established for it, else what the app
 * assumes. `'undetermined'` is a verdict about the colours, not a scheme — the state is known and
 * which colour sits under white is not — so it falls back to the assumption, and the scan screen
 * says so in words rather than silently picking (ADR 0001 §8.3).
 */
/**
 * Take a scan's verdict as the app's belief, and say so when it changes something.
 *
 * A DECISIVE scan is the only evidence there is about a cube's colours, so it outranks whatever
 * the app assumed and is remembered for the next one (`schemeSource: 'scan'`). The source is
 * recorded even when the value agrees, because "a scan confirmed this" and "nobody has said" are
 * different states and only one of them should still be offering to be corrected.
 *
 * A refusal never reaches here, and `'undetermined'` never reaches here: neither establishes
 * anything, and adopting either would turn an absence of evidence into a belief.
 */
export function adoptScheme(scheme) {
  if (!isScheme(scheme)) return;
  const changed = settings.scheme !== scheme;
  if (!changed && settings.schemeSource === 'scan') return;
  settings.scheme = scheme;
  settings.schemeSource = 'scan';
  save('cubusSettings', settings);
  applyNetColors();
  // It records; it does not speak. Whether a change is worth a sentence, and in whose voice,
  // belongs to the screen the user is looking at — the same rule that keeps "press Solve this
  // cube" out of the scanner package. Returns true when the belief actually moved.
  return changed;
}

function drawScheme(cube = state.cube) {
  return isScheme(cube?.scheme) ? cube.scheme : settings.scheme;
}

export function applyNetColors() {
  const p = netPalette(); const r = document.documentElement.style;
  for (const k of NET_FACES) r.setProperty('--net-' + k, p[k]);
}

// ---- theme -----------------------------------------------------------------------------------
export function applyTheme() {
  if (settings.theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', settings.theme);
}
