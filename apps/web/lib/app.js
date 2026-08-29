// Cubus app controller. Renders the designed multi-screen shell and wires it to the real
// engine: cubejs (independent oracle + facelet parsing + validity), the two-phase solver in a
// worker (solving, and the scrambles it inverts), and the YOLO camera scanner. The 3D cube is
// <cubus-cube> — it draws only; state and solving stay here.

import { summarize, times } from './solve-stats.js';
import { TIERS, describe, refine } from './solve-target.js';
import { createSolveClient, spawnSolveWorker } from './solve-client.js';
import { LOOSEST_BOUND } from './solver-engine.js';
import { randomCube } from './random-state.js';
import { fromCube } from './cube-pieces.js';
import { solveByMethod } from './method-solver.js';
import { makeRouter } from './router.js';
// The smart-cube strands, recovered from v0 (2026-08-27): the transport seam (Web Bluetooth in a
// browser, native BLE events under Tauri), one durable record per cube, and the trust model that
// keeps "connected" from standing in for "known".
import { makeTauriTransport, makeWebBluetoothTransport } from './cube-transport.js';
import { MAX_LABEL, cubeLabel, forgetCube, listCubes, normaliseMac, parseRegistry, rememberCube, rememberLast, renameCube } from './cube-registry.js';
import { applyOffset, deriveOffset, isIdentity } from './cube-trust.js';
// Reconnecting a known cube: the readings that choose the picture and the words on reconnect, and
// the two-adjacent-side camera check that supports the user's answer. Never the trust — only the
// user's answer grants that (dev-docs/smart-cube-ux-prd.md, "Reconnecting a known cube").
import { classifyReconnect, confirmCheck } from './cube-reconnect.js';
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
export const VERSION = '0.1.0';
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
  // The false return is checked by the callers that can say something useful; the warn is for
  // every caller that cannot — a preference that silently fails to stick looks exactly like a
  // preference that stuck until the next launch proves otherwise.
  try { localStorage.setItem(k, JSON.stringify(v)); return true; }
  catch (e) { console.warn(`could not persist ${k}`, e); return false; }
};

// ---- inline icons (lucide paths; offline, no CDN) --------------------------------------------
const P = {
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
const settings = load('cubusSettings', { theme: 'auto', palette: 'muted', autosolve: false, cameraId: '', navHidden: null, navDefaults: 0, devRandCube: false, language: '', dragRotate: false, solveTier: 'twenty', teachLevel: 'off' });
// The inspection flag is gone (it toggled a label, never a behaviour); drop the stored leftover
// rather than letting save() keep rewriting a field nothing reads — the advancedOpen precedent.
delete settings.inspection;

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
 * invented data is worse than no screen. Alg trainer, Drill and Lessons are the same class:
 * representative screens with placeholder content. The default tab row is the beginner's path;
 * everything else is one chord away. In CODE, not only in a stored preference: the hidden set
 * was once a preference alone, and one wiped localStorage brought five placeholder screens back
 * into the toolbar. Version 2 hides the three once for anyone who already ran the app. */
const DEFAULT_HIDDEN = ['timer', 'stats', 'trainer', 'drill', 'lessons'];
const NAV_DEFAULTS_VERSION = 2;

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
    facelets: SOLVED, setupAlg: '', solution: '', moves: [], solvable: false, stepFacelets: [], solveResult: null,
    methodSteps: null, moveStep: null,
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
    // What derived it — 'scan' (a camera repair) or 'confirmed' (the reconnect answer) — so the
    // visible correction names its real basis. "A camera scan put this cube back in step" over
    // an offset the user's Yes derived is a wrong provenance claim wearing a right-looking one.
    offsetFrom: '',
  },
  /** The connected cube's TRUE arrangement — its last report with any correction applied. Kept
   *  apart from `cube.facelets`, which is whatever the app is currently about. */
  live: null,
  /** The same report, uncorrected. Only a repair may use this: an offset derived against
   *  corrected truth is the identity, which discards the correction that made it look right. */
  reported: null,
  /** The open reconnect question, or null. A cube that was paired before has reconnected, a
   *  remembered arrangement exists, and the app cannot know whether the cube was turned while
   *  nobody counted — so the reading chose a PICTURE (`candidate`) and words, and the user has
   *  not yet answered "Is this your cube right now?". While this is open the candidate is FROZEN
   *  (live reports do not repaint the subject — a picture that changes while it is being
   *  confirmed is not a picture anyone can confirm), trust stays down, and the walk stays up.
   *  `raw` is the cube's report at classification — the Yes derives the working offset from
   *  (candidate, raw), the same derivation a camera repair makes, and the offset is constant
   *  under any turns made while the question was open. `seenAt` is the memory's timestamp, for
   *  "as we last saw it, Tuesday 21:40". */
  reconnect: null,
};

/** The rungs of the explaining solver, and how the Settings row reads. */
const TEACH_LEVELS = ['off', 'beginner', 'intermediate'];
const TEACH_LABEL = { off: 'off', beginner: 'beginner', intermediate: 'F2L' };
const TEACH_BLURB = {
  off: 'The shortest solution the target allows, with no explanation',
  beginner: 'Every piece placed on its own, and a reason for each step',
  intermediate: 'The cross planned as one, and each corner paired with its edge',
};

/**
 * A step's reason, in words.
 *
 * The solver produces `why: { key, ... }` and never a sentence, so that the wording lives in one
 * place and can be translated. These are deliberately about what the step ACHIEVES, not about
 * what the moves are: the move list is right there and can be read.
 *
 * A step with no entry here would render as nothing, which is why the wiring test checks that
 * every key the solver can emit has one.
 */
const WHY_TEXT = {
  'cross.lift': () => 'Bring this edge up to the top, without disturbing the cross so far.',
  'cross.insert': () => 'Line it up over its home, then drop it in.',
  'cross.whole': ({ moves }) => `Make the cross on the bottom — ${moves} moves, planned as one.`,
  'firstLayer.lift': () => 'Bring this corner up to the top, where you can work with it.',
  'firstLayer.insert': () => 'Drop the corner into its slot underneath.',
  'middleLayer.insert': () => 'Send this edge down into the middle layer.',
  'f2l.pair': ({ ejected }) => (ejected
    ? 'Take the pair out of the slot first, then join the corner to its edge and put them in together.'
    : 'Join the corner to its edge, then put the pair in together.'),
  'topCross.orient': () => 'Make a cross on the top face.',
  'topFace.orient': () => 'Make the whole top face one colour.',
  'topCorners.permute': () => 'Move the top corners to the places they belong.',
  'topEdges.permute': () => 'Move the top edges home — this finishes the cube.',
};

/** The sentence for a step, with the case name where the step is a named algorithm. */
function whyText(step) {
  if (!step) return '';
  const write = WHY_TEXT[step.why?.key];
  const sentence = write ? write(step.why) : '';
  // A case name is what a learner recognises next time, so it is worth showing — but only for
  // named algorithms, never for a searched sequence, which has no case to name.
  return step.kind === 'case' && step.caseName && !step.parts
    ? `${sentence} (${step.caseName})`
    : sentence;
}

// How the four rungs read on the Settings screen. A rung with no label here would render as
// "undefined", so app-wiring.test.mjs checks every TIERS entry has one.
const TIER_LABEL = { twenty: '≤ 20', nineteen: '≤ 19', eighteen: '≤ 18', shortest: 'shortest' };
const TIER_BLURB = {
  twenty: 'Twenty moves or fewer — always possible, and instant',
  nineteen: 'Nineteen or fewer — a moment longer, and it always gets there',
  eighteen: 'Eighteen if this cube allows it; some do not, and it will say so',
  shortest: 'Keeps looking for a shorter one until you move on',
};

// ---- solver pipeline (cubejs oracle + the two-phase engine in a worker), lazy-loaded ----------
let Cube = null, solverReady = false;
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
  c.solution = ''; c.moves = []; c.stepFacelets = []; c.solveResult = null;
  c.methodSteps = null; c.moveStep = null;
  c.setupAlg = ''; c.derived = false;
}

/** Derive setupAlg/solvable from the stored facelets. Idempotent; cheap after the first call.
 *  Every reader of `solvable` or `setupAlg` must go through here first. */
/** An algorithm string as its move list — the one tokenizer both solve paths share. */
const movesOf = (alg) => (alg.trim() ? alg.trim().split(/\s+/) : []);

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
    const cube = Cube.fromString(c.facelets);
    // A solved cube has no walk. Asked for one anyway, cubejs's two-phase search answers the
    // identity with a 14-move no-op ("R L U2 R L F2 R2 U2 R2 F2 R2 U2 F2 L2"), so "the solver
    // returned moves" is not evidence of anything to follow — every fresh launch put a transport
    // under the solved cube reading 0 / 0, its done tick already lit.
    if (cube.isSolved()) { c.setupAlg = ''; c.solvable = false; return c; }
    const sol = cube.solve();
    const moves = movesOf(sol);
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

// The solver worker, made once and kept. Building the engine's pruning tables costs ~0.5-2.6 s
// (dev-docs/solver-move-count.md §7), so a client per solve would pay it every time.
let solveClient = null;
const solverWorker = () => (solveClient ??= createSolveClient({ spawn: spawnSolveWorker }));

/**
 * Whatever produced the solution, this is what makes it usable — and what checks it.
 *
 * Both solvers end here on purpose. The oracle cross-check and the per-step facelets are not
 * properties of one search or the other, and having two copies is how one of them would quietly
 * stop being verified.
 */
