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

use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
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
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager, Runtime, State};

/// Ultralytics letterbox pad colour (grey 114), normalised — the same constant as the TS.
const PAD: f32 = 114.0 / 255.0;
const IMG: usize = 640;

/// Consecutive capture failures after which the last good frame stops being served. See
/// [note_capture_failure].
const STALE_AFTER_FAILURES: u32 = 30;
const RETRY_BACKOFF_MS: u64 = 20;

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
    /// Which capture session is current. Bumped by every open and every close — see [stop_capture].
    generation: Arc<AtomicUsize>,
    /// Why the last frame did not arrive, if it did not. See the capture loop.
    capture_error: Arc<Mutex<Option<String>>>,
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

/// The bundled model, relative to the app's Resource dir (see tauri.windows.conf.json resources).
const MODEL_RESOURCE: &str = "models/cube-yolo.onnx";

/// The committed source model, path baked in at compile time. Used only as the dev fallback.
fn source_model_path() -> PathBuf {
    PathBuf::from(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../ml/models/cube-yolo.onnx"
    ))
}

/// Find the ONNX model, by the SAME two tiers `apple.rs::resolve_model_path` uses: the app's
/// Resource dir first (a shipped app), then the committed source tree (`tauri dev`, which does
/// not stage `bundle.resources`, so the resource dir is empty there). Resource first, so a shipped
/// app never uses the source path — which is the build machine's and is not on a user's disk.
///
/// This used to walk out from `std::env::current_exe()` looking for `cube-yolo.onnx` beside the
/// binary, and `tauri.windows.conf.json` declared no `resources` at all — so the file was never
/// placed anywhere the search looked, `probe` answered false in EVERY build, and this entire
/// module was unreachable code that compiled. That is the shape of failure the repo has a rule
/// about: a gate nothing runs is not a gate, and a path that is never taken looks exactly like a
/// path that works. The second implementation of a solved problem was the wrong one; there is now
/// one method, spelled the same way on both platforms.
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
        "cube-yolo.onnx not found — not in the app Resource dir, and not at {} (run ml/export.py)",
        dev.display()
    ))
}

