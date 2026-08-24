#!/usr/bin/env python3
"""Derive every icon SVG in the repo from ONE source mark.

The single source of truth is `dev-docs/design/icons/cubus-icon-flat.svg`: the
"Fold" mark as drawn, with no shading and no background. Everything else — the
light/dark previews, the macOS legacy tile, the Windows/Linux tile, the `.icon`
layer and the web tiles — is a mechanical transform of it and is written by
this script. Editing a derived file by hand is always wrong; it will be
overwritten the next time `scripts/build-icons.sh` runs.

The mark stays FLAT on every surface. An earlier revision of the design baked
light and shadow into the three faces — white 0.08 on the top, dark at 0.10 and
0.22 on the left and right — and that was deliberately removed: flat, clear
colours are the design. Nothing here re-synthesises it.

That happens to be exactly what the macOS 26 layered `.icon` wants anyway,
since the system applies the squircle mask, the background gradient, a
per-layer specular highlight and a drop shadow at composite time, and baked
shading would double up with it. The three faces read as a cube from the
isometric geometry and their three distinct hues, not from shading.

What still differs per platform is the CANVAS, not the mark: how much gutter
the artwork carries and whether it draws its own squircle. See the three
compositions in main().

Geometry facts read off the source and asserted below, so a change to the mark
that breaks an assumption fails loudly instead of shipping crooked:

  - The 400x400 artboard holds a rounded hexagon centred on (200, 200) whose
    every vertex is exactly 160 from that centre. So the mark's circumradius is
    0.40 of the artboard width, which is also the PWA maskable safe-zone radius.
  - The mark is 6 paths: three (face, arch) pairs in top / left / right order.
"""

from __future__ import annotations

import math
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DESIGN = REPO / "dev-docs" / "design" / "icons"
SOURCE = DESIGN / "cubus-icon-flat.svg"

# --- palette -----------------------------------------------------------------
# Pinned as literals, not tokens. An icon sits on the user's wallpaper; it must
# not move when the app's theme changes. These are the app's `muted` cube
# palette and must not drift from it.
BLUE = "#3C6E9E"
RED = "#B8503F"
YELLOW = "#D8B84A"
CREAM = "#F6F2E9"  # paper, light background
INK = "#241F18"  # ink, dark background

# --- geometry ----------------------------------------------------------------
ARTBOARD = 400.0  # the source viewBox
CANVAS = 1024.0  # every raster master is authored at 1024
GUTTER = 100.0  # Apple HIG: 100px transparent gutter per side at 1024 ...
TILE = CANVAS - 2 * GUTTER  # ... leaving an 824x824 tile
SUPERELLIPSE_N = 5.0  # |x/a|^n + |y/a|^n = 1 — Apple's continuous corner
SUPERELLIPSE_SAMPLES = 720

# How much of its tile the mark occupies. One number, applied to every surface,
# so the icon is the same size whether macOS composites the layered `.icon`,
# falls back to the `.icns`, or Windows draws the `.ico`.
#
# MEASURED, not chosen. The design kit originally used 0.86 (a 14% inset). That
# read small beside other Dock icons, so this is set to match ChatGPT.app, which
# was measured through NSWorkspace.icon(forFile:) — the system composite, not
# the source file:
#
#   ChatGPT knot   0.791 of the tile in both axes, stable across luminance
#                  thresholds 100-200, so inscribed in a circle of radius
#                  0.3955 of the tile.
#   Fold mark      a rounded hexagon whose every vertex is exactly 0.40 of the
#                  artboard from centre, so its circumradius is 0.40 * scale.
#
# Matching circumradius is the right equivalence for two marks that are both
# roughly circular, and 0.40 * 0.99 = 0.396 lands on ChatGPT's 0.3955.
#
# 0.99 is also the practical ceiling: the PWA maskable safe zone guarantees
# only a centred circle of radius 0.40 of the canvas, and 0.396 sits just
# inside it. Going further would push the hexagon's vertices out of the
# guaranteed-visible region. verify-icons.py measures that, so the constraint
# is enforced rather than remembered.
MARK_IN_TILE = 0.99


class SourceError(RuntimeError):
    """The source mark no longer has the shape this script assumes."""


def fmt(value: float) -> str:
    """Trim a float to 4 decimals without trailing zeros, for compact paths."""
    text = f"{value:.4f}".rstrip("0").rstrip(".")
    return "0" if text in ("", "-0") else text


def superellipse_path(cx: float, cy: float, half: float) -> str:
    """A closed superellipse as a sampled polygon.

    Apple's icon corner is a continuous-curvature superellipse, not a rounded
    rectangle. An arc-based rounded rect meets the straight edge with a jump in
    curvature, which is exactly what makes it read as boxy beside real icons.
    Sampling the real curve costs a few hundred bytes and removes the question.
    """
    points = []
    for i in range(SUPERELLIPSE_SAMPLES):
        t = 2.0 * math.pi * i / SUPERELLIPSE_SAMPLES
        ct, st = math.cos(t), math.sin(t)
        x = half * math.copysign(abs(ct) ** (2.0 / SUPERELLIPSE_N), ct)
        y = half * math.copysign(abs(st) ** (2.0 / SUPERELLIPSE_N), st)
        points.append(f"{fmt(cx + x)} {fmt(cy + y)}")
    return "M" + "L".join(points) + "Z"


