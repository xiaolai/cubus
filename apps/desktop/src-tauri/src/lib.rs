// Cubus desktop backend.
//
// Deliberately thin. The app is `apps/web` in a native window: the solver, the scanner and the
// renderer all run in the webview, and there is nothing the browser build cannot do that this
// needs Rust for. It exists so the tutor can be an application a child opens rather than a tab
// somebody has to find again, and so it works with no network at all.
//
// It used to own native Bluetooth, bridging a GAN cube's notifications into the webview. That went
// with the rest of the smart-cube support; see the `v0` branch if it is ever wanted back. Nothing
// replaced it, which is why there are no commands here — a `#[tauri::command]` would mean the web
// build and the desktop build had stopped being the same app.

pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
