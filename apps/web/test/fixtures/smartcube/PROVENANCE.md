# Vendored smart-cube captures

Twelve real-hardware BLE captures, copied verbatim from
[`poliva/smartcube-web-bluetooth`](https://github.com/poliva/smartcube-web-bluetooth) at rev
`44f1f091c6e980d9cc31e6d2863c4437eca3ab3c` (v4.0.0), MIT, Andy Fedotov and Pau Oliva. Recorded
2026-04-14/15. See `packages/gan-driver/THIRD_PARTY.md` for the project's attribution record.

## Why copied instead of imported

The package's `files` list ships `dist`, `src`, `README.md`, `LICENSE.txt` and `package.json` — and
**not `captures/`**. So the dependency in `node_modules` contains none of them, and a test that
imported them would fail on every machine including CI. They are copied rather than fetched because
a test that reaches the network is not a test.

## What they are

Each file is a `smartcube-fixture` v1 session: the complete GATT conversation
(`discover-service` / `discover-char` / `read` / `write` / `notify` / `marker`) **plus** the events
the library decoded from it at capture time. That second half is what makes a capture
self-checking — replay the traffic, compare the events.

| Protocol family | Captures | Models |
|---|---|---|
| `gan-gen2` | 3 | GAN12ui, GAN12uiFp, GANicXXX |
| `gan-gen4` | 1 | GANi4 |
| `giiker` | 1 | Giiker i3SE |
| `gocube` | 2 | GoCube, Rubik's Connected |
| `moyu32` | 3 | WCU_MY32 ×2, WCU_MY33 |
| `qiyi` | 2 | QY-QYSC-S, XMD Tornado V4 |

Eleven models, six protocol families. Upstream's own `FIXTURES` registry names only eight of the
twelve files, so four are exercised by no upstream test at all; `ble-polyfill.test.mjs` replays
three of those four, and records why the fourth cannot be
(`NOT_CONNECT_REPLAYABLE`).

## What they are evidence for, and what they are not

They verify **decoders** against real hardware — hardware nobody here owns. They were recorded
through upstream's own Bluetooth mock, so on their own they say nothing about our transport. That is
exactly why they are replayed here through `lib/ble-polyfill.js` instead: the same bytes, the same
expected events, but routed through the layer this project added.

They are not a substitute for a real connection on a real device. Nothing here exercises btleplug,
WKWebView, or Android permissions — see `dev-docs/universal-cube-driver.md` §7 for why the user
report survives anyway.

## Privacy

Several captures contain the cube's BLE MAC, because GAN and MoYu key derivation needs it. It is a
toy's identifier, broadcast in the clear by the cube itself, and it is upstream's hardware rather
than any user's. It is not a phone or computer address. The same note applies to
`packages/gan-driver/tests/fixtures/`.

## Updating

These move only when the pinned rev moves. Re-copy the whole directory rather than individual
files, re-run `apps/web/test/ble-polyfill.test.mjs`, and read `NOT_CONNECT_REPLAYABLE` before
concluding that a newly-failing capture is a regression.
