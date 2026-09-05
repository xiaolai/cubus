#!/usr/bin/env bash
#
# Take the artifacts `tauri build` just produced and finish the two steps it
# does not do, then prove the result with Gatekeeper's own verdict.
#
#   ./scripts/sign-macos.sh                      verify only, change nothing
#   ./scripts/sign-macos.sh --profile <name>     notarize + staple + verify
#
# APPLE_SIGNING_IDENTITY must be set to the certificate's exact name, as
# `security find-identity -v -p codesigning` prints it ("Developer ID
# Application: …"). It is the same variable `tauri build` signs with.
#
# `<name>` is a notarytool keychain profile, created once per Apple account:
#
#   xcrun notarytool store-credentials cubus --apple-id <id> --team-id <team>
#
# A profile is used rather than --apple-id/--password so the app-specific
# password never reaches argv, a process listing, or a build log.
#
# ---------------------------------------------------------------------------
# What Tauri already does, and what it leaves undone
#
# Given APPLE_SIGNING_IDENTITY, tauri-bundler 2.11 signs the inner binary, then
# the .app, then the .dmg — all three with the hardened runtime and a secure
# timestamp. So this script does NOT sign from scratch; the widely repeated
# claim that Tauri leaves the dmg unsigned is out of date, and `codesign -dvvv`
# on a fresh build is what settles it.
#
# What Tauri skips without APPLE_ID/APPLE_PASSWORD/APPLE_TEAM_ID is
# notarization, and notarization is the half that decides whether the app opens
# on a Mac that is not this one. A Developer ID signature alone is `rejected /
# source=Unnotarized Developer ID` — the "damaged and can't be opened" dialog.
#
# ---------------------------------------------------------------------------
# Why the app is stapled and then swapped into the dmg, rather than the dmg
# alone being notarized
#
# Notarizing the dmg does register the enclosed app's cdhash with Apple, so the
# app dragged out to /Applications is accepted — by an ONLINE lookup. With no
# network on first launch, Gatekeeper finds no local ticket and blocks it. The
# fix is a ticket physically inside the .app, which means stapling the .app
# before it is sealed into the disk image.
#
# The image is rebuilt by payload swap — convert to read/write, replace the app,
# convert back — instead of by re-running Tauri's bundle_dmg.sh. Re-running it
# would mean reconstructing an argument list this repo does not own, and any
# drift in Tauri's defaults would silently change the window geometry, the
# volume icon or the Applications symlink. Swapping the payload leaves the
# volume name, .DS_Store icon positions and every other cosmetic byte untouched,
# because they are never regenerated. The swap does destroy the image's
# signature, so the dmg is re-signed afterwards — that is expected, not a repair.
#
# Order is load-bearing throughout and must not be rearranged:
#
#   staple app -> rebuild dmg -> sign dmg -> notarize dmg -> staple dmg
#
# Rebuilding the dmg before the app is stapled ships the ticketless app.
# Signing before rebuilding signs an image that is about to be thrown away.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Locate the bundle under ANY target triple, not just the native one.
#
# `tauri build` writes to target/release/bundle/, but `tauri build --target
# universal-apple-darwin` writes to target/universal-apple-darwin/release/bundle/ — and the
# release workflow builds universal. This script had the native path hardcoded, so it worked on
# a developer Mac and died in CI with `find: .../target/release/bundle/dmg: No such file or
# directory`, AFTER notarytool had already validated credentials. Searching is the fix: there is
# exactly one macOS bundle in a given build, and preferring the universal one when both exist
# matches what a release actually ships.
find_bundle() {
  local kind="$1" name="$2" hit
  for base in "$ROOT/target/universal-apple-darwin/release/bundle" \
              "$ROOT/target/release/bundle" \
              "$ROOT/target"/*/release/bundle; do
    [ -d "$base/$kind" ] || continue
    hit="$(find "$base/$kind" -maxdepth 1 -name "$name" -not -name 'rw.*' | head -1)"
    [ -n "$hit" ] && { printf '%s' "$hit"; return 0; }
  done
  return 1
}

APP="$(find_bundle macos 'cubus.app' || true)"
DMG_DIR="$(dirname "$(find_bundle dmg 'cubus_*.dmg' || echo "$ROOT/target/release/bundle/dmg/none")")"
IDENTITY="${APPLE_SIGNING_IDENTITY:-}"
PROFILE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="${2:?--profile needs a notarytool keychain profile name}"; shift 2 ;;
    -h|--help) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

# The identity is REQUIRED from the environment and never defaulted. It used to fall back to the
# owner's own "Developer ID Application: …" string, which made the script look runnable on any
# machine and fail one step later on a keychain lookup for a certificate that was never there —
# and a checked-out script is not the place for one person's certificate name. The release
# workflow passes APPLE_SIGNING_IDENTITY explicitly and checks it is set before calling this.
[ -n "$IDENTITY" ] || {
  echo "FAIL: APPLE_SIGNING_IDENTITY is not set — export the certificate's exact name, e.g." >&2
  echo "      APPLE_SIGNING_IDENTITY='Developer ID Application: <name> (<team>)' (see: security find-identity -v -p codesigning)" >&2
  exit 1
}

DMG="$(find "$DMG_DIR" -maxdepth 1 -name 'cubus_*.dmg' -not -name 'rw.*' | head -1)"
[ -d "$APP" ] || { echo "FAIL: no app bundle at $APP — run 'pnpm build:desktop' first" >&2; exit 1; }
[ -n "$DMG" ] || { echo "FAIL: no dmg in $DMG_DIR — run 'pnpm build:desktop' first" >&2; exit 1; }

# Never echo "$@" here: with --password it would write the secret to the log.
# The label is what gets printed; the argv is not.
retry() {
  local label="$1"; shift
  local i
  for i in 1 2 3 4 5; do
    "$@" && return 0
    echo "  attempt $i failed, retrying in 10s: $label" >&2
    sleep 10
  done
  echo "FAIL: gave up after 5 attempts: $label" >&2
  return 1
}

# Mount points are cleaned up even when a step between attach and detach fails,
# otherwise a failed run leaves the image mounted and the next run cannot
# convert it.
MOUNT=""
cleanup() {
  [ -n "$MOUNT" ] && hdiutil detach "$MOUNT" -quiet >/dev/null 2>&1 || true
  MOUNT=""
}
trap cleanup EXIT

# --- preflight -------------------------------------------------------------
# Each of these has been an actual failure mode, and each one is invisible in a
# build that exits 0.

echo "== preflight"
security find-identity -v -p codesigning | grep -qF "$IDENTITY" \
  || { echo "FAIL: signing identity not in keychain: $IDENTITY" >&2; exit 1; }
echo "  identity present: $IDENTITY"

# Captured into variables rather than piped straight into `grep -q`. Under
# `pipefail` that pipeline is a trap: grep -q exits on its first match, codesign
# then dies on EPIPE, and the non-zero producer fails the whole check — so a
# passing assertion reports FAIL, at random, depending on who wins the race.
# Matching against a captured string has no producer left to kill.
SIG_INFO="$(codesign -dvvv "$APP" 2>&1)"
ENTITLEMENTS="$(codesign -d --entitlements :- "$APP" 2>/dev/null)"

# get-task-allow makes a release build debuggable and is rejected by the notary
# service. Its absence is asserted rather than assumed.
case "$ENTITLEMENTS" in
  *get-task-allow*) echo "FAIL: get-task-allow is present in the release build" >&2; exit 1 ;;
esac
echo "  no get-task-allow"

# The camera entitlement is the half Info.plist cannot supply. Without it the
# signed app prompts, is granted permission, and still cannot open a capture
# device — and this does not reproduce in an unsigned local build, so nothing
# short of an assertion catches it.
case "$ENTITLEMENTS" in
  *com.apple.security.device.camera*) echo "  camera entitlement present" ;;
  *) echo "FAIL: com.apple.security.device.camera entitlement missing — the scanner will not work" >&2; exit 1 ;;
esac

case "$SIG_INFO" in
  *"flags=0x10000(runtime)"*) echo "  hardened runtime enabled" ;;
  *) echo "FAIL: hardened runtime is not enabled — the notary service will reject this" >&2; exit 1 ;;
esac

case "$SIG_INFO" in
  *"Authority=Developer ID Application"*) echo "  Developer ID signature (not ad-hoc)" ;;
  *) echo "FAIL: not signed with a Developer ID Application certificate" >&2; exit 1 ;;
esac

case "$SIG_INFO" in
  *Timestamp=*) echo "  secure timestamp present" ;;
  *) echo "FAIL: no secure timestamp — the signature expires with the certificate" >&2; exit 1 ;;
esac

codesign --verify --deep --strict "$APP"
echo "  signature valid (--deep --strict)"

# Gatekeeper's verdict on both artifacts. `if !` is used rather than `|| true`
# so nothing is swallowed: in verify-only mode a rejection is the EXPECTED
# reading of an un-notarized build and is reported as such, while in the
# notarized path further down the same check is allowed to fail the script.
report_verdict() {
  local label="$1"; shift
  local out
  if out="$("$@" 2>&1)"; then
    echo "  $label: $(printf '%s' "$out" | grep -E 'source=|accepted' | tr '\n' ' ')"
    return 0
  fi
  echo "  $label: $(printf '%s' "$out" | grep -E 'source=|rejected' | tr '\n' ' ')"
  return 1
}

if [ -z "$PROFILE" ]; then
  echo
  echo "== verify only (no --profile given)"
  app_ok=0; dmg_ok=0
  report_verdict "app" spctl -a -vv -t exec "$APP" || app_ok=1
  report_verdict "dmg" spctl -a -vv -t open --context context:primary-signature "$DMG" || dmg_ok=1
  echo
  if [ "$app_ok" -eq 0 ] && [ "$dmg_ok" -eq 0 ]; then
    echo "Both accepted by Gatekeeper."
  else
    echo "Signed, not notarized. This opens on this Mac and is refused on any"
    echo "other one that received it through a channel that sets the quarantine"
    echo "attribute. Re-run with --profile <name> to finish."
  fi
  exit 0
fi

# --- notarize and staple the app -------------------------------------------

echo
echo "== notarize app"
ZIP="$(mktemp -d)/cubus.zip"
ditto -c -k --keepParent "$APP" "$ZIP"
retry "notarytool submit (app)" xcrun notarytool submit "$ZIP" --keychain-profile "$PROFILE" --wait
retry "stapler staple (app)" xcrun stapler staple "$APP"
xcrun stapler validate "$APP"
echo "  app stapled"

# --- rebuild the dmg around the stapled app --------------------------------

echo
echo "== rebuild dmg around the stapled app"
APP_NAME="$(basename "$APP")"
WORK="$(mktemp -d)"
RW="$WORK/rw.dmg"

hdiutil convert "$DMG" -format UDRW -o "$RW" -quiet
# The stapled app is a few KB larger than the one already inside, and a
# converted image carries almost no slack. Grow it generously — the final UDZO
# size is set by content, so the slack costs nothing in the shipped artifact.
SLACK_MB=$(( $(du -sm "$APP" | cut -f1) + 200 ))
hdiutil resize -size "${SLACK_MB}m" "$RW" >/dev/null

MOUNT="$WORK/mnt"
mkdir -p "$MOUNT"
hdiutil attach "$RW" -nobrowse -quiet -mountpoint "$MOUNT"
[ -d "$MOUNT/$APP_NAME" ] || { echo "FAIL: $APP_NAME not found inside the dmg" >&2; exit 1; }
# Replace rather than merge: ditto onto an existing bundle would leave stale
# files from the old one in place.
rm -rf "${MOUNT:?}/$APP_NAME"
ditto "$APP" "$MOUNT/$APP_NAME"
xcrun stapler validate "$MOUNT/$APP_NAME"
hdiutil detach "$MOUNT" -quiet
MOUNT=""

rm -f "$DMG"
hdiutil convert "$RW" -format UDZO -o "$DMG" -quiet
echo "  dmg rebuilt: $(basename "$DMG")"

# --- sign, notarize and staple the dmg -------------------------------------

echo
echo "== sign and notarize dmg"
# The conversion above discarded the signature Tauri applied. Not a repair —
# a signature cannot survive its container being rewritten.
codesign --force --timestamp --sign "$IDENTITY" "$DMG"
codesign --verify --strict --verbose=2 "$DMG"
retry "notarytool submit (dmg)" xcrun notarytool submit "$DMG" --keychain-profile "$PROFILE" --wait
retry "stapler staple (dmg)" xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG"

# --- verify ----------------------------------------------------------------
# No `|| true` anywhere below. A verification that cannot fail is not one, and
# the exit status of the app check is propagated deliberately.

echo
echo "== verify"
spctl -a -vv -t open --context context:primary-signature "$DMG"

MOUNT="$WORK/verify"
mkdir -p "$MOUNT"
hdiutil attach "$DMG" -nobrowse -quiet -mountpoint "$MOUNT"
spctl -a -vv -t exec "$MOUNT/$APP_NAME"
# Proves first launch works with no network, which the spctl check above does
# not: spctl silently falls back to an online lookup.
xcrun stapler validate "$MOUNT/$APP_NAME"
hdiutil detach "$MOUNT" -quiet
MOUNT=""

echo
echo "OK: $DMG"
echo "Signed, notarized and stapled. Opens on any Mac, online or off."
