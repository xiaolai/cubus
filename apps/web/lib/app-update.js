// Self-update for the desktop builds: ask whether a newer signed build exists, and install it
// only when the user says so.
//
// THE SEAM. Only a desktop has anything to update — a phone goes through its store, and the
// browser build is whatever the server last served — so this is the same shape as the window's
// orientation, and it is drawn the same way: `isTauri && isDesktopHost()`, never on platform
// sniffing alone. Nothing here runs in the browser harness, and `makeUpdater` is written so a test
// can drive every branch without Tauri, a network, or a clock.
//
// WHAT MAKES IT SAFE TO SHIP AT ALL is not this file. The endpoint is a plain public HTTPS URL,
// and anyone can serve a JSON manifest at one; what stops that from being an install-anything hole
// is that `tauri-plugin-updater` verifies the payload against the minisign public key compiled
// into the app before it unpacks a single byte. This module never sees the bytes and never decides
// whether they are trustworthy — it decides WHEN to ask and WHETHER to interrupt, which is all a
// UI layer should be trusted with.
//
// WHY IT ASKS. The audience is beginners and children, and an app that changes under someone
// without a word is the kind of surprise this project avoids elsewhere on purpose (a proof is off
// by default because it costs minutes; a misread says how many rather than guessing). So: check
// quietly, interrupt only when there is genuinely something to install, and never download until
// the answer is yes.

/**
 * The platforms whose copy of cubus updates ITSELF.
 *
 * ALL THREE DESKTOPS, macOS included — and macOS is the one with a story.
 *
 * It also ships through a Homebrew cask, so two things can move the same
 * /Applications/cubus.app. That is fine, and the reason is timing: both track the same GitHub
 * releases, and since the tap started updating on `release: published` it moves within seconds of
 * the manifest the app reads. They stay in lockstep, so `brew upgrade` reinstalls the version the
 * app already has rather than replacing a newer one — a redundant copy, not a downgrade. The
 * downgrade this was once written to avoid needs the cask to LAG the app, which is a property of a
 * tap that updates late, not of having two updaters.
 *
 * The cask deliberately does NOT declare `auto_updates true`. That would tell Homebrew to stand
 * down and leave the app as the only path; leaving it off means both work, and someone who manages
 * their Mac with `brew upgrade` keeps doing exactly that. It is the arrangement vmark ships.
 *
 * A phone still updates through its store and the browser build is whatever the server last
 * served, so neither is here.
 *
 * Exported and tested rather than inlined at the call site, because "which platforms self-update"
 * is a decision with a reason, and the next person to add a platform needs to meet the reason.
 */
export const SELF_UPDATE_PLATFORMS = Object.freeze(['macos', 'windows', 'linux']);

/** Does this platform update itself, or does something else own it? */
export function selfUpdateSupported(platform) {
  return SELF_UPDATE_PLATFORMS.includes(platform);
}

/** Once a day. A cube tutor does not need to poll for updates more often than someone opens it. */
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Waited out before the first check, so a network call never competes with the first paint.
 *
 * The app measures its own startup carefully — the die's synchronous click is 0–1 ms and the
 * longest main-thread block 14–33 ms — and an update check that resolves DNS during that window
 * is exactly the kind of thing that turns those numbers into different ones.
 */
export const STARTUP_DELAY_MS = 3000;

export const LAST_CHECK_KEY = 'cubusUpdateLastCheck';

/**
 * Is a check due?
 *
 * Pure, and separate from everything that talks to a network, because this is the part with the
 * edge cases: a clock that went backwards (a laptop waking in another timezone, a user correcting
 * the date) must not lock the app out of ever checking again. A future timestamp is treated as
 * due rather than as "not yet", which is the direction that fails safe.
 */
export function dueForCheck(now, lastCheck, interval = CHECK_INTERVAL_MS) {
  if (!Number.isFinite(lastCheck) || lastCheck <= 0) return true;
  if (lastCheck > now) return true; // the clock moved back; do not wait a day to notice
  return now - lastCheck >= interval;
}

/** Read the stored timestamp, tolerating anything a hand-edited localStorage might hold. */
export function readLastCheck(storage) {
  const raw = storage?.getItem?.(LAST_CHECK_KEY);
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The updater, with every dependency injected.
 *
 * @param {object} deps
 * @param {object} deps.api      the Tauri global (`window.__TAURI__`)
 * @param {Storage} deps.storage where the last-check time lives
 * @param {() => number} deps.now
 * @param {(update) => Promise<boolean>} deps.confirm  asks the user; true means install
 * @param {(msg: string, err?: unknown) => void} [deps.warn]
 */
export function makeUpdater({ api, storage, now = Date.now, confirm, warn = () => {} }) {
  // SINGLE FLIGHT. A launch check and a Settings press can land together, and two concurrent
  // `check()` calls against the same endpoint produce two prompts for one update — which is worse
  // than either alone, because dismissing one leaves the other on screen looking like a bug.
  let inFlight = null;

  async function run({ announceNoUpdate }) {
    const updater = api?.updater;
    if (!updater?.check) {
      // Not an error: this is every non-desktop build, and the caller has already decided not to
      // draw the affordance there. Said once, quietly, because a missing API on a platform that
      // never had it is not news.
      warn('app-update: no updater API on this build');
      return { status: 'unavailable' };
    }

    let update;
    try {
      update = await updater.check();
    } catch (err) {
      // A failed check is a fact about the network, not about the app, and the user did not ask
      // for it on launch. It is recorded and swallowed there; a Settings press reports it, because
      // then somebody IS waiting for an answer.
      warn('app-update: could not reach the update endpoint', err);
      return { status: 'error', error: err };
    } finally {
      // Stamped even on failure, so a machine that is offline for a week does not retry on every
      // single launch. The Settings button ignores this stamp entirely.
      try {
        storage?.setItem?.(LAST_CHECK_KEY, String(now()));
      } catch {
        // A full or blocked localStorage must not take down the app on launch.
      }
    }

    if (!update?.available) {
      return { status: announceNoUpdate ? 'current' : 'silent-current', version: update?.version };
    }

    const wanted = await confirm(update);
    if (!wanted) return { status: 'declined', version: update.version };

    try {
      // Downloads AND applies. The signature is checked against the app's compiled-in public key
      // inside this call, before anything is unpacked.
      await update.downloadAndInstall();
    } catch (err) {
      warn('app-update: the update did not install', err);
      return { status: 'failed', error: err };
    }

    // The install is staged; the running process is still the old one. Without the relaunch the
    // user sees nothing change and reasonably concludes it did not work.
    try {
      await api?.process?.relaunch?.();
    } catch (err) {
      warn('app-update: installed, but could not relaunch', err);
      return { status: 'installed-needs-restart' };
    }
    return { status: 'installed' };
  }

  async function check({ announceNoUpdate = false } = {}) {
    if (inFlight) return inFlight;
    inFlight = run({ announceNoUpdate }).finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  return {
    check,
    /** The launch path: only when one is due, and never announcing "you are up to date". */
    async checkOnLaunch() {
      if (!dueForCheck(now(), readLastCheck(storage))) return { status: 'not-due' };
      return check({ announceNoUpdate: false });
    },
    /** The Settings path: always checks, and always says something back. */
    checkNow() {
      return check({ announceNoUpdate: true });
    },
  };
}
