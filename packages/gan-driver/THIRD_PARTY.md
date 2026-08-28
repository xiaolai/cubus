# Third-party attribution

## gan-web-bluetooth
- Source: https://github.com/afedotov/gan-web-bluetooth
- Author: Andy Fedotov
- License: MIT

The GAN Gen4 wire protocol implemented here — service/characteristic UUIDs,
the AES-128-CBC encryption scheme and base key/iv, the MAC-salting method, and
the MOVE / MOVE_HISTORY / FACELETS / GYRO / HARDWARE / BATTERY message layouts —
was derived from this project. The code here is an independent TypeScript
re-implementation for Node/macOS with a `blew`-based transport; it was written
by studying and verifying the protocol against a physical GAN16 ui, not by
copying source. Redistribution of protocol constants and algorithm structure is
covered by the upstream MIT license; retain this attribution.

## cubejs
- Source: https://github.com/ldez/cubejs (npm: `cubejs`)
- License: MIT
- Used as the trusted cube-state model in the state-consistency test.

## blew
- Source: https://github.com/stass/blew
- License: BSD-2-Clause
- External CLI dependency (not vendored); used as the macOS BLE transport.
