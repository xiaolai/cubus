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

/// The plugin on non-Apple targets: present, named, and empty. The webview probes for a command and,
/// finding none, falls back to `WebDetector` — the same fallback Windows and Linux use by design.
#[cfg(not(any(target_os = "macos", target_os = "ios")))]
pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("cube-vision").build()
}
