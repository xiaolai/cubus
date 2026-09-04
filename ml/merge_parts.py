"""Merge K parallel BlenderProc COCO parts into one YOLO image+label set.

The parallel renderer gives each worker its own output dir (`OUT/part_<k>/coco`) so their
`write_coco_annotations` calls don't race on a shared file. But every worker numbers its images
000000.jpg, 000001.jpg… — unique only within the part. This flattens all parts into
`OUT/images_all` + `OUT/labels_all`, prefixing each filename with its part index so nothing
collides, and converts the boxes to YOLO labels on the way (reusing coco_to_yolo).

  python3 merge_parts.py --out ~/datasets/cube --parts ~/datasets/cube/part_*

Stdlib only. Idempotent per run: the two output dirs are CLEARED first, so a part that has been
removed or re-rendered since the last merge cannot leave its old images behind — before this,
files were only ever overwritten by filename, and a stale `p3_*.jpg` from a deleted part stayed
in the set with a label nothing had regenerated.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil

from coco_to_yolo import DEFAULT_MAP, coco_to_yolo_lines


def merge(out: str, parts: list[str]) -> tuple[int, int]:
    """Copy every part's images (prefixed) + write their YOLO labels. Returns (images, labels)."""
    img_dir = os.path.join(out, "images_all")
    lbl_dir = os.path.join(out, "labels_all")
    # These two directories are this script's own output and nothing else's; clearing them is
    # what makes the merge a function of the parts rather than of the previous merge.
    for d in (img_dir, lbl_dir):
        shutil.rmtree(d, ignore_errors=True)
        os.makedirs(d)

    n_img = n_with_boxes = 0
    for pi, part in enumerate(sorted(parts)):
        coco_path = os.path.join(part, "coco", "coco_annotations.json")
        if not os.path.exists(coco_path):
            print(f"  part {part}: no coco_annotations.json — skipped")
            continue
        with open(coco_path, encoding="utf-8") as f:
            coco = json.load(f)
        images = {im["id"]: im for im in coco["images"]}
        per_image: dict[int, list[dict]] = {}
        for a in coco["annotations"]:
            per_image.setdefault(a["image_id"], []).append(a)

        for img_id, im in images.items():
            src_img = os.path.join(part, "coco", im["file_name"])  # file_name == "images/NNNNNN.jpg"
            if not os.path.exists(src_img):
                continue
            stem = f"p{pi}_" + os.path.splitext(os.path.basename(im["file_name"]))[0]
            shutil.copy2(src_img, os.path.join(img_dir, stem + ".jpg"))
            lines = coco_to_yolo_lines(per_image.get(img_id, []), im["width"], im["height"], DEFAULT_MAP)
            with open(os.path.join(lbl_dir, stem + ".txt"), "w", encoding="utf-8") as f:
                f.write("".join(f"{line}\n" for line in lines))
            n_img += 1
            n_with_boxes += 1 if lines else 0
    return n_img, n_with_boxes


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True, help="dataset root; writes <out>/images_all + <out>/labels_all")
    p.add_argument("--parts", nargs="+", required=True, help="the part_* dirs to merge")
    args = p.parse_args()
    imgs, labeled = merge(args.out, args.parts)
    print(f"merged {imgs} images ({labeled} with boxes) → {args.out}/images_all + labels_all")
