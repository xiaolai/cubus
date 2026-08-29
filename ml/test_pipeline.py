"""Off-GPU tests for the pure pipeline pieces. Run: `python3 ml/test_pipeline.py`."""

from __future__ import annotations

import math

import colorsys
import random

from coco_to_yolo import DEFAULT_MAP, coco_to_yolo_lines
from cube_colors import (
    MIN_RED_ORANGE_SEPARATION,
    ORANGE,
    RED,
    cube_palette,
    hue_of,
    shade_sticker,
)
from cube_geometry import FACE_NAMES, HALF, RAISE, stickers


def test_cube_geometry() -> None:
    s = stickers()
    assert len(s) == 54, f"expected 54 stickers, got {len(s)}"
    # 9 per face
    per_face: dict[str, int] = {}
    for st in s:
        per_face[st.face] = per_face.get(st.face, 0) + 1
    assert all(per_face[f] == 9 for f in FACE_NAMES), per_face
    # Every sticker sits on the cube surface: its max |coord| ≈ HALF+RAISE, and it stays
    # within the face (other two coords within the cube half-extent).
    for st in s:
        cx, cy, cz = st.center
        m = max(abs(cx), abs(cy), abs(cz))
        assert math.isclose(m, HALF + RAISE, abs_tol=1e-6), (st.face, st.center)
        # the in-plane extent (center ± u ± v) must stay within the face
        for du in (-1, 1):
            for dv in (-1, 1):
                corner = (cx + du * st.u[0] + dv * st.v[0],
                          cy + du * st.u[1] + dv * st.v[1],
                          cz + du * st.u[2] + dv * st.v[2])
                # the two axes not equal to the face normal stay within [-HALF, HALF]
                for c in corner:
                    assert abs(c) <= HALF + RAISE + 1e-6, (st.face, corner)
    print("PASS cube_geometry: 54 stickers, 9/face, all on-surface & within bounds")


def test_one_cube_has_one_pigment_per_colour() -> None:
    """Every sticker of a colour on one cube shares that colour's hue exactly.

    The v3 generator drew hue per STICKER, so a cube's nine reds spanned 13.6 deg of hue on
    average and 28.2% of cubes contained a red rendered hue-orangier than one of their own
    oranges — two stickers of the same apparent colour carrying opposite labels. This asserts the
    thing that made that impossible: per-sticker variation is shading, never hue identity.
    """
    rng = random.Random(11)
    checked = 0
    for _ in range(200):
        wide = rng.random() < 0.6
        palette = cube_palette(rng, wide)
        for colour, pigment in enumerate(palette):
            hues = set()
            for _ in range(9):
                rgb = tuple(shade_sticker(pigment, rng, wide)[:3])
                # Hue is UNDEFINED for an achromatic sticker: an untinted white is grey, and
                # rgb_to_hsv reports 0 for it, which is not a hue that disagrees with anything.
                # Only stickers carrying actual colour can be asked to agree about it.
                if colorsys.rgb_to_hsv(*rgb)[1] < 0.02:
                    continue
                hues.add(round(hue_of(rgb), 6))
            if len(hues) <= 1:
                continue
            raise AssertionError(f"colour {colour} rendered {len(hues)} different hues on one cube")
        checked += 1
    assert checked == 200
    print("PASS cube_colors: one pigment per colour per cube — shading varies, hue does not")


def test_orange_is_never_redder_than_red() -> None:
    """No real cube's orange is hue-redder than its red, so no rendered one may be either.

    Hoisting the draw alone would not give this: an independent per-cube draw still inverts the
    pair about 1.4% of the time, and a systematically inverted cube is worse than per-sticker
    noise, because every sticker in the image then agrees on the wrong thing.
    """
    rng = random.Random(29)
    worst = 1.0
    for _ in range(2000):
        wide = rng.random() < 0.6
        palette = cube_palette(rng, wide)
        # Compare the extremes actually rendered, not just the pigments.
        reds = [hue_of(tuple(shade_sticker(palette[RED], rng, wide)[:3])) for _ in range(9)]
        oranges = [hue_of(tuple(shade_sticker(palette[ORANGE], rng, wide)[:3])) for _ in range(9)]
        margin = min(oranges) - max(reds)
        worst = min(worst, margin)
        assert margin > 0.0, f"a red rendered hue-orangier than an orange (margin {margin})"
    assert worst >= MIN_RED_ORANGE_SEPARATION - 1e-9, (
        f"separation floor not honoured: worst margin {worst * 360:.2f} deg"
    )
    print(f"PASS cube_colors: orange never redder than red (worst margin {worst * 360:.1f} deg)")


def test_coco_to_yolo() -> None:
    # COCO ids are 1-indexed (white=1..blue=6, body=7); DEFAULT_MAP shifts 1..6 → classes 0..5.
    # A 100x200 image: one white (cat 1 → class 0), one red (cat 2 → class 1), one tiny (dropped).
    anns = [
        {"category_id": 1, "bbox": [10, 20, 30, 40]},  # cx=25,cy=40 → 0.25,0.20 ; w=0.30,h=0.20
        {"category_id": 2, "bbox": [50, 100, 20, 20]},
        {"category_id": 3, "bbox": [0, 0, 1, 1]},  # area 1 < 4 → dropped
    ]
    lines = coco_to_yolo_lines(anns, img_w=100, img_h=200, catid_to_class=DEFAULT_MAP)
    assert len(lines) == 2, lines
    assert lines[0] == "0 0.250000 0.200000 0.300000 0.200000", lines[0]
    assert lines[1] == "1 0.600000 0.550000 0.200000 0.100000", lines[1]
    # Regression guard for the BlenderProc background bug: category_id 0 (background) and 7 (the
    # cube body) must never emit a label — only the six colour ids 1..6 are mapped.
    assert 0 not in DEFAULT_MAP and 7 not in DEFAULT_MAP, DEFAULT_MAP
    assert coco_to_yolo_lines([{"category_id": 0, "bbox": [0, 0, 50, 50]}], 100, 100, DEFAULT_MAP) == []
    assert coco_to_yolo_lines([{"category_id": 7, "bbox": [0, 0, 50, 50]}], 100, 100, DEFAULT_MAP) == []
    # unknown category is skipped
    assert coco_to_yolo_lines([{"category_id": 99, "bbox": [0, 0, 50, 50]}], 100, 100, DEFAULT_MAP) == []
    print("PASS coco_to_yolo: 1-indexed shift, normalization, area filter, background/body/unknown skip")


if __name__ == "__main__":
    test_cube_geometry()
    test_one_cube_has_one_pigment_per_colour()
    test_orange_is_never_redder_than_red()
    test_coco_to_yolo()
    print("ALL PASS")
