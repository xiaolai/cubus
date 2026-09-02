//! A brand-agnostic BLE bridge — the native half of `navigator.bluetooth`.
//!
//! Web Bluetooth exists on exactly one of this project's shipping targets. Not WKWebView (macOS,
//! iOS), not Android WebView, not WebView2, not WebKitGTK. The protocol layer
//! (`smartcube-web-bluetooth`) is a Web Bluetooth library with no packet-level entry point, so on
//! every packaged build it needs an implementation of that API backed by something that can
//! actually reach the radio. This crate is that something; `apps/web/lib/ble-polyfill.js` is the
//! shape it wears. See `dev-docs/universal-cube-driver.md` §3-4.
//!
//! **There is no cube brand in this file, and that is a requirement rather than a preference.**
//! The predecessor (`gan-ble`) hardcoded a "GAN" name prefix, the FFF5/FFF6 characteristic UUIDs,
//! and GAN's manufacturer-data layout for MAC recovery. Every one of those is per-brand knowledge
//! that the protocol layer already holds — for ten protocols, not one — so keeping a second copy
//! here means two places that must agree about a brand, which is the exact failure this whole
//! design exists to avoid. `crates/cube-ble/tests/no_brand_constants.rs` enforces it.
//!
//! Where the MAC went: recovering it from manufacturer data is brand-specific (company-id list and
//! byte order differ), so this crate reports the manufacturer data verbatim and the library
//! extracts it per protocol. That is not a downgrade. The library then proves the MAC by requiring
//! a *legally decodable cube state* within ten seconds of connecting — a stronger check than the
//! name-suffix comparison this crate used to do, because it tests the key rather than the layout.

pub use btleplug;
// Re-exported for the same reason as btleplug: this crate hands back types that CONTAIN a Uuid
// (and `parse_uuid` returns one), so a consumer has to be able to name it without taking its own
// dependency and risking a version skew that would make the two Uuids different types.
pub use uuid;

use btleplug::api::{
    Central, CharPropFlags, Characteristic, Peripheral as _, ScanFilter, WriteType,
};
// `Manager` and its trait exist only on the path that actually opens an adapter, which Android
// does not have — see default_adapter. Importing them unconditionally is an unused-import warning
// there, and a warning nobody can act on is how real ones stop being read.
#[cfg(not(target_os = "android"))]
use btleplug::api::Manager as _;
#[cfg(not(target_os = "android"))]
use btleplug::platform::Manager;
use btleplug::platform::{Adapter, Peripheral};
use std::collections::HashMap;
use std::time::Duration;
use uuid::Uuid;

pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;

/// One entry of Web Bluetooth's `filters` array. A device matches a filter when every field the
/// filter sets is satisfied; it matches the request when it satisfies any one filter.
#[derive(serde::Serialize, Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceFilter {
    pub name: Option<String>,
    pub name_prefix: Option<String>,
    #[serde(default)]
    pub services: Vec<String>,
    /// Manufacturer-data criteria. NOT optional to support: the protocol layer emits
    /// manufacturer-ONLY filters alongside its name filters (`filters.push({ manufacturerData:
    /// [{ companyIdentifier }] })`), which is how it finds a cube advertising without a
    /// recognisable name. Ignoring them made every such device invisible to the native scan while
    /// the browser build found it — the two builds silently disagreeing about what exists.
    #[serde(default)]
    pub manufacturer_data: Vec<ManufacturerDataFilter>,
}

#[derive(serde::Serialize, Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManufacturerDataFilter {
    pub company_identifier: u16,
    /// Hex. Web Bluetooth also defines a `mask`; the protocol layer does not use one, so matching
    /// a prefix it never sends would be untested code pretending to be a feature.
    pub data_prefix: Option<String>,
}

