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
import androidx.appcompat.app.AppCompatActivity
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
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

/**
 * Native capture and inference for Android, behind the same `cube-vision` commands Apple answers.
 *
 * The seam is `Detector` (packages/cube-scanner/src/detector.ts): the panel asks for the model's
 * output for a fresh frame and does not know what produced it. `pickDetector` probes this plugin
 * and falls back to `WebDetector` when it is absent, which is what every non-Apple build did until
 * now. The commands here are the ones `NativeDetector` calls, because a platform that answers a
 * different vocabulary is a second app — spelled the way TAURI DELIVERS THEM, which is not the way
 * the page sends them (see [listCameras]).
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
     * Who is waiting on the camera permission, in order, and — by whether the queue was empty —
     * whether a request is already out.
     *
     * ONE REQUEST IN FLIGHT (2026-09-21, audit). Tauri's `PluginManager` keeps a single
     * `requestPermissionsCallback` (tauri-2.11.5/mobile/android/src/main/java/app/tauri/plugin/
     * PluginManager.kt, `requestPermissions`), so a second `requestPermissionForAlias` while the
     * first was unanswered OVERWROTE it: the first invoke's callback never ran and its promise never
     * settled — and the map this replaced, keyed by invoke id "so both are kept", only hid that,
     * since the callback for the overwritten entry was never going to arrive. Now the first caller
     * launches the request and every caller waits here; the answer, a failed launch, an undeclared
     * permission and [onDestroy] each drain the WHOLE queue, so no invoke is left pending whichever
     * way the request ends.
     */
    private val permissionWaiters = Waiters<Pair<Invoke, () -> Unit>>()

    /** Set by [onDestroy], read on the model thread: a task queued behind the teardown must not
     *  build or use an interpreter the teardown has closed. */
    @Volatile
    private var destroyed = false

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
     *
     * NAMED IN lowerCamelCase, AND EVERY OTHER COMMAND HERE TOO (2026-09-20, audit 1.6). The page
     * sends `plugin:cube-vision|list_cameras`. This plugin registers no Rust `invoke_handler`
     * (crates/cube-vision/src/lib.rs, the Android `init`), so the call takes Tauri's mobile
     * fallback, which camel-cases the command before handing it to Kotlin —
     * `heck::AsLowerCamelCase(message.command)` in tauri-2.11.5/src/webview/mod.rs (the
     * `run_command` call around line 1891) — and `PluginHandle.kt` indexes `@Command` methods by
     * the exact `method.name` (`indexMethods`, `commands[method.name]`, mobile/android/src/main/
     * java/app/tauri/plugin/PluginHandle.kt:156). So `list_cameras` here was a method nothing could
     * reach: `listCameras` is what arrives, and "No command listCameras found" was the answer. Six
     * of the seven commands were unreachable this way; only `probe`, one word, was found — which is
     * why an `@Command` here is spelled as the camel-casing of what the page sends, held to it by
     * `apps/web/test/native-plugin-commands.test.mjs` on the source and by
     * `VisionPluginCommandsTest` on the compiled class.
     *
     * The BLE plugin's `ble_*` methods are snake_case and DO work, and that is not a counter-
     * example: Rust calls them through `run_mobile_plugin`, which passes the name verbatim. Copying
     * that convention here was the defect.
     */
    @Command
    fun listCameras(invoke: Invoke) {
        val future = ProcessCameraProvider.getInstance(activity)
        future.addListener({
            runCatching {
                val p = future.get()
                val cameras = buildList {
                    if (p.hasCamera(CameraSelector.DEFAULT_BACK_CAMERA)) add(cameraEntry(BACK))
                    if (p.hasCamera(CameraSelector.DEFAULT_FRONT_CAMERA)) add(cameraEntry(FRONT))
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
        // Only the FIRST waiter launches the request; the rest ride on its answer (see [permissionWaiters]).
        if (!permissionWaiters.add(invoke to proceed)) return
        // Tauri answers a permission the manifest does not declare by rejecting the LAUNCHING
        // invoke and never calling the callback (`PluginHandle.requestPermissions` runs it only
        // when `validatePermissions` passes) — which, with one request shared by everyone, would
        // leave every later caller queued for an answer that is never coming. The same check,
        // made here, refuses all of them at once instead (2026-09-21).
        if (!isPermissionDeclared(CAMERA_ALIAS)) {
            rejectWaiters("the camera permission is not declared in AndroidManifest.xml")
            return
        }
        runCatching { requestPermissionForAlias(CAMERA_ALIAS, invoke, "onCameraPermissionResult") }
            .onFailure { e ->
                // A launch that throws would otherwise leave every waiter pending for ever.
                rejectWaiters("could not ask for the camera permission: ${e.message}")
            }
    }

    /** Everyone waiting on the camera permission is rejected with [reason]; the queue is empty after. */
    private fun rejectWaiters(reason: String) {
        for ((waiting, _) in permissionWaiters.drain()) waiting.reject(reason)
    }

    /**
     * Whichever invoke Tauri hands back, EVERYONE drained is answered (2026-09-21). A callback
     * means a dialog was answered and the permission state is re-read fresh, so the answer is the
     * same for all of them; and an empty queue means whoever drained it — a failed launch, a
     * destroy — already settled the launching invoke, so nothing is answered twice. An earlier
     * draft returned early when the callback's invoke was not among the waiters, which dropped
     * the waiters it had just drained, unresolved.
     *
     * `invoke` is the signature Tauri's `PluginHandle` calls this with (`method(instance, invoke)`),
     * not a value this reads: the launching invoke is the first waiter, answered with the rest.
     */
    @Suppress("UNUSED_PARAMETER")
    @PermissionCallback
    private fun onCameraPermissionResult(invoke: Invoke) {
        val granted = getPermissionState(CAMERA_ALIAS) == PermissionState.GRANTED
        val waiting = permissionWaiters.drain()
        for ((each, proceed) in waiting) {
            if (!granted) {
                each.reject("camera permission was not granted")
                continue
            }
            // Inside Tauri's ActivityResult callback there is no try/catch above this frame: a
            // throwing first post-grant command crashed the app instead of rejecting one promise.
            runCatching(proceed).onFailure {
                each.reject("${each.command} failed after the permission was granted: ${it.message}")
            }
        }
    }

    @SuppressLint("UnsafeOptInUsageError")
    @Command
    fun openCamera(invoke: Invoke) = withCameraPermission(invoke) { bindCamera(invoke) }

    private fun bindCamera(invoke: Invoke) {
        val args = invoke.parseArgs(OpenArgs::class.java)
        // The REAR camera by default. A phone's front lens is the trap the web path documents:
        // the app expresses no preference and the platform hands back a selfie camera, so the
        // scanner looks at a face while the user points the cube at the back of the phone.
        // And an id this plugin never listed is REFUSED, before any state moves (2026-09-21,
        // audit): every unknown id used to fall through to the rear camera, where `Detector.use`
        // promises a rejection — the one `CameraSession.open` acts on by retrying with the id
        // dropped (packages/cube-scanner/view/camera-session.ts, its pinned-camera fallback).
        val facing = facingOf(args.deviceId)
            ?: return invoke.reject("no camera with id \"${args.deviceId}\": this plugin lists \"$BACK\" and \"$FRONT\"")
        val id = if (facing == Facing.FRONT) FRONT else BACK
        val selector =
            if (facing == Facing.FRONT) CameraSelector.DEFAULT_FRONT_CAMERA else CameraSelector.DEFAULT_BACK_CAMERA

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
            // ONE catch around the whole bind — the provider, `unbindAll`, the builder and the
            // bind itself — because a throw that escapes this Runnable is an uncaught exception
            // on the main thread: the app dies with the invoke unanswered, where the contract is
            // a rejection that says why.
            runCatching { bindTransactionally(future.get(), selector, id, mine) }
                .onSuccess { invoke.resolve() }
                .onFailure { invoke.reject("could not open the camera: ${it.message}") }
        }, androidx.core.content.ContextCompat.getMainExecutor(activity))
    }

    /**
     * Unbind whatever was bound, bind `selector` with a fresh analyzer, and commit the session's
     * state only when the bind succeeded. Throws on any failure — with NOTHING committed and the
     * candidate analyzer cleared — and the caller answers the invoke.
     *
     * TRANSACTIONAL (2026-09-21, audit). `analysis`/`openedId` used to be written only on success
     * and left alone on failure — but `unbindAll()` had already run, so a failed switch left
     * [currentCamera] naming a camera that was no longer bound, and the analyzer built for the new
     * one was neither installed nor cleared. The committed state is cleared BEFORE the old camera
     * is unbound, so no step can leave the fields describing a camera that is gone; the candidate
     * analyzer is local until the bind succeeds.
     */
    @SuppressLint("UnsafeOptInUsageError")
    private fun bindTransactionally(
        p: ProcessCameraProvider,
        selector: CameraSelector,
        id: String,
        mine: Int,
    ) {
        provider = p
        analysis?.clearAnalyzer()
        analysis = null
        openedId = null
        p.unbindAll()
        val candidate = analysisFor(mine)
        try {
            p.bindToLifecycle(activity as LifecycleOwner, selector, candidate)
        } catch (e: Throwable) {
            candidate.clearAnalyzer()
            throw e
        }
        analysis = candidate
        openedId = id
    }

    /** The analysis use case for session `mine`: frames at or just above 640, RGBA, newest only. */
    @SuppressLint("UnsafeOptInUsageError")
    private fun analysisFor(mine: Int): ImageAnalysis =
        ImageAnalysis.Builder()
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
            .also { a ->
                a.setAnalyzer(analysisExecutor) { image ->
                    // `use` rather than a bare close, so a throwing letterbox still releases the
                    // image — a leaked ImageProxy stalls the whole analysis pipeline after two
                    // frames, which looks like a camera that froze.
                    image.use { publishFrame(mine, it) }
                }
            }

    /** Letterbox one frame of session `mine` into a pooled buffer and publish it as [latest]. */
    private fun publishFrame(mine: Int, image: ImageProxy) {
        if (generation.get() != mine) return
        // No free buffer means the model thread and the slot hold all three: the model is behind
        // the camera, and the honest thing is to drop this frame rather than allocate a fourth.
        val buf = pool.acquire() ?: return
        runCatching { letterbox(image, buf) }
            .onSuccess {
                // Re-checked after the work: a close can land while a frame is being letterboxed,
                // and publishing it then revives a closed camera's pixels.
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
                    // Recorded AND the stale frame dropped: answering with older pixels would let
                    // a broken camera read as a working one.
                    latest.getAndSet(null)?.let(pool::release)
                    lastFrameError.set(e.message ?: e.toString())
                }
            }
    }

    /**
     * The camera that is open, as the same entry [listCameras] lists it — `facing` included
     * (2026-09-20). The scan screen mirrors its sticker view unless `facing === 'environment'`
     * (apps/web/lib/screens/scan/sticker-view.js), and `nativeDevice` on the TS side already reads
     * the field; this reply omitted it, so a phone's BACK camera was drawn mirrored.
     */
    @Command
    fun currentCamera(invoke: Invoke) {
        val id = openedId ?: return invoke.resolve()
        invoke.resolveObject(cameraEntry(id))
    }

    @Command
    fun closeCamera(invoke: Invoke) {
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
    fun loadModel(invoke: Invoke) {
        invoke.parseArgs(LoadArgs::class.java)
        // On the model thread: building an Interpreter maps the file and initialises XNNPACK, which
        // is not work for the thread that has to keep drawing.
        modelExecutor.execute {
            if (destroyed) return@execute invoke.reject("the plugin was destroyed")
            if (interpreter != null) return@execute invoke.resolve()
            runCatching {
                val opts = Interpreter.Options().apply {
                    // XNNPACK and the cores the app can spare — the same reasoning as the wasm
                    // path's thread count, which leaves two for the camera and the renderer.
                    numThreads = maxOf(1, Runtime.getRuntime().availableProcessors() - 2)
                    setUseXNNPACK(true)
                }
                val candidate = Interpreter(loadModel(), opts)
                // CLOSED ON EVERY FAILURE FROM HERE (2026-09-21, audit): an interpreter whose shape
                // check failed used to be dropped unclosed, and each retry leaked another LiteRT
                // instance. It becomes [interpreter] only once every check has passed.
                try {
                    // ASSERTED, not assumed. The shipped graph takes NHWC [1,640,640,3]; an export
                    // that changed layout would otherwise be discovered as boxes that are subtly
                    // wrong everywhere, which reads as a worse model rather than a wrong tensor.
                    val inShape = candidate.getInputTensor(0).shape()
                    check(inShape.contentEquals(intArrayOf(1, IMG, IMG, 3))) {
                        "the model wants input ${inShape.joinToString()}, not [1, $IMG, $IMG, 3] — " +
                            "this plugin builds NHWC and would feed it the wrong pixels"
                    }
                    val outShape = candidate.getOutputTensor(0).shape()
                    outputShape = outShape
                    interpreter = candidate
                } catch (e: Throwable) {
                    candidate.close()
                    throw e
                }
            }.onSuccess { invoke.resolve() }
                .onFailure { invoke.reject("could not load the model: ${it.message}") }
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
    /**
     * The pixels of the frame with the given id — which this plugin never has (D7,
     * dev-docs/scan-pipeline-audit-2026-09-23.md §3).
     *
     * IMPLEMENTED AS THE HONEST NEGATIVE, not omitted. The page asks for a frame's pixels so the
     * assembly can ask which stickers carry the same PAINT before it refuses a scan
     * (`recolourByPaint`), and it asks BY ID — the grid was fitted to one particular picture.
     * This plugin speaks wire version 1, so it attaches no identity to a frame and keeps none to
     * hand back; it also releases every frame into its buffer pool the moment the tensor is made
     * (`nextDetection`), so there is nothing to return even in principle.
     *
     * The reply is the 8-byte header alone, both zero, which `decodeFramePixels` reads as "that
     * frame is gone" — an ordinary answer, the same one Apple gives when a frame has aged out, and
     * the page then behaves exactly as it did before any of this existed. It is here rather than
     * absent because every command the page can send must be declared, or the call fails as "No
     * command framePixels found" instead of as a plain "no pixels"
     * (`apps/web/test/native-plugin-commands.test.mjs`, and `VisionPluginCommandsTest` on the
     * compiled class). A real implementation waits on the frame identity Android does not yet send.
     */
    @Command
    fun framePixels(invoke: Invoke) {
        val header = ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN)
        header.putInt(0).putInt(0)
        val empty = android.util.Base64.encodeToString(header.array(), android.util.Base64.NO_WRAP)
        invoke.resolve(JSObject().apply { put("pixels", empty) })
    }

    @Command
    fun nextDetection(invoke: Invoke) {
        modelExecutor.execute {
            if (destroyed) return@execute invoke.reject("the plugin was destroyed")
            val i = interpreter
                ?: return@execute invoke.reject("the model is not loaded — call load_model first")
            val input = latest.getAndSet(null)
            if (input == null) {
                // A recorded preprocessing failure is reported, not papered over as "no frame yet".
                val why = lastFrameError.get()
                if (why != null) return@execute invoke.reject("the camera frame could not be prepared: $why")
                return@execute invoke.resolve(JSObject().apply { put("tensor", "") })
            }
            // OWNED FROM HERE, RELEASED IN `finally` (2026-09-21, audit): only `Interpreter.run`
            // used to be guarded, so a throw in the output allocation, the encoding or the reply
            // skipped the release — a leaked buffer per failure, three failures and the pool was
            // empty and the camera "froze" — and left the invoke unresolved.
            try {
                val rows = outputShape.getOrElse(1) { 0 }
                val anchors = outputShape.getOrElse(2) { 0 }
                if (rows <= 0 || anchors <= 0) {
                    return@execute invoke.reject("the model reports no output shape")
                }
                // The ENCODING is inside the same guard as the inference (2026-09-21, verification of
                // the audit fix): with it in `onSuccess`, a throw from Base64 or the reply object escaped
                // `runCatching` after it had already succeeded — the buffer was released, the invoke was
                // never answered, and the executor task died with the exception.
                runCatching {
                    val bytes = infer(i, input, rows, anchors)
                    JSObject().apply {
                        put("tensor", android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP))
                    }
                }
                    .onSuccess { invoke.resolve(it) }
                    .onFailure { invoke.reject("inference failed: ${it.message}") }
            } finally {
                pool.release(input)
            }
        }
    }

    /**
     * One inference on an owned frame: the wire bytes `decodeTensorResponse` reads. Throws on any
     * failure; the caller owns `frame` and its release.
     */
    private fun infer(i: Interpreter, frame: FloatArray, rows: Int, anchors: Int): ByteArray {
        val out = Array(1) { Array(rows) { FloatArray(anchors) } }
        // A DIRECT ByteBuffer, and `run` rather than `runForMultipleInputsOutputs`.
        //
        // This previously nested the frame into `[1,3,640,640]` and wrapped THAT in
        // `arrayOf(...)`, producing a five-dimensional NCHW tensor for a model whose input
        // is `[1,640,640,3]` — and handed `run()` a Map, which is the multi-input API. Three
        // mistakes that all had to be fixed together, because each one alone still threw.
        val buf = inputBuffer()
        buf.clear()
        buf.asFloatBuffer().put(frame)
        buf.rewind()
        i.run(buf, out)
        return encodeTensor(rows, anchors, out[0])
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

    /**
     * Release what a plugin instance owns; an activity can be recreated under us.
     *
     * THE INTERPRETER IS CLOSED ON ITS OWN THREAD, BEHIND EVERY TASK ALREADY QUEUED (2026-09-21,
     * audit). It used to be closed here, on the main thread, while an inference could be running
     * on it — LiteRT is not safe to call from two threads — and a `loadModel` queued before the
     * destroy could then build a fresh interpreter into a dead plugin and leak it. Every model task
     * checks [destroyed] first, the close is the last task the executor accepts — `shutdown`, never
     * `shutdownNow`, so what is queued still runs and answers its own invoke — and permission
     * waiters are answered rather than abandoned. A command that arrives after the shutdown finds
     * `execute` throwing, which Tauri's dispatcher turns into a rejection of that invoke.
     *
     * The activity-taking overload: Tauri deprecated the bare `onDestroy()` and its
     * `triggerOnDestroy` calls each once, so this runs exactly as before and compiles clean.
     */
    override fun onDestroy(activity: AppCompatActivity) {
        destroyed = true
        closeCamera()
        analysisExecutor.shutdown()
        // Guarded: a second destroy finds the executor shut and `execute` throwing, and nothing
        // may escape the destroy path.
        runCatching {
            modelExecutor.execute {
                runCatching { interpreter?.close() }
                interpreter = null
                input = null
            }
        }
        modelExecutor.shutdown()
        for ((waiting, _) in permissionWaiters.drain()) {
            waiting.reject("the plugin was destroyed before the camera permission was answered")
        }
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

    /** The two lenses this plugin can name. */
    enum class Facing { BACK, FRONT }

    /**
     * Callers waiting on one shared answer, in order. `add` says whether the caller is the FIRST
     * waiting — the one that must launch the request — and `drain` hands every waiter back and
     * re-arms, so the next `add` launches again. Pure, so the one-request-in-flight rule of
     * [permissionWaiters] is pinned without a permission dialog.
     */
    class Waiters<T> {
        private val queue = ArrayDeque<T>()

        /** Adds `item`; true when it is the only one waiting, i.e. the caller must launch. */
        fun add(item: T): Boolean = synchronized(queue) {
            queue.add(item)
            queue.size == 1
        }

        /** Everyone waiting, in order, and the queue emptied. */
        fun drain(): List<T> = synchronized(queue) {
            val all = queue.toList()
            queue.clear()
            all
        }

        val size: Int get() = synchronized(queue) { queue.size }
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

        /**
         * One camera as the page reads it — a `CameraDevice` (packages/cube-scanner/src/camera.ts):
         * `deviceId`, `label`, and `facing` as `getUserMedia` would say it, `'environment'` for the
         * lens that faces away and `'user'` for the one that faces the person. The one place the
         * two ids become words, so [listCameras] and [currentCamera] cannot disagree; pure, so
         * `VisionPluginCommandsTest` pins the facing without a camera.
         */
        fun cameraEntry(id: String): Map<String, String> =
            if (id == FRONT) {
                mapOf("deviceId" to FRONT, "label" to "Front camera", "facing" to "user")
            } else {
                mapOf("deviceId" to BACK, "label" to "Back camera", "facing" to "environment")
            }

        /**
         * Which lens `deviceId` names: the rear by default, and null for an id this plugin never
         * listed — which [openCamera] refuses rather than opening the rear camera in its place.
         * Only null means "no preference": the panel already turns an empty `device-id` into
         * undefined (`ai-scan-panel.ts`, `|| undefined`) and `NativeDetector.use` sends null, so an
         * empty string here is an id nobody listed. Pure, so `VisionPluginLifecycleTest` pins the
         * refusal without a camera.
         */
        fun facingOf(deviceId: String?): Facing? = when (deviceId) {
            null, BACK -> Facing.BACK
            FRONT -> Facing.FRONT
            else -> null
        }

        /**
         * The wire format `decodeTensorResponse` reads: two little-endian int32s (rows, anchors)
         * then rows×anchors float32, row-major. Pure, and refuses an `out` whose shape is not the
         * one declared, so the header can never promise bytes the body does not carry.
         */
        fun encodeTensor(rows: Int, anchors: Int, out: Array<FloatArray>): ByteArray {
            require(rows > 0 && anchors > 0) { "a ${rows}×$anchors tensor has no cells" }
            require(out.size == rows && out.all { it.size == anchors }) {
                "the output is ${out.size} rows of ${out.firstOrNull()?.size ?: 0}, not ${rows}×$anchors"
            }
            val bytes = ByteBuffer.allocate(8 + rows * anchors * 4).order(ByteOrder.LITTLE_ENDIAN)
            bytes.putInt(rows)
            bytes.putInt(anchors)
            for (r in 0 until rows) for (a in 0 until anchors) bytes.putFloat(out[r][a])
            return bytes.array()
        }

        const val CAMERA_ALIAS = "camera"
        const val IMG = 640
        /** Letterbox pad colour (grey 114), normalised — the pad the model was trained with
         *  (ml/cube_infer.py PAD), and the same constant as the TS. */
        const val PAD = 114f / 255f
        private const val MODEL = "cubedet.tflite"
        private const val BACK = "back"
        private const val FRONT = "front"
    }
}
