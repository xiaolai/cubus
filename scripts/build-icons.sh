#!/usr/bin/env bash
#
# Rebuild every shipped icon raster from the one source mark.
#
#   dev-docs/design/icons/cubus-icon-flat.svg   <- the ONLY hand-authored file
#
# Everything this script writes is derived. Hand-editing any output is always
# wrong: the next run overwrites it, and in the meantime two surfaces disagree.
#
# Run this after any change to the mark, then run scripts/build-macos-glass-icon.sh
# (which needs Xcode) and scripts/verify-icons.py (which needs neither).
#
# Three masters, three different treatments, because the platforms genuinely
# differ:
#
#   icon.svg         824x824 squircle inside a 1024 canvas, 100px gutter per
#                    side. macOS stopped auto-masking app PNGs at Big Sur, so
#                    an icon without this renders ~12% larger than every
#                    conformant app in the Dock. Feeds icon.icns ONLY.
#
#   icon-square.svg  full-bleed squircle, no gutter. Windows and Linux neither
#                    mask nor inset, and have no gutter convention: artwork
#                    should fill its box. Feeds icon.ico, the Linux PNG ladder
#                    and the Square*Logo set.
#
#   Cubus.icon/Assets/mark.svg
#                    the FLAT mark, edge to edge, no background. macOS 26
#                    applies mask, gradient, specular and shadow itself.
#
# Every PNG is forced through `magick PNG32:` on the way out. rsvg-convert
# emits 3-channel RGB whenever the artwork is fully opaque, and Tauri
# hard-rejects a non-RGBA bundle icon with `icon <path> is not RGBA` — which
# fails the whole crate compile, not just the bundling step.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
icons="$repo_root/apps/desktop/src-tauri/icons"
web="$repo_root/apps/web/icons"
design="$repo_root/dev-docs/design/icons"

for tool in rsvg-convert magick iconutil; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "build-icons: missing required tool '$tool'" >&2
    exit 1
  }
done

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# --- 1. derive every SVG from the flat source --------------------------------
echo "==> deriving SVGs from cubus-icon-flat.svg"
python3 "$repo_root/scripts/make-icon-svgs.py"

# render <svg> <size> <out.png> — rasterise square, then force RGBA.
# The PNG32: is not cosmetic; see the header note about Tauri rejecting RGB.
render() {
  local src="$1" size="$2" out="$3"
  rsvg-convert -w "$size" -h "$size" "$src" -o "$work/r.png"
  magick "$work/r.png" -strip PNG32:"$out"
}

# --- 2. macOS: the full .icns ladder from the gutter master ------------------
# Every rung is rendered from the SVG at its own pixel size rather than
# downsampled from 1024. Downsampling a squircle softens the corner; rendering
# at size keeps it crisp, which is the whole point at 16 and 32.
echo "==> macOS icon.icns (from icon.svg, 824/1024 gutter master)"
iconset="$work/Cubus.iconset"
mkdir -p "$iconset"
# name:pixels — the full ladder iconutil expects. Missing rungs are why a
# Retina Dock upscales and looks soft.
for entry in \
  icon_16x16.png:16 icon_16x16@2x.png:32 \
  icon_32x32.png:32 icon_32x32@2x.png:64 \
  icon_128x128.png:128 icon_128x128@2x.png:256 \
  icon_256x256.png:256 icon_256x256@2x.png:512 \
  icon_512x512.png:512 icon_512x512@2x.png:1024; do
  render "$icons/icon.svg" "${entry##*:}" "$iconset/${entry%%:*}"
done
rm -f "$icons/icon.icns"
iconutil -c icns "$iconset" -o "$icons/icon.icns"

# --- 3. Linux PNG ladder + the generic raster --------------------------------
# Tauri's deb/AppImage bundlers read these out of `bundle.icon` and install
# them into share/icons/hicolor/<w>x<h>/apps/. They are also what becomes the
# default window icon on Linux.
echo "==> Linux PNG ladder (from icon-square.svg, full-bleed master)"
for entry in 32x32.png:32 64x64.png:64 128x128.png:128 128x128@2x.png:256 \
  256x256.png:256 512x512.png:512 icon.png:1024; do
  render "$icons/icon-square.svg" "${entry##*:}" "$icons/${entry%%:*}"
