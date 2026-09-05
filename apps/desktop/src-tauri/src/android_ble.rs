//! The Android side of the `ble_*` commands: forward to the Kotlin plugin, keep the seam.
//!
//! WHY THIS EXISTS AT ALL. btleplug — which every other platform's BLE goes through — compiles for
//! Android and then panics on the first adapter call, because its droidplug backend needs Java
//! classes in the APK and `platform::init(&env)` with a JNIEnv. Supplying those means vendoring and
//! building two third-party Java trees, one of which (jni-utils) is published only as a SNAPSHOT.
//! `gen/android/.../BlePlugin.kt` does the same job in Kotlin instead, which is the answer the
//! ecosystem converged on for exactly this reason.
//!
//! WHY IT LOOKS LIKE THIS. The nine command NAMES do not change, and neither do the two events. The
//! web side (`apps/web/lib/ble-bridge.js`) is written against them and is deliberately platform-
//! blind; a Tauri plugin of our own would have renamed all of them to `plugin:cube-ble|…` and made
//! Android a different app, which is the thing AGENTS.md's seam rule exists to prevent. So each
//! command keeps its identity and only its BODY differs, by an early return in the command itself.
//!
//! Notifications come back on a CHANNEL rather than the plugin's `trigger`, because `trigger` only
//! reaches listeners registered from JS and the app listens for the global `ble-notification` /
//! `ble-disconnect` that the desktop emits. Rust receives on the channel, hands each event to ONE
//! long-lived relay task (`crate::relay::pump`) in arrival order, and that task re-emits those two
//! globals, so the JS cannot tell which half produced them — and cannot see two packets swapped.
//!
//! EVERY CALL INTO KOTLIN LEAVES THE ASYNC RUNTIME. `run_mobile_plugin` blocks the calling thread
//! until Kotlin resolves — up to the plugin's own 10 s GATT deadline, or a 20 s scan — and the
//! commands calling it are `async fn`s on tokio's worker pool. A few concurrent BLE commands could
//! park every worker and stall the whole app's IPC (audit 2026-09-04, mobile B4). `spawn_blocking`
//! moves the wait onto the blocking pool, which is what that pool is for.
//!
//! NOT VERIFIED. Every line here compiles for `aarch64-linux-android` and none of it has spoken to
//! a radio. `NATIVE_BLE_UNSUPPORTED` in ble-bridge.js still lists 'android' — see the flip note
//! there. Compiling is not evidence; the crate this replaces says so itself.

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::plugin::PluginHandle;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::relay::{self, Inbound, Outbound};

/// The handle to `BlePlugin`, put in managed state at setup.
pub struct AndroidBle<R: Runtime>(pub PluginHandle<R>);

/// The relay pump's inbox, put in managed state at setup. Sending never blocks and never fails
/// while the pump lives, which is the process's lifetime.
pub struct RelayInbox(pub relay::Sender);

/// One event out of Kotlin. `event` names which of the two globals to re-emit; the rest is what a
/// GATT callback knows, which is NOT what `ble-bridge.js` validates — a notification is re-keyed
/// to `{ sub, data }` by the relay pump before it reaches the web side. Only `device` crosses
/// unchanged, and only the disconnect event needs it to.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KotlinEvent {
    pub event: String,
    pub device: String,
    #[serde(default)]
    pub service: String,
    #[serde(default)]
    pub characteristic: String,
    /// HEX, matching `NotificationPayload.data` and every other byte-carrying field on this
    /// boundary. Not base64: `ble-polyfill.js`'s `toBytes` throws on a non-hex string, and the
    /// strings that happen to be valid hex AND valid base64 are the dangerous ones — they decode
    /// to different bytes without complaint.
    #[serde(default)]
    pub data: String,
}

#[derive(Serialize)]
struct ChannelArgs {
    channel: Channel,
}

#[derive(Serialize)]
pub struct DeviceArgs {
    pub id: String,
}

#[derive(Serialize)]
pub struct ServiceArgs {
    pub id: String,
    pub service: String,
}

