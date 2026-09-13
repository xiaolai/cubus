// The screen shell: the screen registry, rendering and refreshing a screen, the router and
// navigation, popover placement, and the app-wide keyboard shortcuts.
//
// Lifted out of app.js on 2026-09-13, when that file was split into modules.

import { cancel as optimalCancel, capability as optimalCapability } from './optimal.js';
import { hostPlatform } from './host.js';
import { makeRouter } from './router.js';
import { t } from './i18n.js';

import { $, NAV, TITLES, escHtml, icon, state } from './app-state.js';
import { navHidden } from './app-settings.js';
import { hooks, shell } from './screen-slots.js';
import { parkCube } from './cube-drawing.js';
import { setTitle } from './window-chrome.js';

export let advancedOpen = false;

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
export const stageRect = () => $('#stage').getBoundingClientRect();

/** Vertical placement for a popover. The stylesheet's cap bounds SIZE but cannot know POSITION,
 *  so the room that remains is computed here: below the anchor when that fits or is the roomier
 *  side, above it otherwise — and always capped to the room actually there, so the popover
 *  scrolls rather than running off either edge of the stage. */
export const placePopoverV = (el, anchorRect) => {
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
export const placeMenuUnder = (btn, menu) => {
  const r = btn.getBoundingClientRect();
  const s = stageRect();
  const w = menu.offsetWidth;
  menu.style.left = `${Math.min(Math.max(8, r.right - s.left - w), s.width - w - 8)}px`;
  placePopoverV(menu, r);
};

/** Aborted by the next render. A listener a mount puts on something that OUTLIVES its screen —
 *  the document, or the parked <cubus-cube> — must carry this signal, or the handlers stack up
 *  one per visit and the element arrives at its next screen still driving the last one's DOM.
 *  Captured at the top of an async mount, never read late: by the time an await returns, the
 *  module-level value may already belong to the screen that replaced it. */
export let screenAbort = null;

/** Bumped by every render. An async mount that awaits a solver load or a Kociemba search can
 * outlive the screen that started it; comparing this on the far side of an await is how such a
 * mount learns it is obsolete and stops before writing to shared state like `liveUpdate`. */
export let screenGen = 0;

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
export const advancedChordWords = () =>
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
export function installExternalLinks() {
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

/**
 * ⌘, opens Settings — the macOS convention for an app's preferences — and Ctrl+, does the same
 * where the primary modifier is Ctrl. Nothing handled either until 2026-09-07: the desktop shell
 * sets no native menu, so there was no Preferences… item to claim the accelerator, and the key
 * reached the page, where nobody was listening. It is a page listener rather than a native menu
 * item on purpose: a keyboard shortcut is a capability both builds satisfy, and a menu item would
 * be a screen that exists on one build only. (A browser on macOS keeps ⌘, for its own
 * preferences and the page never sees it; that is the browser's, not a failure here, and it is
 * why the gear's hint is drawn only under the desktop shell.)
 *
 * Matched on e.code, like the Advanced chord, and EXACTLY: one primary modifier — Meta or Ctrl,
 * not both, and neither is the other's synonym — with no Alt and no Shift, so ⌃⌥⌘D-style chords
 * and any future ⇧⌘, stay distinct. `repeat` is ignored because a held key must not re-enter the
 * screen sixty times a second; and arriving on Settings while already there is a no-op rather
 * than a rebuild, since `go()` re-applies the route when the hash does not change.
 */
export function installSettingsShortcut() {
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Comma' || e.repeat || e.altKey || e.shiftKey || e.metaKey === e.ctrlKey) return;
    e.preventDefault();
    if (state.screen !== 'settings') go('settings');
  });
}

export function installAdvancedShortcut() {
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

export function renderNav() {
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
export function refreshScreen() {
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

export function renderScreen({ navigated = false } = {}) {
  // Logged, not swallowed. A teardown that throws half-way leaves the half after it undone — a
  // camera still open, a wake lock still held, a search still running — and an empty catch made
  // that indistinguishable from a clean teardown.
  if (hooks.cleanup) {
    try { hooks.cleanup(); } catch (err) { console.error('screen teardown failed part-way', err); }
    hooks.cleanup = null;
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
  hooks.liveUpdate = null;
  hooks.liveMove = null;
  hooks.liveGap = null;
  hooks.onTrustLost = null;
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
export const router = makeRouter({
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
export function resolveAlias() {
  const raw = String(window.location.hash || '').replace(/^#\/?/, '').trim();
  const target = ALIAS[raw];
  if (!target) return;
  try { window.history.replaceState(null, '', `#/${target}`); }
  catch { window.location.hash = `#/${target}`; }
}
export function applyRoute() { state.screen = router.current(); renderNav(); renderScreen({ navigated: true }); }
// A hash assignment only fires hashchange when the value actually differs, so navigating onto the
// screen already showing would do nothing. go() renders directly in that case, preserving the
// always-re-render behaviour the scan flow depends on (go('home') while on home).
export function go(id) { if (!router.go(id)) applyRoute(); }
// The code beneath the screens reaches these through `shell` (declared with `hooks`), never by import.
Object.assign(shell, { go, refreshScreen, renderScreen });
