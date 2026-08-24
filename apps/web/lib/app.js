// Cubus app controller. Renders the designed multi-screen shell and wires it to the real
// engine: cubejs (independent oracle + random + validity), cubing.js (min2phase solve), the
// gan-driver transport seam (Web Bluetooth / Tauri native BLE), and the YOLO camera scanner.
// The 3D cube is <cubus-cube> (Renderer B) — it draws only; state and solving stay here.

import { makeTauriTransport, makeWebBluetoothTransport } from './cube-transport.js';
import { makeRouter } from './router.js';

const $ = (sel, root = document) => root.querySelector(sel);
const SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
const PALETTE_ATTR = { muted: 'muted', classic: 'classic', colorsafe: 'colorsafe' };
const load = (k, fb) => { try { return { ...fb, ...JSON.parse(localStorage.getItem(k) || '{}') }; } catch { return { ...fb }; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

// ---- inline icons (lucide paths; offline, no CDN) --------------------------------------------
const P = {
  house: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  'scan-line': '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>',
  route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
  film: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 12h18M3 7.5h4M3 16.5h4M17 7.5h4M17 16.5h4"/>',
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
  'rotate-cw': '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  sliders: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>',
  dice: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.2"/><circle cx="16" cy="16" r="1.2"/><circle cx="8" cy="16" r="1.2"/><circle cx="16" cy="8" r="1.2"/><circle cx="12" cy="12" r="1.2"/>',
  'panel-left': '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  minus: '<path d="M5 12h14"/>',
  square: '<rect x="5" y="5" width="14" height="14" rx="1"/>',
  webcam: '<circle cx="12" cy="10" r="8"/><circle class="lens" cx="12" cy="10" r="3"/><path d="M7 22h10"/><path d="M12 22v-4"/>',
};
const icon = (name, size = 16) => `<svg class="ic" viewBox="0 0 24 24" style="width:${size}px;height:${size}px">${P[name] || '<circle cx="12" cy="12" r="2"/>'}</svg>`;

// ---- navigation model ------------------------------------------------------------------------
const NAV = [
  ['SOLVE', [['home', 'Home', '', 'house'], ['scan', 'Camera scan', '', 'scan-line'], ['guide', 'Solve guide', '', 'route'], ['playback', 'Playback', '', 'film']]],
  ['PRACTICE', [['timer', 'Timer', '', 'timer'], ['stats', 'Session stats', '', 'chart'], ['trainer', 'Alg trainer', '78', 'cap'], ['drill', 'Drill', '12', 'repeat']]],
  ['CUBE', [['viewer', '3D viewer', '', 'box'], ['pair', 'Smart cube', '', 'bluetooth']]],
  ['LEARN', [['lessons', 'Lessons', '9', 'book'], ['settings', 'Settings', '', 'settings']]],
];
const TITLES = {
  home: ['Welcome back', 'Scan a cube to solve it, or open the timer'],
  scan: ['Camera scan', 'Six faces, any order. Held flat and centred, each is captured automatically.'],
  guide: ['Solve guide', 'Step by step — follow each move on your cube'],
  playback: ['Solution playback', 'Scrub the full solution, chunked by CFOP stage'],
  timer: ['Timer', 'Click or press space to start · WCA inspection'],
  stats: ['Session stats', 'Your recent solves at a glance'],
  trainer: ['Algorithm trainer', 'OLL + PLL · spaced repetition on recall'],
  drill: ['Drill', 'Rate each rep to schedule the next'],
  viewer: ['Cube state', 'Read, orbit, and export the current state'],
  pair: ['Smart cube', 'Bluetooth LE — optional; everything works without it'],
  lessons: ['Lessons', 'Beginner layer method through full CFOP'],
  settings: ['Settings', 'Appearance, cube colours, and timer'],
};

// ---- app state -------------------------------------------------------------------------------
const settings = load('cubusSettings', { theme: 'auto', palette: 'muted', inspection: true, autosolve: false, cameraId: '' });
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

async function loadSolver() {
  if (solverReady) return true;
  try {
    Cube = (await import('../vendor/cubejs.js')).default;
    Cube.initSolver();
    solverReady = true;
    return true;
  } catch { return false; }
}

// Given a scanned/known facelet state, derive the setup alg (solved -> scrambled, for the 3D
// animation) and whether it needs solving. cubejs is the oracle here.
function setFacelets(f) {
  const c = state.cube;
  c.facelets = f; c.solution = ''; c.moves = []; c.stepFacelets = [];
  if (!solverReady) { c.setupAlg = ''; c.solvable = f !== SOLVED; return; }
  try {
    const sol = Cube.fromString(f).solve();
    const moves = sol.trim() ? sol.trim().split(/\s+/) : [];
    c.setupAlg = moves.slice().reverse().map(invMove).join(' ');
    c.solvable = moves.length > 0;
  } catch { c.setupAlg = ''; c.solvable = false; }
}

// Compute the animated solution with cubing.js (min2phase) and cross-check it against cubejs.
async function solve() {
  const c = state.cube;
  // If a state arrived before the solver was ready, its setup alg is stale — recompute now.
  if (solverReady && c.facelets !== SOLVED && !c.setupAlg) setFacelets(c.facelets);
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
  try { verified = Cube.fromString(c.facelets).move(solution).isSolved(); } catch {}
  if (verified === false) throw new Error('solver cross-check failed — re-scan');
  // Per-step facelets so the 2D net + move list can co-move with the 3D animation.
  const sf = [];
  try { const b = Cube.fromString(c.facelets); sf.push(b.asString()); for (const m of moves) { b.move(m); sf.push(b.asString()); } } catch {}
  c.solution = solution; c.moves = moves; c.stepFacelets = sf;
  return solution;
}

const STAGES = [['CROSS', 0, 0], ['F2L', 0, 0], ['OLL', 0, 0], ['PLL', 0, 0]];
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
  if (animate && c.solvable) { el.setAttribute('scramble', c.setupAlg); el.setAttribute('alg', c.solution || ''); }
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
  const box = $('#cubeStatus');
  box.classList.toggle('on', on);
  $('#cubeStatusLabel').textContent = on ? `${name || 'Smart cube'} connected` : 'No smart cube';
  $('#cubeStatusSub').textContent = on ? (battery ? `${battery} battery` : 'live') : 'Camera works on its own';
  if (state.screen === 'pair') renderScreen();
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
function onFacelets(f) { if (!f || f === state.cube.facelets) return; setFacelets(f); if (state.screen === 'viewer' || state.screen === 'home') renderScreen(); }

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
let cleanup = null;

SCREENS.home = () => {
  const solves = recentSolves();
  const rows = solves.slice(0, 6).map((s) => `<div class="row" style="grid-template-columns:34px 1fr 70px 74px;gap:12px">
      <div class="num" style="color:var(--ink-5)">${s.n}</div>
      <div class="num" style="color:var(--ink-3);overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${s.scramble}</div>
      <div class="sub" style="color:var(--ink-4);font-size:var(--fs-body-s)">${s.tps ? s.tps + ' tps' : ''}</div>
      <div class="num" style="font-size:var(--fs-title-s);font-weight:600;text-align:right">${s.time}</div></div>`).join('');
  return { html: `<div class="cols">
    <div class="col">
      <div class="grid3">
        <div class="card stat"><div class="eyebrow">SINGLE BEST</div><div class="v">14.82</div><div class="d" style="color:var(--ok)">−1.3s this week</div></div>
        <div class="card stat"><div class="eyebrow">AO5</div><div class="v">21.44</div><div class="d">37 solves today</div></div>
        <div class="card stat"><div class="eyebrow">ALG MASTERY</div><div class="v">42<span style="font-size:var(--fs-title);color:var(--ink-5)">/78</span></div><div class="d">OLL + PLL</div></div>
      </div>
      <button class="card dark" id="scanCta" style="display:flex;align-items:center;justify-content:space-between;text-align:left;gap:16px;cursor:pointer">
        <div><div class="num" style="font-size:var(--fs-title-l);font-weight:600">Scan a scrambled cube</div>
        <div class="sub" style="color:var(--on-ink-dim);margin-top:4px">Point the camera at the cube. Six faces, about eight seconds.</div></div>
        <span class="btn" style="border:1px solid var(--invert-fg);color:var(--invert-fg)">Open camera</span>
      </button>
      <div class="card tight" style="flex:1;min-height:0;display:flex;flex-direction:column">
        <div class="card-h"><b>Recent solves</b><button class="link" data-go="stats">Session stats</button></div>
        <div class="list">${rows}</div>
      </div>
    </div>
    <div class="aside">
      <div class="card"><div class="eyebrow">PICK UP WHERE YOU LEFT OFF</div>
        <div class="num" style="font-size:var(--fs-title);font-weight:600;margin-top:8px">OLL — dot cases</div>
        <div class="sub" style="color:var(--ink-4);margin-top:2px">3 of 12 drilled</div>
        <div class="bar" style="margin-top:12px"><i style="width:25%"></i></div>
        <button class="btn accent-outline block" data-go="drill" style="margin-top:14px">Resume drill</button></div>
      <div class="card" style="flex:1;min-height:0"><div class="eyebrow">WEEK</div>
        <div style="display:flex;align-items:flex-end;gap:8px;height:110px;margin-top:14px">
        ${[['M', 54], ['T', 72], ['W', 40], ['T', 86], ['F', 63], ['S', 96], ['S', 48]].map(([d, h], i) => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;height:100%;justify-content:flex-end">
          <div style="width:100%;border-radius:3px 3px 0 0;height:${h}%;background:${i === 5 ? 'var(--accent)' : 'var(--ink-6)'}"></div>
          <div style="font-size:var(--fs-meta);color:var(--ink-5)">${d}</div></div>`).join('')}</div>
        <div class="sub" style="color:var(--ink-4);margin-top:14px">Average dropped 2.6s since Monday. Cross is now your fastest stage.</div></div>
    </div></div>`,
    mount(root) { $('#scanCta', root).onclick = () => go('scan'); },
  };
};

// Camera scan. The camera opens the moment this screen mounts — <ai-scan-panel headless autostart>
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
  const cell = (bg) => `<i style="background:${bg}"></i>`;
  // A pending tile is nine dim wells with the face's own colour in the centre, so the board reads
  // "the yellow side is still missing" without a legend.
  const pending = (f) => Array.from({ length: 9 }, (_, i) => cell(i === 4 ? pal[f] : 'var(--facelet-off)')).join('');
  const blank = Array.from({ length: 9 }, () => cell('var(--facelet-off)')).join('');
  // border-color takes top/right/bottom/left in that order — the same order FACE_EDGES names.
  const e = (f) => FACE_EDGES[f];
  const edgeColors = (f) => `${pal[e(f).top]} ${pal[e(f).right]} ${pal[e(f).bottom]} ${pal[e(f).left]}`;
  // The panel is registered by a module script; if that has not landed yet the element is still
  // inert, so say so rather than claiming a camera is opening.
  const registered = Boolean(customElements.get('ai-scan-panel'));
  return {
    html: `<div class="cols">
    <div class="col">
      <div class="card scanboard">
        <ai-scan-panel headless autostart></ai-scan-panel>
        <div class="scan-live" id="scanLive">${blank}</div>
        <div>
          <div class="scan-msg" id="scanMsg">${registered ? 'Opening the camera…' : 'Loading the scanner…'}</div>
          <div class="scan-count" id="scanCount">0 / ${NET_FACES.length} sides</div>
        </div>
        <div class="bar" style="width:220px"><i id="scanBar" style="width:0%"></i></div>
        <div class="scan-faces">${NET_FACES.map((f) => `<div class="scan-face" data-face="${f}">
          <div class="tile" style="border-color:${edgeColors(f)}">${pending(f)}</div><div class="lbl">${SCAN_FACE_NAME[f]}</div></div>`).join('')}</div>
        <div class="scan-cam">
          <label class="select"><select id="scanCam"></select></label>
          <button id="scanCamBtn" title="Camera">${icon('webcam', 20)}</button>
        </div>
      </div>
    </div>
    <div class="aside">
      <div class="card"><div class="eyebrow">DETECTED STATE</div>
        <div class="cube-slot" id="scanCube" style="height:230px;margin-top:6px"></div>
        <div class="mono" id="scanState" style="margin-top:6px">${state.cube.facelets}</div></div>
      <div class="card"><b style="font-size:var(--fs-body-l)">How it works</b>
        <div class="sub" style="color:var(--ink-4);margin-top:4px">The camera opens with this screen and the YOLO scanner reads the stickers on device — no picture is kept, and none leaves it. Show the sides in any order; each is captured as soon as it holds still. Each tile is edged in the colours of its neighbours: hold a side that way up and the scan needs nothing more from you.</div></div>
      <button class="btn accent-outline block" data-go="guide">Solve this cube</button>
    </div></div>`,
    mount(root) {
      $('#scanCube', root).appendChild(newCube());
      const panel = $('ai-scan-panel', root);
      const live = $('#scanLive', root), msg = $('#scanMsg', root);
      const count = $('#scanCount', root), bar = $('#scanBar', root);
      const liveCells = [...live.querySelectorAll('i')];
      const tiles = [...root.querySelectorAll('.scan-face')];
      const paint = (cells, colors) => cells.forEach((c, i) => { c.style.background = classColor(colors[i]); });

      // Which camera. This machine class routinely has several — a built-in, a virtual camera, a
      // Continuity Camera (an iPhone) — and with no video preview the user cannot tell which one
      // answered. The pin is an ATTRIBUTE, not a property: mount() runs before the element's
      // deferred autostart, but a property set before the element upgrades would be clobbered by
      // its own class fields, whereas an attribute survives and start() re-reads it.
      const cam = $('#scanCam', root), camRow = $('.scan-cam', root), camBtn = $('#scanCamBtn', root);
      const pin = (id) => { if (id) panel.setAttribute('device-id', id); else panel.removeAttribute('device-id'); };
      pin(settings.cameraId);
      let camsKey = null;
      const fillCams = async () => {
        let list = [];
        try { list = (await panel.cameras?.()) ?? []; } catch { list = []; }
        const key = list.map((d) => d.deviceId).join('|');
        if (key === camsKey) return;
        camsKey = key;
        cam.textContent = '';
        // Device labels come from the OS — set as text, never interpolated into HTML.
        const add = (value, label) => { const o = document.createElement('option'); o.value = value; o.textContent = label; cam.appendChild(o); };
        add('', 'Default camera');
        for (const d of list) add(d.deviceId, d.label);
        cam.value = settings.cameraId || '';
        // Only offer the CHOICE when there is one — the webcam button itself always stays, since
        // it reports whether a camera is running and is the way back from a refusal. The exception
        // is a camera already pinned: the picker is the only way to un-pin it, so hiding it would
        // strand anyone whose chosen camera has since been unplugged.
        camRow.classList.toggle('pick', list.length >= 2 || Boolean(settings.cameraId));
      };
      void fillCams();
      // Cameras come and go — a webcam is plugged in, an iPhone wanders out of Continuity range.
      // Without this the row's visibility would only ever be re-evaluated when the ACTIVE camera
      // changed, so a second camera appearing would never offer the choice.
      const onDevices = () => { void fillCams(); };
      navigator.mediaDevices?.addEventListener?.('devicechange', onDevices);
      let shownDevice = null;
      cam.onchange = () => {
        settings.cameraId = cam.value; save('cubusSettings', settings);
        pin(cam.value);
        void panel.start?.();
      };
      // The webcam button replaces the two buttons that used to sit under the tiles: with the
      // camera dark it turns it on (the recovery path after a permission refusal), and with the
      // camera live it starts the scan over. Its lens fills and pulses while a camera is open, so
      // a screen that shows no picture still says plainly whether one is running.
      let camOn = false;
      camBtn.onclick = () => { if (camOn) panel.restart?.(); else void panel.start?.(); };

      panel.addEventListener('scan-progress', (e) => {
        const p = e.detail;
        msg.textContent = p.message;
        msg.className = 'scan-msg' + (p.phase === 'error' ? ' err' : p.phase === 'checking' || p.phase === 'done' ? ' ok' : '');
        // The live 3x3 is the viewfinder: it shows the side the scanner can see right now, and
        // goes dim when it cannot see one — the same information a video feed would carry, minus
        // everything else in the room.
        live.classList.toggle('reading', Boolean(p.live));
        if (p.live) paint(liveCells, p.live);
        else liveCells.forEach((c) => { c.style.background = 'var(--facelet-off)'; });
        for (const tile of tiles) {
          const f = tile.dataset.face;
          const got = p.captured.find((c) => c.face === f);
          const cells = [...tile.querySelectorAll('i')];
          tile.classList.toggle('done', Boolean(got));
          // A nearly-solved cube can read as several different cubes; the scanner then names one
          // side to show again, held a stated way up. Point at it — the sentence alone makes a
          // child hunt through six tiles for the colour it named.
          tile.classList.toggle('asked', p.confirm?.face === f);
          if (got) paint(cells, got.colors);
          else cells.forEach((c, i) => { c.style.background = i === 4 ? pal[f] : 'var(--facelet-off)'; });
        }
        // Names are only readable once permission is granted, so the list is worth refilling the
        // first time a camera actually answers — and the select then shows which one that was.
        // Keyed on the device, not on cam.value: a device that never appears in the list would
        // otherwise re-trigger this on every tick.
        camOn = Boolean(p.device);
        camRow.classList.toggle('on', camOn);
        camBtn.title = camOn ? `${p.device.label} — click to start the scan over` : 'Camera off — click to turn it on';
        if (p.device && p.device.deviceId !== shownDevice) {
          const id = p.device.deviceId;
          shownDevice = id;
          void fillCams().then(() => {
            // Only adopt it if the list actually offers it. Assigning an unknown value to a
            // <select> selects nothing and the control renders EMPTY — worse than saying
            // "Default camera", and it would hide which camera is live rather than reveal it.
            cam.value = [...cam.options].some((o) => o.value === id) ? id : '';
          });
        }
        count.textContent = `${p.captured.length} / ${NET_FACES.length} sides`;
        bar.style.width = `${(p.captured.length / NET_FACES.length) * 100}%`;
      });
      // A rejected scan restarts itself and explains why through scan-progress, so there is
      // nothing to do here; only a validated cube leaves this screen.
      panel.addEventListener('scan-complete', (e) => {
        onFacelets(e.detail.facelets);
        go(settings.autosolve ? 'guide' : 'viewer');
      });
      // Removing the element releases the camera through disconnectedCallback, but a live camera
      // is not something to leave to a lifecycle callback firing — stop it explicitly first.
      cleanup = () => {
        navigator.mediaDevices?.removeEventListener?.('devicechange', onDevices);
        panel.stop?.();
      };
    },
  };
};

SCREENS.viewer = () => {
  const v = load('cubeView', { hintElev: 4, camDist: 12, camLat: 35, camLon: 45, facScale: 0.9, tempo: 0.5, ghosts: false, back: 'none' });
  const sliders = [
    ['ghost distance', 'hintElev', 0, 8, 0.5, 'ghost-elevation'], ['camera', 'camDist', 6, 30, 1, 'camera-distance'],
    ['tilt', 'camLat', -90, 90, 5, 'camera-latitude'], ['rotate', 'camLon', -180, 180, 5, 'camera-longitude'],
    ['sticker', 'facScale', 0.3, 1, 0.05, 'facelet-scale'], ['speed', 'tempo', 0.25, 4, 0.25, 'tempo-scale'],
  ];
  return { html: `<div class="cols">
    <div class="col">
      <div class="card" style="flex:1;min-height:0;display:flex;flex-direction:column;align-items:center">
        <div class="cube-slot" id="viewCube" style="flex:1"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:8px">
          ${['Isometric', 'Front', 'Top', 'Exploded'].map((l) => `<button class="pill" data-preset="${l}">${l}</button>`).join('')}
          <button class="pill" id="ghostToggle">${v.ghosts ? 'Ghosts on' : 'Ghosts off'}</button>
        </div>
        <div class="sub" style="color:var(--ink-4);margin-top:8px">Drag to orbit · scroll to zoom</div>
      </div>
      <div class="card"><div class="eyebrow">VIEW</div>
        <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px 16px;margin-top:10px">
        ${sliders.map(([lbl, k, min, max, step, attr]) => `<label style="font-size:var(--fs-body-s);color:var(--ink-3);display:flex;flex-direction:column;gap:4px">${lbl}
          <input type="range" data-attr="${attr}" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${v[k]}"></label>`).join('')}
        </div>
      </div>
    </div>
    <div class="aside">
      <div class="card"><div class="eyebrow">UNFOLDED NET</div><div class="net" id="viewNet" style="margin-top:12px"></div></div>
      <div class="card"><div class="eyebrow">STATE (URFDLB)</div><div class="mono" id="viewState" style="margin-top:8px">${state.cube.facelets}</div>
        <div style="display:flex;gap:8px;margin-top:12px"><button class="btn outline sm" id="copyState" style="flex:1">Copy</button>
          <button class="btn primary sm" data-go="guide" style="flex:1">Solve</button>
          <button class="btn outline sm" id="randCube" title="Random cube">${icon('dice')}</button></div></div>
      <div class="card"><b style="font-size:var(--fs-body-l)">Validity</b><div class="sub" id="validity" style="color:var(--ok);margin-top:4px">${state.cube.solvable ? 'Solvable' : state.cube.facelets === SOLVED ? 'Solved ✓' : 'checking…'}</div></div>
    </div></div>`,
    mount(root) {
      const cube = newCube(); $('#viewCube', root).appendChild(cube);
      applyNetColors();
      const paintNet = buildNet($('#viewNet', root)); paintNet(state.cube.facelets);
      const applyGhost = () => cube.setAttribute('ghosts', v.ghosts ? 'floating' : 'none'); applyGhost();
      for (const inp of root.querySelectorAll('input[data-attr]')) {
        inp.oninput = () => { v[inp.dataset.k] = Number(inp.value); cube.setAttribute(inp.dataset.attr, inp.value); };
        inp.onchange = () => save('cubeView', v);
      }
      $('#ghostToggle', root).onclick = (e) => { v.ghosts = !v.ghosts; applyGhost(); e.target.textContent = v.ghosts ? 'Ghosts on' : 'Ghosts off'; save('cubeView', v); };
      const PRESETS = { Isometric: [35, 45], Front: [0, 0], Top: [80, 0], Exploded: [25, 30] };
      for (const b of root.querySelectorAll('[data-preset]')) b.onclick = () => { const [lat, lon] = PRESETS[b.dataset.preset]; cube.setAttribute('camera-latitude', lat); cube.setAttribute('camera-longitude', lon); };
      $('#copyState', root).onclick = () => { navigator.clipboard?.writeText(state.cube.facelets); };
      $('#randCube', root).onclick = () => { if (!solverReady) return; const f = randomScramble(); onFacelets(f); };
    },
  };
};

// Playback + Guide share the solve/animation engine.
function solveScreen({ guide }) {
  return {
    html: `<div class="cols">
      <div class="col">
        <div class="card" style="flex:1;min-height:0;display:flex;align-items:center;justify-content:center;position:relative">
          <div class="cube-slot" id="solveCube"></div>
          ${guide ? `<div style="position:absolute;left:0;right:0;bottom:0;padding:18px 20px;background:linear-gradient(transparent,rgba(16,14,11,.0))">
            <div class="eyebrow" id="stageLbl" style="color:var(--ink-4)">—</div>
            <div class="num" id="moveLbl" style="font-size:var(--fs-display-l);font-weight:600;line-height:1.05">—</div>
            <div class="sub" id="moveHint" style="color:var(--ink-4)"></div></div>` : ''}
        </div>
        <div class="card"><div style="display:flex;align-items:center;gap:16px">
          <button class="btn primary" id="playBtn" style="width:46px;height:46px;border-radius:50%;padding:0">${icon('play', 20)}</button>
          <div style="flex:1"><input type="range" id="scrub" min="0" max="1" value="0" style="width:100%">
            <div style="display:flex;justify-content:space-between" class="num sub"><span id="scrubLbl">move 0</span><span id="scrubStage"></span></div></div>
          <div style="display:flex;gap:8px">${['0.5', '1', '2'].map((s) => `<button class="btn ${s === '1' ? 'primary' : 'outline'} sm" data-speed="${s}">${s}×</button>`).join('')}</div>
        </div>
        ${guide ? '<div style="display:flex;gap:10px;margin-top:12px"><button class="btn outline" id="prevBtn">Back</button><button class="btn accent" id="nextBtn" style="flex:1">Next move</button></div>' : ''}
        </div>
      </div>
      <div class="aside">
        <div class="card tight" style="flex:1;min-height:0;display:flex;flex-direction:column">
          <div class="card-h"><b>Solution</b><span class="num sub" id="moveCount">—</span></div>
          <div class="list" id="solList" style="padding:6px 0"></div>
        </div>
      </div></div>`,
    async mount(root) {
      const cube = newCube({ animate: true }); $('#solveCube', root).appendChild(cube);
      const solList = $('#solList', root), scrub = $('#scrub', root);
      let paintNet = null; // guide/playback don't show the net; kept null
      const setStatus = (msg) => { $('#moveCount', root).textContent = msg; };
      setStatus('solving…');
      try {
        if (!solverReady) await loadSolver();
        await solve();
      } catch (e) { setStatus('solve failed'); return; }
      const c = state.cube; const moves = c.moves; const total = moves.length;
      cube.setAttribute('scramble', c.setupAlg); cube.removeAttribute('facelets'); cube.setAttribute('alg', c.solution);
      cube.setAttribute('tempo-scale', String(load('cubeView', { tempo: 0.5 }).tempo || 0.5));
      scrub.max = String(total); setStatus(total + ' moves');
      const stages = stageSplit(total);
      solList.innerHTML = stages.map(([name, a, b]) => `<div style="padding:10px 16px 14px">
        <div style="display:flex;justify-content:space-between"><span class="eyebrow">${name}</span><span class="num sub">${b - a}</span></div>
        <div class="move-chips" style="margin-top:8px">${moves.slice(a, b).map((m, k) => `<span class="chip-m" data-i="${a + k}">${m}</span>`).join('')}</div></div>`).join('');
      const chips = [...solList.querySelectorAll('.chip-m')];
      const stageOf = (i) => (stages.find(([, a, b]) => i >= a && i < b) || stages[stages.length - 1] || ['', 0, 0])[0];
      function sync(i) {
        chips.forEach((ch, k) => { ch.classList.toggle('played', k < i); ch.classList.toggle('cur', k === i); });
        $('#scrubLbl', root).textContent = 'move ' + i + ' / ' + total;
        $('#scrubStage', root).textContent = stageOf(Math.min(i, total - 1));
        scrub.value = String(i);
        if (guide) {
          const m = moves[Math.min(i, total - 1)] || '—';
          $('#moveLbl', root).textContent = i >= total ? 'Solved' : m;
          $('#stageLbl', root).textContent = i >= total ? 'DONE' : stageOf(i) + ' · MOVE ' + (i + 1) + ' OF ' + total;
          $('#moveHint', root).textContent = i >= total ? '' : 'Turn the ' + faceName(m) + ' face ' + (m.includes("'") ? 'counter-clockwise' : 'clockwise');
        }
      }
      cube.addEventListener('cubus-step', (e) => sync(e.detail.index));
      let playing = false;
      $('#playBtn', root).onclick = () => { playing = !playing; $('#playBtn', root).innerHTML = icon(playing ? 'pause' : 'play', 20); if (playing) cube.play(); else cube.pause(); };
      scrub.oninput = () => { cube.pause(); playing = false; $('#playBtn', root).innerHTML = icon('play', 20); cube.seek(Number(scrub.value)); };
      for (const b of root.querySelectorAll('[data-speed]')) b.onclick = () => { cube.setAttribute('tempo-scale', b.dataset.speed); for (const o of root.querySelectorAll('[data-speed]')) o.className = 'btn ' + (o === b ? 'primary' : 'outline') + ' sm'; };
      if (guide) { $('#nextBtn', root).onclick = () => cube.step(); $('#prevBtn', root).onclick = () => cube.seek(Math.max(0, cube._applied - 1)); }
      sync(0);
    },
  };
}
const faceName = (m) => ({ R: 'right', L: 'left', U: 'up', D: 'down', F: 'front', B: 'back' }[m[0]] || 'right');
SCREENS.playback = () => solveScreen({ guide: false });
SCREENS.guide = () => solveScreen({ guide: true });

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
      const onKey = (e) => { if (e.code === 'Space' && state.screen === 'timer') { e.preventDefault(); toggle(); } };
      document.addEventListener('keydown', onKey);
      cleanup = () => { cancelAnimationFrame(raf); document.removeEventListener('keydown', onKey); };
      renderLast(); newScr();
    },
  };
};

SCREENS.pair = () => {
  const on = state.connected;
  const devices = [['GAN 356 i3', 'GAN', on ? 'Connected · live' : 'Not paired', on], ['MoYu AI 2023', 'MOY', '−64 dBm', false], ['Giiker Super Cube', 'GII', '−81 dBm', false]];
  const steps = [['Turn the cube', 'Any quarter turn wakes the radio'], ['Select it above', 'Cubus matches by advertisement'], ['Connect', 'Streams moves + state live'], ['Solve once', 'Establishes the ground-truth state']];
  return { html: `<div class="cols">
    <div class="aside" style="flex:0 1 420px">
      <div class="card tight"><div class="card-h"><b>Nearby cubes</b><span class="link">${isTauri ? 'native BLE' : 'Web Bluetooth'}</span></div>
        ${devices.map(([name, abbr, meta, paired], i) => `<div class="row" style="grid-template-columns:34px 1fr auto;gap:14px;cursor:pointer" data-dev="${i}">
          <div class="avatar num" style="border-radius:8px;font-size:var(--fs-body-s)">${abbr}</div>
          <div><div style="font-weight:600">${name}</div><div class="sub" style="color:var(--ink-4);font-size:var(--fs-caption)">${meta}</div></div>
          <div style="font-weight:600;color:${paired ? 'var(--ok)' : 'var(--accent)'}">${paired ? 'Connected' : 'Pair'}</div></div>`).join('')}</div>
      <div class="card"><div class="eyebrow">SETUP</div>${steps.map(([t, s], i) => `<div style="display:flex;gap:12px;padding:11px 0;border-bottom:1px solid var(--line-faint)">
        <div class="num" style="width:22px;height:22px;flex:none;border-radius:50%;border:1.5px solid ${on && (i < 3 || state.anchored) ? 'var(--ok)' : 'var(--line)'};display:grid;place-items:center;font-size:var(--fs-meta)">${i + 1}</div>
        <div><div style="font-weight:600">${t}</div><div class="sub" style="color:var(--ink-4)">${s}</div></div></div>`).join('')}</div>
    </div>
    <div class="col"><div class="card" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px">
      <div class="cube-slot" id="pairCube" style="height:240px"></div>
      <div class="num" style="font-size:var(--fs-title);font-weight:600">${on ? state.cubeName + ' · live' : 'Nothing connected'}</div>
      <div class="sub" style="color:var(--ink-4);text-align:center;max-width:360px">${on ? 'Every turn streams into cubus. The 3D view follows the cube in your hands.' : 'Cubus solves from the camera alone. Pair a smart cube for move-level analysis and auto timing.'}</div>
      ${on ? `<div style="display:flex;gap:22px">${[['78%', 'battery'], ['18ms', 'latency'], ['1.2.7', 'firmware']].map(([v, l]) => `<div style="text-align:center"><div class="num" style="font-size:var(--fs-title-s);font-weight:600">${v}</div><div class="eyebrow" style="letter-spacing:.04em">${l}</div></div>`).join('')}</div>` : `<input class="field" id="macIn" placeholder="cube MAC (macOS)" style="width:220px;text-align:center">`}
      <div style="display:flex;gap:10px;align-items:center">
        <button class="btn ${on ? 'outline' : 'primary'}" id="pairBtn">${on ? 'Disconnect' : 'Pair selected cube'}</button>
        ${on ? '<button class="btn accent-outline" id="anchorBtn">Anchor solved state</button>' : ''}
      </div>
      <div class="sub" id="pairMsg" style="min-height:18px;text-align:center;max-width:360px"></div>
    </div></div></div>`,
    mount(root) {
      $('#pairCube', root).appendChild(newCube());
      const mi = $('#macIn', root); if (mi) mi.value = connMac; // set as a property, never interpolated into HTML
      const say = (text, colour) => { const m = $('#pairMsg', root); m.style.color = colour; m.textContent = text; };
      $('#pairBtn', root).onclick = async () => {
        if (state.connected) { try { await transport?.disconnect(); } catch {} conn = null; transport = null; setConnected(false); return; }
        say(isTauri ? 'scanning…' : 'pick your cube in the browser prompt', 'var(--ink-4)');
        try { await doConnect($('#macIn', root)?.value); } catch (e) { say(String(e.message || e), 'var(--err)'); }
      };
      // Step 4, "Solve once". anchorSolved() sends REQUEST_RESET only if the cube already
      // reports a solved state — it throws otherwise rather than adopting a scrambled
      // position as the origin, which would desync the driver from the cube for good.
      // The button is deliberately not disabled when the cube is unsolved: the driver's
      // refusal explains WHY, which teaches the step. A dead button would not.
      const anchorBtn = $('#anchorBtn', root);
      if (anchorBtn) anchorBtn.onclick = async () => {
        if (!conn) { say('not connected', 'var(--err)'); return; }
        anchorBtn.disabled = true; // one in flight at a time
        say('anchoring…', 'var(--ink-4)');
        try {
          await conn.anchorSolved();
          state.anchored = true;
          say('Anchored — the cube agrees it is solved.', 'var(--ok)');
          renderScreen(); // step 4 now shows complete
        } catch (e) {
          state.anchored = false;
          // The driver's message carries the offending facelet string after a newline;
          // show the human sentence here and leave the detail to the thrown error.
          say(String(e.message || e).split('\n')[0], 'var(--err)');
        } finally {
          anchorBtn.disabled = false;
        }
      };
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
      <div class="card"><div class="eyebrow">TIMER & CAMERA</div>
        ${toggles.map(([k, t, s]) => `<div style="display:flex;align-items:center;gap:16px;padding:13px 0;border-bottom:1px solid var(--line-faint)">
          <div style="flex:1"><div style="font-weight:600">${t}</div><div class="sub" style="color:var(--ink-4)">${s}</div></div>
          <button class="toggle ${settings[k] ? 'on' : ''}" data-toggle="${k}"><i></i></button></div>`).join('')}</div>
    </div>
    <div class="aside">
      <div class="card"><div class="eyebrow">CUBE COLOURS</div>
        <div style="display:flex;gap:6px;margin-top:12px" id="palSwatch"></div>
        <div style="display:flex;gap:6px;margin-top:12px">${pals.map((p) => `<button class="pill ${settings.palette === p ? 'on' : ''}" data-pal="${p}" style="flex:1;justify-content:center">${p}</button>`).join('')}</div></div>
      <div class="card"><div class="eyebrow">ABOUT</div><div class="sub" style="color:var(--ink-3);margin-top:8px;line-height:1.55">cubus 0.4.2 · ${isTauri ? 'Tauri build' : 'Web'}<br>Solver and vision run locally. Nothing leaves the device.</div>
        <div class="link" style="margin-top:12px">cubus.im</div></div>
    </div></div>`,
    mount(root) {
      const swatch = () => { const p = NET_COLORS[settings.palette]; $('#palSwatch', root).innerHTML = ['U', 'D', 'R', 'L', 'F', 'B'].map((k) => `<div style="flex:1;height:34px;border-radius:4px;background:${p[k]}"></div>`).join(''); };
      swatch();
      for (const b of root.querySelectorAll('[data-theme]')) b.onclick = () => { settings.theme = b.dataset.theme; save('cubusSettings', settings); applyTheme(); renderScreen(); };
      for (const b of root.querySelectorAll('[data-pal]')) b.onclick = () => { settings.palette = b.dataset.pal; save('cubusSettings', settings); applyNetColors(); renderScreen(); };
      for (const b of root.querySelectorAll('[data-toggle]')) b.onclick = () => { const k = b.dataset.toggle; settings[k] = !settings[k]; save('cubusSettings', settings); b.classList.toggle('on', settings[k]); };
    },
  };
};

