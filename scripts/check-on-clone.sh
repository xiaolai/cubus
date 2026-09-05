#!/usr/bin/env bash
# Run the checks CI runs, with the gitignored content hidden — i.e. as a fresh clone sees the repo.
#
# WHY THIS EXISTS. dev-docs/ and .codex/ went from tracked to ignored, and three things quietly read
# files out of them: apps/web/test/stage.test.mjs (the layout contract, at MODULE SCOPE, so its
# absence threw before a single test ran), apps/web/test/tokens.test.mjs (the design kit's
# tokens.css), and scripts/verify-icons.py, which at the time read cubus-icon-flat.svg — the one
# hand-authored source every app icon is generated from — out of dev-docs/design/icons/ (the source
# has been the tracked design/icons/ since 2026-09-01, 1d46c00). Each was found by CI going red,
# one at a time, after the class had been "checked" by grepping for file reads.
#
# A static check was tried first and abandoned, and the reason is worth keeping: verify-icons.py
# built its path as `REPO / "dev-docs" / "design" / "icons"`, so there was no `dev-docs/...` literal
# to match, and reintroducing the bug produced an identical offender list. A gate that cannot fail
# for its own founding case is worse than no gate, because it is believed. Deciding statically
# whether a script breaks without a directory amounts to running it — so this runs it.
#
# WHAT IS HIDDEN is every ignored input a clone lacks, not only the two directories that first bit:
# the agent-tooling files (.cc-suite.md, .claude/*.local.*, the .agents/skills symlink), the grill
# reports, ML training output (runs/) and a stray tool's error.log. A check that happens to read any
# of them passes here and fails in CI, which is the founding defect under a different file name.
#
#   ./scripts/check-on-clone.sh
#
# Exit 0 when a clone would pass every check this ran; 1 when a check failed; 2 when every check
# that ran passed but at least one was SKIPPED for a missing tool — a skip is reported and never
# counted as a pass, because a gate nothing runs is not a gate. Restores the hidden files on any
# exit, including Ctrl-C. The data paths — hiding, restoring, recovering, and refusing to guess —
# are covered by apps/web/test/check-on-clone.test.mjs, which runs this file against a throwaway
# fixture.

set -uo pipefail
cd "$(dirname "$0")/.." || {
  echo "FATAL: cannot enter the repo root" >&2
  exit 1
}
HIDDEN=()
# What gets hidden: paths and globs relative to the repo root, expanded at hide time. Named once,
# because the recovery below must look for exactly these and nothing else: a stash holding
# anything unexpected is a situation to report, not to tidy up by moving strangers into the repo
# root. dev-docs and .codex stay first so the log reads the same as it always has.
HIDE=(dev-docs .codex .cc-suite.md 'grill-report-*.md' '.claude/*.local.*' .agents/skills runs error.log)
# A FIXED path inside the repo, not mktemp.
#
# This script moves gitignored directories aside, which means for the length of a run the only
# copy of them is wherever it put them. The first version used `mktemp -d`, and when a run was
# killed with SIGTERM the trap did not survive: 25 MB of the maintainer's notes — gitignored, so
# not recoverable from git — were left in /var/folders under a random name that nothing would ever
# look for. A fixed, discoverable path inside the repo means a killed run is recoverable BY HAND,
# and the recovery below means it usually does not have to be.
STASH=".check-on-clone-stash"
# Who owns the stash right now. Written inside it, so it moves and vanishes with it.
OWNER="$STASH/.owner"

# Loud, and before anything moves. Every failure this reports is one where continuing would run
# checks against a tree that is not what the script says it is.
die() {
  echo "FATAL: $*" >&2
  exit 1
}

# `-e` follows symlinks and a moved symlink's relative target usually will not resolve, so a
# symlinked dev-docs would be hidden and then silently never restored. Ask about the link itself.
there() { [ -e "$1" ] || [ -L "$1" ]; }

# Every existing path a HIDE entry names under `$1` — the repo root, or the stash — one per line,
# relative to it. Globs expand here and nowhere else; an entry that matches nothing contributes
# nothing (an unmatched glob is left as its own literal text, which `there` then rejects).
matches_under() {
  local base="$1" pattern path
  for pattern in "${HIDE[@]}"; do
    # shellcheck disable=SC2086  # the entry is a glob, and this is where it is meant to expand
    for path in "$base"/$pattern; do
      there "$path" && printf '%s\n' "${path#"$base"/}"
    done
  done
}

