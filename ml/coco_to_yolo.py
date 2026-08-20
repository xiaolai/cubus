"""Convert BlenderProc COCO annotations → YOLO detection labels. Pure stdlib, testable.

BlenderProc writes `coco_annotations.json` (bbox in [x, y, w, h] pixels, per-instance, with
occlusion already accounted for — an occluded sticker gets a clipped/absent box). YOLO wants
one `.txt` per image, each line: `class cx cy w h`, all normalized to [0, 1]. Category ids in
the COCO file map to our 6 colour classes (see data.yaml).
"""

from __future__ import annotations

import argparse
import json
import os
from collections import defaultdict


def coco_to_yolo_lines(
    annotations: list[dict],
    img_w: int,
    img_h: int,
    catid_to_class: dict[int, int],
    min_area_px: float = 4.0,
) -> list[str]:
    """YOLO label lines for one image's COCO annotations."""
    lines: list[str] = []
    for a in annotations:
        cls = catid_to_class.get(a["category_id"])
        if cls is None:
            continue
        x, y, w, h = a["bbox"]
        if w * h < min_area_px or w <= 0 or h <= 0:
            continue
        cx = (x + w / 2) / img_w
        cy = (y + h / 2) / img_h
        nw = w / img_w
        nh = h / img_h
        # Clamp to the image (a box grazing the edge shouldn't exceed [0,1]).
        cx = min(max(cx, 0.0), 1.0)
        cy = min(max(cy, 0.0), 1.0)
        nw = min(nw, 1.0)
        nh = min(nh, 1.0)
        lines.append(f"{cls} {cx:.6f} {cy:.6f} {nw:.6f} {nh:.6f}")
    return lines


def convert(coco_path: str, out_dir: str, catid_to_class: dict[int, int]) -> int:
    """Convert a whole COCO file to YOLO .txt files next to `out_dir`. Returns image count."""
    with open(coco_path, encoding="utf-8") as f:
        coco = json.load(f)
    images = {img["id"]: img for img in coco["images"]}
    per_image: dict[int, list[dict]] = defaultdict(list)
    for a in coco["annotations"]:
        per_image[a["image_id"]].append(a)
    os.makedirs(out_dir, exist_ok=True)
    for img_id, img in images.items():
        lines = coco_to_yolo_lines(per_image.get(img_id, []), img["width"], img["height"], catid_to_class)
        stem = os.path.splitext(os.path.basename(img["file_name"]))[0]
        # Newline-terminate every line (an image with no visible sticker → an empty file, which
        # is how YOLO encodes "no objects"). Trailing newlines also keep files concatenation-safe.
        with open(os.path.join(out_dir, f"{stem}.txt"), "w", encoding="utf-8") as f:
            f.write("".join(f"{line}\n" for line in lines))
    return len(images)


# COCO category_id → YOLO class index. The generator stores colours 1-indexed (white=1..blue=6)
# because BlenderProc reserves category_id 0 for background and drops it; the body is 7. Shift
# 1..6 back to 0..5 here; 7 (body) has no entry, so coco_to_yolo_lines skips it.
DEFAULT_MAP = {i + 1: i for i in range(6)}


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("coco", help="path to coco_annotations.json")
    p.add_argument("out", help="output dir for YOLO .txt labels")
    args = p.parse_args()
    n = convert(args.coco, args.out, DEFAULT_MAP)
    print(f"converted {n} images → {args.out}")
