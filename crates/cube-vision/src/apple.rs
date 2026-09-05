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
//! `tauri_plugin_log` captures) and returned to the webview as the command's error.
//!
//! EVERY COMMAND THAT TOUCHES THE SWIFT STATE IS `(async)`. A plain `#[tauri::command]` runs on
//! the main thread, and these hold the Swift `stateLock` around work that is anything but quick:
//! `MLModel.compileModel` plus a warm inference in `load_model`, `startRunning()` in `open_camera`
//! (which on iOS also waits for the permission prompt), and one CoreML run per `next_detection`
//! tick. On the main thread that is the UI frozen for the duration, on the one screen whose job
//! is to stay live while the camera comes up; `windows.rs` documents and avoids the same trap. The
//! Swift lock serialises them, so moving them off the main thread changes nothing about ordering.

use std::os::raw::c_char;
use std::path::PathBuf;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::ipc::Response;
use tauri::path::BaseDirectory;
use tauri::plugin::TauriPlugin;
use tauri::{AppHandle, Manager, Runtime, State};

use crate::frame;

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
    fn cube_vision_next_detection(
        out: *mut f32,
        cap: i32,
        rows: *mut i32,
        anchors: *mut i32,
    ) -> i32;
}

/// `cube_vision_next_detection`'s "camera open, no frame has arrived" answer.
const NO_FRAME_YET: i32 = 0;

/// How long an open camera may deliver nothing before `next_detection` says so. A capture session
/// that starts delivers its first frame within a few hundred milliseconds; one that never will —
/// a device that went away, a Continuity Camera that dropped, a session AVFoundation interrupted
/// for another app — used to answer `0,0` forever, which `decodeTensorResponse` reads as "try
/// again next tick", so the scanner waited on it with nothing said. The Windows arm records a
/// capture error to report in the same spot; here the Swift side has no error to record (no
/// frame is not a failure to it), so the clock is the signal.
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
}

/// Encode a raw detect tensor for the bridge: `int32 rows, int32 anchors` (little-endian) then the
/// `rows*anchors` f32 values. The TS side reads the header, then a `Float32Array` over the rest —
/// the same shape `decodeDetections` parses. A header of `0, 0` means "no frame yet" (the caller
/// treats it as null and tries again), so an idle tick costs 8 bytes, not an error.
fn tensor_response(count: i32, rows: i32, anchors: i32, data: &[f32]) -> Response {
    // Clamp to the buffer as well as to zero. The Swift side never reports more than the cap it was
    // given (= data.len()), so this only ever guards against a future contract break — but it does so
    // by shipping a short tensor the TS side rejects, not by panicking the whole process.
    let n = (count.max(0) as usize).min(data.len());
    let mut out = Vec::with_capacity(8 + n * 4);
    out.extend_from_slice(&rows.max(0).to_le_bytes());
    out.extend_from_slice(&anchors.max(0).to_le_bytes());
    for &v in &data[..n] {
        out.extend_from_slice(&v.to_le_bytes());
    }
    Response::new(out)
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
    let json = take_string(unsafe { cube_vision_list_cameras() })
        .ok_or_else(|| "list_cameras returned null".to_string())?;
    serde_json::from_str(&json).map_err(|e| format!("bad camera list: {e}"))
}

#[tauri::command]
fn current_camera() -> Result<Option<CameraInfo>, String> {
    // SAFETY: null (no camera open) or a heap C string we own; `take_string` frees it.
    match take_string(unsafe { cube_vision_current_camera() }) {
        None => Ok(None),
        Some(json) => serde_json::from_str(&json)
            .map(Some)
            .map_err(|e| format!("bad current camera: {e}")),
    }
}

/// The bundled model, relative to the app's Resource dir (see tauri.conf.json bundle.resources).
const MODEL_RESOURCE: &str = "models/cube-yolo.mlpackage";

/// The committed source model, path baked in at compile time. Used only as the dev fallback.
fn source_model_path() -> PathBuf {
    PathBuf::from(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../ml/models/cube-yolo.mlpackage"
    ))
}

/// Find the CoreML model. The webview no longer passes a path (it cannot reliably resolve one — the
/// JS `path` API may be absent or unpermitted, and that silently dropped the whole app to the wasm
/// runtime): resolution is the plugin's job.
///
/// Two tiers, in order: the bundled Resource dir (a shipped app), then the committed source tree
/// (`tauri dev`, which does NOT stage `bundle.resources`, so the resource dir is empty there). The
/// resource dir is tried FIRST so a shipped app never uses the source path — which is the build
/// machine's and would not exist on a user's disk.
fn resolve_model_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    if let Ok(p) = app.path().resolve(MODEL_RESOURCE, BaseDirectory::Resource) {
        if p.exists() {
            return Ok(p);
        }
    }
    let dev = source_model_path();
    if dev.exists() {
        return Ok(dev);
    }
    Err(format!(
        "cube-yolo.mlpackage not found — not in the app Resource dir, and not at {} (run ml/export.py)",
        dev.display()
    ))
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
    // SAFETY: `c` outlives the call; the Swift side copies the path.
    let len = unsafe { cube_vision_load(c.as_ptr(), compute_units) };
    if len <= 0 {
        return Err(ffi_failure(
            &format!("model load for {}", path.display()),
            len,
        ));
    }
    state.out_len.store(len, Ordering::SeqCst);
    Ok(len)
}

