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
//   - native BLE (removed 2026-08-26, recovered from v0 on 2026-08-27, generalised 2026-08-31) —
//     the `ble_*` commands below, a brand-agnostic bridge over `crates/cube-ble`. They implement
//     the operations `apps/web/lib/ble-polyfill.js` needs to present a `navigator.bluetooth` to
//     the protocol layer: scan by the filters it supplies, enumerate, subscribe, read, write, and
//     stream notifications back as `ble-notification` events. The browser build reaches the same
//     cube over the real Web Bluetooth — same seam shape, same protocol layer above it.
//     No cube brand appears here; `crates/cube-ble/tests/no_brand_constants.rs` scans this file
//     too and fails the build over one.
//   - the optimal solver (2026-08-29, src/optimal.rs) — prove a solution minimal. Native
//     because generating its 86 MB of pattern databases is; the browser answers the same
//     capability with the two-phase tiers' "shortest found" and the proven library.

// `mobile_entry_point` is the symbol the generated iOS/Android wrappers call. It is a no-op on
// desktop (the `cfg_attr(mobile, …)` expands to nothing), so it costs the desktop build nothing while
// making the same `run()` the entry point when Phase 3 wires up the iOS and Android shells. The
// `cube-vision` plugin is Apple-only today, so on iOS it runs the same CoreML core as macOS; the
// Android backend (LiteRT/CameraX) is the remaining device-gated work.
// ---- smart-cube BLE bridge (recovered verbatim from v0 — proven against a real GAN16) --------

use std::collections::HashMap;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use cube_ble::btleplug::api::{Central, CentralEvent, Peripheral as _, ValueNotification};
use cube_ble::btleplug::platform::Peripheral;
use cube_ble::{
    default_adapter, find_device, AdvertisedDevice, CharacteristicInfo, RequestOptions,
};
use futures::{Stream, StreamExt};
use tauri::{AppHandle, Emitter, State};
// Desktop-only: the sole use is `app.path()` in `orientation_path`, and a phone has no window whose
// orientation could be remembered. Un-gated it is an unused import on mobile.
#[cfg(desktop)]
use tauri::Manager;
use tokio::sync::Mutex;

mod optimal;

/// The notification stream btleplug hands back (owned, 'static).
type NotifyStream = Pin<Box<dyn Stream<Item = ValueNotification> + Send>>;

/// One inbound notification, as the web side's bridge expects it.
///
/// Typed rather than an ad-hoc json literal: this is a contract with
/// `apps/web/lib/ble-bridge.js`, and a renamed field would otherwise fail as a silently
/// undefined value in the polyfill rather than as a compile error here.
#[derive(serde::Serialize, Clone)]
struct NotificationPayload {
    device: String,
    service: String,
    characteristic: String,
    /// Hex. The webview boundary is JSON, and a byte array costs ~6x the bytes of hex.
    data: String,
}

#[derive(serde::Serialize, Clone)]
struct DisconnectPayload {
    device: String,
}

/// The BLE session: the adapter, what it discovered, and what is connected.
///
/// The adapter is held deliberately. A `Peripheral` belongs to the `Adapter` that discovered it,
/// and `ble_request_device` used to drop both — then `ble_connect` built a FRESH adapter and
/// searched its cache by id, which is a different adapter's cache and need not contain anything.
/// On a good day it worked because CoreBluetooth had cached the scan; on a bad one the connect
/// failed with "no longer in range" for a cube sitting on the desk.
///
/// Keyed by id rather than assuming one cube, because the polyfill passes a device id on every
/// call and silently ignoring it would let a stale id operate on whatever happens to be connected.
#[derive(Default)]
struct CubeState(Arc<Mutex<BleSession>>);

#[derive(Default)]
struct BleSession {
    /// Kept alive for as long as any peripheral it produced is in use.
    adapter: Option<cube_ble::btleplug::platform::Adapter>,
    discovered: HashMap<String, Peripheral>,
    connected: HashMap<String, Peripheral>,
}

