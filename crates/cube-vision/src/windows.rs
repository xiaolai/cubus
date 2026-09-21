//! Native capture and inference for Windows: Media Foundation for frames, onnxruntime with the
//! DirectML execution provider for the model.
//!
//! The same eight commands as the Apple plugin, the same wire format and the same `probe` gate — the
//! panel's `Detector` seam does not know which of them answered. The wire is version 2 through
//! `crate::wire` since 2026-09-21 (audit-fix row 96): this arm had stayed on version 1, which
//! carries no picture size, so the scan screen could not place a sticker in the picture on Windows.
//! What differs is only the runtime, which is the platform's own fastest path: DirectML runs the
//! model on whatever D3D12 device is present, discrete or integrated, without a vendor-specific
//! dependency.
//!
//! EVERY COMMAND THAT TOUCHES A DEVICE, THE RUNTIME OR THE MODEL IS `(async)`. Tauri runs a plain
//! command on the main thread, which here is the thread that draws the scan screen. `open_camera`,
//! `close_camera`, `load_model` and `next_detection` said so from the start; `probe` (the first
//! `Session::builder()` loads onnxruntime's DLL) and `list_cameras` (a Media Foundation
//! enumeration) were plain until 2026-09-20 (audit, 2.14). `current_camera` reads the lifecycle's
//! lock, which is never held across a wait (`crate::lifecycle` hands a retired thread back to be
//! joined OUTSIDE it), and stays plain.
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
//! `preprocess()` in `packages/cube-scanner/src/letterbox.ts`. It is reproduced in `crate::letterbox`
//! and held to the TypeScript's own numbers on every host; `ml/golden_frames.py` proves the .onnx
//! agrees with the other runtimes, and a device check on Windows is still what has to look first.
//!
//! WHAT IS TESTED WHERE (2026-09-21). This file's own tests run only on the Windows CI job, because
//! nokhwa and ort are Windows-only dependencies — so everything that could be lifted off the
//! platform was: the session arbitration (`crate::lifecycle`), the letterbox (`crate::letterbox`),
//! the choice of capture format (`crate::format_policy`), the wire (`crate::wire`) and the model
//! lookup (`crate::model_path`) are tested on every host. What stays here is the glue to Media
//! Foundation and onnxruntime, and `infer_frame` driven end to end on the committed model.

use std::path::PathBuf;
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use nokhwa::pixel_format::RgbFormat;
use nokhwa::utils::{
    color_frame_formats, CameraFormat, CameraIndex, RequestedFormat, RequestedFormatType,
};
use nokhwa::Camera;
use ort::ep::{DirectML, CPU};
use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::Tensor;
use serde::Serialize;
use tauri::ipc::Response;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager, Runtime, State};

use crate::format_policy::{self, Candidate};
use crate::frame;
use crate::letterbox::{letterbox, IMG};
use crate::lifecycle::CaptureLifecycle;
use crate::model_path;
use crate::wire;
use crate::worker::{settle_open, CaptureWorker, Joined};

/// Consecutive capture failures after which the last good frame stops being served. See
/// [note_capture_failure].
const STALE_AFTER_FAILURES: u32 = 30;
const RETRY_BACKOFF_MS: u64 = 20;
/// How long a reopen or close waits for the previous capture thread to release the device. A
/// worker blocked in `cam.frame()` leaves within one frame interval; one blocked inside a
/// ten-second `Camera::new` may not, and is then left to notice the generation change on its own
/// rather than freezing the command that replaced it.
const WORKER_JOIN_TIMEOUT: Duration = Duration::from_secs(3);
/// How long `open_camera` waits for its worker to say whether the camera opened. Media Foundation
/// can sit inside device activation for seconds on a camera another process holds.
const OPEN_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone, Serialize)]
struct CameraInfo {
    #[serde(rename = "deviceId")]
    device_id: String,
    label: String,
}

