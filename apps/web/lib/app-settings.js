// Settings: loaded from storage and repaired against a stale or hostile blob before anything reads
// them, with the themes, palettes and navigation visibility they choose between.
//
// Lifted out of app.js on 2026-09-13, when that file was split into modules.

import { TIERS } from './solve-target.js';
import { DEFAULT_RUNGS, STAGE_IDS, TOP_RUNG } from './method-solver.js';
import { repairProgress } from './method-ladder.js';
import { isScheme } from './scheme.js';
import { STICKER_PALETTES } from './sticker-palettes.js';

export const load = (k, fb) => { try { return { ...fb, ...JSON.parse(localStorage.getItem(k) || '{}') }; } catch { return { ...fb }; } };
/** Persist, and say whether it worked. Storage can be full, or disabled outright in a private
 *  window — and the UI used to report "Saved" either way, so a nickname could vanish on reload
 *  with nothing having warned anyone. */
export const save = (k, v) => {
  // The false return is checked by the callers that can say something useful; the warn is for
  // every caller that cannot — a preference that silently fails to stick looks exactly like a
  // preference that stuck until the next launch proves otherwise.
  try { localStorage.setItem(k, JSON.stringify(v)); return true; }
  catch (e) { console.warn(`could not persist ${k}`, e); return false; }
};

// ---- app state -------------------------------------------------------------------------------
/**
 * The cube colours a new install gets: CLASSIC, the saturated set (owner's call, 2026-09-07).
 * It was `muted`, the warm-paper set the design kit was drawn around — which sits beautifully in
 * the app's own palette and is not what a child's cube looks like. The first thing this app has
 * to do is let someone match what is on screen to the plastic in their hand, and `classic` is the
 * set that names those colours the way a cube does.
 *
 * ONE spelling, exported, because it was seven: the settings default, the repair's fallback, and
 * five `NET_COLORS[…] || NET_COLORS.muted` reads, each free to drift from the others. A default
 * written down seven times is a default that eventually disagrees with itself.
 *
 * It changes nothing for anyone already using the app: `load` merges storage over these defaults
 * and `save` writes the whole object, so a stored palette — including a `muted` nobody ever chose
 * deliberately — is kept. This is the value for a fresh install and for a repaired one.
 * `hostile-settings.test.mjs` pins the repair against this constant rather than a copy of it.
 */
export const DEFAULT_PALETTE = 'classic';
/** The scan-guidance study's two arms (dev-docs/scan-guidance-plan.md 4.1), declared once: today's scan
 *  screen, and the sticker view beside it. A developer setting; its default, its repair, the Settings
 *  switch and the scan screen all read these. */
export const SCAN_VIEWS = Object.freeze({ today: 'today', stickers: 'dots' });
/** How the scan sounds, as three exclusive choices rather than one on/off (owner's call,
 *  2026-09-20). `sounds` was a single boolean covering the chime and the voice together, so the only
 *  way to stop a spoken line repeating was to silence the chime a child depends on. `voice` is both
 *  — the chime marks the capture at once and the line follows, because speech has latency and a tick
 *  that lands immediately is what says "it heard me". `chime` is the bell alone. `off` is silent.
 *  One value, so the two cannot come to disagree about what "sounds on" meant. */
export const SOUND_MODES = Object.freeze({ voice: 'voice', chime: 'chime', off: 'off' });
/** What a fresh install gets and what every repair below falls back to — one table, so the two
 *  cannot come to disagree about a default. */
export const DEFAULT_SETTINGS = Object.freeze({
  theme: 'auto', palette: DEFAULT_PALETTE, scheme: 'western', schemeSource: 'default', autosolve: false, cameraId: '',
  navHidden: null, navDefaults: 0, devRandCube: false, language: '', dragRotate: false, solveTier: 'twenty',
  proveMinimum: false, soundMode: SOUND_MODES.voice, devScanView: SCAN_VIEWS.today,
  // What the scan says out loud, where a line has been edited in Settings -> Advanced. Keyed by the
  // line's name in lib/screens/scan/spoken.js, which owns the defaults and the repair: this file
  // must not import a screen's module (AGENTS.md, the one-way dependency), so all it promises is
  // that the value is an object.
  spokenLines: {},
});
/** Every setting whose default is a boolean — DERIVED, so a new flag is repaired the moment it has a
 *  default, and no list kept by hand can leave one out (audit, 2026-09-19: the tests' own copies had
 *  already drifted). */
