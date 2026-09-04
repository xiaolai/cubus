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
//
// EVERY DIAGNOSTIC GOES THROUGH THE `log` FACADE. This file used to `eprintln!` its loud failures —
// a dropped packet, a subscription that matched nothing — and a Finder-launched app has no stderr,
// so "loud" was loud only under `cargo run`. `tauri_plugin_log` captures the facade (and only the
// facade) into the log file a user can send, so that is the one channel (audit 2026-09-04, A3/A4).

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

use cube_ble::btleplug::api::{
    Central, CentralEvent, CentralState, Peripheral as _, ValueNotification,
};
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
use tokio::sync::Mutex;

#[cfg(target_os = "android")]
mod android_ble;
mod optimal;

/// The notification stream btleplug hands back (owned, 'static).
type NotifyStream = Pin<Box<dyn Stream<Item = ValueNotification> + Send>>;

/// How long a connect, a service discovery or a notification-stream open may take before the
/// command gives up with a sentence rather than a spinner. btleplug's CoreBluetooth backend has no
/// timeout of its own: a cube that stopped advertising between the scan and the tap, or an adapter
/// that went away, left `peripheral.connect()` pending for as long as the app ran, and the web
/// side's "Connecting…" with it. Fifteen seconds is longer than any connect a cube on the desk
/// takes (measured well under two) and short enough that a person still remembers what they did.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

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
#[derive(serde::Serialize, Clone, Debug, PartialEq, Eq)]
struct NotificationPayload {
    /// Subscription id, from `ble_subscribe`.
    sub: u32,
    /// Hex. The webview boundary is JSON, and a byte array costs ~6x the bytes of hex.
    data: String,
}

#[derive(serde::Serialize, Clone, Debug, PartialEq, Eq)]
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

/// The one sentence for "that id is not connected", so the Android arm can recognise the Kotlin
/// side's identical answer (`BlePlugin.kt` rejects with the same words) where it matters — see
/// `ble_unsubscribe`.
const NOT_CONNECTED: &str = "no connected device with id";

impl CubeState {
    async fn get(&self, id: &str) -> Result<Peripheral, String> {
        self.0
            .lock()
            .await
            .connected
            .get(id)
            .cloned()
            .ok_or_else(|| format!("{NOT_CONNECTED} {id}"))
    }
}

/// Which live subscription a packet belongs to: exactly one match, or none.
///
/// Named and shared because BOTH notification paths have to obey it — the desktop's btleplug
/// stream task and the Android relay pump. A characteristic uuid is unique only WITHIN a service,
/// so a device exposing the same one under two subscribed services makes this ambiguous; `find`
/// would have taken whichever the map iterated first, which is unspecified, and routed a stream
/// to the wrong decoder.
///
/// The refusal is deliberate and it is also load-bearing in a way that was not obvious: it turns
/// a LEAKED subscription into total silence rather than a wrong answer. That is the right trade,
/// and it is why `release_device` below is not merely tidiness.
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

/// Book a subscription id BEFORE the transport is asked to subscribe, and hand it back.
///
/// The order is the point. `ble_subscribe` used to insert the id AFTER the CCCD write returned —
/// and a cube that starts notifying the instant that descriptor lands (which is what a smart cube
/// does: the first packet after subscribe is its full state snapshot) delivered that packet into
/// a window where `subscription_for` found nothing and the stream task dropped it. The web side
/// then waited for a state it had already been sent. With the entry booked first, a packet that
/// beats the subscribe's return resolves like any other; a subscribe that FAILS un-books it
/// (`forget_subscription`), so nothing is left addressing a characteristic nobody listens to.
fn reserve_subscription(
    session: &mut BleSession,
    device: String,
    service: String,
    characteristic: Uuid,
) -> u32 {
    let id = session.next_subscription;
    session.next_subscription += 1;
    session.subscriptions.insert(
        id,
        Subscription {
            device,
            service,
            characteristic,
        },
    );
    id
}

/// The other half of `reserve_subscription`: a transport that refused takes its booking back.
fn forget_subscription(session: &mut BleSession, id: u32) {
    session.subscriptions.remove(&id);
}

