#!/usr/bin/env bash
# Link a git worktree's ignored agent context to the main checkout's.
#
#   scripts/link-worktree-context.sh <worktree>
#
# WHY. The rule files (every AGENTS.md and the CLAUDE.md importing it), .codex and the MCP
# registrations are gitignored, so `git worktree add` gives a worktree none of them, and a copy made
# by hand drifts silently. A LINK cannot drift. The paths are the ones scripts/worktree-context.txt
# names — the one list, which apps/web/test/worktree-context.test.mjs holds every worktree to.
#
# The workspace's scripts/new-worktree.sh (beside main/, not in this repository) runs this right after
# it creates a worktree under ../worktrees/<name>; run it by hand only for a worktree made another way.
# The notes (dev-docs) are not linked: they sit beside the main checkout and every reader finds them
# through git's common directory (scripts/dev-docs-dir.mjs).
#
# WHAT IT REFUSES. A copy is never overwritten unless its content equals main's: a `cp` of one feature
# ledger over another once destroyed four rows for good, because an untracked file has no history.
# Every path is checked BEFORE anything changes; any of these stops the run, naming each path, with
# nothing moved:
#   - the main checkout lacks the path (there is nothing to link to);
#   - the worktree holds a real file or directory whose content differs from main's;
#   - the worktree holds a link to somewhere other than main's copy.
# A copy identical to main's is replaced by a link; a path already linked to main's is left alone, so
# a second run changes nothing. Exit 0 when every path is linked, 1 on a refusal, 2 on bad usage.
#
# Covered by apps/web/test/link-worktree-context.test.mjs, against a throwaway repo and real worktrees.

set -uo pipefail

die() { echo "FATAL: $*" >&2; exit 2; }
# A symlink is a thing that is there even when it dangles; ask about the link itself.
there() { [ -e "$1" ] || [ -L "$1" ]; }

[ $# -eq 1 ] || die "usage: $0 <worktree>"

# The main checkout is the one owning git's common directory — the same answer whichever checkout's
# copy of this script runs.
here="$(cd "$(dirname "$0")/.." && pwd -P)" || die "cannot enter the repo holding this script"
common="$(git -C "$here" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" \
  || die "$here is not inside a git repository"
MAIN="$(cd "$common/.." && pwd -P)" || die "cannot resolve the main checkout from $common"

[ -d "$1" ] || die "$1 is not a directory"
TARGET="$(cd "$1" && pwd -P)" || die "cannot enter $1"
if [ "$TARGET" = "$MAIN" ]; then die "$TARGET is the main checkout itself; give a worktree of it"; fi
if [ "$(git -C "$TARGET" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" != "$common" ] \
  || [ "$(git -C "$TARGET" rev-parse --show-toplevel 2>/dev/null)" != "$TARGET" ]; then
  die "$TARGET is not a worktree of $MAIN (or not its top level)"
fi

MANIFEST="$MAIN/scripts/worktree-context.txt"
[ -f "$MANIFEST" ] || die "no manifest at $MANIFEST"
PATHS=()
while IFS= read -r line || [ -n "$line" ]; do
  line="${line%%#*}"
  line="$(printf '%s' "$line" | tr -d '[:space:]')"
  [ -n "$line" ] || continue
  case "/$line/" in
    */../*|*/./*|//*|*'*'*|*'?'*|*'['*) die "manifest entry is not a plain repo-relative path: $line" ;;
  esac
  PATHS+=("$line")
done < "$MANIFEST"
[ ${#PATHS[@]} -gt 0 ] || die "the manifest names nothing"

# Pass 1: decide every path. Nothing on disk changes here.
refused=()
link=()
replace=()
for p in "${PATHS[@]}"; do
  src="$MAIN/$p"
  dst="$TARGET/$p"
  if ! there "$src"; then
    refused+=("$p: the main checkout has no $p, so there is nothing to link to")
    continue
  fi
  if [ -L "$dst" ]; then
    if [ "$(realpath "$dst" 2>/dev/null)" = "$(realpath "$src")" ]; then
      continue
    fi
    refused+=("$p: is a link to $(readlink "$dst"), not to $src")
  elif there "$dst"; then
    if { [ -d "$src" ] && [ -d "$dst" ] && diff -rq "$src" "$dst" >/dev/null 2>&1; } \
      || { [ -f "$src" ] && [ -f "$dst" ] && cmp -s "$src" "$dst"; }; then
      replace+=("$p")
    else
      refused+=("$p: is a copy that differs from main's — merge what only it holds into $src (row-wise for a ledger), remove it, and run again")
    fi
  else
    link+=("$p")
  fi
done

if [ ${#refused[@]} -gt 0 ]; then
  echo "REFUSED — nothing was changed in $TARGET:" >&2
  printf '  %s\n' "${refused[@]}" >&2
  exit 1
fi

# Pass 2: act. A replaced copy was just shown byte-identical to main's, so removing it loses nothing.
for p in "${replace[@]+"${replace[@]}"}"; do
  rm -rf "${TARGET:?}/$p" || die "could not remove the identical copy $TARGET/$p"
  link+=("$p")
done
for p in "${link[@]+"${link[@]}"}"; do
  mkdir -p "$(dirname "$TARGET/$p")" || die "could not create the directory for $p"
  ln -s "$MAIN/$p" "$TARGET/$p" || die "could not link $p"
  echo "linked $p -> $MAIN/$p"
done
echo "ok: all ${#PATHS[@]} manifest paths in $TARGET link to $MAIN"