export const BOOLEAN_SETTINGS = Object.freeze(Object.keys(DEFAULT_SETTINGS).filter((k) => typeof DEFAULT_SETTINGS[k] === 'boolean'));
/** The record exactly as storage held it, so the one write at the end of this file happens only when a
 *  repair or a migration changed something — or on a first launch, when storage held nothing. */
const storedRecord = (() => { try { return localStorage.getItem('cubusSettings'); } catch { return null; } })();
export const settings = load('cubusSettings', DEFAULT_SETTINGS);
// localStorage is untrusted input, and `load` merges it raw. The string "false" is truthy, so a
// hand-edited or half-migrated flag reads as ON: proveMinimum would opt someone in to an operation
// that runs for hours, and a Settings toggle flips `!settings[k]`, so a stored "false" showed as on
// while auto-solve left a believed scan. ONE rule for every flag: a real boolean is kept, and
// anything else is the flag's DEFAULT — off for all of them but `sounds`, which is on
// (dev-docs/scan-guidance-plan.md, D3: a chime is how a child who cannot read hears a side saved).
// It was two rules until 2026-09-19, one per default, free to drift apart.
for (const flag of BOOLEAN_SETTINGS) {
  if (typeof settings[flag] !== 'boolean') settings[flag] = DEFAULT_SETTINGS[flag];
}
// The study's arm: anything but one of its two values is today's screen.
if (!Object.values(SCAN_VIEWS).includes(settings.devScanView)) settings.devScanView = DEFAULT_SETTINGS.devScanView;
// The sound mode, repaired and MIGRATED in one place. A stored `sounds: false` is a person who
// asked for silence and must keep it; anything else -- true, absent, or the string "false" that the
// boolean repair above used to catch -- becomes the default.
//
// ASKED OF THE STORED RECORD, NOT OF `settings`. `load()` merges storage over the defaults, so
// `settings.soundMode` is ALWAYS a valid mode by the time this runs -- the default supplies one --
// and a test that a chosen silence survives failed against exactly that. What decides is whether
// STORAGE held a mode: if it did not, this install predates the split and the boolean beside it is
// the only record of what anyone asked for.
const storedSound = (() => { try { return JSON.parse(storedRecord || '{}'); } catch { return {}; } })();
if (!Object.values(SOUND_MODES).includes(storedSound.soundMode)) {
  settings.soundMode = storedSound.sounds === false ? SOUND_MODES.off : DEFAULT_SETTINGS.soundMode;
}
delete settings.sounds;
// Edited spoken lines are untrusted input like everything else in this file. Only that it is an
// object is promised here; WHICH keys are real, and how long a line may be, is
// lib/screens/scan/spoken.js's to say, because that is where the lines live.
if (!settings.spokenLines || typeof settings.spokenLines !== 'object' || Array.isArray(settings.spokenLines)) {
  settings.spokenLines = {};
}
// The inspection flag is gone (it toggled a label, never a behaviour); drop the stored leftover
// rather than letting save() keep rewriting a field nothing reads — the advancedOpen precedent.
delete settings.inspection;
// `teachLevel` was a Settings dropdown offering off / beginner / F2L. It was deleted with the
// explaining solver on 2026-08-29 and it deserved deleting: the rung is a FACT ABOUT THE LEARNER,
// not a preference, and four dropdowns would be a configuration screen inside a children's app.
// The stored leftover goes the same way `inspection` did.
delete settings.teachLevel;

/**
 * Which rung of each stage this learner is on — dev-docs/method-solver-return-plan.md §2/§3.
 *
 * Four independent dials, not one level: you learn to plan the cross long before you learn 57
 * OLLs, and the removed design forced those onto one axis. The default is the bottom rung
 * everywhere, so a new learner chooses nothing and is shown the beginner's method — the same
 * discipline `DEFAULT_HIDDEN` already applies to the nav.
 *
 * localStorage is untrusted input, so this is repaired rather than believed: anything that is not
 * an integer inside the ladder falls back to 0. A stored 9 would otherwise throw out of
 * `methodFor` on the first solve and take the screen with it — the `language: 7` failure again.
 */
function repairRungs(stored) {
  const out = { ...DEFAULT_RUNGS };
  for (const id of STAGE_IDS) {
    const want = stored?.[id];
    if (Number.isInteger(want) && want >= 0 && want <= TOP_RUNG[id]) out[id] = want;
  }
  return out;
}
settings.rungs = repairRungs(settings.rungs);
// How many times each stage has been followed to the end at its current rung, and how often its
// next rung has been declined. §3 rule 3 — "offer, never ask" — is a rule about counting, so the
// counts are stored; repaired on load for the same reason the rungs are.
settings.rungProgress = repairProgress(settings.rungProgress);

