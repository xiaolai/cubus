//! `cube-vision` — native camera capture + native model inference, as a Tauri plugin.
//!
//! The FIRST of the seams AGENTS.md sanctioned — native capture and inference, accepted 2026-08-26.
//! (It is not the only one now: the shell has since grown BLE, the window's orientation, external
//! links and the optimal solver, each accepted on its own terms and listed there. It was written
//! when it was the only one, and said so.)
//!
//! Every command here sits behind the `Detector` seam the browser build also implements
//! (`WebDetector`), so the native and web builds stay the same app in behaviour while the native
//! one gets accelerators and cameras the webview cannot reach. The RGBA frame never crosses the
//! bridge — only the ~170 KB output tensor does (see the IPC round-trip spike).
//!
//! THE PLATFORM MATRIX, which is no longer "Apple, and nothing else":
//!
//! | Target        | Frames                | Model                    | Where it lives      |
//! |---------------|-----------------------|--------------------------|---------------------|
//! | macOS / iOS   | AVFoundation          | CoreML (`.mlpackage`)    | `apple.rs` + Swift  |
//! | Windows       | Media Foundation      | onnxruntime + DirectML   | `windows.rs`        |
//! | Android       | CameraX               | LiteRT (`.tflite`)       | Kotlin, see below   |
//! | everything else | —                   | —                        | inert plugin below  |
//!
//! On the last row the plugin registers no commands, so the shell still builds and the app runs
//! `WebDetector` — which since 2026-09-02 is WebGPU wherever the webview has an adapter, and is
//! also what the other three fall back to when their `probe` answers false.
//!
//! Only Apple's path is verified on hardware. Android's is gated by `verifiedOnDevice` in
//! `VisionPlugin.kt` and Windows' by whether its model resolves; neither has captured a frame.

#[cfg(any(target_os = "macos", target_os = "ios"))]
mod apple;

#[cfg(target_os = "windows")]
mod windows;

/// The ONE `infer_frame` wire shape (`rgba_base64`, `width: usize`, `height: usize`) and every
/// check that must run before a frame reaches an FFI or a letterbox. Shared by the Apple and
/// Windows arms, and compiled under test everywhere so the checks are exercised on any host.
#[cfg(any(target_os = "macos", target_os = "ios", target_os = "windows", test))]
mod frame;

/// A capture thread with a bounded join — Windows' reopen safety, tested on every host.
#[cfg(any(target_os = "windows", test))]
mod worker;

#[cfg(any(target_os = "macos", target_os = "ios"))]
pub use apple::init;

/// Android: the same commands, answered by Kotlin.
///
/// `gen/android/.../VisionPlugin.kt` does capture with CameraX and inference with TFLite on the
/// `.tflite` that `ml/export.py` writes from the same checkpoint as the `.onnx` and `.mlpackage`,
/// and that `ml/golden_frames.py` cross-checks against both. Registering it here is all Rust has
/// to do — the commands cross straight from the webview to Kotlin, so no tensor passes through
/// this crate on that platform.
///
/// `probe` still decides. It answers true only when the model asset is actually openable, so a
/// build that shipped without it falls back to `WebDetector` rather than failing per frame.
#[cfg(target_os = "android")]
pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("cube-vision")
        .setup(|_app, api| {
            api.register_android_plugin("im.cubus.app", "VisionPlugin")?;
            Ok(())
        })
        .build()
}

/// Windows: Media Foundation for frames, onnxruntime + DirectML for the model. See `windows.rs`
/// for what it has to beat, which since WebGPU landed is no longer the number the plan assumed.
#[cfg(target_os = "windows")]
pub use windows::init;

/// The plugin on the remaining targets: present, named, and empty. The webview probes for a command
/// and, finding none, falls back to `WebDetector` — the same fallback Windows and Linux use by
/// design, and since 2026-09-02 that fallback is WebGPU where the WebView has one.
#[cfg(not(any(
    target_os = "macos",
    target_os = "ios",
    target_os = "android",
    target_os = "windows"
)))]
pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("cube-vision").build()
}
