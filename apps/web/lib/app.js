// Cubus app controller. Renders the designed multi-screen shell and wires it to the real
// engine: cubejs (independent oracle + facelet parsing + validity), the two-phase solver in a
// worker (solving, and the scrambles it inverts), and the YOLO camera scanner. The 3D cube is
// <cubus-cube> — it draws only; state and solving stay here.

import { summarize, times } from './solve-stats.js';
import { createSolveTimer } from './solve-timer.js';
import { TIERS, describe, refine, solveWithinGodsNumber } from './solve-target.js';
import { createParallelSolveClient, createSolveClient, spawnSolveWorker } from './solve-client.js';
import { LOOSEST_BOUND, VIEW_COUNT } from './solver-engine.js';
import {
  cancel as optimalCancel,
  capability as optimalCapability,
  prepare as optimalPrepare,
  prove as optimalProve,
  status as optimalStatus,
} from './optimal.js';
import { NO_CHALLENGES, loadIndex, provenAnswer } from './optimal-challenges.js';
import { STARTUP_DELAY_MS, makeUpdater, selfUpdateSupported } from './app-update.js';
import { hostPlatform, isDesktopHost } from './host.js';
import { randomCube } from './random-state.js';
import { makeRouter } from './router.js';
// The smart-cube strands, recovered from v0 (2026-08-27): the transport seam (Web Bluetooth in a
// browser, native BLE events under Tauri), one durable record per cube, and the trust model that
// keeps "connected" from standing in for "known".
import { VERDICT, connectCube } from './cube-session.js';
import { MAX_LABEL, NAME_PREFIX, cubeLabel, forgetCube, listCubes, normaliseIdentity, normaliseMac, parseRegistry, rememberCube, rememberLast, renameCube } from './cube-registry.js';
import { applyOffset, deriveOffset, isCubeState, isIdentity } from './cube-trust.js';
// What the host can actually reach a radio with. Imported rather than re-derived: the list of
// platforms whose native BLE is not yet proved on a device is one line in one file by design
// ("THE FLIP IS THIS LINE"), and a second copy here would let the app offer Pair on a platform
// that file had already refused.
import { NATIVE_BLE_UNSUPPORTED, forgetLibraryMac } from './ble-bridge.js';
// Reconnecting a known cube: the readings that choose the picture and the words on reconnect, and
// the two-adjacent-side camera check that supports the user's answer. Never the trust — only the
// user's answer grants that (dev-docs/smart-cube-ux-prd.md, "Reconnecting a known cube").
import { classifyReconnect, confirmCheck } from './cube-reconnect.js';
// Translation is wired at the render choke points (nav labels, window titles, the scan aside,
// Settings) and is an identity function until a catalog registers — see dev-docs/i18n.md for the
// convention and for the surfaces still to be converted.
import { t, initLocale, locale, plural } from './i18n.js';

const $ = (sel, root = document) => root.querySelector(sel);
/** The app's version — written HERE and nowhere else by hand. The About card renders it, and a
 * test pins the manifests (apps/web/package.json, tauri.conf.json, the desktop Cargo.toml) equal
 * to it, so the five version fields this repo carries can no longer drift apart silently — the
 * About card spent months claiming 0.4.2 over manifests that all said 0.1.0. Exported for that
 * test, not as API. */
export const VERSION = '0.3.3';
/** A cube with nothing wrong with it: the solved state, and the one search that costs only the
 *  tables. There used to be a second copy of this string under the name SOLVED_FACELETS, which is
 *  how two identical 54-character literals come to disagree. */
const SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
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
  scan: '<path d="M3 8V5a2 2 0 0 1 2-2h3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M21 16v3a2 2 0 0 1-2 2h-3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><rect x="8.5" y="8.5" width="7" height="7" rx="1.5"/>',
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
  // Pips are FILLED, not stroked. At r=1.2 with the sheet's 1.75 stroke and fill:none they were
  // drawn as rings with a 0.65-unit hole — invisible at 18px, plainly wrong at any size a
  // reader might zoom to. Same technique grid-filled used for its solid cells.
  dice: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none"/><circle cx="16" cy="8" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="8" cy="16" r="1.5" fill="currentColor" stroke="none"/><circle cx="16" cy="16" r="1.5" fill="currentColor" stroke="none"/>',
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
  // Two 3x3 grids differing only in which cells were filled read as one picture at 22px, which is
  // the cost the icons-only row took on (dev-docs/stage-contract.md). A viewfinder and a die are
  // different silhouettes, and both say what the screen does rather than what a cube looks like:
  // Restore asks you to hold a face up to the camera, Scramble hands you a random cube. `dice` is
  // already the Random button's icon on the cube screen — the same meaning, deliberately the same
  // picture.
  ['scan', 'Restore', 'scan'],
  ['scramble', 'Scramble', 'dice'],
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
const settings = load('cubusSettings', { theme: 'auto', palette: 'muted', autosolve: false, cameraId: '', navHidden: null, navDefaults: 0, devRandCube: false, language: '', dragRotate: false, solveTier: 'twenty', proveMinimum: false });
// localStorage is untrusted input, and `load` merges it raw. The string "false" is truthy, so
// a hand-edited or half-migrated value could opt someone in to an operation that runs for
// hours — the one setting where "off unless explicitly true" is the whole point.
settings.proveMinimum = settings.proveMinimum === true;
// The inspection flag is gone (it toggled a label, never a behaviour); drop the stored leftover
// rather than letting save() keep rewriting a field nothing reads — the advancedOpen precedent.
delete settings.inspection;

/** The themes, as stored. Auto is a policy rather than a theme: white while the system is light,
 * night while it is dark (tokens.css). Cream is the warm option you choose, not the default you
 * get — it was the auto-light appearance until 2026-08-31. */
const THEMES = ['auto', 'white', 'cream', 'night'];
// The names changed when White arrived: the kit's "light" is Cream and its "dark" is Night. A
// stored value from before is mapped rather than dropped, so nobody's window changes colour on
// update; anything else in that field is not a theme and falls back to auto.
{
  const mapped = { light: 'cream', dark: 'night' }[settings.theme]
    ?? (THEMES.includes(settings.theme) ? settings.theme : 'auto');
  if (mapped !== settings.theme) { settings.theme = mapped; save('cubusSettings', settings); }
}

/** The cube palettes, as stored — and the same three keys `NET_COLORS` and the renderer's own
 *  PALETTES use. Validated at load for the same reason the theme is: localStorage is untrusted
 *  input, and an unknown value here was not a cosmetic fallback but a crash. `NET_COLORS[p]`
 *  returned undefined at three sites with no `||`, so Trainer, Drill and the Settings swatch
 *  threw on the first property read and left the previous screen's DOM under the new title
 *  (found by audit, 2026-09-04). Repaired ONCE, here, and saved — so a hand-edited value is
 *  corrected rather than re-read on every render — with the `||` kept at every read as the
 *  belt: this validation is what makes them unreachable, not what replaces them. */
const PALETTES = ['muted', 'classic', 'colorsafe'];
/** Every stored field whose value STEERS something, checked once, here.
 *
 *  The palette was the one that crashed, but it was not the only one that could: an unknown
 *  `solveTier` reaches `tierByName` inside the solver, which throws by contract; a non-string
 *  `language` reached `.toLowerCase()` in initLocale and took the whole of boot() with it, so the
 *  app came up with a blank stage; and a non-numeric `navDefaults` made the one-time nav
 *  migration silently never apply. Each is the same defect — a value the app's own writes cannot
 *  produce, trusted because it was in storage — so each is repaired the same way and at the same
 *  moment, rather than being caught at whichever call site happens to reach it first. */