/// A frame as the capture thread publishes it: letterboxed for the model, and the size of the
/// picture it came from, which the wire carries so the page can place each sticker (`crate::wire`).
struct Prepared {
    chw: Vec<f32>,
    picture: [i32; 2],
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
    latest: Arc<Mutex<Option<Prepared>>>,
    /// Why the last frame did not arrive, if it did not. See the capture loop.
    capture_error: Arc<Mutex<Option<String>>>,
    /// Which capture session is current, the thread that owns the device, and the camera the app
    /// believes is open — ONE lock, so a claim, an install, a conditional retirement and the
    /// `opened` commit are each one step (`crate::lifecycle`, 2026-09-21, audit-fix rows 35–37, 39).
    lifecycle: CaptureLifecycle<CameraInfo>,
    session: Mutex<Option<Session>>,
}

/// The bundled model, relative to the app's Resource dir (see tauri.windows.conf.json resources).
const MODEL_RESOURCE: &str = "models/cubedet.onnx";

/// The committed source model, path baked in at compile time. Used only as the dev fallback.
fn source_model_path() -> PathBuf {
    PathBuf::from(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../ml/models/cubedet.onnx"
    ))
}

/// Find the ONNX model, by the SAME two tiers the Apple arm uses — the rule is `crate::model_path`'s,
/// one implementation for both since 2026-09-21 (audit-fix row 31): the app's Resource dir first
/// (a shipped app), then the committed source tree (`tauri dev`, which does not stage
/// `bundle.resources`, so the resource dir is empty there).
///
/// This used to walk out from `std::env::current_exe()` looking for `cubedet.onnx` beside the
/// binary, and `tauri.windows.conf.json` declared no `resources` at all — so the file was never
/// placed anywhere the search looked, `probe` answered false in EVERY build, and this entire
/// module was unreachable code that compiled. That is the shape of failure the repo has a rule
/// about: a gate nothing runs is not a gate, and a path that is never taken looks exactly like a
/// path that works. The second implementation of a solved problem was the wrong one.
fn resolve_model_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    model_path::resolve(
        app.path()
            .resolve(MODEL_RESOURCE, BaseDirectory::Resource)
            .ok(),
        source_model_path(),
        "cubedet.onnx",
    )
}

/// `(async)` since 2026-09-20 (audit, 2.14): the first `Session::builder()` of the process loads
/// onnxruntime's DLL and initialises the runtime, which is disk and dynamic-linker work — on the
/// main thread that is a stall on the first paint of the scan screen, the exact moment `probe` is
/// asked. Same reasoning as `open_camera`, smaller price.
#[tauri::command(async)]
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
            // not load", and only one of those is worth anybody's time to investigate. Through the
            // `log` facade, not stderr: a Start-menu launch has no stderr, and only the facade
            // reaches the log file `tauri_plugin_log` keeps.
            log::warn!("cube-vision: onnxruntime is unavailable, falling back to WebDetector: {e}");
            false
        }
    }
}

/// `(async)` since 2026-09-20 (audit, 2.14): enumerating Media Foundation activates every capture
/// source on the machine to read its name, which is device I/O with no bound this code controls.
/// The camera menu asks for this on the scan screen, which is the screen that must keep drawing.
#[tauri::command(async)]
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

/// Plain on purpose: the lifecycle's lock is held only for the few assignments a transition makes,
/// never across a join, so this is a lookup and not a wait.
#[tauri::command]
fn current_camera(state: State<'_, CubeVision>) -> Result<Option<CameraInfo>, String> {
    Ok(state.lifecycle.opened())
}

