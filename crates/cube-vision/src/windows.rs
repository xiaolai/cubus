//! Native capture and inference for Windows: Media Foundation for frames, onnxruntime with the
//! DirectML execution provider for the model.
//!
//! Same seven commands as the Apple plugin, same wire format, same `probe` gate — the panel's
//! `Detector` seam does not know which of them answered. What differs is only the runtime, which is
//! the platform's own fastest path: DirectML runs the model on whatever D3D12 device is present,
//! discrete or integrated, without a vendor-specific dependency.
//!
//! WHAT THIS HAS TO BEAT, and it is no longer the number the accepted plan was written against.
//! Windows' WebView2 is Chromium, so since 2026-09-02 the fallback `WebDetector` is not the 198 ms
//! threaded-wasm path — it is WebGPU, and WebGPU is confirmed WORKING on Windows: a real hardware
//! adapter and a correct compute result on Edge/WebView2 152, measured. What is NOT measured is how
//! fast it is there — the 15 ms figure quoted around this repo is a macOS number, and no Windows
//! timing exists for either path. So DirectML has something real to beat, of unknown size, and
//! `probe` is what decides. The honest reading of a passing build here is "the native path
//! exists", not "the native path is better".
//!
//! The browser path is also not available on every Windows machine. On a laptop with hybrid
//! graphics, Chromium's GPU process was measured dying at startup, leaving no WebGPU adapter at
//! ANY power preference — high-performance and low-power both — though the machine has two working
//! GPUs and one is driving the panel. On hardware like that this plugin would be the only
//! accelerated path rather than a faster one. That is an argument for it existing. It is still not
//! a measurement of it.
//!
//! THE LETTERBOX IS THE CORRECTNESS PROBLEM, exactly as it is on Android. Everything downstream of
//! `next_detection` is one TypeScript implementation calibrated against one preprocessing:
//! `preprocess()` in `packages/cube-scanner/src/onnx-detect.ts` — long side to 640, bilinear at
//! PIXEL CENTRES, centre-pad grey 114, normalise, CHW, RGB. It is reproduced here line for line.
//! `ml/golden_frames.py` proves the .onnx agrees with the other runtimes; it does not prove this
//! code feeds it the same pixels, so that is what a device check has to look at first.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};

use base64::Engine as _;
use nokhwa::pixel_format::RgbFormat;
use nokhwa::utils::{CameraIndex, RequestedFormat, RequestedFormatType};
use nokhwa::Camera;
use ort::ep::{DirectML, CPU};
use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::Tensor;
use serde::Serialize;
use tauri::ipc::Response;
use tauri::State;

/// Ultralytics letterbox pad colour (grey 114), normalised — the same constant as the TS.
const PAD: f32 = 114.0 / 255.0;
const IMG: usize = 640;

#[derive(Serialize)]
struct CameraInfo {
    #[serde(rename = "deviceId")]
    device_id: String,
    label: String,
}

/// The camera runs on its OWN THREAD and nothing else ever touches it.
///
/// `nokhwa::Camera` wraps a Media Foundation COM object and is not `Send`, while Tauri state must
/// be `Send + Sync` — so it cannot be held here at all. Rather than fight that with unsafe, the
/// thread owns the camera and publishes the newest LETTERBOXED frame into `latest`. That is also
/// the right shape regardless: the scan wants the most recent frame, not a queue of stale ones,
/// and doing the letterbox on the capture thread keeps it off the one answering commands. It is
/// the same arrangement the Android plugin arrived at, for the same reason.
#[derive(Default)]
pub struct CubeVision {
    latest: Arc<Mutex<Option<Vec<f32>>>>,
    running: Arc<AtomicBool>,
    stop: Mutex<Option<mpsc::Sender<()>>>,
    session: Mutex<Option<Session>>,
    opened: Mutex<Option<CameraInfo>>,
}

/// Encode a raw detect tensor for the bridge: `int32 rows, int32 anchors` (little-endian) then the
/// floats. Byte-identical to the Apple plugin's, because `decodeTensorResponse` reads one format.
fn tensor_response(rows: i32, anchors: i32, data: &[f32]) -> Response {
    let mut out = Vec::with_capacity(8 + data.len() * 4);
    out.extend_from_slice(&rows.max(0).to_le_bytes());
    out.extend_from_slice(&anchors.max(0).to_le_bytes());
    for &v in data {
        out.extend_from_slice(&v.to_le_bytes());
    }
    Response::new(out)
}

