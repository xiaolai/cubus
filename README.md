# cubus

A Rubik's Cube tutor for beginners and kids. Show your cube to a webcam, it reads the stickers,
and it walks you through solving it.

## What it is

- **Scan with a camera.** A YOLO sticker detector reads a face at a time; a misread is refused
  rather than guessed at, and where a repair is provably unique it says which sticker.
- **Solve.** An in-house two-phase (Kociemba) engine, with a solution-length ceiling you choose.
  Every answer is checked by a second, independent implementation before it reaches the screen.
- **Smart cubes, optionally.** Ten Bluetooth protocols via `smartcube-web-bluetooth`, on desktop
  as well as in the browser. Every screen works with no cube; hardware is a capability, never a mode.

Runs in a browser, and as a native app on macOS, Windows, Linux, iOS and Android.

## Build

```
pnpm install
pnpm dev              # the web app
pnpm dev:desktop      # the Tauri desktop app
pnpm check            # the quality gate
```

## Licence

**GNU AGPL-3.0** — see [`LICENSE`](LICENSE).

If those terms do not suit your use, **a commercial licence is available**; see
[`LICENSE-COMMERCIAL.md`](LICENSE-COMMERCIAL.md), which also explains why the project is copyleft
rather than permissive. The short version: the shipped sticker detector is trained with
Ultralytics, which is AGPL-3.0, and a permissive licence here would not be honest about that.

`packages/gan-driver` is MIT and stays MIT. Third-party components keep their own licences.
