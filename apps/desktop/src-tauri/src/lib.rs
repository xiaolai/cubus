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
use cube_ble::uuid::Uuid;
use cube_ble::{
    default_adapter, find_device, AdvertisedDevice, CharacteristicInfo, RequestOptions,
};
use futures::{Stream, StreamExt};
use tauri::{AppHandle, Emitter, State};
// Desktop-only: the sole use is `app.path()` in `orientation_path`, and a phone has no window whose
// orientation could be remembered. Un-gated it is an unused import on mobile.
#[cfg(desktop)]
use tauri::Manager;
// Android-only: `relay_notification` reaches the shared subscription map through managed state.
#[cfg(target_os = "android")]
use tauri::Manager;
use tokio::sync::Mutex;

#[cfg(target_os = "android")]
mod android_ble;
mod optimal;

/// The notification stream btleplug hands back (owned, 'static).
type NotifyStream = Pin<Box<dyn Stream<Item = ValueNotification> + Send>>;

/// One inbound notification, as the web side's bridge expects it.
///
/// Typed rather than an ad-hoc json literal: this is a contract with
/// `apps/web/lib/ble-bridge.js`, and a renamed field would otherwise fail as a silently
/// undefined value in the polyfill rather than as a compile error here.
///
/// `sub` is a subscription id, not the (device, service, characteristic) triple this used to
/// carry. Those three strings are IDENTICAL for every packet of a session — a device id and two
/// 36-character UUIDs — so sending them 20 times a second was 150 bytes of repetition around 20
/// bytes of payload: 204 bytes per notification, of which 54 carried anything. Over a ten-minute
/// session that is 2.3 MB across the webview boundary instead of 0.6 MB, and every one of those
/// bytes is serialised, copied and parsed. The id is assigned once at subscribe time and the web
/// side keeps the mapping.
#[derive(serde::Serialize, Clone)]
struct NotificationPayload {
    /// Subscription id, from `ble_subscribe`.
    sub: u32,
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

/// A subscribed (device, service, characteristic), addressed by a small integer.
struct Subscription {
    device: String,
    service: String,
    characteristic: Uuid,
}

#[derive(Default)]
struct BleSession {
    /// Kept alive for as long as any peripheral it produced is in use.
    adapter: Option<cube_ble::btleplug::platform::Adapter>,
    discovered: HashMap<String, Peripheral>,
    connected: HashMap<String, Peripheral>,
    /// Live subscriptions by id. The id is what crosses the boundary per packet instead of three
    /// strings that never change within a session.
    subscriptions: HashMap<u32, Subscription>,
    next_subscription: u32,
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

/// Which live subscription a packet belongs to: exactly one match, or none.
///
/// Named and shared because BOTH notification paths have to obey it — the desktop's btleplug
/// stream task and, since the Android bridge started re-keying its own packets, `relay`. A
/// characteristic uuid is unique only WITHIN a service, so a device exposing the same one under
/// two subscribed services makes this ambiguous; `find` would have taken whichever the map
/// iterated first, which is unspecified, and routed a stream to the wrong decoder.
///
/// The refusal is deliberate and it is also load-bearing in a way that was not obvious: it turns
/// a LEAKED subscription into total silence rather than a wrong answer. That is the right trade,
/// and it is why `forget_subscriptions` below is not merely tidiness.
fn subscription_for(
    subs: &HashMap<u32, Subscription>,
    device: &str,
    characteristic: Uuid,
) -> Option<u32> {
    let mut matches = subs
        .iter()
        .filter(|(_, s)| s.device == device && s.characteristic == characteristic)
        .map(|(id, _)| *id);
    match (matches.next(), matches.next()) {
        (Some(id), None) => Some(id),
        _ => None,
    }
}

/// Let a device go: drop the peripheral AND every subscription that addressed it.
///
/// ONE function rather than two calls, because the two halves were separable and drifted. Every
/// disconnect path removed the peripheral; none of them removed the subscriptions, which looked
/// harmless since nothing reads them for a device that is gone. It is not harmless across a
/// RECONNECT, a flow this app is built around (`apps/web/lib/cube-reconnect.js`): subscribing to
/// the same characteristic again inserted a SECOND entry, `subscription_for` then saw two matches
/// and refused, and every packet from that characteristic was dropped for the rest of the session
/// — a cube that connects, reports trusted, and then says nothing.
///
/// Written as one operation so a future disconnect path cannot do half of it. That is the whole
/// design: the unit test below can prove this function does both, and it cannot prove a call site
/// remembered to.
fn release_device(session: &mut BleSession, device: &str) {
    session.connected.remove(device);
    session.subscriptions.retain(|_, s| s.device != device);
}

/// Re-key one Android notification onto the wire shape the web side actually validates.
///
/// Kotlin reports `(device, service, characteristic)` because that is all a GATT callback knows.
/// `ble-bridge.js` requires `{ sub, data }` and THROWS on anything else, so until this existed
/// every Android packet was rejected at the boundary — by a check working exactly as designed,
/// which is why nothing about it was quiet. The map is the same one the desktop stream task reads
/// and `ble_subscribe` populates on BOTH platforms, deliberately, so that the two never answer the
/// same question with different numbers.
///
/// Asynchronous because the session is behind an async mutex and the Kotlin channel callback is
/// synchronous. Ordering within one characteristic is preserved by the GATT queue upstream, and a
/// packet that loses its race with `ble_subscribe`'s bookkeeping is dropped loudly below rather
/// than delivered under an id the web side has never heard of.
#[cfg(target_os = "android")]
pub(crate) fn relay_notification<R: tauri::Runtime>(
    app: &AppHandle<R>,
    device: String,
    characteristic: String,
    data: String,
) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let uuid = match cube_ble::parse_uuid(&characteristic) {
            Ok(uuid) => uuid,
            Err(e) => {
                // Loud: a characteristic Kotlin can name but Rust cannot parse is a bridge bug,
                // and the quiet version of it is a cube that connects and then says nothing.
                eprintln!("cube-ble: unparseable characteristic {characteristic} from Kotlin: {e}");
                return;
            }
        };
        let Some(session) = app.try_state::<CubeState>().map(|s| s.0.clone()) else {
            eprintln!("cube-ble: notification arrived before the BLE session was managed");
            return;
        };
        let sub = subscription_for(&session.lock().await.subscriptions, &device, uuid);
        match sub {
            Some(sub) => {
                let _ = app.emit("ble-notification", NotificationPayload { sub, data });
            }
            None => {
                // The same sentence, and the same reasoning, as the desktop stream task.
                eprintln!(
                    "cube-ble: notification for characteristic {uuid} matches no live \
                     subscription, or more than one — packet dropped"
                );
            }
        }
    });
}

