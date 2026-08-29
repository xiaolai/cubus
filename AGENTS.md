# Project Instructions

> cubus-im

## Guidelines

A beginner/kids Rubik's Cube tutor. You show your cube to a webcam, it reads the stickers, and
it walks you through solving it.

- **Language**: always reply to the user, and write all code comments and
  documentation, in English — regardless of the language the user writes in.
- **Layout** (pnpm + Cargo monorepo): the AI scanner at `packages/cube-scanner/`, the web SPA at
  `apps/web/`, and the Tauri desktop app at `apps/desktop/` — which is `apps/web` in a native
  window and nothing more. Its Rust side is a shell: no commands, because a command would mean the
  web build and the desktop build had stopped being the same app.
  - **The one deliberate exception, accepted 2026-08-26**: native camera capture and native model
    inference (CoreML/Vision on Apple, LiteRT/TFLite on Android; the browser keeps `getUserMedia` +
    onnxruntime-web). These are Tauri plugins, so they ARE commands — but each sits behind a seam
    the browser build also implements (a `RawFrame` source; an injected model run), so the two
    builds stay the same app in behaviour while one gets native acceleration and cameras the webview
    cannot reach. That is the line: a capability seam both builds satisfy is allowed; a screen that
    only exists on one build is not. The plan, the artefacts per platform, and the checks that must
    pass before the native work starts are in `dev-docs/native-capture-and-inference.md`.
  - **Second seam, accepted 2026-08-27**: `tauri-plugin-opener`, for external links only (the
    About card's website/author anchors). A webview does nothing with `target="_blank"`, so a
    delegated click handler in `app.js` hands the URL to `__TAURI__.opener.openUrl` when that API
    is injected; in the browser the same anchors work natively. Same test as above: both builds
    satisfy the seam, neither gains a screen.
  - **Third seam, accepted 2026-08-27 with the layout contract**: the desktop window's
    orientation. `set_orientation` / `get_orientation` (commands in `lib.rs`) re-size and
    re-centre the fixed window to the other reference and remember the choice in a file the
    window is built from at the next launch — a file, because the window exists before the
    webview does. The Settings row that calls them is drawn only where the Tauri API is injected
    on a desktop platform; the browser build has no window to shape and a phone rotates in the
    hand. Same test as above: no screen exists on one build only.
  - **Dev tooling, accepted 2026-08-27, never shipped**: `tauri-plugin-mcp` (git dep, pinned rev)
    — the control socket that lets an AI agent drive the app for verification: screenshots,
    selector clicks, DOM queries, JS eval. Triple-gated because it is control-everything: the
    `mcp` cargo feature (`pnpm dev` passes it, `tauri build` does not, so release binaries never
    compile the crate), `debug_assertions`, and a `CUBUS_MCP=1` runtime opt-in. The MCP server
    side is registered in `.mcp.json` (`tauri-mcp`, pinned npm version); the guest JS is vendored
    to `apps/web/vendor/tauri-mcp-guest.js` and loaded only under Tauri, inert without the Rust
    side. To use: `CUBUS_MCP=1 pnpm dev:desktop`, then the `tauri-mcp` MCP tools in a fresh
    agent session. **Never call `manage_window clear_browsing_data` (or any storage clear) on the
    dev app**: its localStorage IS the user's data — settings, the hidden-nav choice, the cube
    registry, recent solves, the `cubeView` tuning — and on 2026-08-27 one such call, made to bust
    a cached bundle, wiped all of it with no backup. If a rebuilt bundle does not show after a
    reload, restart the dev app; the cache dies with the process, the data does not.
    **`manage_window focus` before any screenshot of a `<cubus-cube>`**: an occluded window
    reports `document.visibilityState === 'hidden'` and WebKit pauses `requestAnimationFrame`,
    so the renderer keeps its FIRST frame — a camera or ghost attribute set after mount is never
    repainted. On 2026-08-28 that made the solved cube on Home look twice its size with no
    ghosts, and cost an hour of chasing a renderer bug that did not exist.
- **Smart-cube support returned, deliberately** (removed 2026-08-26, merged back 2026-08-28).
  The removal's reasoning is the bar the return is held to: a cube adds an axis — present or
  absent, trusted or not — that every screen has to answer, and for this audience that axis was
  where the app got lost. The return answers it rather than modelling it away: trust is a
  visible state, never inferred from "connected"; one camera scan repairs tracking with no
  solving (the offset, `apps/web/lib/cube-trust.js`); and a reconnect asks the one question a
  beginner can answer — "Is this your cube right now?" — backed by a two-adjacent-side camera
  check (`apps/web/lib/cube-reconnect.js`). Capability, never a mode: every screen works with no
  cube, the camera stays first-class, and no screen exists only with hardware. The design and
  its refute passes: `dev-docs/cube-trust-design.md` and `dev-docs/smart-cube-ux-prd.md`
  (delivery status per phase). The removal-era code history remains on **`v0`**.
- **Design system**: the approved UI kit lives in `dev-docs/design/` — read
  `dev-docs/design/README.md` before any `apps/web` UI work. Adopted into the app:
  `apps/web/tokens.css` (warm-paper tokens, light/dark) and `<cubus-cube>` (a purpose-built
  three.js renderer that replaced twisty-player; draws only — state/solving stay with
  cubejs + cubing.js). Fonts are system stacks only (decided 2026-08-27): numerals/times/algs use
  the system mono stack, UI text `system-ui` — no web fonts, no embedded fonts, and index.html
  loads nothing remote (a test enforces it).
- **Layout contract** (decided 2026-08-27): two compositions keyed only on orientation — a 4:3
  landscape reference and a 3:4 portrait reference — each with a locked primary region (the cube,
  or the live scan face) and a sheet that absorbs the long-axis surplus, so a phone's extra height
  is sheet, never paper. Every platform runs the same two; the desktop window is fixed-size,
  non-resizable, sized from the monitor's work area, and can be either shape (a persisted toggle).
  The browser tab is a test harness, not a supported viewport. No viewport width/height media
  queries anywhere in `apps/web` — a test enforces it; `@container`, `orientation`, `prefers-*`
  and `pointer` are the allowed queries. Contract, fit rule, fixture table, desktop formulas,
  and the build order: `dev-docs/stage-contract.md`.
- **Verification is the contract**: a claim in a comment or a doc must be backed by a test that
  fails when the claim stops being true. The habit that mattered most on the driver — assert what
  must NOT happen, not only what should — applies just as well to a scan and a solve.
- **`cubejs` is a deliberate independent test oracle**, not a redundant dep. Do not
  "consolidate" it into cubing.js; a different implementation is what makes the
  invariant a real cross-check. cubing.js (kpuzzle + search) is the state-brain and
  solver; `<cubus-cube>` is the renderer (see Design system above).
- **Never invent data**: a statistic that cannot be computed is a dash, not a number; a reading
  that cannot be validated is a refusal, not a guess. A plausible figure is worse than a blank.
- **A misread scan may say HOW MANY, and may only point when it is one** (decided 2026-08-28).
  Two legal cube colourings are never closer than three stickers, so a one-sticker misread is the
  only one whose repair is provably unique — above that, the nearest legal cube need not be the
  user's, and pointing would sometimes accuse a correctly-read sticker. So `decodeMisread`
  (`packages/cube-scanner/src/misread-decode.ts`) reports a count that is a proven lower bound and
  is never an overstatement, and `suspects` is populated only at distance 1. Above it the app says
  "at least N stickers were misread" and asks for a side again. This is "Never invent data" applied
  to a place it was previously being broken: the old copy asserted a single misread in exactly the
  branch the code had already ruled one out. The derivation, the measurements, the refutation pass,
  and the three measurements still owed: `dev-docs/misread-decoding.md`.
- **Fail loud**: an unreadable scan, a state that cannot be solved, a storage write that did not
  land — each surfaces where it happens, never silently.
- **The version is one number in six places** — `apps/web/lib/app.js` (`VERSION`, what the About
  card shows; the web app has no build step to read a manifest at runtime), both `package.json`s
  under `apps/`, `tauri.conf.json`, the desktop `Cargo.toml` and `Cargo.lock`. `pnpm bump X.Y.Z`
  moves all six (`scripts/bump-version.mjs`, tested; it refuses rather than half-bumps), and a
  wiring test fails if any of them drifts from `VERSION`. Never edit one by hand.
- **A model change is not verified until `ml/golden_frames.py` has run.** It is the parity gate —
  every fixture through the app's exact letterbox, one runtime, the app's exact post-processing —
  and CI enforces it, but `pnpm check` does NOT, so it is the gate you can ship past locally. On
  2026-08-29 a model was swapped, declared verified on two hand-picked benchmarks, committed and
  pushed; the gate then failed **8 of 20 fixtures**, including one where the new model stopped
  abstaining on input it should refuse. **The benchmarks you choose yourself are the ones least
  likely to surprise you.** Run `ml/venv/bin/python ml/golden_frames.py` before vendoring a model,
  and never reach for `--write-expected` to make a failure go away — re-pinning is for a change you
  have already explained, not a way to turn CI green.
- **Which machine renders, which machine trains** (measured 2026-08-29). **Render on
  `render-host`** — M2 Ultra, 16 performance cores, and it already has Blender 4.2.1, the 200
  HDRIs and `~/cubus-ml/venv`; it is where every earlier dataset was rendered. 2.7 img/s, so a
  32k set takes ~3.5 h. **Never render on the MacBook Air**: 4 performance cores, fanless, 5.2×
  slower — and it is the machine you are being asked to keep usable. Check `ssh` config for hosts
  before assuming the local machine is the right one; a whole night was spent tuning worker counts
  on the laptop while the Studio sat idle.
  **Train on `train-host-a`** (GB10, on the local LAN): 2.4 MB/s from here, so a 2.6 GB dataset moves
  in ~20 min, and its containers resolve DNS so images can be built there. **`train-host-b` is the same
  GB10 but ~109 ms away at 0.1 MB/s** — 7 h for that same dataset — so use it only for work whose
  data is already on it; it holds every historical dataset and the v3/v4 runs, which makes it the
  right host for baseline evals and for parallel jobs. Its container DNS is broken, so build
  images on train-host-a or `docker commit` a finished run.
  **Never change Blender or ultralytics versions mid-comparison** — either puts a renderer or
  training-code difference inside an experiment meant to isolate something else. `ml/train.sh`
  prefers the pinned `cube-train:1`; `ml/Dockerfile.train` pins the stack and asserts the pin took.
  Timings, traps and the reasoning: `dev-docs/red-orange-fine-tune.md`.
- **Quality gate** is `pnpm check`, and it is two different things:
  `packages/cube-scanner` runs strict `tsc` + Biome + a type-aware ESLint pass + vitest;
  `apps/web` runs `node --test` over `apps/web/test/` (it has no build step to typecheck, and
  provisions its vendored libs first). Keep both green. CI enforces them on push, plus
  `cargo fmt`/`clippy`/`check` for the desktop shell, and a step that rebuilds every vendored
  bundle and fails on any diff — those bundles are committed and have drifted from their sources
  four times.

## Shared Memory

**Always write new instructions, rules, and memory to `AGENTS.md` only.**

Never modify `CLAUDE.md` directly — it only imports `AGENTS.md`.
This keeps Claude Code, Codex CLI, and Antigravity CLI (`agy`) on the same
context; Codex and `agy` both read `AGENTS.md` natively.

## Project Structure

- `.claude/` — Claude Code skills, agents, rules, hooks, commands
- `.agents/skills/` — symlink to `.claude/skills/` (Codex skill scan path)
- `.codex/prompts/` — Codex slash-command prompts
- `.codex/hooks.json` / `.codex/config.toml` — Codex hooks/config (optional)
- `.mcp.json` — MCP server registrations (Claude Code + Codex)
