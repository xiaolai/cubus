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
// Traffic lights, macOS. `trafficLightPosition` in tauri.conf.json (x:19/y:28 — measured to land
// the lights exactly where Finder's tall toolbar puts its own: 25.75pt centre) is applied by tao
// only from its content view's drawRect — which a webview-covered window rarely receives, so most
// launches left the lights at Apple's default spot. Two workarounds were tried and rejected: a
// 1px resize-and-back applied the inset but let the lights visibly jump into place, and the
// per-navigation native retitle in app.js turned out to be what knocked them loose after launch
// (AppKit rebuilds the titlebar on `setTitle:`; that retitle is now skipped on macOS, where the
// overlay titlebar hides the native title anyway). What remains is the direct fix: place the
// buttons ourselves — the same arithmetic tao's `inset_traffic_lights` uses — synchronously at
// setup, before the first frame is presented, and again on the window events that make AppKit
// rebuild the titlebar. Idempotent, a few Objective-C calls, no resizing, nothing to see.
#[cfg(target_os = "macos")]
fn place_traffic_lights(ns_window_ptr: *mut std::ffi::c_void, x: f64, y: f64) {
    use objc2_app_kit::{NSWindow, NSWindowButton};

    // Safety: both call sites run on the main thread (setup and window-event callbacks), on a
    // live NSWindow pointer tauri hands out for exactly this kind of platform work.
    unsafe {
        let ns_window: &NSWindow = &*ns_window_ptr.cast();
        let (Some(close), Some(miniaturize), Some(zoom)) = (
            ns_window.standardWindowButton(NSWindowButton::CloseButton),
            ns_window.standardWindowButton(NSWindowButton::MiniaturizeButton),
            ns_window.standardWindowButton(NSWindowButton::ZoomButton),
        ) else {
            return;
        };
        let Some(container) = close.superview().and_then(|v| v.superview()) else {
            return;
        };
        // Grow the title-bar container so the buttons can sit `y` below the top edge, then walk
        // the three buttons to `x` at whatever spacing the system drew them with.
        let close_rect = close.frame();
        let bar_height = close_rect.size.height + y;
        let mut bar_rect = container.frame();
        bar_rect.size.height = bar_height;
        bar_rect.origin.y = ns_window.frame().size.height - bar_height;
        container.setFrame(bar_rect);
        let spacing = miniaturize.frame().origin.x - close_rect.origin.x;
        for (i, button) in [&*close, &*miniaturize, &*zoom].into_iter().enumerate() {
            let mut rect = button.frame();
            rect.origin.x = x + (i as f64) * spacing;
            button.setFrameOrigin(rect.origin);
        }
    }
}

/// The window's configured traffic-light inset, straight from tauri.conf.json — the one place
/// the numbers live.
#[cfg(target_os = "macos")]
fn configured_traffic_lights<R: tauri::Runtime, M: tauri::Manager<R>>(
    manager: &M,
    label: &str,
) -> Option<(f64, f64)> {
    manager
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == label)
        .and_then(|w| w.traffic_light_position.as_ref())
        .map(|p| (p.x, p.y))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    if let (Some((x, y)), Ok(ptr)) =
                        (configured_traffic_lights(app, "main"), window.ns_window())
                    {
                        place_traffic_lights(ptr, x, y);
                    }
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(target_os = "macos")]
            {
                use tauri::WindowEvent;
                if matches!(
                    event,
                    WindowEvent::Resized(_)
                        | WindowEvent::Focused(_)
                        | WindowEvent::ThemeChanged(_)
                ) {
                    if let (Some((x, y)), Ok(ptr)) = (
                        configured_traffic_lights(window, window.label()),
                        window.ns_window(),
                    ) {
                        place_traffic_lights(ptr, x, y);
                    }
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (window, event);
        })
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(cube_vision::init())
        // External links only: the About card's anchors call opener.openUrl when this API is
        // injected (withGlobalTauri), because a webview does nothing with target="_blank". The
        // browser build satisfies the same seam with plain anchors.
        .plugin(tauri_plugin_opener::init());

    // Dev-only MCP bridge (AGENTS.md exception, accepted 2026-08-27): a control socket that lets
    // an AI agent drive the app — screenshots, selector clicks, DOM queries, arbitrary JS in the
    // app's origin. Exactly because it is control-everything, it is triple-gated: the `mcp` cargo
    // feature (release builds never compile it — `tauri build` does not pass the feature), a
    // debug_assertions belt on top, and a CUBUS_MCP=1 runtime opt-in so even ordinary dev runs
    // do not listen unless a session asks to. Socket path matches .mcp.json's TAURI_MCP_IPC_PATH.
    #[cfg(all(feature = "mcp", debug_assertions))]
    let builder = if std::env::var_os("CUBUS_MCP").is_some() {
        builder.plugin(tauri_plugin_mcp::init_with_config(
            tauri_plugin_mcp::PluginConfig::new("cubus".to_string())
                .start_socket_server(true)
                .socket_path(std::path::PathBuf::from("/tmp/cubus-mcp.sock")),
        ))
    } else {
        builder
    };

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