/// Scan for a device satisfying the web side's `requestDevice` filters.
///
/// The filters come from the protocol layer, which owns the brand table; nothing here knows what a
/// cube is called. Twenty seconds because most smart cubes advertise only while moving, and a
/// beginner reaching for one takes a moment.
#[tauri::command]
async fn ble_request_device(
    #[allow(unused_variables)] app: AppHandle,
    #[allow(unused_variables)] state: State<'_, CubeState>,
    options: RequestOptions,
) -> Result<AdvertisedDevice, String> {
    #[cfg(target_os = "android")]
    {
        return android_ble::call(&app, "ble_request_device", options);
    }
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
    #[allow(unused_variables)] state: State<'_, CubeState>,
    id: String,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        return android_ble::call(&app, "ble_connect", android_ble::DeviceArgs { id });
    }
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
    let state_for_task = state.0.clone();
    tauri::async_runtime::spawn(async move {
        let _central = central; // keep the adapter alive so its event stream stays fed
        let mut stream = stream;
        let mut events = events;
        loop {
            tokio::select! {
                packet = stream.next() => match packet {
                    Some(v) => {
                        // Resolve to the subscription the web side already knows about. This is a
                        // map lookup on a handful of entries, once per packet, and it replaces
                        // three strings on the wire with one integer.
                        //
                        // No subscription, no delivery — and say so rather than emitting a packet
                        // the web side will silently drop.
                        // Exactly one match, or none — never "the first".
                        //
                        // A characteristic uuid is unique only WITHIN a service, so a device that
                        // exposes the same one under two subscribed services makes this ambiguous.
                        // `find` would have picked whichever the map iterated first, which is
                        // unspecified, so a stream could be routed to the wrong subscription and
                        // decoded as the wrong thing. That is the same defect `service_of` refuses
                        // to commit three functions away, and refusing here keeps the two honest.
                        let sub = subscription_for(
                            &state_for_task.lock().await.subscriptions,
                            &device_id,
                            v.uuid,
                        );
                        match sub {
                            Some(sub) => {
                                let _ = app_for_task.emit(
                                    "ble-notification",
                                    NotificationPayload {
                                        sub,
                                        data: hex::encode(&v.value),
                                    },
                                );
                            }
                            None => {
                                // The stream is delivering something nothing asked for. Said out
                                // loud, because a silently dropped packet is the failure this
                                // whole path exists to avoid.
                                eprintln!(
                                    "cube-ble: notification for characteristic {} matches no live \
                                     subscription, or more than one — packet dropped",
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
            release_device(&mut *state_for_task.lock().await, &device_id);
        }
        let _ = app_for_task.emit("ble-disconnect", DisconnectPayload { device: device_id });
    });

    Ok(())
}

#[tauri::command]
async fn ble_discover_services(
    #[allow(unused_variables)] app: AppHandle,
    #[allow(unused_variables)] state: State<'_, CubeState>,
    id: String,
) -> Result<Vec<String>, String> {
    #[cfg(target_os = "android")]
    {
        return android_ble::call(
            &app,
            "ble_discover_services",
            android_ble::DeviceArgs { id },
        );
    }
    let p = state.get(&id).await?;
    cube_ble::discover_services(&p)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn ble_discover_characteristics(
    #[allow(unused_variables)] app: AppHandle,
    #[allow(unused_variables)] state: State<'_, CubeState>,
    id: String,
    service: String,
) -> Result<Vec<CharacteristicInfo>, String> {
    #[cfg(target_os = "android")]
    {
        return android_ble::call(
            &app,
            "ble_discover_characteristics",
            android_ble::ServiceArgs { id, service },
        );
    }
    let p = state.get(&id).await?;
    cube_ble::discover_characteristics(&p, &service)
        .await
        .map_err(|e| e.to_string())
}

/// Subscribe, and hand back the id that will identify this stream's packets.
#[tauri::command]
async fn ble_subscribe(
    #[allow(unused_variables)] app: AppHandle,
    state: State<'_, CubeState>,
    id: String,
    service: String,
    characteristic: String,
) -> Result<u32, String> {
    // Only the TRANSPORT differs by platform; the bookkeeping below is shared on purpose. The
    // subscription id is what the web side keys packets by, so if Android allocated its own the two
    // platforms would be answering the same question with different numbers.
    #[cfg(target_os = "android")]
    android_ble::call::<_, _, ()>(
        &app,
        "ble_subscribe",
        android_ble::CharArgs {
            id: id.clone(),
            service: service.clone(),
            characteristic: characteristic.clone(),
        },
    )?;
    #[cfg(not(target_os = "android"))]
    {
        let p = state.get(&id).await?;
        cube_ble::subscribe(&p, &service, &characteristic)
            .await
            .map_err(|e| e.to_string())?;
    }
    let uuid = cube_ble::parse_uuid(&characteristic).map_err(|e| e.to_string())?;
    let mut session = state.0.lock().await;
    let sub_id = session.next_subscription;
    session.next_subscription += 1;
    session.subscriptions.insert(
        sub_id,
        Subscription {
            device: id,
            service,
            characteristic: uuid,
        },
    );
    Ok(sub_id)
}

#[tauri::command]
async fn ble_unsubscribe(
    #[allow(unused_variables)] app: AppHandle,
    state: State<'_, CubeState>,
    id: String,
    service: String,
    characteristic: String,
) -> Result<(), String> {
    // The TRANSPORT differs by platform; the bookkeeping below does not — the same rule
    // `ble_subscribe` states, and the reason its Android branch is not an early return either.
    // This one WAS an early return, so on Android the entry was never removed and the map grew a
    // duplicate on the next subscribe, which `subscription_for` then refuses to resolve.
    #[cfg(target_os = "android")]
    android_ble::call::<_, _, ()>(
        &app,
        "ble_unsubscribe",
        android_ble::CharArgs {
            id: id.clone(),
            service: service.clone(),
            characteristic: characteristic.clone(),
        },
    )?;
    #[cfg(not(target_os = "android"))]
    {
        let p = state.get(&id).await?;
        cube_ble::unsubscribe(&p, &service, &characteristic)
            .await
            .map_err(|e| e.to_string())?;
    }
    let uuid = cube_ble::parse_uuid(&characteristic).map_err(|e| e.to_string())?;
    let mut session = state.0.lock().await;
    session
        .subscriptions
        .retain(|_, s| !(s.device == id && s.service == service && s.characteristic == uuid));
    Ok(())
}

#[tauri::command]
async fn ble_read(
    #[allow(unused_variables)] app: AppHandle,
    #[allow(unused_variables)] state: State<'_, CubeState>,
    id: String,
    service: String,
    characteristic: String,
) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        return android_ble::read(&app, id, service, characteristic);
    }
    let p = state.get(&id).await?;
    let bytes = cube_ble::read(&p, &service, &characteristic)
        .await
        .map_err(|e| e.to_string())?;
    Ok(hex::encode(bytes))
}

#[tauri::command]
async fn ble_write(
    #[allow(unused_variables)] app: AppHandle,
    #[allow(unused_variables)] state: State<'_, CubeState>,
    id: String,
    service: String,
    characteristic: String,
    data: String,
    without_response: bool,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        return android_ble::call(
            &app,
            "ble_write",
            android_ble::WriteArgs {
                id: id.clone(),
                service: service.clone(),
                characteristic: characteristic.clone(),
                data: data.clone(),
                with_response: !without_response,
            },
        );
    }
    let p = state.get(&id).await?;
    let bytes = hex::decode(&data).map_err(|e| e.to_string())?;
    cube_ble::write(&p, &service, &characteristic, &bytes, without_response)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn ble_disconnect(
    #[allow(unused_variables)] app: AppHandle,
    #[allow(unused_variables)] state: State<'_, CubeState>,
    id: String,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        return android_ble::call(&app, "ble_disconnect", android_ble::DeviceArgs { id });
    }
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
        release_device(&mut *state.0.lock().await, &id);
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
            // CMD+W CLOSES THE WINDOW; CMD+Q QUITS. On macOS those are different things, and this
            // app used to make them the same one: it has a single window, so closing it ended the
            // process — which meant the reflex that dismisses a window on every other Mac app threw
            // away a scan in progress, a solve in progress, and every warm table behind them
            // (cubejs alone costs 3-6 s and ~34 MB to rebuild, and the renderer's GL context goes
            // with it). Hidden rather than closed, reopening is instantaneous AND lands exactly
            // where the user left off, because the webview was never torn down.
            //
            // This is only correct BECAUSE `RunEvent::Reopen` below brings it back. An app that
            // keeps a Dock icon it cannot restore a window from is worse than one that quits: the
            // icon is there, clicking it does nothing, and the only way out is Force Quit. The two
            // halves are a pair and neither is safe alone.
            //
            // macOS only, deliberately. On Windows and Linux the close button IS quit — an app
            // that lingered with no window there would be a process nobody asked for and nothing
            // in the taskbar to reach it by.
            #[cfg(target_os = "macos")]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
                return;
            }
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

    // Self-update, and the relaunch that completes it. WINDOWS AND LINUX ONLY.
    //
    // Not macOS: it ships through a Homebrew cask, and a cask plus a self-updater both write to
    // the same /Applications/cubus.app while only one of them knows what is really there. An app
    // that moved itself to 0.3.0 would be reinstalled as 0.2.9 by the next `brew upgrade` — a
    // downgrade performed by the command meant to keep you current, and reported by nothing.
    // Homebrew is the macOS updater; this is not compiled there at all.
    //
    // Not a phone either, and not the browser build: one goes through a store, the other is
    // whatever the server last served. So this is the same shape as the window's orientation — a
    // capability one build has and another cannot want — and the affordance is drawn behind the
    // same predicate, narrowed by `SELF_UPDATE_PLATFORMS`.
    //
    // The pubkey and endpoint live in tauri.conf.json. An update is verified against that key
    // before it is ever unpacked, which is the whole reason this is safe to ship: the endpoint is
    // plain HTTPS on a public URL, and a signature nobody but the maintainer can produce is what
    // stops that URL from being an install-anything hole.
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init());

    // Android's BLE is Kotlin (src/android_ble.rs); every other platform's is btleplug in-process
    // and needs no plugin at all. The nine command NAMES are identical either way, which is what
    // keeps `apps/web/lib/ble-bridge.js` from having to learn a platform.
    #[cfg(target_os = "android")]
    let builder = builder.plugin(android_ble::plugin());

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

    // `build().run(handler)` rather than `run()`, for one reason: `RunEvent::Reopen` is the Dock
    // icon being clicked, and it is only reachable from the handler form.
    builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            // The other half of the hide-on-close pair above. Without it the app would keep a Dock
            // icon that restores nothing, which is a worse outcome than quitting.
            //
            // `has_visible_windows` is false exactly when every window is hidden — the state
            // CloseRequested leaves behind. When it is true macOS has already brought a window
            // forward and there is nothing to do; showing again would be a no-op that steals focus.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen {
                has_visible_windows: false,
                ..
            } = _event
            {
                if let Some(window) = _app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        });
}

