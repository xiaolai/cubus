# GAN cube — native Rust BLE spike (btleplug)

De-risks the **Tauri cross-platform** direction by testing the one thing a browser SPA can't do:
reach the cube over **native** Bluetooth. `btleplug` is the exact stack `tauri-plugin-blec` wraps,
so if this works standalone, the Tauri app is just packaging around it.

## What it proves

1. **Scan + MAC** — native BLE sees the GAN cube and recovers its MAC from advertisement
   **manufacturer data** (payload `[3..9]` reversed; company-id low byte `0x01` — same logic as
   `gan-driver/src/mac.ts`). The MAC is the device-specific salt for the AES key, so this is the
   load-bearing unknown on macOS/iOS.
2. **Connect + notify** — connects and subscribes to **FFF6**, printing the encrypted 20-byte state
   packets. These are exactly what the verified `gan-driver` already decodes (decode is *not* retested
   here — it's proven).

Web Bluetooth is absent from Tauri's webviews (and all of iOS), so this native path is what makes a
smart-cube app possible on **iOS/Android/desktop** alike.

## Run

```sh
cd dev-docs/spikes/rust-ble
cargo run
```

- macOS will prompt **"Terminal wants to use Bluetooth"** the first time — allow it.
- Keep the cube **moving** so it advertises (it sleeps ~1s after resting).

## Expected output (success)

```
found: GAN16ui_C8D3
  ✓ MAC recovered from manufacturer data: 54:6C:50:89:C8:D3
connecting…
subscribed to FFF6 — encrypted state packets follow (turn the cube):
  FFF6 [20 bytes] [ab, 12, …]
  …
✓ received 20 packets — native BLE (scan + MAC + notify) works. A Tauri app wraps exactly this.
```

If you see the MAC and packets, the whole Rust-bridge path is de-risked.

## If it fails

- **No cube found** → keep it moving; confirm Bluetooth is on and the cube isn't already connected to
  another app (a BLE peripheral allows one central at a time).
- **MAC `✗`** → the manufacturer-data layout differs on your unit; the raw bytes are printed so we can
  adjust the offset.
- **FFF6 not found** → the service/char UUIDs differ; we'll enumerate and adjust.

## Next step (if green)

Wrap this in a minimal **Tauri + `tauri-plugin-blec`** app whose Rust side emits the raw FFF6 packets
to the webview, where the existing `gan-driver` (after the `node:crypto`→`aes-js` port) decodes them —
i.e. the plan's **Fork 1**. The `web/` SPA frontend is reused as-is.
