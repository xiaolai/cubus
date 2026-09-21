//! The Apple implementation: thin Rust over the Swift C ABI in the CubeVision package.
//!
//! Every function here is a Tauri command the webview's `NativeDetector` calls. The heavy lifting —
//! AVFoundation capture, the byte-exact letterbox, CoreML on the ANE — is Swift; Rust marshals
//! arguments and hands the raw output tensor back as bytes (never JSON on the hot path: the spike
//! measured JSON at 2–3 ms/frame against ≤1 ms for raw bytes).
//!
//! ERRORS TRAVEL AS CODES AND ARE NARRATED HERE. The Swift side used to write its failures to
//! stderr and return -1, and this file said "see stderr" — which a Finder-launched app does not
//! have, so a camera that refused to open reported "open_camera failed (-1)" and nothing else.
//! Now every negative code is followed by `cube_vision_last_error()`, the message the Swift side
//! kept for exactly that call, and the pair is logged through the `log` facade (which is what
//! `tauri_plugin_log` captures) and returned to the webview as the command's error. The call and
//! that read are ONE step under `SWIFT` (2026-09-21), or a second command's failure could overwrite
//! the message between them.
//!
//! EVERY COMMAND THAT TOUCHES THE SWIFT STATE IS `(async)`. A plain `#[tauri::command]` runs on
//! the main thread, and these hold the Swift `stateLock` around work that is anything but quick:
//! `MLModel.compileModel` plus a warm inference in `load_model`, `startRunning()` in `open_camera`
//! (which on iOS also waits for the permission prompt), and one CoreML run per `next_detection`
//! tick. On the main thread that is the UI frozen for the duration, on the one screen whose job
//! is to stay live while the camera comes up; `windows.rs` documents and avoids the same trap. The
//! Swift lock serialises them, so moving them off the main thread changes nothing about ordering.
//! The rule covers the QUICK ones too — `current_camera` reads a string under that same lock, and
//! a lock a tick's CoreML run holds for milliseconds is a main-thread wait of milliseconds (it was
//! plain until 2026-09-20; audit §2.14). Only `probe` is plain: it reaches no Swift state at all.
//! Mechanised in `every_command_that_reaches_the_swift_state_is_async` below, on this file's text.

use std::os::raw::c_char;
use std::path::PathBuf;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::ipc::Response;
use tauri::path::BaseDirectory;
use tauri::plugin::TauriPlugin;
use tauri::{AppHandle, Manager, Runtime, State};

use crate::frame;
use crate::model_path;
use crate::wire;

// The C ABI exported by libCubeVision.a (see swift/Sources/CubeVision/FFI.swift). Every call is
// process-global on the Swift side (one model, one camera) — a plugin is a singleton and CoreML load
// is a one-time cost, so a global is the honest shape.
extern "C" {
    fn cube_vision_load(path: *const c_char, compute_units: i32) -> i32;
    /// A test instrument only: how many CoreML compiles this process has performed.
    #[cfg(test)]
    fn cube_vision_compile_count() -> i32;
    fn cube_vision_infer_rgba(
        rgba: *const u8,
        byte_count: usize,
        w: i32,
        h: i32,
        out: *mut f32,
        cap: i32,
        rows: *mut i32,
        anchors: *mut i32,
    ) -> i32;
    fn cube_vision_list_cameras() -> *mut c_char;
    fn cube_vision_current_camera() -> *mut c_char;
    fn cube_vision_last_error() -> *mut c_char;
    fn cube_vision_free_string(p: *mut c_char);
    fn cube_vision_open_camera(device_id: *const c_char) -> i32;
    fn cube_vision_close_camera();
    /// `picture` is two i32s, `[width, height]`, written whole by the Swift side.
    fn cube_vision_next_detection(
        out: *mut f32,
        cap: i32,
        rows: *mut i32,
        anchors: *mut i32,
        picture: *mut i32,
    ) -> i32;
}

/// `cube_vision_next_detection`'s "camera open, no frame has arrived" answer.
const NO_FRAME_YET: i32 = 0;

/// EVERY SWIFT CALL, AND THE NARRATION OF ITS FAILURE, UNDER ONE LOCK (2026-09-21, audit-fix
/// row 27). The Swift side kept ONE process-global `lastError`, written by a failing call and
/// consumed by `cube_vision_last_error()` — a second call. Its own lock covered each call alone, so
/// between a failure returning and this side asking why, another `(async)` command on another
/// tokio worker could fail and overwrite the message, or succeed and consume it: `open_camera`'s
/// error carrying `load_model`'s reason, or "the Swift side recorded no detail". This crate is the
/// only in-process caller (the probe CLI is another process), so serialising here makes the pair
/// atomic. Nothing is lost by it: the Swift `stateLock` already ran these one at a time.
///
/// TWO GUARDS, ONE ON EACH SIDE OF THE BOUNDARY. The same day, the Swift side moved the message
/// to a PER-THREAD slot (`LastError` in FFI.swift): a message now travels with the thread that made
/// the failing call, whatever other threads do meanwhile — and it asks of this side exactly what
/// `ffi_failure` does, a fetch on the same thread, right after the call. Either guard alone keeps
/// the contract, so neither side depends on a detail of the other it cannot see; it also means
/// the two tests below hold the CONTRACT and not this lock — with this lock removed both stay
/// green on the Swift slot (measured), and only both guards gone would fail them.
static SWIFT: Mutex<()> = Mutex::new(());