#[cfg(test)]
mod subscription_tests {
    use super::*;

    fn uuid(n: u128) -> Uuid {
        Uuid::from_u128(n)
    }

    fn session_with(entries: &[(u32, &str, u128)]) -> BleSession {
        let mut s = BleSession::default();
        for &(id, device, ch) in entries {
            s.subscriptions.insert(
                id,
                Subscription {
                    device: device.to_string(),
                    service: "service".into(),
                    characteristic: uuid(ch),
                },
            );
            s.next_subscription = s.next_subscription.max(id + 1);
        }
        s
    }

    #[test]
    fn one_live_subscription_resolves() {
        let s = session_with(&[(0, "cube", 1)]);
        assert_eq!(subscription_for(&s.subscriptions, "cube", uuid(1)), Some(0));
    }

    #[test]
    fn a_packet_for_another_device_resolves_to_nothing() {
        let s = session_with(&[(0, "cube", 1)]);
        assert_eq!(subscription_for(&s.subscriptions, "other", uuid(1)), None);
    }

    // The refusal that makes leaked entries dangerous rather than merely untidy, asserted directly
    // so the two halves of this behaviour can never be changed independently.
    #[test]
    fn two_matches_refuse_rather_than_guess() {
        let s = session_with(&[(0, "cube", 1), (1, "cube", 1)]);
        assert_eq!(subscription_for(&s.subscriptions, "cube", uuid(1)), None);
    }

