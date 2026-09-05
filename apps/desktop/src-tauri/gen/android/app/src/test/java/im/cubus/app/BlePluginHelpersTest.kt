package im.cubus.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The pure half of the BLE bridge: UUID expansion, the hex boundary, and the advertisement filter.
 *
 * Every one of these was written, reviewed, and shipped wrong or nearly wrong, and every one is a
 * single assertion away from being obviously so. The whole Android radio path is otherwise
 * unverifiable off a device, which made "compiles" the only signal it had.
 */
class BlePluginHelpersTest {
    /**
     * The bug this file exists for.
     *
     * A 16- or 32-bit UUID expands into the Bluetooth Base UUID by becoming the FIRST GROUP: eight
     * hex digits, left-padded with zeros. The old expression prepended a further "0000" to an
     * already-padded eight, so every short UUID came out with a twelve-digit first group — and
     * short UUIDs are the only kind the protocol layer writes down.
     */
    @Test
    fun `a 16-bit uuid expands into the bluetooth base uuid`() {
        assertEquals(
            "0000fff0-0000-1000-8000-00805f9b34fb",
            BlePlugin.uuid("fff0").toString(),
        )
    }

    @Test
    fun `a 32-bit uuid expands into the bluetooth base uuid`() {
        assertEquals(
            "0000fff0-0000-1000-8000-00805f9b34fb",
            BlePlugin.uuid("0000fff0").toString(),
        )
    }

    @Test
    fun `a full uuid is passed through unchanged`() {
        val full = "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
        assertEquals(full, BlePlugin.uuid(full).toString())
    }

    /** Round trip across the boundary that speaks hex everywhere: Rust, the polyfill, and here. */
    @Test
    fun `hex round trips, lowercase and zero padded`() {
        val bytes = byteArrayOf(0x00, 0x0f, 0x7f, -1, -128)
        assertEquals("000f7fff80", BlePlugin.toHex(bytes))
        assertArrayEqualsSigned(bytes, BlePlugin.hex("000f7fff80"))
    }

    @Test
    fun `a malformed hex string decodes to null rather than to wrong bytes`() {
        assertNull("odd length", BlePlugin.hex("abc"))
        assertNull("not hex", BlePlugin.hex("zz"))
        // `toInt(16)` accepts a sign, so these used to decode to bytes nobody sent.
        assertNull("a signed pair is not hex", BlePlugin.hex("+f"))
        assertNull("a negative pair is not hex", BlePlugin.hex("-1"))
        assertNull("a sign inside is not hex", BlePlugin.hex("ab-1"))
        assertNull("whitespace is not hex", BlePlugin.hex(" a"))
        assertEquals("", BlePlugin.toHex(BlePlugin.hex("")!!))
    }

    /**
     * An EMPTY filter must not match everything.
     *
     * `cube_ble::matches_request` requires at least one criterion; the Kotlin closure fell through
     * to `true`, so a filter with no clauses matched every advertiser in range — the two builds
     * disagreeing about which devices exist, which is the one thing this port was written out
     * clause for clause to prevent.
     */
    @Test
    fun `an empty filter matches nothing`() {
        val args = BlePlugin.RequestArgs().apply { filters = arrayOf(BlePlugin.DeviceFilter()) }
        assertFalse(BlePlugin.matches("Some Cube", listOf(), mapOf(), args))
    }

    @Test
    fun `no filters at all matches nothing unless acceptAllDevices is set`() {
        assertFalse(BlePlugin.matches("Some Cube", listOf(), mapOf(), BlePlugin.RequestArgs()))
        assertTrue(
            BlePlugin.matches(
                "Some Cube",
                listOf(),
                mapOf(),
                BlePlugin.RequestArgs().apply { acceptAllDevices = true },
            ),
        )
    }

    @Test
    fun `a name prefix filter matches on the prefix only`() {
        val args = BlePlugin.RequestArgs().apply {
            filters = arrayOf(BlePlugin.DeviceFilter().apply { namePrefix = "GAN" })
        }
        assertTrue(BlePlugin.matches("GAN-1234", listOf(), mapOf(), args))
        assertFalse(BlePlugin.matches("MoYu-1234", listOf(), mapOf(), args))
    }

    /**
     * The manufacturer-ONLY filter, which is how a cube advertising without a recognisable name is
     * found — and the clause an earlier draft dropped, making the native scan blind to devices the
     * browser build could see.
     */
    @Test
    fun `a manufacturer filter matches on company and data prefix`() {
        val args = BlePlugin.RequestArgs().apply {
            filters = arrayOf(
                BlePlugin.DeviceFilter().apply {
                    manufacturerData = arrayOf(
                        BlePlugin.ManufacturerFilter().apply {
                            companyIdentifier = 0x0001
                            dataPrefix = "abcd"
                        },
                    )
                },
            )
        }
        val hit = mapOf(0x0001 to byteArrayOf(0xab.toByte(), 0xcd.toByte(), 0x99.toByte()))
        assertTrue(BlePlugin.matches("", listOf(), hit, args))
        assertFalse(
            "a different prefix must not match",
            BlePlugin.matches("", listOf(), mapOf(0x0001 to byteArrayOf(0x00, 0x00, 0x00)), args),
        )
        assertFalse(
            "a different company must not match",
            BlePlugin.matches("", listOf(), mapOf(0x0002 to byteArrayOf(0xab.toByte(), 0xcd.toByte())), args),
        )
        assertFalse("a payload shorter than the prefix must not match",
            BlePlugin.matches("", listOf(), mapOf(0x0001 to byteArrayOf(0xab.toByte())), args))
    }

    /** A service filter compares EXPANDED uuids, which is why the expansion above has to be right. */
    @Test
    fun `a short service uuid in a filter matches an expanded advertised uuid`() {
        val args = BlePlugin.RequestArgs().apply {
            filters = arrayOf(BlePlugin.DeviceFilter().apply { services = arrayOf("fff0") })
        }
        assertTrue(
            BlePlugin.matches("", listOf("0000fff0-0000-1000-8000-00805f9b34fb"), mapOf(), args),
        )
        assertFalse(BlePlugin.matches("", listOf("0000fff1-0000-1000-8000-00805f9b34fb"), mapOf(), args))
    }

    private fun assertArrayEqualsSigned(want: ByteArray, got: ByteArray?) {
        assertEquals(want.size, got?.size)
        for (i in want.indices) assertEquals("byte $i", want[i].toInt(), got!![i].toInt())
    }
}
