// The host window: which platform the app runs on, the desktop title bar and its buttons, and the
// window title.
//
// Lifted out of app.js on 2026-09-13, when that file was split into modules.

import { icon } from './app-state.js';
import { DESKTOP_PLATFORMS, PLATFORMS, classifyDevice } from './host.js';
import { shell } from './screen-slots.js';

// ---- host ------------------------------------------------------------------------------------
// The app runs as a plain web page and inside the Tauri window, and the two draw their chrome
// differently. This is not a smart-cube leftover: it is what tells a real window from a preview.
export const isTauri = typeof window.__TAURI__ !== 'undefined';

// Which window chrome to draw (paper-one platform.ts): a UA sniff is enough — the platform can't
// change under a running window. `?platform=macos|windows|linux` pins it for design review
// (persisted); `?platform=auto` clears.
export function detectPlatform() {
  // globalThis, guarded: the test harness has no matchMedia, and no finger either.
  const finger = navigator.maxTouchPoints > 0 || globalThis.matchMedia?.('(any-pointer: coarse)').matches === true;
  return pinnedPlatform() ?? classifyDevice(navigator.userAgent, finger);
}

/** The design-review pin — `?platform=`, or what this tab last pinned — or null when nothing
 *  names a platform the app draws. */
function pinnedPlatform() {
  // sessionStorage, not localStorage. The pin is a DESIGN-REVIEW tool — "show me this window as
  // Windows draws it" — and persisting it meant a shared link pinned the visitor's browser to
  // somebody else's platform permanently, with `?platform=auto` the only way back and nothing
  // anywhere saying so (found by audit, 2026-09-04). A tab is exactly the right lifetime: the
  // pin survives reloads and deep links while the review is happening, and is gone when the tab
  // is. The old key is removed on sight, so a browser already pinned by a link is freed.
  try { localStorage.removeItem('cubus.platform'); } catch {}
  const q = new URLSearchParams(window.location.search).get('platform');
  if (PLATFORMS.includes(q)) {
    // Remembered best-effort, and apart: a session storage that refuses the write threw away the
    // pin the URL had just asked for (found by audit, 2026-09-13).
    try { sessionStorage.setItem('cubus.platform', q); } catch {}
    return q;
  }
  try {
    if (q === 'auto') sessionStorage.removeItem('cubus.platform');
    const s = sessionStorage.getItem('cubus.platform');
    // Only a platform the app draws. Any other stored value was believed, published on
    // <html data-platform>, and a desktop window lost its caption buttons (found by audit).
    if (PLATFORMS.includes(s)) return s;
  } catch {}
  return null;
}

// Wire the drawn caption buttons to the Tauri window (no-ops in a browser preview).
//
// Load-bearing, not decoration: on Windows and Linux the window is created without decorations
// (tauri.windows.conf.json / tauri.linux.conf.json), so these are the only minimise and close the
// user has. There is no maximise: the window is a fixed size (dev-docs/stage-contract.md). A
// rejection here means a capability is missing from src-tauri/capabilities/desktop.json, where the
// window permissions live (app-acl.test.mjs holds that) — say so, rather than leave a button that
// silently does nothing. This used to be defined and never called, which nothing noticed while the
// bar was hidden on those platforms.
function wireWindowButtons(root) {
  if (!isTauri) return;
  const win = window.__TAURI__?.window?.getCurrentWindow?.();
  if (!win) { console.error('window controls: the Tauri window API is not exposed'); return; }
  const on = (sel, fn) => root.querySelector(sel)?.addEventListener('click', () => {
    // `.then(fn)`, not `Promise.resolve(fn())`: that CALLS fn before the catch exists, so a
    // synchronous throw escaped the listener and the line below never printed (found by audit,
    // 2026-09-13).
    void Promise.resolve().then(fn).catch((e) => console.error('window control failed', e));
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
export function buildChrome(platform) {
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
  // The shortcut hint is drawn only where the shortcut is guaranteed to arrive: under the desktop
  // shell. A browser on macOS keeps ⌘, for itself, and a phone has no keyboard to promise.
  const shortcut = isTauri && DESKTOP_PLATFORMS.includes(platform)
    ? (platform === 'macos' ? ' (⌘,)' : ' (Ctrl+,)')
    : '';
  const gear = `<button class="tb-ctl" data-nav="settings" title="Settings${shortcut}" aria-label="Settings">${icon('settings', 18)}</button>`;
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
  for (const b of trail.querySelectorAll('[data-nav="settings"]')) b.onclick = () => shell.go('settings');
}

/**
 * Name the screen where the platform shows names: the document title (a browser tab) and the
 * window title (the taskbar and the window switcher). The bar itself no longer draws it — the
 * filled tab is the name.
 */
export function setTitle(name) {
  document.title = `${name} · Cubus`;
  // The NATIVE window title is set on Windows and Linux only. There it shows in the taskbar and
  // Alt-Tab of an undecorated window, so it is worth keeping current. On macOS the overlay
  // titlebar hides it (hiddenTitle) AND `setTitle:` makes AppKit rebuild the titlebar, which
  // snapped the traffic lights back to Apple's default position on every in-app navigation — so
  // macOS keeps the conf's static "Cubus" and the Rust shell places the lights (lib.rs). iOS and
  // Android inject the same API and have no window title; the permission is granted on the three
  // desktops only (capabilities/desktop.json), so every navigation there was a refused call and a
  // console error, when this was written "off macOS" (found by audit, 2026-09-13).
  const platform = document.documentElement.dataset.platform;
  if (isTauri && (platform === 'windows' || platform === 'linux')) {
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