/// `(async)` because Tauri runs a plain command on the MAIN thread, and this one waits up to
/// `OPEN_TIMEOUT` for a camera to answer — and, when it does not, up to `WORKER_JOIN_TIMEOUT` more
/// for the thread to leave. On the main thread that is many seconds of frozen UI on the screen
/// whose entire job is to stay responsive while the camera comes up.
#[tauri::command(async)]
fn open_camera(state: State<'_, CubeVision>, device_id: Option<String>) -> Result<(), String> {
    let index = match device_id.as_deref() {
        Some(id) => CameraIndex::Index(
            id.parse::<u32>()
                .map_err(|_| format!("bad camera id {id}"))?,
        ),
        None => CameraIndex::Index(0),
    };
    // Retires whatever was running and claims the next session — one step under the lifecycle's
    // lock — then forgets what the retired session published and WAITS for its thread to leave, so
    // the device below is free. Everything the new worker does is conditioned on `token` still
    // being the current session.
    let (token, previous) = state.lifecycle.claim();
    forget_frames(&state);
    join_retired(previous);
    let (label_tx, label_rx) = mpsc::channel::<Result<String, String>>();
    let latest = Arc::clone(&state.latest);
    let capture_error = Arc::clone(&state.capture_error);
    let idx = index.clone();
    let session = token.clone();

    let worker = CaptureWorker::spawn(move || {
        // OPENED ON ANY COLOUR FORMAT, THEN SET TO THE ONE THE SCAN WANTS (2026-09-20, audit
        // 2.15). This asked for `AbsoluteHighestFrameRate`, which nokhwa resolves as "the highest
        // frame rate on offer, then the highest resolution AT that rate" (`RequestedFormat::
        // fulfill`, nokhwa-core-0.1.9/src/types.rs:101-114) — so a camera whose top rate exists
        // only at 640x480 or below was opened there, and the letterbox then UPSCALED it to 640.
        //
        // None of nokhwa's one-shot requests says "nearest to 720p, whatever you have":
        // `Closest(CameraFormat)` keeps only the formats whose `FrameFormat` equals the one named
        // (nokhwa-core-0.1.9/src/types.rs:155-162), so it refuses a camera that has YUY2 and no
        // MJPEG, or the reverse; `HighestResolution(Resolution)` keeps only an EXACT size match
        // (nokhwa-core-0.1.9/src/types.rs:115-130 — its doc comment describes an older signature),
        // so it refuses any camera without 1280x720 itself. Either would turn a camera that opened
        // under the old request into "could not open".
        //
        // So the device is opened on `None` — the first format the `RgbFormat` decoder can read
        // (nokhwa-core-0.1.9/src/types.rs:198-201), which resolves exactly when the old request
        // did — and its own list is then read and `pick_format` chooses. Nothing is captured at the
        // interim format: the stream is opened only after the format is set, and the bindings'
        // `set_format` re-reads the media type it set, so the decoder sees the chosen one.
        let any_colour = RequestedFormat::new::<RgbFormat>(RequestedFormatType::None);
        let mut cam = match Camera::new(idx, any_colour) {
            Ok(c) => c,
            Err(e) => {
                let _ = label_tx.send(Err(format!("could not open the camera: {e}")));
                return;
            }
        };
        // RETIRED WHILE INSIDE THE DEVICE CALL? Checked after EVERY blocking device operation, the
        // last of them directly before the stream is opened (2026-09-21, audit-fix row 34). A
        // worker whose session was closed or replaced while it sat inside `Camera::new` — ten
        // seconds on a camera another process holds — used to go on to negotiate a format and
        // light the camera, contending with the session that had replaced it; its first check was
        // after `open_stream`. Now it drops the device and leaves, and the answer says why to
        // whoever is still listening.
        if let Err(why) = session.ensure_current() {
            let _ = label_tx.send(Err(why));
            return;
        }
        let offered = match cam.compatible_camera_formats() {
            Ok(list) => list,
            Err(e) => {
                let _ = label_tx.send(Err(format!("could not list the camera's formats: {e}")));
                return;
            }
        };
        if let Err(why) = session.ensure_current() {
            let _ = label_tx.send(Err(why));
            return;
        }
        let Some(wanted) = pick_format(&offered) else {
            let _ = label_tx.send(Err("the camera offers no colour format".to_string()));
            return;
        };
        // `Exact` through the request door (`set_camera_format` is deprecated in nokhwa 0.10):
        // `fulfill` accepts an `Exact` whenever the decoder reads its `FrameFormat`
        // (nokhwa-core-0.1.9/src/types.rs:147-153), which `pick_format` has already guaranteed,
        // and the camera then gets the format it listed itself.
        let exact = RequestedFormat::new::<RgbFormat>(RequestedFormatType::Exact(wanted));
        let got = match cam.set_camera_requset(exact) {
            Ok(set) => set,
            Err(e) => {
                let _ = label_tx.send(Err(format!(
                    "could not set the camera to {}x{} {} at {} fps: {e}",
                    wanted.width(),
                    wanted.height(),
                    wanted.format(),
                    wanted.frame_rate()
                )));
                return;
            }
        };
        // What the camera agreed to, for the log: no Windows timing exists for this path yet,
        // and the frame it runs on is the first thing a measurement needs to know.
        log::info!(
            "cube-vision: capturing at {}x{} {} at {} fps",
            got.width(),
            got.height(),
            got.format(),
            got.frame_rate()
        );
        // The check directly before the camera is lit: a stale worker never activates the device.
        if let Err(why) = session.ensure_current() {
            let _ = label_tx.send(Err(why));
            return;
        }
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
        while session.current() {
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
            // The size the wire carries, and the check that the frame HAS one: a zero side is a
            // failure to count, not a frame to letterbox (`h - 1` would underflow), and a side past
            // `i32` is one the wire cannot carry.
            let picture = match (
                i32::try_from(decoded.width()),
                i32::try_from(decoded.height()),
            ) {
                (Ok(w), Ok(h)) if w > 0 && h > 0 => [w, h],
                _ => {
                    note_capture_failure(
                        &capture_error,
                        &latest,
                        &mut consecutive_failures,
                        format!(
                            "the camera produced a {}x{} frame",
                            decoded.width(),
                            decoded.height()
                        ),
                    );
                    continue;
                }
            };
            let chw = letterbox(decoded.as_raw(), picture[0] as usize, picture[1] as usize);
            // Published only while the session is still ours, and the check is made UNDER the
            // publish lock: a close bumps the generation and THEN clears `latest`, so a frame
            // letterboxed across the close can never land after the clear and hand the next
            // session a previous camera's pixels.
            if let Ok(mut slot) = latest.lock() {
                if !session.current() {
                    break;
                }
                *slot = Some(Prepared { chw, picture });
            }
            if let Ok(mut slot) = capture_error.lock() {
                *slot = None;
            }
            // Reset AFTER the frame is published, not after it is decoded (2026-09-21, audit-fix
            // row 97): a camera whose every decoded frame was 0×N reset the counter before the
            // size check refused it, so `STALE_AFTER_FAILURES` was never reached and the last good
            // frame was served forever.
            consecutive_failures = 0;
        }
        let _ = cam.stop_stream();
    });
    // Installed only if the session is still ours — one step with that check, under the
    // lifecycle's lock (audit-fix row 35). Refused when a close or another open superseded this
    // one while the thread was being spawned: the worker exits on its first generation check, and
    // it is joined here rather than parked over the live session's thread.
    if let Err(stale) = state.lifecycle.install(&token, worker) {
        join_retired(Some(stale));
        return Err("the camera was closed before it finished opening".into());
    }

    // Wait for the thread to say whether the camera opened, so a failure is this command's error
    // rather than a scan that quietly never produces a frame. `settle_open` (crate::worker) reads
    // the answer: a timed-out open is retired before the error goes back — this used to leave the
    // generation alone, so a camera that answered at 11 s published frames with the lens on and
    // no owner (audit 2026-09-20, 2.8) — and a worker that died before answering is reported as
    // dead rather than as slow.
    let label = settle_open(label_rx.recv_timeout(OPEN_TIMEOUT), OPEN_TIMEOUT, || {
        // ONLY IF THIS ATTEMPT IS STILL THE CURRENT SESSION (audit-fix row 36): the retirement used
        // to be the global stop, so an attempt that timed out after a newer open had replaced it
        // closed the newer camera. A superseded attempt retires nothing.
        if let Some(retired) = state.lifecycle.retire_if_current(&token) {
            forget_frames(&state);
            join_retired(retired);
        }
    })?;
    // Committed atomically with the currency check (audit-fix row 37): the check and the write
    // were two steps, and a close between them wrote a camera back that was not running, which
    // `current_camera` then reported until the next open.
    let opened = CameraInfo {
        device_id: index.to_string(),
        label,
    };
    if !state.lifecycle.commit_opened(&token, opened) {
        return Err("the camera was closed before it finished opening".into());
    }
    Ok(())
}