/// Drop every booking for one (device, service, characteristic). Used by `ble_unsubscribe` on
/// every platform, whatever the transport said — a subscription the app asked to end must not go
/// on claiming packets.
fn drop_subscriptions(session: &mut BleSession, device: &str, service: &str, characteristic: Uuid) {
    session.subscriptions.retain(|_, s| {
        !(s.device == device && s.service == service && s.characteristic == characteristic)
    });
}

/// Whether a scan is worth starting on this adapter, and if not, WHY — the two reasons a scan
/// finds nothing have different fixes and used to share one sentence.
///
/// "No matching device found — is the cube awake?" was the answer for a cube that was asleep AND
/// for a Mac whose Bluetooth was switched off, and only one of those is fixed by shaking the cube.
/// `PoweredOff` is refused before the radio is asked; `Unknown` is CoreBluetooth's state until its
/// first callback, and proceeding is right (the scan's own window absorbs the wait) — it is named
/// in the no-device sentence so a permission problem does not keep wearing a hardware problem's
/// face. Denied access has no state of its own in this btleplug: an unauthorised app sees
/// `Unknown` forever and then an empty scan, so the sentence for that outcome names both.
fn scan_precondition(state: CentralState) -> Result<(), String> {
    match state {
        CentralState::PoweredOn | CentralState::Unknown => Ok(()),
        CentralState::PoweredOff => Err(
            "Bluetooth is switched off on this computer — turn it on in the system settings, then \
             try again"
                .to_string(),
        ),
    }
}

/// The sentence for an empty scan, given what the adapter said about itself first.
fn nothing_found(state: CentralState) -> String {
    match state {
        CentralState::PoweredOn => {
            "no matching cube advertised during the scan — is it awake? Most cubes advertise only \
             while being turned"
                .to_string()
        }
        // Still Unknown after a whole scan window: either the OS never granted this app Bluetooth
        // (macOS: Privacy & Security › Bluetooth), or the adapter never came up.
        CentralState::Unknown => {
            "no cube advertised, and the Bluetooth adapter never reported ready — check that this \
             app is allowed to use Bluetooth in the system's privacy settings, and that Bluetooth \
             is on"
                .to_string()
        }
        CentralState::PoweredOff => {
            scan_precondition(CentralState::PoweredOff).expect_err("PoweredOff is always a refusal")
        }
    }
}

/// The Android relay: every event Kotlin reports, in the order it reported it.
///
/// One long-lived task fed by an unbounded FIFO channel. The previous shape spawned ONE TASK PER
/// NOTIFICATION, and tasks are not a queue: two packets 5 ms apart could resolve their ids and
/// emit in either order, and a cube's move stream is a serial the driver reads as a gap the moment
/// two arrive swapped (audit 2026-09-04, B3/B1). The channel preserves arrival order by
/// construction, the pump is the only consumer, and a disconnect rides the same channel so it
/// cannot overtake the packets that preceded it.
///
/// Compiled on Android and under test everywhere: the FIFO promise is the kind of thing a unit
/// test can prove with a thousand events and a device cannot.
#[cfg(any(target_os = "android", test))]
mod relay {
    use super::*;

    /// One event as Kotlin reported it, before any re-keying.
    #[derive(Debug)]
    pub(crate) enum Inbound {
        Notification {
            device: String,
            characteristic: String,
            data: String,
        },
        Disconnect {
            device: String,
        },
    }

    /// What reaches the webview, in the same order.
    #[derive(Debug, PartialEq, Eq)]
    pub(crate) enum Outbound {
        Notification(NotificationPayload),
        Disconnect(DisconnectPayload),
    }

    /// The inbox `android_ble` manages; the test drives the pump with a raw channel instead.
    #[cfg(target_os = "android")]
    pub(crate) type Sender = tokio::sync::mpsc::UnboundedSender<Inbound>;
    pub(crate) type Receiver = tokio::sync::mpsc::UnboundedReceiver<Inbound>;

