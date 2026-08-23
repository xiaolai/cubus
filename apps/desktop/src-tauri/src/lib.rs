// Cubus desktop backend. The Rust side owns native BLE (via crates/gan-ble → btleplug) and
// bridges it to the webview (apps/web): FFF6 notifications are forwarded as `cube-packet` events
// (hex), FFF5 commands come back via `write_fff5`. The browser-safe gan-driver decodes in the
// webview — this is Fork 1 (native BLE bridge, TS decode).

use std::sync::Arc;
use std::time::Duration;

use futures::StreamExt;
use gan_ble::btleplug::api::{Peripheral as _, WriteType};
use gan_ble::btleplug::platform::Peripheral;
use gan_ble::{default_adapter, find_gan_cube, FFF5_WRITE, FFF6_NOTIFY};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;

/// The currently-connected cube (if any).
#[derive(Default)]
struct CubeState(Arc<Mutex<Option<Peripheral>>>);

#[derive(serde::Serialize)]
struct CubeInfo {
    name: String,
    mac: Option<String>,
}

/// Scan → connect → subscribe FFF6. Each notification is emitted to the webview as a
/// `cube-packet` event carrying the raw 20-byte packet as hex; gan-driver decodes it there.
#[tauri::command]
async fn connect_cube(app: AppHandle, state: State<'_, CubeState>) -> Result<CubeInfo, String> {
    let central = default_adapter().await.map_err(|e| e.to_string())?;
    let cube = find_gan_cube(&central, Duration::from_secs(20))
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no GAN cube found — is it awake and advertising?".to_string())?;

    let peripheral = cube.peripheral;
    peripheral.connect().await.map_err(|e| e.to_string())?;
    peripheral.discover_services().await.map_err(|e| e.to_string())?;

    let notify = peripheral
        .characteristics()
        .into_iter()
        .find(|c| c.uuid == FFF6_NOTIFY)
        .ok_or_else(|| "FFF6 notify characteristic not found".to_string())?;
    peripheral.subscribe(&notify).await.map_err(|e| e.to_string())?;

    let mut stream = peripheral.notifications().await.map_err(|e| e.to_string())?;
    let app_for_task = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(v) = stream.next().await {
            let _ = app_for_task.emit("cube-packet", hex::encode(&v.value));
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .manage(CubeState::default())
        .invoke_handler(tauri::generate_handler![
            connect_cube,
            write_fff5,
            disconnect_cube
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