restore() {
  for name in "${HIDDEN[@]-}"; do
    [ -n "$name" ] || continue
    there "$STASH/$name" || continue
    # Never `rm -rf` the live copy to make room. If something already exists at the destination,
    # the stash is the copy of unknown provenance and the live one wins; say so and keep both.
    if there "./$name"; then
      echo "WARNING: ./$name reappeared during the run — leaving $STASH/$name in place" >&2
    elif ! mv "$STASH/$name" "./$name"; then
      echo "WARNING: could not restore ./$name — it is still in $STASH" >&2
    fi
  done
  rm -f "$OWNER"
  # The parent directories the stash grew for nested names (.claude/…), empty now and only now.
  find "$STASH" -mindepth 1 -type d -empty -delete 2>/dev/null
  rmdir "$STASH" 2>/dev/null || true
}
trap restore EXIT
# The signal handlers must EXIT, and this is the whole reason they are separate from the EXIT trap.
# `trap restore INT` ran restore and then CARRIED ON: Ctrl-C un-hid the directories and the
# remaining checks ran against a tree that was no longer a clone, so the script could print PASS
# for a condition it had stopped testing. Exiting re-enters the EXIT trap, which is harmless —
# restore skips whatever it has already moved back.
trap 'restore; exit 130' INT
trap 'restore; exit 143' TERM

fail=0
skipped=()
# run <name> <tools> <command...>: run a check, or report it SKIPPED when a tool it needs is not
# installed. A skip is printed as such and remembered for the verdict; it never reads as "ok".
run() {
  local name="$1" tools="$2" tool
  shift 2
  printf '\n=== %s ===\n' "$name"
  # shellcheck disable=SC2086  # a space-separated list of tool names, split on purpose
  for tool in $tools; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      echo "  SKIPPED — needs $tool, which is not installed"
      skipped+=("$name (needs $tool)")
      return 0
    fi
  done
  if "$@"; then echo "  ok"; else echo "  FAILED"; fail=$((fail + 1)); fi
}

