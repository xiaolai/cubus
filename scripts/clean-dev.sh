#!/usr/bin/env bash
#
# Reclaim the disk a Tauri + Cargo dev loop quietly eats, without touching
# anything the repository actually keeps.
#
#   ./scripts/clean-dev.sh            tier 1 — this project only (default)
#   ./scripts/clean-dev.sh 2          + Cargo's machine-wide registry
#   ./scripts/clean-dev.sh 3          + pnpm store, and a report on the app's own data
#   ./scripts/clean-dev.sh --dry-run  print what each tier would remove
#   ./scripts/clean-dev.sh -y         do not prompt about local release bundles
#
# Tier 3's app-data report is macOS-only: the paths it names live under ~/Library, and on
# Linux or Windows it prunes the pnpm store and says that the rest was not inspected.
#
# WHY THIS IS A SCRIPT AND NOT A LINE IN A DOC. Measured on 2026-09-03: a
# `target/` of 32 GB, which `cargo clean` reported as 44.2 GiB across 129,042
# files, on a tree whose entire committed content is a few tens of MB. That is
# not a tidy-up, it is most of a disk — and the paths that are safe to remove
# are NOT the ones a generic recipe names, because this is a monorepo.
#
# THREE THINGS HERE ARE REPO-SPECIFIC, and each of them is a way to lose work:
#
#   `target/` lives at the WORKSPACE ROOT, not under src-tauri/. `cargo clean`
#   from anywhere walks up to the [workspace] and cleans the right one, so it
#   is the whole reclaim; there is no second target/ to chase. (Cargo rejects
#   `--workspace` on clean — the bare command is already workspace-wide.)
#
#   `apps/desktop/src-tauri/gen/` is mostly TRACKED. `gen/android/` holds the
#   Kotlin plugins and `gen/apple/` holds the Xcode project — both committed,
#   both irreplaceable by a rebuild. Only `gen/schemas/` is generated. A script
#   that removed `gen/` because a recipe said "src-tauri/gen" would delete
#   source code, so this one names `gen/schemas` and nothing else, and refuses
#   outright if git says the path is tracked.
#
#   The frontend is esbuild, not Vite. `apps/web/dist` is the build output;
#   `node_modules/.vite` exists only as a stray. Both are regenerated.
#
# THE ONE THING THAT IS NOT RECOVERABLE is a local release bundle you have
# signed and notarized but not yet uploaded: Apple's staple is per-build, so
# deleting it means re-signing and re-notarizing, against a quota. `cargo clean`
# takes `target/release/bundle` with everything else, so this script stops and
# shows you what is there first. Everything else it removes comes back from a
# build or a download.

set -euo pipefail

TIER=1
DRY_RUN=0
ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    1|2|3) TIER="$arg" ;;
    --dry-run) DRY_RUN=1 ;;
    -y|--yes) ASSUME_YES=1 ;;
    -h|--help) sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $arg (want 1|2|3, --dry-run, -y)" >&2; exit 2 ;;
  esac
done

# Run from the repository root whatever the caller's cwd, so the relative paths
# below cannot resolve somewhere else and delete somebody's unrelated dist/.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! grep -q '^\[workspace\]' Cargo.toml 2>/dev/null; then
  echo "error: $ROOT is not a Cargo workspace root — refusing to remove caches here" >&2
  exit 1
fi

run() {
  if [ "$DRY_RUN" = 1 ]; then
    echo "  would run: $*"
  else
    "$@"
  fi
}

# Remove a generated path, but only after git agrees nothing in it is tracked.
# The check is the point: `gen/schemas` sits beside `gen/android` and
# `gen/apple`, which are committed source, and one wrong path here is a commit
# to recover from rather than a rebuild.
remove_generated() {
  local path="$1"
  [ -e "$path" ] || return 0
  local tracked
  tracked="$(git ls-files -- "$path" | wc -l | tr -d ' ')"
  if [ "$tracked" != "0" ]; then
    echo "  REFUSING $path — git tracks $tracked file(s) there; it is not generated" >&2
    return 0
  fi
  echo "  removing $path ($(du -sh "$path" 2>/dev/null | cut -f1))"
  run rm -rf "$path"
}

sizes() {
  echo "=== $1 ==="
  du -sh target 2>/dev/null || echo "  0B  target (absent)"
  du -sh apps/web/dist 2>/dev/null || true
  du -sh "$HOME/.cargo/registry" "$HOME/.cargo/git" 2>/dev/null || true
  if [ "$TIER" = 3 ]; then
    # Asked of pnpm, not assumed: the store lives under ~/Library on macOS and ~/.local/share
    # elsewhere, and a hard-coded macOS path reported nothing on any other OS.
    store="$(pnpm store path 2>/dev/null || true)"
    if [ -n "$store" ]; then du -sh "$store" 2>/dev/null || true; fi
  fi
  df -h / | tail -1 | awk '{print "  " $4 " free on /"}'
}

