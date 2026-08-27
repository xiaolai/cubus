// Cubus app controller. Renders the designed multi-screen shell and wires it to the real
// engine: cubejs (independent oracle + random + validity), cubing.js (min2phase solve), and the
// YOLO camera scanner. The 3D cube is <cubus-cube> — it draws only; state and solving stay here.

import { summarize, times } from './solve-stats.js';
import { makeRouter } from './router.js';
// The smart-cube strands, recovered from v0 (2026-08-27): the transport seam (Web Bluetooth in a
// browser, native BLE events under Tauri), one durable record per cube, and the trust model that
// keeps "connected" from standing in for "known".
import { makeTauriTransport, makeWebBluetoothTransport } from './cube-transport.js';
import { MAX_LABEL, cubeLabel, forgetCube, listCubes, normaliseMac, parseRegistry, rememberCube, renameCube } from './cube-registry.js';
import { applyOffset } from './cube-trust.js';
// Translation is wired at the render choke points (nav labels, window titles, the scan aside,
// Settings) and is an identity function until a catalog registers — see dev-docs/i18n.md for the
// convention and for the surfaces still to be converted.
import { t, initLocale } from './i18n.js';

const $ = (sel, root = document) => root.querySelector(sel);
/** The app's version — written HERE and nowhere else by hand. The About card renders it, and a
 * test pins the manifests (apps/web/package.json, tauri.conf.json, the desktop Cargo.toml) equal
 * to it, so the five version fields this repo carries can no longer drift apart silently — the
 * About card spent months claiming 0.4.2 over manifests that all said 0.1.0. Exported for that
 * test, not as API. */
export const VERSION = '0.4.2';
const SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
const PALETTE_ATTR = { muted: 'muted', classic: 'classic', colorsafe: 'colorsafe' };
/** Escape text destined for an innerHTML template. Scramble strings, solve times and anything
 * else out of localStorage are untrusted input — storage is writable by anything on the origin —
 * and must never be parsed as markup. Screens that can use textContent do; this is for the ones
 * building an HTML string. */
const escHtml = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const load = (k, fb) => { try { return { ...fb, ...JSON.parse(localStorage.getItem(k) || '{}') }; } catch { return { ...fb }; } };
/** Persist, and say whether it worked. Storage can be full, or disabled outright in a private
 *  window — and the UI used to report "Saved" either way, so a nickname could vanish on reload
 *  with nothing having warned anyone. */
const save = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; }
};

// ---- inline icons (lucide paths; offline, no CDN) --------------------------------------------
const P = {
  house: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  // A cube face as a nine-grid, drawn twice: empty for Restore (a solved side), part-filled for
  // Scramble. The pair reads by contrast — order against disorder — which is the whole distinction
  // between the two screens. `fill` is a presentation attribute so it beats the `fill: none`
  // inherited from svg.ic; `stroke="none"` keeps a filled cell from looking a stroke-width bigger
  // than an empty one.
  grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>',
  'grid-filled': '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/><rect x="4" y="4" width="4" height="4" rx=".5" fill="currentColor" stroke="none"/><rect x="16" y="10" width="4" height="4" rx=".5" fill="currentColor" stroke="none"/><rect x="10" y="16" width="4" height="4" rx=".5" fill="currentColor" stroke="none"/>',
  timer: '<line x1="10" y1="2" x2="14" y2="2"/><line x1="12" y1="14" x2="15" y2="11"/><circle cx="12" cy="14" r="8"/>',
  chart: '<path d="M3 3v18h18"/><rect x="7" y="10" width="3" height="7"/><rect x="12" y="6" width="3" height="11"/><rect x="17" y="13" width="3" height="4"/>',
  cap: '<path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c0 1 3 2 6 2s6-1 6-2v-5"/>',
  repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2Z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7Z"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z"/><circle cx="12" cy="12" r="3"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  pause: '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'chevron-left': '<path d="m15 18-6-6 6-6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>',
  dice: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.2"/><circle cx="16" cy="16" r="1.2"/><circle cx="8" cy="16" r="1.2"/><circle cx="16" cy="8" r="1.2"/><circle cx="12" cy="12" r="1.2"/>',
  minus: '<path d="M5 12h14"/>',
  square: '<rect x="5" y="5" width="14" height="14" rx="1"/>',
  webcam: '<circle cx="12" cy="10" r="8"/><circle class="lens" cx="12" cy="10" r="3"/><path d="M7 22h10"/><path d="M12 22v-4"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  'paint-roller': '<rect width="16" height="6" x="2" y="2" rx="2"/><path d="M10 16v-2a2 2 0 0 1 2-2h8a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect width="4" height="6" x="8" y="16" rx="1"/>',
  // The About card's three row markers, drawn by hand in the same 24×24 stroke grammar as the
  // rest of this map — no icon library behind them, same as everything above.
  tag: '<path d="M12.6 2.6 21 11a2 2 0 0 1 0 2.8l-7.2 7.2a2 2 0 0 1-2.8 0L2.6 12.6A2 2 0 0 1 2 11.2V4a2 2 0 0 1 2-2h7.2a2 2 0 0 1 1.4.6Z"/><circle cx="7.5" cy="7.5" r="1.3"/>',
  bluetooth: '<path d="m7 7 10 10-5 5V2l5 5L7 17"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.3 4 5.6 4 9s-1.5 6.7-4 9c-2.5-2.3-4-5.6-4-9s1.5-6.7 4-9Z"/>',
  user: '<circle cx="12" cy="7.5" r="3.5"/><path d="M5 20.5c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>',
};
const icon = (name, size = 16) => `<svg class="ic" viewBox="0 0 24 24" style="width:${size}px;height:${size}px">${P[name] || '<circle cx="12" cy="12" r="2"/>'}</svg>`;

// ---- navigation model ------------------------------------------------------------------------
// One flat list. The SOLVE / PRACTICE / LEARN headings were a taxonomy for nine items, which is
// fewer than the number of rows a person can scan at a glance — the labels cost three lines of
// chrome and a level of hierarchy to sort a list short enough not to need sorting.
// The tabs, in order. Settings is not among them: it is the toolbar's trailing button, drawn by
// buildChrome, because it is not a stop on the way to a solved cube. The counts that used to sit
// beside Alg trainer, Drill and Lessons (78, 12, 9) were fixed numbers describing nothing; a tab
// carries no badge until there is something real to count.
const NAV = [
  ['home', 'Home', 'box'],
  ['scan', 'Restore', 'grid'],
  ['scramble', 'Scramble', 'grid-filled'],
  ['timer', 'Timer', 'timer'],
  ['stats', 'Stats', 'chart'],
  ['trainer', 'Alg trainer', 'cap'],
  ['drill', 'Drill', 'repeat'],
  ['lessons', 'Lessons', 'book'],
];
// Each screen's name. It is shown in the title bar rather than in a bar of its own, so there is no
// second line of chrome restating what the nav already highlights. The subtitles that used to sit
// under these were restatements of what each screen says itself, and went with the bar.
const TITLES = {
  home: 'Cube',
  scan: 'Restore',
  scramble: 'Scramble',
  timer: 'Timer',
  stats: 'Stats',
  trainer: 'Algorithm trainer',
  drill: 'Drill',
  lessons: 'Lessons',
  settings: 'Settings',
};

// ---- app state -------------------------------------------------------------------------------
const settings = load('cubusSettings', { theme: 'auto', palette: 'muted', inspection: true, autosolve: false, cameraId: '', navHidden: null, navDefaults: 0, devRandCube: false, language: '' });

/** The themes, as stored. Auto is a policy rather than a theme: cream while the system is light,
 * night while it is dark (tokens.css). */
const THEMES = ['auto', 'white', 'cream', 'night'];
// The names changed when White arrived: the kit's "light" is Cream and its "dark" is Night. A
// stored value from before is mapped rather than dropped, so nobody's window changes colour on
// update; anything else in that field is not a theme and falls back to auto.
{
  const mapped = { light: 'cream', dark: 'night' }[settings.theme]
    ?? (THEMES.includes(settings.theme) ? settings.theme : 'auto');
  if (mapped !== settings.theme) { settings.theme = mapped; save('cubusSettings', settings); }
}

/** Is the Advanced section revealed? Deliberately NOT part of `settings`, so it is not persisted:
 * a section you reach with an undocumented chord should start closed every time, not stay open
 * forever because you once looked at it. What it CONTROLS (navHidden) is a real preference and is
 * saved; the disclosure itself lasts for this page only.
 *
 * Earlier versions stored it, so drop any leftover key rather than letting `save()` keep rewriting
 * a field nothing reads. */
delete settings.advanced;
let advancedOpen = false;

/** Tabs the Advanced section can hide, in tab order. Hiding is cosmetic: the route
 * keeps working, so a deep link or a typed #/timer still gets you there. */
const HIDEABLE = [
  ['timer', 'Timer'],
  ['stats', 'Stats'],
  ['trainer', 'Alg trainer'],
  ['drill', 'Drill'],
  ['lessons', 'Lessons'],
];

/** Hidden unless asked for. Timer and Stats are speedcubing instruments, not part of learning to
 * solve a cube, and Stats currently shows representative numbers rather than yours — a screen of
 * invented data is worse than no screen. The default tab row is the beginner's path; everything
 * else is one chord away. */
const DEFAULT_HIDDEN = ['timer', 'stats'];
const NAV_DEFAULTS_VERSION = 1;

// localStorage is untrusted input: anything in here that is not a hideable id is dropped rather
// than allowed to silently remove some other nav entry.
const HIDEABLE_IDS = new Set(HIDEABLE.map(([id]) => id));
settings.navHidden = (Array.isArray(settings.navHidden) ? settings.navHidden : DEFAULT_HIDDEN)
  .filter((id) => HIDEABLE_IDS.has(id));

// A stored preference outranks a changed default, so shipping a new default alone would do nothing
// for anyone who has already run the app — their saved `navHidden: []` wins forever. Applied once,
// marked, and saved, so it neither repeats nor re-hides something deliberately brought back.
if (settings.navDefaults < NAV_DEFAULTS_VERSION) {
  settings.navHidden = [...new Set([...settings.navHidden, ...DEFAULT_HIDDEN])];
  settings.navDefaults = NAV_DEFAULTS_VERSION;
  save('cubusSettings', settings);
}
// Checked per call, not just once at load: a stored id that is not hideable must never be able to
// hide some OTHER nav entry (a stray "home" in there would take Home out of the toolbar).
const navHidden = (id) => HIDEABLE_IDS.has(id) && settings.navHidden.includes(id);
const state = {
  screen: 'home',
  // ---- smart cube (recovered from v0) ---------------------------------------------------------
  connected: false,
  cubeName: '',
  cubeMac: '',
  /** Battery percent, or null until the cube answers — it replies on request only, and inventing
   *  a figure here is exactly what this replaced. */
  battery: null,
  // Not persisted: it describes the live connection, and a new one starts unanchored.
  anchored: false,
  cube: {
    facelets: SOLVED, setupAlg: '', solution: '', moves: [], solvable: false, stepFacelets: [],
    // ---- trust ------------------------------------------------------------------------
    // Do we currently KNOW what this cube looks like? Deliberately not derived from
    // `state.connected`: a paired cube is not a trusted one. A cube reports how far it has been
    // turned since it was last told where it was — disconnect it, turn it, reconnect, and it
    // reports a state that is confidently wrong. Conflating the two is the bug this models away.
    trusted: false,
    source: 'none',     // 'none' | 'camera' | 'cube' | 'generated' — what last established it
    staleWhy: '',       // why trust lapsed, for a UI that must explain rather than just refuse
    // Is the arrangement on screen the cube in your HAND? Knowing an arrangement and holding it
    // are different claims. A generated cube is perfectly known and is not yours, so a guide
    // built from one must not be driven by your turns.
    isPhysical: false,
    // The constant correction between what the cube reports and what it physically is, or null.
    // Derived from ONE camera scan (see lib/cube-trust.js); never persisted, and cleared on
    // disconnect — yesterday's correction applied to today's readings is a wrong answer wearing
    // the costume of a right one.
    offset: null,
    offsetAt: 0, // when the correction was derived, so Settings can say so
  },
  /** The connected cube's TRUE arrangement — its last report with any correction applied. Kept
   *  apart from `cube.facelets`, which is whatever the app is currently about. */
  live: null,
  /** The same report, uncorrected. Only a repair may use this: an offset derived against
   *  corrected truth is the identity, which discards the correction that made it look right. */
  reported: null,
};

// ---- solver pipeline (cubejs oracle + cubing.js solve), lazy-loaded --------------------------
let Cube = null, solverReady = false, cjSolve = null, cjPuzzle = null;
const invMove = (m) => (m.endsWith('2') ? m : m.endsWith("'") ? m[0] : m + "'");

// Single-flight: boot and an async screen mount both call this, and initSolver() builds the
// Kociemba tables — running it twice is seconds of wasted main-thread work, and both callers
// racing on `Cube` is worse. The in-flight promise is shared; a failure clears it so a later
// call can retry rather than being stuck with a rejected one.
let solverLoading = null;
async function loadSolver() {
  if (solverReady) return true;
  solverLoading ??= (async () => {
    try {
      Cube = (await import('../vendor/cubejs.js')).default;
      Cube.initSolver();
      solverReady = true;
      return true;
    } catch {
      solverLoading = null;
      return false;
    }
  })();
  return solverLoading;
}

// Given a scanned/known facelet state, derive the setup alg (solved -> scrambled, for the 3D
// animation) and whether it needs solving. cubejs is the oracle here.
//
// PRECONDITION: `f` must be a SOLVABLE cube, not merely a well-formed string. cubejs's solve() is
// a Kociemba search that assumes solvability; hand a it a state with the right colour counts and
// centres but broken parity and it searches forever, freezing the tab — no throw, no timeout. Both
// callers hold up their end: assembleColors clears a scan through the parity gate before emitting
// it, and the driver's facelets come from hardware the state invariant checks. A future caller
// that does neither would hang here, and nothing in this function can tell.
// Ingesting a state and DERIVING from it are separate costs, and they used to be one call.
//
// Storing facelets is free. Working out the setup alg is a full Kociemba search, and it ran on
// every arriving snapshot — the cube emits those at ~1Hz for as long as it is connected, on the
// UI thread, for a solution most of them never need. Screens that want the derived values ask for
// them; the live path just records what the cube says.
function ingestFacelets(f) {
  const c = state.cube;
  c.facelets = f;
  c.solution = ''; c.moves = []; c.stepFacelets = [];
  c.setupAlg = ''; c.derived = false;
}

/** Derive setupAlg/solvable from the stored facelets. Idempotent; cheap after the first call.
 *  Every reader of `solvable` or `setupAlg` must go through here first. */
function deriveCube() {
  const c = state.cube;
  if (c.derived) return c;
  if (!solverReady) {
    // Without a solver the best we can say is "not the solved state". Deliberately NOT marked
    // derived, so the real derivation still happens once the solver arrives.
    c.setupAlg = '';
    c.solvable = c.facelets !== SOLVED;
    return c;
  }
  c.derived = true;
  try {
    const sol = Cube.fromString(c.facelets).solve();
    const moves = sol.trim() ? sol.trim().split(/\s+/) : [];
    c.setupAlg = moves.slice().reverse().map(invMove).join(' ');
    c.solvable = moves.length > 0;
  } catch { c.setupAlg = ''; c.solvable = false; }
  return c;
}

/** Ingest AND derive — for callers that are about to use the result immediately. */
function setFacelets(f) {
  ingestFacelets(f);
  deriveCube();
}

// Compute the animated solution with cubing.js (min2phase) and cross-check it against cubejs.
async function solve() {
  const c = state.cube;
  // If a state arrived before the solver was ready, its setup alg is stale — recompute now.
  if (solverReady && c.facelets !== SOLVED && !c.setupAlg) deriveCube();
  if (c.solution) return c.solution;
  if (!cjSolve) {
    // Vendored, not fetched: see vendor-cubing.mjs. Both entry points come from one bundle, and
    // its Web Worker lives beside it as vendor/search-worker-entry.js.
    ({ experimentalSolve3x3x3IgnoringCenters: cjSolve, cube3x3x3: cjPuzzle } = await import('../vendor/cubing.js'));
  }
  const kpuzzle = await cjPuzzle.kpuzzle();
  const pattern = kpuzzle.defaultPattern().applyAlg(c.setupAlg);
  const solution = (await cjSolve(pattern)).toString();
  const moves = solution.trim() ? solution.trim().split(/\s+/) : [];
  // Oracle cross-check: only a definite refutation (parses AND does not solve) blocks.
  let verified = null;
  try { verified = Cube.fromString(c.facelets).move(solution).isSolved(); } catch (err) {
    // Deliberately non-blocking: an oracle that cannot PARSE the alg has refuted nothing, and
    // failing closed here would take solving down whenever cubing.js emits notation cubejs does
    // not read. But it must not be silent — a cross-check that quietly stops running looks
    // exactly like one that keeps passing.
    console.warn('cubejs cross-check could not run; solution accepted unverified', err);
  }
  if (verified === false) throw new Error('solver cross-check failed — re-scan');
  // Per-step facelets so the 2D net + move list can co-move with the 3D animation.
  const sf = [];
  // A short array is not fatal — the move chips fall back to jumping without the intermediate
  // states — but it is never expected, so it says so rather than degrading quietly.
  try { const b = Cube.fromString(c.facelets); sf.push(b.asString()); for (const m of moves) { b.move(m); sf.push(b.asString()); } } catch (err) {
    console.warn('per-step facelets unavailable; the move list will jump rather than step', err);
  }
  c.solution = solution; c.moves = moves; c.stepFacelets = sf;
  return solution;
}