const repairs = [
  [() => PALETTES.includes(settings.palette), () => { settings.palette = 'muted'; }],
  [() => TIERS.some((tier) => tier.name === settings.solveTier), () => { settings.solveTier = 'twenty'; }],
  [() => typeof settings.language === 'string', () => { settings.language = ''; }],
  [() => typeof settings.cameraId === 'string', () => { settings.cameraId = ''; }],
  [() => Number.isFinite(settings.navDefaults), () => { settings.navDefaults = 0; }],
];
{
  let repaired = false;
  for (const [ok, fix] of repairs) if (!ok()) { fix(); repaired = true; }
  // Written back, so a hand-edited value is corrected once rather than re-read and re-repaired on
  // every launch — the theme migration's precedent.
  if (repaired) save('cubusSettings', settings);
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
 * solve a cube. (Stats used to be hidden because it showed invented numbers; phase 5 replaced
 * every one of them with a computed figure or an em dash, so it is hidden now only because a
 * beginner does not need an ao12 — not because it lies.) Alg trainer, Drill and Lessons are still
 * the other class: representative screens with placeholder content. The default tab row is the beginner's path;
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
    // Has this arrangement been classified? Declared here rather than appearing on first write, so
    // the shape of `state.cube` is readable in one place — it was set by ingestFacelets and read
    // by deriveCube and existed in neither declaration.
    derived: false,
    // Is this an arrangement NO cube can be turned into — a twisted corner, a flipped edge, two
    // swapped pieces? A distinct outcome from `!solvable`, which a solved cube also has: there is
    // nothing to walk in both cases, and only one of them is something to tell a person about.
    //
    // It comes from cubejs's parser and the four classical conditions (classifyCube), never from
    // the engine answering null. The engine's null means "out of budget OR not a solvable state"
    // and cannot be asked which (solve-target.js) — reading it as a verdict about the cube is
    // exactly the claim AGENTS.md forbids.
    unsolvable: false,
    // Has `solution` been checked by the implementation that did NOT produce it? A solution
    // reaches this state two ways — searched for by the two-phase worker, or inverted from a
    // setup alg that worker already searched for — and only one of them has been cross-checked
    // (applied through the cubejs oracle) on arrival. Without this flag "solution is set"
    // would mean "verified" in one case and not the other.
    crossChecked: false,
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

// How the four rungs read on the Settings screen. A rung with no label here would render as
// "undefined", so solve-tier-wiring.test.mjs checks every TIERS entry has one.
/** How long a proof may run before it has to account for itself.
 *
 *  Proof cost tracks DEPTH, not the incumbent: a cube a few turns from solved proves in
 *  milliseconds, a random one at depth 17 takes about a minute, and depth 18 — which is 67% of
 *  random states — has been measured at over an hour (optimal-solver-plan.md). So there is no
 *  threshold worth guessing in advance, and no percentage worth inventing: the proof simply
 *  earns its waiting state by taking one. Under this, a press looks instant, which for a
 *  shallow cube it is; over it, the button starts saying what it has ruled out and how long it
 *  has been at it, and a stop appears beside it. */
const PROOF_WAIT_VISIBLE_MS = 250;

/** Every place the app NAMES the prove feature, as opposed to making a claim with it.
 *
 *  The distinction is the whole point, and it is what keeps the wording invariant meaningful as
 *  the feature grows: `provenMinimumLabel` and the native prover's gated block assert something
 *  about a particular cube, and may only ever run after a proof. These strings assert nothing —
 *  they are a button that offers to start one and a toggle that decides whether the button is
 *  drawn. Kept together so there is one region to sanction rather than a new one per string, and
 *  named rather than reworded to slip under the check: a toggle should be named after the button
 *  it turns on, not after what a regex will tolerate.
 *
 *  `button` is also the button's RESTING label in three states — the markup, the per-walk
 *  rewiring, and the return from a stopped proof — which had drifted apart as three literals. */
const PROVE_COPY = {
  button: 'prove the minimum',
  settingLabel: 'Offer to prove the minimum',
  settingBlurb: 'A button on the solution that proves no shorter solution exists. The first run builds 86 MB of tables, and a proof can take minutes to hours',
};

/** The one sentence the SHIPPED library may put on a screen, and the second of exactly two
 *  places in this file where the word "proved" is allowed to originate (the other is the
 *  native prover's gated block). It is a named function rather than a slice of a ternary so
 *  the wording invariant in optimal.test.mjs can sanction it precisely instead of loosening
 *  to a pattern that would let a third source through unnoticed. Its guard is checked there
 *  too: the only call must sit behind `provenHere`. */
const provenMinimumLabel = (moves) => `${moves} — proved the minimum`;


const TIER_LABEL = { twenty: '≤ 20', nineteen: '≤ 19', eighteen: '≤ 18', shortest: 'shortest' };
const TIER_BLURB = {
  twenty: 'Twenty moves or fewer — always possible, and quick. An easy cube still gets its short answer',
  nineteen: 'Nineteen or fewer — a moment longer, and it almost always gets there',
  eighteen: 'Eighteen when it can be found; often it cannot, and it says so rather than pretend',
  shortest: 'Keeps looking for a shorter one until you move on',
};

// ---- solver pipeline (cubejs oracle + the two-phase engine in a worker), lazy-loaded ----------
let Cube = null, solverReady = false;
/** States whose minimum is already PROVED, by facelets. Empty until the solver loads, and empty
 *  forever if the library did not validate — both of which a lookup answers with a miss. */
let challenges = NO_CHALLENGES;
const invMove = (m) => (m.endsWith('2') ? m : m.endsWith("'") ? m[0] : m + "'");
/** An alg undone: the same turns, backwards, each reversed. The ONE place that rule is written.
 *  It is an involution on every move form (R->R'->R, R2->R2, R'->R->R'), which is what lets the
 *  same function turn a solution into a setup alg and a setup alg back into a solution. */
const invertAlg = (a) => (String(a).trim() ? String(a).trim().split(/\s+/).reverse().map(invMove).join(' ') : '');

// Single-flight: boot and an async screen mount both call this, and two callers racing on `Cube`
// would each import and each publish. The in-flight promise is shared; a failure clears it so a
// later call can retry rather than being stuck with a rejected one.
//
// `Cube.initSolver()` USED TO BE HERE, right after first paint, and it was the largest block the
// app took at boot — two to four times that on a phone (dev-docs/deferred-plans-2026-09-05.md §1).
// Measured in WebKit on 2026-09-05, ten boots each, as the longest gap between two consecutive
// 4 ms timer callbacks installed before any page script (the main thread cannot run one while it
// is blocked, so the gap IS the block): median 723 ms and worst 793 ms with it, median 40 ms and
// worst 59 ms without. What remains is the renderer's first WebGL build, which is present in both
// and is a different item.
//
// It built cubejs's Kociemba tables, and the ONLY thing on this thread that ever needed them was
// `cube.solve()` in deriveCube — a search for an answer the worker pool produces anyway, and
// whose inverse IS the setup alg (takeSetupAlg). Nothing else cubejs does here needs a table:
// parsing a facelet string, applying moves, asking whether a state is solved and judging a state
// legal are all arithmetic. So the tables are gone from this thread entirely, and the engine's
// own live in the pool's workers, where a user is not waiting behind them (removed 2026-09-05).
let solverLoading = null;
async function loadSolver() {
  if (solverReady) return true;
  solverLoading ??= (async () => {
    try {
      Cube = (await import('../vendor/cubejs.js')).default;
      solverReady = true;
      // The proven library rides ALONGSIDE, never in front. It needs the same oracle and it is
      // what lets a known state answer with no search at all — but it is an optimisation, and
      // awaiting it here made it a dependency: a fetch that never settles would have left
      // solverReady false forever and every solve waiting on it, which is the exact opposite
      // of the "costs performance, never correctness" this comment used to claim. Un-awaited,
      // a slow library only means the first few solves search as they always did.
      //
      // Its failure is loud but never fatal, and a library that will not validate must yield
      // NO claim rather than a plausible one — which is what dropping the whole index achieves.
      // loadIndex, not a promise chain assembled here: both failure kinds — a library that will
      // not load and one that will not validate — leave through its single door, so there is no
      // arrangement of .then/.catch for this call site to get subtly wrong.
      void loadIndex({
        Cube,
        onError: (err) => console.error(
          'optimal-challenges: the proven library did not load; every state will be searched', err,
        ),
      }).then((index) => { challenges = index; });
      return true;
    } catch (err) {
      // Loud. This was an empty catch, and its silence was the whole defect: the die became a
      // no-op, `loadWalk` blamed the CUBE ("could not work it out") for a failure of the APP, and
      // the Timer sat on "solver loading…" forever behind a retry that could never fire. A
      // console line is the least a developer needs; the screens now say the other half in words
      // a user can act on (found by audit, 2026-09-04).
      console.error('the solver did not load — solving, scrambles and the die are unavailable', err);
      solverLoading = null;
      return false;
    }
  })();
  return solverLoading;
}

// Record a scanned/known facelet state. Ingesting a state and DERIVING from it are separate
// costs, and they used to be one call.
//
// Storing facelets is free. Working out the setup alg is a full Kociemba search, and it ran on
// every arriving snapshot — the cube emits those at ~1Hz for as long as it is connected, on the
// UI thread, for a solution most of them never need. Screens that want the derived values ask for
// them; the live path just records what the cube says.
function ingestFacelets(f) {
  const c = state.cube;
  c.facelets = f;
  c.solution = ''; c.moves = []; c.stepFacelets = []; c.solveResult = null;
  c.setupAlg = ''; c.derived = false; c.unsolvable = false; c.crossChecked = false;
}

/** An algorithm string as its move list — the one tokenizer both solve paths share. */
const movesOf = (alg) => (alg.trim() ? alg.trim().split(/\s+/) : []);

/**
 * What the stored facelets ARE, before anything searches: a walk to make, nothing to do, or an
 * arrangement no cube can be turned into. Idempotent; every reader of `solvable` or `unsolvable`
 * goes through here first.
 *
 * SYNCHRONOUS AND TABLE-FREE, which is the whole point. This used to run `cube.solve()` — a
 * Kociemba search on the UI thread — which is the only reason `Cube.initSolver()`'s ~1 s table
 * build was ever a boot cost. Neither is needed to answer what the screens actually ask:
 *
 *   * **A legal cube that is not solved HAS a walk.** God's number says every one of the
 *     43,252,003,274,489,856,000 legal positions has a solution of 20 moves or fewer, so "is
 *     there one" is a fact about the cube rather than something a search establishes. Which one
 *     it is, is the pool's job (deriveCube).
 *   * **A state that is not legal has none, and legality is arithmetic.** cubejs's parser plus
 *     the four classical conditions — `isCubeState` in lib/cube-trust.js, the same gate the cube
 *     registry and the reconnect readings go through, so a string one of them accepts and
 *     another refuses cannot drift apart. Microseconds, and no table anywhere.
 *
 * The old code could not tell the two apart at all: handed a twisted corner, cubejs's `solve()`
 * returns a well-formed 16-move alg that does not solve it (measured 2026-09-05), so the screen
 * went walking, the engine refused the state, and eight budget escalations later `failWalk` said
 * "could not work it out" — blaming a search for something parity had already settled.
 */
function classifyCube() {
  const c = state.cube;
  if (c.derived) return c;
  // A solved cube has no walk, and needs no library to say so. Asked for one anyway, cubejs's
  // two-phase search answers the identity with a 14-move no-op ("R L U2 R L F2 R2 U2 R2 F2 R2 U2
  // F2 L2"), so "the solver returned moves" was never evidence of anything to follow — every
  // fresh launch put a transport under the solved cube reading 0 / 0, its done tick already lit.
  if (c.facelets === SOLVED) {
    c.setupAlg = ''; c.solvable = false; c.unsolvable = false; c.derived = true;
    return c;
  }
  if (!Cube) {
    // No parser yet, so legality is not knowable — and an unknown must never be reported as a
    // verdict ("Never invent data"). The best that can be said is "not the solved state".
    // Deliberately NOT marked derived, so the real classification still happens once cubejs
    // arrives. Gated on `Cube` rather than on `solverReady` because the parser is the thing this
    // needs, and there is no longer anything else to be ready.
    c.solvable = true; c.unsolvable = false;
    return c;
  }
  c.derived = true;
  c.unsolvable = !isCubeState(c.facelets, Cube);
  c.solvable = !c.unsolvable;
  return c;
}

/**
 * The walk for the stored facelets, worked out THROUGH THE POOL — never on this thread.
 *
 * The setup alg (solved -> this arrangement, the path the 3D twin animates from) used to be its
 * own Kociemba search here, over the same state, for the same answer the pool is asked for
 * anyway. It is the inverse of that answer: `finishSolve` takes it, checked (takeSetupAlg), for
 * every path a solution can arrive by. So this is classification plus the one ask.
 *
 * Throws for a subject with no walk. That cannot happen down the ordinary route — the screen's
 * composition is chosen from `classifyCube()` and a cube with nothing to walk draws no solution
 * card — but a live snapshot can replace the subject inside the await this stands in front of,
 * and an empty chip grid under a count reading "0" would be the screen quietly lying about a
 * cube it cannot walk.
 */
async function deriveCube(opts = {}) {
  const c = classifyCube();
  if (!c.solvable) throw new Error('nothing to walk on this cube');
  await solve(opts);
  return c;
}

/** Ingest AND classify — for callers that are about to read `solvable` immediately. */
function setFacelets(f) {
  ingestFacelets(f);
  classifyCube();
}

// The solver worker, made once and kept. Building the engine's pruning tables costs ~0.5-2.6 s
// (dev-docs/solver-move-count.md §7), so a client per solve would pay it every time.
let solveClient = null;
/**
 * The solver, on as many threads as this page is allowed and can use.
 *
 * Parallel needs SharedArrayBuffer, and not for the answer — for the STOP. A search is
 * synchronous, so a worker that cannot possibly win still runs to its budget unless something
 * reaches inside it, and waiting for those would cost more than the parallelism wins. Without
 * isolation this is one worker searching every view, which is exactly what it was before.
 *
 * ONE WORKER PER VIEW, and that was measured rather than guessed. Three workers with two views
 * each barely moved the tail — p95 302 ms to 313 ms, which is nothing — because the hard cubes
 * are hard in ONE view, so a slice holding the expensive view is still doing all the work. One
 * view each is the finest split this design allows and it is the one that pays: on 90 random
 * cubes, p95 665 ms to 325 ms and worst 960 ms to 339 ms. The plan warned about exactly this,
 * quoting the Rust prover's note that two-move roots collapsed to 3 of 20 cores.
 *
 * Capped by the cores actually present, less two for the camera and the renderer — the same
 * reasoning as the scanner's thread count, and what keeps a four-core phone from starting a
 * worker per view when there are no cores to run them on. Until 2026-09-05 the cap was also
 * about memory, because every worker built its own 9.82 MiB of tables; that half is gone — one
 * worker builds and the rest adopt views of the same bytes (`shareTables` below) — and the cap
 * stands on the cores alone.
 */
const SOLVER_WORKERS = Math.max(1, Math.min(VIEW_COUNT, (globalThis.navigator?.hardwareConcurrency ?? 4) - 2));
const solverWorker = () => (solveClient ??= (() => {
  const isolated = typeof SharedArrayBuffer !== 'undefined' && globalThis.crossOriginIsolated === true;
  // `Worker` absent means every "worker" is this thread. Six of those is six sequential searches
  // blocking the page with a sixth of the budget each — strictly worse than one searching every
  // view, and the pool's stop cannot help because nothing runs concurrently to be stopped.
  const threaded = typeof Worker === 'function';
  if (!isolated || !threaded || SOLVER_WORKERS < 2) return createSolveClient({ spawn: spawnSolveWorker });
  return createParallelSolveClient({
    spawn: spawnSolveWorker,
    workers: SOLVER_WORKERS,
    viewCount: VIEW_COUNT,
    // A fresh word per solve, not one for the client's lifetime: overlapping solves would
    // otherwise publish each other's depths into the same channel.
    makeShared: () => new Int32Array(new SharedArrayBuffer(4)),
    // Build once and publish (2026-09-05, dev-docs/deferred-plans-2026-09-05.md §2). Every worker
    // used to build the engine's eleven tables itself — 9.82 MiB and 0.4-2.6 s each — so a cold
    // session paid six builds and then carried six identical copies. One worker builds into a
    // SharedArrayBuffer now and the rest adopt views of it; the pool owns the handshake, and this
    // thread only says that this page is allowed to have one. It is passed HERE and not to
    // `createSolveClient` above because it needs the same isolation the stop word does, and this
    // is the branch that already established the page has it.
    shareTables: true,
  });
})());

let solverWarmed = false;
/**
 * Build the pool's pruning tables before a user is waiting on them.
 *
 * They are built lazily — 0.5-2.6 s (dev-docs/solver-move-count.md §7) — so without this the
 * FIRST solve of a session is the thing that pays, on screens that had seconds of warning.
 * Since 2026-09-05 the first request through the pool also runs the table handshake: one worker
 * builds into a SharedArrayBuffer and the other five adopt views of it, so a session pays for
 * ONE build here instead of six concurrent ones. Measured in WebKit on this machine, this call:
 * 720 ms before, 425 ms after — and the gap is contention rather than five sixths of the work,
 * because six builds on six threads never cost six times one.
 *
 * The warm request is a SOLVED cube: every view answers it at depth 0, so the table build is
 * the whole of what it costs. Measured on this engine: 652 ms cold, 0 ms warm, 1 ms for six
 * slices warm. The budget is 1,000 nodes per slice rather than a token amount because
 * `shareBudget` drops a zero share — a budget under the worker count would warm only some of
 * them, which is the quiet half-fix this exists to avoid.
 *
 * Fire-and-forget by design, and never awaited: nothing the user asked for is waiting on it,
 * and the real solve behind it surfaces its own failures. Same shape as `warmRoller`, and
 * called from the same kind of place — a screen that knows a solve is coming, never a session
 * that opens neither.
 */
function warmSolver() {
  if (solverWarmed) return;
  solverWarmed = true;
  try {
    void solverWorker()
      .solve(SOLVED, { solLen: LOOSEST_BOUND, probeMax: 1000 * VIEW_COUNT })
      .catch(() => {});
  } catch {
    // A client that cannot even be constructed is the real solve's problem to report, loudly,
    // where a user is actually waiting. Warming must never be the thing that breaks a screen.
  }
}

/**
 * The setup alg, taken from the solution the pool already found — CHECKED, never trusted.
 *
 * A solution takes this arrangement to solved, so its inverse takes solved to this arrangement:
 * one search yields both halves. That is the rule the scramble side has followed since
 * 2026-08-29 ("inverting the setup alg already IS one search"), applied to the other direction —
 * `invertAlg` is an involution, so there is one rule and not two. It replaces the Kociemba search
 * `deriveCube` used to run on the UI thread for exactly this, and with it the cubejs tables that
 * search needed.
 *
 * `reaches()` is what makes it a fact rather than an assumption: applying the alg to a solved
 * cube must reproduce the facelets — a couple of dozen move applications, microseconds against
 * the search it replaces, and the same check `takeDerivation` puts a carried alg through. A
 * disagreement leaves the setup alg EMPTY rather than wrong, and says so: `newCube` then draws
 * the arrangement instead of animating a walk that does not lead to it.
 */
function takeSetupAlg(c, solution) {
  // Already carried in with the cube and already checked (takeDerivation), or already taken from
  // an earlier solve of this same arrangement.
  if (c.setupAlg) return;
  const setupAlg = invertAlg(solution);
  if (!reaches(c.facelets, setupAlg)) {
    console.error('the inverse of the solution does not reach the cube it solves — no setup alg to animate from', { solution });
    return;
  }
  c.setupAlg = setupAlg;
}

/**
 * Whatever produced the solution, this is what makes it usable — and what checks it.
 *
 * Both solvers end here on purpose. The oracle cross-check, the per-step facelets and the setup
 * alg are not properties of one search or the other, and having two copies is how one of them
 * would quietly stop being verified.
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
  c.solution = solution; c.moves = moves;
  // Per-step facelets so the 2D net + move list can co-move with the 3D animation.
  c.stepFacelets = stepStates(c.facelets, moves);
  // True only when the oracle actually SAID yes. An oracle that could not run refuted
  // nothing — but it verified nothing either, and marking that "checked" would let an
  // unverified solution be reused forever. Left false, the next solve() retries the check.
  c.crossChecked = verified === true;
  // And the other half of the same answer. After the refutation gate, not before it: a solution
  // the oracle rejects must not leave a setup alg behind for the next screen to animate from.
  takeSetupAlg(c, solution);
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
 *
 * `signal` stops a search whose subject has been replaced. A cancelled search is SUPERSEDED, not
 * failed: it throws an AbortError, which callers recognise and say nothing about — the walk that
 * replaced it is the one on screen, and an error message about the cube it abandoned would be
 * about a cube nobody is looking at. `onProgress` is the engine's "still going", forwarded.
 */
async function solve({ onImprovement, onProgress, signal } = {}) {
  /** The one shape a superseded search reports with. `AbortError` rather than a sentinel value
   *  because every caller already has a catch, and a sentinel returned through one is a value
   *  that gets committed by whoever forgets to check it. */
  const aborted = () => Object.assign(new Error('solve: superseded'), { name: 'AbortError' });
  if (signal?.aborted) throw aborted();
  const c = state.cube;
  // There used to be a "the setup alg is stale — recompute now" line here, which called back into
  // deriveCube for a second Kociemba search on this thread. The setup alg is now the INVERSE of
  // the answer this function is about to produce (takeSetupAlg, from finishSolve), so a stale one
  // is repaired by the search that was going to run anyway rather than by one of its own.
  if (c.solution && c.crossChecked) return c.solution;
  if (c.solution) {
    // A solution that arrived WITHOUT a search — the inverse of a setup alg the worker already
    // found (the scramble hand-off). There is nothing to search for, but the oracle discipline
    // is unchanged: finishSolve applies it through cubejs — move application, ~µs, no search —
    // and a definite refutation blocks exactly as it does on the searched path.
    return finishSolve(c, c.solution);
  }

  // Already proved, offline, by crates/optimal-solver — so there is nothing to search for and
  // nothing to prove. This is the whole point of shipping the library as data: the minimum for
  // these states is a fact we carry, not a computation the device repeats. finishSolve still
  // applies it through the cubejs oracle, so a library entry gets exactly the same refutation
  // every searched answer gets; what it skips is the search, not the check.
  const proven = provenAnswer(challenges, c.facelets);
  if (proven) {
    c.solveResult = { key: 'solve.provenMinimum', moves: proven.moves };
    onImprovement?.({ alg: proven.alg, moves: proven.moves, target: null, met: true, stopped: 'met' });
    return finishSolve(c, proven.alg);
  }

  const client = solverWorker();
  // Captured: the search is about THIS arrangement. A live snapshot can re-ingest the cube
  // mid-await, and committing this search's answer onto the new subject would pair a solution
  // with a cube it does not solve. (The oracle in finishSolve would catch it loudly — this
  // makes it a clean refusal instead of a confusing one.)
  const searched = c.facelets;
  let result = null;
  for await (const step of refine(searched, {
    solve: (facelets, bounds) => client.solve(facelets, bounds),
    tier: settings.solveTier,
    signal,
    onProgress,
  })) {
    result = step;
    // A yield that arrives WITH the abort is real work and refine reports it, but it describes a
    // cube this screen has already replaced. Nothing is shown for it.
    if (signal?.aborted) throw aborted();
    onImprovement?.(step);
  }
  // Two ways to come back with nothing: cancelled before the first answer (refine yields nothing
  // at all), or cancelled between yields. Both are superseded, and neither may reach
  // `finishSolve` — `result.alg` on null is a TypeError dressed as a solver failure.
  if (signal?.aborted || result === null) throw aborted();
  if (c.facelets !== searched) {
    throw new Error('solve: the cube changed mid-search — this answer is about the previous one');
  }
  // Never inferred from the move count: a tier the cube cannot reach (18 does not exist for
  // every position) must read as "the shortest I found", not as the target met.
  c.solveResult = describe(result);
  return finishSolve(c, result.alg);
}

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
function parkCube() {
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

function newCube({ animate = false } = {}) {
  const el = reuseCube();
  // A drawing, with a description. `role="img"` is what makes the label be READ rather than the
  // element being walked into as a container of nothing.
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', cubeLabelWords());
  // The stored key IS the renderer's attribute value — validated at load, so there is nothing
  // left to map. There used to be a PALETTE_ATTR identity map here, which read as a translation
  // between two vocabularies that have always been the same one.
  el.setAttribute('palette', settings.palette);
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

/**
 * Keep the screen awake while the app is being LOOKED at rather than touched.
 *
 * Two screens earn it and no others: the scan, where the user is holding a cube up to a camera
 * with both hands, and a walk in progress, where they are turning a cube and reading the next
 * move. On a phone both are minutes of no input at all, and the display sleeping mid-solve is
 * the one interruption this audience cannot recover from gracefully — they put the cube down.
 *
 * A capability seam both builds satisfy, in the sense AGENTS.md means: `navigator.wakeLock` is a
 * web API the browser build has and the webviews either have or do not. No screen exists on one
 * build only; where the API is absent, nothing happens and nothing is said, because a screen
 * timeout is not a failure to report.
 *
 * REFERENCE-COUNTED, because two screens can want it across one navigation and a naive
 * release-on-teardown would drop the lock the incoming screen just took. And re-taken on
 * `visibilitychange`: the platform revokes a wake lock whenever the page is hidden, so a lock
 * acquired once and never renewed is gone the first time somebody takes a phone call.
 */
let wakeHolders = 0;
let wakeLock = null;
/** A request already out. SINGLE-FLIGHT, because the request is asynchronous and every check
 *  below it reads `wakeLock`, which is still null while one is in flight: two screens asking in
 *  the same tick — a navigation from the scan screen to a walk does exactly that — would each
 *  take a lock, and the second assignment would drop the first handle on the floor with the
 *  platform still holding it. */
let wakeAsking = false;
const wakeSupported = () => typeof globalThis.navigator?.wakeLock?.request === 'function';
async function takeWakeLock() {
  if (!wakeSupported() || wakeAsking || wakeHolders === 0 || wakeLock) return;
  if (document.visibilityState !== 'visible') return;
  wakeAsking = true;
  try {
    const taken = wakeLock = await navigator.wakeLock.request('screen');
    // Released by the platform as well as by us; clearing the handle is what lets the
    // visibility listener take a fresh one rather than believing it still holds this.
    //
    // CLEARED BY IDENTITY, never unconditionally (fixed 2026-09-05). The event is delivered a
    // task or more after `release()` resolves, and one navigation is enough to have replaced this
    // sentinel by then: the scan screen's holder leaves (holders hit 0, we release), the walk's
    // holder arrives (holders back to 1, a fresh lock is taken), and only then does the OLD
    // sentinel's release land. Clearing on it dropped the NEW handle on the floor with the
    // platform still holding it — so the next visibility change took a second lock, and the
    // screen that took the real one had nothing left to release when it went away.
    taken.addEventListener?.('release', () => { if (wakeLock === taken) wakeLock = null; });
    if (wakeHolders === 0) releaseWakeLock(); // the last holder left while this was in flight
  } catch (err) {
    // A refusal is normal — a battery-saver mode declines these — and is not worth a word to a
    // user who did not ask for it. Recorded once, at debug level, so it is findable.
    console.debug('screen wake lock refused', err);
  } finally {
    wakeAsking = false;
  }
}
function releaseWakeLock() {
  const held = wakeLock;
  wakeLock = null;
  void Promise.resolve(held?.release?.()).catch(() => {});
}
/** Ask for the screen to stay on. Returns the release, so a caller holds it exactly the way a
 *  screen holds anything else: take it at mount, call it in cleanup. */
function keepAwake() {
  wakeHolders += 1;
  void takeWakeLock();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    wakeHolders -= 1;
    if (wakeHolders === 0) releaseWakeLock();
  };
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void takeWakeLock();
  });
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
    // sessionStorage, not localStorage. The pin is a DESIGN-REVIEW tool — "show me this window as
    // Windows draws it" — and persisting it meant a shared link pinned the visitor's browser to
    // somebody else's platform permanently, with `?platform=auto` the only way back and nothing
    // anywhere saying so (found by audit, 2026-09-04). A tab is exactly the right lifetime: the
    // pin survives reloads and deep links while the review is happening, and is gone when the tab
    // is. The old key is removed on sight, so a browser already pinned by a link is freed.
    try { localStorage.removeItem('cubus.platform'); } catch {}
    const q = new URLSearchParams(window.location.search).get('platform');
    if (['macos', 'windows', 'linux', 'ios', 'android'].includes(q)) { sessionStorage.setItem('cubus.platform', q); return q; }
    if (q === 'auto') sessionStorage.removeItem('cubus.platform');
    const s = sessionStorage.getItem('cubus.platform'); if (s) return s;
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
  // The indicator is a BUTTON — it leads to cube management — and it stays one. It used to be
  // given role="status" as well, which REPLACES the button role: the one control that reaches the
  // smart-cube card stopped being announced as a control at all, and a keyboard user had no way
  // to know it could be pressed (found by audit, 2026-09-04). The live text belongs to a status
  // region, so it has one of its own: an off-screen sibling nobody has to be able to click.
  const cubeLive = `<button class="tb-ctl tb-live" id="cubeLive" hidden data-nav="settings">${icon('bluetooth', 17)}</button>`
    + '<span class="sr-only" id="cubeLiveSay" role="status" aria-live="polite"></span>';
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

// The live session (lib/cube-session.js), or null. It owns the transport, the protocol layer
// and the self-check; app.js only ever holds this one handle.
let conn = null;

// One durable record per cube. Only durable facts live here — trust, the tracking offset, the
// battery and the anchor flag are properties of a CONNECTION and are deliberately excluded
// (see lib/cube-registry.js).
let cubes = parseRegistry(load('cubusCubes', {}));

/** The address a bare "Pair" should try: whichever cube was used most recently — and only if it
 *  HAS one. Since a cube with no address is remembered under `name:<its name>` (normaliseIdentity),
 *  the most recent record's key is not necessarily an address, and handing `name:green cube` to
 *  the protocol layer as a Bluetooth address is a connect that cannot work and cannot say why. */
const lastCubeMac = () => listCubes(cubes).map((c) => normaliseMac(c.mac)).find(Boolean) || '';

/** The connected cube's remembered record at the moment it connected — what the reconnect
 *  reading compares the first report against. Cleared with the connection. */
let pendingLast = null;
/** True until the connection's FIRST report arrives; that report is the reconnect evidence. */
let awaitingReport = false;
/** A camera reading taken while this connection had reported NOTHING yet, held until its first
 *  report: `{facelets, turns}`. A repair is derived FROM what the cube claims — the camera says
 *  where the cube is, the report says where the cube thinks it is — so with no report there is
 *  nothing to derive against and the scan cannot put tracking back in step. Cleared with the
 *  connection: a scan is evidence about the cube that was in front of the camera, and the next
 *  connection may be another one.
 *
 *  `turns` is what makes the hold safe to use later. A held scan is reconcilable by the first
 *  report ONLY if nothing turned in between — see dropHeldScan. */
let scanAwaitingReport = null;
/** Why a held scan was thrown away. One string, said from the two places that can establish it —
 *  the turn itself, and the session's own count at the first report — because two wordings for
 *  one fact would read on screen as two different faults. */
const TURNED_SINCE_SCAN = 'it was turned after the camera saw it, and before it had reported anything';
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

/** Has the session PROVED this cube's own reports do not add up?
 *
 *  One predicate, because it now gates three different things — the report stream, the repair
 *  scan, and re-trusting after one — and three copies of a verdict comparison is how a refusal
 *  comes to mean different things per screen. A session that is not there refuses nothing:
 *  "no cube" and "a cube known to be wrong" are not the same state. */
const cubeRefused = () => conn?.verdict === VERDICT.REFUSED;

/** Repair tracking from one camera reading, WITHOUT solving the cube.
 *
 *  This is the whole point of the trust design: the old repair was "solve it, then re-anchor",
 *  which for a beginner is not a recovery path at all — someone who could solve the cube would
 *  not need the app, and that is exactly where a new player gives up.
 *
 *  The correction is derived BY THE SESSION'S CHECKER (`cameraScan`), not here. Both used to
 *  derive one — this file with `deriveOffset`, the checker with its own copy — so the app and the
 *  session held two disconnected trust models: `VERDICT.TRUSTED` was unreachable because nothing
 *  ever told the checker a camera had looked, and the checker's constancy rule (a correction that
 *  moves between two scans with an intact stream between them is not a correction) guarded
 *  nothing (found by audit, 2026-09-04). One derivation now, with the checker's answer as the
 *  answer, so a scan advances the verdict and a refusal reaches this screen.
 *
 *  @returns {{ok: boolean, text: string}|null} what to tell the user, or null when the scan
 *  changed nothing about tracking (no cube, or it already agreed).
 */
function repairTracking(scanned, { reconciling = false } = {}) {
  if (!state.connected || !conn) return null;
  // A refused cube cannot be repaired by a camera, and this is the door that used to let one be.
  // The correction is derived FROM the cube's own report; if that report has been proved not to
  // add up, the correction built on it is arithmetic over a fiction — and adopting the scan
  // afterwards called the cube trusted again. A refusal is about the cube, and only a fresh
  // connection can revisit it.
  if (cubeRefused()) {
    return {
      ok: false,
      text: 'This cube’s own reports have stopped adding up, so a scan cannot put it back in step — what the camera saw would be measured against a reading that means nothing. Disconnect it and pair again; the camera still solves the cube either way.',
    };
  }
  // The RAW report, not state.live: live has already had the current offset applied, so deriving
  // against it yields the identity — overwriting a correction the cube still needs.
  const reported = state.reported;
  if (!reported) {
    // The cube is here and has said nothing yet, so there is nothing to derive a correction
    // AGAINST and this scan cannot put its tracking back in step. Held for the FIRST report,
    // which is the first moment the repair can run at all (onFacelets reconciles it there).
    // Without this the scan granted camera trust with the repair silently skipped, and that first
    // report then replaced the scanned arrangement while keeping the trust the scan had earned —
    // a trusted subject nobody had looked at (found by audit, 2026-09-05).
    //
    // The turn count travels with it, because the hold is only good while the cube holds still:
    // a turn between the scan and the first report leaves the camera describing the cube BEFORE
    // it and the report describing the cube AFTER, and a correction derived from that pair is an
    // invented one (found by the same audit's second pass, 2026-09-05). dropHeldScan is the
    // other half.
    scanAwaitingReport = { facelets: scanned, turns: turnsReported() };
    return null;
  }
  // On an UNBROKEN chain the scan and the cube must agree. If they do not, one of them is wrong —
  // a misread, or a camera pointed at a different cube — and deriving a correction from a
  // contradiction would bake the mistake in permanently. Which one is wrong is not knowable;
  // that there is a problem is. (Compared against state.live, NOT the raw report: once a
  // correction is active, comparing with the raw report made every later good scan look like a
  // contradiction — repairing a cube once made every later scan of it fail.)
  //
  // Never on a RECONCILIATION, which is this same repair run late — the deferred half of a scan
  // taken before the connection had reported anything. There the trust being read here is the
  // scan's OWN, granted moments ago, and `live` is null precisely because no report had arrived
  // to establish one: the pair being compared would be the scan against nothing.
  //
  // And the trust that gates it is the CHAIN's, not the subject's. `state.cube.trusted` is also
  // true of a generated scramble — the die, the Timer, the Scramble hand-off — which is perfect
  // knowledge of a cube nobody looked at, and says nothing whatever about whether this cube's
  // reports are in step. A camera repair on a stale cube was refused for the words "the cube was
  // tracking" purely because a scramble had been rolled, which is the one moment the repair
  // exists for (found by audit, 2026-09-05). chainTrusted() is the predicate that means what
  // this sentence claims: trusted knowledge of the cube ITSELF.
  if (chainTrusted() && !reconciling && scanned !== state.live) {
    return {
      ok: false,
      text: 'This is not what your cube is reporting, and the cube was tracking. One of the two is wrong, so nothing was changed — check that you scanned the cube that is connected.',
    };
  }
  const offset = conn.cameraScan(scanned, reported);
  // The checker may have REFUSED on this very scan — two scans implying two different corrections
  // with an unbroken stream between them is the self-consistent-but-wrong decoder it exists to
  // catch. Asked after the scan, because that is when the answer exists; `offset` still holds the
  // previous correction in that case, so applying it would silently keep a correction the checker
  // has just disowned.
  if (cubeRefused()) {
    return {
      ok: false,
      text: 'This scan and the last one imply two different corrections, with nothing lost in between — so what this cube reports cannot be corrected by any fixed amount. cubus has stopped trusting its reports; the camera still solves it.',
    };
  }
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
  // A scan waiting for a report it will never get. It stays the SUBJECT — the camera did see that
  // cube — but the chain it was to be reconciled with has ended, and markStale below says so.
  scanAwaitingReport = null;
  lastSerialSeen = null;
  // Order matters: mark stale BEFORE setConnected, so the indicator repaints once, already
  // knowing the truth, rather than flashing "connected and fine" on its way out.
  markStale('it disconnected, and may have been turned since');
  // Across a disconnect the cube may sleep, reset its own counters, or be turned. The offset
  // corrected a specific chain to reality at a moment; that chain is gone.
  clearOffset();
  setConnected(false);
  // setConnected repaints Settings; the question block on Home is this screen's own furniture.
  if (hadQuestion && state.screen === 'home') refreshScreen();
}

/** Throw the correction away. NOT called on `gap`: a serial skip means moves were missed, not
 *  that the reference moved — what was lost is the moves in between, not the relationship. */
function clearOffset() {
  state.cube.offset = null;
  state.cube.offsetAt = 0;
  state.cube.offsetFrom = '';
}

/**
 * A turn reached the cube but not us.
 *
 * Trust lapses HERE rather than in a screen's handler, so a loss arriving while you are in
 * Settings is not dropped; the screen still gets told so it can stand down.
 *
 * It used to be reached by a SERIAL skip, which only cubes that number their moves can report —
 * three brands the app now speaks to report a usable clock and number nothing. It is reached by
 * PROOF now: the self-check replays the moves it saw onto the last reported state, and the next
 * report does not match. That works on every brand, and it establishes the loss against the cube
 * rather than inferring it from a counter.
 *
 * What it costs is the COUNT. A serial says two turns went missing; reconciliation says at least
 * one did. So nothing here names a number any more — an invented one would be the more
 * comfortable sentence and the less true one.
 */
function onMovesLost() {
  markStale('a turn went unrecorded');
  if (liveGap) liveGap();
}

/** How many turns this connection has reported, as the SESSION counts them. The self-check is
 *  shown every MOVE event before any listener of ours is, so this is the cube's own record rather
 *  than a tally of what happened to reach this file — which is exactly what makes it worth asking
 *  a second time at the report. Zero with no session, and zero for a session that counts nothing:
 *  a count that cannot move can only ever say "nothing turned", which is what a cube reporting no
 *  moves at all is in fact saying. */
const turnsReported = () => conn?.evidence?.moveReports ?? 0;

/**
 * Throw away a scan held for a first report, and say where trust is shown why.
 *
 * A held scan is reconcilable by the first report ONLY if nothing turned in between. Once the
 * cube has moved, the camera describes it before the turn and the report describes it after: the
 * correction derived from that pair relates two different arrangements, so it is an offset nobody
 * observed, and adopting it kept the camera's trust over an arrangement the cube had already
 * left (found by audit, 2026-09-05, in the fix that introduced the hold).
 *
 * At the TURN rather than at the report, because a first report that never arrives would
 * otherwise leave that trust standing for the life of the connection. Trust lapses through
 * markStale like every other lapse, so the indicator, its live region and Settings all say it;
 * the report itself then takes the ordinary path — which, with something remembered, is the
 * reconnect question, the one question a beginner can answer.
 */
function dropHeldScan() {
  if (!scanAwaitingReport) return;
  scanAwaitingReport = null;
  markStale(TURNED_SINCE_SCAN);
}

/**
 * A turn the cube reported.
 *
 * ONE body for the driver and the test seam, and deliberately NOT the same thing as the follow
 * hook. `liveMove` is cleared on every screen render, so on the scan screen — the screen a
 * beginner is on when this matters — a turn used to reach nothing at all; and a refused cube's
 * turns must not drive a walk, but a refused cube is still a cube that was turned. The one thing
 * every turn does, whoever is watching, is invalidate a scan being held for a first report.
 */
function onCubeMove(m) {
  dropHeldScan();
  // The self-check GATES following, and only following: a refused cube has been proved to
  // contradict itself, so letting it drive the walk would animate a cube nobody can vouch for,
  // while everything short of a refusal still follows — mirroring a turn is not a claim about
  // where the cube is. A session that is not there refuses nothing, exactly as cubeRefused()
  // reads it: "no cube" and "a cube known to be wrong" are not the same state.
  if (conn?.mayFollow?.() === false) return;
  liveMove?.(m);
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
  // Including a scan that was waiting to be reconciled: it is evidence about the cube that was in
  // front of the camera, and this may be another one.
  scanAwaitingReport = null;
  clearOffset();
  // The reconnect reading. Until the first report arrives the evidence is "no report" — with a
  // remembered arrangement that is already a picture worth showing (dimmed, unconfirmed), and if
  // the cube never answers, the words are already the true ones. The first report re-reads the
  // evidence; with nothing remembered there is no question to ask and today's flow stands.
  pendingLast = cubes[normaliseIdentity(mac)]?.last ?? null;
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
  if (state.reconnect && state.screen === 'home') refreshScreen();
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
  if (state.screen === 'home') refreshScreen();
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
  // A refused cube's Yes cannot be taken either, for the reason a refused cube's repair scan
  // cannot: the correction would be derived against a report already proved not to add up.
  if (cubeRefused()) {
    markStale('its reports stopped adding up');
    state.reconnect = { ...rc, raw: null };
    return false;
  }
  // Through the SESSION, exactly as a camera repair goes: the user is answering a question about
  // the physical cube ("is this it, right now?"), which is the same KIND of evidence a scan is —
  // an outside observation of the cube, paired with what the cube claimed at that moment. The
  // checker therefore counts it, its constancy rule covers it, and the app's trust and the
  // session's verdict stay one model instead of two. With no session there is nothing to confirm
  // AGAINST, so this refuses rather than deriving privately.
  const offset = conn ? conn.cameraScan(rc.candidate, rc.raw) : null;
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
  // The answer itself can be what refuses the cube: the checker holds every correction it has
  // been shown, and one that MOVED with an unbroken stream between the two is not a correction.
  // `offset` is the previous one in that case, so taking it would keep a correction the checker
  // has just disowned — and call the cube trusted on the strength of it.
  if (cubeRefused()) {
    markStale('its reports stopped adding up');
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
      if (b.dataset.reconnect === 'yes') { confirmReconnect(); refreshScreen(); }
      else go('scan');
    };
  }
}

/**
 * "Tuesday 21:40" — the dress a memory wears. A remembered arrangement is a memory with a
 * timestamp and is shown as one, never as the truth. Empty parts when the stamp is missing.
 *
 * Through `Intl`, in the app's locale, for two separate reasons. The weekday names were a
 * hard-coded English array and the clock a hard-coded 24-hour pad, so a translated app would have
 * said "Tuesday" in the middle of a Chinese sentence and shown 21:40 to a reader whose region
 * writes 9:40 PM — the mechanism was there, this was simply outside it.
 *
 * And a weekday ALONE IS A DATE THAT LIES once it is more than a week old. "Tuesday 21:40" for a
 * cube last seen five weeks ago names this week's Tuesday to every reader. Inside six days a
 * weekday is the friendliest true form; past that it takes a date (found by audit, 2026-09-04).
 */
const SIX_DAYS_MS = 6 * 24 * 60 * 60 * 1000;
function whenWords(ts, now = Date.now()) {
  if (!ts) return { day: '', full: '' };
  const d = new Date(ts);
  const fmt = (opts) => {
    try { return new Intl.DateTimeFormat(locale(), opts).format(d); } catch { return ''; }
  };
  const recent = now - ts < SIX_DAYS_MS && ts <= now;
  const day = recent ? fmt({ weekday: 'long' }) : fmt({ day: 'numeric', month: 'short' });
  const time = fmt({ hour: 'numeric', minute: '2-digit' });
  return { day, full: day && time ? `${day} ${time}` : day || time };
}

