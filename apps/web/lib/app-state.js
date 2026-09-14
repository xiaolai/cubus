// The shared app state (`state`) and the small DOM helpers every screen uses: `$`, `escHtml`, the
// icon set, the navigation table and the window titles.
//
// Lifted out of app.js on 2026-09-13, when that file was split into modules.

import { SOLVED_FACELETS } from './solved.js';

export const $ = (sel, root = document) => root.querySelector(sel);
/** A cube with nothing wrong with it: the solved state, and the one search that costs only the
 *  tables. Read from lib/solved.js, the one place the 54 characters are written: this file, the
 *  trust offset and the solve timer each carried a copy, and identical literals are how a cube
 *  comes to be solved in one place and not in another. */
export const SOLVED = SOLVED_FACELETS;
/** Escape text destined for an innerHTML template. Scramble strings, solve times and anything
 * else out of localStorage are untrusted input — storage is writable by anything on the origin —
 * and must never be parsed as markup. Screens that can use textContent do; this is for the ones
 * building an HTML string. */
export const escHtml = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

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
  webcam: '<circle cx="12" cy="10" r="8"/><circle class="lens" cx="12" cy="10" r="3"/><path d="M7 22h10"/><path d="M12 22v-4"/>',
  'paint-roller': '<rect width="16" height="6" x="2" y="2" rx="2"/><path d="M10 16v-2a2 2 0 0 1 2-2h8a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect width="4" height="6" x="8" y="16" rx="1"/>',
  // The About card's three row markers, drawn by hand in the same 24×24 stroke grammar as the
  // rest of this map — no icon library behind them, same as everything above.
  tag: '<path d="M12.6 2.6 21 11a2 2 0 0 1 0 2.8l-7.2 7.2a2 2 0 0 1-2.8 0L2.6 12.6A2 2 0 0 1 2 11.2V4a2 2 0 0 1 2-2h7.2a2 2 0 0 1 1.4.6Z"/><circle cx="7.5" cy="7.5" r="1.3"/>',
  bluetooth: '<path d="m7 7 10 10-5 5V2l5 5L7 17"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.3 4 5.6 4 9s-1.5 6.7-4 9c-2.5-2.3-4-5.6-4-9s1.5-6.7 4-9Z"/>',
  user: '<circle cx="12" cy="7.5" r="3.5"/><path d="M5 20.5c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>',
};
// Only its own names: an inherited one — `toString`, `__proto__` — drew native function text or
// "[object Object]" where a glyph belongs (found by audit, 2026-09-13).
export const icon = (name, size = 16) => `<svg class="ic" viewBox="0 0 24 24" style="width:${size}px;height:${size}px">${Object.hasOwn(P, name) ? P[name] : '<circle cx="12" cy="12" r="2"/>'}</svg>`;

// ---- navigation model ------------------------------------------------------------------------
// One flat list. The SOLVE / PRACTICE / LEARN headings were a taxonomy for nine items, which is
// fewer than the number of rows a person can scan at a glance — the labels cost three lines of
// chrome and a level of hierarchy to sort a list short enough not to need sorting.
// The tabs, in order. Settings is not among them: it is the toolbar's trailing button, drawn by
// buildChrome, because it is not a stop on the way to a solved cube. The counts that used to sit
// beside Alg trainer, Drill and Lessons (78, 12, 9) were fixed numbers describing nothing; a tab
// carries no badge until there is something real to count.
export const NAV = [
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
// Built from NAV, so a tab added or renamed there brings its title with it; only the names that
// differ from their tab's label are written here — Home is the cube, the trainer's tab is short,
// and Settings has no tab (it is the toolbar's trailing button).
export const TITLES = Object.freeze({
  ...Object.fromEntries(NAV.map(([id, label]) => [id, label])),
  home: 'Cube',
  trainer: 'Algorithm trainer',
  settings: 'Settings',
});
export const state = {
  screen: 'home',
  /**
   * Which named state the cube screen is walking TO.
   *
   * `'solved'` by default, so nothing changes for somebody who only wants their cube solved. It is
   * a fact about this cube right now rather than a preference, which is why it is here and not in
   * Settings — the same argument the ladder makes about rungs. A chip on Restore sets it; the
   * selector on the cube screen changes it; a retarget is what carries the change onto the screen
   * already standing (plan §6).
   */
  stageTarget: 'solved',
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
    facelets: SOLVED, setupAlg: '', solution: '', moves: [], solvable: false, stepFacelets: [], solveResult: null, solvedFor: null,
    // The explaining solver's answer for THIS arrangement, or null while it has not been asked.
    // A second object beside `solution`, never a replacement for it: the two answer different
    // questions and the screen offers both (§3, "a lesson and a short solution are two different
    // objects, and both stay reachable"). Cached per arrangement and per rung record, because it
    // is not free — lib/cube-subject.js measures 33 ms to 804 ms — and the screen may switch
    // back and forth.
    lesson: null,
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
