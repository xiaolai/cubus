// Proof binary for the gan-ble bridge: scan -> recover MAC -> subscribe FFF6 -> print packets.
// The Tauri backend uses the same lib (src/lib.rs); this is the standalone hardware check.
//
// Run:  cargo run -p gan-ble    (allow the "Terminal wants to use Bluetooth" prompt; keep the cube moving)

use btleplug::api::Peripheral as _;
use futures::stream::StreamExt;
use gan_ble::{default_adapter, find_gan_cube, FFF6_NOTIFY};
use std::time::Duration;

#[tokio::main]
async fn main() -> gan_ble::Result<()> {
    let central = default_adapter().await?;
    println!("scanning up to 20s for a GAN cube (keep it moving so it advertises)…");

    let Some(cube) = find_gan_cube(&central, Duration::from_secs(20)).await? else {
        // "not found" has three different causes and three different fixes. Say which.
        println!("no cube matched the name filter (\"GAN\"…). What the radio DID see:");
        let seen = gan_ble::scan_all(&central, Duration::from_secs(6)).await?;
        if seen.is_empty() {
            println!("  (nothing at all — macOS most likely denied Bluetooth to this program.");
            println!("   Check System Settings ▸ Privacy & Security ▸ Bluetooth.)");
        } else {
            for (name, gan_mfr) in &seen {
                let label = if name.is_empty() {
                    "<no advertised name>"
                } else {
                    name
                };
                println!(
                    "  {label}{}",
                    if *gan_mfr {
                        "   [GAN manufacturer data!]"
                    } else {
                        ""
                    }
                );
            }
            if seen.iter().any(|(_, g)| *g) {
                println!("\n  ^ something is broadcasting GAN manufacturer data but its name does");
                println!("    not start with \"GAN\" — the name filter is what is rejecting it.");
            } else {
                println!(
                    "\n  No GAN manufacturer data anywhere: the cube is asleep. Turn it and retry."
                );
            }
        }
        // Non-zero exit: a scan that found nothing is a failed check, and a caller that only reads
        // the exit code must not record it as a pass.
        return Err("no GAN cube found".into());
    };
    println!("found: {}", cube.name);
    match (&cube.mac, &cube.mac_unvalidated) {
        (Some(mac), _) => {
            println!("  ✓ MAC recovered from manufacturer data: {mac}");
        }
        (None, Some(mac)) => {
            println!(
                "  ✗ MAC recovered as {mac}, but it disagrees with the name {}",
                cube.name
            );
            println!("    The name's last 4 hex digits should be the MAC's last 2 bytes.");
            println!("    This cube lays its manufacturer data out differently — the derived AES");
            println!("    key would be wrong, and every packet would decrypt to noise.");
        }
        (None, None) => {
            println!("  ✗ no MAC found in manufacturer data — cannot derive the AES key")
        }
    }

    let p = cube.peripheral;
    println!("connecting…");
    p.connect().await?;
    p.discover_services().await?;

    let notify = p
        .characteristics()
        .into_iter()
        .find(|c| c.uuid == FFF6_NOTIFY)
        .ok_or("FFF6 notify characteristic not found")?;
    p.subscribe(&notify).await?;

    println!("subscribed to FFF6 — encrypted state packets follow (turn the cube):");
    let mut stream = p.notifications().await?;
    let mut n = 0u32;
    while let Some(v) = stream.next().await {
        println!("  FFF6 [{:>2} bytes] {:02x?}", v.value.len(), v.value);
        n += 1;
        if n >= 20 {
            break;
        }
    }
    let _ = p.disconnect().await;
    // Zero packets used to print the same checkmark as twenty. A stream that ends immediately —
    // because the cube slept, or the link dropped — is the failure this tool exists to catch, and
    // reporting it as success is worse than not running at all.
    if n == 0 {
        return Err(
            "subscribed to FFF6 but received NO packets — cube asleep, or link dropped".into(),
        );
    }
    println!("✓ received {n} packets — native BLE works. The Tauri backend wraps this lib.");
    Ok(())
}