// Data-driven screens (design layout with representative data; interactions where cheap).
SCREENS.stats = () => {
  const rows = [['Cross', '2.41', '18%', '1.88', 'var(--ok)'], ['F2L', '9.86', '46%', '8.12', 'var(--accent)'], ['OLL', '4.02', '19%', '3.11', 'var(--warn)'], ['PLL', '3.60', '17%', '2.74', 'var(--err)']];
  return { html: `<div class="cols"><div class="col">
    <div class="card"><div class="eyebrow">SESSION · ${recentSolves().length} SOLVES</div>
      <div style="display:flex;align-items:flex-end;gap:4px;height:150px;margin-top:16px">${[72, 64, 80, 58, 66, 52, 74, 49, 61, 45, 70, 55, 42, 58, 50, 64, 44, 52, 38, 47].map((h, i) => `<div style="flex:1;background:${i % 5 === 4 ? 'var(--accent)' : 'var(--ink-6)'};height:${h}%;border-radius:2px 2px 0 0"></div>`).join('')}</div></div>
    <div class="card tight" style="flex:1;min-height:0;overflow-y:auto">
      <div class="row eyebrow" style="grid-template-columns:1fr 1fr 1fr 1fr">${['STAGE', 'AVG', 'SHARE', 'BEST'].map((h) => `<div>${h}</div>`).join('')}</div>
      ${rows.map(([stage, avg, pct, best, color]) => `<div class="row" style="grid-template-columns:1fr 1fr 1fr 1fr"><div style="font-weight:600">${stage}</div><div class="num" style="font-size:var(--fs-title-s);font-weight:600">${avg}</div><div><div class="bar" style="max-width:130px"><i style="width:${pct};background:${color}"></i></div></div><div class="num" style="color:var(--ink-3)">${best}</div></div>`).join('')}</div>
    </div>
    <div class="aside">
      <div class="card"><div class="eyebrow">PERSONAL BESTS</div>${[['single', '14.82'], ['ao5', '19.44'], ['ao12', '21.10'], ['ao100', '23.68']].map(([k, v]) => `<div class="row" style="grid-template-columns:1fr auto;border-color:var(--line-faint)"><div style="color:var(--ink-3)">${k}</div><div class="num" style="font-size:var(--fs-title);font-weight:600">${v}</div></div>`).join('')}</div>
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
function renderNav() {
  $('#nav').innerHTML = NAV.map(([label, items]) => `<div class="nav-group"><div class="eyebrow">${label}</div>${items.map(([id, lbl, meta, ic]) => `<button class="nav-item ${state.screen === id ? 'active' : ''}" data-nav="${id}"><span class="ico">${icon(ic)}</span><span class="lbl">${lbl}</span><span class="meta">${meta}</span></button>`).join('')}</div>`).join('');
  for (const b of $('#nav').querySelectorAll('[data-nav]')) b.onclick = () => go(b.dataset.nav);
}
function renderScreen() {
  if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
  const [t, s] = TITLES[state.screen] || ['', '']; $('#title').textContent = t; $('#subtitle').textContent = s;
  const build = SCREENS[state.screen] || SCREENS.home;
  const spec = build();
  const stage = $('#stage'); stage.innerHTML = `<div class="screen active">${spec.html}</div>`;
  const root = stage.firstElementChild;
  for (const b of root.querySelectorAll('[data-go]')) b.onclick = () => go(b.dataset.go);
  try { spec.mount?.(root); } catch (e) { console.error('screen mount failed', e); }
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
function applyRoute() { state.screen = router.current(); renderNav(); renderScreen(); }
// A hash assignment only fires hashchange when the value actually differs, so navigating onto the
// screen already showing would do nothing. go() renders directly in that case, preserving the
// always-re-render behaviour the scan flow depends on (go('viewer') while on viewer).
function go(id) { if (!router.go(id)) applyRoute(); }
window.addEventListener('hashchange', applyRoute);
window.cubusGo = go;

async function boot() {
  const platform = detectPlatform();
  document.documentElement.dataset.host = isTauri ? 'tauri' : 'web';
  document.documentElement.dataset.platform = platform;
  buildChrome(platform);
  // Resolve the deep link before the first paint, and canonicalise the URL so a bogus hash does
  // not sit in the address bar contradicting the screen on show.
  applyTheme(); applyNetColors(); router.normalize(); applyRoute();
  // Load the solver in the background so Random / Solve / Timer are ready. 'scan' is deliberately
  // NOT in that list: nothing on it depends on the solver, and re-rendering it would tear down a
  // camera that just opened and open a second one.
  if (await loadSolver()) { setFacelets(state.cube.facelets); if (['home', 'viewer', 'timer'].includes(state.screen)) renderScreen(); }
}
boot();
