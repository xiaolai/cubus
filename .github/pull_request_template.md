<!-- What changed and WHY — the mechanism, not the diff. CONTRIBUTING.md has the rules this list
     summarises. Delete what does not apply. -->

## Why

## What

## Checks

- [ ] `pnpm check` is green locally
- [ ] a behaviour change has a test that fails without it (a claim in a comment is backed by a test)
- [ ] a change under `packages/cube-scanner`, `apps/web/lib/cubus-cube.js`, or a bundle entry rebuilt and committed the vendored bundle (`pnpm build:panel`, `build:cube`, `build:cubejs`, `build:smartcube`, `build:mcp-guest`)
- [ ] a model change ran `ml/venv/bin/python ml/golden_frames.py` and its result is stated here
- [ ] the version was moved with `pnpm bump X.Y.Z`, never by hand
- [ ] no AI attribution trailers in the commits
