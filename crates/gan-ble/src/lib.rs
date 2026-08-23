//! Native GAN-cube BLE bridge (btleplug) — the stack the Tauri backend uses.
//!
//! Exposes the load-bearing primitives proven by the spike: find the cube, recover its
//! MAC from advertisement manufacturer data, and reach the FFF6 (notify) / FFF5 (write)
//! characteristics. Decode stays in the TypeScript driver (gan-driver); this crate only
//! moves raw encrypted packets — the native reach that Web Bluetooth lacks on iOS/Safari.

pub use btleplug;

use btleplug::api::{Central, Manager as _, Peripheral as _, ScanFilter};
use btleplug::platform::{Adapter, Manager, Peripheral};
use std::collections::HashMap;
use std::time::Duration;
use uuid::Uuid;

pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;

/// GAN16 ui uses standard 16-bit UUIDs under the Bluetooth base.
pub const FFF6_NOTIFY: Uuid = Uuid::from_u128(0x0000fff6_0000_1000_8000_00805f9b34fb);
pub const FFF5_WRITE: Uuid = Uuid::from_u128(0x0000fff5_0000_1000_8000_00805f9b34fb);

/// A discovered GAN cube: the peripheral plus its advertised name and recovered MAC.
pub struct GanCube {
    pub peripheral: Peripheral,
    pub name: String,
    pub mac: Option<String>,
}

/// GAN company id has low byte 0x01; the MAC is manufacturer-data payload bytes [3..9],
/// reversed (matches gan-driver/src/mac.ts and afedotov/gan-web-bluetooth).
pub fn mac_from_manufacturer_data(data: &HashMap<u16, Vec<u8>>) -> Option<String> {
    for (company_id, payload) in data {
        if (company_id & 0xff) == 0x01 && payload.len() >= 9 {
            let mac: Vec<String> = payload[3..9].iter().rev().map(|b| format!("{b:02X}")).collect();
            return Some(mac.join(":"));
        }
    }
    None
}

/// First available BLE adapter.
pub async fn default_adapter() -> Result<Adapter> {
    let manager = Manager::new().await?;
    manager
        .adapters()
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| "no BLE adapter".into())
}

/// Scan up to `timeout` for a peripheral whose advertised name starts with "GAN".
/// Returns None if none is seen (the cube may be asleep). Leaves scanning stopped.
pub async fn find_gan_cube(central: &Adapter, timeout: Duration) -> Result<Option<GanCube>> {
    central.start_scan(ScanFilter::default()).await?;
    let deadline = tokio::time::Instant::now() + timeout;
    let found = 'scan: loop {
        for p in central.peripherals().await? {
            let Some(props) = p.properties().await? else { continue };
            let name = props.local_name.clone().unwrap_or_default();
            if name.starts_with("GAN") {
                break 'scan Some(GanCube {
                    mac: mac_from_manufacturer_data(&props.manufacturer_data),
                    name,
                    peripheral: p,
                });
            }
        }
        if tokio::time::Instant::now() >= deadline {
            break 'scan None;
        }
        tokio::time::sleep(Duration::from_millis(400)).await;
    };
    central.stop_scan().await?;
    Ok(found)
}