/// The subset of `requestDevice` options this bridge acts on.
#[derive(serde::Serialize, Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestOptions {
    #[serde(default)]
    pub filters: Vec<DeviceFilter>,
    /// Present for API fidelity and deliberately unused for access control.
    ///
    /// In a browser this list is a permission boundary: a service absent from it is unreachable.
    /// Here the user has already granted Bluetooth to the whole application, so re-implementing
    /// the browser's gate would add a second place to keep a UUID list correct without adding any
    /// security. Recorded rather than silently dropped.
    #[serde(default)]
    pub optional_services: Vec<String>,
    #[serde(default)]
    pub accept_all_devices: bool,
}

/// What a scan saw. `manufacturer_data` is passed through untouched — the protocol layer reads a
/// MAC out of it per brand, and this crate deliberately does not know how.
#[derive(serde::Deserialize, Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvertisedDevice {
    /// Stable within a session. On macOS this is CoreBluetooth's per-host UUID, not a hardware
    /// address — which is exactly why the MAC has to come out of the advertisement instead.
    pub id: String,
    pub name: String,
    /// Company identifier -> payload, hex-encoded for the webview boundary.
    pub manufacturer_data: HashMap<u16, String>,
    pub services: Vec<String>,
    pub rssi: Option<i16>,
}

#[derive(serde::Deserialize, Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacteristicInfo {
    pub uuid: String,
    pub properties: CharacteristicProperties,
}

/// The property flags Web Bluetooth exposes on a characteristic.
#[derive(serde::Deserialize, Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacteristicProperties {
    pub broadcast: bool,
    pub read: bool,
    pub write_without_response: bool,
    pub write: bool,
    pub notify: bool,
    pub indicate: bool,
    pub authenticated_signed_writes: bool,
}

impl From<CharPropFlags> for CharacteristicProperties {
    fn from(f: CharPropFlags) -> Self {
        Self {
            broadcast: f.contains(CharPropFlags::BROADCAST),
            read: f.contains(CharPropFlags::READ),
            write_without_response: f.contains(CharPropFlags::WRITE_WITHOUT_RESPONSE),
            write: f.contains(CharPropFlags::WRITE),
            notify: f.contains(CharPropFlags::NOTIFY),
            indicate: f.contains(CharPropFlags::INDICATE),
            authenticated_signed_writes: f.contains(CharPropFlags::AUTHENTICATED_SIGNED_WRITES),
        }
    }
}

/// Canonical lowercase 128-bit form, accepting the 16-bit shorthand the web side may send.
/// One spelling per characteristic, or a lookup silently finds nothing.
pub fn canonical_uuid(s: &str) -> String {
    let t = s.trim().to_ascii_lowercase();
    if t.len() == 4 && t.chars().all(|c| c.is_ascii_hexdigit()) {
        return format!("0000{t}-0000-1000-8000-00805f9b34fb");
    }
    t
}

pub fn parse_uuid(s: &str) -> Result<Uuid> {
    Ok(Uuid::parse_str(&canonical_uuid(s))?)
}

/// Does an advertisement satisfy the request?
///
/// Web Bluetooth's rule exactly: any filter matching is a match, and within a filter every stated
/// field must hold. `acceptAllDevices` matches everything — which is how a cube nothing recognises
/// still becomes reportable (§7).
pub fn matches_request(
    name: &str,
    services: &[Uuid],
    manufacturer_data: &HashMap<u16, Vec<u8>>,
    opts: &RequestOptions,
) -> bool {
    if opts.accept_all_devices {
        return true;
    }
    if opts.filters.is_empty() {
        return false;
    }
    opts.filters.iter().any(|f| {
        if let Some(n) = &f.name {
            if name != n {
                return false;
            }
        }
        if let Some(p) = &f.name_prefix {
            if !name.starts_with(p) {
                return false;
            }
        }
        for s in &f.services {
            let Ok(want) = parse_uuid(s) else {
                return false;
            };
            if !services.contains(&want) {
                return false;
            }
        }
        for m in &f.manufacturer_data {
            let Some(payload) = manufacturer_data.get(&m.company_identifier) else {
                return false;
            };
            if let Some(prefix) = &m.data_prefix {
                let Ok(want) = hex::decode(prefix) else {
                    return false;
                };
                if !payload.starts_with(&want) {
                    return false;
                }
            }
        }
        // An empty filter object matches nothing, mirroring the browser: a filter must state at
        // least one criterion, and treating "no criteria" as "everything" would turn a caller's
        // bug into a chooser full of unrelated hardware.
        f.name.is_some()
            || f.name_prefix.is_some()
            || !f.services.is_empty()
            || !f.manufacturer_data.is_empty()
    })
}

