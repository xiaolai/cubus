// GAN cube BLE spike — btleplug, the same native BLE stack Tauri uses (via tauri-plugin-blec).
//
// Proves the load-bearing unknowns for a Tauri/Rust BLE bridge on macOS:
//   1. can native BLE SEE the cube and read its advertisement MANUFACTURER DATA (-> recover the MAC)?
//   2. can it CONNECT and SUBSCRIBE to FFF6 (-> the encrypted state packets the TS driver decodes)?
// Decode is already proven by gan-driver; this only tests the native BLE reach that Web Bluetooth
// lacks on iOS/Safari — the exact thing that makes a cross-platform Tauri app possible.
//
// Run:  cargo run     (allow the "Terminal wants to use Bluetooth" prompt; keep the cube moving)

use btleplug::api::{Central, Manager as _, Peripheral as _, ScanFilter};
use btleplug::platform::{Adapter, Manager};
use futures::stream::StreamExt;
use std::collections::HashMap;
use std::time::Duration;
use uuid::Uuid;

// GAN16 ui exposes standard 16-bit UUIDs under the Bluetooth base; FFF6 is the notify characteristic.
const FFF6_NOTIFY: Uuid = Uuid::from_u128(0x0000fff6_0000_1000_8000_00805f9b34fb);

// GAN company id has low byte 0x01; the MAC is manufacturer-data payload bytes [3..9], reversed.
// (Matches gan-driver/src/mac.ts and afedotov/gan-web-bluetooth.)
fn mac_from_manufacturer_data(data: &HashMap<u16, Vec<u8>>) -> Option<String> {
    for (company_id, payload) in data {
        if (company_id & 0xff) == 0x01 && payload.len() >= 9 {
            let mac: Vec<String> = payload[3..9].iter().rev().map(|b| format!("{b:02X}")).collect();
            return Some(mac.join(":"));
        }
    }
    None
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let manager = Manager::new().await?;
    let central: Adapter = manager.adapters().await?.into_iter().next().ok_or("no BLE adapter")?;

    println!("scanning up to 20s for a GAN cube (keep it moving so it advertises)…");
    central.start_scan(ScanFilter::default()).await?;

    let mut cube = None;
    'scan: for _ in 0..40 {
        for p in central.peripherals().await? {
            let Some(props) = p.properties().await? else { continue };
            let name = props.local_name.unwrap_or_default();
            if name.starts_with("GAN") {
                println!("found: {name}");
                match mac_from_manufacturer_data(&props.manufacturer_data) {
                    Some(mac) => println!("  ✓ MAC recovered from manufacturer data: {mac}"),
                    None => println!("  ✗ no MAC found; manufacturer_data = {:02x?}", props.manufacturer_data),
                }
                cube = Some(p);
                break 'scan;
            }
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    central.stop_scan().await?;

    let Some(cube) = cube else {
        println!("no GAN cube seen in 20s — is it awake and advertising?");
        return Ok(());
    };

    println!("connecting…");
    cube.connect().await?;
    cube.discover_services().await?;

    let notify = cube
        .characteristics()
        .into_iter()
        .find(|c| c.uuid == FFF6_NOTIFY)
        .ok_or("FFF6 notify characteristic not found")?;
    cube.subscribe(&notify).await?;

    println!("subscribed to FFF6 — encrypted state packets follow (turn the cube):");
    let mut stream = cube.notifications().await?;
    let mut n = 0u32;
    while let Some(v) = stream.next().await {
        println!("  FFF6 [{:>2} bytes] {:02x?}", v.value.len(), v.value);
        n += 1;
        if n >= 20 {
            break;
        }
    }
    println!("✓ received {n} packets — native BLE (scan + MAC + notify) works. A Tauri app wraps exactly this.");
    let _ = cube.disconnect().await;
    Ok(())
}