/// The format to capture at, from what the camera offers: `crate::format_policy`'s choice — the
/// colour format nearest to the browser's ideal, and at that size the highest frame rate, ties
/// keeping the camera's own order — over nokhwa's formats. Colour only: `RgbFormat` decodes
/// `color_frame_formats()` and nothing else, so a GRAY-only camera is refused here instead of
/// failing on its first frame. The policy is tested on every host; the mapping onto nokhwa's
/// `CameraFormat` is `mod tests`', run by the Windows CI job.
fn pick_format(offered: &[CameraFormat]) -> Option<CameraFormat> {
    let colour = color_frame_formats();
    let candidates: Vec<Candidate> = offered
        .iter()
        .map(|f| Candidate {
            width: f.width(),
            height: f.height(),
            colour: colour.contains(&f.format()),
            frame_rate: f.frame_rate(),
        })
        .collect();
    format_policy::pick_nearest(&candidates).map(|i| offered[i])
}

/// Retire the current capture session — whichever it is — forget what it published, and wait for
/// its thread to release the device.
///
/// The JOIN is the half this used to lack. Bumping the generation tells the worker to stop; it
/// does not wait for it, so a reopen spawned its new thread while the old one still held Media
/// Foundation's device — and `Camera::new` on the new thread then failed against a camera nobody
/// else was using. `open_camera` does the same three steps itself, keeping the claimed session.
fn stop_capture(state: &CubeVision) {
    let (_next, previous) = state.lifecycle.claim();
    forget_frames(state);
    join_retired(previous);
}

