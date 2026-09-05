# Privacy

What cubus does with data, stated from the code as it is on 2026-09-05. Every sentence below is a
fact about this repository that a `grep` or a test can check; none is a promise about a version
that does not exist yet.

## The short version

Nothing you do in cubus leaves your device, with one exception: the **desktop** app asks GitHub
once a day whether a newer version exists. There is no account, no analytics, no crash reporting,
no advertising, and no server of ours.

## In detail

**The camera.** Frames are read by the sticker detector on your device — in the browser by
onnxruntime running in the page, in the native apps by CoreML (Apple) or TensorFlow Lite
(Android). No frame is stored or transmitted. The web app talks to no host but the one it was
loaded from: the one `fetch` in `apps/web/lib` (`optimal-challenges.js`) loads the app's own
library of proven solutions, `data/optimal-challenges.json`, from beside its own code, and there
is no `XMLHttpRequest`, `sendBeacon` or WebSocket call anywhere. The page loads nothing from any
other origin, and a test fails the build if it ever does.

**The update check (desktop only: macOS, Windows, Linux).** At most once every 24 hours, and
whenever you press *Check now* in Settings, the app fetches
`https://github.com/xiaolai/cubus/releases/latest/download/latest.json` over HTTPS. That request
carries what every HTTPS request carries — your IP address and a user-agent string — and nothing
else: no installation id, no version, no settings, no cube. GitHub's handling of that request is
governed by GitHub's own privacy statement. Nothing is downloaded until you accept the update,
and what is downloaded is verified against a signing key built into the app before it is
installed. Phones and the browser build never make this request.

**What is stored, and where.** The app keeps its state in the browser's `localStorage` — inside
the app's own container on desktop and phones: your settings, the cubes you have paired (their
names and Bluetooth addresses), recent solve times, the time of the last update check, and a few
display choices. All of it stays on the device; deleting the app's data (or clearing site data in
a browser) removes it, and there is no sync.

**Smart cubes.** The app reads from a cube over Bluetooth only after you choose it, and reads
only the cube's own packets. Nothing about the cube is sent anywhere by the app.

**Cube reports.** If you choose *Save report* for a cube (Settings → your cube), the app writes a
file — or, in the desktop app, copies text to your clipboard — for you to attach to a GitHub
issue by hand. That report contains the Bluetooth conversation with the cube and, for GAN and
MoYu cubes, the cube's Bluetooth address, which is needed to decode the traffic. It is an
identifier for the toy, not for you or your computer. The app describes what the report contains
before you save it, and the issue form repeats it where the report is posted. Whether to post it
is your decision; nothing is sent automatically.

**Homebrew.** If you install the macOS app with `brew install --cask cubus`, Homebrew downloads
the release from GitHub, and Homebrew's own analytics apply to `brew`, not to the app.

## Contact

Questions about any of this: open an issue at <https://github.com/xiaolai/cubus/issues>. For a
vulnerability, see `SECURITY.md`.