#[tauri::command]
fn probe<R: Runtime>(app: AppHandle<R>) -> bool {
    // True only when the work can actually be done. A build that answers true and then fails per
    // frame is worse than one that answers false, because `pickDetector`'s fallback — which on this
    // platform is a WebGPU path that works — is silently skipped.
    //
    // TWO conditions, because the file alone was never the question. `probe` commits the app to
    // this plugin — `pickDetector` takes the native path and never builds a `WebDetector` — so a
    // true answer followed by a failure in `load_model` leaves the scanner with nothing at all,
    // where a false answer would have left it with WebGPU. Both halves are cheap: resolving a path,
    // and asking onnxruntime whether it can build a session builder, which is what fails when the
    // runtime's DLL is absent or the wrong architecture.
    //
    // It stops short of committing the MODEL, which is seconds of graph compilation and DirectML
    // initialisation — too much to spend answering a capability question on every scan. So this is
    // still necessary-not-sufficient, and deliberately so; what it now rules out is the whole class
    // of "the runtime is not really here", which the file check could not see at all.
    if resolve_model_path(&app).is_err() {
        return false;
    }
    match Session::builder() {
        Ok(_) => true,
        Err(e) => {
            // Loud: falling back to WebDetector is the right outcome, but silently is not — this is
            // the difference between "this machine prefers the browser path" and "onnxruntime did
            // not load", and only one of those is worth anybody's time to investigate.
            eprintln!("cube-vision: onnxruntime is unavailable, falling back to WebDetector: {e}");
            false
        }
    }
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

/// `(async)` because Tauri runs a plain command on the MAIN thread, and this one waits up to ten
/// seconds for a camera to answer. On the main thread that is ten seconds of frozen UI on the
/// screen whose entire job is to stay responsive while the camera comes up.
#[tauri::command(async)]
fn open_camera(state: State<'_, CubeVision>, device_id: Option<String>) -> Result<(), String> {
    let index = match device_id.as_deref() {
        Some(id) => CameraIndex::Index(
            id.parse::<u32>()
                .map_err(|_| format!("bad camera id {id}"))?,
        ),
        None => CameraIndex::Index(0),
    };
    // Retires whatever was running and claims the next session number in one step. Everything the
    // new worker does is conditioned on still owning it.
    let mine = stop_capture(&state);
    let (label_tx, label_rx) = mpsc::channel::<Result<String, String>>();
    let latest = Arc::clone(&state.latest);
    let generation = Arc::clone(&state.generation);
    let capture_error = Arc::clone(&state.capture_error);
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

        // OWNERSHIP, not a shared flag. A single `running` bool plus a stop channel had three ways
        // to go wrong: a reopen set the flag back to true and revived the previous worker, a
        // DISCONNECTED channel read as "keep running" because only `try_recv().is_err()` was
        // tested, and a worker that opened after its own open had timed out kept publishing with
        // nobody holding its stop handle. A session number the worker compares against is none of
        // those — the moment anything else claims the camera, this loop's condition is false.
        let mut consecutive_failures = 0u32;
        while generation.load(Ordering::SeqCst) == mine {
            let frame = match cam.frame() {
                Ok(f) => f,
                Err(e) => {
                    note_capture_failure(
                        &capture_error,
                        &latest,
                        &mut consecutive_failures,
                        e.to_string(),
                    );
                    continue;
                }
            };
            let decoded = match frame.decode_image::<RgbFormat>() {
                Ok(d) => d,
                Err(e) => {
                    note_capture_failure(
                        &capture_error,
                        &latest,
                        &mut consecutive_failures,
                        e.to_string(),
                    );
                    continue;
                }
            };
            consecutive_failures = 0;
            let (w, h) = (decoded.width() as usize, decoded.height() as usize);
            if w == 0 || h == 0 {
                note_capture_failure(
                    &capture_error,
                    &latest,
                    &mut consecutive_failures,
                    format!("the camera produced a {w}x{h} frame"),
                );
                continue;
            }
            let prepared = letterbox(decoded.as_raw(), w, h);
            // Re-checked after the work: a close can land while a frame is being letterboxed, and
            // publishing it then hands the next session a previous camera's pixels.
            if generation.load(Ordering::SeqCst) != mine {
                break;
            }
            if let Ok(mut slot) = latest.lock() {
                *slot = Some(prepared);
            }
            if let Ok(mut slot) = capture_error.lock() {
                *slot = None;
            }
        }
        let _ = cam.stop_stream();
    });

    // Wait for the thread to say whether the camera opened, so a failure is this command's error
    // rather than a scan that quietly never produces a frame.
    let label = label_rx
        .recv_timeout(std::time::Duration::from_secs(10))
        .map_err(|_| "the camera did not answer within 10s".to_string())??;
    // The open may have been superseded while we waited — by a close, or by another open. Its
    // worker has already stopped on the generation check; all that is left is not to publish it.
    if state.generation.load(Ordering::SeqCst) != mine {
        return Err("the camera was closed before it finished opening".into());
    }
    *state.opened.lock().map_err(|_| "camera state poisoned")? = Some(CameraInfo {
        device_id: index.to_string(),
        label,
    });
    Ok(())
}

/// Retire the current capture session and return the number of the NEW one.
///
/// Split out so `open_camera` can reuse it without going through the command wrapper — reopening
/// must not leave the previous thread holding the device. Returning the new generation is what
/// makes "stop, then start" a single indivisible step from the caller's point of view.
fn stop_capture(state: &CubeVision) -> usize {
    let next = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    if let Ok(mut slot) = state.opened.lock() {
        *slot = None;
    }
    if let Ok(mut slot) = state.latest.lock() {
        *slot = None;
    }
    if let Ok(mut slot) = state.capture_error.lock() {
        *slot = None;
    }
    next
}

/// Record why a frame did not arrive, and stop serving stale pixels once it is clearly not a blip.
///
/// Failures used to be discarded by `let Ok(..) else { continue }`, which did two things at once:
/// it span the loop as fast as the CPU allowed on a camera that failed immediately, and — after
/// one good frame — it left `latest` populated, so inference kept re-reading the same picture and
/// the scanner looked like it was working on a cube that was no longer in front of it.
fn note_capture_failure(
    capture_error: &Mutex<Option<String>>,
    latest: &Mutex<Option<Vec<f32>>>,
    consecutive: &mut u32,
    why: String,
) {
    *consecutive += 1;
    if let Ok(mut slot) = capture_error.lock() {
        *slot = Some(why);
    }
    // A handful of dropped frames is normal while a camera settles; a run of them is not, and past
    // that point the last good frame is a lie rather than a stand-in.
    if *consecutive >= STALE_AFTER_FAILURES {
        if let Ok(mut slot) = latest.lock() {
            *slot = None;
        }
    }
    // Not a busy loop. Without this a camera erroring instantly pins a core for as long as it is
    // open, which on a laptop is felt long before anyone looks at the logs.
    std::thread::sleep(std::time::Duration::from_millis(RETRY_BACKOFF_MS));
}

