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
        println!("no GAN cube seen in 20s — is it awake and advertising?");
        return Ok(());
    };
    println!("found: {}", cube.name);
    match &cube.mac {
        Some(mac) => println!("  ✓ MAC recovered from manufacturer data: {mac}"),
        None => println!("  ✗ no MAC found in manufacturer data"),
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
    println!("✓ received {n} packets — native BLE works. The Tauri backend wraps this lib.");
    let _ = p.disconnect().await;
    Ok(())
}
