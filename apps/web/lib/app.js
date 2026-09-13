// The Cubus app entry. It loads the screens (lib/screens/) and the services they share, and it
// boots: the OS insets, the stage check, the updater, the first route. Since 2026-09-13 everything
// else lives in its own module; this file keeps what runs once at start, and re-exports the names
// the tests read off the app.

import { STARTUP_DELAY_MS } from './app-update.js';
import { initLocale } from './i18n.js';

import { $, state } from './app-state.js';
import { settings } from './app-settings.js';
import { loadSolver } from './solver-service.js';
import { setFacelets } from './cube-subject.js';
import { applyNetColors, applyTheme } from './cube-drawing.js';
import { buildChrome, detectPlatform, isTauri } from './window-chrome.js';
import { reparseRegistry } from './cube-memory.js';
import { schedulePreroll } from './scramble-roll.js';
import { appUpdater, hideUpdateProgress, showUpdateProgress } from './update-ui.js';
import {
  applyRoute, go, installAdvancedShortcut, installExternalLinks, installSettingsShortcut,
  resolveAlias, router,
} from './screen-shell.js';

// The screens register themselves in the screen registry as they load, so importing them is how
// they exist; the order is the order they were written in.
import './screens/scan.js';
import './screens/cube.js';
import './screens/timer.js';
import './screens/settings.js';
import './screens/stats.js';
import './screens/lessons.js';

// The names the test suites read off the app, from the modules that own them.
export { DEFAULT_PALETTE } from './app-settings.js';
export { privacyLine } from './update-ui.js';
export { SCREENS } from './screen-shell.js';
export { state } from './app-state.js';
export { VERSION } from './version.js';

window.addEventListener('hashchange', () => { resolveAlias(); applyRoute(); });
window.cubusGo = go;

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
  installSettingsShortcut();
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
    reparseRegistry();
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
      // A launch-path install can be confirmed from any screen, so its progress goes to the
      // status chip — the same one the Settings press uses — rather than to a button that may
      // not exist.
      appUpdater()
        .checkOnLaunch({ onProgress: showUpdateProgress })
        .catch((e) => console.warn('app-update: launch check failed', e))
        .finally(hideUpdateProgress);
    }, STARTUP_DELAY_MS);
  }
}
boot();