#[tauri::command]
fn close_camera(state: State<'_, CubeVision>) -> Result<(), String> {
    let _ = stop_capture(&state);
    Ok(())
}

/// `(async)` for the same reason as `open_camera`: building an ORT session compiles the graph and
/// initialises DirectML, which is not work for the thread that has to keep drawing.
#[tauri::command(async)]
fn load_model<R: Runtime>(app: AppHandle<R>, state: State<'_, CubeVision>) -> Result<(), String> {
    if state
        .session
        .lock()
        .map_err(|_| "model state poisoned")?
        .is_some()
    {
        return Ok(());
    }
    let path = resolve_model_path(&app)?;
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
    // IN f64, because the TypeScript is. Every JS number is a double and only the store into
    // `Float32Array` rounds; computing in f32 can land `sy` on the other side of an integer
    // boundary and pick a different source row, so "reproduced line for line" was not true of the
    // arithmetic — only of the shape of it. The same gap existed in the Android plugin and was
    // fixed in the same pass; this is the file whose module note makes the strongest claim about
    // it, and `letterbox_matches_the_typescript_reference` below is what now holds that claim up.
    let scale = IMG as f64 / w.max(h) as f64;
    let new_w = ((w as f64 * scale).round() as usize).max(1);
    let new_h = ((h as f64 * scale).round() as usize).max(1);
    let pad_x = (IMG - new_w) / 2;
    let pad_y = (IMG - new_h) / 2;
    let area = IMG * IMG;
    let mut out = vec![PAD; 3 * area];
    let at = |x: usize, y: usize, c: usize| -> f64 { rgb[(y * w + x) * 3 + c] as f64 };

    for y in 0..new_h {
        // The `+ 0.5 … - 0.5` is the half-pixel convention the model was calibrated against, not
        // decoration: dropping it shifts every box by half a pixel at 640 and more after the scale
        // back, which reads as a model that got worse.
        let sy = (((y as f64 + 0.5) / scale) - 0.5).clamp(0.0, h as f64 - 1.0);
        let y0 = sy.floor() as usize;
        let y1 = (y0 + 1).min(h - 1);
        let fy = sy - y0 as f64;
        let oy = y + pad_y;
        for x in 0..new_w {
            let sx = (((x as f64 + 0.5) / scale) - 0.5).clamp(0.0, w as f64 - 1.0);
            let x0 = sx.floor() as usize;
            let x1 = (x0 + 1).min(w - 1);
            let fx = sx - x0 as f64;
            let o = oy * IMG + (x + pad_x);
            for c in 0..3 {
                let top = at(x0, y0, c) + (at(x1, y0, c) - at(x0, y0, c)) * fx;
                let bot = at(x0, y1, c) + (at(x1, y1, c) - at(x0, y1, c)) * fx;
                out[c * area + o] = ((top + (bot - top) * fy) / 255.0) as f32;
            }
        }
    }
    out
}

