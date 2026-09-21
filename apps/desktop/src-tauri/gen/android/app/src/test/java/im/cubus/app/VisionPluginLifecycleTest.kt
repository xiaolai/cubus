package im.cubus.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * The pure halves of the plugin's lifecycle fixes of 2026-09-21 (scanner audit-fix round 1),
 * pinned without a camera, a permission dialog or a model:
 *
 *  - an unknown `deviceId` is REFUSED rather than opened as the rear camera (`facingOf`);
 *  - one permission request in flight, every caller answered (`Waiters`);
 *  - the wire bytes `decodeTensorResponse` reads, with a header that cannot promise more than
 *    the body carries (`encodeTensor`).
 *
 * The Android halves — the transactional bind, the frame released in `finally`, the teardown on
 * the model thread — need a device and stay unverified here, as the file's header says.
 */
class VisionPluginLifecycleTest {
    @Test
    fun `the rear camera is the default and the two listed ids are the only ones opened`() {
        assertEquals(VisionPlugin.Facing.BACK, VisionPlugin.facingOf(null))
        assertEquals(VisionPlugin.Facing.BACK, VisionPlugin.facingOf("back"))
        assertEquals(VisionPlugin.Facing.FRONT, VisionPlugin.facingOf("front"))
    }

    @Test
    fun `an id this plugin never listed is refused, not read as the rear camera`() {
        // `Detector.use` promises a rejection for a pinned id that is gone; falling through to the
        // rear camera opened one the page had not asked for, and CameraSession never saw a failure.
        for (id in listOf("rear", "", "BACK", "Front", "0", "environment")) {
            assertNull("\"$id\" must be refused", VisionPlugin.facingOf(id))
        }
    }

    @Test
    fun `only the first waiter launches the request, and a drain hands everyone back in order`() {
        val waiters = VisionPlugin.Waiters<String>()
        assertTrue(waiters.add("first"))
        assertFalse(waiters.add("second"))
        assertFalse(waiters.add("third"))
        assertEquals(3, waiters.size)
        assertEquals(listOf("first", "second", "third"), waiters.drain())
        assertEquals(0, waiters.size)
    }

    @Test
    fun `after a drain the queue is re-armed, so the next caller launches again`() {
        val waiters = VisionPlugin.Waiters<Int>()
        assertTrue(waiters.add(1))
        assertEquals(listOf(1), waiters.drain())
        assertEquals(emptyList<Int>(), waiters.drain())
        assertTrue(waiters.add(2))
    }

    @Test
    fun `the tensor is two little-endian int32s then the rows, row-major, as float32`() {
        val out = arrayOf(floatArrayOf(1.5f, -2f, 3f), floatArrayOf(0f, 0.25f, 100f))
        val bytes = VisionPlugin.encodeTensor(2, 3, out)
        assertEquals(8 + 2 * 3 * 4, bytes.size)
        val read = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        assertEquals(2, read.getInt())
        assertEquals(3, read.getInt())
        val floats = FloatArray(6) { read.getFloat() }
        assertEquals(listOf(1.5f, -2f, 3f, 0f, 0.25f, 100f), floats.toList())
    }

    @Test
    fun `a header may not promise a shape the body does not have`() {
        assertThrows(IllegalArgumentException::class.java) {
            VisionPlugin.encodeTensor(2, 3, arrayOf(floatArrayOf(1f, 2f, 3f)))
        }
        assertThrows(IllegalArgumentException::class.java) {
            VisionPlugin.encodeTensor(1, 3, arrayOf(floatArrayOf(1f, 2f)))
        }
        assertThrows(IllegalArgumentException::class.java) {
            VisionPlugin.encodeTensor(0, 0, arrayOf())
        }
    }
}
