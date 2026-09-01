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
# A FIXED path inside the repo, not mktemp.
#
# This script moves gitignored directories aside, which means for the length of a run the only
# copy of them is wherever it put them. The first version used `mktemp -d`, and when a run was
# killed with SIGTERM the trap did not survive: 25 MB of the maintainer's notes — gitignored, so
# not recoverable from git — were left in /var/folders under a random name that nothing would ever
# look for. A fixed, discoverable path inside the repo means a killed run is recoverable BY HAND,
# and the recovery below means it usually does not have to be.
STASH=".check-on-clone-stash"

restore() {
  for name in "${HIDDEN[@]-}"; do
    [ -n "$name" ] || continue
    [ -d "$STASH/$name" ] || continue
    # Never `rm -rf` the live copy to make room. If something already exists at the destination,
    # the stash is the copy of unknown provenance and the live one wins; say so and keep both.
    if [ -e "./$name" ]; then
      echo "WARNING: ./$name reappeared during the run — leaving $STASH/$name in place" >&2
    else
      mv "$STASH/$name" "./$name"
    fi
  done
  rmdir "$STASH" 2>/dev/null || true
}
trap restore EXIT INT TERM

# Recover anything a previous run was killed before restoring, BEFORE hiding anything new.
if [ -d "$STASH" ]; then
  for p in "$STASH"/* "$STASH"/.[!.]*; do
    [ -e "$p" ] || continue
    name="$(basename "$p")"
    if [ -e "./$name" ]; then
      echo "WARNING: both ./$name and $STASH/$name exist — leaving the stash alone" >&2
    else
      mv "$p" "./$name" && echo "recovered ./$name from an interrupted run"
    fi
  done
  rmdir "$STASH" 2>/dev/null || true
fi

mkdir -p "$STASH"
for name in dev-docs .codex; do
  if [ -e "$name" ]; then mv "$name" "$STASH/$name" && HIDDEN+=("$name"); fi
done
if [ ${#HIDDEN[@]} -gt 0 ]; then
  # Say WHERE, every time. If this run is killed hard enough to skip the trap, this line is the
  # only record of what moved and where it went — and these are gitignored directories, so there
  # is no other copy anywhere.
  echo "hidden: ${HIDDEN[*]} -> $STASH (restored on exit; recovered automatically on the next run)"
else
  echo "hidden: nothing"
fi

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