/**
 * Can this host reach a radio at all, and by which route?
 *
 * The SAME ladder `installBleBridge` walks, asked without building a bridge: a bridge registers
 * native event listeners, and one constructed at render time beside a live session would sit
 * there warning about every packet it could not place. The one line that can drift — which
 * native platforms are refused until somebody has run the app on a real device — is imported
 * rather than copied, because that list is deliberately kept in one place ("THE FLIP IS THIS
 * LINE", ble-bridge.js).
 *
 * Answered at RENDER time, never memoised: `?platform=` pins the answer for design review, and a
 * value cached before boot published `<html data-platform>` would be the wrong one forever.
 *
 * @returns {'native'|'browser'|'refused-host'|'none'}
 */
function bleReach() {
  if (isTauri && NATIVE_BLE_UNSUPPORTED.includes(hostPlatform())) return 'refused-host';
  if (isTauri) return 'native';
  if (globalThis.navigator?.bluetooth) return 'browser';
  return 'none';
}

/** Whether the Pair button is drawn at all. A control that can never work on this platform is
 *  furniture: it invites a press, fails, and explains afterwards in words written for a
 *  different host. The row still says what the platform can do — the capability is named
 *  everywhere, it is only OFFERED where it exists. */
const canPair = () => bleReach() === 'native' || bleReach() === 'browser';

/** Why, in the user's terms. Host-specific, because "this cannot work here" is useless without
 *  "and here is what does". Every branch keeps the camera in view: it is the path that works on
 *  every platform, and a beginner reading a Bluetooth refusal needs to know the app still does
 *  its job. */
function bleReachNote() {
  switch (bleReach()) {
    case 'native':
      return 'Pairing scans for a nearby cube — turn it first so its radio is awake.';
    case 'browser':
      return 'Pairing opens your browser’s device chooser — turn the cube first so it appears in the list.';
    case 'refused-host':
      // Named for the platform, and true: the Rust and Kotlin BLE paths compile and have never
      // spoken to a radio, so the app refuses rather than offering a connect that would fail in
      // a way nobody could read (ble-bridge.js says what a device run must show first).
      return hostPlatform() === 'ios'
        ? 'Smart cubes are off on iPhone and iPad for now — cubus has not been tried against a real cube on this hardware, and offering it before that would mean guessing. The camera reads your cube here exactly as it does everywhere else.'
        : 'Smart cubes are off on Android for now — cubus has not been tried against a real cube on an Android phone, and offering it before that would mean guessing. The camera reads your cube here exactly as it does everywhere else.';
    default:
      return 'This browser cannot use Bluetooth. Chrome, Edge or the desktop app can — and the camera works either way.';
  }
}

/** How a registry KEY reads on screen. An address is shown as itself; a `name:` key is a filing
 *  detail and is shown as the fact behind it, so no screen ever prints a string a user might
 *  mistake for something they could type into the address field. */
const idWords = (id) => (String(id).startsWith(NAME_PREFIX) ? '(no address)' : `at ${id}`);

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
    // `null` means the cube would not say, and it must stay unknown. `Number(null)` is 0, which
    // is finite — so the old line drew a flat battery for a cube that simply had not answered,
    // which is the "never invent data" rule broken in the most alarming direction available.
    const answer = await conn.requestBattery();
    if (conn !== asked) return;
    const level = answer === null || answer === undefined ? Number.NaN : Number(answer);
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
  // A refusal is about the CUBE, and only a fresh connection can revisit it. Trust sourced from
  // 'cube' means "its own reports say so", which is exactly the claim the checker has disproved —
  // so an anchor or a confirmation must not be able to buy it back. 'camera' and 'generated' are
  // knowledge from elsewhere and are unaffected; the guard is at this choke point rather than at
  // each caller for the same reason every other trust change passes through here.
  if (source === 'cube' && cubeRefused()) return;
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
  const say = $('#cubeLiveSay');
  el.hidden = !on;
  if (!on) {
    // An absent cube announces nothing rather than announcing an absence: the region is emptied,
    // so leaving Settings after a disconnect does not read the last state out again.
    if (say) say.textContent = '';
    return;
  }
  const ok = state.cube.trusted;
  el.classList.toggle('stale', !ok);
  const who = liveCubeLabel();
  // The button's NAME says what it is and where it goes — it is a control, and its name has to
  // survive the state changing under it. The STATE is the status region's, beside it.
  el.setAttribute('aria-label', `${who} — smart cube settings`);
  const words = ok
    ? `${who}: tracking`
    : `${who}: position unverified — ${state.cube.staleWhy || 'read the cube again'}`;
  if (say && say.textContent !== words) say.textContent = words;
  el.title = ok
    ? `${who} connected${Number.isFinite(state.battery) ? ` · ${state.battery}% battery` : ''} · tracking`
    : `${who} connected, but ${state.cube.staleWhy || 'its position is unverified'} — read the cube again`;
}

function setConnected(on, name = '', mac = '') {
  // Compared so a call that changes nothing does not re-render: doConnect's failure path calls
  // setConnected(false) while already disconnected, and the resulting teardown discarded the DOM
  // the caller's catch was about to write its error into.
  const before = `${state.connected}|${state.cubeName}|${state.cubeMac}`;
  // normaliseIdentity, not normaliseMac: five of the ten protocols never expose an address, and
  // stripping their `name:` key here emptied state.cubeMac — which every registry write then
  // bailed on (`!state.cubeMac`), so those cubes were never remembered and never matched their
  // own row in Settings.
  state.connected = on; state.cubeName = name; state.cubeMac = on ? normaliseIdentity(mac) : '';
  state.battery = null;
  // The anchor belongs to a connection, not to the app.
  if (!on) state.anchored = false;
  const live = $('#cubeLive');
  if (live) paintTrust(live);
  if (state.screen === 'settings' && before !== `${state.connected}|${state.cubeName}|${state.cubeMac}`) {
    renderScreen();
  }
}

/**
 * The identity a connected cube is remembered under — ITS OWN, and nothing else's.
 *
 * A cube with no address is remembered under its NAME rather than under an empty string. Only the
 * GAN protocols expose a MAC; the others report '', and keying the registry on that makes every
 * such cube the same cube — one nickname, one shared last-seen record, and a reconnect that
 * greets a stranger with another cube's memory.
 *
 * `name:` is the registry's own prefix (NAME_PREFIX), spelled once there: every path that stores
 * or looks up a record runs the id through `normaliseIdentity`, which is what makes this a key
 * rather than a string that merely looks like one. It was a bare template literal here and
 * `normaliseMac` everywhere else, so these cubes were documented as remembered and were in fact
 * never written at all.
 *
 * ONE ARGUMENT, and that is the fix of 2026-09-05. This used to fall back to the address the
 * connect attempt had been GIVEN — `macFromUi` or, failing that, `lastCubeMac()`, the most
 * recently used remembered cube. So connecting an addressless cube while a GAN was the last cube
 * used filed it under the GAN's MAC: two cubes, one record, each inheriting the other's nickname,
 * history and remembered arrangement, and a reconnect question about the wrong cube. The session's
 * resolved address is the only evidence there is — the protocol layer publishes `deviceMAC` when
 * it has one, including one it took from the provider and then VERIFIED against the cube — so an
 * empty one means no address was established, and the name is the honest key.
 */
function sessionIdentity(session) {
  return normaliseIdentity(session?.mac)
    || normaliseIdentity(NAME_PREFIX + (session?.name || 'cube'));
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
  if (conn) { try { await conn.disconnect(); } catch {} conn = null; }
  try {
    // The self-check needs cubejs, and a cube paired before the solver finished loading would be
    // REFUSED for a reason that has nothing to do with the cube — an alarming verdict caused by
    // our own start-up ordering. Wait for it instead; it is already loading.
    if (!Cube) await loadSolver().catch(() => {});
    if (!Cube) throw new Error('still starting up — try again in a moment');
    // Validated before it is offered as an address. The field accepts whatever was typed and a
    // remembered key may be a `name:` id, and the protocol layer takes this as a MAC — so
    // anything that is not one is no answer at all, and letting it through asked the cube to be
    // found at an address that does not exist.
    const typed = normaliseMac(String(macFromUi ?? '').trim()) || lastCubeMac();
    // The typed address is a FALLBACK, not the source. Nearly every cube broadcasts its own and
    // the protocol layer reads it per brand; this only answers when the advertisement did not
    // carry one. It used to be mandatory in the browser, which asked a beginner for a hexadecimal
    // address before they could connect at all.
    //
    // It is an ANSWER TO THE PROTOCOL LAYER and never an identity: what it supplies here is
    // checked against the cube (the library verifies a provided MAC before the connection stands)
    // and comes back as `session.mac` if it holds. Feeding it to the registry directly is what
    // made an addressless cube inherit the last cube's record — see sessionIdentity.
    const session = await connectCube({
      Cube,
      macProvider: typed ? async () => typed : undefined,
    });

    // Every callback is scoped to ITS session: a slow packet or a late disconnect from a
    // connection since replaced must not mutate the new cube's state or tear it down.
    session.onFacelets((facelets, serial) => { if (conn === session) onFacelets(facelets, serial); });
    // Following runs on moves (immediate); snapshots (~1Hz) only correct drift — a turn sequence
    // completed inside one second has no intermediate snapshots.
    // Through onCubeMove, not straight to `liveMove`: the self-check's gate lives there so the
    // test seam passes through the same one the driver does, and so does the one piece of
    // bookkeeping that must happen on EVERY turn whether or not a screen is following.
    session.onMove((m) => { if (conn === session) onCubeMove(m); });
    session.onDisconnect(() => { if (conn === session) onDisconnect(); });
    // Trust lapses HERE rather than in a screen's handler, so a verdict changing while you are in
    // Settings is not dropped. This replaces the driver's `gap` event and is a better trigger: the
    // old one fired on a serial jump, this one fires when the cube's own moves and its own
    // reported state stop agreeing — which is what a lost turn actually IS, proved rather than
    // inferred, and available on every brand instead of only those that number their moves.
    session.onVerdict((verdict) => {
      if (conn !== session) return;
      if (verdict === VERDICT.REFUSED) markStale('its reports stopped adding up');
    });
    // A lost turn is its OWN signal, not a shade of the verdict (2026-09-04). The whole point of
    // tolerating a loss is that a trusted cube SURVIVES it — so on the cube this matters most for,
    // the verdict and the reason are identical before and after, and a screen watching the verdict
    // announces nothing. Standing follow down, refusing the timer's result and saying what
    // happened all live behind onMovesLost, and this is the door they arrive through.
    session.onMovesLost(() => { if (conn === session) onMovesLost(); });

    conn = session;
    adoptConnection(sessionIdentity(session), session.name || 'Smart cube');
    // The reply is NOT fed to onFacelets here. It arrives on the event stream too, and the
    // permanent listener above already handles it — passing it on as well delivered the
    // connection's first report twice, which runs the reconnect classification against a question
    // its own first answer had already closed.
    session.requestState().catch((e) => {
      // Said, not swallowed: this rejection used to vanish into an empty catch, and the screen
      // showed a connected cube that had said nothing. The passive stream may still deliver a
      // first report later; until it does, the reading is 'no report' and the screens say so.
      if (conn !== session) return;
      console.warn('the cube did not answer its state request', e);
      reportSilence();
    });
    // Ask the cube rather than inventing a number — a flat battery is what disconnects a cube
    // mid-solve, and a mid-solve disconnect is what silently desyncs its tracking from reality.
    void refreshBattery();
  } catch (err) {
    if (conn) { try { await conn.disconnect(); } catch {} }
    onDisconnect();
    throw err;
  }
}

/** Make `facelets` the arrangement the app is about.
 *  `physical` says whether it is the cube in the user's hand — a scan or a confirmed cube report
 *  is; a generated scramble is not, however well we know it.
 *  `setupAlg` is for a caller that ALREADY searched for it — see takeDerivation. */
function adoptCube(facelets, { physical, source, setupAlg = '' } = { physical: false, source: 'generated' }) {
  ingestFacelets(facelets);
  if (setupAlg) takeDerivation(facelets, setupAlg);
  state.cube.isPhysical = physical;
  markTrusted(source);
}

/**
 * Take a setup alg the caller already holds instead of searching for it again.
 *
 * A generated cube arrives WITH its alg (randomScramble does one search and returns both), and
 * deriving it again is the same Kociemba search over the same state for the same answer — the
 * biggest cost of pressing the die, paid on the click, between the old paint and the new one.
 *
 * CHECKED, never trusted: the alg must reproduce `facelets` when applied to a solved cube. That
 * is a couple of dozen move applications — microseconds against the search it replaces — so the
 * shortcut is free AND cannot install a walk that does not lead to the cube on screen. A
 * disagreement means the caller paired the two wrongly; it says so and leaves the state
 * underived, so the pool's answer supplies the alg after all rather than the app drawing a lie.
 */
/** Does applying `setupAlg` to a solved cube produce exactly `facelets`? Move application only —
 *  microseconds, and no search. The one check that makes a setup alg from anywhere usable. */
function reaches(facelets, setupAlg) {
  if (!Cube) return false;
  try { return Cube.fromString(SOLVED).move(setupAlg).asString() === facelets; } catch { return false; }
}

function takeDerivation(facelets, setupAlg) {
  if (!Cube) return;
  const c = state.cube;
  if (!reaches(facelets, setupAlg)) {
    console.error('setup alg does not reach the cube it came with — deriving instead', { setupAlg });
    return;
  }
  // Written BEFORE the commit, so takeSetupAlg inside finishSolve takes its "already carried in
  // and already checked" branch instead of re-deriving and re-checking the alg handed in here.
  c.setupAlg = setupAlg;
  try {
    // ONE CHECKED-SOLUTION COMMIT PATH (2026-09-05). This function used to repeat all of
    // finishSolve — the oracle applying the solution, the assignment, the tokenizer, the
    // per-step states — and then set `crossChecked = false`, so the first use of the cube ran
    // every one of them a second time (`solve()` answers a carried solution by calling
    // finishSolve). Two copies of one rule is how one copy quietly stops being verified, and
    // this one had already drifted: the flag said "unverified" about a check cubejs had just
    // performed and passed.
    //
    // The oracle rule is unchanged, only spelled once: `crossChecked` is true because cubejs
    // ACTUALLY SAID YES — it applied this solution to these facelets and found them solved —
    // and false whenever it could not run. That is an independent check now in a way the old
    // comment here predates: the alg comes from the two-phase engine (rollScramble inverts the
    // pool's answer, 2026-08-31), so this is cubejs checking a different implementation's work,
    // where it used to be cubejs checking cubejs.
    //
    // Undoing the setup alg solves the cube by construction, which is why no search follows:
    // the app used to hand this state to a second Kociemba search and then discard an answer it
    // already held — the longest thing a press of the die waited on.
    finishSolve(c, invertAlg(setupAlg));
  } catch (err) {
    // A DEFINITE refutation is the only thing that reaches here — finishSolve throws on one and
    // commits nothing before it. The cube is left underived and with no setup alg, exactly as
    // this function left it before, so the pool's answer supplies both rather than the app
    // drawing a walk nobody checked. (An oracle that could not RUN is not this branch: it has
    // refuted nothing, so finishSolve commits with `crossChecked` false and the next solve
    // retries the check.)
    c.setupAlg = '';
    console.error('the inverse of the setup alg does not solve the cube — deriving instead', err);
    return;
  }
  // It took moves to get here, so there are moves back — and an arrangement a real alg reaches is
  // a real arrangement, which is what the check above has just established. `unsolvable` is
  // written beside `solvable` rather than left to whoever ingested: the two are one verdict, and
  // a record carrying both as true is a state nothing downstream can read correctly.
  c.solvable = true;
  c.unsolvable = false;
  c.derived = true;
}

/** The state after each move of a walk, so the 2D net and the move list can co-move with the 3D
 *  animation. Move application only — no search. A short array is not fatal (the chips fall back
 *  to jumping) but it is never expected, so it says so rather than degrading quietly. */
function stepStates(facelets, moves) {
  const sf = [];
  try {
    const b = Cube.fromString(facelets);
    sf.push(b.asString());
    for (const m of moves) { b.move(m); sf.push(b.asString()); }
  } catch (err) {
    console.warn('per-step facelets unavailable; the move list will jump rather than step', err);
  }
  return sf;
}

/** A snapshot from the connected cube. Always records what the cube says; only changes the
 *  SUBJECT when the subject is that cube — otherwise pressing Random would have its arrangement
 *  quietly replaced by the real one a second later. */
function onFacelets(reported, serial) {
  if (!reported) return;
  // The self-check gates the STATE channel too, and this is the half that was missing: only moves
  // were gated, so a refused cube's reports went on becoming the app's subject — driving the net
  // and the 3D cube, being written into the registry as "as we last saw it", and standing as the
  // raw report a camera scan would derive a correction from. A refusal is a PROOF that this
  // cube's two channels disagree, which makes its state reports exactly as unusable as its moves
  // and rather more dangerous, because a state is a claim about where the cube IS.
  //
  // Here rather than in the session listener, so the test seam (window.cubusFeed) passes through
  // the same gate the driver does — a seam that skipped it would be a lookalike, and this
  // behaviour would have no test that could see it. The checker has already been shown this
  // report by the time either caller runs, so the report that CAUSED the refusal is dropped too,
  // which is the point.
  if (cubeRefused()) return;
  // What the cube literally said, before any correction. A repair derives the offset from the
  // RAW report — deriving it from a corrected one produces the identity.
  state.reported = reported;
  lastSerialSeen = Number.isInteger(serial) ? serial & 0xffff : null;
  // A camera reading taken before this connection had said anything is RECONCILED here, against
  // the report it was waiting for. Two things this is, in order:
  //
  //   * the repair that could not run at scan time. A correction is derived from what the cube
  //     CLAIMS, and the cube had claimed nothing — so the scan granted camera trust with the
  //     repair skipped, and this very report then replaced the scanned arrangement while keeping
  //     that trust. Reconciling first means the report AGREES with the scan (that is what the
  //     correction makes true) instead of overwriting it.
  //   * the answer to the reconnect question. Six sides establish what a two-sided memory
  //     comparison can only spot-check, so the question closes rather than being asked over a
  //     cube the camera has just read in full.
  //
  // Both of those rest on the cube having held still since the scan, so that is asked FIRST, and
  // asked of the session's own turn count rather than of this file having noticed. A turn that
  // arrives through onCubeMove drops the hold where it happens; this catches one the cube counted
  // and our door never delivered, and it is the same question either way — an offset between an
  // arrangement the camera saw and one the cube has since turned away from is invented.
  if (scanAwaitingReport && scanAwaitingReport.turns !== turnsReported()) dropHeldScan();
  if (scanAwaitingReport) {
    const scanned = scanAwaitingReport.facelets;
    scanAwaitingReport = null;
    awaitingReport = false;
    state.reconnect = null;
    const repaired = repairTracking(scanned, { reconciling: true });
    if (repaired && !repaired.ok) {
      // The camera and this cube cannot be related by any fixed correction. The scan was good
      // knowledge of the cube in the hand; it is not knowledge of what this stream means, and a
      // stream nothing could reconcile must not go on being read as the trusted subject.
      markStale('a scan and the cube’s first report could not be reconciled');
      return;
    }
  }
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
      if (state.screen === 'home') refreshScreen();
      else repaintSettings();
      return;
    }
    // Nothing remembered (or nothing derivable): no question to ask — today's flow, below. A
    // question opened over the memory alone ('no report') closes here: the report is the better
    // evidence, and it said the memory was not usable after all.
    const hadQuestion = Boolean(state.reconnect);
    state.reconnect = null;
    if (hadQuestion) {
      if (state.screen === 'home') refreshScreen();
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
  else if (changed && state.screen === 'home') refreshScreen();
}

// ---- session store (recent solves) -----------------------------------------------------------
// There used to be five fabricated solves here, handed to anyone whose session was empty — so a
// person who had never solved a cube was shown their "recent solves", complete with turn rates.
// An empty session now reads as empty. Placeholder data that looks real is worse than nothing,
// and this is the screen where that costs the most.
/** Who timed a solve. Exactly these two: `cubeTimed` in solve-stats.js reads `source === 'cube'`
 *  as its licence to put a solve into a turn rate, so an unrecognised value must never survive
 *  the boundary below wearing that name. */
const SOLVE_SOURCES = new Set(['cube', 'manual']);
/** A plausible inspection: from the moment the scramble was reached to the first turn. Bounded
 *  because a stored number with no ceiling is a statistic waiting to be fabricated; a day is
 *  generous past anything a person inspects for and short of anything a clock glitch invents. */
const MAX_INSPECTION_MS = 24 * 60 * 60 * 1000;

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
    // What a CUBE-timed solve knows and a hand-timed one cannot — and, until 2026-09-05, what
    // this whitelist silently ate. `pushSolve` writes them and then reads the list back THROUGH
    // here to write it out again, so every recorded solve erased them from every older record:
    // the turn rate on Stats could not be computed by construction, and "0 cube-timed solves"
    // was the honest report of a list this function had emptied.
    //
    // Per field, and only when usable. A missing key is the ABSENCE this app owes the reader —
    // `moves: 0` or `source: 'cube'` over a hand-timed row would be a fabricated fact about a
    // solve, which is the one thing the statistics module exists to refuse.
    ...(ok(s) && SOLVE_SOURCES.has(s.source) ? { source: s.source } : {}),
    ...(ok(s) && Number.isSafeInteger(s.moves) && s.moves > 0 ? { moves: s.moves } : {}),
    ...(ok(s) && Number.isFinite(s.inspectionMs) && s.inspectionMs >= 0 && s.inspectionMs <= MAX_INSPECTION_MS
      ? { inspectionMs: s.inspectionMs } : {}),
  }));
}

/** Record a solve. RETURNS whether the browser actually kept it: a private window or a full
 *  quota fails this write, and a time that showed on the clock and then vanished from "last five"
 *  with nothing said is indistinguishable from a bug in the timer. The caller says so on screen;
 *  save() already warns to the console. */
function pushSolve(time, extra = {}) {
  const list = recentSolves();
  return save('cubusSolves', {
    list: [
      // Highest n, not the first row's. Corrupt rows keep their place with a placeholder n of 0,
      // so reading position zero could restart numbering at 1 half-way through a session.
      // `moves` and `source` are what a cube-timed solve knows and a hand-timed one cannot:
      // a turn rate is a fact about a move stream, so it may only ever be computed from these.
      { n: list.reduce((hi, s) => Math.max(hi, s.n || 0), 0) + 1, time, scramble: currentScramble || '—', at: Date.now(), ...extra },
      ...list,
      // 100, not 50. Stats offers an ao100, and a 50-record history made that statistic
      // unreachable by construction — a number on screen that could never stop being an em dash.
      // The retained span also has to outlast the seven-day chart drawn beside it.
    ].slice(0, 200),
  });
}

/** Take the most recent SHOWN solve back off the list.
 *
 *  The one destructive edit the app offers, and it exists because the alternative was permanent:
 *  a fumbled press, or a clock a cube started while the cube was only being tidied, went into
 *  every average from then on and could be removed only by editing localStorage by hand.
 *
 *  The newest row WITH A TIME, not simply the first. `recentSolves()` keeps corrupt records in
 *  place on purpose — that is what stops an average quietly reaching further back — so the first
 *  row and the first row a person can SEE are not always the same one. The button is drawn beside
 *  a time; it has to remove that record and not an unreadable one hiding above it.
 *
 *  Returns whether anything was removed AND stored. */
function dropLastSolve() {
  const list = recentSolves();
  const at = list.findIndex((s) => s.time);
  if (at < 0) return false;
  return save('cubusSolves', { list: [...list.slice(0, at), ...list.slice(at + 1)] });
}

/** The scramble a finished solve is recorded against. Written by the caller that PUT one in
 *  play, never by the roll itself — see randomScramble. */
let currentScramble = '';

/** The eighteen face turns. Enough to recognise a state that is one turn from solved. */
const SINGLE_MOVES = Object.freeze(
  ['U', 'D', 'L', 'R', 'F', 'B'].flatMap((f) => [f, `${f}'`, `${f}2`]),
);

/** How many trivial draws in a row before we stop believing the random source. */
const MAX_TRIVIAL_REDRAWS = 8;

/**
 * Is this state already solved, or one turn from it?
 *
 * TNoodle rejects these, so a scramble claiming to be WCA-standard has to as well. It asks the
 * STATE rather than the solver, which is what makes it exact: "our answer came back short"
 * would depend on the search finding the optimal route, and two-phase does not promise one.
 *
 * It essentially never fires — 19 states out of 43,252,003,274,489,856,000, about four in 10^19
 * draws. That is the point: eighteen move-applications on a path that already runs a Kociemba
 * search, and the conformance claim becomes true rather than nearly true.
 */
function trivialState(cube) {
  if (cube.isSolved()) return true;
  const facelets = cube.asString();
  return SINGLE_MOVES.some((m) => {
    const c = Cube.fromString(facelets);
    c.move(m);
    return c.isSolved();
  });
}

/**
 * Roll one, without putting it in play.
 *
 * WCA-standard on both halves now. The STATE is a uniform draw from a cryptographic source
 * (random-state.js) — that half was always right. The LENGTH is the half that was not: this
 * handed the state to cubejs's `solve()`, whose default bound is 22, so 96% of scrambles came
 * out above God's number and 79.5% were exactly 22 (measured, n=200).
 *
 * The bound is not a preference, it is the promise the solve path already keeps:
 * `solveWithinGodsNumber`, one implementation, so a scramble and a solution cannot come to
 * disagree about what 20 means. Inversion preserves length, so a <= 20 solution is a <= 20
 * scramble — and because invertAlg is an involution, inverting the scramble hands that solution
 * straight back, which is how the solve side gets its answer without searching (takeDerivation).
 *
 * Asking cubejs for 20 instead is the obvious one-argument fix and is a trap: measured mean
 * 5,644 ms and worst 66 s per scramble, against 4 ms median through this engine, which searches
 * six interleaved views under a node budget rather than depth-limited IDA* on one.
 *
 * Pure on purpose: `currentScramble` is the scramble a timed solve is RECORDED against, so a
 * roll that happens before anyone asked for one must not touch it. Rolling ahead while it did
 * would have filed a solve under a scramble the solver never saw.
 */