    /// Drain the channel forever, resolving each notification to the subscription id the web side
    /// keys on and pruning the session on each disconnect. Returns when every sender is gone.
    pub(crate) async fn pump(
        mut rx: Receiver,
        session: Arc<Mutex<BleSession>>,
        mut emit: impl FnMut(Outbound),
    ) {
        while let Some(ev) = rx.recv().await {
            match ev {
                Inbound::Notification {
                    device,
                    characteristic,
                    data,
                } => {
                    let uuid = match cube_ble::parse_uuid(&characteristic) {
                        Ok(uuid) => uuid,
                        Err(e) => {
                            // A characteristic Kotlin can name but Rust cannot parse is a bridge
                            // bug, and the quiet version of it is a cube that connects and then
                            // says nothing.
                            log::error!(
                                "cube-ble: unparseable characteristic {characteristic} from Kotlin: {e}"
                            );
                            continue;
                        }
                    };
                    let sub = subscription_for(&session.lock().await.subscriptions, &device, uuid);
                    match sub {
                        Some(sub) => {
                            emit(Outbound::Notification(NotificationPayload { sub, data }))
                        }
                        None => {
                            // The same sentence, and the same reasoning, as the desktop stream task.
                            log::warn!(
                                "cube-ble: notification for characteristic {uuid} matches no live \
                                 subscription, or more than one — packet dropped"
                            );
                        }
                    }
                }
                Inbound::Disconnect { device } => {
                    // Pruned HERE, in order, so a packet that arrived before the drop still
                    // resolves and one that arrives after it does not — and so the next connect's
                    // subscribe does not find a stale entry and go silent (`release_device`).
                    release_device(&mut *session.lock().await, &device);
                    emit(Outbound::Disconnect(DisconnectPayload { device }));
                }
            }
        }
    }
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
        return android_ble::call(&app, "ble_request_device", options).await;
    }
    let central = default_adapter().await.map_err(|e| e.to_string())?;
    // Asked BEFORE the radio is: a switched-off adapter is refused with its own sentence instead
    // of staring into a twenty-second window and blaming the cube.
    let before = central.adapter_state().await.map_err(|e| e.to_string())?;
    scan_precondition(before.clone())?;
    let found = find_device(&central, &options, Duration::from_secs(20))
        .await
        .map_err(|e| e.to_string())?;
    match found {
        Some((peripheral, dev)) => {
            // Keep BOTH. The peripheral is only usable through the adapter that found it — and
            // ONLY through it: every entry in `discovered` belongs to whichever adapter was current
            // when it was found, so swapping the adapter empties the map rather than leaving
            // peripherals a connect would dispatch to an adapter that no longer exists.
            let mut session = state.0.lock().await;
            session.discovered.clear();
            session.adapter = Some(central);
            session.discovered.insert(dev.id.clone(), peripheral);
            Ok(dev)
        }
        None => {
            let after = central
                .adapter_state()
                .await
                .unwrap_or(CentralState::Unknown);
            Err(nothing_found(after))
        }
    }
}

/// Connect, and start forwarding every notification from this peripheral to the webview.
///
/// The forwarding task resolves each notification's SUBSCRIPTION before emitting. btleplug
/// reports only the characteristic UUID, and the web side keys its characteristic objects on the
/// (service, characteristic) pair — so an unresolved notification is delivered to nothing and the
/// packet is gone. A dropped packet is not cosmetic: a driver takes the first move serial it sees
/// as its gap baseline, so a move lost here is never reported missing.
#[tauri::command]
async fn ble_connect(
    app: AppHandle,
    #[allow(unused_variables)] state: State<'_, CubeState>,
    id: String,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        return android_ble::call(&app, "ble_connect", android_ble::DeviceArgs { id }).await;
    }
    // The adapter and peripheral from the scan that produced this id — not a fresh adapter, whose
    // cache is a different cache and need not contain this device at all.
    let (central, peripheral) = {
        let session = state.0.lock().await;
        // Already connected is a SUCCESS, not a second connection. A repeated connect used to
        // spawn a second forwarding task over the same peripheral, and two tasks resolving the same
        // stream emitted every packet twice — a driver reads that as a serial that goes backwards.
        // The web side's reconnect flow asks this question legitimately after a reload.
        if session.connected.contains_key(&id) {
            return Ok(());
        }
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

    // Each step bounded by CONNECT_TIMEOUT, with a sentence that names the step. btleplug has no
    // timeout of its own here, and a pending connect was a "Connecting…" that never ended.
    tokio::time::timeout(CONNECT_TIMEOUT, peripheral.connect())
        .await
        .map_err(|_| {
            format!(
                "the cube did not answer a connection request within {}s — is it still on and \
                 nearby?",
                CONNECT_TIMEOUT.as_secs()
            )
        })?
        .map_err(|e| e.to_string())?;
    // Discover up front so notifications can resolve, and so the web side's getPrimaryServices()
    // does not race the first packet.
    match tokio::time::timeout(CONNECT_TIMEOUT, peripheral.discover_services()).await {
        Ok(Ok(())) => {}
        Ok(Err(e)) => {
            let _ = peripheral.disconnect().await;
            return Err(e.to_string());
        }
        Err(_) => {
            let _ = peripheral.disconnect().await;
            return Err(format!(
                "connected, but the cube's services did not enumerate within {}s",
                CONNECT_TIMEOUT.as_secs()
            ));
        }
    }
    let stream: NotifyStream =
        match tokio::time::timeout(CONNECT_TIMEOUT, peripheral.notifications()).await {
            Ok(Ok(s)) => s,
            Ok(Err(e)) => {
                let _ = peripheral.disconnect().await;
                return Err(e.to_string());
            }
            Err(_) => {
                let _ = peripheral.disconnect().await;
                return Err(format!(
                    "connected, but the notification stream did not open within {}s",
                    CONNECT_TIMEOUT.as_secs()
                ));
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
                                log::warn!(
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
        )
        .await;
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
        )
        .await;
    }
    let p = state.get(&id).await?;
    cube_ble::discover_characteristics(&p, &service)
        .await
        .map_err(|e| e.to_string())
}

