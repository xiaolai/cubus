// The self-update surface: the updater, its visible progress chip, and the privacy line Settings
// shows about it.
//
// Lifted out of app.js on 2026-09-13, when that file was split into modules.

import { makeUpdater, progressLabel, selfUpdateSupported } from './app-update.js';
import { hostPlatform, isDesktopHost } from './host.js';
import { t } from './i18n.js';
import { VERSION } from './version.js';

import { isTauri } from './window-chrome.js';

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
export function appUpdater() {
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
export const privacySentence = () => privacyLine(Boolean(appUpdater()));

/**
 * The download and the install, made visible.
 *
 * After "Install and restart" the app showed nothing until it relaunched: the Settings button
 * kept saying "Checking…", and a launch-path install had no surface at all. Measured 2026-09-06,
 * through a proxy tunnel: one download sat at 1454 bytes for five minutes before completing, and
 * with nothing on screen that was a hang to the person watching, who quit it. A fixed chip
 * carries the numbers wherever the user is (the launch path can arrive on any screen), and a
 * one-second tick keeps the stall notice honest between events — a stalled download sends none.
 * Only ever drawn where the updater exists, which is the desktop.
 */
let updateProgress = null; // the last report, or null when nothing is in flight
let updateTicker = 0;
export function showUpdateProgress(p) {
  updateProgress = p;
  let chip = document.getElementById('updateStatus');
  if (!chip) {
    chip = document.createElement('div');
    chip.id = 'updateStatus';
    chip.className = 'update-status';
    chip.setAttribute('role', 'status');
    chip.setAttribute('aria-live', 'polite');
    document.body.appendChild(chip);
  }
  const paint = () => { chip.textContent = progressLabel(updateProgress, Date.now(), t); };
  paint();
  if (!updateTicker) updateTicker = setInterval(paint, 1000);
}
export function hideUpdateProgress() {
  updateProgress = null;
  if (updateTicker) { clearInterval(updateTicker); updateTicker = 0; }
  document.getElementById('updateStatus')?.remove();
}

/** Say the outcome of a check the user ASKED for. A launch check stays silent unless it found one. */
export async function reportUpdateOutcome(result) {
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