/// First available BLE adapter.
///
/// # Android
///
/// Refused, deliberately and loudly. btleplug's Android backend (`droidplug`) needs two things
/// this project does not yet provide: its `com.nonpolynomial.btleplug.android.impl.*` Java classes
/// compiled into the APK, and `btleplug::platform::init(&env)` called with a `JNIEnv` before any
/// use. Without them `Manager::adapters()` reaches `global_adapter()`, which **panics** —
/// "Droidplug has not been initialized" — inside a Tauri command, which is a crash rather than an
/// error a screen can report.
///
/// The crate compiles for `aarch64-linux-android` today, so nothing catches this at build time.
/// That is exactly why the refusal is here: a capability that is absent must say so, and it must
/// not be discovered by a user tapping a button.
///
/// It is also no longer the path Android takes. `apps/desktop/src-tauri/src/android_ble.rs`
/// forwards the `ble_*` commands to a Kotlin plugin instead, so this function is unreachable
/// there — it stays as the refusal for any OTHER caller that reaches for a btleplug adapter on
/// Android, which would still panic.
#[cfg(target_os = "android")]
pub async fn default_adapter() -> Result<Adapter> {
    Err(
        "Bluetooth is not wired up on Android yet: btleplug's droidplug backend needs its Java \
         classes in the APK and platform::init() called with a JNIEnv. The crate compiles without \
         them, so this refusal is the only thing standing between a tap and a panic."
            .into(),
    )
}

/// First available BLE adapter.
#[cfg(not(target_os = "android"))]
pub async fn default_adapter() -> Result<Adapter> {
    let manager = Manager::new().await?;
    manager
        .adapters()
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| "no BLE adapter".into())
}

/// One place that turns a discovered peripheral into the shape the web side receives.
///
/// Both scan paths built this inline and had already begun to differ. A cross-platform field like
/// `rssi` or the manufacturer-data encoding drifting between "what a scan reports" and "what a
/// match reports" is the kind of difference nobody notices until a report from one path cannot be
/// replayed by the other.
fn describe(p: &Peripheral, props: &btleplug::api::PeripheralProperties) -> AdvertisedDevice {
    AdvertisedDevice {
        id: p.id().to_string(),
        name: props.local_name.clone().unwrap_or_default(),
        manufacturer_data: props
            .manufacturer_data
            .iter()
            .map(|(k, v)| (*k, hex::encode(v)))
            .collect(),
        services: props.services.iter().map(|u| u.to_string()).collect(),
        rssi: props.rssi,
    }
}

/// Every peripheral a scan saw, matched or not.
///
/// "Nothing found" has three causes with three different fixes — the cube is asleep, it advertises
/// under a name no filter matches, or the OS never granted Bluetooth and we saw literally nothing.
/// A caller that cannot tell them apart reports the wrong one.
pub async fn scan_all(central: &Adapter, timeout: Duration) -> Result<Vec<AdvertisedDevice>> {
    central.start_scan(ScanFilter::default()).await?;
    // Everything between start and stop runs inside a closure whose result is returned only AFTER
    // the scan is stopped. An early `?` used to leave the radio scanning forever, which on macOS
    // makes every later scan return stale results and looks exactly like a cube that will not
    // reconnect.
    let collected = async {
        // The scan WINDOW. Dropping this (as a refactor briefly did) turns the function into an
        // instant read of whatever btleplug had already cached, which on a resting cube is nothing.
        tokio::time::sleep(timeout).await;
        let mut seen = Vec::new();
        for p in central.peripherals().await? {
            if let Some(props) = p.properties().await? {
                seen.push(describe(&p, &props));
            }
        }
        Ok::<_, Box<dyn std::error::Error + Send + Sync>>(seen)
    }
    .await;
    report_stop_scan(central.stop_scan().await);
    collected
}