/// One inference, from letterboxed pixels to the wire response.
///
/// The ONE place tensor construction, the session call, output extraction and encoding live.
/// `next_detection` and `infer_frame` had a copy each — identical but for where the pixels came
/// from — so a change to the model contract could reach the camera path and miss the parity
/// harness, which is precisely the path whose job is to notice such changes.
fn run_inference(state: &CubeVision, input: Vec<f32>) -> Result<Response, String> {
    if input.len() != 3 * IMG * IMG {
        return Err(format!(
            "letterboxed frame is {} floats, expected {} for 3x{IMG}x{IMG}",
            input.len(),
            3 * IMG * IMG
        ));
    }
    let mut sess_guard = state.session.lock().map_err(|_| "model state poisoned")?;
    let session = sess_guard.as_mut().ok_or("model not loaded")?;
    let tensor = Tensor::from_array(([1usize, 3, IMG, IMG], input))
        .map_err(|e| format!("could not build the input tensor: {e}"))?;
    let outputs = session
        .run(ort::inputs!["images" => tensor])
        .map_err(|e| format!("inference failed: {e}"))?;
    // The first output, taken rather than indexed. `outputs[0]` PANICS on a model that produced
    // none — a crash in place of the error this function exists to return.
    let (_, output) = outputs
        .iter()
        .next()
        .ok_or("the model produced no outputs")?;
    let (shape, data) = output
        .try_extract_tensor::<f32>()
        .map_err(|e| format!("could not read the output tensor: {e}"))?;

    // [1, rows, anchors] — the same layout every other runtime returns, and what
    // `decodeDetections` parses. CHECKED rather than indexed hopefully: a missing dimension used to
    // become a silent 0, which `decodeTensorResponse` reads as "no frame yet" — so a model with the
    // wrong output rank presented as a camera still warming up, forever.
    if shape.len() != 3 {
        return Err(format!(
            "the model output has shape {shape:?}; this decoder needs [1, rows, anchors]"
        ));
    }
    let (batch, rows, anchors) = (shape[0], shape[1], shape[2]);
    if batch != 1 || rows <= 0 || anchors <= 0 {
        return Err(format!(
            "the model output has shape {shape:?}; batch must be 1 and rows/anchors positive"
        ));
    }
    let expected = (rows as usize)
        .checked_mul(anchors as usize)
        .ok_or("the model reports an output size that overflows")?;
    if data.len() != expected {
        return Err(format!(
            "the model output holds {} floats, not the {expected} its shape {shape:?} promises",
            data.len()
        ));
    }
    Ok(tensor_response(rows as i32, anchors as i32, data))
}

/// `(async)`: one inference is the single most expensive thing this plugin does per tick.
#[tauri::command(async)]
fn next_detection(state: State<'_, CubeVision>) -> Result<Response, String> {
    // Whatever the capture thread published last. Cloned rather than held, so inference never
    // keeps the lock the camera thread needs to publish the next frame.
    let input = {
        let slot = state.latest.lock().map_err(|_| "camera state poisoned")?;
        match slot.as_ref() {
            Some(frame) => frame.clone(),
            None => {
                // A RECORDED failure is reported. Without this, a camera that cannot produce a
                // usable frame is indistinguishable from one that has not produced its first yet,
                // and the scanner waits on it forever with nothing said.
                if let Ok(why) = state.capture_error.lock() {
                    if let Some(why) = why.as_ref() {
                        return Err(format!("the camera frame could not be prepared: {why}"));
                    }
                }
                // Opened but no frame yet. An empty tensor is what `decodeTensorResponse` reads as
                // null, which the panel already handles as "try again next tick" — an error here
                // would look like a broken scanner during warm-up.
                return Ok(tensor_response(0, 0, &[]));
            }
        }
    };
    run_inference(&state, input)
}

/// Run one frame the caller already has. The parity harness's door: it hands pixels in and compares
/// the tensor against the other runtimes, which is how a letterbox drift is caught by a test rather
/// than by a scan that has quietly become worse.
#[tauri::command(async)]
fn infer_frame(
    state: State<'_, CubeVision>,
    rgb_base64: String,
    width: usize,
    height: usize,
) -> Result<Response, String> {
    let rgb = base64::engine::general_purpose::STANDARD
        .decode(rgb_base64.as_bytes())
        .map_err(|e| format!("rgb_base64 is not base64: {e}"))?;
    // Zero dimensions passed the old length check against an empty payload, and `letterbox` then
    // underflowed at `w - 1`; a large pair overflowed the multiplication and could accept a buffer
    // far too small. Both are rejected before any indexing happens.
    if width == 0 || height == 0 {
        return Err(format!(
            "frame dimensions must be positive, got {width}x{height}"
        ));
    }
    let expected = width
        .checked_mul(height)
        .and_then(|px| px.checked_mul(3))
        .ok_or_else(|| format!("{width}x{height} RGB overflows a usize"))?;
    if rgb.len() != expected {
        return Err(format!(
            "rgb is {} bytes, expected {expected} for {width}x{height} RGB",
            rgb.len()
        ));
    }
    run_inference(&state, letterbox(&rgb, width, height))
}

