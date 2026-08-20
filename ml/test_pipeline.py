"""Off-GPU tests for the pure pipeline pieces. Run: `python3 ml/test_pipeline.py`."""

from __future__ import annotations

import math

from coco_to_yolo import DEFAULT_MAP, coco_to_yolo_lines
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


def test_coco_to_yolo() -> None:
    # A 100x200 image with two boxes: one red (cat 1), one green (cat 2), one tiny (dropped).
    anns = [
        {"category_id": 1, "bbox": [10, 20, 30, 40]},  # cx=25,cy=40 → 0.25,0.20 ; w=0.30,h=0.20
        {"category_id": 2, "bbox": [50, 100, 20, 20]},
        {"category_id": 3, "bbox": [0, 0, 1, 1]},  # area 1 < 4 → dropped
    ]
    lines = coco_to_yolo_lines(anns, img_w=100, img_h=200, catid_to_class=DEFAULT_MAP)
    assert len(lines) == 2, lines
    assert lines[0] == "1 0.250000 0.200000 0.300000 0.200000", lines[0]
    assert lines[1] == "2 0.600000 0.550000 0.200000 0.100000", lines[1]
    # unknown category is skipped
    assert coco_to_yolo_lines([{"category_id": 99, "bbox": [0, 0, 50, 50]}], 100, 100, DEFAULT_MAP) == []
    print("PASS coco_to_yolo: normalization, area filter, unknown-category skip")


if __name__ == "__main__":
    test_cube_geometry()
    test_coco_to_yolo()
    print("ALL PASS")
