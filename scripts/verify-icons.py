#!/usr/bin/env python3
"""Measure every shipped icon against its platform's spec.

Nothing here is a rendering preference. Every assertion is a number read off
the pixels or the file container, because the failures these catch — an icon
12% too large in the Dock, an `.icns` missing a Retina rung, a layered icon
that compiled to a black tile — all look completely fine in the source SVG.

Run after scripts/build-icons.sh and scripts/build-macos-glass-icon.sh:

    python3 scripts/verify-icons.py

Exits non-zero on the first failed expectation, and prints every measurement it
took either way so a change in a number is visible even when it still passes.
"""

from __future__ import annotations

import json
import math
import struct
import subprocess
import sys
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
ICONS = REPO / "apps" / "desktop" / "src-tauri" / "icons"
WEB = REPO / "apps" / "web" / "icons"
DESIGN = REPO / "dev-docs" / "design" / "icons"

CANVAS = 1024
GUTTER = 100
TILE = CANVAS - 2 * GUTTER
SUPERELLIPSE_N = 5.0

PALETTE = {
    "blue": (0x3C, 0x6E, 0x9E),
    "red": (0xB8, 0x50, 0x3F),
    "yellow": (0xD8, 0xB8, 0x4A),
}
CREAM = (0xF6, 0xF2, 0xE9)

results: list[tuple[str, str, str, bool, bool]] = []


def check(name: str, expected: str, got: str, ok: bool, *, gated: bool = True) -> None:
    """Record a measurement. `gated=False` reports a number without failing on it."""
    results.append((name, expected, got, ok, gated))


def alpha_bbox(path: Path, threshold: int = 128) -> tuple[int, int, int, int] | None:
    """Opaque bounding box, thresholding alpha rather than trusting getbbox().

    getbbox() treats alpha 1 as opaque, so antialiased fringe inflates the box
    by a pixel or two and a real gutter measurement comes out wrong.
    """
    im = Image.open(path).convert("RGBA")
    mask = im.split()[3].point(lambda a: 255 if a >= threshold else 0)
    return mask.getbbox()


