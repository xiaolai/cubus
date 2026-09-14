// Keeping the screen awake while a scan or a walk takes minutes with no input.
//
// Lifted out of app.js on 2026-09-13, when that file was split into modules.

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
/** Whether a refusal has been reported this session. A refusal repeats every time the page comes
 *  back, and a line per attempt buried whatever else the console was carrying. */
let wakeRefusalLogged = false;
/** How long to wait before asking again for a lock the platform took back while the page stayed
 *  visible: at once the first time, and after a wait each time after that, until the page is shown
 *  again. Asked at once every time, a lock granted and taken straight back was asked for 12 times
 *  in 60 ms (found by verification, 2026-09-14). */
const WAKE_RETRY_MS = 1000;
const WAKE_RETRY_MAX_MS = 60000;
const retryWait = (n) => (n === 0 ? 0 : Math.min(WAKE_RETRY_MS * 2 ** (n - 1), WAKE_RETRY_MAX_MS));
let wakeRevokedWhileShown = 0;
let wakeRetryTimer = null;
const wakeSupported = () => typeof globalThis.navigator?.wakeLock?.request === 'function';
async function takeWakeLock() {
  // `released`, not merely held: the platform revokes a lock and says so a task or more later, and
  // between the two `wakeLock` is a handle to nothing. Believing it let a page come back from
  // hiding and never re-take the lock its holder still wanted (found by audit, 2026-09-13).
  if (!wakeSupported() || wakeAsking || wakeHolders === 0 || (wakeLock && !wakeLock.released)) return;
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
    taken.addEventListener?.('release', () => {
      if (wakeLock !== taken) return;
      wakeLock = null;
      // The holders did not leave because the platform did. Asked again, not left for the next
      // visibility change, which on a scan that runs for minutes may never come: at once the first
      // time, and after a wait each time the platform takes it back again (retryWait).
      const wait = retryWait(wakeRevokedWhileShown);
      wakeRevokedWhileShown += 1;
      if (wait === 0) {
        void takeWakeLock();
        return;
      }
      clearTimeout(wakeRetryTimer);
      wakeRetryTimer = setTimeout(() => { wakeRetryTimer = null; void takeWakeLock(); }, wait);
    });
    if (wakeHolders === 0) releaseWakeLock(); // the last holder left while this was in flight
  } catch (err) {
    // A refusal is normal — a battery-saver mode declines these — and is not worth a word to a
    // user who did not ask for it. Recorded once, at debug level, so it is findable.
    if (!wakeRefusalLogged) { wakeRefusalLogged = true; console.debug('screen wake lock refused', err); }
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
export function keepAwake() {
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
    if (document.visibilityState !== 'visible') return;
    // Shown again: the wait for a lock the platform keeps taking back starts over.
    clearTimeout(wakeRetryTimer);
    wakeRetryTimer = null;
    wakeRevokedWhileShown = 0;
    void takeWakeLock();
  });
}