/// Run `f` — a Swift call and, on failure, `ffi_failure` — as one step nobody interleaves.
fn swift<T>(f: impl FnOnce() -> T) -> T {
    let _one_at_a_time = SWIFT.lock().unwrap_or_else(PoisonError::into_inner);
    f()
}

/// How long an open camera may deliver nothing before `next_detection` says so. A capture session
/// that starts delivers its first frame within a few hundred milliseconds; one that never will —
/// a Continuity Camera that dropped, a session AVFoundation interrupted for another app — used to
/// answer `0,0` forever, which `decodeTensorResponse` reads as "try again next tick", so the
/// scanner waited on it with nothing said. The Windows arm records a capture error to report in
/// the same spot; here the clock is the signal for what the OS only PAUSES or says nothing about.
/// What the OS announces — a device disconnected, a session that failed — the Swift side reports
/// as `-6` with the reason the tick after it happens (2026-09-20), and since the same day a frame
/// older than a second is not served as the latest, so a camera that stops mid-scan reaches this
/// clock at all: until then its last frame was re-inferred every tick as a perfectly still cube
/// and the clock, which starts only on a frameless tick, never started (audit §1.2).
const NO_FRAME_TIMEOUT: Duration = Duration::from_secs(5);

/// Output element count from the last successful `load_model`, so `next_detection` sizes its buffer
/// once. Zero means "no model loaded" — every inference command refuses rather than guessing a size.
#[derive(Default)]
struct CubeVision {
    out_len: AtomicI32,
    /// When the current run of frameless ticks began; None while frames are arriving or before
    /// the first tick after an open. See [NO_FRAME_TIMEOUT].
    waiting_since: Mutex<Option<Instant>>,
}

// Deserialized from the Swift side's JSON, then re-serialized to the webview — the field name the
// browser's CameraDevice uses (`deviceId`) is the wire name on both sides.
#[derive(Serialize, Deserialize)]
struct CameraInfo {
    #[serde(rename = "deviceId")]
    device_id: String,
    label: String,
    /// "user" or "environment" when AVFoundation knows the camera's position; absent otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    facing: Option<String>,
}

/// Encode a raw detect tensor for the bridge — wire version 2, VALIDATED at this boundary
/// (`crate::wire`, 2026-09-21): a count the buffer cannot hold, a shape whose product is not the
/// count, a negative dimension or half a picture size is an error naming the value, never a
/// clamped tensor that fails later in TypeScript (audit-fix row 95). Zero anchors with no picture
/// is "no frame yet" (the caller treats it as null and tries again), 20 bytes, not an error.
fn tensor_response(
    count: i32,
    rows: i32,
    anchors: i32,
    picture: [i32; 2],
    data: &[f32],
) -> Result<Response, String> {
    wire::tensor_bytes(count, rows, anchors, picture, data).map(Response::new)
}

/// Take ownership of a C string the Swift side allocated with `strdup`, or None for null.
fn take_string(ptr: *mut c_char) -> Option<String> {
    if ptr.is_null() {
        return None;
    }
    // SAFETY: a non-null pointer from the Swift side is a NUL-terminated heap string we own and
    // must free with cube_vision_free_string, exactly once.
    let s = unsafe { std::ffi::CStr::from_ptr(ptr) }
        .to_string_lossy()
        .into_owned();
    unsafe { cube_vision_free_string(ptr) };
    Some(s)
}

/// The Swift side's explanation for the last failing call, consumed.
fn last_error() -> String {
    // SAFETY: returns null (nothing recorded) or a heap string we own; `take_string` frees it.
    take_string(unsafe { cube_vision_last_error() })
        .unwrap_or_else(|| "the Swift side recorded no detail".to_string())
}

/// Narrate a failing FFI call: the code plus the Swift side's message, logged AND returned. The
/// return value is what the webview shows; the log line is what survives when nobody was looking.
/// Called INSIDE the `swift` closure that made the failing call, so the message read is that
/// call's — see `SWIFT`.
fn ffi_failure(what: &str, rc: i32) -> String {
    let detail = last_error();
    log::error!("cube-vision: {what} failed ({rc}): {detail}");
    format!("{what} failed ({rc}): {detail}")
}

/// True only when the plugin can actually do the work. `probe` COMMITS the webview to this path —
/// `pickDetector` takes it and never builds a `WebDetector` — so answering true and then failing
/// in `load_model` leaves the scanner with nothing, where a false answer would have left it with
/// the wasm/WebGPU fallback. This used to answer `true` unconditionally, on the reasoning that
/// reaching the command at all proved the plugin present; a shipped app whose `.mlpackage` resource
/// was missing then ended in "Cannot start" rather than in the fallback. The same two-tier check
/// the Windows arm makes, minus its runtime probe: CoreML is part of the OS and cannot be absent.
#[tauri::command]
fn probe<R: Runtime>(app: AppHandle<R>) -> bool {
    match resolve_model_path(&app) {
        Ok(_) => true,
        Err(e) => {
            log::warn!(
                "cube-vision: native inference unavailable, falling back to WebDetector: {e}"
            );
            false
        }
    }
}

/// `(async)`: AVFoundation's discovery session enumerates hardware, which is I/O, not a lookup.
#[tauri::command(async)]
fn list_cameras() -> Result<Vec<CameraInfo>, String> {
    // SAFETY: the Swift side returns a heap C string we own; `take_string` frees it.
    let json = swift(|| take_string(unsafe { cube_vision_list_cameras() }))
        .ok_or_else(|| "list_cameras returned null".to_string())?;
    serde_json::from_str(&json).map_err(|e| format!("bad camera list: {e}"))
}

