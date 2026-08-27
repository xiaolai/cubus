// Cubus desktop backend.
//
// Deliberately thin. The app is `apps/web` in a native window: the solver, the scanner and the
// renderer all run in the webview, and there is nothing the browser build cannot do that this
// needs Rust for. It exists so the tutor can be an application a child opens rather than a tab
// somebody has to find again, and so it works with no network at all.
//
// Native capabilities, each behind a seam the browser build also satisfies (AGENTS.md):
//   - `cube-vision` (2026-08-26) — native camera capture and CoreML inference behind the
//     `Detector` seam; the browser runs `WebDetector`. Inert on non-Apple targets.
//   - native BLE (removed 2026-08-26, recovered from v0 on 2026-08-27) — the GAN smart-cube
//     bridge below: FFF6 notifications are forwarded as `cube-packet` events (hex), FFF5
//     commands come back via `write_fff5`, and the browser-safe gan-driver decodes in the
//     webview. The browser build reaches the same cube over Web Bluetooth — same seam shape.

// `mobile_entry_point` is the symbol the generated iOS/Android wrappers call. It is a no-op on
// desktop (the `cfg_attr(mobile, …)` expands to nothing), so it costs the desktop build nothing while
// making the same `run()` the entry point when Phase 3 wires up the iOS and Android shells. The
// `cube-vision` plugin is Apple-only today, so on iOS it runs the same CoreML core as macOS; the
// Android backend (LiteRT/CameraX) is the remaining device-gated work.
// ---- smart-cube BLE bridge (recovered verbatim from v0 — proven against a real GAN16) --------

use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use futures::{Stream, StreamExt};
use gan_ble::btleplug::api::{
    Central, CentralEvent, Peripheral as _, ValueNotification, WriteType,
};
use gan_ble::btleplug::platform::Peripheral;
use gan_ble::{default_adapter, find_gan_cube, FFF5_WRITE, FFF6_NOTIFY};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;

/// The FFF6 notification stream btleplug hands back (owned, 'static).
type NotifyStream = Pin<Box<dyn Stream<Item = ValueNotification> + Send>>;

/// The currently-connected cube (if any).
#[derive(Default)]
struct CubeState(Arc<Mutex<Option<Peripheral>>>);

#[derive(serde::Serialize)]
struct CubeInfo {
    name: String,
    mac: Option<String>,
}

/// Discover services, find FFF6, subscribe, and open the notification stream. Split out so
/// `connect_cube` can tear the peripheral down if any step here fails.
async fn init_notifications(peripheral: &Peripheral) -> Result<NotifyStream, String> {
    peripheral
        .discover_services()
        .await
        .map_err(|e| e.to_string())?;
    let notify = peripheral
        .characteristics()
        .into_iter()
        .find(|c| c.uuid == FFF6_NOTIFY)
        .ok_or_else(|| "FFF6 notify characteristic not found".to_string())?;
    peripheral
        .subscribe(&notify)
        .await
        .map_err(|e| e.to_string())?;
    peripheral.notifications().await.map_err(|e| e.to_string())
}

/// Scan → connect → subscribe FFF6. Each notification is emitted to the webview as a
/// `cube-packet` event carrying the raw 20-byte packet as hex; gan-driver decodes it there.
#[tauri::command]
async fn connect_cube(app: AppHandle, state: State<'_, CubeState>) -> Result<CubeInfo, String> {
    let central = default_adapter().await.map_err(|e| e.to_string())?;
    // Subscribe to adapter events BEFORE connecting so a fast disconnect can't slip past us.
    let events = central.events().await.map_err(|e| e.to_string())?;
    let cube = find_gan_cube(&central, Duration::from_secs(20))
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no GAN cube found — is it awake and advertising?".to_string())?;

    let peripheral = cube.peripheral;
    peripheral.connect().await.map_err(|e| e.to_string())?;

    // The peripheral is now connected; if any initialization step fails, disconnect it before
    // returning so we never leak an open BLE link behind an error the frontend can't clean up
    // (its disconnect_cube would run against an empty CubeState).
    let stream = match init_notifications(&peripheral).await {
        Ok(s) => s,
        Err(e) => {
            let _ = peripheral.disconnect().await;
            return Err(e);
        }
    };

    // Forward FFF6 notifications as `cube-packet`, and detect a real disconnect from the adapter's
    // DeviceDisconnected event — NOT from stream exhaustion. On CoreBluetooth the notifications
    // stream can stay open after the cube drops, so relying on it would leave the UI "Connected"
    // forever and leak this task; the event fires on a genuine disconnect and ends the task.
    let app_for_task = app.clone();
    let pid = peripheral.id();
    tauri::async_runtime::spawn(async move {
        let _central = central; // keep the adapter alive so its event stream stays fed
        let mut stream = stream;
        let mut events = events;
        loop {
            tokio::select! {
                packet = stream.next() => match packet {
                    Some(v) => {
                        let _ = app_for_task.emit("cube-packet", hex::encode(&v.value));
                    }
                    None => break,
                },
                event = events.next() => match event {
                    Some(CentralEvent::DeviceDisconnected(id)) if id == pid => break,
                    Some(_) => {}
                    None => break,
                },
            }
        }
        let _ = app_for_task.emit("cube-disconnect", ());
    });

    let info = CubeInfo {
        name: cube.name,
        mac: cube.mac,
    };
    *state.0.lock().await = Some(peripheral);
    Ok(info)
}

/// Write an FFF5 command (encrypted, built by gan-driver) — passed as hex from the webview.
#[tauri::command]
async fn write_fff5(state: State<'_, CubeState>, hex_data: String) -> Result<(), String> {
    let bytes = hex::decode(&hex_data).map_err(|e| e.to_string())?;
    let guard = state.0.lock().await;
    let peripheral = guard.as_ref().ok_or_else(|| "not connected".to_string())?;
    let write = peripheral
        .characteristics()
        .into_iter()
        .find(|c| c.uuid == FFF5_WRITE)
        .ok_or_else(|| "FFF5 write characteristic not found".to_string())?;
    peripheral
        .write(&write, &bytes, WriteType::WithoutResponse)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn disconnect_cube(state: State<'_, CubeState>) -> Result<(), String> {
    if let Some(peripheral) = state.0.lock().await.take() {
        let _ = peripheral.disconnect().await;
    }
    Ok(())
}

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
        .plugin(tauri_plugin_opener::init())
        .manage(CubeState::default())
        .invoke_handler(tauri::generate_handler![
            connect_cube,
            write_fff5,
            disconnect_cube
        ]);

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
