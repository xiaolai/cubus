#!/usr/bin/env bash
# Run the checks CI runs, with the gitignored content directories hidden — i.e. as a fresh clone
# sees the repo.
#
# WHY THIS EXISTS. dev-docs/ and .codex/ went from tracked to ignored, and three things quietly read
# files out of them: apps/web/test/stage.test.mjs (the layout contract, at MODULE SCOPE, so its
# absence threw before a single test ran), apps/web/test/tokens.test.mjs (the design kit's
# tokens.css), and scripts/verify-icons.py (dev-docs/design/icons/cubus-icon-flat.svg — the one
# hand-authored source every app icon is generated from). Each was found by CI going red, one at a
# time, after the class had been "checked" by grepping for file reads.
#
# A static check was tried first and abandoned, and the reason is worth keeping: verify-icons.py
# builds its path as `REPO / "dev-docs" / "design" / "icons"`, so there is no `dev-docs/...` literal
# to match, and reintroducing the bug produced an identical offender list. A gate that cannot fail
# for its own founding case is worse than no gate, because it is believed. Deciding statically
# whether a script breaks without a directory amounts to running it — so this runs it.
#
#   ./scripts/check-on-clone.sh
#
# Exit 0 when a clone would pass. Restores the hidden directories on any exit, including Ctrl-C.

set -uo pipefail
cd "$(dirname "$0")/.."
HIDDEN=()
STASH="$(mktemp -d)"

restore() {
  for name in "${HIDDEN[@]-}"; do
    [ -n "$name" ] && [ -d "$STASH/$name" ] && rm -rf "./$name" && mv "$STASH/$name" "./$name"
  done
  rmdir "$STASH" 2>/dev/null || true
}
trap restore EXIT INT TERM

for name in dev-docs .codex; do
  if [ -e "$name" ]; then mv "$name" "$STASH/$name" && HIDDEN+=("$name"); fi
done
echo "hidden: ${HIDDEN[*]-nothing}"

fail=0
run() {
  printf '\n=== %s ===\n' "$1"; shift
  if "$@"; then echo "  ok"; else echo "  FAILED"; fail=$((fail + 1)); fi
}

# Exactly the steps the TS job runs, in its order.
run "cube-scanner — check"  pnpm --filter cube-scanner check
run "cubus-web — test"      pnpm --filter cubus-web test
run "icons"                 python3 scripts/verify-icons.py

printf '\n'
if [ "$fail" -gt 0 ]; then
  echo "FAIL: $fail check(s) a fresh clone would fail. Either the missing file is a build INPUT and"
  echo "belongs in the repo, or the caller must guard on its absence and report that it skipped."
  exit 1
fi
echo "PASS: a fresh clone passes every check this runs."