/// `(async)`: `startRunning()` blocks until the capture session is live, and on first use the
/// camera-permission prompt sits in front of it.
#[tauri::command(async)]
fn open_camera(state: State<'_, CubeVision>, device_id: Option<String>) -> Result<(), String> {
    let c = device_id
        .map(std::ffi::CString::new)
        .transpose()
        .map_err(|e| e.to_string())?;
    let ptr = c.as_ref().map_or(std::ptr::null(), |s| s.as_ptr());
    // SAFETY: `c` (and thus `ptr`) outlives the call.
    let rc = unsafe { cube_vision_open_camera(ptr) };
    if rc != 0 {
        return Err(ffi_failure("open_camera", rc));
    }
    // A fresh session gets a fresh clock: frames from the previous camera do not count for this one.
    *state
        .waiting_since
        .lock()
        .map_err(|_| "camera state poisoned")? = None;
    Ok(())
}

/// `(async)`: takes the Swift state lock, which a running inference may hold for a few ms.
#[tauri::command(async)]
fn close_camera() {
    // SAFETY: idempotent on the Swift side; safe to call with no camera open.
    unsafe { cube_vision_close_camera() };
}

/// `(async)`: one CoreML run per tick, the single most expensive thing this plugin does.
#[tauri::command(async)]
fn next_detection(state: State<'_, CubeVision>) -> Result<Response, String> {
    let len = state.out_len.load(Ordering::SeqCst);
    if len <= 0 {
        return Err("model not loaded".into());
    }
    let mut buf = vec![0f32; len as usize];
    let (mut rows, mut anchors) = (0i32, 0i32);
    // SAFETY: `buf` has `len` elements, matching the `cap` we pass; rows/anchors are valid out-params.
    let n = unsafe { cube_vision_next_detection(buf.as_mut_ptr(), len, &mut rows, &mut anchors) };
    if n < 0 {
        return Err(ffi_failure("next_detection", n));
    }
    let mut waiting = state
        .waiting_since
        .lock()
        .map_err(|_| "camera state poisoned")?;
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
        return Ok(tensor_response(0, 0, 0, &[]));
    }
    *waiting = None;
    Ok(tensor_response(n, rows, anchors, &buf))
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
    // SAFETY: rgba is exactly w*h*4 bytes (checked by prepare_still); buf has `len` elements
    // matching `cap`; rows/anchors are valid out-params.
    let n = unsafe {
        cube_vision_infer_rgba(
            rgba.as_ptr(),
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
    Ok(tensor_response(n, rows, anchors, &buf))
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
                unsafe { cube_vision_close_camera() };
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
        let len = load_source_model(0);
        let (w, h) = (64i32, 48i32);
        let rgba = vec![128u8; (w * h * 4) as usize];
        let mut buf = vec![0f32; len as usize];
        let (mut rows, mut anchors) = (0i32, 0i32);
        // SAFETY: rgba is w*h*4 bytes; buf has `len` elements matching the cap.
        let n = unsafe {
            cube_vision_infer_rgba(
                rgba.as_ptr(),
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
        assert_eq!(anchors, 8400, "YOLO11 at 640 has 8400 anchors");
    }

    /// The park-and-reuse contract: the scan panel is re-mounted per screen and asks its detector
    /// to load every time, so a repeat `cube_vision_load` for the SAME path and units must not
    /// recompile (seconds, on the main thread's watch). The compile counter is the Swift side's own
    /// count of `MLModel.compileModel` calls — a second load that recompiled would move it, which
    /// is exactly what happened before the short-circuit existed.
    #[test]
    fn load_is_free_for_the_same_model_and_units() {
        let first = load_source_model(0);
        // SAFETY: a plain counter read, no arguments, no ownership.
        let compiled = unsafe { cube_vision_compile_count() };
        let again = load_source_model(0);
        assert_eq!(
            again, first,
            "the cached model answers the same output size"
        );
        assert_eq!(
            unsafe { cube_vision_compile_count() },
            compiled,
            "a repeat load of the same model and units must not compile again"
        );
        // Different compute units ARE a different model configuration and must rebuild.
        let _ = load_source_model(1);
        assert_eq!(
            unsafe { cube_vision_compile_count() },
            compiled + 1,
            "changing compute units must compile a new model"
        );
    }

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

    /// The Swift side's error channel round-trips: a call that fails leaves a message this side can
    /// fetch, and fetching consumes it. Opening a camera by an id that cannot exist is the cheapest
    /// deterministic failure — no permission prompt, no device.
    #[test]
    fn a_failing_call_leaves_its_reason_where_ffi_failure_finds_it() {
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
