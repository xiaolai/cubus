# cubus

A Rubik's Cube tutor for beginners and kids. Show your cube to a webcam, it reads the
stickers, and it walks you through solving it.

Runs in a browser, and as a native app on macOS, Windows and Linux. The iOS and Android shells
are in the repository and build, but are **not yet shipped** — no store listing, no signed build;
`dev-docs/release-runbook.md` tracks what that waits on. Smart cubes are supported over
Bluetooth, and optional — every screen works without one.

## Prerequisites

| For | You need |
|---|---|
| The web app (`pnpm dev`) | Node 24 (`.nvmrc`) and pnpm 10.33 through corepack (`corepack enable`). Nothing else. |
| The desktop app (`pnpm dev:desktop`) | The above, plus Rust stable (`rustup`), and per platform: **macOS** — a full Xcode, not the Command Line Tools alone, because the native scanner is a Swift package built by swift-rs; **Linux** — `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libdbus-1-dev pkg-config` (the set `.github/workflows/ci.yml` installs; Ubuntu 22.04 is the release floor); **Windows** — the MSVC build tools and WebView2. |
| The icon check (`python3 scripts/verify-icons.py`) | Python 3.11 with `pillow==12.3.0`, and librsvg (`rsvg-convert`) for the renderer-dependent measurements — without it those report as skipped, never as passed. |
| Android (`pnpm --filter cubus-desktop android build`) | JDK 21 (Gradle 8.14 + AGP 8.11 run on 17–21; `scripts/tauri-android.mjs` refuses a newer one), the Android SDK with `ANDROID_HOME` set, and NDK 27.2.12479018 with `NDK_HOME` set. |
| iOS | A Mac with Xcode. `cargo check -p cubus-desktop --target aarch64-apple-ios` compiles the Rust side; a signed build needs the material listed in the runbook. |
| The model gate (`ml/golden_frames.py`) | `ml/venv`, a Python 3.11 environment from `ml/requirements-golden.txt`. CI runs it; `pnpm check` does not, and AGENTS.md records why that distinction matters. |

## Build

```sh
pnpm install
pnpm dev          # the web app, on http://localhost:15173 (loopback only; CUBUS_DEV_HOST=0.0.0.0 for a phone on the LAN)
pnpm dev:desktop  # the desktop app — needs Rust and the platform packages above
pnpm check        # the quality gate
```

`pnpm dev` works on a clean clone with Node and pnpm alone. `pnpm dev:desktop` does not: it
compiles the Rust shell and, on a Mac, the Swift scanner.

## Hosting the web build

`pnpm --filter cubus-web build:dist` assembles `apps/web/dist/`, the static site every build
serves. **Nothing in this repository deploys it anywhere yet** — there is no Pages, Netlify or
nginx configuration, and `cubus.im` (which the About card names) is not published from here.
Whoever hosts it has to serve exactly what `apps/web/serve.mjs` serves, or the scanner runs on
one core:

- **Cross-origin isolation, on every response.** `Cross-Origin-Opener-Policy: same-origin`,
  `Cross-Origin-Embedder-Policy: require-corp`, `Cross-Origin-Resource-Policy: same-origin`.
  onnxruntime's threaded wasm needs `SharedArrayBuffer`, which a browser grants only to an
  isolated page; without the headers it silently reports one thread — measured at 297 ms per
  inference in WebKit, about three frames a second.
- **MIME types.** `.wasm` as `application/wasm` (streaming compilation fails on anything else),
  `.js` and `.mjs` as `text/javascript`, `.onnx` as `application/octet-stream`, `.webmanifest`
  as `application/manifest+json`, `.md` as `text/markdown`.
- **HTTPS**, or the browser refuses the camera. Only `localhost` is a secure context over plain
  http, which is why the dev server needs no certificate.
- **No rewrite rules.** Routes live in the URL hash (`#/scan`), so every path is a real file and
  there is no SPA fallback to configure.
- **Caching.** A cold load is about 35 MB: 24 MB of onnxruntime wasm and 10.6 MB of model.
  Neither file is content-hashed, so cache them by validator (`ETag` or `Last-Modified` with
  `Cache-Control: max-age=…, must-revalidate`) rather than as immutable, and keep `index.html`
  and `lib/*.js` at `no-cache`. There is no service worker, so offline use is not supported.
- **The page loads nothing remote** — no CDN, no fonts, no telemetry — and a test fails the
  build if that changes.

## Signing

- **macOS** builds are signed with a Developer ID certificate and notarized, with the ticket
  stapled into the app, so a first launch works offline.
- **Windows** builds are **not** Authenticode-signed. SmartScreen shows "Windows protected your
  PC" on install, and every self-update runs an unsigned NSIS installer through a UAC prompt.
  Fine for people who know what they are installing; not yet for a general audience.
- **Linux** bundles are unsigned, as is usual. On every desktop the in-app updater verifies its
  downloads with minisign before installing them.
- **iOS and Android** are not shipped: no distribution certificate, no upload keystore.

## Privacy, security, contributing

`PRIVACY.md` says what the app does with data (in short: nothing leaves the device except the
desktop updater's daily check against GitHub). `SECURITY.md` says how to report a vulnerability.
`CONTRIBUTING.md` has the gate, the version tool and the commit rules. The licences of everything
that ships with the app are in `apps/web/THIRD_PARTY_NOTICES.md`.

## Licence

**GNU AGPL-3.0** — see [`LICENSE`](LICENSE). A commercial licence is available if those terms
do not suit you: [`LICENSE-COMMERCIAL.md`](LICENSE-COMMERCIAL.md), which also explains why the
project is copyleft (the shipped sticker detector is trained with Ultralytics, itself AGPL-3.0).

`packages/gan-driver` is MIT. Third-party components keep their own licences.