function finishSolve(c, alg) {
  const solution = alg;
  const moves = movesOf(solution);
  // Oracle cross-check: only a definite refutation (parses AND does not solve) blocks.
  let verified = null;
  try { verified = Cube.fromString(c.facelets).move(solution).isSolved(); } catch (err) {
    // Deliberately non-blocking: an oracle that cannot PARSE the alg has refuted nothing, and
    // failing closed here would take solving down whenever the solver emits notation cubejs
    // does not read. But it must not be silent — a cross-check that quietly stops running looks
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

/**
 * Work out the solution, as short as this learner's tier asks for, and cross-check it.
 *
 * The tier is a solution LENGTH, not an effort — "twenty moves or fewer" is a thing a person can
 * hold. Under 20 is reached on every cube and costs ~6 ms, so the default rung is invisible; the
 * tighter ones take seconds, which is why the search runs in a worker and reports each
 * improvement as it finds one rather than making anyone wait for the last.
 *
 * `onImprovement` is called with every strictly shorter answer, so a screen can show 21 becoming
 * 20 becoming 19 instead of a spinner. The promise resolves with the final one.
 */
async function solve({ onImprovement } = {}) {
  const c = state.cube;
  // If a state arrived before the solver was ready, its setup alg is stale — recompute now.
  if (solverReady && c.facelets !== SOLVED && !c.setupAlg) deriveCube();
  // A cached solution is only reusable if it came from the solver that is on now. A lesson
  // kept from before the rung changed would caption the walk with the wrong steps; a solution
  // carried in WITHOUT one — restored, or computed while explaining was off — leaves the
  // reason line with nothing to say, which is how the feature disappeared in the real app
  // while passing in every test that set the state up by hand.
  const wantsLesson = settings.teachLevel !== 'off';
  if (c.solution && wantsLesson === Boolean(c.methodSteps)) return c.solution;

  // The explaining solver is a different product, not a shorter setting: it answers "why is this
  // move right" where the other answers "how short can this be". It runs here on the main
  // thread because it takes ~13 ms and needs no search worth moving off it.
  if (settings.teachLevel !== 'off') {
    const lesson = solveByMethod(fromCube(Cube.fromString(c.facelets)), { level: settings.teachLevel });
    c.methodSteps = lesson.steps;
    // Which step each move belongs to, so the walk can say why the move you are on is there.
    c.moveStep = lesson.steps.flatMap((step, i) => movesOf(step.alg).map(() => i));
    c.solveResult = null; // a lesson has no length target to have met or missed
    onImprovement?.({ moves: lesson.moveCount, met: true, target: null, stopped: null, alg: lesson.alg });
    return finishSolve(c, lesson.alg);
  }
  c.methodSteps = null;
  c.moveStep = null;

  const client = solverWorker();
  let result = null;
  for await (const step of refine(c.facelets, {
    solve: (facelets, bounds) => client.solve(facelets, bounds),
    tier: settings.solveTier,
  })) {
    result = step;
    onImprovement?.(step);
  }
  // Never inferred from the move count: a tier the cube cannot reach (18 does not exist for
  // every position) must read as "the shortest I found", not as the target met.
  c.solveResult = describe(result);
  return finishSolve(c, result.alg);
}

// ---- cube element helpers --------------------------------------------------------------------
function newCube({ animate = false } = {}) {
  const el = document.createElement('cubus-cube');
  el.setAttribute('palette', PALETTE_ATTR[settings.palette] || 'muted');
  // Off by default: every cube in the app is set up at a chosen angle (the ghost faces depend on
  // it), and a stray drag on a touch screen or a trackpad swung it away with no way back.
  el.setAttribute('orbit', settings.dragRotate ? 'free' : 'locked');
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
    if (['macos', 'windows', 'linux', 'ios', 'android'].includes(q)) { localStorage.setItem('cubus.platform', q); return q; }
    if (q === 'auto') localStorage.removeItem('cubus.platform');
    const s = localStorage.getItem('cubus.platform'); if (s) return s;
  } catch {}
  const ua = navigator.userAgent;
  // iPadOS calls itself a Mac; a finger gives it away — the touch points (5 on a real iPad), or a
  // coarse pointer (what a touch-emulating WebKit reports, with no touch points at all). No Mac
  // has either. A phone or tablet gets plain bars: no traffic-light gap, no caption buttons —
  // there is no window to drive.
  // globalThis, guarded: the test harness has no matchMedia, and no finger either.
  const finger = navigator.maxTouchPoints > 0 || globalThis.matchMedia?.('(any-pointer: coarse)').matches === true;
  if (/iPhone|iPad|iPod/.test(ua) || (/Mac/.test(ua) && finger)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Mac/.test(ua)) return 'macos';
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
  const cap = (name, win, round = false) => `<button class="tb-cap ${win}${round ? ' round' : ''}" data-win="${win}" title="${win}" aria-label="${win === 'min' ? 'Minimise' : 'Close'}">${icon(name, round ? 14 : 16)}</button>`;
  if (platform === 'macos') {
    const lights = preview ? ['#E8695E', '#E0B341', '#5FB55F'].map((c) => `<span class="tl" style="background:${c}"></span>`).join('') : '';
    lead.innerHTML = `<span class="tb-lights">${lights}</span>${brand}`;
    trail.innerHTML = cubeLive + gear;
  } else {
    const round = platform === 'linux';
    // Caption buttons only where there is an undecorated window to drive: Windows and Linux.
    const captions = (platform === 'windows' || platform === 'linux') && (isTauri || preview);
    lead.innerHTML = brand;
    // Minimise and close only: the window is a fixed size (dev-docs/stage-contract.md), so
    // there is no maximise — and toggleMaximize would have maximised it regardless of the
    // resize flag.
    trail.innerHTML = cubeLive + gear + (captions
      ? `<span class="tb-zone tb-caption ${platform}">${cap('minus', 'min', round) + cap('x', 'close', round)}</span>`
      : '');
    if (captions) wireWindowButtons(trail);
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

/** The connected cube's remembered record at the moment it connected — what the reconnect
 *  reading compares the first report against. Cleared with the connection. */
let pendingLast = null;
/** True until the connection's FIRST report arrives; that report is the reconnect evidence. */
let awaitingReport = false;
/** The 16-bit serial that came with the latest report, or null when it carried none. Stored
 *  beside the memory as information for wording, never proof: the GAN16's counter is
 *  per-connection and says nothing across a break. */
let lastSerialSeen = null;
/** Did the last registry write fail? Announced in Settings: a memory that failed to save must
 *  not look like one that saved — on the next reconnect the app would ask its question over
 *  nothing and call a known cube new. */
let registryWriteBad = false;

/** Is the live CHAIN trusted — trusted knowledge of the cube itself, not of a generated
 *  subject? 'generated' sets `trusted` too (a scramble is perfectly known), but that is
 *  knowledge of a scramble, and filing it as what the cube looked like is exactly the
 *  confidently-wrong record this distinction exists to prevent. One predicate, because its two
 *  call sites (the trusted-update write and the disconnect timestamp) must never drift. */
const chainTrusted = () =>
  state.cube.trusted && (state.cube.source === 'cube' || state.cube.source === 'camera');

/** Write the remembered arrangement: the truth the app is currently sure of, and the cube's own
 *  raw report at the same moment. Called on every update that arrives on a trusted chain;
 *  deduplicated on content so the ~1 Hz resend of an unchanged state does not become a storage
 *  write per second — and `force` refreshes the timestamp anyway at moments worth naming (a
 *  confirmation, a repair, the disconnect that ends the chain). */
function rememberLastSeen(how, { force = false } = {}) {
  if (!state.connected || !state.cubeMac || !state.live || !state.reported) return;
  const prev = cubes[state.cubeMac]?.last;
  const serial = lastSerialSeen ?? null;
  if (!force && prev && prev.facelets === state.live && prev.reported === state.reported
    && prev.serial === serial && prev.how === how) return;
  cubes = rememberLast(cubes, state.cubeMac, {
    facelets: state.live, reported: state.reported, serial, at: Date.now(), how,
  }, Cube);
  const ok = save('cubusCubes', cubes);
  if (ok !== !registryWriteBad) { registryWriteBad = !ok; repaintSettings(); }
}

/** The cube screen installs these while following. Moves are the SIGNAL — the cube reports one
 * per turn, immediately. Facelet snapshots arrive at ~1Hz and are the CORRECTION: they say where
 * the cube really is when the move stream and the guide have drifted apart. */
let liveMove = null;
let liveGap = null;
/** An anchor in flight. Module-level on purpose: dropping trust re-renders Settings, so a flag
 *  declared inside the mount would be reset by the very repaint the guard exists to survive. */
let anchoring = false;
/** A screen's reaction to trust LAPSING — gap, disconnect, a report that failed validation, a
 *  contradicted scan. One hook covers them all because they all pass through markStale, which is
 *  the whole point of routing trust through one function. Cleared on navigation. */
let onTrustLost = null;

/** Repair tracking from one camera reading, WITHOUT solving the cube.
 *
 *  This is the whole point of the trust design: the old repair was "solve it, then re-anchor",
 *  which for a beginner is not a recovery path at all — someone who could solve the cube would
 *  not need the app, and that is exactly where a new player gives up.
 *
 *  @returns {{ok: boolean, text: string}|null} what to tell the user, or null when the scan
 *  changed nothing about tracking (no cube, or it already agreed).
 */
function repairTracking(scanned) {
  if (!state.connected || !conn) return null;
  // The RAW report, not state.live: live has already had the current offset applied, so deriving
  // against it yields the identity — overwriting a correction the cube still needs.
  const reported = state.reported;
  if (!reported) return null;
  // On an UNBROKEN chain the scan and the cube must agree. If they do not, one of them is wrong —
  // a misread, or a camera pointed at a different cube — and deriving a correction from a
  // contradiction would bake the mistake in permanently. Which one is wrong is not knowable;
  // that there is a problem is. (Compared against state.live, NOT the raw report: once a
  // correction is active, comparing with the raw report made every later good scan look like a
  // contradiction — repairing a cube once made every later scan of it fail.)
  if (state.cube.trusted && scanned !== state.live) {
    return {
      ok: false,
      text: 'This is not what your cube is reporting, and the cube was tracking. One of the two is wrong, so nothing was changed — check that you scanned the cube that is connected.',
    };
  }
  const offset = deriveOffset(scanned, reported, Cube);
  if (!offset) return null;
  state.cube.offset = isIdentity(offset) ? null : offset;
  state.cube.offsetAt = state.cube.offset ? Date.now() : 0;
  state.cube.offsetFrom = state.cube.offset ? 'scan' : '';
  // Recomputed on the spot: live is the last report WITH the correction applied, and leaving it
  // describing the old correction until the next ~1s snapshot lands means everything reading it
  // in between sees a position that is no longer claimed.
  const corrected = applyOffset(state.cube.offset, reported, Cube);
  if (corrected !== null) state.live = corrected;
  return state.cube.offset
    ? { ok: true, text: 'Tracking repaired — your cube is back in step for as long as it stays connected, and you never had to solve it.' }
    : null;
}

/** The cube is gone — dropped, or deliberately let go. ONE body, used by the driver's event, the
 *  Disconnect button and the failure path in connectOnce. Idempotent. */
function onDisconnect() {
  conn = null;
  // The memory's timestamp is the last moment the app was SURE — which is now, if the chain was
  // trusted when it broke. The content is already stored; this is the one write that keeps
  // "as we last saw it, Tuesday 21:40" naming the break rather than the last turn.
  if (chainTrusted()) {
    rememberLastSeen(state.cube.source, { force: true });
  }
  // A question about a cube that is no longer here has no answer worth taking: the Yes would
  // grant trust to a chain that just ended. The candidate picture stays as the (stale, flagged)
  // subject; the question itself closes.
  const hadQuestion = Boolean(state.reconnect);
  state.reconnect = null;
  pendingLast = null;
  awaitingReport = false;
  lastSerialSeen = null;
  // Order matters: mark stale BEFORE setConnected, so the indicator repaints once, already
  // knowing the truth, rather than flashing "connected and fine" on its way out.
  markStale('it disconnected, and may have been turned since');
  // Across a disconnect the cube may sleep, reset its own counters, or be turned. The offset
  // corrected a specific chain to reality at a moment; that chain is gone.
  clearOffset();
  setConnected(false);
  // setConnected repaints Settings; the question block on Home is this screen's own furniture.
  if (hadQuestion && state.screen === 'home') renderScreen();
}

/** Throw the correction away. NOT called on `gap`: a serial skip means moves were missed, not
 *  that the reference moved — what was lost is the moves in between, not the relationship. */
function clearOffset() {
  state.cube.offset = null;
  state.cube.offsetAt = 0;
  state.cube.offsetFrom = '';
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
  cubes = rememberCube(cubes, { mac, name, at: Date.now() }, Cube);
  // A memory that failed to save must not look like one that saved: on the next reconnect the
  // app would greet a known cube as a stranger. save() already logs; Settings says it in words.
  registryWriteBad = !save('cubusCubes', cubes);
  // A new connection starts knowing nothing about this cube. Trust and the last report belong to
  // the chain that just ended: inheriting them let a freshly paired cube be treated as verified
  // on the strength of a camera scan of some *other* cube.
  state.live = null;
  state.reported = null;
  lastSerialSeen = null;
  clearOffset();
  // The reconnect reading. Until the first report arrives the evidence is "no report" — with a
  // remembered arrangement that is already a picture worth showing (dimmed, unconfirmed), and if
  // the cube never answers, the words are already the true ones. The first report re-reads the
  // evidence; with nothing remembered there is no question to ask and today's flow stands.
  pendingLast = cubes[normaliseMac(mac)]?.last ?? null;
  awaitingReport = true;
  const opening = classifyReconnect({ report: null, last: pendingLast }, Cube);
  state.reconnect = opening.candidate
    ? { reading: opening.reading, candidate: opening.candidate, raw: null, seenAt: pendingLast?.at ?? 0 }
    : null;
  if (state.reconnect) {
    // Home shows the candidate AT ONCE — the remembered arrangement, in an unconfirmed dress.
    // Ingested, not adopted: adoptCube would mark it trusted, and no reading grants trust.
    ingestFacelets(state.reconnect.candidate);
    state.cube.isPhysical = true;
  }
  markStale('it has just connected, and has not been checked yet');
  setConnected(true, name, mac);
  if (state.reconnect && state.screen === 'home') renderScreen();
}

/** The cube answered nothing — getState timed out or rejected. This used to be swallowed with an
 *  empty catch, and the screen showed a connected cube that had said nothing; now it is said. The
 *  reading is already 'no-report' when something is remembered (set at adoptConnection); with
 *  nothing remembered this is the moment the silence becomes a question worth drawing at all. */
function reportSilence() {
  if (!state.connected || !awaitingReport) return;
  if (!state.reconnect) {
    state.reconnect = { reading: 'no-report', candidate: null, raw: null, seenAt: 0 };
  }
  // Settings goes through the deferral, like every other async repaint of it.
  if (state.screen === 'home') renderScreen();
  else repaintSettings();
}

/** The user's answer: yes, the candidate is the cube in their hand, right now. The ONE thing that
 *  grants trust on a reconnect — no reading does. The working offset is derived from the
 *  confirmed picture and the cube's report at classification, exactly the derivation a camera
 *  repair makes with the picture standing in for the scan; it is constant under any turns made
 *  while the question was open, so the LATEST report is then corrected by it. State only — the
 *  caller owns navigation and re-rendering, because Home, Settings and the scan screen each need
 *  a different one. */
function confirmReconnect() {
  const rc = state.reconnect;
  if (!rc || !rc.candidate || !rc.raw) return false;
  const offset = deriveOffset(rc.candidate, rc.raw, Cube);
  if (offset === null) {
    // Should be unreachable — both strings were validated by the reading — but a confirmation
    // that cannot do its job must refuse loudly ON SCREEN, never grant trust over a failed
    // derivation and never leave the Yes button looking dead: markStale repaints the indicator
    // and Settings with the reason.
    console.error('reconnect confirmation could not derive a correction', rc);
    // The refusal reaches the question itself, not only the indicator: dropping `raw` takes the
    // Yes away (it cannot do its job), leaving the camera as the door — and the caller's
    // re-render is what repaints the block either way.
    markStale('its confirmation could not be checked');
    state.reconnect = { ...rc, raw: null };
    return false;
  }
  state.cube.offset = isIdentity(offset) ? null : offset;
  state.cube.offsetAt = state.cube.offset ? Date.now() : 0;
  state.cube.offsetFrom = state.cube.offset ? 'confirmed' : '';
  // The LATEST report, corrected — turns made while the question was open are covered, because
  // the offset is constant under them. A latest report that fails validation (recorded raw, on
  // purpose) falls back to the one the reading validated.
  const corrected = applyOffset(state.cube.offset, state.reported ?? rc.raw, Cube)
    ?? applyOffset(state.cube.offset, rc.raw, Cube);
  if (corrected === null) {
    console.error('reconnect confirmation could not correct the latest report');
    clearOffset();
    markStale('its confirmation could not be checked');
    state.reconnect = { ...rc, raw: null };
    return false;
  }
  state.reconnect = null;
  state.live = corrected;
  adoptCube(corrected, { physical: true, source: 'cube' });
  rememberLastSeen('confirmed', { force: true });
  return true;
}

/** Wire a screen's Yes / camera answer pair. One body for Home and Settings, so the answer
 *  cannot behave differently by screen — and the re-render covers BOTH outcomes: a taken Yes
 *  shows the normal screen, a refused one repaints the question with the Yes gone. */
function wireReconnectAnswers(root) {
  for (const b of root.querySelectorAll('[data-reconnect]')) {
    b.onclick = () => {
      if (b.dataset.reconnect === 'yes') { confirmReconnect(); renderScreen(); }
      else go('scan');
    };
  }
}

/** "Tuesday 21:40" — the dress a memory wears. A remembered arrangement is a memory with a
 *  timestamp and is shown as one, never as the truth. Empty parts when the stamp is missing. */
function whenWords(ts) {
  if (!ts) return { day: '', full: '' };
  const d = new Date(ts);
  const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()];
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return { day, full: `${day} ${time}` };
}

/** What to call the connected cube. The user's own word wins; the cube's own name is the
 *  fallback. One helper so a nickname cannot appear on one screen and not another. */
const liveCubeLabel = () =>
  cubeLabel({ ...cubes[state.cubeMac], mac: state.cubeMac, name: state.cubeName }) || 'Smart cube';

/** Is someone mid-typing in a cube-settings input? Async repaints of Settings defer rather than
 *  discard what is being typed. ONE predicate on purpose — it had two copies, and two copies of
 *  a focus check is how one repaint path eats input while the other politely waits. */
const editingCubeSettings = () => {
  const el = document.activeElement;
  return Boolean(el && (el.id === 'macIn' || el.dataset?.renameCube));
};
/** A Settings repaint that arrived mid-typing. DEFERRED is not DROPPED: without the flush on
 *  focusout (wired in the Settings mount), a battery or trust change landing while a nickname
 *  was being typed stayed stale on screen indefinitely. */
let settingsRepaintPending = false;
const repaintSettings = () => {
  if (state.screen !== 'settings') return;
  if (editingCubeSettings()) { settingsRepaintPending = true; return; }
  settingsRepaintPending = false;
  renderScreen();
};

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
      repaintSettings();
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
  // The read-from-cube button this used to relabel is gone: its job — naming whether the screen's
  // subject is the cube in your hand — is done by the reconnect question's Yes / camera pair,
  // which renders with the screen rather than being repainted here.
  // Settings derives its setup checklist from trust; deferred while an input there has focus,
  // for the same reason the battery redraw is.
  repaintSettings();
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
  const lapsed = state.cube.trusted;
  state.cube.trusted = false;
  state.cube.staleWhy = why;
  // Only an actual lapse notifies — a stale cube going stale for a new reason is a wording
  // change, not an event a screen needs to stand down for.
  if (lapsed && onTrustLost) { try { onTrustLost(); } catch {} }
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
    // Every callback is scoped to ITS cube: a slow packet or a late disconnect event from a
    // connection that has since been replaced must not mutate the new cube's state, report a
    // gap against it, or tear it down.
    cube.onFacelets((f) => { if (conn === cube) onFacelets(f.facelets, f.serial); });
    // Subscribe the move stream too: following runs on moves (immediate), snapshots (~1Hz) only
    // correct drift — a turn sequence completed inside one second has no intermediate snapshots.
    cube.onMove((m) => { if (conn === cube && liveMove) liveMove(m); });
    cube.on('gap', (g) => { if (conn === cube) onGap(g); });
    cube.on('disconnect', () => { if (conn === cube) onDisconnect(); });
    // Not swallowed: a decrypt or transport error is a fact about the stream worth a trace,
    // even when the driver recovers on the next packet.
    cube.on('error', (e) => { if (conn === cube) console.warn('cube driver error', e); });
    cube.connect(); conn = cube;
    adoptConnection(mac, name);
    cube.getState({ active: true }).then((f) => { if (conn === cube) onFacelets(f.facelets, f.serial); }).catch((e) => {
      // Said, not swallowed: this rejection used to vanish into an empty catch, and the screen
      // showed a connected cube that had said nothing. The passive stream may still deliver a
      // first report later; until it does, the reading is 'no report' and the screens say so.
      if (conn !== cube) return;
      console.warn('the cube did not answer its state request', e);
      reportSilence();
    });
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
function onFacelets(reported, serial) {
  if (!reported) return;
  // What the cube literally said, before any correction. A repair derives the offset from the
  // RAW report — deriving it from a corrected one produces the identity.
  state.reported = reported;
  lastSerialSeen = Number.isInteger(serial) ? serial & 0xffff : null;
  // The connection's FIRST report is the reconnect evidence: raw against the remembered raw,
  // and the reading chooses the picture and the words — never the trust.
  if (awaitingReport) {
    awaitingReport = false;
    const r = classifyReconnect({ report: reported, last: pendingLast }, Cube);
    if (r.candidate && (r.reading === 'unchanged' || r.reading === 'turned')) {
      state.reconnect = { reading: r.reading, candidate: r.candidate, raw: reported, seenAt: pendingLast?.at ?? 0 };
      // The candidate becomes the subject — shown at once, in the unconfirmed dress. Ingested,
      // not adopted: no reading grants trust, only the user's answer does. Settings repaints
      // through the deferral, like every other async repaint of it — the first report lands
      // about a second after pairing, exactly when a nickname is likely mid-typing.
      ingestFacelets(r.candidate);
      state.cube.isPhysical = true;
      if (state.screen === 'home') renderScreen();
      else repaintSettings();
      return;
    }
    // Nothing remembered (or nothing derivable): no question to ask — today's flow, below. A
    // question opened over the memory alone ('no report') closes here: the report is the better
    // evidence, and it said the memory was not usable after all.
    const hadQuestion = Boolean(state.reconnect);
    state.reconnect = null;
    if (hadQuestion) {
      if (state.screen === 'home') renderScreen();
      else repaintSettings();
    }
  }
  // The candidate is FROZEN while the reconnect question is open: an untrusted report updating
  // the picture being confirmed would make it a picture nobody can confirm. The raw report is
  // still recorded above — the Yes derives against it and the repair scan reads it — but `live`
  // stays unclaimed (the cube's true arrangement is precisely what is being asked) and the
  // subject and the screens hold still until the answer.
  if (state.reconnect) return;
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
  // An UNCHANGED report still reaches the screen. After a lost move packet, the snapshot that
  // proves the cube is back where the app already thought it was IS the correction — an early
  // return here swallowed it, and the follow model on a walking screen stayed wrong forever.
  // Only the ingest and the home repaint are deduplicated.
  const changed = !(state.cube.isPhysical && f === state.cube.facelets);
  // ingest, not set: a snapshot from the cube must not cost a Kociemba search.
  if (state.cube.isPhysical && changed) ingestFacelets(f);
  // Every update that arrives on a trusted chain replaces the remembered arrangement — the
  // record a reconnect is later compared against.
  if (chainTrusted()) {
    rememberLastSeen('cube');
  }
  if (liveUpdate) liveUpdate(f, serial);
  else if (changed && state.screen === 'home') renderScreen();
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
/** How short a scramble should be. A WCA scramble is around 19-20 moves; cubejs's unbounded
 *  answer averaged 21.5, which is a longer thing to type in than it needs to be. Under 20 is
 *  reached on every cube in a few milliseconds (dev-docs/solver-move-count.md). */
const SCRAMBLE_BOUND = 21;
const SCRAMBLE_PROBES = 50_000_000;

/**
 * A scramble, the way the WCA makes one.
 *
 * A random-STATE scramble: the position is drawn uniformly from all 43 quintillion legal ones,
 * from a cryptographic source, and then solved — the scramble is that solution inverted. Random
 * TURNS would leave a distribution with structure in it, and cubes systematically easier than
 * they look.
 *
 * The solver is our own two-phase engine (lib/two-phase.js), whose length bound is what lets
 * a scramble be asked for at a sensible length rather than however long the search happened
 * to answer.
 *
 * Returns `{ facelets, alg }` — the scrambled state and the scramble that reaches it — and
 * mirrors `alg` into `currentScramble` for the cross-screen readers (the solve record). Only
 * the LATEST call writes the mirror: two overlapping requests once let the slower, staler one
 * overwrite the scramble the screen was already showing. Callers that need the pair use the
 * return value, which is always self-consistent.
 */
let scrambleSeq = 0;
async function randomScramble() {
  if (!solverReady) return { facelets: '', alg: '' };
  const seq = ++scrambleSeq;
  const cube = randomCube(Cube);
  const facelets = cube.asString();
  const client = solverWorker();
  // The bound is a preference, not a requirement: a scramble that is one move longer is still a
  // perfectly good scramble, and refusing to produce one at all would be much worse. Falling
  // back is why this asks twice rather than once.
  let solution = await client.solve(facelets, { solLen: SCRAMBLE_BOUND, probeMax: SCRAMBLE_PROBES });
  solution ??= await client.solve(facelets, { solLen: LOOSEST_BOUND, probeMax: SCRAMBLE_PROBES });
  if (solution === null) {
    // Not a budget problem — the loose bound always answers. Something is wrong with the solver,
    // and a scramble screen showing an empty string would look like a solved cube.
    if (seq === scrambleSeq) currentScramble = '';
    throw new Error('scramble: the solver could not solve a state it generated');
  }
  const alg = movesOf(solution).reverse().map(invMove).join(' ');
  // The oracle check the solve path gets in finishSolve, for the scramble path: the alg must
  // actually reach the state it is paired with, or the walk would march to a different cube
  // than the one every label describes. Cheap (~µs), and a wrong pair fails loudly here.
  const oracle = new Cube();
  if (alg) oracle.move(alg);
  if (oracle.asString() !== facelets) {
    if (seq === scrambleSeq) currentScramble = '';
    throw new Error('scramble: the alg does not reach the state it was made from');
  }
  if (seq === scrambleSeq) currentScramble = alg;
  return { facelets, alg };
}

export { state };

// ===============================================================================================
// Screens
// ===============================================================================================
const SCREENS = {};
/** The stage's box, in viewport coordinates. Popovers are the stage's absolutely positioned
 *  children (index.html, the popover rule), so this is both the box they are clamped to and the
 *  origin their `top`/`left` are measured from. Not the viewport: under the layout contract
 *  (dev-docs/stage-contract.md) the viewport also holds the OS insets and the app's bars, and a
 *  test keeps this file from reading it. */
const stageRect = () => $('#stage').getBoundingClientRect();

/** Vertical placement for a popover. The stylesheet's cap bounds SIZE but cannot know POSITION,
 *  so the room that remains is computed here: below the anchor when that fits or is the roomier
 *  side, above it otherwise — and always capped to the room actually there, so the popover
 *  scrolls rather than running off either edge of the stage. */
const placePopoverV = (el, anchorRect) => {
  const gap = 6, margin = 8;
  const s = stageRect();
  el.style.maxHeight = ''; // measure the natural height, not the cap left by the last placement
  const below = s.bottom - anchorRect.bottom - gap - margin;
  const above = anchorRect.top - s.top - gap - margin;
  if (below >= Math.min(el.offsetHeight, 120) || below >= above) {
    el.style.top = `${anchorRect.bottom - s.top + gap}px`;
    el.style.maxHeight = `${Math.max(40, below)}px`;
  } else {
    // Above the anchor: sized to the room there is, then placed so its bottom edge sits `gap`
    // over the anchor. (Anchoring by `bottom` would need a height this file no longer reads.)
    const h = Math.max(40, Math.min(el.offsetHeight, above));
    el.style.maxHeight = `${h}px`;
    el.style.top = `${anchorRect.top - s.top - gap - h}px`;
  }
};

/** Drop a `.menu` under a corner button, right-aligned to it and clamped inside the stage. */
const placeMenuUnder = (btn, menu) => {
  const r = btn.getBoundingClientRect();
  const s = stageRect();
  const w = menu.offsetWidth;
  menu.style.left = `${Math.min(Math.max(8, r.right - s.left - w), s.width - w - 8)}px`;
  placePopoverV(menu, r);
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
  // A sticker is a BUTTON: correcting it by pointer and by keyboard are one path, because a
  // button's keyboard activation IS a click — the delegated listener cannot tell them apart.
  // tabindex −1 on every cell: the board is one tab stop and the arrows rove (see the mount).
  const cell = (bg) => `<button type="button" class="cell" tabindex="-1" style="background-color:${bg}"></button>`;
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
  // --primary-share 0.66, not the default 0.58: the net wants the room, and the sheet is a cube
  // twin and a paragraph. `twin-low`: in portrait the twin sits beside the sheet, not beside the
  // cross — the cross is the same cross in both windows and wants the width (index.html). Only a
  // finger's portrait shows one face large over a strip (.scan-faces under pointer: coarse).
  return {
    html: `<div class="cols twin-low" style="--primary-share:0.66">
    <div class="col">
      <div class="card scanboard">
        <ai-scan-panel headless autostart></ai-scan-panel>
        <div class="scan-faces">${NET_FACES.map((f) => `<div class="scan-face" role="group" aria-label="${SCAN_FACE_NAME[f]} side" data-face="${f}">
          <div class="tile" style="border-color:${edgeColors(f)}"><div class="tgrid">${pending(f)}</div></div><div class="lbl">${SCAN_FACE_NAME[f]}</div></div>`).join('')}</div>
        <div class="scan-cam card-tools">
          <button id="scanResetBtn" title="Throw the whole scan away and start again" aria-label="Throw the whole scan away and start again">${icon('refresh', 19)}</button>
          <button id="scanPaintBtn" title="Paint the cube by hand instead of scanning it" aria-label="Paint the cube by hand instead of scanning it">${icon('paint-roller', 19)}</button>
          <button id="scanCamBtn" title="Camera" aria-label="Camera and scan menu">${icon('webcam', 20)}</button>
        </div>
      </div>
    </div>
    <div class="aside">
      <div class="card twin"><div class="eyebrow">DETECTED STATE</div>
        <div class="cube-slot" id="scanCube"></div></div>
      <div class="sheet scan-sheet">
        <div class="card"><b style="font-size:var(--fs-body-l)" id="scanHowTitle">How it works</b>
          <div class="sub scan-say" id="scanHow" style="margin-top:4px">${registered ? 'Opening the camera…' : 'Loading the scanner…'}</div>
          <div class="sub scan-hint" id="scanHint" hidden></div></div>
        <button class="btn primary block" id="scanSolveBtn" data-go="home" style="margin-top:auto" disabled>Solve this cube</button>
      </div>
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
      // its 0–8) so the hidden three clear the solid ones; stickers go full-bleed at 1 so a
      // nine-grid stays legible at this size. The camera's distance is the renderer's to fit —
      // it frames whatever this puts in view to whatever slot the twin has (lib/cube-frame.js).
      stateCube.setAttribute('ghost-elevation', '9');
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
        [...tile.querySelectorAll('.cell')].forEach((c, i) => {
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
      // The reconnect confirmation runs INSIDE this screen's own flow, not beside it: the panel's
      // captures are private to it and die with it, so "the repair scan continues from the sides
      // already captured" is true only if the confirmation IS this screen in a confirm mode. Two
      // adjacent matching sides take the user's Yes; one mismatch and the same panel instance
      // simply keeps capturing into the full six-side repair, two sides in.
      let confirming = Boolean(state.reconnect?.candidate);
      const confirmEntry = confirming;
      const CONFIRM_HOW = 'We remember this cube. Show any two sides that meet along an edge — the front, then the top, works well. If both match what we remember, that’s your cube confirmed with no full scan; if either differs, keep going and the camera reads all six.';
      if (confirming) {
        sayTitle.textContent = t('Checking your cube');
        say.textContent = t(CONFIRM_HOW);
      }
      // "Solve this cube" is a promise about THIS screen's scan, so it is only pressable once a
      // scan stands complete — and a correction that re-opens the verdict takes it away again.
      const solveBtn = $('#scanSolveBtn', root);
      const tiles = [...root.querySelectorAll('.scan-face')];
      const paint = (cells, colors) => cells.forEach((c, i) => { c.style.backgroundColor = classColor(colors[i]); });
      // A finger's portrait shows one face large and the other five as a strip (index.html,
      // .scan-faces under pointer: coarse): six 3×3 tiles cannot give a finger 44px stickers in
      // a phone's width. Which face is large is a policy, because the scanner is orderless and
      // reports no "face being seen": the side it asks to see again, else the side it just read,
      // else the one you tap — F to begin with. With a mouse, in either window, the class is
      // inert and the six tiles are the cross.
      const faces = $('.scan-faces', root);
      const setFocus = (f) => { for (const tile of tiles) tile.classList.toggle('focus', tile.dataset.face === f); };
      // Guarded: the test harness lays nothing out and has no getComputedStyle global.
      const focusLayout = () => {
        const cs = globalThis.getComputedStyle?.(faces);
        return cs ? cs.getPropertyValue('--focus').trim() === '1' : false;
      };
      setFocus('F');
      let capturedCount = 0;

      // ---- the board's keyboard path -----------------------------------------------------------
      // 54 stickers are 54 buttons, but ONE tab stop: the board is a composite widget with a
      // roving tabindex. Tab lands on it once; the arrows walk the stickers (Left/Right by one,
      // Up/Down by a row within a side, Home/End to the board's ends); Enter is the click the
      // pointer would have made, heard by the same delegated listener. Every cell is inspectable
      // by arrow — its label carries the side, the position and the reading — and aria-disabled
      // says which ones a press will be refused on, without swallowing the event the way real
      // `disabled` would (a swallowed click would break tap-to-focus on the strip tiles).
      const cellButtons = tiles.flatMap((tile) => [...tile.querySelectorAll('.cell')]);
      let roveAt = cellButtons.indexOf(tiles.find((tile) => tile.dataset.face === 'F').querySelector('.cell'));
      const setRove = (idx) => {
        cellButtons[roveAt].setAttribute('tabindex', '-1');
        roveAt = Math.max(0, Math.min(cellButtons.length - 1, idx));
        cellButtons[roveAt].setAttribute('tabindex', '0');
      };
      setRove(roveAt);
      faces.addEventListener('keydown', (ev) => {
        const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 3, ArrowUp: -3 }[ev.key];
        const jump = ev.key === 'Home' ? 0 : ev.key === 'End' ? cellButtons.length - 1 : null;
        if (step === undefined && jump === null) return;
        ev.preventDefault();
        setRove(jump ?? roveAt + step);
        cellButtons[roveAt].focus();
      });
      // A pointer can land focus anywhere; the roving point follows it rather than fighting it.
      faces.addEventListener('focusin', (ev) => {
        const i = cellButtons.indexOf(ev.target);
        if (i >= 0) setRove(i);
      });

      /** Names and actionability for all 54 cells, refreshed on every capture and every paint
       *  toggle: the label is how a screen reader inspects the board the way an eye does, and
       *  aria-disabled marks the cells whose press the handler will refuse (a pending outer
       *  sticker; the centre before its side is read, or while painting). */
      let lastCaptured = [];
      const refreshCellNames = () => {
        for (const tile of tiles) {
          const f = tile.dataset.face;
          const got = lastCaptured.find((c) => c.face === f);
          [...tile.querySelectorAll('.cell')].forEach((c, i) => {
            const centre = i === 4;
            const actionable = centre ? Boolean(got) && !painting : Boolean(got) || painting;
            c.setAttribute('aria-disabled', String(!actionable));
            if (centre) {
              c.setAttribute('aria-label', got
                ? `Scan the ${SCAN_FACE_NAME[f]} side again`
                : `${SCAN_FACE_NAME[f]} side centre — it names the side`);
            } else {
              const read = got ? `read as the ${SCAN_FACE_NAME[NET_FACES[got.colors[i]]]} side’s colour` : 'not read yet';
              c.setAttribute('aria-label', `${SCAN_FACE_NAME[f]} side, sticker ${i + 1} — ${read}`);
            }
          });
        }
      };
      // First called below, once `painting` exists — this definition precedes that declaration.

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
        // The tiles read this: outer stickers only wear a pointer when a click will be heard —
        // on a read side, or while painting. The class is what lets the stylesheet know.
        root.classList.toggle('painting', on);
        paintBtn.title = on ? 'Stop painting and use the camera' : 'Paint the cube by hand instead of scanning it';
        paintBtn.setAttribute('aria-label', paintBtn.title);
        // Painting changes which cells a press is heard on; their aria-disabled must say so.
        refreshCellNames();
        panel.setPainting?.(on);
      };
      refreshCellNames();
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
          const centreCell = tile.querySelectorAll('.cell')[4];
          if (!centreCell.firstChild) centreCell.innerHTML = icon('refresh', 15);
          centreCell.title = `Scan the ${SCAN_FACE_NAME[f]} side again`;
          const got = p.captured.find((c) => c.face === f);
          const cells = [...tile.querySelectorAll('.cell')];
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
        // The large tile in portrait: the side asked for again outranks the side just read.
        if (p.confirm?.face) setFocus(p.confirm.face);
        else if (p.captured.length > capturedCount) setFocus(p.captured[p.captured.length - 1].face);
        capturedCount = p.captured.length;
        lastCaptured = p.captured;
        refreshCellNames();
        // The twin follows the scan side by side rather than waiting for all six.
        if (!settled) stateCube.setAttribute('facelets', partialFacelets(p.captured));
        camOn = Boolean(p.device);
        camRow.classList.toggle('on', camOn);
        camBtn.title = camOn ? `${p.device.label} — camera and scan` : 'Camera off — click to turn it on';
        camBtn.setAttribute('aria-label', camBtn.title);
        // Labels are only readable once permission is granted, so the list is worth rebuilding the
        // first time a camera actually answers.
        if (p.device && p.device.deviceId !== shownDevice) {
          shownDevice = p.device.deviceId;
          void fillCams();
        }
        // ---- reconnect confirmation ----------------------------------------------------------
        // Each captured side is compared with the candidate — by its centre colour (the scanner
        // names a side by its centre, the one sticker a turn cannot move), up to rotation, and
        // EXACTLY: the scanner's own two-sticker tolerance is one short of a quarter turn's
        // three, so here a misread costs a full scan and never a false yes. Last, so its words
        // stand over the generic caption — but never over the scanner's own pinned notice.
        if (confirming && state.reconnect?.candidate && !n && p.phase !== 'error') {
          const sides = p.captured.map((c) => ({ face: c.face, stickers: c.colors.map((ci) => NET_FACES[ci] ?? '?').join('') }));
          const check = confirmCheck(state.reconnect.candidate, sides, Cube);
          if (check.verdict === 'confirmed') {
            confirming = false;
            // The user's Yes, well founded and taken: same derivation, same trust, same words a
            // Yes on Home earns — and back to the screen the question was asked on.
            if (confirmReconnect()) {
              go('home');
              return;
            }
            // Refused — the derivation could not do its job. The scan is already running, so
            // the full read is the honest continuation, and this says so.
            sayTitle.textContent = t('Keep going');
            say.textContent = t('The match could not be taken as an answer, so the camera will read the whole cube instead — keep showing sides, the ones already read still count.');
            say.className = 'sub scan-say';
          } else if (check.verdict === 'mismatch') {
            confirming = false;
            sayTitle.textContent = t('Not what we remembered');
            say.textContent = t('That side is not what we remembered, so the camera will read the whole cube instead. Keep showing sides — the ones already read still count.');
            say.className = 'sub scan-say';
          } else if (check.matched.length) {
            sayTitle.textContent = t('One more side');
            say.textContent = t('That side matches. Now show one that touches it along an edge — two neighbouring sides are what the check needs.');
            say.className = 'sub scan-say ok';
          } else if (!p.captured.length && !p.message) {
            sayTitle.textContent = t('Checking your cube');
            say.textContent = t(CONFIRM_HOW);
            say.className = 'sub scan-say';
          }
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
        // place (their content is already canonical, so nothing visibly changes). The cell
        // names follow: captures were named as SHOWN, and the settle renames every sticker
        // from the validated string.
        settleTiles(fl, e.detail.rotations);
        lastCaptured = NET_FACES.map((f, fi) => ({ face: f, colors: [...fl.slice(fi * 9, fi * 9 + 9)].map((ch) => NET_FACES.indexOf(ch)) }));
        refreshCellNames();
        // The camera SAW the cube in the user's hand; nothing was inferred from anywhere else.
        //
        // Order matters: the repair reads what the cube CLAIMED, so it runs before the scan is
        // adopted as truth. With a connected smart cube this one reading does two jobs — it says
        // where the cube is, and it puts the cube's own tracking back in step for the rest of
        // this connection, with no solving involved. (Not permanently: the correction is
        // discarded on disconnect, because the cube may sleep or be turned while nobody counts.)
        const repaired = repairTracking(fl);
        const adopted = repaired?.ok !== false;
        if (!adopted) {
          // A contradiction is not a reading to adopt: one of the two is wrong and nothing can
          // tell which. Adopting it while saying "nothing was changed" would be untrue — and so
          // would an enabled Solve button over a cube the screen refused to believe.
          markStale('a scan disagreed with what the cube reports, and neither could be confirmed');
          solveBtn.disabled = true;
        } else {
          // A completed scan answers the reconnect question outright — six sides ESTABLISH what
          // two sides could only spot-check — so the question closes before the adoption that
          // would otherwise mark a cube trusted with its own question still open.
          state.reconnect = null;
          confirming = false;
          adoptCube(fl, { physical: true, source: 'camera' });
          // The moment the chain became trusted is a moment worth remembering: truth from the
          // scan, the cube's own raw claim beside it.
          if (state.connected && state.reported) rememberLastSeen('camera', { force: true });
        }
        if (repaired) {
          sayTitle.textContent = repaired.ok ? 'Tracking repaired' : 'These do not match';
          say.textContent = repaired.text;
          say.className = 'sub scan-say' + (repaired.ok ? ' ok' : ' err');
        }
        // Stay put. Jumping to another screen took the six tiles away at the moment they finally
        // mean something, and with them the chance to check the read or fix a sticker. The aside
        // shows the cube that was found, and "Solve this cube" is right beside it. Anyone who
        // wants the jump has the "Auto-solve after scan" setting, which this now actually honours
        // — and honours only for a scan that was BELIEVED: auto-solving a refused reading would
        // walk the previous cube behind a disabled Solve button.
        showState(e.detail.facelets);
        // A scan entered as a reconnect confirmation goes back to the question's screen once the
        // question is answered — "then back here" — exactly as a two-side confirmation does.
        if ((settings.autosolve || confirmEntry) && adopted) go('home');
      });
      // The detector is good, not perfect, so let a person overrule it: on a side the camera has
      // READ, click any sticker and pick the right colour. Delegated rather than 54 listeners. The
      // centre is the one sticker not offered a colour — a centre colour IS the face's identity,
      // so changing it would rename the face rather than correct it; it re-reads the side instead.
      const swatches = document.createElement('div');
      swatches.className = 'swatches';
      swatches.hidden = true;
      // Named like the app's other icon-only controls: a colour alone is not an accessible name,
      // and `title` is the weakest carrier of one.
      swatches.setAttribute('role', 'group');
      swatches.setAttribute('aria-label', 'Pick this sticker’s colour');
      root.appendChild(swatches);
      let editing = null;
      const closeSwatches = () => {
        // Hand focus back to the cell that opened the picker — but only when focus is INSIDE it
        // (the keyboard path); a pointer click elsewhere keeps the focus it just placed.
        const back = editing?.el && swatches.contains(document.activeElement) ? editing.el : null;
        swatches.hidden = true;
        editing = null;
        root.querySelector('.scan-face .cell.editing')?.classList.remove('editing');
        back?.focus();
      };
      const closePops = () => { closeSwatches(); menu.hidden = true; };
      for (const f of NET_FACES) {
        const b = document.createElement('button');
        b.type = 'button';
        b.style.backgroundColor = pal[f];
        b.title = SCAN_FACE_NAME[f];
        b.setAttribute('aria-label', `Make it the ${SCAN_FACE_NAME[f]} side’s colour`);
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
        if (!tile) return;
        // In the portrait layout a tap anywhere on a strip tile brings that side forward;
        // correcting a sticker is for the large tile, where a sticker is big enough to hit.
        if (focusLayout() && !tile.classList.contains('focus')) {
          closePops();
          setFocus(tile.dataset.face);
          ev.stopPropagation();
          return;
        }
        if (!cellEl) return;
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
        editing = { face: tile.dataset.face, index, el: cellEl };
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
        // are correcting hides the thing you need to look at. Centred on the sticker in stage
        // coordinates, and clamped so an edge tile keeps it on the stage.
        const cellRect = cellEl.getBoundingClientRect();
        const tileRect = tile.getBoundingClientRect();
        const s = stageRect();
        const w = swatches.offsetWidth;
        swatches.style.left = `${Math.min(Math.max(8, cellRect.left - s.left + cellRect.width / 2 - w / 2), s.width - w - 8)}px`;
        placePopoverV(swatches, tileRect); // below the tile, or above it when that is the room there is
        // The keyboard path continues where the pointer's does: focus lands on the colour the
        // sticker already has (or the first chip), and closeSwatches hands it back to the cell.
        (swatches.querySelector('.now') ?? swatches.firstElementChild)?.focus();
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
  // `cubeView` so they stay tunable without a rebuild — but the DEFAULTS are the tuned look, not
  // a starting point: the Restore screen's cube (ghosts floating at elevation 9, stickers
  // full-bleed at 1 — see the scan screen's mount) is the reference the walking screens must
  // match, and a wiped localStorage once reverted them to a look nobody had chosen. A tuning
  // that lives only in storage is a tuning waiting to be lost.
  const v = load('cubeView', { hintElev: 9, camLat: 35, camLon: 45, facScale: 1, ghosts: true });
  // The camera's distance is no longer a tuning: the renderer fits the picture to its slot
  // (lib/cube-frame.js) — a distance right for one slot shape clipped the ghost faces on every
  // other. A stored camDist is dropped rather than left for save() to keep rewriting.
  if ('camDist' in v) { delete v.camDist; save('cubeView', v); }
  // A scramble is always available: it is generated here rather than read off the cube, so there is
  // no state that makes this screen have nothing to do.
  const walking = scrambling || deriveCube().solvable;
  const label = scrambling ? 'Scramble' : 'Solution';
  const walked = scrambling ? 'scramble' : 'solution';
  // The open reconnect question, on the solve side only — Scramble's subject is always the
  // generated walk. The unconfirmed DRESS (the twin's heading) is worn only while the subject IS
  // the candidate; the question itself stands as long as it is open, because it is about the
  // cube, not about whatever the screen happens to show.
  const rc = scrambling ? null : state.reconnect;
  const rcDress = Boolean(rc?.candidate && state.cube.facelets === rc.candidate);
  const stateHeading = scrambling ? 'Target State'
    : !rcDress ? 'Initial State'
    : rc.reading === 'turned' ? 'Your cube — as it reports it'
    : `Your cube — as we last saw it${whenWords(rc.seenAt).full ? `, ${whenWords(rc.seenAt).full}` : ''}`;
  // The question: at the top of the sheet, ABOVE the moves, not instead of them — a disconnect or
  // a reconnect must not wipe the guide (the floor never rises), so the walk of the candidate
  // stays walkable while the answer is open, and trust gates what it gates today: Follow.
  const reconnectAsk = () => {
    if (!rc) return '';
    const when = whenWords(rc.seenAt);
    let ask = '';
    let sub = '';
    if (rc.reading === 'no-report') {
      ask = 'Your cube hasn’t said where it is.';
      sub = rc.candidate
        ? `It’s connected but hasn’t reported an arrangement — this is how we last saw it${when.full ? `, ${when.full}` : ''}.`
        : 'It’s connected but hasn’t reported an arrangement. The camera can read it as it is.';
    } else if (rc.reading === 'turned') {
      ask = `Your cube says it has been turned since${when.day ? ` ${when.day}` : ''} — is this it now?`;
    } else {
      ask = rc.candidate === SOLVED ? 'Is it solved right now?' : 'Is this your cube right now?';
      sub = `As we last saw it${when.full ? `, ${when.full}` : ''}.`;
    }
    // Yes needs a report to derive the correction from; a silent cube leaves the camera as the
    // only door. No reading grants trust — these two buttons are how the user does.
    const yes = rc.raw && rc.candidate
      ? '<button class="btn sm primary" data-reconnect="yes">Yes, that’s it</button>' : '';
    return `<div class="follow-note reconnect-ask" id="reconnectAsk" style="border-top:0">
      <b>${escHtml(ask)}</b>${sub ? `<span class="sub" style="color:var(--ink-4)">${escHtml(sub)}</span>` : ''}
      <div class="acts">${yes}<button class="btn sm outline" data-reconnect="scan">Show a side to the camera</button></div>
    </div>`;
  };
  // Saved key → renderer attribute. Named for what it is now that the sliders it fed are gone.
  const VIEW_ATTRS = [
    ['hintElev', 'ghost-elevation'],
    ['camLat', 'camera-latitude'], ['camLon', 'camera-longitude'],
    ['facScale', 'facelet-scale'],
  ];
  // Four regions of the layout contract's grid (index.html, ".cols"): the cube card is
  // `primary`, the transport card `aux`, the state card the `twin` and the solution card the
  // `sheet` — the last two are the aside's children, which the stylesheet hands to the grid
  // (display: contents) or keeps as a scrolling column, by composition. The DOM is the same
  // either way.
  return {
    html: `<div class="cols${walking ? ' walking' : ''}">
      <div class="card primary" style="display:flex;flex-direction:column;align-items:center;position:relative">
        ${walking ? `<div class="card-tools">
          <button id="speedBtn" title="Animation speed" aria-label="Animation speed">${icon('gauge', 20)}</button>
        </div>` : ''}
        <div style="flex:1;min-height:0;width:100%">
          <div class="cube-slot" id="viewCube" style="height:100%"></div>
        </div>
      </div>
      ${walking ? `<div class="card aux">
        <div class="transport">
          <button class="tbtn" id="prevBtn" title="Back a move" aria-label="Back a move">${icon('chevron-left', 20)}</button>
          <button class="tbtn" id="repeatBtn" title="Show that move again" aria-label="Show that move again">${icon('refresh', 18)}</button>
          <button class="tbtn" id="nextBtn" title="Next move" aria-label="Next move">${icon('chevron-right', 20)}</button>
          <button class="tbtn primary" id="playBtn" title="Play from here to the end" aria-label="Play from here to the end">${icon('play', 18)}</button>
          ${state.connected ? `<button class="pill${state.cube.trusted ? ' on' : ''}" data-mode="cube" title="Turn your smart cube and the guide keeps up">Follow cube</button>` : ''}
          <div class="progress" title="How far through the ${walked} you are"><span id="progBar"></span></div>
          <span class="done-mark" id="doneMark" hidden title="Done">${icon('check', 14)}</span>
          <span class="num" id="stepLbl" style="color:var(--ink-4);min-width:56px;text-align:right">0 / 0</span>
          ${scrambling ? `<button class="btn sm primary" id="solveItBtn" hidden>Solve this scramble</button>` : ''}
        </div>
      </div>` : ''}
    <div class="aside">
      <div class="card state-card twin" style="padding-bottom:0">
        <div class="eyebrow-row"><b class="state-h">${escHtml(stateHeading)}</b>
          ${scrambling || settings.devRandCube
            // On Scramble the die IS the screen's re-roll and always shows. On the solve side it
            // loads a random cube that is NOT the one in anyone's hand — a developer shortcut,
            // hidden unless the Advanced toggle asks for it.
            ? `<button id="randCube" title="${scrambling ? 'Roll a different scramble' : 'Load a random scrambled cube'}" aria-label="${scrambling ? 'Roll a different scramble' : 'Load a random scrambled cube'}">${icon('dice', 18)}</button>`
            : ''}</div>
        <!-- 30px above AND ~30px below the net in landscape (bottom = grid row gap 18 + the
             Solution header's 14px pad, with this card's own bottom padding zeroed) — the two
             breathing spaces the eye compares, made equal. The margin is the stylesheet's
             (.state-card .net): beside the cube in portrait the net centres instead. -->
        <div class="net" id="viewNet"></div></div>
      ${!walking && rc ? `<div class="card sheet reconnect-card">${reconnectAsk()}</div>` : ''}
      ${walking ? `<div class="card tight solution-card sheet">
        ${reconnectAsk()}
        <div class="card-h bare"><b id="solLabel">${label}</b><span class="sub" id="moveCount">—</span></div>
        <div class="list" id="solList" style="padding:6px 0"></div>
        <div class="sub" id="whyLine" style="padding:0 18px 10px;color:var(--ink-4)" hidden></div>
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
      // The reconnect answer, wired before any await: the solver can take seconds or fail, and
      // the question must be answerable either way.
      wireReconnectAnswers(root);
      cube.setAttribute('ghosts', v.ghosts ? 'floating' : 'none');
      for (const [k, attr] of VIEW_ATTRS) cube.setAttribute(attr, String(v[k]));

      // Who drives the guide: 'slow' = the transport buttons, 'cube' = the physical cube.
      // Declared before the speed menu because tempo DEPENDS on the driver: the walk speeds are
      // for the app demonstrating a move, but while following, the drawing is a mirror of moves
      // the user already made — a mirror slower than the hand must fall behind, so follow runs at
      // the renderer's 190ms base whatever speed is chosen for demonstrations.
      let mode = 'slow';
      let applyTempo = () => {};

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
          // The ONE place tempo is written. While the cube drives, the choice is stored but not
          // applied — it takes effect the moment the user takes over.
          cube.setAttribute('tempo-scale', String(mode === 'cube' ? 1 : chosen.tempo));
          speedBtn.title = `Animation speed — ${chosen.label}`;
          speedBtn.setAttribute('aria-label', speedBtn.title);
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
        applyTempo = applySpeed;

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
      if ($('#randCube', root)) $('#randCube', root).onclick = async () => {
        if (!solverReady) return;
        // Re-entering is what rolls a new one: the moves, the chips and the step count are all
        // built at mount, so repainting in place would leave a new cube wearing the old list.
        if (scrambling) { go('scramble'); return; }
        // Known by construction, and NOT the cube in your hand. Marking this 'camera' was the bug
        // behind a solved physical cube instantly completing a random solve: the guide accepted
        // the real cube's snapshots as progress through an arrangement it had never been in.
        adoptCube((await randomScramble()).facelets, { physical: false, source: 'generated' });
        go('home');
      };

      liveUpdate = (f) => {
        // Walking screens install their own handler further down (the follow machinery); until it
        // lands — and on the failure path where it never does — snapshots must not repaint the
        // net either: its label names a fixed reference state.
        if (walking) return;
        // The picture is the SUBJECT. Live reports repaint it only when the subject IS the
        // physical cube — with a generated or unreadable subject on screen, painting the
        // connected cube over it would show one cube while every label describes another.
        if (!state.cube.isPhysical) return;
        paintNet(f);
        cube.setAttribute('facelets', f);
      };

      if (!walking) return;

      const solList = $('#solList', root);
      const setStatus = (msg) => { $('#moveCount', root).textContent = msg; };
      setStatus('working…');
      let setup, alg, moves, steps = [], target = null;
      try {
        if (scrambling) {
          if (!solverReady && !(await loadSolver())) throw new Error('solver unavailable');
          // randomScramble() returns the state it lands on and the alg that gets there from
          // solved, as one self-consistent pair. That alg is what we walk, so `setup` stays
          // empty and the cube starts solved. `target` outlives this block: it is what "Solve
          // this scramble" hands to Home at the end of the walk.
          const scramble = await randomScramble();
          target = scramble.facelets;
          if (!target || !scramble.alg) throw new Error('no scramble');
          setup = ''; alg = scramble.alg; moves = movesOf(alg);
          // Per-step states for Follow cube, built the same way the solve path builds its own.
          const b = Cube.fromString(SOLVED);
          steps = [b.asString()];
          for (const m of moves) { b.move(m); steps.push(b.asString()); }
          paintNet(target);
        } else {
          if (!solverReady && !(await loadSolver())) throw new Error('solver unavailable');
          // Each improvement lands on the heading as it is found, so a tight tier shows 21
          // becoming 20 becoming 19 rather than nothing at all.
          await solve({ onImprovement: (step) => { if (!stale()) setStatus(String(step.moves)); } });
          setup = state.cube.setupAlg; alg = state.cube.solution; moves = state.cube.moves;
          // Snapshotted: setFacelets() clears stepFacelets on every live update, and following a
          // physical cube needs the states to compare against to outlive the next turn.
          steps = state.cube.stepFacelets.slice();
        }
      } catch { if (!stale()) setStatus('could not work it out'); return; }
      if (stale()) return; // navigated away while solving — leave the new screen alone
      const total = moves.length;
      cube.setAttribute('scramble', setup ?? ''); cube.removeAttribute('facelets'); cube.setAttribute('alg', alg);
      // A lesson and a shortest solution are different objects and must not be presented as
      // one. Both used to read "Solution" with a number beside it, so a 93-move lesson looked
      // exactly like a solver that had broken — which is what it was taken for.
      const lesson = state.cube.methodSteps;
      const solLabel = $('#solLabel', root);
      if (solLabel) solLabel.textContent = lesson ? 'Lesson' : label;
      const verdict = state.cube.solveResult;
      if (lesson) {
        // Moves FIRST, because that is the number the old count was and the only one a
        // learner can compare. Leading with steps put a "20" exactly where twenty MOVES used to
        // be printed, which read as the same solution rather than a different, longer one.
        setStatus(`${total} moves · ${lesson.length} steps`);
      } else {
        // Just the number, unless the tier asked for something this cube cannot give. Eighteen
        // moves do not exist for every position, so that case is said plainly rather than left
        // to look like the target was met — but only when the search actually EXHAUSTED.
        // A stopped search proved nothing impossible and must not claim it did.
        setStatus(verdict && verdict.key === 'solve.targetMissed' && verdict.stopped === 'exhausted'
          ? `${total} — ${verdict.target} was not possible here`
          : String(total));
      }
      // One grid, no group headings, on both sides of the walk. The solve side used to cut its
      // list at fixed 16 / 62 / 82% and head the pieces CROSS / F2L / OLL / PLL — proportional
      // slices of a two-phase solution wearing the names of stages it does not have. That is
      // invented structure on the screen a beginner trusts most, and a heading per group is what
      // put the tail of a 20-move solve past the sheet's foot in portrait. The card header already
      // says what the chips are and how many.
      solList.innerHTML = `<div style="padding:6px 18px 12px"><div class="move-chips">${moves.map((m, k) => `<button class="chip-m" data-i="${k}" title="Jump to this move">${m}</button>`).join('')}</div></div>`;
      const chips = [...solList.querySelectorAll('.chip-m')];

      // ---- Scramble → Solve hand-off ---------------------------------------------------------
      // The loop a beginner actually wants: scramble it by following the guide, then solve THAT.
      // Offered at completion and only on a press — never automatic. Reaching 22/22 by clicking
      // says nothing about the cube in someone's hand, so without a trusted cube the target is
      // adopted as a GENERATED subject (exactly what the dev die does) and Home says so. With a
      // trusted physical cube the subject already IS the cube (its snapshots are ingested), so
      // nothing is adopted: Home solves whatever the cube really is, and the label only claims
      // "scrambled" when the cube's own state says so.
      const solveIt = $('#solveItBtn', root);
      const cubeTruth = () => state.connected && state.cube.trusted && state.cube.isPhysical;
      const solveItLabel = () => {
        if (!cubeTruth()) return 'Solve this scramble';
        return state.cube.facelets === target ? 'Your cube is scrambled — solve it' : 'Solve your cube';
      };
      if (solveIt) {
        solveIt.onclick = () => {
          if (!cubeTruth()) adoptCube(target, { physical: false, source: 'generated' });
          go('home');
        };
      }

      // The reason for the step you are ON. One line, updated as you walk — at 0 it reads the
      // first step, because that is the one about to happen. Silent entirely when the explaining
      // solver is off, since a two-phase solution has no steps and inventing captions for it is
      // exactly what this app does not do.
      const whyLine = $('#whyLine', root);
      function sayWhy(i) {
        if (!whyLine) return;
        const steps = state.cube.methodSteps;
        const map = state.cube.moveStep;
        if (!steps || !map || scrambling) { whyLine.hidden = true; return; }
        const step = steps[map[Math.min(Math.max(i - 1, 0), map.length - 1)]];
        const text = whyText(step);
        whyLine.hidden = !text;
        whyLine.textContent = text ? `Step ${(steps.indexOf(step) + 1)} of ${steps.length} — ${text}` : '';
      }

      let at = 0;
      function sync(i) {
        at = i;
        // The filled chip is the move just shown — the one you are on. At 0 / 22 nothing has been
        // shown, so nothing is filled. It used to mark the NEXT move, and a black first chip before
        // anything had happened read as a step already taken.
        chips.forEach((ch, k) => { ch.classList.toggle('played', k < i); ch.classList.toggle('cur', k === i - 1); });
        sayWhy(i);
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
        // And, on Scramble, the way onward — labelled for what is actually known at that moment.
        if (solveIt) {
          solveIt.hidden = i < total;
          if (i >= total) solveIt.textContent = solveItLabel();
        }
      }
      cube.addEventListener('cubus-step', (e) => sync(e.detail.index));

      let playing = false;
      const setPlaying = (on) => {
        playing = on;
        const play = $('#playBtn', root);
        play.innerHTML = icon(on ? 'pause' : 'play', 18);
        // The name follows the action: a button drawn as Pause while announcing "Play from here
        // to the end" claims the wrong deed.
        play.title = on ? 'Pause' : 'Play from here to the end';
        play.setAttribute('aria-label', play.title);
        // Guarded like drawTo below: if the renderer bundle failed to upgrade the element, the
        // transport still works as position bookkeeping even though nothing animates.
        if (typeof cube.play !== 'function' || typeof cube.pause !== 'function') return;
        if (on) cube.play(); else cube.pause();
      };

      // Touching the transport hands control back to you. Following and the buttons were two
      // drivers for one guide, and while both were live the step counter tracked the ANIMATION
      // rather than the cube. One rule removes the ambiguity — the toggle is right there to
      // resume. Hoisted, because the handlers below call it while `followBtn` and the note
      // helpers are declared further down.
      function takeOver() {
        if (mode !== 'cube') return;
        setFollow(false);
        pauseNote();
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

      // ---- Follow cube -----------------------------------------------------------------------
      //
      // The physical cube drives the guide through ONE local model matched by STATE, never by
      // move token: the driver emits quarter turns only, while the plan is full of half turns —
      // tokens can never pair those up, states always can. Position, drawing and the note are
      // three views of that model. Full design, and the adversarial review that shaped it, in
      // dev-docs/follow-mode-redesign.md.
      //
      // One pacing control, and only when there is a cube to pace against: with nothing connected,
      // walking by hand is the only behaviour there is, so a button naming it would be a switch
      // with one position. Connected, following is what you want by default — a single toggle
      // that starts on, provided the preconditions hold.
      const followBtn = root.querySelector('[data-mode="cube"]');
      const note = $('#followNote', root), noteMsg = $('#followMsg', root);
      const showNote = (msg) => {
        if (note) { note.hidden = false; note.classList.remove('info'); noteMsg.textContent = msg; }
      };
      // Neutral, not a warning, and without the rescue buttons: pausing is a choice, not a fault.
      const pauseNote = () => {
        if (note) { note.hidden = false; note.classList.add('info'); noteMsg.textContent = 'Paused following — you are driving. Click Follow and your cube leads again.'; }
      };
      const clearNote = () => {
        if (note) { note.hidden = true; note.classList.remove('info'); }
      };

      // Where the PHYSICAL cube is, in solution indices. The model beneath it tracks in EVERY
      // mode — only drawing and notes are gated on `mode` — so resuming follow needs no special
      // case: the position is simply already right.
      let cubePos = 0;
      let liveModel = null; // cubejs cube in truth frame; seeded below, resynced by every snapshot
      let drawn = 0;        // index the renderer's QUEUE will end at; meaningful only while following
      let lastSerial = null;

      // For each half-turn step i, the two states one quarter turn in: the cube passes through
      // one of them mid-R2 in either direction (undoing is steps[i]·R2·R = steps[i]·R'). Owner-
      // indexed, because a midpoint only counts BESIDE its own half turn — landing on a distant
      // one is a wrong move, not silent progress.
      const midpoints = new Map();
      // Built only from a COMPLETE step array: with steps short (the case refuseFollow answers
      // below), steps[i] is undefined for the tail and fromString(undefined) throws — which
      // turned "follow is refused" into "the whole screen fails to mount".
      if (steps.length === total + 1) {
        for (let i = 0; i < moves.length; i++) {
          if (!moves[i].endsWith('2')) continue;
          for (const q of [moves[i][0], `${moves[i][0]}'`]) {
            const c = Cube.fromString(steps[i]); c.move(q);
            const s = c.asString();
            if (!midpoints.has(s)) midpoints.set(s, []);
            midpoints.get(s).push(i);
          }
        }
      }

      /** Where is this state on the plan? Locality first: the near window resolves a repeated
       *  state toward where the cube actually is, and is also the cheap path. */
      const locate = (f) => {
        for (let d = 0; d <= 2; d++) {
          for (const idx of d === 0 ? [cubePos] : [cubePos - d, cubePos + d]) {
            if (idx >= 0 && idx < steps.length && steps[idx] === f) return { kind: 'step', idx };
          }
        }
        if (midpoints.get(f)?.some((i) => i === cubePos || i === cubePos - 1)) return { kind: 'mid' };
        const idx = steps.indexOf(f);
        return idx >= 0 ? { kind: 'step', idx } : { kind: 'off' };
      };

      /** Move the drawing toward where the cube is. Deltas are against `drawn` — the end of the
       *  renderer's QUEUE — never against the animation's progress: reading the completion index
       *  dropped any turn made inside the 0.19–3.8s animation window, permanently.
       *
       *  The renderer guard is not belt-and-braces: if the vendored bundle failed to upgrade the
       *  element — which this repo has shipped more than once — the guide still tracks turns
       *  rather than throwing on every one. */
      const drawTo = (idx) => {
        if (typeof cube.step !== 'function' || typeof cube.seek !== 'function') return;
        if (idx === drawn) return;
        if (idx > drawn && idx - drawn <= 2) { for (let i = drawn; i < idx; i++) cube.step(); }
        else if (idx === drawn - 1) cube.stepBack(); // an undo is a turn worth watching too
        else cube.seek(idx); // a jump: animating a dozen moves to catch up helps nobody
        drawn = idx;
      };

      /** ONE reaction to every accepted reading, move or snapshot. */
      const act = (loc, offMsg) => {
        if (loc.kind === 'step') {
          cubePos = loc.idx;
          if (mode === 'cube') { clearNote(); drawTo(cubePos); }
        } else if (loc.kind === 'mid') {
          if (mode === 'cube') clearNote(); // half a half-turn: legal, silent, position held
        } else if (mode === 'cube') {
          showNote(offMsg);
        }
      };

      /** The FIFO tripwire. Moves and snapshots ride one ordered channel and share one counter;
       *  a regression means that assumption broke, which deserves a loud word — placed AFTER
       *  act() by every caller, so the warning is not painted over by the event it arrived on. */
      const tripwire = (serial) => {
        if (!Number.isInteger(serial)) return;
        // Repeats are normal — a resting cube re-sends snapshots under one counter, and a
        // FACELETS packet shares its move's serial. Only a REGRESSION is a breach, and a breach
        // is a trust matter, not just a note: the stream this model is built on is unreliable,
        // so trust lapses (which stands follow down through the hook) and the screen says why.
        if (lastSerial !== null && (serial - lastSerial + 256) % 256 > 127) {
          console.warn('cube events arrived out of order', { lastSerial, serial });
          showNote('The cube’s reports arrived out of order — read it again before following.');
          markStale('its reports arrived out of order');
        }
        lastSerial = serial;
      };

      /** ONE owner for the driver switch: tempo, button paint and the atomic hand-over all live
       *  here, so no exit path can leak follow's tempo into a demonstration or leave the queue
       *  running under the wrong driver. BOTH directions seek: taking over collapses follow's
       *  queue debt and its in-flight animation; resuming re-bases `drawn` on wherever the cube
       *  is now — which is what makes `drawn` trustworthy within a follow session. */
      function setFollow(on) {
        const want = on ? 'cube' : 'slow';
        if (mode === want) return;
        mode = want;
        if (typeof cube.seek === 'function') cube.seek(cubePos);
        drawn = cubePos;
        applyTempo();
        followBtn?.classList.toggle('on', on);
        if (followBtn) {
          followBtn.title = on
            ? 'Turn your smart cube and the guide keeps up'
            : 'You took over — click to let the cube drive again';
        }
        if (on) {
          setPlaying(false);
          // Say at once whether the cube is still on the plan, rather than waiting up to a
          // second for its next report to say it.
          if (liveModel) act(locate(liveModel.asString()), 'This cube is not on the plan any more.');
          else clearNote();
        }
      }

      const refuseFollow = (why) => {
        if (!followBtn) return;
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
          liveModel = Cube.fromString(state.live);
          setFollow(true);
        }
        followBtn.onclick = () => {
          if (followBtn.disabled) return;
          setFollow(mode !== 'cube');
        };
      }

      liveMove = (m) => {
        if (!liveModel) return; // nothing to track against until a first reading seeds the model
        liveModel.move(m.notation);
        act(locate(liveModel.asString()), `That was ${m.notation} — the next move is ${moves[cubePos] ?? '—'}.`);
        tripwire(m.serial);
      };

      // Snapshots are authoritative: they share the moves' FIFO channel, so every one delivered
      // is current, and the model resyncs from it unconditionally — that IS the drift correction,
      // including after a lost move packet. The 2D net is never repainted here: its card says
      // INITIAL STATE (or TARGET STATE), and a label naming a fixed reference must not sit over a
      // moving picture — what the cube does live is the 3D cube's and the transport's story.
      liveUpdate = (f, serial) => {
        liveModel = Cube.fromString(f);
        act(locate(f), 'This cube is not on the plan any more.');
        tripwire(serial);
      };

      // Trust has already lapsed by the time this runs — onGap() owns that, with or without a
      // screen mounted to hear it — and the trust hook below has stood follow down. What is left
      // is this screen's own account of what happened.
      liveGap = (g) => {
        // The shutdown itself is NOT repeated here: onGap marks trust stale first, and the trust
        // hook below owns standing follow down. What this adds is the gap-specific account.
        // Disabled, not merely un-highlighted: following matches your turns against an
        // arrangement we have just said we cannot vouch for.
        refuseFollow('Your cube missed a turn — read it again before following');
        // The cube numbers its moves, and the driver says so when the count skips. Silence here
        // would look exactly like a wrong turn; it is neither, and the snapshot will resync.
        showNote(`Missed ${g.missing} turn${g.missing === 1 ? '' : 's'} — checking the cube…`);
      };

      // Any loss of trust while walking — a gap, a disconnect, a report that failed validation —
      // stands follow down the moment it happens, not at the next mount.
      onTrustLost = () => {
        setFollow(false);
        refuseFollow(`Read the cube first — ${state.cube.staleWhy || 'its position is unverified'}`);
      };

      $('#resolveBtn', root).onclick = () => {
        // Re-solve starts from the cube as it IS. The model can be ahead of the last adopted
        // snapshot by whatever was turned in the past second — remounting from the stale global
        // would build a walk for a cube that no longer exists.
        if (liveModel && state.cube.trusted) {
          const f = liveModel.asString();
          if (f !== state.cube.facelets) adoptCube(f, { physical: true, source: 'cube' });
          // `live` too, or the next mount's "starts where the cube is" precondition compares the
          // fresh walk against a snapshot from before those turns and refuses to follow — for
          // the whole visit, since the precondition runs once. The model IS the corrected
          // report stream carried forward, so this stays true to what `live` means; `reported`
          // (the raw stream) is deliberately untouched.
          state.live = f;
        }
        // Scramble ignores the subject — it always walks from solved — so "Re-solve this cube"
        // must go where the cube in hand is actually solved from: the solve walk on Home.
        go(scrambling ? 'home' : state.screen);
      };
      $('#turnBackBtn', root).onclick = () => {
        // Acknowledging is not the same as the cube being back: hiding the warning here would
        // silently accept an off-plan cube if no further report arrived. The note stays, saying
        // what is being waited for — only act() clears it, on an actually on-plan reading.
        if (note && !note.hidden) noteMsg.textContent = 'Watching for it — turn it back and the guide picks up.';
      };

      sync(0);
    },
  };
};

