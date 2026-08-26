//! The Apple implementation: thin Rust over the Swift C ABI in the CubeVision package.
//!
//! Every function here is a Tauri command the webview's `NativeDetector` calls. The heavy lifting —
//! AVFoundation capture, the byte-exact letterbox, CoreML on the ANE — is Swift; Rust marshals
//! arguments and hands the raw output tensor back as bytes (never JSON on the hot path: the spike
//! measured JSON at 2–3 ms/frame against ≤1 ms for raw bytes).

use std::os::raw::c_char;
use std::path::PathBuf;
use std::sync::atomic::{AtomicI32, Ordering};

use serde::{Deserialize, Serialize};
use tauri::ipc::Response;
use tauri::path::BaseDirectory;
use tauri::plugin::TauriPlugin;
use tauri::{AppHandle, Manager, Runtime, State};

// The C ABI exported by libCubeVision.a (see swift/Sources/CubeVision/FFI.swift). Every call is
// process-global on the Swift side (one model, one camera) — a plugin is a singleton and CoreML load
// is a one-time cost, so a global is the honest shape.
extern "C" {
    fn cube_vision_load(path: *const c_char, compute_units: i32) -> i32;
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

/// Output element count from the last successful `load_model`, so `next_detection` sizes its buffer
/// once. Zero means "no model loaded" — every inference command refuses rather than guessing a size.
#[derive(Default)]
struct CubeVision {
    out_len: AtomicI32,
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

#[tauri::command]
fn probe() -> bool {
    // The webview calls this to decide WebDetector vs NativeDetector. Reaching here at all means the
    // plugin is present and its command surface answers, which is exactly the question.
    true
}

#[tauri::command]
fn list_cameras() -> Result<Vec<CameraInfo>, String> {
    // SAFETY: the Swift side returns a heap C string we own and must free with cube_vision_free_string.
    let ptr = unsafe { cube_vision_list_cameras() };
    if ptr.is_null() {
        return Err("list_cameras returned null".into());
    }
    let json = unsafe { std::ffi::CStr::from_ptr(ptr) }
        .to_string_lossy()
        .into_owned();
    unsafe { cube_vision_free_string(ptr) };
    serde_json::from_str(&json).map_err(|e| format!("bad camera list: {e}"))
}

#[tauri::command]
fn current_camera() -> Result<Option<CameraInfo>, String> {
    // SAFETY: null (no camera open) or a heap C string we own and free.
    let ptr = unsafe { cube_vision_current_camera() };
    if ptr.is_null() {
        return Ok(None);
    }
    let json = unsafe { std::ffi::CStr::from_ptr(ptr) }
        .to_string_lossy()
        .into_owned();
    unsafe { cube_vision_free_string(ptr) };
    serde_json::from_str(&json)
        .map(Some)
        .map_err(|e| format!("bad current camera: {e}"))
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

#[tauri::command]
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
        return Err(format!(
            "model load failed ({len}) for {} — see stderr",
            path.display()
        ));
    }
    state.out_len.store(len, Ordering::SeqCst);
    Ok(len)
}

#[tauri::command]
fn open_camera(device_id: Option<String>) -> Result<(), String> {
    let c = device_id
        .map(std::ffi::CString::new)
        .transpose()
        .map_err(|e| e.to_string())?;
    let ptr = c.as_ref().map_or(std::ptr::null(), |s| s.as_ptr());
    // SAFETY: `c` (and thus `ptr`) outlives the call.
    let rc = unsafe { cube_vision_open_camera(ptr) };
    if rc != 0 {
        return Err(format!("open_camera failed ({rc}) — see stderr"));
    }
    Ok(())
}

#[tauri::command]
fn close_camera() {
    // SAFETY: idempotent on the Swift side; safe to call with no camera open.
    unsafe { cube_vision_close_camera() };
}

#[tauri::command]
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
        return Err(format!("next_detection failed ({n}) — see stderr"));
    }
    Ok(tensor_response(n, rows, anchors, &buf))
}

/// Inject a still RGBA frame and get its tensor back — the golden-frame harness's path across the
/// bridge, and the way a test proves the plugin's real letterbox matches `preprocess()` end to end.
/// Not the production path (that is `next_detection`, which never ships the frame).
#[tauri::command]
fn infer_frame(
    state: State<'_, CubeVision>,
    rgba: Vec<u8>,
    width: i32,
    height: i32,
) -> Result<Response, String> {
    let len = state.out_len.load(Ordering::SeqCst);
    if len <= 0 {
        return Err("model not loaded".into());
    }
    let expected = (width as usize) * (height as usize) * 4;
    if rgba.len() != expected {
        return Err(format!("rgba is {} bytes, expected {expected}", rgba.len()));
    }
    let mut buf = vec![0f32; len as usize];
    let (mut rows, mut anchors) = (0i32, 0i32);
    // SAFETY: rgba is width*height*4 bytes (checked); buf has `len` elements matching `cap`.
    let n = unsafe {
        cube_vision_infer_rgba(
            rgba.as_ptr(),
            width,
            height,
            buf.as_mut_ptr(),
            len,
            &mut rows,
            &mut anchors,
        )
    };
    if n < 0 {
        return Err(format!("infer_frame failed ({n}) — see stderr"));
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

    #[test]
    fn infer_rgba_returns_a_correctly_shaped_tensor() {
        let model = source_model_path();
        assert!(
            model.is_dir(),
            "committed model missing at {} — run ml/export.py",
            model.display()
        );
        let c = std::ffi::CString::new(model.to_string_lossy().as_ref()).unwrap();
        // SAFETY: valid C path; returns the output element count or <=0 on failure.
        let len = unsafe { cube_vision_load(c.as_ptr(), 0) };
        assert!(len > 0, "cube_vision_load failed: {len}");

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

    // Exercises the AVFoundation discovery path in-process — no camera permission, no capture session,
    // no cube needed. It proves `cube_vision_list_cameras` returns a well-formed, parseable list (the
    // Rust↔Swift string ownership and JSON round-trip), which is the half of the camera path that does
    // not need a person. Opening a device and reading frames is the remaining part, and that one does.
    #[test]
    fn list_cameras_enumerates_without_crashing() {
        // SAFETY: returns null or a heap C string we own and free.
        let ptr = unsafe { cube_vision_list_cameras() };
        assert!(!ptr.is_null(), "list_cameras returned null");
        let json = unsafe { std::ffi::CStr::from_ptr(ptr) }
            .to_string_lossy()
            .into_owned();
        unsafe { cube_vision_free_string(ptr) };
        let cams: Vec<CameraInfo> =
            serde_json::from_str(&json).expect("list_cameras must return a JSON array");
        // Not asserted non-empty: a CI runner or a locked-down machine may expose no video device,
        // and that is a valid answer, not a failure. The point is the path runs and parses.
        eprintln!("list_cameras found {} device(s)", cams.len());
    }
}
