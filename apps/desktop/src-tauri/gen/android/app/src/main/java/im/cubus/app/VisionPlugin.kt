package im.cubus.app

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.ImageFormat
import android.util.Size
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.lifecycle.LifecycleOwner
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.tensorflow.lite.Interpreter
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.MappedByteBuffer
import java.nio.channels.FileChannel
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicReference

/**
 * Native capture and inference for Android, behind the same `cube-vision` commands Apple answers.
 *
 * The seam is `Detector` (packages/cube-scanner/src/detector.ts): the panel asks for the model's
 * output for a fresh frame and does not know what produced it. `pickDetector` probes this plugin
 * and falls back to `WebDetector` when it is absent, which is what every non-Apple build did until
 * now. The commands here are the ones `NativeDetector` calls, spelled the same way, because a
 * platform that answers a different vocabulary is a second app.
 *
 * THE LETTERBOX IS THE WHOLE CORRECTNESS PROBLEM. Everything downstream of `next_detection` —
 * decode, NMS, fitFace, assembleColors — is one TypeScript implementation shared by every runtime,
 * and it is calibrated against a specific preprocessing. `preprocess()` in `src/onnx-detect.ts`
 * resizes so the LONG side becomes 640 with bilinear sampling at pixel centres, centre-pads with
 * grey 114, normalises to [0,1] and lays the result out CHW. Any deviation — nearest-neighbour, a
 * half-pixel offset, HWC, BGR — produces boxes that are slightly wrong everywhere, which reads as
 * a model that has become worse rather than a preprocessing that has drifted. It is reproduced
 * below line for line, and `ml/golden_frames.py` is what proves the model half agrees.
 *
 * NOT VERIFIED. This compiles. Nothing here has run on a phone, opened a camera, or produced a
 * tensor. `pickDetector` only takes the native path when `probe` answers true, so an Android build
 * that has never been tested simply keeps using WebDetector — which since 2026-09-02 is WebGPU
 * where the WebView has it, measured at 15 ms a frame against this path's unmeasured promise.
 * That is the honest reason not to rush the switch: the thing it has to beat is no longer slow.
 */
@TauriPlugin
class VisionPlugin(private val activity: Activity) : Plugin(activity) {

    @InvokeArg
    class OpenArgs {
        var deviceId: String? = null
    }

    @InvokeArg
    class LoadArgs {
        /** Present for parity with the CoreML plugin's compute-unit choice; LiteRT picks below. */
        var computeUnits: Int = 0
    }

    private val analysisExecutor = Executors.newSingleThreadExecutor()
    private var provider: ProcessCameraProvider? = null
    private var analysis: ImageAnalysis? = null
    private var openedId: String? = null

    /** The most recent frame, already letterboxed. One slot: a scan wants the newest, not a queue. */
    private val latest = AtomicReference<FloatArray?>(null)

    private var interpreter: Interpreter? = null
    private var outputShape: IntArray = intArrayOf(1, 0, 0)

    // ---- capability ----------------------------------------------------------------------------

    /**
     * The one question `pickDetector` asks. True only when this plugin can actually do the work:
     * a build that answers true and then fails per-frame is worse than one that answers false,
     * because the fallback is silently skipped.
     */
    @Command
    fun probe(invoke: Invoke) {
        val ok = runCatching { activity.assets.open(MODEL).close(); true }.getOrDefault(false)
        invoke.resolve(JSObject().apply { put("value", ok) })
    }

    // ---- camera --------------------------------------------------------------------------------

    @Command
    fun list_cameras(invoke: Invoke) {
        val list = listOf(
            JSObject().apply {
                put("deviceId", BACK)
                put("label", "Back camera")
            },
            JSObject().apply {
                put("deviceId", FRONT)
                put("label", "Front camera")
            },
        )
        invoke.resolve(JSObject().apply { put("cameras", JSArray(list.toTypedArray())) })
    }

    @SuppressLint("UnsafeOptInUsageError")
    @Command
    fun open_camera(invoke: Invoke) {
        val args = invoke.parseArgs(OpenArgs::class.java)
        // The REAR camera by default. A phone's front lens is the trap the web path documents:
        // the app expresses no preference and the platform hands back a selfie camera, so the
        // scanner looks at a face while the user points the cube at the back of the phone.
        val id = args.deviceId ?: BACK
        val selector =
            if (id == FRONT) CameraSelector.DEFAULT_FRONT_CAMERA else CameraSelector.DEFAULT_BACK_CAMERA

        val future = ProcessCameraProvider.getInstance(activity)
        future.addListener({
            runCatching {
                val p = future.get()
                provider = p
                p.unbindAll()
                val a = ImageAnalysis.Builder()
                    .setTargetResolution(Size(IMG, IMG))
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
                    .build()
                a.setAnalyzer(analysisExecutor) { image ->
                    runCatching { latest.set(letterbox(image)) }
                    image.close()
                }
                p.bindToLifecycle(activity as LifecycleOwner, selector, a)
                analysis = a
                openedId = id
                invoke.resolve()
            }.onFailure { invoke.reject("could not open the camera: ${it.message}") }
        }, androidx.core.content.ContextCompat.getMainExecutor(activity))
    }

    @Command
    fun current_camera(invoke: Invoke) {
        val id = openedId ?: return invoke.resolve()
        invoke.resolve(
            JSObject().apply {
                put("deviceId", id)
                put("label", if (id == FRONT) "Front camera" else "Back camera")
            },
        )
    }

    @Command
    fun close_camera(invoke: Invoke) {
        provider?.unbindAll()
        analysis = null
        openedId = null
        latest.set(null)
        invoke.resolve()
    }

    // ---- model ---------------------------------------------------------------------------------

