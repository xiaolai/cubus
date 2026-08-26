// Cubus desktop backend.
//
// Deliberately thin. The app is `apps/web` in a native window: the solver, the scanner and the
// renderer all run in the webview, and there is nothing the browser build cannot do that this
// needs Rust for. It exists so the tutor can be an application a child opens rather than a tab
// somebody has to find again, and so it works with no network at all.
//
// It used to own native Bluetooth, bridging a GAN cube's notifications into the webview. That went
// with the rest of the smart-cube support; see the `v0` branch if it is ever wanted back.
//
// The one native capability it now carries is `cube-vision` — native camera capture and CoreML
// inference — and that is the single deliberate exception AGENTS.md sanctioned on 2026-08-26. Its
// commands are not a second app: each sits behind the `Detector` seam the browser build implements
// too (`WebDetector`), so the desktop and web builds stay the same app in behaviour while the
// desktop one gets the ANE and cameras the webview cannot reach. On non-Apple targets the plugin is
// inert and the app runs `WebDetector`, exactly as the accepted platform table says.

// `mobile_entry_point` is the symbol the generated iOS/Android wrappers call. It is a no-op on
// desktop (the `cfg_attr(mobile, …)` expands to nothing), so it costs the desktop build nothing while
// making the same `run()` the entry point when Phase 3 wires up the iOS and Android shells. The
// `cube-vision` plugin is Apple-only today, so on iOS it runs the same CoreML core as macOS; the
// Android backend (LiteRT/CameraX) is the remaining device-gated work.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(cube_vision::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