#[derive(Serialize)]
pub struct CharArgs {
    pub id: String,
    pub service: String,
    pub characteristic: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteArgs {
    pub id: String,
    pub service: String,
    pub characteristic: String,
    /// Hex, passed through from the web side exactly as the desktop path receives it.
    pub data: String,
    pub with_response: bool,
}

/// The plugin that registers the Kotlin half, gives it the channel it reports on, and starts the
/// one relay task that drains that channel in order.
///
/// Registered from `run()` like any other plugin. It carries no commands of its own — the nine
/// `ble_*` names stay exactly where they were, which is the whole point.
pub fn plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::<R>::new("cube-ble")
        .setup(|app, api| {
            let handle = api.register_android_plugin("im.cubus.app", "BlePlugin")?;

            // The relay: one FIFO, one consumer, for the process's life. The session it prunes and
            // resolves against is the SAME `CubeState` the commands book subscriptions in, so the
            // two platforms never answer "which subscription" with different numbers.
            let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<Inbound>();
            let session = app.state::<crate::CubeState>().0.clone();
            let emitter = app.clone();
            tauri::async_runtime::spawn(relay::pump(rx, session, move |out| match out {
                Outbound::Notification(p) => {
                    let _ = emitter.emit("ble-notification", p);
                }
                Outbound::Disconnect(p) => {
                    let _ = emitter.emit("ble-disconnect", p);
                }
            }));
            app.manage(RelayInbox(tx));

            let inbox = app.clone();
            // Kotlin holds this for the process's life and sends every notification and disconnect
            // down it. Decoding failures are logged rather than swallowed: a packet that does not
            // parse is a protocol change, and the quiet version of this bug is a cube that appears
            // to connect and then says nothing.
            let channel = Channel::new(move |body: tauri::ipc::InvokeResponseBody| {
                match body.deserialize::<KotlinEvent>() {
                    Ok(ev) => relay_event(&inbox, ev),
                    Err(e) => log::warn!("cube-ble: undecodable event from Kotlin: {e}"),
                }
                Ok(())
            });
            handle
                .run_mobile_plugin::<()>("ble_set_event_channel", ChannelArgs { channel })
                .map_err(|e| format!("cube-ble: could not hand Kotlin its event channel: {e}"))?;
            app.manage(AndroidBle(handle));
            Ok(())
        })
        .build()
}

/// Hand one Kotlin event to the relay pump, in the order it arrived.
///
/// The channel callback runs on whichever thread the JNI bridge calls it from — not a runtime
/// worker, and not somewhere a lock may be awaited — so this does the one thing that is safe from
/// anywhere: an unbounded, non-blocking send. The pump does the parsing, the lookup under the
/// session mutex, the pruning and the emit, sequentially, so a disconnect cannot overtake the
/// packets before it and two packets cannot swap.
///
/// An event Kotlin invented and Rust does not relay is logged rather than dropped: a packet path
/// that silently ends here looks like a cube that stopped talking.
pub fn relay_event<R: Runtime>(app: &AppHandle<R>, ev: KotlinEvent) {
    let inbound = match ev.event.as_str() {
        "ble-notification" => Inbound::Notification {
            device: ev.device,
            characteristic: ev.characteristic,
            data: ev.data,
        },
        "ble-disconnect" => Inbound::Disconnect { device: ev.device },
        other => {
            log::warn!("cube-ble: Kotlin sent an event this build does not relay: {other}");
            return;
        }
    };
    match app.try_state::<RelayInbox>() {
        Some(inbox) => {
            if inbox.0.send(inbound).is_err() {
                log::error!("cube-ble: the relay pump is gone — a Kotlin event was dropped");
            }
        }
        None => log::error!("cube-ble: an event arrived before the relay was managed — dropped"),
    }
}

/// What Kotlin resolves a read with. HEX, because that is what this boundary speaks everywhere
/// else — `ble_read` returns `hex::encode`, `ble_write` takes `hex::decode`, and
/// `ble-polyfill.js`'s `toBytes` throws on anything that is not hex. This said base64 for as long
/// as the Kotlin side did, and stayed saying it for a moment after the code was corrected.
#[derive(Deserialize)]
struct ReadReply {
    data: String,
}

/// `ble_read` hands the web side hex directly; Kotlin wraps it in an object, so unwrap it here
/// rather than changing either side's shape.
pub async fn read<R: Runtime>(
    app: &AppHandle<R>,
    id: String,
    service: String,
    characteristic: String,
) -> Result<String, String> {
    let reply: ReadReply = call(
        app,
        "ble_read",
        CharArgs {
            id,
            service,
            characteristic,
        },
    )
    .await?;
    Ok(reply.data)
}

/// Ask the Kotlin plugin for one command, decoding whatever it resolves with — off the async
/// runtime's workers, because the call blocks until Kotlin answers (see the module note).
pub async fn call<
    R: Runtime,
    A: Serialize + Send + 'static,
    T: serde::de::DeserializeOwned + Send + 'static,
>(
    app: &AppHandle<R>,
    command: &str,
    args: A,
) -> Result<T, String> {
    let handle = app
        .try_state::<AndroidBle<R>>()
        .ok_or_else(|| "cube-ble: the Android plugin was not registered at setup".to_string())?
        .0
        .clone();
    let command = command.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        handle
            .run_mobile_plugin::<T>(&command, args)
            .map_err(|e| format!("cube-ble (android): {e}"))
    })
    .await
    .map_err(|e| format!("cube-ble (android): the call to Kotlin panicked or was cancelled: {e}"))?
}