// Home is the cube. There is no separate "3D viewer" entry any more: it was the same screen
// reached by a second name, and the app's front door is the thing it is for.
SCREENS.home = () => cubeScreen('solve');
SCREENS.scramble = () => cubeScreen('scramble');

SCREENS.timer = () => {
  // width:100% — the screen centres its child, and a column without a width would shrink to
  // its content. The clock's size and the wrapping rows are classes (index.html).
  return { html: `<div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px">
      <div class="num" id="scr" style="font-size:var(--fs-body-l);color:var(--ink-4);text-align:center;max-width:640px">press New scramble</div>
      <div class="num timer-clock" id="clock">0.00</div>
      <div class="sub" id="timerHint" style="color:var(--ink-4)">Click or hold space to start</div>
      <div class="wrap-row" style="justify-content:center;gap:10px"><button class="btn outline sm" id="newScr">New scramble</button>
        <span class="pill">WCA scrambles</span></div>
      <div class="wrap-row" style="justify-content:center;gap:12px;margin-top:6px" id="lastFive"></div></div>`,
    mount(root) {
      const clock = $('#clock', root); let running = false, t0 = 0, raf = 0;
      const fmt = (ms) => (ms / 1000).toFixed(2);
      const tick = () => { if (!running) return; clock.textContent = fmt(performance.now() - t0); raf = requestAnimationFrame(tick); };
      const hint = $('#timerHint', root);
      const MANUAL = 'Click or hold space to start';
      const say = (text) => { if (hint) hint.textContent = text; };

      const newScr = async () => {
        if (!solverReady) {
          $('#scr', root).textContent = 'solver loading…';
          // Retry when it lands. Without this, opening Timer before the solver finished left
          // "solver loading…" on screen permanently — the only way out was pressing New scramble
          // again, which nothing on the screen suggested.
          void loadSolver().then((ok) => { if (ok && state.screen === 'timer' && root.isConnected) void newScr(); });
          return;
        }
        // The solver runs in a worker now, so this is a round trip. Nothing else on the screen
        // depends on it, and a failure must not leave the old scramble looking like the new one.
        try {
          const { alg } = await randomScramble();
          if (root.isConnected) $('#scr', root).textContent = alg || '—';
        } catch (err) {
          console.error('scramble failed', err);
          if (root.isConnected) $('#scr', root).textContent = 'could not make a scramble';
        }
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
      renderLast(); void newScr();
    },
  };
};

SCREENS.settings = () => {
  const pals = ['muted', 'classic', 'colorsafe'];
  // No WCA-inspection toggle: it flipped a label and nothing else — the timer never implemented
  // the 15s countdown it named. A setting that claims behaviour it does not have is exactly the
  // invented data this app refuses elsewhere; it returns when the Timer actually earns it.
  const toggles = [['autosolve', 'Auto-solve after scan', 'Jump straight to the guide']];
  // The window's orientation is the desktop's to choose (dev-docs/stage-contract.md, decision
  // 4): a fixed window that can be either shape. The row exists only where there is a window to
  // shape — the Tauri API on a desktop platform. A phone or tablet rotates in the hand, and the
  // browser harness has no window. The Rust side (set_orientation) re-sizes, re-centres and
  // remembers; this is the third capability seam AGENTS.md lists.
  const desktopWindow = isTauri && ['macos', 'windows', 'linux'].includes(document.documentElement.dataset.platform);
  // `flow`: a list screen — in portrait the box scrolls as one (index.html, .cols.flow).
  return { html: `<div class="cols flow">
    <div class="col">
      <div class="card"><div class="eyebrow">APPEARANCE</div>
        <div class="wrap-row" style="justify-content:space-between;padding:12px 0"><div><div style="font-weight:600">Theme</div><div class="sub" style="color:var(--ink-4)">White, cream or night — auto follows the system</div></div>
          <div class="wrap-row" style="gap:6px">${THEMES.map((t) => `<button class="pill ${settings.theme === t ? 'on' : ''}" data-set-theme="${t}">${t}</button>`).join('')}</div></div>
        <div style="display:flex;align-items:center;gap:16px;padding:13px 0 0;border-top:1px solid var(--line-faint)">
          <div style="flex:1"><div style="font-weight:600">Rotate the cube by dragging</div><div class="sub" style="color:var(--ink-4)">Off, the 3D cube keeps the angle its ghost faces are set up for</div></div>
          <button class="toggle ${settings.dragRotate ? 'on' : ''}" data-toggle="dragRotate" role="switch" aria-checked="${Boolean(settings.dragRotate)}" aria-label="Rotate the cube by dragging"><i></i></button></div>
        <div class="wrap-row" style="justify-content:space-between;padding:13px 0 0;border-top:1px solid var(--line-faint)"><div><div style="font-weight:600">How short a solution</div><div class="sub" style="color:var(--ink-4)">${TIER_BLURB[settings.solveTier] ?? TIER_BLURB.twenty}</div></div>
          <div class="wrap-row" style="gap:6px">${TIERS.map((t) => `<button class="pill ${settings.solveTier === t.name ? 'on' : ''}" data-set-tier="${t.name}">${TIER_LABEL[t.name]}</button>`).join('')}</div></div>
        <div class="wrap-row" style="justify-content:space-between;padding:13px 0 0;border-top:1px solid var(--line-faint)"><div><div style="font-weight:600">Explain each step</div><div class="sub" style="color:var(--ink-4)">${TEACH_BLURB[settings.teachLevel] ?? TEACH_BLURB.off}</div></div>
          <div class="wrap-row" style="gap:6px">${TEACH_LEVELS.map((t) => `<button class="pill ${settings.teachLevel === t ? 'on' : ''}" data-set-teach="${t}">${TEACH_LABEL[t]}</button>`).join('')}</div></div>
        ${desktopWindow ? `<div class="wrap-row" style="justify-content:space-between;padding:12px 0"><div><div style="font-weight:600">Window</div><div class="sub" style="color:var(--ink-4)">Landscape or portrait — the window takes the shape and keeps it</div></div>
          <div class="wrap-row" style="gap:6px" id="orientationPills">${['landscape', 'portrait'].map((o) => `<button class="pill" data-set-orientation="${o}">${o}</button>`).join('')}</div></div>` : ''}</div>
      ${(() => {
        // ---- smart cube (recovered from v0) --------------------------------------------------
        const on = state.connected;
        // The open reconnect question. While it stands, the card is a STATUS ROW — the net of
        // the remembered arrangement (the same buildNet component Home paints, so the two
        // screens cannot disagree), the reading's words, the trust badge, and the same two
        // actions Home offers. The three-step checklist folds into it: "Is it solved right now?"
        // is this question in the case where the candidate is solved.
        const rc = on ? state.reconnect : null;
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
        // The reading's words, compact: what is remembered, and what the evidence says about it.
        // Words and a picture only — no reading grants trust; the buttons below are how the user
        // does, and the answer is about the STATE, never the identity (design §0).
        const reconnectRow = () => {
          if (!rc) return '';
          const when = whenWords(rc.seenAt);
          const seen = when.full ? `last seen ${when.full} · ` : '';
          const words = rc.reading === 'no-report' ? `${seen}hasn’t said where it is`
            : rc.reading === 'turned' ? `${seen}turned since, or lost count`
            : `${seen}no turns recorded since`;
          const ask = rc.reading === 'no-report' ? 'Your cube hasn’t said where it is.'
            : rc.candidate === SOLVED ? 'Is it solved right now?' : 'Is this your cube right now?';
          return `<div style="padding:10px 0 4px;border-top:1px solid var(--line-faint)">
            <div class="eyebrow">AS WE REMEMBER IT</div>
            ${rc.candidate ? `<div class="net" id="settingsNet" style="max-width:240px;margin:12px auto"></div>` : ''}
            <div class="sub" style="color:var(--ink-4)">${escHtml(words)}</div>
            <div style="display:flex;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap">
              <span class="pill" id="reconnectBadge" style="color:var(--warn);border-color:var(--warn)">position unverified</span>
              <b style="flex:1;font-size:var(--fs-body-s)">${escHtml(ask)}</b>
            </div>
            <div style="display:flex;gap:8px;margin-top:10px">
              ${rc.raw && rc.candidate ? '<button class="btn sm primary" data-reconnect="yes">Yes, that’s it</button>' : ''}
              <button class="btn sm outline" data-reconnect="scan">Show a side to the camera</button>
            </div>
          </div>`;
        };
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
        ${registryWriteBad ? `<div id="registryWriteWarn" style="display:flex;gap:8px;padding:0 0 12px;color:var(--err);font-size:var(--fs-body-s)">
          <span>This browser is refusing to store what cubus learns about this cube — its memory of it will not survive a reload, so the next reconnect will greet it as a stranger.</span>
        </div>` : ''}
        ${on && state.cube.offset ? `<div style="display:flex;align-items:center;gap:10px;padding:12px 0;border-top:1px solid var(--line-faint)">
          <span class="ico" style="color:var(--ok);flex:none">${icon('check', 16)}</span>
          <div style="flex:1">
            <div style="font-weight:600">Tracking corrected</div>
            <div class="sub" style="color:var(--ink-4)">${state.cube.offsetFrom === 'confirmed'
              ? `You confirmed this cube's arrangement at ${escHtml(hhmm(state.cube.offsetAt))}, and every reading since is corrected by that answer. If the picture you confirmed was wrong, so is everything built on it.`
              : `A camera scan at ${escHtml(hhmm(state.cube.offsetAt))} put this cube back in step after it lost count, and every reading since is corrected by it. If that scan was wrong, so is everything built on it.`}</div>
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
        ${rc ? reconnectRow() : steps.every((_, i) => done(i)) ? '' : steps.map(([st, sub], i) => `<div style="display:flex;gap:12px;align-items:center;padding:10px 0;border-top:1px solid var(--line-faint)">
          <div class="num" style="width:22px;height:22px;flex:none;border-radius:50%;border:1.5px solid ${done(i) ? 'var(--ok)' : 'var(--line)'};display:grid;place-items:center;font-size:var(--fs-meta);color:${done(i) ? 'var(--ok)' : 'var(--ink-5)'}">${done(i) ? '✓' : i + 1}</div>
          <div style="flex:1"><div style="font-weight:600">${st}</div><div class="sub" style="color:var(--ink-4)">${sub}</div></div>
          ${i === 2 && on ? `<button class="btn sm outline" id="anchorNoBtn" style="flex:none" title="The camera reads it exactly as it is — no need to solve it first">Not solved</button>
          <button class="btn sm primary" id="anchorBtn" style="flex:none">${state.anchored ? 'Re-mark solved' : "It's solved"}</button>
          <button class="btn sm" id="anchorForceBtn" hidden style="flex:none;border:1px solid var(--warn);color:var(--warn)">It is solved — anchor anyway</button>` : ''}
        </div>`).join('')}
        ${on && !rc && steps.every((_, i) => done(i)) ? `<div style="display:flex;align-items:center;gap:8px;padding:10px 0;border-top:1px solid var(--line-faint);color:var(--ok);font-size:var(--fs-body-s)">
          ${icon('check', 15)}<span style="flex:1">Set up and tracking.</span>
          <button class="btn sm outline" id="anchorBtn" aria-label="Re-mark this cube as solved">Re-mark solved</button>
        </div>` : ''}
      </div>`; })()}
      <div class="card"><div class="eyebrow">CAMERA</div>
        ${toggles.map(([k, lbl, sub]) => `<div style="display:flex;align-items:center;gap:16px;padding:13px 0;border-bottom:1px solid var(--line-faint)">
          <div style="flex:1"><div style="font-weight:600">${t(lbl)}</div><div class="sub" style="color:var(--ink-4)">${t(sub)}</div></div>
          <button class="toggle ${settings[k] ? 'on' : ''}" data-toggle="${k}" role="switch" aria-checked="${Boolean(settings[k])}" aria-label="${t(lbl)}"><i></i></button></div>`).join('')}</div>
    </div>
    <div class="aside">
      <div class="card"><div class="eyebrow">CUBE COLOURS</div>
        <div style="display:flex;gap:6px;margin-top:12px" id="palSwatch"></div>
        <div style="display:flex;gap:6px;margin-top:12px">${pals.map((p) => `<button class="pill ${settings.palette === p ? 'on' : ''}" data-pal="${p}" style="flex:1;justify-content:center">${p}</button>`).join('')}</div></div>
      ${advancedOpen ? `<div class="card"><div class="eyebrow">ADVANCED</div>
        <div class="sub" style="color:var(--ink-4);margin-top:6px;line-height:1.5">Toolbar tabs. Hiding one only takes it out of the row — its address still works.</div>
        ${HIDEABLE.map(([id, lbl]) => `<div style="display:flex;align-items:center;gap:16px;padding:13px 0;border-bottom:1px solid var(--line-faint)">
          <div style="flex:1"><div style="font-weight:600">${lbl}</div><div class="sub" style="color:var(--ink-4)">${navHidden(id) ? 'Hidden from the toolbar' : 'Shown in the toolbar'}</div></div>
          <button class="toggle ${navHidden(id) ? '' : 'on'}" data-nav-toggle="${id}" role="switch" aria-checked="${!navHidden(id)}" aria-label="Show ${lbl} in the toolbar"><i></i></button></div>`).join('')}
        <div style="display:flex;align-items:center;gap:16px;padding:13px 0;border-bottom:1px solid var(--line-faint)">
          <div style="flex:1"><div style="font-weight:600">Random-cube die</div><div class="sub" style="color:var(--ink-4)">Shows the die on the solve screen that loads a random scrambled cube — a developer shortcut, since that cube is not the one in anyone's hand. Scramble keeps its own die regardless.</div></div>
          <button class="toggle ${settings.devRandCube ? 'on' : ''}" data-toggle="devRandCube" role="switch" aria-checked="${Boolean(settings.devRandCube)}" aria-label="Random-cube die"><i></i></button></div>
        <div class="sub" style="color:var(--ink-5);margin-top:12px">⌃⌥⌘D hides this section again.</div></div>` : ''}
      <div class="card"><div class="eyebrow">ABOUT</div>
        <div class="about-brand"><img src="./icons/icon.svg" alt="" width="22" height="22" /><b>Cubus</b></div>
        <div class="about-row">${icon('tag', 15)}<span class="k">${t('Version')}</span><span class="num">${VERSION}</span></div>
        <div class="about-row">${icon('globe', 15)}<span class="k">${t('Website')}</span><a class="link" href="https://cubus.im" target="_blank" rel="noopener">cubus.im</a></div>
        <div class="about-row">${icon('user', 15)}<span class="k">${t('Author')}</span><a class="link" href="https://lixiaolai.com" target="_blank" rel="noopener">@xiaolai</a></div>
        <div class="sub" style="color:var(--ink-3);margin-top:10px;line-height:1.55">${t('Solver and vision run locally. Nothing leaves the device.')}</div></div>
    </div></div>`,
    mount(root) {
      const swatch = () => { const p = NET_COLORS[settings.palette]; $('#palSwatch', root).innerHTML = ['U', 'D', 'R', 'L', 'F', 'B'].map((k) => `<div style="flex:1;height:34px;border-radius:var(--r-2);background:${p[k]}"></div>`).join(''); };
      swatch();
      for (const b of root.querySelectorAll('[data-set-theme]')) b.onclick = () => { settings.theme = b.dataset.setTheme; save('cubusSettings', settings); applyTheme(); renderScreen(); };
      // Changing the target does not re-solve anything now — the next solve uses it. Clearing
      // the cached solution is what makes that true; without it the old answer would stand.
      for (const b of root.querySelectorAll('[data-set-tier]')) b.onclick = () => { settings.solveTier = b.dataset.setTier; save('cubusSettings', settings); state.cube.solution = ''; state.cube.solveResult = null; renderScreen(); };
      for (const b of root.querySelectorAll('[data-set-teach]')) b.onclick = () => { settings.teachLevel = b.dataset.setTeach; save('cubusSettings', settings); state.cube.solution = ''; state.cube.solveResult = null; state.cube.methodSteps = null; state.cube.moveStep = null; renderScreen(); };
      // The window's orientation lives on the Rust side (a file the window is built from before
      // this webview exists), so the pills ask it which is current, and tell it which to become.
      // A failure surfaces on the pills themselves rather than in a console nobody reads.
      const orientationPills = $('#orientationPills', root);
      if (orientationPills) {
        const invoke = window.__TAURI__?.core?.invoke;
        const mark = (current) => { for (const b of orientationPills.querySelectorAll('[data-set-orientation]')) b.classList.toggle('on', b.dataset.setOrientation === current); };
        const fail = (e) => { orientationPills.title = String(e); orientationPills.style.color = 'var(--err)'; console.error('window orientation', e); };
        if (typeof invoke !== 'function') fail('the Tauri API is not exposed');
        else {
          invoke('get_orientation').then(mark, fail);
          for (const b of orientationPills.querySelectorAll('[data-set-orientation]')) {
            b.onclick = () => invoke('set_orientation', { orientation: b.dataset.setOrientation }).then(mark, fail);
          }
        }
      }
      for (const b of root.querySelectorAll('[data-pal]')) b.onclick = () => { settings.palette = b.dataset.pal; save('cubusSettings', settings); applyNetColors(); renderScreen(); };
      for (const b of root.querySelectorAll('[data-toggle]')) b.onclick = () => { const k = b.dataset.toggle; settings[k] = !settings[k]; save('cubusSettings', settings); b.classList.toggle('on', settings[k]); b.setAttribute('aria-checked', String(Boolean(settings[k]))); };

      // ---- smart cube (recovered from v0) --------------------------------------------------
      // Resolved against the document, not the captured root: anything that re-renders Settings
      // between an action starting and finishing would otherwise leave the result written into a
      // detached node — visible to no one, indistinguishable from the action doing nothing.
      const say = (text, colour) => { const m = $('#pairMsg'); if (m) { m.style.color = colour; m.textContent = text; } };
      const pairBtn = $('#pairBtn', root);

      // A repaint deferred because a nickname or address was mid-typing flushes when the typing
      // stops — deferred is not dropped. The timeout lets focus land on its next element first,
      // so tabbing between the two inputs does not flush (and discard) between them.
      root.addEventListener('focusout', () => {
        setTimeout(() => { if (settingsRepaintPending) repaintSettings(); }, 0);
      });

      // ONE connect flow for the Pair button and every remembered-cube Use button: same pending
      // message idiom, same error surfacing. Two copies of it had already started to drift.
      const connectFromSettings = async (mac, pending) => {
        say(pending, 'var(--ink-4)');
        try { await doConnect(mac); } catch (e) { say(String(e.message || e), 'var(--err)'); }
      };

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
        await connectFromSettings($('#macIn', root)?.value, isTauri ? 'scanning…' : 'pick your cube in the browser prompt');
      };

      // Resetting the correction does NOT restore trust — it removes the only thing that was
      // making the cube's readings true, and says so.
      $('#offsetReset', root)?.addEventListener('click', () => {
        clearOffset();
        markStale('its correction was reset, so its position is unverified again');
        renderScreen();
      });

      // The remembered arrangement's net — the SAME buildNet component Home's twin is, painted
      // from the same candidate, so the two screens cannot disagree about what is remembered.
      const settingsNet = $('#settingsNet', root);
      if (settingsNet && state.reconnect?.candidate) {
        applyNetColors();
        buildNet(settingsNet)(state.reconnect.candidate);
      }
      // The same two actions Home's question offers; the answer is one answer wherever given.
      wireReconnectAnswers(root);

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
        el.onclick = () => connectFromSettings(el.dataset.useCube, 'connecting…');
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
    return { html: `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center">
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

  return { html: `<div class="cols flow">
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
    <div class="aside">
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
  // width:100% — the screen centres its child (see the timer). The case grid wraps as many
  // 140px cards as fit rather than dividing the width into five.
  return { html: `<div style="width:100%;height:100%;display:flex;flex-direction:column;gap:16px">
    <div class="wrap-row">${['OLL', 'PLL', 'F2L', 'Weak first'].map((f, i) => `<button class="pill ${i === 0 ? 'on' : ''}">${f}</button>`).join('')}<span class="sub" style="margin-left:auto;color:var(--ink-4)">Sorted by weakest recall</span></div>
    <div class="case-grid">
    ${oll.map(([name, alg, color, pct], i) => `<button class="card" data-go="drill" style="text-align:center;cursor:pointer">
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;width:76px;margin:0 auto">${grid(i).map((g) => `<div style="aspect-ratio:1;border-radius:var(--r-sticker);background:${g}"></div>`).join('')}</div>
      <div style="font-weight:700;margin-top:10px">${name}</div><div class="num sub" style="color:var(--ink-4);min-height:28px;font-size:var(--fs-caption)">${alg}</div>
      <div class="bar" style="margin-top:6px"><i style="width:${pct};background:${color}"></i></div></button>`).join('')}</div></div>`, mount() {} };
};

SCREENS.drill = () => {
  const P2 = NET_COLORS[settings.palette];
  const grid = Array.from({ length: 9 }, (_, i) => ((i * 7 + 9) % 4 === 0 ? P2.D : 'var(--facelet-off)'));
  // `flow`: the flashcard is taller than a phone's locked primary region, and its controls
  // (Reveal, Again / Good / Easy) must never sit below a fold — so the box scrolls as one.
  return { html: `<div class="cols flow"><div class="col"><div class="card" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px">
      <div class="eyebrow">OLL 24 · DOT CASES · 3 OF 12</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;width:180px">${grid.map((g) => `<div style="aspect-ratio:1;border-radius:var(--r-sticker);background:${g}"></div>`).join('')}</div>
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
  return { html: `<div class="cols flow"><div class="col">
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
  // The capsule is the segmented control's pill; the nav around it is the positioned box the
  // stylesheet floats over the title bar (landscape) or lays at the foot of the window (portrait).
  $('#nav').innerHTML = `<div class="capsule">${items.map(([id, lbl, ic]) => `<button class="nav-item ${state.screen === id ? 'active' : ''}" data-nav="${id}"${state.screen === id ? ' aria-current="page"' : ''}><span class="ico">${icon(ic, 15)}</span><span class="lbl">${t(lbl)}</span></button>`).join('')}</div>`;
  for (const b of $('#nav').querySelectorAll('[data-nav]')) b.onclick = () => go(b.dataset.nav);
  // Settings sits outside the row (buildChrome draws it), so it is marked here, not by the template.
  // The GEAR, found by its label: the smart-cube indicator beside it also carries
  // data-nav="settings" and comes first in the bar, so a data-nav match marked the hidden
  // indicator and the visible gear never once said "you are here".
  $('#tbTrail [aria-label="Settings"]')?.classList.toggle('active', state.screen === 'settings');
  fitTabs();
}

/** Labels when the labelled row fits between the bar's outer zones, icons only when it does not.
 *  Measured, not thresholded: whether six labelled tabs fit a title bar depends on the tabs, the
 *  language and the platform's lead zone, none of which a width can know. Landscape only — the
 *  portrait tab bar (the stylesheet lays the row in flow there) has room for a word under every
 *  icon. Re-run by renderNav and whenever the bar resizes. */
function fitTabs() {
  const nav = $('#nav'), bar = $('#titlebar');
  if (!nav || !bar || bar.clientWidth === 0) return; // not laid out (the test harness has no layout)
  nav.classList.remove('compact');
  if (getComputedStyle(nav).position !== 'absolute') return; // the portrait bar
  // Centred on the bar, the row needs symmetric room: the wider of the two zones on both sides.
  // scrollWidth, not offsetWidth: the zone's CONTENT is what the tabs must clear, whatever box
  // the engine gave the zone.
  const zone = Math.max($('#tbLead').scrollWidth, $('#tbTrail').scrollWidth) + 12; // + the bar's padding
  const room = bar.clientWidth - 2 * zone - 8;
  if (nav.scrollWidth > room) nav.classList.add('compact');
}
function renderScreen() {
  if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
  liveUpdate = null;
  liveMove = null;
  liveGap = null;
  onTrustLost = null;
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
/** Test seam for the cube stream. In production the driver is the only caller of these (see
 * doConnect); following cannot otherwise be exercised without a physical GAN cube in the room,
 * which is precisely why its worst bug survived so long. Same shape as cubusGo above. */
window.cubusFeed = {
  move: (m) => liveMove?.(m),
  facelets: (f, serial) => onFacelets(f, serial),
  gap: (g) => onGap(g), // the driver's door, not the screen's — see onGap
  disconnect: () => onDisconnect(),
  /** The cube answered nothing — what connectOnce's getState rejection reports. Exposed because
   *  that path needs Web Bluetooth to exercise for real, and the silence handling is exactly the
   *  behaviour that was once an empty catch. */
  silence: () => reportSilence(),
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

/** The layout contract is built on container-query units (index.html: .stage, .screen). A webview
 *  without them would not fail — it would draw every screen at the wrong size and say nothing.
 *  Under Tauri that is a floor violation (macOS 13 / iOS 16 are declared) and the app stops here,
 *  on the paper, in words. The browser is a harness, not a target: it gets the console. An engine
 *  with no CSS object at all is the test harness, which lays nothing out and is not asked. */
function assertStageSupport() {
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return;
  if (CSS.supports('width', '1cqw') && CSS.supports('container-type', 'size')) return;
  const msg = 'Cubus cannot lay itself out here: this webview has no container-query units (needs macOS 13 / iOS 16 or newer).';
  if (!isTauri) { console.error(msg); return; }
  $('#stage').textContent = msg;
  throw new Error(msg);
}

/** Fixture insets for the harness: `?insets=59,0,34,0` (top, right, bottom, left; px) stands in
 *  for the OS safe-area insets, so a desktop window resized to a phone's size is a phone. Sets
 *  the same --inset-* properties .app reads from env(safe-area-inset-*); a real device never
 *  carries the parameter, and without it nothing happens. */
function applyInsetOverride() {
  const raw = new URLSearchParams(window.location.search).get('insets');
  if (raw === null) return;
  const px = raw.split(',').map((v) => Number.parseFloat(v));
  if (px.length !== 4 || px.some((v) => !Number.isFinite(v) || v < 0)) throw new Error(`?insets= wants four non-negative numbers, got "${raw}"`);
  const app = $('.app');
  ['t', 'r', 'b', 'l'].forEach((side, i) => app.style.setProperty(`--inset-${side}`, `${px[i]}px`));
}

async function boot() {
  assertStageSupport();
  applyInsetOverride();
  const platform = detectPlatform();
  document.documentElement.dataset.host = isTauri ? 'tauri' : 'web';
  document.documentElement.dataset.platform = platform;
  buildChrome(platform);
  // The tab row refits when the bar's width changes — a window resize, an orientation change.
  if (typeof ResizeObserver === 'function') new ResizeObserver(fitTabs).observe($('#titlebar'));
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
  if (await loadSolver()) {
    // The registry was parsed before the cube library existed, so its remembered arrangements
    // have passed only the structural checks. Re-parse with the full reachability round-trip:
    // a forged state that merely looks like facelets is dropped whole here, not shown later.
    cubes = parseRegistry(cubes, Cube);
    setFacelets(state.cube.facelets);
    if (['home', 'viewer', 'timer'].includes(state.screen)) renderScreen();
  }
}
boot();
