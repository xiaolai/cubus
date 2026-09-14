// The self-update surface: the updater, its visible progress chip, and the privacy line Settings
// shows about it.
//
// Lifted out of app.js on 2026-09-13, when that file was split into modules.

import { launchCheckOutcome, makeUpdater, progressLabel, selfUpdateSupported } from './app-update.js';
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
          // No dialog is not the user saying "Not now": it throws, and makeUpdater answers
          // `unasked` rather than `declined`.
          confirm: (update) => {
            const dialog = window.__TAURI__?.dialog;
            if (typeof dialog?.ask !== 'function') throw new Error('app-update: there is no dialog to ask with');
            return dialog.ask(
              t('Cubus %1 is available. You have %2.\n\nInstall it and restart?', update.version, VERSION),
              {
                title: t('A newer Cubus'),
                kind: 'info',
                okLabel: t('Install and restart'),
                cancelLabel: t('Not now'),
              },
            );
          },
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
let noticeSerial = 0;
function statusChip() {
  let chip = document.getElementById('updateStatus');
  if (!chip) {
    chip = document.createElement('div');
    chip.id = 'updateStatus';
    chip.className = 'update-status';
    chip.setAttribute('role', 'status');
    chip.setAttribute('aria-live', 'polite');
    document.body.appendChild(chip);
  }
  return chip;
}
export function showUpdateProgress(p) {
  updateProgress = p;
  const chip = statusChip();
  chip.dataset.kind = 'progress';
  const paint = () => { chip.textContent = progressLabel(updateProgress, Date.now(), t); };
  paint();
  if (!updateTicker) updateTicker = setInterval(paint, 1000);
}
export function hideUpdateProgress() {
  updateProgress = null;
  if (updateTicker) { clearInterval(updateTicker); updateTicker = 0; }
  const chip = document.getElementById('updateStatus');
  // A notice is not progress: a press hides its progress while the answer is still showing.
  if (chip?.dataset.kind !== 'notice') chip?.remove();
}

/** How long an answer stays in the chip when the native dialog could not show it. */
export const NOTICE_MS = 12_000;
/**
 * An answer in the app's own chip, for NOTICE_MS: the fallback for a native dialog that is
 * missing or refuses. An answer somebody waited for is not dropped because the OS would not
 * draw it (found by audit, 2026-09-13).
 */
export function showUpdateNotice(message) {
  hideUpdateProgress();
  const chip = statusChip();
  chip.dataset.kind = 'notice';
  chip.textContent = message;
  // Nothing to cancel: when this falls due, a notice that has been replaced, or a chip that has
  // since become progress, leaves it with nothing to do.
  const mine = ++noticeSerial;
  setTimeout(() => {
    if (mine === noticeSerial && chip.dataset.kind === 'notice') chip.remove();
  }, NOTICE_MS);
}

/**
 * Say how a check ended: every answer to a press, and on the launch path only what
 * launchCheckOutcome picks.
 *
 * Never rejects. A dialog that is missing or refuses leaves the answer in the chip instead; a
 * refusal used to reach the press, which said "could not reach the update server" through the
 * same failing dialog (found by audit, 2026-09-13).
 */
export async function reportUpdateOutcome(result) {
  const say = async (message, kind = 'info') => {
    const dialog = window.__TAURI__?.dialog;
    try {
      if (typeof dialog?.message !== 'function') throw new Error('there is no dialog to say it with');
      await dialog.message(message, { title: 'Cubus', kind });
    } catch (err) {
      console.warn('app-update: the dialog could not show the answer', err);
      showUpdateNotice(message);
    }
  };
  if (result.status === 'current') return say(t('Cubus %1 is the latest version.', VERSION));
  if (result.status === 'error') return say(t('Could not reach the update server. Check your connection and try again.'), 'warning');
  if (result.status === 'failed') return say(t('The update could not be installed. Try again, or download it from the website.'), 'error');
  if (result.status === 'installed-needs-restart') return say(t('The update is installed. Quit and reopen Cubus to use it.'));
  if (result.status === 'unasked') return say(t('Cubus %1 is available, but this copy could not ask before installing it. Download it from the website.', result.version), 'warning');
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

/**
 * The daily launch check, on a timer after boot (lib/app.js).
 *
 * A launch-path install can be confirmed from any screen, so its progress goes to the status
 * chip — the same one the Settings press uses — rather than to a button that may not exist.
 * What it then takes down and says is launchCheckOutcome's. Never rejects.
 */
export function runLaunchCheck(updater) {
  return updater
    .checkOnLaunch({ onProgress: showUpdateProgress })
    .catch((err) => {
      console.warn('app-update: launch check failed', err);
      return { status: 'error', error: err };
    })
    .then(async (result) => {
      const { hideProgress, report } = launchCheckOutcome(result);
      if (hideProgress) hideUpdateProgress();
      if (report) await reportUpdateOutcome(result);
      return result;
    });
}

/**
 * A press of Settings' "Check now". The press ALWAYS checks (it ignores the daily throttle) and
 * always answers, because somebody is waiting for one; the launch check is the quiet half.
 * Disabled while in flight, since `check` joins one flight and a button that keeps accepting
 * presses while nothing visibly happens reads as broken.
 */
export async function runUpdatePress(updater, button) {
  const was = button.textContent;
  button.disabled = true;
  button.textContent = t('Checking…');
  let result;
  try {
    result = await updater.checkNow({
      onProgress: (p) => {
        // The press has become a download: the button says so, and the status chip
        // carries the numbers wherever the user looks next.
        if (button.isConnected) button.textContent = t('Updating…');
        showUpdateProgress(p);
      },
    });
  } catch (err) {
    // A press that throws used to leave the button spinning back to normal with nothing
    // said — the check simply appeared not to happen.
    console.error('app-update: the check failed', err);
    result = { status: 'error' };
  }
  try {
    // The flight is over, so its progress goes before the answer is shown; and the answer is said
    // once, because saying it never rejects into a second attempt.
    hideUpdateProgress();
    await reportUpdateOutcome(result);
  } finally {
    // The button may have gone with a re-render, and an installed update never comes back
    // here at all — the app relaunches out from under it.
    if (button.isConnected) { button.disabled = false; button.textContent = was; }
  }
}
