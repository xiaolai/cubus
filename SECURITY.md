# Security

## Reporting a vulnerability

Please do not open a public issue for a vulnerability.

- **Preferred:** GitHub's private vulnerability reporting for this repository,
  <https://github.com/xiaolai/cubus/security/advisories/new>. As of 2026-09-05 that feature is
  not yet enabled on the repository (it is a one-click owner setting under *Settings → Code
  security*); until it is, use the next route.
- **Otherwise:** email the author at the address on the GitHub profile, <https://github.com/xiaolai>,
  with "cubus security" in the subject line.

Say what you found, how to reproduce it, and what you believe it lets an attacker do. A proof of
concept is welcome; running it against other people's machines is not necessary and not wanted.

## What is in scope

The app runs on the user's own device and talks to almost nothing, so the surface is small, and
each part of it is named here so a report can be precise.

- **The self-updater** (macOS, Windows, Linux). `latest.json` is fetched from GitHub Releases over
  HTTPS, and every download is verified against the minisign public key in
  `apps/desktop/src-tauri/tauri.conf.json` before a byte is unpacked; a downgrade is refused. Any
  way to get an unsigned, tampered or older build installed is critical.
- **Bluetooth.** The smart-cube bridge (`crates/cube-ble`, the Android and iOS plugins,
  `apps/web/lib/ble-*.js`) decodes packets from a device the user chose. A packet that crashes
  the app, escapes the decoder's bounds or reaches the page unescaped is in scope.
- **The camera.** Frames go to the detector on-device (`packages/cube-scanner` in the browser,
  `crates/cube-vision` and the mobile plugins natively) and never leave it. A path by which they
  could is a report; so is a frame that can drive the native plugins out of bounds.
- **Stored data.** Settings, the cube registry and recent solves live in `localStorage`, and the
  app treats them as untrusted input. A stored value that breaks the app or reaches the DOM
  unescaped is in scope.
- **The dev server** (`apps/web/serve.mjs`) is for local development and binds loopback by
  default. It is in scope for anything a web page open in a browser on the same machine could do
  to it.
- **The release pipeline** (`.github/workflows`). Anything that would let a shipped build carry
  code that is not in the tagged commit, or let a tag build from a commit CI never passed.

Out of scope: vulnerabilities in the operating system's webview, Bluetooth stack or camera
drivers (report those upstream), and findings that require an already-compromised machine.

## What to expect

- An acknowledgement within seven days, from one maintainer, in a personal capacity — there is
  no security team behind this project.
- For a confirmed finding, a fix or a reasoned decision not to fix within ninety days. Desktop
  users receive fixes through the self-updater and the Homebrew cask; the web build through
  whoever hosts it.
- Credit in the release notes, if you want it.