/// The model, beside the executable. Shipped by the bundler's `resources`, not embedded, so a
/// re-export does not mean a rebuild.
fn model_path() -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    for candidate in ["cube-yolo.onnx", "resources/cube-yolo.onnx"] {
        let p = dir.join(candidate);
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

#[tauri::command]
fn probe() -> bool {
    // True only when the work can actually be done. A build that answers true and then fails per
    // frame is worse than one that answers false, because `pickDetector`'s fallback — which on this
    // platform is a WebGPU path that works — is silently skipped.
    model_path().is_some()
}

#[tauri::command]
fn list_cameras() -> Result<Vec<CameraInfo>, String> {
    let devices = nokhwa::query(nokhwa::utils::ApiBackend::MediaFoundation)
        .map_err(|e| format!("could not enumerate cameras: {e}"))?;
    Ok(devices
        .into_iter()
        .map(|d| CameraInfo {
            device_id: d.index().to_string(),
            label: d.human_name(),
        })
        .collect())
}

#[tauri::command]
fn current_camera(state: State<'_, CubeVision>) -> Result<Option<CameraInfo>, String> {
    let opened = state.opened.lock().map_err(|_| "camera state poisoned")?;
    Ok(opened.as_ref().map(|c| CameraInfo {
        device_id: c.device_id.clone(),
        label: c.label.clone(),
    }))
}

#[tauri::command]
fn open_camera(state: State<'_, CubeVision>, device_id: Option<String>) -> Result<(), String> {
    let index = match device_id.as_deref() {
        Some(id) => CameraIndex::Index(
            id.parse::<u32>()
                .map_err(|_| format!("bad camera id {id}"))?,
        ),
        None => CameraIndex::Index(0),
    };
    stop_capture(&state);
    let (label_tx, label_rx) = mpsc::channel::<Result<String, String>>();
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let latest = Arc::clone(&state.latest);
    let running = Arc::clone(&state.running);
    running.store(true, Ordering::SeqCst);
    let idx = index.clone();

    std::thread::spawn(move || {
        let format =
            RequestedFormat::new::<RgbFormat>(RequestedFormatType::AbsoluteHighestFrameRate);
        let mut cam = match Camera::new(idx, format) {
            Ok(c) => c,
            Err(e) => {
                let _ = label_tx.send(Err(format!("could not open the camera: {e}")));
                return;
            }
        };
        if let Err(e) = cam.open_stream() {
            let _ = label_tx.send(Err(format!("could not start the camera: {e}")));
            return;
        }
        let _ = label_tx.send(Ok(cam.info().human_name()));
        while running.load(Ordering::SeqCst) && stop_rx.try_recv().is_err() {
            let Ok(frame) = cam.frame() else { continue };
            let Ok(decoded) = frame.decode_image::<RgbFormat>() else {
                continue;
            };
            let (w, h) = (decoded.width() as usize, decoded.height() as usize);
            let prepared = letterbox(decoded.as_raw(), w, h);
            if let Ok(mut slot) = latest.lock() {
                *slot = Some(prepared);
            }
        }
        let _ = cam.stop_stream();
    });

    // Wait for the thread to say whether the camera opened, so a failure is this command's error
    // rather than a scan that quietly never produces a frame.
    let label = label_rx
        .recv_timeout(std::time::Duration::from_secs(10))
        .map_err(|_| "the camera did not answer within 10s".to_string())??;
    *state.stop.lock().map_err(|_| "camera state poisoned")? = Some(stop_tx);
    *state.opened.lock().map_err(|_| "camera state poisoned")? = Some(CameraInfo {
        device_id: index.to_string(),
        label,
    });
    Ok(())
}

/// Stop the capture thread. Split out so `open_camera` can reuse it without going through the
/// command wrapper — reopening must not leave the previous thread holding the device.
fn stop_capture(state: &CubeVision) {
    state.running.store(false, Ordering::SeqCst);
    if let Ok(mut slot) = state.stop.lock() {
        if let Some(tx) = slot.take() {
            let _ = tx.send(());
        }
    }
    if let Ok(mut slot) = state.opened.lock() {
        *slot = None;
    }
    if let Ok(mut slot) = state.latest.lock() {
        *slot = None;
    }
}

#[tauri::command]
fn close_camera(state: State<'_, CubeVision>) -> Result<(), String> {
    stop_capture(&state);
    Ok(())
}

#[tauri::command]
fn load_model(state: State<'_, CubeVision>) -> Result<(), String> {
    if state
        .session
        .lock()
        .map_err(|_| "model state poisoned")?
        .is_some()
    {
        return Ok(());
    }
    let path = model_path().ok_or("cube-yolo.onnx is not beside the executable")?;
    // DirectML FIRST, CPU second, and the order is the whole point: onnxruntime walks the list, so
    // a machine without a D3D12 device still gets a working scanner rather than a failure. Falling
    // back is not a silent downgrade here — `probe` has already committed us to the native path, so
    // the alternative to a CPU session is no scanner at all.
    // Not one chain: `commit_from_file` takes `&mut self`, so the builder has to be a binding.
    let mut builder = Session::builder()
        .map_err(|e| format!("onnxruntime unavailable: {e}"))?
        .with_execution_providers([DirectML::default().build(), CPU::default().build()])
        .map_err(|e| format!("could not set execution providers: {e}"))?
        .with_optimization_level(GraphOptimizationLevel::Level3)
        .map_err(|e| format!("could not set optimisation level: {e}"))?;
    let session = builder
        .commit_from_file(&path)
        .map_err(|e| format!("could not load {}: {e}", path.display()))?;
    *state.session.lock().map_err(|_| "model state poisoned")? = Some(session);
    Ok(())
}

/// `preprocess()` from src/onnx-detect.ts, reproduced exactly. See the module note.
fn letterbox(rgb: &[u8], w: usize, h: usize) -> Vec<f32> {
    let scale = IMG as f32 / w.max(h) as f32;
    let new_w = ((w as f32 * scale).round() as usize).max(1);
    let new_h = ((h as f32 * scale).round() as usize).max(1);
    let pad_x = (IMG - new_w) / 2;
    let pad_y = (IMG - new_h) / 2;
    let area = IMG * IMG;
    let mut out = vec![PAD; 3 * area];
    let at = |x: usize, y: usize, c: usize| -> f32 { rgb[(y * w + x) * 3 + c] as f32 };

    for y in 0..new_h {
        // The `+ 0.5 … - 0.5` is the half-pixel convention the model was calibrated against, not
        // decoration: dropping it shifts every box by half a pixel at 640 and more after the scale
        // back, which reads as a model that got worse.
        let sy = (((y as f32 + 0.5) / scale) - 0.5).clamp(0.0, h as f32 - 1.0);
        let y0 = sy.floor() as usize;
        let y1 = (y0 + 1).min(h - 1);
        let fy = sy - y0 as f32;
        let oy = y + pad_y;
        for x in 0..new_w {
            let sx = (((x as f32 + 0.5) / scale) - 0.5).clamp(0.0, w as f32 - 1.0);
            let x0 = sx.floor() as usize;
            let x1 = (x0 + 1).min(w - 1);
            let fx = sx - x0 as f32;
            let o = oy * IMG + (x + pad_x);
            for c in 0..3 {
                let top = at(x0, y0, c) + (at(x1, y0, c) - at(x0, y0, c)) * fx;
                let bot = at(x0, y1, c) + (at(x1, y1, c) - at(x0, y1, c)) * fx;
                out[c * area + o] = (top + (bot - top) * fy) / 255.0;
            }
        }
    }
    out
}

#[tauri::command]
fn next_detection(state: State<'_, CubeVision>) -> Result<Response, String> {
    // Whatever the capture thread published last. Cloned rather than held, so inference never
    // keeps the lock the camera thread needs to publish the next frame.
    let input = {
        let slot = state.latest.lock().map_err(|_| "camera state poisoned")?;
        match slot.as_ref() {
            Some(frame) => frame.clone(),
            // Opened but no frame yet. An empty tensor is what `decodeTensorResponse` reads as
            // null, which the panel already handles as "try again next tick" — an error here
            // would look like a broken scanner during warm-up.
            None => return Ok(tensor_response(0, 0, &[])),
        }
    };

    let mut sess_guard = state.session.lock().map_err(|_| "model state poisoned")?;
    let session = sess_guard.as_mut().ok_or("model not loaded")?;
    let tensor = Tensor::from_array(([1usize, 3, IMG, IMG], input))
        .map_err(|e| format!("could not build the input tensor: {e}"))?;
    let outputs = session
        .run(ort::inputs!["images" => tensor])
        .map_err(|e| format!("inference failed: {e}"))?;
    let (shape, data) = outputs[0]
        .try_extract_tensor::<f32>()
        .map_err(|e| format!("could not read the output tensor: {e}"))?;
    // [1, rows, anchors] — the same layout every other runtime returns, and what
    // `decodeDetections` parses.
    let rows = *shape.get(1).unwrap_or(&0) as i32;
    let anchors = *shape.get(2).unwrap_or(&0) as i32;
    Ok(tensor_response(rows, anchors, data))
}

/// Run one frame the caller already has. The parity harness's door: it hands pixels in and compares
/// the tensor against the other runtimes, which is how a letterbox drift is caught by a test rather
/// than by a scan that has quietly become worse.
#[tauri::command]
fn infer_frame(
    state: State<'_, CubeVision>,
    rgb_base64: String,
    width: usize,
    height: usize,
) -> Result<Response, String> {
    let rgb = base64::engine::general_purpose::STANDARD
        .decode(rgb_base64.as_bytes())
        .map_err(|e| format!("rgb_base64 is not base64: {e}"))?;
    if rgb.len() != width * height * 3 {
        return Err(format!(
            "rgb is {} bytes, expected {} for {width}x{height} RGB",
            rgb.len(),
            width * height * 3
        ));
    }
    let input = letterbox(&rgb, width, height);
    let mut sess_guard = state.session.lock().map_err(|_| "model state poisoned")?;
    let session = sess_guard.as_mut().ok_or("model not loaded")?;
    let tensor = Tensor::from_array(([1usize, 3, IMG, IMG], input))
        .map_err(|e| format!("could not build the input tensor: {e}"))?;
    let outputs = session
        .run(ort::inputs!["images" => tensor])
        .map_err(|e| format!("inference failed: {e}"))?;
    let (shape, data) = outputs[0]
        .try_extract_tensor::<f32>()
        .map_err(|e| format!("could not read the output tensor: {e}"))?;
    let rows = *shape.get(1).unwrap_or(&0) as i32;
    let anchors = *shape.get(2).unwrap_or(&0) as i32;
    Ok(tensor_response(rows, anchors, data))
}

pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
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
            use tauri::Manager as _;
            app.manage(CubeVision::default());
            Ok(())
        })
        .build()
}
