package im.cubus.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The Android letterbox against the numbers the TypeScript actually produces.
 *
 * `VisionPlugin`'s note calls `preprocess()` "reproduced exactly", and until this existed nothing
 * checked it — `ml/golden_frames.py` proves the `.tflite` agrees with the other exports and says
 * nothing about what this code feeds it. The same fixture and the same expected values are pinned
 * in `crates/cube-vision/src/windows.rs`, because there is ONE preprocessing contract and three
 * implementations of it, and the way it breaks is a fraction of a pixel everywhere — which reads
 * as a model that has got worse rather than a preprocessing that has drifted.
 *
 * The expected values were produced by running `preprocess` from
 * `packages/cube-scanner/src/onnx-detect.ts` over the fixture below. They are EXACT: both sides
 * compute in double and round once, on the store to float. Computing in Float instead — which this
 * did until 2026-09-02 — moves index 576960 from 0.23291667 to 0.23291671, and that is the whole
 * failure mode, caught here rather than in a scan.
 */
class LetterboxParityTest {
    private val w = 97
    private val h = 43

    /** The same deterministic frame the Rust fixture builds. */
    private fun sample(x: Int, y: Int, c: Int): Int = when (c) {
        0 -> (x * 7 + y * 13) % 256
        1 -> (x * 31 + y * 5 + 77) % 256
        else -> (x * 17 + y * 23 + 191) % 256
    }

    /**
     * NHWC here, CHW in the TypeScript — the same samples in a different order, because this
     * `.tflite` takes `[1,640,640,3]` and the ONNX graph takes `[1,3,640,640]`. The mapping is
     * spelled out rather than hidden in the expected indices, so a layout change fails as a layout
     * change instead of as nine unrelated wrong numbers.
     */
    private fun nhwc(chwIndex: Int): Int {
        val plane = VisionPlugin.IMG * VisionPlugin.IMG
        val c = chwIndex / plane
        val within = chwIndex % plane
        return within * 3 + c
    }

    @Test
    fun `the letterbox matches the typescript reference exactly`() {
        val out = VisionPlugin.letterboxFrom(w, h, ::sample)
        assertEquals("the tensor is 640x640x3", VisionPlugin.IMG * VisionPlugin.IMG * 3, out.size)

        // (TypeScript CHW index, value). Three samples per channel inside the image band, and one
        // in the letterbox padding so the pad colour is pinned too.
        val expected = listOf(
            // Full precision as the TypeScript printed them, so the literal rounds to the SAME
            // float32 rather than to a neighbouring one. `0.7444975f` and `0.744497537612915f` are
            // different floats, and the first is not the value preprocess() stores.
            128_100 to 0.5527696013450623f,
            192_320 to 0.2329166680574417f,
            256_600 to 0.16269607841968536f,
            537_700 to 0.14213235676288605f,
            601_920 to 0.4771813750267029f,
            666_200 to 0.9138235449790955f,
            947_300 to 0.32084253430366516f,
            1_011_520 to 0.5639828443527222f,
            1_075_800 to 0.744497537612915f,
            6_410 to 0.4470588266849518f,
        )
        for ((chwIndex, want) in expected) {
            assertEquals("CHW index $chwIndex", want, out[nhwc(chwIndex)], 0.0f)
        }

        // The same position-weighted checksum the Rust test uses, computed over the CHW ORDER so
        // the two languages produce one comparable number. This is what catches a shift of a row or
        // a channel, which the ten samples above could miss.
        var sum = 0.0
        for (chwIndex in 0 until out.size) sum += out[nhwc(chwIndex)] * ((chwIndex % 97) + 1.0) / 97.0
        assertTrue(
            "checksum $sum differs from the TypeScript's 291823.35534517275 — the letterbox has " +
                "drifted from preprocess()",
            Math.abs(sum - 291_823.35534517275) < 1e-3,
        )
    }

    /** Grey 114/255 outside the image, which is the Ultralytics convention the model was trained on. */
    @Test
    fun `the padding is ultralytics grey`() {
        val out = VisionPlugin.letterboxFrom(w, h, ::sample)
        // Row 10 is above the image band for a 97x43 source scaled to 640 wide (284 tall, pad 178).
        assertEquals(114f / 255f, out[(10 * VisionPlugin.IMG + 10) * 3], 0.0f)
    }
}
