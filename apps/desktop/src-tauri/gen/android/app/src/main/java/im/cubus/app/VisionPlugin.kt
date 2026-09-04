package im.cubus.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.util.Size
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.lifecycle.LifecycleOwner
import app.tauri.annotation.Command
import app.tauri.PermissionState
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.tensorflow.lite.Interpreter
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.MappedByteBuffer
import java.nio.channels.FileChannel
import java.util.ArrayDeque
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
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
 * half-pixel offset, BGR — produces boxes that are slightly wrong everywhere, which reads as a
 * model that has become worse rather than a preprocessing that has drifted. It is reproduced below
 * line for line, in DOUBLE as the TypeScript is, and `ml/golden_frames.py` is what proves the model
 * half agrees.
 *
 * AND THE FRAME MUST BE UPRIGHT FIRST. A phone's sensor is landscape; held in portrait, CameraX
 * hands an `ImageAnalysis` its frames un-rotated and says so in `imageInfo.rotationDegrees` — the
 * clockwise turn that would make them upright. The letterbox is byte-exact against an UPRIGHT
 * frame, so feeding it the sensor's orientation reads a cube face with every sticker in the wrong
 * place (audit 2026-09-04, headline 14). [Rotation] maps output coordinates back to sensor
 * coordinates, so the rotation costs no copy and no allocation; `rotateRgba` is the same mapping
 * as a byte-for-byte reference the unit test can check on a 3×2 pattern. UNVERIFIED ON A DEVICE:
 * the mapping is tested, the claim that CameraX's degrees mean what its documentation says is not.
 *
 * The one deliberate difference is LAYOUT: this `.tflite` takes NHWC `[1,640,640,3]` where the ONNX
 * graph takes CHW, so the same samples are written in a different order. `load_model` asserts the
 * shape rather than trusting this note.
 *
 * NOT VERIFIED. This compiles. Nothing here has run on a phone, opened a camera, or produced a
 * tensor. `pickDetector` only takes the native path when `probe` answers true, so an Android build
 * that has never been tested simply keeps using WebDetector — which since 2026-09-02 is WebGPU
 * where the WebView has it, measured at 15 ms a frame against this path's unmeasured promise.
 * That is the honest reason not to rush the switch: the thing it has to beat is no longer slow.
 */