/// Forget the retired session's last frame and its last failure — AFTER its generation was
/// bumped, which every caller has just done. The worker checks the generation under the `latest`
/// lock before it publishes, so nothing of the retired session can land after this.
fn forget_frames(state: &CubeVision) {
    if let Ok(mut slot) = state.latest.lock() {
        *slot = None;
    }
    if let Ok(mut slot) = state.capture_error.lock() {
        *slot = None;
    }
}

/// Wait, bounded, for a retired worker to release the device. Bounded (`WORKER_JOIN_TIMEOUT`),
/// and a timeout is logged rather than fatal: the straggler re-checks the generation after every
/// device call and before it publishes anything, so the worst it can do is hold the device a
/// little longer, which the next open then reports honestly.
fn join_retired(worker: Option<CaptureWorker>) {
    if let Some(worker) = worker {
        if worker.join_within(WORKER_JOIN_TIMEOUT) == Joined::TimedOut {
            log::warn!(
                "cube-vision: the previous capture thread did not release the camera within {:?}; \
                 the next open may find the device busy",
                WORKER_JOIN_TIMEOUT
            );
        }
    }
}

/// Record why a frame did not arrive, and stop serving stale pixels once it is clearly not a blip.
///
/// Failures used to be discarded by `let Ok(..) else { continue }`, which did two things at once:
/// it span the loop as fast as the CPU allowed on a camera that failed immediately, and — after
/// one good frame — it left `latest` populated, so inference kept re-reading the same picture and
/// the scanner looked like it was working on a cube that was no longer in front of it.
fn note_capture_failure(
    capture_error: &Mutex<Option<String>>,
    latest: &Mutex<Option<Prepared>>,
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

/// `(async)` because closing now WAITS for the capture thread (up to `WORKER_JOIN_TIMEOUT`), and a
/// plain command runs on the main thread — a frozen UI is the wrong price for a clean release.
#[tauri::command(async)]
fn close_camera(state: State<'_, CubeVision>) -> Result<(), String> {
    stop_capture(&state);
    Ok(())
}

/// `(async)` for the same reason as `open_camera`: building an ORT session compiles the graph and
/// initialises DirectML, which is not work for the thread that has to keep drawing.
#[tauri::command(async)]
fn load_model<R: Runtime>(app: AppHandle<R>, state: State<'_, CubeVision>) -> Result<(), String> {
    // HELD FROM THE CHECK TO THE STORE (2026-09-21, audit-fix row 98). This checked the slot,
    // released it, built a session for seconds and then stored — so two loads in flight together
    // (the scan panel re-mounting while its first load still ran) each built a DirectML session,
    // and the second replaced the first. Holding the slot makes the second caller wait and find
    // the session built; a `next_detection` that arrives mid-load waits on the same lock rather
    // than answering "model not loaded" for a model that is seconds from ready.
    let mut slot = state.session.lock().map_err(|_| "model state poisoned")?;
    if slot.is_some() {
        return Ok(());
    }
    let path = resolve_model_path(&app)?;
    // DirectML FIRST, CPU second — but as two ATTEMPTS, not one provider list. onnxruntime walks a
    // list silently: a DirectML registration that fails (no D3D12 device, or `DirectML.dll` not
    // beside the executable, which is exactly what an unbundled build looks like) falls through to
    // CPU with nothing said, and the scanner then runs ~30x slower while every log reads as if the
    // GPU path were live. `error_on_failure` makes the first attempt refuse instead, so the
    // fallback is a decision this function makes out loud and the provider a session got is a fact
    // it can log. Falling back is still right — `probe` has already committed us to the native
    // path, so the alternative to a CPU session is no scanner at all.
    let session = match build_session(&path, Some(DirectML::default().build().error_on_failure())) {
        Ok(session) => {
            log::info!(
                "cube-vision: model loaded on DirectML from {}",
                path.display()
            );
            session
        }
        Err(e) => {
            log::warn!(
                "cube-vision: DirectML is not available ({e}); the model runs on the CPU. If \
                 DirectML.dll is not beside the executable this is the missing-bundle case, not a \
                 missing GPU."
            );
            let session = build_session(&path, None)?;
            log::info!("cube-vision: model loaded on CPU from {}", path.display());
            session
        }
    };
    *slot = Some(session);
    Ok(())
}

/// One session builder, with or without an accelerator in front of the CPU provider.
fn build_session(
    path: &std::path::Path,
    accelerator: Option<ort::ep::ExecutionProviderDispatch>,
) -> Result<Session, String> {
    let providers: Vec<ort::ep::ExecutionProviderDispatch> = accelerator
        .into_iter()
        .chain(std::iter::once(CPU::default().build()))
        .collect();
    // Not one chain: `commit_from_file` takes `&mut self`, so the builder has to be a binding.
    let mut builder = Session::builder()
        .map_err(|e| format!("onnxruntime unavailable: {e}"))?
        .with_execution_providers(providers)
        .map_err(|e| format!("could not set execution providers: {e}"))?
        .with_optimization_level(GraphOptimizationLevel::Level3)
        .map_err(|e| format!("could not set optimisation level: {e}"))?;
    builder
        .commit_from_file(path)
        .map_err(|e| format!("could not load {}: {e}", path.display()))
}

/// One inference, from letterboxed pixels to the wire bytes.
///
/// The ONE place tensor construction, the session call, output extraction and encoding live.
/// `next_detection` and `infer_frame` had a copy each — identical but for where the pixels came
/// from — so a change to the model contract could reach the camera path and miss the parity
/// harness, which is precisely the path whose job is to notice such changes. `picture` is the
/// size of the camera picture `input` was letterboxed from, which the wire carries.
fn run_inference(
    state: &CubeVision,
    input: Vec<f32>,
    picture: [i32; 2],
) -> Result<Vec<u8>, String> {
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
    // The wire's words are `i32`; a shape past that is refused here with the number, and
    // `crate::wire` re-checks the count against the shape before a byte is written.
    let count = i32::try_from(data.len()).map_err(|_| {
        format!(
            "the model output of {} floats exceeds the wire's Int32",
            data.len()
        )
    })?;
    let rows = i32::try_from(rows).map_err(|_| format!("a tensor with {rows} rows"))?;
    let anchors = i32::try_from(anchors).map_err(|_| format!("a tensor with {anchors} anchors"))?;
    wire::frame_bytes(count, rows, anchors, picture, data)
}

/// `(async)`: one inference is the single most expensive thing this plugin does per tick.
#[tauri::command(async)]
fn next_detection(state: State<'_, CubeVision>) -> Result<Response, String> {
    // Whatever the capture thread published last. Cloned rather than held, so inference never
    // keeps the lock the camera thread needs to publish the next frame.
    let (input, picture) = {
        let slot = state.latest.lock().map_err(|_| "camera state poisoned")?;
        match slot.as_ref() {
            Some(frame) => (frame.chw.clone(), frame.picture),
            None => {
                // A RECORDED failure is reported. Without this, a camera that cannot produce a
                // usable frame is indistinguishable from one that has not produced its first yet,
                // and the scanner waits on it forever with nothing said.
                if let Ok(why) = state.capture_error.lock() {
                    if let Some(why) = why.as_ref() {
                        return Err(format!("the camera frame could not be prepared: {why}"));
                    }
                }
                // Opened but no frame yet. The idle header is what `decodeTensorResponse` reads as
                // null, which the panel already handles as "try again next tick" — an error here
                // would look like a broken scanner during warm-up.
                return Ok(Response::new(wire::no_frame()));
            }
        }
    };
    run_inference(&state, input, picture).map(Response::new)
}

/// Run one frame the caller already has. The parity harness's door: it hands pixels in and compares
/// the tensor against the other runtimes, which is how a letterbox drift is caught by a test rather
/// than by a scan that has quietly become worse.
///
/// The wire shape is `crate::frame`'s — `rgba_base64` plus `usize` dimensions, the same on every
/// platform — and every check (positive dimensions, `checked_mul`, exact length) happens there
/// before a byte is indexed. The alpha channel is dropped here because this letterbox reads RGB
/// triples; the camera thread decodes straight to RGB and never pays that pass.
#[tauri::command(async)]
fn infer_frame(
    state: State<'_, CubeVision>,
    rgba_base64: String,
    width: usize,
    height: usize,
) -> Result<Response, String> {
    infer_bytes(&state, &rgba_base64, width, height).map(Response::new)
}

/// `infer_frame` without the IPC wrapper, so the Windows CI job can drive the command end to end on
/// the committed model (`mod tests`, 2026-09-21, audit-fix row 99).
fn infer_bytes(
    state: &CubeVision,
    rgba_base64: &str,
    width: usize,
    height: usize,
) -> Result<Vec<u8>, String> {
    let rgba = frame::decode_rgba(rgba_base64, width, height)?;
    let rgb = frame::strip_alpha(&rgba);
    let picture = [
        i32::try_from(width).map_err(|_| format!("width {width} exceeds the wire's Int32"))?,
        i32::try_from(height).map_err(|_| format!("height {height} exceeds the wire's Int32"))?,
    ];
    run_inference(state, letterbox(&rgb, width, height), picture)
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

    /// Zero dimensions and an oversized pair are rejected before anything indexes the buffer.
    /// `letterbox` itself is only ever reached through `frame::decode_rgba`'s validation or the
    /// capture loop's, both of which reject these; `frame.rs` carries the tests for the former.
    #[test]
    fn a_degenerate_frame_is_refused_rather_than_indexed() {
        assert!(frame::rgba_len(0, 480).is_err(), "h - 1 would underflow");
        assert!(
            frame::rgba_len(usize::MAX / 2, 4).is_err(),
            "the product would wrap"
        );
    }

    // The dev tier of `resolve_model_path`, which is the one a developer actually hits: `tauri dev`
    // does not stage `bundle.resources`, so the Resource dir is empty and this path is the only
    // thing standing between a working native scanner and a silent fall back to WebDetector.
    //
    // The SHIPPED tier is asserted from the other side, in `apps/web/test/shipped-model.test.mjs`,
    // which reads `MODEL_RESOURCE` out of this file and checks `tauri.windows.conf.json` stages
    // something to it. Between them the two tiers are both covered; neither could be checked here
    // alone, because resolving a Resource dir needs a running app.
    #[test]
    fn the_dev_model_path_points_at_the_committed_source_model() {
        let p = source_model_path();
        assert!(
            p.exists(),
            "source cubedet.onnx missing at {} — run ml/export.py",
            p.display()
        );
    }

    /// THE PARITY HARNESS'S DOOR, DRIVEN (2026-09-21, audit-fix row 99). `infer_frame` is exposed
    /// through the ACL and documented as the harness's entry, and nothing in the repository called
    /// it — so model loading, inference, output extraction and the wire encoding through this
    /// command had never once run. This runs them on the committed model, on the CPU provider (a
    /// CI runner promises no D3D12 device), and holds the answer's SHAPE: the detect head's rows
    /// and anchors, the picture the tensor came from, and the byte length the wire promises. The
    /// VALUES against the other runtimes remain `ml/golden_frames.py`'s, whose onnx leg runs this
    /// same graph through onnxruntime; a Windows leg there is owed with the platform's first device
    /// check.
    #[test]
    fn infer_frame_runs_the_committed_model_end_to_end() {
        use base64::Engine as _;
        let state = CubeVision::default();
        let session = build_session(&source_model_path(), None)
            .expect("the committed model builds a CPU session");
        *state.session.lock().unwrap() = Some(session);
        let (w, h) = (97usize, 43usize);
        let rgba = base64::engine::general_purpose::STANDARD.encode(vec![128u8; w * h * 4]);
        let bytes = infer_bytes(&state, &rgba, w, h).expect("the committed model answers a still");
        let word = |i: usize| i32::from_le_bytes(bytes[i * 4..i * 4 + 4].try_into().unwrap());
        assert_eq!(word(0), wire::WIRE_VERSION, "wire version 2");
        assert_eq!(
            (word(1), word(2)),
            (4 + 6, 8400),
            "rows = 4 box coords + 6 colour classes; 8400 anchors at 640"
        );
        assert_eq!(
            (word(3), word(4)),
            (97, 43),
            "the picture the tensor was letterboxed from"
        );
        assert_eq!(bytes.len(), wire::HEADER_BYTES + 10 * 8400 * 4);
    }

    /// The model is loaded by `run_inference` only through the slot `load_model` fills, so a still
    /// before any load is refused, not run against nothing.
    #[test]
    fn a_still_before_the_model_is_loaded_is_refused() {
        use base64::Engine as _;
        let state = CubeVision::default();
        let rgba = base64::engine::general_purpose::STANDARD.encode(vec![0u8; 2 * 2 * 4]);
        let e = infer_bytes(&state, &rgba, 2, 2).unwrap_err();
        assert_eq!(e, "model not loaded");
    }

    use nokhwa::utils::FrameFormat;

    fn offered(w: u32, h: u32, format: FrameFormat, fps: u32) -> CameraFormat {
        CameraFormat::new_from(w, h, format, fps)
    }

    // The mapping from nokhwa's `CameraFormat` onto `crate::format_policy`'s candidates — the
    // policy itself is tested on every host; these hold that a colour format reads as colour, that
    // the chosen index maps back to the format the camera listed, and the audit's own camera.

    /// The audit's camera (2.15): its top rate exists only at 480p. `AbsoluteHighestFrameRate`
    /// took that mode and the letterbox upscaled it; the scan wants 720p, at 720p's best rate.
    #[test]
    fn the_capture_format_is_the_nearest_to_720p_not_the_fastest() {
        let list = [
            offered(640, 480, FrameFormat::YUYV, 60),
            offered(1280, 720, FrameFormat::YUYV, 10),
            offered(1280, 720, FrameFormat::MJPEG, 30),
            offered(1920, 1080, FrameFormat::MJPEG, 30),
        ];
        let got = pick_format(&list).expect("a colour format was offered");
        assert_eq!((got.width(), got.height()), (1280, 720));
        assert_eq!(
            got.frame_rate(),
            30,
            "at the chosen size, the highest rate on offer"
        );
        assert_eq!(got.format(), FrameFormat::MJPEG);
    }

    /// A camera with no 720p mode gets its nearest size — where `Closest(… MJPEG …)` would have
    /// refused a YUY2-only camera outright and `HighestResolution(720p)` any camera without that
    /// exact size (nokhwa-core-0.1.9/src/types.rs:115-130, 155-162).
    #[test]
    fn a_camera_without_720p_gets_its_nearest_size_rather_than_a_refusal() {
        let list = [
            offered(640, 480, FrameFormat::YUYV, 30),
            offered(1600, 1200, FrameFormat::YUYV, 15),
        ];
        let got = pick_format(&list).expect("a colour format was offered");
        // (1600-1280)² + (1200-720)² = 332 800 against (640-1280)² + (480-720)² = 467 200.
        assert_eq!((got.width(), got.height()), (1600, 1200));
    }

    /// Ties keep the camera's order, and a format the decoder cannot read is never chosen.
    #[test]
    fn only_colour_formats_are_considered_and_ties_keep_the_cameras_order() {
        let list = [
            offered(1280, 720, FrameFormat::GRAY, 60),
            offered(1280, 720, FrameFormat::NV12, 30),
            offered(1280, 720, FrameFormat::YUYV, 30),
        ];
        let got = pick_format(&list).expect("a colour format was offered");
        assert_eq!(
            got.format(),
            FrameFormat::NV12,
            "first of the equal candidates"
        );
        assert_eq!(
            pick_format(&[offered(1280, 720, FrameFormat::GRAY, 30)]),
            None,
            "a GRAY-only camera is refused before its first frame, not on it"
        );
    }
}
