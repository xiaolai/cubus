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
- **No smart-cube support, deliberately.** A verified GAN16 BLE driver and a Rust bridge were
  built, shipped and then removed. They worked; the problem was that a cube adds an axis — present
  or absent, trusted or not — and every screen has to answer it. For this audience that axis is
  where the app gets lost, and it cannot be modelled away because it should not exist. Both are
  preserved on the **`v0`** branch, including the tracking-offset maths, which is the part worth
  recovering if this is ever revisited.
- **Design system**: the approved UI kit lives in `dev-docs/design/` — read
  `dev-docs/design/README.md` before any `apps/web` UI work. Adopted into the app:
  `apps/web/tokens.css` (warm-paper tokens, light/dark) and `<cubus-cube>` (a purpose-built
  three.js renderer that replaced twisty-player; draws only — state/solving stay with
  cubejs + cubing.js). Numerals/times/algs use Zilla Slab; UI text Alegreya Sans.
- **Verification is the contract**: a claim in a comment or a doc must be backed by a test that
  fails when the claim stops being true. The habit that mattered most on the driver — assert what
  must NOT happen, not only what should — applies just as well to a scan and a solve.
- **`cubejs` is a deliberate independent test oracle**, not a redundant dep. Do not
  "consolidate" it into cubing.js; a different implementation is what makes the
  invariant a real cross-check. cubing.js (kpuzzle + search) is the state-brain and
  solver; `<cubus-cube>` is the renderer (see Design system above).
- **Never invent data**: a statistic that cannot be computed is a dash, not a number; a reading
  that cannot be validated is a refusal, not a guess. A plausible figure is worse than a blank.
- **Fail loud**: an unreadable scan, a state that cannot be solved, a storage write that did not
  land — each surfaces where it happens, never silently.
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
