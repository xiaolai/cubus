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
//! `ble-disconnect` that the desktop emits. Rust receives on the channel and re-emits those two, so
//! the JS cannot tell which half produced them.
//!
//! NOT VERIFIED. Every line here compiles for `aarch64-linux-android` and none of it has spoken to
//! a radio. `NATIVE_BLE_UNSUPPORTED` in ble-bridge.js still lists 'android' — see the flip note
//! there. Compiling is not evidence; the crate this replaces says so itself.

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::plugin::PluginHandle;
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// The handle to `BlePlugin`, put in managed state at setup.
pub struct AndroidBle<R: Runtime>(pub PluginHandle<R>);

/// One event out of Kotlin. `event` names which of the two globals to re-emit; the rest is the
/// payload shape `ble-bridge.js` already validates, field for field.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KotlinEvent {
    pub event: String,
    pub device: String,
    #[serde(default)]
    pub service: String,
    #[serde(default)]
    pub characteristic: String,
    /// Base64. JSON cannot carry bytes, and a lossy encoding here corrupts a protocol silently.
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
    pub data: String,
    pub with_response: bool,
}

/// The plugin that registers the Kotlin half and gives it the channel it reports on.
///
/// Registered from `run()` like any other plugin. It carries no commands of its own — the nine
/// `ble_*` names stay exactly where they were, which is the whole point.
pub fn plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::<R>::new("cube-ble")
        .setup(|app, api| {
            let handle = api.register_android_plugin("im.cubus.app", "BlePlugin")?;
            let relay_to = app.clone();
            // Kotlin holds this for the process's life and sends every notification and disconnect
            // down it. Decoding failures are logged rather than swallowed: a packet that does not
            // parse is a protocol change, and the quiet version of this bug is a cube that appears
            // to connect and then says nothing.
            let channel = Channel::new(move |body: tauri::ipc::InvokeResponseBody| {
                match body.deserialize::<KotlinEvent>() {
                    Ok(ev) => relay(&relay_to, ev),
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

/// Re-emit one Kotlin event as the global the web side is already listening for.
///
/// A notification is RE-KEYED on the way through. Kotlin reports (device, service, characteristic)
/// because that is what a GATT callback knows; `ble-bridge.js` expects `{ sub, data }`, because a
/// subscription id is what crosses the boundary per packet instead of three strings that never
/// change within a session. The map is `CubeState`'s, so the Kotlin half never learns that ids
/// exist — and a packet for a subscription that has gone is dropped with a word, exactly as the
/// desktop path does, rather than reaching the web side with an id that means nothing.
pub fn relay<R: Runtime>(app: &AppHandle<R>, ev: KotlinEvent) {
    match ev.event.as_str() {
        "ble-notification" => {
            let _ = app.emit("ble-notification", ev);
        }
        "ble-disconnect" => {
            let _ = app.emit("ble-disconnect", ev);
        }
        other => {
            // Loud rather than dropped: an event Kotlin invented and Rust does not relay is a
            // packet path that silently ends here, which looks like a cube that stopped talking.
            log::warn!("cube-ble: Kotlin sent an event this build does not relay: {other}");
        }
    }
}

/// What Kotlin resolves a read with. Base64, because JSON cannot carry bytes.
#[derive(Deserialize)]
struct ReadReply {
    data: String,
}

/// `ble_read` hands the web side base64 directly; Kotlin wraps it in an object, so unwrap it here
/// rather than changing either side's shape.
pub fn read<R: Runtime>(
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
    )?;
    Ok(reply.data)
}

/// Ask the Kotlin plugin for one command, decoding whatever it resolves with.
pub fn call<R: Runtime, A: Serialize, T: serde::de::DeserializeOwned>(
    app: &AppHandle<R>,
    command: &str,
    args: A,
) -> Result<T, String> {
    let state = app
        .try_state::<AndroidBle<R>>()
        .ok_or_else(|| "cube-ble: the Android plugin was not registered at setup".to_string())?;
    state
        .0
        .run_mobile_plugin::<T>(command, args)
        .map_err(|e| format!("cube-ble (android): {e}"))
}