# --- source parsing ----------------------------------------------------------

_CLIP_RE = re.compile(r'<clipPath id="[^"]*">\s*<path d="([^"]+)"', re.S)
_PATH_RE = re.compile(
    r'<path d="([^"]+)"(?:\s+transform="([^"]+)")?\s+fill="([^"]+)"\s*>', re.S
)


class Mark:
    """The parsed source mark: a clip silhouette and three (face, arch) pairs."""

    def __init__(self, svg_text: str) -> None:
        clip = _CLIP_RE.search(svg_text)
        if not clip:
            raise SourceError("no <clipPath> with a <path d=...> in the source")
        self.clip_d = clip.group(1).strip()

        body = svg_text.split("</defs>", 1)[-1]
        paths = _PATH_RE.findall(body)
        if len(paths) != 6:
            raise SourceError(
                f"expected 6 paths (3 face/arch pairs), found {len(paths)}. "
                "This script assumes that pairing."
            )
        # Faces are the even entries, arches the odd ones.
        self.faces = [(d.strip(), fill) for d, tf, fill in paths[0::2]]
        self.arches = [(d.strip(), tf, fill) for d, tf, fill in paths[1::2]]

        for d, tf, _ in self.arches:
            if not tf:
                raise SourceError("an arch path has no transform= matrix")
        for _, tf, _ in [(d, tf, f) for d, tf, f in paths[0::2]]:
            if tf:
                raise SourceError("a face path unexpectedly carries a transform")

        face_fills = {fill.upper() for _, fill in self.faces}
        if face_fills != {BLUE, RED, YELLOW}:
            raise SourceError(
                f"face colours {sorted(face_fills)} are not the muted palette "
                f"{sorted([BLUE, RED, YELLOW])} — the palette must not drift"
            )

    def circumradius(self) -> float:
        """Max distance from the artboard centre to any face vertex.

        Used to prove the PWA maskable safe zone is respected, and to prove the
        mark fits inside the squircle without being clipped.
        """
        centre = ARTBOARD / 2.0
        best = 0.0
        for d, _ in self.faces:
            for xs, ys in re.findall(r"(-?[\d.]+)\s+(-?[\d.]+)", d):
                best = max(best, math.hypot(float(xs) - centre, float(ys) - centre))
        return best

    def body(self, indent: str = "  ") -> str:
        """The six drawing paths, in order, as SVG text.

        Flat, always. The faces carry their palette colour and nothing else.
        """
        out = []
        for (face_d, face_fill), (arch_d, arch_tf, arch_fill) in zip(
            self.faces, self.arches, strict=True
        ):
            out.append(f'{indent}<path d="{face_d}" fill="{face_fill}"/>')
            out.append(
                f'{indent}<path d="{arch_d}" transform="{arch_tf}" fill="{arch_fill}"/>'
            )
        return "\n".join(out)


# --- SVG emission ------------------------------------------------------------

BANNER = """<!--
  GENERATED by scripts/make-icon-svgs.py from cubus-icon-flat.svg.
  Do not edit: run scripts/build-icons.sh instead. {what}
-->"""