/// `(async)`: a lookup, but one made under the Swift state lock, which a tick's CoreML run holds
/// for milliseconds at a time — on the main thread that wait is the UI's (2026-09-20, audit §2.14).
#[tauri::command(async)]
fn current_camera() -> Result<Option<CameraInfo>, String> {
    // SAFETY: null (no camera open) or a heap C string we own; `take_string` frees it.
    match swift(|| take_string(unsafe { cube_vision_current_camera() })) {
        None => Ok(None),
        Some(json) => serde_json::from_str(&json)
            .map(Some)
            .map_err(|e| format!("bad current camera: {e}")),
    }
}

/// The bundled model, relative to the app's Resource dir (see tauri.conf.json bundle.resources).
const MODEL_RESOURCE: &str = "models/cubedet.mlpackage";

/// The committed source model, path baked in at compile time. Used only as the dev fallback.
fn source_model_path() -> PathBuf {
    PathBuf::from(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../ml/models/cubedet.mlpackage"
    ))
}

/// Find the CoreML model. The webview no longer passes a path (it cannot reliably resolve one — the
/// JS `path` API may be absent or unpermitted, and that silently dropped the whole app to the wasm
/// runtime): resolution is the plugin's job, and the two-tier rule — the bundled Resource dir, then
/// the committed source tree — is `crate::model_path`'s, shared with the Windows arm (2026-09-21).
fn resolve_model_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    model_path::resolve(
        app.path()
            .resolve(MODEL_RESOURCE, BaseDirectory::Resource)
            .ok(),
        source_model_path(),
        "cubedet.mlpackage",
    )
}

/// `(async)`: a CoreML compile plus a warm inference, seconds on first load. The Swift side
/// answers a repeat load of the same path and compute units from its cache without recompiling
/// (`cube_vision_load` short-circuits, tested below), which is what the scan panel's park-and-reuse
/// relies on: a re-mounted panel asks its parked detector to load again, and that must be free.
#[tauri::command(async)]
fn load_model<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, CubeVision>,
    compute_units: i32,
) -> Result<i32, String> {
    let path = resolve_model_path(&app)?;
    let c = std::ffi::CString::new(path.to_string_lossy().as_ref()).map_err(|e| e.to_string())?;
    let len = swift(|| {
        // SAFETY: `c` outlives the call; the Swift side copies the path.
        let len = unsafe { cube_vision_load(c.as_ptr(), compute_units) };
        if len <= 0 {
            return Err(ffi_failure(
                &format!("model load for {}", path.display()),
                len,
            ));
        }
        Ok(len)
    })?;
    state.out_len.store(len, Ordering::SeqCst);
    Ok(len)
}

/// `(async)`: `startRunning()` blocks until the capture session is live, and on first use the
/// camera-permission prompt sits in front of it.
#[tauri::command(async)]
fn open_camera(state: State<'_, CubeVision>, device_id: Option<String>) -> Result<(), String> {
    open_camera_named(device_id.as_deref())?;
    // A fresh session gets a fresh clock: frames from the previous camera do not count for this one.
    *state
        .waiting_since
        .lock()
        .map_err(|_| "camera state poisoned")? = None;
    Ok(())
}

/// The Swift half of `open_camera`: the call and, on failure, its reason — one step under `SWIFT`,
/// so the reason is this call's and not another command's (row 27; the test with eight concurrent
/// bogus opens holds it).
fn open_camera_named(device_id: Option<&str>) -> Result<(), String> {
    let c = device_id
        .map(std::ffi::CString::new)
        .transpose()
        .map_err(|e| e.to_string())?;
    let ptr = c.as_ref().map_or(std::ptr::null(), |s| s.as_ptr());
    swift(|| {
        // SAFETY: `c` (and thus `ptr`) outlives the call.
        let rc = unsafe { cube_vision_open_camera(ptr) };
        if rc != 0 {
            return Err(ffi_failure("open_camera", rc));
        }
        Ok(())
    })
}

/// `(async)`: takes the Swift state lock, which a running inference may hold for a few ms.
#[tauri::command(async)]
fn close_camera() {
    // SAFETY: idempotent on the Swift side; safe to call with no camera open.
    swift(|| unsafe { cube_vision_close_camera() });
}

/// `(async)`: one CoreML run per tick, the single most expensive thing this plugin does.
#[tauri::command(async)]
fn next_detection(state: State<'_, CubeVision>) -> Result<Response, String> {
    let len = state.out_len.load(Ordering::SeqCst);
    if len <= 0 {
        return Err("model not loaded".into());
    }
    next_detection_bytes(len, &state.waiting_since, |buf, rows, anchors, picture| {
        // SAFETY: `buf` has `len` elements (`next_detection_bytes` allocates it so), matching the
        // `cap` passed; rows/anchors are valid out-params and `picture` is the two Int32s the Swift
        // side writes.
        unsafe {
            cube_vision_next_detection(buf.as_mut_ptr(), len, rows, anchors, picture.as_mut_ptr())
        }
    })
    .map(Response::new)
}

