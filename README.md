# cubus

A Rubik's Cube tutor for beginners and kids. Show your cube to a webcam, it reads the
stickers, and it walks you through solving it.

Runs in a browser, and as a native app on macOS, Windows, Linux, iOS and Android.
Smart cubes are supported over Bluetooth, and optional — every screen works without one.

## Build

```sh
pnpm install
pnpm dev          # the web app
pnpm dev:desktop  # the desktop app
pnpm check        # the quality gate
```

## Licence

**GNU AGPL-3.0** — see [`LICENSE`](LICENSE). A commercial licence is available if those terms
do not suit you: [`LICENSE-COMMERCIAL.md`](LICENSE-COMMERCIAL.md), which also explains why the
project is copyleft (the shipped sticker detector is trained with Ultralytics, itself AGPL-3.0).

`packages/gan-driver` is MIT. Third-party components keep their own licences.