impl CubeState {
    async fn get(&self, id: &str) -> Result<Peripheral, String> {
        self.0
            .lock()
            .await
            .connected
            .get(id)
            .cloned()
            .ok_or_else(|| format!("no connected device with id {id}"))
    }
}

/// Scan for a device satisfying the web side's `requestDevice` filters.
///
/// The filters come from the protocol layer, which owns the brand table; nothing here knows what a
/// cube is called. Twenty seconds because most smart cubes advertise only while moving, and a
/// beginner reaching for one takes a moment.
#[tauri::command]
async fn ble_request_device(
    state: State<'_, CubeState>,
    options: RequestOptions,
) -> Result<AdvertisedDevice, String> {
    let central = default_adapter().await.map_err(|e| e.to_string())?;
    let found = find_device(&central, &options, Duration::from_secs(20))
        .await
        .map_err(|e| e.to_string())?;
    match found {
        Some((peripheral, dev)) => {
            // Keep BOTH. The peripheral is only usable through the adapter that found it.
            let mut session = state.0.lock().await;
            session.adapter = Some(central);
            session.discovered.insert(dev.id.clone(), peripheral);
            Ok(dev)
        }
        None => Err("no matching device found — is the cube awake and advertising?".into()),
    }
}

/// Connect, and start forwarding every notification from this peripheral to the webview.
///
/// The forwarding task resolves each notification's SERVICE before emitting. btleplug reports only
/// the characteristic UUID, and the web side keys its characteristic objects on the (service,
/// characteristic) pair — so an unresolved notification is delivered to nothing and the packet is
/// gone. A dropped packet is not cosmetic: a driver takes the first move serial it sees as its gap
/// baseline, so a move lost here is never reported missing.
#[tauri::command]
async fn ble_connect(
    app: AppHandle,
    state: State<'_, CubeState>,
    id: String,
) -> Result<(), String> {
    // The adapter and peripheral from the scan that produced this id — not a fresh adapter, whose
    // cache is a different cache and need not contain this device at all.
    let (central, peripheral) = {
        let session = state.0.lock().await;
        let central = session
            .adapter
            .clone()
            .ok_or_else(|| "no scan has run — call ble_request_device first".to_string())?;
        let peripheral = session
            .discovered
            .get(&id)
            .cloned()
            .ok_or_else(|| format!("device {id} was not returned by the last scan"))?;
        (central, peripheral)
    };
    // Subscribe to adapter events BEFORE connecting so a fast disconnect cannot slip past.
    let events = central.events().await.map_err(|e| e.to_string())?;

    peripheral.connect().await.map_err(|e| e.to_string())?;
    // Discover up front so `service_of` can resolve notifications, and so the web side's
    // getPrimaryServices() does not race the first packet.
    if let Err(e) = peripheral.discover_services().await {
        let _ = peripheral.disconnect().await;
        return Err(e.to_string());
    }
    let stream: NotifyStream = match peripheral.notifications().await {
        Ok(s) => s,
        Err(e) => {
            let _ = peripheral.disconnect().await;
            return Err(e.to_string());
        }
    };

    // Recorded BEFORE the watcher is spawned. Inserting afterwards left a window in which a fast
    // disconnect fired, found nothing to remove, and was then overwritten by this insert — leaving
    // a dead peripheral in the session that every later command would be dispatched to.
    state
        .0
        .lock()
        .await
        .connected
        .insert(id.clone(), peripheral.clone());

    let app_for_task = app.clone();
    let pid = peripheral.id();
    let device_id = id.clone();
    let p_for_task = peripheral.clone();
    let state_for_task = state.0.clone();
    tauri::async_runtime::spawn(async move {
        let _central = central; // keep the adapter alive so its event stream stays fed
        let mut stream = stream;
        let mut events = events;
        loop {
            tokio::select! {
                packet = stream.next() => match packet {
                    Some(v) => {
                        // No service, no delivery — and say so rather than emitting a packet the
                        // web side will silently drop.
                        match cube_ble::service_of(&p_for_task, v.uuid) {
                            Some(service) => {
                                let _ = app_for_task.emit(
                                    "ble-notification",
                                    NotificationPayload {
                                        device: device_id.clone(),
                                        service,
                                        characteristic: v.uuid.to_string(),
                                        data: hex::encode(&v.value),
                                    },
                                );
                            }
                            None => {
                                // Unknown OR ambiguous: a characteristic uuid is unique only
                                // within a service, so `service_of` refuses to guess when two
                                // services expose the same one. Said out loud, because a silently
                                // dropped packet is the failure this whole path exists to avoid.
                                eprintln!(
                                    "cube-ble: cannot resolve the service for characteristic {} \
                                     (unknown or ambiguous) — packet dropped",
                                    v.uuid
                                );
                            }
                        }
                    }
                    None => break,
                },
                // A real disconnect comes from the adapter event, NOT from stream exhaustion. On
                // CoreBluetooth the notification stream can stay open after the cube drops, so
                // trusting it leaves the UI "Connected" forever and leaks this task.
                event = events.next() => match event {
                    Some(CentralEvent::DeviceDisconnected(pid_seen)) if pid_seen == pid => break,
                    Some(_) => {}
                    None => break,
                },
            }
        }
        // Drop it from the session as well as telling the webview. Emitting alone left a
        // disconnected peripheral in `connected`, so a later command would be dispatched to a dead
        // handle and fail with a puzzling error instead of a clear "not connected".
        {
            let mut session = state_for_task.lock().await;
            session.connected.remove(&device_id);
        }
        let _ = app_for_task.emit("ble-disconnect", DisconnectPayload { device: device_id });
    });

    Ok(())
}