sizes BEFORE
echo

# ---- the un-uploaded bundle check, before anything is removed ---------------
# BOTH places a macOS bundle lands. `tauri build` writes target/release/bundle; the release
# workflow's `--target universal-apple-darwin` writes target/universal-apple-darwin/release/bundle,
# which is where a locally reproduced release build sits — and where this check did not look, so
# a notarized universal dmg could be deleted without the prompt this block exists to give.
BUNDLES=()
for b in target/release/bundle target/universal-apple-darwin/release/bundle; do
  [ -d "$b" ] && BUNDLES+=("$b")
done
found=""
if [ ${#BUNDLES[@]} -gt 0 ]; then
  found="$(find "${BUNDLES[@]}" -type f \( -name '*.dmg' -o -name '*.app' -o -name '*.tar.gz' \) 2>/dev/null | head -1)"
fi
if [ -n "$found" ]; then
  echo "Local release bundles present — these are the only thing here a rebuild"
  echo "cannot fully replace, because notarization is per-build:"
  find "${BUNDLES[@]}" -type f \( -name '*.dmg' -o -name '*.tar.gz' \) -exec ls -lh {} \; 2>/dev/null \
    | awk '{print "  " $5 "  " $6 " " $7 " " $9}'
  if [ "$ASSUME_YES" != 1 ] && [ "$DRY_RUN" != 1 ]; then
    if [ -t 0 ]; then
      read -r -p "Delete them along with target/? [y/N] " reply
      case "$reply" in
        y|Y|yes|YES) ;;
        *) echo "aborted — upload or move the bundle first, then re-run"; exit 1 ;;
      esac
    else
      echo "not a terminal and -y not given — refusing to delete unreviewed bundles" >&2
      exit 1
    fi
  fi
  echo
fi

# ---- tier 1: this project ---------------------------------------------------
echo "Tier 1 — project-local"
echo "  cargo clean (workspace target/, every profile, including release/bundle)"
run cargo clean
remove_generated apps/web/dist
remove_generated node_modules/.vite
remove_generated apps/desktop/src-tauri/gen/schemas

# ---- tier 2: Cargo's machine-wide caches ------------------------------------
if [ "$TIER" != 1 ]; then
  echo
  echo "Tier 2 — Cargo registry (machine-wide; every Rust project re-downloads)"
  if command -v cargo-cache >/dev/null 2>&1; then
    run cargo cache -r all
  else
    # CACHEDIR.TAG at the registry root is what keeps Time Machine and restic
    # out of it; Cargo rewrites it on next use, so removing the subdirectories
    # rather than the whole registry keeps that true in the meantime.
    run rm -rf "$HOME/.cargo/registry/cache" "$HOME/.cargo/registry/src"
    run rm -rf "$HOME/.cargo/git/db" "$HOME/.cargo/git/checkouts"
  fi
fi

# ---- tier 3: pnpm store, and the app's own data -----------------------------
if [ "$TIER" = 3 ]; then
  echo
  echo "Tier 3 — pnpm store"
  run pnpm store prune

  # DESTRUCTIVE, and different in kind from everything above: this is the dev
  # build's USER DATA. For this app that is the cube registry, recent solves,
  # settings and the hidden-nav choice — the same localStorage a stray MCP
  # `clear_browsing_data` wiped on 2026-08-27 with no backup. Never implicit.
  #
  # macOS paths only. Tauri keeps the same data under ~/.local/share and
  # ~/.cache on Linux and %APPDATA% on Windows, but this report has only ever
  # been checked against a Mac, so elsewhere it says so rather than guessing.
  if [ "$(uname -s)" = Darwin ]; then
    APP_DATA="$HOME/Library/Application Support/im.cubus.app"
    APP_CACHE="$HOME/Library/Caches/im.cubus.app"
    if [ -d "$APP_DATA" ] || [ -d "$APP_CACHE" ]; then
      echo
      echo "The dev app's own data is NOT removed by this script:"
      [ -d "$APP_DATA" ] && echo "  $APP_DATA  ($(du -sh "$APP_DATA" 2>/dev/null | cut -f1)) — settings, cubes, recent solves"
      [ -d "$APP_CACHE" ] && echo "  $APP_CACHE  ($(du -sh "$APP_CACHE" 2>/dev/null | cut -f1))"
      echo "  Remove by hand if you are deliberately resetting onboarding state."
    fi
  else
    echo
    echo "The app-data report is macOS-only; on $(uname -s) the app's own data was not inspected."
  fi
fi

echo
sizes AFTER
echo
[ "$DRY_RUN" = 1 ] && echo "(dry run — nothing was removed)"
echo "Next cargo build is a full rebuild: tauri, wry and btleplug are minutes, not seconds."