def relative_luminance(rgb: tuple[int, int, int]) -> float:
    """WCAG relative luminance, with the sRGB gamma expansion.

    A plain channel average badly misjudges green and would report a passing
    ratio for a mark that is genuinely hard to see.
    """

    def channel(c: int) -> float:
        s = c / 255.0
        return s / 12.92 if s <= 0.04045 else ((s + 0.055) / 1.055) ** 2.4

    r, g, b = (channel(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_ratio(a: tuple[int, int, int], b: tuple[int, int, int]) -> float:
    la, lb = relative_luminance(a), relative_luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


# --- 1. the macOS legacy gutter ---------------------------------------------
# macOS has not auto-masked app PNGs since Big Sur. Artwork must occupy an
# 824x824 squircle inside a 1024 canvas with exactly 100px of transparent
# gutter per side, or the Dock renders it about 12% larger than every
# conformant neighbour. Measured off the alpha channel, not read off the SVG.


def verify_gutter() -> None:
    src = ICONS / "icon.svg"
    out = REPO / ".verify-gutter.png"
    subprocess.run(
        ["rsvg-convert", "-w", str(CANVAS), "-h", str(CANVAS), str(src), "-o", str(out)],
        check=True,
    )
    try:
        box = alpha_bbox(out)
        assert box is not None
        left, top, right, bottom = box
        gutters = (left, top, CANVAS - right, CANVAS - bottom)
        check(
            "macOS master gutter (l,t,r,b) @1024",
            f"({GUTTER}, {GUTTER}, {GUTTER}, {GUTTER})",
            str(gutters),
            all(g == GUTTER for g in gutters),
        )
        check(
            "macOS master tile size",
            f"{TILE}x{TILE}",
            f"{right - left}x{bottom - top}",
            (right - left, bottom - top) == (TILE, TILE),
        )

        # A rectangular bbox cannot see a mark poking through a rounded corner.
        # Test every opaque pixel against the superellipse itself.
        im = Image.open(out).convert("RGBA")
        alpha = im.split()[3].load()
        half = TILE / 2.0
        centre = CANVAS / 2.0
        outside = 0
        for y in range(CANVAS):
            dy = abs(y + 0.5 - centre) / half
            if dy > 1.0:
                if any(alpha[x, y] >= 128 for x in range(CANVAS)):
                    outside += 1
                continue
            # Solve the superellipse for the max |x| at this row.
            max_dx = (1.0 - dy**SUPERELLIPSE_N) ** (1.0 / SUPERELLIPSE_N)
            limit = max_dx * half + 1.5  # 1.5px tolerance for antialiasing
            for x in range(CANVAS):
                if alpha[x, y] >= 128 and abs(x + 0.5 - centre) > limit:
                    outside += 1
                    break
        check(
            "macOS master: opaque pixels outside the squircle",
            "0 rows",
            f"{outside} rows",
            outside == 0,
        )
    finally:
        out.unlink(missing_ok=True)


# --- 2. the .icns ladder -----------------------------------------------------
# Parse the ICNS container directly. `iconutil -c iconset` corrupts on the way
# OUT — the legacy ic04/ic05 members come back with the blue channel zeroed —
# so a perfectly good file looks like broken artwork at 16 and 32. Reading the
# container's own members avoids the question entirely.

ICNS_EXPECTED = {
    "ic04": 16,
    "ic05": 32,
    "ic07": 128,
    "ic08": 256,
    "ic09": 512,
    "ic10": 1024,
    "ic11": 32,
    "ic12": 64,
    "ic13": 256,
    "ic14": 512,
}


def parse_icns(path: Path) -> dict[str, int]:
    """Return {member type: byte length} by walking the container."""
    data = path.read_bytes()
    if data[:4] != b"icns":
        raise ValueError(f"{path} is not an ICNS container")
    total = struct.unpack(">I", data[4:8])[0]
    members: dict[str, int] = {}
    offset = 8
    while offset < min(total, len(data)):
        kind = data[offset : offset + 4].decode("ascii", "replace")
        length = struct.unpack(">I", data[offset + 4 : offset + 8])[0]
        if length < 8:
            break
        members[kind] = length - 8
        offset += length
    return members


def verify_icns() -> None:
    members = parse_icns(ICONS / "icon.icns")
    missing = sorted(set(ICNS_EXPECTED) - set(members))
    check(
        "icon.icns ladder members",
        f"{len(ICNS_EXPECTED)} rungs, none missing",
        f"{len(members)} present"
        + (f", MISSING {missing}" if missing else ", none missing"),
        not missing,
    )

    # Render through ImageIO (`sips`), the path macOS itself uses, and confirm
    # the pixels are the artwork rather than an empty or black plate.
    for size in (16, 32, 128, 512):
        out = REPO / f".verify-icns-{size}.png"
        subprocess.run(
            ["sips", "-s", "format", "png", "-Z", str(size),
             str(ICONS / "icon.icns"), "--out", str(out)],
            check=True, capture_output=True,
        )
        try:
            im = Image.open(out).convert("RGBA")
            px = [p for p in im.getdata() if p[3] > 200]
            mean = tuple(round(sum(c[i] for c in px) / len(px)) for i in range(3))
            check(
                f"icon.icns @{size} rendered mean RGB (not black/empty)",
                "every channel > 60",
                str(mean),
                all(c > 60 for c in mean),
            )
        finally:
            out.unlink(missing_ok=True)


# --- 3. the .ico -------------------------------------------------------------


def parse_ico(path: Path) -> list[tuple[int, int]]:
    data = path.read_bytes()
    reserved, kind, count = struct.unpack("<HHH", data[:6])
    if reserved != 0 or kind != 1:
        raise ValueError(f"{path} is not an ICO")
    sizes = []
    for i in range(count):
        entry = 6 + i * 16
        w = data[entry] or 256
        h = data[entry + 1] or 256
        sizes.append((w, h))
    return sizes


def verify_ico() -> None:
    want = [(s, s) for s in (16, 24, 32, 48, 64, 128, 256)]
    got = sorted(parse_ico(ICONS / "icon.ico"))
    check(
        "icon.ico resolutions",
        str([s for s, _ in want]),
        str([s for s, _ in got]),
        got == sorted(want),
    )
    fav = sorted(parse_ico(WEB / "favicon.ico"))
    check(
        "favicon.ico resolutions",
        "[16, 32, 48]",
        str([s for s, _ in fav]),
        fav == [(16, 16), (32, 32), (48, 48)],
    )

    # scripts/make-ico.py writes the BMP members by hand — a header with a
    # doubled height, bottom-up BGRA rows and a padded AND mask. That is easy
    # to get subtly wrong in a way that still produces a plausible file, so
    # decode every member back and compare it against a fresh render of the
    # same source at the same size.
    for ico, src, sizes in (
        (ICONS / "icon.ico", ICONS / "icon-square.svg",
         (16, 24, 32, 48, 64, 128, 256)),
        (WEB / "favicon.ico", WEB / "icon.svg", (16, 32, 48)),
    ):
        im = Image.open(ico)
        worst = 0
        for size in sizes:
            member = im.ico.getimage((size, size)).convert("RGBA")
            tmp = REPO / f".verify-ico-{size}.png"
            subprocess.run(
                ["rsvg-convert", "-w", str(size), "-h", str(size), str(src),
                 "-o", str(tmp)],
                check=True,
            )
            try:
                ref = Image.open(tmp).convert("RGBA")
                if member.size != (size, size):
                    worst = 255
                    break
                worst = max(
                    worst,
                    max(
                        abs(a - b)
                        for pa, pb in zip(member.getdata(), ref.getdata())
                        for a, b in zip(pa, pb)
                    ),
                )
            finally:
                tmp.unlink(missing_ok=True)
        check(
            f"{ico.name} members decode back to the source pixels",
            "max channel diff 0",
            str(worst),
            worst == 0,
        )

    # The 256 member must not be a raw BMP: 32-bit uncompressed is 270KB on its
    # own, which is how this file was once 372KB.
    data = (ICONS / "icon.ico").read_bytes()
    count = struct.unpack("<H", data[4:6])[0]
    encodings = {}
    for i in range(count):
        entry = 6 + i * 16
        w = data[entry] or 256
        off = struct.unpack("<I", data[entry + 12 : entry + 16])[0]
        encodings[w] = "PNG" if data[off : off + 4] == b"\x89PNG" else "BMP"
    check(
        "icon.ico large members are PNG-compressed",
        "128 and 256 = PNG",
        f"{encodings}, file={len(data)} bytes",
        encodings.get(128) == "PNG" and encodings.get(256) == "PNG",
    )


# --- 4. RGBA, because Tauri hard-rejects anything else -----------------------
# `icon <path> is not RGBA` fails the whole crate compile, not just bundling.


def verify_rgba() -> None:
    conf = json.loads((ICONS.parent / "tauri.conf.json").read_text())
    listed = [p for p in conf["bundle"]["icon"] if p.endswith(".png")]
    bad = []
    for rel in listed:
        path = ICONS.parent / rel
        if not path.exists():
            bad.append(f"{rel} MISSING")
        elif Image.open(path).mode != "RGBA":
            bad.append(f"{rel} is {Image.open(path).mode}")
    check(
        "every bundle.icon PNG is RGBA and present",
        f"{len(listed)} files, all RGBA",
        "all RGBA" if not bad else str(bad),
        not bad,
    )


# --- 5. the layered icon, rendered -------------------------------------------
# Inspecting Assets.car proves nothing about the picture: the picture does not
# exist until the renderer makes it. A layer actool cannot rasterise compiles
# without a murmur and renders black.

ICTOOL = Path(
    "/Applications/Xcode.app/Contents/Applications/Icon Composer.app"
    "/Contents/Executables/ictool"
)


def verify_glass() -> None:
    car = ICONS / "Assets.car"
    check(
        "Assets.car exists and is non-empty",
        "> 0 bytes",
        f"{car.stat().st_size} bytes" if car.exists() else "MISSING",
        car.exists() and car.stat().st_size > 0,
    )
    if car.exists():
        info = subprocess.run(
            ["assetutil", "--info", str(car)], capture_output=True, text=True
        ).stdout
        check(
            "Assets.car declares the app icon CFBundleIconName looks up",
            'an asset named "Cubus"',
            "found" if '"Cubus"' in info else "NOT FOUND",
            '"Cubus"' in info,
        )

    if not ICTOOL.exists():
        check("layered icon rendered", "ictool present", "ictool MISSING", False)
        return

    for rendition in ("Default", "Dark"):
        out = REPO / f".verify-glass-{rendition}.png"
        subprocess.run(
            [str(ICTOOL), str(ICONS / "Cubus.icon"), "--export-image",
             "--output-file", str(out), "--platform", "macOS",
             "--rendition", rendition, "--width", "512", "--height", "512",
             "--scale", "1"],
            check=True, capture_output=True,
        )
        try:
            im = Image.open(out).convert("RGBA")
            px = [p for p in im.getdata() if p[3] > 200]
            mean = tuple(round(sum(c[i] for c in px) / len(px)) for i in range(3))
            check(
                f"layered {rendition}: not a black tile",
                "mean RGB every channel > 30",
                str(mean),
                all(c > 30 for c in mean),
            )
            # A background layer occluding the mark yields a clean, plausible
            # and entirely wrong tile that sails past the not-black check.
            # Count pixels near each brand colour instead.
            found = {}
            for name, target in PALETTE.items():
                n = sum(
                    1
                    for p in px
                    if max(abs(p[i] - target[i]) for i in range(3)) <= 40
                )
                found[name] = n
            check(
                f"layered {rendition}: all three brand colours visible",
                "each > 2000 px of 512x512",
                str(found),
                all(v > 2000 for v in found.values()),
            )
        finally:
            out.unlink(missing_ok=True)


# --- 6. web ------------------------------------------------------------------


def verify_web() -> None:
    # apple-touch-icon must be fully opaque. iOS composites a transparent one
    # against black, which puts a black ring around the tile.
    im = Image.open(WEB / "apple-touch-icon.png")
    has_alpha = im.mode in ("RGBA", "LA") and im.split()[-1].getextrema()[0] < 255
    check(
        "apple-touch-icon.png is fully opaque",
        "no transparency",
        f"mode={im.mode}, transparent pixels={'yes' if has_alpha else 'no'}",
        not has_alpha,
    )
    check(
        "apple-touch-icon.png size",
        "180x180",
        f"{im.size[0]}x{im.size[1]}",
        im.size == (180, 180),
    )

    # Maskable safe zone: content must sit inside a centred circle of radius
    # 40% of the canvas. Measure the farthest opaque pixel from the centre of
    # the MARK, ignoring the full-bleed background it sits on.
    path = WEB / "icon-maskable-512.png"
    im = Image.open(path).convert("RGB")
    w, h = im.size
    cx, cy = w / 2.0, h / 2.0
    px = im.load()
    worst = 0.0
    for y in range(h):
        for x in range(w):
            if max(abs(px[x, y][i] - CREAM[i]) for i in range(3)) > 24:
                worst = max(worst, math.hypot(x + 0.5 - cx, y + 0.5 - cy))
    frac = worst / w
    check(
        "maskable-512 mark circumradius (safe zone)",
        "<= 0.40 of width",
        f"{frac:.4f}",
        frac <= 0.40,
    )

    for name, size in (("icon-192.png", 192), ("icon-512.png", 512),
                       ("icon-maskable-192.png", 192),
                       ("icon-maskable-512.png", 512)):
        p = WEB / name
        ok = p.exists() and Image.open(p).size == (size, size)
        check(
            f"web {name}",
            f"{size}x{size} present",
            f"{Image.open(p).size}" if p.exists() else "MISSING",
            ok,
        )


# --- 7. palette fidelity and contrast ---------------------------------------


def verify_palette() -> None:
    """The brand colours must survive rasterisation unchanged.

    This is also what enforces that the faces stay FLAT. An earlier revision
    baked light and shadow into them (white 0.08 on the top face, #1A1208 at
    0.10 and 0.22 on the left and right); that was deliberately removed, and a
    shaded face no longer contains its exact palette colour anywhere — the
    right face came out (175, 148, 59) instead of #D8B84A. So checking every
    SHIPPING master for the exact literal is a direct test that nothing has
    re-introduced an overlay.
    """
    for label, src in (
        ("flat source", DESIGN / "cubus-icon-flat.svg"),
        ("macOS master", ICONS / "icon.svg"),
        ("Win/Linux master", ICONS / "icon-square.svg"),
        ("layer", ICONS / "Cubus.icon" / "Assets" / "mark.svg"),
    ):
        out = REPO / ".verify-palette.png"
        subprocess.run(
            ["rsvg-convert", "-w", "1024", "-h", "1024", str(src), "-o", str(out)],
            check=True,
        )
        try:
            im = Image.open(out).convert("RGBA")
            present = {p[:3] for p in im.getdata() if p[3] == 255}
            missing = [n for n, rgb in PALETTE.items() if rgb not in present]
            check(
                f"{label}: faces are flat, exact palette",
                "all 3 literals present",
                "all present" if not missing else f"MISSING {missing} (shaded?)",
                not missing,
            )
        finally:
            out.unlink(missing_ok=True)

    # Contrast, reported but NOT gated — and the reason matters.
    #
    # WCAG relative luminance is the wrong instrument for this mark. Fold is
    # hue-coded: it is a Rubik's cube, so the three colours ARE the meaning,
    # and they sit at deliberately similar luminance. Measured as rendered,
    # adjacent faces are 1.25:1 (top/left), 1.52:1 (top/right) and 1.90:1
    # (left/right) — all far below any luminance threshold, while being
    # instantly distinguishable to the eye because they differ in hue, which
    # relative luminance cannot see. WCAG 1.4.3 and 1.4.11 both exempt
    # logotypes for exactly this reason.
    #
    # So these numbers are context, not a gate. The property that actually
    # matters — can you still read three faces when the icon is 16px — is
    # measured directly by verify_small_sizes() below.
    for name, rgb in PALETTE.items():
        ratio = contrast_ratio(rgb, CREAM)
        check(
            f"contrast {name} on cream (informational)",
            "logotype: exempt",
            f"{ratio:.2f}:1",
            True,
            gated=False,
        )


# --- 8. legibility at the size that actually breaks icons -------------------
# Most icon mistakes are invisible at 1024 and fatal at 16. Classify every
# non-plate pixel of the rendered tile by nearest brand colour and require each
# of the three faces to still hold a real share of the mark. A face that has
# blurred away into its neighbours stops claiming pixels, which is the failure
# this catches and which no measurement at 1024 can see.


def verify_small_sizes() -> None:
    for size in (16, 32, 64):
        out = REPO / f".verify-small-{size}.png"
        subprocess.run(
            ["rsvg-convert", "-w", str(size), "-h", str(size),
             str(ICONS / "icon.svg"), "-o", str(out)],
            check=True,
        )
        try:
            im = Image.open(out).convert("RGBA")
            px = im.load()
            counts = {k: 0 for k in PALETTE}
            mark_total = 0
            for y in range(size):
                for x in range(size):
                    r, g, b, a = px[x, y]
                    if a < 200:
                        continue
                    # Skip the cream plate; everything else belongs to the mark.
                    if max(abs((r, g, b)[i] - CREAM[i]) for i in range(3)) <= 30:
                        continue
                    mark_total += 1
                    nearest = min(
                        PALETTE,
                        key=lambda k: sum(
                            ((r, g, b)[i] - PALETTE[k][i]) ** 2 for i in range(3)
                        ),
                    )
                    counts[nearest] += 1
            shares = {k: (v / mark_total if mark_total else 0.0) for k, v in counts.items()}
            # Each face is geometrically about a third of the mark. A floor of
            # 10% is generous enough to absorb antialiasing at 16px while still
            # catching a face that has genuinely disappeared.
            check(
                f"@{size}px: all three faces still legible",
                "each face >= 10% of mark pixels",
                ", ".join(f"{k}={v:.0%}" for k, v in shares.items()),
                all(v >= 0.10 for v in shares.values()) and mark_total > 0,
            )
        finally:
            out.unlink(missing_ok=True)


def main() -> int:
    verify_gutter()
    verify_icns()
    verify_ico()
    verify_rgba()
    verify_glass()
    verify_web()
    verify_palette()
    verify_small_sizes()

    width = max(len(r[0]) for r in results)
    failures = 0
    gated = 0
    print(f"\n{'CHECK'.ljust(width)}  {'EXPECTED':<30} {'GOT':<38} RESULT")
    print("-" * (width + 80))
    for name, expected, got, ok, is_gated in results:
        if is_gated:
            gated += 1
            if not ok:
                failures += 1
            verdict = "pass" if ok else "FAIL"
        else:
            verdict = "info"
        print(f"{name.ljust(width)}  {expected:<30} {got:<38} {verdict}")
    print("-" * (width + 80))
    print(f"{gated} gated checks, {failures} failed; {len(results) - gated} informational")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