/// A scan that would not stop is worth saying out loud.
///
/// It was discarded with `let _ =`, under a comment promising the radio is stopped on every path —
/// so the one case the comment was about produced no evidence at all. It is deliberately NOT
/// turned into an error: the caller's result is a list of devices that were genuinely seen, and
/// failing the whole call over the teardown would throw away good data. On macOS a stuck scan
/// makes every LATER scan return stale results, which reads as a cube that will not reconnect —
/// a symptom nobody would trace back here without this line.
fn report_stop_scan(r: std::result::Result<(), btleplug::Error>) {
    if let Err(e) = r {
        eprintln!("cube-ble: the adapter did not stop scanning: {e}");
    }
}

/// Scan until a peripheral satisfies `opts`, or the timeout expires. Leaves scanning stopped.
pub async fn find_device(
    central: &Adapter,
    opts: &RequestOptions,
    timeout: Duration,
) -> Result<Option<(Peripheral, AdvertisedDevice)>> {
    central.start_scan(ScanFilter::default()).await?;
    let deadline = tokio::time::Instant::now() + timeout;
    // Same shape as scan_all: stop the radio on every exit, including the error paths.
    let found = async {
        loop {
            // Collect every match, then take the strongest signal.
            //
            // Taking the FIRST match meant "whichever the platform happened to enumerate first",
            // which is unspecified and unstable — in a room with two cubes, or a classroom with
            // ten, the app would connect to an arbitrary one and a second attempt could pick a
            // different one. There is no chooser on the native path to fall back on, so the choice
            // has to be principled: nearest radio wins, and equal signal breaks by id so the
            // answer is at least reproducible.
            let mut matches = Vec::new();
            for p in central.peripherals().await? {
                let Some(props) = p.properties().await? else {
                    continue;
                };
                let name = props.local_name.clone().unwrap_or_default();
                if matches_request(&name, &props.services, &props.manufacturer_data, opts) {
                    matches.push((p.clone(), describe(&p, &props)));
                }
            }
            if !matches.is_empty() {
                matches.sort_by(|a, b| {
                    b.1.rssi
                        .unwrap_or(i16::MIN)
                        .cmp(&a.1.rssi.unwrap_or(i16::MIN))
                        .then_with(|| a.1.id.cmp(&b.1.id))
                });
                return Ok::<_, Box<dyn std::error::Error + Send + Sync>>(Some(matches.remove(0)));
            }
            if tokio::time::Instant::now() >= deadline {
                return Ok(None);
            }
            tokio::time::sleep(Duration::from_millis(400)).await;
        }
    }
    .await;
    report_stop_scan(central.stop_scan().await);
    found
}

/// Primary service UUIDs, discovering first. Discovery is idempotent in btleplug.
pub async fn discover_services(peripheral: &Peripheral) -> Result<Vec<String>> {
    peripheral.discover_services().await?;
    let mut out: Vec<String> = peripheral
        .services()
        .iter()
        .map(|s| s.uuid.to_string())
        .collect();
    out.sort();
    out.dedup();
    Ok(out)
}

/// Characteristics of one service, with their property flags.
pub async fn discover_characteristics(
    peripheral: &Peripheral,
    service: &str,
) -> Result<Vec<CharacteristicInfo>> {
    peripheral.discover_services().await?;
    let want = parse_uuid(service)?;
    Ok(peripheral
        .characteristics()
        .into_iter()
        .filter(|c| c.service_uuid == want)
        .map(|c| CharacteristicInfo {
            uuid: c.uuid.to_string(),
            properties: c.properties.into(),
        })
        .collect())
}