@TauriPlugin(
    permissions = [
        Permission(strings = [Manifest.permission.CAMERA], alias = VisionPlugin.CAMERA_ALIAS),
    ],
)
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

    /**
     * Model work, on its OWN thread and never the caller's.
     *
     * Tauri dispatches Android commands on the main thread, so loading a model and running
     * inference inline froze the UI and risked an ANR — on the very screen whose whole job is to
     * stay responsive while the camera runs. A second single-threaded executor rather than reusing
     * [analysisExecutor], because inference must not block frame delivery; being single-threaded is
     * what keeps interpreter access serialised without a lock.
     */
    private val modelExecutor = Executors.newSingleThreadExecutor()

    private var provider: ProcessCameraProvider? = null
    private var analysis: ImageAnalysis? = null
    private var openedId: String? = null

    /**
     * Which camera session a frame belongs to. Bumped by every open and every close.
     *
     * An `ImageAnalysis` callback already in flight when the camera closes used to publish its
     * frame into [latest] AFTER `close_camera` had cleared it, and a provider callback that
     * arrived late could bind a camera the app had already asked to close. Both produce the same
     * symptom: the scanner reading pixels from a camera that is no longer open. The analyzer
     * compares the generation it was bound with against this before publishing anything.
     */
    private val generation = AtomicInteger(0)

    /**
     * The most recent letterboxed frame, OWNED by whoever holds it. One slot: a scan wants the
     * newest, not a queue. The buffers come from [pool] and go back to it — a frame nobody read
     * before the next one arrived is returned by the analyzer, a frame the model consumed is
     * returned by the model thread — so the 4.9 MB tensor is allocated three times per session
     * rather than thirty times a second.
     */
    private val latest = AtomicReference<FloatArray?>(null)
    private val pool = FramePool(count = 3, size = IMG * IMG * 3)

    /**
     * Why the last frame did not arrive, if it did not.
     *
     * Preprocessing failures used to be swallowed by a bare `runCatching`, so a camera that
     * produced unreadable frames looked exactly like a camera warming up — `next_detection` kept
     * answering "no frame yet" forever, or worse, kept re-inferring one stale frame. The repo's
     * rule is fail loud, and this is where the failure is kept until someone asks.
     */
    private val lastFrameError = AtomicReference<String?>(null)

    private var interpreter: Interpreter? = null
    private var outputShape: IntArray = intArrayOf(1, 0, 0)

    /**
     * What to run once the camera permission is answered, keyed by the INVOKE — not by its command
     * name. Two concurrent `open_camera` invokes are two entries here; keyed by name, the second
     * overwrote the first and one of the two promises never settled.
     */
    private val pendingPermissionAction = ConcurrentHashMap<Long, () -> Unit>()

    // ---- capability ----------------------------------------------------------------------------

    /**
     * The one question `pickDetector` asks. True only when this plugin can actually do the work.
     *
     * TWO conditions, and the second is the one that matters today. The model asset has to be
     * present — but the asset IS present, because the Gradle copy task puts it in every APK, so
     * that condition alone would answer true on a build where not one line of this file has ever
     * run. `pickDetector` would then take the native path and the WebGPU fallback would be
     * silently skipped, which is the exact failure the sentence above warns about, committed by
     * the code that warns about it.
     *
     * That asymmetry is not sanctioned anywhere: Android's BLE plugin ships behind
     * `NATIVE_BLE_UNSUPPORTED` in ble-bridge.js precisely so that unverified native code cannot be
     * reached, and this had no equivalent. It does now.
     *
     * THE FLIP IS THIS CONSTANT. Set it true only after running on a device and checking, at
     * minimum: that a frame is captured at all and is UPRIGHT (see [Rotation]); that the letterbox
     * agrees with `preprocess()` — ml/golden_frames.py proves the .tflite matches the other
     * runtimes, not that this code feeds it the same pixels; and that it is actually FASTER than
     * what it replaces, which on a recent Android WebView is WebGPU rather than the slow wasm path
     * this plugin was planned against. Being native is not by itself a reason to win.
     */
    private val verifiedOnDevice = false

    @Command
    fun probe(invoke: Invoke) {
        val hasModel = runCatching { activity.assets.open(MODEL).close(); true }.getOrDefault(false)
        // A BARE boolean. `pickDetector` tests `=== true`, so `{ "value": … }` was never going to
        // select this plugin however the gate below was set — the native path would have stayed
        // unreachable even after someone verified it on a device and flipped the constant, which is
        // the worst moment for a wiring bug to still be waiting.
        invoke.resolveObject(verifiedOnDevice && hasModel)
    }

    // ---- camera --------------------------------------------------------------------------------

    /**
     * The cameras this phone actually has, as a bare array — `NativeDetector.cameras()` types the
     * reply `CameraDevice[]`, so `{ "cameras": [...] }` arrived as an object pretending to be one.
     *
     * ASKED, not assumed. This used to return a fixed front/back pair, so a device with no front
     * lens still offered one and selecting it failed later, at bind time, as an opaque camera
     * error rather than an absence the picker could have shown.
     */
    @Command
    fun list_cameras(invoke: Invoke) {
        val future = ProcessCameraProvider.getInstance(activity)
        future.addListener({
            runCatching {
                val p = future.get()
                val cameras = buildList {
                    if (p.hasCamera(CameraSelector.DEFAULT_BACK_CAMERA)) {
                        add(mapOf("deviceId" to BACK, "label" to "Back camera"))
                    }
                    if (p.hasCamera(CameraSelector.DEFAULT_FRONT_CAMERA)) {
                        add(mapOf("deviceId" to FRONT, "label" to "Front camera"))
                    }
                }
                invoke.resolveObject(cameras)
            }.onFailure { invoke.reject("could not enumerate cameras: ${it.message}") }
        }, androidx.core.content.ContextCompat.getMainExecutor(activity))
    }

    /**
     * Ask for the camera permission, then run [proceed].
     *
     * A manifest entry grants nothing on Android 6+; this plugin had no request path at all, so a
     * fresh install would fail to open the camera with no prompt ever shown to explain why.
     */
    private fun withCameraPermission(invoke: Invoke, proceed: () -> Unit) {
        if (getPermissionState(CAMERA_ALIAS) == PermissionState.GRANTED) {
            proceed()
            return
        }
        pendingPermissionAction[invoke.id] = proceed
        requestPermissionForAlias(CAMERA_ALIAS, invoke, "onCameraPermissionResult")
    }

    @PermissionCallback
    private fun onCameraPermissionResult(invoke: Invoke) {
        val proceed = pendingPermissionAction.remove(invoke.id)
        if (getPermissionState(CAMERA_ALIAS) != PermissionState.GRANTED) {
            return invoke.reject("camera permission was not granted")
        }
        if (proceed == null) {
            return invoke.reject("the permission result arrived with nothing waiting on it")
        }
        // Inside Tauri's ActivityResult callback there is no try/catch above this frame: a
        // throwing first post-grant command crashed the app instead of rejecting one promise.
        runCatching(proceed).onFailure {
            invoke.reject("${invoke.command} failed after the permission was granted: ${it.message}")
        }
    }

    @SuppressLint("UnsafeOptInUsageError")
    @Command
    fun open_camera(invoke: Invoke) = withCameraPermission(invoke) { bindCamera(invoke) }

    @SuppressLint("UnsafeOptInUsageError")
    private fun bindCamera(invoke: Invoke) {
        val args = invoke.parseArgs(OpenArgs::class.java)
        // The REAR camera by default. A phone's front lens is the trap the web path documents:
        // the app expresses no preference and the platform hands back a selfie camera, so the
        // scanner looks at a face while the user points the cube at the back of the phone.
        val id = args.deviceId ?: BACK
        val selector =
            if (id == FRONT) CameraSelector.DEFAULT_FRONT_CAMERA else CameraSelector.DEFAULT_BACK_CAMERA

        // Claim this session BEFORE anything async starts, and clear the last camera's frame with
        // it. Whatever was in `latest` belongs to a camera that is about to be unbound.
        val mine = generation.incrementAndGet()
        latest.getAndSet(null)?.let(pool::release)
        lastFrameError.set(null)

        val future = ProcessCameraProvider.getInstance(activity)
        future.addListener({
            // A provider callback that lost its race with a `close_camera` — or with another
            // `open_camera` — must not bind. Without this a camera the app asked to close could be
            // brought back up moments later by a listener nobody was waiting for any more.
            if (generation.get() != mine) {
                return@addListener invoke.reject("the camera was closed before it finished opening")
            }
            runCatching {
                val p = future.get()
                provider = p
                p.unbindAll()
                val a = ImageAnalysis.Builder()
                    // The modern selector: `setTargetResolution` is deprecated and, past CameraX
                    // 1.3, ignored on some devices. Closest-higher-then-lower keeps the frame at or
                    // just above 640 on the long side, which is all the letterbox can use.
                    .setResolutionSelector(
                        ResolutionSelector.Builder()
                            .setResolutionStrategy(
                                ResolutionStrategy(
                                    Size(IMG, IMG),
                                    ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER,
                                ),
                            )
                            .build(),
                    )
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
                    .build()
                a.setAnalyzer(analysisExecutor) { image ->
                    // `use` rather than a bare close, so a throwing letterbox still releases the
                    // image — a leaked ImageProxy stalls the whole analysis pipeline after two
                    // frames, which looks like a camera that froze.
                    image.use {
                        if (generation.get() != mine) return@use
                        // No free buffer means the model thread and the slot hold all three: the
                        // model is behind the camera, and the honest thing is to drop this frame
                        // rather than allocate a fourth.
                        val buf = pool.acquire() ?: return@use
                        runCatching { letterbox(it, buf) }
                            .onSuccess {
                                // Re-checked after the work: a close can land while a frame is
                                // being letterboxed, and publishing it then revives a closed
                                // camera's pixels.
                                if (generation.get() == mine) {
                                    lastFrameError.set(null)
                                    latest.getAndSet(buf)?.let(pool::release)
                                } else {
                                    pool.release(buf)
                                }
                            }
                            .onFailure { e ->
                                pool.release(buf)
                                if (generation.get() == mine) {
                                    // Recorded AND the stale frame dropped: answering with older
                                    // pixels would let a broken camera read as a working one.
                                    latest.getAndSet(null)?.let(pool::release)
                                    lastFrameError.set(e.message ?: e.toString())
                                }
                            }
                    }
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
        closeCamera()
        invoke.resolve()
    }

    /** Retire this session first, so an analyzer mid-frame cannot publish into the next one. */
    private fun closeCamera() {
        generation.incrementAndGet()
        analysis?.clearAnalyzer()
        provider?.unbindAll()
        analysis = null
        openedId = null
        latest.getAndSet(null)?.let(pool::release)
        lastFrameError.set(null)
    }

    // ---- model ---------------------------------------------------------------------------------

    @Command
    fun load_model(invoke: Invoke) {
        invoke.parseArgs(LoadArgs::class.java)
        // On the model thread: building an Interpreter maps the file and initialises XNNPACK, which
        // is not work for the thread that has to keep drawing.
        modelExecutor.execute {
            if (interpreter != null) return@execute invoke.resolve()
            runCatching {
                val opts = Interpreter.Options().apply {
                    // XNNPACK and the cores the app can spare — the same reasoning as the wasm
                    // path's thread count, which leaves two for the camera and the renderer.
                    numThreads = maxOf(1, Runtime.getRuntime().availableProcessors() - 2)
                    setUseXNNPACK(true)
                }
                val i = Interpreter(loadModel(), opts)
                // ASSERTED, not assumed. The shipped graph takes NHWC [1,640,640,3]; an export that
                // changed layout would otherwise be discovered as boxes that are subtly wrong
                // everywhere, which reads as a worse model rather than a wrong tensor.
                val inShape = i.getInputTensor(0).shape()
                check(inShape.contentEquals(intArrayOf(1, IMG, IMG, 3))) {
                    "the model wants input ${inShape.joinToString()}, not [1, $IMG, $IMG, 3] — " +
                        "this plugin builds NHWC and would feed it the wrong pixels"
                }
                outputShape = i.getOutputTensor(0).shape()
                interpreter = i
                invoke.resolve()
            }.onFailure { invoke.reject("could not load the model: ${it.message}") }
        }
    }

    private fun loadModel(): MappedByteBuffer {
        // `use`, so the descriptor is released even when the map fails.
        activity.assets.openFd(MODEL).use { fd ->
            FileInputStream(fd.fileDescriptor).use { stream ->
                return stream.channel.map(
                    FileChannel.MapMode.READ_ONLY,
                    fd.startOffset,
                    fd.declaredLength,
                )
            }
        }
    }

    /**
     * One inference on the newest frame, or null when the camera has opened but produced none yet.
     *
     * The reply is the RAW output tensor in the wire format `decodeTensorResponse` reads: two
     * little-endian int32s (rows, anchors) then rows*anchors float32. The RGBA frame never crosses
     * the bridge — that is the whole efficiency argument for doing this natively at all.
     *
     * On the model thread, and serialised there: LiteRT's `Interpreter` is not safe to call from
     * two threads, and running it on the command thread froze the UI.
     *
     * The frame is TAKEN, not read: this thread owns the buffer until it returns it to the pool,
     * so the analyzer cannot overwrite pixels mid-copy. A second tick before a new frame lands
     * sees "no frame yet" and skips, which is also one fewer inference of a picture the model has
     * already answered.
     */
    @Command
    fun next_detection(invoke: Invoke) {
        modelExecutor.execute {
            val i = interpreter
                ?: return@execute invoke.reject("the model is not loaded — call load_model first")
            val input = latest.getAndSet(null)
            if (input == null) {
                // A recorded preprocessing failure is reported, not papered over as "no frame yet".
                lastFrameError.get()?.let {
                    return@execute invoke.reject("the camera frame could not be prepared: $it")
                }
                return@execute invoke.resolve(JSObject().apply { put("tensor", "") })
            }
            val rows = outputShape.getOrElse(1) { 0 }
            val anchors = outputShape.getOrElse(2) { 0 }
            if (rows <= 0 || anchors <= 0) {
                pool.release(input)
                return@execute invoke.reject("the model reports no output shape")
            }

            val out = Array(1) { Array(rows) { FloatArray(anchors) } }
            val ran = runCatching {
                // A DIRECT ByteBuffer, and `run` rather than `runForMultipleInputsOutputs`.
                //
                // This previously nested the frame into `[1,3,640,640]` and wrapped THAT in
                // `arrayOf(...)`, producing a five-dimensional NCHW tensor for a model whose input
                // is `[1,640,640,3]` — and handed `run()` a Map, which is the multi-input API. Three
                // mistakes that all had to be fixed together, because each one alone still threw.
                val buf = inputBuffer()
                buf.clear()
                val f = buf.asFloatBuffer()
                f.put(input)
                buf.rewind()
                i.run(buf, out)
            }
            pool.release(input)
            ran.onFailure { return@execute invoke.reject("inference failed: ${it.message}") }

            val bytes = ByteBuffer.allocate(8 + rows * anchors * 4).order(ByteOrder.LITTLE_ENDIAN)
            bytes.putInt(rows)
            bytes.putInt(anchors)
            for (r in 0 until rows) for (a in 0 until anchors) bytes.putFloat(out[0][r][a])
            invoke.resolve(
                JSObject().apply {
                    put("tensor", android.util.Base64.encodeToString(bytes.array(), android.util.Base64.NO_WRAP))
                },
            )
        }
    }

    /**
     * The one input buffer, reused. Safe without a lock because every caller is [modelExecutor],
     * which is single-threaded — the same property that serialises the interpreter.
     */
    private var input: ByteBuffer? = null

    private fun inputBuffer(): ByteBuffer =
        input ?: ByteBuffer.allocateDirect(IMG * IMG * 3 * 4)
            .order(ByteOrder.nativeOrder())
            .also { input = it }

    /** Release what a plugin instance owns; an activity can be recreated under us. */
    override fun onDestroy() {
        closeCamera()
        analysisExecutor.shutdown()
        modelExecutor.shutdown()
        interpreter?.close()
        interpreter = null
        input = null
    }

    /**
     * `preprocess()` from src/onnx-detect.ts, reproduced exactly — including its arithmetic —
     * over the frame ROTATED UPRIGHT.
     *
     * Bilinear at PIXEL CENTRES: the `+ 0.5 … - 0.5` is not decoration, it is the half-pixel
     * convention the model was trained and calibrated against, and dropping it shifts every box by
     * half a pixel at 640 and more after the scale back. Long side to 640, centre pad with grey
     * 114/255, RGB.
     *
     * IN DOUBLE, because the TypeScript is. Every JS number is a double and only the store into
     * `Float32Array` rounds; this computed the scale, the source coordinates, the interpolation
     * weights and the normalisation in `Float`, which can land `sy` on the other side of an integer
     * boundary and pick a different source row. The comment claimed byte-exact parity that the code
     * did not deliver — and this is the one file where that claim carries real weight, since
     * `golden_frames.py` proves the .tflite agrees with the other runtimes and proves nothing at all
     * about what this feeds it.
     *
     * NHWC, unlike the TS and the Apple/Windows paths, which are CHW. Not a divergence in the
     * pixels — the same samples in a different order — but in the LAYOUT the runtime demands: the
     * ONNX graph takes `[1,3,640,640]` and this `.tflite` takes `[1,640,640,3]`, asserted in
     * `load_model` so an export that changes it fails loudly instead of quietly misreading.
     *
     * The one thing that legitimately differs from the TS is where the pixels come from: an
     * ImageProxy row is `rowStride` bytes wide, which is NOT width*4 on most devices — and the
     * frame is the sensor's, so [Rotation] turns upright coordinates back into sensor ones.
     */
    private fun letterbox(image: ImageProxy, into: FloatArray): FloatArray {
        val w = image.width
        val h = image.height
        require(w > 0 && h > 0) { "the camera produced a ${w}x${h} frame" }
        val plane = image.planes[0]
        val row = plane.rowStride
        val pixel = plane.pixelStride
        val src = plane.buffer
        val rotation = Rotation.of(w, h, image.imageInfo.rotationDegrees)
        // The ImageProxy is unwrapped HERE and the arithmetic lives in a pure function, so the
        // letterbox can be tested off a device. It could not be before: the only entry point took
        // an Android type that exists on a phone, which is why the file's strongest claim — that
        // this reproduces `preprocess()` — was never checked by anything.
        return letterboxFrom(rotation.width, rotation.height, into) { x, y, c ->
            src.get(rotation.srcY(x, y) * row + rotation.srcX(x, y) * pixel + c).toInt() and 0xff
        }
    }

    /**
     * A fixed set of frame buffers, handed out and returned. Whoever holds a buffer owns it; the
     * pool never hands out one it has not been given back. Pure, so the ownership rule can be
     * tested without a camera.
     */
    class FramePool(count: Int, size: Int) {
        private val free = ArrayDeque<FloatArray>(count).apply { repeat(count) { add(FloatArray(size)) } }

        /** A buffer nobody else holds, or null when every buffer is out. */
        fun acquire(): FloatArray? = synchronized(free) { free.poll() }

        fun release(buf: FloatArray) {
            synchronized(free) { free.add(buf) }
        }

        /** How many buffers are currently free — a test instrument. */
        val available: Int get() = synchronized(free) { free.size }
    }

    /**
     * The rotation CameraX asks for, as a coordinate map from the UPRIGHT frame back to the sensor
     * frame — so the letterbox samples rotated pixels without any of them being copied.
     *
     * `degrees` is `ImageInfo.rotationDegrees`: the CLOCKWISE turn that makes the sensor's frame
     * upright. For 90 the upright frame is `srcH` wide and `srcW` tall, and its top-left pixel is
     * the sensor's bottom-left. Only the four right angles exist; anything else is a contract
     * change and is refused rather than approximated.
     */
    class Rotation private constructor(
        private val degrees: Int,
        private val srcW: Int,
        private val srcH: Int,
    ) {
        /** The upright frame's size. */
        val width: Int get() = if (degrees == 90 || degrees == 270) srcH else srcW
        val height: Int get() = if (degrees == 90 || degrees == 270) srcW else srcH

        // Derived on the 3×2 picture in `VisionPluginRotationTest`, and the first draft of this
        // had the wrong dimension in two of the four arms — which that test caught on its first
        // run. Upright (x, y) for 90° CW: column `y` of the sensor, counted from its LAST row
        // (the sensor's bottom-left is the upright top-left), so the row index runs over srcH.

        /** Sensor column of the upright pixel (x, y). */
        fun srcX(x: Int, y: Int): Int = when (degrees) {
            0 -> x
            90 -> y
            180 -> srcW - 1 - x
            else -> srcW - 1 - y
        }

        /** Sensor row of the upright pixel (x, y). */
        fun srcY(x: Int, y: Int): Int = when (degrees) {
            0 -> y
            90 -> srcH - 1 - x
            180 -> srcH - 1 - y
            else -> x
        }

        companion object {
            fun of(srcW: Int, srcH: Int, degrees: Int): Rotation {
                require(degrees == 0 || degrees == 90 || degrees == 180 || degrees == 270) {
                    "CameraX reported a rotation of $degrees°; only right angles are defined"
                }
                return Rotation(degrees, srcW, srcH)
            }
        }
    }

    companion object Letterbox {
        /**
         * The letterbox itself, over any pixel source, into a caller-owned buffer.
         *
         * `sample(x, y, channel)` returns 0..255. Pulled out of [letterbox] so
         * `LetterboxParityTest` can run it against the exact numbers
         * `packages/cube-scanner/src/onnx-detect.ts` produces for the same fixture — the cross
         * language check that `crates/cube-vision/src/windows.rs` also carries, because there is
         * one preprocessing contract and three implementations of it.
         *
         * `inline`, so the sampler is not a boxed lambda call per channel per pixel (~1.2 M calls a
         * frame at 640×640) but the caller's expression in place; and `out` is the caller's, so a
         * frame costs no allocation once the [FramePool] is warm.
         */
        inline fun letterboxFrom(
            w: Int,
            h: Int,
            out: FloatArray = FloatArray(IMG * IMG * 3),
            sample: (Int, Int, Int) -> Int,
        ): FloatArray {
            require(out.size == IMG * IMG * 3) { "the output buffer is ${out.size} floats, not ${IMG * IMG * 3}" }
            out.fill(PAD)
            val scale = IMG.toDouble() / maxOf(w, h)
            val newW = maxOf(1, Math.round(w * scale).toInt())
            val newH = maxOf(1, Math.round(h * scale).toInt())
            val padX = (IMG - newW) / 2
            val padY = (IMG - newH) / 2

            for (y in 0 until newH) {
                val sy = minOf(h - 1.0, maxOf(0.0, (y + 0.5) / scale - 0.5))
                val y0 = sy.toInt()
                val y1 = minOf(h - 1, y0 + 1)
                val fy = sy - y0
                val oy = y + padY
                for (x in 0 until newW) {
                    val sx = minOf(w - 1.0, maxOf(0.0, (x + 0.5) / scale - 0.5))
                    val x0 = sx.toInt()
                    val x1 = minOf(w - 1, x0 + 1)
                    val fx = sx - x0
                    // NHWC: three contiguous channels per pixel, rather than three 640x640 planes.
                    val o = (oy * IMG + (x + padX)) * 3
                    for (c in 0 until 3) {
                        val p00 = sample(x0, y0, c).toDouble()
                        val p01 = sample(x1, y0, c).toDouble()
                        val p10 = sample(x0, y1, c).toDouble()
                        val p11 = sample(x1, y1, c).toDouble()
                        val top = p00 + (p01 - p00) * fx
                        val bot = p10 + (p11 - p10) * fx
                        out[o + c] = ((top + (bot - top) * fy) / 255.0).toFloat()
                    }
                }
            }
            return out
        }

        /**
         * Rotate a packed RGBA frame clockwise by `degrees` — the SAME mapping [Rotation] applies
         * on the fly, materialised so a unit test can look at the bytes. Not used on the frame
         * path (that would be a copy per frame); it exists so the mapping the letterbox samples
         * through is checked against the plainest possible statement of what "rotate clockwise"
         * means, on a pattern small enough to read.
         */
        fun rotateRgba(width: Int, height: Int, degrees: Int, rgba: ByteArray): ByteArray {
            require(rgba.size == width * height * 4) { "rgba is ${rgba.size} bytes, not ${width * height * 4}" }
            val r = Rotation.of(width, height, degrees)
            val out = ByteArray(rgba.size)
            for (y in 0 until r.height) {
                for (x in 0 until r.width) {
                    val src = (r.srcY(x, y) * width + r.srcX(x, y)) * 4
                    val dst = (y * r.width + x) * 4
                    for (c in 0 until 4) out[dst + c] = rgba[src + c]
                }
            }
            return out
        }

        const val CAMERA_ALIAS = "camera"
        const val IMG = 640
        /** Ultralytics letterbox pad colour (grey 114), normalised — same constant as the TS. */
        const val PAD = 114f / 255f
        private const val MODEL = "cube-yolo.tflite"
        private const val BACK = "back"
        private const val FRONT = "front"
    }
}
