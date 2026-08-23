# Project Instructions

> cubus-im

## Guidelines

A beginner/kids Rubik's Cube tutor built on a verified GAN16 ui smart-cube driver.

- **Language**: always reply to the user, and write all code comments and
  documentation, in English — regardless of the language the user writes in.
- **Layout** (pnpm + Cargo monorepo): the verified driver lives at `packages/gan-driver/`
  (TypeScript, **zero runtime deps**, transport-agnostic); the AI scanner at
  `packages/cube-scanner/`; the web SPA at `apps/web/` (also the Tauri webview); the native
  BLE bridge at `crates/gan-ble/` (btleplug). The Tauri desktop app (`apps/desktop/`) is being
  built — see `dev-docs/implementation-plan.md` for the dual web+Tauri roadmap.
- **Verification is the contract**: protocol/crypto/decode claims must stay backed by
  the fixture tests in `packages/gan-driver/tests` (they run with no hardware). The state
  invariant — apply decoded moves → matches hardware facelets — is the core check.
- **`cubejs` is a deliberate independent test oracle**, not a redundant dep. Do not
  "consolidate" it into cubing.js; a different implementation is what makes the
  invariant a real cross-check. cubing.js (twisty-player + kpuzzle) is the chosen
  renderer/state-brain for the app.
- **Never fake hardware**: the cube reports only completed quarter-turns (no partial
  angle — proven in Experiment H). Animation is our synthesis, clearly labelled as such.
- **Fail loud**: unknown packets and missed moves surface as events, never vanish.
- **Quality gate** (`pnpm check` — runs each TS package's strict `tsc`, Biome + a
  type-aware ESLint pass, and vitest). Keep it green; CI enforces it on push.

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
