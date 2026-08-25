// Cubus app controller. Renders the designed multi-screen shell and wires it to the real
// engine: cubejs (independent oracle + random + validity), cubing.js (min2phase solve), the
// gan-driver transport seam (Web Bluetooth / Tauri native BLE), and the YOLO camera scanner.
// The 3D cube is <cubus-cube> (Renderer B) — it draws only; state and solving stay here.

import { makeTauriTransport, makeWebBluetoothTransport } from './cube-transport.js';
import { makeRouter } from './router.js';

const $ = (sel, root = document) => root.querySelector(sel);
const SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
const PALETTE_ATTR = { muted: 'muted', classic: 'classic', colorsafe: 'colorsafe' };
/** Escape text destined for an innerHTML template. A Bluetooth device name is chosen by whatever
 * is advertising, so it is untrusted input that must never be parsed as markup. Screens that can
 * use textContent do; this is for the ones building an HTML string. */
const escHtml = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const load = (k, fb) => { try { return { ...fb, ...JSON.parse(localStorage.getItem(k) || '{}') }; } catch { return { ...fb }; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

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
  bluetooth: '<path d="m7 7 10 10-5 5V2l5 5L7 17"/>',
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
  'panel-left': '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  minus: '<path d="M5 12h14"/>',
  square: '<rect x="5" y="5" width="14" height="14" rx="1"/>',
  webcam: '<circle cx="12" cy="10" r="8"/><circle class="lens" cx="12" cy="10" r="3"/><path d="M7 22h10"/><path d="M12 22v-4"/>',
  'paint-roller': '<rect width="16" height="6" x="2" y="2" rx="2"/><path d="M10 16v-2a2 2 0 0 1 2-2h8a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect width="4" height="6" x="8" y="16" rx="1"/>',
};
const icon = (name, size = 16) => `<svg class="ic" viewBox="0 0 24 24" style="width:${size}px;height:${size}px">${P[name] || '<circle cx="12" cy="12" r="2"/>'}</svg>`;

// ---- navigation model ------------------------------------------------------------------------
// One flat list. The SOLVE / PRACTICE / LEARN headings were a taxonomy for nine items, which is
// fewer than the number of rows a person can scan at a glance — the labels cost three lines of
// chrome and a level of hierarchy to sort a list short enough not to need sorting.
const NAV = [
  ['home', 'Home', '', 'box'],
  ['scan', 'Restore', '', 'grid'],
  ['scramble', 'Scramble', '', 'grid-filled'],
  ['timer', 'Timer', '', 'timer'],
  ['stats', 'Stats', '', 'chart'],
  ['trainer', 'Alg trainer', '78', 'cap'],
  ['drill', 'Drill', '12', 'repeat'],
  ['lessons', 'Lessons', '9', 'book'],
  ['settings', 'Settings', '', 'settings'],
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
const settings = load('cubusSettings', { theme: 'auto', palette: 'muted', inspection: true, autosolve: false, cameraId: '', navHidden: [] });

/** Is the Advanced section revealed? Deliberately NOT part of `settings`, so it is not persisted:
 * a section you reach with an undocumented chord should start closed every time, not stay open
 * forever because you once looked at it. What it CONTROLS (navHidden) is a real preference and is
 * saved; the disclosure itself lasts for this page only.
 *
 * Earlier versions stored it, so drop any leftover key rather than letting `save()` keep rewriting
 * a field nothing reads. */
delete settings.advanced;
let advancedOpen = false;

/** Sidebar entries the Advanced section can hide. These are the screens still carrying
 * placeholder data, so being able to take them out of the way is the point. Hiding is cosmetic:
 * the route keeps working, so a deep link or a typed #/trainer still gets you there. */
const HIDEABLE = [['trainer', 'Alg trainer'], ['drill', 'Drill'], ['lessons', 'Lessons']];

// localStorage is untrusted input: anything in here that is not a hideable id is dropped rather
// than allowed to silently remove some other nav entry.
const HIDEABLE_IDS = new Set(HIDEABLE.map(([id]) => id));
settings.navHidden = (Array.isArray(settings.navHidden) ? settings.navHidden : []).filter((id) => HIDEABLE_IDS.has(id));
// Checked per call, not just once at load: a stored id that is not hideable must never be able to
// hide some OTHER nav entry (a stray "home" in there would take Home out of the sidebar).
const navHidden = (id) => HIDEABLE_IDS.has(id) && settings.navHidden.includes(id);
const state = {
  screen: 'home',
  connected: false, cubeName: '', battery: '',
  // Whether the cube's solved reference has been anchored this session (pair screen step 4).
  // Not persisted: it describes the live connection, and a new one starts unanchored.
  anchored: false,
  cube: { facelets: SOLVED, setupAlg: '', solution: '', moves: [], solvable: false, stepFacelets: [] },
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
  // Silence here disables Follow-cube with no explanation: the mode needs one state per step and
  // simply reports "needs a solve worked out on this screen" when the array is short.
  try { const b = Cube.fromString(c.facelets); sf.push(b.asString()); for (const m of moves) { b.move(m); sf.push(b.asString()); } } catch (err) {
    console.warn('per-step facelets unavailable; Follow cube will stay off', err);
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
  document.documentElement.setAttribute('data-theme', settings.theme === 'auto' ? '' : settings.theme);
  if (settings.theme === 'auto') document.documentElement.removeAttribute('data-theme');
}

// ---- transport seam (Web Bluetooth / Tauri) --------------------------------------------------
const isTauri = typeof window.__TAURI__ !== 'undefined';

// Which window chrome to draw (paper-one platform.ts): a UA sniff is enough — the platform can't
// change under a running window. `?platform=macos|windows|linux` pins it for design review
// (persisted); `?platform=auto` clears. Only macOS draws a custom overlay titlebar.
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

// Build the titlebar zones per platform (paper-one TitleBar): macOS puts the traffic lights (real
// in Tauri, preview-only in a browser) leading; Windows/Linux put app controls leading and caption
// buttons trailing. The caption buttons drive the Tauri window; in a browser they only preview.
function buildChrome(platform) {
  const lead = document.getElementById('tbLead');
  const trail = document.getElementById('tbTrail');
  if (!lead || !trail) return;
  const ctl = (name, on = false) => `<button class="tb-ctl${on ? ' on' : ''}" tabindex="-1" aria-hidden="true">${icon(name, 18)}</button>`;
  const cap = (name, win, round = false) => `<button class="tb-cap ${win}${round ? ' round' : ''}" data-win="${win}" title="${win}">${icon(name, round ? 14 : 16)}</button>`;
  if (platform === 'macos') {
    const preview = new URLSearchParams(window.location.search).get('chrome') === 'preview';
    lead.className = 'tb-zone tb-lights';
    lead.innerHTML = (!isTauri && preview) ? ['#E8695E', '#E0B341', '#5FB55F'].map((c) => `<span class="tl" style="background:${c}"></span>`).join('') : '';
    trail.className = 'tb-zone tb-macos-trail';
    trail.innerHTML = '';
    return;
  }
  // Windows / Linux: a real 44px row — app controls lead, caption buttons trail.
  lead.className = 'tb-zone tb-apps';
  lead.innerHTML = ctl('panel-left', true) + ctl('search');
  const round = platform === 'linux';
  trail.className = `tb-zone tb-caption ${platform}`;
  trail.innerHTML = cap('minus', 'min', round) + cap('square', 'max', round) + cap('x', 'close', round);
  wireWindowButtons(trail);
}

/**
 * Show the screen's name in the title bar — all of them. The custom overlay chip is the one macOS
 * and the browser draw, but the Tauri build on Windows and Linux hides that row in favour of the
 * native title bar, so the name would simply vanish there. Setting the window title covers that,
 * and puts the screen in the taskbar and window switcher besides; document.title does the same for
 * a browser tab.
 */
function setTitle(name) {
  const el = $('#title');
  if (el) el.textContent = name;
  document.title = `${name} · Cubus`;
  if (isTauri) {
    // try/catch only covers the synchronous reach into the API — a rejected setTitle() would
    // escape it as an unhandled rejection, so the promise gets its own catch.
    try { window.__TAURI__?.window?.getCurrentWindow?.()?.setTitle?.(`${name} · Cubus`)?.catch?.(() => {}); } catch {}
  }
}

// Wire the drawn caption buttons to the Tauri window (no-ops in a browser preview).
function wireWindowButtons(root) {
  if (!isTauri) return;
  const win = window.__TAURI__?.window?.getCurrentWindow?.();
  if (!win) return;
  const on = (sel, fn) => root.querySelector(sel)?.addEventListener('click', () => { void Promise.resolve(fn()).catch(() => {}); });
  on('[data-win="min"]', () => win.minimize());
  on('[data-win="max"]', () => win.toggleMaximize());
  on('[data-win="close"]', () => win.close());
}

let conn = null, transport = null, connMac = '';
try { connMac = localStorage.getItem('cubeMac') || ''; } catch {}

function setConnected(on, name = '', battery = '') {
  state.connected = on; state.cubeName = name; state.battery = battery;
  // The anchor belongs to a connection, not to the app. A reconnect (or a different
  // cube) starts unanchored, so step 4 must not keep claiming it is done.
  if (!on) state.anchored = false;
  // Updated in place rather than by re-rendering: the cube screen may be part-way through a walk,
  // and rebuilding it on connect would restart the animation and lose the step you were on.
  // The element only exists while that screen is mounted, hence the optional chaining.
  const live = $('#cubeLive');
  if (live) {
    live.hidden = !on;
    live.title = on ? `${name || 'Smart cube'} connected${battery ? ` · ${battery} battery` : ''}` : '';
  }
  // Settings, not 'pair' — the smart-cube card lives there now, and it renders its own connected
  // state, the anchor button and the setup ticks. A stale id here left all three frozen.
  if (state.screen === 'settings') renderScreen();
}

// gan-driver bundle lives at ../vendor relative to this module (apps/web/lib/app.js).
async function doConnect(macFromUi) {
  if (transport) { try { await transport.disconnect(); } catch {} transport = null; conn = null; }
  try {
    const { GanCube } = await import('../vendor/gan-driver.js');
    let mac = (macFromUi || connMac || '').trim(), name = 'GAN cube';
    if (isTauri) {
      transport = makeTauriTransport(); await transport.start();
      const info = await window.__TAURI__.core.invoke('connect_cube');
      name = info.name || name; mac = info.mac || mac;
      if (!mac) throw new Error('cube MAC unavailable — enter it and reconnect');
    } else {
      if (!navigator.bluetooth) throw new Error('Web Bluetooth unavailable in this browser');
      if (!mac) throw new Error('enter your cube’s MAC first (macOS hides it)');
      transport = makeWebBluetoothTransport(); await transport.start();
    }
    const cube = new GanCube({ mac, transport });
    cube.onFacelets((f) => { onFacelets(f.facelets); });
    // The move stream was never subscribed to before. Following ran on ~1Hz snapshots alone, so a
    // turn sequence completed inside one second produced no intermediate state to match against.
    cube.onMove((m) => { if (liveMove) liveMove(m); });
    cube.on('gap', (g) => { if (liveGap) liveGap(g); });
    cube.on('disconnect', () => { conn = null; setConnected(false); });
    cube.on('error', () => {});
    cube.connect(); conn = cube;
    connMac = mac; try { localStorage.setItem('cubeMac', mac); } catch {}
    setConnected(true, name, '78%');
    cube.getState({ active: true }).then((f) => onFacelets(f.facelets)).catch(() => {});
  } catch (err) {
    try { if (transport) await transport.disconnect(); } catch {}
    transport = null; conn = null; setConnected(false);
    throw err;
  }
}

// New physical state (from the cube or the scanner): recompute + refresh the active screen.
function onFacelets(f) {
  if (!f || f === state.cube.facelets) return;
  // ingest, not set: a snapshot from the cube must not cost a Kociemba search.
  ingestFacelets(f);
  if (liveUpdate) liveUpdate(f);
  else if (state.screen === 'home') renderScreen();
}

// ---- session store (recent solves) -----------------------------------------------------------
const SAMPLE_SOLVES = [
  ['19.02', "R U' F2 D B L' U2 R' F D'", '5.9'], ['22.41', "B2 U R' D2 F L U' R2 D F'", '5.1'],
  ['24.86', "L' D2 R U F2 B' L2 U' R D", '4.8'], ['21.10', "F R2 U' L D' B2 R U2 F' L'", '5.4'],
  ['17.94', "D' L U2 R' F B2 U L2 D R", '6.2'],
];
function recentSolves() { const s = load('cubusSolves', { list: [] }); return s.list.length ? s.list : SAMPLE_SOLVES.map(([time, scramble, tps], i) => ({ n: SAMPLE_SOLVES.length - i, time, scramble, tps })); }
function pushSolve(time) {
  const s = load('cubusSolves', { list: [] });
  s.list = [{ n: (s.list[0]?.n || 0) + 1, time, scramble: currentScramble || '—', tps: '' }, ...s.list].slice(0, 50);
  save('cubusSolves', s);
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
// Set by a screen that can take a new cube state in place. Without it, a live smart cube rebuilds
// the screen on every quarter turn — which on the cube screen means restarting an animation the
// user is halfway through following.
let liveUpdate = null;
/** The cube screen installs these while following. Moves are the SIGNAL — the cube reports one per
 * turn, immediately. Facelet snapshots arrive at ~1Hz and are the CORRECTION: they say where the
 * cube really is when the move stream and the guide have drifted apart. */
let liveMove = null;
let liveGap = null;

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
          <div class="tile" style="border-color:${edgeColors(f)}">${pending(f)}</div><div class="lbl">${SCAN_FACE_NAME[f]}</div></div>`).join('')}</div>
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
        <div class="sub scan-say" id="scanHow" style="margin-top:4px">${registered ? 'Opening the camera…' : 'Loading the scanner…'}</div></div>
      <button class="btn accent-outline block" data-go="home" style="margin-top:auto">Solve this cube</button>
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
      // validated string IS the canonical layout. The tiles are repainted from it, so the edge
      // colours on a tile finally agree with the stickers inside it. Faded down and back, with the
      // swap at the low point, so it reads as the scan settling rather than as stickers twitching.
      let settled = false;
      let settleTimer = 0;
      const repaintCanonical = (fl) => {
        for (const tile of tiles) {
          const fi = NET_FACES.indexOf(tile.dataset.face);
          const letters = fl.slice(fi * 9, fi * 9 + 9);
          [...tile.querySelectorAll('i')].forEach((c, i) => {
            c.style.backgroundColor = pal[letters[i]] ?? 'var(--facelet-off)';
          });
        }
      };
      const panel = $('ai-scan-panel', root);
      const say = $('#scanHow', root), sayTitle = $('#scanHowTitle', root);
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
      // Throw the whole scan away. With the camera dark this is also the way back on, since a
      // refused permission leaves nothing else to press.
      resetBtn.onclick = () => {
        closePops();
        // While painting there is no camera to reopen — restart() clears the canvas and stays.
        if (painting || camOn) panel.restart?.();
        else void panel.start?.();
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
        // that breaks validity must not leave canonically-repainted tiles claiming otherwise.
        if (p.phase !== 'done') settled = false;
        say.textContent = p.message || HOW;
        say.className = 'sub scan-say' + (p.phase === 'error' ? ' err' : p.phase === 'checking' || p.phase === 'done' ? ' ok' : '');
        sayTitle.textContent = (p.message && SAY_TITLE[p.phase]) || 'How it works';
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
          if (got) paint(cells, got.colors);
          else cells.forEach((c, i) => { c.style.backgroundColor = i === 4 ? pal[f] : 'var(--facelet-off)'; });
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
        settled = true;
        const fl = e.detail.facelets;
        const faces = $('.scan-faces', root);
        faces.classList.add('settling');
        clearTimeout(settleTimer);
        settleTimer = setTimeout(() => { repaintCanonical(fl); faces.classList.remove('settling'); }, 190);
        onFacelets(e.detail.facelets);
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
        // Mark the colour already there, so the picker shows what it is changing FROM.
        const current = cellEl.style.backgroundColor;
        for (const b of swatches.children) b.classList.toggle('now', b.style.backgroundColor === current);
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

      // Removing the element releases the camera through disconnectedCallback, but a live camera
      // is not something to leave to a lifecycle callback firing — stop it explicitly first.
      cleanup = () => {
        clearTimeout(settleTimer);
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
// A live smart cube updates this screen IN PLACE (see liveUpdate): a full re-render on every
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
          <span class="ind" id="cubeLive" ${state.connected ? '' : 'hidden'} title="${state.connected ? escHtml(state.cubeName) + ' connected' : ''}">${icon('bluetooth', 17)}</span>
          <button id="speedBtn" title="Animation speed">${icon('gauge', 20)}</button>
        </div>` : ''}
        <div style="position:relative;flex:1;min-height:0;width:100%">
          <div class="cube-slot" id="viewCube" style="height:100%"></div>
          ${walking ? `<div class="done-mark" id="doneMark" hidden>${icon('check', 34)}</div>` : ''}
        </div>
      </div>
      ${walking ? `<div class="card">
        <div class="transport">
          <button class="tbtn" id="prevBtn" title="Back a move">${icon('chevron-left', 20)}</button>
          <button class="tbtn" id="repeatBtn" title="Show that move again">${icon('refresh', 18)}</button>
          <button class="tbtn" id="nextBtn" title="Next move">${icon('chevron-right', 20)}</button>
          <button class="tbtn primary" id="playBtn" title="Play from here to the end">${icon('play', 18)}</button>
          <div class="progress" title="How far through the ${walked} you are"><span id="progBar"></span></div>
          ${state.connected ? `<button class="pill on" data-mode="cube" title="Turn your smart cube and the guide keeps up">Follow cube</button>` : ''}
          <span class="num" id="stepLbl" style="color:var(--ink-4);min-width:64px;text-align:right">0 / 0</span>
        </div>
      </div>` : ''}
    </div>
    <div class="aside" style="overflow-y:auto">
      ${walking ? `<div class="card tight" style="flex:1;min-height:140px;display:flex;flex-direction:column">
        <div class="card-h"><b>${label}</b><span class="num sub" id="moveCount">—</span></div>
        <div class="list" id="solList" style="padding:6px 0"></div>
        <div class="follow-note" id="followNote" hidden>
          <span id="followMsg"></span>
          <div class="acts">
            <button class="btn sm accent-outline" id="resolveBtn">Re-solve</button>
            <button class="btn sm outline" id="turnBackBtn">I'll turn it back</button>
          </div>
        </div></div>` : ''}
      <div class="card">
        <div class="eyebrow-row"><div class="eyebrow">${scrambling ? 'TARGET STATE' : 'INITIAL STATE'}</div>
          <button id="randCube" title="${scrambling ? 'Roll a different scramble' : 'Load a random scrambled cube'}">${icon('dice', 18)}</button></div>
        <div class="net" id="viewNet" style="margin-top:12px"></div></div>
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
      $('#randCube', root).onclick = () => {
        if (!solverReady) return;
        // Re-entering is what rolls a new one: the moves, the chips and the step count are all
        // built at mount, so repainting in place would leave a new cube wearing the old list.
        if (scrambling) { go('scramble'); return; }
        onFacelets(randomScramble());
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
      setStatus(total + ' moves');
      // A scramble has no stages — CROSS/F2L/OLL/PLL are phases of solving, and pinning them on a
      // scramble would invent structure that is not there.
      const stages = scrambling ? [['SCRAMBLE', 0, total]] : stageSplit(total);
      solList.innerHTML = stages.map(([name, a, b]) => `<div style="padding:10px 16px 14px">
        <div style="display:flex;justify-content:space-between"><span class="eyebrow">${name}</span><span class="num sub">${b - a}</span></div>
        <div class="move-chips" style="margin-top:8px">${moves.slice(a, b).map((m, k) => `<button class="chip-m" data-i="${a + k}" title="Jump to this move">${m}</button>`).join('')}</div></div>`).join('');
      const chips = [...solList.querySelectorAll('.chip-m')];
      let at = 0;
      function sync(i) {
        at = i;
        chips.forEach((ch, k) => { ch.classList.toggle('played', k < i); ch.classList.toggle('cur', k === i); });
        $('#stepLbl', root).textContent = `${i} / ${total}`;
        $('#progBar', root).style.width = total ? `${(i / total) * 100}%` : '0%';
        // A button that cannot do anything says so, rather than swallowing the press.
        $('#prevBtn', root).disabled = i === 0;
        $('#repeatBtn', root).disabled = i === 0;
        $('#nextBtn', root).disabled = i >= total;
        $('#playBtn', root).disabled = i >= total;
        // The only thing left to say over the cube: it is done. A move label repeated what the
        // highlighted chip and the animation were both already showing.
        $('#doneMark', root).hidden = i < total;
      }
      cube.addEventListener('cubus-step', (e) => sync(e.detail.index));

      let playing = false;
      const setPlaying = (on) => {
        playing = on;
        $('#playBtn', root).innerHTML = icon(on ? 'pause' : 'play', 18);
        if (on) cube.play(); else cube.pause();
      };
      $('#playBtn', root).onclick = () => setPlaying(!playing);
      $('#nextBtn', root).onclick = () => { setPlaying(false); cube.step(); };
      // Back and repeat are both animated, at the one walking speed, and differ only in where they
      // leave you. Back undoes the last move and stops there. Repeat answers "show me that again":
      // it undoes the move and then makes it again, so you end up where you started having watched
      // it twice. Neither jumps: a cut to a new state teaches nothing about the turn that got there.
      // The renderer's queue is FIFO and pulls the next move only when the current one finishes,
      // so pushing both halves of a repeat here plays them in order.
      $('#prevBtn', root).onclick = () => { setPlaying(false); cube.stepBack(); };
      // A move in the list is a place in the solution, so clicking one goes there. seek() is instant
      // on purpose: jumping twelve moves is not something to sit through, which is exactly the case
      // step()/stepBack() do not cover. The clicked move becomes the CURRENT one — the one you are
      // about to make — rather than the one just made, so the highlight lands where you clicked.
      solList.onclick = (ev) => {
        const chip = ev.target.closest('.chip-m');
        if (!chip) return;
        setPlaying(false);
        cube.seek(Number(chip.dataset.i));
      };
      $('#repeatBtn', root).onclick = () => {
        // Not merely belt-and-braces with the disabled attribute: stepBack() self-guards at step 0
        // but step() does not, so without this a repeat at the start would go FORWARD one move.
        if (at === 0) return;
        setPlaying(false);
        cube.stepBack();
        cube.step();
      };

      // One pacing control, and only when there is a cube to pace against. With nothing connected
      // there is no choice to offer: walking the moves by hand is the only behaviour there is, so a
      // button naming it would be a switch with one position. Connected, following is what you want
      // by default, so the control is a single toggle that starts on.
      const followBtn = root.querySelector('[data-mode="cube"]');
      let mode = 'slow';
      if (followBtn) {
        // Following compares the real cube against the state each move produces, so it needs one
        // state per step. It says no rather than pretending when the solve did not supply them.
        if (steps.length === total + 1) mode = 'cube';
        else {
          followBtn.disabled = true;
          followBtn.classList.remove('on');
          followBtn.title = 'Needs a solve worked out on this screen';
        }
        followBtn.onclick = () => {
          if (followBtn.disabled) return;
          mode = mode === 'cube' ? 'slow' : 'cube';
          followBtn.classList.toggle('on', mode === 'cube');
          if (mode === 'cube') setPlaying(false);
        };
      }

      // ---- Follow cube -------------------------------------------------------------------
      //
      // Where the PHYSICAL cube is, in solution indices. Deliberately not `at`: `at` is where the
      // ANIMATION has got to, and it only advances when a turn finishes drawing (1.9s at Normal,
      // 3.8s at Slow). Driving the match off `at` meant a second real turn inside that window
      // compared against the wrong index and was dropped — and once the cube was two moves ahead,
      // the state it was waiting for had already gone past, so nothing could ever match again.
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
        // Following is about the guide's POSITION; the drawing is a follower of it. If the renderer
        // never upgraded — a vendored bundle that failed to load, which this repo has shipped more
        // than once — the cube should still track your turns rather than throwing on every one.
        if (typeof cube.step !== 'function' || typeof cube.seek !== 'function') return;
        if (idx === at) return;
        if (idx > at && idx - at <= 2) { for (let i = at; i < idx; i++) cube.step(); }
        else cube.seek(idx); // a jump: animating a dozen moves to catch up helps nobody
      };

      liveMove = (m) => {
        if (mode !== 'cube' || offTrack) return;
        if (m.notation === moves[cubePos]) {
          cubePos += 1;
          drawTo(cubePos);
          clearNote();
          return;
        }
        showNote(`That was ${m.notation} — the next move is ${moves[cubePos] ?? '—'}.`);
      };

      liveGap = (g) => {
        if (mode !== 'cube') return;
        // The cube numbers its moves, and the driver says so when the count skips. Silence here
        // would look exactly like a wrong turn; it is neither, and the snapshot will resync.
        showNote(`Missed ${g.missing} turn${g.missing === 1 ? '' : 's'} — checking the cube…`);
      };

      liveUpdate = (f) => {
        // The net is NOT repainted here. While a solution is being walked, that card shows the
        // state the solution was computed from — it says INITIAL STATE — and following live turns
        // would leave the label describing something the user is no longer looking at.
        //
        // Snapshots are the CORRECTION, not the signal. Searching all of `steps` rather than
        // testing only the next one is what lets a cube that ran ahead, or was turned back, rejoin
        // the guide instead of stalling forever.
        if (mode !== 'cube') return;
        const idx = steps.indexOf(f);
        if (idx < 0) {
          showNote('This cube is not on the plan any more.');
          return;
        }
        clearNote();
        if (idx !== cubePos) { cubePos = idx; drawTo(idx); }
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
      const renderLast = () => { const l = recentSolves().slice(0, 5); $('#lastFive', root).innerHTML = l.map((s) => `<div class="card" style="padding:9px 16px;text-align:center"><div class="num" style="font-size:var(--fs-title);font-weight:600">${s.time}</div><div class="eyebrow" style="letter-spacing:.04em">${s.tps ? s.tps + ' tps' : ''}</div></div>`).join(''); };
      const newScr = () => { if (!solverReady) { $('#scr', root).textContent = 'solver loading…'; return; } randomScramble(); $('#scr', root).textContent = currentScramble || '—'; };
      const toggle = () => {
        if (running) { running = false; cancelAnimationFrame(raf); const t = fmt(performance.now() - t0); clock.textContent = t; clock.style.color = 'var(--ink)'; $('#timerHint', root).textContent = 'Click or hold space to start'; pushSolve(t); renderLast(); }
        else { running = true; t0 = performance.now(); clock.style.color = 'var(--accent)'; $('#timerHint', root).textContent = 'Running — click or press space to stop'; tick(); }
      };
      clock.onclick = toggle; $('#newScr', root).onclick = newScr;
      // e.repeat: holding the key down fires keydown continuously, which start/stopped the clock
      // dozens of times a second and wrote a run of nonsense times into the solve history.
      const onKey = (e) => {
        if (e.repeat || e.code !== 'Space' || state.screen !== 'timer') return;
        e.preventDefault();
        toggle();
      };
      document.addEventListener('keydown', onKey);
      cleanup = () => { cancelAnimationFrame(raf); document.removeEventListener('keydown', onKey); };
      renderLast(); newScr();
    },
  };
};

SCREENS.settings = () => {
  const themes = ['auto', 'light', 'dark'], pals = ['muted', 'classic', 'colorsafe'];
  const toggles = [['inspection', 'WCA inspection', '15s hold before the timer starts'], ['autosolve', 'Auto-solve after scan', 'Jump straight to the guide']];
  return { html: `<div class="cols">
    <div class="col">
      <div class="card"><div class="eyebrow">APPEARANCE</div>
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0"><div><div style="font-weight:600">Theme</div><div class="sub" style="color:var(--ink-4)">Warm paper, light or dark</div></div>
          <div style="display:flex;gap:6px">${themes.map((t) => `<button class="pill ${settings.theme === t ? 'on' : ''}" data-theme="${t}">${t}</button>`).join('')}</div></div></div>
      ${(() => {
        const on = state.connected;
        // Step 3 is not decoration: anchorSolved() is what tells the cube which position counts as
        // solved. Naming it "Anchor solved state" and parking the button away from the step it
        // belongs to was the confusing part — the button now lives IN its own step.
        const steps = [
          ['Turn the cube', 'Any quarter turn wakes its radio'],
          ['Pair it', 'Moves and state then stream in live'],
          ['Solve it once', 'Teaches the cube which position counts as solved'],
        ];
        const done = (i) => on && (i < 2 || state.anchored);
        return `<div class="card"><div class="eyebrow">SMART CUBE</div>
        <div style="display:flex;align-items:center;gap:12px;padding:12px 0">
          <span class="ico" style="color:${on ? 'var(--ok)' : 'var(--ink-5)'}">${icon('bluetooth', 18)}</span>
          <div style="flex:1">
            <div style="font-weight:600">${on ? escHtml(state.cubeName) + ' · live' : 'No cube paired'}</div>
            <div class="sub" id="btNote" style="color:var(--ink-4)">${on ? 'Every turn streams into cubus.' : 'Optional — cubus solves from the camera alone. A cube adds move-by-move following.'}</div>
          </div>
        </div>
        ${on ? '' : `<div id="macRow" hidden style="display:flex;align-items:center;gap:12px;padding:12px 0;border-top:1px solid var(--line-faint)">
          <div style="flex:1"><div style="font-weight:600">Cube Bluetooth address</div>
            <div class="sub" style="color:var(--ink-4)">The cube encrypts everything with this as the key, and browsers on macOS will not reveal it. Copy it from the GAN app, under your cube's details.</div></div>
          <input class="field" id="macIn" placeholder="AB:CD:EF:12:34:56" style="width:180px;flex:none">
        </div>`}
        <div style="display:flex;gap:10px;align-items:center;padding:12px 0">
          <button class="btn ${on ? 'outline' : 'primary'} sm" id="pairBtn">${on ? 'Disconnect' : 'Pair a cube'}</button>
          <span class="sub" id="pairMsg" style="flex:1"></span>
        </div>
        ${steps.map(([t, sub], i) => `<div style="display:flex;gap:12px;align-items:center;padding:10px 0;border-top:1px solid var(--line-faint)">
          <div class="num" style="width:22px;height:22px;flex:none;border-radius:50%;border:1.5px solid ${done(i) ? 'var(--ok)' : 'var(--line)'};display:grid;place-items:center;font-size:var(--fs-meta);color:${done(i) ? 'var(--ok)' : 'var(--ink-5)'}">${done(i) ? '✓' : i + 1}</div>
          <div style="flex:1"><div style="font-weight:600">${t}</div><div class="sub" style="color:var(--ink-4)">${sub}</div></div>
          ${i === 2 && on ? `<button class="btn accent-outline sm" id="anchorBtn" style="flex:none">${state.anchored ? 'Re-mark' : 'Mark it solved'}</button>
          <button class="btn sm" id="anchorForceBtn" hidden style="flex:none;border:1px solid var(--warn);color:var(--warn)">It is solved — anchor anyway</button>` : ''}
        </div>`).join('')}
      </div>`; })()}
      <div class="card"><div class="eyebrow">TIMER & CAMERA</div>
        ${toggles.map(([k, t, s]) => `<div style="display:flex;align-items:center;gap:16px;padding:13px 0;border-bottom:1px solid var(--line-faint)">
          <div style="flex:1"><div style="font-weight:600">${t}</div><div class="sub" style="color:var(--ink-4)">${s}</div></div>
          <button class="toggle ${settings[k] ? 'on' : ''}" data-toggle="${k}"><i></i></button></div>`).join('')}</div>
    </div>
    <div class="aside">
      <div class="card"><div class="eyebrow">CUBE COLOURS</div>
        <div style="display:flex;gap:6px;margin-top:12px" id="palSwatch"></div>
        <div style="display:flex;gap:6px;margin-top:12px">${pals.map((p) => `<button class="pill ${settings.palette === p ? 'on' : ''}" data-pal="${p}" style="flex:1;justify-content:center">${p}</button>`).join('')}</div></div>
      ${advancedOpen ? `<div class="card"><div class="eyebrow">ADVANCED</div>
        <div class="sub" style="color:var(--ink-4);margin-top:6px;line-height:1.5">Sidebar entries. Hiding one only takes it out of the list — its address still works.</div>
        ${HIDEABLE.map(([id, lbl]) => `<div style="display:flex;align-items:center;gap:16px;padding:13px 0;border-bottom:1px solid var(--line-faint)">
          <div style="flex:1"><div style="font-weight:600">${lbl}</div><div class="sub" style="color:var(--ink-4)">${navHidden(id) ? 'Hidden from the sidebar' : 'Shown in the sidebar'}</div></div>
          <button class="toggle ${navHidden(id) ? '' : 'on'}" data-nav-toggle="${id}"><i></i></button></div>`).join('')}
        <div class="sub" style="color:var(--ink-5);margin-top:12px">⌃⌥⌘D hides this section again.</div></div>` : ''}
      <div class="card"><div class="eyebrow">ABOUT</div><div class="sub" style="color:var(--ink-3);margin-top:8px;line-height:1.55">cubus 0.4.2 · ${isTauri ? 'Tauri build' : 'Web'}<br>Solver and vision run locally. Nothing leaves the device.</div>
        <div class="link" style="margin-top:12px">cubus.im</div></div>
    </div></div>`,
    mount(root) {
      const swatch = () => { const p = NET_COLORS[settings.palette]; $('#palSwatch', root).innerHTML = ['U', 'D', 'R', 'L', 'F', 'B'].map((k) => `<div style="flex:1;height:34px;border-radius:4px;background:${p[k]}"></div>`).join(''); };
      swatch();
      for (const b of root.querySelectorAll('[data-theme]')) b.onclick = () => { settings.theme = b.dataset.theme; save('cubusSettings', settings); applyTheme(); renderScreen(); };
      for (const b of root.querySelectorAll('[data-pal]')) b.onclick = () => { settings.palette = b.dataset.pal; save('cubusSettings', settings); applyNetColors(); renderScreen(); };
      for (const b of root.querySelectorAll('[data-toggle]')) b.onclick = () => { const k = b.dataset.toggle; settings[k] = !settings[k]; save('cubusSettings', settings); b.classList.toggle('on', settings[k]); };
      // Smart-cube setup moved here from its own screen. The mock "nearby cubes" list and the
      // hardcoded battery/latency/firmware readout did not come with it: both were invented data
      // presented as live hardware telemetry, which an audit of this branch flagged.
      const mi = $('#macIn', root); if (mi) mi.value = connMac; // a property, never interpolated

      const say = (text, colour) => { const m = $('#pairMsg', root); if (m) { m.style.color = colour; m.textContent = text; } };
      const pairBtn = $('#pairBtn', root);

      // What CAN be detected, and what cannot.
      //
      // Nearby cubes: not in a browser. Web Bluetooth has no scan-without-permission by design —
      // discovery only happens inside the chooser the browser itself shows, behind a user gesture.
      // So there is no honest "1 cube found" line to draw here, and the old screen's list of
      // nearby cubes with signal strengths was invented data.
      //
      // Whether pairing is possible at all: yes. getAvailability() reports whether this machine
      // has a usable Bluetooth radio, which is the difference between "press Pair" and "pressing
      // Pair cannot work". Saying so up front beats a button that fails for unexplained reasons.
      //
      // The address field is asked for ONLY where it is genuinely needed. The native build learns
      // the address from the scan it already does; a browser cannot, so the user must supply it.
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
            if (ok === false && btNote) {
              btNote.textContent = 'No Bluetooth radio available on this machine — turn it on, then reload.';
              pairBtn.disabled = true;
            }
          }).catch(() => {}); // an engine without getAvailability tells us nothing; leave the button alone
        }
      }

      if (pairBtn) pairBtn.onclick = async () => {
        if (state.connected) { try { await transport?.disconnect(); } catch {} conn = null; transport = null; setConnected(false); return; }
        say(isTauri ? 'scanning…' : 'pick your cube in the browser prompt', 'var(--ink-4)');
        try { await doConnect($('#macIn', root)?.value); } catch (e) { say(String(e.message || e), 'var(--err)'); }
      };
      // anchorSolved() sends REQUEST_RESET only if the cube already reports solved — it throws
      // otherwise rather than adopting a scrambled position as the origin. The button is
      // deliberately not disabled when the cube is unsolved: the driver's refusal explains WHY,
      // which teaches the step. A dead button would not.
      const anchorBtn = $('#anchorBtn', root), forceBtn = $('#anchorForceBtn', root);
      // The precondition can dead-end an honest user, so the refusal has to offer a way through.
      //
      // A cube whose internal solved-reference has drifted reports an unsolved state WHILE SITTING
      // SOLVED on the desk, and REQUEST_RESET is the only thing that repairs it — so refusing
      // outright locks the repair away in the exact case it exists for. Nothing here can tell that
      // apart from a genuinely scrambled cube; the person holding it can. So the override is
      // offered, never taken automatically, and it says what it will do.
      const anchor = async (force) => {
        if (!conn) { say('not connected', 'var(--err)'); return; }
        anchorBtn.disabled = true; forceBtn.disabled = true;
        say(force ? 'anchoring anyway…' : 'anchoring…', 'var(--ink-4)');
        try {
          await conn.anchorSolved(force ? { force: true } : {});
          state.anchored = true;
          say('Anchored — the cube agrees it is solved.', 'var(--ok)');
          renderScreen();
        } catch (e) {
          state.anchored = false;
          const msg = String(e.message || e).split('\n')[0];
          if (!force && /refusing to anchor/i.test(msg)) {
            say('The cube reports it is not solved. If it IS solved in front of you, its own reference has drifted — anchoring will reset it to this position.', 'var(--warn)');
            forceBtn.hidden = false;
          } else {
            say(msg, 'var(--err)');
          }
        } finally { anchorBtn.disabled = false; forceBtn.disabled = false; }
      };
      if (anchorBtn) anchorBtn.onclick = () => { forceBtn.hidden = true; void anchor(false); };
      if (forceBtn) forceBtn.onclick = () => { void anchor(true); };

      for (const b of root.querySelectorAll('[data-nav-toggle]')) b.onclick = () => {
        const id = b.dataset.navToggle;
        settings.navHidden = navHidden(id) ? settings.navHidden.filter((x) => x !== id) : [...settings.navHidden, id];
        save('cubusSettings', settings);
        renderNav();
        // Hiding the screen you are standing on would leave the sidebar with nothing marked
        // active. You are on Settings when you press this, so that only bites via a deep link.
        if (navHidden(state.screen)) { go('home'); return; }
        renderScreen(); // repaints this card's own labels, so it cannot describe the old state
      };
    },
  };
};