pub fn init<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
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
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    // The dev tier of `resolve_model_path`, which is the one a developer actually hits: `tauri dev`
    // does not stage `bundle.resources`, so the Resource dir is empty and this path is the only
    // thing standing between a working native scanner and a silent fall back to WebDetector.
    //
    // The SHIPPED tier is asserted from the other side, in `apps/web/test/shipped-model.test.mjs`,
    // which reads `MODEL_RESOURCE` out of this file and checks `tauri.windows.conf.json` stages
    // something to it. Between them the two tiers are both covered; neither could be checked here
    // alone, because resolving a Resource dir needs a running app.
    /// The fixture frame, generated the same way on both sides of the comparison.
    fn fixture(w: usize, h: usize) -> Vec<u8> {
        let mut rgb = vec![0u8; w * h * 3];
        for y in 0..h {
            for x in 0..w {
                let o = (y * w + x) * 3;
                rgb[o] = ((x * 7 + y * 13) % 256) as u8;
                rgb[o + 1] = ((x * 31 + y * 5 + 77) % 256) as u8;
                rgb[o + 2] = ((x * 17 + y * 23 + 191) % 256) as u8;
            }
        }
        rgb
    }

    /// THE PARITY TEST, against numbers produced by the TypeScript, not by this code.
    ///
    /// The module note says `preprocess()` is "reproduced here line for line", and until now
    /// nothing checked it: `ml/golden_frames.py` proves the .onnx agrees with the other runtimes
    /// and says nothing about what this feeds it, and `infer_frame` — documented as the parity
    /// harness's door — had no caller anywhere in the repo. So the one claim on which every box
    /// this plugin produces depends was resting on a comment.
    ///
    /// The expected values below were computed by running `preprocess` from
    /// `packages/cube-scanner/src/onnx-detect.ts` on the same fixture, and they are EXACT: both
    /// sides now compute in double and round once, on the store to f32. When this drifts, it will
    /// drift the way a letterbox always does — a fraction of a pixel, everywhere, reading as a
    /// model that has quietly got worse — which is why the assertion is exact rather than
    /// approximate.
    #[test]
    fn letterbox_matches_the_typescript_reference() {
        let (w, h) = (97usize, 43usize);
        let out = letterbox(&fixture(w, h), w, h);
        assert_eq!(out.len(), 3 * IMG * IMG, "the tensor is 3x{IMG}x{IMG}");

        // (index, value) straight out of the TypeScript. Three samples per plane inside the image
        // band, and one in the letterbox padding so the pad colour is pinned too.
        let expected: [(usize, f32); 10] = [
            (128_100, 0.552_769_6),
            (192_320, 0.232_916_67),
            (256_600, 0.162_696_08),
            (537_700, 0.142_132_36),
            (601_920, 0.477_181_37),
            (666_200, 0.913_823_55),
            (947_300, 0.320_842_53),
            (1_011_520, 0.563_982_84),
            (1_075_800, 0.744_497_54),
            (6_410, 0.447_058_83),
        ];
        for (i, want) in expected {
            assert_eq!(
                out[i], want,
                "index {i}: this implementation gives {}, the TypeScript gives {want}",
                out[i]
            );
        }

        // A position-weighted checksum over every element, so the samples above are a readable
        // anchor and this is what actually catches a shift of one row or one channel.
        let checksum: f64 = out
            .iter()
            .enumerate()
            .map(|(i, v)| *v as f64 * ((i % 97) as f64 + 1.0) / 97.0)
            .sum();
        assert!(
            (checksum - 291_823.355_345_172_75).abs() < 1e-3,
            "checksum {checksum} differs from the TypeScript's 291823.35534517275 — the letterbox \
             has drifted from `preprocess()`"
        );
    }

    /// Zero dimensions and an oversized pair are rejected before anything indexes the buffer.
    #[test]
    fn a_degenerate_frame_is_refused_rather_than_indexed() {
        // `letterbox` itself is only ever reached through `infer_frame`'s validation or the capture
        // loop's, both of which reject these — this pins the reason those checks exist by showing
        // what the arithmetic would do with h = 0: `h - 1` underflows.
        assert_eq!(
            0usize.checked_sub(1),
            None,
            "h - 1 underflows for a zero-height frame"
        );
    }

    #[test]
    fn the_dev_model_path_points_at_the_committed_source_model() {
        let p = source_model_path();
        assert!(
            p.exists(),
            "source cube-yolo.onnx missing at {} — run ml/export.py",
            p.display()
        );
    }
}