// Rough CFOP stage split of a min2phase solution for display chunking (proportional, not exact
// CFOP — min2phase is two-phase, so this is a readable approximation labelled as such).
function stageSplit(n) {
  if (!n) return [];
  const cut = [Math.round(n * 0.16), Math.round(n * 0.62), Math.round(n * 0.82), n];
  const names = ['CROSS', 'F2L', 'OLL', 'PLL'];
  const out = []; let a = 0;
  for (let i = 0; i < 4; i++) { const b = cut[i]; if (b > a) out.push([names[i], a, b]); a = b; }
  return out;
}

// ---- cube element helpers --------------------------------------------------------------------
function newCube({ animate = false } = {}) {
  const el = document.createElement('cubus-cube');
  el.setAttribute('palette', PALETTE_ATTR[settings.palette] || 'muted');
  const c = state.cube;
  if (animate && deriveCube().solvable) { el.setAttribute('scramble', c.setupAlg); el.setAttribute('alg', c.solution || ''); }
  else el.setAttribute('facelets', c.facelets);
  return el;
}

// ---- 2D net ----------------------------------------------------------------------------------
const NET_FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
const NET_POS = { U: [1, 4], L: [4, 1], F: [4, 4], R: [4, 7], B: [4, 10], D: [7, 4] };
function buildNet(root) {
  root.innerHTML = '';
  const cells = [];
  for (const f of NET_FACES) {
    const d = document.createElement('div'); d.className = 'face';
    const [r, col] = NET_POS[f]; d.style.gridRow = `${r}/span 3`; d.style.gridColumn = `${col}/span 3`;
    for (let i = 0; i < 9; i++) { const s = document.createElement('div'); s.className = 'sticker'; d.appendChild(s); cells.push(s); }
    root.appendChild(d);
  }
  return (facelets) => { for (let i = 0; i < 54; i++) cells[i].className = 'sticker ' + facelets[i]; };
}
// Net sticker colours track the selected palette (puzzle data lives in cubus-cube's PALETTES; we
// mirror the muted set here for the flat net).
const NET_COLORS = {
  muted: { U: '#E8E3D6', D: '#D8B84A', F: '#4E8C6A', B: '#3C6E9E', R: '#B8503F', L: '#C87A3C' },
  classic: { U: '#F4F2EC', D: '#F0C000', F: '#00A651', B: '#0051BA', R: '#C41E3A', L: '#FF6C00' },
  colorsafe: { U: '#EFEAE0', D: '#E9C46A', F: '#6A9FB5', B: '#20405C', R: '#D1495B', L: '#8C5E8A' },
};
function applyNetColors() {
  const p = NET_COLORS[settings.palette] || NET_COLORS.muted; const r = document.documentElement.style;
  for (const k of NET_FACES) r.setProperty('--net-' + k, p[k]);
}