// Data-driven screens (design layout with representative data; interactions where cheap).
// Stats — the session dashboard. This absorbed the old Home screen when Home became the cube:
// the headline numbers, the recent-solve list and the week chart were never a landing page, they
// were this screen's content sitting one nav entry too far to the left.
//
// The one thing not carried over is the "Scan a scrambled cube" call to action. It was a front-door
// affordance, and a stats page is not a front door — Restore has its own nav entry.
SCREENS.stats = () => {
  const solves = recentSolves();
  const stages = [['Cross', '2.41', '18%', '1.88', 'var(--ok)'], ['F2L', '9.86', '46%', '8.12', 'var(--accent)'], ['OLL', '4.02', '19%', '3.11', 'var(--warn)'], ['PLL', '3.60', '17%', '2.74', 'var(--err)']];
  const rows = solves.slice(0, 8).map((so) => `<div class="row" style="grid-template-columns:34px 1fr 70px 74px;gap:12px">
      <div class="num" style="color:var(--ink-5)">${so.n}</div>
      <div class="num" style="color:var(--ink-3);overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${escHtml(so.scramble)}</div>
      <div class="sub" style="color:var(--ink-4);font-size:var(--fs-body-s)">${so.tps ? escHtml(so.tps) + ' tps' : ''}</div>
      <div class="num" style="font-size:var(--fs-title-s);font-weight:600;text-align:right">${escHtml(so.time)}</div></div>`).join('');
  return { html: `<div class="cols">
    <div class="col">
      <div class="grid3">
        <div class="card stat"><div class="eyebrow">SINGLE BEST</div><div class="v">14.82</div><div class="d" style="color:var(--ok)">−1.3s this week</div></div>
        <div class="card stat"><div class="eyebrow">AO5</div><div class="v">21.44</div><div class="d">37 solves today</div></div>
        <div class="card stat"><div class="eyebrow">ALG MASTERY</div><div class="v">42<span style="font-size:var(--fs-title);color:var(--ink-5)">/78</span></div><div class="d">OLL + PLL</div></div>
      </div>
      <div class="card"><div class="eyebrow">SESSION · ${solves.length} SOLVES</div>
        <div style="display:flex;align-items:flex-end;gap:4px;height:130px;margin-top:16px">${[72, 64, 80, 58, 66, 52, 74, 49, 61, 45, 70, 55, 42, 58, 50, 64, 44, 52, 38, 47].map((h, i) => `<div style="flex:1;background:${i % 5 === 4 ? 'var(--accent)' : 'var(--ink-6)'};height:${h}%;border-radius:2px 2px 0 0"></div>`).join('')}</div></div>
      <div class="card tight" style="flex:1;min-height:0;display:flex;flex-direction:column">
        <div class="card-h"><b>Recent solves</b><span class="num sub">${solves.length}</span></div>
        <div class="list" style="overflow-y:auto">${rows}</div></div>
    </div>
    <div class="aside" style="overflow-y:auto">
      <div class="card tight" style="flex:none"><div class="card-h"><b>By stage</b><span class="num sub">avg</span></div>
        ${stages.map(([stage, avg, pct, best, color]) => `<div class="row" style="grid-template-columns:1fr auto"><div><div style="font-weight:600">${stage}</div><div class="bar" style="max-width:150px;margin-top:6px"><i style="width:${pct};background:${color}"></i></div></div><div style="text-align:right"><div class="num" style="font-size:var(--fs-title-s);font-weight:600">${avg}</div><div class="sub" style="color:var(--ink-4)">best ${best}</div></div></div>`).join('')}</div>
      <div class="card"><div class="eyebrow">PERSONAL BESTS</div>${[['single', '14.82'], ['ao5', '19.44'], ['ao12', '21.10'], ['ao100', '23.68']].map(([k, v]) => `<div class="row" style="grid-template-columns:1fr auto;border-color:var(--line-faint)"><div style="color:var(--ink-3)">${k}</div><div class="num" style="font-size:var(--fs-title);font-weight:600">${v}</div></div>`).join('')}</div>
      <div class="card"><div class="eyebrow">PICK UP WHERE YOU LEFT OFF</div>
        <div class="num" style="font-size:var(--fs-title);font-weight:600;margin-top:8px">OLL — dot cases</div>
        <div class="sub" style="color:var(--ink-4);margin-top:2px">3 of 12 drilled</div>
        <div class="bar" style="margin-top:12px"><i style="width:25%"></i></div>
        <button class="btn accent-outline block" data-go="drill" style="margin-top:14px">Resume drill</button></div>
      <div class="card"><div class="eyebrow">WEEK</div>
        <div style="display:flex;align-items:flex-end;gap:8px;height:110px;margin-top:14px">
        ${[['M', 54], ['T', 72], ['W', 40], ['T', 86], ['F', 63], ['S', 96], ['S', 48]].map(([d, h], i) => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;height:100%;justify-content:flex-end">
          <div style="width:100%;border-radius:3px 3px 0 0;height:${h}%;background:${i === 5 ? 'var(--accent)' : 'var(--ink-6)'}"></div>
          <div style="font-size:var(--fs-meta);color:var(--ink-5)">${d}</div></div>`).join('')}</div>
        <div class="sub" style="color:var(--ink-4);margin-top:14px">Average dropped 2.6s since Monday. Cross is now your fastest stage.</div></div>
      <div class="card dark"><div class="eyebrow" style="color:var(--on-ink-dim)">WHERE THE TIME GOES</div><div style="margin-top:8px;line-height:1.5;color:var(--on-ink-2)">F2L takes 46% of your average. Two slot cases account for most of it.</div><button class="btn block" data-go="trainer" style="border:1px solid var(--invert-fg);color:var(--invert-fg);margin-top:14px">Open trainer</button></div>
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
    <div class="aside"><div class="card dark"><div class="eyebrow" style="color:var(--on-ink-dim)">UP NEXT</div><div class="num" style="font-size:var(--fs-title);font-weight:600;margin-top:8px">Keyhole F2L</div><div style="color:var(--on-ink-2);margin-top:6px;line-height:1.5">A bridge between the beginner method and full F2L. 6 minutes, then a 10-case drill.</div><button class="btn block" data-go="drill" style="border:1px solid var(--invert-fg);color:var(--invert-fg);margin-top:14px">Start lesson</button></div>
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
  $('#nav').innerHTML = items.map(([id, lbl, meta, ic]) => `<button class="nav-item ${state.screen === id ? 'active' : ''}" data-nav="${id}"><span class="ico">${icon(ic)}</span><span class="lbl">${lbl}</span><span class="meta">${meta}</span></button>`).join('');
  for (const b of $('#nav').querySelectorAll('[data-nav]')) b.onclick = () => go(b.dataset.nav);
}
function renderScreen() {
  if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
  liveUpdate = null; liveMove = null; liveGap = null;
  setTitle(TITLES[state.screen] ?? 'Cubus');
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
const ALIAS = { guide: 'home', playback: 'home', viewer: 'home', pair: 'settings' };
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
/** Test seam for the cube stream. In production the driver is the only caller of these three
 * (see doConnect); following cannot otherwise be exercised without a physical GAN cube in the
 * room, which is precisely why its worst bug survived so long. Same shape as cubusGo above. */
window.cubusFeed = {
  move: (m) => liveMove?.(m),
  facelets: (f) => onFacelets(f),
  gap: (g) => liveGap?.(g),
};

async function boot() {
  const platform = detectPlatform();
  document.documentElement.dataset.host = isTauri ? 'tauri' : 'web';
  document.documentElement.dataset.platform = platform;
  buildChrome(platform);
  installAdvancedShortcut();
  // Resolve the deep link before the first paint, and canonicalise the URL so a bogus hash does
  // not sit in the address bar contradicting the screen on show.
  applyTheme(); applyNetColors(); resolveAlias(); router.normalize(); applyRoute();
  // Load the solver in the background so Random / Solve / Timer are ready. 'scan' is deliberately
  // NOT in that list: nothing on it depends on the solver, and re-rendering it would tear down a
  // camera that just opened and open a second one.
  if (await loadSolver()) { setFacelets(state.cube.facelets); if (['home', 'viewer', 'timer'].includes(state.screen)) renderScreen(); }
}
boot();
