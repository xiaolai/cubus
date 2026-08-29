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
  - **Fourth seam, accepted 2026-08-29 with the owner's execution of
    `dev-docs/optimal-solver-plan.md`**: the optimal solver. Proving a solution minimal needs
    ~86 MB of pattern databases whose generation is native work (minutes of BFS, ~500 MB peak),
    which a webview cannot do — that, not size, was always the barrier. The capability is "how
    short can this be, and can you prove it": the desktop answers with a native proof
    (`crates/optimal-solver` behind prepare/prove/cancel commands), the browser answers with the
    two-phase tiers' honest "the shortest I found" and the precomputed proven library that ships
    everywhere. Same test as every seam: no screen exists on one build only — the prove
    affordance follows the orientation-row precedent (drawn only where the API is injected),
    and the word "optimal" can appear ONLY as the result of a native proof, never from the
    two-phase engine. Provenance discipline as for the two-phase engine:
    `dev-docs/optimal-solver-provenance.md`, written before the Rust.
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
  cubejs + the two-phase engine). Fonts are system stacks only (decided 2026-08-27): numerals/times/algs use
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
  "consolidate" it into the solver; a different implementation is what makes the invariant a real
  cross-check. It is also the facelet parser and the state-brain.
- **The solver is our own two-phase engine (2026-08-29): `apps/web/lib/two-phase.js`** —
  Kociemba's algorithm implemented from the published method, no existing solver's source
  opened (the record: `dev-docs/two-phase-provenance.md`; the plan and its acceptance stamps:
  `dev-docs/two-phase-plan.md`). It replaced the vendored min2phase, whose licence was
  contradictory and unresolved — `apps/web/vendor/min2phase.PROVENANCE.md` stays as that
  record. The bounds are the feature and are why the app owns its solver: `solLen` (an
  EXCLUSIVE length bound), `probeMax` (a budget in SEARCH NODES — deterministic across
  machines and proportional to time, ~20 ns each), and null when out of budget, never an error
  string. `lib/solver-engine.js` enforces that contract at the boundary; the search runs six
  interleaved views (three axes × normal/inverse); the measured ladder and its retuning
  history live in `dev-docs/solver-move-count.md` §7. **cubing is gone entirely** — not even a
  devDependency. Bring it back only for something it is actually needed for — WCA-event
  scrambles are the obvious candidate, and note that `randomScrambleForEvent` was never
  vendored, so nothing lost it. `<cubus-cube>` is the renderer and never touched any of this
  (see Design system above).
- **Scrambles are random-STATE, from a cryptographic source** (`apps/web/lib/random-state.js`):
  the position is drawn uniformly from all 43 quintillion legal ones via `crypto.getRandomValues`
  and then solved, and the scramble is that solution inverted. Never random turns — those leave a
  distribution with structure and cubes easier than they look. There is no fallback to
  `Math.random()`; a platform without a crypto source fails loudly instead of quietly weakening.
- **One solver, one question (decided 2026-08-29 — the explaining solver was removed).** The
  app answers *just restore it*: the two-phase engine, behind a single Settings choice — a
  solution-length ceiling (≤ 20 / ≤ 19 / ≤ 18 / shortest). The method solver ("why is this
  move right", 118 moves in 21 steps with a reason each) and its reason line were removed by
  the owner's call: in practice the explanations did not reduce a learner's burden. The
  two-solvers argument it reversed, the measured ladders, the completeness proof over all
  62,208 last-layer states, and the dead-ends table are all preserved in
  `dev-docs/solver-research.md` — read it before re-deriving anything, and before any attempt
  to bring explanation back (hold a return to the same bar the smart-cube return met). The
  code history is in git (removal commit, 2026-08-29).
  - **The ceiling is a ceiling, not a stopping place**: once the target is met, `refine`
    keeps asking for shorter at a small bonus budget, so a cube a few turns from solved gets
    its real few-move answer instead of the target length. The day this was missing, a 7-turn
    cube was answered with ~20 moves — `lib/solve-target.js` records the mechanism.
- **Never invent data**: a statistic that cannot be computed is a dash, not a number; a reading
  that cannot be validated is a refusal, not a guess. A plausible figure is worse than a blank.
- **Fail loud**: an unreadable scan, a state that cannot be solved, a storage write that did not
  land — each surfaces where it happens, never silently.
- **The version is one number in six places** — `apps/web/lib/app.js` (`VERSION`, what the About
  card shows; the web app has no build step to read a manifest at runtime), both `package.json`s
  under `apps/`, `tauri.conf.json`, the desktop `Cargo.toml` and `Cargo.lock`. `pnpm bump X.Y.Z`
  moves all six (`scripts/bump-version.mjs`, tested; it refuses rather than half-bumps), and a
  wiring test fails if any of them drifts from `VERSION`. Never edit one by hand.
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