// ---- theme -----------------------------------------------------------------------------------
function applyTheme() {
  if (settings.theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', settings.theme);
}

// ---- host ------------------------------------------------------------------------------------
// The app runs as a plain web page and inside the Tauri window, and the two draw their chrome
// differently. This is not a smart-cube leftover: it is what tells a real window from a preview.
const isTauri = typeof window.__TAURI__ !== 'undefined';

// Which window chrome to draw (paper-one platform.ts): a UA sniff is enough — the platform can't
// change under a running window. `?platform=macos|windows|linux` pins it for design review
// (persisted); `?platform=auto` clears.
function detectPlatform() {
  try {
    const q = new URLSearchParams(window.location.search).get('platform');
    if (q === 'macos' || q === 'windows' || q === 'linux') { localStorage.setItem('cubus.platform', q); return q; }
    if (q === 'auto') localStorage.removeItem('cubus.platform');
    const s = localStorage.getItem('cubus.platform'); if (s) return s;
  } catch {}
  const ua = navigator.userAgent;
  if (/Mac|iPhone|iPad|iPod/.test(ua)) return 'macos';
  if (/Win/.test(ua)) return 'windows';
  return 'linux';
}

// Wire the drawn caption buttons to the Tauri window (no-ops in a browser preview).
//
// Load-bearing, not decoration: on Windows and Linux the window is created without decorations
// (tauri.windows.conf.json / tauri.linux.conf.json), so these are the only minimise, maximise and
// close the user has. A rejection here means a capability is missing from
// src-tauri/capabilities/default.json — say so, rather than leave a button that silently does
// nothing. This used to be defined and never called, which nothing noticed while the bar was
// hidden on those platforms.
function wireWindowButtons(root) {
  if (!isTauri) return;
  const win = window.__TAURI__?.window?.getCurrentWindow?.();
  if (!win) { console.error('window controls: the Tauri window API is not exposed'); return; }
  const on = (sel, fn) => root.querySelector(sel)?.addEventListener('click', () => {
    void Promise.resolve(fn()).catch((e) => console.error('window control failed', e));
  });
  on('[data-win="min"]', () => win.minimize());
  on('[data-win="max"]', () => win.toggleMaximize());
  on('[data-win="close"]', () => win.close());
}

// Build the title bar's two outer zones per platform (paper-one TitleBar, with the navigation now
// in the bar). The tabs between them are renderNav's. macOS leads with the traffic-light gap — the
// OS paints the real lights there; `?chrome=preview` draws three dots in a browser — then the
// wordmark, and trails with Settings. Windows/Linux lead with the wordmark and trail with Settings
// and the caption buttons. Caption buttons are drawn only where they can act: in the Tauri window,
// or in an explicit preview. A browser tab on Windows used to get a close button that closed
// nothing.
function buildChrome(platform) {
  const lead = document.getElementById('tbLead');
  const trail = document.getElementById('tbTrail');
  if (!lead || !trail) return;
  const preview = !isTauri && new URLSearchParams(window.location.search).get('chrome') === 'preview';
  // alt="" on purpose: the wordmark beside it already names the app, so the mark is decorative and
  // a screen reader should not say "cubus" twice.
  const brand = '<div class="brand"><img class="mark" src="./icons/icon.svg" alt="" width="20" height="20" /><b>cubus</b></div>';
  // The smart-cube presence, global because the connection is: green and pulsing while tracking,
  // amber and still when the position is unverified, absent when no cube is connected. It sits
  // before Settings and clicks through to it — Settings is where the cube is managed. Painted by
  // paintTrust(); hidden is its boot state.
  const cubeLive = `<button class="tb-ctl tb-live" id="cubeLive" hidden data-nav="settings">${icon('bluetooth', 17)}</button>`;
  const gear = `<button class="tb-ctl" data-nav="settings" title="Settings" aria-label="Settings">${icon('settings', 18)}</button>`;
  const cap = (name, win, round = false) => `<button class="tb-cap ${win}${round ? ' round' : ''}" data-win="${win}" title="${win}">${icon(name, round ? 14 : 16)}</button>`;
  if (platform === 'macos') {
    const lights = preview ? ['#E8695E', '#E0B341', '#5FB55F'].map((c) => `<span class="tl" style="background:${c}"></span>`).join('') : '';
    lead.innerHTML = `<span class="tb-lights">${lights}</span>${brand}`;
    trail.innerHTML = cubeLive + gear;
  } else {
    const round = platform === 'linux';
    lead.innerHTML = brand;
    trail.innerHTML = cubeLive + gear + ((isTauri || preview)
      ? `<span class="tb-zone tb-caption ${platform}">${cap('minus', 'min', round) + cap('square', 'max', round) + cap('x', 'close', round)}</span>`
      : '');
    wireWindowButtons(trail);
  }
  // All of them: the gear AND the cube-live indicator both land on Settings.
  for (const b of trail.querySelectorAll('[data-nav="settings"]')) b.onclick = () => go('settings');
}

/**
 * Name the screen where the platform shows names: the document title (a browser tab) and the
 * window title (the taskbar and the window switcher). The bar itself no longer draws it — the
 * filled tab is the name.
 */
function setTitle(name) {
  document.title = `${name} · Cubus`;
  // The NATIVE window title is only retitled off macOS. On undecorated Windows/Linux windows it
  // surfaces in the taskbar and Alt-Tab, so it is worth keeping current there; on macOS the
  // overlay titlebar hides it entirely (hiddenTitle) AND `setTitle:` makes AppKit rebuild the
  // titlebar — which snapped the traffic lights back to Apple's default position on every in-app
  // navigation. A label nobody can see is not worth moving window furniture: macOS keeps the
  // conf's static "Cubus", and the Rust shell places the lights deterministically (lib.rs).
  if (isTauri && document.documentElement.dataset.platform !== 'macos') {
    // try/catch only covers the synchronous reach into the API — a rejected setTitle() would
    // escape it as an unhandled rejection, so the promise gets its own catch. It logs rather
    // than swallows: this call was rejected for as long as the capability file lacked
    // core:window:allow-set-title, and nothing said so — the title simply never changed.
    try {
      window.__TAURI__?.window?.getCurrentWindow?.()?.setTitle?.(`${name} · Cubus`)
        ?.catch?.((e) => console.error('window title not set', e));
    } catch (e) { console.error('window title not set', e); }
  }
}

// ---- smart cube: connection, registry, trust (recovered from v0) -----------------------------

let conn = null, transport = null;

// One durable record per cube. Only durable facts live here — trust, the tracking offset, the
// battery and the anchor flag are properties of a CONNECTION and are deliberately excluded
// (see lib/cube-registry.js).
let cubes = parseRegistry(load('cubusCubes', {}));

/** The address a bare "Pair" should try: whichever cube was used most recently. */
const lastCubeMac = () => listCubes(cubes)[0]?.mac || '';

/** The cube screen installs these while following. Moves are the SIGNAL — the cube reports one
 * per turn, immediately. Facelet snapshots arrive at ~1Hz and are the CORRECTION: they say where
 * the cube really is when the move stream and the guide have drifted apart. */
let liveMove = null;
let liveGap = null;
/** An anchor in flight. Module-level on purpose: dropping trust re-renders Settings, so a flag
 *  declared inside the mount would be reset by the very repaint the guard exists to survive. */
let anchoring = false;
/** A screen's reaction to losing the cube, beyond the trust model's own. Cleared on navigation. */
let onCubeLost = null;

/** The cube is gone — dropped, or deliberately let go. ONE body, used by the driver's event, the
 *  Disconnect button and the failure path in connectOnce. Idempotent. */
function onDisconnect() {
  conn = null;
  if (onCubeLost) { try { onCubeLost(); } catch {} }
  // Order matters: mark stale BEFORE setConnected, so the indicator repaints once, already
  // knowing the truth, rather than flashing "connected and fine" on its way out.
  markStale('it disconnected, and may have been turned since');
  // Across a disconnect the cube may sleep, reset its own counters, or be turned. The offset
  // corrected a specific chain to reality at a moment; that chain is gone.
  clearOffset();
  setConnected(false);
}

/** Throw the correction away. NOT called on `gap`: a serial skip means moves were missed, not
 *  that the reference moved — what was lost is the moves in between, not the relationship. */
function clearOffset() {
  state.cube.offset = null;
  state.cube.offsetAt = 0;
}

/** A missed move serial. Trust lapses HERE rather than in a screen's handler, so a gap arriving
 *  while you are in Settings is not dropped; the screen still gets told so it can stand down. */
function onGap(g) {
  markStale(`${g.missing} turn${g.missing === 1 ? '' : 's'} went unrecorded`);
  if (liveGap) liveGap(g);
}

/** Record a live connection. The registry write and the connected flag are ONE step on purpose:
 *  as two, the test seam and the real path each had a copy, and a regression passed every test. */
function adoptConnection(mac, name) {
  cubes = rememberCube(cubes, { mac, name, at: Date.now() });
  save('cubusCubes', cubes);
  // A new connection starts knowing nothing about this cube. Trust and the last report belong to
  // the chain that just ended: inheriting them let a freshly paired cube be treated as verified
  // on the strength of a camera scan of some *other* cube.
  state.live = null;
  state.reported = null;
  clearOffset();
  markStale('it has just connected, and has not been checked yet');
  setConnected(true, name, mac);
}

/** What to call the connected cube. The user's own word wins; the cube's own name is the
 *  fallback. One helper so a nickname cannot appear on one screen and not another. */
const liveCubeLabel = () =>
  cubeLabel({ ...cubes[state.cubeMac], mac: state.cubeMac, name: state.cubeName }) || 'Smart cube';

/** Read the cube's battery and publish it. The cube answers on request only. */
async function refreshBattery() {
  if (!conn) return;
  // Scoped to the connection that asked: a slow reply from a cube you have since disconnected
  // must not land as the current cube's battery level.
  const asked = conn;
  try {
    const ev = await conn.requestBattery();
    if (conn !== asked) return;
    const level = Number(ev?.level);
    if (Number.isFinite(level)) {
      state.battery = Math.max(0, Math.min(100, Math.round(level)));
      // A reply can land while someone is typing a nickname or an address into this very card,
      // and rebuilding the card discards what they typed — so the redraw is deferred, not faked.
      const editing = document.activeElement;
      const midEdit = Boolean(editing && (editing.id === 'macIn' || editing.dataset?.renameCube));
      if (state.screen === 'settings' && !midEdit) renderScreen();
    }
  } catch {
    if (conn !== asked) return;
    // A cube that will not answer its battery is still a usable cube. Leave the level unknown
    // and let the UI say so, rather than drawing a fictional meter.
    state.battery = null;
  }
}

/** Everything on screen that is derived from trust, repainted together. Trust is the one claim
 *  this model exists to make honestly; every place that repeats it changes at the same moment. */
function trustChanged() {
  const live = $('#cubeLive');
  if (live) paintTrust(live);
  const read = $('#readCubeBtn');
  if (read) {
    const label = state.cube.trusted
      ? 'Show the cube in your hand'
      : 'Your cube has lost count — see how to fix it';
    read.setAttribute('aria-label', label);
    read.title = label;
  }
  // Settings derives its setup checklist from trust; skipped while an input there has focus, for
  // the same reason the battery redraw is.
  const editing = document.activeElement;
  const midEdit = Boolean(editing && (editing.id === 'macIn' || editing.dataset?.renameCube));
  if (state.screen === 'settings' && !midEdit) renderScreen();
}

/** We now know what the cube looks like, and by what means. */
function markTrusted(source) {
  if (state.cube.trusted && state.cube.source === source) return;
  state.cube.trusted = true;
  state.cube.source = source;
  state.cube.staleWhy = '';
  trustChanged();
}

/** Something happened that we cannot see through. The state is NOT discarded — a loudly-flagged
 *  stale cube is more useful than an empty screen. */
function markStale(why) {
  if (!state.cube.trusted && state.cube.staleWhy === why) return;
  state.cube.trusted = false;
  state.cube.staleWhy = why;
  trustChanged();
}

/** One indicator, three states — absent, stale, trusted — because "connected" was never the
 *  question a user needs answered. */
function paintTrust(el) {
  const on = state.connected;
  el.hidden = !on;
  if (!on) return;
  const ok = state.cube.trusted;
  el.classList.toggle('stale', !ok);
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  const who = liveCubeLabel();
  el.setAttribute('aria-label', ok
    ? `${who}: tracking`
    : `${who}: position unverified — ${state.cube.staleWhy || 'read the cube again'}`);
  el.title = ok
    ? `${who} connected${Number.isFinite(state.battery) ? ` · ${state.battery}% battery` : ''} · tracking`
    : `${who} connected, but ${state.cube.staleWhy || 'its position is unverified'} — read the cube again`;
}

function setConnected(on, name = '', mac = '') {
  // Compared so a call that changes nothing does not re-render: doConnect's failure path calls
  // setConnected(false) while already disconnected, and the resulting teardown discarded the DOM
  // the caller's catch was about to write its error into.
  const before = `${state.connected}|${state.cubeName}|${state.cubeMac}`;
  state.connected = on; state.cubeName = name; state.cubeMac = on ? normaliseMac(mac) : '';
  state.battery = null;
  // The anchor belongs to a connection, not to the app.
  if (!on) state.anchored = false;
  const live = $('#cubeLive');
  if (live) paintTrust(live);
  if (state.screen === 'settings' && before !== `${state.connected}|${state.cubeName}|${state.cubeMac}`) {
    renderScreen();
  }
}

let connecting = null;
async function doConnect(macFromUi) {
  // Single-flight: two overlapping attempts raced through the shared transport/conn state, the
  // loser tearing down the winner's transport half-way through its own handshake.
  if (connecting) return connecting;
  connecting = (async () => {
    try { return await connectOnce(macFromUi); } finally { connecting = null; }
  })();
  return connecting;
}

async function connectOnce(macFromUi) {
  if (transport) { try { await transport.disconnect(); } catch {} transport = null; conn = null; }
  try {
    const { GanCube } = await import('../vendor/gan-driver.js');
    let mac = (macFromUi || lastCubeMac() || '').trim(), name = 'GAN cube';
    if (isTauri) {
      transport = makeTauriTransport(); await transport.start();
      // Let go of any link the Rust side still holds. A page reload loses every scrap of JS
      // state but NOT the Rust peripheral — and a cube that is still connected does not
      // advertise, so the fresh scan below would stare into silence for its whole window while
      // a second CoreBluetooth manager wedges against the first. Fast no-op when nothing is held.
      try { await window.__TAURI__.core.invoke('disconnect_cube'); } catch {}
      const info = await window.__TAURI__.core.invoke('connect_cube');
      name = info.name || name; mac = info.mac || mac;
      if (!mac) throw new Error('cube MAC unavailable — enter it and reconnect');
    } else {
      if (!navigator.bluetooth) throw new Error('Web Bluetooth unavailable in this browser');
      if (!mac) throw new Error('enter your cube’s address first');
      transport = makeWebBluetoothTransport(); await transport.start();
    }
    const cube = new GanCube({ mac, transport });
    cube.onFacelets((f) => { onFacelets(f.facelets); });
    // Subscribe the move stream too: following runs on moves (immediate), snapshots (~1Hz) only
    // correct drift — a turn sequence completed inside one second has no intermediate snapshots.
    cube.onMove((m) => { if (liveMove) liveMove(m); });
    cube.on('gap', onGap);
    cube.on('disconnect', onDisconnect);
    cube.on('error', () => {});
    cube.connect(); conn = cube;
    adoptConnection(mac, name);
    cube.getState({ active: true }).then((f) => onFacelets(f.facelets)).catch(() => {});
    // Ask the cube rather than inventing a number — a flat battery is what disconnects a cube
    // mid-solve, and a mid-solve disconnect is what silently desyncs its tracking from reality.
    void refreshBattery();
  } catch (err) {
    try { if (transport) await transport.disconnect(); } catch {}
    transport = null; onDisconnect();
    throw err;
  }
}

/** Make `facelets` the arrangement the app is about.
 *  `physical` says whether it is the cube in the user's hand — a scan or a confirmed cube report
 *  is; a generated scramble is not, however well we know it. */
function adoptCube(facelets, { physical, source } = { physical: false, source: 'generated' }) {
  ingestFacelets(facelets);
  state.cube.isPhysical = physical;
  markTrusted(source);
}

/** A snapshot from the connected cube. Always records what the cube says; only changes the
 *  SUBJECT when the subject is that cube — otherwise pressing Random would have its arrangement
 *  quietly replaced by the real one a second later. */
function onFacelets(reported) {
  if (!reported) return;
  // What the cube literally said, before any correction. A repair derives the offset from the
  // RAW report — deriving it from a corrected one produces the identity.
  state.reported = reported;
  // The ONE place a correction is applied to the stream.
  const f = applyOffset(state.cube.offset, reported, Cube);
  if (f === null) {
    // A report that could not be established as truth is not a fact about the cube; and `live`
    // is cleared rather than left behind, or a current position and a stale one become
    // indistinguishable downstream.
    state.live = null;
    markStale('its last report could not be checked');
    return;
  }
  state.live = f;
  if (state.cube.isPhysical) {
    if (f === state.cube.facelets) return;
    // ingest, not set: a snapshot from the cube must not cost a Kociemba search.
    ingestFacelets(f);
  }
  if (liveUpdate) liveUpdate(f);
  else if (state.screen === 'home') renderScreen();
}

// ---- session store (recent solves) -----------------------------------------------------------
// There used to be five fabricated solves here, handed to anyone whose session was empty — so a
// person who had never solved a cube was shown their "recent solves", complete with turn rates.
// An empty session now reads as empty. Placeholder data that looks real is worse than nothing,
// and this is the screen where that costs the most.
/** Solves from storage, normalised. This is the boundary: `cubusSolves` is written by anything on
 *  the origin and edited by anyone with devtools, so `{list: null}` or a list of strings must
 *  become an empty session rather than reaching a `.slice` or an innerHTML template. Fields are
 *  whitelisted for the same reason the cube registry whitelists its own. */
function recentSolves() {
  const raw = load('cubusSolves', { list: [] }).list;
  if (!Array.isArray(raw)) return [];
  // Mapped, never filtered. Dropping a corrupt row closes the gap it left, so the "last five
  // solves" becomes five solves that were not the last five — and an ao5 computed over them looks
  // perfectly reasonable. An unusable row stays in place as a record with no usable time, which
  // is what makes averageOf() refuse rather than quietly reach further back.
  const ok = (s) => s && typeof s === 'object' && !Array.isArray(s);
  return raw.map((s) => ({
    n: ok(s) && Number.isSafeInteger(s.n) && s.n > 0 ? s.n : 0,
    time: ok(s) && typeof s.time === 'string' ? s.time : '',
    scramble: ok(s) && typeof s.scramble === 'string' ? s.scramble : '',
    at: ok(s) && Number.isSafeInteger(s.at) && s.at > 0 ? s.at : 0,
  }));
}

function pushSolve(time) {
  const list = recentSolves();
  save('cubusSolves', {
    list: [
      // Highest n, not the first row's. Corrupt rows keep their place with a placeholder n of 0,
      // so reading position zero could restart numbering at 1 half-way through a session.
      { n: list.reduce((hi, s) => Math.max(hi, s.n || 0), 0) + 1, time, scramble: currentScramble || '—', at: Date.now() },
      ...list,
      // 100, not 50. Stats offers an ao100, and a 50-record history made that statistic
      // unreachable by construction — a number on screen that could never stop being an em dash.
      // The retained span also has to outlast the seven-day chart drawn beside it.
    ].slice(0, 200),
  });
}

let currentScramble = '';
function randomScramble() {
  if (!solverReady) return '';
  const r = Cube.random();
  const sol = r.solve();
  currentScramble = sol ? sol.split(/\s+/).reverse().map(invMove).join(' ') : '';
  return r.asString();
}

export { state };

// ===============================================================================================
// Screens
// ===============================================================================================
const SCREENS = {};
/** Drop a fixed-position `.menu` under a corner button, clamped inside the viewport. */
const placeMenuUnder = (btn, menu) => {
  const r = btn.getBoundingClientRect();
  const w = menu.offsetWidth;
  menu.style.left = `${Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8)}px`;
  menu.style.top = `${r.bottom + 6}px`;
};

let cleanup = null;

/** Bumped by every render. An async mount that awaits a solver load or a Kociemba search can
 * outlive the screen that started it; comparing this on the far side of an await is how such a
 * mount learns it is obsolete and stops before writing to shared state like `liveUpdate`. */
let screenGen = 0;
// Set by a screen that can take a new cube state in place, so a fresh scan repaints rather than
// re-mounting — which on the cube screen would restart an animation the user is halfway through.
let liveUpdate = null;
// Restore — the screen that reads your cube so it can be solved. Its route id stays `scan`, and
// renaming it is not worth breaking every #/scan link and bookmark already in the wild.
// The camera opens the moment this screen mounts — <ai-scan-panel headless autostart>
// sits in the markup invisibly, owning the camera, the model and the capture state machine, and
// reports every change through `scan-progress`. The whole six-face flow happens right here: no
// modal, and deliberately no camera picture. What the user needs to see is what the scanner READ,
// so the live 3x3 below is the viewfinder. Colour class i <-> FACES[i] <-> NET_FACES[i], so a
// scanned sticker is painted in the app's own palette, matching the 3D cube beside it.
const SCAN_FACE_NAME = { U: 'Up', R: 'Right', F: 'Front', D: 'Down', L: 'Left', B: 'Back' };
// Which side neighbours each face, in the canonical URFDLB facelet layout — so a tile can paint
// its four edges in the neighbours' colours and show, without words, which way up to hold that
// side. Not invented here: derived from EDGE_FACELET in packages/cube-scanner/src/facelet-cube.ts,
// whose twelve facelet pairs give all 24 (face, side) answers. A test in that package re-derives
// it and asserts this exact table, so a layout change fails there and names this file.
const FACE_EDGES = {
  U: { top: 'B', right: 'R', bottom: 'F', left: 'L' },
  R: { top: 'U', right: 'B', bottom: 'D', left: 'F' },
  F: { top: 'U', right: 'R', bottom: 'D', left: 'L' },
  D: { top: 'F', right: 'R', bottom: 'B', left: 'L' },
  L: { top: 'U', right: 'F', bottom: 'D', left: 'B' },
  B: { top: 'U', right: 'L', bottom: 'D', left: 'R' },
};

SCREENS.scan = () => {
  const pal = NET_COLORS[settings.palette] || NET_COLORS.muted;
  const classColor = (i) => pal[NET_FACES[i]] || 'var(--facelet-off)';
  // background-COLOR, not the shorthand: a colour is all this ever sets, and the shorthand would
  // reset background-image and friends alongside it. (It is also the only form a DOM can report
  // back reliably — happy-dom drops `style.background = '#hex'` silently, which quietly blinded
  // every test that tried to assert what a sticker had been painted.)
  // Face letters are positions; a person checking their cube sees colours. Same scheme the
  // scanner's own GUIDE uses, and the same one every palette here is built on.
  const COLOUR_OF = { U: 'white', R: 'red', F: 'green', D: 'yellow', L: 'orange', B: 'blue' };
  const cell = (bg) => `<i class="cell" style="background-color:${bg}"></i>`;
  // A pending tile is nine dim wells with the face's own colour in the centre, so the board reads
  // "the yellow side is still missing" without a legend.
  const pending = (f) => Array.from({ length: 9 }, (_, i) => cell(i === 4 ? pal[f] : 'var(--facelet-off)')).join('');
  // border-color takes top/right/bottom/left in that order — the same order FACE_EDGES names.
  const e = (f) => FACE_EDGES[f];
  const edgeColors = (f) => `${pal[e(f).top]} ${pal[e(f).right]} ${pal[e(f).bottom]} ${pal[e(f).left]}`;
  // The panel is registered by a module script; if that has not landed yet the element is still
  // inert, so say so rather than claiming a camera is opening.
  const registered = Boolean(customElements.get('ai-scan-panel'));
  // Shown when the scanner is not saying anything more specific. The scan's own messages replace
  // it, so the aside is one voice rather than a caption competing with a status line.
  const HOW = 'The camera opens with this screen and the YOLO scanner reads the stickers on device — no picture is kept, and none leaves it. Show the sides in any order; each is captured as soon as it holds still. Each tile is edged in the colours of its neighbours: hold a side that way up and the scan needs nothing more from you. Got a sticker wrong? Click it and pick the right colour.';
  // What to call the aside while the scanner is speaking, so "How it works" never heads an error.
  const SAY_TITLE = { error: 'Camera trouble', confirm: 'One more look', checking: 'Checking', done: 'Scanned' };
  return {
    html: `<div class="cols">
    <div class="col">
      <div class="card scanboard">
        <ai-scan-panel headless autostart></ai-scan-panel>
        <div class="scan-faces">${NET_FACES.map((f) => `<div class="scan-face" data-face="${f}">
          <div class="tile" style="border-color:${edgeColors(f)}"><div class="tgrid">${pending(f)}</div></div><div class="lbl">${SCAN_FACE_NAME[f]}</div></div>`).join('')}</div>
        <div class="scan-cam card-tools">
          <button id="scanResetBtn" title="Throw the whole scan away and start again">${icon('refresh', 19)}</button>
          <button id="scanPaintBtn" title="Paint the cube by hand instead of scanning it">${icon('paint-roller', 19)}</button>
          <button id="scanCamBtn" title="Camera">${icon('webcam', 20)}</button>
        </div>
      </div>
    </div>
    <div class="aside">
      <div class="card"><div class="eyebrow">DETECTED STATE</div>
        <div class="cube-slot" id="scanCube" style="height:230px;margin-top:6px"></div></div>
      <div class="card"><b style="font-size:var(--fs-body-l)" id="scanHowTitle">How it works</b>
        <div class="sub scan-say" id="scanHow" style="margin-top:4px">${registered ? 'Opening the camera…' : 'Loading the scanner…'}</div>
        <div class="sub scan-hint" id="scanHint" hidden></div></div>
      <button class="btn primary pill block" id="scanSolveBtn" data-go="home" style="margin-top:auto" disabled>Solve this cube</button>
    </div></div>`,
    mount(root) {
      // Kept, so a finished scan can update the aside in place. Re-rendering the screen would tear
      // down the scanner element and reopen the camera for a scan that has just ended.
      const stateCube = newCube();
      // Ghosts float the faces the camera angle hides, so all six are readable at once — which is
      // the whole job of a twin meant to show what has been read so far. The rest match the
      // renderer's own defaults today and are pinned anyway: this twin has a job (read six sides at
      // a glance) that a future change to those defaults should not quietly retune.
      stateCube.setAttribute('ghosts', 'floating');
      // Tuned by eye against a half-finished scan, not inherited: this twin has one job — read all
      // six sides at a glance — and the renderer's defaults are set for a cube you orbit, not one
      // you read. Ghosts are thrown further out than the Cube screen's slider even offers (9, past
      // its 0–8) so the hidden three clear the solid ones; the camera pulls back to 18 to fit them;
      // stickers go full-bleed at 1 so a nine-grid stays legible at this size.
      stateCube.setAttribute('ghost-elevation', '9');
      stateCube.setAttribute('camera-distance', '18');
      stateCube.setAttribute('camera-latitude', '35');
      stateCube.setAttribute('camera-longitude', '45');
      stateCube.setAttribute('facelet-scale', '1');

      $('#scanCube', root).appendChild(stateCube);
      const showState = (f) => { stateCube.setAttribute('facelets', f); };
      // What has been read so far, as a facelet string. Unread stickers are '?', which the renderer
      // draws as unknown rather than falling back to the face's own colour — otherwise a cube
      // nobody has scanned would render as solved. Captured sides appear in the rotation they were
      // SHOWN in; their true rotation is not known until all six are in, which is what the settle
      // at the end is for.
      const partialFacelets = (captured) => {
        const byFace = new Map(captured.map((c) => [c.face, c.colors]));
        return NET_FACES.map((f) => {
          const colors = byFace.get(f);
          return colors ? colors.map((c) => NET_FACES[c] ?? '?').join('') : '?'.repeat(9);
        }).join('');
      };
      // Which way up each side was held stops mattering the moment the cube reads as solvable: the
      // validated string IS the canonical layout, and the scanner reports each face's rotation.
      // A face captured the wrong way up TURNS to its true orientation — slowly enough to read as
      // "we turned this the right way up for you" — and the repaint lands in the same frame the
      // transform resets, so rotated-shown content and canonical content are pixel-identical at
      // the swap. Timer-driven, not transitionend-driven: the animation is cosmetic and must not
      // be load-bearing in an environment that never fires transition events (tests, reduced CSS).
      let settled = false;
      let turnTimers = [];
      const paintTile = (tile, fl) => {
        const fi = NET_FACES.indexOf(tile.dataset.face);
        const letters = fl.slice(fi * 9, fi * 9 + 9);
        [...tile.querySelectorAll('i')].forEach((c, i) => {
          c.style.backgroundColor = pal[letters[i]] ?? 'var(--facelet-off)';
        });
      };
      const clearTurns = () => {
        for (const t of turnTimers) clearTimeout(t);
        turnTimers = [];
        for (const tile of tiles) {
          const g = tile.querySelector('.tgrid');
          g.style.transition = '';
          g.style.transform = '';
        }
      };
      const settleTiles = (fl, rotations) => {
        clearTurns();
        for (const tile of tiles) {
          const fi = NET_FACES.indexOf(tile.dataset.face);
          const k = rotations?.[fi] ?? 0;
          if (!k) { paintTile(tile, fl); continue; }
          const g = tile.querySelector('.tgrid');
          const deg = k === 3 ? -90 : k * 90; // a 270° CW turn reads better as 90° back
          const ms = k === 2 ? 800 : 500; // unhurried on purpose — this is the explanation
          g.style.transition = `transform ${ms}ms ease`;
          g.style.transform = `rotate(${deg}deg)`;
          turnTimers.push(setTimeout(() => {
            g.style.transition = 'none';
            g.style.transform = '';
            paintTile(tile, fl);
          }, ms + 30));
        }
      };
      const panel = $('ai-scan-panel', root);
      const say = $('#scanHow', root), sayTitle = $('#scanHowTitle', root), hint = $('#scanHint', root);
      // "Solve this cube" is a promise about THIS screen's scan, so it is only pressable once a
      // scan stands complete — and a correction that re-opens the verdict takes it away again.
      const solveBtn = $('#scanSolveBtn', root);
      const tiles = [...root.querySelectorAll('.scan-face')];
      const paint = (cells, colors) => cells.forEach((c, i) => { c.style.backgroundColor = classColor(colors[i]); });

      // Which camera. This machine class routinely has several — a built-in, a virtual camera, a
      // Continuity Camera (an iPhone) — and with no video preview the user cannot tell which one
      // answered. The pin is an ATTRIBUTE, not a property: mount() runs before the element's
      // deferred autostart, but a property set before the element upgrades would be clobbered by
      // its own class fields, whereas an attribute survives and start() re-reads it.
      const camRow = $('.scan-cam', root), camBtn = $('#scanCamBtn', root);
      const resetBtn = $('#scanResetBtn', root), paintBtn = $('#scanPaintBtn', root);
      // Painting and the camera are exclusive: one authors the cube, the other reads it.
      let painting = false;
      // The scanner's current misread suspects, kept so the colour picker can ring the suggested
      // colour when it opens on one of them.
      let suspects = [];
      const setPainting = (on) => {
        painting = on;
        camRow.classList.toggle('paint', on);
        paintBtn.title = on ? 'Stop painting and use the camera' : 'Paint the cube by hand instead of scanning it';
        panel.setPainting?.(on);
      };
      paintBtn.onclick = () => { closePops(); setPainting(!painting); };
      const pin = (id) => { if (id) panel.setAttribute('device-id', id); else panel.removeAttribute('device-id'); };
      pin(settings.cameraId);
      // The webcam button IS the camera menu: one control in the corner rather than a button and a
      // dropdown competing for the same space. Its lens fills and pulses while a camera is open,
      // so a screen that shows no picture still says plainly whether one is running. The menu also
      // carries the scan action, which would otherwise have nowhere left to live.
      const menu = document.createElement('div');
      menu.className = 'menu';
      menu.hidden = true;
      root.appendChild(menu);
      let camOn = false;
      let camsKey = null;
      const choose = (id) => {
        settings.cameraId = id; save('cubusSettings', settings);
        pin(id);
        closePops();
        // Picking a camera is asking to scan, so it leaves painting; otherwise the camera would
        // open under a mode that exists to keep it shut.
        if (painting) setPainting(false);
        else void panel.start?.();
      };
      const markActive = () => {
        const items = [...menu.querySelectorAll('[data-value]')];
        // A pinned camera that is no longer attached is not what will be used — the panel falls
        // back to the platform default — so mark THAT rather than ticking nothing and leaving the
        // menu mute about which camera is in force.
        const active = items.some((b) => b.dataset.value === settings.cameraId) ? settings.cameraId : '';
        for (const b of items) b.classList.toggle('now', b.dataset.value === active);
      };
      const fillCams = async () => {
        let list = [];
        try { list = (await panel.cameras?.()) ?? []; } catch { list = []; }
        const key = list.map((d) => d.deviceId).join('|');
        if (key === camsKey) { markActive(); return; }
        camsKey = key;
        menu.textContent = '';
        // Device labels come from the OS — set as text, never interpolated into HTML.
        const add = (value, label) => {
          const b = document.createElement('button');
          b.type = 'button'; b.dataset.value = value; b.textContent = label;
          b.onclick = () => choose(value);
          menu.appendChild(b);
        };
        add('', 'Default camera');
        for (const d of list) add(d.deviceId, d.label);
        markActive();
      };
      void fillCams();
      // Cameras come and go — a webcam is plugged in, an iPhone wanders out of Continuity range —
      // and the menu is built once, so without this a newly attached camera would never appear.
      const onDevices = () => { void fillCams(); };
      navigator.mediaDevices?.addEventListener?.('devicechange', onDevices);
      let shownDevice = null;
      // Throw the whole scan away — the panel's restart() also turns the camera back on when it
      // is dark, so this one call is the whole contract.
      resetBtn.onclick = () => {
        closePops();
        panel.restart?.();
      };
      camBtn.onclick = (ev) => {
        const open = menu.hidden;
        closePops();
        if (!open) return;
        void fillCams();
        menu.hidden = false;
        placeMenuUnder(camBtn, menu);
        ev.stopPropagation();
      };

      panel.addEventListener('scan-progress', (e) => {
        const p = e.detail;
        // Anything other than a finished scan means the orientation is open again — a correction
        // that breaks validity must not leave canonically-repainted tiles claiming otherwise, nor
        // a half-finished settle turn hanging over tiles about to be repainted as shown.
        if (p.phase !== 'done') { settled = false; clearTurns(); }
        solveBtn.disabled = !p.complete;
        // Two voices, two places: a pinned notice (what the scanner needs and why — it stands
        // until the situation changes) and the transient camera hint. The hint used to overwrite
        // the explanation within one tick, which made every refusal look like a silent crash.
        // The scanner's prose passes through t(): its sentences are exact English strings, so a
        // catalog can translate them here without the scanner package knowing languages exist.
        // Sentences with colour words baked in pass through untranslated until their call sites
        // move to placeholder form — the seam dev-docs/i18n.md tracks.
        const n = p.notice;
        if (n) {
          sayTitle.textContent = t(n.title);
          say.textContent = t(n.body);
          say.className = 'sub scan-say' + (n.tone === 'err' ? ' err' : n.tone === 'ok' ? ' ok' : '');
          // The hint is noise when it just restates the notice (the confirm ask opens the loop
          // with the same sentence the notice carries).
          const dup = !p.message || n.body.includes(p.message);
          hint.textContent = dup ? '' : t(p.message);
          hint.hidden = dup;
        } else if (p.complete) {
          // A finished scan answers "what do I do now?", and only this file can: the next action
          // is THIS screen's button. The scanner says the scan is complete; the words naming
          // "Solve this cube" belong to the screen the button lives on.
          sayTitle.textContent = t('Scanned');
          say.textContent = t('That’s the whole cube, checked and solvable — press "Solve this cube" when you’re ready. Spotted a wrong sticker? Click it and pick the right colour. Different cube? Start over with the ↻ button.');
          say.className = 'sub scan-say ok';
          // With the camera reopened over a finished scan, the camera's own line still matters
          // ("this cube is already scanned…"); with it off there is nothing to hint about.
          hint.textContent = p.device && p.message ? t(p.message) : '';
          hint.hidden = !hint.textContent;
        } else {
          say.textContent = t(p.message || HOW);
          sayTitle.textContent = (p.message && t(SAY_TITLE[p.phase] ?? '')) || t('How it works');
          say.className = 'sub scan-say' + (p.phase === 'error' ? ' err' : p.phase === 'checking' || p.phase === 'done' ? ' ok' : '');
          hint.textContent = '';
          hint.hidden = true;
        }
        suspects = p.suspects ?? [];
        for (const tile of tiles) {
          const f = tile.dataset.face;
          // The centre carries the rescan affordance, revealed on hover over a captured side.
          const centreCell = tile.querySelectorAll('i')[4];
          if (!centreCell.firstChild) centreCell.innerHTML = icon('refresh', 15);
          centreCell.title = `Scan the ${SCAN_FACE_NAME[f]} side again`;
          const got = p.captured.find((c) => c.face === f);
          const cells = [...tile.querySelectorAll('i')];
          tile.classList.toggle('done', Boolean(got));
          // A nearly-solved cube can read as several different cubes; the scanner then names one
          // side to show again, held a stated way up. Point at it — the sentence alone makes a
          // child hunt through six tiles for the colour it named.
          tile.classList.toggle('asked', p.confirm?.face === f);
          // Same pointing for a suspected misread: the sticker whose fix would make the cube
          // legal pulses, so "one sticker looks wrong" never sends anyone hunting either.
          const sus = suspects.filter((s) => s.face === f);
          cells.forEach((c, i) => c.classList.toggle('suspect', sus.some((s) => s.index === i)));
          // On 'done' the captures are already canonical and the settle turn owns the repaint —
          // painting them here would snap the tiles canonical before the turn starts.
          if (got && p.phase !== 'done') paint(cells, got.colors);
          else if (!got) cells.forEach((c, i) => { c.style.backgroundColor = i === 4 ? pal[f] : 'var(--facelet-off)'; });
        }
        // The twin follows the scan side by side rather than waiting for all six.
        if (!settled) stateCube.setAttribute('facelets', partialFacelets(p.captured));
        camOn = Boolean(p.device);
        camRow.classList.toggle('on', camOn);
        camBtn.title = camOn ? `${p.device.label} — camera and scan` : 'Camera off — click to turn it on';
        // Labels are only readable once permission is granted, so the list is worth rebuilding the
        // first time a camera actually answers.
        if (p.device && p.device.deviceId !== shownDevice) {
          shownDevice = p.device.deviceId;
          void fillCams();
        }
      });
      // A rejected scan restarts itself and explains why through scan-progress, so there is
      // nothing to do here; only a validated cube leaves this screen.
      panel.addEventListener('scan-complete', (e) => {
        // The panel is torn down on navigation, but an event already in flight still lands. Without
        // this, a scan finishing just after you left could adopt a cube, derive a correction, and
        // navigate you from a screen that no longer exists.
        if (!root.isConnected) return;
        settled = true;
        // The 'done' progress report normally lands first and enables this; belt-and-braces here
        // so a delivered cube can always be walked, whatever order the two events arrive in.
        solveBtn.disabled = false;
        const fl = e.detail.facelets;
        // Faces captured the wrong way up turn to their true orientation; the rest repaint in
        // place (their content is already canonical, so nothing visibly changes).
        settleTiles(fl, e.detail.rotations);
        // The camera SAW the cube in the user's hand; nothing was inferred from anywhere else.
        adoptCube(fl, { physical: true, source: 'camera' });
        // Stay put. Jumping to another screen took the six tiles away at the moment they finally
        // mean something, and with them the chance to check the read or fix a sticker. The aside
        // shows the cube that was found, and "Solve this cube" is right beside it. Anyone who
        // wants the jump has the "Auto-solve after scan" setting, which this now actually honours
        // — it read "jump straight to the guide" while the code jumped to the viewer regardless.
        showState(e.detail.facelets);
        if (settings.autosolve) go('home');
      });
      // The detector is good, not perfect, so let a person overrule it: on a side the camera has
      // READ, click any sticker and pick the right colour. Delegated rather than 54 listeners. The
      // centre is the one sticker not offered a colour — a centre colour IS the face's identity,
      // so changing it would rename the face rather than correct it; it re-reads the side instead.
      const swatches = document.createElement('div');
      swatches.className = 'swatches';
      swatches.hidden = true;
      root.appendChild(swatches);
      let editing = null;
      const closeSwatches = () => { swatches.hidden = true; editing = null; root.querySelector('.scan-face .cell.editing')?.classList.remove('editing'); };
      const closePops = () => { closeSwatches(); menu.hidden = true; };
      for (const f of NET_FACES) {
        const b = document.createElement('button');
        b.type = 'button';
        b.style.backgroundColor = pal[f];
        b.title = SCAN_FACE_NAME[f];
        b.dataset.face = f;
        b.onclick = () => {
          if (editing) panel.setSticker?.(editing.face, editing.index, NET_FACES.indexOf(f));
          closeSwatches();
        };
        swatches.appendChild(b);
      }
      $('.scan-faces', root).onclick = (ev) => {
        const cellEl = ev.target.closest('.cell');
        const tile = ev.target.closest('.scan-face');
        if (!cellEl || !tile) return;
        const index = [...cellEl.parentElement.children].indexOf(cellEl);
        // The centre cannot be colour-corrected — it names the face — so it does the other useful
        // thing: throws that side's reading away so the camera reads it again.
        if (index === 4) {
          closePops();
          // Re-reading needs something to read with, so the centre does nothing while painting.
          if (!painting && tile.classList.contains('done')) panel.rescanFace?.(tile.dataset.face);
          return;
        }
        // Correcting needs a reading to overrule; painting is where supplying one is the point, so
        // there all 48 outer stickers are open whether the camera has seen that side or not.
        if (!painting && !tile.classList.contains('done')) return;
        closePops();
        editing = { face: tile.dataset.face, index };
        cellEl.classList.add('editing');
        // Mark the colour already there, so the picker shows what it is changing FROM — and, when
        // this sticker is a misread suspect, ring the colour the scanner reckons it should be.
        const current = cellEl.style.backgroundColor;
        const sug = suspects.find((s) => s.face === editing.face && s.index === index);
        for (const b of swatches.children) {
          b.classList.toggle('now', b.style.backgroundColor === current);
          b.classList.toggle('suggest', sug !== undefined && NET_FACES.indexOf(b.dataset.face) === sug.to);
        }
        swatches.hidden = false;
        // Anchored below the TILE, not below the sticker: a picker covering the very sticker you
        // are correcting hides the thing you need to look at. Fixed to the viewport so there is no
        // offset-parent arithmetic, and clamped so an edge tile keeps it on screen.
        const cellRect = cellEl.getBoundingClientRect();
        const tileRect = tile.getBoundingClientRect();
        const w = swatches.offsetWidth;
        swatches.style.left = `${Math.min(Math.max(8, cellRect.left + cellRect.width / 2 - w / 2), window.innerWidth - w - 8)}px`;
        swatches.style.top = `${tileRect.bottom + 6}px`;
        ev.stopPropagation();
      };
      const onAway = (ev) => {
        if (!swatches.hidden && !swatches.contains(ev.target)) closeSwatches();
        if (!menu.hidden && !menu.contains(ev.target) && ev.target !== camBtn) menu.hidden = true;
      };
      const onEsc = (ev) => { if (ev.key === 'Escape') closePops(); };
      document.addEventListener('click', onAway);
      document.addEventListener('keydown', onEsc);


      cleanup = () => {
        clearTurns();
        navigator.mediaDevices?.removeEventListener?.('devicechange', onDevices);
        document.removeEventListener('click', onAway);
        document.removeEventListener('keydown', onEsc);
        panel.stop?.();
      };
    },
  };
};

// The cube screen: where a sequence of moves gets FOLLOWED, and where a cube gets looked at.
//
// One screen, because it was always one object. Solve guide and Playback were the same function
// behind a boolean — `solveScreen({ guide })` — and the 3D viewer was the same cube again with the
// transport taken away. Three nav items differing by a flag and a couple of cards taught nobody
// anything. Restore reads a cube; this is the next step.
//
// Scramble is the SAME screen again, and this one earns its flag where those did not: it is not a
// card hidden or a button greyed out, it is the opposite end of the same walk. Restore reads a
// cube so it can be solved; Scramble starts from solved and tells you how to mix one up.
//
// There was a `followMoves(seq)` handoff here for a third caller to push its own alg through. It
// had no callers, so its branch in the walk was unreachable; it is gone rather than kept warm for
// a History screen that does not exist yet. Re-add it when there is something to add it for.
//
// A new reading updates this screen IN PLACE (see liveUpdate): a full re-render on every
// quarter turn would restart an animation the user is halfway through following.

/** The three walking speeds, as renderer tempo-scale values. The renderer divides a 190ms base by
 * this, so a LARGER number is faster. None of them is quick: Fast is 0.95s per quarter turn, still
 * slower than the 760ms that used to be the only speed and was the complaint that prompted this. */
const SPEEDS = [
  { id: 'slow', label: 'Slow', tempo: 0.05 },     // 3.8s per quarter turn
  { id: 'normal', label: 'Normal', tempo: 0.1 },  // 1.9s
  { id: 'fast', label: 'Fast', tempo: 0.2 },      // 0.95s
];
const DEFAULT_SPEED = 'normal';

/** Solve and Scramble are the same screen walked from opposite ends.
 *
 * Solve starts at YOUR cube and ends solved; Scramble starts SOLVED and ends at a random state.
 * Both walk a list of moves forwards, which is the whole reason this is one screen and not a
 * mirrored transport: a scramble played forwards names the turn you actually make. Playing a
 * solution backwards would not — the chips render each move literally, so the label would read R
 * while your hand does R'.
 */
const cubeScreen = (screenMode) => {
  const scrambling = screenMode === 'scramble';
  // No controls on this screen any more, so these are read but never written here. Left on
  // `cubeView` rather than hard-coded so they stay tunable without a rebuild.
  const v = load('cubeView', { hintElev: 4, camDist: 12, camLat: 35, camLon: 45, facScale: 0.9, ghosts: true });
  // A scramble is always available: it is generated here rather than read off the cube, so there is
  // no state that makes this screen have nothing to do.
  const walking = scrambling || deriveCube().solvable;
  const label = scrambling ? 'Scramble' : 'Solution';
  const walked = scrambling ? 'scramble' : 'solution';
  // Saved key → renderer attribute. Named for what it is now that the sliders it fed are gone.
  const VIEW_ATTRS = [
    ['hintElev', 'ghost-elevation'], ['camDist', 'camera-distance'],
    ['camLat', 'camera-latitude'], ['camLon', 'camera-longitude'],
    ['facScale', 'facelet-scale'],
  ];
  return {
    html: `<div class="cols">
    <div class="col">
      <div class="card" style="flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;position:relative">
        ${walking ? `<div class="card-tools">
          <button id="speedBtn" title="Animation speed">${icon('gauge', 20)}</button>
        </div>` : ''}
        <div style="flex:1;min-height:0;width:100%">
          <div class="cube-slot" id="viewCube" style="height:100%"></div>
        </div>
      </div>
      ${walking ? `<div class="card">
        <div class="transport">
          <button class="tbtn" id="prevBtn" title="Back a move">${icon('chevron-left', 20)}</button>
          <button class="tbtn" id="repeatBtn" title="Show that move again">${icon('refresh', 18)}</button>
          <button class="tbtn" id="nextBtn" title="Next move">${icon('chevron-right', 20)}</button>
          <button class="tbtn primary" id="playBtn" title="Play from here to the end">${icon('play', 18)}</button>
          ${state.connected ? `<button class="pill on" data-mode="cube" title="Turn your smart cube and the guide keeps up">Follow cube</button>` : ''}
          <div class="progress" title="How far through the ${walked} you are"><span id="progBar"></span></div>
          <span class="done-mark" id="doneMark" hidden title="Done">${icon('check', 14)}</span>
          <span class="num" id="stepLbl" style="color:var(--ink-4);min-width:64px;text-align:right">0 / 0</span>
        </div>
      </div>` : ''}
    </div>
    <div class="aside" style="overflow-y:auto">
      <div class="card" style="padding-bottom:0">
        <div class="eyebrow-row"><b class="state-h">${scrambling ? 'Target State' : 'Initial State'}</b>
          ${scrambling || settings.devRandCube
            // On Scramble the die IS the screen's re-roll and always shows. On the solve side it
            // loads a random cube that is NOT the one in anyone's hand — a developer shortcut,
            // hidden unless the Advanced toggle asks for it.
            ? `<button id="randCube" title="${scrambling ? 'Roll a different scramble' : 'Load a random scrambled cube'}">${icon('dice', 18)}</button>`
            : ''}</div>
        <!-- 30px above AND 30px below the net (bottom = aside gap 16 + Solution header pad 14,
             with this card's own bottom padding zeroed) — the two breathing spaces the eye
             compares, made equal. -->
        <div class="net" id="viewNet" style="margin-top:30px"></div></div>
      ${walking ? `<div class="card tight" style="flex:1;min-height:140px;display:flex;flex-direction:column">
        <div class="card-h bare"><b>${label}</b><span class="sub" id="moveCount">—</span></div>
        <div class="list" id="solList" style="padding:6px 0"></div>
        <div class="follow-note" id="followNote" hidden>
          <span id="followMsg"></span>
          <div class="acts">
            <button class="btn sm accent-outline" id="resolveBtn">Re-solve</button>
            <button class="btn sm outline" id="turnBackBtn">I'll turn it back</button>
          </div>
        </div>
</div>` : ''}
    </div></div>`,
    async mount(root) {
      // Captured before the first await. A solve can take seconds, and navigating away meanwhile
      // must not let this mount come back and install its liveUpdate over the new screen's.
      const gen = screenGen;
      const stale = () => gen !== screenGen;
      const cube = newCube({ animate: walking });
      $('#viewCube', root).appendChild(cube);
      applyNetColors();
      const paintNet = buildNet($('#viewNet', root));
      paintNet(scrambling ? SOLVED : state.cube.facelets);
      cube.setAttribute('ghosts', v.ghosts ? 'floating' : 'none');
      for (const [k, attr] of VIEW_ATTRS) cube.setAttribute(attr, String(v[k]));

      // Speed sits in the card's corner, not in the transport row: it is a preference you set once
      // and forget, whereas the row is the solution you are walking. Same idiom as the scan
      // screen's camera menu. Wired before the solve so a screen that fails to solve still honours
      // the setting. The renderer reads tempo-scale per move, so a change lands on the next turn.
      const speedBtn = $('#speedBtn', root);
      const speedMenu = document.createElement('div');
      let speedId = DEFAULT_SPEED;
      let closeSpeed = () => {};
      if (speedBtn) {
        speedMenu.className = 'menu';
        speedMenu.hidden = true;
        root.appendChild(speedMenu);
        // localStorage is untrusted input: an id no longer in SPEEDS must not reach setAttribute.
        const saved = load('walkSpeed', { id: DEFAULT_SPEED }).id;
        if (SPEEDS.some((o) => o.id === saved)) speedId = saved;
        closeSpeed = () => { speedMenu.hidden = true; speedBtn.classList.remove('open'); };

        const applySpeed = () => {
          const chosen = SPEEDS.find((o) => o.id === speedId);
          cube.setAttribute('tempo-scale', String(chosen.tempo));
          speedBtn.title = `Animation speed — ${chosen.label}`;
          speedMenu.textContent = '';
          for (const o of SPEEDS) {
            const b = document.createElement('button');
            b.textContent = o.label;
            b.dataset.speed = o.id;
            if (o.id === speedId) b.className = 'now';
            b.onclick = () => { speedId = o.id; save('walkSpeed', { id: o.id }); applySpeed(); closeSpeed(); };
            speedMenu.appendChild(b);
          }
        };
        applySpeed();

        speedBtn.onclick = (ev) => {
          const wasClosed = speedMenu.hidden;
          closeSpeed();
          if (!wasClosed) return;
          speedMenu.hidden = false;
          speedBtn.classList.add('open');
          placeMenuUnder(speedBtn, speedMenu);
          ev.stopPropagation();
        };
        const onAway = (ev) => {
          if (!speedMenu.hidden && !speedMenu.contains(ev.target) && !speedBtn.contains(ev.target)) closeSpeed();
        };
        const onEsc = (ev) => { if (ev.key === 'Escape') closeSpeed(); };
        document.addEventListener('click', onAway);
        document.addEventListener('keydown', onEsc);
        // Without this the listeners outlive the screen and stack up one pair per visit.
        cleanup = () => {
          document.removeEventListener('click', onAway);
          document.removeEventListener('keydown', onEsc);
        };
      }

      // Re-entering the screen is what makes a new cube take effect: the solution, the move list
      // and the step count are all built at mount, so repainting in place would leave a fresh cube
      // wearing the old cube's solution. This is the wiring the button was missing.
      // Absent on the solve side unless the Advanced dev toggle shows it.
      if ($('#randCube', root)) $('#randCube', root).onclick = () => {
        if (!solverReady) return;
        // Re-entering is what rolls a new one: the moves, the chips and the step count are all
        // built at mount, so repainting in place would leave a new cube wearing the old list.
        if (scrambling) { go('scramble'); return; }
        // Known by construction, and NOT the cube in your hand. Marking this 'camera' was the bug
        // behind a solved physical cube instantly completing a random solve: the guide accepted
        // the real cube's snapshots as progress through an arrangement it had never been in.
        adoptCube(randomScramble(), { physical: false, source: 'generated' });
        go('home');
      };

      liveUpdate = (f) => {
        paintNet(f);
        if (!walking) cube.setAttribute('facelets', f);
      };

      if (!walking) return;

      const solList = $('#solList', root);
      const setStatus = (msg) => { $('#moveCount', root).textContent = msg; };
      setStatus('working…');
      let setup, alg, moves, steps = [];
      try {
        if (scrambling) {
          if (!solverReady && !(await loadSolver())) throw new Error('solver unavailable');
          // randomScramble() returns the state it lands on and leaves the alg that gets there from
          // solved in `currentScramble`. That alg is what we walk, so `setup` stays empty and the
          // cube starts solved.
          const target = randomScramble();
          if (!target || !currentScramble) throw new Error('no scramble');
          setup = ''; alg = currentScramble; moves = alg.trim().split(/\s+/);
          // Per-step states for Follow cube, built the same way the solve path builds its own.
          const b = Cube.fromString(SOLVED);
          steps = [b.asString()];
          for (const m of moves) { b.move(m); steps.push(b.asString()); }
          paintNet(target);
        } else {
          if (!solverReady && !(await loadSolver())) throw new Error('solver unavailable');
          await solve();
          setup = state.cube.setupAlg; alg = state.cube.solution; moves = state.cube.moves;
          // Snapshotted: setFacelets() clears stepFacelets on every live update, and following a
          // physical cube needs the states to compare against to outlive the next turn.
          steps = state.cube.stepFacelets.slice();
        }
      } catch { if (!stale()) setStatus('could not work it out'); return; }
      if (stale()) return; // navigated away while solving — leave the new screen alone
      const total = moves.length;
      cube.setAttribute('scramble', setup ?? ''); cube.removeAttribute('facelets'); cube.setAttribute('alg', alg);
      setStatus(String(total)); // just the number — the heading beside it already says what it counts
      // A scramble has no stages — CROSS/F2L/OLL/PLL are phases of solving, and pinning them on a
      // scramble would invent structure that is not there. It gets no group heading either: the
      // card header directly above already says "Scramble" and the move count, and repeating both
      // an inch lower said nothing twice. The solve side keeps its headings — stage names are
      // information the card header does not carry.
      const stages = scrambling ? [['SCRAMBLE', 0, total]] : stageSplit(total);
      solList.innerHTML = stages.map(([name, a, b]) => `<div style="padding:10px 18px 14px">
        ${scrambling ? '' : `<div style="display:flex;justify-content:space-between"><span class="eyebrow">${name}</span><span class="num sub">${b - a}</span></div>`}
        <div class="move-chips" style="margin-top:${scrambling ? '0' : '8px'}">${moves.slice(a, b).map((m, k) => `<button class="chip-m" data-i="${a + k}" title="Jump to this move">${m}</button>`).join('')}</div></div>`).join('');
      const chips = [...solList.querySelectorAll('.chip-m')];
      let at = 0;
      function sync(i) {
        at = i;
        // The filled chip is the move just shown — the one you are on. At 0 / 22 nothing has been
        // shown, so nothing is filled. It used to mark the NEXT move, and a black first chip before
        // anything had happened read as a step already taken.
        chips.forEach((ch, k) => { ch.classList.toggle('played', k < i); ch.classList.toggle('cur', k === i - 1); });
        $('#stepLbl', root).textContent = `${i} / ${total}`;
        $('#progBar', root).style.width = total ? `${(i / total) * 100}%` : '0%';
        // A button that cannot do anything says so, rather than swallowing the press.
        $('#prevBtn', root).disabled = i === 0;
        $('#repeatBtn', root).disabled = i === 0;
        $('#nextBtn', root).disabled = i >= total;
        $('#playBtn', root).disabled = i >= total;
        // A tick beside the count once the last move lands. It used to be a 46px badge over the
        // cube, saying "done" where the count beside it already read 22 / 22.
        $('#doneMark', root).hidden = i < total;
      }
      cube.addEventListener('cubus-step', (e) => sync(e.detail.index));

      let playing = false;
      const setPlaying = (on) => {
        playing = on;
        $('#playBtn', root).innerHTML = icon(on ? 'pause' : 'play', 18);
        if (on) cube.play(); else cube.pause();
      };

      // Touching the transport hands control back to you. Following and the buttons were two
      // drivers for one guide, and while both were live the step counter tracked the ANIMATION
      // rather than the cube. One rule removes the ambiguity — the toggle is right there to
      // resume. Hoisted, because the handlers below call it while `mode` and `followBtn` are
      // declared further down.
      function takeOver() {
        if (mode !== 'cube') return;
        mode = 'slow';
        followBtn?.classList.remove('on');
        if (followBtn) followBtn.title = 'You took over — click to let the cube drive again';
      }

      $('#playBtn', root).onclick = () => { takeOver(); setPlaying(!playing); };
      $('#nextBtn', root).onclick = () => { takeOver(); setPlaying(false); cube.step(); };
      // Back and repeat are both animated, at the one walking speed, and differ only in where they
      // leave you. Back undoes the last move and stops there. Repeat answers "show me that again":
      // it undoes the move and then makes it again, so you end up where you started having watched
      // it twice. Neither jumps: a cut to a new state teaches nothing about the turn that got there.
      // The renderer's queue is FIFO and pulls the next move only when the current one finishes,
      // so pushing both halves of a repeat here plays them in order.
      $('#prevBtn', root).onclick = () => { takeOver(); setPlaying(false); cube.stepBack(); };
      // A move in the list is a place in the solution, so clicking one goes there. seek() is instant
      // on purpose: jumping twelve moves is not something to sit through, which is exactly the case
      // step()/stepBack() do not cover. It seeks to just AFTER the clicked move: the cube shows that
      // move made and the clicked chip is the filled one, so the highlight lands where you clicked.
      solList.onclick = (ev) => {
        const chip = ev.target.closest('.chip-m');
        if (!chip) return;
        takeOver(); // jumping to a move is taking over just as much as pressing Next is
        setPlaying(false);
        cube.seek(Number(chip.dataset.i) + 1);
      };
      $('#repeatBtn', root).onclick = () => {
        takeOver();
        // Not merely belt-and-braces with the disabled attribute: stepBack() self-guards at step 0
        // but step() does not, so without this a repeat at the start would go FORWARD one move.
        if (at === 0) return;
        setPlaying(false);
        cube.stepBack();
        cube.step();
      };

      // ---- Follow cube (recovered from v0, extended with move-driven Previous) ---------------
      //
      // One pacing control, and only when there is a cube to pace against: with nothing connected,
      // walking by hand is the only behaviour there is, so a button naming it would be a switch
      // with one position. Connected, following is what you want by default — a single toggle
      // that starts on, provided the preconditions hold.
      const followBtn = root.querySelector('[data-mode="cube"]');
      let mode = 'slow';
      const refuseFollow = (why) => {
        followBtn.disabled = true;
        followBtn.classList.remove('on');
        followBtn.title = why;
      };
      if (followBtn) {
        // Following compares the real cube against the state each move produces, so it needs one
        // state per step, a TRUSTED cube (the move stream is in the CUBE's frame — following an
        // unverified one advances the guide on turns that may not be the ones being made), and a
        // walk that STARTS from where the cube in your hand actually is. The last rule is what
        // makes a random cube unfollowable while a scramble from a solved cube is perfectly
        // followable — and why a solved cube used to complete a random solve instantly.
        if (steps.length !== total + 1) {
          refuseFollow('Needs a solve worked out on this screen');
        } else if (!state.cube.trusted) {
          refuseFollow(`Read the cube first — ${state.cube.staleWhy || 'its position is unverified'}`);
        } else if (steps[0] !== state.live) {
          refuseFollow(state.live
            ? 'This is not the cube in your hand — read your cube to follow along'
            : 'Waiting to hear from your cube…');
        } else {
          mode = 'cube';
        }
        followBtn.onclick = () => {
          if (followBtn.disabled) return;
          mode = mode === 'cube' ? 'slow' : 'cube';
          followBtn.classList.toggle('on', mode === 'cube');
          followBtn.title = mode === 'cube'
            ? 'Turn your smart cube and the guide keeps up'
            : 'You took over — click to let the cube drive again';
          if (mode === 'cube') setPlaying(false);
        };
      }

      // Where the PHYSICAL cube is, in solution indices. Deliberately not `at`: `at` is where the
      // ANIMATION has got to (up to 3.8s behind at Slow), and driving the match off it dropped
      // any second real turn made inside that window — after which nothing could ever match again.
      let cubePos = 0;
      let offTrack = false;
      const note = $('#followNote', root), noteMsg = $('#followMsg', root);
      const showNote = (msg) => {
        offTrack = true;
        if (note) { note.hidden = false; noteMsg.textContent = msg; }
      };
      const clearNote = () => {
        offTrack = false;
        if (note) note.hidden = true;
      };
      /** Move the drawing toward where the cube actually is. One queued step per accepted move —
       *  the renderer's queue is FIFO and never drops, so this cannot fall behind. */
      const drawTo = (idx) => {
        // The drawing is a FOLLOWER of the guide's position. If the renderer never upgraded — a
        // vendored bundle that failed to load, which this repo has shipped more than once — the
        // guide should still track your turns rather than throwing on every one.
        if (typeof cube.step !== 'function' || typeof cube.seek !== 'function') return;
        if (idx === at) return;
        if (idx > at && idx - at <= 2) { for (let i = at; i < idx; i++) cube.step(); }
        else cube.seek(idx); // a jump: animating a dozen moves to catch up helps nobody
      };

      liveMove = (m) => {
        if (mode !== 'cube' || offTrack) return;
        // The next move in the walk: your turn IS pressing Next.
        if (m.notation === moves[cubePos]) {
          cubePos += 1;
          drawTo(cubePos);
          clearNote();
          return;
        }
        // The inverse of the move just made: your turn IS pressing Previous — immediately, not a
        // second later when a snapshot happens to notice. (v0 only resynced backward off the ~1Hz
        // snapshots, which made undoing a move feel like the guide had stopped listening.)
        if (cubePos > 0 && m.notation === invMove(moves[cubePos - 1])) {
          cubePos -= 1;
          drawTo(cubePos);
          clearNote();
          return;
        }
        showNote(`That was ${m.notation} — the next move is ${moves[cubePos] ?? '—'}.`);
      };

      // Trust has already lapsed by the time this runs — onGap() owns that, with or without a
      // screen mounted to hear it. What is left here is this screen's own reaction.
      liveGap = (g) => {
        // Disabled, not merely un-highlighted: following matches your turns against an
        // arrangement we have just said we cannot vouch for.
        if (followBtn) {
          followBtn.disabled = true;
          followBtn.title = 'Your cube missed a turn — read it again before following';
        }
        if (mode !== 'cube') return;
        mode = 'slow';
        followBtn?.classList.remove('on');
        // The cube numbers its moves, and the driver says so when the count skips. Silence here
        // would look exactly like a wrong turn; it is neither, and the snapshot will resync.
        showNote(`Missed ${g.missing} turn${g.missing === 1 ? '' : 's'} — checking the cube…`);
      };

      liveUpdate = (f) => {
        if (mode === 'cube') {
          // Snapshots are the CORRECTION, not the signal. Searching all of `steps` rather than
          // testing only the next one is what lets a cube that ran ahead, or was turned back,
          // rejoin the guide instead of stalling forever. The net is NOT repainted while walking:
          // it says INITIAL STATE, and following live turns would leave that label describing
          // something the user is no longer looking at.
          const idx = steps.indexOf(f);
          if (idx < 0) {
            showNote('This cube is not on the plan any more.');
            return;
          }
          clearNote();
          if (idx !== cubePos) { cubePos = idx; drawTo(idx); }
          return;
        }
        paintNet(f);
      };

      $('#resolveBtn', root).onclick = () => go(state.screen); // re-mount solves from the cube as it is now
      $('#turnBackBtn', root).onclick = () => clearNote();     // the next snapshot resyncs on its own

      sync(0);
    },
  };
};

// Home is the cube. There is no separate "3D viewer" entry any more: it was the same screen
// reached by a second name, and the app's front door is the thing it is for.
SCREENS.home = () => cubeScreen('solve');
SCREENS.scramble = () => cubeScreen('scramble');

SCREENS.timer = () => {
  return { html: `<div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px">
      <div class="num" id="scr" style="font-size:var(--fs-body-l);color:var(--ink-4);text-align:center;max-width:640px">press New scramble</div>
      <div class="num" id="clock" style="font-size:var(--fs-timer);font-weight:600;line-height:.95;letter-spacing:-.03em;cursor:pointer">0.00</div>
      <div class="sub" id="timerHint" style="color:var(--ink-4)">Click or hold space to start</div>
      <div style="display:flex;gap:10px"><button class="btn outline sm" id="newScr">New scramble</button>
        <span class="pill">${settings.inspection ? 'Inspection 15s' : 'Inspection off'}</span>
        <span class="pill">WCA scrambles</span></div>
      <div style="display:flex;gap:12px;margin-top:6px" id="lastFive"></div></div>`,
    mount(root) {
      const clock = $('#clock', root); let running = false, t0 = 0, raf = 0;
      const fmt = (ms) => (ms / 1000).toFixed(2);
      const tick = () => { if (!running) return; clock.textContent = fmt(performance.now() - t0); raf = requestAnimationFrame(tick); };
      const hint = $('#timerHint', root);
      const MANUAL = 'Click or hold space to start';
      const say = (text) => { if (hint) hint.textContent = text; };

      const newScr = () => {
        if (!solverReady) {
          $('#scr', root).textContent = 'solver loading…';
          // Retry when it lands. Without this, opening Timer before the solver finished left
          // "solver loading…" on screen permanently — the only way out was pressing New scramble
          // again, which nothing on the screen suggested.
          void loadSolver().then((ok) => { if (ok && state.screen === 'timer' && root.isConnected) newScr(); });
          return;
        }
        randomScramble();
        $('#scr', root).textContent = currentScramble || '—';
      };
      const stop = () => {
        running = false;
        cancelAnimationFrame(raf);
        const t = fmt(performance.now() - t0);
        clock.textContent = t;
        clock.style.color = 'var(--ink)';
        say(MANUAL);
        pushSolve(t);
        renderLast();
      };
      const start = () => {
        running = true;
        t0 = performance.now();
        clock.style.color = 'var(--accent)';
        say('Running — click or press space to stop');
        tick();
      };
      const toggle = () => { if (running) stop(); else start(); };
      clock.onclick = toggle;
      $('#newScr', root).onclick = newScr;
      // escHtml: solve times come from localStorage, which is untrusted input, and they were
      // going into innerHTML raw — a stored-XSS hole reachable by anything that can write to the
      // origin's storage.
      const renderLast = () => {
        const l = recentSolves().filter((s) => s.time).slice(0, 5);
        $('#lastFive', root).innerHTML = l.map((s) =>
          `<div class="card" style="padding:9px 16px;text-align:center"><div class="num" style="font-size:var(--fs-title);font-weight:600">${escHtml(s.time)}</div></div>`,
        ).join('');
      };
      // e.repeat: holding the key down fires keydown continuously, which start/stopped the clock
      // dozens of times a second and wrote a run of nonsense times into the solve history.
      const onKey = (e) => {
        if (e.repeat || e.code !== 'Space' || state.screen !== 'timer') return;
        e.preventDefault();
        toggle();
      };
      document.addEventListener('keydown', onKey);
      cleanup = () => {
        // `running` first: tick() re-schedules itself, so cancelling the pending frame while the
        // flag is still true leaves an in-flight callback free to queue another one — a clock that
        // animates forever on a screen that no longer exists.
        running = false;
        cancelAnimationFrame(raf);
        document.removeEventListener('keydown', onKey);
      };
      renderLast(); newScr();
    },
  };
};

SCREENS.settings = () => {
  const pals = ['muted', 'classic', 'colorsafe'];
  const toggles = [['inspection', 'WCA inspection', '15s hold before the timer starts'], ['autosolve', 'Auto-solve after scan', 'Jump straight to the guide']];
  return { html: `<div class="cols">
    <div class="col">
      <div class="card"><div class="eyebrow">APPEARANCE</div>
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0"><div><div style="font-weight:600">Theme</div><div class="sub" style="color:var(--ink-4)">White, cream or night — auto follows the system</div></div>
          <div style="display:flex;gap:6px">${THEMES.map((t) => `<button class="pill ${settings.theme === t ? 'on' : ''}" data-set-theme="${t}">${t}</button>`).join('')}</div></div></div>
      ${(() => {
        // ---- smart cube (recovered from v0) --------------------------------------------------
        const on = state.connected;
        // The cube answers its battery on request, so an unknown level is a real state, not a
        // zero. Drawn rather than written as a bare percentage because the number that matters is
        // "is this about to die mid-solve" — a dying cube is what desyncs tracking from reality.
        const battery = () => {
          const lv = state.battery;
          if (!Number.isFinite(lv)) {
            return `<button class="btn sm outline" id="battRefresh" title="Ask the cube again">battery ?</button>`;
          }
          const low = lv <= 20;
          const tone = low ? 'var(--err)' : lv <= 40 ? 'var(--warn)' : 'var(--ok)';
          return `<div id="battMeter" title="${lv}% battery" style="display:flex;align-items:center;gap:8px;flex:none">
            <div style="position:relative;width:34px;height:16px;border:1.5px solid var(--ink-5);border-radius:3px">
              <i style="position:absolute;inset:2px;width:calc(${lv}% - 4px);min-width:1px;background:${tone};border-radius:1px"></i>
            </div>
            <span style="width:8px;height:7px;margin-left:-6px;background:var(--ink-5);border-radius:0 2px 2px 0"></span>
            <span class="num" style="font-size:var(--fs-body-s);color:${low ? 'var(--err)' : 'var(--ink-3)'};font-weight:${low ? 700 : 400}">${lv}%</span>
          </div>`;
        };
        // Step 3 is not decoration: anchorSolved() is what tells the cube which position counts
        // as solved, so the button lives IN its own step.
        // Step 3 asks the one question only the person holding the cube can answer. "It's solved"
        // anchors; "Not solved" hands the cube to the camera, which reads it exactly as it is —
        // nobody should have to solve a cube to start using the app.
        const steps = [
          ['Turn the cube', 'Any quarter turn wakes its radio'],
          ['Pair it', 'Moves and state then stream in live'],
          ['Is it solved right now?', 'Solved: mark it, and the cube learns its reference. Not solved: the camera reads it as it is'],
        ];
        // Step 3 is not done just because the anchor button was once pressed: a cube that has
        // since disconnected, missed a turn or had its correction reset is not "set up and
        // tracking", and a green tick over one is the most misleading thing this card could say.
        const done = (i) => on && (i < 2 || (state.anchored && state.cube.trusted));
        const known = listCubes(cubes);
        const hhmm = (ts) => {
          if (!ts) return '';
          const d = new Date(ts);
          return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        };
        const seenAgo = (ts) => {
          if (!ts) return 'not used yet';
          const d = Date.now() - ts;
          for (const [ms, unit] of [[86400000, 'd'], [3600000, 'h'], [60000, 'min']]) {
            if (d >= ms) return `${Math.floor(d / ms)}${unit} ago`;
          }
          return 'just now';
        };
        // The FULL address in labels, not a tail: neither two octets nor nicknames are unique —
        // nothing stops a user calling two cubes "green".
        const rowName = (c) => `${c.nickname || c.name || 'cube'} at ${c.mac}`;
        const knownCubesRows = () => {
          if (!known.length) return '';
          return `<div style="padding:4px 0 0;border-top:1px solid var(--line-faint)">
            <div class="eyebrow" style="padding-top:12px">${known.length === 1 ? 'YOUR CUBE' : 'YOUR CUBES'}</div>
            ${known.map((c) => {
              const live = on && state.cubeMac === c.mac;
              // Aligned to the INPUT's row, not the column's centre: the name field is the
              // element the eye reads the row by, and the mac line hanging under it pushed a
              // centre-aligned button visibly off that line.
              return `<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--line-faint)">
                <span class="ico" style="color:${live ? 'var(--ok)' : 'var(--ink-5)'};flex:none;margin-top:9px">${icon('bluetooth', 16)}</span>
                <div style="flex:1;min-width:0">
                  <input class="field" data-rename-cube="${escHtml(c.mac)}" value="${escHtml(c.nickname)}"
                    placeholder="${escHtml(c.name || 'Give it a name')}" maxlength="${MAX_LABEL}"
                    aria-label="Name for the cube at ${escHtml(c.mac)}"
                    style="width:100%;font-weight:600" title="A name of your own. Only a label — nothing depends on it.">
                  <div class="sub num" style="color:var(--ink-5);font-size:var(--fs-meta);margin-top:3px">${escHtml(c.mac)} · ${live ? 'connected now' : seenAgo(c.lastSeen)}</div>
                </div>
                ${!on && !isTauri ? `<button class="btn sm outline" data-use-cube="${escHtml(c.mac)}" aria-label="Connect to ${escHtml(rowName(c))}" style="flex:none;margin-top:1px">Use</button>` : ''}
                <button class="btn sm" data-forget-cube="${escHtml(c.mac)}" aria-label="Forget ${escHtml(rowName(c))}" style="flex:none;margin-top:1px;border:1px solid var(--line);color:var(--ink-4)">Forget</button>
              </div>`;
            }).join('')}
            ${isTauri ? `<div class="sub" style="color:var(--ink-5);padding:8px 0 0">cubus finds whichever cube is awake nearby, so this list is a history rather than a chooser.</div>` : ''}
          </div>`;
        };

        return `<div class="card"><div class="eyebrow">SMART CUBE</div>
        <div style="display:flex;align-items:center;gap:12px;padding:12px 0">
          <span class="ico" style="color:${on ? 'var(--ok)' : 'var(--ink-5)'}">${icon('bluetooth', 18)}</span>
          <div style="flex:1">
            <div style="font-weight:600">${on ? escHtml(liveCubeLabel()) + ' · live' : 'No cube paired'}</div>
            <div class="sub" id="btNote" style="color:var(--ink-4)">${on ? 'Every turn streams into cubus.' : 'Optional — cubus solves from the camera alone. A cube adds move-by-move following.'}</div>
            ${on ? '' : `<div class="sub" style="color:var(--ink-5);margin-top:4px">${isTauri ? 'Pairing scans for a nearby cube — turn it first so its radio is awake.' : 'Pairing opens your browser’s device chooser — turn the cube first so it appears in the list.'}</div>`}
          </div>
          ${on ? battery() : ''}
        </div>
        ${on && Number.isFinite(state.battery) && state.battery <= 20 ? `<div style="display:flex;gap:8px;padding:0 0 12px;color:var(--err);font-size:var(--fs-body-s)">
          <span>Battery low. A cube that dies mid-solve stops counting turns, and what it reports afterwards will not match the cube in your hand until you read it again.</span>
        </div>` : ''}
        ${on && state.cube.offset ? `<div style="display:flex;align-items:center;gap:10px;padding:12px 0;border-top:1px solid var(--line-faint)">
          <span class="ico" style="color:var(--ok);flex:none">${icon('check', 16)}</span>
          <div style="flex:1">
            <div style="font-weight:600">Tracking corrected</div>
            <div class="sub" style="color:var(--ink-4)">A camera scan at ${escHtml(hhmm(state.cube.offsetAt))} put this cube back in step after it lost count, and every reading since is corrected by it. If that scan was wrong, so is everything built on it.</div>
          </div>
          <button class="btn sm outline" id="offsetReset" aria-label="Discard the tracking correction — your cube will need reading again" style="flex:none">Reset</button>
        </div>` : ''}
        ${knownCubesRows()}
        ${on ? '' : `<div id="macRow" hidden style="display:flex;align-items:center;gap:12px;padding:12px 0;border-top:1px solid var(--line-faint)">
          <div style="flex:1"><div style="font-weight:600">${known.length ? 'Add another cube' : 'Cube Bluetooth address'}</div>
            <div class="sub" style="color:var(--ink-4)">The cube encrypts everything with this as the key, and browsers on macOS will not reveal it. Copy it from the GAN app, under your cube's details.</div></div>
          <input class="field" id="macIn" placeholder="AB:CD:EF:12:34:56" style="width:180px;flex:none">
        </div>`}
        <div style="display:flex;gap:10px;align-items:center;padding:12px 0">
          <button class="btn ${on ? 'outline' : 'primary'} sm" id="pairBtn">${on ? 'Disconnect' : 'Pair a cube'}</button>
          <span class="sub" id="pairMsg" style="flex:1"></span>
        </div>
        ${steps.every((_, i) => done(i)) ? '' : steps.map(([st, sub], i) => `<div style="display:flex;gap:12px;align-items:center;padding:10px 0;border-top:1px solid var(--line-faint)">
          <div class="num" style="width:22px;height:22px;flex:none;border-radius:50%;border:1.5px solid ${done(i) ? 'var(--ok)' : 'var(--line)'};display:grid;place-items:center;font-size:var(--fs-meta);color:${done(i) ? 'var(--ok)' : 'var(--ink-5)'}">${done(i) ? '✓' : i + 1}</div>
          <div style="flex:1"><div style="font-weight:600">${st}</div><div class="sub" style="color:var(--ink-4)">${sub}</div></div>
          ${i === 2 && on ? `<button class="btn sm outline" id="anchorNoBtn" style="flex:none" title="The camera reads it exactly as it is — no need to solve it first">Not solved</button>
          <button class="btn sm primary" id="anchorBtn" style="flex:none">${state.anchored ? 'Re-mark solved' : "It's solved"}</button>
          <button class="btn sm" id="anchorForceBtn" hidden style="flex:none;border:1px solid var(--warn);color:var(--warn)">It is solved — anchor anyway</button>` : ''}
        </div>`).join('')}
        ${on && steps.every((_, i) => done(i)) ? `<div style="display:flex;align-items:center;gap:8px;padding:10px 0;border-top:1px solid var(--line-faint);color:var(--ok);font-size:var(--fs-body-s)">
          ${icon('check', 15)}<span style="flex:1">Set up and tracking.</span>
          <button class="btn sm outline" id="anchorBtn" aria-label="Re-mark this cube as solved">Re-mark solved</button>
        </div>` : ''}
      </div>`; })()}
      <div class="card"><div class="eyebrow">TIMER & CAMERA</div>
        ${toggles.map(([k, lbl, sub]) => `<div style="display:flex;align-items:center;gap:16px;padding:13px 0;border-bottom:1px solid var(--line-faint)">
          <div style="flex:1"><div style="font-weight:600">${t(lbl)}</div><div class="sub" style="color:var(--ink-4)">${t(sub)}</div></div>
          <button class="toggle ${settings[k] ? 'on' : ''}" data-toggle="${k}"><i></i></button></div>`).join('')}</div>
    </div>
    <div class="aside">
      <div class="card"><div class="eyebrow">CUBE COLOURS</div>
        <div style="display:flex;gap:6px;margin-top:12px" id="palSwatch"></div>
        <div style="display:flex;gap:6px;margin-top:12px">${pals.map((p) => `<button class="pill ${settings.palette === p ? 'on' : ''}" data-pal="${p}" style="flex:1;justify-content:center">${p}</button>`).join('')}</div></div>
      ${advancedOpen ? `<div class="card"><div class="eyebrow">ADVANCED</div>
        <div class="sub" style="color:var(--ink-4);margin-top:6px;line-height:1.5">Toolbar tabs. Hiding one only takes it out of the row — its address still works.</div>
        ${HIDEABLE.map(([id, lbl]) => `<div style="display:flex;align-items:center;gap:16px;padding:13px 0;border-bottom:1px solid var(--line-faint)">
          <div style="flex:1"><div style="font-weight:600">${lbl}</div><div class="sub" style="color:var(--ink-4)">${navHidden(id) ? 'Hidden from the toolbar' : 'Shown in the toolbar'}</div></div>
          <button class="toggle ${navHidden(id) ? '' : 'on'}" data-nav-toggle="${id}"><i></i></button></div>`).join('')}
        <div style="display:flex;align-items:center;gap:16px;padding:13px 0;border-bottom:1px solid var(--line-faint)">
          <div style="flex:1"><div style="font-weight:600">Random-cube die</div><div class="sub" style="color:var(--ink-4)">Shows the die on the solve screen that loads a random scrambled cube — a developer shortcut, since that cube is not the one in anyone's hand. Scramble keeps its own die regardless.</div></div>
          <button class="toggle ${settings.devRandCube ? 'on' : ''}" data-toggle="devRandCube"><i></i></button></div>
        <div class="sub" style="color:var(--ink-5);margin-top:12px">⌃⌥⌘D hides this section again.</div></div>` : ''}
      <div class="card"><div class="eyebrow">ABOUT</div>
        <div class="about-brand"><img src="./icons/icon.svg" alt="" width="22" height="22" /><b>Cubus</b></div>
        <div class="about-row">${icon('tag', 15)}<span class="k">${t('Version')}</span><span class="num">${VERSION}</span></div>
        <div class="about-row">${icon('globe', 15)}<span class="k">${t('Website')}</span><a class="link" href="https://cubus.im" target="_blank" rel="noopener">cubus.im</a></div>
        <div class="about-row">${icon('user', 15)}<span class="k">${t('Author')}</span><a class="link" href="https://lixiaolai.com" target="_blank" rel="noopener">@xiaolai</a></div>
        <div class="sub" style="color:var(--ink-3);margin-top:10px;line-height:1.55">${t('Solver and vision run locally. Nothing leaves the device.')}</div></div>
    </div></div>`,
    mount(root) {
      const swatch = () => { const p = NET_COLORS[settings.palette]; $('#palSwatch', root).innerHTML = ['U', 'D', 'R', 'L', 'F', 'B'].map((k) => `<div style="flex:1;height:34px;border-radius:4px;background:${p[k]}"></div>`).join(''); };
      swatch();
      for (const b of root.querySelectorAll('[data-set-theme]')) b.onclick = () => { settings.theme = b.dataset.setTheme; save('cubusSettings', settings); applyTheme(); renderScreen(); };
      for (const b of root.querySelectorAll('[data-pal]')) b.onclick = () => { settings.palette = b.dataset.pal; save('cubusSettings', settings); applyNetColors(); renderScreen(); };
      for (const b of root.querySelectorAll('[data-toggle]')) b.onclick = () => { const k = b.dataset.toggle; settings[k] = !settings[k]; save('cubusSettings', settings); b.classList.toggle('on', settings[k]); };

      // ---- smart cube (recovered from v0) --------------------------------------------------
      // Resolved against the document, not the captured root: anything that re-renders Settings
      // between an action starting and finishing would otherwise leave the result written into a
      // detached node — visible to no one, indistinguishable from the action doing nothing.
      const say = (text, colour) => { const m = $('#pairMsg'); if (m) { m.style.color = colour; m.textContent = text; } };
      const pairBtn = $('#pairBtn', root);

      // What CAN be detected, and what cannot. A browser has no scan-without-permission by
      // design, so there is no honest "1 cube found" line to draw; getAvailability() does say
      // whether pressing Pair can work at all, which beats a button that fails unexplained. The
      // address field appears ONLY where it is genuinely needed: the native build learns the
      // address from its own scan, a browser must be handed it.
      const btNote = $('#btNote', root), macRow = $('#macRow', root);
      if (pairBtn && !state.connected) {
        if (isTauri) {
          if (btNote) btNote.textContent = 'Native Bluetooth — cubus finds the cube itself.';
        } else if (!navigator.bluetooth) {
          if (btNote) btNote.textContent = 'This browser cannot use Bluetooth. The desktop app can, and the camera works either way.';
          pairBtn.disabled = true;
        } else {
          if (macRow) macRow.hidden = false;
          void navigator.bluetooth.getAvailability?.().then((ok) => {
            if (ok !== false) return;
            // Resolved now, not captured at mount: a trust change repaints this card, and nodes
            // taken beforehand are detached by the time this promise settles.
            const note = $('#btNote'), pair = $('#pairBtn');
            if (note) note.textContent = 'No Bluetooth radio available on this machine — turn it on, then reload.';
            if (pair) pair.disabled = true;
          }).catch(() => {}); // an engine without getAvailability tells us nothing
        }
      }

      if (pairBtn) pairBtn.onclick = async () => {
        if (state.connected) {
          // The web transport removes its own disconnect listener before disconnecting, so the
          // driver's event never fires here — without this call, deliberately disconnecting left
          // the cube marked trusted with its correction still applied to nothing.
          try { await transport?.disconnect(); } catch {}
          transport = null;
          onDisconnect();
          return;
        }
        say(isTauri ? 'scanning…' : 'pick your cube in the browser prompt', 'var(--ink-4)');
        try { await doConnect($('#macIn', root)?.value); } catch (e) { say(String(e.message || e), 'var(--err)'); }
      };

      // Resetting the correction does NOT restore trust — it removes the only thing that was
      // making the cube's readings true, and says so.
      $('#offsetReset', root)?.addEventListener('click', () => {
        clearOffset();
        markStale('its correction was reset, so its position is unverified again');
        renderScreen();
      });

      // A nickname is the user's word for a cube: stored because it is useful, never branched on,
      // which is what makes accepting an unverifiable label honest.
      for (const el of root.querySelectorAll('[data-rename-cube]')) {
        el.onchange = () => {
          cubes = renameCube(cubes, el.dataset.renameCube, el.value);
          const rec = cubes[normaliseMac(el.dataset.renameCube)];
          const named = cubeLabel({ ...rec, mac: el.dataset.renameCube });
          if (save('cubusCubes', cubes)) say(`Saved — this cube is "${named}".`, 'var(--ok)');
          else say('Could not save that name — this browser is refusing to store anything.', 'var(--err)');
        };
      }
      for (const el of root.querySelectorAll('[data-use-cube]')) {
        el.onclick = async () => {
          say('connecting…', 'var(--ink-4)');
          try { await doConnect(el.dataset.useCube); } catch (e) { say(String(e.message || e), 'var(--err)'); }
        };
      }
      // Two-step, because a browser on macOS cannot read the address back off the cube:
      // forgetting is the one action here that destroys something the app cannot re-derive.
      for (const el of root.querySelectorAll('[data-forget-cube]')) {
        el.onclick = () => {
          if (el.dataset.armed !== 'yes') {
            el.dataset.armed = 'yes';
            el.textContent = 'Really forget?';
            el.setAttribute('aria-label', `Confirm forgetting ${el.dataset.forgetCube}`);
            el.style.color = 'var(--err)';
            el.style.borderColor = 'var(--err)';
            return;
          }
          cubes = forgetCube(cubes, el.dataset.forgetCube);
          const stored = save('cubusCubes', cubes);
          renderScreen();
          if (!stored) say('Forgotten for now, but this browser will not store the change.', 'var(--err)');
        };
      }
      $('#battRefresh', root)?.addEventListener('click', () => void refreshBattery());

      // anchorSolved() sends REQUEST_RESET only if the cube already reports solved — it throws
      // otherwise, and the refusal is what teaches the step. But the precondition can dead-end an
      // honest user: a cube whose internal solved-reference has drifted reports unsolved WHILE
      // SITTING SOLVED on the desk, and REQUEST_RESET is the only repair. Nothing here can tell
      // that from a genuinely scrambled cube; the person holding it can — so the override is
      // offered, never taken automatically, and it says what it will do.
      const anchorBtn = $('#anchorBtn', root), forceBtn = $('#anchorForceBtn', root);
      const liveAnchorBtn = () => $('#anchorBtn');
      const liveForceBtn = () => $('#anchorForceBtn');
      const anchor = async (force) => {
        if (!conn) { say('not connected', 'var(--err)'); return; }
        // Single-flight: dropping trust re-renders this card, which hands back a fresh enabled
        // button while the first call is still awaiting — two concurrent REQUEST_RESETs.
        if (anchoring) { say('already anchoring…', 'var(--ink-4)'); return; }
        anchoring = true;
        const disable = (on) => {
          const a = liveAnchorBtn(); if (a) a.disabled = on;
          const f = liveForceBtn(); if (f) f.disabled = on;
        };
        disable(true);
        say(force ? 'anchoring anyway…' : 'anchoring…', 'var(--ink-4)');
        const asked = conn;
        try {
          // Trust goes first, and the correction with it: anchorSolved() moves the cube's own
          // solved reference, so the old correction describes a relationship that no longer
          // exists. If the anchor then fails, the cube is left honestly untrusted rather than
          // confidently wrong.
          clearOffset();
          markStale('its reference is being reset');
          await conn.anchorSolved(force ? { force: true } : {});
          // Scoped to the connection that asked: a slow anchor completing after a disconnect must
          // not mark a cube that is no longer there as set up and trusted.
          if (conn !== asked) return;
          state.anchored = true;
          markTrusted('cube'); // the cube and reality were just made to agree — and this repaints
          say('Anchored — the cube agrees it is solved.', 'var(--ok)');
        } catch (e) {
          if (conn !== asked) return;
          state.anchored = false;
          const msg = String(e.message || e).split('\n')[0];
          if (!force && /refusing to anchor/i.test(msg)) {
            say('The cube reports it is not solved. If it IS solved in front of you, its own reference has drifted — anchoring will reset it to this position.', 'var(--warn)');
            const f = liveForceBtn();
            if (f) f.hidden = false;
          } else {
            say(msg, 'var(--err)');
          }
        } finally { anchoring = false; disable(false); }
      };
      if (anchorBtn) anchorBtn.onclick = () => { const f = liveForceBtn(); if (f) f.hidden = true; void anchor(false); };
      if (forceBtn) forceBtn.onclick = () => { void anchor(true); };
      // "Not solved" is a real answer, not a dead end: Restore reads the cube exactly as it is.
      $('#anchorNoBtn', root)?.addEventListener('click', () => go('scan'));

      for (const b of root.querySelectorAll('[data-nav-toggle]')) b.onclick = () => {
        const id = b.dataset.navToggle;
        settings.navHidden = navHidden(id) ? settings.navHidden.filter((x) => x !== id) : [...settings.navHidden, id];
        save('cubusSettings', settings);
        renderNav();
        // Hiding the screen you are standing on would leave the toolbar with nothing marked
        // active. You are on Settings when you press this, so that only bites via a deep link.
        if (navHidden(state.screen)) { go('home'); return; }
        renderScreen(); // repaints this card's own labels, so it cannot describe the old state
      };
    },
  };
};

// Data-driven screens. Stats is now computed entirely from recorded solves — the representative
// numbers it once carried are gone. Trainer, Drill and Lessons still show design-layout content.
// Stats — the session dashboard. This absorbed the old Home screen when Home became the cube:
// the headline numbers, the recent-solve list and the week chart were never a landing page, they
// were this screen's content sitting one nav entry too far to the left.
//
// The one thing not carried over is the "Scan a scrambled cube" call to action. It was a front-door
// affordance, and a stats page is not a front door — Restore has its own nav entry.
SCREENS.stats = () => {
  const solves = recentSolves();
  const s = summarize(solves, Date.now());
  // One rule for the whole screen: a statistic that cannot be computed is an em dash, never a
  // number. Every figure below used to be a literal — a 14.82 single, a 21.44 ao5, a twenty-bar
  // session chart from a hardcoded array — shown identically to someone who had never solved
  // anything. A statistics screen is the one place a person comes specifically to learn what is
  // true, so it is the worst possible place to invent.
  const secs = (v, digits = 2) => (v === null || v === undefined ? '—' : Number(v).toFixed(digits));
  const rate = (v) => (v === null || v === undefined ? '—' : Number(v).toFixed(1));

  // Nothing USABLE, not nothing stored. Corrupt rows are now kept in place so the averages stay
  // honest, so a history of three unreadable records has a length of three and a count of zero —
  // and it is the count that decides whether there is anything to report.
  if (!s.count) {
    return { html: `<div style="height:100%;display:flex;align-items:center;justify-content:center">
      <div class="card" style="max-width:460px;text-align:center;padding:34px">
        <div class="eyebrow">NO SOLVES YET</div>
        <div style="font-size:var(--fs-title);font-weight:600;margin-top:10px">Nothing to report</div>
        <div class="sub" style="color:var(--ink-4);margin-top:8px;line-height:1.55">
          Times and averages appear here once you have solved something.
        </div>
        <button class="btn accent-outline block" data-go="timer" style="margin-top:18px">Open the timer</button>
      </div></div>`, mount() {} };
  }

  // Corrupt rows keep their PLACE in the list above (so the averages stay honest) but are not
  // drawn — a blank row is not information, it is just a gap wearing a border.
  const rows = solves.filter((so) => so.time).slice(0, 12).map((so) => `<div class="row" style="grid-template-columns:34px 1fr 74px;gap:12px">
      <div class="num" style="color:var(--ink-5)">${escHtml(so.n || '')}</div>
      <div class="num" style="color:var(--ink-3);overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${escHtml(so.scramble)}</div>
      <div class="num" style="font-size:var(--fs-title-s);font-weight:600;text-align:right">${escHtml(so.time)}</div></div>`).join('');

  // The session chart is the real times, tallest = slowest, so the shape means something. Scaled
  // to the session's own worst time rather than to a fixed ceiling.
  //
  // Built from the SAME validated view the figures above use, and its "best" marker comes from the
  // bars actually drawn. Deriving the two separately let the chart accept zero and negative times
  // that summarize() rejects, and let the caption say "your best is marked" while marking nothing,
  // because the overall best was older than the twenty solves on screen.
  const chart = times(solves.slice(0, 20)).reverse();
  const worst = chart.length ? Math.max(...chart) : 1;
  const bestT = chart.length ? Math.min(...chart) : null;

  const week = s.week;
  const busiest = Math.max(1, ...week.map((d) => d.count));

  return { html: `<div class="cols">
    <div class="col">
      <div class="grid3">
        <div class="card stat"><div class="eyebrow">SINGLE BEST</div><div class="v">${secs(s.best)}</div><div class="d">${s.count} solve${s.count === 1 ? '' : 's'} recorded</div></div>
        <div class="card stat"><div class="eyebrow">AO5</div><div class="v">${secs(s.ao5)}</div><div class="d">${s.ao5 === null ? (s.count < 5 ? `needs ${5 - s.count} more` : 'a recent solve is unreadable') : 'last five'}</div></div>
        <div class="card stat"><div class="eyebrow">AO12</div><div class="v">${secs(s.ao12)}</div><div class="d">${s.ao12 === null ? `needs ${Math.max(0, 12 - s.count)} more` : 'last twelve'}</div></div>
      </div>
      <div class="card"><div class="eyebrow">LAST ${chart.length} SOLVE${chart.length === 1 ? '' : 'S'}</div>
        <div style="display:flex;align-items:flex-end;gap:4px;height:130px;margin-top:16px">${chart.map((v) => `<div title="${secs(v)}s" style="flex:1;background:${v === bestT ? 'var(--accent)' : 'var(--ink-6)'};height:${Math.max(4, Math.round((v / worst) * 100))}%;border-radius:2px 2px 0 0"></div>`).join('')}</div>
        <div class="sub" style="color:var(--ink-5);margin-top:10px;font-size:var(--fs-meta)">Taller is slower.${bestT === null ? '' : ' The fastest of these is marked.'}</div></div>
      <div class="card tight" style="flex:1;min-height:0;display:flex;flex-direction:column">
        <div class="card-h"><b>Recent solves</b><span class="num sub">${s.count}</span></div>
        <div class="list" style="overflow-y:auto">${rows}</div></div>
    </div>
    <div class="aside" style="overflow-y:auto">
      <div class="card"><div class="eyebrow">AVERAGES</div>
        ${[['single', secs(s.best)], ['ao5', secs(s.ao5)], ['ao12', secs(s.ao12)], ['ao100', secs(s.ao100)]].map(([k, v]) => `<div class="row" style="grid-template-columns:1fr auto;border-color:var(--line-faint)"><div style="color:var(--ink-3)">${k}</div><div class="num" style="font-size:var(--fs-title);font-weight:600">${v}</div></div>`).join('')}
        <div class="sub" style="color:var(--ink-5);margin-top:10px;font-size:var(--fs-meta)">An average of n needs n solves. Until then it is a dash, not a guess.</div></div>
      <div class="card"><div class="eyebrow">WEEK</div>
        <div style="display:flex;align-items:flex-end;gap:8px;height:110px;margin-top:14px">
        ${week.map((d, i) => `<div title="${d.count} solve${d.count === 1 ? '' : 's'}${d.best === null ? '' : ` · best ${secs(d.best)}`}" style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;height:100%;justify-content:flex-end">
          <div style="width:100%;border-radius:3px 3px 0 0;height:${d.count ? Math.max(6, Math.round((d.count / busiest) * 100)) : 2}%;background:${i === week.length - 1 && d.count ? 'var(--accent)' : 'var(--ink-6)'}"></div>
          <div style="font-size:var(--fs-meta);color:var(--ink-5)">${d.label}</div></div>`).join('')}</div>
        <div class="sub" style="color:var(--ink-5);margin-top:14px;font-size:var(--fs-meta)">Solves per day. Only solves recorded with a date appear here.</div></div>
    </div></div>`, mount() {} };
};

SCREENS.trainer = () => {
  const P2 = NET_COLORS[settings.palette];
  const oll = [['OLL 21', "R U2 R' U' R U R' U' R U' R'", 'var(--ok)', '82%'], ['OLL 22', "R U2 R2 U' R2 U' R2 U2 R", 'var(--accent)', '64%'], ['OLL 24', "r U R' U' r' F R F'", 'var(--err)', '22%'], ['OLL 27', "R U R' U R U2 R'", 'var(--ok)', '94%'], ['PLL T', "R U R' U' R' F R2 U' R' U' R U R' F'", 'var(--accent)', '71%'], ['PLL Y', "F R U' R' U' R U R' F' R U R' U' R' F R F'", 'var(--err)', '29%']];
  const grid = (seed) => Array.from({ length: 9 }, (_, i) => ((i * 7 + seed * 3) % 4 === 0 ? P2.D : 'var(--facelet-off)'));
  return { html: `<div style="height:100%;display:flex;flex-direction:column;gap:16px">
    <div style="display:flex;gap:8px;align-items:center">${['OLL', 'PLL', 'F2L', 'Weak first'].map((f, i) => `<button class="pill ${i === 0 ? 'on' : ''}">${f}</button>`).join('')}<span class="sub" style="margin-left:auto;color:var(--ink-4)">Sorted by weakest recall</span></div>
    <div style="flex:1;min-height:0;overflow-y:auto;display:grid;grid-template-columns:repeat(5,1fr);gap:14px;align-content:start">
    ${oll.map(([name, alg, color, pct], i) => `<button class="card" data-go="drill" style="text-align:center;cursor:pointer">
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;width:76px;margin:0 auto">${grid(i).map((g) => `<div style="aspect-ratio:1;border-radius:2px;background:${g}"></div>`).join('')}</div>
      <div style="font-weight:700;margin-top:10px">${name}</div><div class="num sub" style="color:var(--ink-4);min-height:28px;font-size:var(--fs-caption)">${alg}</div>
      <div class="bar" style="margin-top:6px"><i style="width:${pct};background:${color}"></i></div></button>`).join('')}</div></div>`, mount() {} };
};

SCREENS.drill = () => {
  const P2 = NET_COLORS[settings.palette];
  const grid = Array.from({ length: 9 }, (_, i) => ((i * 7 + 9) % 4 === 0 ? P2.D : 'var(--facelet-off)'));
  return { html: `<div class="cols"><div class="col"><div class="card" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px">
      <div class="eyebrow">OLL 24 · DOT CASES · 3 OF 12</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;width:180px">${grid.map((g) => `<div style="aspect-ratio:1;border-radius:4px;background:${g}"></div>`).join('')}</div>
      <div class="num" id="drillAlg" style="font-size:var(--fs-display-s);font-weight:600;color:var(--ink-6)">· · · · · · · ·</div>
      <button class="btn accent-outline" id="reveal">Reveal algorithm</button>
      <div style="display:flex;gap:10px"><button class="btn outline" style="color:var(--err)" data-next>Again</button><button class="btn outline" data-next>Good</button><button class="btn primary" data-next>Easy</button></div>
    </div></div>
    <div class="aside"><div class="card"><div class="eyebrow">THIS DRILL</div><div class="num" style="font-size:var(--fs-display);font-weight:600;margin-top:6px">2.14</div><div class="sub" style="color:var(--ink-4)">average execution, 9 reps</div><div class="bar" style="margin-top:14px"><i style="width:25%"></i></div></div>
      <div class="card" style="flex:1;min-height:0"><div class="eyebrow">QUEUE</div>${[['OLL 24', 'now'], ['OLL 25', 'now'], ['OLL 23', '+2'], ['PLL Y', '+5'], ['OLL 22', 'tomorrow']].map(([n, due], i) => `<div class="row" style="grid-template-columns:1fr auto;border-color:var(--line-faint)"><div style="color:${i === 0 ? 'var(--ink)' : 'var(--ink-3)'};font-weight:${i === 0 ? 700 : 500}">${n}</div><div class="num sub" style="color:var(--ink-5)">${due}</div></div>`).join('')}</div></div></div>`,
    mount(root) {
      let shown = false; const alg = "r U R' U' r' F R F'";
      $('#reveal', root).onclick = (e) => { shown = !shown; $('#drillAlg', root).textContent = shown ? alg : '· · · · · · · ·'; $('#drillAlg', root).style.color = shown ? 'var(--ink)' : 'var(--ink-6)'; e.target.textContent = shown ? 'Hide algorithm' : 'Reveal algorithm'; };
      for (const b of root.querySelectorAll('[data-next]')) b.onclick = () => { shown = false; $('#drillAlg', root).textContent = '· · · · · · · ·'; $('#drillAlg', root).style.color = 'var(--ink-6)'; $('#reveal', root).textContent = 'Reveal algorithm'; };
    },
  };
};

SCREENS.lessons = () => {
  const ch = [['CHAPTER 1 · 4 LESSONS', 'Beginner layer method', '4/4', [['White cross', '5 min', 'Done', 'var(--ok)'], ['First layer corners', '7 min', 'Done', 'var(--ok)'], ['Middle layer', '9 min', 'Done', 'var(--ok)'], ['Last layer', '12 min', 'Done', 'var(--ok)']]], ['CHAPTER 2 · 3 LESSONS', 'Getting under a minute', '1/3', [['Efficient cross', '6 min', 'Done', 'var(--ok)'], ['Keyhole F2L', '6 min', 'Next', 'var(--accent)'], ['Look-ahead drills', '8 min', 'Locked', 'var(--ink-5)']]]];
  return { html: `<div class="cols"><div class="col" style="overflow-y:auto">
    ${ch.map(([kick, title, prog, ls]) => `<div class="card tight"><div class="card-h"><div><div class="eyebrow">${kick}</div><div class="num" style="font-size:var(--fs-title);font-weight:600;margin-top:2px">${title}</div></div><div class="num sub" style="color:var(--ink-4)">${prog}</div></div>
      ${ls.map(([t, len, tag, fg]) => `<div class="row" style="grid-template-columns:8px 1fr auto auto;gap:14px"><div style="width:8px;height:8px;border-radius:50%;background:${fg}"></div><div style="color:${tag === 'Locked' ? 'var(--ink-5)' : 'var(--ink)'};font-weight:${tag === 'Next' ? 700 : 500}">${t}</div><div class="sub" style="color:var(--ink-5)">${len}</div><div style="font-weight:600;color:${fg}">${tag}</div></div>`).join('')}</div>`).join('')}</div>
    <div class="aside"><div class="card"><div class="eyebrow">UP NEXT</div><div class="num" style="font-size:var(--fs-title);font-weight:600;margin-top:8px">Keyhole F2L</div><div style="color:var(--ink-3);margin-top:6px;line-height:1.5">A bridge between the beginner method and full F2L. 6 minutes, then a 10-case drill.</div><button class="btn outline block" data-go="drill" style="margin-top:14px">Start lesson</button></div>
      <div class="card"><div class="eyebrow">COACH VIEW</div><div class="sub" style="color:var(--ink-3);margin-top:8px;line-height:1.5">Share a read-only link so a parent or coach can follow lesson progress and session times.</div><button class="btn accent-outline block" style="margin-top:12px">Create share link</button></div></div></div>`, mount() {} };
};

// ===============================================================================================
// Router + boot
// ===============================================================================================
// ⌃⌥⌘D reveals (and hides) the Advanced section in Settings.
//
// `e.code`, not `e.key`: on macOS Option rewrites the character, so this chord arrives as `∂` and
// a key-based check would never match. `code` is the physical key and is layout-independent.
// Every modifier is required, so this cannot collide with a plain typing shortcut.
// External links (the About card). In a browser the anchors just work; the desktop webview gives
// `target="_blank"` nothing, so when the opener plugin's API is injected (withGlobalTauri) the
// click is handed to the system browser instead. One delegated listener, checked at click time,
// so the same markup serves both builds — the seam pattern AGENTS.md sanctions.
function installExternalLinks() {
  document.addEventListener('click', (ev) => {
    const a = ev.target.closest?.('a[href^="http"]');
    const open = window.__TAURI__?.opener?.openUrl;
    if (!a || !open) return;
    ev.preventDefault();
    // Failure surfaces rather than vanishing: a rejected open used to be exactly the kind of
    // silent no-op this app keeps having to dig out.
    Promise.resolve(open(a.href)).catch((e) => console.error('external link not opened', e));
  });
}

function installAdvancedShortcut() {
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyD' || !e.ctrlKey || !e.altKey || !e.metaKey) return;
    e.preventDefault();
    advancedOpen = !advancedOpen;
    // Turning it on somewhere else would be invisible, so go and show it. Turning it off only
    // needs a repaint, and only if the section is on screen to disappear from.
    if (advancedOpen && state.screen !== 'settings') go('settings');
    else if (state.screen === 'settings') renderScreen();
  });
}

