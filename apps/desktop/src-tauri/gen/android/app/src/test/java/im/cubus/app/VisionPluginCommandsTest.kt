package im.cubus.app

import app.tauri.annotation.Command
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The command names Tauri can actually find, read off the compiled class the way `PluginHandle`
 * reads them — reflection over `@Command` methods, indexed by `method.name` — and the one field the
 * scan screen needs from a camera entry.
 *
 * THE MECHANISM (2026-09-20, audit 1.6). The page sends `plugin:cube-vision|next_detection`; the
 * plugin has no Rust `invoke_handler`, so Tauri's mobile fallback camel-cases the name before
 * handing it to Kotlin (`heck::AsLowerCamelCase`, tauri-2.11.5/src/webview/mod.rs ~1891), and
 * `PluginHandle.kt:156` looks it up by exact method name. `next_detection` was therefore a method
 * nothing could call, and so were five others; only `probe`, one word, survived the conversion
 * unchanged. `apps/web/test/native-plugin-commands.test.mjs` holds the source of this file to the
 * lowerCamelCase of every name `NativeDetector` sends; this test holds the COMPILED class to the
 * same set, through the same reflection the runtime uses, so a rename that reaches the source
 * but not a `@Command` — or a `@Command` on a method spelled with an underscore — fails here.
 *
 * The BLE plugin is deliberately not held to this: Rust calls it through `run_mobile_plugin`,
 * which passes the name verbatim, so its `ble_*` methods are reached as written.
 */
class VisionPluginCommandsTest {
    private fun commandNames(): Set<String> =
        VisionPlugin::class.java.declaredMethods
            .filter { it.isAnnotationPresent(Command::class.java) }
            .map { it.name }
            .toSet()

    @Test
    fun `every command is spelled the way tauri's mobile fallback delivers it`() {
        assertEquals(
            // `framePixels` is D7's ninth command (2026-09-23): the page asks for the pixels behind a
            // captured frame BY ID, so the native and browser paths end in the same `stickerLab` and
            // cannot come to disagree about a colour. Android implements it as the honest negative.
            // It was added to the plugin and not to this list, so this case had been red on the
            // branch ever since — found by running the Kotlin tests, which `pnpm check` does not.
            setOf(
                "probe",
                "listCameras",
                "openCamera",
                "currentCamera",
                "closeCamera",
                "loadModel",
                "framePixels",
                "nextDetection",
            ),
            commandNames(),
        )
    }

    @Test
    fun `no command carries an underscore, because the fallback removes them before the lookup`() {
        val underscored = commandNames().filter { '_' in it }
        assertTrue("unreachable through the mobile fallback: $underscored", underscored.isEmpty())
    }

    /**
     * `facing` as `getUserMedia` says it: the scan screen mirrors the sticker view unless the
     * camera reports `'environment'` (apps/web/lib/screens/scan/sticker-view.js), and `nativeDevice`
     * on the TS side keeps the field only when it is one of the two words.
     */
    @Test
    fun `a camera entry says which way it faces, in the words the page reads`() {
        val back = VisionPlugin.cameraEntry("back")
        assertEquals("back", back["deviceId"])
        assertEquals("environment", back["facing"])
        assertEquals("Back camera", back["label"])

        val front = VisionPlugin.cameraEntry("front")
        assertEquals("front", front["deviceId"])
        assertEquals("user", front["facing"])
        assertEquals("Front camera", front["label"])
    }
}
