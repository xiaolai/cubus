package im.cubus.app

import android.content.pm.ActivityInfo
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The pure halves of the activity: which devices rotate, and what the insets bridge hands the web
 * side. Both are contracts with something that cannot be unit-tested here — the OS, and app.js —
 * so the values are pinned where they are decided.
 */
class MainActivityHelpersTest {
    /** stage-contract.md decision 6: phones portrait, tablets free — at Android's own sw600dp line. */
    @Test
    fun `phones are portrait-locked and tablets are not`() {
        assertEquals(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT, MainActivity.orientationFor(320))
        assertEquals(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT, MainActivity.orientationFor(599))
        assertEquals(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED, MainActivity.orientationFor(600))
        assertEquals(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED, MainActivity.orientationFor(800))
        assertEquals(600, MainActivity.TABLET_MIN_WIDTH_DP)
    }

    /** `window.cubusInsets.get()`: four ints in CSS px, or null before the first dispatch. */
    @Test
    fun `the insets bridge reports the four edges or null`() {
        assertEquals("null", MainActivity.insetsJson(null))
        assertEquals("""{"t":51,"r":0,"b":24,"l":0}""", MainActivity.insetsJson(intArrayOf(51, 0, 24, 0)))
        assertEquals("cubusInsets", MainActivity.INSETS_INTERFACE)
    }
}