/// One tick's handling, with the Swift call handed in as `detect(buffer, rows, anchors, picture)`:
/// the command passes `cube_vision_next_detection`, the tests a stand-in that writes what a camera
/// frame would. So everything this side does with the call's outputs — the tensor, its shape, the
/// picture's `[width, height]`, the no-frame clock, a refusal — runs end to end without a camera
/// (round-3 audit). The Swift side of the same call is held by `swift test`, which can inject a
/// frame, and the ABI between the two by `next_detection_writes_the_picture_through_its_own_argument`.
fn next_detection_bytes(
    len: i32,
    waiting_since: &Mutex<Option<Instant>>,
    detect: impl FnOnce(&mut [f32], &mut i32, &mut i32, &mut [i32; 2]) -> i32,
) -> Result<Vec<u8>, String> {
    let mut buf =
        vec![0f32; usize::try_from(len).map_err(|_| format!("a model output of {len} elements"))?];
    let (mut rows, mut anchors) = (0i32, 0i32);
    // `[width, height]`, written whole by the Swift side.
    let mut picture = [0i32; 2];
    let n = swift(|| {
        let n = detect(&mut buf, &mut rows, &mut anchors, &mut picture);
        if n < 0 {
            return Err(ffi_failure("next_detection", n));
        }
        Ok(n)
    })?;
    let mut waiting = waiting_since.lock().map_err(|_| "camera state poisoned")?;
    if n == NO_FRAME_YET {
        // Opened but no frame yet — for a while, that is warm-up and the panel tries again next
        // tick. Past the window it is a camera that is not going to deliver, and the wait ends in
        // an error instead of a spinner. The Windows arm surfaces the same condition from a
        // recorded capture error; AVFoundation records nothing for a frame that never comes.
        let since = *waiting.get_or_insert_with(Instant::now);
        if since.elapsed() >= NO_FRAME_TIMEOUT {
            return Err(format!(
                "the camera has delivered no frame in {}s — it may be in use by another app, \
                 asleep, or gone; close and reopen it",
                NO_FRAME_TIMEOUT.as_secs()
            ));
        }
        return Ok(wire::no_frame());
    }
    *waiting = None;
    wire::frame_bytes(n, rows, anchors, picture, &buf)
}

/// Decode and check an `infer_frame` payload into what the Swift ABI takes: the RGBA bytes and
/// `Int32` dimensions. Everything `crate::frame` guards (positive, `checked_mul`, exact length)
/// happens there; this adds the one check the C ABI needs on top — a dimension the Swift side
/// could not even represent is refused rather than truncated.
fn prepare_still(
    rgba_base64: &str,
    width: usize,
    height: usize,
) -> Result<(Vec<u8>, i32, i32), String> {
    let rgba = frame::decode_rgba(rgba_base64, width, height)?;
    let w =
        i32::try_from(width).map_err(|_| format!("width {width} exceeds the Swift ABI's Int32"))?;
    let h = i32::try_from(height)
        .map_err(|_| format!("height {height} exceeds the Swift ABI's Int32"))?;
    Ok((rgba, w, h))
}

/// Inject a still RGBA frame and get its tensor back — the golden-frame harness's path across the
/// bridge, and the way a test proves the plugin's real letterbox matches `preprocess()` end to end.
/// Not the production path (that is `next_detection`, which never ships the frame).
///
/// The wire shape is `crate::frame`'s — `rgba_base64`, `width: usize`, `height: usize`, identical
/// on Windows — so one harness drives both plugins. Every check runs in `prepare_still` before a
/// pointer is formed; the Swift letterbox additionally `precondition`s positive dimensions, so a
/// caller that reached it with a zero would crash loudly rather than index `h - 1`.
#[tauri::command(async)]
fn infer_frame(
    state: State<'_, CubeVision>,
    rgba_base64: String,
    width: usize,
    height: usize,
) -> Result<Response, String> {
    let len = state.out_len.load(Ordering::SeqCst);
    if len <= 0 {
        return Err("model not loaded".into());
    }
    let (rgba, w, h) = prepare_still(&rgba_base64, width, height)?;
    let mut buf = vec![0f32; len as usize];
    let (mut rows, mut anchors) = (0i32, 0i32);
    let n = swift(|| {
        // SAFETY: rgba is exactly w*h*4 bytes (checked by prepare_still, and again by the Swift side
        // against the length passed with it); buf has `len` elements matching `cap`; rows/anchors
        // are valid out-params.
        let n = unsafe {
            cube_vision_infer_rgba(
                rgba.as_ptr(),
                rgba.len(),
                w,
                h,
                buf.as_mut_ptr(),
                len,
                &mut rows,
                &mut anchors,
            )
        };
        if n < 0 {
            return Err(ffi_failure("infer_frame", n));
        }
        Ok(n)
    })?;
    tensor_response(n, rows, anchors, [w, h], &buf)
}