/// Subscribe, and hand back the id that will identify this stream's packets.
///
/// Only the TRANSPORT differs by platform; the bookkeeping is shared on purpose. The subscription
/// id is what the web side keys packets by, so if Android allocated its own the two platforms
/// would be answering the same question with different numbers. And the booking comes FIRST —
/// see `reserve_subscription` for the packet that used to fall into the gap.
#[tauri::command]
async fn ble_subscribe(
    #[allow(unused_variables)] app: AppHandle,
    state: State<'_, CubeState>,
    id: String,
    service: String,
    characteristic: String,
) -> Result<u32, String> {
    let uuid = cube_ble::parse_uuid(&characteristic).map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "android"))]
    let p = state.get(&id).await?;
    let sub_id = reserve_subscription(
        &mut *state.0.lock().await,
        id.clone(),
        service.clone(),
        uuid,
    );
    #[cfg(target_os = "android")]
    let transport = android_ble::call::<_, _, ()>(
        &app,
        "ble_subscribe",
        android_ble::CharArgs {
            id,
            service,
            characteristic,
        },
    )
    .await;
    #[cfg(not(target_os = "android"))]
    let transport = cube_ble::subscribe(&p, &service, &characteristic)
        .await
        .map_err(|e| e.to_string());
    if let Err(e) = transport {
        forget_subscription(&mut *state.0.lock().await, sub_id);
        return Err(e);
    }
    Ok(sub_id)
}

/// Unsubscribe. The bookkeeping goes whatever the transport says: an entry the app asked to end
/// must not keep claiming packets, and for a device that is already GONE the transport's "no
/// connected device" is the answer the app wanted, not an error — the disconnect path pruned the
/// booking already and the web side is only tidying up after it. Every other transport failure
/// is reported, after the booking is dropped.
#[tauri::command]
async fn ble_unsubscribe(
    #[allow(unused_variables)] app: AppHandle,
    state: State<'_, CubeState>,
    id: String,
    service: String,
    characteristic: String,
) -> Result<(), String> {
    let uuid = cube_ble::parse_uuid(&characteristic).map_err(|e| e.to_string())?;
    #[cfg(target_os = "android")]
    let transport = android_ble::call::<_, _, ()>(
        &app,
        "ble_unsubscribe",
        android_ble::CharArgs {
            id: id.clone(),
            service: service.clone(),
            characteristic: characteristic.clone(),
        },
    )
    .await;
    #[cfg(not(target_os = "android"))]
    let transport = match state.get(&id).await {
        Ok(p) => cube_ble::unsubscribe(&p, &service, &characteristic)
            .await
            .map_err(|e| e.to_string()),
        Err(e) => Err(e),
    };
    drop_subscriptions(&mut *state.0.lock().await, &id, &service, uuid);
    match transport {
        Ok(()) => Ok(()),
        Err(e) if e.contains(NOT_CONNECTED) => Ok(()),
        Err(e) => Err(e),
    }
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
        return android_ble::read(&app, id, service, characteristic).await;
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
        )
        .await;
    }
    let p = state.get(&id).await?;
    let bytes = hex::decode(&data).map_err(|e| e.to_string())?;
    cube_ble::write(&p, &service, &characteristic, &bytes, without_response)
        .await
        .map_err(|e| e.to_string())
}

