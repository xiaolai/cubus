//! `cube-vision` — native camera capture + CoreML inference, as a Tauri plugin.
//!
//! This is the ONE place the desktop shell grows commands, and it is the deliberate exception
//! AGENTS.md sanctioned on 2026-08-26: every command here sits behind the `Detector` seam the
//! browser build also implements (`WebDetector`), so the desktop and web builds stay the same app in
//! behaviour while the desktop one gets the ANE and cameras the webview cannot reach. The RGBA frame
//! never crosses the bridge — only the ~170 KB output tensor does (see the IPC round-trip spike).
//!
//! The real implementation is Apple-only (CoreML + AVFoundation, in the linked Swift package). On
//! every other target this compiles to an inert plugin that registers no commands, so the shell still
//! builds — and there the app runs `WebDetector`, exactly as the accepted plan's platform table says.

#[cfg(any(target_os = "macos", target_os = "ios"))]
mod apple;

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

/// The plugin on the remaining targets: present, named, and empty. The webview probes for a command
/// and, finding none, falls back to `WebDetector` — the same fallback Windows and Linux use by
/// design, and since 2026-09-02 that fallback is WebGPU where the WebView has one.
#[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "android")))]
pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("cube-vision").build()
}
