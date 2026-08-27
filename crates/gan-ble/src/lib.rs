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
    /// Validated: recovered from manufacturer data AND agreeing with the name suffix. This is the
    /// only one safe to derive an AES key from.
    pub mac: Option<String>,
    /// What was recovered before validation. `mac == None` while this is `Some` is the diagnostic
    /// case worth naming: the cube advertises a MAC, but not where we expect it. Without keeping
    /// it, "wrong layout" and "no manufacturer data at all" collapse into the same empty answer,
    /// and they need different fixes.
    pub mac_unvalidated: Option<String>,
}

/// GAN company id has low byte 0x01; the MAC is manufacturer-data payload bytes [3..9],
/// reversed (matches gan-driver/src/mac.ts and afedotov/gan-web-bluetooth).
pub fn mac_from_manufacturer_data(data: &HashMap<u16, Vec<u8>>) -> Option<String> {
    for (company_id, payload) in data {
        if (company_id & 0xff) == 0x01 && payload.len() >= 9 {
            let mac: Vec<String> = payload[3..9]
                .iter()
                .rev()
                .map(|b| format!("{b:02X}"))
                .collect();
            return Some(mac.join(":"));
        }
    }
    None
}

/// Does a recovered MAC agree with the device-name suffix? GAN names carry the last two MAC
/// bytes (e.g. "GAN16ui_C8D3" -> ...:C8:D3), which is a free check that the manufacturer-data
/// layout we assumed is the layout this cube actually uses.
///
/// This mirrors `macMatchesName` in gan-driver/src/mac.ts. Without it the Rust side returns a
/// plausible-but-wrong MAC on any firmware that lays the payload out differently — and a wrong MAC
/// is a wrong AES key, so the cube connects, streams, and decrypts to noise. Loud beats silent:
/// the failure is otherwise indistinguishable from "the cube is broken".
pub fn mac_matches_name(mac: &str, name: &str) -> bool {
    let Some(suffix) = name
        .rsplit('_')
        .next()
        .filter(|s| s.len() == 4 && s.chars().all(|c| c.is_ascii_hexdigit()))
    else {
        return true; // no suffix to check against
    };
    let tail: String = mac.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    tail.len() >= 4 && tail[tail.len() - 4..].eq_ignore_ascii_case(suffix)
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

/// Every peripheral seen during a scan: what the radio actually reported.
///
/// `find_gan_cube` returning None is ambiguous on its own — it means "asleep", "advertising under
/// a name we do not match", or "macOS never granted Bluetooth permission, so we saw nothing at
/// all". Those need different fixes, so a failed scan has to be able to say which it was.
pub async fn scan_all(central: &Adapter, timeout: Duration) -> Result<Vec<(String, bool)>> {
    central.start_scan(ScanFilter::default()).await?;
    tokio::time::sleep(timeout).await;
    let mut seen = Vec::new();
    for p in central.peripherals().await? {
        if let Some(props) = p.properties().await? {
            let name = props.local_name.clone().unwrap_or_default();
            let has_gan_mfr = props.manufacturer_data.keys().any(|id| (id & 0xff) == 0x01);
            seen.push((name, has_gan_mfr));
        }
    }
    central.stop_scan().await?;
    Ok(seen)
}

/// Scan up to `timeout` for a peripheral whose advertised name starts with "GAN".
/// Returns None if none is seen (the cube may be asleep). Leaves scanning stopped.
pub async fn find_gan_cube(central: &Adapter, timeout: Duration) -> Result<Option<GanCube>> {
    central.start_scan(ScanFilter::default()).await?;
    let deadline = tokio::time::Instant::now() + timeout;
    let found = 'scan: loop {
        for p in central.peripherals().await? {
            let Some(props) = p.properties().await? else {
                continue;
            };
            let name = props.local_name.clone().unwrap_or_default();
            if name.starts_with("GAN") {
                // A MAC that disagrees with the name is WORSE than no MAC, so it is discarded
                // rather than passed on. No MAC gives the caller a clear "cannot derive the key"
                // error; a wrong one derives a wrong AES key, and the cube then connects, streams,
                // and decrypts to noise — indistinguishable from broken hardware.
                // The diagnostic CLI applied this check; the production path did not, which left
                // the Tauri backend accepting exactly what the CLI would have refused.
                let raw = mac_from_manufacturer_data(&props.manufacturer_data);
                let mac = raw.clone().filter(|m| mac_matches_name(m, &name));
                break 'scan Some(GanCube {
                    mac,
                    mac_unvalidated: raw,
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

#[cfg(test)]
mod tests {
    use super::*;

    // The real advertisement from a GAN16 ui, recorded 2026-08-19 (see gan-driver/src/mac.ts):
    // company id 0xXX01, MAC at payload bytes 3..9 reversed, name suffix = last two MAC bytes.
    fn mfr(payload: Vec<u8>) -> HashMap<u16, Vec<u8>> {
        HashMap::from([(0x0001u16, payload)])
    }

    #[test]
    fn recovers_the_mac_from_payload_bytes_3_to_9_reversed() {
        let data = mfr(vec![0, 0, 0, 0xD3, 0xC8, 0x5B, 0x34, 0x12, 0xAB]);
        assert_eq!(
            mac_from_manufacturer_data(&data).as_deref(),
            Some("AB:12:34:5B:C8:D3")
        );
    }

    #[test]
    fn ignores_manufacturer_data_that_is_not_gan() {
        let data = HashMap::from([(0x004Cu16, vec![0; 12])]); // Apple
        assert_eq!(mac_from_manufacturer_data(&data), None);
    }

    #[test]
    fn refuses_a_payload_too_short_to_hold_a_mac() {
        assert_eq!(mac_from_manufacturer_data(&mfr(vec![0; 8])), None);
    }

    // A wrong MAC is a wrong AES key, and the symptom is a cube that connects and streams noise.
    // The name suffix is the only free evidence that the layout assumption held.
    #[test]
    fn name_suffix_confirms_a_correctly_recovered_mac() {
        assert!(mac_matches_name("AB:12:34:5B:C8:D3", "GAN16ui_C8D3"));
    }

    #[test]
    fn name_suffix_rejects_a_mac_from_a_different_layout() {
        assert!(!mac_matches_name("D3:C8:5B:34:12:AB", "GAN16ui_C8D3"));
    }

    #[test]
    fn a_name_without_a_suffix_cannot_confirm_or_deny() {
        assert!(mac_matches_name("AB:12:34:5B:C8:D3", "GAN"));
    }
}