    @Command
    fun load_model(invoke: Invoke) {
        invoke.parseArgs(LoadArgs::class.java)
        if (interpreter != null) return invoke.resolve()
        runCatching {
            val opts = Interpreter.Options().apply {
                // XNNPACK and the cores the app can spare — the same reasoning as the wasm path's
                // thread count, which leaves two for the camera and the renderer.
                numThreads = maxOf(1, Runtime.getRuntime().availableProcessors() - 2)
                setUseXNNPACK(true)
            }
            val i = Interpreter(loadModel(), opts)
            outputShape = i.getOutputTensor(0).shape()
            interpreter = i
            invoke.resolve()
        }.onFailure { invoke.reject("could not load the model: ${it.message}") }
    }

    private fun loadModel(): MappedByteBuffer {
        val fd = activity.assets.openFd(MODEL)
        FileInputStream(fd.fileDescriptor).use { stream ->
            return stream.channel.map(
                FileChannel.MapMode.READ_ONLY,
                fd.startOffset,
                fd.declaredLength,
            )
        }
    }

    /**
     * One inference on the newest frame, or null when the camera has opened but produced none yet.
     *
     * The reply is the RAW output tensor in the wire format `decodeTensorResponse` reads: two
     * little-endian int32s (rows, anchors) then rows*anchors float32. The RGBA frame never crosses
     * the bridge — that is the whole efficiency argument for doing this natively at all.
     */
    @Command
    fun next_detection(invoke: Invoke) {
        val i = interpreter ?: return invoke.reject("the model is not loaded — call load_model first")
        val input = latest.get() ?: return invoke.resolve(JSObject().apply { put("tensor", "") })
        val rows = outputShape.getOrElse(1) { 0 }
        val anchors = outputShape.getOrElse(2) { 0 }
        if (rows <= 0 || anchors <= 0) return invoke.reject("the model reports no output shape")

        val out = Array(1) { Array(rows) { FloatArray(anchors) } }
        runCatching {
            i.run(arrayOf(reshapeToNCHW(input)), mapOf(0 to out))
        }.onFailure { return invoke.reject("inference failed: ${it.message}") }

        val buf = ByteBuffer.allocate(8 + rows * anchors * 4).order(ByteOrder.LITTLE_ENDIAN)
        buf.putInt(rows)
        buf.putInt(anchors)
        for (r in 0 until rows) for (a in 0 until anchors) buf.putFloat(out[0][r][a])
        invoke.resolve(
            JSObject().apply {
                put("tensor", android.util.Base64.encodeToString(buf.array(), android.util.Base64.NO_WRAP))
            },
        )
    }

    /** CHW float array → the [1,3,640,640] nesting LiteRT's Java API wants. */
    private fun reshapeToNCHW(chw: FloatArray): Array<Array<Array<FloatArray>>> {
        val plane = IMG * IMG
        return Array(1) { _ ->
            Array(3) { c ->
                Array(IMG) { y ->
                    FloatArray(IMG) { x -> chw[c * plane + y * IMG + x] }
                }
            }
        }
    }

    /**
     * `preprocess()` from src/onnx-detect.ts, reproduced exactly.
     *
     * Bilinear at PIXEL CENTRES — the `+ 0.5 … - 0.5` is not decoration, it is the half-pixel
     * convention the model was trained and calibrated against, and dropping it shifts every box by
     * half a pixel at 640 and more after the scale back. Long side to 640, centre pad with grey
     * 114/255, CHW, RGB. The one thing that legitimately differs from the TS is where the pixels
     * come from: an ImageProxy row is `rowStride` bytes wide, which is NOT width*4 on most devices.
     */
    private fun letterbox(image: ImageProxy): FloatArray {
        val w = image.width
        val h = image.height
        val plane = image.planes[0]
        val row = plane.rowStride
        val pixel = plane.pixelStride
        val src = plane.buffer

        val scale = IMG.toFloat() / maxOf(w, h)
        val newW = maxOf(1, Math.round(w * scale))
        val newH = maxOf(1, Math.round(h * scale))
        val padX = (IMG - newW) / 2
        val padY = (IMG - newH) / 2
        val area = IMG * IMG
        val out = FloatArray(3 * area) { PAD }

        fun at(x: Int, y: Int, c: Int): Int = src.get(y * row + x * pixel + c).toInt() and 0xff

        for (y in 0 until newH) {
            val sy = minOf(h - 1.0f, maxOf(0.0f, (y + 0.5f) / scale - 0.5f))
            val y0 = sy.toInt()
            val y1 = minOf(h - 1, y0 + 1)
            val fy = sy - y0
            val oy = y + padY
            for (x in 0 until newW) {
                val sx = minOf(w - 1.0f, maxOf(0.0f, (x + 0.5f) / scale - 0.5f))
                val x0 = sx.toInt()
                val x1 = minOf(w - 1, x0 + 1)
                val fx = sx - x0
                val o = oy * IMG + (x + padX)
                for (c in 0 until 3) {
                    val p00 = at(x0, y0, c)
                    val p01 = at(x1, y0, c)
                    val p10 = at(x0, y1, c)
                    val p11 = at(x1, y1, c)
                    val top = p00 + (p01 - p00) * fx
                    val bot = p10 + (p11 - p10) * fx
                    out[c * area + o] = (top + (bot - top) * fy) / 255f
                }
            }
        }
        return out
    }

    companion object {
        private const val IMG = 640
        /** Ultralytics letterbox pad colour (grey 114), normalised — same constant as the TS. */
        private const val PAD = 114f / 255f
        private const val MODEL = "cube-yolo.tflite"
        private const val BACK = "back"
        private const val FRONT = "front"
    }
}