/// Disconnect. On every platform the session forgets the device — peripheral AND subscriptions,
/// through `release_device` — only once the transport has actually let go.
///
/// The Android arm used to return straight from the Kotlin call and never reach the bookkeeping
/// (audit 2026-09-04, mobile A1), which left every subscription for the device in the map; the
/// next connect's subscribe then made a duplicate and `subscription_for` went silent. Kotlin
/// resolves a disconnect for an unknown id too, so an Ok from it always means "not connected now".
#[tauri::command]
async fn ble_disconnect(
    #[allow(unused_variables)] app: AppHandle,
    #[allow(unused_variables)] state: State<'_, CubeState>,
    id: String,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        android_ble::call::<_, _, ()>(
            &app,
            "ble_disconnect",
            android_ble::DeviceArgs { id: id.clone() },
        )
        .await?;
        release_device(&mut *state.0.lock().await, &id);
        return Ok(());
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
//
// Plain AppKit through objc2, no private API: `standardWindowButton:` and `setFrameOrigin:` are
// public, which is why `macOSPrivateApi` / the `macos-private-api` feature were removed on
// 2026-09-05 — nothing here needed them, and the flag is an App Store rejection.
#[cfg(target_os = "macos")]
fn place_traffic_lights(ns_window_ptr: *mut std::ffi::c_void, x: f64, y: f64) {
    use objc2_app_kit::{NSWindow, NSWindowButton};

    // SAFETY: both call sites run on the main thread (setup and window-event callbacks), on a
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

/// Where the dev-only MCP control socket lives: a per-user directory, never shared `/tmp`.
///
/// `/tmp/cubus-mcp.sock` was world-visible and pre-creatable by any local account, and a control
/// socket that hands out arbitrary JS in the app's origin is the one thing on this machine that
/// should not sit in a shared directory. The precedence is `TAURI_MCP_IPC_PATH` (an explicit
/// choice, honoured verbatim) → `$XDG_RUNTIME_DIR` (Linux's per-user, mode-0700 runtime dir) →
/// `$TMPDIR` (macOS's per-user `/var/folders/…/T/`) → `/tmp` as the last resort. The MCP server
/// side must compute the SAME path, and `.mcp.json` cannot expand variables in `env`, so it runs
/// the server through `sh -c` with exactly this precedence spelled out in shell — the two are kept
/// identical by `apps/web/test/csp.test.mjs`, which reads both.
#[cfg(all(feature = "mcp", debug_assertions))]
fn mcp_socket_path() -> std::path::PathBuf {
    mcp_socket_path_from(
        std::env::var_os("TAURI_MCP_IPC_PATH"),
        std::env::var_os("XDG_RUNTIME_DIR"),
        std::env::var_os("TMPDIR"),
    )
}

/// The pure half of [mcp_socket_path], so the precedence can be tested without touching the
/// process environment (tests run in parallel; `set_var` in one is a race in all of them).
#[cfg(any(all(feature = "mcp", debug_assertions), test))]
fn mcp_socket_path_from(
    explicit: Option<std::ffi::OsString>,
    runtime_dir: Option<std::ffi::OsString>,
    tmpdir: Option<std::ffi::OsString>,
) -> std::path::PathBuf {
    const SOCKET: &str = "cubus-mcp.sock";
    let non_empty = |v: Option<std::ffi::OsString>| v.filter(|s| !s.is_empty());
    if let Some(explicit) = non_empty(explicit) {
        return std::path::PathBuf::from(explicit);
    }
    let dir = non_empty(runtime_dir)
        .or_else(|| non_empty(tmpdir))
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from("/tmp"));
    dir.join(SOCKET)
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

    // Self-update, and the relaunch that completes it. EVERY DESKTOP, macOS included.
    //
    // macOS also has a Homebrew cask, and the two coexist because they move together: both follow
    // the same GitHub releases, and the tap updates on `release: published`, within seconds of the
    // manifest the app reads. So `brew upgrade` reinstalls the version the app already has instead
    // of replacing a newer one. The cask deliberately does not declare `auto_updates true`, which
    // leaves both paths working for whoever prefers which.
    //
    // Not a phone, and not the browser build: one goes through a store, the other is whatever the
    // server last served. So this is the same shape as the window's orientation — a capability one
    // build has and another cannot want — and the affordance is drawn behind the same predicate,
    // narrowed by `SELF_UPDATE_PLATFORMS`.
    //
    // The pubkey and endpoint live in tauri.conf.json. An update is verified against that key
    // before it is ever unpacked, which is the whole reason this is safe to ship: the endpoint is
    // plain HTTPS on a public URL, and a signature nobody but the maintainer can produce is what
    // stops that URL from being an install-anything hole.
    #[cfg(desktop)]
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
    // do not listen unless a session asks to. The socket sits in a per-user directory
    // (`mcp_socket_path`); .mcp.json's server side derives the same path.
    #[cfg(all(feature = "mcp", debug_assertions))]
    let builder = if std::env::var_os("CUBUS_MCP").is_some() {
        let socket = mcp_socket_path();
        log::info!("MCP control socket at {}", socket.display());
        builder.plugin(tauri_plugin_mcp::init_with_config(
            tauri_plugin_mcp::PluginConfig::new("cubus".to_string())
                .start_socket_server(true)
                .socket_path(socket),
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
    // connect, subscribe, drop, reconnect, subscribe again. Before `release_device` ran on the
    // disconnect paths, the second subscribe left two entries and the cube went silent.
    #[test]
    fn a_reconnect_does_not_silence_the_cube() {
        let mut s = session_with(&[(0, "cube", 1)]);
        assert_eq!(subscription_for(&s.subscriptions, "cube", uuid(1)), Some(0));

        release_device(&mut s, "cube"); // the disconnect
        assert_eq!(subscription_for(&s.subscriptions, "cube", uuid(1)), None);

        // Re-subscribing after the reconnect, exactly as `ble_subscribe` does.
        let id = reserve_subscription(&mut s, "cube".into(), "service".into(), uuid(1));
        assert_eq!(
            subscription_for(&s.subscriptions, "cube", uuid(1)),
            Some(id),
            "a reconnected cube's packets must still resolve — this is the defect the disconnect \
             paths leaked before they called release_device"
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

    /// Smart-cube B2: the booking exists BEFORE the transport is asked, so the state snapshot a
    /// cube sends the instant its CCCD is written resolves instead of falling into a gap; and a
    /// transport that refuses takes the booking back, so nothing addresses a dead stream.
    #[test]
    fn a_subscription_is_booked_before_the_transport_and_unbooked_on_failure() {
        let mut s = BleSession::default();
        let id = reserve_subscription(&mut s, "cube".into(), "service".into(), uuid(1));
        // The packet that used to be lost: it arrives while the CCCD write is still in flight.
        assert_eq!(
            subscription_for(&s.subscriptions, "cube", uuid(1)),
            Some(id),
            "a packet arriving before the subscribe returns must already resolve"
        );
        forget_subscription(&mut s, id); // the transport refused
        assert_eq!(subscription_for(&s.subscriptions, "cube", uuid(1)), None);
        // Ids are never reused: the next booking is a new number, so a late packet for a
        // forgotten id can never be delivered under a fresh one.
        let next = reserve_subscription(&mut s, "cube".into(), "service".into(), uuid(1));
        assert!(next > id);
    }

    /// `ble_unsubscribe`'s half: the booking goes for exactly the triple asked, whatever the
    /// transport answered.
    #[test]
    fn unsubscribing_drops_exactly_the_triple_asked() {
        let mut s = session_with(&[(0, "cube", 1), (1, "cube", 2), (2, "spare", 1)]);
        drop_subscriptions(&mut s, "cube", "service", uuid(1));
        assert_eq!(subscription_for(&s.subscriptions, "cube", uuid(1)), None);
        assert_eq!(subscription_for(&s.subscriptions, "cube", uuid(2)), Some(1));
        assert_eq!(
            subscription_for(&s.subscriptions, "spare", uuid(1)),
            Some(2)
        );
    }

    /// Smart-cube C5: an adapter that is off is refused with a sentence about Bluetooth, and an
    /// empty scan on a live adapter is a sentence about the cube — the two remedies are different
    /// and used to share one line.
    #[test]
    fn bluetooth_off_and_no_cube_advertising_are_told_apart() {
        let off = scan_precondition(CentralState::PoweredOff).unwrap_err();
        assert!(off.contains("Bluetooth is switched off"), "{off}");
        assert!(scan_precondition(CentralState::PoweredOn).is_ok());
        assert!(
            scan_precondition(CentralState::Unknown).is_ok(),
            "Unknown proceeds — the scan window absorbs CoreBluetooth's first callback"
        );
        let none = nothing_found(CentralState::PoweredOn);
        assert!(none.contains("is it awake"), "{none}");
        let unknown = nothing_found(CentralState::Unknown);
        assert!(unknown.contains("privacy settings"), "{unknown}");
        assert_eq!(nothing_found(CentralState::PoweredOff), off);
    }

    /// D6: the socket lands in a per-user directory by precedence, never in shared /tmp when a
    /// better answer exists, and an explicit path wins verbatim.
    #[test]
    fn the_mcp_socket_prefers_a_per_user_directory() {
        use std::ffi::OsString;
        let os = |s: &str| Some(OsString::from(s));
        assert_eq!(
            mcp_socket_path_from(os("/custom/x.sock"), os("/run/user/1"), os("/var/t")),
            std::path::PathBuf::from("/custom/x.sock")
        );
        assert_eq!(
            mcp_socket_path_from(None, os("/run/user/1"), os("/var/t")),
            std::path::PathBuf::from("/run/user/1/cubus-mcp.sock")
        );
        assert_eq!(
            mcp_socket_path_from(None, None, os("/var/folders/ab/T/")),
            std::path::PathBuf::from("/var/folders/ab/T/cubus-mcp.sock")
        );
        assert_eq!(
            mcp_socket_path_from(os(""), os(""), None),
            std::path::PathBuf::from("/tmp/cubus-mcp.sock"),
            "empty variables count as unset"
        );
    }

    /// Mobile B3 / smart-cube B1: a thousand notifications in, a thousand out, in order — and a
    /// disconnect that rides the same queue prunes the session where it sits in the sequence.
    /// The old shape spawned a task per packet, which is exactly a queue that does not promise
    /// this.
    #[tokio::test]
    async fn the_android_relay_preserves_arrival_order() {
        use relay::{pump, Inbound, Outbound};
        let session = Arc::new(Mutex::new(session_with(&[(7, "cube", 1)])));
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        let characteristic = uuid(1).to_string();
        for i in 0..1000u32 {
            tx.send(Inbound::Notification {
                device: "cube".into(),
                characteristic: characteristic.clone(),
                data: format!("{i:04x}"),
            })
            .unwrap();
        }
        // A packet nothing subscribed to: dropped with a word, and it must not disturb the order
        // of the rest.
        tx.send(Inbound::Notification {
            device: "cube".into(),
            characteristic: uuid(2).to_string(),
            data: "dead".into(),
        })
        .unwrap();
        tx.send(Inbound::Disconnect {
            device: "cube".into(),
        })
        .unwrap();
        // A packet AFTER the disconnect resolves to nothing: the booking is gone.
        tx.send(Inbound::Notification {
            device: "cube".into(),
            characteristic: characteristic.clone(),
            data: "late".into(),
        })
        .unwrap();
        drop(tx);

        let mut out = Vec::new();
        pump(rx, session.clone(), |o| out.push(o)).await;

        assert_eq!(
            out.len(),
            1001,
            "1000 packets and one disconnect; the stray and the late one dropped"
        );
        for (i, o) in out.iter().take(1000).enumerate() {
            assert_eq!(
                *o,
                Outbound::Notification(NotificationPayload {
                    sub: 7,
                    data: format!("{i:04x}")
                }),
                "packet {i} arrived out of order"
            );
        }
        assert_eq!(
            out[1000],
            Outbound::Disconnect(DisconnectPayload {
                device: "cube".into()
            })
        );
        assert!(
            session.lock().await.subscriptions.is_empty(),
            "the disconnect pruned the device's bookings"
        );
    }
}