async function rollScramble() {
  // cubejs no longer SEARCHES here, but it is still the parser and the oracle: a state has to
  // be drawn into a Cube, and the answer has to be checked by applying it.
  if (!solverReady) return null;
  for (let draw = 0; draw < MAX_TRIVIAL_REDRAWS; draw++) {
    // Crypto random-state, never Cube.random(): the uniform draw is the project's scramble rule
    // (AGENTS.md), and Math.random is exactly the quiet weakening it forbids.
    const r = randomCube(Cube);
    if (trivialState(r)) continue;
    const facelets = r.asString();
    const solution = await solveWithinGodsNumber(facelets, {
      solve: (f, bounds) => solverWorker().solve(f, bounds),
    });
    if (solution === undefined) return null; // aborted before an answer; nothing to show
    const alg = invertAlg(solution);
    // Zero trust at the boundary — unchanged in substance and now worth MORE than it was. The
    // answer crossed a thread and came from the two-phase engine; cubejs, a different
    // implementation, checks it by applying it. Before this it was cubejs checking cubejs.
    if (!alg || !reaches(facelets, alg)) {
      console.error('solver returned a scramble its alg does not reach — refusing it');
      return null;
    }
    return { facelets, alg };
  }
  // Unreachable short of a broken random source: it needs MAX_TRIVIAL_REDRAWS draws in a row
  // from a set of 19 states. Loud, because the alternative is a die that quietly does nothing.
  console.error('rollScramble: every draw was a trivial state — the random source is broken');
  return null;
}

/** One cube rolled ahead, waiting to be asked for. */
let nextRoll = null;
let rollPending = false;

/**
 * Roll the next one before anybody asks for it.
 *
 * A Kociemba search blocks whichever thread runs it — 2-196 ms measured across presses in
 * WebKit, and the spread is the search's, not the machine's. On the UI thread that is up to
 * twelve dropped frames, and moving it off the click alone only moved the stutter a beat later.
 *
 * It goes to the SOLVER POOL, the same place a solve goes. There used to be a second worker for
 * this — the since-deleted `lib/scramble-worker.js` — carrying its own ~34 MB of cubejs
 * Kociemba tables and 3-6 s of
 * build, plus a `warmRoller()` to start it early. The pool's workers already hold warm two-phase
 * tables, so that entire worker was the app paying twice for a capability it had once.
 *
 * The die never DEPENDS on this having finished: an unrolled press rolls on the spot. Late is
 * slow, never wrong.
 */
function schedulePreroll() {
  if (rollPending || nextRoll || !solverReady) return;
  rollPending = true;
  void rollScramble().then(
    (rolled) => { rollPending = false; if (rolled && !nextRoll) nextRoll = rolled; },
    (err) => {
      // Loud, and not fatal: the next press rolls on demand and reports its own failure.
      rollPending = false;
      console.warn('pre-roll failed; the next press will roll on demand', err);
    },
  );
}

/**
 * The next random cube, and the alg that reaches it.
 *
 * PURE with respect to `currentScramble`, which the CALLER puts in play once it knows the roll is
 * still wanted. It used to be set here, inside the await — so a roll that landed after the user
 * had already started a solve re-filed that running solve under a scramble it was never about
 * (found by audit, 2026-09-04). Rolling is a real Kociemba search now, so that window is seconds
 * wide rather than notional.
 */
async function randomScramble() {
  // Taken BEFORE any await: two presses must not be handed the same pre-rolled cube.
  const ready = nextRoll;
  nextRoll = null;
  const rolled = ready ?? await rollScramble();
  schedulePreroll(); // there should always be one waiting
  if (!rolled) return { facelets: '', alg: '' };
  return rolled;
}

/** This roll is the one a solve will be recorded against. */
const putInPlay = (rolled) => { if (rolled?.alg) currentScramble = rolled.alg; };

/** This roll arrived at a moment nothing could use it — hold it for the next press rather than
 *  throwing away a search somebody has already paid for. Never over a roll already waiting: the
 *  one in hand is at least as fresh, and a scramble is a scramble. */
const parkRoll = (rolled) => { if (rolled?.facelets && rolled.alg && !nextRoll) nextRoll = rolled; };


export { state };

// ===============================================================================================
// Screens
// ===============================================================================================
/** The routable screens. Exported as a TEST SEAM, the way `state` and `window.cubusFeed` are:
 *  the error boundary in renderScreen answers "a builder threw", and the only honest way to test
 *  that is to hand it one that does. Not API — nothing in the app reads it from outside. */
export const SCREENS = {};
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

/** Aborted by the next render. A listener a mount puts on something that OUTLIVES its screen —
 *  the document, or the parked <cubus-cube> — must carry this signal, or the handlers stack up
 *  one per visit and the element arrives at its next screen still driving the last one's DOM.
 *  Captured at the top of an async mount, never read late: by the time an await returns, the
 *  module-level value may already belong to the screen that replaced it. */