/** The themes, as stored. Auto is a policy rather than a theme: white while the system is light,
 * night while it is dark (tokens.css). Cream is the warm option you choose, not the default you
 * get — it was the auto-light appearance until 2026-08-31. */
export const THEMES = ['auto', 'white', 'cream', 'night'];
// The names changed when White arrived: the kit's "light" is Cream and its "dark" is Night. A
// stored value from before is mapped rather than dropped, so nobody's window changes colour on
// update; anything else in that field is not a theme and falls back to the default. Looked up
// only as an OWN name of a string: an object carrying `toString: null` threw out of the lookup at
// import, so the app never booted, and "__proto__" found Object.prototype and kept it (found by
// audit, 2026-09-13).
{
  const LEGACY_THEMES = { light: 'cream', dark: 'night' };
  const stored = settings.theme;
  settings.theme = typeof stored === 'string' && Object.hasOwn(LEGACY_THEMES, stored)
    ? LEGACY_THEMES[stored]
    : (THEMES.includes(stored) ? stored : DEFAULT_SETTINGS.theme);
}

/** The cube palettes, as stored: the keys of the one sticker table (lib/sticker-palettes.js).
 *  Validated at load for the same reason the theme is: localStorage is untrusted
 *  input, and an unknown value here was not a cosmetic fallback but a crash. `NET_COLORS[p]`
 *  returned undefined at three sites with no `||`, so Trainer, Drill and the Settings swatch
 *  threw on the first property read and left the previous screen's DOM under the new title
 *  (found by audit, 2026-09-04). Repaired ONCE, here, and saved — so a hand-edited value is
 *  corrected rather than re-read on every render — with the `||` kept at every read as the
 *  belt: this validation is what makes them unreachable, not what replaces them. */
export const PALETTES = Object.freeze(Object.keys(STICKER_PALETTES));
/** Where the app's belief about the cube's colour arrangement came from (ADR 0001 §8.3):
 *  nobody has said (the default), the user set it, or a decisive scan established it. */
const SCHEME_SOURCES = ['default', 'user', 'scan'];
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
  [() => PALETTES.includes(settings.palette), () => { settings.palette = DEFAULT_SETTINGS.palette; }],
  // The cube's colour arrangement, and WHERE THAT BELIEF CAME FROM (ADR 0001 §8.3). A stored
  // value replaced by the fallback carries no evidence, so the source falls back with it — a
  // repaired scheme is a default, never a scan's verdict.
  [() => isScheme(settings.scheme), () => {
    settings.scheme = DEFAULT_SETTINGS.scheme; settings.schemeSource = DEFAULT_SETTINGS.schemeSource;
  }],
  [() => SCHEME_SOURCES.includes(settings.schemeSource), () => { settings.schemeSource = DEFAULT_SETTINGS.schemeSource; }],
  [() => TIERS.some((tier) => tier.name === settings.solveTier), () => { settings.solveTier = DEFAULT_SETTINGS.solveTier; }],
  [() => typeof settings.language === 'string', () => { settings.language = DEFAULT_SETTINGS.language; }],
  [() => typeof settings.cameraId === 'string', () => { settings.cameraId = DEFAULT_SETTINGS.cameraId; }],
  [() => Number.isFinite(settings.navDefaults), () => { settings.navDefaults = DEFAULT_SETTINGS.navDefaults; }],
];
// Written back by the one write at the end of this file, with every other repair and migration.
for (const [ok, fix] of repairs) if (!ok()) fix();

/** Is the Advanced section revealed? Deliberately NOT part of `settings`, so it is not persisted:
 * a section you reach with an undocumented chord should start closed every time, not stay open
 * forever because you once looked at it. What it CONTROLS (navHidden) is a real preference and is
 * saved; the disclosure itself lasts for this page only.
 *
 * Earlier versions stored it, so drop any leftover key rather than letting `save()` keep rewriting
 * a field nothing reads. */
delete settings.advanced;

/** Tabs the Advanced section can hide, in tab order. Hiding is cosmetic: the route
 * keeps working, so a deep link or a typed #/timer still gets you there. */
export const HIDEABLE = [
  ['timer', 'Timer'],
  ['stats', 'Stats'],
  ['trainer', 'Alg trainer'],
  ['drill', 'Drill'],
  ['lessons', 'Lessons'],
  ['course', 'Course'],
];

