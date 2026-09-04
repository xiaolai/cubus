package im.cubus.app

import android.content.pm.ActivityInfo
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/**
 * The app draws edge to edge (enableEdgeToEdge below, and targetSdk 36 enforces it anyway), so it
 * is responsible for keeping its own chrome out from under the system bars. On iOS the web layer
 * does that by itself: env(safe-area-inset-bottom) covers the home indicator, and .app pads by it.
 *
 * On Android it cannot. In Chromium, env(safe-area-inset-*) reports the DISPLAY CUTOUT and nothing
 * else — the gesture navigation bar is a system-bar inset, not a cutout, so safe-area-inset-bottom
 * is legitimately 0. Measured on a Pixel 8 emulator (API 36) on 2026-08-30: inset-top 51px,
 * inset-bottom 0px, and the bottom tab row therefore ran 865→914 in a 914px viewport — flush to the
 * edge, with the gesture pill drawn straight through it.
 *
 * So the insets are handed to the web layer here, where the OS actually knows them. They are
 * written as --os-inset-*, which index.html's .app rule reads with env() as its fallback:
 *
 *     --inset-b: var(--os-inset-b, env(safe-area-inset-bottom, 0px));
 *
 * That ordering is deliberate. The browser build never sets --os-inset-*, so it keeps env() and is
 * untouched; the harness's `?insets=` override sets --inset-* inline on .app and still wins over
 * both. A capability seam both builds satisfy, which is the shape AGENTS.md sanctions — no screen
 * exists on one build only.
 *
 * TWO CHANNELS, because a push alone rests on a guess. The insets are dispatched on attach, which
 * can land before there is a document to write into, so the push is repeated after 800 ms — a
 * number that is right on the emulator and unproven on a slow phone. `window.cubusInsets.get()`
 * (the [InsetsBridge] below) is the other half: the web side PULLS the last known insets at boot,
 * whenever it is ready, so a first paint no longer depends on the timer having guessed well. The
 * push stays for changes after boot (rotation, the keyboard, a split). The name is the contract
 * with app.js; `apps/web/test/os-insets.test.mjs` pins it.
 *
 * systemBars() OR displayCutout() because either can be the thing in the way, and on a notched
 * phone in landscape they are different edges.
 */
class MainActivity : TauriActivity() {
  private var webView: WebView? = null
  @Volatile private var last: IntArray? = null

  /**
   * Back goes BACK, not out. The generated base class turns Tauri's default off, so the system
   * Back gesture left the app from any screen — a beginner three steps into a solve, back on the
   * launcher. With it on, WryActivity routes Back to the WebView's history while there is one, and
   * to the system only when the app is on its first screen. The router pushes a history entry per
   * screen, which is what makes that history worth having.
   */
  override val handleBackNavigation: Boolean = true

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    // Phones are portrait-locked; tablets rotate (stage-contract.md decision 6, the same split
    // the iOS project makes between ~iphone and ~ipad). The manifest cannot say this — it locks
    // the activity for every device — so the lock is applied here, per device class, before the
    // window is created. 600dp is Android's own tablet threshold (sw600dp).
    requestedOrientation = orientationFor(resources.configuration.smallestScreenWidthDp)
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
    webView.addJavascriptInterface(InsetsBridge(), INSETS_INTERFACE)
    ViewCompat.setOnApplyWindowInsetsListener(webView) { view, windowInsets ->
      val i = windowInsets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      val d = view.resources.displayMetrics.density
      last = intArrayOf(
        (i.top / d).toInt(), (i.right / d).toInt(), (i.bottom / d).toInt(), (i.left / d).toInt()
      )
      push()
      // Not consumed: the listener reports, it does not absorb.
      windowInsets
    }
    // Insets are dispatched on attach, which can land before the document exists — an
    // evaluateJavascript against no document is silently dropped, and the app would then run its
    // whole first screen with the wrong bottom edge. Re-push once the page has had time to load;
    // the write is idempotent, so an extra one costs nothing and a missed one costs the layout.
    // The pull channel above is what removes the dependence on this number being right.
    webView.postDelayed({ push() }, 800)
  }

  override fun onResume() {
    super.onResume()
    push()
  }

  /** Write the last known insets into the document, in CSS pixels. No-op before either exists. */
  private fun push() {
    val v = webView ?: return
    val i = last ?: return
    v.evaluateJavascript(
      "(function(){var s=document.documentElement.style;" +
        "s.setProperty('--os-inset-t','${i[0]}px');" +
        "s.setProperty('--os-inset-r','${i[1]}px');" +
        "s.setProperty('--os-inset-b','${i[2]}px');" +
        "s.setProperty('--os-inset-l','${i[3]}px');})();",
      null,
    )
  }

  /**
   * `window.cubusInsets.get()` → `{"t":..,"r":..,"b":..,"l":..}` in CSS pixels, or `null` before
   * the first inset dispatch. Ints only, built by hand: no user data reaches this string, and the
   * JSON classes are stubs on the JVM this is unit-tested on.
   */
  inner class InsetsBridge {
    @JavascriptInterface
    fun get(): String = insetsJson(last)
  }

  companion object {
    /** The JS global the bridge is installed as — the one name app.js reads. */
    const val INSETS_INTERFACE = "cubusInsets"

    /** Android's own tablet threshold: `sw600dp`. */
    const val TABLET_MIN_WIDTH_DP = 600

    /** Portrait below the tablet threshold; the system's choice (which honours the user's rotation lock) at or above it. */
    fun orientationFor(smallestScreenWidthDp: Int): Int =
      if (smallestScreenWidthDp >= TABLET_MIN_WIDTH_DP) {
        ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
      } else {
        ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
      }

    /** The pull channel's payload; see [InsetsBridge]. */
    fun insetsJson(i: IntArray?): String =
      if (i == null) "null" else """{"t":${i[0]},"r":${i[1]},"b":${i[2]},"l":${i[3]}}"""
  }
}
