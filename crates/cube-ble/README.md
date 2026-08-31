# cube-ble — the native half of `navigator.bluetooth`

A brand-agnostic BLE bridge over `btleplug`. It scans by the filters the web side forwards,
enumerates services and characteristics, subscribes, reads and writes, and streams notifications
back to the webview. `apps/web/lib/ble-polyfill.js` is the shape it wears; together they let the
protocol layer (`smartcube-web-bluetooth`, ten protocols, ~11 models of real-hardware evidence) run
unmodified on targets where Web Bluetooth does not exist.

Which is all of the packaged ones:

| Target | `navigator.bluetooth` |
|---|---|
| Chrome / Edge desktop, Chrome Android | yes |
| Tauri macOS, iOS (WKWebView) | no |
| Tauri Android (Android WebView) | no |
| Tauri Windows (WebView2), Linux (WebKitGTK) | no |

## No cube brand lives here

Not a style preference — `tests/no_brand_constants.rs` fails the build over it, and the scan covers
this crate *and* the Tauri backend so a constant cannot simply move next door.

This crate replaced `gan-ble`, which hardcoded a `"GAN"` name prefix, the FFF5/FFF6 characteristic
UUIDs, and GAN's manufacturer-data layout for MAC recovery. All three are per-brand facts the
protocol layer already holds for ten protocols. Two places that must agree about a cube is the
failure the whole design exists to prevent, and it never announces itself: the copies drift, one
build connects, the other quietly does not.

**Where MAC recovery went.** Reading a MAC out of an advertisement is brand-specific — company-id
list, offset and byte order all differ — so this crate reports manufacturer data verbatim and the
protocol layer extracts per brand. Not a downgrade in either direction:

- The old name-suffix cross-check is replaced by a stronger one. The library requires a *legally
  decodable cube state* within ten seconds of connecting, which tests the key rather than the
  layout.
- The two implementations are checked against each other. `apps/web/test/ble-polyfill.test.mjs`
  asserts the library recovers exactly the MAC that `gan-driver`'s hardware-verified layout
  encodes, because that agreement is what GAN key derivation on every packaged build now rests on.

Brand names in comments and in `#[cfg(test)]` fixtures are allowed, and both carve-outs are
themselves asserted — a gate whose filter silently eats everything passes everything.

## Running it

```
cargo run -p cube-ble                 # 8s scan, report every advertising device
cargo run -p cube-ble -- GAN QY-QYSC  # only these name prefixes
```

Allow the Bluetooth prompt, and keep the cube moving — most smart cubes stop advertising when
still. "Nothing found" has three causes with three different fixes (asleep / no filter matched /
the OS never granted Bluetooth), so the binary reports what the radio actually saw rather than a
bare failure.

## Tests

`cargo test -p cube-ble` — filter matching, UUID canonicalisation, and the brand gate. None of it
needs a radio. What it cannot cover is a real connection: btleplug, CoreBluetooth permissions and
Android's runtime prompts have no substitute, which is why the compatibility report exists
(`dev-docs/universal-cube-driver.md` §7).