    // The bug this pair of functions exists to prevent, written as the sequence that produced it:
    // connect, subscribe, drop, reconnect, subscribe again. Before `forget_subscriptions` ran on
    // the disconnect paths, the second subscribe left two entries and the cube went silent.
    #[test]
    fn a_reconnect_does_not_silence_the_cube() {
        let mut s = session_with(&[(0, "cube", 1)]);
        assert_eq!(subscription_for(&s.subscriptions, "cube", uuid(1)), Some(0));

        release_device(&mut s, "cube"); // the disconnect
        assert_eq!(subscription_for(&s.subscriptions, "cube", uuid(1)), None);

        // Re-subscribing after the reconnect, exactly as `ble_subscribe` does.
        let id = s.next_subscription;
        s.next_subscription += 1;
        s.subscriptions.insert(
            id,
            Subscription {
                device: "cube".into(),
                service: "service".into(),
                characteristic: uuid(1),
            },
        );
        assert_eq!(
            subscription_for(&s.subscriptions, "cube", uuid(1)),
            Some(id),
            "a reconnected cube's packets must still resolve — this is the defect the disconnect \
             paths leaked before they called forget_subscriptions"
        );
    }

    #[test]
    fn releasing_one_device_leaves_another_alone() {
        let mut s = session_with(&[(0, "cube", 1), (1, "spare", 1)]);
        release_device(&mut s, "cube");
        assert_eq!(
            subscription_for(&s.subscriptions, "spare", uuid(1)),
            Some(1)
        );
        assert_eq!(s.subscriptions.len(), 1);
    }

    // Every subscription goes, not just the one that matched a packet. A device is subscribed to
    // more than one characteristic in practice, and half a release is what leaves the duplicate
    // behind on the NEXT connect.
    //
    // The peripheral half is deliberately NOT asserted: `connected` holds a btleplug `Peripheral`,
    // which cannot be constructed off a real adapter, so the map is empty in any test and
    // `assert!(!connected.contains_key(..))` would pass without `release_device` doing anything at
    // all. It is checked by the compiler instead — the function is the only way to leave the
    // session, so `connected.remove` cannot be dropped from a call site without deleting the call.
    #[test]
    fn releasing_a_device_drops_all_of_its_subscriptions() {
        let mut s = session_with(&[(0, "cube", 1), (1, "cube", 2)]);
        assert_eq!(s.subscriptions.len(), 2);
        release_device(&mut s, "cube");
        assert!(
            s.subscriptions.is_empty(),
            "subscriptions must go with the device"
        );
    }
}