/// Locate a characteristic by (service, characteristic).
///
/// Both are required. A characteristic UUID is only unique WITHIN a service, and matching on the
/// characteristic alone silently picks whichever service enumerated first — which on a cube that
/// exposes the same UUID under two services is a subscription to the wrong stream.
pub fn find_characteristic(
    peripheral: &Peripheral,
    service: &str,
    characteristic: &str,
) -> Result<Characteristic> {
    let svc = parse_uuid(service)?;
    let chr = parse_uuid(characteristic)?;
    peripheral
        .characteristics()
        .into_iter()
        .find(|c| c.service_uuid == svc && c.uuid == chr)
        .ok_or_else(|| format!("characteristic {chr} not found in service {svc}").into())
}

pub async fn subscribe(peripheral: &Peripheral, service: &str, characteristic: &str) -> Result<()> {
    let c = find_characteristic(peripheral, service, characteristic)?;
    peripheral.subscribe(&c).await?;
    Ok(())
}

pub async fn unsubscribe(
    peripheral: &Peripheral,
    service: &str,
    characteristic: &str,
) -> Result<()> {
    let c = find_characteristic(peripheral, service, characteristic)?;
    peripheral.unsubscribe(&c).await?;
    Ok(())
}

pub async fn read(peripheral: &Peripheral, service: &str, characteristic: &str) -> Result<Vec<u8>> {
    let c = find_characteristic(peripheral, service, characteristic)?;
    Ok(peripheral.read(&c).await?)
}

pub async fn write(
    peripheral: &Peripheral,
    service: &str,
    characteristic: &str,
    data: &[u8],
    without_response: bool,
) -> Result<()> {
    let c = find_characteristic(peripheral, service, characteristic)?;
    let kind = if without_response {
        WriteType::WithoutResponse
    } else {
        WriteType::WithResponse
    };
    peripheral.write(&c, data, kind).await?;
    Ok(())
}