done

# --- 4. Windows --------------------------------------------------------------
# A multi-resolution .ico. Each member is rendered at its own size for the same
# reason as the .icns ladder; `magick ... -define icon:auto-resize` would
# downsample one bitmap instead, which visibly muddies 16 and 24.
echo "==> Windows icon.ico (16/24/32/48/64/128/256)"
ico_members=()
for size in 16 24 32 48 64 128 256; do
  render "$icons/icon-square.svg" "$size" "$work/ico-$size.png"
  ico_members+=("$work/ico-$size.png")
done
rm -f "$icons/icon.ico"
python3 "$repo_root/scripts/make-ico.py" "$icons/icon.ico" "${ico_members[@]}"

echo "==> Windows Square*Logo set"
for entry in Square30x30Logo.png:30 Square44x44Logo.png:44 Square71x71Logo.png:71 \
  Square89x89Logo.png:89 Square107x107Logo.png:107 Square142x142Logo.png:142 \
  Square150x150Logo.png:150 Square284x284Logo.png:284 Square310x310Logo.png:310 \
  StoreLogo.png:50; do
  render "$icons/icon-square.svg" "${entry##*:}" "$icons/${entry%%:*}"
done

# --- 5. the macOS 26 layered-icon layer --------------------------------------
# A PNG, not the SVG. actool's SVG rasteriser is a narrower renderer than
# rsvg-convert: layers carrying filters or gradients compile without a murmur
# and render BLACK, and clip paths are not documented as supported. This mark
# uses a clip path, so it goes in as pixels and the question does not arise.
echo "==> Cubus.icon layer (flat mark, 1024, RGBA)"
mkdir -p "$icons/Cubus.icon/Assets"
render "$icons/Cubus.icon/Assets/mark.svg" 1024 "$icons/Cubus.icon/Assets/mark.png"

# --- 6. web ------------------------------------------------------------------
echo "==> web favicons and PWA tiles"
mkdir -p "$web"
for entry in favicon-16.png:16 favicon-32.png:32 favicon-48.png:48; do
  render "$web/icon.svg" "${entry##*:}" "$web/${entry%%:*}"
done
rm -f "$web/favicon.ico"
python3 "$repo_root/scripts/make-ico.py" "$web/favicon.ico" \
  "$web/favicon-16.png" "$web/favicon-32.png" "$web/favicon-48.png"

# purpose="any": displayed unmasked, so it carries its own squircle.
for entry in icon-192.png:192 icon-512.png:512; do
  render "$web/icon-squircle.svg" "${entry##*:}" "$web/${entry%%:*}"
done

# purpose="maskable" and apple-touch-icon: the platform crops to its own shape.
# apple-touch-icon must have NO alpha — iOS composites a transparent one on
# black, which would put a black ring around the tile.
for entry in icon-maskable-192.png:192 icon-maskable-512.png:512; do
  render "$web/icon-tile.svg" "${entry##*:}" "$web/${entry%%:*}"
done
rsvg-convert -w 180 -h 180 "$web/icon-tile.svg" -o "$work/apple.png"
magick "$work/apple.png" -background "#F6F2E9" -alpha remove -alpha off \
  -strip PNG24:"$web/apple-touch-icon.png"

# --- 7. design-kit rasters ---------------------------------------------------
# The design kit's own preview rasters, refreshed from the same source so the
# kit cannot drift from what ships. These are design assets, not build inputs:
# no Tauri mobile target exists, so nothing consumes ios/ or android/.
echo "==> design-kit preview rasters"
for entry in icon_16x16.png:16 icon_32x32.png:32 icon_64x64.png:64 \
  icon_128x128.png:128 icon_256x256.png:256 icon_512x512.png:512 \
  icon_1024x1024.png:1024; do
  render "$design/cubus-icon-appicon.svg" "${entry##*:}" "$design/macos/${entry%%:*}"
done

echo
echo "build-icons: done. Next:"
echo "  scripts/build-macos-glass-icon.sh   # needs Xcode 26+, compiles Assets.car"
echo "  scripts/verify-icons.py             # measures everything above"