# THE DESIGN KIT'S COPY OF THE ICON SOURCE, compared while both are in view — this runs before
# dev-docs is hidden, and CI never sees dev-docs at all. design/icons/ (tracked) is the source
# every icon is built from; dev-docs/design/icons/ carries a byte-identical copy for the design
# kit's previews, and nothing else keeps the two equal. A drifted copy is a FAILED check, not a
# note: the next person to edit the kit's copy would be editing a file nothing builds from.
icon_copies() {
  local src copy drift=0
  for src in design/icons/*.svg; do
    copy="dev-docs/design/icons/${src#design/icons/}"
    [ -e "$copy" ] || continue
    if ! cmp -s "$src" "$copy"; then
      echo "  $copy differs from $src, which is the source — copy the source over it"
      drift=1
    fi
  done
  return $drift
}
if [ -d dev-docs/design/icons ]; then
  run "design-kit icon copies match design/icons/ (the source)" cmp icon_copies
fi

# A LIVE run owns the stash, and a second one must not touch it.
#
# Without this the second invocation sees no dev-docs in the root — the first one has it — reads
# that as an interrupted run, recovers the first run's only copy, and hides it again under itself.
# Whichever finishes first then restores, and the other keeps checking a tree with the directories
# it believes it hid sitting in plain view: a "fresh clone" result for a condition that stopped
# holding halfway through. The recovery below is for a run that is GONE, so it has to be able to
# tell the two apart, and a pid it can signal is what does that.
if [ -f "$OWNER" ]; then
  owner="$(cat "$OWNER" 2>/dev/null || true)"
  if [ -n "$owner" ] && kill -0 "$owner" 2>/dev/null; then
    die "another run of this script (pid $owner) is using $STASH right now.
       Wait for it to finish — two at once would each hide the other's directories."
  fi
  # The owner is gone: this is the interrupted case after all, so recovery may proceed.
  rm -f "$OWNER"
fi

# Recover anything a previous run was killed before restoring, BEFORE hiding anything new.
if [ -d "$STASH" ]; then
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    # A collision is the one case where guessing destroys data, so it stops the run. Continuing
    # used to `mv ./dev-docs "$STASH/dev-docs"` onto a directory that already existed — which
    # moves it INSIDE — so the restore handed back one dev-docs with a second nested inside it,
    # holding two runs' notes merged into one tree. It is also what a second, concurrent run of
    # this script looks like from here, and that must not be resolved by a coin toss either.
    if there "./$name"; then
      die "both ./$name and $STASH/$name exist. Either a previous run was killed, or another run
       is in progress. Reconcile them by hand — this script will not guess which copy is yours."
    fi
    mv "$STASH/$name" "./$name" || die "could not recover ./$name from $STASH"
    echo "recovered ./$name from an interrupted run"
  done < <(matches_under "$STASH")
  find "$STASH" -mindepth 1 -type d -empty -delete 2>/dev/null
  strays="$(find "$STASH" -mindepth 1 -maxdepth 1 ! -name .owner -exec basename {} \; | tr '\n' ' ')"
  if [ -n "$strays" ]; then
    die "$STASH holds something this script did not put there: $strays
       Move it somewhere safe and delete $STASH."
  fi
  rmdir "$STASH" || die "could not remove the empty $STASH"
fi

mkdir -p "$STASH" || die "could not create $STASH"
echo "$$" > "$OWNER" || die "could not claim $STASH"
while IFS= read -r name; do
  [ -n "$name" ] || continue
  # A failed hide is fatal, not a warning. The run would otherwise continue with the file still
  # in place and report PASS for a fresh clone it never simulated — a green that proves nothing,
  # which is worse than a red.
  mkdir -p "$STASH/$(dirname "$name")" || die "could not prepare $STASH for $name"
  mv "./$name" "$STASH/$name" || die "could not hide $name"
  HIDDEN+=("$name")
done < <(matches_under .)
if [ ${#HIDDEN[@]} -gt 0 ]; then
  # Say WHERE, every time. If this run is killed hard enough to skip the trap, this line is the
  # only record of what moved and where it went — and these are gitignored files, so there is no
  # other copy anywhere.
  echo "hidden: ${HIDDEN[*]} -> $STASH (restored on exit; recovered automatically on the next run)"
else
  echo "hidden: nothing"
fi

# The vendored bundles are COMMITTED build artifacts and the app imports them rather than the
# sources; CI rebuilds and diffs them because they have drifted four times.
#
# Compared against what was on disk BEFORE the rebuild, not against HEAD as CI does. The question
# both are asking is "are these built from the current sources", and in CI the two are the same
# check because the tree is clean at the commit. Here it is not: `git diff` also fails for a bundle
# that has been correctly rebuilt and not yet committed, which is the state anyone running this
# script mid-change is in — so it would fail for everyone who had just done the right thing, and be
# learned as noise. Hashing before and after asks the question directly.
vendor_hashes() { find apps/web/vendor -type f -exec shasum {} + | sort; }
bundles() {
  local before after
  before="$(vendor_hashes)"
  pnpm build:panel \
    && pnpm --filter cubus-web build:mcp-guest \
    && pnpm --filter cubus-web build:cube \
    && pnpm --filter cubus-web build:cubejs \
    && pnpm --filter cubus-web build:smartcube || return 1
  after="$(vendor_hashes)"
  if [ "$before" != "$after" ]; then
    echo "  a vendored bundle was behind its source — it has been rebuilt; commit the result" >&2
    return 1
  fi
}

# Exactly the steps the TS job runs, in its order — and it has to STAY exactly, or this reports a
# clone as fine over a gate it never ran. It omitted gan-driver and the vendored-bundle rebuild
# for as long as it existed, while its own comment claimed otherwise. The second argument names
# the tools a check cannot run without; verify-icons.py in particular reports its rsvg-convert
# measurements as informational when the tool is absent, and a run that could only be
# informational is a skip here, not a pass.
run "cube-scanner — check"  pnpm                   pnpm --filter cube-scanner check
run "gan-driver — check"    pnpm                   pnpm --filter gan-driver check
run "vendored bundles"      pnpm                   bundles
run "cubus-web — test"      pnpm                   pnpm --filter cubus-web test
run "icons"                 "python3 rsvg-convert" python3 scripts/verify-icons.py

printf '\n'
if [ "$fail" -gt 0 ]; then
  echo "FAIL: $fail check(s) a fresh clone would fail. Either the missing file is a build INPUT and"
  echo "belongs in the repo, or the caller must guard on its absence and report that it skipped."
  exit 1
fi
if [ ${#skipped[@]} -gt 0 ]; then
  echo "INCOMPLETE: every check that ran passed, but ${#skipped[@]} were SKIPPED for a missing tool,"
  echo "and a skipped check is not a passed one:"
  printf '  %s\n' "${skipped[@]}"
  exit 2
fi
echo "PASS: a fresh clone passes every check this runs."