/// Which service a notification belongs to.
///
/// btleplug's `ValueNotification` carries only the characteristic UUID, and the web side keys its
/// characteristic objects on the (service, characteristic) pair — so without this the notification
/// is delivered to nothing and the packet is silently lost.
///
/// Returns None when the answer is AMBIGUOUS as well as when it is unknown. A characteristic UUID
/// is unique only within a service, and `find`-ing the first match would have picked whichever
/// service happened to enumerate first — silently routing a stream to the wrong characteristic
/// object. That directly contradicted `find_characteristic`, three functions above, which requires
/// both halves for exactly this reason. A caller that gets None must say so rather than guess.
pub fn service_of(peripheral: &Peripheral, characteristic: Uuid) -> Option<String> {
    let mut matches = peripheral
        .characteristics()
        .into_iter()
        .filter(|c| c.uuid == characteristic)
        .map(|c| c.service_uuid.to_string())
        .collect::<Vec<_>>();
    matches.sort();
    matches.dedup();
    match matches.len() {
        1 => matches.pop(),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn uuid(s: &str) -> Uuid {
        parse_uuid(s).unwrap()
    }

    #[test]
    fn expands_the_sixteen_bit_shorthand() {
        assert_eq!(
            canonical_uuid("fff6"),
            "0000fff6-0000-1000-8000-00805f9b34fb"
        );
        assert_eq!(
            canonical_uuid("FFF6"),
            "0000fff6-0000-1000-8000-00805f9b34fb"
        );
    }

    #[test]
    fn leaves_a_vendor_uuid_alone_but_lowercases_it() {
        // Expanding one of these into the Bluetooth base range would address a different
        // characteristic entirely.
        assert_eq!(
            canonical_uuid("6E400001-B5A3-F393-E0A9-E50E24DCCA9E"),
            "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
        );
    }

    fn no_mfr() -> HashMap<u16, Vec<u8>> {
        HashMap::new()
    }

    fn opts(filters: Vec<DeviceFilter>) -> RequestOptions {
        RequestOptions {
            filters,
            ..Default::default()
        }
    }

    #[test]
    fn matches_on_a_name_prefix() {
        let o = opts(vec![DeviceFilter {
            name_prefix: Some("GAN".into()),
            ..Default::default()
        }]);
        assert!(matches_request("GAN16ui_C8D3", &[], &no_mfr(), &o));
        assert!(!matches_request("QY-QYSC-D", &[], &no_mfr(), &o));
    }

    #[test]
    fn any_filter_matching_is_a_match() {
        // Ten protocols each contribute their own filters; the request is their union.
        let o = opts(vec![
            DeviceFilter {
                name_prefix: Some("GAN".into()),
                ..Default::default()
            },
            DeviceFilter {
                name_prefix: Some("QY-QYSC".into()),
                ..Default::default()
            },
        ]);
        assert!(matches_request("QY-QYSC-D", &[], &no_mfr(), &o));
    }

    #[test]
    fn every_field_within_one_filter_must_hold() {
        let o = opts(vec![DeviceFilter {
            name_prefix: Some("GAN".into()),
            services: vec!["fff0".into()],
            ..Default::default()
        }]);
        assert!(matches_request("GAN16ui", &[uuid("fff0")], &no_mfr(), &o));
        // Right name, wrong service: not a match. An OR here would hand the protocol layer a
        // device it cannot speak to, and the failure would surface as a mystery timeout.
        assert!(!matches_request("GAN16ui", &[uuid("aadb")], &no_mfr(), &o));
    }

    #[test]
    fn an_empty_filter_list_matches_nothing() {
        assert!(!matches_request("GAN16ui", &[], &no_mfr(), &opts(vec![])));
    }

    #[test]
    fn a_filter_stating_no_criteria_matches_nothing() {
        // Treating "no criteria" as "everything" turns a caller's bug into a chooser full of
        // headphones, and on the native side there is no chooser — it would just connect.
        assert!(!matches_request(
            "GAN16ui",
            &[],
            &no_mfr(),
            &opts(vec![DeviceFilter::default()])
        ));
    }

    #[test]
    fn matches_a_manufacturer_only_filter() {
        // The protocol layer emits these alongside its name filters — `filters.push({
        // manufacturerData: [{ companyIdentifier }] })` — to find a cube advertising without a
        // recognisable name. Ignoring them made such a device invisible to the native scan while
        // the browser build found it: the two builds disagreeing about what exists.
        let o = opts(vec![DeviceFilter {
            manufacturer_data: vec![ManufacturerDataFilter {
                company_identifier: 0x0001,
                data_prefix: None,
            }],
            ..Default::default()
        }]);
        let mfr = HashMap::from([(0x0001u16, vec![0x00, 0xc8, 0xd3])]);
        assert!(matches_request("", &[], &mfr, &o));
        assert!(!matches_request("", &[], &no_mfr(), &o));
        // A different company id is a different vendor, not a near miss.
        let other = HashMap::from([(0x004Cu16, vec![0x00])]);
        assert!(!matches_request("", &[], &other, &o));
    }

    #[test]
    fn honours_a_manufacturer_data_prefix() {
        let o = opts(vec![DeviceFilter {
            manufacturer_data: vec![ManufacturerDataFilter {
                company_identifier: 0x0001,
                data_prefix: Some("00c8".into()),
            }],
            ..Default::default()
        }]);
        assert!(matches_request(
            "",
            &[],
            &HashMap::from([(0x0001u16, vec![0x00, 0xc8, 0xd3])]),
            &o
        ));
        assert!(!matches_request(
            "",
            &[],
            &HashMap::from([(0x0001u16, vec![0x00, 0xff, 0xd3])]),
            &o
        ));
    }

    #[test]
    fn accept_all_devices_matches_anything_including_the_unnamed() {
        // The path a cube nothing recognises takes on its way to becoming a capture.
        let o = RequestOptions {
            accept_all_devices: true,
            ..Default::default()
        };
        assert!(matches_request("", &[], &no_mfr(), &o));
        assert!(matches_request(
            "something else entirely",
            &[],
            &no_mfr(),
            &o
        ));
    }
}