/** Hidden unless asked for. Timer and Stats are speedcubing instruments, not part of learning to
 * solve a cube. (Stats used to be hidden because it showed invented numbers; phase 5 replaced
 * every one of them with a computed figure or an em dash, so it is hidden now only because a
 * beginner does not need an ao12 — not because it lies.) Alg trainer, Drill and Lessons are still
 * the other class: representative screens with placeholder content. The default tab row is the beginner's path;
 * everything else is one chord away. In CODE, not only in a stored preference: the hidden set
 * was once a preference alone, and one wiped localStorage brought five placeholder screens back
 * into the toolbar. Version 2 hides the three once for anyone who already ran the app. */
export const DEFAULT_HIDDEN = ['timer', 'stats', 'trainer', 'drill', 'lessons', 'course'];

/**
 * What each version ADDED, so a bump applies a delta rather than the whole set.
 *
 * Version 2 applied `DEFAULT_HIDDEN` wholesale, which was right when it shipped because everything
 * in it was new. Doing that again at 3 would re-hide every tab somebody had deliberately brought
 * back — their Timer and Stats would vanish because a Course screen was added, and the comment
 * above already promises that a bump "neither repeats nor re-hides something deliberately brought
 * back". A delta is what makes that sentence true for every version after the first.
 */
const NAV_ADDED = Object.freeze({
  2: ['timer', 'stats', 'trainer', 'drill', 'lessons'],
  3: ['course'],
});
export const NAV_DEFAULTS_VERSION = 3;

// localStorage is untrusted input: anything in here that is not a hideable id is dropped rather
// than allowed to silently remove some other nav entry.
const HIDEABLE_IDS = new Set(HIDEABLE.map(([id]) => id));
settings.navHidden = (Array.isArray(settings.navHidden) ? settings.navHidden : DEFAULT_HIDDEN)
  .filter((id) => HIDEABLE_IDS.has(id));

// A stored preference outranks a changed default, so shipping a new default alone would do nothing
// for anyone who has already run the app — their saved `navHidden: []` wins forever. Applied once,
// marked, and saved (by the one write below), so it neither repeats nor re-hides something deliberately
// brought back.
/**
 * Apply the nav-default migrations that a record at `navDefaults` has not had yet.
 *
 * A FUNCTION, and exported, because the loop this replaces was module-scope statements nothing
 * could call — so the two ways it went wrong could only be found by booting the app with a hostile
 * record, which is exactly the kind of check that never gets written.
 *
 * IT WALKS THE KNOWN MIGRATIONS, never a counter started from storage. `navDefaults` is untrusted
 * like every other field here, and counting from it fails two ways, both reproduced: a stored
 * `-1e100` never increments — `-1e100 + 1 === -1e100` in floating point — so the loop never
 * terminates and THE APP NEVER STARTS; and a stored `2.5` starts at `3.5`, runs no migration at
 * all, and is then stamped as version 3, so the Course tab silently never gets its default.
 * Walking a fixed list cannot do either.
 *
 * A version that is not a whole number ≥ 0 is treated as 0, which applies every migration — the
 * safe direction, since these only ever ADD to the hidden set.
 */
export function migrateNavDefaults(navDefaults, navHidden, added = NAV_ADDED, to = NAV_DEFAULTS_VERSION) {
  const from = Number.isInteger(navDefaults) && navDefaults >= 0 ? navDefaults : 0;
  if (from >= to) return { navDefaults, navHidden };
  let hidden = navHidden;
  for (const v of Object.keys(added).map(Number).sort((a, b) => a - b)) {
    if (v > from) hidden = [...new Set([...hidden, ...added[v]])];
  }
  return { navDefaults: to, navHidden: hidden };
}

{
  const migrated = migrateNavDefaults(settings.navDefaults, settings.navHidden);
  settings.navDefaults = migrated.navDefaults;
  settings.navHidden = migrated.navHidden;
}

// ONE write, after every repair and migration above. Each used to save on its own, and only three of
// them did: the rung and progress repairs, the dropped leftover keys, the nav filter and the flag
// coercion changed the record in memory and left storage as it was, so a hand-edited value was
// re-read and re-repaired on every launch — the opposite of what the repair table promised. Compared
// with what storage held, so a clean record is not rewritten each launch (found by audit, 2026-09-13).
if (JSON.stringify(settings) !== storedRecord) save('cubusSettings', settings);
// Checked per call, not just once at load: a stored id that is not hideable must never be able to
// hide some OTHER nav entry (a stray "home" in there would take Home out of the toolbar).
export const navHidden = (id) => HIDEABLE_IDS.has(id) && settings.navHidden.includes(id);
