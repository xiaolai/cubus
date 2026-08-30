package im.cubus.app

import android.os.Bundle
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
 * systemBars() OR displayCutout() because either can be the thing in the way, and on a notched
 * phone in landscape they are different edges.
 */
class MainActivity : TauriActivity() {
  private var webView: WebView? = null
  private var last: IntArray? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
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
}
