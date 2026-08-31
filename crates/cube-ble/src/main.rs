// Standalone hardware check for the cube-ble bridge: scan, and say what the radio actually saw.
//
// The library half has no cube brand in it (see lib.rs), so neither does this. It takes name
// prefixes on the command line, which is how a cube whose protocol nothing here recognises still
// gets looked at:
//
//   cargo run -p cube-ble                 -- every advertising device
//   cargo run -p cube-ble -- GAN QY-QYSC  -- only those prefixes
//
// Allow the "Terminal wants to use Bluetooth" prompt, and keep the cube moving — most smart cubes
// stop advertising when they are still.

use cube_ble::{default_adapter, find_device, scan_all, DeviceFilter, RequestOptions};
use std::time::Duration;

#[tokio::main]
async fn main() -> cube_ble::Result<()> {
    let prefixes: Vec<String> = std::env::args().skip(1).collect();
    let central = default_adapter().await?;

    if prefixes.is_empty() {
        println!("scanning 8s for anything advertising…");
        report(&scan_all(&central, Duration::from_secs(8)).await?);
        return Ok(());
    }

    let opts = RequestOptions {
        filters: prefixes
            .iter()
            .map(|p| DeviceFilter {
                name_prefix: Some(p.clone()),
                ..Default::default()
            })
            .collect(),
        ..Default::default()
    };
    println!("scanning up to 20s for {prefixes:?} (keep the cube moving)…");

    match find_device(&central, &opts, Duration::from_secs(20)).await? {
        Some((_peripheral, dev)) => {
            println!("FOUND  {}", dev.name);
            println!("  id    {}", dev.id);
            println!("  rssi  {:?}", dev.rssi);
            println!("  svcs  {:?}", dev.services);
            // Printed raw rather than parsed: which bytes are a MAC is per-brand knowledge that
            // lives in the protocol layer, not here.
            println!("  mfr   {:?}", dev.manufacturer_data);
        }
        None => {
            // "Not found" has three causes and three different fixes. Say which.
            println!("nothing matched {prefixes:?}. What the radio DID see:");
            report(&scan_all(&central, Duration::from_secs(6)).await?);
        }
    }
    Ok(())
}

fn report(seen: &[cube_ble::AdvertisedDevice]) {
    if seen.is_empty() {
        println!("  (nothing at all — the OS most likely denied Bluetooth to this program.");
        println!("   On macOS: System Settings > Privacy & Security > Bluetooth.)");
        return;
    }
    for d in seen {
        let label = if d.name.is_empty() {
            "<no advertised name>"
        } else {
            &d.name
        };
        println!(
            "  {label}  rssi={:?}  services={}  mfr-ids={:?}",
            d.rssi,
            d.services.len(),
            d.manufacturer_data.keys().collect::<Vec<_>>()
        );
    }
}
