# Contributing

Short, because the rules that matter are enforced by tests and workflows rather than by this file.
`AGENTS.md` is the long version — the project's decisions and the reasons behind each — and it
applies to people exactly as it applies to the agents it was written for.

## The gate

`pnpm check` is the definition of green: strict `tsc`, Biome, a type-aware ESLint pass and vitest
for the TypeScript packages; `node --test` over `apps/web/test/` for the web app. CI runs the same
and more — `cargo fmt`/`clippy`/`check`/`test` on Linux, macOS and Windows plus the Android and iOS
targets, the Kotlin unit tests, the golden-frame parity gate for the model, the icon measurements,
`cargo audit`, `pnpm audit`, gitleaks, shellcheck, and a check that the licence notices match the
lockfiles. A pull request is reviewed after it is green, not instead.

`scripts/check-on-clone.sh` runs the web checks the way a fresh clone sees the tree, with the
gitignored inputs hidden. It is how "works on my machine" gets caught before CI does, and it says
which checks it had to skip for a missing tool rather than counting them as passed.

## A change comes with a test that fails without it

A claim in a comment or a doc is backed by a test that fails when the claim stops being true.
Prefer asserting what must NOT happen — the frame that must never be painted, the search that
must never run, the file that must never ship — over what should. If a claim cannot be tested,
say so where the claim is made.

## Vendored bundles are committed, and rebuilt

`apps/web/vendor/*.js` are esbuild outputs the app imports directly. An edit under
`packages/cube-scanner`, to `apps/web/lib/cubus-cube.js`, or to a bundle entry is not finished
until the bundle is rebuilt and committed (`pnpm build:panel`, `pnpm --filter cubus-web
build:cube`, `build:cubejs`, `build:smartcube`, `build:mcp-guest`); CI rebuilds them and fails on
any diff. The licence notices, `apps/web/THIRD_PARTY_NOTICES.md`, are the same kind of artifact:
`pnpm notices` regenerates them after a dependency change and CI refuses drift.

## The version is one number in ten places

`pnpm bump X.Y.Z` moves it everywhere at once and refuses rather than half-bumps. Never edit one
of the sites by hand; a wiring test fails if any drifts. Releases are cut from **annotated** tags
(`git tag -a vX.Y.Z -m 'release: X.Y.Z'`), pushed after the commit is on `main` and CI is green,
and a pushed tag is never moved — the release gate refuses all three the other way round.
`dev-docs/release-runbook.md` §3 has the sequence.

## A model change is not verified until the golden gate has run

`ml/venv/bin/python ml/golden_frames.py` before vendoring a model, every time. `pnpm check` does
not run it; CI does. Never re-pin `expected.json` to make a failure go away — re-pinning is for a
change that has already been explained.

## Commits

- One logical change per commit; each passes the checks relevant to it.
- **No AI attribution lines** — no "Generated with …", no `Co-Authored-By:` for an assistant,
  no session URLs — in commits, pull requests, issues or generated files.
- Write a commit message through a file (`git commit -F msg.txt`) or a heredoc whose delimiter
  is **quoted** (`<<'EOF'`). A double-quoted `-m "…"` lets the shell run backticks and `$(…)`
  inside the message before git sees it, and a single-quoted one breaks on the first
  apostrophe; `AGENTS.md` records the day a code span in a commit message ran `export` and
  published an environment.
- Read the diff for secrets, tokens, private paths and internal hostnames before pushing. CI
  runs gitleaks, but a secret caught there is already in a pushed commit.

## Where things live

`apps/web` is the app; `apps/desktop` the Tauri shell (a window, and the few native seams
`AGENTS.md` sanctions); `packages/cube-scanner` the detector; `crates/*` the native side; `ml/`
training and the golden gate. `dev-docs/` holds the design records and is gitignored — code
comments cite its paths on purpose, and the tests that read it skip when it is absent and say so.
