# Discovered device — GAN16 ui

- **name**: GAN16ui_C8D3
- **CoreBluetooth id (this Mac)**: BBD8635C-78B0-08F9-A5DA-238B635D57D2  (random, per-Mac — not portable)
- **advertised service**: 00000010-0000-FFF7-FFF6-FFF5FFF4FFF0  (== GAN Gen4 service)
- **manufacturer data**: 0100 00000000 d3c889506c54 64636f6e00 ffffffffffff
  - company id 0x0001 (GAN CIC, matches 0xXX01 list)
  - MAC (Web-Bluetooth slice, last-6-reversed) = 54:6C:50:89:C8:D3
  - cross-check: name suffix _C8D3 == MAC tail C8:D3  ✓
- **RSSI**: ~-53 dBm at desk range
- **connectable**: true

MAC is device-specific key material — kept here in captures/, never hard-coded in src/.