let screenAbort = null;

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
  // net in both compositions and on every platform (.scan-faces).
  //
  // `facing="environment"` off the desktop, and it is not a preference — it is which way the
  // camera points. A handheld has two, and only one of them can see a cube you are holding;
  // getUserMedia with no constraint hands over the platform's default, which on a phone is the
  // front one, so the scanner opened pointed at your face. Desktops are deliberately left
  // asking for nothing: there a facing mode names a different physical machine rather than a
  // different lens (packages/cube-scanner/src/camera.ts says so at the constraint itself).
  // A pinned camera still wins over this — deviceId is checked first — so choosing one from the
  // menu is never overridden by the hint.
  return {
    html: `<div class="cols twin-low" style="--primary-share:0.66">
    <div class="col">
      <div class="card scanboard">
        <ai-scan-panel headless autostart${isDesktopHost() ? '' : ' facing="environment"'}></ai-scan-panel>
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
          <div class="sub scan-say" id="scanHow" role="status" aria-live="polite" style="margin-top:4px">${registered ? 'Opening the camera…' : 'Loading the scanner…'}</div>
          <div class="sub scan-hint" id="scanHint" hidden></div></div>
        <button class="btn primary block" id="scanSolveBtn" data-go="home" style="margin-top:auto" disabled>Solve this cube</button>
      </div>
    </div></div>`,
    mount(root) {
      // Captured at the top of the mount, never read late: by the time anything here awaits, the
      // module-level controller may already belong to the screen that replaced this one.
      const signal = screenAbort?.signal;
      // Both hands are on a cube in front of a camera for the length of a scan, so nothing tells
      // the platform anybody is still here. The display sleeping mid-scan is the interruption
      // this audience does not recover from.
      const releaseScanAwake = keepAwake();
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
      // The largest of the warm windows: a scan is seconds of camera and then a solve, so the
      // tables can be built entirely inside time the user is already spending.
      warmSolver();
      const say = $('#scanHow', root), sayTitle = $('#scanHowTitle', root), hint = $('#scanHint', root);
      // "Loading the scanner…" was INITIAL COPY and nothing else: if the bundle never registers —
      // a failed fetch, a parse error, a blocked module — the element stays inert forever and the
      // sentence stays on screen forever, promising a camera that is never opening. A registration
      // that lands replaces it through the panel's own events; one that does not now has an end
      // state and a way out (found by audit, 2026-09-04).
      if (!customElements.get('ai-scan-panel')) {
        const SCANNER_WAIT_MS = 15000;
        let landed = false;
        void customElements.whenDefined('ai-scan-panel').then(() => { landed = true; });
        setTimeout(() => {
          // Guarded on the SCREEN, not only on the flag: this outlives its screen by design.
          if (landed || !root.isConnected || !say.isConnected) return;
          sayTitle.textContent = t('The scanner did not load');
          say.textContent = t('The camera part of cubus failed to start, so there is nothing to scan with. Reloading the app usually fixes it. Everything else — the solver, the guide, a smart cube — still works.');
          say.className = 'sub scan-say err';
        }, SCANNER_WAIT_MS);
      }
      // The reconnect confirmation runs INSIDE this screen's own flow, not beside it: the panel's
      // captures are private to it and die with it, so "the repair scan continues from the sides
      // already captured" is true only if the confirmation IS this screen in a confirm mode. Two
      // adjacent matching sides take the user's Yes; one mismatch and the same panel instance
      // simply keeps capturing into the full six-side repair, two sides in.
      let confirming = Boolean(state.reconnect?.candidate);
      const confirmEntry = confirming;
      /**
       * What the camera should see NOW if the remembered arrangement is right.
       *
       * NOT the frozen candidate, which is what this compared against and is wrong the moment
       * anybody turns the cube: the question is asked on reconnect, the check happens seconds
       * later with the cube in a hand, and a single quarter turn in between made every side
       * mismatch — a false "not what we remembered" that cost the user a full six-side scan
       * (found by audit, 2026-09-04).
       *
       * The candidate carried forward by whatever the cube has reported since. If the candidate
       * is right then `candidate · raw⁻¹` is the correction, it is constant under later turns
       * (cube-trust.js), and applying it to the LATEST report says where the cube is now. This is
       * a PREDICTION to compare a scan against, not a correction being adopted — which is why it
       * derives here instead of going through the session's checker, whose business is evidence.
       * With nothing to carry forward it is the candidate, exactly as before.
       */
      const expectedNow = () => {
        const rc = state.reconnect;
        if (!rc?.candidate) return null;
        if (!rc.raw || !state.reported || state.reported === rc.raw) return rc.candidate;
        const off = deriveOffset(rc.candidate, rc.raw, Cube);
        return (off && applyOffset(off, state.reported, Cube)) || rc.candidate;
      };
      const CONFIRM_HOW = 'We remember this cube. Show any two sides that meet along an edge — the front, then the top, works well. If both match what we remember, that’s your cube confirmed with no full scan; if either differs, keep going and the camera reads all six.';
      if (confirming) {
        sayTitle.textContent = t('Checking your cube');
        say.textContent = t(CONFIRM_HOW);
      }
      // "Solve this cube" is a promise about THIS screen's scan, so it is only pressable once a
      // scan stands complete — and a correction that re-opens the verdict takes it away again.
      const solveBtn = $('#scanSolveBtn', root);
      /** Did this screen refuse the finished scan? Screen-local, and cleared only by a scan that
       *  is no longer complete — see the scan-progress handler. */
      let refused = false;
      const tiles = [...root.querySelectorAll('.scan-face')];
      const paint = (cells, colors) => cells.forEach((c, i) => { c.style.backgroundColor = classColor(colors[i]); });
      // The six sides are the cube's net, everywhere (decided 2026-08-30). There used to be a
      // second arrangement for a finger in portrait — one face large over a strip of five — and
      // with it a `.focus` class, a `--focus` flag read back out of the stylesheet, and a tap
      // that meant "show me this side" on a strip tile and "correct this sticker" anywhere
      // else. All of it is gone with the layout it served: no rule styles `.focus` any more, so
      // keeping the machinery would have been a switch with one position. What the removal
      // costs is written down where the decision is (dev-docs/stage-contract.md).
      const faces = $('.scan-faces', root);

      // ---- the board's keyboard path -----------------------------------------------------------
      // 54 stickers are 54 buttons, but ONE tab stop: the board is a composite widget with a
      // roving tabindex. Tab lands on it once; the arrows walk the stickers (Left/Right by one,
      // Up/Down by a row within a side, Home/End to the board's ends); Enter is the click the
      // pointer would have made, heard by the same delegated listener. Every cell is inspectable
      // by arrow — its label carries the side, the position and the reading — and aria-disabled
      // says which ones a press will be refused on, without swallowing the event the way real
      // `disabled` would.
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
      // A menu, said as one: without a role it is a div of buttons, and a screen reader gives no
      // hint that Escape closes it or that its items belong together.
      menu.setAttribute('role', 'menu');
      menu.setAttribute('aria-label', t('Camera and scan'));
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
        for (const b of items) {
          const now = b.dataset.value === active;
          b.classList.toggle('now', now);
          b.setAttribute('aria-checked', String(now)); // the tick is the look; this is the fact
        }
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
          b.setAttribute('role', 'menuitemradio');
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
      navigator.mediaDevices?.addEventListener?.('devicechange', onDevices, { signal });
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
        // Focus goes IN. A popover that opens behind the focus ring is one a keyboard cannot
        // reach without tabbing through everything after the button that opened it.
        (menu.querySelector('.now') ?? menu.firstElementChild)?.focus();
        ev.stopPropagation();
      };

      /** The two voices of the scan, and the only thing this writes: a pinned notice (what the
       *  scanner needs and why — it stands until the situation changes) and the transient camera
       *  hint. Lifted out of the scan-progress handler (2026-09-05), which had grown to hold four
       *  unrelated jobs; this one is the words, and it touches nothing but the three elements
       *  that carry them.
       *
       *  The hint used to overwrite the explanation within one tick, which made every refusal
       *  look like a silent crash. The scanner's prose passes through t(): its sentences are
       *  exact English strings, so a catalog can translate them here without the scanner package
       *  knowing languages exist. Sentences with colour words baked in pass through untranslated
       *  until their call sites move to placeholder form — the seam dev-docs/i18n.md tracks. */
      const paintSay = (p) => {
        const n = p.notice;
        if (n) {
          sayTitle.textContent = t(n.title);
          // Translate FIRST, substitute after: a notice carrying a count or a side name keeps its
          // sentence whole in the catalog instead of arriving pre-assembled and untranslatable.
          say.textContent = t(n.body, ...(n.params ?? []));
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
      };

      /** The two-side reconnect check, folded into a running scan. Its own job, lifted out of the
       *  scan-progress handler along with the words (2026-09-05): the handler was writing status
       *  messages, painting stickers, discovering cameras and answering a question about the
       *  user's cube, all in one body. Called LAST, for the reason its own comment gives. */
      const answerFromSides = (p) => {
        // ---- reconnect confirmation ----------------------------------------------------------
        // Each captured side is compared with the candidate — by its centre colour (the scanner
        // names a side by its centre, the one sticker a turn cannot move), up to rotation, and
        // EXACTLY: the scanner's own two-sticker tolerance is one short of a quarter turn's
        // three, so here a misread costs a full scan and never a false yes. Last, so its words
        // stand over the generic caption — but never over the scanner's own pinned notice.
        if (confirming && state.reconnect?.candidate && !p.notice && p.phase !== 'error') {
          const sides = p.captured.map((c) => ({ face: c.face, stickers: c.colors.map((ci) => NET_FACES[ci] ?? '?').join('') }));
          const check = confirmCheck(expectedNow(), sides, Cube);
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
      };

      /** The camera row: which device is on, and what it is called. Cameras come and go, and the
       *  menu is built once — so a device answering for the first time is also the moment its
       *  LABEL becomes readable (permission), which is why the list is rebuilt here rather than
       *  only on `devicechange`. Lifted out of the scan-progress handler, 2026-09-05. */
      const paintCameraRow = (p) => {
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
      };

      panel.addEventListener('scan-progress', (e) => {
        const p = e.detail;
        // Anything other than a finished scan means the orientation is open again — a correction
        // that breaks validity must not leave canonically-repainted tiles claiming otherwise, nor
        // a half-finished settle turn hanging over tiles about to be repainted as shown.
        if (p.phase !== 'done') { settled = false; clearTurns(); }
        // A scan this screen REFUSED stays refused until there is a new one to judge. The panel
        // reports `complete` on every state change once it has a finished scan — and `complete`
        // deliberately SURVIVES a camera reopen, which is what stops a reopened camera
        // overwriting an accepted scan — so a refusal ("the camera and the cube disagree,
        // nothing was changed") was undone by the very next tick, handing back an enabled Solve
        // button over a cube the screen had just said it did not believe (found by audit,
        // 2026-09-04). The flag is this screen's own, because the panel is right not to carry it:
        // the panel judged the scan legal, and what was refused is what the APP made of it.
        // Cleared by a scan that is no longer complete — a restart, or a capture that reopens the
        // verdict — and by the next accepted scan-complete.
        if (!p.complete) refused = false;
        solveBtn.disabled = !p.complete || refused;
        paintSay(p);
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
        lastCaptured = p.captured;
        refreshCellNames();
        // The twin follows the scan side by side rather than waiting for all six.
        if (!settled) stateCube.setAttribute('facelets', partialFacelets(p.captured));
        paintCameraRow(p);
        answerFromSides(p);
      });
      // A scan the SCANNER refused is a scan this screen must not offer to solve either. It
      // restarts itself and explains why through scan-progress, so there is nothing to say here —
      // but `complete` can still be standing from the previous accepted scan, and an enabled
      // Solve over it would walk that older cube while the screen is telling you this one was not
      // readable. (The panel's own fields for a refusal are deliberately absent, so nothing here
      // reads them.)
      //
      // FIRES MORE THAN ONCE PER REFUSAL, since 2026-09-05, and this line is why that is safe.
      // The misread decode moved to a worker, so a refusal is announced at once with
      // `misreadCount: null` — "checking", not zero and not "nothing can be said" — and announced
      // again with the count when it lands. Setting a flag both times is idempotent; counting the
      // events, or reading `misreadCount` as a number, would not be. What the count is FOR is the
      // panel's pinned notice, which arrives on scan-progress and is rendered above with its
      // params, so the "at least N stickers were misread" wording stays the scanner's to prove.
      panel.addEventListener('scan-invalid', () => { refused = true; solveBtn.disabled = true; }, { signal });
      // Only a validated cube leaves this screen.
      panel.addEventListener('scan-complete', (e) => {
        // The panel is torn down on navigation, but an event already in flight still lands. Without
        // this, a scan finishing just after you left could adopt a cube, derive a correction, and
        // navigate you from a screen that no longer exists.
        if (!root.isConnected) return;
        settled = true;
        // The 'done' progress report normally lands first and enables this; belt-and-braces here
        // so a delivered cube can always be walked, whatever order the two events arrive in.
        // Not over a standing refusal, though: that is the one state where a delivered cube is
        // deliberately not walkable, and this line ran before the refusal below could set it.
        if (!refused) solveBtn.disabled = false;
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
          refused = true;
          solveBtn.disabled = true;
        } else {
          refused = false;
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
      const onEsc = (ev) => {
        if (ev.key !== 'Escape') return;
        // Escape returns focus to the control the popover came from, rather than dropping it on
        // <body> — closeSwatches already does that for the picker; the menu's owner is the button.
        const hadMenu = !menu.hidden;
        closePops();
        if (hadMenu) camBtn.focus();
      };
      // `{ signal }` rather than a removal pair in cleanup: the screen's abort is cut on every
      // navigation, so these cannot outlive their screen — the same mechanism the parked
      // <cubus-cube>'s listener relies on. The devicechange listener carries it too.
      document.addEventListener('click', onAway, { signal });
      document.addEventListener('keydown', onEsc, { signal });


      cleanup = () => {
        clearTurns();
        releaseScanAwake();
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

/**
 * Why there turned out to be no walk.
 *
 * The reason is the message, and it used to be one sentence for four different failures: the
 * solver never loaded, no scramble could be rolled, the worker died, the oracle refused the
 * answer. "Could not work it out" blames the CUBE for every one of them, and offers re-scanning
 * as the remedy even when the cube is blameless and re-scanning cannot help (found by audit,
 * 2026-09-04). Each one now says what happened and what to do instead — and none of them says a
 * move count is impossible, which two-phase cannot know.
 *
 * At module scope rather than inside the mount, because the die's own roll fails in exactly the
 * same way and must say exactly the same sentence: a `const` after `if (!walking) return` is in
 * the temporal dead zone on every screen that has no walk, which is precisely where the die's
 * failure had nothing to say at all.
 */
const WALK_FAILURES = {
  'solver unavailable': 'the solver did not load — reload the app',
  'no scramble': 'a scramble could not be rolled — try again',
  'cross-check': 'the answer did not check out — read the cube again',
};

/** Which run of `runProof` owns the shared prove/stop buttons.
 *
 *  A proof's cleanup can land long after a newer proof has taken those controls over: a status
 *  reply that arrives late, a native call that settles after a retarget replaced the walk. The
 *  `finally` runs for the OLD proof either way, and it used to hide the stop button and clear its
 *  handler unconditionally — so the proof actually running could no longer be called off, and
 *  the button that would have done it was gone from the screen (found by audit, 2026-09-05).
 *
 *  A counter rather than a flag, because ownership is "the latest run", and the question is asked
 *  from a cleanup that must still release ITS OWN timers and listeners whatever the answer is. */
let proofRun = 0;

/**
 * Run one native minimality proof, from the press to the state it leaves the button in.
 *
 * Lifted out of `loadWalk` (2026-09-05), which had grown to hold a whole second lifecycle inside
 * a walk load: two waits with different shapes, an optional table generation with a percentage, a
 * readiness poll, two event subscriptions, a stop, and exactly one cleanup path. Everything it
 * needs is an argument, and `fresh()` is the one thing that ties it back to the screen — the walk
 * it was wired for must still be the walk on show, or it writes nothing at all.
 *
 * `sayProved` comes IN rather than being written here; the reason is at the line that passes it.
 *
 * @param {{proveBtn: HTMLElement, cancelBtn: HTMLElement|null, startFacelets: string,
 *          shown: number, fresh: () => boolean, sayProved: (proof: object) => void}} o
 */
async function runProof({ proveBtn, cancelBtn, startFacelets, shown, fresh, sayProved }) {
  // Two waits with different shapes, and they must not be dressed the same. Table
  // GENERATION is known-slow and has a denominator, so it announces itself and shows
  // a percentage. The PROOF has neither: it is milliseconds on a shallow cube and
  // hours on a deep one, and no fraction of it is knowable — so it stays silent until
  // it has actually taken time, and then reports the only honest number it has.
  let unlisten = null;
  let unlistenProof = null;
  let ticking = null;
  let reveal = null;
  let ruledOut = null;
  const startedAt = Date.now();
  // Taken synchronously with the press: from here on, this run owns the buttons until another
  // press takes them. `fresh()` cannot answer this — it is about the WALK, and two proofs about
  // two different walks are exactly the case where the older one's cleanup arrives last.
  const myRun = ++proofRun;
  const owns = () => myRun === proofRun;

  const clock = () => {
    const secs = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
    return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  };
  // "at least N" is a fact, not a spinner: every contour the native side reports has
  // been exhausted, so the answer really is longer than it. Before the first one
  // lands there is nothing true to say beyond the clock.
  const paintWait = () => {
    if (!fresh()) { clearInterval(ticking); ticking = null; return; }
    proveBtn.textContent = ruledOut === null
      ? `proving… ${clock()}`
      : `at least ${ruledOut + 1} · ${clock()}`;
  };
  const showWaiting = () => {
    if (!fresh()) return;
    proveBtn.title = 'A deep cube can take hours to prove. Stop whenever you like — nothing is lost.';
    if (cancelBtn) { cancelBtn.hidden = false; cancelBtn.disabled = false; cancelBtn.textContent = 'stop'; }
    paintWait();
    ticking ??= setInterval(paintWait, 1000);
  };
  const endWaiting = () => {
    // OWNED unconditionally: this run's timer and its reveal stop when this run ends, whoever
    // holds the buttons. Releasing them is never someone else's business, and skipping it would
    // leave a superseded proof repainting a button it no longer writes to.
    clearTimeout(reveal); clearInterval(ticking); ticking = null;
    // SHARED, so only while this run still owns them. A stop hidden by the previous proof's
    // cleanup is a proof that cannot be called off — minutes to hours of native work with
    // nothing on screen to end it.
    if (!owns()) return;
    proveBtn.title = '';
    if (cancelBtn) { cancelBtn.hidden = true; cancelBtn.onclick = null; }
  };

  proveBtn.disabled = true;
  try {
    // Ask before announcing. Preparation is minutes, so a run that needs it says so at
    // once; a run that does not must never flash the word at a person for whom it is
    // already done.
    let readiness = await optimalStatus();
    if (!fresh()) return;
    if (readiness !== 'ready') {
      proveBtn.textContent = 'preparing…';
      try {
        unlisten = await window.__TAURI__?.event?.listen?.('optimal-progress', (ev) => {
          const p = ev?.payload;
          if (fresh() && p?.total) proveBtn.textContent = `${p.stage} ${Math.round((p.done / p.total) * 100)}%`;
        });
      } catch (err) {
        // Preparation still works without the heartbeat — but a silent subscribe
        // failure would make minutes of generation look like a hang, so say it once.
        console.warn('optimal: no progress events; preparation will look quiet', err);
      }
      if (!fresh()) return; // the listen await is an await like any other
      // prepare() answers "preparing" when another call started the generation — the
      // readiness contract is polling status to "ready", not trusting the first resolve.
      await optimalPrepare();
      if (!fresh()) return; // left during generation — the finally still frees the listener
      for (;;) {
        readiness = await optimalStatus();
        if (!fresh()) return; // walked away during generation — start no proof at all
        if (readiness === 'ready') break;
        if (readiness !== 'preparing') {
          // 'cold' here means the generation this call was waiting on DIED in another
          // call — polling a corpse forever was the bug this loop once had.
          throw new Error(`optimal: preparation ended ${readiness}, not ready`);
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    try {
      unlistenProof = await window.__TAURI__?.event?.listen?.('optimal-proof-progress', (ev) => {
        const depth = ev?.payload?.ruled_out;
        if (!fresh() || !Number.isInteger(depth)) return;
        ruledOut = depth;
        if (ticking) paintWait(); // only once the wait is on screen; before that, nothing to repaint
      });
    } catch (err) {
      console.warn('optimal: no proof progress; a long proof will show only its clock', err);
    }
    if (!fresh()) return;

    // The stop is wired BEFORE the proof starts, so there is no window in which a
    // proof is running and cannot be called off.
    if (cancelBtn) {
      cancelBtn.onclick = () => {
        cancelBtn.disabled = true;
        cancelBtn.textContent = 'stopping…';
        void optimalCancel().catch((err) => console.warn('optimal cancel failed', err));
      };
    }
    reveal = setTimeout(showWaiting, PROOF_WAIT_VISIBLE_MS);
    const proof = await optimalProve(startFacelets, { Cube, upperBound: shown });
    if (!fresh()) return; // the finally below is the ONE cleanup path

    // The sentence is the CALLER's to write, and it is written inside the capability-gated
    // block this controller was lifted out of. A minimality claim may originate in exactly two
    // places (AGENTS.md, fourth seam), and optimal.test.mjs sanctions those two BY REGION — so a
    // controller that worded its own result would be a third. This runs the proof; it never says
    // what the proof means.
    sayProved(proof);
    proveBtn.hidden = true;
  } catch (err) {
    if (!fresh()) return;
    // Stopping is a choice, not a failure: the affordance comes back saying what it
    // said before, so a person who changes their mind can simply press it again.
    const stopped = /cancelled/i.test(String(err?.message ?? err));
    proveBtn.textContent = stopped ? PROVE_COPY.button : 'could not prove';
    proveBtn.disabled = false;
    if (stopped) console.info('optimal: the proof was stopped');
    else console.error('optimal proof failed', err);
  } finally {
    endWaiting();
    unlisten?.();
    unlistenProof?.();
  }
}

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
  //
  // Chosen SYNCHRONOUSLY, from arithmetic — that is why `classifyCube` had to stop being a
  // search. The composition is decided before the first frame is composited, so a screen with no
  // walk never briefly draws a transport over one, and a screen with a walk never draws an empty
  // solution card while a search runs.
  const walking = scrambling || classifyCube().solvable;
  // The other reason there is no walk, and the only one worth a sentence. `!solvable` covers both
  // a solved cube (nothing to do, and the picture says so) and an arrangement no turning can
  // produce (nothing to do, and nothing on screen would otherwise explain why).
  const unsolvable = !scrambling && state.cube.unsolvable;
  const label = scrambling ? 'Scramble' : 'Solution';
  const walked = scrambling ? 'scramble' : 'solution';
  // The open reconnect question, on the solve side only — Scramble's subject is always the
  // generated walk. The unconfirmed DRESS (the twin's heading) is worn only while the subject IS
  // the candidate; the question itself stands as long as it is open, because it is about the
  // cube, not about whatever the screen happens to show.
  // Read through a FUNCTION, not captured: this screen retargets in place now (see `update`
  // below), so a question that opens or closes has to be able to change the heading and the ask
  // on a screen that is not being rebuilt. A const here would freeze both at first render.
  const rcNow = () => (scrambling ? null : state.reconnect);
  const stateHeading = () => {
    const rc = rcNow();
    const rcDress = Boolean(rc?.candidate && state.cube.facelets === rc.candidate);
    if (scrambling) return 'Target State';
    if (!rcDress) return 'Initial State';
    if (rc.reading === 'turned') return 'Your cube — as it reports it';
    const when = whenWords(rc.seenAt).full;
    return `Your cube — as we last saw it${when ? `, ${when}` : ''}`;
  };
  // The question: at the top of the sheet, ABOVE the moves, not instead of them — a disconnect or
  // a reconnect must not wipe the guide (the floor never rises), so the walk of the candidate
  // stays walkable while the answer is open, and trust gates what it gates today: Follow.
  const reconnectAsk = () => {
    const rc = rcNow();
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
      <div class="acts">${yes}<button class="btn sm outline" data-reconnect="scan">Check with the camera</button></div>
    </div>`;
  };
  /** Set by mount, once this screen has a walk it can reload. Null while it has none — a solved
   *  cube draws no transport and no solution card, so there is nothing to retarget INTO. */
  let retarget = null;
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
          <div class="progress" title="How far through the ${walked} you are"><span id="progBar"></span></div>
          <span class="done-mark" id="doneMark" hidden title="Done">${icon('check', 14)}</span>
          <span class="num" id="stepLbl" role="status" aria-live="polite" style="color:var(--ink-4);min-width:56px;text-align:right">0 / 0</span>
          ${state.connected ? `<button class="pill${state.cube.trusted ? ' on' : ''}" data-mode="cube" aria-pressed="${Boolean(state.cube.trusted)}" title="Turn your smart cube and the guide keeps up">${escHtml(t('Cube leads'))}</button>` : ''}
          ${scrambling ? `<button class="btn sm primary" id="solveItBtn" hidden>Solve this scramble</button>` : ''}
        </div>
      </div>` : ''}
    <div class="aside">
      <div class="card state-card twin" style="padding-bottom:0">
        <div class="eyebrow-row"><b class="state-h">${escHtml(stateHeading())}</b>
          ${scrambling || settings.devRandCube
            // On Scramble the die IS the screen's re-roll and always shows. On the solve side it
            // loads a random cube that is NOT the one in anyone's hand — a developer shortcut,
            // hidden unless the Advanced toggle asks for it.
            //
            // The die's own status line, beside the button that was pressed. The count in the
            // solution card is where a failed roll is reported when there IS a walk — but a
            // solved cube draws no solution card at all, and there the press used to fail into
            // the console alone: nothing moved, nothing was said (found by audit, 2026-09-05).
            ? `<span class="sub" id="rollSay" role="status" aria-live="polite" style="margin-left:auto;padding-right:8px;color:var(--err-ink)"></span>
              <button id="randCube" title="${scrambling ? 'Roll a different scramble' : 'Load a random scrambled cube'}" aria-label="${scrambling ? 'Roll a different scramble' : 'Load a random scrambled cube'}">${icon('dice', 18)}</button>`
            : ''}</div>
        <!-- 30px above AND ~30px below the net in landscape (bottom = grid row gap 18 + the
             Solution header's 14px pad, with this card's own bottom padding zeroed) — the two
             breathing spaces the eye compares, made equal. The margin is the stylesheet's
             (.state-card .net): beside the cube in portrait the net centres instead. -->
        <div class="net" id="viewNet"></div></div>
      ${unsolvable ? `<div class="card sheet unsolvable-card">
        <div class="follow-note" id="unsolvableNote" style="border-top:0">
          <b>${escHtml(t('This arrangement is not one a cube can be turned into.'))}</b>
          <span class="sub" style="color:var(--ink-4)">${escHtml(t('At least one sticker is somewhere turning a real cube could never put it — a corner twisted in place, an edge flipped, or two pieces swapped — so there is no walk to follow. Read the cube again on Restore, or correct the sticker there.'))}</span>
        </div>
      </div>` : ''}
      ${!walking && rcNow() ? `<div class="card sheet reconnect-card">${reconnectAsk()}</div>` : ''}
      ${walking ? `<div class="card tight solution-card sheet">
        ${reconnectAsk()}
        <!-- The count carries the auto margin, not the button: with it on the button, the header's
             space-between left the number stranded midway between the heading and the pill. The
             count is the heading's ANSWER and belongs at the right edge whether or not anything
             follows it; the buttons then sit beside it, each with a margin of its own. -->
        <div class="card-h bare"><b id="solLabel">${label}</b><span class="sub" id="moveCount" role="status" aria-live="polite" style="margin-left:auto">—</span><button class="pill" id="proveBtn" hidden style="margin-left:12px">${PROVE_COPY.button}</button><button class="pill" id="proveCancel" hidden style="margin-left:6px">stop</button></div>
        <div class="list" id="solList" style="padding:6px 0"></div>
        <div class="follow-note" id="followNote" hidden>
          <span id="followMsg" role="status" aria-live="polite"></span>
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
      // Captured here for the same reason `gen` is: this mount can outlive its screen, and the
      // signal it must hang listeners on is THIS screen's, not whichever one is current when an
      // await comes back.
      const signal = screenAbort?.signal;

      /** The search this screen is currently waiting on, so a superseded one can be stopped.
       *
       *  A press of the die, a reconnect answered, a tier change or leaving the screen all make
       *  the search in flight about a cube nobody is looking at any more — and without this it
       *  ran to its full budget anyway, on every worker in the pool, with the NEXT search queued
       *  behind it. The engine already polls a stop word per solve; an AbortSignal is how that
       *  reaches it, and it cancels without terminating workers or rebuilding their tables. */
      let walkAbort = null;

      // This screen can roll a scramble — start the roller's tables warming now, so the press
      // that asks for one is not the thing that waits for them.
      // Rolling and solving are the same pool now, so one warm-up covers both. This screen
      // solves on entry and on every press of the die; see warmSolver.
      warmSolver();
      if (scrambling || settings.devRandCube) schedulePreroll();
      const cube = newCube({ animate: walking });
      // The view goes on BEFORE the element is connected, the way the scan screen's twin does it.
      // connectedCallback draws immediately, so attributes set after appendChild leave that first
      // drawing framed for the renderer's OWN defaults — no ghosts, and a camera fitted to a
      // cube without them, which is a visibly larger picture than the one that replaces it. It
      // survived only because the element's animation frame happened to run later in the same
      // frame as the mount; that ordering is the engine's to change, and nothing tested it.
      cube.setAttribute('ghosts', v.ghosts ? 'floating' : 'none');
      for (const [k, attr] of VIEW_ATTRS) cube.setAttribute(attr, String(v[k]));
      $('#viewCube', root).appendChild(cube);
      applyNetColors();
      const paintNet = buildNet($('#viewNet', root));
      paintNet(scrambling ? SOLVED : state.cube.facelets);
      // The reconnect answer, wired before any await: the solver can take seconds or fail, and
      // the question must be answerable either way.
      wireReconnectAnswers(root);
      /** Put the open question — or its absence — into the sheet of a screen already standing.
       *  A question opening or closing used to be a reason to rebuild the whole screen, which on
       *  a walking one threw away the walk to change a paragraph above it. Replaces the node in
       *  place rather than wrapping it, so no stylesheet rule learns a new box. */
      const syncReconnectAsk = () => {
        const card = root.querySelector('.solution-card');
        if (!card) return;
        const showing = card.querySelector(':scope > .reconnect-ask');
        const html = reconnectAsk();
        if (!html) { showing?.remove(); return; }
        const holder = document.createElement('div');
        holder.innerHTML = html;
        const asked = holder.firstElementChild;
        if (showing) showing.replaceWith(asked); else card.prepend(asked);
        wireReconnectAnswers(root);
      };

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
        speedMenu.setAttribute('role', 'menu');
        speedMenu.setAttribute('aria-label', t('Animation speed'));
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
            b.textContent = t(o.label);
            b.dataset.speed = o.id;
            b.setAttribute('role', 'menuitemradio');
            b.setAttribute('aria-checked', String(o.id === speedId));
            if (o.id === speedId) b.className = 'now';
            b.onclick = () => { speedId = o.id; save('walkSpeed', { id: o.id }); applySpeed(); closeSpeed(); speedBtn.focus(); };
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
          (speedMenu.querySelector('.now') ?? speedMenu.firstElementChild)?.focus();
          ev.stopPropagation();
        };
        const onAway = (ev) => {
          if (!speedMenu.hidden && !speedMenu.contains(ev.target) && !speedBtn.contains(ev.target)) closeSpeed();
        };
        const onEsc = (ev) => {
          if (ev.key !== 'Escape' || speedMenu.hidden) return;
          closeSpeed();
          speedBtn.focus(); // Escape returns you to the control you opened it from
        };
        // `{ signal }`, not a hand-written removal pair: this screen's abort is cut by
        // renderScreen on every navigation, so a listener that carries it cannot outlive its
        // screen — which is the same mechanism the parked <cubus-cube>'s listener relies on, and
        // one fewer place for a teardown to be written correctly. The pair it replaces was the
        // whole of `cleanup` here.
        document.addEventListener('click', onAway, { signal });
        document.addEventListener('keydown', onEsc, { signal });
      }
      // Turning a cube and reading the next move is minutes with no input at all, so the same
      // reasoning as the scan screen's: taken only where there IS a walk, because a cube being
      // looked at is not a cube being followed.
      const releaseWalkAwake = walking ? keepAwake() : () => {};
      // The screen's own teardown, now that the listeners carry their own: a search this screen
      // started must not go on burning the pool for a cube nobody is looking at.
      cleanup = () => { walkAbort?.abort(); releaseWalkAwake(); };

      // A new cube is a new SUBJECT, not a new screen. This used to re-enter the screen, because
      // the solution, the move list and the step count were all built at mount and there was no
      // other way to replace them — which destroyed every node, listener and animation on the
      // screen to change one fact about it. loadWalk() is that other way now; refreshScreen()
      // asks for it and falls back to a rebuild only when the composition itself has to change.
      // Absent on the solve side unless the Advanced dev toggle shows it.
      //
      // The ANSWER IS STILL FOUND BEFORE ANYTHING ON SCREEN CHANGES. Adopting a cube and then
      // retargeting would put an empty chip grid and a count reading "working…" on the screen
      // until the solver answered — one whole presented frame, measured, and the blink this
      // button was reported for. Solving first spends the same milliseconds with the screen still
      // complete, and every await in loadWalk then resolves as a microtask.
      /** A roll produced nothing — said WHERE THE PRESS WAS, always.
       *
       *  The count beside the solution heading is this screen's status line while there is a
       *  walk: it is where failWalk reports the identical failure on the Scramble side, so the
       *  same press gets the same words wherever it is made. A screen with no walk has no such
       *  line — a solved cube draws no solution card — and there this reported to the console
       *  alone, which for the person pressing the button is indistinguishable from a button that
       *  does nothing (found by audit, 2026-09-05). `#rollSay` is the die's own line, drawn
       *  wherever the die is, so there is no composition in which the press can fail in silence.
       *  The die stays enabled either way, so the answer is the one it prints: try again.
       *  Silence was what both branches did before: an empty roll returned, and a rejected one
       *  escaped this handler entirely as an unhandled promise. */
      const sayRollFailed = (err) => {
        console.error('a random cube could not be rolled', err ?? 'the roller produced no cube');
        const status = $('#moveCount', root) ?? $('#rollSay', root);
        if (status) status.textContent = t(WALK_FAILURES['no scramble']);
      };
      /** Which press of the die owns the screen. Neither of the two generations already here can
       *  answer that: `stale()` counts SCREENS and this one is not being replaced, and `walkGen`
       *  counts walks, which a press has not started yet while it is still rolling. Rolling is a
       *  real Kociemba search — seconds, in the pool, alongside whatever else is queued — so two
       *  presses can be in flight at once and land in either order, and the OLDER one adopting
       *  its cube afterwards replaces the newer one on a screen already showing it (found by
       *  audit, 2026-09-05). */
      let rollGen = 0;
      const die = $('#randCube', root);
      if (die) die.onclick = async () => {
        if (!solverReady || die.disabled) return;
        const mine = ++rollGen;
        // Held from BEFORE the first await, not from after the roll: the press used to stay live
        // for the length of the search it started, so a second press could roll a second cube
        // over the first. Released in the `finally` at the end, because a roll that fails must
        // leave behind the button that retries it.
        die.disabled = true;
        try {
          // Scramble rolls its own inside loadWalk — the walk IS the scramble there, so there is
          // no subject to adopt first.
          if (!scrambling) {
            // Known by construction, and NOT the cube in your hand. Marking this 'camera' was the
            // bug behind a solved physical cube instantly completing a random solve: the guide
            // accepted the real cube's snapshots as progress through an arrangement it had never
            // been in.
            let rolled;
            try {
              rolled = await randomScramble();
            } catch (err) {
              // Rolling IS a solve (2026-08-31), so it fails the way a solve fails — eight budget
              // escalations, or a pool that could not spawn a worker. The press must not end in
              // silence and an unhandled rejection.
              if (!stale() && mine === rollGen) sayRollFailed(err);
              return;
            }
            // Superseded, by the screen or by a later press. Either way this cube is nobody's
            // subject — and rolling is a real search, so it is parked rather than wasted.
            if (stale() || mine !== rollGen) { parkRoll(rolled); return; }
            if (!rolled.facelets) { sayRollFailed(null); return; }
            putInPlay(rolled);
            adoptCube(rolled.facelets, { physical: false, source: 'generated', setupAlg: rolled.alg });
          }
          // A failure is not swallowed into silence — it leaves `solution` empty, and the screen
          // says "could not work it out" the way it does for any walk it cannot build.
          try { if (!scrambling) await deriveCube({ signal }); }
          catch (err) {
            // A search the screen's own teardown called off is not a failure worth a line: the
            // subject is gone and nobody is waiting on it.
            if (err?.name !== 'AbortError') console.warn('random cube could not be solved', err);
          }
          if (stale() || mine !== rollGen) return; // navigated away, or overtaken, while solving
          refreshScreen();
        } finally { die.disabled = false; }
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
        // A NEW SUBJECT CAN ALSO BE A NEW COMPOSITION (2026-09-05). `walking` and `unsolvable`
        // were decided when this screen was built, and they decide whether the transport, the
        // solution card and the explanation exist AT ALL. So a cube that was solved and has now
        // been turned has a walk with nowhere to put it: the old handler repainted the picture
        // and stopped, leaving a scrambled cube on screen with no solution, no move list and no
        // way to ask for one — the app going quiet at exactly the moment it has something to say.
        // A composition change is a rebuild, which is precisely the answer refreshScreen() gets
        // from update() on a screen with no walk to replace.
        const now = classifyCube();
        if (now.solvable !== walking || now.unsolvable !== unsolvable) { refreshScreen(); return; }
        paintNet(f);
        cube.setAttribute('facelets', f);
      };

      if (!walking) return;

      const solList = $('#solList', root);
      const setStatus = (msg) => { $('#moveCount', root).textContent = msg; };

      // ---- the walk, and everything a retarget replaces ---------------------------------------
      //
      // These are `let`, not `const`, and that is the whole shape of this screen: pressing Random
      // does not navigate anywhere, it changes which cube the screen is ABOUT, and it used to say
      // so by re-entering the screen — destroying every node, listener and animation to change
      // one subject. Everything below is written once per MOUNT and reads these through the
      // closure, so loadWalk() can replace the walk underneath them without rebuilding anything.
      // A `const` here would put us straight back to needing a new screen for a new cube.
      let setup, alg, moves = [], steps = [], target = null, total = 0;
      let chips = [];
      let at = 0;
      let playing = false;
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
      // Which load is current. `screenGen` cannot answer this any more: it counts SCREENS, and a
      // retarget deliberately does not make a new one — so two presses in quick succession would
      // both believe they were still valid, and the slower solve would paint its move list over
      // the cube the faster one left on screen.
      let walkGen = 0;

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
        if (note) { note.hidden = false; note.classList.add('info'); noteMsg.textContent = 'Paused — you are driving. Switch Cube leads back on and your cube sets the pace.'; }
      };
      const clearNote = () => {
        if (note) { note.hidden = true; note.classList.remove('info'); }
      };

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
          // The target is what this button HANDS OVER, so a press without one has nothing to do.
          // Guarded here as well as at the point the button is drawn: `hidden` is a property any
          // later paint could get wrong, and handing `null` to adoptCube stores a subject with no
          // facelets at all — Home then draws a cube nobody rolled.
          if (!target) return;
          // `alg` is this scramble's own setup alg — the walk that just finished, from solved to
          // `target` — so Home needs no search to know how the cube it is handed was reached.
          if (!cubeTruth()) adoptCube(target, { physical: false, source: 'generated', setupAlg: alg });
          go('home');
        };
      }

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
        // And, on Scramble, the way onward — labelled for what is actually known at that moment.
        // Gated on the TARGET, not on the count: between beginWalk() and the roll landing, and
        // after a roll that failed, `total` is 0 and `i >= total` is trivially true — so the
        // button offered to hand Home a scramble while `target` was still null, and the press
        // stored a subject with no facelets (found by audit, 2026-09-05). There is nothing to
        // walk onward from until there is something to hand over.
        if (solveIt) {
          solveIt.hidden = !target || i < total;
          if (target && i >= total) solveIt.textContent = solveItLabel();
        }
      }
      // Signalled, because `cube` is parked and re-used between screens now: an unscoped
      // listener here would arrive at the next screen still calling this screen's sync().
      cube.addEventListener('cubus-step', (e) => sync(e.detail.index), { signal });

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
        followBtn?.setAttribute('aria-pressed', String(on));
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
      liveGap = () => {
        // The shutdown itself is NOT repeated here: onMovesLost marks trust stale first, and the
        // trust hook below owns standing follow down. What this adds is the account of what
        // happened. Disabled, not merely un-highlighted: following matches your turns against an
        // arrangement we have just said we cannot vouch for.
        refuseFollow('Your cube missed a turn — read it again before following');
        // No count. Reconciliation proves a turn was lost; it cannot say how many, and the old
        // "Missed 2 turns" came from a serial the app no longer has. Silence here would look
        // exactly like a wrong turn; it is neither, and the next snapshot will resync.
        showNote('A turn went unrecorded — checking the cube…');
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

      // ---- loading a walk into this screen ----------------------------------------------------
      /** Work out the walk for whatever the subject is NOW, and put it on the screen already
       *  standing. Called once by mount, and again by `update` every time the subject changes.
       *  Returns false when it was overtaken and wrote nothing. */
      /** Put the screen into "this cube, no walk yet" — the honest state to wait in.
       *
       *  Called BEFORE the solve, not after it. The moment the subject changes, everything the
       *  previous walk put on screen stops being true: those chips are moves through a cube that
       *  is no longer here, and leaving them under a new heading is the one thing this app
       *  refuses to do. Where the answer is already known — the die solves before it retargets —
       *  nothing between here and it yields, so no frame is ever painted in this state; where the
       *  answer has to be searched for, this is what the search is waited out in.
       */
      function beginWalk() {
        moves = []; steps = []; chips = []; total = 0; target = null;
        midpoints.clear();
        solList.innerHTML = '';
        // The previous walk's prove button must not survive into the gap: its closure guards
        // itself with fresh(), but a click would still flip it to "preparing…" and disable it
        // BEFORE those guards run — and if the new walk fails, nothing ever puts it back.
        const oldProve = $('#proveBtn', root);
        if (oldProve) { oldProve.hidden = true; oldProve.disabled = true; oldProve.onclick = null; }
        // The heading and the open question describe the SUBJECT, not the walk, so they are
        // written here — synchronously, before any search — and not on the far side of one. A
        // reconnect answered on a screen whose solver is slow, or missing entirely, still has to
        // show the question it just became; waiting for a solution to redraw a paragraph is how
        // a screen ends up asking something the user has already answered.
        const heading = root.querySelector('.state-h');
        if (heading) heading.textContent = stateHeading();
        syncReconnectAsk();
        setPlaying(false);
        setFollow(false);
        clearNote();
        // The subject, drawn without a walk: no scramble to animate from, just the arrangement.
        // Scramble is left alone — it always starts from solved, and what it walks TO is not
        // known until it has been rolled.
        if (!scrambling) {
          cube.removeAttribute('scramble'); cube.removeAttribute('alg');
          cube.setAttribute('facelets', state.cube.facelets);
          paintNet(state.cube.facelets);
        }
        sync(0);
        setStatus('working…');
      }

      function failWalk(err) {
        const key = String(err?.message ?? err ?? '');
        refuseFollow('Needs a solve worked out on this screen');
        // A cross-check refusal names itself in prose rather than in a code (finishSolve throws
        // 'solver cross-check failed — re-scan'), so it is matched rather than looked up.
        const why = WALK_FAILURES[key]
          ?? (/cross-check/i.test(key) ? WALK_FAILURES['cross-check'] : null)
          ?? 'could not work it out';
        setStatus(t(why));
      }

      async function loadWalk() {
        const mine = ++walkGen;
        // Two ways to become obsolete: the screen was replaced (screenGen), or another press
        // started a newer walk on this same screen (walkGen). Both must stop this one writing.
        const fresh = () => !stale() && mine === walkGen;
        // The previous walk's search is about a cube this one is replacing. Aborted BEFORE the
        // new one starts, so the pool is free rather than working through a dead search first.
        walkAbort?.abort();
        const abort = walkAbort = new AbortController();
        beginWalk();
        // A retarget replaces the SUBJECT, and a native proof about the old subject must not
        // outlive it — same rule as renderScreen's teardown, for the path that never renders.
        if (optimalCapability()) optimalCancel().catch((err) => console.warn('optimal cancel failed', err));
        // WORKED OUT INTO LOCALS, COMMITTED AFTER THE FRESHNESS CHECK — not before it. Two loads
        // can be in flight at once (a reconnect answered while the die's is still solving), and
        // the slower one finishes last. Assigning the shared `moves` / `steps` / `target` inside
        // the search and only THEN noticing it had been overtaken left the screen showing one
        // cube while every closure that reads those — follow's `locate`, the midpoint table,
        // "Solve this scramble" — had been handed the other one. Nothing crosses out of here
        // until this load is known to still be the current one, so there is no window in which
        // that disagreement exists at all.
        let gotSetup = '', gotAlg = '', gotMoves = [], gotSteps = [], gotTarget = null, gotRoll = null;
        try {
          if (scrambling) {
            if (!solverReady && !(await loadSolver())) throw new Error('solver unavailable');
            // randomScramble() returns the state it lands on together with the alg that gets there
            // from solved. That alg is what we walk, so `setup` stays empty and the cube starts
            // solved. The target outlives this block: it is what "Solve this scramble" hands to
            // Home at the end of the walk.
            const rolled = await randomScramble();
            gotRoll = rolled;
            gotTarget = rolled.facelets;
            if (!gotTarget || !rolled.alg) throw new Error('no scramble');
            // The SAME tokenizer and the SAME replay the solve path uses (movesOf, stepStates),
            // not a second copy of each. They were written out again here, and the copies had
            // already drifted in the way two copies of one rule always do: this one threw where
            // stepStates warns, so one walk called a failed replay "a scramble could not be
            // rolled" and the other quietly shipped a short step array (found by audit,
            // 2026-09-05). One path now, with the refusal kept where it belongs — a scramble
            // whose replay came up short IS a failed roll, and says so in those words.
            gotAlg = rolled.alg; gotMoves = movesOf(gotAlg);
            gotSteps = stepStates(SOLVED, gotMoves);
            if (gotSteps.length !== gotMoves.length + 1) throw new Error('no scramble');
          } else {
            if (!solverReady && !(await loadSolver())) throw new Error('solver unavailable');
            // Each improvement lands on the heading as it is found, so a tight tier shows 21
            // becoming 20 becoming 19 rather than nothing at all — guarded by fresh(), because
            // a superseded load's improvements describe a cube no longer on screen.
            //
            // `signal` is what makes a superseded search stop rather than run to its budget on
            // every worker with the next one queued behind it. `onProgress` is the other half of
            // the same wait: an escalation is the search doubling its budget and starting again,
            // which from outside is a count that has stopped moving for seconds — so it says, in
            // the smallest words available, that it is still going.
            //
            // deriveCube, not solve: the walk and the setup alg the twin animates from are one
            // answer now, so there is one ask. `gotSetup` below reads the alg this produced.
            await deriveCube({
              signal: abort.signal,
              onImprovement: (step) => { if (fresh()) setStatus(String(step.moves)); },
              onProgress: ({ attempt }) => {
                // `attempt` is 0-BASED (solve-target's contract), and only the first escalating
                // search reports at all. Nothing is said for attempt 0: that is the ordinary
                // case and needs no apology. From the first ESCALATION on, the count is shown
                // one-based, because "attempt 2" is what a person would call it. Never a
                // percentage or a time — nothing here knows either.
                if (fresh() && attempt >= 1) setStatus(t('still searching (attempt %1)', attempt + 1));
              },
            });
            gotSetup = state.cube.setupAlg; gotAlg = state.cube.solution; gotMoves = state.cube.moves;
            // Snapshotted: setFacelets() clears stepFacelets on every live update, and following a
            // physical cube needs the states to compare against to outlive the next turn.
            gotSteps = state.cube.stepFacelets.slice();
          }
        } catch (err) {
          // A search this screen itself called off is not a failure to report: the subject it was
          // about is gone, and the walk that replaced it owns the screen now. Superseded, silent.
          if (abort.signal.aborted) return false;
          if (fresh()) failWalk(err);
          return false;
        }
        if (!fresh()) { parkRoll(gotRoll); return false; } // navigated away, or a newer load took over

        // The scramble in play is committed HERE, with everything else, and not inside the search:
        // a slower load finishing last would otherwise have left the solve history recording
        // against a scramble that is not the one on screen.
        putInPlay(gotRoll);
        setup = gotSetup; alg = gotAlg; moves = gotMoves; steps = gotSteps; target = gotTarget;
        total = moves.length;
        if (scrambling) paintNet(target);
        // The Scramble side genuinely starts from solved, so an empty setup alg is its normal
        // case and `scramble=""` says exactly that. On the SOLVE side an empty one means
        // takeSetupAlg refused the inverse of the answer — the walk is still cross-checked and
        // still right, but there is no verified path from solved to this arrangement, and
        // `scramble=""` would draw a solved cube under a scrambled walk. So the arrangement is
        // drawn instead: `facelets` outranks `scramble` in the renderer and `alg` is independent
        // of both, so the walk still animates, just from where the cube actually is.
        if (scrambling || setup) {
          cube.setAttribute('scramble', setup ?? '');
          cube.removeAttribute('facelets');
        } else {
          cube.removeAttribute('scramble');
          cube.setAttribute('facelets', state.cube.facelets);
        }
        cube.setAttribute('alg', alg);
        // Just the number, unless the search fell short of the tier — and then a sentence about
        // the SEARCH, never about the cube. This used to read "18 was not possible here", which
        // two-phase has no way to know: it cannot prove a minimum, so it cannot prove one absent
        // (solver-move-count.md section 4). Measured on 30 random states, the <= 18 tier fell
        // short 19 times while only ~3.5% of positions are genuinely optimal-19-or-20 — so that
        // sentence was false roughly eighteen times out of nineteen. At <= 20 it was false
        // always, God's number being 20; solve-target now keeps that promise by escalating, so
        // this branch cannot be reached from a promised tier at all.
        // A scramble walk never ran the solver, so any verdict on state.cube is a LEFTOVER
        // from an earlier solve — shown here it would caption a fresh scramble with an old
        // cube's shortfall.
        const verdict = scrambling ? null : state.cube.solveResult;
        const provenHere = verdict?.key === 'solve.provenMinimum';
        setStatus(
          provenHere ? provenMinimumLabel(total)
            : verdict && verdict.key === 'solve.targetMissed' && verdict.stopped === 'exhausted'
              ? `${total} — couldn't get to ${verdict.target}`
              : String(total),
        );

        // The optimal seam's affordance (AGENTS.md, fourth seam): drawn only where the native
        // prover is injected AND a desktop is behind it — the whole orientation-row precedent,
        // since the mobile shells inject the same commands — and the words "proved" / "minimum"
        // can reach this screen only from optimal.js's oracle-checked proof. In the browser and
        // mobile builds the button never appears and the wording above stands as the honest
        // answer: the shortest found, no claim of minimality. Re-wired per WALK: a retarget
        // replaced the subject, so the button must come back for the new one.
        // `!provenHere`: the library already carries this state's proof, so there is nothing
        // left to ask the native prover for — offering minutes of search to re-derive a fact
        // we shipped would be the opposite of why the file exists.
        // `settings.proveMinimum`: off by default. Proving is minutes to hours on a typical cube
        // (optimal-solver-plan.md), so the affordance is not something to put in front of a
        // beginner who did not ask for it — it is opt-in from Settings, where the row explains
        // the cost. Everything else about the gate is unchanged: the commands must be injected,
        // a desktop must be behind them, and a state the library already proved has nothing left
        // to ask for.
        const proveBtn = $('#proveBtn', root);
        if (proveBtn && optimalCapability() && !scrambling && !provenHere && settings.proveMinimum) {
          proveBtn.hidden = false;
          proveBtn.disabled = false;
          proveBtn.textContent = PROVE_COPY.button;
          // The pair being proved is the WALK's, captured at wiring: steps[0] IS the start
          // state this walk displays and total IS its length. Reading state.cube at click
          // time would race live ingestion (a snapshot can swap the subject or zero the move
          // list under the button), and a re-solve replaces the walk through loadWalk, which
          // re-wires this handler with the new pair.
          const startFacelets = steps[0] ?? state.cube.facelets;
          const shown = total;
          const cancelBtn = $('#proveCancel', root);
          // The press hands off to the controller: the proof's lifecycle is its own, and a walk
          // load is not the place to keep one. What stays here is the pair being proved and the
          // SENTENCE, which may only be said from a region the wording invariant sanctions.
          proveBtn.onclick = () => void runProof({
            proveBtn, cancelBtn, startFacelets, shown, fresh,
            // The sentence this seam exists for — and the honest split when the shown solution
            // is longer than the proved minimum. A failed table save rides along: the proof
            // stands, the next launch regenerates, and nobody wonders why.
            sayProved: (proof) => {
              const saved = proof.tablesPersisted ? '' : ' · tables not saved';
              setStatus((proof.moves === shown
                ? `${shown} — proved the minimum`
                : `${shown} shown — the minimum is ${proof.moves}, proved`) + saved);
            },
          // The controller reports every failure a proof can have; this catches the one thing it
          // cannot — itself — rather than leaving a press to end in an unhandled rejection.
          }).catch((err) => console.error('optimal: the proof controller failed', err));
        }
        // One grid, no group headings, on both sides of the walk. The solve side used to cut its
        // list at fixed 16 / 62 / 82% and head the pieces CROSS / F2L / OLL / PLL — proportional
        // slices of a two-phase solution wearing the names of stages it does not have. That is
        // invented structure on the screen a beginner trusts most, and a heading per group is what
        // put the tail of a 20-move solve past the sheet's foot in portrait. The card header already
        // says what the chips are and how many.
        // escHtml on the move text. It comes from the solver or the validated library and
        // `reaches()` fails closed, so nothing hostile can be in it today — but it is a string
        // reaching innerHTML, and "this particular source is trusted" is exactly the reasoning
        // that stops being true when a source is added. Every other template here escapes.
        solList.innerHTML = `<div style="padding:6px 18px 12px"><div class="move-chips">${moves.map((m, k) => `<button class="chip-m" data-i="${k}" title="${escHtml(t('Jump to this move'))}">${escHtml(m)}</button>`).join('')}</div></div>`;
        chips = [...solList.querySelectorAll('.chip-m')];

        // Nothing may survive from the previous walk. Each of these is a position ON a plan, and
        // the plan has just been replaced: carried over, they describe a cube that is no longer
        // on screen.
        at = 0;
        playing = false;
        cubePos = 0;
        liveModel = null;
        drawn = 0;
        lastSerial = null;
        setPlaying(false);
        clearNote();
        // Following is judged per walk, so a session that was following must be stood down before
        // the new walk is judged — otherwise setFollow(true) below sees `mode` already 'cube',
        // returns early, and never re-bases the drawing on the new plan.
        setFollow(false);
        midpoints.clear();
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
        if (followBtn) {
          followBtn.disabled = false; // a previous walk may have refused it; this one is re-judged
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
        }
        sync(0);
        return true;
      }

      retarget = loadWalk;
      await loadWalk();
    },
    /**
     * Take a new subject without being rebuilt — see refreshScreen().
     *
     * Only the WALK is replaceable in place. The composition is not: `walking` decides whether
     * the transport and the solution card exist at all, and with no walk there is nowhere to put
     * one, so those transitions say so and let the caller render properly. Returning false is not
     * a failure, it is the honest answer to "can you show this without rebuilding".
     */
    update() {
      if (!retarget) return false;                            // nothing mounted, or nothing to walk
      if (!walking) return false;                             // this screen has no walk to replace
      if (!(scrambling || classifyCube().solvable)) return false; // and now there is none to show
      void retarget();
      return true;
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
  //
  // The clock is a real <button>, styled to look exactly as it did as a <div onclick>. It is the
  // screen's primary control — it starts and stops the solve — and a div is not reachable by Tab,
  // not activated by Enter or Space, and announced as nothing. The look is unchanged: `button`
  // already inherits font and colour in this stylesheet, and .timer-clock zeroes the padding.
  // Its accessible NAME is an aria-label that says what pressing it does, because its text is a
  // number that changes sixty times a second; the RESULT is announced through the hint line,
  // which is the screen's status region.
  return { html: `<div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px">
      <div class="num" id="scr" role="status" aria-live="polite" style="font-size:var(--fs-body-l);color:var(--ink-4);text-align:center;max-width:640px">${escHtml(t('press New scramble'))}</div>
      <button type="button" class="num timer-clock" id="clock" aria-label="${escHtml(t('Start the timer'))}">0.00</button>
      <div class="sub" id="timerHint" role="status" aria-live="polite" style="color:var(--ink-4)">${escHtml(t('Click or hold space to start'))}</div>
      <div class="wrap-row" style="justify-content:center;gap:10px"><button class="btn outline sm" id="newScr">${escHtml(t('New scramble'))}</button>
        <span class="pill">${escHtml(t('WCA scrambles'))}</span></div>
      <div class="wrap-row" style="justify-content:center;gap:12px;margin-top:6px" id="lastFive"></div></div>`,
    mount(root) {
      const clock = $('#clock', root); let running = false, t0 = 0, raf = 0;
      const fmt = (ms) => (ms / 1000).toFixed(2);
      const tick = () => { if (!running) return; clock.textContent = fmt(performance.now() - t0); raf = requestAnimationFrame(tick); };
      const hint = $('#timerHint', root);
      const MANUAL = t('Click or hold space to start');
      const say = (text) => { if (hint) hint.textContent = text; };
      /** What pressing the clock will do next. Kept in step with `running` in one place, so the
       *  name a screen reader announces cannot describe the opposite of what the press does. */
      const nameClock = () => clock.setAttribute('aria-label', running ? t('Stop the timer') : t('Start the timer'));

      // ---- cube-driven timing (PRD phase 4) ------------------------------------------------
      // The arrangement the current scramble produces — what the auto timer arms on: the one
      // instant the app can KNOW setup is finished, since applying the scramble is also turns.
      let scrTarget = null;
      // True while the clock was started by the cube, so a manual press can take it back.
      let byCube = false;
      const auto = createSolveTimer({ target: () => scrTarget, trusted: chainTrusted });
      /**
       * A cube that numbers nothing cannot be timed truthfully, so this screen does not time it.
       *
       * solve-timer's two "moves were dropped" refusals both compare serials; with no serial they
       * are inert, and the screen would report a span with nothing able to tell it a turn went
       * missing. That is a measurement resting on an assumption, which is the one thing this app
       * will not print as a number. Three of the brands it speaks to are in that position
       * (moyu32, moyu-mhc, qiyi), and `numbersMoves()` existed with no caller — so they were all
       * being timed (found by audit, 2026-09-04).
       *
       * Asked when the timer ARMS, which is the first instant the answer is both needed and
       * known, and said once: the hand clock still works, and a line repeated on every snapshot
       * would bury that.
       */
      let untimeable = false;
      // Only a session that SAYS no declines the solve. With no session there is no cube-driven
      // timing to decline — `conn` and `state.connected` move together — and refusing on a fact
      // nobody asserted would be inventing the answer rather than asking for it.
      const cubeCanTime = () => !conn || conn.numbersMoves();

      // A lost turn means the span cannot be vouched for, and this is the only path that says so
      // on a cube that does not number its moves — which is three of the brands the app speaks to.
      // The clock keeps running: a solve in progress is still a solve. It is the RESULT that is
      // refused, and solve-timer already owns those words.
      liveGap = () => auto.interrupted();

      warmSolver();      // New scramble is one press away here; see cubeScreen's mount
      schedulePreroll(); // and it should never be the press that waits for a search
      const newScr = async () => {
        // The scramble on screen is the one the RUNNING solve is recorded against — replacing
        // it mid-solve would file the time under a scramble the solver never saw, and disarm
        // the cube-driven stop. Stop the clock first; then roll.
        if (running) return;
        if (!solverReady) {
          $('#scr', root).textContent = t('working out a scramble…');
          // Retry when it lands. Without this, opening Timer before the solver finished left
          // "solver loading…" on screen permanently — the only way out was pressing New scramble
          // again, which nothing on the screen suggested.
          //
          // And when the load FAILS, say so about the APP rather than about the cube: the retry
          // used to be handed `false` and do nothing at all, leaving the screen waiting forever
          // on something that had already given up (found by audit, 2026-09-04).
          void loadSolver().then((ok) => {
            if (!root.isConnected || state.screen !== 'timer') return;
            if (ok) { void newScr(); return; }
            $('#scr', root).textContent = t('the solver did not load — reload the app');
            say(t('Scrambles need the solver, and it did not load. Reloading the app is the fix; the clock below still times by hand.'));
          });
          return;
        }
        // A roll that THREW says the same thing to a user as one that came back empty: there is
        // no scramble, and the button is the retry. It used to say nothing at all — `newScr` is
        // wired straight to onclick, so the rejection left the click handler as an unhandled
        // promise and the screen sat on the old scramble with no explanation. The engine raises
        // here for real (eight budget escalations, or a pool that cannot spawn a worker).
        let rolled;
        try {
          rolled = await randomScramble();
        } catch (err) {
          if (!root.isConnected || state.screen !== 'timer') return;
          console.error('scramble could not be rolled', err);
          // The scramble already in play is left exactly as it is: it is still the one this
          // screen would record a solve against, and blanking it would lose that too.
          say(t('A scramble could not be worked out — press New scramble to try again.'));
          return;
        }
        // RE-CHECKED after the await, not only before it. A roll is a real Kociemba search now,
        // so seconds can pass inside this call — long enough to press the clock and start a solve.
        // Landing then would file that solve under a scramble shown after it began, and disarm the
        // cube-driven stop. The rolled cube is not thrown away: it is parked as the next roll, so
        // the press after this one is instant rather than paying for the search twice.
        if (!root.isConnected) { parkRoll(rolled); return; }
        if (running) { parkRoll(rolled); return; }
        // The CALLER puts it in play, so a roll that arrives at a bad moment changes nothing the
        // solve history is recorded against.
        putInPlay(rolled);
        scrTarget = rolled.facelets || null;
        auto.reset();
        untimeable = false;
        $('#scr', root).textContent = rolled.alg || '—';
        if (!rolled.alg) say(t('A scramble could not be worked out — press New scramble to try again.'));
        else if (scrTarget && chainTrusted()) say(t('Scramble your cube — the clock starts itself'));
      };
      /** Record a finished solve, and say so when the browser refused to keep it.
       *
       *  A solve that was not stored still showed on the clock and then vanished from "last five"
       *  with nothing said — a private window or a full quota looked exactly like a bug in the
       *  timer. save() already warns to the console; this is the half a person can see. */
      const record = (time, extra) => {
        if (pushSolve(time, extra)) return true;
        say(t('That time is on the clock but was NOT saved — this browser is refusing to store anything, so it will be gone on reload.'));
        return false;
      };
      const stop = () => {
        running = false;
        cancelAnimationFrame(raf);
        // `secs`, not `t`: a local named `t` here shadowed the imported translator for the rest of
        // this function, so every sentence below it would silently stop being translatable.
        const secs = fmt(performance.now() - t0);
        clock.textContent = secs;
        clock.style.color = 'var(--ink)';
        nameClock();
        say(MANUAL);
        // A hand-stopped solve is hand-timed even if the cube started it: the moment recorded is
        // the click, not a move. Recording it as cube-timed would put a click into a turn rate.
        record(secs, { source: 'manual' });
        byCube = false;
        auto.reset();
        renderLast();
      };
      /** Start the clock. ONE body, because the two ways it starts differ in exactly two things:
       *  the sentence on the hint line, and who is credited for the number at the end (`byCube`,
       *  set by the caller that earns it). Everything else — the flag the frame loop reads, the
       *  instant it measures from, the accent colour, the name the button announces, the loop
       *  itself — is the same start, and it was written out twice. Two copies of a five-line
       *  sequence is two places for the next change to land in one of. */
      const runClock = (message) => {
        running = true;
        t0 = performance.now();
        clock.style.color = 'var(--accent)';
        nameClock();
        say(message);
        tick();
      };
      const start = () => runClock(t('Running — click or press space to stop'));
      const toggle = () => { if (running) stop(); else start(); };

      /** The cube reached the scramble and the solver made the first turn. */
      const startFromCube = () => {
        byCube = true;
        // The animated figure runs on the host clock because it only has to LOOK live; the number
        // that gets recorded is replaced by the cube's own measurement when the solve ends.
        runClock(t('Running — solve it, and the cube stops the clock'));
      };

      /** The cube reached solved. The cube's clock decides the number, not this screen's. */
      const stopFromCube = () => {
        running = false;
        cancelAnimationFrame(raf);
        clock.style.color = 'var(--ink)';
        nameClock();
        byCube = false;
        const r = auto.result();
        if (!r) {
          // Refusing is the designed outcome, not an error path: a solve that cannot be timed
          // truthfully is not recorded at all, and the screen says which fact was missing.
          clock.textContent = '—';
          // The module's refusals are English sentences, which IS the catalog key — the same
          // contract the scanner panel's notices use.
          say(t(auto.refusal || 'that solve could not be timed — press New scramble'));
          auto.reset();
          return;
        }
        clock.textContent = r.seconds;
        // `inspectionMs` is host-clocked at both ends and therefore coarser than the solve; it is
        // stored as-is (or omitted) rather than rounded into looking as precise as `time`.
        const saved = record(r.seconds, {
          source: 'cube',
          moves: r.moves,
          ...(r.inspectionMs === null ? {} : { inspectionMs: r.inspectionMs }),
        });
        auto.reset();
        // ONLY ON A SUCCESSFUL WRITE. `record()` puts the "that time is on the clock but was NOT
        // saved" sentence on this same line, and saying the idle hint straight after wiped it in
        // the same task — no frame ever carried it. The cube-timed solve is exactly where that
        // matters most: nobody pressed anything, so a time that quietly failed to store looks
        // like the app deciding the solve did not count. The hand-stopped path says MANUAL
        // BEFORE it records, which is why it never had this bug.
        if (saved) say(MANUAL);
        renderLast();
      };
      clock.onclick = toggle;
      nameClock();
      $('#newScr', root).onclick = newScr;
      // escHtml: solve times come from localStorage, which is untrusted input, and they were
      // going into innerHTML raw — a stored-XSS hole reachable by anything that can write to the
      // origin's storage.
      //
      // The most recent one carries an undo. A mis-recorded solve — a fumbled press, a clock
      // started by a cube that was only being tidied — used to be permanent, and the alternative
      // for anyone who cared about their averages was to edit localStorage by hand. Two-step,
      // the idiom the Forget button uses, because it destroys a record nothing can re-derive.
      const renderLast = () => {
        const l = recentSolves().filter((s) => s.time).slice(0, 5);
        $('#lastFive', root).innerHTML = l.map((s, i) =>
          `<div class="card" style="padding:9px 16px;text-align:center"><div class="num" style="font-size:var(--fs-title);font-weight:600">${escHtml(s.time)}</div>${
            i === 0 ? `<button class="pill" id="undoLast" style="margin-top:6px;padding:2px 10px;font-size:var(--fs-meta)">${escHtml(t('Undo'))}</button>` : ''
          }</div>`,
        ).join('');
        const undo = $('#undoLast', root);
        if (undo) {
          undo.onclick = () => {
            if (undo.dataset.armed !== 'yes') {
              undo.dataset.armed = 'yes';
              undo.textContent = t('Remove it?');
              undo.style.color = 'var(--err-ink)';
              undo.style.borderColor = 'var(--err)';
              return;
            }
            if (dropLastSolve()) say(t('Removed — that solve is no longer counted.'));
            else say(t('It could not be removed — this browser is refusing to store anything.'));
            renderLast();
          };
        }
      };
      // e.repeat: holding the key down fires keydown continuously, which start/stopped the clock
      // dozens of times a second and wrote a run of nonsense times into the solve history.
      const onKey = (e) => {
        if (e.repeat || e.code !== 'Space' || state.screen !== 'timer') return;
        // A press of the clock button arrives here as well as through onclick — Space is a
        // button's own activation key — and toggling twice per press would start and stop in the
        // same instant. The button's own handler owns that case.
        if (document.activeElement === clock) return;
        e.preventDefault();
        toggle();
      };
      document.addEventListener('keydown', onKey, { signal: screenAbort?.signal });

      // The cube's two streams. Moves start the clock; snapshots arm and stop it. Both are the
      // same doors every other screen uses, so the test seam (window.cubusFeed) drives this
      // exactly as the driver does — the reason phase 4's absence went unnoticed is that nothing
      // could exercise it without a physical cube.
      liveMove = (m) => {
        if (untimeable) return;
        const before = auto.state;
        if (auto.move(m) === 'running' && before === 'armed' && !running) startFromCube();
      };
      liveUpdate = (f, serial) => {
        if (untimeable) return;
        const before = auto.state;
        const now = auto.facelets(f, serial);
        // "Ready" is a recorded instant, not a mood: the timer captured WHEN the cube reached the
        // scramble, which is what makes the inspection interval a measurement rather than a guess.
        if (before !== 'armed' && now === 'armed') {
          if (!cubeCanTime()) {
            untimeable = true;
            auto.reset();
            say(t('This cube does not number its turns, so cubus cannot tell a clean solve from one that dropped a turn — it will not time it. Use the clock or the space bar and time it by hand.'));
            return;
          }
          say(t('Ready — turn to start'));
        }
        if (before === 'armed' && now === 'idle' && !running) say(t('Scramble your cube — the clock starts itself'));
        if (before === 'running' && now === 'stopped' && byCube) stopFromCube();
      };

      cleanup = () => {
        // `running` first: tick() re-schedules itself, so cancelling the pending frame while the
        // flag is still true leaves an in-flight callback free to queue another one — a clock that
        // animates forever on a screen that no longer exists.
        running = false;
        cancelAnimationFrame(raf);
        // Release the cube stream with the screen, or a torn-down closure keeps timing.
        liveMove = null;
        liveUpdate = null;
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
  const desktopWindow = isTauri && isDesktopHost();
  // `flow`: a list screen — in portrait the box scrolls as one (index.html, .cols.flow).
  return { html: `<div class="cols flow">
    <div class="col">
      <div class="card"><div class="eyebrow">APPEARANCE</div>
        <div class="wrap-row" style="justify-content:space-between;padding:12px 0"><div><div style="font-weight:600">Theme</div><div class="sub" style="color:var(--ink-4)">White, cream or night — auto follows the system</div></div>
          <div class="wrap-row" style="gap:6px">${THEMES.map((name) => `<button class="pill ${settings.theme === name ? 'on' : ''}" data-set-theme="${name}" aria-pressed="${settings.theme === name}">${escHtml(t(name))}</button>`).join('')}</div></div>
        <div style="display:flex;align-items:center;gap:16px;padding:13px 0 0;border-top:1px solid var(--line-faint)">
          <div style="flex:1"><div style="font-weight:600">Rotate the cube by dragging</div><div class="sub" style="color:var(--ink-4)">Off, the 3D cube keeps the angle its ghost faces are set up for</div></div>
          <button class="toggle ${settings.dragRotate ? 'on' : ''}" data-toggle="dragRotate" role="switch" aria-checked="${Boolean(settings.dragRotate)}" aria-label="Rotate the cube by dragging"><i></i></button></div>
        <div class="wrap-row" style="justify-content:space-between;padding:13px 0 0;border-top:1px solid var(--line-faint)"><div><div style="font-weight:600">How short a solution</div><div class="sub" style="color:var(--ink-4)">${TIER_BLURB[settings.solveTier] ?? TIER_BLURB.twenty}</div></div>
          <div class="wrap-row" style="gap:6px">${TIERS.map((tier) => `<button class="pill ${settings.solveTier === tier.name ? 'on' : ''}" data-set-tier="${tier.name}" aria-pressed="${settings.solveTier === tier.name}">${escHtml(TIER_LABEL[tier.name])}</button>`).join('')}</div></div>
        ${optimalCapability() ? `<div style="display:flex;align-items:center;gap:16px;padding:13px 0 0;border-top:1px solid var(--line-faint)">
          <div style="flex:1"><div style="font-weight:600">${PROVE_COPY.settingLabel}</div><div class="sub" style="color:var(--ink-4)">${PROVE_COPY.settingBlurb}</div></div>
          <button class="toggle ${settings.proveMinimum ? 'on' : ''}" data-toggle="proveMinimum" role="switch" aria-checked="${Boolean(settings.proveMinimum)}" aria-label="${PROVE_COPY.settingLabel}"><i></i></button></div>` : ''}
        ${desktopWindow ? `<div class="wrap-row" style="justify-content:space-between;padding:12px 0"><div><div style="font-weight:600">Window</div><div class="sub" style="color:var(--ink-4)">Landscape or portrait — the window takes the shape and keeps it</div></div>
          <div class="wrap-row" style="gap:6px" id="orientationPills">${['landscape', 'portrait'].map((o) => `<button class="pill" data-set-orientation="${o}" aria-pressed="false">${escHtml(t(o))}</button>`).join('')}</div></div>` : ''}</div>
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
            <span class="num" style="font-size:var(--fs-body-s);color:${low ? 'var(--err-ink)' : 'var(--ink-3)'};font-weight:${low ? 700 : 400}">${lv}%</span>
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
        // Step 3 is "does cubus know where this cube is", and there are TWO ways to answer it:
        // anchoring (the cube's own reference is moved to solved) and a camera scan (the cube is
        // read exactly as it is). The card offers both — "Not solved" sends you to the camera —
        // and then required the anchor anyway, so a cube set up entirely through the camera sat
        // on an unfinished checklist for the whole session with nothing left to press (found by
        // audit, 2026-09-04). The condition is the fact the step is about: trusted, and by a
        // means that says something about THIS cube.
        const done = (i) => on && (i < 2 || (state.cube.trusted && (state.anchored || state.cube.source === 'camera')));
        const known = listCubes(cubes);
        // Both through Intl, in the app's locale, for the reason whenWords is: a 24-hour pad and
        // an English "2d ago" are the app writing in one language while claiming to be in another.
        const hhmm = (ts) => {
          if (!ts) return '';
          try { return new Intl.DateTimeFormat(locale(), { hour: 'numeric', minute: '2-digit' }).format(new Date(ts)); }
          catch { return ''; }
        };
        const seenAgo = (ts) => {
          if (!ts) return t('not used yet');
          const ago = Date.now() - ts;
          if (ago < 60000) return t('just now');
          try {
            const rel = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
            for (const [ms, unit] of [[86400000, 'day'], [3600000, 'hour'], [60000, 'minute']]) {
              if (ago >= ms) return rel.format(-Math.floor(ago / ms), unit);
            }
          } catch { /* an engine without RelativeTimeFormat falls through to the plain form */ }
          return t('a while ago');
        };
        // The FULL address in labels, not a tail: neither two octets nor nicknames are unique —
        // nothing stops a user calling two cubes "green".
        //
        // A cube with no address is keyed on its NAME (`name:<label>`), and that key is a storage
        // detail, not something to print: "green at name:green" reads as a bug, and it is the one
        // string here a user might try to type into the address field. Such a row says plainly
        // that there is no address instead — the fact, which is also why the row exists.
        const rowName = (c) => `${c.nickname || c.name || 'cube'} ${idWords(c.mac)}`;
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
              <span class="pill" id="reconnectBadge" style="color:var(--warn-ink);border-color:var(--warn-ink)">position unverified</span>
              <b style="flex:1;font-size:var(--fs-body-s)">${escHtml(ask)}</b>
            </div>
            <div style="display:flex;gap:8px;margin-top:10px">
              ${rc.raw && rc.candidate ? '<button class="btn sm primary" data-reconnect="yes">Yes, that’s it</button>' : ''}
              <button class="btn sm outline" data-reconnect="scan">Check with the camera</button>
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
                    aria-label="Name for the cube ${escHtml(idWords(c.mac))}"
                    style="width:100%;font-weight:600" title="A name of your own. Only a label — nothing depends on it.">
                  <div class="sub num" style="color:var(--ink-5);font-size:var(--fs-meta);margin-top:3px">${escHtml(c.mac.startsWith(NAME_PREFIX) ? t('no address — remembered by name') : c.mac)} · ${escHtml(live ? t('connected now') : seenAgo(c.lastSeen))}</div>
                </div>
                ${!on && !isTauri && normaliseMac(c.mac) ? `<button class="btn sm outline" data-use-cube="${escHtml(c.mac)}" aria-label="Connect to ${escHtml(rowName(c))}" style="flex:none;margin-top:1px">Use</button>` : ''}
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
            ${on ? '' : `<div class="sub" id="btReach" style="color:var(--ink-5);margin-top:4px">${escHtml(t(bleReachNote()))}</div>`}
          </div>
          ${on ? battery() : ''}
        </div>
        ${on && Number.isFinite(state.battery) && state.battery <= 20 ? `<div style="display:flex;gap:8px;padding:0 0 12px;color:var(--err-ink);font-size:var(--fs-body-s)">
          <span>Battery low. A cube that dies mid-solve stops counting turns, and what it reports afterwards will not match the cube in your hand until you read it again.</span>
        </div>` : ''}
        ${registryWriteBad ? `<div id="registryWriteWarn" style="display:flex;gap:8px;padding:0 0 12px;color:var(--err-ink);font-size:var(--fs-body-s)">
          <span>This browser is refusing to store what cubus learns about this cube — its memory of it will not survive a reload, so the next reconnect will greet it as a stranger.</span>
        </div>` : ''}
        ${on ? `<div style="display:flex;align-items:center;gap:10px;padding:12px 0;border-top:1px solid var(--line-faint)">
          <span class="ico" style="flex:none;color:${conn?.verdict === 'refused' ? 'var(--err)' : 'var(--ink-4)'}">${icon(conn?.verdict === 'refused' ? 'x' : 'check', 16)}</span>
          <div style="flex:1">
            <div style="font-weight:600">${conn?.verdict === 'refused'
              ? 'This cube did not check out'
              : 'Send us a report about this cube'}</div>
            <div class="sub" style="color:var(--ink-4)">${conn?.verdict === 'refused'
              ? 'What it reported did not add up, so cubus is not trusting it. That is worth telling us about — the file below is a recording of the conversation, and it is the only thing that can show why.'
              : 'Only if you feel like it. Most cube types have never been tried on this app, and a recording of one that works is what makes the next person\u2019s cube work too.'}</div>
          </div>
          <button class="btn sm outline" id="cubeReportBtn" style="flex:none">Save report</button>
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
        ${on || !canPair() ? '' : `<div id="macRow" hidden style="display:flex;align-items:center;gap:12px;padding:12px 0;border-top:1px solid var(--line-faint)">
          <div style="flex:1"><div style="font-weight:600">${known.length ? 'Add another cube' : 'Cube Bluetooth address'}</div>
            <div class="sub" style="color:var(--ink-4)">Only needed if your cube does not broadcast its own address. Most do, and most cubes never ask you for this. If yours does, its own app lists it under the cube's details.</div></div>
          <input class="field" id="macIn" placeholder="AB:CD:EF:12:34:56" style="width:180px;flex:none">
        </div>`}
        <div style="display:flex;gap:10px;align-items:center;padding:12px 0">
          ${on || canPair() ? `<button class="btn ${on ? 'outline' : 'primary'} sm" id="pairBtn">${escHtml(t(on ? 'Disconnect' : 'Pair a cube'))}</button>` : ''}
          <span class="sub" id="pairMsg" style="flex:1" role="status" aria-live="polite"></span>
        </div>
        ${rc ? reconnectRow() : steps.every((_, i) => done(i)) ? '' : steps.map(([st, sub], i) => `<div style="display:flex;gap:12px;align-items:center;padding:10px 0;border-top:1px solid var(--line-faint)">
          <div class="num" style="width:22px;height:22px;flex:none;border-radius:50%;border:1.5px solid ${done(i) ? 'var(--ok)' : 'var(--line)'};display:grid;place-items:center;font-size:var(--fs-meta);color:${done(i) ? 'var(--ok-ink)' : 'var(--ink-5)'}">${done(i) ? '✓' : i + 1}</div>
          <div style="flex:1"><div style="font-weight:600">${st}</div><div class="sub" style="color:var(--ink-4)">${sub}</div></div>
          ${i === 2 && on ? `<button class="btn sm outline" id="anchorNoBtn" style="flex:none" title="The camera reads it exactly as it is — no need to solve it first">Not solved</button>
          <button class="btn sm primary" id="anchorBtn" style="flex:none">${state.anchored ? 'Re-mark solved' : "It's solved"}</button>
          <button class="btn sm" id="anchorForceBtn" hidden style="flex:none;border:1px solid var(--warn-ink);color:var(--warn-ink)">It is solved — anchor anyway</button>` : ''}
        </div>`).join('')}
        ${on && !rc && steps.every((_, i) => done(i)) ? `<div style="display:flex;align-items:center;gap:8px;padding:10px 0;border-top:1px solid var(--line-faint);color:var(--ok-ink);font-size:var(--fs-body-s)">
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
        <div style="display:flex;gap:6px;margin-top:12px">${pals.map((p) => `<button class="pill ${settings.palette === p ? 'on' : ''}" data-pal="${p}" aria-pressed="${settings.palette === p}" style="flex:1;justify-content:center">${escHtml(t(p))}</button>`).join('')}</div></div>
      ${advancedOpen ? `<div class="card"><div class="eyebrow">ADVANCED</div>
        <div class="sub" style="color:var(--ink-4);margin-top:6px;line-height:1.5">Toolbar tabs. Hiding one only takes it out of the row — its address still works.</div>
        ${HIDEABLE.map(([id, lbl]) => `<div style="display:flex;align-items:center;gap:16px;padding:13px 0;border-bottom:1px solid var(--line-faint)">
          <div style="flex:1"><div style="font-weight:600">${lbl}</div><div class="sub" style="color:var(--ink-4)">${navHidden(id) ? 'Hidden from the toolbar' : 'Shown in the toolbar'}</div></div>
          <button class="toggle ${navHidden(id) ? '' : 'on'}" data-nav-toggle="${id}" role="switch" aria-checked="${!navHidden(id)}" aria-label="Show ${lbl} in the toolbar"><i></i></button></div>`).join('')}
        <div style="display:flex;align-items:center;gap:16px;padding:13px 0;border-bottom:1px solid var(--line-faint)">
          <div style="flex:1"><div style="font-weight:600">Random-cube die</div><div class="sub" style="color:var(--ink-4)">Shows the die on the solve screen that loads a random scrambled cube — a developer shortcut, since that cube is not the one in anyone's hand. Scramble keeps its own die regardless.</div></div>
          <button class="toggle ${settings.devRandCube ? 'on' : ''}" data-toggle="devRandCube" role="switch" aria-checked="${Boolean(settings.devRandCube)}" aria-label="Random-cube die"><i></i></button></div>
        <div class="sub" style="color:var(--ink-5);margin-top:12px">${escHtml(t('%1 hides this section again.', advancedChordWords()))}</div></div>` : ''}
      <div class="card"><div class="eyebrow">ABOUT</div>
        <div class="about-brand"><img src="./icons/icon.svg" alt="" width="22" height="22" /><b>Cubus</b></div>
        <div class="about-row">${icon('tag', 15)}<span class="k">${t('Version')}</span><span class="num">${VERSION}</span></div>
        ${appUpdater() ? `<div class="about-row">${icon('refresh', 15)}<span class="k">${t('Updates')}</span><button class="pill" id="checkUpdate">${t('Check now')}</button></div>` : ''}
        <div class="about-row">${icon('globe', 15)}<span class="k">${t('Website')}</span><a class="link" href="https://cubus.im" target="_blank" rel="noopener">cubus.im</a></div>
        <div class="about-row">${icon('user', 15)}<span class="k">${t('Author')}</span><a class="link" href="https://lixiaolai.com" target="_blank" rel="noopener">@xiaolai</a></div>
        <div class="about-row">${icon('book', 15)}<span class="k">${t('Credits')}</span><a class="link" href="./THIRD_PARTY_NOTICES.md" rel="noopener">${t('Third-party notices')}</a></div>
        <div class="sub" style="color:var(--ink-3);margin-top:10px;line-height:1.55">${t(privacySentence())}</div></div>
    </div></div>`,
    mount(root) {
      const swatch = () => { const p = NET_COLORS[settings.palette] || NET_COLORS.muted; $('#palSwatch', root).innerHTML = ['U', 'D', 'R', 'L', 'F', 'B'].map((k) => `<div style="flex:1;height:34px;border-radius:var(--r-2);background:${p[k]}"></div>`).join(''); };
      swatch();
      // Drawn only where `updater` exists, which is the desktop gate — so this never looks for a
      // button the browser build does not have. The press ALWAYS checks (it ignores the daily
      // throttle) and always answers, because somebody is waiting for one; the launch check is the
      // quiet half. Disabled while in flight, since `check` joins one flight and a button that
      // keeps accepting presses while nothing visibly happens reads as broken.
      const checkBtn = $('#checkUpdate', root);
      const upd = appUpdater();
      if (checkBtn && upd) {
        checkBtn.onclick = async () => {
          const was = checkBtn.textContent;
          checkBtn.disabled = true;
          checkBtn.textContent = t('Checking…');
          try {
            await reportUpdateOutcome(await upd.checkNow());
          } catch (err) {
            // A press that throws used to leave the button spinning back to normal with nothing
            // said — the check simply appeared not to happen.
            console.error('app-update: the check failed', err);
            await reportUpdateOutcome({ status: 'error' });
          } finally {
            // The button may have gone with a re-render, and an installed update never comes back
            // here at all — the app relaunches out from under it.
            if (checkBtn.isConnected) { checkBtn.disabled = false; checkBtn.textContent = was; }
          }
        };
      }
      for (const b of root.querySelectorAll('[data-set-theme]')) b.onclick = () => { settings.theme = b.dataset.setTheme; save('cubusSettings', settings); applyTheme(); renderScreen(); };
      // Changing the target does not re-solve anything now — the next solve uses it. Clearing
      // the cached solution is what makes that true; without it the old answer would stand.
      for (const b of root.querySelectorAll('[data-set-tier]')) b.onclick = () => { settings.solveTier = b.dataset.setTier; save('cubusSettings', settings); state.cube.solution = ''; state.cube.solveResult = null; renderScreen(); };
      // The window's orientation lives on the Rust side (a file the window is built from before
      // this webview exists), so the pills ask it which is current, and tell it which to become.
      // A failure surfaces on the pills themselves rather than in a console nobody reads.
      const orientationPills = $('#orientationPills', root);
      if (orientationPills) {
        const invoke = window.__TAURI__?.core?.invoke;
        const mark = (current) => {
          for (const b of orientationPills.querySelectorAll('[data-set-orientation]')) {
            const on = b.dataset.setOrientation === current;
            b.classList.toggle('on', on);
            b.setAttribute('aria-pressed', String(on)); // the class is the look; this is the fact
          }
        };
        const fail = (e) => { orientationPills.title = String(e); orientationPills.style.color = 'var(--err-ink)'; console.error('window orientation', e); };
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
        try { await doConnect(mac); } catch (e) { say(String(e.message || e), 'var(--err-ink)'); }
      };

      // What CAN be detected, and what cannot. A browser has no scan-without-permission by
      // design, so there is no honest "1 cube found" line to draw; getAvailability() does say
      // whether pressing Pair can work at all, which beats a button that fails unexplained. The
      // address field appears ONLY where it is genuinely needed: the native build learns the
      // address from its own scan, a browser must be handed it.
      //
      // WHICH HOSTS GET THE BUTTON AT ALL is decided in the template, by canPair(), and not here:
      // this used to promise "Native Bluetooth — cubus finds the cube itself" under any Tauri
      // build, including the Android one whose native BLE the bridge refuses outright — so the
      // affordance was offered, pressed, and answered with a message written for a browser
      // ("smart cubes need Chrome, Edge, or the desktop app") on a phone where none of those
      // three is the answer (found by audit, 2026-09-04). bleReachNote() states the platform's
      // real position before anything is pressed.
      const btNote = $('#btNote', root), macRow = $('#macRow', root);
      if (pairBtn && !state.connected) {
        if (bleReach() === 'native') {
          if (btNote) btNote.textContent = t('Native Bluetooth — cubus finds the cube itself.');
        } else {
          if (macRow) macRow.hidden = false;
          void navigator.bluetooth.getAvailability?.().then((ok) => {
            if (ok !== false) return;
            // Resolved now, not captured at mount: a trust change repaints this card, and nodes
            // taken beforehand are detached by the time this promise settles.
            const note = $('#btNote'), pair = $('#pairBtn');
            if (note) note.textContent = t('No Bluetooth radio available on this machine — turn it on, then reload.');
            if (pair) pair.disabled = true;
          }).catch(() => {}); // an engine without getAvailability tells us nothing
        }
      }

      if (pairBtn) pairBtn.onclick = async () => {
        if (state.connected) {
          // Called explicitly rather than waited for: a deliberate disconnect tears the session
          // down locally, so no DISCONNECT event arrives to do it for us — and without this the
          // cube stayed marked trusted with its correction applied to nothing.
          try { await conn?.disconnect(); } catch {}
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
          const rec = cubes[normaliseIdentity(el.dataset.renameCube)];
          const named = cubeLabel({ ...rec, mac: el.dataset.renameCube });
          if (save('cubusCubes', cubes)) say(`Saved — this cube is "${named}".`, 'var(--ok-ink)');
          else say('Could not save that name — this browser is refusing to store anything.', 'var(--err-ink)');
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
          const id = el.dataset.forgetCube;
          cubes = forgetCube(cubes, id);
          const stored = save('cubusCubes', cubes);
          // The app's own registry is not the only place this cube's address is written down. The
          // protocol layer caches a resolved address under `smartcube-ble-mac:<device id>`, and on
          // Windows, Linux and Android the device id IS that address — so a "forgotten" cube kept
          // its MAC on disk and the next connect resolved a key from it without asking anything.
          // A forget that leaves the identifying value in storage is not a forget.
          //
          // Best effort by construction, and honest about it: on macOS the id is a per-host UUID
          // the app never sees, so there is nothing here to remove and this removes nothing. The
          // live session's id is tried too, for the case where the row being forgotten is the
          // cube currently connected.
          const purged = forgetLibraryMac(normaliseMac(id))
            + (state.cubeMac === id ? forgetLibraryMac(normaliseMac(conn?.mac ?? '')) : 0);
          if (purged) console.info(`forget: also removed ${purged} cached address entr${purged === 1 ? 'y' : 'ies'}`);
          renderScreen();
          if (!stored) say('Forgotten for now, but this browser will not store the change.', 'var(--err-ink)');
        };
      }
      $('#battRefresh', root)?.addEventListener('click', () => void refreshBattery());

      // The compatibility report (dev-docs/universal-cube-driver.md §7). One affordance, not a
      // screen: the moment worth offering it is when the self-check has refused a cube, because a
      // refusal that reaches nobody is a quiet failure one level above the one it guards against.
      $('#cubeReportBtn', root)?.addEventListener('click', async () => {
        const asked = conn;
        if (!asked) { say('not connected', 'var(--err-ink)'); return; }
        try {
          const { describeReport, saveReport } = await import('./cube-report.js');
          const fixture = asked.report({ scenario: 'saved from Settings' });
          // Said BEFORE the file exists, not after — and said at all, which it was not: a GAN or
          // MoYu capture carries the cube's BLE address, because key derivation needs it, and the
          // app was writing that into a file it invited people to attach to a public issue
          // without once mentioning it (`describeReport` existed and had no caller — found by
          // audit, 2026-09-04). It is a toy's identifier that the toy broadcasts in the clear,
          // not a phone or a person; the point is that the choice is the user's to make knowing.
          //
          // Two-step, the same idiom the Forget button uses, and for a reason of the same weight:
          // this is the one action here that puts an identifier somewhere the app cannot take it
          // back from. No modal is invented for it — this design system has none, and the button
          // itself can carry the question.
          const about = describeReport(fixture);
          const btn = $('#cubeReportBtn');
          if (about.containsMac && btn?.dataset.told !== 'yes') {
            if (btn) { btn.dataset.told = 'yes'; btn.textContent = t('Save it anyway'); }
            say(t('This recording includes your cube’s Bluetooth address — cubus needs it to decode the cube, and the cube broadcasts it in the clear, but it will be in the file you attach. Nothing about you or your computer is. Press again to save.'), 'var(--warn-ink)');
            return;
          }
          const r = await saveReport(fixture, { isWebview: isTauri });
          if (conn !== asked) return;
          const kb = Math.max(1, Math.round(r.bytes / 1024));
          // Says which thing happened, never a generic "done": a download and a clipboard copy
          // need different next steps from the person holding it.
          say(r.how === 'downloaded'
            ? `Saved ${r.name} (${kb} KB) — attach it to an issue at github.com/xiaolai/cubus`
            : `Copied ${kb} KB to your clipboard — paste it into an issue at github.com/xiaolai/cubus`,
            'var(--ok-ink)');
        } catch (e) {
          if (conn !== asked) return;
          say(String(e.message || e).split('\n')[0], 'var(--err-ink)');
        }
      });

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
        if (!conn) { say('not connected', 'var(--err-ink)'); return; }
        // Anchoring moves the cube's own solved reference. It cannot answer a refusal, which is
        // about the two channels disagreeing with each other rather than with reality — and
        // markTrusted would refuse the 'cube' source afterwards anyway, leaving a success message
        // over a cube that had not become trusted.
        if (cubeRefused()) {
          say('This cube’s reports do not add up, so anchoring it would not make them true. Disconnect and pair again — the camera reads the cube either way.', 'var(--err-ink)');
          return;
        }
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
          say('Anchored — the cube agrees it is solved.', 'var(--ok-ink)');
        } catch (e) {
          if (conn !== asked) return;
          state.anchored = false;
          const msg = String(e.message || e).split('\n')[0];
          if (!force && /refusing to anchor/i.test(msg)) {
            say('The cube reports it is not solved. If it IS solved in front of you, its own reference has drifted — anchoring will reset it to this position.', 'var(--warn-ink)');
            const f = liveForceBtn();
            if (f) f.hidden = false;
          } else {
            say(msg, 'var(--err-ink)');
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
        <div class="card stat"><div class="eyebrow">SINGLE BEST</div><div class="v">${secs(s.best)}</div><div class="d">${escHtml(plural(s.count, { one: '%1 solve recorded', other: '%1 solves recorded' }))}</div></div>
        <div class="card stat"><div class="eyebrow">AO5</div><div class="v">${secs(s.ao5)}</div><div class="d">${s.ao5 === null ? (s.count < 5 ? `needs ${5 - s.count} more` : 'a recent solve is unreadable') : 'last five'}</div></div>
        <div class="card stat"><div class="eyebrow">AO12</div><div class="v">${secs(s.ao12)}</div><div class="d">${s.ao12 === null ? `needs ${Math.max(0, 12 - s.count)} more` : 'last twelve'}</div></div>
      </div>
      <div class="grid3">
        <div class="card stat"><div class="eyebrow">${t('TURN RATE')}</div>
          <div class="v">${s.turnRate === null ? '—' : `${s.turnRate.tps.toFixed(2)}`}</div>
          <div class="d">${s.turnRate === null
            ? t('a turn rate is a fact about a move stream — pair a smart cube to earn one')
            : escHtml(plural(s.cubeTimed, {
              // ONE key, not three. The old form was `t('turns per second, over') + count +
              // t('cube-timed solve[s]')`, which a translation cannot reorder and cannot inflect:
              // a language that puts the count last, or that agrees the noun with it, had no way
              // to express the sentence at all.
              one: 'turns per second, over %1 cube-timed solve',
              other: 'turns per second, over %1 cube-timed solves',
            }))}</div></div>
      </div>
      <div class="card"><div class="eyebrow">${escHtml(plural(chart.length, { one: 'LAST %1 SOLVE', other: 'LAST %1 SOLVES' }))}</div>
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
        ${week.map((d, i) => `<div title="${escHtml(plural(d.count, { one: '%1 solve', other: '%1 solves' }))}${d.best === null ? '' : ` · ${t('best')} ${secs(d.best)}`}" style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;height:100%;justify-content:flex-end">
          <div style="width:100%;border-radius:3px 3px 0 0;height:${d.count ? Math.max(6, Math.round((d.count / busiest) * 100)) : 2}%;background:${i === week.length - 1 && d.count ? 'var(--accent)' : 'var(--ink-6)'}"></div>
          <div style="font-size:var(--fs-meta);color:var(--ink-5)">${d.label}</div></div>`).join('')}</div>
        <div class="sub" style="color:var(--ink-5);margin-top:14px;font-size:var(--fs-meta)">Solves per day. Only solves recorded with a date appear here.</div></div>
    </div></div>`, mount() {} };
};

// ---- Preview screens ---------------------------------------------------------------------
//
// Trainer, Drill and Lessons are LAYOUTS, not features: the compositions exist, nothing behind
// them does. That is a legitimate state for a screen to be in — the design work is real and the
// rows are how it was reviewed — but until 2026-09-04 they said it by showing invented figures.
// "82% recall", "2.14 average execution, 9 reps", "4/4 Done", a queue with due dates, five case
// cards with per-case mastery bars: every one of those numbers described nothing, and they were
// one Advanced toggle away from a beginner who would read them as their own.
//
// The app's own rule is that a statistic that cannot be computed is a dash, never a number, and
// it is enforced everywhere else — Stats replaced its whole invented dashboard with computed
// figures or em dashes, and the Timer's "last five" starts empty rather than seeded. These three
// screens were the exception, and an exception one URL away is not an exception, it is the rule
// being broken quietly.
//
// So: every figure is an em dash, every screen states in words that nothing here is measured,
// and the controls that would pretend to do something are disabled rather than silently inert.
// A layout can be reviewed perfectly well with dashes in it. When one of these grows a real
// engine, the dash is exactly the place the real number goes.
const PREVIEW_NOTE = 'Preview — nothing here is measured yet';
const previewBanner = () => `<div class="card" style="padding:12px 16px;display:flex;gap:10px;align-items:center">
  <span class="ico" style="color:var(--ink-5);flex:none">${icon('book', 16)}</span>
  <div class="sub" style="color:var(--ink-3);line-height:1.5"><b>${escHtml(t(PREVIEW_NOTE))}</b> — ${escHtml(t('this screen is a design in progress. The layout is real; the figures are placeholders shown as dashes, and the controls do nothing yet.'))}</div>
</div>`;

SCREENS.trainer = () => {
  const P2 = NET_COLORS[settings.palette] || NET_COLORS.muted;
  // The algs are REAL algorithms and stay — they are facts about a cube, not claims about you.
  // What went are the per-case percentages and the colour that ranked them.
  const oll = [
    ['OLL 21', "R U2 R' U' R U R' U' R U' R'"],
    ['OLL 22', "R U2 R2 U' R2 U' R2 U2 R"],
    ['OLL 24', "r U R' U' r' F R F'"],
    ['OLL 27', "R U R' U R U2 R'"],
    ['PLL T', "R U R' U' R' F R2 U' R' U' R U R' F'"],
    ['PLL Y', "F R U' R' U' R U R' F' R U R' U' R' F R F'"],
  ];
  const grid = (seed) => Array.from({ length: 9 }, (_, i) => ((i * 7 + seed * 3) % 4 === 0 ? P2.D : 'var(--facelet-off)'));
  // width:100% — the screen centres its child (see the timer). The case grid wraps as many
  // 140px cards as fit rather than dividing the width into five.
  return { html: `<div style="width:100%;height:100%;display:flex;flex-direction:column;gap:16px">
    ${previewBanner()}
    <div class="wrap-row" role="group" aria-label="${escHtml(t('Case filters'))}">${['OLL', 'PLL', 'F2L', 'Weak first'].map((f, i) => `<button class="pill" aria-pressed="${i === 0}" disabled>${escHtml(f)}</button>`).join('')}<span class="sub" style="margin-left:auto;color:var(--ink-4)">${escHtml(t('Recall is not recorded yet'))}</span></div>
    <div class="case-grid">
    ${oll.map(([name, alg], i) => `<div class="card" style="text-align:center">
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;width:76px;margin:0 auto">${grid(i).map((g) => `<div style="aspect-ratio:1;border-radius:var(--r-sticker);background:${g}"></div>`).join('')}</div>
      <div style="font-weight:700;margin-top:10px">${escHtml(name)}</div><div class="num sub" style="color:var(--ink-4);min-height:28px;font-size:var(--fs-caption)">${escHtml(alg)}</div>
      <div class="num sub" style="margin-top:6px;color:var(--ink-5)">—</div></div>`).join('')}</div></div>`, mount() {} };
};

SCREENS.drill = () => {
  const P2 = NET_COLORS[settings.palette] || NET_COLORS.muted;
  const grid = Array.from({ length: 9 }, (_, i) => ((i * 7 + 9) % 4 === 0 ? P2.D : 'var(--facelet-off)'));
  // `flow`: the flashcard is taller than a phone's locked primary region, and its controls
  // (Reveal, Again / Good / Easy) must never sit below a fold — so the box scrolls as one.
  //
  // Reveal STILL WORKS: it shows a real algorithm, which is a fact rather than a measurement, and
  // it is the one thing on this screen that does what it says. The spaced-repetition grades are
  // disabled — pressing "Good" recorded nothing and scheduled nothing.
  return { html: `<div class="cols flow"><div class="col">${previewBanner()}<div class="card" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px">
      <div class="eyebrow">OLL 24 · ${escHtml(t('DOT CASES'))}</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;width:180px">${grid.map((g) => `<div style="aspect-ratio:1;border-radius:var(--r-sticker);background:${g}"></div>`).join('')}</div>
      <div class="num" id="drillAlg" style="font-size:var(--fs-display-s);font-weight:600;color:var(--ink-6)">· · · · · · · ·</div>
      <button class="btn accent-outline" id="reveal">${escHtml(t('Reveal algorithm'))}</button>
      <div style="display:flex;gap:10px" role="group" aria-label="${escHtml(t('How well did that go'))}"><button class="btn outline" disabled>${escHtml(t('Again'))}</button><button class="btn outline" disabled>${escHtml(t('Good'))}</button><button class="btn primary" disabled>${escHtml(t('Easy'))}</button></div>
    </div></div>
    <div class="aside"><div class="card"><div class="eyebrow">${escHtml(t('THIS DRILL'))}</div><div class="num" style="font-size:var(--fs-display);font-weight:600;margin-top:6px">—</div><div class="sub" style="color:var(--ink-4)">${escHtml(t('average execution — nothing recorded yet'))}</div></div>
      <div class="card" style="flex:1;min-height:0"><div class="eyebrow">${escHtml(t('QUEUE'))}</div><div class="sub" style="color:var(--ink-4);margin-top:8px;line-height:1.5">${escHtml(t('A queue needs a schedule, and a schedule needs solves this screen does not record yet.'))}</div></div></div></div>`,
    mount(root) {
      let shown = false; const alg = "r U R' U' r' F R F'";
      $('#reveal', root).onclick = (e) => { shown = !shown; $('#drillAlg', root).textContent = shown ? alg : '· · · · · · · ·'; $('#drillAlg', root).style.color = shown ? 'var(--ink)' : 'var(--ink-6)'; e.target.textContent = shown ? t('Hide algorithm') : t('Reveal algorithm'); };
    },
  };
};

SCREENS.lessons = () => {
  // Titles and durations are the SYLLABUS — a plan, and plans are allowed to be written down.
  // What went are the progress claims: "4/4", "1/3", four lessons marked Done and one Next, on a
  // course nobody has taken a minute of. A tag that says where you are is a measurement.
  const ch = [
    ['CHAPTER 1', 'Beginner layer method', ['White cross', 'First layer corners', 'Middle layer', 'Last layer']],
    ['CHAPTER 2', 'Getting under a minute', ['Efficient cross', 'Keyhole F2L', 'Look-ahead drills']],
  ];
  return { html: `<div class="cols flow"><div class="col">
    ${previewBanner()}
    ${ch.map(([kick, title, ls]) => `<div class="card tight"><div class="card-h"><div><div class="eyebrow">${escHtml(kick)} · ${ls.length} ${escHtml(t('LESSONS'))}</div><div class="num" style="font-size:var(--fs-title);font-weight:600;margin-top:2px">${escHtml(title)}</div></div><div class="num sub" style="color:var(--ink-4)">—</div></div>
      ${ls.map((name) => `<div class="row" style="grid-template-columns:8px 1fr auto;gap:14px"><div style="width:8px;height:8px;border-radius:50%;background:var(--ink-6)"></div><div style="color:var(--ink)">${escHtml(name)}</div><div class="num sub" style="color:var(--ink-5)">—</div></div>`).join('')}</div>`).join('')}</div>
    <div class="aside"><div class="card"><div class="eyebrow">${escHtml(t('UP NEXT'))}</div><div class="sub" style="color:var(--ink-3);margin-top:8px;line-height:1.5">${escHtml(t('There is no next lesson until the lessons exist. The chapters above are the plan.'))}</div></div>
      <div class="card"><div class="eyebrow">${escHtml(t('COACH VIEW'))}</div><div class="sub" style="color:var(--ink-3);margin-top:8px;line-height:1.5">${escHtml(t('The idea: share a read-only link so a parent or coach can follow progress. Nothing to share yet.'))}</div></div></div></div>`, mount() {} };
};

// ===============================================================================================
// Router + boot
// ===============================================================================================
/** The Advanced chord, spelled the way THIS platform spells it.
 *
 *  The handler requires Ctrl + Alt + Meta + D on every platform, and the copy printed the macOS
 *  glyphs — ⌃⌥⌘D — everywhere. On Windows and Linux the third key is Super/Win, and a person
 *  reading "⌘" there has been handed a key their keyboard does not have (found by audit,
 *  2026-09-04). The chord itself is unchanged: `e.code` is layout-independent and all three
 *  modifiers are required, which is what keeps it from colliding with anything a person types. */
const advancedChordWords = () =>
  (hostPlatform() === 'macos' ? '⌃⌥⌘D' : 'Ctrl + Alt + Win + D');

// The Advanced chord reveals (and hides) the Advanced section in Settings.
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
  // The label is DRAWN in one composition and undrawn in the other, from one DOM — the same
  // rule the row's position follows. Portrait is a bottom tab bar with a word under every icon
  // (the 49px height is the one iOS sizes for exactly that); landscape floats the row between
  // the title bar's outer zones, where there was never room for words — that is what fitTabs()
  // used to measure before the labels went away entirely on 2026-08-30.
  //
  // `aria-label` stays on the button in BOTH, and is what makes hiding the span safe: an
  // accessible name given explicitly wins over the element's contents, so the landscape row is
  // announced identically to the portrait one. Hiding a span that was the ONLY source of the
  // name is what would leave a row of anonymous buttons — which is why the name was moved onto
  // the button first, and stays there now that the word is back.
  $('#nav').innerHTML = `<div class="capsule">${items.map(([id, lbl, ic]) => `<button class="nav-item ${state.screen === id ? 'active' : ''}" data-nav="${id}" title="${t(lbl)}" aria-label="${t(lbl)}"${state.screen === id ? ' aria-current="page"' : ''}><span class="ico">${icon(ic, 15)}</span><span class="lbl">${t(lbl)}</span></button>`).join('')}</div>`;
  for (const b of $('#nav').querySelectorAll('[data-nav]')) b.onclick = () => go(b.dataset.nav);
  // Settings sits outside the row (buildChrome draws it), so it is marked here, not by the template.
  // The GEAR, found by its label: the smart-cube indicator beside it also carries
  // data-nav="settings" and comes first in the bar, so a data-nav match marked the hidden
  // indicator and the visible gear never once said "you are here".
  $('#tbTrail [aria-label="Settings"]')?.classList.toggle('active', state.screen === 'settings');
}

/** The spec currently on the stage — what refreshScreen() asks to take a new subject. */
let liveScreen = null;
let refreshing = false;

/**
 * Push a change of SUBJECT into the screen already on the paper.
 *
 * The app had one seam for "same screen, new data" — `liveUpdate`, which exists so a live cube
 * snapshot repaints instead of re-mounting, "which on the cube screen would restart an animation
 * the user is halfway through". It had none for "same screen, new SUBJECT", so a dozen callers
 * reached for a full renderScreen() to change one cube: the die, both reconnect answers, the
 * silence report, the snapshot fallback. Each of those destroyed the screen to change a fact
 * about it. This is that missing seam; a screen that cannot take the change in place says so,
 * and gets rebuilt exactly as before.
 */
function refreshScreen() {
  // A retarget repaints things that can call back into here — the reconnect answers are re-wired
  // by it — and a rebuild from inside a retarget would pull the DOM out from under the caller.
  if (refreshing) return;
  refreshing = true;
  let took = false;
  try { took = liveScreen?.update?.() === true; }
  catch (err) { console.error('screen could not take the new subject; rebuilding', err); }
  finally { refreshing = false; }
  if (!took) renderScreen();
}

/** What the stage shows when a screen could not be built at all.
 *
 *  On the paper, in the app's own type, and with a way out — because the alternative this
 *  replaced was the previous screen's DOM sitting under the new screen's title, which is worse
 *  than an error: it is an app that quietly shows you the wrong thing. Deliberately a plain
 *  spec with a no-op mount, so nothing about the failing screen is re-entered here. */
const brokenScreen = (id) => ({
  html: `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center">
    <div class="card" style="max-width:460px;text-align:center;padding:34px">
      <div class="eyebrow">${escHtml(t('THIS SCREEN DID NOT OPEN'))}</div>
      <div style="font-size:var(--fs-title);font-weight:600;margin-top:10px">${escHtml(t('Something went wrong drawing this screen'))}</div>
      <div class="sub" style="color:var(--ink-3);margin-top:8px;line-height:1.55">${escHtml(t('Nothing you did caused it, and nothing is lost. The other screens still work; reloading the app usually clears it.'))}</div>
      <button class="btn accent-outline block" data-go="home" style="margin-top:18px">${escHtml(t('Go to the cube'))}</button>
    </div></div>`,
  mount() {},
  broken: id,
});

/** The screen id focus was last moved for. A REPAINT of the screen you are on must not steal
 *  focus — Settings repaints itself on a battery reply, a trust change and every toggle, and
 *  each one would have taken the caret out of whatever was being typed. */
let focusedScreen = null;

function renderScreen({ navigated = false } = {}) {
  // Logged, not swallowed. A teardown that throws half-way leaves the half after it undone — a
  // camera still open, a wake lock still held, a search still running — and an empty catch made
  // that indistinguishable from a clean teardown.
  if (cleanup) {
    try { cleanup(); } catch (err) { console.error('screen teardown failed part-way', err); }
    cleanup = null;
  }
  // A multi-hour native proof must not outlive the screen that asked for it. Cancelling on
  // every switch is a cheap no-op when nothing runs, and the one reliable teardown when it
  // does. Caught, not fire-and-forgotten: a rejection here is a torn IPC channel, worth a
  // line in the console and never an unhandled-rejection banner. (A RETARGET is the other way
  // a proof's subject can vanish — loadWalk cancels there for the same reason.)
  if (optimalCapability()) optimalCancel().catch((err) => console.warn('optimal cancel failed', err));
  // Anything a mount listened to that OUTLIVES its screen is cut here. The document listeners
  // have always had their own teardown; the reason this exists is the parked <cubus-cube>, which
  // now survives the screen that added listeners to it — without this, every visit would leave
  // one more 'cubus-step' handler on it, each driving a chip row that is no longer on screen.
  screenAbort?.abort();
  screenAbort = new AbortController();
  liveUpdate = null;
  liveMove = null;
  liveGap = null;
  onTrustLost = null;
  setTitle(t(TITLES[state.screen] ?? 'Cubus'));
  const build = SCREENS[state.screen] || SCREENS.home;
  // A builder that throws must not leave the PREVIOUS screen's DOM standing under the new
  // title — which is exactly what happened while this was an unguarded call: the title bar and
  // the toolbar said Trainer, the paper still showed Home, and nothing anywhere said why (an
  // unknown stored palette was one way in; found by audit, 2026-09-04). The screen is replaced
  // either way, and when there is nothing to put there the paper says so in words. Loud on the
  // console too: a message a user can act on is not a stack trace a developer can.
  let spec;
  try {
    spec = build();
  } catch (err) {
    console.error(`screen "${state.screen}" could not be built`, err);
    spec = brokenScreen(state.screen);
  }
  liveScreen = spec;
  screenGen += 1; // async mounts compare against this to detect that they are obsolete
  parkCube(); // lift the renderer clear of the wipe on the next line
  // The screen is a NAMED, FOCUSABLE region. Focus used to drop to <body> on every navigation:
  // a keyboard user tabbed from the toolbar into the top of the document again, and a screen
  // reader announced nothing at all — the title bar changed, the paper changed, and the only
  // signal either of them had was silence. `tabindex="-1"` makes it programmatically focusable
  // without adding a tab stop, which is the standard shape for a single-page app's route change.
  const title = t(TITLES[state.screen] ?? 'Cubus');
  const stage = $('#stage');
  stage.innerHTML = `<div class="screen active" tabindex="-1" role="region" aria-label="${escHtml(title)}">${spec.html}</div>`;
  const root = stage.firstElementChild;
  for (const b of root.querySelectorAll('[data-go]')) b.onclick = () => go(b.dataset.go);
  // Moved only when the SCREEN changed. `preventScroll`, because the stage is a fixed box under
  // the layout contract and nothing here should ever scroll the window.
  if (navigated || focusedScreen !== state.screen) {
    focusedScreen = state.screen;
    try { root.focus({ preventScroll: true }); } catch { root.focus?.(); }
  }
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
function applyRoute() { state.screen = router.current(); renderNav(); renderScreen({ navigated: true }); }
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
  move: (m) => onCubeMove(m),
  facelets: (f, serial) => onFacelets(f, serial),
  /** A turn that reached the cube but not us. No argument: reconciliation proves the loss and
   *  cannot count it, so a seam that took a number would let a test assert something the app can
   *  never know. */
  movesLost: () => onMovesLost(),
  disconnect: () => onDisconnect(),
  /** The cube answered nothing — what connectOnce's getState rejection reports. Exposed because
   *  that path needs Web Bluetooth to exercise for real, and the silence handling is exactly the
   *  behaviour that was once an empty catch. */
  silence: () => reportSilence(),
  /** Stand in for a paired driver. Setting `state.connected` alone is deliberately not enough —
   *  a flag saying "connected" with nothing behind it must fall back to the camera, which is its
   *  own test. This is the SAME call doConnect makes, not a lookalike: the address is part of a
   *  connection, and identity is what the registry keys on — so the key is RESOLVED here the way
   *  connectOnce resolves it, from the session's own address and its name. `mac` stands in for
   *  the address a real protocol layer would have published on the session; a fake that carries
   *  its own `mac` (including the empty one five of the ten protocols report) overrides it, which
   *  is how an addressless cube can be driven through this seam at all. */
  useConnection: (fake, mac = 'AA:BB:CC:DD:EE:FF') => {
    conn = fake;
    if (fake) {
      const session = { mac: fake.mac ?? mac, name: fake.name ?? 'Test cube' };
      adoptConnection(sessionIdentity(session), session.name);
    } else onDisconnect();
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

/**
 * Read the OS insets the Android shell is holding, and write them as --os-inset-*.
 *
 * The activity PUSHES these too (MainActivity.kt), by evaluating a script 800 ms after attach —
 * a number that is right on an emulator and a guess on a slow phone. A push that lands before
 * this document exists is a first paint with the tab row under the gesture bar for the whole of
 * that render. So the web side PULLS as well, at the moment it is actually ready, and the two
 * cannot conflict: they write the same four properties from the same source of truth, and the
 * later of them simply wins.
 *
 * Android only, because that is the only platform where env() cannot see the answer: Chromium
 * reports `safe-area-inset-*` for the DISPLAY CUTOUT alone, and the gesture navigation bar is a
 * system-bar inset, so the bottom edge reads 0 (measured on a Pixel 8 emulator, 2026-08-30).
 * Everywhere else env() is right and this does nothing.
 *
 * `"null"` — a string — is the honest answer before the first dispatch, and it is left alone:
 * with no insets to write, env()'s fallback stands, which is exactly the pre-push behaviour.
 */
function pullAndroidInsets() {
  const bridge = globalThis.window?.cubusInsets;
  if (typeof bridge?.get !== 'function') return;
  let raw;
  try { raw = bridge.get(); } catch (err) { console.warn('android insets: the bridge would not answer', err); return; }
  if (typeof raw !== 'string' || raw === 'null') return;
  let px;
  try { px = JSON.parse(raw); } catch (err) { console.warn('android insets: unreadable payload', raw, err); return; }
  // Zero trust at the boundary, even though the other side is ours: this crosses a JNI bridge as
  // text, and a malformed number reaching setProperty is a silently broken layout rather than an
  // error. Every side must be a finite, non-negative number or the whole answer is refused.
  const sides = ['t', 'r', 'b', 'l'];
  if (!px || typeof px !== 'object' || sides.some((k) => !Number.isFinite(px[k]) || px[k] < 0)) {
    console.warn('android insets: not four non-negative numbers', raw);
    return;
  }
  const app = $('.app');
  if (!app) return;
  for (const k of sides) app.style.setProperty(`--os-inset-${k}`, `${px[k]}px`);
}

/**
 * The self-updater, or null where there is nothing to update.
 *
 * LAZY, and that is the whole point of the function rather than a const.
 *
 * `hostPlatform()` reads `<html data-platform>`, which `boot()` publishes — and a module-level
 * const is evaluated when this file is IMPORTED, before boot has run. So the first version of this
 * asked which platform it was on before anything had said, got null, and disabled itself on every
 * platform including the ones it was written for. The feature shipped in 0.2.4 completely inert:
 * no Settings row, no launch check, nothing to see, on macOS and Windows and Linux alike.
 *
 * Nothing caught it because the tests drive `makeUpdater` and `selfUpdateSupported` directly, and
 * both were right. The wiring between them and the host was the part with no test, and the module
 * note in host.js had already written the trap down: the platform string is "published on
 * <html data-platform> BEFORE the first screen renders" — before the screen, and after this file
 * is evaluated.
 *
 * Memoised on first use, which is after boot by construction: the Settings row and the launch
 * check are both reached from a rendered screen.
 */
let updaterInstance;
function appUpdater() {
  if (updaterInstance !== undefined) return updaterInstance;
  updaterInstance =
    isTauri && isDesktopHost() && selfUpdateSupported(hostPlatform())
      ? makeUpdater({
          api: window.__TAURI__,
          storage: (() => {
            try {
              return window.localStorage;
            } catch {
              return null;
            }
          })(),
          // A NATIVE question. The app has no general modal, and one invented for this would be a
          // new component in a design system that does not have it — for a question the OS draws
          // better.
          // Through t() like every other sentence. This dialog was written after i18n landed and
          // skipped it, so the one moment the app interrupts a user was the one it could not say
          // in their language.
          confirm: (update) =>
            window.__TAURI__?.dialog?.ask?.(
              t('Cubus %1 is available. You have %2.\n\nInstall it and restart?', update.version, VERSION),
              {
                title: t('A newer Cubus'),
                kind: 'info',
                okLabel: t('Install and restart'),
                cancelLabel: t('Not now'),
              },
            ) ?? false,
          warn: (msg, err) => console.warn(msg, err ?? ''),
        })
      : null;
  return updaterInstance;
}

/**
 * The privacy claim on the About card, and it has to be TRUE on the build it is drawn on.
 *
 * "Nothing leaves the device" sat directly under a "Check now" button that makes an HTTPS request
 * to github.com, and the desktop build makes the same request once a day on its own (found by
 * audit, 2026-09-04). Everything else about the sentence was right — no analytics, no crash
 * reporting, camera frames never leave the machine, the solver and the scanner are local — so the
 * fix is to say the one exception rather than to drop a true sentence for a vague one.
 *
 * Keyed on the updater's own existence, which is the same gate the Check now row uses: where
 * there is no self-updater there is genuinely no network activity at all, and the browser build
 * must not apologise for a request it never makes.
 */
export const privacyLine = (selfUpdates) => (selfUpdates
  ? 'Solver and vision run locally, and camera frames never leave this device. The only thing cubus sends anywhere is a daily question to github.com asking whether a newer version exists — nothing about you or your cube goes with it.'
  : 'Solver and vision run locally. Nothing leaves the device.');
/** The sentence for THIS build. Split from the wording above so a test can check both halves
 *  without a Tauri window: the fact is the argument, the claim is the function. */
const privacySentence = () => privacyLine(Boolean(appUpdater()));

/** Say the outcome of a check the user ASKED for. A launch check stays silent unless it found one. */
async function reportUpdateOutcome(result) {
  const say = (message, kind = 'info') =>
    window.__TAURI__?.dialog?.message?.(message, { title: 'Cubus', kind });
  if (result.status === 'current') return say(t('Cubus %1 is the latest version.', VERSION));
  if (result.status === 'error') return say(t('Could not reach the update server. Check your connection and try again.'), 'warning');
  if (result.status === 'failed') return say(t('The update could not be installed. Try again, or download it from the website.'), 'error');
  if (result.status === 'installed-needs-restart') return say(t('The update is installed. Quit and reopen Cubus to use it.'));
  // 'unavailable' means the updater exists but cannot check here — no signature, no endpoint, a
  // build that was not packaged for updates. Silence was the old answer, and silence after a
  // press of "Check now" is indistinguishable from a button that does nothing.
  if (result.status === 'unavailable') return say(t('Updates are not available for this copy of Cubus. Download the latest version from the website.'), 'warning');
  // Anything else is a status this function has not been taught. It still answers, because the
  // user pressed a button: an unrecognised outcome is a fact, not a reason to say nothing.
  if (result.status !== 'installed' && result.status !== 'declined') {
    console.warn('app-update: unrecognised outcome', result);
    return say(t('The update check finished without a clear answer. Try again in a moment.'), 'warning');
  }
  return undefined;
}

async function boot() {
  assertStageSupport();
  applyInsetOverride();
  const platform = detectPlatform();
  document.documentElement.dataset.host = isTauri ? 'tauri' : 'web';
  document.documentElement.dataset.platform = platform;
  // Before the first screen renders, so the first paint has the real bottom edge rather than the
  // one an 800 ms timer will correct afterwards.
  if (platform === 'android') pullAndroidInsets();
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
  if (await loadSolver()) {
    // The registry was parsed before the cube library existed, so its remembered arrangements
    // have passed only the structural checks. Re-parse with the full reachability round-trip:
    // a forged state that merely looks like facelets is dropped whole here, not shown later.
    cubes = parseRegistry(cubes, Cube);
    setFacelets(state.cube.facelets);
    schedulePreroll(); // so the first press of the die is as cheap as every one after it
    // NO RE-RENDER. Both screens that could want one already await loadSolver() inside their own
    // mount — cubeScreen's loadWalk does, the Timer's newScr does — so this rebuilt a screen that
    // was about to say the same thing, throwing away its DOM, its listeners and (on Home) a walk
    // that had just been drawn. 'viewer' in that list had not been a screen key since the cube
    // screen absorbed it, which is how long nobody had looked at this line.
  }
  // LAST, and on a timer. The check is the least important thing happening at startup, and the app
  // measures its own first paint closely enough that a DNS lookup inside that window would change
  // the numbers. It also stays quiet: `checkOnLaunch` throttles to once a day and only interrupts
  // when there is genuinely something to install.
  if (appUpdater()) {
    setTimeout(() => {
      appUpdater().checkOnLaunch().catch((e) => console.warn('app-update: launch check failed', e));
    }, STARTUP_DELAY_MS);
  }
}
boot();