/// The plugin. Registers the command surface and the shared output-size state, and closes the camera
/// when the app exits so the capture device is never left running past the window.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("cube-vision")
        .invoke_handler(tauri::generate_handler![
            probe,
            list_cameras,
            current_camera,
            load_model,
            open_camera,
            close_camera,
            next_detection,
            infer_frame
        ])
        .setup(|app, _api| {
            app.manage(CubeVision::default());
            Ok(())
        })
        .on_event(|_app, event| {
            if let tauri::RunEvent::Exit = event {
                // SAFETY: idempotent; releases the capture device on shutdown.
                swift(|| unsafe { cube_vision_close_camera() });
            }
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Proves the Rust↔Swift boundary marshals end to end — a path in, a correctly-shaped tensor out
    // of the real CoreML model. The Swift letterbox + model parity against fp32 is proven separately
    // and exhaustively by ml/golden_frames.py's `native` leg (the same CubeVision code via the CLI);
    // this covers the ~30 lines of FFI in this file, which that leg does not exercise.
    // The dev fallback the app relies on in `tauri dev` (where bundle.resources are not staged): the
    // committed source model must exist at the compile-time path, or native inference silently
    // becomes impossible in development and the app quietly runs the slow wasm model instead.
    #[test]
    fn dev_model_path_resolves_to_the_committed_source_model() {
        let p = source_model_path();
        assert!(
            p.is_dir(),
            "source .mlpackage missing at {} — run ml/export.py",
            p.display()
        );
    }

    /// Load the committed model once for the tests that need it. The Swift side is process-global,
    /// so this is also what `load_is_free_for_the_same_model_and_units` measures against.
    /// The Swift side holds ONE model and ONE camera for the whole process, and the harness runs tests
    /// on parallel threads — so every test that loads the model or touches the camera holds this for
    /// its length. The compile-count test counted another test's load as its own once a second model
    /// test existed (2026-09-19); the race had been there all along, with one fewer contender.
    static NATIVE_STATE: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn native_state() -> std::sync::MutexGuard<'static, ()> {
        NATIVE_STATE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn load_source_model(units: i32) -> i32 {
        let model = source_model_path();
        assert!(
            model.is_dir(),
            "committed model missing at {} — run ml/export.py",
            model.display()
        );
        let c = std::ffi::CString::new(model.to_string_lossy().as_ref()).unwrap();
        // SAFETY: valid C path; returns the output element count or <=0 on failure.
        let len = unsafe { cube_vision_load(c.as_ptr(), units) };
        assert!(len > 0, "cube_vision_load failed: {len}: {}", last_error());
        len
    }

    #[test]
    fn infer_rgba_returns_a_correctly_shaped_tensor() {
        let _state = native_state();
        let len = load_source_model(0);
        let (w, h) = (64i32, 48i32);
        let rgba = vec![128u8; (w * h * 4) as usize];
        let mut buf = vec![0f32; len as usize];
        let (mut rows, mut anchors) = (0i32, 0i32);
        // SAFETY: rgba is w*h*4 bytes; buf has `len` elements matching the cap.
        let n = unsafe {
            cube_vision_infer_rgba(
                rgba.as_ptr(),
                rgba.len(),
                w,
                h,
                buf.as_mut_ptr(),
                len,
                &mut rows,
                &mut anchors,
            )
        };
        assert_eq!(n, len, "infer returned {n}, expected {len} elements");
        assert_eq!(rows, 4 + 6, "rows = 4 box coords + 6 colour classes");
        assert_eq!(anchors, 8400, "v3 at 640 has 8400 anchors");
    }

    /// The byte count crosses with the pointer and the Swift side checks it against the dimensions:
    /// a buffer shorter or longer than `w * h * 4`, or dimensions that overflow, are refused with a
    /// code rather than read past or trapped on (audit, 2026-09-19). No model is needed — the check
    /// runs before the model is asked for.
    #[test]
    fn infer_rgba_refuses_a_byte_count_that_is_not_its_size() {
        let _state = native_state();
        // Longer than any count passed below, so a Swift side that ignored the count would still
        // read inside it.
        let rgba = [0u8; 32];
        let mut buf = vec![0f32; 1];
        let (mut rows, mut anchors) = (0i32, 0i32);
        for (count, w, h) in [
            (15usize, 2, 2),
            (17, 2, 2),
            (0, 0, 4),
            (16, i32::MAX, i32::MAX),
        ] {
            // SAFETY: `count` never exceeds `rgba.len()`, so a Swift side that ignored it still
            // reads inside the buffer; the call is expected to refuse before reading at all.
            let n = unsafe {
                cube_vision_infer_rgba(
                    rgba.as_ptr(),
                    count,
                    w,
                    h,
                    buf.as_mut_ptr(),
                    1,
                    &mut rows,
                    &mut anchors,
                )
            };
            assert_eq!(n, -5, "{w}x{h} against {count} bytes was not refused");
            assert!(
                last_error().contains("is not"),
                "the refusal carried no reason"
            );
        }
    }

    /// The per-tick entry's ABI, driven from Rust: argument order and the picture's pointer are the
    /// extern above's, and a mistake there compiles. With a model and no camera the Swift side answers
    /// -4 and zeroes the picture through the FIFTH argument, touching neither the rows nor the anchors —
    /// so a declaration that swapped `picture` with either would zero the wrong one and fail here. The
    /// frame-present path is `swift test`'s (swift/Tests/CubeVisionTests), which can inject a frame.
    #[test]
    fn next_detection_writes_the_picture_through_its_own_argument() {
        let _state = native_state();
        let len = load_source_model(0);
        // SAFETY: idempotent; no camera is open afterwards.
        unsafe { cube_vision_close_camera() };
        let mut buf = vec![0f32; len as usize];
        let (mut rows, mut anchors) = (-7i32, -7i32);
        let mut picture = [-1i32, -1];
        // SAFETY: `buf` has `len` elements matching the cap; the rest are valid out-params.
        let n = unsafe {
            cube_vision_next_detection(
                buf.as_mut_ptr(),
                len,
                &mut rows,
                &mut anchors,
                picture.as_mut_ptr(),
            )
        };
        assert_eq!(n, -4, "expected no camera: {}", last_error());
        assert_eq!(
            picture,
            [0, 0],
            "the picture was not written through its argument"
        );
        assert_eq!(
            (rows, anchors),
            (-7, -7),
            "the picture's zeroes landed on the shape"
        );
    }

    /// A tick end to end on this side, with the Swift call stood in for: what it wrote reaches the wire
    /// as it wrote it — a picture odd both ways, so a swapped or rounded pair cannot pass — and a frame
    /// whose size did not come back, a camera with no frame yet and a frame after that wait each get
    /// the answer the page expects.
    #[test]
    fn a_tick_carries_what_the_swift_side_wrote_to_the_wire() {
        let waiting = Mutex::new(None);
        let frame = |buf: &mut [f32], rows: &mut i32, anchors: &mut i32, picture: &mut [i32; 2]| {
            assert_eq!(
                buf.len(),
                3,
                "the buffer is not the size the model promised"
            );
            buf.copy_from_slice(&[0.5, 0.25, 0.125]);
            (*rows, *anchors, *picture) = (1, 3, [721, 479]);
            3
        };
        let bytes = next_detection_bytes(3, &waiting, frame).unwrap();
        let word = |i: usize| i32::from_le_bytes(bytes[i * 4..i * 4 + 4].try_into().unwrap());
        assert_eq!(
            [word(0), word(1), word(2), word(3), word(4)],
            [-2, 1, 3, 721, 479]
        );
        let f = |i: usize| f32::from_le_bytes(bytes[20 + i * 4..24 + i * 4].try_into().unwrap());
        assert_eq!([f(0), f(1), f(2)], [0.5, 0.25, 0.125]);
        assert_eq!(bytes.len(), 20 + 3 * 4);

        let no_size = next_detection_bytes(3, &waiting, |_, rows, anchors, _| {
            (*rows, *anchors) = (1, 3);
            3
        })
        .unwrap_err();
        assert!(no_size.contains("reported its picture"), "{no_size}");

        let idle = next_detection_bytes(3, &waiting, |_, _, _, _| NO_FRAME_YET).unwrap();
        assert_eq!(idle.len(), 20, "no frame yet is the 20-byte header alone");
        assert!(
            waiting.lock().unwrap().is_some(),
            "the no-frame clock did not start"
        );
        next_detection_bytes(3, &waiting, frame).unwrap();
        assert!(
            waiting.lock().unwrap().is_none(),
            "a frame did not stop the no-frame clock"
        );
    }

    /// THE FIVE-SECOND BRANCH (2026-09-21, audit-fix row 28): a clock that started `NO_FRAME_TIMEOUT` ago turns
    /// the next frameless tick into an error naming the wait; the tick after it errors again (the
    /// clock is not reset by the error); a frame clears it, and the next frameless tick starts a
    /// new clock rather than inheriting the expired one. Driven by setting the clock's start
    /// directly, which is what the mutex is for.
    #[test]
    fn the_no_frame_clock_expires_into_an_error_and_a_frame_resets_it() {
        let expired = Instant::now()
            .checked_sub(NO_FRAME_TIMEOUT)
            .expect("five seconds ago exists");
        let waiting = Mutex::new(Some(expired));
        let idle = |_: &mut [f32], _: &mut i32, _: &mut i32, _: &mut [i32; 2]| NO_FRAME_YET;
        let e = next_detection_bytes(3, &waiting, idle).unwrap_err();
        assert!(e.contains("no frame in 5s"), "{e}");
        assert!(e.contains("close and reopen"), "{e}");
        // Still expired on the next tick: the error repeats rather than restarting the wait.
        assert!(next_detection_bytes(3, &waiting, idle).is_err());
        // A frame ends the wait…
        let frame = |buf: &mut [f32], rows: &mut i32, anchors: &mut i32, picture: &mut [i32; 2]| {
            buf.copy_from_slice(&[0.5, 0.25, 0.125]);
            (*rows, *anchors, *picture) = (1, 3, [640, 480]);
            3
        };
        next_detection_bytes(3, &waiting, frame).unwrap();
        assert!(
            waiting.lock().unwrap().is_none(),
            "a frame did not clear the clock"
        );
        // …and the next frameless tick is warm-up again, timed from now.
        assert_eq!(next_detection_bytes(3, &waiting, idle).unwrap().len(), 20);
        let restarted = waiting.lock().unwrap().expect("a new clock started");
        assert!(restarted.elapsed() < NO_FRAME_TIMEOUT);
    }

    /// A refused tick is an error carrying the Swift side's code, never a tensor.
    #[test]
    fn a_refused_tick_is_an_error_with_its_code() {
        // The Swift side's last error is process-wide, and the failing-call test reads it.
        let _state = native_state();
        let e = next_detection_bytes(3, &Mutex::new(None), |_, _, _, _| -4).unwrap_err();
        assert!(e.contains("next_detection failed (-4)"), "{e}");
    }

    /// The Swift side's answer for a camera the OS took away — `-6`, since 2026-09-20 — goes down
    /// the same road as every other refusal: an error naming the code, narrated with the Swift
    /// side's reason, and never a wait. A stopped camera is not a camera to keep a no-frame clock
    /// on, and the clock is untouched by it: the error returns before the clock is read. The Swift
    /// half — that a disconnect or a failed session produces the code and the reason — is held by
    /// `swift test` (swift/Tests/CubeVisionTests), which can record one; this side cannot.
    #[test]
    fn a_stopped_camera_is_an_error_with_its_code_and_not_a_wait() {
        let _state = native_state();
        let waiting = Mutex::new(None);
        let e = next_detection_bytes(3, &waiting, |_, _, _, _| CAMERA_STOPPED).unwrap_err();
        assert!(e.contains("next_detection failed (-6)"), "{e}");
        assert!(
            waiting.lock().unwrap().is_none(),
            "a stopped camera started the no-frame clock"
        );
    }

    /// `cube_vision_next_detection`'s "the camera that was open stopped" answer (FFI.swift's code
    /// table); this side branches on no code, so the constant lives with the test that pins the path.
    const CAMERA_STOPPED: i32 = -6;

    /// The module doc's rule, mechanised on this file's own text and KEYED ON COMMAND IDENTITY
    /// (2026-09-21, audit-fix row 29): every command the plugin registers is declared
    /// `#[tauri::command(async)]`, except the ones on an explicit allowlist that reach no Swift
    /// state — and each of those must exist and BE plain, so the list cannot rot. The first draft
    /// inferred "reaches Swift" from substrings of each command's body, which a helper named
    /// anything but `next_detection_bytes` slipped past. `current_camera` was plain until
    /// 2026-09-20 (audit §2.14), and the doc claimed the rule held.
    #[test]
    fn every_command_that_reaches_the_swift_state_is_async() {
        /// Commands that reach no Swift state, and so may run on the main thread.
        const PLAIN: &[&str] = &["probe"];
        let src = include_str!("apple.rs");
        // The registered names, read out of the builder's list rather than guessed.
        let list_at = src
            .find("generate_handler![")
            .expect("the plugin registers commands");
        let list_end = src[list_at..].find(']').expect("the list closes") + list_at;
        let registered: Vec<&str> = src[list_at + "generate_handler![".len()..list_end]
            .split(',')
            .map(str::trim)
            .filter(|n| !n.is_empty())
            .collect();
        assert_eq!(registered.len(), 8, "the plugin registers eight commands");
        for plain in PLAIN {
            assert!(
                registered.contains(plain),
                "{plain} is on the plain allowlist but not registered"
            );
        }
        let lines: Vec<&str> = src.lines().collect();
        let mut offenders = Vec::new();
        for name in &registered {
            // The command's `fn` line, then the attribute directly above it, past any doc lines.
            let fn_line = lines
                .iter()
                .position(|l| {
                    l.strip_prefix("fn ")
                        .is_some_and(|rest| rest.split(['<', '(']).next() == Some(name))
                })
                .unwrap_or_else(|| panic!("no fn {name} at column 0"));
            let attribute = lines[..fn_line]
                .iter()
                .rev()
                .find(|l| !l.starts_with("///"))
                .copied()
                .unwrap_or("");
            let is_async = attribute == "#[tauri::command(async)]";
            let is_plain = attribute == "#[tauri::command]";
            assert!(
                is_async || is_plain,
                "{name} is registered but not declared as a command: {attribute:?}"
            );
            let allowed_plain = PLAIN.contains(name);
            if allowed_plain && !is_plain {
                offenders.push(format!(
                    "{name}: on the plain allowlist but declared {attribute}"
                ));
            }
            if !allowed_plain && !is_async {
                offenders.push(format!("{name}: {attribute}"));
            }
        }
        assert!(
            offenders.is_empty(),
            "commands that must be (async) but are not, or allowlisted ones that are: {offenders:?}"
        );
    }

    /// The park-and-reuse contract: the scan panel is re-mounted per screen and asks its detector
    /// to load every time, so a repeat `cube_vision_load` for the SAME path and units must not
    /// rebuild the model (a CoreML load, and until 2026-09-20 a compile too — seconds, on the main
    /// thread's watch). The counter is the Swift side's own count of `CubeModel` builds — a second
    /// load that rebuilt would move it, which is exactly what happened before the short-circuit
    /// existed. Since the compiled-model cache (Model.swift) a build compiles only when the cache
    /// has no entry for the source; the counter counts builds under its older name.
    #[test]
    fn load_is_free_for_the_same_model_and_units() {
        let _state = native_state();
        let first = load_source_model(0);
        // SAFETY: a plain counter read, no arguments, no ownership.
        let built = unsafe { cube_vision_compile_count() };
        let again = load_source_model(0);
        assert_eq!(
            again, first,
            "the cached model answers the same output size"
        );
        assert_eq!(
            unsafe { cube_vision_compile_count() },
            built,
            "a repeat load of the same model and units must not build again"
        );
        // Different compute units ARE a different model configuration and must rebuild.
        let _ = load_source_model(1);
        assert_eq!(
            unsafe { cube_vision_compile_count() },
            built + 1,
            "changing compute units must build a new model"
        );
    }

    // The wire itself — version 2, the picture, every refusal — is `crate::wire`'s and tested
    // there; this side's tests hold what the COMMAND does with the Swift side's outputs.

    /// The guards in front of the FFI, exercised without it: every shape the audit named is
    /// refused by `prepare_still` before a pointer exists. `crate::frame` carries the finer-grained
    /// cases; this pins that THIS arm goes through them and adds the Int32 ceiling.
    #[test]
    fn infer_frame_refuses_degenerate_dimensions_before_any_ffi() {
        use base64::Engine as _;
        let b64 = |n: usize| base64::engine::general_purpose::STANDARD.encode(vec![0u8; n]);
        assert!(prepare_still(&b64(0), 0, 48)
            .unwrap_err()
            .contains("positive"));
        assert!(prepare_still(&b64(0), 64, 0)
            .unwrap_err()
            .contains("positive"));
        assert!(prepare_still(&b64(8), usize::MAX / 2, 4)
            .unwrap_err()
            .contains("overflows"));
        assert!(prepare_still(&b64(8), 2, 2)
            .unwrap_err()
            .contains("expected 16"));
        let (rgba, w, h) = prepare_still(&b64(16), 2, 2).unwrap();
        assert_eq!((rgba.len(), w, h), (16, 2, 2));
    }

    // Exercises the AVFoundation discovery path in-process — no camera permission, no capture session,
    // no cube needed. It proves `cube_vision_list_cameras` returns a well-formed, parseable list (the
    // Rust↔Swift string ownership and JSON round-trip), which is the half of the camera path that does
    // not need a person. Opening a device and reading frames is the remaining part, and that one does.
    #[test]
    fn list_cameras_enumerates_without_crashing() {
        // SAFETY: returns null or a heap C string we own; `take_string` frees it.
        let json = take_string(unsafe { cube_vision_list_cameras() }).expect("non-null list");
        let cams: Vec<CameraInfo> =
            serde_json::from_str(&json).expect("list_cameras must return a JSON array");
        // Not asserted non-empty: a CI runner or a locked-down machine may expose no video device,
        // and that is a valid answer, not a failure. The point is the path runs and parses.
        eprintln!("list_cameras found {} device(s)", cams.len());
    }

    /// A FAILURE'S REASON IS ITS OWN, through the real command (2026-09-21, audit-fix row 27):
    /// eight commands failing at once, on eight threads, each with its own bogus camera id, and
    /// each error must carry ITS id. The Swift side records a message and this side reads it in a
    /// second call; with nothing between the two, a thread could read the message another thread's
    /// failure had just written — or the "no detail" left after another thread consumed its own.
    /// Real Swift, no device: a bogus id is refused before any camera is touched. This exercises
    /// the production path with free-running threads, so it is not a check of either guard (see
    /// `SWIFT`); the test after it forces the interleaving.
    #[test]
    fn concurrent_failures_each_get_their_own_reason() {
        let _state = native_state();
        let threads: Vec<_> = (0..8)
            .map(|i| {
                std::thread::spawn(move || {
                    let id = format!("no-such-camera-{i}");
                    let e = open_camera_named(Some(&id)).expect_err("a bogus id must fail");
                    (id, e)
                })
            })
            .collect();
        for t in threads {
            let (id, e) = t.join().unwrap();
            assert!(
                e.contains(&id),
                "the error for {id} carried another call's reason: {e}"
            );
            assert!(
                !e.contains("no detail"),
                "the reason was consumed by another call: {e}"
            );
        }
    }

    /// THE CONTRACT, WITH THE RACE FORCED (2026-09-21, audit-fix row 27). Thread A fails a call
    /// and, still inside its `swift` step, waits 200 ms before reading the reason; thread B fails
    /// its own call the moment A signals. Each must read its own reason. Against a process-wide
    /// slot with no lock, B's call overwrites the message during A's wait and B's read consumes
    /// it, so A reads "no detail". Two guards now stand in the way — `SWIFT` here, the per-thread
    /// slot in FFI.swift — and either alone passes this (measured with `SWIFT` removed), so it
    /// pins the contract rather than one guard. The step is written out here rather than taken
    /// from `open_camera_named` because the wait has to sit BETWEEN the call and the narration,
    /// where no command has a seam.
    #[test]
    fn a_failure_is_narrated_before_another_call_can_overwrite_it() {
        let _state = native_state();
        let (started_tx, started_rx) = std::sync::mpsc::channel::<()>();
        let a = std::thread::spawn(move || {
            let id = std::ffi::CString::new("no-such-camera-A").unwrap();
            swift(|| {
                // SAFETY: valid C string that outlives the call.
                let rc = unsafe { cube_vision_open_camera(id.as_ptr()) };
                let _ = started_tx.send(());
                std::thread::sleep(Duration::from_millis(200));
                ffi_failure("open_camera", rc)
            })
        });
        started_rx.recv().expect("A made its call");
        let b = std::thread::spawn(|| {
            let id = std::ffi::CString::new("no-such-camera-B").unwrap();
            swift(|| {
                // SAFETY: valid C string that outlives the call.
                let rc = unsafe { cube_vision_open_camera(id.as_ptr()) };
                ffi_failure("open_camera", rc)
            })
        });
        let (a, b) = (a.join().unwrap(), b.join().unwrap());
        assert!(
            a.contains("no-such-camera-A"),
            "A's reason was overwritten or consumed by B's call: {a}"
        );
        assert!(b.contains("no-such-camera-B"), "B's reason: {b}");
    }

    /// The Swift side's error channel round-trips: a call that fails leaves a message this side can
    /// fetch, and fetching consumes it. Opening a camera by an id that cannot exist is the cheapest
    /// deterministic failure — no permission prompt, no device.
    #[test]
    fn a_failing_call_leaves_its_reason_where_ffi_failure_finds_it() {
        let _state = native_state();
        let bogus = std::ffi::CString::new("no-such-camera-id").unwrap();
        // SAFETY: valid C string that outlives the call.
        let rc = unsafe { cube_vision_open_camera(bogus.as_ptr()) };
        assert!(rc < 0, "a bogus id must fail");
        let msg = last_error();
        assert!(
            msg.contains("no-such-camera-id"),
            "the detail names the id: {msg}"
        );
        assert!(
            last_error().contains("no detail"),
            "the message is consumed by the first read"
        );
    }
}
