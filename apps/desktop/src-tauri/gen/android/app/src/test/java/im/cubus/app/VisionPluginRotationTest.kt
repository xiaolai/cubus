package im.cubus.app

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

/**
 * The rotation the letterbox samples through, on a pattern small enough to read.
 *
 * CameraX hands `ImageAnalysis` the sensor's frame and a `rotationDegrees` — the clockwise turn
 * that makes it upright. The letterbox is byte-exact against an upright frame, so the mapping has
 * to be right in the direction and not merely in the shape; a 3×2 frame with one distinct byte
 * per pixel is the smallest picture on which "clockwise" and "anticlockwise" give different
 * answers. The bytes are laid out as `rgba` here only to exercise the four-channel stride; the
 * three unused channels of each pixel are the pixel's own number too, so a channel slip would also
 * show.
 *
 *     sensor (3 wide, 2 tall):      A B C
 *                                   D E F
 *
 *     90° clockwise (2 wide, 3 tall):  D A
 *                                      E B
 *                                      F C
 */
class VisionPluginRotationTest {
    private val w = 3
    private val h = 2

    /** Pixel p is four bytes of value p (A=1 … F=6), row-major. */
    private fun frame(): ByteArray = ByteArray(w * h * 4) { (it / 4 + 1).toByte() }

    /** The first byte of every pixel of a rotated frame, as a readable list. */
    private fun pixels(rgba: ByteArray): List<Int> = (rgba.indices step 4).map { rgba[it].toInt() }

    @Test
    fun `0 degrees is the identity`() {
        val out = VisionPlugin.rotateRgba(w, h, 0, frame())
        assertArrayEquals(frame(), out)
        val r = VisionPlugin.Rotation.of(w, h, 0)
        assertEquals(3, r.width)
        assertEquals(2, r.height)
    }

    @Test
    fun `90 degrees clockwise puts the sensor's bottom-left at the top-left`() {
        val out = VisionPlugin.rotateRgba(w, h, 90, frame())
        // 2 wide, 3 tall: D A / E B / F C.
        assertEquals(listOf(4, 1, 5, 2, 6, 3), pixels(out))
        val r = VisionPlugin.Rotation.of(w, h, 90)
        assertEquals(2, r.width)
        assertEquals(3, r.height)
        // The mapping the letterbox actually samples through, checked at a corner and the middle.
        assertEquals(0, r.srcX(0, 0)); assertEquals(1, r.srcY(0, 0)) // top-left ← D (col 0, row 1)
        assertEquals(2, r.srcX(1, 2)); assertEquals(0, r.srcY(1, 2)) // bottom-right ← C (col 2, row 0)
    }

    @Test
    fun `180 degrees reverses the frame`() {
        val out = VisionPlugin.rotateRgba(w, h, 180, frame())
        assertEquals(listOf(6, 5, 4, 3, 2, 1), pixels(out))
        val r = VisionPlugin.Rotation.of(w, h, 180)
        assertEquals(3, r.width)
        assertEquals(2, r.height)
    }

    @Test
    fun `270 degrees clockwise puts the sensor's top-right at the top-left`() {
        val out = VisionPlugin.rotateRgba(w, h, 270, frame())
        // 2 wide, 3 tall: C F / B E / A D.
        assertEquals(listOf(3, 6, 2, 5, 1, 4), pixels(out))
    }

    @Test
    fun `every channel travels with its pixel`() {
        val src = ByteArray(w * h * 4) { it.toByte() } // byte i = i, so channels are distinct
        val out = VisionPlugin.rotateRgba(w, h, 90, src)
        // Upright (0,0) is sensor D = pixel index 3 → bytes 12..15.
        assertArrayEquals(byteArrayOf(12, 13, 14, 15), out.copyOfRange(0, 4))
    }

    @Test
    fun `an angle that is not a right angle is refused`() {
        assertThrows(IllegalArgumentException::class.java) { VisionPlugin.Rotation.of(w, h, 45) }
    }

    /** The buffer pool's ownership rule: hand out each buffer once, take it back, no allocation. */
    @Test
    fun `the frame pool hands out each buffer once and takes it back`() {
        val pool = VisionPlugin.FramePool(count = 3, size = 8)
        val a = pool.acquire()
        val b = pool.acquire()
        val c = pool.acquire()
        assertNotNull(a); assertNotNull(b); assertNotNull(c)
        assertNull("a fourth request finds nothing rather than allocating", pool.acquire())
        assertEquals(0, pool.available)
        pool.release(b!!)
        assertEquals(1, pool.available)
        val again = pool.acquire()
        assertEquals("the returned buffer is the one handed out next", b, again)
    }
}