def wrap(
    mark: Mark,
    *,
    size: float,
    background: str | None,
    background_path: str | None,
    scale: float,
    what: str,
) -> str:
    """Compose one icon SVG.

    `scale` maps the 400 artboard onto the canvas, applied about the centre so
    the mark stays centred whatever the inset.
    """
    centre = size / 2.0
    art_centre = ARTBOARD / 2.0
    bg = ""
    if background_path is not None and background is not None:
        bg = f'\n<path d="{background_path}" fill="{background}"/>'
    elif background is not None:
        bg = f'\n<rect width="{fmt(size)}" height="{fmt(size)}" fill="{background}"/>'

    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {fmt(size)} {fmt(size)}" \
width="{fmt(size)}" height="{fmt(size)}">
{BANNER.format(what=what)}
<defs><clipPath id="silo"><path d="{mark.clip_d}"/></clipPath></defs>{bg}
<g transform="translate({fmt(centre)} {fmt(centre)}) scale({fmt(scale)}) \
translate({fmt(-art_centre)} {fmt(-art_centre)})">
<g clip-path="url(#silo)">
{mark.body()}
</g>
</g>
</svg>
"""


def main() -> int:
    if not SOURCE.exists():
        print(f"make-icon-svgs: missing source {SOURCE}", file=sys.stderr)
        return 1
    mark = Mark(SOURCE.read_text(encoding="utf-8"))

    # Prove the geometry assumption the maskable and squircle maths rely on.
    r = mark.circumradius()
    expected = 0.40 * ARTBOARD
    if abs(r - expected) > 0.01:
        raise SourceError(
            f"mark circumradius is {r:.3f}, expected {expected:.3f} "
            "(0.40 of the artboard). The maskable safe-zone and squircle-fit "
            "derivations below assume it."
        )

    # Scale factors. `full` maps the artboard edge-to-edge onto the canvas;
    # every composition is that times the design's own inset within its tile.
    full = CANVAS / ARTBOARD  # 2.56
    tile_only = TILE / ARTBOARD  # 2.06 — the gutter-inset macOS tile
    outputs: dict[Path, str] = {}

    # 1. Design-kit SVGs. The previews are derived, not authored; regenerating
    #    them is what keeps the kit from drifting away from the source.
    outputs[DESIGN / "cubus-icon.svg"] = wrap(
        mark,
        size=ARTBOARD,
        background=None,
        background_path=None,
        scale=1.0,
        what="The mark, transparent — the reference mark for print and docs.",
    )
    outputs[DESIGN / "cubus-icon-light.svg"] = wrap(
        mark,
        size=ARTBOARD,
        background=CREAM,
        background_path=None,
        scale=1.0,
        what="The mark on paper cream — light preview.",
    )
    outputs[DESIGN / "cubus-icon-dark.svg"] = wrap(
        mark,
        size=ARTBOARD,
        background=INK,
        background_path=None,
        scale=1.0,
        what="The mark on ink — dark preview.",
    )
    outputs[DESIGN / "cubus-icon-appicon.svg"] = wrap(
        mark,
        size=ARTBOARD,
        background=CREAM,
        background_path=None,
        scale=MARK_IN_TILE,
        what="Full-bleed cream tile — the mobile / maskable composition.",
    )

    icons = REPO / "apps" / "desktop" / "src-tauri" / "icons"
    web = REPO / "apps" / "web" / "icons"

    # 2. macOS legacy master. macOS has not auto-masked app PNGs since Big Sur,
    #    so the 824/1024 squircle and its 100px gutter have to be in the file.
    #    Without it the Dock draws this icon about 12% larger than every
    #    conformant neighbour.
    outputs[icons / "icon.svg"] = wrap(
        mark,
        size=CANVAS,
        background=CREAM,
        background_path=superellipse_path(CANVAS / 2, CANVAS / 2, TILE / 2),
        scale=tile_only * MARK_IN_TILE,
        what=(
            "macOS legacy master: 824x824 squircle in a 1024 canvas, 100px "
            "gutter per side. Feeds icon.icns only."
        ),
    )

    # 3. Windows / Linux master. Neither platform masks or insets, and neither
    #    has a gutter convention: the artwork should fill its box. Same
    #    superellipse so the silhouette matches macOS, but edge to edge.
    outputs[icons / "icon-square.svg"] = wrap(
        mark,
        size=CANVAS,
        background=CREAM,
        background_path=superellipse_path(CANVAS / 2, CANVAS / 2, CANVAS / 2),
        scale=full * MARK_IN_TILE,
        what=(
            "Windows / Linux master: full-bleed squircle, no gutter. Feeds "
            "icon.ico, the Linux PNG ladder and the Square*Logo set."
        ),
    )

    # 4. The macOS 26 layered-icon layer. FLAT, and edge to edge on 1024: the
    #    system supplies mask, gutter, gradient, specular and shadow. A layer
    #    that draws its own squircle gets inset twice. The background is the
    #    manifest's `fill`, not a layer, so this file has none.
    outputs[icons / "Cubus.icon" / "Assets" / "mark.svg"] = wrap(
        mark,
        size=CANVAS,
        background=None,
        background_path=None,
        scale=full * MARK_IN_TILE,
        what=(
            "Layer source for Cubus.icon — macOS 26 lights it. Rasterised to "
            "mark.png by build-icons.sh; actool consumes the PNG."
        ),
    )

    # 5. Web. Favicons keep the transparent mark (they sit on browser chrome of
    #    unknown colour and a cream plate would read as a box); the installable
    #    tiles get the full-bleed composition.
    outputs[web / "icon.svg"] = wrap(
        mark,
        size=ARTBOARD,
        background=None,
        background_path=None,
        scale=1.0,
        what="Scalable favicon: the mark, transparent.",
    )
    outputs[web / "icon-squircle.svg"] = wrap(
        mark,
        size=CANVAS,
        background=CREAM,
        background_path=superellipse_path(CANVAS / 2, CANVAS / 2, CANVAS / 2),
        scale=full * MARK_IN_TILE,
        what=(
            'PWA purpose="any": shown unmasked, so it carries its own squircle. '
            "Same composition as the Windows / Linux master."
        ),
    )
    outputs[web / "icon-tile.svg"] = wrap(
        mark,
        size=CANVAS,
        background=CREAM,
        background_path=None,
        scale=full * MARK_IN_TILE,
        what=(
            'PWA purpose="maskable" and apple-touch-icon: the platform crops to '
            "its own shape, so this one is a full-bleed square with no alpha to "
            "crop away. The mark's circumradius lands at 0.396 of the canvas, "
            "inside the 0.40 maskable safe-zone circle."
        ),
    )

    for path, text in sorted(outputs.items()):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        print(f"  wrote {path.relative_to(REPO)}")

    print(f"make-icon-svgs: {len(outputs)} SVGs derived from {SOURCE.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