function renderNav() {
  const items = NAV.filter(([id]) => !navHidden(id));
  $('#nav').innerHTML = items.map(([id, lbl, ic]) => `<button class="nav-item ${state.screen === id ? 'active' : ''}" data-nav="${id}"${state.screen === id ? ' aria-current="page"' : ''}><span class="ico">${icon(ic, 15)}</span><span class="lbl">${t(lbl)}</span></button>`).join('');
  for (const b of $('#nav').querySelectorAll('[data-nav]')) b.onclick = () => go(b.dataset.nav);
  // Settings sits outside the row (buildChrome draws it), so it is marked here, not by the template.
  $('#tbTrail [data-nav="settings"]')?.classList.toggle('active', state.screen === 'settings');
}
function renderScreen() {
  if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
  liveUpdate = null;
  liveMove = null;
  liveGap = null;
  onCubeLost = null;
  setTitle(t(TITLES[state.screen] ?? 'Cubus'));
  const build = SCREENS[state.screen] || SCREENS.home;
  const spec = build();
  screenGen += 1; // async mounts compare against this to detect that they are obsolete
  const stage = $('#stage'); stage.innerHTML = `<div class="screen active">${spec.html}</div>`;
  const root = stage.firstElementChild;
  for (const b of root.querySelectorAll('[data-go]')) b.onclick = () => go(b.dataset.go);
  // Two failure modes, and try/catch only covers one: cubeScreen's mount is async, so anything it
  // throws after its first await escapes as an unhandled rejection instead of reaching here.
  try {
    Promise.resolve(spec.mount?.(root)).catch((e) => console.error('screen mount failed', e));
  } catch (e) { console.error('screen mount failed', e); }
}
// Screens are addressable as #/<id>, so a reload or a shared link lands where it left off, and the
// webview's Back/Forward walk the screens. SCREENS is the routable set — an unknown id resolves to
// home rather than rendering nothing.
const router = makeRouter({
  screens: SCREENS,
  defaultScreen: 'home',
  location: window.location,
  history: window.history,
});
// Solve guide and Playback were absorbed into the cube screen. Their links are already out in
// bookmarks and in anything the app has ever put in an address bar, and an unknown id falls back to
// home — which would send someone who saved a solve link somewhere unrelated. Rewritten silently,
// before the router gets a chance to canonicalise them to home.
// `viewer` joins them: the cube screen is Home now. `pair` too — smart-cube setup moved into
// Settings, so #/pair lands where the controls actually are.
const ALIAS = { guide: 'home', playback: 'home', viewer: 'home' };
function resolveAlias() {
  const raw = String(window.location.hash || '').replace(/^#\/?/, '').trim();
  const target = ALIAS[raw];
  if (!target) return;
  try { window.history.replaceState(null, '', `#/${target}`); }
  catch { window.location.hash = `#/${target}`; }
}
function applyRoute() { state.screen = router.current(); renderNav(); renderScreen(); }
// A hash assignment only fires hashchange when the value actually differs, so navigating onto the
// screen already showing would do nothing. go() renders directly in that case, preserving the
// always-re-render behaviour the scan flow depends on (go('home') while on home).
function go(id) { if (!router.go(id)) applyRoute(); }
window.addEventListener('hashchange', () => { resolveAlias(); applyRoute(); });
window.cubusGo = go;
/** Test seam for the cube stream. In production the driver is the only caller of these (see
 * doConnect); following cannot otherwise be exercised without a physical GAN cube in the room,
 * which is precisely why its worst bug survived so long. Same shape as cubusGo above. */
window.cubusFeed = {
  move: (m) => liveMove?.(m),
  facelets: (f) => onFacelets(f),
  gap: (g) => onGap(g), // the driver's door, not the screen's — see onGap
  disconnect: () => onDisconnect(),
  /** Stand in for a paired driver. Setting `state.connected` alone is deliberately not enough —
   *  a flag saying "connected" with nothing behind it must fall back to the camera, which is its
   *  own test. This is the SAME call doConnect makes, not a lookalike: the address is part of a
   *  connection, and identity is what the registry keys on. */
  useConnection: (fake, mac = 'AA:BB:CC:DD:EE:FF') => {
    conn = fake;
    if (fake) adoptConnection(mac, 'Test cube');
    else onDisconnect();
    // doConnect reads the battery on connect; a stand-in that skipped it would leave every test
    // looking at the "unknown" state and quietly never exercise the meter at all.
    if (fake) void refreshBattery();
  },
};

async function boot() {
  const platform = detectPlatform();
  document.documentElement.dataset.host = isTauri ? 'tauri' : 'web';
  document.documentElement.dataset.platform = platform;
  buildChrome(platform);
  installAdvancedShortcut();
  installExternalLinks();
  // '' = follow the browser/OS language. No-op until a catalog is registered; the picker arrives
  // with the first second language, because a menu listing only English is furniture.
  initLocale(settings.language);
  // Dev-only MCP guest: in-page listeners that let an AI agent drive the app (selector clicks,
  // DOM queries, JS eval) through tauri-plugin-mcp. Loaded only under Tauri; inert without the
  // Rust side, which only exists behind the desktop crate's `mcp` feature + CUBUS_MCP=1 and is
  // never compiled into a release. debug-logged rather than silent, so a missing bundle in dev
  // is findable while a release dist that ships without it stays quiet by design.
  if (isTauri) {
    import('../vendor/tauri-mcp-guest.js')
      .then((m) => m.setupPluginListeners?.())
      .catch((e) => console.debug('tauri-mcp guest not loaded', e));
  }
  // Resolve the deep link before the first paint, and canonicalise the URL so a bogus hash does
  // not sit in the address bar contradicting the screen on show.
  applyTheme(); applyNetColors(); resolveAlias(); router.normalize(); applyRoute();
  // Load the solver in the background so Random / Solve / Timer are ready. 'scan' is deliberately
  // NOT in that list: nothing on it depends on the solver, and re-rendering it would tear down a
  // camera that just opened and open a second one.
  if (await loadSolver()) { setFacelets(state.cube.facelets); if (['home', 'viewer', 'timer'].includes(state.screen)) renderScreen(); }
}
boot();