#[tauri::command]
async fn ble_discover_services(
    state: State<'_, CubeState>,
    id: String,
) -> Result<Vec<String>, String> {
    let p = state.get(&id).await?;
    cube_ble::discover_services(&p)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn ble_discover_characteristics(
    state: State<'_, CubeState>,
    id: String,
    service: String,
) -> Result<Vec<CharacteristicInfo>, String> {
    let p = state.get(&id).await?;
    cube_ble::discover_characteristics(&p, &service)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn ble_subscribe(
    state: State<'_, CubeState>,
    id: String,
    service: String,
    characteristic: String,
) -> Result<(), String> {
    let p = state.get(&id).await?;
    cube_ble::subscribe(&p, &service, &characteristic)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn ble_unsubscribe(
    state: State<'_, CubeState>,
    id: String,
    service: String,
    characteristic: String,
) -> Result<(), String> {
    let p = state.get(&id).await?;
    cube_ble::unsubscribe(&p, &service, &characteristic)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn ble_read(
    state: State<'_, CubeState>,
    id: String,
    service: String,
    characteristic: String,
) -> Result<String, String> {
    let p = state.get(&id).await?;
    let bytes = cube_ble::read(&p, &service, &characteristic)
        .await
        .map_err(|e| e.to_string())?;
    Ok(hex::encode(bytes))
}

#[tauri::command]
async fn ble_write(
    state: State<'_, CubeState>,
    id: String,
    service: String,
    characteristic: String,
    data: String,
    without_response: bool,
) -> Result<(), String> {
    let p = state.get(&id).await?;
    let bytes = hex::decode(&data).map_err(|e| e.to_string())?;
    cube_ble::write(&p, &service, &characteristic, &bytes, without_response)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn ble_disconnect(state: State<'_, CubeState>, id: String) -> Result<(), String> {
    // Looked up, not removed: a disconnect that FAILS leaves the peripheral connected, and having
    // already dropped it from the map would leave the app unable to reach or release it again.
    // It is removed below, after the teardown actually succeeds.
    let peripheral = state.0.lock().await.connected.get(&id).cloned();
    if let Some(peripheral) = peripheral {
        // Reported rather than swallowed: a teardown that failed leaves the peripheral held by the
        // native side, and a cube that is still connected does not advertise — so the NEXT scan
        // stares into silence for its whole window and reads as a cube that will not reconnect.
        if let Err(e) = peripheral.disconnect().await {
            return Err(format!("the cube did not release cleanly: {e}"));
        }
        state.0.lock().await.connected.remove(&id);
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

// ---- the desktop window (dev-docs/stage-contract.md) ------------------------------------------
//
// Fixed and non-resizable, sized from the monitor's work area in the persisted orientation, and
// centred there. The three window configs declare the window with `create: false` — they keep
// the platform chrome (overlay title bar and traffic lights on macOS, no decorations on Windows
// and Linux) — and `build_main_window` builds it from that config at its computed size. Built,
// not resized: tao applies `set_size` asynchronously on macOS and Linux, so a window created
// small and grown would show its first frame at the wrong size. Nothing here touches the
// webview's layout — that asks its own container (index.html) and does not care what shape the
// window is.

// Desktop-only, like every one of its callers: the window arithmetic exists to fit a window to a
// monitor's work area, and a phone has neither. Un-gated it compiled into the iOS build as 13
// dead-code warnings (found by the first `--target aarch64-apple-ios` build, 2026-08-30) — which a
// mobile clippy leg would read as 13 errors under `-D warnings`.
#[cfg(desktop)]
mod stage;

/// Where the desktop's orientation is remembered: one word in a file in the app's config dir.
/// Not localStorage — that is the webview's, and the window has to be built before the webview
/// exists. Missing or unreadable reads as landscape, the shape the app is designed in first.
#[cfg(desktop)]
fn orientation_path<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<std::path::PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|d| d.join("orientation"))
}

#[cfg(desktop)]
fn load_orientation<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> stage::Orientation {
    orientation_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .map(|s| stage::Orientation::parse(&s))
        .unwrap_or(stage::Orientation::Landscape)
}

#[cfg(desktop)]
fn store_orientation<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    orientation: stage::Orientation,
) -> Result<(), String> {
    let path = orientation_path(app).ok_or("no config directory for this app")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, orientation.as_str()).map_err(|e| e.to_string())
}

/// The monitor the window belongs on: the one under the cursor, else the primary, else the
/// first the system reports. None only when the system reports no monitor at all.
#[cfg(desktop)]
fn pick_monitor<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<tauri::Monitor> {
    let under_cursor = app
        .cursor_position()
        .ok()
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten());
    under_cursor
        .or_else(|| app.primary_monitor().ok().flatten())
        .or_else(|| {
            app.available_monitors()
                .ok()
                .and_then(|m| m.into_iter().next())
        })
}

/// The window for a monitor in an orientation, and where it goes: centred in the monitor's work
/// area (the screen less menu bar, Dock and taskbar). Logical px: `work_area()` is physical.
#[cfg(desktop)]
fn place(
    monitor: &tauri::Monitor,
    orientation: stage::Orientation,
) -> (tauri::LogicalSize<f64>, tauri::LogicalPosition<f64>) {
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let size: tauri::LogicalSize<f64> = area.size.to_logical(scale);
    let origin: tauri::LogicalPosition<f64> = area.position.to_logical(scale);
    let w = stage::window(size.width, size.height, stage::BAR, orientation);
    let position = tauri::LogicalPosition::new(
        origin.x + (size.width - w.width) / 2.0,
        origin.y + (size.height - w.height) / 2.0,
    );
    (tauri::LogicalSize::new(w.width, w.height), position)
}

/// The main window's declaration in tauri.conf.json. Both builders below start here, because the
/// window is declared with `create: false` — Tauri creates nothing, and something must. What
/// differs between them is only the size and the position, which is to say: only the things a
/// phone does not have.
fn main_window_config(app: &tauri::App) -> tauri::utils::config::WindowConfig {
    app.config()
        .app
        .windows
        .iter()
        .find(|w| w.label == "main")
        .cloned()
        .expect("tauri.conf.json declares the main window (create: false)")
}

/// Mobile builds the declared window and nothing else: a phone's window is the screen, so there is
/// no monitor to pick, no work area to fit it to, and no position to centre it in. The composition
/// inside it is the webview's business and already keys on nothing but orientation
/// (dev-docs/stage-contract.md).
///
/// Without this the app launches with no webview at all. `create: false` means Tauri creates
/// nothing, and until the first mobile build the only builder was the `#[cfg(desktop)]` one below —
/// which the compiler said out loud, as `unused variable: app` on a `setup` whose whole body was
/// desktop-only.
#[cfg(mobile)]
fn build_main_window(app: &tauri::App) -> tauri::Result<tauri::WebviewWindow> {
    tauri::WebviewWindowBuilder::from_config(app, &main_window_config(app))?.build()
}

/// Build the main window from its config, at the size the contract gives it.
#[cfg(desktop)]
fn build_main_window(app: &tauri::App) -> tauri::Result<tauri::WebviewWindow> {
    let config = main_window_config(app);
    let handle = app.handle();
    let orientation = load_orientation(handle);
    // Built visible. Built hidden and shown after the traffic lights were placed, the window
    // stayed off screen: `show()` is dispatched to an event loop that is not running yet during
    // setup, and the message never landed (Quartz listed the window, onscreen false). The lights
    // are placed synchronously right after build, before the first frame, as they always were.
    let mut builder = tauri::WebviewWindowBuilder::from_config(app, &config)?
        .resizable(false)
        .maximizable(false);
    match pick_monitor(handle) {
        Some(monitor) => {
            let (size, position) = place(&monitor, orientation);
            log::info!(
                "window: {} {}×{} at ({}, {}) on {:?}",
                orientation.as_str(),
                size.width,
                size.height,
                position.x,
                position.y,
                monitor.name()
            );
            builder = builder
                .inner_size(size.width, size.height)
                .position(position.x, position.y);
        }
        // Loud, and still a window: the configured size is the fallback, not a silent one.
        None => log::error!("no monitor reported — the window keeps its configured size"),
    }
    builder.build()
}

/// The desktop's orientation toggle (contract decision 4): re-size and re-centre the window to
/// the other reference on the monitor it is on, and remember the choice for the next launch.
/// A capability seam (AGENTS.md): app.js calls this only when the Tauri API is injected on a
/// desktop platform; the browser build has no window to shape, and a phone rotates in the hand.
#[tauri::command]
fn set_orientation(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    orientation: String,
) -> Result<String, String> {
    #[cfg(desktop)]
    {
        let o = stage::Orientation::parse(&orientation);
        let monitor = window
            .current_monitor()
            .ok()
            .flatten()
            .or_else(|| pick_monitor(&app))
            .ok_or("no monitor reported")?;
        let (size, position) = place(&monitor, o);
        window.set_size(size).map_err(|e| e.to_string())?;
        // Best effort: Wayland has no window positioning, and a window that is the right size
        // in the wrong place is still the right window.
        if let Err(e) = window.set_position(position) {
            log::warn!("could not centre the window: {e}");
        }
        store_orientation(&app, o)?;
        Ok(o.as_str().to_string())
    }
    #[cfg(mobile)]
    {
        let _ = (app, window, orientation);
        Err("a phone or tablet rotates in the hand".to_string())
    }
}

/// The persisted orientation, for the toggle to show which is current.
#[tauri::command]
fn get_orientation(app: tauri::AppHandle) -> String {
    #[cfg(desktop)]
    {
        load_orientation(&app).as_str().to_string()
    }
    #[cfg(mobile)]
    {
        let _ = app;
        String::from("landscape")
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .setup(|app| {
            // Every platform, deliberately: the window is declared `create: false`, so this is the
            // only thing that brings a webview into existence anywhere.
            let window = build_main_window(app)?;
            #[cfg(target_os = "macos")]
            if let (Some((x, y)), Ok(ptr)) =
                (configured_traffic_lights(app, "main"), window.ns_window())
            {
                place_traffic_lights(ptr, x, y);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = window;
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
        .manage(optimal::OptimalState::default())
        .invoke_handler(tauri::generate_handler![
            set_orientation,
            get_orientation,
            ble_request_device,
            ble_connect,
            ble_discover_services,
            ble_discover_characteristics,
            ble_subscribe,
            ble_unsubscribe,
            ble_read,
            ble_write,
            ble_disconnect,
            optimal::optimal_prepare,
            optimal::optimal_status,
            optimal::optimal_prove,
            optimal::optimal_cancel
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
